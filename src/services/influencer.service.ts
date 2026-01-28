/**
 * 網黃偵測服務
 * 負責爬取 Dcard 西斯版，檢測作者個人頁面的 Twitter/X 連結
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';


// Twitter 偵測模式（只偵測 Twitter/X）
const TWITTER_PATTERNS = {
    // 完整連結
    urls: [
        /https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/|\?|$)/i,
        /(twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/|\?|$)/i,
    ],
    // @ 開頭的 ID
    atMention: /@([a-zA-Z0-9_]{1,15})\b/,
    // 純 ID 格式（需要關鍵字提示）
    plainId: /\b(?:twitter|tw|X|推特|小藍鳥)[：:\s]*@?([a-zA-Z0-9_]{4,15})\b/i,
};

interface InfluencerAuthor {
    id: string;
    dcard_id: string;
    dcard_username: string | null;
    dcard_url: string | null;
    dcard_bio: string | null;
    twitter_id: string | null;
    twitter_url: string | null;
    twitter_verified: boolean;
    twitter_verified_at: Date | null;
    status: string;
    priority: string;
    notes: string | null;
    first_detected_at: Date;
    last_seen_at: Date | null;
    // 關聯資料
    contact_count?: number;
    last_contact_date?: Date | null;
}

interface InfluencerSourcePost {
    id: string;
    author_id: string;
    post_id: string;
    post_url: string;
    post_title: string | null;
    post_excerpt: string | null;
    likes_count: number;
    comments_count: number;
    detected_at: Date;
    // 關聯資料
    author_name?: string;
    twitter_id?: string;
}

interface InfluencerContact {
    id: string;
    author_id: string;
    contact_date: Date;
    contact_method: string;
    subject: string | null;
    message: string | null;
    result: string;
    response_content: string | null;
    response_date: Date | null;
    notes: string | null;
    // 關聯資料
    author_name?: string;
    twitter_id?: string;
}

interface DetectionConfig {
    enabled: boolean;
    check_interval_minutes: number;
    target_forums: string[];
    max_posts_per_check: number;
    notify_on_new: boolean;
}

class InfluencerService {
    /**
     * 取得偵測設定
     */
    async getConfig(): Promise<DetectionConfig> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT * FROM influencer_detection_config LIMIT 1`
        );

        if (rows.length === 0) {
            return {
                enabled: false,
                check_interval_minutes: 30,
                target_forums: ['sex'],
                max_posts_per_check: 20,
                notify_on_new: true,
            };
        }

        const row = rows[0];
        // MySQL JSON 欄位已經被 mysql2 自動解析，不需要 JSON.parse
        let targetForums = row.target_forums;
        if (typeof targetForums === 'string') {
            try {
                targetForums = JSON.parse(targetForums);
            } catch {
                targetForums = ['sex'];
            }
        }
        return {
            enabled: row.enabled === 1,
            check_interval_minutes: row.check_interval_minutes || 30,
            target_forums: targetForums || ['sex'],
            max_posts_per_check: row.max_posts_per_check || 20,
            notify_on_new: row.notify_on_new === 1,
        };
    }

    /**
     * 更新偵測設定
     */
    async updateConfig(config: Partial<DetectionConfig>): Promise<void> {
        const pool = getPool();

        const updates: string[] = [];
        const values: any[] = [];

        if (config.enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(config.enabled ? 1 : 0);
        }
        if (config.check_interval_minutes !== undefined) {
            updates.push('check_interval_minutes = ?');
            values.push(config.check_interval_minutes);
        }
        if (config.target_forums !== undefined) {
            updates.push('target_forums = ?');
            values.push(JSON.stringify(config.target_forums));
        }
        if (config.max_posts_per_check !== undefined) {
            updates.push('max_posts_per_check = ?');
            values.push(config.max_posts_per_check);
        }
        if (config.notify_on_new !== undefined) {
            updates.push('notify_on_new = ?');
            values.push(config.notify_on_new ? 1 : 0);
        }

        if (updates.length > 0) {
            await pool.execute(
                `UPDATE influencer_detection_config SET ${updates.join(', ')}, updated_at = NOW()`,
                values
            );
        }
    }

    /**
     * 取得作者列表（包含聯繫狀態）
     */
    async getAuthors(options: {
        status?: string;
        twitterVerified?: boolean;
        hasContact?: boolean;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ authors: InfluencerAuthor[]; total: number }> {
        const pool = getPool();
        const { status, twitterVerified, hasContact, limit = 20, offset = 0 } = options;

        // Ensure limit and offset are valid integers for mysql2 prepared statements
        const limitInt = Math.max(1, Math.min(100, Number(limit) || 20));
        const offsetInt = Math.max(0, Number(offset) || 0);

        let whereClause = 'a.twitter_id IS NOT NULL'; // 只顯示有 Twitter 的
        const values: any[] = [];

        if (status) {
            whereClause += ' AND a.status = ?';
            values.push(status);
        }

        if (twitterVerified !== undefined) {
            whereClause += twitterVerified
                ? ' AND a.twitter_verified = TRUE'
                : ' AND (a.twitter_verified = FALSE OR a.twitter_verified IS NULL)';
        }

        if (hasContact !== undefined) {
            whereClause += hasContact
                ? ' AND EXISTS (SELECT 1 FROM influencer_contacts c WHERE c.author_id = a.id)'
                : ' AND NOT EXISTS (SELECT 1 FROM influencer_contacts c WHERE c.author_id = a.id)';
        }

        // 取得總數 - use query instead of execute for more reliable parameter handling
        const [countRows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_authors a WHERE ${whereClause}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_authors a WHERE ${whereClause}`
            );
        const total = Number(countRows[0].total) || 0;

        // 取得資料，包含聯繫統計
        const [rows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT a.*,
                        (SELECT COUNT(*) FROM influencer_contacts c WHERE c.author_id = a.id) as contact_count,
                        (SELECT MAX(contact_date) FROM influencer_contacts c WHERE c.author_id = a.id) as last_contact_date
                 FROM influencer_authors a
                 WHERE ${whereClause}
                 ORDER BY a.first_detected_at DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT a.*,
                        (SELECT COUNT(*) FROM influencer_contacts c WHERE c.author_id = a.id) as contact_count,
                        (SELECT MAX(contact_date) FROM influencer_contacts c WHERE c.author_id = a.id) as last_contact_date
                 FROM influencer_authors a
                 WHERE ${whereClause}
                 ORDER BY a.first_detected_at DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`
            );

        return {
            authors: rows as InfluencerAuthor[],
            total,
        };
    }

    /**
     * 取得單一作者詳情
     */
    async getAuthorById(authorId: string): Promise<InfluencerAuthor | null> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT a.*,
                    (SELECT COUNT(*) FROM influencer_contacts c WHERE c.author_id = a.id) as contact_count,
                    (SELECT MAX(contact_date) FROM influencer_contacts c WHERE c.author_id = a.id) as last_contact_date
             FROM influencer_authors a
             WHERE a.id = ?`,
            [authorId]
        );

        return rows.length > 0 ? (rows[0] as InfluencerAuthor) : null;
    }

    /**
     * 更新作者狀態
     */
    async updateAuthorStatus(authorId: string, status: string, notes?: string): Promise<void> {
        const pool = getPool();

        await pool.execute(
            `UPDATE influencer_authors SET status = ?, notes = ?, updated_at = NOW() WHERE id = ?`,
            [status, notes || null, authorId]
        );
    }

    /**
     * 驗證 Twitter ID 是否存在
     */
    async verifyTwitterUsername(username: string): Promise<{
        exists: boolean;
        url: string;
    }> {
        const cleanUsername = username.replace(/^@/, '');
        const url = `https://x.com/${cleanUsername}`;

        try {
            // 使用 HEAD 請求檢查頁面是否存在
            const response = await fetch(url, {
                method: 'HEAD',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                redirect: 'follow',
            });

            // 200 或 重導向到 profile 頁面表示存在
            const exists = response.ok || response.status === 302;

            return { exists, url };
        } catch (error) {
            logger.warn(`驗證 Twitter @${cleanUsername} 失敗:`, error);
            return { exists: false, url };
        }
    }

    /**
     * 驗證並更新作者的 Twitter 狀態
     */
    async verifyAuthorTwitter(authorId: string): Promise<{ exists: boolean; url: string }> {
        const pool = getPool();

        // 取得作者的 Twitter ID
        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT twitter_id FROM influencer_authors WHERE id = ?`,
            [authorId]
        );

        if (rows.length === 0 || !rows[0].twitter_id) {
            throw new Error('作者不存在或沒有 Twitter ID');
        }

        const result = await this.verifyTwitterUsername(rows[0].twitter_id);

        // 更新驗證狀態
        await pool.execute(
            `UPDATE influencer_authors
             SET twitter_verified = ?, twitter_verified_at = NOW(), twitter_url = ?, updated_at = NOW()
             WHERE id = ?`,
            [result.exists, result.url, authorId]
        );

        return result;
    }

    /**
     * 取得來源貼文
     */
    async getSourcePosts(options: {
        authorId?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ posts: InfluencerSourcePost[]; total: number }> {
        const pool = getPool();
        const { authorId, limit = 20, offset = 0 } = options;

        // Ensure limit and offset are valid integers for mysql2 prepared statements
        const limitInt = Math.max(1, Math.min(100, Number(limit) || 20));
        const offsetInt = Math.max(0, Number(offset) || 0);

        let whereClause = '1=1';
        const values: any[] = [];

        if (authorId) {
            whereClause += ' AND sp.author_id = ?';
            values.push(authorId);
        }

        // Use query when no parameters, execute when parameters exist
        const [countRows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_source_posts sp WHERE ${whereClause}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_source_posts sp WHERE ${whereClause}`
            );
        const total = Number(countRows[0].total) || 0;

        const [rows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT sp.*, a.dcard_username as author_name, a.twitter_id
                 FROM influencer_source_posts sp
                 LEFT JOIN influencer_authors a ON sp.author_id = a.id
                 WHERE ${whereClause}
                 ORDER BY sp.detected_at DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT sp.*, a.dcard_username as author_name, a.twitter_id
                 FROM influencer_source_posts sp
                 LEFT JOIN influencer_authors a ON sp.author_id = a.id
                 WHERE ${whereClause}
                 ORDER BY sp.detected_at DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`
            );

        return {
            posts: rows as InfluencerSourcePost[],
            total,
        };
    }

    /**
     * 新增聯繫記錄
     */
    async addContact(contact: {
        authorId: string;
        contactDate: Date;
        contactMethod: string;
        subject?: string;
        message?: string;
        notes?: string;
    }): Promise<string> {
        const pool = getPool();
        const id = generateUUID();

        await pool.execute(
            `INSERT INTO influencer_contacts
             (id, author_id, contact_date, contact_method, subject, message, notes, result)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [
                id,
                contact.authorId,
                contact.contactDate,
                contact.contactMethod,
                contact.subject || null,
                contact.message || null,
                contact.notes || null,
            ]
        );

        // 更新作者狀態為已聯繫（如果目前是 new 或 pending）
        await pool.execute(
            `UPDATE influencer_authors
             SET status = 'contacted', updated_at = NOW()
             WHERE id = ? AND status IN ('new', 'pending')`,
            [contact.authorId]
        );

        return id;
    }

    /**
     * 取得聯繫記錄
     */
    async getContacts(options: {
        authorId?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ contacts: InfluencerContact[]; total: number }> {
        const pool = getPool();
        const { authorId, limit = 20, offset = 0 } = options;

        // Ensure limit and offset are valid integers for mysql2 prepared statements
        const limitInt = Math.max(1, Math.min(100, Number(limit) || 20));
        const offsetInt = Math.max(0, Number(offset) || 0);

        let whereClause = '1=1';
        const values: any[] = [];

        if (authorId) {
            whereClause += ' AND c.author_id = ?';
            values.push(authorId);
        }

        // Use query when no parameters, execute when parameters exist
        const [countRows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_contacts c WHERE ${whereClause}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT COUNT(*) as total FROM influencer_contacts c WHERE ${whereClause}`
            );
        const total = Number(countRows[0].total) || 0;

        const [rows] = values.length > 0
            ? await pool.execute<RowDataPacket[]>(
                `SELECT c.*, a.dcard_username as author_name, a.twitter_id
                 FROM influencer_contacts c
                 LEFT JOIN influencer_authors a ON c.author_id = a.id
                 WHERE ${whereClause}
                 ORDER BY c.contact_date DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`,
                values
            )
            : await pool.query<RowDataPacket[]>(
                `SELECT c.*, a.dcard_username as author_name, a.twitter_id
                 FROM influencer_contacts c
                 LEFT JOIN influencer_authors a ON c.author_id = a.id
                 WHERE ${whereClause}
                 ORDER BY c.contact_date DESC
                 LIMIT ${limitInt} OFFSET ${offsetInt}`
            );

        return {
            contacts: rows as InfluencerContact[],
            total,
        };
    }

    /**
     * 更新聯繫記錄的回覆狀態
     */
    async updateContactResult(contactId: string, result: string, responseContent?: string): Promise<void> {
        const pool = getPool();

        await pool.execute(
            `UPDATE influencer_contacts
             SET result = ?, response_content = ?, response_date = NOW(), updated_at = NOW()
             WHERE id = ?`,
            [result, responseContent || null, contactId]
        );

        // 如果結果是 agreed，更新作者狀態為合作中
        if (result === 'agreed') {
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT author_id FROM influencer_contacts WHERE id = ?`,
                [contactId]
            );
            if (rows.length > 0) {
                await pool.execute(
                    `UPDATE influencer_authors SET status = 'cooperating', updated_at = NOW() WHERE id = ?`,
                    [rows[0].author_id]
                );
            }
        }
    }

    /**
     * 掃描 Dcard 論壇 - 已移至本機爬蟲 (dcard-local-scraper)
     * 此方法保留以供 API 回應提示
     */
    async scanDcardForum(_forumAlias: string = 'sex'): Promise<{
        scanned: number;
        newAuthors: number;
        withTwitter: number;
    }> {
        logger.info('Dcard 掃描已移至本機爬蟲，請使用本機 DcardScraper 執行掃描');
        return { scanned: 0, newAuthors: 0, withTwitter: 0 };
    }

    // parseForumPosts, checkAuthor, fetchAuthorProfile 已移至本機爬蟲 (dcard-local-scraper)

    /**
     * 從文字中偵測 Twitter ID（只偵測 Twitter/X）
     */
    private detectTwitterId(text: string): { username: string; url: string } | null {
        // 1. 先檢測完整連結
        for (const pattern of TWITTER_PATTERNS.urls) {
            const match = text.match(pattern);
            if (match) {
                // 根據 pattern 的捕獲組取得 username
                const username = match[3] || match[2];
                if (username && !this.isReservedTwitterPath(username)) {
                    return {
                        username,
                        url: `https://x.com/${username}`,
                    };
                }
            }
        }

        // 2. 檢測純 ID 格式（有關鍵字提示）
        const plainMatch = text.match(TWITTER_PATTERNS.plainId);
        if (plainMatch) {
            const username = plainMatch[1].replace(/^@/, '');
            if (username && !this.isReservedTwitterPath(username)) {
                return {
                    username,
                    url: `https://x.com/${username}`,
                };
            }
        }

        // 3. 最後才檢測 @mention（可能是其他平台的 mention）
        // 只在文字中有 twitter/x 相關關鍵字時才啟用
        if (/twitter|x\.com|推特|小藍鳥/i.test(text)) {
            const atMatch = text.match(TWITTER_PATTERNS.atMention);
            if (atMatch) {
                const username = atMatch[1];
                if (username && !this.isReservedTwitterPath(username)) {
                    return {
                        username,
                        url: `https://x.com/${username}`,
                    };
                }
            }
        }

        return null;
    }

    /**
     * 檢查是否為 Twitter 保留路徑
     */
    private isReservedTwitterPath(path: string): boolean {
        const reserved = [
            'home', 'explore', 'notifications', 'messages', 'settings',
            'login', 'signup', 'logout', 'search', 'compose', 'intent',
            'i', 'following', 'followers', 'lists', 'bookmarks',
        ];
        return reserved.includes(path.toLowerCase());
    }

    /**
     * 延遲函數
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 取得統計數據
     */
    async getStats(): Promise<{
        totalAuthors: number;
        withTwitter: number;
        twitterVerified: number;
        newToday: number;
        contacted: number;
        cooperating: number;
    }> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(`
            SELECT
                COUNT(*) as totalAuthors,
                SUM(CASE WHEN twitter_id IS NOT NULL THEN 1 ELSE 0 END) as withTwitter,
                SUM(CASE WHEN twitter_verified = TRUE THEN 1 ELSE 0 END) as twitterVerified,
                SUM(CASE WHEN DATE(first_detected_at) = CURDATE() THEN 1 ELSE 0 END) as newToday,
                SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                SUM(CASE WHEN status = 'cooperating' THEN 1 ELSE 0 END) as cooperating
            FROM influencer_authors
        `);

        const stats = rows[0];
        return {
            totalAuthors: stats.totalAuthors || 0,
            withTwitter: stats.withTwitter || 0,
            twitterVerified: stats.twitterVerified || 0,
            newToday: stats.newToday || 0,
            contacted: stats.contacted || 0,
            cooperating: stats.cooperating || 0,
        };
    }

    /**
     * 測試爬蟲服務連接 - 已移至本機爬蟲
     */
    async testCrawlerConnection(): Promise<any> {
        return {
            message: '雲端代理爬蟲已移除，請使用本機 DcardScraper 執行爬取',
            localScraper: true,
        };
    }

    // ==========================================
    // 作者管理
    // ==========================================

    /**
     * 更新作者資料
     */
    async updateAuthor(authorId: string, data: {
        dcard_username?: string;
        twitter_id?: string;
        twitter_display_name?: string;
        notes?: string;
        priority?: string;
    }): Promise<void> {
        const pool = getPool();

        const updates: string[] = [];
        const values: any[] = [];

        if (data.dcard_username !== undefined) {
            updates.push('dcard_username = ?');
            values.push(data.dcard_username);
        }
        if (data.twitter_id !== undefined) {
            updates.push('twitter_id = ?');
            values.push(data.twitter_id);
        }
        if (data.twitter_display_name !== undefined) {
            updates.push('twitter_display_name = ?');
            values.push(data.twitter_display_name);
        }
        if (data.notes !== undefined) {
            updates.push('notes = ?');
            values.push(data.notes);
        }
        if (data.priority !== undefined) {
            updates.push('priority = ?');
            values.push(data.priority);
        }

        if (updates.length === 0) return;

        updates.push('updated_at = NOW()');
        values.push(authorId);

        await pool.execute(
            `UPDATE influencer_authors SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
    }

    /**
     * 刪除作者
     */
    async deleteAuthor(authorId: string): Promise<void> {
        const pool = getPool();
        await pool.execute('DELETE FROM influencer_authors WHERE id = ?', [authorId]);
    }

    // ==========================================
    // 合作記錄管理
    // ==========================================

    /**
     * 取得作者的合作記錄
     */
    async getCooperations(authorId: string): Promise<any[]> {
        const pool = getPool();
        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, author_id, first_contact_at, cooperated, post_url, payment_amount, post_date, notes, created_at
             FROM influencer_cooperations
             WHERE author_id = ?
             ORDER BY first_contact_at DESC`,
            [authorId]
        );
        return rows;
    }

    /**
     * 新增合作記錄
     */
    async addCooperation(data: {
        author_id: string;
        first_contact_at: Date;
        cooperated: boolean;
        post_url?: string;
        payment_amount?: number;
        post_date?: Date;
        notes?: string;
    }): Promise<string> {
        const pool = getPool();
        const id = generateUUID();

        await pool.execute(
            `INSERT INTO influencer_cooperations (
                id, author_id, first_contact_at, cooperated, post_url, payment_amount, post_date, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                data.author_id,
                data.first_contact_at,
                data.cooperated,
                data.post_url || null,
                data.payment_amount || null,
                data.post_date || null,
                data.notes || null,
            ]
        );

        // 如果合作成功，更新作者狀態為 cooperating
        if (data.cooperated) {
            await pool.execute(
                `UPDATE influencer_authors SET status = 'cooperating', updated_at = NOW() WHERE id = ?`,
                [data.author_id]
            );
        }

        return id;
    }

    /**
     * 更新合作記錄
     */
    async updateCooperation(cooperationId: string, data: {
        first_contact_at?: Date;
        cooperated?: boolean;
        post_url?: string;
        payment_amount?: number;
        post_date?: Date;
        notes?: string;
    }): Promise<void> {
        const pool = getPool();

        const updates: string[] = [];
        const values: any[] = [];

        if (data.first_contact_at !== undefined) {
            updates.push('first_contact_at = ?');
            values.push(data.first_contact_at);
        }
        if (data.cooperated !== undefined) {
            updates.push('cooperated = ?');
            values.push(data.cooperated);
        }
        if (data.post_url !== undefined) {
            updates.push('post_url = ?');
            values.push(data.post_url);
        }
        if (data.payment_amount !== undefined) {
            updates.push('payment_amount = ?');
            values.push(data.payment_amount);
        }
        if (data.post_date !== undefined) {
            updates.push('post_date = ?');
            values.push(data.post_date);
        }
        if (data.notes !== undefined) {
            updates.push('notes = ?');
            values.push(data.notes);
        }

        if (updates.length === 0) return;

        updates.push('updated_at = NOW()');
        values.push(cooperationId);

        await pool.execute(
            `UPDATE influencer_cooperations SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
    }

    /**
     * 刪除合作記錄
     */
    async deleteCooperation(cooperationId: string): Promise<void> {
        const pool = getPool();
        await pool.execute('DELETE FROM influencer_cooperations WHERE id = ?', [cooperationId]);
    }

}

export default new InfluencerService();
