/**
 * 網黃偵測 API 控制器
 */

import { Request, Response } from 'express';
import influencerService from '../services/influencer.service';
import logger from '../utils/logger';

class InfluencerController {
    /**
     * 取得偵測設定
     */
    async getConfig(req: Request, res: Response) {
        try {
            const config = await influencerService.getConfig();
            res.json({ success: true, data: config });
        } catch (error) {
            logger.error('取得偵測設定失敗:', error);
            res.status(500).json({ success: false, error: '取得設定失敗' });
        }
    }

    /**
     * 更新偵測設定
     */
    async updateConfig(req: Request, res: Response) {
        try {
            const { autoScanEnabled, scanIntervalHours, targetForums, minPostsToScan, notifyOnNewDetection } = req.body;

            await influencerService.updateConfig({
                auto_scan_enabled: autoScanEnabled,
                scan_interval_hours: scanIntervalHours,
                target_forums: targetForums,
                min_posts_to_scan: minPostsToScan,
                notify_on_new_detection: notifyOnNewDetection,
            });

            res.json({ success: true, message: '設定已更新' });
        } catch (error) {
            logger.error('更新偵測設定失敗:', error);
            res.status(500).json({ success: false, error: '更新設定失敗' });
        }
    }

    /**
     * 取得作者列表
     */
    async getAuthors(req: Request, res: Response) {
        try {
            const { status, platform, limit = '20', offset = '0' } = req.query;

            const result = await influencerService.getAuthors({
                status: status as string,
                platform: platform as string,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
            });

            res.json({
                success: true,
                data: result.authors,
                total: result.total,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
            });
        } catch (error) {
            logger.error('取得作者列表失敗:', error);
            res.status(500).json({ success: false, error: '取得作者列表失敗' });
        }
    }

    /**
     * 更新作者狀態
     */
    async updateAuthorStatus(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status, notes } = req.body;

            if (!['new', 'contacted', 'cooperating', 'rejected', 'blacklist', 'no_social'].includes(status)) {
                res.status(400).json({ success: false, error: '無效的狀態' });
                return;
            }

            await influencerService.updateAuthorStatus(id, status, notes);
            res.json({ success: true, message: '狀態已更新' });
        } catch (error) {
            logger.error('更新作者狀態失敗:', error);
            res.status(500).json({ success: false, error: '更新狀態失敗' });
        }
    }

    /**
     * 取得來源貼文
     */
    async getSourcePosts(req: Request, res: Response) {
        try {
            const { authorId, limit = '20', offset = '0' } = req.query;

            const result = await influencerService.getSourcePosts({
                authorId: authorId as string,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
            });

            res.json({
                success: true,
                data: result.posts,
                total: result.total,
            });
        } catch (error) {
            logger.error('取得來源貼文失敗:', error);
            res.status(500).json({ success: false, error: '取得來源貼文失敗' });
        }
    }

    /**
     * 新增聯繫記錄
     */
    async addContact(req: Request, res: Response) {
        try {
            const { authorId, contactType, contactDate, contactMethod, notes } = req.body;

            if (!authorId || !contactType || !contactDate) {
                res.status(400).json({ success: false, error: '缺少必要欄位' });
                return;
            }

            const id = await influencerService.addContact({
                authorId,
                contactType,
                contactDate: new Date(contactDate),
                contactMethod,
                notes,
            });

            res.json({ success: true, data: { id } });
        } catch (error) {
            logger.error('新增聯繫記錄失敗:', error);
            res.status(500).json({ success: false, error: '新增聯繫記錄失敗' });
        }
    }

    /**
     * 取得聯繫記錄
     */
    async getContacts(req: Request, res: Response) {
        try {
            const { authorId } = req.query;

            const contacts = await influencerService.getContacts(authorId as string);
            res.json({ success: true, data: contacts });
        } catch (error) {
            logger.error('取得聯繫記錄失敗:', error);
            res.status(500).json({ success: false, error: '取得聯繫記錄失敗' });
        }
    }

    /**
     * 更新聯繫回應狀態
     */
    async updateContactResponse(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { responseStatus } = req.body;

            if (!['pending', 'replied', 'no_reply', 'interested', 'not_interested'].includes(responseStatus)) {
                res.status(400).json({ success: false, error: '無效的回應狀態' });
                return;
            }

            await influencerService.updateContactResponse(id, responseStatus);
            res.json({ success: true, message: '回應狀態已更新' });
        } catch (error) {
            logger.error('更新回應狀態失敗:', error);
            res.status(500).json({ success: false, error: '更新回應狀態失敗' });
        }
    }

    /**
     * 手動觸發掃描
     */
    async triggerScan(req: Request, res: Response) {
        try {
            const { forum = 'sex' } = req.body;

            // 非同步執行掃描
            const result = await influencerService.scanDcardForum(forum);

            res.json({
                success: true,
                data: result,
                message: `掃描完成: 共掃描 ${result.scanned} 篇, 新作者 ${result.newAuthors} 位, 有社群連結 ${result.withSocialLinks} 位`,
            });
        } catch (error) {
            logger.error('觸發掃描失敗:', error);
            res.status(500).json({ success: false, error: '掃描失敗' });
        }
    }

    /**
     * 取得統計數據
     */
    async getStats(req: Request, res: Response) {
        try {
            const stats = await influencerService.getStats();
            res.json({ success: true, data: stats });
        } catch (error) {
            logger.error('取得統計失敗:', error);
            res.status(500).json({ success: false, error: '取得統計失敗' });
        }
    }
}

export default new InfluencerController();
