import { Client, FlexMessage, FlexBubble, WebhookEvent } from '@line/bot-sdk';
import config from '../config';
import logger from '../utils/logger';
import { getPool } from '../database/connection';
import { generateUUID } from '../utils/uuid';
import { ReviewStatus } from '../types';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import crypto from 'crypto';

class LineService {
  private client: Client | null;

  constructor() {
    // LINE Bot is optional - only initialize if credentials are provided
    if (config.line.channelAccessToken && config.line.channelSecret) {
      this.client = new Client({
        channelAccessToken: config.line.channelAccessToken,
        channelSecret: config.line.channelSecret,
      });
    } else {
      this.client = null;
      logger.warn('LINE Bot credentials not configured - LINE features will be disabled');
    }
  }

  /**
   * Send review request to reviewer
   */
  async sendReviewRequest(data: {
    reviewerLineUserId: string;
    postId: string;
    revisionId: string;
    content: string;
    reviewerUserId: string;
    scheduledTime?: string;  // ISO 8601 格式的排程時間（可選）
  }): Promise<string> {
    if (!this.client) {
      throw new Error('LINE Bot is not configured');
    }

    const pool = getPool();
    const requestId = generateUUID();
    const token = this.generateReviewToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save review request
    await pool.execute<ResultSetHeader>(
      `INSERT INTO review_requests
       (id, post_id, revision_id, token, reviewer_user_id, status, expires_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [requestId, data.postId, data.revisionId, token, data.reviewerUserId, expiresAt]
    );

    // Create Flex Message
    const flexMessage = this.createReviewFlexMessage(
      data.content,
      token,
      data.postId,
      data.revisionId,
      data.reviewerLineUserId,
      data.scheduledTime
    );

    // Send to LINE user
    try {
      await this.client.pushMessage(data.reviewerLineUserId, flexMessage);
      logger.info(`Sent review request ${requestId} to LINE user ${data.reviewerLineUserId}`);
      return requestId;
    } catch (error) {
      logger.error('Failed to send LINE message:', error);
      throw error;
    }
  }

  /**
   * Create Flex Message for review
   */
  private createReviewFlexMessage(
    content: string,
    token: string,
    postId: string,
    revisionId: string,
    lineUserId: string,
    scheduledTime?: string
  ): FlexMessage {
    const baseUrl = config.app.baseUrl;
    const approveUrl = `${baseUrl}/api/review/approve?token=${token}&lineUserId=${lineUserId}`;
    const regenerateUrl = `${baseUrl}/api/review/regenerate?token=${token}&lineUserId=${lineUserId}`;
    const skipUrl = `${baseUrl}/api/review/skip?token=${token}&lineUserId=${lineUserId}`;

    // 格式化排程時間顯示
    let scheduledTimeText = '';
    if (scheduledTime) {
      const scheduleDate = new Date(scheduledTime);
      scheduledTimeText = scheduleDate.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    // 建立 body 內容
    const bodyContents: any[] = [];

    // 如果有排程時間，顯示在最上方
    if (scheduledTime) {
      bodyContents.push(
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            {
              type: 'text',
              text: '⏰ 預計發文時間',
              weight: 'bold',
              size: 'sm',
              color: '#0084ff',
              flex: 0,
            },
          ],
          margin: 'md',
        },
        {
          type: 'text',
          text: scheduledTimeText,
          size: 'lg',
          weight: 'bold',
          color: '#111111',
          margin: 'sm',
        },
        {
          type: 'separator',
          margin: 'lg',
        }
      );
    }

    // 內容預覽
    bodyContents.push(
      {
        type: 'text',
        text: '📝 內容預覽',
        weight: 'bold',
        size: 'md',
        margin: 'md',
      },
      {
        type: 'text',
        text: content.substring(0, 300) + (content.length > 300 ? '...' : ''),
        wrap: true,
        size: 'sm',
        margin: 'md',
      },
      {
        type: 'separator',
        margin: 'xl',
      },
      {
        type: 'text',
        text: '請選擇動作：',
        size: 'sm',
        margin: 'md',
      }
    );

    const bubble: FlexBubble = {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: scheduledTime ? '📅 Threads 排程預審' : 'Threads 文章審核',
            weight: 'bold',
            size: 'xl',
            color: '#ffffff',
          },
        ],
        backgroundColor: '#0084ff',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: '✓ 確認並發布',
              uri: approveUrl,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: '🔄 重新生成',
              uri: regenerateUrl,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'uri',
              label: '⊘ 跳過',
              uri: skipUrl,
            },
          },
        ],
      },
    };

    return {
      type: 'flex',
      altText: 'Threads Post Review Request',
      contents: bubble,
    };
  }

  /**
   * Validate review token and get request
   */
  async validateReviewToken(
    token: string,
    lineUserId: string
  ): Promise<{
    id: string;
    post_id: string;
    revision_id: string;
    reviewer_user_id: string;
  } | null> {
    const pool = getPool();

    // Debug: 先查詢 token 是否存在（不考慮其他條件）
    const [debugRows] = await pool.execute<RowDataPacket[]>(
      `SELECT rr.id, rr.status, rr.expires_at, u.line_user_id as db_line_user_id
       FROM review_requests rr
       LEFT JOIN users u ON rr.reviewer_user_id = u.id
       WHERE rr.token = ?`,
      [token]
    );

    if (debugRows.length === 0) {
      logger.warn(`[validateReviewToken] Token not found in database: ${token.substring(0, 20)}...`);
    } else {
      const debug = debugRows[0];
      logger.info(`[validateReviewToken] Token found. Status: ${debug.status}, Expires: ${debug.expires_at}, DB Line ID: ${debug.db_line_user_id}, Request Line ID: ${lineUserId}`);

      if (debug.status !== 'PENDING') {
        logger.warn(`[validateReviewToken] Token already used or cancelled. Status: ${debug.status}`);
      }
      if (debug.db_line_user_id !== lineUserId) {
        logger.warn(`[validateReviewToken] LINE User ID mismatch. DB: ${debug.db_line_user_id}, Request: ${lineUserId}`);
      }
      if (new Date(debug.expires_at) <= new Date()) {
        logger.warn(`[validateReviewToken] Token expired. Expires: ${debug.expires_at}, Now: ${new Date().toISOString()}`);
      }
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT rr.* FROM review_requests rr
       INNER JOIN users u ON rr.reviewer_user_id = u.id
       WHERE rr.token = ? AND u.line_user_id = ? AND rr.status = 'PENDING'
       AND rr.expires_at > NOW()`,
      [token, lineUserId]
    );

    if (rows.length === 0) {
      return null;
    }

    return rows[0] as any;
  }

