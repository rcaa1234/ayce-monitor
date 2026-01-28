/**
 * Scraper API 控制器
 * 提供本機爬蟲所需的設定與結果接收端點
 */

import { Request, Response } from 'express';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { createHash } from 'crypto';
import { generateUUID } from '../utils/uuid';
import logger from '../utils/logger';
import classifierService from '../services/classifier.service';

class ScraperApiController {
    /**
     * 健康檢查
     */
    async health(_req: Request, res: Response) {
        res.json({ success: true, message: 'Scraper API is running', timestamp: new Date().toISOString() });
    }

    /**
     * 取得爬取設定（看板、關鍵字、網黃偵測設定）
     */
    async getConfig(_req: Request, res: Response) {
        try {
            const pool = getPool();

            // 取得 Dcard 來源
            const [sources] = await pool.execute<RowDataPacket[]>(
                `SELECT id, name, url, platform, max_items_per_check
                 FROM monitor_sources
                 WHERE platform = 'dcard' AND is_active = 1`
            );

            // 從 URL 提取 forum_alias
            const sourcesWithAlias = sources.map((s: any) => {
                const match = s.url?.match(/\/f\/([a-zA-Z0-9_-]+)/);
                return {
                    id: s.id,
                    name: s.name,
                    platform: s.platform,
                    forum_alias: match ? match[1] : '',
                    max_items_per_check: s.max_items_per_check || 30,
                };
            });

            // 取得品牌（含關鍵字）
            const [brands] = await pool.execute<RowDataPacket[]>(
                `SELECT b.id, b.name, b.keywords, b.exclude_keywords, b.notify_enabled, b.engagement_threshold
                 FROM monitor_brands b
                 WHERE b.is_active = 1`
            );

            // 取得品牌-來源關聯
            const [brandSources] = await pool.execute<RowDataPacket[]>(
                `SELECT brand_id, source_id FROM monitor_brand_sources`
            );

            const brandsData = brands.map((b: any) => {
                let keywords: string[] = [];
                let excludeKeywords: string[] = [];

                try {
                    keywords = typeof b.keywords === 'string' ? JSON.parse(b.keywords) : (b.keywords || []);
                } catch { keywords = []; }

                try {
                    excludeKeywords = typeof b.exclude_keywords === 'string' ? JSON.parse(b.exclude_keywords) : (b.exclude_keywords || []);
                } catch { excludeKeywords = []; }

                const sourceIds = brandSources
                    .filter((bs: any) => bs.brand_id === b.id)
                    .map((bs: any) => bs.source_id);

                return {
                    id: b.id,
                    name: b.name,
                    keywords,
                    exclude_keywords: excludeKeywords,
                    source_ids: sourceIds,
                    notify_enabled: !!b.notify_enabled,
                    engagement_threshold: b.engagement_threshold || 50,
                };
            });

            // 取得網黃偵測設定
            const [influencerConfig] = await pool.execute<RowDataPacket[]>(
                `SELECT enabled, target_forums, max_posts_per_check, check_interval_minutes
                 FROM influencer_detection_config
                 LIMIT 1`
            );

            let influencer = {
                enabled: false,
                target_forums: ['sex'],
                max_posts_per_check: 20,
            };

            if (influencerConfig.length > 0) {
                const cfg = influencerConfig[0];
                influencer = {
                    enabled: !!cfg.enabled,
                    target_forums: typeof cfg.target_forums === 'string' ? JSON.parse(cfg.target_forums) : (cfg.target_forums || ['sex']),
                    max_posts_per_check: cfg.max_posts_per_check || 20,
                };
            }

            res.json({
                success: true,
                data: {
                    monitor: {
                        sources: sourcesWithAlias,
                        brands: brandsData,
                    },
                    influencer,
                },
            });
        } catch (error) {
            logger.error('[ScraperAPI] 取得設定失敗:', error);
            res.status(500).json({ success: false, error: '取得設定失敗' });
        }
    }

    /**
     * 接收關鍵字命中的文章
     */
    async receiveMentions(req: Request, res: Response) {
        try {
            const { mentions } = req.body;

            if (!Array.isArray(mentions) || mentions.length === 0) {
                res.status(400).json({ success: false, error: 'mentions 必須是非空陣列' });
                return;
            }

            const pool = getPool();
            let saved = 0;
            let duplicates = 0;

            for (const mention of mentions) {
                try {
                    const { source_id, brand_id, url, title, content, author_name, published_at,
                        likes_count, comments_count, external_id, matched_keywords, keyword_count, match_location } = mention;

                    // 計算 content_hash
                    const hashContent = `${url}|${title || ''}`;
                    const contentHash = createHash('sha256').update(hashContent).digest('hex').substring(0, 64);

                    // 檢查重複
                    const [existing] = await pool.execute<RowDataPacket[]>(
                        `SELECT id FROM monitor_mentions WHERE content_hash = ? AND brand_id = ? LIMIT 1`,
                        [contentHash, brand_id]
                    );

                    if (existing.length > 0) {
                        duplicates++;
                        continue;
                    }

                    // 建立 crawl log
                    const crawlLogId = generateUUID();
                    await pool.execute(
                        `INSERT INTO monitor_crawl_logs (id, source_id, started_at, completed_at, status, articles_found, new_mentions)
                         VALUES (?, ?, NOW(), NOW(), 'completed', 1, 1)`,
                        [crawlLogId, source_id]
                    );

                    // 執行分類
                    const textToClassify = `${title || ''} ${content || ''}`;
                    const classification = classifierService.classify(textToClassify);

                    // 計算互動分數
                    const engagementScore = (likes_count || 0) + (comments_count || 0) * 2;

                    const id = generateUUID();
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
                            id, source_id, brand_id, crawlLogId,
                            external_id, url, title, content, content?.substring(0, 500) || null,
                            content?.length || 0, contentHash,
                            author_name, JSON.stringify(matched_keywords || []), keyword_count || 0, match_location || 'content',
                            likes_count || 0, comments_count || 0, engagementScore, engagementScore >= 50,
                            published_at ? new Date(published_at) : null,
                            classification.primary_topic,
                            JSON.stringify(classification.topics),
                            JSON.stringify(classification.hits),
                            classification.version,
                            classification.hits.length > 0,
                        ]
                    );

                    saved++;
                } catch (err) {
                    logger.error('[ScraperAPI] 儲存 mention 失敗:', err);
                }
            }

