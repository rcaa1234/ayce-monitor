/**
 * 網黃偵測服務
 * 負責爬取 Dcard 西斯版，檢測作者個人頁面的 Twitter/X 連結
 */

import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';
import * as cheerio from 'cheerio';

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
     * 掃描 Dcard 論壇並偵測有 Twitter 的作者
     */
    async scanDcardForum(forumAlias: string = 'sex'): Promise<{
        scanned: number;
        newAuthors: number;
        withTwitter: number;
    }> {
        logger.info(`開始掃描 Dcard ${forumAlias} 版...`);

        const result = {
            scanned: 0,
            newAuthors: 0,
            withTwitter: 0,
        };

        try {
            const forumUrl = `https://www.dcard.tw/f/${forumAlias}?tab=latest`;
            const html = await this.fetchDcardPage(forumUrl);

            if (!html) {
                logger.error('無法取得 Dcard 頁面');
                return result;
            }

            const posts = this.parseForumPosts(html);
            result.scanned = posts.length;

            logger.info(`找到 ${posts.length} 篇文章`);

            for (const post of posts) {
                if (!post.authorId) continue;

                try {
                    const authorResult = await this.checkAuthor(post.authorId, post, forumAlias);
                    if (authorResult.isNew) {
                        result.newAuthors++;
                    }
                    if (authorResult.hasTwitter) {
                        result.withTwitter++;
                    }
                } catch (err) {
                    logger.error(`檢查作者 ${post.authorId} 失敗:`, err);
                }

                await this.delay(1000);
            }

            logger.info(`掃描完成: 新作者 ${result.newAuthors}, 有 Twitter ${result.withTwitter}`);
            return result;
        } catch (error) {
            logger.error('掃描 Dcard 論壇失敗:', error);
            throw error;
        }
    }

    /**
     * 使用 ZenRows 取得 Dcard 頁面
     */
    private async fetchDcardPage(url: string): Promise<string | null> {
        const zenrowsApiKey = process.env.ZENROWS_API_KEY;

        if (!zenrowsApiKey) {
            logger.error('ZenRows API key 未設定');
            return null;
        }

        try {
            const zenrowsUrl = `https://api.zenrows.com/v1/?apikey=${zenrowsApiKey}&url=${encodeURIComponent(url)}&js_render=true&wait=3000`;

            const response = await fetch(zenrowsUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html',
                },
            });

            if (!response.ok) {
                logger.error(`ZenRows 請求失敗: ${response.status}`);
                return null;
            }

            return await response.text();
        } catch (error) {
            logger.error('ZenRows 請求錯誤:', error);
            return null;
        }
    }

    /**
     * 解析論壇頁面取得文章列表
     */
    private parseForumPosts(html: string): Array<{
        postId: string;
        title: string;
        authorId: string | null;
        authorName: string | null;
        url: string;
        likesCount?: number;
        commentsCount?: number;
    }> {
        const $ = cheerio.load(html);
        const posts: Array<{
            postId: string;
            title: string;
            authorId: string | null;
            authorName: string | null;
            url: string;
            likesCount?: number;
            commentsCount?: number;
        }> = [];

        try {
            const nextDataScript = $('#__NEXT_DATA__').html();
            if (nextDataScript) {
                const nextData = JSON.parse(nextDataScript);

                const forumData = nextData?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data;
                const postsData = forumData?.posts || forumData?.pages?.[0]?.posts || [];

                for (const post of postsData) {
                    posts.push({
                        postId: post.id?.toString() || '',
                        title: post.title || '',
                        authorId: post.member?.uid || post.authorId || null,
                        authorName: post.member?.nickname || post.authorNickname || null,
                        url: `https://www.dcard.tw/f/${post.forumAlias}/p/${post.id}`,
                        likesCount: post.likeCount || 0,
                        commentsCount: post.commentCount || 0,
                    });
                }
            }
        } catch (err) {
            logger.error('解析 __NEXT_DATA__ 失敗:', err);
        }

        return posts;
    }

    /**
     * 檢查作者是否有 Twitter 連結
     */
    private async checkAuthor(
        dcardUid: string,
        postInfo: { postId: string; title: string; url: string; likesCount?: number; commentsCount?: number },
        forumAlias: string
    ): Promise<{ isNew: boolean; hasTwitter: boolean }> {
        const pool = getPool();

        // 檢查是否已存在
        const [existingRows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, twitter_id FROM influencer_authors WHERE dcard_id = ?`,
            [dcardUid]
        );

        const isNew = existingRows.length === 0;
        let authorId: string;
        let hasTwitter = false;

        if (isNew) {
            // 取得作者頁面資訊
            const authorProfile = await this.fetchAuthorProfile(dcardUid);

            if (!authorProfile) {
                return { isNew: false, hasTwitter: false };
            }

            // 只檢測 Twitter
            const twitterInfo = this.detectTwitterId(authorProfile.bio || '');
            hasTwitter = twitterInfo !== null;

            // 儲存作者
            authorId = generateUUID();
            await pool.execute(
                `INSERT INTO influencer_authors
                 (id, dcard_id, dcard_username, dcard_bio, dcard_url, twitter_id, twitter_url, status, source_forum)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    authorId,
                    dcardUid,
                    authorProfile.nickname,
                    authorProfile.bio,
                    `https://www.dcard.tw/@${dcardUid}`,
                    twitterInfo?.username || null,
                    twitterInfo?.url || null,
                    hasTwitter ? 'new' : 'no_social',
                    forumAlias,
                ]
            );

            if (hasTwitter) {
                logger.info(`新作者: ${authorProfile.nickname} (@${twitterInfo?.username})`);
            }
        } else {
            authorId = existingRows[0].id;
            hasTwitter = !!existingRows[0].twitter_id;

            // 更新最後看到時間
            await pool.execute(
                `UPDATE influencer_authors SET last_seen_at = NOW() WHERE id = ?`,
                [authorId]
            );
        }

        // 儲存來源貼文（如果尚未存在）
        const [existingPosts] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM influencer_source_posts WHERE post_id = ?`,
            [postInfo.postId]
        );

        if (existingPosts.length === 0) {
            await pool.execute(
                `INSERT INTO influencer_source_posts
                 (id, author_id, post_id, post_url, post_title, likes_count, comments_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    generateUUID(),
                    authorId,
                    postInfo.postId,
                    postInfo.url,
                    postInfo.title,
                    postInfo.likesCount || 0,
                    postInfo.commentsCount || 0,
                ]
            );
        }

        return { isNew, hasTwitter };
    }

    /**
     * 取得作者個人頁面資訊
     */
    private async fetchAuthorProfile(dcardUid: string): Promise<{
        nickname: string | null;
        bio: string | null;
    } | null> {
        try {
            const apiUrl = `https://www.dcard.tw/service/api/v2/members/${dcardUid}`;

            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                logger.warn(`取得用戶資訊失敗: ${response.status}`);
                return null;
            }

            const data = await response.json() as { nickname?: string; description?: string; bio?: string };
            return {
                nickname: data.nickname || null,
                bio: data.description || data.bio || null,
            };
        } catch (error) {
            logger.error(`取得作者資訊失敗 (${dcardUid}):`, error);
            return null;
        }
    }

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
}

export default new InfluencerService();
