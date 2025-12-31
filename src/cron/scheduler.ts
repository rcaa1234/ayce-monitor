import cron from 'node-cron';
import logger from '../utils/logger';
import queueService from '../services/queue.service';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import config from '../config';
import { PostStatus } from '../types';

// Store dynamic schedule jobs
const scheduleJobs: cron.ScheduledTask[] = [];

/**
 * Generate content based on settings
 */
async function generateScheduledContent() {
  logger.info('Running scheduled content generation...');

  try {
    // Get settings
    const { SettingsModel } = await import('../models/settings.model');
    const aiEngine = await SettingsModel.get('ai_engine');
    const customPrompt = await SettingsModel.get('custom_prompt');
    const lineNotifyUserId = await SettingsModel.get('line_notify_user_id');

    // Find user by LINE User ID from settings, or fallback to content_creator
    const pool = getPool();
    let creatorId: string;

    if (lineNotifyUserId) {
      // Find user by LINE User ID
      const [users] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE line_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [lineNotifyUserId]
      );

      if (users.length > 0) {
        creatorId = users[0].id;
        logger.info(`Using LINE notify user (${lineNotifyUserId}) as creator`);
      } else {
        logger.warn(`LINE User ID ${lineNotifyUserId} not found, using fallback`);
        // Fallback to content_creator
        const [fallbackUsers] = await pool.execute<RowDataPacket[]>(
          `SELECT u.id FROM users u
           INNER JOIN user_roles ur ON u.id = ur.user_id
           INNER JOIN roles r ON ur.role_id = r.id
           WHERE r.name = 'content_creator' AND u.status = 'ACTIVE'
           LIMIT 1`
        );

        if (fallbackUsers.length === 0) {
          logger.error('No active content creator found and LINE user not found');
          return;
        }
        creatorId = fallbackUsers[0].id;
      }
    } else {
      // No LINE User ID set, use content_creator
      const [users] = await pool.execute<RowDataPacket[]>(
        `SELECT u.id FROM users u
         INNER JOIN user_roles ur ON u.id = ur.user_id
         INNER JOIN roles r ON ur.role_id = r.id
         WHERE r.name = 'content_creator' AND u.status = 'ACTIVE'
         LIMIT 1`
      );

      if (users.length === 0) {
        logger.warn('No active content creator found and no LINE User ID configured');
        return;
      }
      creatorId = users[0].id;
    }

    // Create a new post and trigger generation
    const { PostModel } = await import('../models/post.model');
    const post = await PostModel.create({
      created_by: creatorId,
      status: PostStatus.DRAFT,
    });

    await queueService.addGenerateJob({
      postId: post.id,
      createdBy: creatorId,
      stylePreset: customPrompt,
      engine: aiEngine,
    });

    logger.info(`Scheduled generation job created for post ${post.id} using ${aiEngine}`);
  } catch (error) {
    logger.error('Scheduled generation failed:', error);
  }
}

/**
 * Initialize dynamic schedule from settings
 */
/**
 * Initialize or reload dynamic schedule from settings
 * This function is exported so it can be called when settings are updated
 */
export async function initializeDynamicSchedule() {
  try {
    const { SettingsModel } = await import('../models/settings.model');
    const scheduleConfig = await SettingsModel.get('schedule_config');

    if (!scheduleConfig) {
      logger.warn('No schedule configuration found, using default');
      return;
    }

    // Clear existing schedule jobs
    scheduleJobs.forEach(job => job.stop());
    scheduleJobs.length = 0;

    // Create cron jobs for each enabled day
    const dayMap: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };

    for (const [day, dayConfig] of Object.entries(scheduleConfig)) {
      const config = dayConfig as { enabled: boolean; time: string };
      if (config.enabled) {
        const [hour, minute] = config.time.split(':');
        const dayOfWeek = dayMap[day];

        // Cron format: minute hour day month dayOfWeek
        const cronExpression = `${minute} ${hour} * * ${dayOfWeek}`;

        const job = cron.schedule(cronExpression, generateScheduledContent, {
          scheduled: true,
          timezone: 'Asia/Taipei',
        });

        scheduleJobs.push(job);
        logger.info(`Scheduled content generation for ${day} at ${config.time}`);
      }
    }

    logger.info(`✓ Initialized ${scheduleJobs.length} dynamic schedule jobs`);
  } catch (error) {
    logger.error('Failed to initialize dynamic schedule:', error);
  }
}

/**
 * Check for expired review requests
 * Runs every hour
 */
export const checkExpiredReviews = cron.schedule('0 * * * *', async () => {
  logger.info('Checking for expired review requests...');

  try {
    const pool = getPool();

    // Mark expired reviews
    await pool.execute(
      `UPDATE review_requests
       SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND expires_at < NOW()`
    );

    logger.info('Expired reviews updated');
  } catch (error) {
    logger.error('Failed to check expired reviews:', error);
  }
}, {
  scheduled: false,
});

