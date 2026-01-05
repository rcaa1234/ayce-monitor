import cron from 'node-cron';
import logger from '../utils/logger';
import queueService from '../services/queue.service';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import config from '../config';
import { PostStatus } from '../types';

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
 * Execute scheduled posts
 * 用途：每 5 分鐘檢查一次，自動執行到期的排程
 * 影響範圍：新增排程執行器，不影響現有排程系統
 *
 * 執行邏輯：
 * 1. 查詢 status='PENDING' 且 scheduled_time <= now 的排程
 * 2. 取得對應的模板內容
 * 3. 建立 Post 並加入生成隊列
 * 4. 更新排程狀態為 'GENERATED'
 * 5. 記錄到 post_performance_log（初始值）
 */
export const executeScheduledPosts = cron.schedule('*/5 * * * *', async () => {
  logger.info('Checking for scheduled posts to execute...');

  try {
    const pool = getPool();
    const { PostModel } = await import('../models/post.model');
    const { generateUUID } = await import('../utils/uuid');

    // 查詢需要執行的排程
    const [schedules] = await pool.execute<RowDataPacket[]>(
      `SELECT ds.*, ct.prompt, ct.name as template_name
       FROM daily_scheduled_posts ds
       JOIN content_templates ct ON ds.template_id = ct.id
       WHERE ds.status = 'PENDING'
         AND ds.scheduled_time <= NOW()
       ORDER BY ds.scheduled_time ASC
       LIMIT 10`
    );

    if (schedules.length === 0) {
      logger.info('No scheduled posts to execute');
      return;
    }

    logger.info(`Found ${schedules.length} scheduled post(s) to execute`);

    // 取得建立者 ID（使用第一個 active 的 content_creator 或 admin）
    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id FROM users u
       INNER JOIN user_roles ur ON u.id = ur.user_id
       INNER JOIN roles r ON ur.role_id = r.id
       WHERE r.name IN ('content_creator', 'admin') AND u.status = 'ACTIVE'
       ORDER BY CASE r.name WHEN 'content_creator' THEN 1 WHEN 'admin' THEN 2 END
       LIMIT 1`
    );

    if (users.length === 0) {
      logger.error('No active user found to create scheduled posts');
      return;
    }

    const creatorId = users[0].id;

    // 執行每個排程
    for (const schedule of schedules) {
      try {
        logger.info(`Executing schedule ${schedule.id} for template "${schedule.template_name}" at ${schedule.scheduled_time}`);

        // 建立貼文
        const post = await PostModel.create({
          created_by: creatorId,
          status: PostStatus.DRAFT,
        });

        logger.info(`Created post ${post.id} for schedule ${schedule.id}`);

        // 加入生成隊列（使用模板的提示詞）
        await queueService.addGenerateJob({
          postId: post.id,
          createdBy: creatorId,
          stylePreset: schedule.prompt, // 使用模板的提示詞
        });

        logger.info(`Added generation job for post ${post.id}`);

        // 更新排程狀態為 GENERATED，並記錄 post_id
        await pool.execute(
          `UPDATE daily_scheduled_posts
           SET status = 'GENERATED', post_id = ?, updated_at = NOW()
           WHERE id = ?`,
          [post.id, schedule.id]
        );

        // 記錄到 post_performance_log（初始值，等待發文後更新）
        const logId = generateUUID();
        const scheduledTime = new Date(schedule.scheduled_time);
        await pool.execute(
          `INSERT INTO post_performance_log
           (id, post_id, template_id, posted_at, posted_hour, posted_minute, day_of_week, selection_method, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            logId,
            post.id,
            schedule.template_id,
            schedule.scheduled_time,
            scheduledTime.getHours(),
            scheduledTime.getMinutes(),
            scheduledTime.getDay(),
            schedule.selection_method || 'MANUAL'
          ]
        );

        logger.info(`✓ Schedule ${schedule.id} executed successfully, created post ${post.id}`);
      } catch (error) {
        logger.error(`Failed to execute schedule ${schedule.id}:`, error);

        // 更新排程狀態為 FAILED
        await pool.execute(
          `UPDATE daily_scheduled_posts
           SET status = 'FAILED', updated_at = NOW()
           WHERE id = ?`,
          [schedule.id]
        );
      }
    }

    logger.info(`✓ Executed ${schedules.length} scheduled post(s)`);
  } catch (error) {
    logger.error('Failed to execute scheduled posts:', error);
  }
}, {
  scheduled: false,
});

