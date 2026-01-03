import { Client, FlexMessage, FlexBubble, WebhookEvent } from '@line/bot-sdk';
import config from '../config';
import logger from '../utils/logger';
import { getPool } from '../database/connection';
import { generateUUID } from '../utils/uuid';
import { ReviewStatus } from '../types';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import crypto from 'crypto';

class LineService {
  private client: Client;

  constructor() {
    this.client = new Client({
      channelAccessToken: config.line.channelAccessToken,
      channelSecret: config.line.channelSecret,
    });
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
  }): Promise<string> {
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
      data.reviewerLineUserId
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
    lineUserId: string
  ): FlexMessage {
    const baseUrl = config.app.baseUrl;
    const approveUrl = `${baseUrl}/api/review/approve?token=${token}&lineUserId=${lineUserId}`;
    const regenerateUrl = `${baseUrl}/api/review/regenerate?token=${token}&lineUserId=${lineUserId}`;
    const skipUrl = `${baseUrl}/api/review/skip?token=${token}&lineUserId=${lineUserId}`;

    const bubble: FlexBubble = {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'Threads 文章審核',
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
        contents: [
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
          },
        ],
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
