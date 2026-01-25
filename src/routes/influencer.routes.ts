/**
 * 網黃偵測 API 路由
 */

import { Router } from 'express';
import influencerController from '../controllers/influencer.controller';

const router = Router();

// ========================================
// 偵測設定
// ========================================
router.get('/config', influencerController.getConfig.bind(influencerController));
router.put('/config', influencerController.updateConfig.bind(influencerController));

// ========================================
// 作者管理
// ========================================
router.get('/authors', influencerController.getAuthors.bind(influencerController));
router.put('/authors/:id/status', influencerController.updateAuthorStatus.bind(influencerController));

// ========================================
// 來源貼文
// ========================================
router.get('/source-posts', influencerController.getSourcePosts.bind(influencerController));

// ========================================
// 聯繫記錄
// ========================================
router.get('/contacts', influencerController.getContacts.bind(influencerController));
router.post('/contacts', influencerController.addContact.bind(influencerController));
router.put('/contacts/:id/response', influencerController.updateContactResponse.bind(influencerController));

// ========================================
// 掃描操作
// ========================================
router.post('/scan', influencerController.triggerScan.bind(influencerController));

// ========================================
// 統計
// ========================================
router.get('/stats', influencerController.getStats.bind(influencerController));

export default router;
