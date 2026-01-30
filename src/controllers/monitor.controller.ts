/**
 * 聲量監控 API Controller
 */

import { Request, Response } from 'express';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import { generateUUID } from '../utils/uuid';
import logger from '../utils/logger';
import monitorService from '../services/monitor.service';

class MonitorController {
    // ========================================
    // 品牌管理 API
    // ========================================

    /**
     * GET /api/monitor/brands - 取得所有品牌
     */
    async getBrands(req: Request, res: Response): Promise<void> {
        try {
            const pool = getPool();
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT * FROM monitor_brands ORDER BY display_order, created_at DESC`
            );

            res.json({
                success: true,
                data: rows,
            });
        } catch (error: any) {
            logger.error('Failed to get brands:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/brands - 新增品牌
     */
    async createBrand(req: Request, res: Response): Promise<void> {
        try {
            const {
                name,
                short_name,
                description,
                brand_type = 'own',
                keywords,
                exclude_keywords,
                notify_enabled = true,
                display_color = '#667eea',
            } = req.body;

            if (!name || !keywords || !Array.isArray(keywords)) {
                res.status(400).json({ success: false, error: '請提供品牌名稱和關鍵字' });
                return;
            }

            const pool = getPool();
            const id = generateUUID();

            await pool.execute(
                `INSERT INTO monitor_brands (
          id, name, short_name, description, brand_type,
          keywords, exclude_keywords, notify_enabled, display_color
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, name, short_name || null, description || null, brand_type,
                    JSON.stringify(keywords),
                    exclude_keywords ? JSON.stringify(exclude_keywords) : null,
                    notify_enabled, display_color,
                ]
            );

            // 自動將新關鍵字組關聯到所有現有的來源
            const [sources] = await pool.execute<RowDataPacket[]>(
                'SELECT id FROM monitor_sources WHERE is_active = true'
            );

            for (const source of sources) {
                const linkId = generateUUID();
                try {
                    await pool.execute(
                        `INSERT INTO monitor_brand_sources (id, brand_id, source_id) VALUES (?, ?, ?)`,
                        [linkId, id, source.id]
                    );
                } catch (linkError: any) {
                    // 忽略重複關聯的錯誤
                    if (linkError.code !== 'ER_DUP_ENTRY') {
                        logger.warn(`Failed to link brand ${id} to source ${source.id}:`, linkError.message);
                    }
                }
            }

            logger.info(`Created brand "${name}" and linked to ${sources.length} existing sources`);

            res.json({
                success: true,
                data: { id, name, linkedSources: sources.length },
                message: `關鍵字組已建立，並已關聯到 ${sources.length} 個現有來源`,
            });
        } catch (error: any) {
            logger.error('Failed to create brand:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/brands/:id - 更新品牌
     */
    async updateBrand(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const updates = req.body;

            const pool = getPool();
            const allowedFields = [
                'name', 'short_name', 'description', 'brand_type',
                'keywords', 'exclude_keywords', 'notify_enabled',
                'notify_threshold', 'engagement_threshold', 'display_color', 'is_active',
            ];

            const setClauses: string[] = [];
            const values: any[] = [];

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    if (field === 'keywords' || field === 'exclude_keywords') {
                        setClauses.push(`${field} = ?`);
                        values.push(JSON.stringify(updates[field]));
                    } else {
                        setClauses.push(`${field} = ?`);
                        values.push(updates[field]);
                    }
                }
            }

            if (setClauses.length === 0) {
                res.status(400).json({ success: false, error: '沒有要更新的欄位' });
                return;
            }

            values.push(id);
            await pool.execute(
                `UPDATE monitor_brands SET ${setClauses.join(', ')} WHERE id = ?`,
                values
            );

            res.json({ success: true, message: '品牌已更新' });
        } catch (error: any) {
            logger.error('Failed to update brand:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * DELETE /api/monitor/brands/:id - 刪除品牌
     */
    async deleteBrand(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const pool = getPool();

            await pool.execute('DELETE FROM monitor_brands WHERE id = ?', [id]);

            res.json({ success: true, message: '品牌已刪除' });
        } catch (error: any) {
            logger.error('Failed to delete brand:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 來源管理 API
    // ========================================

    /**
     * GET /api/monitor/sources - 取得所有來源
     */
    async getSources(req: Request, res: Response): Promise<void> {
        try {
            const pool = getPool();
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT ms.*,
                    (SELECT COUNT(*) FROM monitor_brand_sources mbs WHERE mbs.source_id = ms.id) as brand_count,
                    (SELECT COUNT(*) FROM monitor_mentions mm WHERE mm.source_id = ms.id) as total_mentions,
                    mcl.completed_at as last_crawl_at,
                    mcl.status as last_crawl_status,
                    mcl.articles_found as last_articles_found,
                    mcl.new_mentions as last_new_mentions,
                    mcl.duplicate_skipped as last_duplicate_skipped,
                    mcl.error_message as last_error_message
                FROM monitor_sources ms
                LEFT JOIN (
                    SELECT source_id, completed_at, status, articles_found, new_mentions, duplicate_skipped, error_message,
                           ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY completed_at DESC) as rn
                    FROM monitor_crawl_logs
                ) mcl ON mcl.source_id = ms.id AND mcl.rn = 1
                ORDER BY ms.platform, ms.name`
            );

            res.json({ success: true, data: rows });
        } catch (error: any) {
            logger.error('Failed to get sources:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/sources - 新增來源
     */
    async createSource(req: Request, res: Response): Promise<void> {
        try {
            const {
                name,
                url,
                platform = 'other',
                platform_category,
                check_interval_hours = 1,
                use_puppeteer = false,
                brand_ids = [],
            } = req.body;

            if (!name || !url) {
                res.status(400).json({ success: false, error: '請提供來源名稱和網址' });
                return;
            }

            const pool = getPool();
            const id = generateUUID();

            // Dcard 需要使用 Puppeteer 繞過 Cloudflare
            const needsPuppeteer = platform === 'dcard' || use_puppeteer;

            await pool.execute(
                `INSERT INTO monitor_sources (
          id, name, url, platform, platform_category, 
          check_interval_hours, use_puppeteer
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, name, url, platform, platform_category || null, check_interval_hours, needsPuppeteer]
            );

            // 建立品牌關聯
            for (const brandId of brand_ids) {
                const linkId = generateUUID();
                await pool.execute(
                    `INSERT INTO monitor_brand_sources (id, brand_id, source_id) VALUES (?, ?, ?)`,
                    [linkId, brandId, id]
                );
            }

            res.json({
                success: true,
                data: { id, name },
                message: '來源已建立',
            });
        } catch (error: any) {
            logger.error('Failed to create source:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/sources/:id - 更新來源
     */
    async updateSource(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const updates = req.body;

            const pool = getPool();
            const allowedFields = [
                'name', 'url', 'platform', 'platform_category',
                'check_interval_hours', 'use_puppeteer', 'is_active', 'selectors',
            ];

            const setClauses: string[] = [];
            const values: any[] = [];

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    if (field === 'selectors') {
                        setClauses.push(`${field} = ?`);
                        values.push(JSON.stringify(updates[field]));
                    } else {
                        setClauses.push(`${field} = ?`);
                        values.push(updates[field]);
                    }
                }
            }

            if (setClauses.length > 0) {
                values.push(id);
                await pool.execute(
                    `UPDATE monitor_sources SET ${setClauses.join(', ')} WHERE id = ?`,
                    values
                );
            }

            // 更新品牌關聯
            if (updates.brand_ids !== undefined) {
                await pool.execute('DELETE FROM monitor_brand_sources WHERE source_id = ?', [id]);
                for (const brandId of updates.brand_ids) {
                    const linkId = generateUUID();
                    await pool.execute(
                        `INSERT INTO monitor_brand_sources (id, brand_id, source_id) VALUES (?, ?, ?)`,
                        [linkId, brandId, id]
                    );
                }
            }

            res.json({ success: true, message: '來源已更新' });
        } catch (error: any) {
            logger.error('Failed to update source:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * DELETE /api/monitor/sources/:id - 刪除來源
     */
    async deleteSource(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const pool = getPool();

            await pool.execute('DELETE FROM monitor_sources WHERE id = ?', [id]);

            res.json({ success: true, message: '來源已刪除' });
        } catch (error: any) {
            logger.error('Failed to delete source:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/sources/delete-by-platform - 刪除指定平台的所有來源
     */
    async deleteSourcesByPlatform(req: Request, res: Response): Promise<void> {
        try {
            const { platform } = req.body;

            if (!platform) {
                res.status(400).json({ success: false, error: '請指定平台' });
                return;
            }

            const pool = getPool();

            // 先查詢數量
            const [countResult] = await pool.execute<RowDataPacket[]>(
                'SELECT COUNT(*) as count FROM monitor_sources WHERE platform = ?',
                [platform]
            );
            const count = countResult[0].count;

            // 刪除
            await pool.execute('DELETE FROM monitor_sources WHERE platform = ?', [platform]);

            logger.info(`Deleted ${count} sources for platform: ${platform}`);

            res.json({
                success: true,
                data: { deleted: count, platform },
                message: `已刪除 ${count} 個 ${platform} 來源`,
            });
        } catch (error: any) {
            logger.error('Failed to delete sources by platform:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 提及記錄 API
    // ========================================

    /**
     * GET /api/monitor/mentions - 取得提及列表
     */
    async getMentions(req: Request, res: Response): Promise<void> {
        try {
            const {
                brand_id,
                source_id,
                is_read,
                sentiment,
                primary_topic,
                page = 1,
                limit = 20,
            } = req.query;

            const pool = getPool();
            let whereClause = 'WHERE 1=1';
            const values: any[] = [];

            if (brand_id) {
                whereClause += ' AND mm.brand_id = ?';
                values.push(brand_id);
            }
            if (source_id) {
                whereClause += ' AND mm.source_id = ?';
                values.push(source_id);
            }
            if (is_read !== undefined) {
                whereClause += ' AND mm.is_read = ?';
                values.push(is_read === 'true');
            }
            if (sentiment) {
                whereClause += ' AND mm.sentiment = ?';
                values.push(sentiment);
            }
            if (primary_topic) {
                whereClause += ' AND mm.primary_topic = ?';
                values.push(primary_topic);
            }

            const limitNum = Number(limit);
            const offsetNum = (Number(page) - 1) * limitNum;

            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          mm.*,
          mb.name as brand_name,
          mb.display_color as brand_color,
          ms.name as source_name,
          ms.platform
         FROM monitor_mentions mm
         INNER JOIN monitor_brands mb ON mm.brand_id = mb.id
         INNER JOIN monitor_sources ms ON mm.source_id = ms.id
         ${whereClause}
         ORDER BY mm.discovered_at DESC
         LIMIT ${limitNum} OFFSET ${offsetNum}`,
                values
            );

            // 取得總數
            const [countRows] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM monitor_mentions mm ${whereClause}`,
                values
            );

            res.json({
                success: true,
                data: {
                    mentions: rows,
                    total: countRows[0].total,
                    page: Number(page),
                    limit: Number(limit),
                },
            });
        } catch (error: any) {
            logger.error('Failed to get mentions:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/mentions/:id/read - 標記已讀
     */
    async markMentionRead(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const pool = getPool();

            await pool.execute(
                'UPDATE monitor_mentions SET is_read = true, read_at = NOW() WHERE id = ?',
                [id]
            );

            res.json({ success: true });
        } catch (error: any) {
            logger.error('Failed to mark mention read:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/mentions/:id/star - 星號標記
     */
    async toggleMentionStar(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const pool = getPool();

            await pool.execute(
                'UPDATE monitor_mentions SET is_starred = NOT is_starred WHERE id = ?',
                [id]
            );

            res.json({ success: true });
        } catch (error: any) {
            logger.error('Failed to toggle star:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 統計 API
    // ========================================

    /**
     * GET /api/monitor/stats/overview - 聲量總覽
     */
    async getStatsOverview(req: Request, res: Response): Promise<void> {
        try {
            const { days = 7 } = req.query;
            const pool = getPool();

            // 總提及數
            const [mentionCount] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as count FROM monitor_mentions 
         WHERE discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [days]
            );

            // 未讀數
            const [unreadCount] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as count FROM monitor_mentions 
         WHERE is_read = false AND discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
                [days]
            );

            // 各品牌提及數
            const [brandStats] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          mb.id, mb.name, mb.brand_type, mb.display_color,
          COUNT(mm.id) as mention_count,
          SUM(CASE WHEN mm.is_high_engagement THEN 1 ELSE 0 END) as high_engagement_count
         FROM monitor_brands mb
         LEFT JOIN monitor_mentions mm ON mb.id = mm.brand_id 
           AND mm.discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         WHERE mb.is_active = true
         GROUP BY mb.id
         ORDER BY mention_count DESC`,
                [days]
            );

            // 各來源提及數
            const [sourceStats] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          ms.id, ms.name, ms.platform, ms.health_status,
          COUNT(mm.id) as mention_count
         FROM monitor_sources ms
         LEFT JOIN monitor_mentions mm ON ms.id = mm.source_id 
           AND mm.discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         WHERE ms.is_active = true
         GROUP BY ms.id
         ORDER BY mention_count DESC`,
                [days]
            );

            // 每日趨勢
            const [dailyTrend] = await pool.execute<RowDataPacket[]>(
                `SELECT 
          DATE(discovered_at) as date,
          COUNT(*) as count
         FROM monitor_mentions
         WHERE discovered_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         GROUP BY DATE(discovered_at)
         ORDER BY date`,
                [days]
            );

            res.json({
                success: true,
                data: {
                    total_mentions: mentionCount[0].count,
                    unread_count: unreadCount[0].count,
                    brand_stats: brandStats,
                    source_stats: sourceStats,
                    daily_trend: dailyTrend,
                },
            });
        } catch (error: any) {
            logger.error('Failed to get stats overview:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 手動觸發 API
    // ========================================

    /**
     * POST /api/monitor/crawl - 手動觸發爬取
     */
    async triggerCrawl(req: Request, res: Response): Promise<void> {
        try {
            const { source_id } = req.body;
            const pool = getPool();

            if (source_id) {
                // 爬取特定來源
                const [sources] = await pool.execute<RowDataPacket[]>(
                    'SELECT * FROM monitor_sources WHERE id = ?',
                    [source_id]
                );

                if (sources.length === 0) {
                    res.status(404).json({ success: false, error: '來源不存在' });
                    return;
                }

                const result = await monitorService.crawlSource(sources[0] as any);
                res.json({
                    success: true,
                    data: {
                        ...result,
                        source: sources[0].name,
                    },
                    message: `爬取完成，發現 ${result.newMentions} 筆新提及`,
                });
            } else {
                // 爬取所有到期來源
                await monitorService.runScheduledCrawls();
                res.json({ success: true, message: '已啟動排程爬取' });
            }
        } catch (error: any) {
            logger.error('Failed to trigger crawl:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/monitor/crawl-logs - 取得爬取日誌
     */
    async getCrawlLogs(req: Request, res: Response): Promise<void> {
        try {
            const { source_id, limit = 20 } = req.query;
            const pool = getPool();

            let whereClause = '';
            const values: any[] = [];

            if (source_id) {
                whereClause = 'WHERE mcl.source_id = ?';
                values.push(source_id);
            }

            const limitNum = Number(limit);

            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT mcl.*, ms.name as source_name
         FROM monitor_crawl_logs mcl
         INNER JOIN monitor_sources ms ON mcl.source_id = ms.id
         ${whereClause}
         ORDER BY mcl.started_at DESC
         LIMIT ${limitNum}`,
                values
            );

            res.json({ success: true, data: rows });
        } catch (error: any) {
            logger.error('Failed to get crawl logs:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 預設模板 API
    // ========================================

    /**
     * GET /api/monitor/templates - 取得預設來源模板
     * 注意：Dcard 來源會自動抓取最新文章（程式會自動加上 ?tab=latest）
     */
    async getSourceTemplates(req: Request, res: Response): Promise<void> {
        const templates = [
            { name: 'Dcard 閒聊 (最新)', url: 'https://www.dcard.tw/f/talk?tab=latest', platform: 'dcard', platform_category: 'talk', description: '抓取最新文章' },
            { name: 'Dcard 西斯 (最新)', url: 'https://www.dcard.tw/f/sex?tab=latest', platform: 'dcard', platform_category: 'sex', description: '抓取最新文章' },
            { name: 'Dcard 女孩 (最新)', url: 'https://www.dcard.tw/f/girl?tab=latest', platform: 'dcard', platform_category: 'girl', description: '抓取最新文章' },
            { name: 'Dcard 感情 (最新)', url: 'https://www.dcard.tw/f/relationship?tab=latest', platform: 'dcard', platform_category: 'relationship', description: '抓取最新文章' },
            { name: 'Dcard 美妝 (最新)', url: 'https://www.dcard.tw/f/makeup?tab=latest', platform: 'dcard', platform_category: 'makeup', description: '抓取最新文章' },
            { name: 'Dcard 女孩西斯 (最新)', url: 'https://www.dcard.tw/f/girlsex?tab=latest', platform: 'dcard', platform_category: 'girlsex', description: '抓取最新文章' },
            { name: 'Dcard 西斯玩具 (最新)', url: 'https://www.dcard.tw/f/sex_toys?tab=latest', platform: 'dcard', platform_category: 'sex_toys', description: '抓取最新文章' },
            { name: 'PTT Sex', url: 'https://www.ptt.cc/bbs/sex/index.html', platform: 'ptt', platform_category: 'sex' },
            { name: 'PTT feminine_sex', url: 'https://www.ptt.cc/bbs/feminine_sex/index.html', platform: 'ptt', platform_category: 'feminine_sex' },
            { name: 'PTT 八卦板', url: 'https://www.ptt.cc/bbs/Gossiping/index.html', platform: 'ptt', platform_category: 'Gossiping' },
            { name: 'PTT WomenTalk', url: 'https://www.ptt.cc/bbs/WomenTalk/index.html', platform: 'ptt', platform_category: 'WomenTalk' },
            { name: 'PTT Boy-Girl', url: 'https://www.ptt.cc/bbs/Boy-Girl/index.html', platform: 'ptt', platform_category: 'Boy-Girl' },
        ];

        res.json({ success: true, data: templates });
    }

    // ========================================
    // 爬蟲控制 API
    // ========================================

    /**
     * POST /api/monitor/crawl/run - 手動觸發爬蟲
     */
    async runCrawl(req: Request, res: Response): Promise<void> {
        try {
            const { source_id } = req.body;
            const pool = getPool();

            if (source_id) {
                // 爬取特定來源
                const [sources] = await pool.execute<RowDataPacket[]>(
                    `SELECT * FROM monitor_sources WHERE id = ? AND is_active = true`,
                    [source_id]
                );

                if (sources.length === 0) {
                    res.status(404).json({ success: false, error: '找不到該來源' });
                    return;
                }

                const result = await monitorService.crawlSource(sources[0] as any);
                res.json({
                    success: true,
                    data: {
                        source: sources[0].name,
                        ...result,
                    },
                });
            } else {
                // 爬取所有到期來源
                await monitorService.runScheduledCrawls();
                res.json({ success: true, message: '已觸發排程爬蟲' });
            }
        } catch (error: any) {
            logger.error('Failed to run crawl:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/reclassify - 重新分類所有提及
     */
    async reclassifyMentions(req: Request, res: Response): Promise<void> {
        try {
            const pool = getPool();
            const classifierService = (await import('../services/classifier.service')).default;

            // 重新載入分類規則
            classifierService.reloadConfig();
            const version = classifierService.getVersion();

            // 取得所有提及（或可加上條件篩選）
            const [mentions] = await pool.execute<RowDataPacket[]>(
                `SELECT id, title, content FROM monitor_mentions`
            );

            let processed = 0;

            for (const mention of mentions) {
                const textToClassify = `${mention.title || ''} ${mention.content || ''}`;
                const classification = classifierService.classify(textToClassify);

                await pool.execute(
                    `UPDATE monitor_mentions SET
                        primary_topic = ?,
                        topics = ?,
                        classification_hits = ?,
                        classification_version = ?,
                        has_strong_hit = ?
                     WHERE id = ?`,
                    [
                        classification.primary_topic,
                        JSON.stringify(classification.topics),
                        JSON.stringify(classification.hits),
                        classification.version,
                        classification.hits.length > 0, // All hits are now direct hits
                        mention.id,
                    ]
                );
                processed++;
            }

            logger.info(`[Monitor] Reclassified ${processed} mentions with version ${version}`);

            res.json({
                success: true,
                data: {
                    processed,
                    version,
                },
                message: `已重新分類 ${processed} 筆提及`,
            });
        } catch (error: any) {
            logger.error('Failed to reclassify mentions:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 分類設定 API
    // ========================================

    /**
     * GET /api/monitor/classifier-config - 取得分類設定
     */
    async getClassifierConfig(req: Request, res: Response): Promise<void> {
        try {
            const classifierService = (await import('../services/classifier.service')).default;
            const config = classifierService.getFullConfig();

            if (!config) {
                res.status(404).json({ success: false, error: '設定檔案不存在' });
                return;
            }

            res.json({
                success: true,
                data: config,
            });
        } catch (error: any) {
            logger.error('Failed to get classifier config:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/classifier-config - 更新分類設定
     */
    async updateClassifierConfig(req: Request, res: Response): Promise<void> {
        try {
            const classifierService = (await import('../services/classifier.service')).default;
            const updates = req.body;

            // 支援部分更新
            if (updates.exclude_patterns) {
                classifierService.updateExcludePatterns(updates.exclude_patterns);
            }

            // 如果是完整更新
            if (updates.topics) {
                const currentConfig = classifierService.getFullConfig();
                if (currentConfig) {
                    currentConfig.topics = updates.topics;
                    if (updates.exclude_patterns) {
                        currentConfig.exclude_patterns = updates.exclude_patterns;
                    }
                    classifierService.updateFullConfig(currentConfig);
                }
            }

            res.json({
                success: true,
                message: '分類設定已更新',
            });
        } catch (error: any) {
            logger.error('Failed to update classifier config:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/classifier-rules - 新增分類規則
     */
    async addClassifierRule(req: Request, res: Response): Promise<void> {
        try {
            const classifierService = (await import('../services/classifier.service')).default;
            const { topic, rule } = req.body;

            if (!topic || !rule || !rule.id || !rule.name || !rule.pattern) {
                res.status(400).json({ success: false, error: '缺少必要欄位' });
                return;
            }

            classifierService.addRule(topic, rule);

            res.json({
                success: true,
                message: '規則已新增',
            });
        } catch (error: any) {
            logger.error('Failed to add classifier rule:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * PUT /api/monitor/classifier-rules/:topic/:ruleId - 更新分類規則
     */
    async updateClassifierRule(req: Request, res: Response): Promise<void> {
        try {
            const classifierService = (await import('../services/classifier.service')).default;
            const { topic, ruleId } = req.params;
            const updates = req.body;

            classifierService.updateRule(topic, ruleId, updates);

            res.json({
                success: true,
                message: '規則已更新',
            });
        } catch (error: any) {
            logger.error('Failed to update classifier rule:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * DELETE /api/monitor/classifier-rules/:topic/:ruleId - 刪除分類規則
     */
    async deleteClassifierRule(req: Request, res: Response): Promise<void> {
        try {
            const classifierService = (await import('../services/classifier.service')).default;
            const { topic, ruleId } = req.params;

            classifierService.deleteRule(topic, ruleId);

            res.json({
                success: true,
                message: '規則已刪除',
            });
        } catch (error: any) {
            logger.error('Failed to delete classifier rule:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 關聯修復 API
    // ========================================

    /**
     * POST /api/monitor/relink-all - 重新建立所有品牌與來源的關聯
     * 用於修復關聯遺失的問題
     */
    async relinkAllBrandsSources(req: Request, res: Response): Promise<void> {
        try {
            const pool = getPool();

            // 取得所有活躍的品牌和來源
            const [brands] = await pool.execute<RowDataPacket[]>(
                'SELECT id, name FROM monitor_brands WHERE is_active = true'
            );
            const [sources] = await pool.execute<RowDataPacket[]>(
                'SELECT id, name FROM monitor_sources WHERE is_active = true'
            );

            let created = 0;
            let skipped = 0;

            // 為每個品牌-來源組合建立關聯
            for (const brand of brands) {
                for (const source of sources) {
                    const linkId = generateUUID();
                    try {
                        await pool.execute(
                            `INSERT INTO monitor_brand_sources (id, brand_id, source_id) VALUES (?, ?, ?)`,
                            [linkId, brand.id, source.id]
                        );
                        created++;
                    } catch (error: any) {
                        // 已存在的關聯會因為 UNIQUE KEY 而失敗，這是正常的
                        if (error.code === 'ER_DUP_ENTRY') {
                            skipped++;
                        } else {
                            throw error;
                        }
                    }
                }
            }

            logger.info(`Relinked brands-sources: ${created} created, ${skipped} already existed`);

            res.json({
                success: true,
                data: {
                    brands: brands.length,
                    sources: sources.length,
                    linksCreated: created,
                    linksSkipped: skipped,
                },
                message: `已重新建立關聯：新增 ${created} 個，跳過 ${skipped} 個（已存在）`,
            });
        } catch (error: any) {
            logger.error('Failed to relink brands-sources:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    // ========================================
    // 週報 API
    // ========================================

    /**
     * GET /api/monitor/weekly-report - 取得週報數據
     * Query: weeks_ago (default: 0, 本週)
     */
    async getWeeklyReport(req: Request, res: Response): Promise<void> {
        try {
            const { weeks_ago = 0 } = req.query;
            const weeklyReportService = (await import('../services/weekly-report.service')).default;
            const report = await weeklyReportService.generateReport(Number(weeks_ago));

            res.json({ success: true, data: report });
        } catch (error: any) {
            logger.error('Failed to get weekly report:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/weekly-report/send - 手動發送週報到 LINE
     */
    async sendWeeklyReport(req: Request, res: Response): Promise<void> {
        try {
            const { weeks_ago = 0 } = req.body;
            const weeklyReportService = (await import('../services/weekly-report.service')).default;

            const report = await weeklyReportService.generateReport(Number(weeks_ago));
            const sent = await weeklyReportService.sendReportToLine(report);

            if (sent) {
                res.json({ success: true, message: '週報已發送到 LINE' });
            } else {
                res.status(500).json({ success: false, error: '發送失敗，請確認 LINE 設定' });
            }
        } catch (error: any) {
            logger.error('Failed to send weekly report:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new MonitorController();

