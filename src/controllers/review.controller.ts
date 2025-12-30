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

      // Add to publish queue
      await queueService.addPublishJob({
        postId: reviewRequest.post_id,
        revisionId: reviewRequest.revision_id,
      });

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
        '✓ Post approved and scheduled for publishing!'
      );

      res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>✓ Approved!</h1>
            <p>Post has been approved and will be published shortly.</p>
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