/**
 * createDailyAutoSchedule
 * 用途：每天自動建立排程,使用 UCB 策略選擇最佳時段和模板
 * 執行時間：每天 00:00
 * 影響：新增功能,不影響現有排程
 * 
 * 修改說明：現在會在建立排程時就立即產生內容並發送 LINE 預審通知
 */
export async function createDailyAutoSchedule() {
  logger.info('Creating daily auto schedule using UCB strategy...');

  try {
    const pool = getPool();
    const { ucbService } = await import('../services/ucb.service');
    const { generateUUID } = await import('../utils/uuid');
    const { PostModel } = await import('../models/post.model');

    // 檢查今天是否已有排程
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM daily_auto_schedule WHERE schedule_date = ?',
      [todayStr]
    );

    if (existing.length > 0) {
      logger.info(`Daily auto schedule for ${todayStr} already exists, skipping`);
      return;
    }

    // 使用 UCB 選擇最佳時段和模板
    const selection = await ucbService.selectOptimalSchedule(today);

    if (!selection) {
      logger.warn('UCB service returned no selection, cannot create schedule');
      return;
    }

    // 取得 UCB 配置（含 Threads 帳號和 LINE User ID）
    const ucbConfig = await ucbService.getConfig();

    // 取得建立者: 優先使用 UCB config 的 LINE User ID，否則使用 content_creator 角色
    let creatorId: string;

    if (ucbConfig.line_user_id) {
      // 使用 LINE User ID 查找用戶
      const [lineUsers] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE line_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [ucbConfig.line_user_id]
      );

      if (lineUsers.length > 0) {
        creatorId = lineUsers[0].id;
        logger.info(`Using UCB LINE User ID (${ucbConfig.line_user_id}) as creator`);
      } else {
        logger.warn(`UCB LINE User ID ${ucbConfig.line_user_id} not found, using content_creator fallback`);
        // Fallback to content_creator
        const [users] = await pool.execute<RowDataPacket[]>(
          `SELECT u.id FROM users u
           INNER JOIN user_roles ur ON u.id = ur.user_id
           INNER JOIN roles r ON ur.role_id = r.id
           WHERE r.name = 'content_creator' AND u.status = 'ACTIVE'
           LIMIT 1`
        );

        if (users.length === 0) {
          throw new Error('No active content creator found and LINE user not found');
        }
        creatorId = users[0].id;
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
        throw new Error('No active content creator found');
      }
      creatorId = users[0].id;
    }

    // 建立自動排程記錄
    const scheduleId = generateUUID();
    await pool.execute(
      `INSERT INTO daily_auto_schedule
       (id, schedule_date, selected_time_slot_id, selected_template_id, scheduled_time,
        status, ucb_score, selection_reason, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, NOW())`,
      [
        scheduleId,
        todayStr,
        selection.timeSlot.id,
        selection.template.id,
        selection.scheduledTime,
        selection.ucbScore,
        selection.reason,
      ]
    );

    // 建立 Post (DRAFT)
    const post = await PostModel.create({
      status: PostStatus.DRAFT,
      created_by: creatorId,
    });

    logger.info(`Created post ${post.id} for auto-schedule ${scheduleId}`);

    // 加入生成佇列（包含排程時間，讓 LINE 通知可以顯示）
    await queueService.addGenerateJob({
      postId: post.id,
      createdBy: creatorId,
      stylePreset: selection.template.prompt,
      scheduledTime: selection.scheduledTime.toISOString(),
      autoScheduleId: scheduleId,
    });

    // 更新排程狀態為 GENERATED，並記錄 post_id
    await pool.execute(
      `UPDATE daily_auto_schedule
       SET status = 'GENERATED', post_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [post.id, scheduleId]
    );

    logger.info(`✓ Daily auto schedule created: ${selection.template.name} at ${selection.scheduledTime.toLocaleTimeString('zh-TW')}`);
    logger.info(`  Reason: ${selection.reason}`);
    logger.info(`  Post ${post.id} created and queued for content generation`);
  } catch (error) {
    logger.error('Failed to create daily auto schedule:', error);
  }
}

/**
 * Dynamic Daily Auto Schedule Creator
 * 用途：每 10 分鐘檢查今天是否需要建立排程，如果還沒有排程就立即建立
 * 頻率：每 10 分鐘檢查一次
 */
const dailyAutoScheduler = cron.schedule('*/10 * * * *', async () => {
  try {
    const pool = getPool();
    const { ucbService } = await import('../services/ucb.service');

    // 檢查配置
    const config = await ucbService.getConfig();
    logger.info(`[UCB Scheduler] Checking UCB config`);

    // 檢查今天是星期幾 (1=週一, 7=週日)
    const today = new Date();
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 將 0 (週日) 轉為 7
    const todayStr = today.toISOString().split('T')[0];

    // 檢查 active_days 設定
    const activeDays = config.active_days || [];
    if (activeDays.length > 0 && !activeDays.includes(dayOfWeek)) {
      logger.info(`[UCB Scheduler] Today (day ${dayOfWeek}) is not an active day, skipping`);
      return;
    }

    // 檢查今天是否已有排程
    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM daily_auto_schedule WHERE schedule_date = ?',
      [todayStr]
    );

    logger.info(`[UCB Scheduler] Existing schedules for ${todayStr}: ${existing.length}`);

    if (existing.length > 0) {
      logger.info('[UCB Scheduler] Schedule already exists for today, skipping');
      return; // 已有排程,不重複建立
    }

    // 如果今天還沒有排程，立即建立
    logger.info(`⏰ Creating daily schedule for ${todayStr}`);
    await createDailyAutoSchedule();
  } catch (error) {
    logger.error('Error in dynamic daily auto scheduler:', error);
  }
}, {
  scheduled: false,
  timezone: 'Asia/Taipei',
});

/**
 * executeAutoScheduledPosts
 * 用途：執行自動排程建立的貼文
 * 頻率：每 5 分鐘檢查一次
 * 影響：與原有 executeScheduledPosts 並行運作
 */
export const executeAutoScheduledPosts = cron.schedule('*/5 * * * *', async () => {
  logger.info('Checking for auto-scheduled posts to execute...');

  try {
    const pool = getPool();
    const { PostModel } = await import('../models/post.model');
    const { generateUUID } = await import('../utils/uuid');

    // 查詢待執行的自動排程
    const [schedules] = await pool.execute<RowDataPacket[]>(
      `SELECT das.*, ct.prompt, ct.name as template_name
       FROM daily_auto_schedule das
       JOIN content_templates ct ON das.selected_template_id = ct.id
       WHERE das.status = 'PENDING'
         AND das.scheduled_time <= NOW()
       ORDER BY das.scheduled_time ASC
       LIMIT 10`
    );

    if (schedules.length === 0) {
      logger.info('No auto-scheduled posts to execute');
      return;
    }

    logger.info(`Found ${schedules.length} auto-scheduled post(s) to execute`);

    // 取得 UCB 配置（含 Threads 帳號和 LINE User ID）
    const { ucbService } = await import('../services/ucb.service');
    const ucbConfig = await ucbService.getConfig();

    // 執行每個排程
    for (const schedule of schedules) {
      try {
        // 取得建立者: 優先使用 UCB config 的 LINE User ID，否則使用 content_creator 角色
        let creatorId: string;

        if (ucbConfig.line_user_id) {
          // 使用 LINE User ID 查找用戶
          const [lineUsers] = await pool.execute<RowDataPacket[]>(
            `SELECT id FROM users WHERE line_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
            [ucbConfig.line_user_id]
          );

          if (lineUsers.length > 0) {
            creatorId = lineUsers[0].id;
            logger.info(`Using UCB LINE User ID (${ucbConfig.line_user_id}) as creator`);
          } else {
            logger.warn(`UCB LINE User ID ${ucbConfig.line_user_id} not found, using content_creator fallback`);
            // Fallback to content_creator
            const [users] = await pool.execute<RowDataPacket[]>(
              `SELECT u.id FROM users u
               INNER JOIN user_roles ur ON u.id = ur.user_id
               INNER JOIN roles r ON ur.role_id = r.id
               WHERE r.name = 'content_creator' AND u.status = 'ACTIVE'
               LIMIT 1`
            );

            if (users.length === 0) {
              throw new Error('No active content creator found and LINE user not found');
            }
            creatorId = users[0].id;
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
            throw new Error('No active content creator found');
          }
          creatorId = users[0].id;
        }

        // 建立 Post (DRAFT)
        const post = await PostModel.create({
          status: PostStatus.DRAFT,
          created_by: creatorId,
        });

        // 如果有設定 Threads 帳號，更新到資料庫
        if (ucbConfig.threads_account_id) {
          await pool.execute(
            `UPDATE posts SET threads_account_id = ? WHERE id = ?`,
            [ucbConfig.threads_account_id, post.id]
          );
          logger.info(`Created post ${post.id} for auto-schedule ${schedule.id} with Threads account ${ucbConfig.threads_account_id}`);
        } else {
          logger.info(`Created post ${post.id} for auto-schedule ${schedule.id} without specific Threads account`);
        }

        // 加入生成佇列
        await queueService.addGenerateJob({
          postId: post.id,
          createdBy: creatorId,
          stylePreset: schedule.prompt,
        });

        // 更新排程狀態
        await pool.execute(
          `UPDATE daily_auto_schedule
           SET status = 'GENERATED', post_id = ?, executed_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [post.id, schedule.id]
        );

        // 記錄到 post_performance_log（初始值）
        const logId = generateUUID();
        const scheduledTime = new Date(schedule.scheduled_time);
        await pool.execute(
          `INSERT INTO post_performance_log
           (id, post_id, template_id, time_slot_id, posted_at, posted_hour, posted_minute, day_of_week,
            ucb_score, was_exploration, selection_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            logId,
            post.id,
            schedule.selected_template_id,
            schedule.selected_time_slot_id,
            schedule.scheduled_time,
            scheduledTime.getHours(),
            scheduledTime.getMinutes(),
            scheduledTime.getDay(),
            schedule.ucb_score,
            schedule.selection_reason?.includes('探索') ? true : false,
            schedule.selection_reason
          ]
        );

        logger.info(`✓ Auto-schedule ${schedule.id} executed successfully`);
      } catch (error) {
        logger.error(`Failed to execute auto-schedule ${schedule.id}:`, error);

        // 更新排程狀態為 FAILED
        await pool.execute(
          `UPDATE daily_auto_schedule
           SET status = 'FAILED', error_message = ?, updated_at = NOW()
           WHERE id = ?`,
          [error instanceof Error ? error.message : String(error), schedule.id]
        );
      }
    }

    logger.info(`✓ Executed ${schedules.length} auto-scheduled post(s)`);
  } catch (error) {
    logger.error('Failed to execute auto-scheduled posts:', error);
  }
}, {
  scheduled: false,
});

