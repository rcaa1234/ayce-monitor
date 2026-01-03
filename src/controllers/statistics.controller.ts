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
   * 手動觸發 Insights 同步
   */
  async syncInsights(req: Request, res: Response): Promise<void> {
    try {
      const { days, limit } = req.body;

      // 在背景執行同步（不阻塞 API 回應）
      threadsInsightsService
        .syncRecentPostsInsights(days || 7, limit || 50)
        .then(() => {
          logger.info('Manual insights sync completed');
        })
        .catch((error) => {
          logger.error('Manual insights sync failed:', error);
        });

      res.json({
        success: true,
        message: '已開始同步 Insights 數據，請稍後查看結果',
      });
    } catch (error: any) {
      logger.error('Failed to trigger insights sync:', error);
      res.status(500).json({
        success: false,
        error: '觸發同步失敗',
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

      res.json({
        success: true,
        data: {
          last_synced_at: lastSyncedAt,
          pending_count: pendingCount,
          is_syncing: false, // 目前沒有追蹤同步狀態，可以後續改進
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
}

export default new StatisticsController();
