/**
 * Scraper API 路由
 * 供本機爬蟲使用的 API 端點
 */

import { Router } from 'express';
import { scraperAuth } from '../middlewares/scraper-auth.middleware';
import scraperApiController from '../controllers/scraper-api.controller';

const router = Router();

// 所有路由都需要 API Key 驗證
router.use(scraperAuth);

// 健康檢查
router.get('/health', scraperApiController.health.bind(scraperApiController));

// 取得爬取設定
router.get('/config', scraperApiController.getConfig.bind(scraperApiController));

// 接收爬取結果
router.post('/results/mentions', scraperApiController.receiveMentions.bind(scraperApiController));
router.post('/results/authors', scraperApiController.receiveAuthors.bind(scraperApiController));

// 心跳回報
router.post('/heartbeat', scraperApiController.heartbeat.bind(scraperApiController));

export default router;
