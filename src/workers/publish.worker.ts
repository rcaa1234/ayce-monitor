import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { QUEUE_NAMES, PublishJobData } from '../services/queue.service';
import threadsService from '../services/threads.service';
import { PostModel } from '../models/post.model';
import { AuditModel } from '../models/audit.model';
import { PostStatus, ErrorCode } from '../types';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const publishWorker = new Worker(
  QUEUE_NAMES.PUBLISH,
  async (job: Job<PublishJobData>) => {
    const { postId, revisionId, accountId } = job.data;

    logger.info(`Processing publish job ${job.id} for post ${postId}`);

    try {
      // Check if post is already being published (prevent duplicate publishing)
      const post = await PostModel.findById(postId);

      if (!post) {
        throw new Error('Post not found');
      }

      if (post.status === PostStatus.PUBLISHING) {
        logger.warn(`Post ${postId} is already being published`);
        return { success: false, reason: 'already_publishing' };
      }

      if (post.status === PostStatus.POSTED) {
        logger.warn(`Post ${postId} is already posted`);
        return { success: false, reason: 'already_posted' };
      }

      await job.updateProgress(10);

      // Update status to PUBLISHING (acts as a lock)
      await PostModel.updateStatus(postId, PostStatus.PUBLISHING);

      await job.updateProgress(20);

      // Get revision content
      const revision = await PostModel.findRevisionById(revisionId);

      if (!revision) {
        throw new Error('Revision not found');
      }

      await job.updateProgress(30);

      // Get Threads account and token
      const accountData = accountId
        ? await threadsService.getDefaultAccount() // For now, always use default
        : await threadsService.getDefaultAccount();

      if (!accountData) {
        throw new Error('No active Threads account found');
      }

      await job.updateProgress(50);

      // Publish to Threads
      const publishResult = await threadsService.createPost(
        accountData.account.account_id,
        accountData.token,
        revision.content,
        accountData.account.username
      );

      await job.updateProgress(80);

      // Update post status to POSTED
      await PostModel.updateStatus(postId, PostStatus.POSTED, {
        posted_at: new Date(),
        post_url: publishResult.permalink,
        threads_media_id: publishResult.id, // Store the Threads Media ID for insights
      });

      // Update daily_auto_schedule status to COMPLETED (if this post was from auto-scheduling)
      try {
        const { getPool } = await import('../database/connection');
        const pool = getPool();
        await pool.execute(
          `UPDATE daily_auto_schedule SET status = 'COMPLETED', updated_at = NOW() WHERE post_id = ?`,
          [postId]
        );
      } catch (scheduleError) {
        // Non-critical error, just log it
        logger.warn(`Failed to update schedule status for post ${postId}:`, scheduleError);
      }

      // Immediately update template usage stats
      try {
        const { getPool } = await import('../database/connection');
        const pool = getPool();

        // Get the template_id from the post
        const [postRows] = await pool.execute(
          `SELECT template_id FROM posts WHERE id = ?`,
          [postId]
        );

        const templateId = (postRows as any[])[0]?.template_id;

        if (templateId) {
          // Update template usage count
          // This counts all POSTED posts with this template_id
          const [stats] = await pool.execute(
            `SELECT 
               COUNT(*) as total_uses,
               AVG(pi.engagement_rate) as avg_engagement_rate
             FROM posts p
             LEFT JOIN post_insights pi ON p.id = pi.post_id
             WHERE p.template_id = ?
               AND p.status = 'POSTED'`,
            [templateId]
          );

          const statsData = (stats as any[])[0];

          await pool.execute(
            `UPDATE content_templates
             SET total_uses = ?,
                 avg_engagement_rate = COALESCE(?, avg_engagement_rate)
             WHERE id = ?`,
            [
              statsData.total_uses || 0,
              statsData.avg_engagement_rate || null,
              templateId
            ]
          );

          logger.info(`✓ Updated template ${templateId} stats after publish: ${statsData.total_uses} uses`);
        }
      } catch (statsError) {
        // Non-critical error, just log it
        logger.warn(`Failed to update template stats after publish:`, statsError);
      }

      await job.updateProgress(90);

      // Log audit
      await AuditModel.log({
        action: 'post_published',
        target_type: 'post',
        target_id: postId,
        metadata: {
          revision_id: revisionId,
          account_id: accountData.account.id,
          post_url: publishResult.permalink,
          threads_post_id: publishResult.id,
        },
      });

      await job.updateProgress(100);

      logger.info(`Publish job ${job.id} completed successfully`);

      return {
        success: true,
        postId,
        postUrl: publishResult.permalink,
        threadsPostId: publishResult.id,
      };
    } catch (error: any) {
      logger.error(`Publish job ${job.id} failed:`, error);

      // Determine error code
      let errorCode = ErrorCode.UNKNOWN_ERROR;
      if (error.message.includes('token') || error.message.includes('auth')) {
        errorCode = ErrorCode.TOKEN_EXPIRED;
      } else if (error.message.includes('permission')) {
        errorCode = ErrorCode.PERMISSION_ERROR;
      } else if (error.message.includes('rate limit')) {
        errorCode = ErrorCode.RATE_LIMIT;
      } else if (error.message.includes('network') || error.code === 'ECONNREFUSED') {
        errorCode = ErrorCode.NETWORK_ERROR;
      }

      // Update post status to FAILED
      await PostModel.updateStatus(postId, PostStatus.FAILED, {
        last_error_code: errorCode,
        last_error_message: error.message,
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 1, // Only 1 concurrent publish to avoid rate limits
    limiter: {
      max: 5,
      duration: 60000, // 5 jobs per minute
    },
  }
);

publishWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

publishWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

export default publishWorker;
