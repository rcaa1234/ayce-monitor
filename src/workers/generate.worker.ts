import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { QUEUE_NAMES, GenerateJobData } from '../services/queue.service';
import contentService from '../services/content.service';
import { PostModel } from '../models/post.model';
import { UserModel } from '../models/user.model';
import { AuditModel } from '../models/audit.model';
import { PostStatus } from '../types';

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

// 最大重試次數
const MAX_RETRIES = 3;

export const generateWorker = new Worker(
  QUEUE_NAMES.GENERATE,
  async (job: Job<GenerateJobData>) => {
    const { postId, stylePreset, topic, keywords, createdBy, engine, scheduledTime, autoScheduleId } = job.data;

    logger.info(`Processing generate job ${job.id} for post ${postId}`);

    try {
      // Update job progress
      await job.updateProgress(10);

      const { getPool } = await import('../database/connection');
      const pool = getPool();

      // ========================================
      // 第一步：生成 Generation Plan
      // ========================================
      const plannerService = (await import('../services/planner.service')).default;
      const promptBuilderService = (await import('../services/prompt-builder.service')).default;
      const postCheckService = (await import('../services/post-check.service')).default;

      const plan = await plannerService.generatePlan();
      logger.info(`[Planner] Generated plan for post ${postId}`);

      // 取得今日話題上下文（從內容推薦引擎）
      const topicContext = await promptBuilderService.getTodayTopicContext();
      if (topicContext) {
        logger.info(`[TopicContext] Loaded topic: ${topicContext.topicTitle} (relevance: ${(topicContext.relevanceScore * 100).toFixed(0)}%)`);
      }

      await job.updateProgress(20);

      // ========================================
      // 第二步：組裝提示詞
      // ========================================
      // 取得 Master Prompt（用戶設定的提示詞）
      let masterPrompt = stylePreset || '';

      if (!masterPrompt) {
        // 從配置取得
        const [configs] = await pool.execute<any[]>(
          'SELECT ai_prompt FROM smart_schedule_config WHERE enabled = true LIMIT 1'
        );
        if (configs.length > 0 && configs[0].ai_prompt) {
          masterPrompt = configs[0].ai_prompt;
        }
      }

      // 組裝完整提示詞（含話題上下文）
      const fullPrompt = await promptBuilderService.buildFullPrompt(masterPrompt, plan, topicContext);
      logger.info(`[PromptBuilder] Built prompt with ${fullPrompt.length} chars${topicContext ? ' (with topic context)' : ''}`);

      await job.updateProgress(30);

      // ========================================
      // 第三步：生成內容（含重試機制）
      // ========================================
      let result: any = null;
      let checkResult: any = null;
      let retryCount = 0;

      // 取得最近貼文用於相似度檢查
      const recentSummaries = await plannerService.getRecentPostsSummary(15);

      while (retryCount <= MAX_RETRIES) {
        let promptToUse = fullPrompt;

        // 如果是重試，加入修正指令
        if (retryCount > 0 && checkResult) {
          const fixPrompt = postCheckService.generateFixPrompt(checkResult, plan);
          promptToUse = fullPrompt + '\n\n' + fixPrompt;
          logger.info(`[PostCheck] Retry ${retryCount}/${MAX_RETRIES} with fix instructions`);
        }

        // 生成內容
        result = await contentService.generateContent(postId, {
          stylePreset: promptToUse,
          topic,
          keywords,
          engine: engine as any,
        });

        // 檢查生成結果
        checkResult = postCheckService.checkContent(result.content, plan, recentSummaries);

        if (checkResult.passed) {
          logger.info(`[PostCheck] Content passed all checks`);
          break;
        }

        logger.warn(`[PostCheck] Content failed: ${checkResult.issues.join(', ')}`);
        retryCount++;

        if (retryCount > MAX_RETRIES) {
          logger.warn(`[PostCheck] Max retries reached, using last result`);
        }
      }

      await job.updateProgress(70);

      // ========================================
      // 第四步：儲存 Generation Plan 和檢測結果
      // ========================================
      try {
        await pool.execute(
          `UPDATE posts SET
            topic_category = ?,
            generation_plan = ?,
            used_topic_id = ?,
            angle = ?,
            outlet = ?,
            tone_bias = ?,
            ending_style = ?,
            length_target = ?,
            risk_flags = ?,
            post_check_result = ?,
            retry_count = ?
          WHERE id = ?`,
          [
            plan.module,
            JSON.stringify(plan),
            topicContext?.topicId || null,
            plan.angle || null,
            plan.outlet,
            plan.toneBias,
            plan.endingStyle,
            plan.lengthTarget,
            JSON.stringify(checkResult?.riskFlags || []),
            JSON.stringify(checkResult),
            retryCount,
            postId,
          ]
        );
        logger.info(`[DB] Saved generation plan and check result for post ${postId}${topicContext ? ` (topic: ${topicContext.topicTitle})` : ''}`);
      } catch (dbError) {
        logger.warn('[DB] Failed to save generation plan:', dbError);
      }

      await job.updateProgress(80);

      // Find reviewer (user who created the post or default reviewer)
      const creator = await UserModel.findById(createdBy);

      if (!creator || !creator.line_user_id) {
        throw new Error('Creator does not have LINE user ID configured');
      }

      // 標記話題為已使用（如果有使用話題上下文）
      if (topicContext && checkResult?.passed) {
        try {
          await promptBuilderService.markTopicAsUsed(topicContext.topicId, postId);
          logger.info(`[TopicContext] Marked topic ${topicContext.topicId} as used for post ${postId}`);
        } catch (topicError) {
          logger.warn(`[TopicContext] Failed to mark topic as used:`, topicError);
        }
      }

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
          plan: plan,
          check_passed: checkResult?.passed,
          retry_count: retryCount,
          topic_context: topicContext ? {
            topicId: topicContext.topicId,
            topicTitle: topicContext.topicTitle,
            relevanceScore: topicContext.relevanceScore,
          } : null,
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
        scheduledTime,
        autoScheduleId,
        plan,
        checkResult,
        retryCount,
        topicContext: topicContext ? {
          topicId: topicContext.topicId,
          topicTitle: topicContext.topicTitle,
          relevanceScore: topicContext.relevanceScore,
        } : null,
      };
    } catch (error: any) {
      console.error(`❌ [GENERATE WORKER] Job ${job.id} failed with error:`);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
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
        scheduledTime: job.returnvalue.scheduledTime,
      });
      logger.info(`Sent review request for job ${job.id} to LINE user ${job.returnvalue.lineUserId}`);
    } catch (error) {
      logger.error(`Failed to send LINE notification for job ${job.id}:`, error);
    }
  }
});

generateWorker.on('failed', async (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);

  // Move to dead-letter queue if retries exhausted
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    try {
      const { deadLetterQueue } = await import('../services/queue.service');
      await deadLetterQueue.add('dead-letter', {
        originalQueue: QUEUE_NAMES.GENERATE,
        originalJobId: job.id,
        originalData: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
        attemptsMade: job.attemptsMade,
      });
      logger.warn(`Generate job ${job.id} moved to dead-letter queue after ${job.attemptsMade} attempts`);
    } catch (dlqError) {
      logger.error(`Failed to move job ${job.id} to dead-letter queue:`, dlqError);
    }
  }
});

export default generateWorker;
