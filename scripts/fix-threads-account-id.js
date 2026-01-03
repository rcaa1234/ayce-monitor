/**
 * 修正 Threads 帳號的 account_id
 * 檢查並修正 threads_accounts 表中缺少 account_id 的記錄
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_bot_db',
};

async function fixThreadsAccountId() {
  let connection;

  try {
    console.log('連接資料庫...');
    console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
    console.log(`Database: ${dbConfig.database}\n`);

    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 資料庫連接成功\n');

    // 檢查 threads_accounts 表中的帳號
    const [accounts] = await connection.execute(
      `SELECT id, user_id, username, account_id, status FROM threads_accounts`
    );

    console.log(`找到 ${accounts.length} 個 Threads 帳號\n`);

    for (const account of accounts) {
      console.log('─'.repeat(60));
      console.log(`帳號 ID: ${account.id}`);
      console.log(`使用者 ID: ${account.user_id}`);
      console.log(`使用者名稱: ${account.username}`);
      console.log(`Threads Account ID: ${account.account_id || '(空)'}`);
      console.log(`狀態: ${account.status}`);

      if (!account.account_id || account.account_id === '') {
        console.log('\n⚠️  此帳號缺少 account_id!');
        console.log('\n請執行以下步驟來修正:');
        console.log('1. 前往前端頁面重新進行 Threads OAuth 授權');
        console.log('2. 或使用 SQL 手動更新:');
        console.log(`   UPDATE threads_accounts SET account_id = 'YOUR_THREADS_USER_ID' WHERE id = '${account.id}';`);
        console.log('\n提示: Threads User ID 通常是一串數字,可以從 Threads API 回應中取得');
      } else {
        console.log('\n✓ account_id 正常');
      }

      console.log('');
    }

    console.log('═'.repeat(60));
    console.log('檢查完成!');
    console.log('═'.repeat(60));

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
  fixThreadsAccountId()
    .then(() => {
      console.log('\n腳本執行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n腳本執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { fixThreadsAccountId };
