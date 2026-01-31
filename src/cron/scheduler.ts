import cron from 'node-cron';
import logger from '../utils/logger';
import queueService from '../services/queue.service';
import { getPool } from '../database/connection';
import { RowDataPacket } from 'mysql2';
import config from '../config';
import { PostStatus } from '../types';

/**
 * Check for expired review requests
 * Runs every 5 minutes - 檢查排程前 10 分鐘仍未審核的貼文
 */
export const checkExpiredReviews = cron.schedule('*/5 * * * *', async () => {
  logger.info('Checking for expired review requests...');

  try {
    const pool = getPool();

    // 1. 標記超過原本過期時間的審核請求為 EXPIRED
    await pool.execute(
      `UPDATE review_requests
       SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND expires_at < NOW()`
    );

    // 2. 檢查自動排程：排程前 10 分鐘未審核則失效
    const [pendingSchedules] = await pool.execute<RowDataPacket[]>(
      `SELECT das.id, das.post_id, das.scheduled_time
       FROM daily_auto_schedule das
       JOIN posts p ON das.post_id = p.id
       WHERE das.status = 'GENERATED'
         AND p.status = 'PENDING_REVIEW'
         AND das.scheduled_time <= DATE_ADD(NOW(), INTERVAL 10 MINUTE)`
    );

    for (const schedule of pendingSchedules) {
      logger.info(`Expiring unreviewed schedule ${schedule.id} (scheduled for ${schedule.scheduled_time})`);

      // 標記排程為過期
      await pool.execute(
        `UPDATE daily_auto_schedule SET status = 'EXPIRED' WHERE id = ?`,
        [schedule.id]
      );

      // 刪除對應的待審核貼文及相關資料
      await pool.execute('DELETE FROM post_insights WHERE post_id = ?', [schedule.post_id]);
      await pool.execute('DELETE FROM post_revisions WHERE post_id = ?', [schedule.post_id]);
      await pool.execute('DELETE FROM post_performance_log WHERE post_id = ?', [schedule.post_id]);
      await pool.execute('DELETE FROM review_requests WHERE post_id = ?', [schedule.post_id]);
      await pool.execute('DELETE FROM posts WHERE id = ?', [schedule.post_id]);

      logger.info(`Deleted expired pending post ${schedule.post_id}`);
    }

    if (pendingSchedules.length > 0) {
      logger.info(`Expired ${pendingSchedules.length} unreviewed schedules`);
    }

    logger.info('Expired reviews check completed');
  } catch (error) {
    logger.error('Failed to check expired reviews:', error);
  }
}, {
  scheduled: false,
  timezone: 'Asia/Taipei',
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

        // 建立貼文 - 包含 template_id 以支援重新生成
        const post = await PostModel.create({
          created_by: creatorId,
          status: PostStatus.DRAFT,
          template_id: schedule.template_id,
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
 * 用途：每天自動建立排程，使用提示詞設定中的單一提示詞生成內容
 * 執行時間：每天 00:00 或由 dailyAutoScheduler 觸發
 * 影響：使用 smart_schedule_config 中的 ai_prompt 和 ai_engine
 */
export async function createDailyAutoSchedule() {
  logger.info('Creating daily auto schedule using single prompt...');

  try {
    const pool = getPool();
    const scheduleConfigService = (await import('../services/schedule-config.service')).default;
    const { generateUUID } = await import('../utils/uuid');
    const { PostModel } = await import('../models/post.model');

    // 取得配置（含提示詞、引擎、時間範圍等）
    const aiConfig = await scheduleConfigService.getConfig();

    // 檢查是否有設定提示詞
    if (!aiConfig.ai_prompt) {
      logger.warn('No AI prompt configured, please set up prompt in "提示詞設定" page');
      return;
    }

    // 檢查今天是否已有排程（使用台灣時區）
    const now = new Date();
    // 轉換為台灣時間
    const taiwanOffset = 8 * 60; // UTC+8
    const taiwanNow = new Date(now.getTime() + (taiwanOffset + now.getTimezoneOffset()) * 60 * 1000);
    const todayStr = taiwanNow.toISOString().split('T')[0]; // YYYY-MM-DD (台灣日期)

    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM daily_auto_schedule WHERE schedule_date = ?',
      [todayStr]
    );

    if (existing.length > 0) {
      logger.info(`Daily auto schedule for ${todayStr} already exists, skipping`);
      return;
    }

    // 計算發文時間（在設定的時段內隨機選擇）
    const startTime = aiConfig.time_range_start || '09:00:00';
    const endTime = aiConfig.time_range_end || '21:00:00';

    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    // 計算隨機發文時間（以分鐘為單位）
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    const randomMinutes = startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes));
    const scheduledHour = Math.floor(randomMinutes / 60);
    const scheduledMinute = randomMinutes % 60;

    // 建立台灣時區的排程時間
    // 先取得台灣今天的日期，然後設定時間
    const scheduledTime = new Date();
    // 設定為台灣時間的今天 00:00
    const taiwanMidnight = new Date(taiwanNow.getFullYear(), taiwanNow.getMonth(), taiwanNow.getDate(), 0, 0, 0, 0);
    // 轉回 UTC（減去 8 小時）
    scheduledTime.setTime(taiwanMidnight.getTime() - taiwanOffset * 60 * 1000);
    // 加上排程的小時和分鐘
    scheduledTime.setTime(scheduledTime.getTime() + (scheduledHour * 60 + scheduledMinute) * 60 * 1000);

    logger.info(`[Schedule] Calculated time: startTime=${startTime}, endTime=${endTime}, randomHour=${scheduledHour}, randomMinute=${scheduledMinute}`);
    logger.info(`[Schedule] Scheduled time (UTC): ${scheduledTime.toISOString()}`);
    logger.info(`[Schedule] Scheduled time (Taiwan): ${new Date(scheduledTime.getTime() + taiwanOffset * 60 * 1000).toISOString()}`);

    // 如果選擇的時間已經過了，設定為明天同一時間
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
      logger.info(`[Schedule] Time already passed, moving to tomorrow: ${scheduledTime.toISOString()}`);
    }

    // 取得建立者: 優先使用配置的 LINE User ID
    let creatorId: string;

    if (aiConfig.line_user_id) {
      // 使用 LINE User ID 查找用戶
      const [lineUsers] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM users WHERE line_user_id = ? AND status = 'ACTIVE' LIMIT 1`,
        [aiConfig.line_user_id]
      );

      if (lineUsers.length > 0) {
        creatorId = lineUsers[0].id;
        logger.info(`Using configured LINE User ID (${aiConfig.line_user_id}) as creator`);
      } else {
        logger.warn(`LINE User ID ${aiConfig.line_user_id} not found, using content_creator fallback`);
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

    // 建立自動排程記錄（不再需要 selected_template_id 和 selected_time_slot_id）
    const scheduleId = generateUUID();
    await pool.execute(
      `INSERT INTO daily_auto_schedule
       (id, schedule_date, scheduled_time, status, selection_reason, created_at)
       VALUES (?, ?, ?, 'PENDING', ?, NOW())`,
      [
        scheduleId,
        todayStr,
        scheduledTime,
        'AI 自動發文（單一提示詞）',
      ]
    );

    // 建立 Post (DRAFT) - 標記為 AI 生成，使用配置的引擎
    const post = await PostModel.create({
      status: PostStatus.DRAFT,
      created_by: creatorId,
      is_ai_generated: true,
    });

    logger.info(`Created post ${post.id} for auto-schedule ${scheduleId}`);

    // 加入生成佇列（使用提示詞設定中的單一提示詞和引擎）
    await queueService.addGenerateJob({
      postId: post.id,
      createdBy: creatorId,
      stylePreset: aiConfig.ai_prompt, // 使用單一提示詞
      engine: aiConfig.ai_engine || 'GPT5_2', // 使用配置的引擎
      scheduledTime: scheduledTime.toISOString(),
      autoScheduleId: scheduleId,
    });

    // 更新排程狀態為 GENERATED，並記錄 post_id
    await pool.execute(
      `UPDATE daily_auto_schedule
       SET status = 'GENERATED', post_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [post.id, scheduleId]
    );

    logger.info(`✓ Daily auto schedule created at ${scheduledTime.toLocaleTimeString('zh-TW')}`);
    logger.info(`  Using AI engine: ${aiConfig.ai_engine || 'GPT5_2'}`);
    logger.info(`  Post ${post.id} created and queued for content generation`);
  } catch (error) {
    logger.error('Failed to create daily auto schedule:', error);
  }
}

