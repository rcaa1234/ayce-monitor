const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env.local
const envPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

async function fixThreadsTables() {
  let connection;

  try {
    console.log('連接到資料庫...');
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'threads_posting',
      multipleStatements: true,
    });

    console.log('✓ 資料庫連接成功\n');

    // Step 1: 檢查現有資料表
    console.log('步驟 1: 檢查現有資料表結構...');

    try {
      const [accountsColumns] = await connection.query(
        "SHOW COLUMNS FROM threads_accounts"
      );
      console.log('threads_accounts 現有欄位:');
      accountsColumns.forEach(col => {
        console.log(`  - ${col.Field} (${col.Type})`);
      });
    } catch (error) {
      console.log('threads_accounts 不存在 (將建立新表)');
    }

    try {
      const [authColumns] = await connection.query(
        "SHOW COLUMNS FROM threads_auth"
      );
      console.log('\nthreads_auth 現有欄位:');
      authColumns.forEach(col => {
        console.log(`  - ${col.Field} (${col.Type})`);
      });
    } catch (error) {
      console.log('threads_auth 不存在 (將建立新表)');
    }

    // Step 2: 先暫時停用外鍵檢查
    console.log('\n步驟 2: 停用外鍵檢查...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✓ 外鍵檢查已停用');

    // Step 3: 刪除舊資料表
    console.log('\n步驟 3: 刪除舊資料表...');
    await connection.query('DROP TABLE IF EXISTS threads_auth');
    console.log('✓ threads_auth 已刪除');

    await connection.query('DROP TABLE IF EXISTS threads_accounts');
    console.log('✓ threads_accounts 已刪除');

    // Step 4: 建立新資料表
    console.log('\n步驟 4: 建立新資料表...');

    await connection.query(`
      CREATE TABLE threads_accounts (
        id CHAR(36) PRIMARY KEY,
        user_id CHAR(36) NOT NULL,
        username VARCHAR(100) NOT NULL,
        account_id VARCHAR(100) NOT NULL,
        status ENUM('ACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
        is_default TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_username (username),
        INDEX idx_user_id (user_id),
        INDEX idx_account_id (account_id),
        INDEX idx_is_default (is_default)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('✓ threads_accounts 建立成功');

    await connection.query(`
      CREATE TABLE threads_auth (
        id CHAR(36) PRIMARY KEY,
        account_id CHAR(36) NOT NULL,
        access_token TEXT NOT NULL,
        token_type VARCHAR(20) DEFAULT 'Bearer',
        expires_at DATETIME NOT NULL,
        last_refreshed_at DATETIME NULL,
        status ENUM('OK', 'EXPIRED', 'ACTION_REQUIRED') NOT NULL DEFAULT 'OK',
        scopes JSON NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES threads_accounts(id) ON DELETE CASCADE,
        INDEX idx_account_id (account_id),
        INDEX idx_expires_at (expires_at),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('✓ threads_auth 建立成功');

    // Step 5: 重新啟用外鍵檢查
    console.log('\n步驟 5: 重新啟用外鍵檢查...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✓ 外鍵檢查已啟用');

    // Step 6: 驗證新資料表
    console.log('\n步驟 6: 驗證新資料表結構...');
    const [newAccountsColumns] = await connection.query(
      "SHOW COLUMNS FROM threads_accounts"
    );
    console.log('\nthreads_accounts 新欄位:');
    newAccountsColumns.forEach(col => {
      console.log(`  ✓ ${col.Field} (${col.Type})`);
    });

    const [newAuthColumns] = await connection.query(
      "SHOW COLUMNS FROM threads_auth"
    );
    console.log('\nthreads_auth 新欄位:');
    newAuthColumns.forEach(col => {
      console.log(`  ✓ ${col.Field} (${col.Type})`);
    });

    console.log('\n========================================');
    console.log('✓✓✓ 資料表修復完成! ✓✓✓');
    console.log('========================================');
    console.log('\n接下來請執行:');
    console.log('1. npm run build');
    console.log('2. 重新啟動 npm run dev');
    console.log('3. 重新進行 Threads 授權\n');

  } catch (error) {
    console.error('\n❌ 錯誤:', error.message);
    console.error('完整錯誤:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('資料庫連接已關閉');
    }
  }
}

// 執行修復
fixThreadsTables();