/**
 * Start all schedulers
 */
export async function startSchedulers() {
  try {
    logger.info('[Scheduler] Starting all cron jobs...');

    // Start fixed schedulers
    logger.info('[Scheduler] Starting checkExpiredReviews (every 30 minutes)...');
    checkExpiredReviews.start();

    logger.info('[Scheduler] Starting tokenRefreshCheck (every 6 hours)...');
    tokenRefreshCheck.start();

    logger.info('[Scheduler] Starting dailyReviewReminder (daily at 09:00)...');
    dailyReviewReminder.start();

    logger.info('[Scheduler] Starting syncInsightsData (every 4 hours)...');
    syncInsightsData.start();

    logger.info('[Scheduler] Starting cleanupOldInsights (daily at 02:00)...');
    cleanupOldInsights.start();

    logger.info('[Scheduler] Starting executeScheduledPosts (every minute)...');
    executeScheduledPosts.start();

    // Start UCB auto-scheduling
    logger.info('[UCB Scheduler] Starting dailyAutoScheduler (every 10 minutes)...');
    dailyAutoScheduler.start();

    logger.info('[UCB Scheduler] Starting executeAutoScheduledPosts (every minute)...');
    executeAutoScheduledPosts.start();

    logger.info('✓ All schedulers started successfully');
    logger.info('  - Fixed schedulers: 6 jobs');
    logger.info('  - UCB schedulers: 2 jobs');
    logger.info('  - Total: 8 cron jobs running');
  } catch (error) {
    logger.error('[Scheduler] Failed to start schedulers:', error);
    throw error;
  }
}

/**
 * Stop all schedulers
 */
export function stopSchedulers() {
  // Stop fixed schedulers
  checkExpiredReviews.stop();
  tokenRefreshCheck.stop();
  dailyReviewReminder.stop();
  syncInsightsData.stop();
  cleanupOldInsights.stop();
  executeScheduledPosts.stop();

  // Stop UCB auto-scheduling
  dailyAutoScheduler.stop();
  executeAutoScheduledPosts.stop();

  logger.info('✓ All schedulers stopped');
}

export default {
  startSchedulers,
  stopSchedulers,
};
