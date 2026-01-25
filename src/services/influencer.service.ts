/**
 * 網黃偵測服務
 * 負責爬取 Dcard 西斯版，檢測作者個人頁面的社群連結
 */

import { getPool } from '../database/connection';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import logger from '../utils/logger';
import { generateUUID } from '../utils/uuid';
import * as cheerio from 'cheerio';

// 社群平台識別模式
const SOCIAL_PLATFORMS = {
    twitter: {
        patterns: [
            /twitter\.com\/([a-zA-Z0-9_]+)/i,
            /x\.com\/([a-zA-Z0-9_]+)/i,
        ],
        name: 'Twitter/X',
    },
    instagram: {
        patterns: [/instagram\.com\/([a-zA-Z0-9_.]+)/i],
        name: 'Instagram',
    },
    tiktok: {
        patterns: [/tiktok\.com\/@([a-zA-Z0-9_.]+)/i],
        name: 'TikTok',
    },
    telegram: {
        patterns: [/t\.me\/([a-zA-Z0-9_]+)/i],
        name: 'Telegram',
    },
    linktree: {
        patterns: [/linktr\.ee\/([a-zA-Z0-9_]+)/i],
        name: 'Linktree',
    },
};

interface InfluencerAuthor {
    id: string;
    dcard_uid: string;
    nickname: string | null;
    bio: string | null;
    twitter_link: string | null;
    twitter_username: string | null;
    instagram_link: string | null;
    instagram_username: string | null;
    other_social_links: any;
    status: string;
    notes: string | null;
    first_seen_at: Date;
    last_checked_at: Date;
}

interface InfluencerSourcePost {
    id: string;
    author_id: string;
    dcard_post_id: string;
    post_url: string;
    post_title: string;
    forum_name: string;
    published_at: Date | null;
    discovered_at: Date;
}

interface InfluencerContact {
    id: string;
    author_id: string;
    contact_type: string;
    contact_date: Date;
    contact_method: string | null;
    response_status: string;
    notes: string | null;
}

