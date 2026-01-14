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
                    id, name, short_name, description, brand_type,
                    JSON.stringify(keywords),
                    exclude_keywords ? JSON.stringify(exclude_keywords) : null,
                    notify_enabled, display_color,
                ]
            );

            res.json({
                success: true,
                data: { id, name },
                message: '品牌已建立',
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
          (SELECT COUNT(*) FROM monitor_brand_sources mbs WHERE mbs.source_id = ms.id) as brand_count
         FROM monitor_sources ms 
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

            await pool.execute(
                `INSERT INTO monitor_sources (
          id, name, url, platform, platform_category, 
          check_interval_hours, use_puppeteer
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, name, url, platform, platform_category, check_interval_hours, use_puppeteer]
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

            const offset = (Number(page) - 1) * Number(limit);

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
         LIMIT ? OFFSET ?`,
                [...values, Number(limit), offset]
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
                    data: result,
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

            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT mcl.*, ms.name as source_name
         FROM monitor_crawl_logs mcl
         INNER JOIN monitor_sources ms ON mcl.source_id = ms.id
         ${whereClause}
         ORDER BY mcl.started_at DESC
         LIMIT ?`,
                [...values, Number(limit)]
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
     */
    async getSourceTemplates(req: Request, res: Response): Promise<void> {
        const templates = [
            { name: 'Dcard 熱門', url: 'https://www.dcard.tw/f/trending', platform: 'dcard', platform_category: 'trending' },
            { name: 'Dcard 閒聊', url: 'https://www.dcard.tw/f/talk', platform: 'dcard', platform_category: 'talk' },
            { name: 'Dcard 西斯', url: 'https://www.dcard.tw/f/sex', platform: 'dcard', platform_category: 'sex' },
            { name: 'Dcard 女孩', url: 'https://www.dcard.tw/f/girl', platform: 'dcard', platform_category: 'girl' },
            { name: 'Dcard 感情', url: 'https://www.dcard.tw/f/relationship', platform: 'dcard', platform_category: 'relationship' },
            { name: 'PTT 八卦板', url: 'https://www.ptt.cc/bbs/Gossiping/index.html', platform: 'ptt', platform_category: 'Gossiping' },
            { name: 'PTT WomenTalk', url: 'https://www.ptt.cc/bbs/WomenTalk/index.html', platform: 'ptt', platform_category: 'WomenTalk' },
            { name: 'PTT Sex', url: 'https://www.ptt.cc/bbs/sex/index.html', platform: 'ptt', platform_category: 'sex' },
            { name: 'PTT Boy-Girl', url: 'https://www.ptt.cc/bbs/Boy-Girl/index.html', platform: 'ptt', platform_category: 'Boy-Girl' },
            { name: 'Mobile01 討論', url: 'https://www.mobile01.com/topiclist.php', platform: 'mobile01', platform_category: 'general' },
            { name: '痞客邦搜尋', url: 'https://www.pixnet.net/blog/search', platform: 'pixnet', platform_category: 'search' },
        ];

        res.json({ success: true, data: templates });
    }

    // ========================================
    // Google Trends API
    // ========================================

    /**
     * GET /api/monitor/trends/:brandId - 取得品牌的搜尋趨勢
     */
    async getBrandTrends(req: Request, res: Response): Promise<void> {
        try {
            const { brandId } = req.params;
            const { days = 30 } = req.query;

            const trendsService = (await import('../services/trends.service')).default;
            const trends = await trendsService.getBrandTrends(brandId, Number(days));

            res.json({ success: true, data: trends });
        } catch (error: any) {
            logger.error('Failed to get brand trends:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/monitor/trends/compare - 比較多個品牌的趨勢
     */
    async compareTrends(req: Request, res: Response): Promise<void> {
        try {
            const { brand_ids, days = 30 } = req.query;

            if (!brand_ids) {
                res.status(400).json({ success: false, error: '請提供品牌 ID' });
                return;
            }

            const brandIdList = typeof brand_ids === 'string'
                ? brand_ids.split(',')
                : (brand_ids as string[]);

            const trendsService = (await import('../services/trends.service')).default;
            const comparison = await trendsService.compareBrandTrends(brandIdList, Number(days));

            res.json({ success: true, data: comparison });
        } catch (error: any) {
            logger.error('Failed to compare trends:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * POST /api/monitor/trends/fetch - 手動抓取趨勢數據
     */
    async fetchTrends(req: Request, res: Response): Promise<void> {
        try {
            const trendsService = (await import('../services/trends.service')).default;

            // 非同步執行，立即返回
            trendsService.fetchTrendsForAllBrands().catch(err => {
                logger.error('Background trends fetch failed:', err);
            });

            res.json({
                success: true,
                message: '已開始抓取 Google Trends 數據，請稍後查看結果'
            });
        } catch (error: any) {
            logger.error('Failed to trigger trends fetch:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/monitor/trends/daily - 取得每日熱門搜尋
     */
    async getDailyTrends(req: Request, res: Response): Promise<void> {
        try {
            const { geo = 'TW' } = req.query;

            const trendsService = (await import('../services/trends.service')).default;
            const trends = await trendsService.getDailyTrends(geo as string);

            res.json({ success: true, data: trends });
        } catch (error: any) {
            logger.error('Failed to get daily trends:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    /**
     * GET /api/monitor/trends/related/:keyword - 取得相關搜尋詞
     */
    async getRelatedQueries(req: Request, res: Response): Promise<void> {
        try {
            const { keyword } = req.params;
            const { geo = 'TW' } = req.query;

            const trendsService = (await import('../services/trends.service')).default;
            const related = await trendsService.getRelatedQueries(keyword, geo as string);

            res.json({ success: true, data: related });
        } catch (error: any) {
            logger.error('Failed to get related queries:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
}

export default new MonitorController();

