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

      // 先同步最近貼文（快速匯入新貼文到資料庫）
      try {
        await threadsInsightsService.syncRecentPosts(20);
      } catch (e: any) {
        logger.warn('syncRecentPosts failed, continuing with insights sync:', e.message);
      }

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

      // 獲取最近一次同步時間
      const [rows] = await pool.execute(
        `SELECT MAX(last_synced_at) as last_synced_at
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
   * DELETE /api/statistics/clear-pending
   * 清除所有待審核的貼文（硬刪除）
   */
  async clearPendingPosts(req: Request, res: Response): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 獲取待刪除的數量
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) as count FROM posts WHERE status IN ('PENDING_REVIEW', 'DRAFT', 'GENERATING', 'ACTION_REQUIRED')`
      );
      const count = (countRows as any)[0]?.count || 0;

      if (count === 0) {
        res.json({
          success: true,
          message: '沒有待審核的貼文需要清除',
          deleted: 0,
        });
        return;
      }

      // 獲取要刪除的貼文 ID
      const [posts] = await pool.execute(
        `SELECT id FROM posts WHERE status IN ('PENDING_REVIEW', 'DRAFT', 'GENERATING', 'ACTION_REQUIRED')`
      );

      // 刪除相關資料
      for (const post of posts as any[]) {
        await pool.execute('DELETE FROM post_insights WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM post_revisions WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM post_performance_log WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM posts WHERE id = ?', [post.id]);
      }

      logger.info(`Cleared ${count} pending posts`);

      res.json({
        success: true,
        message: `已清除 ${count} 篇待審核/草稿貼文`,
        deleted: count,
      });
    } catch (error: any) {
      logger.error('Failed to clear pending posts:', error);
      res.status(500).json({
        success: false,
        error: '清除待審核貼文失敗',
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/statistics/clear-scheduled
   * 清除所有排程中（APPROVED 狀態）的貼文
   */
  async clearScheduledPosts(req: Request, res: Response): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 獲取待刪除的數量
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) as count FROM posts WHERE status = 'APPROVED'`
      );
      const count = (countRows as any)[0]?.count || 0;

      if (count === 0) {
        res.json({
          success: true,
          message: '沒有排程中的貼文需要清除',
          deleted: 0,
        });
        return;
      }

      // 獲取要刪除的貼文 ID
      const [posts] = await pool.execute(
        `SELECT id FROM posts WHERE status = 'APPROVED'`
      );

      // 刪除相關資料
      for (const post of posts as any[]) {
        // 先刪除 daily_auto_schedule 的關聯
        await pool.execute('UPDATE daily_auto_schedule SET post_id = NULL WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM review_requests WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM post_insights WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM post_revisions WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM post_performance_log WHERE post_id = ?', [post.id]);
        await pool.execute('DELETE FROM posts WHERE id = ?', [post.id]);
      }

      logger.info(`Cleared ${count} scheduled posts`);

      res.json({
        success: true,
        message: `已清除 ${count} 篇排程中貼文`,
        deleted: count,
      });
    } catch (error: any) {
      logger.error('Failed to clear scheduled posts:', error);
      res.status(500).json({
        success: false,
        error: '清除排程中貼文失敗',
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

      // 從 Threads API 獲取貼文列表
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
          // 檢查是否已存在（通過 threads_media_id 或 post_url）
          const [existing] = await pool.execute(
            `SELECT id FROM posts WHERE threads_media_id = ? OR post_url LIKE ? LIMIT 1`,
            [post.id, `%${post.id}%`]
          );

          if ((existing as any[]).length > 0) {
            // 已存在，更新 media_type
            const existingPostId = (existing as any)[0].id;
            await pool.execute(
              `UPDATE posts SET media_type = ? WHERE id = ?`,
              [post.media_type || 'TEXT', existingPostId]
            );

            const insights = await threadsService.getPostInsights(post.id, defaultAccount.token);

            if (insights) {
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

          // 建立新貼文記錄
          const { generateUUID } = await import('../utils/uuid');
          const postId = generateUUID();
          const postedAt = new Date(post.timestamp);

          await pool.execute(
            `INSERT INTO posts (id, status, threads_media_id, post_url, posted_at, created_by, media_type, created_at)
             VALUES (?, 'POSTED', ?, ?, ?, ?, ?, NOW())`,
            [postId, post.id, post.permalink, postedAt, adminUserId, post.media_type || 'TEXT']
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
          logger.info(`Imported Threads post: ${post.id} (media_type: ${post.media_type})`);

          // 稍微延遲以避免 API rate limit
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (postError: any) {
          logger.warn(`Failed to import post ${post.id}:`, postError.message);
          skipped++;
        }
      }

      // 同步刪除：檢查資料庫中有但 Threads 上已刪除的貼文（僅在完整匯入時執行）
      let deleted = 0;
      if (fetchAll) {
        try {
          logger.info(`Starting deletion sync check...`);
          logger.info(`Threads API returned ${threadsPosts.length} posts`);

          const [dbPosts] = await pool.execute(
            `SELECT id, threads_media_id, post_url FROM posts WHERE status = 'POSTED'`
          );
          logger.info(`Database has ${(dbPosts as any[]).length} POSTED posts`);

          const threadsMediaIds = new Set(threadsPosts.map((p: any) => String(p.id)));
          const threadsShortcodes = new Set<string>();
          for (const p of threadsPosts) {
            if (p.permalink) {
              const match = p.permalink.match(/\/post\/([^/?]+)/);
              if (match) {
                threadsShortcodes.add(match[1]);
              }
            }
          }

          for (const dbPost of (dbPosts as any[])) {
            let foundOnThreads = false;

            if (dbPost.threads_media_id) {
              foundOnThreads = threadsMediaIds.has(String(dbPost.threads_media_id));
            }

            if (!foundOnThreads && dbPost.post_url) {
              const match = dbPost.post_url.match(/\/post\/([^/?]+)/);
              if (match) {
                foundOnThreads = threadsShortcodes.has(match[1]);
              }
            }

            if (!foundOnThreads) {
              logger.info(`Deleting post not found on Threads: ${dbPost.id}`);
              await pool.execute('DELETE FROM post_insights WHERE post_id = ?', [dbPost.id]);
              await pool.execute('DELETE FROM post_revisions WHERE post_id = ?', [dbPost.id]);
              await pool.execute('DELETE FROM post_performance_log WHERE post_id = ?', [dbPost.id]);
              await pool.execute('DELETE FROM posts WHERE id = ?', [dbPost.id]);
              deleted++;
            }
          }

          logger.info(`Deletion sync completed: ${deleted} posts deleted`);
        } catch (deleteError: any) {
          logger.error('Failed to clean up deleted posts:', deleteError);
        }
      }

      logger.info(`Threads posts sync completed: ${imported} imported, ${updated} updated, ${skipped} skipped, ${deleted} deleted`);

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
   * GET /api/statistics/debug-performance-log
   * 除錯用：查看表現記錄
   */
  async debugPerformanceLog(req: Request, res: Response): Promise<void> {
    try {
      const { getPool } = await import('../database/connection');
      const pool = getPool();

      let logs: any[] = [];

      // 嘗試查詢 post_performance_log（可能不存在）
      try {
        const [logRows] = await pool.execute(
          `SELECT 
             ppl.id,
             ppl.post_id,
             ct.name as template_name,
             ppl.posted_at,
             ppl.views,
             ppl.likes,
             ppl.replies,
             ppl.engagement_rate,
             ppl.selection_reason,
             ppl.created_at
           FROM post_performance_log ppl
           LEFT JOIN content_templates ct ON ppl.template_id = ct.id
           ORDER BY ppl.created_at DESC
           LIMIT 20`
        );
        logs = logRows as any[];
      } catch (logError: any) {
        logger.warn('post_performance_log query failed (table may not exist):', logError.message);
        logs = [];
      }

      // 查詢 content_templates 統計（如果表存在）
      let templates: any[] = [];
      try {
        const [templateRows] = await pool.execute(
          `SELECT id, name, total_uses, avg_engagement_rate, enabled
           FROM content_templates
           ORDER BY total_uses DESC`
        );
        templates = templateRows as any[];
      } catch (templateError: any) {
        logger.warn('content_templates query failed (table may not exist):', templateError.message);
      }

      res.json({
        success: true,
        data: {
          performance_logs: logs,
          template_stats: templates,
          summary: {
            total_logs: logs.length,
            total_templates: (templates as any[]).length,
          }
        },
      });
    } catch (error: any) {
      logger.error('Failed to get debug performance log:', error);
      res.status(500).json({
        success: false,
        error: '查詢失敗',
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
   * GET /api/statistics/posts-by-hour
   * 查詢指定時段（小時）的貼文列表
   */
  async getPostsByHour(req: Request, res: Response): Promise<void> {
    try {
      const hour = parseInt(req.query.hour as string);

      if (isNaN(hour) || hour < 0 || hour > 23) {
        res.status(400).json({
          success: false,
          error: '無效的時段參數（0-23）',
        });
        return;
      }

      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // 查詢指定時段的貼文（使用台灣時區 UTC+8）
      const [rows] = await pool.execute(
        `SELECT 
          p.id,
          p.post_url,
          p.posted_at,
          pr.content as content_preview,
          pi.views,
          pi.likes,
          pi.replies,
          CASE WHEN pi.views > 0 
               THEN ((pi.likes + pi.replies + COALESCE(pi.reposts, 0)) / pi.views * 100) 
               ELSE 0 END as engagement_rate
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        LEFT JOIN post_revisions pr ON p.id = pr.post_id
        WHERE p.status = 'POSTED' 
          AND p.posted_at IS NOT NULL
          AND HOUR(CONVERT_TZ(p.posted_at, '+00:00', '+08:00')) = ?
        ORDER BY p.posted_at DESC
        LIMIT 20`,
        [hour]
      );

      res.json({
        success: true,
        data: {
          hour,
          posts: rows,
          total: (rows as any[]).length,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get posts by hour:', error);
      res.status(500).json({
        success: false,
        error: '查詢失敗',
        message: error.message,
      });
    }
  }

}

export default new StatisticsController();