            // 更新來源的 last_checked_at
            const sourceIds = [...new Set(mentions.map((m: any) => m.source_id))];
            for (const sourceId of sourceIds) {
                await pool.execute(
                    `UPDATE monitor_sources SET last_checked_at = NOW() WHERE id = ?`,
                    [sourceId]
                ).catch(() => {});
            }

            logger.info(`[ScraperAPI] 接收 mentions: ${saved} 新增, ${duplicates} 重複`);
            res.json({ success: true, data: { saved, duplicates, total: mentions.length } });
        } catch (error) {
            logger.error('[ScraperAPI] 接收 mentions 失敗:', error);
            res.status(500).json({ success: false, error: '接收 mentions 失敗' });
        }
    }

    /**
     * 接收偵測到的網黃作者
     */
    async receiveAuthors(req: Request, res: Response) {
        try {
            const { authors } = req.body;

            if (!Array.isArray(authors) || authors.length === 0) {
                res.status(400).json({ success: false, error: 'authors 必須是非空陣列' });
                return;
            }

            const pool = getPool();
            let newAuthors = 0;
            let updated = 0;
            let sourcePosts = 0;

            for (const author of authors) {
                try {
                    const { dcard_id, dcard_username, dcard_bio, dcard_url, twitter_id, twitter_url, source_forum, source_posts } = author;

                    if (!dcard_id) continue;

                    // 檢查作者是否已存在
                    const [existing] = await pool.execute<RowDataPacket[]>(
                        `SELECT id FROM influencer_authors WHERE dcard_id = ? LIMIT 1`,
                        [dcard_id]
                    );

                    let authorId: string;

                    if (existing.length > 0) {
                        authorId = existing[0].id;
                        // 更新現有作者
                        await pool.execute(
                            `UPDATE influencer_authors SET
                                dcard_username = COALESCE(?, dcard_username),
                                dcard_bio = COALESCE(?, dcard_bio),
                                dcard_url = COALESCE(?, dcard_url),
                                twitter_id = COALESCE(?, twitter_id),
                                twitter_url = COALESCE(?, twitter_url),
                                last_seen_at = NOW(),
                                updated_at = NOW()
                            WHERE id = ?`,
                            [dcard_username, dcard_bio, dcard_url, twitter_id, twitter_url, authorId]
                        );
                        updated++;
                    } else {
                        // 新增作者
                        authorId = generateUUID();
                        await pool.execute(
                            `INSERT INTO influencer_authors (
                                id, dcard_id, dcard_username, dcard_bio, dcard_url,
                                twitter_id, twitter_url,
                                source_forum, status, first_detected_at, last_seen_at,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', NOW(), NOW(), NOW(), NOW())`,
                            [authorId, dcard_id, dcard_username, dcard_bio, dcard_url, twitter_id, twitter_url, source_forum]
                        );
                        newAuthors++;
                    }

                    // 儲存來源貼文
                    if (Array.isArray(source_posts)) {
                        for (const post of source_posts) {
                            try {
                                // 檢查貼文是否已存在
                                const [existingPost] = await pool.execute<RowDataPacket[]>(
                                    `SELECT id FROM influencer_source_posts WHERE post_id = ? AND author_id = ? LIMIT 1`,
                                    [post.post_id, authorId]
                                );

                                if (existingPost.length === 0) {
                                    await pool.execute(
                                        `INSERT INTO influencer_source_posts (
                                            id, author_id, post_id, post_url, post_title,
                                            likes_count, comments_count, detected_at
                                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                                        [generateUUID(), authorId, post.post_id, post.post_url, post.post_title,
                                         post.likes_count || 0, post.comments_count || 0]
                                    );
                                    sourcePosts++;
                                }
                            } catch (err) {
                                logger.error(`[ScraperAPI] 儲存來源貼文失敗:`, err);
                            }
                        }
                    }
                } catch (err) {
                    logger.error('[ScraperAPI] 儲存作者失敗:', err);
                }
            }

            logger.info(`[ScraperAPI] 接收 authors: ${newAuthors} 新增, ${updated} 更新, ${sourcePosts} 來源貼文`);
            res.json({ success: true, data: { newAuthors, updated, sourcePosts, total: authors.length } });
        } catch (error) {
            logger.error('[ScraperAPI] 接收 authors 失敗:', error);
            res.status(500).json({ success: false, error: '接收 authors 失敗' });
        }
    }

    /**
     * 本機爬蟲心跳回報
     */
    async heartbeat(req: Request, res: Response) {
        const { version, last_scan_at, next_scan_at, status } = req.body;
        logger.info(`[ScraperAPI] 心跳: version=${version}, status=${status}, last_scan=${last_scan_at}, next_scan=${next_scan_at}`);
        res.json({ success: true, message: 'heartbeat received' });
    }
}

export default new ScraperApiController();
