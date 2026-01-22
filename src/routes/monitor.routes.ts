/**
 * 聲量監控 API 路由
 */

import { Router } from 'express';
import monitorController from '../controllers/monitor.controller';

const router = Router();

// ========================================
// 品牌管理
// ========================================
router.get('/brands', monitorController.getBrands.bind(monitorController));
router.post('/brands', monitorController.createBrand.bind(monitorController));
router.put('/brands/:id', monitorController.updateBrand.bind(monitorController));
router.delete('/brands/:id', monitorController.deleteBrand.bind(monitorController));

// ========================================
// 來源管理
// ========================================
router.get('/sources', monitorController.getSources.bind(monitorController));
router.post('/sources', monitorController.createSource.bind(monitorController));
router.put('/sources/:id', monitorController.updateSource.bind(monitorController));
router.delete('/sources/:id', monitorController.deleteSource.bind(monitorController));

// ========================================
// 提及記錄
// ========================================
router.get('/mentions', monitorController.getMentions.bind(monitorController));
router.put('/mentions/:id/read', monitorController.markMentionRead.bind(monitorController));
router.put('/mentions/:id/star', monitorController.toggleMentionStar.bind(monitorController));

// ========================================
// 統計
// ========================================
router.get('/stats/overview', monitorController.getStatsOverview.bind(monitorController));

// ========================================
// 爬取操作
// ========================================
router.post('/crawl', monitorController.triggerCrawl.bind(monitorController));
router.get('/crawl-logs', monitorController.getCrawlLogs.bind(monitorController));

// ========================================
// 分類操作
// ========================================
router.post('/reclassify', monitorController.reclassifyMentions.bind(monitorController));

// ========================================
// 模板
// ========================================
router.get('/templates', monitorController.getSourceTemplates.bind(monitorController));

// ========================================
// Google Trends
// ========================================
router.get('/trends/compare', monitorController.compareTrends.bind(monitorController));
router.get('/trends/daily', monitorController.getDailyTrends.bind(monitorController));
router.get('/trends/related/:keyword', monitorController.getRelatedQueries.bind(monitorController));
router.get('/trends/:brandId', monitorController.getBrandTrends.bind(monitorController));
router.post('/trends/fetch', monitorController.fetchTrends.bind(monitorController));

// ========================================
// 分類設定
// ========================================
router.get('/classifier-config', monitorController.getClassifierConfig.bind(monitorController));
router.put('/classifier-config', monitorController.updateClassifierConfig.bind(monitorController));
router.post('/classifier-rules', monitorController.addClassifierRule.bind(monitorController));
router.put('/classifier-rules/:topic/:ruleId', monitorController.updateClassifierRule.bind(monitorController));
router.delete('/classifier-rules/:topic/:ruleId', monitorController.deleteClassifierRule.bind(monitorController));

export default router;