  /**
   * Mark review request as used
   */
  async markReviewUsed(requestId: string): Promise<void> {
    const pool = getPool();

    await pool.execute(
      `UPDATE review_requests SET status = 'USED', used_at = NOW() WHERE id = ?`,
      [requestId]
    );
  }

  /**
   * Cancel review request
   */
  async cancelReview(requestId: string): Promise<void> {
    const pool = getPool();

    await pool.execute(
      `UPDATE review_requests SET status = 'CANCELLED' WHERE id = ?`,
      [requestId]
    );
  }

  /**
   * Generate secure review token
   */
  private generateReviewToken(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Send notification message
   */
  async sendNotification(lineUserId: string, message: string): Promise<void> {
    if (!this.client) {
      logger.warn('LINE Bot is not configured - notification not sent');
      return;
    }

    try {
      await this.client.pushMessage(lineUserId, {
        type: 'text',
        text: message,
      });
      logger.info(`Sent notification to LINE user ${lineUserId}`);
    } catch (error) {
      logger.error('Failed to send LINE notification:', error);
      throw error;
    }
  }

  /**
   * Send Flex Message
   */
  async sendFlexMessage(lineUserId: string, bubble: FlexBubble): Promise<void> {
    if (!this.client) {
      logger.warn('LINE Bot is not configured - Flex message not sent');
      return;
    }

    try {
      const flexMessage: FlexMessage = {
        type: 'flex',
        altText: 'Threads Post Notification',
        contents: bubble,
      };

      await this.client.pushMessage(lineUserId, flexMessage);
      logger.info(`Sent Flex message to LINE user ${lineUserId}`);
    } catch (error) {
      logger.error('Failed to send LINE Flex message:', error);
      throw error;
    }
  }

  /**
   * Verify LINE webhook signature
   */
  verifySignature(body: string, signature: string): boolean {
    const hash = crypto
      .createHmac('SHA256', config.line.channelSecret)
      .update(body)
      .digest('base64');

    return hash === signature;
  }
}

export default new LineService();
