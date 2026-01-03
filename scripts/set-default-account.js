/**
 * 設定預設 Threads 帳號
 * 將指定的帳號設為預設,並取消其他帳號的預設狀態
 */

const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'threads_bot_db',
};

async function setDefaultAccount() {
  let connection;

  try {
    console.log('連接資料庫...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✓ 資料庫連接成功\n');

    // 1. 列出所有帳號
    const [accounts] = await connection.execute(
      `SELECT id, username, account_id, status, is_default FROM threads_accounts`
    );

    if (accounts.length === 0) {
      console.log('❌ 找不到任何 Threads 帳號');
      return;
    }

    console.log('找到以下 Threads 帳號:');
    console.log('═'.repeat(60));
    accounts.forEach((acc, i) => {
      console.log(`${i + 1}. ${acc.username}`);
      console.log(`   ID: ${acc.id}`);
      console.log(`   Account ID: ${acc.account_id}`);
      console.log(`   狀態: ${acc.status}`);
      console.log(`   預設帳號: ${acc.is_default ? '✓ 是' : '否'}`);
      console.log('');
    });

    // 2. 如果只有一個帳號,直接設為預設
    if (accounts.length === 1) {
      const account = accounts[0];

      if (account.is_default) {
        console.log('✓ 此帳號已經是預設帳號');
        return;
      }

      console.log(`正在將 ${account.username} 設為預設帳號...`);

      await connection.execute(
        'UPDATE threads_accounts SET is_default = 1 WHERE id = ?',
        [account.id]
      );

      console.log('✅ 成功設定為預設帳號!');

    } else {
      // 3. 如果有多個帳號,找到 ACTIVE 狀態的第一個
      const activeAccount = accounts.find(acc => acc.status === 'ACTIVE');

      if (!activeAccount) {
        console.log('❌ 找不到 ACTIVE 狀態的帳號');
        return;
      }

      console.log(`正在將 ${activeAccount.username} 設為預設帳號...`);

      // 開始事務
      await connection.beginTransaction();

      try {
        // 取消所有帳號的預設狀態
        await connection.execute('UPDATE threads_accounts SET is_default = 0');

        // 設定選中的帳號為預設
        await connection.execute(
          'UPDATE threads_accounts SET is_default = 1 WHERE id = ?',
          [activeAccount.id]
        );

        await connection.commit();
        console.log('✅ 成功設定為預設帳號!');

      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }

    // 4. 驗證結果
    const [updated] = await connection.execute(
      `SELECT username, is_default FROM threads_accounts WHERE is_default = 1`
    );

    if (updated.length > 0) {
      console.log('');
      console.log('═'.repeat(60));
      console.log('✓ 當前預設帳號:', updated[0].username);
      console.log('═'.repeat(60));
    }

  } catch (error) {
    console.error('✗ 發生錯誤:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  setDefaultAccount()
    .then(() => {
      console.log('\n✅ 腳本執行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 腳本執行失敗:', error);
      process.exit(1);
    });
}

module.exports = { setDefaultAccount };
