/**
 * Comprehensive Diagnosis Script
 * 全面診斷統計功能和 UCB 排程問題
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function diagnose() {
  console.log('🔍 開始全面診斷...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\n');

    // ==================== 1. 檢查 posts 表結構 ====================
    console.log('=' .repeat(70));
    console.log('1. 檢查 posts 表結構');
    console.log('='.repeat(70));

    const [postsColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'posts'
      ORDER BY ORDINAL_POSITION
    `);

    console.log('\nposts 表欄位：');
    postsColumns.forEach(col => {
      const marker = ['template_id', 'time_slot_id', 'content_length', 'media_type', 'hashtag_count'].includes(col.COLUMN_NAME) ? ' ⭐' : '';
      console.log(`  ${col.COLUMN_NAME.padEnd(25)} ${col.DATA_TYPE.padEnd(20)} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}${marker}`);
    });

    const hasTemplateId = postsColumns.some(col => col.COLUMN_NAME === 'template_id');
    const hasTimeSlotId = postsColumns.some(col => col.COLUMN_NAME === 'time_slot_id');
    const hasContentLength = postsColumns.some(col => col.COLUMN_NAME === 'content_length');
    const hasMediaType = postsColumns.some(col => col.COLUMN_NAME === 'media_type');

    console.log('\n檢查結果：');
    console.log(`  template_id:    ${hasTemplateId ? '✅ 存在' : '❌ 缺少'}`);
    console.log(`  time_slot_id:   ${hasTimeSlotId ? '✅ 存在' : '❌ 缺少'}`);
    console.log(`  content_length: ${hasContentLength ? '✅ 存在' : '❌ 缺少'}`);
    console.log(`  media_type:     ${hasMediaType ? '✅ 存在' : '❌ 缺少'}`);

    // ==================== 2. 檢查統計相關表 ====================
    console.log('\n' + '='.repeat(70));
    console.log('2. 檢查統計相關表是否存在');
    console.log('='.repeat(70));

    const [tables] = await connection.execute(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('post_insights', 'post_insights_history', 'template_performance', 'timeslot_performance')
    `);

    const tableNames = tables.map(t => t.TABLE_NAME);
    console.log('\n統計表：');
    ['post_insights', 'post_insights_history', 'template_performance', 'timeslot_performance'].forEach(name => {
      console.log(`  ${name.padEnd(30)} ${tableNames.includes(name) ? '✅ 存在' : '❌ 不存在'}`);
    });

    // ==================== 3. 檢查資料完整性 ====================
    console.log('\n' + '='.repeat(70));
    console.log('3. 檢查資料完整性');
    console.log('='.repeat(70));

    // 已發布的貼文數量
    const [postedCount] = await connection.execute(`
      SELECT COUNT(*) as count
      FROM posts
      WHERE status = 'POSTED'
    `);
    console.log(`\n已發布貼文數量: ${postedCount[0].count}`);

    // 有 Insights 的貼文數量
    if (tableNames.includes('post_insights')) {
      const [insightsCount] = await connection.execute(`
        SELECT COUNT(DISTINCT post_id) as count
        FROM post_insights
      `);
      console.log(`有 Insights 的貼文: ${insightsCount[0].count}`);

      const [pendingInsights] = await connection.execute(`
        SELECT COUNT(*) as count
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED' AND pi.id IS NULL
      `);
      console.log(`待同步 Insights 的貼文: ${pendingInsights[0].count}`);
    }

    // 檢查是否有貼文資料
    if (postedCount[0].count > 0) {
      console.log('\n最近的已發布貼文（前 3 筆）：');
      const [recentPosts] = await connection.execute(`
        SELECT id, status, posted_at, created_at
        FROM posts
        WHERE status = 'POSTED'
        ORDER BY posted_at DESC
        LIMIT 3
      `);

      recentPosts.forEach((post, idx) => {
        console.log(`  ${idx + 1}. ID: ${post.id}`);
        console.log(`     Posted at: ${post.posted_at}`);
        console.log(`     Created at: ${post.created_at}`);
      });
    }

    // ==================== 4. 檢查 UCB 配置 ====================
    console.log('\n' + '='.repeat(70));
    console.log('4. 檢查 UCB 配置');
    console.log('='.repeat(70));

    const [ucbConfig] = await connection.execute(`
      SELECT * FROM ucb_config LIMIT 1
    `);

    if (ucbConfig.length > 0) {
      const config = ucbConfig[0];
      console.log('\nUCB 配置：');
      console.log(`  auto_schedule_enabled: ${config.auto_schedule_enabled ? '✅ 啟用' : '❌ 停用'}`);
      console.log(`  time_range_start:      ${config.time_range_start}`);
      console.log(`  time_range_end:        ${config.time_range_end}`);
      console.log(`  posts_per_day:         ${config.posts_per_day}`);
      console.log(`  min_test_iterations:   ${config.min_test_iterations}`);
      console.log(`  exploration_rate:      ${config.exploration_rate}`);

      // 計算應該建立排程的時間
      const [hour, minute] = config.time_range_start.split(':').map(Number);
      const now = new Date();
      const startTime = new Date();
      startTime.setHours(hour, minute, 0, 0);
      const scheduleCreationTime = new Date(startTime.getTime() - 30 * 60 * 1000);

      console.log(`\n時間計算：`);
      console.log(`  當前時間:           ${now.toLocaleTimeString('zh-TW', { hour12: false })}`);
      console.log(`  發文開始時間:       ${startTime.toLocaleTimeString('zh-TW', { hour12: false })}`);
      console.log(`  應建立排程時間:     ${scheduleCreationTime.toLocaleTimeString('zh-TW', { hour12: false })}`);
      console.log(`  是否應該建立排程:   ${now >= scheduleCreationTime ? '✅ 是' : '❌ 否'}`);
    } else {
      console.log('\n❌ UCB 配置不存在');
    }

    // ==================== 5. 檢查今日排程 ====================
    console.log('\n' + '='.repeat(70));
    console.log('5. 檢查今日自動排程');
    console.log('='.repeat(70));

    const today = new Date().toISOString().split('T')[0];
    const [todaySchedules] = await connection.execute(`
      SELECT id, schedule_date, posts_count, created_at
      FROM daily_auto_schedule
      WHERE schedule_date = ?
    `, [today]);

    console.log(`\n今日 (${today}) 的排程數量: ${todaySchedules.length}`);
    if (todaySchedules.length > 0) {
      todaySchedules.forEach((schedule, idx) => {
        console.log(`  ${idx + 1}. ID: ${schedule.id}`);
        console.log(`     Posts count: ${schedule.posts_count}`);
        console.log(`     Created at: ${schedule.created_at}`);
      });
    } else {
      console.log('  ⚠️ 今日尚未建立任何自動排程');
    }

    // ==================== 6. 檢查最近的排程歷史 ====================
    console.log('\n' + '='.repeat(70));
    console.log('6. 最近的排程歷史（前 5 筆）');
    console.log('='.repeat(70));

    const [recentSchedules] = await connection.execute(`
      SELECT schedule_date, posts_count, created_at
      FROM daily_auto_schedule
      ORDER BY schedule_date DESC
      LIMIT 5
    `);

    if (recentSchedules.length > 0) {
      console.log('');
      recentSchedules.forEach((schedule, idx) => {
        console.log(`  ${idx + 1}. ${schedule.schedule_date} - ${schedule.posts_count} 篇貼文 (建立於 ${schedule.created_at})`);
      });
    } else {
      console.log('\n  ⚠️ 沒有任何排程歷史記錄');
    }

    // ==================== 7. 測試統計查詢 ====================
    console.log('\n' + '='.repeat(70));
    console.log('7. 測試統計查詢');
    console.log('='.repeat(70));

    try {
      console.log('\n測試 1: 總覽統計查詢');
      const [overviewTest] = await connection.execute(`
        SELECT
          COUNT(DISTINCT p.id) as total_posts,
          COALESCE(SUM(pi.views), 0) as total_views,
          COALESCE(SUM(pi.likes), 0) as total_likes,
          COALESCE(SUM(pi.replies), 0) as total_replies
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
          AND p.posted_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);
      console.log('  ✅ 總覽查詢成功');
      console.log(`     Total posts: ${overviewTest[0].total_posts}`);
      console.log(`     Total views: ${overviewTest[0].total_views}`);
    } catch (error) {
      console.log(`  ❌ 總覽查詢失敗: ${error.message}`);
    }

    try {
      console.log('\n測試 2: 貼文明細查詢');
      const [postsTest] = await connection.execute(`
        SELECT
          p.id,
          p.posted_at,
          COALESCE(pi.views, 0) as views,
          COALESCE(pi.likes, 0) as likes
        FROM posts p
        LEFT JOIN post_insights pi ON p.id = pi.post_id
        WHERE p.status = 'POSTED'
        ORDER BY p.posted_at DESC
        LIMIT 5
      `);
      console.log(`  ✅ 貼文明細查詢成功，找到 ${postsTest.length} 筆`);
    } catch (error) {
      console.log(`  ❌ 貼文明細查詢失敗: ${error.message}`);
    }

    // ==================== 8. 總結建議 ====================
    console.log('\n' + '='.repeat(70));
    console.log('8. 診斷總結與建議');
    console.log('='.repeat(70));

    const issues = [];
    const suggestions = [];

    if (!hasTemplateId || !hasTimeSlotId || !hasContentLength || !hasMediaType) {
      issues.push('❌ posts 表缺少統計所需的擴展欄位');
      suggestions.push('👉 需要執行統計遷移: npm run migrate:statistics:prod');
    }

    if (!tableNames.includes('post_insights')) {
      issues.push('❌ post_insights 表不存在');
      suggestions.push('👉 需要執行統計遷移: npm run migrate:statistics:prod');
    }

    if (ucbConfig.length > 0 && !ucbConfig[0].auto_schedule_enabled) {
      issues.push('⚠️ UCB 自動排程功能已停用');
      suggestions.push('👉 在 UCB 設定頁面啟用「啟用自動排程」選項');
    }

    if (todaySchedules.length === 0 && ucbConfig.length > 0 && ucbConfig[0].auto_schedule_enabled) {
      issues.push('⚠️ UCB 已啟用但今日沒有排程');
      suggestions.push('👉 檢查 scheduler 日誌，確認 cron job 是否正常執行');
      suggestions.push('👉 確認當前時間是否已過建立排程的時間點');
    }

    if (postedCount[0].count === 0) {
      issues.push('⚠️ 沒有任何已發布的貼文');
      suggestions.push('👉 統計功能需要有已發布的貼文才能顯示數據');
    }

    console.log('\n發現的問題：');
    if (issues.length === 0) {
      console.log('  ✅ 沒有發現明顯問題');
    } else {
      issues.forEach(issue => console.log(`  ${issue}`));
    }

    console.log('\n建議操作：');
    if (suggestions.length === 0) {
      console.log('  ✅ 系統運作正常，無需額外操作');
    } else {
      suggestions.forEach((suggestion, idx) => console.log(`  ${idx + 1}. ${suggestion}`));
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 診斷完成');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ 診斷過程發生錯誤:', error.message);
    console.error(error);
  } finally {
    await connection.end();
  }
}

diagnose()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
