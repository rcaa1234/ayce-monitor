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
    const { postId, stylePreset, topic, keywords, createdBy } = job.data;

    logger.info(`Processing generate job ${job.id} for post ${postId}`);

    try {
      // Update job progress
      await job.updateProgress(10);

      // Generate content
      const result = await contentService.generateContent(postId, {
        stylePreset,
        topic,
        keywords,
      });

      await job.updateProgress(60);

      // Find reviewer (user who created the post or default reviewer)
      const creator = await UserModel.findById(createdBy);

      if (!creator || !creator.line_user_id) {
        throw new Error('Creator does not have LINE user ID configured');
      }

      await job.updateProgress(70);

      // Send review request to LINE
      await lineService.sendReviewRequest({
        reviewerLineUserId: creator.line_user_id,
        postId,
        revisionId: result.revisionId,
        content: result.content,
        reviewerUserId: createdBy,
      });

      await job.updateProgress(90);

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
      };
    } catch (error: any) {
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

generateWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

generateWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

export default generateWorker;
