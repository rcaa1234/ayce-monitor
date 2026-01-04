/**
 * Enable Time Slots for UCB
 * 啟用 UCB 所需的 time slots
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function enableTimeSlots() {
  console.log('🔧 啟用 Time Slots...\\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\\n');

    // 檢查當前狀態
    const [before] = await connection.execute(`
      SELECT COUNT(*) as total, SUM(enabled) as enabled_count
      FROM time_slots
    `);

    console.log('當前狀態:');
    console.log(`  總共: ${before[0].total} 個 time slots`);
    console.log(`  啟用: ${before[0].enabled_count || 0} 個\\n`);

    if (before[0].total === 0) {
      console.log('❌ time_slots 表是空的！');
      console.log('\\n需要先執行: node scripts/setup-time-slots.js');
      return;
    }

    // 啟用所有在 UCB 時段範圍內的 time slots (01:02 - 22:30)
    const [result] = await connection.execute(`
      UPDATE time_slots
      SET enabled = true
      WHERE start_time >= '01:00:00' AND end_time <= '23:00:00'
    `);

    console.log(`✅ 已啟用 ${result.affectedRows} 個 time slots\\n`);

    // 顯示更新後的狀態
    const [after] = await connection.execute(`
      SELECT start_time, end_time, enabled
      FROM time_slots
      ORDER BY start_time
      LIMIT 20
    `);

    console.log('更新後的 Time Slots (前 20 個):');
    after.forEach((slot, idx) => {
      const status = slot.enabled ? '✅' : '❌';
      console.log(`  ${idx + 1}. ${status} ${slot.start_time} - ${slot.end_time}`);
    });

    console.log('\\n✅ Time slots 已啟用，UCB 自動排程現在可以正常運作了！');

  } catch (error) {
    console.error('\\n❌ 啟用過程發生錯誤:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

enableTimeSlots()
  .then(() => {
    console.log('\\n✅ 完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