/**
 * Token refresh check
 * Runs every 6 hours
 */
export const tokenRefreshCheck = cron.schedule('0 */6 * * *', async () => {
  logger.info('Checking tokens for refresh...');

  try {
    const pool = getPool();

    // Find tokens that need refresh (expires soon and not refreshed recently)
    const [accounts] = await pool.execute<RowDataPacket[]>(
      `SELECT t.account_id, t.access_token, t.expires_at, t.last_refreshed_at
       FROM threads_auth t
       INNER JOIN threads_accounts a ON t.account_id = a.id
       WHERE a.status = 'ACTIVE'
       AND t.status = 'OK'
       AND t.expires_at > NOW()
       AND t.expires_at < DATE_ADD(NOW(), INTERVAL 7 DAY)
       AND (
         t.last_refreshed_at IS NULL
         OR t.last_refreshed_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
       )`,
      [config.threads.tokenRefreshThreshold]
    );

    for (const account of accounts) {
      await queueService.addTokenRefreshJob({
        accountId: account.account_id,
      });

      logger.info(`Token refresh job queued for account ${account.account_id}`);
    }

    logger.info(`Queued ${accounts.length} token refresh jobs`);
  } catch (error) {
    logger.error('Token refresh check failed:', error);
  }
}, {
  scheduled: false,
});

/**
 * Daily review reminder
 * Runs at 6:00 PM every day
 */
export const dailyReviewReminder = cron.schedule('0 18 * * *', async () => {
  logger.info('Sending daily review reminders...');

  try {
    const pool = getPool();

    // Group pending reviews by user
    const [reviews] = await pool.execute<RowDataPacket[]>(
      `SELECT u.line_user_id, u.id as user_id, COUNT(*) as pending_count
       FROM review_requests rr
       INNER JOIN users u ON rr.reviewer_user_id = u.id
       WHERE rr.status = 'PENDING'
       AND rr.expires_at > NOW()
       AND u.line_user_id IS NOT NULL
       GROUP BY u.line_user_id, u.id`
    );

    const lineService = (await import('../services/line.service')).default;

    for (const review of reviews) {
      await lineService.sendNotification(
        review.line_user_id,
        `⏰ 提醒:你有 ${review.pending_count} 個待審核的貼文。\n\n請前往系統查看並審核。`
      );
    }

    logger.info(`Sent ${reviews.length} review reminders`);
  } catch (error) {
    logger.error('Failed to send review reminders:', error);
  }
}, {
  scheduled: false,
});

/**
 * Sync Threads insights data
 * Runs every 4 hours
 */
export const syncInsightsData = cron.schedule('0 */4 * * *', async () => {
  logger.info('Syncing Threads insights data...');

  try {
    const threadsInsightsService = (await import('../services/threads-insights.service')).default;
    const threadsService = (await import('../services/threads.service')).default;
    const { PeriodType } = await import('../types');

    // Get default Threads account
    const defaultAccount = await threadsService.getDefaultAccount();
    if (!defaultAccount) {
      logger.warn('No active Threads account found, skipping insights sync');
      return;
    }

    // Sync recent posts insights (last 7 days, up to 50 posts)
    await threadsInsightsService.syncRecentPostsInsights(7, 50);

    // Sync account insights (weekly)
    await threadsInsightsService.syncAccountInsights(defaultAccount.account.id, PeriodType.WEEKLY);

    logger.info('✓ Insights data sync completed');
  } catch (error) {
    logger.error('Failed to sync insights data:', error);
  }
}, {
  scheduled: false,
});

/**
 * Daily insights cleanup
 * Runs at 3:00 AM every day to clean up old insights data
 */
export const cleanupOldInsights = cron.schedule('0 3 * * *', async () => {
  logger.info('Cleaning up old insights data...');

  try {
    const { InsightsModel } = await import('../models/insights.model');

    // Delete insights older than 90 days
    await InsightsModel.deleteOldInsights(90);

    logger.info('✓ Old insights data cleaned up');
  } catch (error) {
    logger.error('Failed to clean up old insights:', error);
  }
}, {
  scheduled: false,
});

/**
 * Start all schedulers
 */
export async function startSchedulers() {
  // Initialize dynamic schedule from settings
  await initializeDynamicSchedule();

  // Start fixed schedulers
  checkExpiredReviews.start();
  tokenRefreshCheck.start();
  dailyReviewReminder.start();
  syncInsightsData.start();
  cleanupOldInsights.start();

  logger.info('✓ All schedulers started');
}

/**
 * Stop all schedulers
 */
export function stopSchedulers() {
  // Stop dynamic schedule jobs
  scheduleJobs.forEach(job => job.stop());

  // Stop fixed schedulers
  checkExpiredReviews.stop();
  tokenRefreshCheck.stop();
  dailyReviewReminder.stop();
  syncInsightsData.stop();
  cleanupOldInsights.stop();

  logger.info('✓ All schedulers stopped');
}

export default {
  startSchedulers,
  stopSchedulers,
};
