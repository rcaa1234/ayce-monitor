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

// GET /api/statistics/templates - 樣板統計
router.get('/templates', statisticsController.getTemplates.bind(statisticsController));

// GET /api/statistics/timeslots - 時段統計
router.get('/timeslots', statisticsController.getTimeslots.bind(statisticsController));

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

export default router;
