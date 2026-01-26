/**
 * 網黃偵測 API 控制器
 */

import { Request, Response } from 'express';
import influencerService from '../services/influencer.service';
import pttbrainScraperService from '../services/pttbrain-scraper.service';
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
            const { enabled, checkIntervalMinutes, targetForums, maxPostsPerCheck, notifyOnNew } = req.body;

            await influencerService.updateConfig({
                enabled,
                check_interval_minutes: checkIntervalMinutes,
                target_forums: targetForums,
                max_posts_per_check: maxPostsPerCheck,
                notify_on_new: notifyOnNew,
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
            const { status, twitterVerified, hasContact, limit = '20', offset = '0' } = req.query;

            const result = await influencerService.getAuthors({
                status: status as string,
                twitterVerified: twitterVerified === 'true' ? true : twitterVerified === 'false' ? false : undefined,
                hasContact: hasContact === 'true' ? true : hasContact === 'false' ? false : undefined,
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
     * 取得單一作者詳情
     */
    async getAuthorById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const author = await influencerService.getAuthorById(id);

            if (!author) {
                res.status(404).json({ success: false, error: '作者不存在' });
                return;
            }

            res.json({ success: true, data: author });
        } catch (error) {
            logger.error('取得作者詳情失敗:', error);
            res.status(500).json({ success: false, error: '取得作者詳情失敗' });
        }
    }

    /**
     * 更新作者狀態
     */
    async updateAuthorStatus(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status, notes } = req.body;

            const validStatuses = ['new', 'pending', 'contacted', 'negotiating', 'cooperating', 'rejected', 'blacklisted'];
            if (!validStatuses.includes(status)) {
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
     * 驗證作者的 Twitter ID
     */
    async verifyAuthorTwitter(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const result = await influencerService.verifyAuthorTwitter(id);

            res.json({
                success: true,
                data: result,
                message: result.exists ? 'Twitter 帳號存在' : 'Twitter 帳號不存在或無法連線',
            });
        } catch (error: any) {
            logger.error('驗證 Twitter 失敗:', error);
            res.status(500).json({ success: false, error: error.message || '驗證失敗' });
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
            const { authorId, contactDate, contactMethod, subject, message, notes } = req.body;

            if (!authorId || !contactDate || !contactMethod) {
                res.status(400).json({ success: false, error: '缺少必要欄位 (authorId, contactDate, contactMethod)' });
                return;
            }

            const id = await influencerService.addContact({
                authorId,
                contactDate: new Date(contactDate),
                contactMethod,
                subject,
                message,
                notes,
            });

            res.json({ success: true, data: { id }, message: '聯繫記錄已新增' });
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
            const { authorId, limit = '20', offset = '0' } = req.query;

            const result = await influencerService.getContacts({
                authorId: authorId as string,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
            });

            res.json({
                success: true,
                data: result.contacts,
                total: result.total,
            });
        } catch (error) {
            logger.error('取得聯繫記錄失敗:', error);
            res.status(500).json({ success: false, error: '取得聯繫記錄失敗' });
        }
    }

    /**
     * 更新聯繫記錄結果
     */
    async updateContactResult(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { result, responseContent } = req.body;

            const validResults = ['pending', 'no_response', 'responded', 'interested', 'negotiating', 'agreed', 'rejected'];
            if (!validResults.includes(result)) {
                res.status(400).json({ success: false, error: '無效的結果狀態' });
                return;
            }

            await influencerService.updateContactResult(id, result, responseContent);
            res.json({ success: true, message: '聯繫結果已更新' });
        } catch (error) {
            logger.error('更新聯繫結果失敗:', error);
            res.status(500).json({ success: false, error: '更新聯繫結果失敗' });
        }
    }

    /**
     * 手動觸發掃描
     */
    async triggerScan(req: Request, res: Response) {
        try {
            const { forum = 'sex' } = req.body;

            const result = await influencerService.scanDcardForum(forum);

            res.json({
                success: true,
                data: result,
                message: `掃描完成: 共掃描 ${result.scanned} 篇, 新作者 ${result.newAuthors} 位, 有 Twitter ${result.withTwitter} 位`,
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

    /**
     * 測試爬蟲服務連接 (ScrapingBee/ZenRows)
     */
    async testCrawler(req: Request, res: Response) {
        try {
            const result = await influencerService.testCrawlerConnection();
            res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error('測試爬蟲失敗:', error);
            res.status(500).json({ success: false, error: error.message || '測試失敗' });
        }
    }

    /**
     * 測試 PTT Brain + Browserless 爬蟲
     */
    async testPttBrain(req: Request, res: Response) {
        try {
            const result = await pttbrainScraperService.testConnection();
            res.json({ success: true, data: result });
        } catch (error: any) {
            logger.error('測試 PTT Brain 失敗:', error);
            res.status(500).json({ success: false, error: error.message || '測試失敗' });
        }
    }

    /**
     * 使用 PTT Brain 掃描 (Browserless)
     */
    async scanWithPttBrain(req: Request, res: Response) {
        try {
            const { maxPages = 2 } = req.body;

            // 取得文章列表
            const posts = await pttbrainScraperService.fetchDcardSexPosts(maxPages);

            res.json({
                success: true,
                data: {
                    postsFound: posts.length,
                    posts: posts.slice(0, 10).map(p => ({
                        postId: p.postId,
                        title: p.title.substring(0, 50),
                        url: p.url,
                    })),
                },
                message: `從 PTT Brain 取得 ${posts.length} 篇文章`,
            });
        } catch (error: any) {
            logger.error('PTT Brain 掃描失敗:', error);
            res.status(500).json({ success: false, error: error.message || '掃描失敗' });
        }
    }
}

export default new InfluencerController();
