/**
 * Add active_days column to smart_schedule_config
 * 手動新增 active_days 欄位到 smart_schedule_config 表
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

async function addActiveDaysColumn() {
  console.log('🔧 新增 active_days 欄位到 smart_schedule_config...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\n');

    // 檢查欄位是否已存在
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'smart_schedule_config'
        AND COLUMN_NAME = 'active_days'
    `, [process.env.MYSQL_DATABASE || 'threads_bot_db']);

    if (columns.length > 0) {
      console.log('✅ active_days 欄位已經存在，無需新增');
      return;
    }

    console.log('📝 新增 active_days 欄位...');

    // 新增欄位（不設定 DEFAULT 值，因為 JSON 類型不支援）
    await connection.execute(`
      ALTER TABLE smart_schedule_config
      ADD COLUMN active_days JSON NULL COMMENT 'UCB 啟用星期，例如：[1,2,3,4,5,6,7] (1=週一, 7=週日)'
      AFTER time_range_end
    `);

    console.log('✅ active_days 欄位新增成功\n');

    // 檢查是否有現有的配置需要更新
    const [configs] = await connection.execute(`
      SELECT id FROM smart_schedule_config WHERE active_days IS NULL
    `);

    if (configs.length > 0) {
      console.log(`📝 更新 ${configs.length} 筆配置的 active_days 預設值為 []...`);

      await connection.execute(`
        UPDATE smart_schedule_config
        SET active_days = '[]'
        WHERE active_days IS NULL
      `);

      console.log('✅ 預設值更新完成');
    }

  } catch (error) {
    console.error('\n❌ 操作失敗:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

addActiveDaysColumn()
  .then(() => {
    console.log('\n✅ 完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
