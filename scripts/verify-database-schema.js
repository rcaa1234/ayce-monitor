/**
 * 驗證並修正資料庫結構
 * 檢查所有必要的欄位是否存在,如果不存在則添加
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_bot_db',
};

// 定義需要檢查的表和欄位
const requiredColumns = {
  posts: [
    'id',
    'status',
    'created_by',
    'approved_by',
    'approved_at',
    'posted_at',
    'post_url',
    'last_error_code',
    'last_error_message',
    'threads_media_id', // Migration 15 added
    'created_at',
    'updated_at'
  ],
  smart_schedule_config: [
    'id',
    'exploration_factor',
    'min_trials_per_template',
    'posts_per_day',
    'auto_schedule_enabled',
    'threads_account_id', // Migration 22 added
    'line_user_id', // Migration 22 added
    'time_range_start', // Migration 22 added
    'time_range_end', // Migration 22 added
    'daily_schedule_time',
    'enabled',
    'created_at',
    'updated_at'
  ],
  threads_accounts: [
    'id',
    'user_id',
    'username',
    'account_id',
    'status', // 注意:是 status 不是 is_active
    'is_default',
    'created_at'
  ]
};

async function checkAndFixSchema() {
  let connection;

  try {
    console.log('連接資料庫...');
    console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`Database: ${dbConfig.database}\n`);

    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 資料庫連接成功\n');

    // 檢查每個表
    for (const [tableName, columns] of Object.entries(requiredColumns)) {
      console.log(`檢查表: ${tableName}`);
      console.log('─'.repeat(50));

      // 取得表的現有欄位
      const [rows] = await connection.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [dbConfig.database, tableName]
      );

      const existingColumns = rows.map(row => row.COLUMN_NAME);
      console.log(`現有欄位 (${existingColumns.length}): ${existingColumns.join(', ')}`);

      // 檢查缺少的欄位
      const missingColumns = columns.filter(col => !existingColumns.includes(col));

      if (missingColumns.length > 0) {
        console.log(`\n⚠️  缺少欄位 (${missingColumns.length}): ${missingColumns.join(', ')}`);
        console.log(`\n建議執行以下 SQL 手動添加欄位:`);

        // 根據表名提供具體的 ALTER TABLE 語句
        if (tableName === 'smart_schedule_config' && missingColumns.includes('threads_account_id')) {
          console.log(`
ALTER TABLE smart_schedule_config
ADD COLUMN threads_account_id CHAR(36) COMMENT 'Threads 發布帳號 ID' AFTER auto_schedule_enabled,
ADD COLUMN line_user_id VARCHAR(100) COMMENT 'LINE 通知接收者 User ID' AFTER threads_account_id,
ADD COLUMN time_range_start TIME DEFAULT '09:00:00' COMMENT 'UCB 發文時段開始時間' AFTER line_user_id,
ADD COLUMN time_range_end TIME DEFAULT '21:00:00' COMMENT 'UCB 發文時段結束時間' AFTER time_range_start;
          `);
        }

        if (tableName === 'posts' && missingColumns.includes('threads_media_id')) {
          console.log(`
ALTER TABLE posts
ADD COLUMN threads_media_id VARCHAR(64) NULL AFTER post_url,
ADD INDEX idx_threads_media_id (threads_media_id);
          `);
        }
      } else {
        console.log(`\n✓ 所有必要欄位都存在`);
      }

      console.log('\n');
    }

    console.log('═'.repeat(50));
    console.log('檢查完成!');
    console.log('═'.repeat(50));

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

if (require.main === module) {
  checkAndFixSchema()
    .then(() => {
      console.log('\n腳本執行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n腳本執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { checkAndFixSchema };
