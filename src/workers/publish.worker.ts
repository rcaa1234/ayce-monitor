import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { QUEUE_NAMES, PublishJobData } from '../services/queue.service';
import threadsService from '../services/threads.service';
import { PostModel } from '../models/post.model';
import { AuditModel } from '../models/audit.model';
import { PostStatus, ErrorCode } from '../types';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

// Transient error patterns that should be retried
const TRANSIENT_ERROR_PATTERNS = [
  'rate limit',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'network',
  'timeout',
  'socket hang up',
  '429',
  '502',
  '503',
  '504',
];

function isTransientError(error: any): boolean {
  const message = (error.message || '').toLowerCase();
  const code = (error.code || '').toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some(
    (pattern) => message.includes(pattern.toLowerCase()) || code.includes(pattern.toLowerCase())
  );
}

export const publishWorker = new Worker(
  QUEUE_NAMES.PUBLISH,
  async (job: Job<PublishJobData>) => {
    const { postId, revisionId, accountId } = job.data;

    logger.info(`Processing publish job ${job.id} for post ${postId}`);

    try {
      const pool = getPool();

      // === Optimistic locking: SELECT FOR UPDATE within transaction ===
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Lock the post row and verify status
        const [lockedRows] = await conn.execute<RowDataPacket[]>(
          'SELECT status FROM posts WHERE id = ? FOR UPDATE',
          [postId]
        );

        if (lockedRows.length === 0) {
          await conn.rollback();
          throw new Error('Post not found');
        }

        const currentStatus = lockedRows[0].status;

        // If already publishing or posted, skip
        if (currentStatus === PostStatus.PUBLISHING || currentStatus === PostStatus.POSTED) {
          await conn.rollback();
          logger.warn(`Post ${postId} is already ${currentStatus}, skipping`);
          return { success: false, reason: `already_${currentStatus.toLowerCase()}` };
        }

        // Update status to PUBLISHING within the same transaction
        await conn.execute(
          'UPDATE posts SET status = ?, updated_at = NOW() WHERE id = ?',
          [PostStatus.PUBLISHING, postId]
        );

        await conn.commit();
      } catch (lockError) {
        await conn.rollback();
        throw lockError;
      } finally {
        conn.release();
      }

      await job.updateProgress(20);

      // Get revision content
      const revision = await PostModel.findRevisionById(revisionId);

      if (!revision) {
        throw new Error('Revision not found');
      }

      await job.updateProgress(30);

      // Get Threads account and token
      const accountData = await threadsService.getDefaultAccount();

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

      // === Post-publish updates wrapped in transaction ===
      const postConn = await pool.getConnection();
      try {
        await postConn.beginTransaction();

        // Update post status to POSTED
        await postConn.execute(
          `UPDATE posts SET status = ?, posted_at = ?, post_url = ?, threads_media_id = ?, updated_at = NOW() WHERE id = ?`,
          [PostStatus.POSTED, new Date(), publishResult.permalink, publishResult.id, postId]
        );

        // Update daily_auto_schedule status to COMPLETED
        await postConn.execute(
          `UPDATE daily_auto_schedule SET status = 'COMPLETED', updated_at = NOW() WHERE post_id = ?`,
          [postId]
        );

        await postConn.commit();
      } catch (txError) {
        await postConn.rollback();
        // CRITICAL: Threads post was published but DB update failed
        logger.error(`CRITICAL: Post ${postId} was published to Threads (${publishResult.permalink}) but DB update failed:`, txError);
        throw txError;
      } finally {
        postConn.release();
      }

      // Immediately update template usage stats (non-critical)
      try {
        const [postRows] = await pool.execute<RowDataPacket[]>(
          `SELECT template_id FROM posts WHERE id = ?`,
          [postId]
        );

        const templateId = (postRows as any[])[0]?.template_id;

        if (templateId) {
          const [stats] = await pool.execute<RowDataPacket[]>(
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

          logger.info(`Updated template ${templateId} stats after publish: ${statsData.total_uses} uses`);
        }
      } catch (statsError) {
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

      // Transient errors: revert to APPROVED so BullMQ can retry
      if (isTransientError(error)) {
        logger.warn(`Transient error for post ${postId}, reverting to APPROVED for retry`);
        await PostModel.updateStatus(postId, PostStatus.APPROVED);
      } else {
        // Permanent errors: mark as FAILED
        await PostModel.updateStatus(postId, PostStatus.FAILED, {
          last_error_code: errorCode,
          last_error_message: error.message,
        });
      }

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

publishWorker.on('failed', async (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);

  // Move to dead-letter queue if retries exhausted
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    try {
      const { deadLetterQueue } = await import('../services/queue.service');
      await deadLetterQueue.add('dead-letter', {
        originalQueue: QUEUE_NAMES.PUBLISH,
        originalJobId: job.id,
        originalData: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
      });
      logger.warn(`Publish job ${job.id} moved to dead-letter queue after ${job.attemptsMade} attempts`);
    } catch (dlqError) {
      logger.error(`Failed to move job ${job.id} to dead-letter queue:`, dlqError);
    }
  }
});

export default publishWorker;
