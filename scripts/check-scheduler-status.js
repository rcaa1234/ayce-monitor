/**
 * Check Scheduler Status
 * 檢查 cron schedulers 是否正常運行
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkSchedulerStatus() {
  console.log('🔍 檢查 Scheduler 狀態...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\n');

    // 檢查 1: 今天是否有任何 UCB 排程被建立
    const today = new Date().toISOString().split('T')[0];
    const [todaySchedules] = await connection.execute(`
      SELECT COUNT(*) as count, MIN(created_at) as first_created
      FROM daily_auto_schedule
      WHERE schedule_date = ?
    `, [today]);

    console.log('1. UCB 自動排程狀態：');
    if (todaySchedules[0].count > 0) {
      console.log(`   ✅ 今日已建立 ${todaySchedules[0].count} 個排程`);
      console.log(`   首次建立時間: ${todaySchedules[0].first_created}`);
    } else {
      console.log('   ❌ 今日尚未建立任何排程');
      console.log('   → Scheduler 可能未啟動或 auto_schedule_enabled = false');
    }

    // 檢查 2: 是否有任何歷史排程記錄
    const [allSchedules] = await connection.execute(`
      SELECT COUNT(*) as count, MAX(created_at) as last_created
      FROM daily_auto_schedule
    `);

    console.log('\n2. 歷史排程記錄：');
    if (allSchedules[0].count > 0) {
      console.log(`   ✅ 共有 ${allSchedules[0].count} 筆排程記錄`);
      console.log(`   最後建立時間: ${allSchedules[0].last_created}`);
    } else {
      console.log('   ❌ 沒有任何排程歷史記錄');
      console.log('   → Scheduler 從未成功執行過！');
    }

    // 檢查 3: Insights 同步狀態
    const [insightsStatus] = await connection.execute(`
      SELECT
        COUNT(DISTINCT pi.post_id) as synced_posts,
        MAX(pi.last_synced_at) as last_sync_time
      FROM post_insights pi
    `);

    console.log('\n3. Insights 同步狀態：');
    if (insightsStatus[0].synced_posts > 0) {
      console.log(`   ✅ 已同步 ${insightsStatus[0].synced_posts} 篇貼文的 Insights`);
      console.log(`   最後同步時間: ${insightsStatus[0].last_sync_time}`);
    } else {
      console.log('   ❌ 沒有任何 Insights 數據');
      console.log('   → Insights 自動同步 scheduler 可能未執行');
    }

    // 檢查 4: UCB 配置
    const [ucbConfig] = await connection.execute(`
      SELECT auto_schedule_enabled, time_range_start, time_range_end
      FROM smart_schedule_config
      WHERE enabled = true
      LIMIT 1
    `);

    console.log('\n4. UCB 配置狀態：');
    if (ucbConfig.length > 0) {
      const config = ucbConfig[0];
      console.log(`   ✅ UCB 配置存在`);
      console.log(`   auto_schedule_enabled: ${config.auto_schedule_enabled ? '✅ 是' : '❌ 否'}`);
      console.log(`   time_range_start: ${config.time_range_start}`);
      console.log(`   time_range_end: ${config.time_range_end}`);
    } else {
      console.log('   ❌ UCB 配置不存在或未啟用');
    }

    // 診斷結論
    console.log('\n' + '='.repeat(60));
    console.log('診斷結論：');
    console.log('='.repeat(60));

    const hasSchedules = allSchedules[0].count > 0;
    const hasInsights = insightsStatus[0].synced_posts > 0;
    const hasConfig = ucbConfig.length > 0 && ucbConfig[0].auto_schedule_enabled;

    if (!hasSchedules && !hasInsights) {
      console.log('\n❌ Schedulers 完全沒有運行！');
      console.log('\n可能原因：');
      console.log('1. startSchedulers() 沒有被調用');
      console.log('2. Worker 進程啟動時發生錯誤');
      console.log('3. Zeabur 部署配置問題');
      console.log('\n建議檢查：');
      console.log('- Runtime Logs 中是否有 "All schedulers started" 訊息');
      console.log('- Runtime Logs 中是否有啟動錯誤');
      console.log('- 確認 Zeabur 是否使用正確的啟動命令');
    } else if (hasConfig && !hasSchedules) {
      console.log('\n⚠️ UCB Scheduler 未運行，但配置正確');
      console.log('\n可能原因：');
      console.log('1. Cron job 的時間還沒到');
      console.log('2. Scheduler 啟動時發生錯誤');
      console.log('\n建議：');
      console.log('- 等待下一個 10 分鐘檢查點');
      console.log('- 檢查 Runtime Logs 中的 [UCB Scheduler] 訊息');
    } else if (!hasInsights) {
      console.log('\n⚠️ Insights Scheduler 未運行');
      console.log('\n原因：');
      console.log('- Insights 同步每 4 小時執行一次');
      console.log('- 可能還沒到執行時間');
      console.log('\n建議：');
      console.log('- 手動執行同步測試功能');
      console.log('- 或等待下一個 4 小時週期');
    } else {
      console.log('\n✅ Schedulers 運行正常！');
    }

  } catch (error) {
    console.error('\n❌ 檢查過程發生錯誤:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

checkSchedulerStatus()
  .then(() => {
    console.log('\n✅ 檢查完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