/**
 * Dynamic Daily Auto Schedule Creator
 * 用途：每 10 分鐘檢查今天是否需要建立排程，如果還沒有排程就立即建立
 * 頻率：每 10 分鐘檢查一次
 * 
 * 重要：必須同時滿足以下條件才會自動排程：
 * 1. auto_schedule_enabled = true
 * 2. ai_prompt 已設定（非空）
 * 3. 今天是 active_days 中的日期
 */
const dailyAutoScheduler = cron.schedule('*/10 * * * *', async () => {
  try {
    const pool = getPool();
    const scheduleConfigService = (await import('../services/schedule-config.service')).default;

    // 檢查配置
    const config = await scheduleConfigService.getConfig();
    logger.info(`[Auto Scheduler] Checking auto-schedule config`);

    // ⚠️ 檢查是否啟用自動排程
    if (!config.auto_schedule_enabled) {
      logger.info('[Auto Scheduler] Auto-schedule is DISABLED, skipping');
      return;
    }

    // ⚠️ 檢查是否有設定 AI 提示詞
    if (!config.ai_prompt || config.ai_prompt.trim() === '') {
      logger.info('[Auto Scheduler] No AI prompt configured, skipping');
      return;
    }

    // 檢查今天是星期幾 (1=週一, 7=週日)
    const today = new Date();
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 將 0 (週日) 轉為 7
    const todayStr = today.toISOString().split('T')[0];

    // 檢查 active_days 設定
    const activeDays = config.active_days || [];
    if (activeDays.length > 0 && !activeDays.includes(dayOfWeek)) {
      logger.info(`[Auto Scheduler] Today (day ${dayOfWeek}) is not an active day, skipping`);
      return;
    }

    // 檢查今天是否已有排程
    const [existing] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM daily_auto_schedule WHERE schedule_date = ?',
      [todayStr]
    );

    logger.info(`[Auto Scheduler] Existing schedules for ${todayStr}: ${existing.length}`);

    if (existing.length > 0) {
      logger.info('[Auto Scheduler] Schedule already exists for today, skipping');
      return; // 已有排程,不重複建立
    }

    // 如果今天還沒有排程，立即建立
    logger.info(`⏰ Creating daily AI schedule for ${todayStr}`);
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
 * 用途：在排程時間到達時，發布已審核通過的自動排程貼文
 * 頻率：每 5 分鐘檢查一次
 * 流程：檢查 APPROVED 狀態且排程時間已到達的排程 → 發布貼文
 */
export const executeAutoScheduledPosts = cron.schedule('*/5 * * * *', async () => {
  logger.info('Checking for auto-scheduled posts to execute...');

  try {
    const pool = getPool();
    const { generateUUID } = await import('../utils/uuid');

    // 查詢已審核通過且排程時間已到達的自動排程
    const [schedules] = await pool.execute<RowDataPacket[]>(
      `SELECT das.*, p.id as post_id
       FROM daily_auto_schedule das
       JOIN posts p ON das.post_id = p.id
       WHERE das.status = 'APPROVED'
         AND das.scheduled_time <= NOW()
       ORDER BY das.scheduled_time ASC
       LIMIT 10`
    );

    if (schedules.length === 0) {
      logger.info('No auto-scheduled posts to execute');
      return;
    }

    logger.info(`Found ${schedules.length} approved auto-scheduled post(s) ready to publish`);

    // 發布每個排程
    for (const schedule of schedules) {
      try {
        // 取得最新的 revision
        const [revisions] = await pool.execute<RowDataPacket[]>(
          `SELECT id FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT 1`,
          [schedule.post_id]
        );

        if (revisions.length === 0) {
          throw new Error(`No revision found for post ${schedule.post_id}`);
        }

        const revisionId = revisions[0].id;

        // 加入發布佇列
        await queueService.addPublishJob({
          postId: schedule.post_id,
          revisionId: revisionId,
        });

        // 更新排程狀態為 PUBLISHING
        await pool.execute(
          `UPDATE daily_auto_schedule
           SET status = 'PUBLISHING', executed_at = NOW(), updated_at = NOW()
           WHERE id = ?`,
          [schedule.id]
        );

        // 記錄到 post_performance_log（簡化版，不需要模板和時段）
        const logId = generateUUID();
        const scheduledTime = new Date(schedule.scheduled_time);
        await pool.execute(
          `INSERT INTO post_performance_log
           (id, post_id, posted_at, posted_hour, posted_minute, day_of_week, selection_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE updated_at = NOW()`,
          [
            logId,
            schedule.post_id,
            schedule.scheduled_time,
            scheduledTime.getHours(),
            scheduledTime.getMinutes(),
            scheduledTime.getDay(),
            schedule.selection_reason || 'AI 自動發文'
          ]
        );

        logger.info(`✓ Auto-schedule ${schedule.id} submitted for publishing (post: ${schedule.post_id})`);
      } catch (error) {
        logger.error(`Failed to publish auto-schedule ${schedule.id}:`, error);

        // 更新排程狀態為 FAILED
        await pool.execute(
          `UPDATE daily_auto_schedule
           SET status = 'FAILED', error_message = ?, updated_at = NOW()
           WHERE id = ?`,
          [error instanceof Error ? error.message : String(error), schedule.id]
        );
      }
    }

    logger.info(`✓ Processed ${schedules.length} auto-scheduled post(s)`);
  } catch (error) {
    logger.error('Failed to execute auto-scheduled posts:', error);
  }
}, {
  scheduled: false,
});

/**
 * 聲量監控 - 定時爬取和通知
 * Runs every 30 minutes - 檢查需要爬取的來源並發送通知
 */
export const monitorCrawlScheduler = cron.schedule('*/30 * * * *', async () => {
  logger.info('[Monitor] Running scheduled crawls...');

  try {
    const monitorService = (await import('../services/monitor.service')).default;

    // 執行排程爬取
    await monitorService.runScheduledCrawls();

    // 發送未通知的提及
    const lineService = (await import('../services/line.service')).default;
    const unnotified = await monitorService.getUnnotifiedMentions(10);

    if (unnotified.length > 0) {
      // 取得管理員的 LINE User ID
      const pool = getPool();
      const [admins] = await pool.execute<RowDataPacket[]>(
        `SELECT line_user_id FROM users WHERE line_user_id IS NOT NULL LIMIT 1`
      );

      if (admins.length === 0) {
        logger.warn('[Monitor] No LINE user found for notifications');
      } else {
        const lineUserId = admins[0].line_user_id;

        // 按品牌分組通知
        const byBrand = new Map<string, any[]>();
        for (const mention of unnotified) {
          const key = mention.brand_id;
          if (!byBrand.has(key)) byBrand.set(key, []);
          byBrand.get(key)!.push(mention);
        }

        for (const [brandId, mentions] of byBrand) {
          const brand = mentions[0];
          const message = `🔔 聲量監控警報\n\n` +
            `📍 品牌：${brand.brand_name}\n` +
            `📊 新增 ${mentions.length} 筆提及\n\n` +
            mentions.slice(0, 3).map((m: any) =>
              `• ${m.title?.substring(0, 30) || '(無標題)'}...\n  🔑 ${JSON.parse(m.matched_keywords).join(', ')}\n  🔗 ${m.url}`
            ).join('\n\n') +
            (mentions.length > 3 ? `\n\n... 還有 ${mentions.length - 3} 筆` : '');

          try {
            await lineService.sendNotification(lineUserId, message);

            // 標記已通知
            const { generateUUID } = await import('../utils/uuid');
            const notificationId = generateUUID();
            await monitorService.markAsNotified(
              mentions.map((m: any) => m.id),
              notificationId
            );

            logger.info(`[Monitor] Sent notification for ${mentions.length} mentions of brand ${brand.brand_name}`);
          } catch (notifyError) {
            logger.error('[Monitor] Failed to send notification:', notifyError);
          }
        }
      }
    }

    logger.info('[Monitor] Scheduled crawls completed');
  } catch (error) {
    logger.error('[Monitor] Scheduled crawl failed:', error);
  }
}, {
  scheduled: false,
});

/**
 * 聲量週報
 * Runs every Sunday at 10:00 - 每週日早上發送週報
 */
export const weeklyReportScheduler = cron.schedule('0 10 * * 0', async () => {
  logger.info('[WeeklyReport] Generating weekly report...');

  try {
    const weeklyReportService = (await import('../services/weekly-report.service')).default;
    const report = await weeklyReportService.generateReport();
    await weeklyReportService.sendReportToLine(report);
    logger.info('[WeeklyReport] Weekly report sent successfully');
  } catch (error) {
    logger.error('[WeeklyReport] Failed to generate/send weekly report:', error);
  }
}, {
  scheduled: false,
});

/**
 * 危機預警檢查
 * Runs every 15 minutes - 檢查負面聲量突增和高互動負面內容
 */
export const crisisAlertScheduler = cron.schedule('*/15 * * * *', async () => {
  logger.info('[CrisisAlert] Running scheduled crisis check...');

  try {
    const crisisAlertService = (await import('../services/crisis-alert.service')).default;
    const result = await crisisAlertService.runCrisisCheck();
    logger.info(`[CrisisAlert] Check completed: ${result.checked} brands, ${result.alerts} alerts`);
  } catch (error) {
    logger.error('[CrisisAlert] Scheduled check failed:', error);
  }
}, {
  scheduled: false,
  timezone: 'Asia/Taipei',
});

/**
 * 內容推薦生成
 * Runs every day at 08:00 - 每天早上分析熱門話題並生成內容建議
 */
export const contentRecommendationScheduler = cron.schedule('0 8 * * *', async () => {
  logger.info('[ContentRecommendation] Running daily content recommendation...');

  try {
    const contentRecommendationService = (await import('../services/content-recommendation.service')).default;
    const result = await contentRecommendationService.runContentRecommendation();
    logger.info(`[ContentRecommendation] Completed: ${result.topics} topics, ${result.suggestions} suggestions`);
  } catch (error) {
    logger.error('[ContentRecommendation] Daily recommendation failed:', error);
  }
}, {
  scheduled: false,
  timezone: 'Asia/Taipei',
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

    // Start auto-scheduling
    logger.info('[Auto Scheduler] Starting dailyAutoScheduler (every 10 minutes)...');
    dailyAutoScheduler.start();

    logger.info('[Auto Scheduler] Starting executeAutoScheduledPosts (every 5 minutes)...');
    executeAutoScheduledPosts.start();

    // Start Monitor scheduler
    logger.info('[Monitor] Starting monitorCrawlScheduler (every 30 minutes)...');
    monitorCrawlScheduler.start();

    // Start Weekly Report scheduler
    logger.info('[WeeklyReport] Starting weeklyReportScheduler (Sunday at 10:00)...');
    weeklyReportScheduler.start();

    // Start Crisis Alert scheduler
    logger.info('[CrisisAlert] Starting crisisAlertScheduler (every 15 minutes)...');
    crisisAlertScheduler.start();

    // Start Content Recommendation scheduler
    logger.info('[ContentRecommendation] Starting contentRecommendationScheduler (daily at 08:00)...');
    contentRecommendationScheduler.start();

    logger.info('✓ All schedulers started successfully');
    logger.info('  - Fixed schedulers: 6 jobs');
    logger.info('  - Auto schedulers: 2 jobs');
    logger.info('  - Monitor schedulers: 2 jobs');
    logger.info('  - Weekly report: 1 job');
    logger.info('  - Crisis alert: 1 job');
    logger.info('  - Content recommendation: 1 job');
    logger.info('  - Total: 13 cron jobs running');
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

  // Stop auto-scheduling
  dailyAutoScheduler.stop();
  executeAutoScheduledPosts.stop();

  // Stop Monitor scheduler
  monitorCrawlScheduler.stop();

  // Stop Weekly Report scheduler
  weeklyReportScheduler.stop();

  // Stop Crisis Alert scheduler
  crisisAlertScheduler.stop();

  // Stop Content Recommendation scheduler
  contentRecommendationScheduler.stop();

  logger.info('✓ All schedulers stopped');
}

export default {
  startSchedulers,
  stopSchedulers,
};
