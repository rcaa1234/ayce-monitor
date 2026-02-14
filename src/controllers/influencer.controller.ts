/**
 * 網黃偵測 API 控制器
 */

import { Request, Response } from 'express';
import influencerService from '../services/influencer.service';
import logger from '../utils/logger';
import * as XLSX from 'xlsx';

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
            const { status, twitterVerified, hasContact, limit = '20', offset = '0', sortBy, sortOrder } = req.query;

            const result = await influencerService.getAuthors({
                status: status as string,
                twitterVerified: twitterVerified === 'true' ? true : twitterVerified === 'false' ? false : undefined,
                hasContact: hasContact === 'true' ? true : hasContact === 'false' ? false : undefined,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
                sortBy: sortBy as string,
                sortOrder: sortOrder as string,
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
     * 匯出作者列表為 Excel
     */
    async exportAuthorsExcel(req: Request, res: Response) {
        try {
            const { status, twitterVerified, hasContact, sortBy, sortOrder } = req.query;

            const result = await influencerService.getAuthors({
                status: status as string,
                twitterVerified: twitterVerified === 'true' ? true : twitterVerified === 'false' ? false : undefined,
                hasContact: hasContact === 'true' ? true : hasContact === 'false' ? false : undefined,
                limit: 10000,
                offset: 0,
                sortBy: sortBy as string,
                sortOrder: sortOrder as string,
            });

            const statusMap: Record<string, string> = {
                new: '新發現', contacted: '已聯繫', cooperating: '合作中',
                rejected: '已拒絕', blacklisted: '黑名單', pending: '待處理', negotiating: '洽談中',
            };

            const rows = result.authors.map((a: any) => ({
                'Dcard 帳號': a.dcard_username || '',
                'Dcard ID': a.dcard_id || '',
                'Twitter ID': a.twitter_id || '',
                'Twitter 顯示名稱': a.twitter_display_name || '',
                'Twitter 已驗證': a.twitter_verified ? '是' : '否',
                '狀態': statusMap[a.status] || a.status || '',
                '發現時間': a.first_detected_at ? new Date(a.first_detected_at).toLocaleString('zh-TW') : '',
                'Dcard 最後發文': a.last_dcard_post_at ? new Date(a.last_dcard_post_at).toLocaleString('zh-TW') : '',
                'Twitter 最後發文': a.last_twitter_post_at ? new Date(a.last_twitter_post_at).toLocaleString('zh-TW') : '',
                '聯繫次數': a.contact_count || 0,
                '最後聯繫日期': a.last_contact_date ? new Date(a.last_contact_date).toLocaleString('zh-TW') : '',
                '備註': a.notes || '',
            }));

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '作者名單');

            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=influencer_authors_${new Date().toISOString().slice(0, 10)}.xlsx`);
            res.send(buffer);
        } catch (error) {
            logger.error('匯出作者 Excel 失敗:', error);
            res.status(500).json({ success: false, error: '匯出失敗' });
        }
    }

    // ==========================================
    // 作者管理
    // ==========================================

    /**
     * 更新作者資料
     */
    async updateAuthor(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { dcard_username, twitter_id, twitter_display_name, notes, priority } = req.body;

            await influencerService.updateAuthor(id, {
                dcard_username,
                twitter_id,
                twitter_display_name,
                notes,
                priority,
            });

            res.json({ success: true, message: '作者資料已更新' });
        } catch (error) {
            logger.error('更新作者資料失敗:', error);
            res.status(500).json({ success: false, error: '更新作者資料失敗' });
        }
    }

    /**
     * 刪除作者
     */
    async deleteAuthor(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await influencerService.deleteAuthor(id);
            res.json({ success: true, message: '作者已刪除' });
        } catch (error) {
            logger.error('刪除作者失敗:', error);
            res.status(500).json({ success: false, error: '刪除作者失敗' });
        }
    }

    /**
     * 刪除所有沒有 Twitter 的作者
     */
    async deleteAuthorsWithoutTwitter(req: Request, res: Response) {
        try {
            const count = await influencerService.deleteAuthorsWithoutTwitter();
            res.json({ success: true, message: `已刪除 ${count} 位沒有 Twitter 的作者`, count });
        } catch (error) {
            logger.error('批量刪除作者失敗:', error);
            res.status(500).json({ success: false, error: '批量刪除失敗' });
        }
    }

    // ==========================================
    // 合作記錄管理
    // ==========================================

    /**
     * 取得作者的合作記錄
     */
    async getCooperations(req: Request, res: Response) {
        try {
            const { authorId } = req.params;
            const cooperations = await influencerService.getCooperations(authorId);
            res.json({ success: true, data: cooperations });
        } catch (error) {
            logger.error('取得合作記錄失敗:', error);
            res.status(500).json({ success: false, error: '取得合作記錄失敗' });
        }
    }

    /**
     * 新增合作記錄
     */
    async addCooperation(req: Request, res: Response) {
        try {
            const { authorId } = req.params;
            const { first_contact_at, cooperated, post_url, payment_amount, post_date, notes } = req.body;

            if (!first_contact_at) {
                res.status(400).json({ success: false, error: '首次聯絡時間為必填' });
                return;
            }

            const id = await influencerService.addCooperation({
                author_id: authorId,
                first_contact_at: new Date(first_contact_at),
                cooperated: cooperated || false,
                post_url,
                payment_amount,
                post_date: post_date ? new Date(post_date) : undefined,
                notes,
            });

            res.json({ success: true, data: { id }, message: '合作記錄已新增' });
        } catch (error) {
            logger.error('新增合作記錄失敗:', error);
            res.status(500).json({ success: false, error: '新增合作記錄失敗' });
        }
    }

    /**
     * 更新合作記錄
     */
    async updateCooperation(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { first_contact_at, cooperated, post_url, payment_amount, post_date, notes } = req.body;

            await influencerService.updateCooperation(id, {
                first_contact_at: first_contact_at ? new Date(first_contact_at) : undefined,
                cooperated,
                post_url,
                payment_amount,
                post_date: post_date ? new Date(post_date) : undefined,
                notes,
            });

            res.json({ success: true, message: '合作記錄已更新' });
        } catch (error) {
            logger.error('更新合作記錄失敗:', error);
            res.status(500).json({ success: false, error: '更新合作記錄失敗' });
        }
    }

    /**
     * 刪除合作記錄
     */
    async deleteCooperation(req: Request, res: Response) {
        try {
            const { id } = req.params;
            await influencerService.deleteCooperation(id);
            res.json({ success: true, message: '合作記錄已刪除' });
        } catch (error) {
            logger.error('刪除合作記錄失敗:', error);
            res.status(500).json({ success: false, error: '刪除合作記錄失敗' });
        }
    }
}

export default new InfluencerController();
