/**
 * 聲量監控服務
 * 負責爬取網頁、匹配關鍵字、儲存提及記錄
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { createHash } from 'crypto';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';

// Cheerio for HTML parsing
import * as cheerio from 'cheerio';

interface MonitorSource {
    id: string;
    name: string;
    url: string;
    platform: string;
    source_type: string;
    search_query: string | null;
    check_interval_hours: number;
    crawl_depth: number;
    max_pages: number;
    max_items_per_check: number;
    use_puppeteer: boolean;
    request_delay_ms: number;
    timeout_seconds: number;
    selectors: any;
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

        return rows.map((row: any) => ({
            ...row,
            keywords: row.custom_keywords ? JSON.parse(row.custom_keywords) : JSON.parse(row.keywords),
            exclude_keywords: row.exclude_keywords ? JSON.parse(row.exclude_keywords) : [],
        }));
    }

    /**
     * 爬取網頁內容
     */
    async fetchPageContent(url: string, usePuppeteer: boolean = false): Promise<string> {
        if (usePuppeteer) {
            // TODO: Puppeteer implementation for JavaScript-rendered pages
            throw new Error('Puppeteer not implemented yet');
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }

        return await response.text();
    }

    /**
     * 解析 Dcard 頁面
     */
    parseDcardPage(html: string, baseUrl: string): CrawledArticle[] {
        const $ = cheerio.load(html);
        const articles: CrawledArticle[] = [];

        // Dcard 的文章列表選取器（需要根據實際結構調整）
        $('article, [data-key], .PostEntry_container__').each((_, element) => {
            const $el = $(element);
            const linkEl = $el.find('a[href*="/f/"]').first();
            const href = linkEl.attr('href');

            if (!href) return;

            const url = href.startsWith('http') ? href : `https://www.dcard.tw${href}`;
            const title = $el.find('h2, h3, [class*="title"]').first().text().trim();
            const content = $el.find('p, [class*="excerpt"], [class*="content"]').first().text().trim();

            if (title || content) {
                articles.push({
                    url,
                    title: title || null,
                    content: content || null,
                    author_name: $el.find('[class*="author"], [class*="name"]').first().text().trim() || null,
                    published_at: null,
                    likes_count: parseInt($el.find('[class*="like"]').text()) || null,
                    comments_count: parseInt($el.find('[class*="comment"]').text()) || null,
                    shares_count: null,
                    external_id: href.split('/').pop() || null,
                });
            }
        });

        return articles;
    }

    /**
     * 解析 PTT 頁面
     */
    parsePttPage(html: string, baseUrl: string): CrawledArticle[] {
        const $ = cheerio.load(html);
        const articles: CrawledArticle[] = [];

        $('.r-ent').each((_, element) => {
            const $el = $(element);
            const linkEl = $el.find('.title a');
            const href = linkEl.attr('href');

            if (!href) return;

            const url = `https://www.ptt.cc${href}`;
            const title = linkEl.text().trim();
            const author = $el.find('.author').text().trim();
            const pushCount = $el.find('.nrec').text().trim();

            articles.push({
                url,
                title,
                content: null,
                author_name: author || null,
                published_at: null,
                likes_count: pushCount === '爆' ? 100 : (parseInt(pushCount) || 0),
                comments_count: null,
                shares_count: null,
                external_id: href.split('/').pop()?.replace('.html', '') || null,
            });
        });

        return articles;
    }

    /**
     * 通用頁面解析器
     */
    parseGenericPage(html: string, selectors: any): CrawledArticle[] {
        const $ = cheerio.load(html);
        const articles: CrawledArticle[] = [];

        if (!selectors || !selectors.list) {
            // 嘗試自動偵測文章列表
            $('article, .post, .entry, .item').each((_, element) => {
                const $el = $(element);
                const linkEl = $el.find('a').first();
                const href = linkEl.attr('href');

                if (!href) return;

                articles.push({
                    url: href,
                    title: $el.find('h1, h2, h3, .title').first().text().trim() || null,
                    content: $el.find('p, .content, .excerpt').first().text().trim() || null,
                    author_name: null,
                    published_at: null,
                    likes_count: null,
                    comments_count: null,
                    shares_count: null,
                    external_id: null,
                });
            });
        } else {
            // 使用自訂選取器
            $(selectors.list).each((_, element) => {
                const $el = $(element);
                articles.push({
                    url: $el.find(selectors.link || 'a').attr('href') || '',
                    title: selectors.title ? $el.find(selectors.title).text().trim() : null,
                    content: selectors.content ? $el.find(selectors.content).text().trim() : null,
                    author_name: selectors.author ? $el.find(selectors.author).text().trim() : null,
                    published_at: null,
                    likes_count: selectors.likes ? parseInt($el.find(selectors.likes).text()) : null,
                    comments_count: selectors.comments ? parseInt($el.find(selectors.comments).text()) : null,
                    shares_count: null,
                    external_id: null,
                });
            });
        }

        return articles;
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
    ): Promise<string> {
        const pool = getPool();
        const id = generateUUID();
        const contentHash = this.calculateContentHash(article);
        const contentPreview = article.content?.substring(0, 500) || null;

        // 計算互動分數
        const engagementScore = (article.likes_count || 0) +
            (article.comments_count || 0) * 2 +
            (article.shares_count || 0) * 3;
        const isHighEngagement = engagementScore >= brand.engagement_threshold;

        await pool.execute(
            `INSERT INTO monitor_mentions (
        id, source_id, brand_id, crawl_log_id,
        external_id, url, title, content, content_preview, 
        content_length, content_hash,
        author_name, matched_keywords, keyword_count, match_location,
        likes_count, comments_count, engagement_score, is_high_engagement,
        published_at, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                id, source.id, brand.id, crawlLogId,
                article.external_id, article.url, article.title, article.content, contentPreview,
                article.content?.length || 0, contentHash,
                article.author_name, JSON.stringify(matchResult.keywords), matchResult.count, matchResult.location,
                article.likes_count, article.comments_count, engagementScore, isHighEngagement,
                article.published_at,
            ]
        );

        return id;
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
                [error, sourceId]
            );
        }
    }

    /**
     * 執行單一來源的爬取任務
     */
    async crawlSource(source: MonitorSource): Promise<{
        success: boolean;
        newMentions: number;
        error?: string;
    }> {
        const crawlLogId = await this.createCrawlLog(source.id);

        try {
            logger.info(`Starting crawl for source: ${source.name} (${source.url})`);

            // 取得關聯的品牌
            const brands = await this.getBrandsForSource(source.id);
            if (brands.length === 0) {
                logger.warn(`No brands associated with source: ${source.name}`);
                await this.updateCrawlLog(crawlLogId, { status: 'skipped' });
                return { success: true, newMentions: 0 };
            }

            // 抓取頁面
            const html = await this.fetchPageContent(source.url, source.use_puppeteer);

            // 解析文章
            let articles: CrawledArticle[];
            switch (source.platform) {
                case 'dcard':
                    articles = this.parseDcardPage(html, source.url);
                    break;
                case 'ptt':
                    articles = this.parsePttPage(html, source.url);
                    break;
                default:
                    articles = this.parseGenericPage(html, source.selectors);
            }

            logger.info(`Found ${articles.length} articles from ${source.name}`);

            let newMentions = 0;
            let duplicateSkipped = 0;

            // 處理每篇文章
            for (const article of articles.slice(0, source.max_items_per_check)) {
                // 對每個品牌檢查關鍵字
                for (const brand of brands) {
                    const matchResult = this.matchKeywords(article, brand);

                    if (matchResult.matched) {
                        const contentHash = this.calculateContentHash(article);
                        const isDup = await this.isDuplicate(contentHash, brand.id);

                        if (isDup) {
                            duplicateSkipped++;
                            continue;
                        }

                        // 儲存提及記錄
                        await this.saveMention(article, source, brand, matchResult, crawlLogId);
                        newMentions++;

                        logger.info(`New mention found: "${article.title?.substring(0, 50)}..." matched keywords: ${matchResult.keywords.join(', ')}`);
                    }
                }

                // 延遲避免請求過快
                if (source.request_delay_ms > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // 更新日誌和狀態
            await this.updateCrawlLog(crawlLogId, {
                status: 'success',
                pagesCount: 1,
                articlesFound: articles.length,
                articlesProcessed: Math.min(articles.length, source.max_items_per_check),
                newMentions,
                duplicateSkipped,
            });

            await this.updateSourceStatus(source.id, true);

            logger.info(`Crawl completed for ${source.name}: ${newMentions} new mentions`);

            return { success: true, newMentions };

        } catch (error: any) {
            logger.error(`Crawl failed for ${source.name}:`, error);

            await this.updateCrawlLog(crawlLogId, {
                status: 'failed',
                errorMessage: error.message,
            });

            await this.updateSourceStatus(source.id, false, error.message);

            return { success: false, newMentions: 0, error: error.message };
        }
    }

    /**
     * 執行所有到期的監控任務
     */
    async runScheduledCrawls(): Promise<void> {
        const sources = await this.getSourcesDueForCheck();

        if (sources.length === 0) {
            logger.debug('No sources due for check');
            return;
        }

        logger.info(`Running scheduled crawls for ${sources.length} sources`);

        for (const source of sources) {
            await this.crawlSource(source);
            // 每個來源之間稍作延遲
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    /**
     * 取得未通知的提及記錄
     */
    async getUnnotifiedMentions(limit: number = 10): Promise<any[]> {
        const pool = getPool();

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
       LIMIT ?`,
            [limit]
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
}

export default new MonitorService();
