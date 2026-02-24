/**
 * Statistics Routes
 * 統計相關的 API 路由
 */

import { Router } from 'express';
import statisticsController from '../controllers/statistics.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// 所有統計路由都需要驗證
router.use(authenticate);

// GET /api/statistics/overview - 統計總覽
router.get('/overview', statisticsController.getOverview.bind(statisticsController));

// GET /api/statistics/timeslots - 時段統計
router.get('/timeslots', statisticsController.getTimeslots.bind(statisticsController));

// GET /api/statistics/analytics - 數據分析（時段、星期、Top 貼文、內容長度）
router.get('/analytics', statisticsController.getAnalytics.bind(statisticsController));

// GET /api/statistics/heatmap - 熱力圖數據
router.get('/heatmap', statisticsController.getHeatmap.bind(statisticsController));

// GET /api/statistics/posts - 貼文明細列表
router.get('/posts', statisticsController.getPosts.bind(statisticsController));

// POST /api/statistics/sync - 手動觸發同步
router.post('/sync', statisticsController.syncInsights.bind(statisticsController));

// GET /api/statistics/sync-status - 同步狀態
router.get('/sync-status', statisticsController.getSyncStatus.bind(statisticsController));

// POST /api/statistics/sync-threads-posts - 從 Threads 同步歷史貼文
router.post('/sync-threads-posts', statisticsController.syncThreadsPosts.bind(statisticsController));

// GET /api/statistics/best-time-post - 查詢最佳時段的貼文
router.get('/best-time-post', statisticsController.getBestTimePost.bind(statisticsController));

// DELETE /api/statistics/clear-pending - 清除所有待審核的貼文
router.delete('/clear-pending', statisticsController.clearPendingPosts.bind(statisticsController));

// DELETE /api/statistics/clear-scheduled - 清除所有排程中的貼文
router.delete('/clear-scheduled', statisticsController.clearScheduledPosts.bind(statisticsController));

// GET /api/statistics/posts-by-hour - 查詢指定時段的貼文
router.get('/posts-by-hour', statisticsController.getPostsByHour.bind(statisticsController));

// GET /api/statistics/debug-performance-log - 除錯：查看表現記錄
router.get('/debug-performance-log', statisticsController.debugPerformanceLog.bind(statisticsController));

export default router;
