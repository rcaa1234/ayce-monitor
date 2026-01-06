/**
 * Statistics Controller
 * 處理統計相關的 API 請求
 */

import { Request, Response } from 'express';
import { StatisticsModel } from '../models/statistics.model';
import threadsInsightsService from '../services/threads-insights.service';
import logger from '../utils/logger';

export class StatisticsController {
  /**
   * GET /api/statistics/overview
   * 獲取統計總覽
   */
  async getOverview(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 7;

      const stats = await StatisticsModel.getOverviewStats(days);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      logger.error('Failed to get overview stats:', error);
      res.status(500).json({
        success: false,
        error: '獲取統計總覽失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/templates
   * 獲取樣板統計
   */
  async getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 30;

      const templates = await StatisticsModel.getTemplateStats(days);

      res.json({
        success: true,
        data: templates,
      });
    } catch (error: any) {
      logger.error('Failed to get template stats:', error);
      res.status(500).json({
        success: false,
        error: '獲取樣板統計失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/timeslots
   * 獲取時段統計
   */
  async getTimeslots(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 30;

      const timeslots = await StatisticsModel.getTimeslotStats(days);

      res.json({
        success: true,
        data: timeslots,
      });
    } catch (error: any) {
      logger.error('Failed to get timeslot stats:', error);
      res.status(500).json({
        success: false,
        error: '獲取時段統計失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/analytics
   * 獲取數據分析（時段、星期、Top 貼文、內容長度）
   */
  async getAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 90;

      // 使用個別 try-catch 避免一個失敗導致全部失敗
      let hourlyAnalysis: any = { hours: [], bestHour: 0 };
      let dayAnalysis: any = { days: [], bestDay: 0 };
      let topPosts: any[] = [];
      let contentAnalysis: any = { short: { count: 0, avgEngagement: 0 }, medium: { count: 0, avgEngagement: 0 }, long: { count: 0, avgEngagement: 0 }, recommendation: '尚無足夠數據' };

      try {
        hourlyAnalysis = await StatisticsModel.getHourlyAnalysis(days);
      } catch (e: any) {
        logger.warn('Failed to get hourly analysis:', e.message);
      }

      try {
        dayAnalysis = await StatisticsModel.getDayOfWeekAnalysis(days);
      } catch (e: any) {
        logger.warn('Failed to get day analysis:', e.message);
      }

      try {
        topPosts = await StatisticsModel.getTopPerformingPosts(5, days);
      } catch (e: any) {
        logger.warn('Failed to get top posts:', e.message);
      }

      try {
        contentAnalysis = await StatisticsModel.getContentLengthAnalysis(days);
      } catch (e: any) {
        logger.warn('Failed to get content analysis:', e.message);
      }

      res.json({
        success: true,
        data: {
          hourlyAnalysis,
          dayAnalysis,
          topPosts,
          contentAnalysis,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get analytics:', error);
      res.status(500).json({
        success: false,
        error: '獲取數據分析失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/heatmap
   * 獲取熱力圖數據
   */
  async getHeatmap(req: Request, res: Response): Promise<void> {
    try {
      const days = parseInt(req.query.days as string) || 30;

      const heatmap = await StatisticsModel.getHeatmapData(days);

      res.json({
        success: true,
        data: heatmap,
      });
    } catch (error: any) {
      logger.error('Failed to get heatmap data:', error);
      res.status(500).json({
        success: false,
        error: '獲取熱力圖數據失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/posts
   * 獲取貼文明細列表
   */
  async getPosts(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const sortBy = (req.query.sortBy as any) || 'posted_at';
      const sortOrder = (req.query.sortOrder as any) || 'DESC';
      const templateId = req.query.templateId as string;
      const timeslotId = req.query.timeslotId as string;

      // 解析日期範圍
      let dateFrom: Date | undefined;
      let dateTo: Date | undefined;

      if (req.query.dateFrom) {
        dateFrom = new Date(req.query.dateFrom as string);
      }

      if (req.query.dateTo) {
        dateTo = new Date(req.query.dateTo as string);
      }

      const result = await StatisticsModel.getPostDetails({
        page,
        limit,
        sortBy,
        sortOrder,
        templateId,
        timeslotId,
        dateFrom,
        dateTo,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error('Failed to get post details:', error);
      res.status(500).json({
        success: false,
        error: '獲取貼文明細失敗',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/statistics/sync
   * 手動觸發 Insights 同步（同步執行，等待完成）
   */
  async syncInsights(req: Request, res: Response): Promise<void> {
    try {
      const { days, limit } = req.body;

      logger.info(`Starting manual insights sync: days=${days || 30}, limit=${limit || 100}`);

      // 同步執行，等待完成
      await threadsInsightsService.syncRecentPostsInsights(days || 30, limit || 100);

      // 獲取同步後的統計
      const { getPool } = await import('../database/connection');
      const pool = getPool();
      const [countRows] = await pool.execute(
        'SELECT COUNT(DISTINCT post_id) as count FROM post_insights'
      );
      const syncedCount = (countRows as any)[0]?.count || 0;

      logger.info(`Manual insights sync completed: ${syncedCount} posts have insights`);

      res.json({
        success: true,
        message: `同步完成！共 ${syncedCount} 篇貼文有互動數據`,
        synced_count: syncedCount,
      });
    } catch (error: any) {
      logger.error('Failed to sync insights:', error);
      res.status(500).json({
        success: false,
        error: '同步失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/sync-status
   * 獲取同步狀態（顯示最近一次同步時間）
   */
  async getSyncStatus(req: Request, res: Response): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 獲取最近一次同步時間（使用 fetched_at 欄位）
      const [rows] = await pool.execute(
        `SELECT MAX(fetched_at) as last_synced_at
         FROM post_insights`
      );

      const lastSyncedAt = (rows as any)[0]?.last_synced_at || null;

      // 獲取待同步的貼文數量（已發布但尚未同步的）
      const [pendingRows] = await pool.execute(
        `SELECT COUNT(*) as pending_count
         FROM posts p
         LEFT JOIN post_insights pi ON p.id = pi.post_id
         WHERE p.status = 'POSTED'
           AND pi.id IS NULL`
      );

      const pendingCount = (pendingRows as any)[0]?.pending_count || 0;

      // 獲取已同步的貼文總數（實際有 insights 數據的）
      const [syncedRows] = await pool.execute(
        `SELECT COUNT(DISTINCT pi.post_id) as synced_count FROM post_insights pi
         INNER JOIN posts p ON pi.post_id = p.id
         WHERE p.status = 'POSTED'`
      );
      const syncedCount = (syncedRows as any)[0]?.synced_count || 0;

      res.json({
        success: true,
        data: {
          last_synced_at: lastSyncedAt,
          pending_count: pendingCount,
          synced_count: syncedCount,
          is_syncing: false,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get sync status:', error);
      res.status(500).json({
        success: false,
        error: '獲取同步狀態失敗',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/statistics/sync-threads-posts
   * 從 Threads 帳號同步歷史貼文到本地資料庫
   * @param fetchAll 如果為 true，會獲取所有歷史貼文（可能需要較長時間）
   */
  async syncThreadsPosts(req: Request, res: Response): Promise<void> {
    try {
      const { limit = 50, fetchAll = false } = req.body;
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 獲取預設 Threads 帳號
      const threadsService = (await import('../services/threads.service')).default;
      const defaultAccount = await threadsService.getDefaultAccount();

      if (!defaultAccount) {
        res.status(400).json({
          success: false,
          error: '尚未連結 Threads 帳號，請先在「Threads 帳號」頁面連結帳號。',
        });
        return;
      }

      // 確保「圖片式文字」和「人工發文」模板存在
      const templateIds = await this.ensureImportTemplates(pool);

      // 從 Threads API 獲取貼文列表
      // 如果 fetchAll 為 true，會自動分頁獲取所有歷史貼文
      const threadsPosts = await threadsService.getAccountPosts(
        defaultAccount.account.account_id,
        defaultAccount.token,
        Math.min(limit, 50),
        fetchAll
      );

      if (threadsPosts.length === 0) {
        res.json({
          success: true,
          message: '沒有找到任何貼文',
          data: { imported: 0, updated: 0, skipped: 0 },
        });
        return;
      }

      let imported = 0;
      let updated = 0;
      let skipped = 0;

      // 取得系統管理員用戶 ID（用於 created_by）
      const [adminUsers] = await pool.execute(
        `SELECT u.id FROM users u
         INNER JOIN user_roles ur ON u.id = ur.user_id
         INNER JOIN roles r ON ur.role_id = r.id
         WHERE r.name = 'admin' AND u.status = 'ACTIVE'
         LIMIT 1`
      );
      const adminUserId = (adminUsers as any)[0]?.id || null;

      for (const post of threadsPosts) {
        try {
          // 根據 media_type 判斷模板分類
          // IMAGE, VIDEO, CAROUSEL_ALBUM = 圖片式文字
          // TEXT = 人工發文
          const templateId = this.classifyPostTemplate(post.media_type, templateIds);

          // 檢查是否已存在（通過 threads_media_id 或 post_url）
          const [existing] = await pool.execute(
            `SELECT id FROM posts WHERE threads_media_id = ? OR post_url LIKE ? LIMIT 1`,
            [post.id, `%${post.id}%`]
          );

          if ((existing as any[]).length > 0) {
            // 已存在，更新 insights 和模板分類
            const existingPostId = (existing as any)[0].id;

            // 更新模板分類（如果之前沒有分類）
            await pool.execute(
              `UPDATE posts SET template_id = COALESCE(template_id, ?) WHERE id = ?`,
              [templateId, existingPostId]
            );

            const insights = await threadsService.getPostInsights(post.id, defaultAccount.token);

            if (insights) {
              // 檢查 post_insights 是否存在
              const [insightExists] = await pool.execute(
                `SELECT id FROM post_insights WHERE post_id = ? LIMIT 1`,
                [existingPostId]
              );

              if ((insightExists as any[]).length > 0) {
                await pool.execute(
                  `UPDATE post_insights SET views = ?, likes = ?, replies = ?, reposts = ?, last_synced_at = NOW() WHERE post_id = ?`,
                  [insights.views, insights.likes, insights.replies, insights.reposts, existingPostId]
                );
              } else {
                const { generateUUID } = await import('../utils/uuid');
                await pool.execute(
                  `INSERT INTO post_insights (id, post_id, views, likes, replies, reposts, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                  [generateUUID(), existingPostId, insights.views, insights.likes, insights.replies, insights.reposts]
                );
              }
              updated++;
            }
            continue;
          }

          // 建立新貼文記錄（包含模板分類）
          const { generateUUID } = await import('../utils/uuid');
          const postId = generateUUID();
          const postedAt = new Date(post.timestamp);

          await pool.execute(
            `INSERT INTO posts (id, status, threads_media_id, post_url, posted_at, created_by, template_id, created_at)
             VALUES (?, 'POSTED', ?, ?, ?, ?, ?, NOW())`,
            [postId, post.id, post.permalink, postedAt, adminUserId, templateId]
          );

          // 建立 revision（如果有文字內容）
          if (post.text) {
            const revisionId = generateUUID();
            await pool.execute(
              `INSERT INTO post_revisions (id, post_id, content, revision_no, engine_used, created_at)
               VALUES (?, ?, ?, 1, 'IMPORTED', NOW())`,
              [revisionId, postId, post.text]
            );
          }

          // 獲取並儲存 insights
          const insights = await threadsService.getPostInsights(post.id, defaultAccount.token);
          if (insights) {
            const insightId = generateUUID();
            await pool.execute(
              `INSERT INTO post_insights (id, post_id, views, likes, replies, reposts, last_synced_at)
               VALUES (?, ?, ?, ?, ?, ?, NOW())`,
              [insightId, postId, insights.views, insights.likes, insights.replies, insights.reposts]
            );
          }

          imported++;
          logger.info(`Imported Threads post: ${post.id} (template: ${templateId})`);

          // 稍微延遲以避免 API rate limit
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (postError: any) {
          logger.warn(`Failed to import post ${post.id}:`, postError.message);
          skipped++;
        }
      }

      // 同步刪除：檢查資料庫中有但 Threads 上已刪除的貼文
      let deleted = 0;
      try {
        // 獲取所有從 Threads 匯入的貼文（有 threads_media_id 的）
        const [dbPosts] = await pool.execute(
          `SELECT id, threads_media_id FROM posts WHERE threads_media_id IS NOT NULL AND status = 'POSTED'`
        );

        // 建立 Threads 貼文 ID 集合
        const threadsPostIds = new Set(threadsPosts.map((p: any) => p.id));

        // 找出資料庫中有但 Threads 上沒有的貼文（已被刪除）
        for (const dbPost of (dbPosts as any[])) {
          if (!threadsPostIds.has(dbPost.threads_media_id)) {
            // 這篇貼文在 Threads 上已被刪除，同步刪除資料庫記錄
            await pool.execute('DELETE FROM post_insights WHERE post_id = ?', [dbPost.id]);
            await pool.execute('DELETE FROM post_revisions WHERE post_id = ?', [dbPost.id]);
            await pool.execute('DELETE FROM posts WHERE id = ?', [dbPost.id]);
            deleted++;
            logger.info(`Deleted orphan post: ${dbPost.threads_media_id}`);
          }
        }

        if (deleted > 0) {
          logger.info(`✓ Cleaned up ${deleted} deleted posts from database`);
        }
      } catch (deleteError: any) {
        logger.warn('Failed to clean up deleted posts:', deleteError.message);
      }

      logger.info(`✓ Threads posts sync completed: ${imported} imported, ${updated} updated, ${skipped} skipped, ${deleted} deleted`);

      res.json({
        success: true,
        message: `同步完成！匯入 ${imported} 篇、更新 ${updated} 篇、跳過 ${skipped} 篇${deleted > 0 ? `、刪除 ${deleted} 篇` : ''}`,
        data: { imported, updated, skipped, deleted },
      });
    } catch (error: any) {
      logger.error('Failed to sync Threads posts:', error);
      res.status(500).json({
        success: false,
        error: '同步 Threads 貼文失敗',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/statistics/reclassify-templates
   * 重新分類所有沒有模板的貼文
   */
  async reclassifyTemplates(req: Request, res: Response): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 確保模板存在
      const templateIds = await this.ensureImportTemplates(pool);

      // 找出所有沒有模板的已發布貼文
      const [postsWithoutTemplate] = await pool.execute(
        `SELECT p.id, p.threads_media_id, p.post_url
         FROM posts p
         WHERE p.status = 'POSTED' AND p.template_id IS NULL`
      );

      let classified = 0;
      let skipped = 0;

      for (const post of postsWithoutTemplate as any[]) {
        try {
          // 根據是否有 threads_media_id 或 post_url 包含特定關鍵字來判斷類型
          // 預設為「人工發文」，如果有媒體相關標記則為「圖片式文字」
          let templateId = templateIds.manual;

          // 如果 post_url 包含圖片/影片相關的標記，分類為圖片式文字
          if (post.post_url && (
            post.post_url.includes('/p/') || // 一般貼文
            post.post_url.includes('/reel/') // Reels
          )) {
            // 無法確定，預設為人工發文
            templateId = templateIds.manual;
          }

          await pool.execute(
            `UPDATE posts SET template_id = ? WHERE id = ?`,
            [templateId, post.id]
          );
          classified++;
        } catch (error) {
          skipped++;
        }
      }

      logger.info(`Reclassified ${classified} posts, skipped ${skipped}`);

      res.json({
        success: true,
        message: `已重新分類 ${classified} 篇貼文`,
        data: { classified, skipped, total: (postsWithoutTemplate as any[]).length },
      });
    } catch (error: any) {
      logger.error('Failed to reclassify templates:', error);
      res.status(500).json({
        success: false,
        error: '重新分類失敗',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/statistics/best-time-post
   * 取得特定模板在最佳時段的貼文
   */
  async getBestTimePost(req: Request, res: Response): Promise<void> {
    try {
      const templateName = req.query.template as string;
      const bestTime = req.query.time as string; // 格式: "Monday 08:04"

      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 解析星期和時間
      const dayMap: { [key: string]: number } = {
        'Sunday': 1, 'Monday': 2, 'Tuesday': 3, 'Wednesday': 4,
        'Thursday': 5, 'Friday': 6, 'Saturday': 7
      };

      let dayOfWeek: number | null = null;
      let hour: number | null = null;

      if (bestTime) {
        const parts = bestTime.split(' ');
        if (parts.length >= 2) {
          dayOfWeek = dayMap[parts[0]] || null;
          const timeParts = parts[1].split(':');
          hour = parseInt(timeParts[0]) || null;
        }
      }

      // 查詢該模板在該時段表現最好的貼文
      let query = `
        SELECT p.id, p.post_url, p.posted_at, pr.content,
               pi.views, pi.likes, pi.replies,
               CASE WHEN pi.views > 0 
                    THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100) 
                    ELSE 0 END as engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id
        LEFT JOIN content_templates ct ON p.template_id = ct.id
        WHERE p.status = 'POSTED'
      `;

      const params: any[] = [];

      if (templateName) {
        query += ` AND ct.name = ?`;
        params.push(templateName);
      }

      if (dayOfWeek !== null) {
        query += ` AND DAYOFWEEK(p.posted_at) = ?`;
        params.push(dayOfWeek);
      }

      if (hour !== null) {
        query += ` AND HOUR(p.posted_at) = ?`;
        params.push(hour);
      }

      query += ` ORDER BY engagement_rate DESC, pi.views DESC LIMIT 5`;

      const [rows] = await pool.execute(query, params);

      res.json({
        success: true,
        data: {
          posts: (rows as any[]).map(row => ({
            id: row.id,
            postUrl: row.post_url,
            postedAt: row.posted_at,
            content: row.content ? row.content.substring(0, 100) + '...' : null,
            views: row.views,
            likes: row.likes,
            replies: row.replies,
            engagementRate: parseFloat(row.engagement_rate).toFixed(2),
          })),
        },
      });
    } catch (error: any) {
      logger.error('Failed to get best time post:', error);
      res.status(500).json({
        success: false,
        error: '查詢失敗',
        message: error.message,
      });
    }
  }

  /**
   * 確保「圖片式文字」和「人工發文」模板存在
   */
  private async ensureImportTemplates(pool: any): Promise<{ imageText: string; manual: string }> {
    const { generateUUID } = await import('../utils/uuid');

    // 檢查「圖片式文字」模板
    const [imageTextRows] = await pool.execute(
      `SELECT id FROM content_templates WHERE name = '圖片式文字' LIMIT 1`
    );
    let imageTextId: string;
    if ((imageTextRows as any[]).length === 0) {
      imageTextId = generateUUID();
      await pool.execute(
        `INSERT INTO content_templates (id, name, prompt, description, preferred_engine, enabled)
         VALUES (?, '圖片式文字', '圖片式文字貼文模板', '包含圖片或影片的貼文', 'GEMINI', true)`,
        [imageTextId]
      );
      logger.info('Created template: 圖片式文字');
    } else {
      imageTextId = (imageTextRows as any)[0].id;
    }

    // 檢查「人工發文」模板
    const [manualRows] = await pool.execute(
      `SELECT id FROM content_templates WHERE name = '人工發文' LIMIT 1`
    );
    let manualId: string;
    if ((manualRows as any[]).length === 0) {
      manualId = generateUUID();
      await pool.execute(
        `INSERT INTO content_templates (id, name, prompt, description, preferred_engine, enabled)
         VALUES (?, '人工發文', '人工發文模板', '手動發布的純文字貼文', 'GEMINI', true)`,
        [manualId]
      );
      logger.info('Created template: 人工發文');
    } else {
      manualId = (manualRows as any)[0].id;
    }

    return { imageText: imageTextId, manual: manualId };
  }

  /**
   * 根據貼文類型分類模板
   */
  private classifyPostTemplate(
    mediaType: string,
    templateIds: { imageText: string; manual: string }
  ): string {
    // IMAGE, VIDEO, CAROUSEL_ALBUM = 圖片式文字
    // TEXT 或其他 = 人工發文
    const imageTypes = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REELS_VIDEO'];
    if (imageTypes.includes(mediaType?.toUpperCase())) {
      return templateIds.imageText;
    }
    return templateIds.manual;
  }
}

export default new StatisticsController();
