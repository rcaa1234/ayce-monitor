import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { QUEUE_NAMES, GenerateJobData } from '../services/queue.service';
import contentService from '../services/content.service';
import lineService from '../services/line.service';
import { PostModel } from '../models/post.model';
import { UserModel } from '../models/user.model';
import { AuditModel } from '../models/audit.model';
import { PostStatus } from '../types';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

export const generateWorker = new Worker(
  QUEUE_NAMES.GENERATE,
  async (job: Job<GenerateJobData>) => {
    const { postId, stylePreset, topic, keywords, createdBy, engine } = job.data;

    logger.info(`Processing generate job ${job.id} for post ${postId}`);

    try {
      // Update job progress
      await job.updateProgress(10);

      // Generate content
      const result = await contentService.generateContent(postId, {
        stylePreset,
        topic,
        keywords,
        engine: engine as any,
      });

      await job.updateProgress(60);

      // Find reviewer (user who created the post or default reviewer)
      const creator = await UserModel.findById(createdBy);

      if (!creator || !creator.line_user_id) {
        throw new Error('Creator does not have LINE user ID configured');
      }

      await job.updateProgress(70);

      // Log audit
      await AuditModel.log({
        actor_user_id: createdBy,
        action: 'content_generated',
        target_type: 'post',
        target_id: postId,
        metadata: {
          engine: result.engine,
          similarity_max: result.similarityMax,
          revision_id: result.revisionId,
        },
      });

      await job.updateProgress(100);

      logger.info(`Generate job ${job.id} completed successfully`);

      return {
        success: true,
        postId,
        revisionId: result.revisionId,
        engine: result.engine,
        similarityMax: result.similarityMax,
        lineUserId: creator.line_user_id,
        createdBy,
        content: result.content,
      };
    } catch (error: any) {
      console.error(`❌ [GENERATE WORKER] Job ${job.id} failed with error:`);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Error object:', error);
      logger.error(`Generate job ${job.id} failed:`, error);

      // Update post status to failed
      await PostModel.updateStatus(postId, PostStatus.FAILED, {
        last_error_code: 'GENERATION_ERROR',
        last_error_message: error.message,
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 10,
      duration: 60000, // 10 jobs per minute
    },
  }
);

generateWorker.on('completed', async (job) => {
  logger.info(`Job ${job.id} completed`);

  // Send LINE notification after job completes successfully
  if (job.returnvalue && job.returnvalue.lineUserId) {
    try {
      const lineService = (await import('../services/line.service')).default;
      await lineService.sendReviewRequest({
        reviewerLineUserId: job.returnvalue.lineUserId,
        postId: job.returnvalue.postId,
        revisionId: job.returnvalue.revisionId,
        content: job.returnvalue.content,
        reviewerUserId: job.returnvalue.createdBy,
      });
      logger.info(`Sent review request for job ${job.id} to LINE user ${job.returnvalue.lineUserId}`);
    } catch (error) {
      logger.error(`Failed to send LINE notification for job ${job.id}:`, error);
    }
  }
});

generateWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

export default generateWorker;
