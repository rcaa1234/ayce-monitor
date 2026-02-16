/**
 * Agent API 路由
 * 供外部 AI Agent（靈犀）使用的 API 端點
 */

import { Router } from 'express';
import { agentAuth } from '../middlewares/agent-auth.middleware';
import * as agentController from '../controllers/agent.controller';

const router = Router();

// 所有路由都需要 API Key 驗證
router.use(agentAuth);

// 查歷史貼文（含互動數據）
router.get('/posts/history', agentController.getPostHistory);

// 高表現貼文
router.get('/posts/top-performing', agentController.getTopPerforming);

// 排程新貼文（支援 dry_run）
router.post('/posts/schedule', agentController.schedulePost);

// 查可用時段
router.get('/schedule/available-slots', agentController.getAvailableSlots);

// 查發布狀態
router.get('/posts/:id/status', agentController.getPostStatus);

// 修改排程內容/時間
router.patch('/posts/:id', agentController.updateScheduledPost);

// 取消排程
router.delete('/posts/:id/schedule', agentController.cancelSchedule);

// 監控關鍵字查詢
router.get('/monitor/keywords', agentController.getMonitorKeywords);

// 診斷：檢查 DB 欄位
router.get('/debug/db-schema', agentController.debugDbSchema);

// Dcard 資料上傳（網紅 & 提及文章）
router.post('/dcard/mentions', agentController.receiveMentions);
router.post('/dcard/authors', agentController.receiveAuthors);

export default router;