interface DetectionConfig {
    auto_scan_enabled: boolean;
    scan_interval_hours: number;
    target_forums: string[];
    min_posts_to_scan: number;
    notify_on_new_detection: boolean;
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
            // 返回預設設定
            return {
                auto_scan_enabled: false,
                scan_interval_hours: 1,
                target_forums: ['sex'],
                min_posts_to_scan: 30,
                notify_on_new_detection: true,
            };
        }

        const row = rows[0];
        return {
            auto_scan_enabled: row.auto_scan_enabled === 1,
            scan_interval_hours: row.scan_interval_hours,
            target_forums: JSON.parse(row.target_forums || '["sex"]'),
            min_posts_to_scan: row.min_posts_to_scan,
            notify_on_new_detection: row.notify_on_new_detection === 1,
        };
    }

    /**
     * 更新偵測設定
     */
    async updateConfig(config: Partial<DetectionConfig>): Promise<void> {
        const pool = getPool();

        const updates: string[] = [];
        const values: any[] = [];

        if (config.auto_scan_enabled !== undefined) {
            updates.push('auto_scan_enabled = ?');
            values.push(config.auto_scan_enabled ? 1 : 0);
        }
        if (config.scan_interval_hours !== undefined) {
            updates.push('scan_interval_hours = ?');
            values.push(config.scan_interval_hours);
        }
        if (config.target_forums !== undefined) {
            updates.push('target_forums = ?');
            values.push(JSON.stringify(config.target_forums));
        }
        if (config.min_posts_to_scan !== undefined) {
            updates.push('min_posts_to_scan = ?');
            values.push(config.min_posts_to_scan);
        }
        if (config.notify_on_new_detection !== undefined) {
            updates.push('notify_on_new_detection = ?');
            values.push(config.notify_on_new_detection ? 1 : 0);
        }

        if (updates.length > 0) {
            await pool.execute(
                `UPDATE influencer_detection_config SET ${updates.join(', ')}, updated_at = NOW()`,
                values
            );
        }
    }

    /**
     * 取得作者列表
     */
    async getAuthors(options: {
        status?: string;
        platform?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ authors: InfluencerAuthor[]; total: number }> {
        const pool = getPool();
        const { status, platform, limit = 20, offset = 0 } = options;

        let whereClause = '1=1';
        const values: any[] = [];

        if (status) {
            whereClause += ' AND status = ?';
            values.push(status);
        }

        if (platform) {
            if (platform === 'twitter') {
                whereClause += ' AND twitter_link IS NOT NULL';
            } else if (platform === 'instagram') {
                whereClause += ' AND instagram_link IS NOT NULL';
            } else if (platform === 'other') {
                whereClause += ' AND other_social_links IS NOT NULL AND other_social_links != "{}"';
            }
        }

        // 取得總數
        const [countRows] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as total FROM influencer_authors WHERE ${whereClause}`,
            values
        );
        const total = countRows[0].total;

        // 取得資料
        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT * FROM influencer_authors
             WHERE ${whereClause}
             ORDER BY first_seen_at DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );

        return {
            authors: rows as InfluencerAuthor[],
            total,
        };
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
     * 取得來源貼文
     */
    async getSourcePosts(options: {
        authorId?: string;
        limit?: number;
        offset?: number;
    } = {}): Promise<{ posts: InfluencerSourcePost[]; total: number }> {
        const pool = getPool();
        const { authorId, limit = 20, offset = 0 } = options;

        let whereClause = '1=1';
        const values: any[] = [];

        if (authorId) {
            whereClause += ' AND author_id = ?';
            values.push(authorId);
        }

        const [countRows] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as total FROM influencer_source_posts WHERE ${whereClause}`,
            values
        );
        const total = countRows[0].total;

        const [rows] = await pool.execute<RowDataPacket[]>(
            `SELECT sp.*, a.nickname, a.twitter_username, a.status as author_status
             FROM influencer_source_posts sp
             LEFT JOIN influencer_authors a ON sp.author_id = a.id
             WHERE ${whereClause.replace('1=1', 'sp.author_id IS NOT NULL OR 1=1')}
             ORDER BY sp.discovered_at DESC
             LIMIT ? OFFSET ?`,
            [...values, limit, offset]
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
        contactType: string;
        contactDate: Date;
        contactMethod?: string;
        notes?: string;
    }): Promise<string> {
        const pool = getPool();
        const id = generateUUID();

        await pool.execute(
            `INSERT INTO influencer_contacts (id, author_id, contact_type, contact_date, contact_method, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, contact.authorId, contact.contactType, contact.contactDate, contact.contactMethod || null, contact.notes || null]
        );

        return id;
    }

    /**
     * 取得聯繫記錄
     */
    async getContacts(authorId?: string): Promise<InfluencerContact[]> {
        const pool = getPool();

        let query = `SELECT c.*, a.nickname, a.twitter_username
                     FROM influencer_contacts c
                     LEFT JOIN influencer_authors a ON c.author_id = a.id`;
        const values: any[] = [];

        if (authorId) {
            query += ' WHERE c.author_id = ?';
            values.push(authorId);
        }

        query += ' ORDER BY c.contact_date DESC';

        const [rows] = await pool.execute<RowDataPacket[]>(query, values);
        return rows as InfluencerContact[];
    }

    /**
     * 更新聯繫記錄的回應狀態
     */
    async updateContactResponse(contactId: string, responseStatus: string): Promise<void> {
        const pool = getPool();

        await pool.execute(
            `UPDATE influencer_contacts SET response_status = ?, updated_at = NOW() WHERE id = ?`,
            [responseStatus, contactId]
        );
    }

    /**
     * 掃描 Dcard 西斯版並偵測網黃
     */
    async scanDcardForum(forumAlias: string = 'sex'): Promise<{
        scanned: number;
        newAuthors: number;
        withSocialLinks: number;
    }> {
        logger.info(`開始掃描 Dcard ${forumAlias} 版...`);

        const result = {
            scanned: 0,
            newAuthors: 0,
            withSocialLinks: 0,
        };

        try {
            // 使用 ZenRows 取得論壇頁面
            const forumUrl = `https://www.dcard.tw/f/${forumAlias}?tab=latest`;
            const html = await this.fetchDcardPage(forumUrl);

            if (!html) {
                logger.error('無法取得 Dcard 頁面');
                return result;
            }

            // 解析 __NEXT_DATA__ 取得文章列表
            const posts = this.parseForumPosts(html);
            result.scanned = posts.length;

            logger.info(`找到 ${posts.length} 篇文章`);

            // 對每篇文章的作者進行檢查
            for (const post of posts) {
                if (!post.authorId) continue;

                try {
                    const authorResult = await this.checkAuthor(post.authorId, post);
                    if (authorResult.isNew) {
                        result.newAuthors++;
                    }
                    if (authorResult.hasSocialLinks) {
                        result.withSocialLinks++;
                    }
                } catch (err) {
                    logger.error(`檢查作者 ${post.authorId} 失敗:`, err);
                }

                // 延遲避免請求過快
                await this.delay(1000);
            }

            logger.info(`掃描完成: 新作者 ${result.newAuthors}, 有社群連結 ${result.withSocialLinks}`);
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
    }> {
        const $ = cheerio.load(html);
        const posts: Array<{
            postId: string;
            title: string;
            authorId: string | null;
            authorName: string | null;
            url: string;
        }> = [];

        try {
            // 嘗試從 __NEXT_DATA__ 解析
            const nextDataScript = $('#__NEXT_DATA__').html();
            if (nextDataScript) {
                const nextData = JSON.parse(nextDataScript);

                // 嘗試不同的資料路徑
                const forumData = nextData?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data;
                const postsData = forumData?.posts || forumData?.pages?.[0]?.posts || [];

                for (const post of postsData) {
                    posts.push({
                        postId: post.id?.toString() || '',
                        title: post.title || '',
                        authorId: post.member?.uid || post.authorId || null,
                        authorName: post.member?.nickname || post.authorNickname || null,
                        url: `https://www.dcard.tw/f/${post.forumAlias}/p/${post.id}`,
                    });
                }
            }
        } catch (err) {
            logger.error('解析 __NEXT_DATA__ 失敗:', err);
        }

        return posts;
    }

    /**
     * 檢查作者是否有社群連結
     */
    private async checkAuthor(
        dcardUid: string,
        postInfo: { postId: string; title: string; url: string }
    ): Promise<{ isNew: boolean; hasSocialLinks: boolean }> {
        const pool = getPool();

        // 檢查是否已存在
        const [existingRows] = await pool.execute<RowDataPacket[]>(
            `SELECT id, twitter_link, instagram_link, other_social_links FROM influencer_authors WHERE dcard_uid = ?`,
            [dcardUid]
        );

        const isNew = existingRows.length === 0;
        let authorId: string;
        let hasSocialLinks = false;

        if (isNew) {
            // 取得作者頁面資訊
            const authorProfile = await this.fetchAuthorProfile(dcardUid);

            if (!authorProfile) {
                return { isNew: false, hasSocialLinks: false };
            }

            // 檢測社群連結
            const socialLinks = this.detectSocialLinks(authorProfile.bio || '');
            hasSocialLinks = Object.keys(socialLinks).length > 0 ||
                socialLinks.twitter !== null ||
                socialLinks.instagram !== null;

            // 儲存作者
            authorId = generateUUID();
            await pool.execute(
                `INSERT INTO influencer_authors
                 (id, dcard_uid, nickname, bio, twitter_link, twitter_username, instagram_link, instagram_username, other_social_links, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    authorId,
                    dcardUid,
                    authorProfile.nickname,
                    authorProfile.bio,
                    socialLinks.twitter?.link || null,
                    socialLinks.twitter?.username || null,
                    socialLinks.instagram?.link || null,
                    socialLinks.instagram?.username || null,
                    JSON.stringify(socialLinks.others || {}),
                    hasSocialLinks ? 'new' : 'no_social',
                ]
            );

            logger.info(`新作者: ${authorProfile.nickname} (${dcardUid})${hasSocialLinks ? ' - 有社群連結' : ''}`);
        } else {
            authorId = existingRows[0].id;
            hasSocialLinks = !!(existingRows[0].twitter_link || existingRows[0].instagram_link);

            // 更新最後檢查時間
            await pool.execute(
                `UPDATE influencer_authors SET last_checked_at = NOW() WHERE id = ?`,
                [authorId]
            );
        }

        // 儲存來源貼文（如果尚未存在）
        const [existingPosts] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM influencer_source_posts WHERE dcard_post_id = ?`,
            [postInfo.postId]
        );

        if (existingPosts.length === 0) {
            await pool.execute(
                `INSERT INTO influencer_source_posts (id, author_id, dcard_post_id, post_url, post_title, forum_name)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [generateUUID(), authorId, postInfo.postId, postInfo.url, postInfo.title, 'sex']
            );
        }

        return { isNew, hasSocialLinks };
    }

    /**
     * 取得作者個人頁面資訊
     */
    private async fetchAuthorProfile(dcardUid: string): Promise<{
        nickname: string | null;
        bio: string | null;
    } | null> {
        try {
            // Dcard 用戶 API
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
     * 從文字中偵測社群連結
     */
    private detectSocialLinks(text: string): {
        twitter: { link: string; username: string } | null;
        instagram: { link: string; username: string } | null;
        others: Record<string, { link: string; username: string }>;
    } {
        const result = {
            twitter: null as { link: string; username: string } | null,
            instagram: null as { link: string; username: string } | null,
            others: {} as Record<string, { link: string; username: string }>,
        };

        // 檢測 Twitter/X
        for (const pattern of SOCIAL_PLATFORMS.twitter.patterns) {
            const match = text.match(pattern);
            if (match) {
                result.twitter = {
                    link: match[0],
                    username: match[1],
                };
                break;
            }
        }

        // 檢測 Instagram
        for (const pattern of SOCIAL_PLATFORMS.instagram.patterns) {
            const match = text.match(pattern);
            if (match) {
                result.instagram = {
                    link: match[0],
                    username: match[1],
                };
                break;
            }
        }

        // 檢測其他平台
        for (const [platform, config] of Object.entries(SOCIAL_PLATFORMS)) {
            if (platform === 'twitter' || platform === 'instagram') continue;

            for (const pattern of config.patterns) {
                const match = text.match(pattern);
                if (match) {
                    result.others[platform] = {
                        link: match[0],
                        username: match[1],
                    };
                    break;
                }
            }
        }

        return result;
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
        withInstagram: number;
        newToday: number;
        contacted: number;
        cooperating: number;
    }> {
        const pool = getPool();

        const [rows] = await pool.execute<RowDataPacket[]>(`
            SELECT
                COUNT(*) as totalAuthors,
                SUM(CASE WHEN twitter_link IS NOT NULL THEN 1 ELSE 0 END) as withTwitter,
                SUM(CASE WHEN instagram_link IS NOT NULL THEN 1 ELSE 0 END) as withInstagram,
                SUM(CASE WHEN DATE(first_seen_at) = CURDATE() THEN 1 ELSE 0 END) as newToday,
                SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                SUM(CASE WHEN status = 'cooperating' THEN 1 ELSE 0 END) as cooperating
            FROM influencer_authors
        `);

        const stats = rows[0];
        return {
            totalAuthors: stats.totalAuthors || 0,
            withTwitter: stats.withTwitter || 0,
            withInstagram: stats.withInstagram || 0,
            newToday: stats.newToday || 0,
            contacted: stats.contacted || 0,
            cooperating: stats.cooperating || 0,
        };
    }
}

export default new InfluencerService();
