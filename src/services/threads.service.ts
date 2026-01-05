import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { encrypt, decrypt } from '../utils/encryption';
import { getPool } from '../database/connection';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { generateUUID } from '../utils/uuid';

export interface ThreadsAccount {
  id: string;
  account_id: string;
  username: string;
  status: 'ACTIVE' | 'LOCKED';
  is_default: boolean;
}

export interface ThreadsTokenInfo {
  access_token: string;
  expires_at: Date;
  scopes: string[];
}

class ThreadsService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.threads.apiBaseUrl,
      timeout: 30000,
    });
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<{
    access_token: string;
    user_id: string;
  }> {
    try {
      const response = await this.client.post('/oauth/access_token', {
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to exchange code for token:', error);
      throw error;
    }
  }

  /**
   * Exchange short-lived token for long-lived token
   */
  async getLongLivedToken(shortLivedToken: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    try {
      const response = await this.client.get('/access_token', {
        params: {
          grant_type: 'th_exchange_token',
          access_token: shortLivedToken,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to get long-lived token:', error);
      throw error;
    }
  }

  /**
   * Refresh long-lived token
   */
  async refreshToken(accessToken: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    try {
      const response = await this.client.get('/refresh_access_token', {
        params: {
          grant_type: 'th_refresh_token',
          access_token: accessToken,
        },
      });

      return response.data;
    } catch (error) {
      logger.error('Failed to refresh token:', error);
      throw error;
    }
  }

  /**
   * Create a Threads post
   */
  async createPost(
    userId: string,
    accessToken: string,
    content: string,
    username?: string
  ): Promise<{
    id: string;
    permalink: string;
  }> {
    let postId: string | null = null;

    try {
      logger.info(`Creating Threads post for user ${userId}`);
      logger.info(`Content type: ${typeof content}, length: ${content?.length}`);

      // Ensure content is a string
      const textContent = typeof content === 'string' ? content : String(content);

      // Step 1: Create media container
      const containerResponse = await this.client.post(
        `/${userId}/threads`,
        null,
        {
          params: {
            media_type: 'TEXT',
            text: textContent,
            access_token: accessToken,
          },
        }
      );

      const containerId = containerResponse.data.id;
      logger.info(`Created container: ${containerId}`);

      // Step 2: Publish the container
      const publishResponse = await this.client.post(
        `/${userId}/threads_publish`,
        null,
        {
          params: {
            creation_id: containerId,
            access_token: accessToken,
          },
        }
      );

      postId = publishResponse.data.id;
      logger.info(`✅ Published post successfully: ${postId}`);

    } catch (error: any) {
      logger.error('Failed to create/publish Threads post:', error);
      logger.error('Error response:', error.response?.data);

      // Extract error details
      if (error.response) {
        throw new Error(
          `Threads API error: ${error.response.data.error?.message || error.message}`
        );
      }

      throw error;
    }

    // If we got here, the post was successfully published
    // Now try to get the permalink (non-critical)
    let permalink = username
      ? `https://www.threads.net/@${username}/post/${postId}`
      : `https://www.threads.net/t/${postId}`;

    try {
      const postResponse = await this.client.get(`/${postId}`, {
        params: {
          fields: 'permalink',
          access_token: accessToken,
        },
      });

      if (postResponse.data.permalink) {
        permalink = postResponse.data.permalink;
        logger.info(`Got permalink from API: ${permalink}`);
      } else {
        logger.warn(`No permalink in response, using default format`);
      }
    } catch (permalinkError: any) {
      logger.warn(`Failed to get permalink, using default format:`, permalinkError.message);
    }

    return {
      id: postId!,
      permalink: permalink,
    };
  }

  /**
   * Save account with encrypted token
   */
  async saveAccount(data: {
    username: string;
    userId: string; // Threads User ID (account_id)
    systemUserId: string; // System user ID (user_id)
    accessToken: string;
    expiresIn: number;
    scopes?: string[];
    isDefault?: boolean;
  }): Promise<string> {
    const pool = getPool();
    const accountId = generateUUID();
    const expiresAt = new Date(Date.now() + data.expiresIn * 1000);
    const encryptedToken = encrypt(data.accessToken);

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // If this is set as default, unset other defaults
      if (data.isDefault) {
        await connection.execute(
          'UPDATE threads_accounts SET is_default = 0 WHERE is_default = 1'
        );
      }

      // Insert account
      await connection.execute<ResultSetHeader>(
        `INSERT INTO threads_accounts (id, user_id, username, account_id, status, is_default)
         VALUES (?, ?, ?, ?, 'ACTIVE', ?)`,
        [accountId, data.systemUserId, data.username, data.userId, data.isDefault ? 1 : 0]
      );

      // Insert auth
      await connection.execute<ResultSetHeader>(
        `INSERT INTO threads_auth
         (account_id, access_token, expires_at, status, scopes)
         VALUES (?, ?, ?, 'OK', ?)`,
        [accountId, encryptedToken, expiresAt, JSON.stringify(data.scopes || [])]
      );

      await connection.commit();
      logger.info(`Saved Threads account: ${data.username}`);

      return accountId;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get default account
   */
  async getDefaultAccount(): Promise<{
    account: ThreadsAccount;
    token: string;
  } | null> {
    const pool = getPool();

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT a.*, t.access_token, t.expires_at, t.status as token_status
       FROM threads_accounts a
       INNER JOIN threads_auth t ON a.id = t.account_id
       WHERE a.is_default = 1 AND a.status = 'ACTIVE' AND t.status = 'OK'
       LIMIT 1`
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    return {
      account: {
        id: row.id,
        account_id: row.account_id,
        username: row.username,
        status: row.status,
        is_default: row.is_default,
      },
      token: decrypt(row.access_token),
    };
  }

  /**
   * Update token for an account
   */
  async updateToken(
    accountId: string,
    accessToken: string,
    expiresIn: number
  ): Promise<void> {
    const pool = getPool();
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const encryptedToken = encrypt(accessToken);

    await pool.execute(
      `UPDATE threads_auth
       SET access_token = ?,
           expires_at = ?,
           last_refreshed_at = NOW(),
           status = 'OK'
       WHERE account_id = ?`,
      [encryptedToken, expiresAt, accountId]
    );

    logger.info(`Updated token for account ${accountId}`);
  }

  /**
   * Mark token as expired or requiring action
   */
  async markTokenStatus(
    accountId: string,
    status: 'EXPIRED' | 'ACTION_REQUIRED'
  ): Promise<void> {
    const pool = getPool();

    await pool.execute(
      'UPDATE threads_auth SET status = ? WHERE account_id = ?',
      [status, accountId]
    );

    logger.warn(`Marked token status as ${status} for account ${accountId}`);
  }

  /**
   * 從 Threads API 獲取帳號的貼文列表
   * 用於同步歷史貼文到本地資料庫進行統計分析
   */
  async getAccountPosts(
    userId: string,
    accessToken: string,
    limit: number = 50
  ): Promise<Array<{
    id: string;
    media_type: string;
    text?: string;
    timestamp: string;
    permalink: string;
  }>> {
    try {
      logger.info(`Fetching posts from Threads for user ${userId}...`);

      const response = await this.client.get(`/${userId}/threads`, {
        params: {
          fields: 'id,media_type,text,timestamp,permalink',
          limit: limit,
          access_token: accessToken,
        },
      });

      const posts = response.data.data || [];
      logger.info(`✓ Fetched ${posts.length} posts from Threads`);

      return posts;
    } catch (error: any) {
      logger.error('Failed to fetch Threads posts:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * 從 Threads API 獲取單一貼文的 Insights
   */
  async getPostInsights(
    mediaId: string,
    accessToken: string
  ): Promise<{
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  } | null> {
    try {
      const response = await this.client.get(`/${mediaId}/insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes',
          access_token: accessToken,
        },
      });

      const metrics = response.data.data || [];
      const result = {
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
      };

      metrics.forEach((metric: any) => {
        const name = metric.name as keyof typeof result;
        const value = metric.values?.[0]?.value || 0;
        if (name in result) {
          result[name] = value;
        }
      });

      return result;
    } catch (error: any) {
      logger.warn(`Failed to fetch insights for ${mediaId}:`, error.response?.data?.error?.message || error.message);
      return null;
    }
  }
}

export default new ThreadsService();
