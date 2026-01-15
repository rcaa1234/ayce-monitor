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
    const { postId, stylePreset, topic, keywords, createdBy, engine, scheduledTime, autoScheduleId } = job.data;

    logger.info(`Processing generate job ${job.id} for post ${postId}`);

    try {
      // Update job progress
      await job.updateProgress(10);

      // 如果沒有提供 stylePreset，嘗試從貼文關聯的模板獲取
      let effectiveStylePreset = stylePreset;
      if (!effectiveStylePreset) {
        try {
          const { getPool } = await import('../database/connection');
          const pool = getPool();

          // 步驟 1: 查詢貼文的 template_id
          const [postInfo] = await pool.execute(
            `SELECT template_id FROM posts WHERE id = ?`,
            [postId]
          );
          let templateId = (postInfo as any[])[0]?.template_id;
          logger.info(`[Regenerate] Post ${postId} has template_id: ${templateId}`);

          // 步驟 2: 如果沒有 template_id，嘗試從 daily_auto_schedule 獲取
          if (!templateId) {
            const [scheduleInfo] = await pool.execute(
              `SELECT selected_template_id FROM daily_auto_schedule WHERE post_id = ?`,
              [postId]
            );
            if ((scheduleInfo as any[]).length > 0) {
              templateId = (scheduleInfo as any[])[0].selected_template_id;
              logger.info(`[Regenerate] Found template_id from schedule: ${templateId}`);
            }
          }

          // 步驟 3: 用 template_id 查詢模板的 prompt
          if (templateId) {
            const [templates] = await pool.execute(
              `SELECT name, prompt FROM content_templates WHERE id = ?`,
              [templateId]
            );

            if ((templates as any[]).length > 0) {
              const template = (templates as any[])[0];
              effectiveStylePreset = template.prompt;
              logger.info(`[Regenerate] Found template "${template.name}", prompt length: ${effectiveStylePreset?.length || 0}`);
              if (effectiveStylePreset) {
                logger.info(`[Regenerate] Prompt preview: ${effectiveStylePreset.substring(0, 100)}...`);
              }
            } else {
              logger.warn(`[Regenerate] Template ${templateId} not found in content_templates`);
            }
          } else {
            logger.warn(`[Regenerate] Post ${postId} has no template_id and no schedule, using default prompt`);
          }
        } catch (e) {
          logger.error('[Regenerate] Failed to fetch template prompt:', e);
        }
      } else {
        logger.info(`[Regenerate] Using provided stylePreset, length: ${effectiveStylePreset.length}`);
      }

      // ========================================
      // AI 學習功能：注入歷史成功範例
      // ========================================
      let enhancedPrompt = effectiveStylePreset || '';

      try {
        const aiLearningService = (await import('../services/ai-learning.service')).default;

        // 取得成功範例
        const examples = await aiLearningService.getTopPerformingPosts(3);

        if (examples.length > 0) {
          logger.info(`[AI Learning] Found ${examples.length} successful examples to reference`);

          // 如果提示詞中有 {PAST_EXAMPLES} 佔位符，替換它
          if (enhancedPrompt.includes('{PAST_EXAMPLES}')) {
            let examplesText = '\n---\n以下是過去互動最好的貼文範例，請參考風格（但不要直接複製）：\n';

            examples.forEach((ex, idx) => {
              examplesText += `\n【範例 ${idx + 1}】(互動分數: ${ex.engagement_score.toFixed(0)})\n`;
              examplesText += ex.content.substring(0, 300);
              if (ex.content.length > 300) examplesText += '...';
              examplesText += '\n';
            });

            examplesText += '\n---\n請創作一篇新的貼文：';
            enhancedPrompt = enhancedPrompt.replace('{PAST_EXAMPLES}', examplesText);
          } else {
            // 沒有佔位符，自動附加在最後
            enhancedPrompt += '\n\n---\n📊 參考資訊：以下是過去表現最好的貼文風格，可作為參考：\n';
            examples.forEach((ex, idx) => {
              enhancedPrompt += `【範例 ${idx + 1}】${ex.content.substring(0, 150)}...\n`;
            });
          }
        } else {
          logger.info('[AI Learning] No historical examples available yet');
        }
      } catch (learningError) {
        logger.warn('[AI Learning] Failed to get examples, continuing without:', learningError);
      }

      // Generate content with enhanced prompt
      const result = await contentService.generateContent(postId, {
        stylePreset: enhancedPrompt,
        topic,
        keywords,
        engine: engine as any,
      });

      await job.updateProgress(60);

      // ========================================
      // AI 學習功能：自動分類主題
      // ========================================
      try {
        const aiLearningService = (await import('../services/ai-learning.service')).default;
        const { getPool } = await import('../database/connection');
        const pool = getPool();

        // 自動分類內容主題
        const topicCategory = aiLearningService.classifyContent(result.content);

        // 更新 posts 表的 topic_category
        await pool.execute(
          `UPDATE posts SET topic_category = ?, learning_metadata = ? WHERE id = ?`,
          [
            topicCategory,
            JSON.stringify({
              classified_at: new Date().toISOString(),
              prompt_length: enhancedPrompt.length,
              examples_count: 3,
            }),
            postId,
          ]
        );

        logger.info(`[AI Learning] Classified post ${postId} as topic: ${topicCategory}`);
      } catch (classifyError) {
        logger.warn('[AI Learning] Failed to classify content:', classifyError);
      }

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
        scheduledTime,
        autoScheduleId,
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
        scheduledTime: job.returnvalue.scheduledTime,
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
