/**
 * Check Time Slots
 * 檢查 time_slots 表狀態
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkTimeSlots() {
  console.log('🔍 檢查 Time Slots...\\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\\n');

    const [rows] = await connection.execute(`
      SELECT id, start_time, end_time, enabled
      FROM schedule_time_slots
      ORDER BY start_time
    `);

    console.log(`找到 ${rows.length} 個 time slots:\\n`);

    const enabled = rows.filter(r => r.enabled);
    const disabled = rows.filter(r => !r.enabled);

    console.log(`✅ 啟用: ${enabled.length} 個`);
    console.log(`❌ 停用: ${disabled.length} 個\\n`);

    if (rows.length === 0) {
      console.log('❌ schedule_time_slots 表是空的！');
      console.log('\\n需要執行: node scripts/setup-time-slots.js');
    } else {
      console.log('Time Slots 列表:');
      rows.forEach((slot, idx) => {
        const status = slot.enabled ? '✅' : '❌';
        console.log(`  ${idx + 1}. ${status} ${slot.start_time} - ${slot.end_time} (ID: ${slot.id})`);
      });

      if (enabled.length === 0) {
        console.log('\\n⚠️ 所有 time slots 都被停用了！');
        console.log('\\n解決方法：');
        console.log('1. 在前端「UCB 設定」頁面啟用 time slots');
        console.log('2. 或執行 SQL:');
        console.log(`   UPDATE schedule_time_slots SET enabled = true WHERE start_time BETWEEN '01:00:00' AND '23:00:00';`);
      }
    }

  } catch (error) {
    console.error('\\n❌ 檢查過程發生錯誤:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

checkTimeSlots()
  .then(() => {
    console.log('\\n✅ 檢查完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
