/**
 * Scraper API 路由
 * 供本機爬蟲使用的 API 端點
 */

import { Router } from 'express';
import { scraperAuth } from '../middlewares/scraper-auth.middleware';
import scraperApiController from '../controllers/scraper-api.controller';

const router = Router();

// === 公開路由（不需要 API Key）===
// 取得本機爬蟲狀態（供前台查詢）
router.get('/status', scraperApiController.getStatus.bind(scraperApiController));

// === 以下路由需要 API Key 驗證 ===
router.use(scraperAuth);

// 健康檢查
router.get('/health', scraperApiController.health.bind(scraperApiController));

// 取得爬取設定（舊版爬蟲相容）
router.get('/config', scraperApiController.getConfig.bind(scraperApiController));

// 取得待執行任務（新版爬蟲使用）
router.get('/tasks', scraperApiController.getTasks.bind(scraperApiController));

// 回報任務完成
router.post('/tasks/complete', scraperApiController.completeTask.bind(scraperApiController));

// 心跳回報
router.post('/heartbeat', scraperApiController.heartbeat.bind(scraperApiController));

export default router;
