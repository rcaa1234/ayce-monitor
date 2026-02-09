/**
 * Scraper API 控制器
 * 提供本機爬蟲所需的設定與結果接收端點
 */

import { Request, Response } from 'express';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { generateUUID } from '../utils/uuid';
import logger from '../utils/logger';

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
                    scraperConfig = { ...scraperConfig, ...configRows[0] as any };
                }
            } catch {
                // 資料表不存在，使用預設值
                logger.warn('[ScraperAPI] scraper_config 資料表不存在，使用預設值');
            }

            // 1. 檢查需要爬取的 monitor sources（包含 Dcard 和 PTT）
            const maxTasks = Number(scraperConfig.max_concurrent_tasks) || 3;
            const [dueSources] = await pool.execute<RowDataPacket[]>(
                `SELECT ms.id, ms.name, ms.url, ms.platform, ms.max_items_per_check, ms.check_interval_hours
                 FROM monitor_sources ms
                 WHERE ms.is_active = 1
                   AND ms.platform IN ('dcard', 'ptt')
                   AND (
                       ms.last_checked_at IS NULL
                       OR ms.last_checked_at < DATE_SUB(NOW(), INTERVAL ms.check_interval_hours HOUR)
                   )
                 ORDER BY ms.last_checked_at ASC
                 LIMIT ${maxTasks}`
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
                        url: source.url,
                        platform: source.platform,
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
