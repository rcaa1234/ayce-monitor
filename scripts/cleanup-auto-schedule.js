/**
 * 清除自動排程功能的資料庫記錄和設定
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function cleanup() {
  let connection;

  try {
    console.log('連接資料庫...');
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'threads_posting'
    });

    console.log('✓ 資料庫連接成功\n');

    // 1. 檢查並清理可能存在的 settings 表
    console.log('1. 檢查 settings 表...');
    try {
      const [settingsResult] = await connection.execute(
        `DELETE FROM settings
         WHERE setting_key IN ('ai_engine', 'custom_prompt', 'line_notify_user_id', 'schedule_settings')`
      );
      console.log(`   ✓ 刪除了 ${settingsResult.affectedRows} 筆設定記錄\n`);
    } catch (err) {
      console.log(`   ℹ settings 表不存在，跳過\n`);
    }

    // 2. 檢查是否有執行中的排程任務（從 cron jobs）
    console.log('2. 檢查排程任務...');
    console.log('   ℹ 動態排程任務將在重啟服務器後自動移除\n');

    // 3. 顯示統計資訊
    console.log('3. 統計資訊:');
    const [stats] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM content_templates WHERE enabled = true) as active_templates,
        (SELECT COUNT(*) FROM daily_auto_schedule) as ucb_schedules
      `
    );
    console.log(`   - 啟用的模板數量: ${stats[0].active_templates}`);
    console.log(`   - UCB 排程記錄: ${stats[0].ucb_schedules}\n`);

    console.log('✅ 清除完成！\n');
    console.log('📝 注意事項:');
    console.log('   1. 自動排程功能已從前端移除');
    console.log('   2. 保留 UCB 智能排程功能');
    console.log('   3. 保留手動建立功能');
    console.log('   4. 請重啟服務器以停止動態排程任務');

  } catch (error) {
    console.error('❌ 清除失敗:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n資料庫連接已關閉');
    }
  }
}

cleanup();
