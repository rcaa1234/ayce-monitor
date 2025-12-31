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
