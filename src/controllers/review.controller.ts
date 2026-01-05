import { Request, Response } from 'express';
import lineService from '../services/line.service';
import contentService from '../services/content.service';
import { PostModel } from '../models/post.model';
import queueService from '../services/queue.service';
import { AuditModel } from '../models/audit.model';
import { PostStatus } from '../types';
import logger from '../utils/logger';

export class ReviewController {
  /**
   * Handle approve action from LINE
   */
  async approve(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.query;
      const lineUserId = req.body.lineUserId || req.query.lineUserId;

      if (!token || !lineUserId) {
        res.status(400).json({ error: 'Missing token or LINE user ID' });
        return;
      }

      // Validate token
      const reviewRequest = await lineService.validateReviewToken(
        token as string,
        lineUserId as string
      );

      if (!reviewRequest) {
        res.status(400).json({ error: 'Invalid or expired review token' });
        return;
      }

      // Mark as used
      await lineService.markReviewUsed(reviewRequest.id);

      // Update post status
      await PostModel.updateStatus(reviewRequest.post_id, PostStatus.APPROVED, {
        approved_by: reviewRequest.reviewer_user_id,
        approved_at: new Date(),
      });

      // 檢查是否為自動排程的貼文
      const { getPool } = await import('../database/connection');
      const pool = getPool();
      const [schedules] = await pool.execute<any[]>(
        `SELECT id, scheduled_time FROM daily_auto_schedule WHERE post_id = ? AND status = 'GENERATED'`,
        [reviewRequest.post_id]
      );

      let responseMessage = '';
      let notificationMessage = '';

      if (schedules.length > 0) {
        // 這是自動排程的貼文，更新排程狀態為 APPROVED，等待排程時間到達後發布
        await pool.execute(
          `UPDATE daily_auto_schedule SET status = 'APPROVED', updated_at = NOW() WHERE post_id = ?`,
          [reviewRequest.post_id]
        );

        const scheduledTime = new Date(schedules[0].scheduled_time);
        const formattedTime = scheduledTime.toLocaleString('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });

        responseMessage = `✓ 已審核通過！將於 ${formattedTime} 自動發布。`;
        notificationMessage = `✓ 文章已審核通過！\n📅 將於 ${formattedTime} 自動發布到 Threads`;
      } else {
        // 非自動排程的貼文，立即發布
        await queueService.addPublishJob({
          postId: reviewRequest.post_id,
          revisionId: reviewRequest.revision_id,
        });

        responseMessage = '✓ 已審核通過！正在發布中...';
        notificationMessage = '✓ Post approved and publishing now!';
      }

      // Log audit
      await AuditModel.log({
        actor_user_id: reviewRequest.reviewer_user_id,
        action: 'post_approved_via_line',
        target_type: 'post',
        target_id: reviewRequest.post_id,
        metadata: { revision_id: reviewRequest.revision_id },
      });

      // Send confirmation
      await lineService.sendNotification(
        lineUserId as string,
        notificationMessage
      );

      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>${responseMessage}</h1>
            <p>You can close this page now.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      logger.error('Failed to approve:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle regenerate action from LINE
   */
  async regenerate(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.query;
      const lineUserId = req.body.lineUserId || req.query.lineUserId;

      if (!token || !lineUserId) {
        res.status(400).json({ error: 'Missing token or LINE user ID' });
        return;
      }

      // Validate token
      const reviewRequest = await lineService.validateReviewToken(
        token as string,
        lineUserId as string
      );

      if (!reviewRequest) {
        res.status(400).json({ error: 'Invalid or expired review token' });
        return;
      }

      // Mark as used
      await lineService.markReviewUsed(reviewRequest.id);

      // Trigger regeneration
      await queueService.addGenerateJob({
        postId: reviewRequest.post_id,
        createdBy: reviewRequest.reviewer_user_id,
      });

      // Log audit
      await AuditModel.log({
        actor_user_id: reviewRequest.reviewer_user_id,
        action: 'post_regenerate_requested',
        target_type: 'post',
        target_id: reviewRequest.post_id,
      });

      // Send confirmation
      await lineService.sendNotification(
        lineUserId as string,
        '↻ Regenerating content... You will receive a new review request shortly.'
      );

      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>↻ Regenerating...</h1>
            <p>New content is being generated.</p>
            <p>You will receive a new review request on LINE.</p>
            <p>You can close this page now.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      logger.error('Failed to regenerate:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle skip action from LINE
   */
  async skip(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.query;
      const lineUserId = req.body.lineUserId || req.query.lineUserId;

      if (!token || !lineUserId) {
        res.status(400).json({ error: 'Missing token or LINE user ID' });
        return;
      }

      // Validate token
      const reviewRequest = await lineService.validateReviewToken(
        token as string,
        lineUserId as string
      );

      if (!reviewRequest) {
        res.status(400).json({ error: 'Invalid or expired review token' });
        return;
      }

      // Mark as used
      await lineService.markReviewUsed(reviewRequest.id);

      // Update post status
      await PostModel.updateStatus(reviewRequest.post_id, PostStatus.SKIPPED);

      // Log audit
      await AuditModel.log({
        actor_user_id: reviewRequest.reviewer_user_id,
        action: 'post_skipped_via_line',
        target_type: 'post',
        target_id: reviewRequest.post_id,
      });

      // Send confirmation
      await lineService.sendNotification(
        lineUserId as string,
        '⊘ Post skipped.'
      );

      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>⊘ Skipped</h1>
            <p>Post has been skipped.</p>
            <p>You can close this page now.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      logger.error('Failed to skip:', error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ReviewController();
