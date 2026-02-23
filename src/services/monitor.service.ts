/**
 * 聲量監控服務
 * 負責接收外部 Agent 資料、匹配關鍵字、分類、儲存提及記錄
 * 所有爬蟲功能已移交外部 Agent 處理
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { createHash } from 'crypto';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';
import classifierService, { ClassificationResult } from './classifier.service';
import aiClassifierService from './ai-classifier.service';

interface MonitorSource {
    id: string;
    name: string;
    url: string;
    platform: string;
    source_type: string;
    search_query: string | null;
    check_interval_hours: number;
    is_active: boolean;
    last_checked_at: Date | null;
}

interface MonitorBrand {
    id: string;
    name: string;
    keywords: string[];
    exclude_keywords: string[];
    notify_enabled: boolean;
    engagement_threshold: number;
}

interface CrawledArticle {
    url: string;
    title: string | null;
    content: string | null;
    author_name: string | null;
    published_at: Date | null;
    likes_count: number | null;
    comments_count: number | null;
    shares_count: number | null;
    external_id: string | null;
}

class MonitorService {
    /**
     * 取得需要檢查的來源列表
     */
    async getSourcesDueForCheck(): Promise<MonitorSource[]> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT * FROM monitor_sources 
       WHERE is_active = true 
       AND (
         last_checked_at IS NULL 
         OR last_checked_at < DATE_SUB(NOW(), INTERVAL check_interval_hours HOUR)
       )
       ORDER BY last_checked_at ASC
       LIMIT 10`
        );

        return rows as MonitorSource[];
    }

    /**
     * 取得來源關聯的所有品牌及其關鍵字
     */
    async getBrandsForSource(sourceId: string): Promise<MonitorBrand[]> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT mb.*, mbs.custom_keywords
       FROM monitor_brands mb
       INNER JOIN monitor_brand_sources mbs ON mb.id = mbs.brand_id
       WHERE mbs.source_id = ? AND mb.is_active = true`,
            [sourceId]
        );

        const brands: MonitorBrand[] = [];

        for (const row of rows) {
            try {
                // 嘗試解析 keywords JSON
                let keywords: string[];
                const keywordsRaw = row.custom_keywords || row.keywords;

                if (typeof keywordsRaw === 'string') {
                    // 如果是字串，嘗試 JSON 解析
                    keywords = JSON.parse(keywordsRaw);
                } else if (Array.isArray(keywordsRaw)) {
                    // 如果已經是陣列
                    keywords = keywordsRaw;
                } else {
                    logger.warn(`[Monitor] Invalid keywords format for brand "${row.name}" (id: ${row.id}), skipping. Expected JSON array like ["關鍵字1", "關鍵字2"]`);
                    continue;
                }

                // 驗證是陣列
                if (!Array.isArray(keywords)) {
                    logger.warn(`[Monitor] Keywords for brand "${row.name}" is not an array, skipping. Value: ${JSON.stringify(keywords).substring(0, 100)}`);
                    continue;
                }

                brands.push({
                    id: row.id,
                    name: row.name,
                    keywords,
                    exclude_keywords: row.exclude_keywords ? JSON.parse(row.exclude_keywords) : [],
                    notify_enabled: row.notify_enabled,
                    engagement_threshold: row.engagement_threshold,
                });
            } catch (parseError: any) {
                // JSON 解析失敗，記錄錯誤但不中斷其他品牌
                logger.error(`[Monitor] Failed to parse keywords for brand "${row.name}" (id: ${row.id}): ${parseError.message}`);
                logger.error(`[Monitor] Keywords value: ${String(row.keywords).substring(0, 200)}`);
                logger.error(`[Monitor] 請到「關鍵字組」頁面修正此品牌的關鍵字格式，應使用逗號分隔的關鍵字，例如: 情趣用品, 成人玩具`);
            }
        }

        return brands;
    }

    /**
     * 檢查文章是否包含關鍵字
     */
    matchKeywords(
        article: CrawledArticle,
        brand: MonitorBrand
    ): { matched: boolean; keywords: string[]; location: string; count: number } {
        const text = `${article.title || ''} ${article.content || ''}`.toLowerCase();
        const matched: string[] = [];
        let totalCount = 0;
        let inTitle = false;
        let inContent = false;

        // 檢查排除關鍵字
        for (const excludeKw of brand.exclude_keywords) {
            if (text.includes(excludeKw.toLowerCase())) {
                return { matched: false, keywords: [], location: '', count: 0 };
            }
        }

        // 檢查匹配關鍵字
        for (const keyword of brand.keywords) {
            const kwLower = keyword.toLowerCase();
            if (text.includes(kwLower)) {
                matched.push(keyword);

                // 計算出現次數
                const regex = new RegExp(kwLower, 'gi');
                const matches = text.match(regex);
                totalCount += matches ? matches.length : 0;

                // 判斷位置
                if (article.title?.toLowerCase().includes(kwLower)) {
                    inTitle = true;
                }
                if (article.content?.toLowerCase().includes(kwLower)) {
                    inContent = true;
                }
            }
        }

        const location = inTitle && inContent ? 'both' : (inTitle ? 'title' : 'content');

        return {
            matched: matched.length > 0,
            keywords: matched,
            location,
            count: totalCount,
        };
    }

    /**
     * 計算內容 hash（用於防重複）
     */
    calculateContentHash(article: CrawledArticle): string {
        const content = `${article.url}|${article.title || ''}`;
        return createHash('sha256').update(content).digest('hex').substring(0, 64);
    }

    /**
     * 檢查是否已存在相同內容
     */
    async isDuplicate(contentHash: string, brandId: string): Promise<boolean> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM monitor_mentions 
       WHERE content_hash = ? AND brand_id = ? 
       LIMIT 1`,
            [contentHash, brandId]
        );

        return rows.length > 0;
    }

    /**
     * 儲存提及記錄
     */
    async saveMention(
        article: CrawledArticle,
        source: MonitorSource,
        brand: MonitorBrand,
        matchResult: { keywords: string[]; location: string; count: number },
        crawlLogId: string
    ): Promise<{ id: string; classification: ClassificationResult }> {
        const pool = getPool();
        const id = generateUUID();
        const contentHash = this.calculateContentHash(article);
        const contentPreview = article.content?.substring(0, 500) || null;

        // 計算互動分數
        const engagementScore = (article.likes_count || 0) +
            (article.comments_count || 0) * 2 +
            (article.shares_count || 0) * 3;
        const isHighEngagement = engagementScore >= brand.engagement_threshold;

        // 執行分類
        const textToClassify = `${article.title || ''} ${article.content || ''}`;
        const classification = classifierService.classify(textToClassify);

        await pool.execute(
            `INSERT INTO monitor_mentions (
        id, source_id, brand_id, crawl_log_id,
        external_id, url, title, content, content_preview,
        content_length, content_hash,
        author_name, matched_keywords, keyword_count, match_location,
        likes_count, comments_count, engagement_score, is_high_engagement,
        published_at, discovered_at,
        primary_topic, topics, classification_hits, classification_version, has_strong_hit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
            [
                id, source.id, brand.id, crawlLogId,
                article.external_id, article.url, article.title, article.content, contentPreview,
                article.content?.length || 0, contentHash,
                article.author_name, JSON.stringify(matchResult.keywords), matchResult.count, matchResult.location,
                article.likes_count, article.comments_count, engagementScore, isHighEngagement,
                article.published_at,
                classification.primary_topic,
                JSON.stringify(classification.topics),
                JSON.stringify(classification.hits),
                classification.version,
                classification.hits.length > 0, // All hits are now direct hits
            ]
        );

        // Async AI sentiment analysis (non-blocking)
        aiClassifierService.analyze(article.title || '', article.content || '')
            .then(async (aiResult) => {
                if (aiResult) {
                    try {
                        await pool.execute(
                            `UPDATE monitor_mentions
                             SET sentiment = ?, sentiment_score = ?, sentiment_confidence = ?,
                                 sentiment_keywords = ?, sentiment_analyzed_at = NOW()
                             WHERE id = ?`,
                            [
                                aiResult.sentiment,
                                aiResult.sentiment_score,
                                aiResult.sentiment_confidence,
                                JSON.stringify(aiResult.sentiment_keywords),
                                id,
                            ]
                        );
                        logger.debug(`[AIClassifier] Updated mention ${id}: ${aiResult.sentiment} (${aiResult.sentiment_score})`);
                    } catch (dbError) {
                        logger.warn(`[AIClassifier] Failed to update mention ${id}:`, dbError);
                    }
                }
            })
            .catch((err) => {
                logger.warn(`[AIClassifier] Async analysis failed for mention ${id}:`, err);
            });

        return { id, classification };
    }

    /**
     * 建立爬取日誌
     */
    async createCrawlLog(sourceId: string): Promise<string> {
        const pool = getPool();
        const id = generateUUID();

        await pool.execute(
            `INSERT INTO monitor_crawl_logs (id, source_id, started_at, status)
       VALUES (?, ?, NOW(), 'running')`,
            [id, sourceId]
        );

        return id;
    }

    /**
     * 更新爬取日誌
     */
    async updateCrawlLog(
        logId: string,
        result: {
            status: string;
            pagesCount?: number;
            articlesFound?: number;
            articlesProcessed?: number;
            newMentions?: number;
            duplicateSkipped?: number;
            errorMessage?: string;
        }
    ): Promise<void> {
        const pool = getPool();

        await pool.execute(
            `UPDATE monitor_crawl_logs SET
        completed_at = NOW(),
        duration_ms = TIMESTAMPDIFF(SECOND, started_at, NOW()) * 1000,
        status = ?,
        pages_crawled = ?,
        articles_found = ?,
        articles_processed = ?,
        new_mentions = ?,
        duplicate_skipped = ?,
        error_message = ?
       WHERE id = ?`,
            [
                result.status,
                result.pagesCount || 0,
                result.articlesFound || 0,
                result.articlesProcessed || 0,
                result.newMentions || 0,
                result.duplicateSkipped || 0,
                result.errorMessage || null,
                logId,
            ]
        );
    }

    /**
     * 更新來源狀態
     */
    async updateSourceStatus(
        sourceId: string,
        success: boolean,
        error?: string
    ): Promise<void> {
        const pool = getPool();

        if (success) {
            await pool.execute(
                `UPDATE monitor_sources SET
          last_checked_at = NOW(),
          last_success_at = NOW(),
          health_status = 'healthy',
          consecutive_failures = 0,
          last_error = NULL,
          total_crawl_count = total_crawl_count + 1
         WHERE id = ?`,
                [sourceId]
            );
        } else {
            await pool.execute(
                `UPDATE monitor_sources SET
          last_checked_at = NOW(),
          health_status = CASE 
            WHEN consecutive_failures >= 2 THEN 'error'
            ELSE 'warning'
          END,
          consecutive_failures = consecutive_failures + 1,
          last_error = ?
         WHERE id = ?`,
                [error || null, sourceId]
            );
        }
    }

    /**
     * 取得未通知的提及記錄
     */
    async getUnnotifiedMentions(limit: number = 10): Promise<any[]> {
        const pool = getPool();

        // MySQL2 prepared statements don't support LIMIT with placeholders
        const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 10)));

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT
        mm.*,
        mb.name as brand_name,
        ms.name as source_name,
        ms.platform
       FROM monitor_mentions mm
       INNER JOIN monitor_brands mb ON mm.brand_id = mb.id
       INNER JOIN monitor_sources ms ON mm.source_id = ms.id
       WHERE mm.is_notified = false AND mb.notify_enabled = true
       ORDER BY mm.discovered_at DESC
       LIMIT ${safeLimit}`,
            []
        );

        return rows as any[];
    }

    /**
     * 標記提及已通知
     */
    async markAsNotified(mentionIds: string[], notificationId: string): Promise<void> {
        if (mentionIds.length === 0) return;

        const pool = getPool();
        const placeholders = mentionIds.map(() => '?').join(',');

        await pool.execute(
            `UPDATE monitor_mentions
       SET is_notified = true, notified_at = NOW(), notification_id = ?
       WHERE id IN (${placeholders})`,
            [notificationId, ...mentionIds]
        );
    }

    /**
     * 發送 pain_point 強命中警示通知
     */
    async sendPainPointAlert(
        mentionId: string,
        article: CrawledArticle,
        brand: MonitorBrand,
        classification: ClassificationResult
    ): Promise<void> {
        try {
            const lineService = (await import('./line.service')).default;
            const pool = getPool();

            // 取得管理員的 LINE User ID
            const [admins] = await pool.execute<RowDataPacket[]>(
                `SELECT line_user_id FROM users WHERE line_user_id IS NOT NULL LIMIT 1`
            );

            if (admins.length === 0) {
                logger.warn('[Monitor] No LINE user found for pain point alert');
                return;
            }

            const lineUserId = admins[0].line_user_id;

            // 取得命中的痛點詳情
            const painPointHits = classification.hits
                .filter(h => h.topic === 'pain_point')
                .map(h => h.rule_name)
                .filter((v, i, a) => a.indexOf(v) === i); // 去重

            const topicInfo = classifierService.getTopicInfo('pain_point');

            const message = `🚨 產品痛點警報\n\n` +
                `📍 關鍵字組：${brand.name}\n` +
                `🔴 痛點類型：${painPointHits.join('、')}\n\n` +
                `📝 ${article.title?.substring(0, 50) || '(無標題)'}${article.title && article.title.length > 50 ? '...' : ''}\n\n` +
                `💬 ${article.content?.substring(0, 100) || ''}${article.content && article.content.length > 100 ? '...' : ''}\n\n` +
                `🔗 ${article.url}`;

            await lineService.sendNotification(lineUserId, message);

            // 標記已通知
            const { generateUUID: genId } = await import('../utils/uuid');
            const notificationId = genId();

            await pool.execute(
                `UPDATE monitor_mentions
                 SET is_notified = true, notified_at = NOW(), notification_id = ?
                 WHERE id = ?`,
                [notificationId, mentionId]
            );

            logger.info(`[Monitor] Sent pain point alert for mention ${mentionId}: ${painPointHits.join(', ')}`);

        } catch (error) {
            logger.error('[Monitor] Failed to send pain point alert:', error);
        }
    }
}

export default new MonitorService();
