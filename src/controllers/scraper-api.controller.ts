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

            for (const author of authors) {
                try {
                    const { dcard_id, dcard_username, dcard_bio, dcard_url, twitter_id, twitter_display_name, twitter_url, last_dcard_post_at, last_twitter_post_at, source_forum } = author;

                    if (!dcard_id) continue;

                    // 檢查作者是否已存在
                    const [existing] = await pool.execute<RowDataPacket[]>(
                        `SELECT id FROM influencer_authors WHERE dcard_id = ? LIMIT 1`,
                        [dcard_id]
                    );

                    if (existing.length > 0) {
                        // 更新現有作者
                        await pool.execute(
                            `UPDATE influencer_authors SET
                                dcard_username = COALESCE(?, dcard_username),
                                dcard_bio = COALESCE(?, dcard_bio),
                                dcard_url = COALESCE(?, dcard_url),
                                twitter_id = COALESCE(?, twitter_id),
                                twitter_display_name = COALESCE(?, twitter_display_name),
                                twitter_url = COALESCE(?, twitter_url),
                                last_dcard_post_at = COALESCE(?, last_dcard_post_at),
                                last_twitter_post_at = COALESCE(?, last_twitter_post_at),
                                last_seen_at = NOW(),
                                detection_count = detection_count + 1,
                                updated_at = NOW()
                            WHERE id = ?`,
                            [
                                dcard_username, dcard_bio, dcard_url,
                                twitter_id, twitter_display_name, twitter_url,
                                last_dcard_post_at ? new Date(last_dcard_post_at) : null,
                                last_twitter_post_at ? new Date(last_twitter_post_at) : null,
                                existing[0].id
                            ]
                        );
                        updated++;
                    } else {
                        // 新增作者
                        await pool.execute(
                            `INSERT INTO influencer_authors (
                                id, dcard_id, dcard_username, dcard_bio, dcard_url,
                                twitter_id, twitter_display_name, twitter_url,
                                last_dcard_post_at, last_twitter_post_at,
                                source_forum, status, first_detected_at, last_seen_at,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', NOW(), NOW(), NOW(), NOW())`,
                            [
                                generateUUID(), dcard_id, dcard_username, dcard_bio, dcard_url,
                                twitter_id, twitter_display_name, twitter_url,
                                last_dcard_post_at ? new Date(last_dcard_post_at) : null,
                                last_twitter_post_at ? new Date(last_twitter_post_at) : null,
                                source_forum
                            ]
                        );
                        newAuthors++;
                    }
                } catch (err) {
                    logger.error('[ScraperAPI] 儲存作者失敗:', err);
                }
            }

            logger.info(`[ScraperAPI] 接收 authors: ${newAuthors} 新增, ${updated} 更新`);
            res.json({ success: true, data: { newAuthors, updated, total: authors.length } });
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

        try {
            const pool = getPool();

            // 確保資料表存在
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS scraper_heartbeat (
                    id INT PRIMARY KEY,
                    version VARCHAR(50),
                    last_scan_at DATETIME,
                    next_scan_at DATETIME,
                    status VARCHAR(50),
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            // 更新或插入心跳資訊
            await pool.execute(`
                INSERT INTO scraper_heartbeat (id, version, last_scan_at, next_scan_at, status, updated_at)
                VALUES (1, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    version = VALUES(version),
                    last_scan_at = VALUES(last_scan_at),
                    next_scan_at = VALUES(next_scan_at),
                    status = VALUES(status),
                    updated_at = NOW()
            `, [
                version || null,
                last_scan_at ? new Date(last_scan_at) : null,
                next_scan_at ? new Date(next_scan_at) : null,
                status || 'unknown'
            ]);
        } catch (err) {
            logger.error('[ScraperAPI] 儲存心跳失敗:', err);
        }

        res.json({ success: true, message: 'heartbeat received' });
    }

    /**
     * 取得待執行任務
     * 本機爬蟲定期呼叫此端點，取得需要執行的爬取任務
     */
    async getTasks(_req: Request, res: Response) {
        try {
            const pool = getPool();
            const tasks: any[] = [];

            // 取得爬蟲設定（若資料表不存在則使用預設值）
            let scraperConfig = { poll_interval_seconds: 60, max_concurrent_tasks: 3 };
            try {
                const [configRows] = await pool.execute<RowDataPacket[]>(
                    `SELECT poll_interval_seconds, max_concurrent_tasks FROM scraper_config WHERE id = 1`
                );
                if (configRows[0]) {
                    scraperConfig = configRows[0] as any;
                }
            } catch {
                // 資料表不存在，使用預設值
                logger.warn('[ScraperAPI] scraper_config 資料表不存在，使用預設值');
            }

            // 1. 檢查需要爬取的 monitor sources
            const [dueSources] = await pool.execute<RowDataPacket[]>(
                `SELECT ms.id, ms.name, ms.url, ms.platform, ms.max_items_per_check, ms.check_interval_hours
                 FROM monitor_sources ms
                 WHERE ms.is_active = 1
                   AND ms.platform = 'dcard'
                   AND (
                       ms.last_checked_at IS NULL
                       OR ms.last_checked_at < DATE_SUB(NOW(), INTERVAL ms.check_interval_hours HOUR)
                   )
                 ORDER BY ms.last_checked_at ASC
                 LIMIT ?`,
                [scraperConfig.max_concurrent_tasks]
            );

            // 取得品牌資料
            const [brands] = await pool.execute<RowDataPacket[]>(
                `SELECT b.id, b.name, b.keywords, b.exclude_keywords, b.notify_enabled, b.engagement_threshold
                 FROM monitor_brands b
                 WHERE b.is_active = 1`
            );

            const [brandSources] = await pool.execute<RowDataPacket[]>(
                `SELECT brand_id, source_id FROM monitor_brand_sources`
            );

            // 為每個到期來源建立任務
            for (const source of dueSources) {
                const match = source.url?.match(/\/f\/([a-zA-Z0-9_-]+)/);
                const forumAlias = match ? match[1] : '';

                // 取得該來源關聯的品牌
                const sourceBrandIds = brandSources
                    .filter((bs: any) => bs.source_id === source.id)
                    .map((bs: any) => bs.brand_id);

                const sourceBrands = brands
                    .filter((b: any) => sourceBrandIds.includes(b.id))
                    .map((b: any) => {
                        let keywords: string[] = [];
                        let excludeKeywords: string[] = [];
                        try {
                            keywords = typeof b.keywords === 'string' ? JSON.parse(b.keywords) : (b.keywords || []);
                        } catch { keywords = []; }
                        try {
                            excludeKeywords = typeof b.exclude_keywords === 'string' ? JSON.parse(b.exclude_keywords) : (b.exclude_keywords || []);
                        } catch { excludeKeywords = []; }

                        return {
                            id: b.id,
                            name: b.name,
                            keywords,
                            exclude_keywords: excludeKeywords,
                        };
                    });

                tasks.push({
                    task_id: generateUUID(),
                    task_type: 'monitor',
                    source: {
                        id: source.id,
                        name: source.name,
                        forum_alias: forumAlias,
                        max_items_per_check: source.max_items_per_check || 30,
                    },
                    brands: sourceBrands,
                });
            }

            // 2. 檢查網黃偵測是否到期
            const [influencerConfig] = await pool.execute<RowDataPacket[]>(
                `SELECT enabled, target_forums, max_posts_per_check, check_interval_minutes, last_check_at
                 FROM influencer_detection_config
                 WHERE enabled = 1
                   AND (
                       last_check_at IS NULL
                       OR last_check_at < DATE_SUB(NOW(), INTERVAL check_interval_minutes MINUTE)
                   )
                 LIMIT 1`
            );

            if (influencerConfig.length > 0 && tasks.length < scraperConfig.max_concurrent_tasks) {
                const cfg = influencerConfig[0];
                tasks.push({
                    task_id: generateUUID(),
                    task_type: 'influencer',
                    influencer_config: {
                        target_forums: typeof cfg.target_forums === 'string' ? JSON.parse(cfg.target_forums) : (cfg.target_forums || ['sex']),
                        max_posts_per_check: cfg.max_posts_per_check || 20,
                    },
                });
            }

            logger.info(`[ScraperAPI] getTasks: 回傳 ${tasks.length} 個任務`);

            res.json({
                success: true,
                data: {
                    tasks,
                    poll_interval_seconds: scraperConfig.poll_interval_seconds,
                    server_time: new Date().toISOString(),
                },
            });
        } catch (error: any) {
            logger.error('[ScraperAPI] 取得任務失敗:', error);
            res.status(500).json({ success: false, error: `取得任務失敗: ${error.message || error}` });
        }
    }

    /**
     * 回報任務完成
     * 本機爬蟲完成任務後呼叫此端點更新狀態
     */
    async completeTask(req: Request, res: Response) {
        try {
            const { task_id, task_type, source_id, status, articles_found, new_mentions, new_authors, duration_ms, error_message } = req.body;

            if (!task_type || !status) {
                res.status(400).json({ success: false, error: 'task_type 和 status 為必填' });
                return;
            }

            const pool = getPool();
            const completedAt = new Date();

            if (task_type === 'monitor' && source_id) {
                // 更新來源的 last_checked_at
                await pool.execute(
                    `UPDATE monitor_sources
                     SET last_checked_at = ?,
                         health_status = ?,
                         consecutive_failures = CASE WHEN ? = 'success' THEN 0 ELSE consecutive_failures + 1 END
                     WHERE id = ?`,
                    [completedAt, status === 'success' ? 'healthy' : 'warning', status, source_id]
                );

                // 取得下次檢查時間
                const [source] = await pool.execute<RowDataPacket[]>(
                    `SELECT check_interval_hours, last_checked_at FROM monitor_sources WHERE id = ?`,
                    [source_id]
                );

                let nextCheckAt = null;
                if (source.length > 0) {
                    const intervalMs = (source[0].check_interval_hours || 1) * 60 * 60 * 1000;
                    nextCheckAt = new Date(completedAt.getTime() + intervalMs);
                }

                logger.info(`[ScraperAPI] 任務完成: type=monitor, source=${source_id}, status=${status}, articles=${articles_found}, mentions=${new_mentions}, duration=${duration_ms}ms`);

                res.json({
                    success: true,
                    data: {
                        acknowledged: true,
                        next_check_at: nextCheckAt?.toISOString(),
                    },
                });
            } else if (task_type === 'influencer') {
                // 更新網黃偵測的 last_check_at
                await pool.execute(
                    `UPDATE influencer_detection_config SET last_check_at = ?`,
                    [completedAt]
                );

                // 取得下次檢查時間
                const [config] = await pool.execute<RowDataPacket[]>(
                    `SELECT check_interval_minutes FROM influencer_detection_config LIMIT 1`
                );

                let nextCheckAt = null;
                if (config.length > 0) {
                    const intervalMs = (config[0].check_interval_minutes || 30) * 60 * 1000;
                    nextCheckAt = new Date(completedAt.getTime() + intervalMs);
                }

                logger.info(`[ScraperAPI] 任務完成: type=influencer, status=${status}, new_authors=${new_authors}, duration=${duration_ms}ms`);

                res.json({
                    success: true,
                    data: {
                        acknowledged: true,
                        next_check_at: nextCheckAt?.toISOString(),
                    },
                });
            } else {
                res.status(400).json({ success: false, error: '無效的 task_type' });
            }
        } catch (error) {
            logger.error('[ScraperAPI] 回報任務完成失敗:', error);
            res.status(500).json({ success: false, error: '回報任務完成失敗' });
        }
    }

    /**
     * 取得本機爬蟲狀態（供前台查詢）
     */
    async getStatus(_req: Request, res: Response) {
        try {
            const pool = getPool();

            // 確保資料表存在
            await pool.execute(`
                CREATE TABLE IF NOT EXISTS scraper_heartbeat (
                    id INT PRIMARY KEY,
                    version VARCHAR(50),
                    last_scan_at DATETIME,
                    next_scan_at DATETIME,
                    status VARCHAR(50),
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);

            const [rows] = await pool.execute<RowDataPacket[]>(`
                SELECT version, last_scan_at, next_scan_at, status, updated_at
                FROM scraper_heartbeat
                WHERE id = 1
                LIMIT 1
            `);

            if (rows.length === 0) {
                res.json({
                    success: true,
                    data: {
                        online: false,
                        message: '本機爬蟲尚未連線'
                    }
                });
                return;
            }

            const heartbeat = rows[0];
            const updatedAt = new Date(heartbeat.updated_at);
            const now = new Date();
            const diffMinutes = (now.getTime() - updatedAt.getTime()) / 1000 / 60;

            // 超過 10 分鐘沒收到心跳視為離線
            const online = diffMinutes < 10;

            res.json({
                success: true,
                data: {
                    online,
                    version: heartbeat.version,
                    status: heartbeat.status,
                    last_scan_at: heartbeat.last_scan_at,
                    next_scan_at: heartbeat.next_scan_at,
                    last_heartbeat_at: heartbeat.updated_at,
                    message: online ? '本機爬蟲運作中' : '本機爬蟲已離線'
                }
            });
        } catch (error) {
            logger.error('[ScraperAPI] 取得狀態失敗:', error);
            res.status(500).json({ success: false, error: '取得狀態失敗' });
        }
    }
}

export default new ScraperApiController();
