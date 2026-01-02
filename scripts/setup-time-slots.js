/**
 * 建立預設時段配置
 * 用於 Zeabur 部署後初始化時段設定
 */

const mysql = require('mysql2/promise');

// 從環境變數讀取資料庫配置
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_bot_db',
};

// 預設時段配置
const defaultTimeSlots = [
  {
    name: '早上時段',
    start_hour: 9,
    start_minute: 0,
    end_hour: 12,
    end_minute: 0,
    priority: 1,
  },
  {
    name: '下午時段',
    start_hour: 13,
    start_minute: 0,
    end_hour: 17,
    end_minute: 0,
    priority: 2,
  },
  {
    name: '晚上時段',
    start_hour: 18,
    start_minute: 0,
    end_hour: 21,
    end_minute: 0,
    priority: 3,
  },
];

// 生成簡單的 UUID (相容於沒有 uuid 套件的環境)
function generateSimpleUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function setupTimeSlots() {
  let connection;

  try {
    console.log('連接資料庫...');
    console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`Database: ${dbConfig.database}`);

    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 資料庫連接成功');

    // 檢查是否已有時段
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM schedule_time_slots'
    );

    if (existing[0].count > 0) {
      console.log(`ℹ️  已存在 ${existing[0].count} 個時段，跳過建立`);
      console.log('如需重新建立，請先手動刪除現有時段');
      return;
    }

    console.log('\n開始建立預設時段...');

    for (const slot of defaultTimeSlots) {
      const id = generateSimpleUUID();

      await connection.execute(
        `INSERT INTO schedule_time_slots
         (id, name, start_hour, start_minute, end_hour, end_minute,
          allowed_template_ids, active_days, enabled, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          slot.name,
          slot.start_hour,
          slot.start_minute,
          slot.end_hour,
          slot.end_minute,
          JSON.stringify([]), // 允許所有模板
          JSON.stringify([1, 2, 3, 4, 5, 6, 7]), // 每天都可用
          1, // enabled
          slot.priority,
        ]
      );

      console.log(`  ✓ 建立時段: ${slot.name} (${slot.start_hour}:00-${slot.end_hour}:00)`);
    }

    console.log('\n✅ 預設時段建立完成！');
    console.log('\n已建立的時段：');
    console.log('  1. 早上時段 (09:00-12:00)');
    console.log('  2. 下午時段 (13:00-17:00)');
    console.log('  3. 晚上時段 (18:00-21:00)');
    console.log('\n現在可以使用 UCB 智能排程功能了！');

  } catch (error) {
    console.error('✗ 發生錯誤:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n資料庫連接已關閉');
    }
  }
}

// 執行腳本
if (require.main === module) {
  setupTimeSlots()
    .then(() => {
      console.log('\n腳本執行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n腳本執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { setupTimeSlots };
