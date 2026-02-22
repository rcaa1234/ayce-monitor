/**
 * 聲量監控 API 路由
 */

import { Router } from 'express';
import monitorController from '../controllers/monitor.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// All monitor routes require authentication
router.use(authenticate);

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
router.post('/sources/delete-by-platform', monitorController.deleteSourcesByPlatform.bind(monitorController));

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
router.post('/classify-pending', monitorController.classifyPending.bind(monitorController));

// ========================================
// 模板
// ========================================
router.get('/templates', monitorController.getSourceTemplates.bind(monitorController));

// ========================================
// 分類設定
// ========================================
router.get('/classifier-config', monitorController.getClassifierConfig.bind(monitorController));
router.put('/classifier-config', monitorController.updateClassifierConfig.bind(monitorController));
router.post('/classifier-rules', monitorController.addClassifierRule.bind(monitorController));
router.put('/classifier-rules/:topic/:ruleId', monitorController.updateClassifierRule.bind(monitorController));
router.delete('/classifier-rules/:topic/:ruleId', monitorController.deleteClassifierRule.bind(monitorController));

// ========================================
// 關聯修復
// ========================================
router.post('/relink-all', monitorController.relinkAllBrandsSources.bind(monitorController));

// ========================================
// 週報
// ========================================
router.get('/weekly-report', monitorController.getWeeklyReport.bind(monitorController));
router.post('/weekly-report/send', monitorController.sendWeeklyReport.bind(monitorController));

// ========================================
// 危機預警
// ========================================
router.get('/crisis/config', monitorController.getCrisisConfigs.bind(monitorController));
router.get('/crisis/config/:brandId', monitorController.getCrisisConfig.bind(monitorController));
router.put('/crisis/config/:brandId', monitorController.updateCrisisConfig.bind(monitorController));
router.get('/crisis/logs', monitorController.getCrisisLogs.bind(monitorController));
router.put('/crisis/logs/:id/resolve', monitorController.resolveCrisisAlert.bind(monitorController));
router.post('/crisis/check', monitorController.triggerCrisisCheck.bind(monitorController));

// ========================================
// 內容推薦
// ========================================
router.get('/recommendations/profile', monitorController.getBrandProfile.bind(monitorController));
router.put('/recommendations/profile', monitorController.updateBrandProfile.bind(monitorController));
router.get('/recommendations/topics', monitorController.getTopics.bind(monitorController));
router.get('/recommendations/suggestions', monitorController.getSuggestions.bind(monitorController));
router.post('/recommendations/suggestions/:id/adopt', monitorController.adoptSuggestion.bind(monitorController));
router.post('/recommendations/suggestions/:id/reject', monitorController.rejectSuggestion.bind(monitorController));
router.post('/recommendations/generate', monitorController.triggerRecommendationGeneration.bind(monitorController));

export default router;
