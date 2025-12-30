const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

async function cleanupTestData() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'threads_posting',
    });

    console.log('✓ 已連接到資料庫\n');

    // 查看當前資料
    console.log('=== 當前資料概覽 ===');
    const [posts] = await connection.query('SELECT COUNT(*) as count FROM posts');
    const [revisions] = await connection.query('SELECT COUNT(*) as count FROM post_revisions');
    const [reviews] = await connection.query('SELECT COUNT(*) as count FROM review_requests');

    console.log(`文章數量: ${posts[0].count}`);
    console.log(`修訂版本數量: ${revisions[0].count}`);
    console.log(`審核請求數量: ${reviews[0].count}`);
    console.log('');

    if (posts[0].count === 0) {
      console.log('✓ 沒有測試資料需要清理');
      return;
    }

    // 詢問是否清理
    console.log('⚠️  即將清理所有測試資料（保留使用者和 Threads 帳號）');
    console.log('');

    // 開始清理
    console.log('開始清理...');

    // 先清理相關表（避免外鍵約束）
    await connection.query('DELETE FROM review_requests');
    console.log('✓ 已清理審核請求');

    await connection.query('DELETE FROM post_revisions');
    console.log('✓ 已清理修訂版本');

    await connection.query('DELETE FROM posts');
    console.log('✓ 已清理文章');

    await connection.query('DELETE FROM audit_logs WHERE target_type = "post"');
    console.log('✓ 已清理相關審計日誌');

    console.log('');
    console.log('✅ 測試資料清理完成！');
    console.log('');
    console.log('保留的資料：');
    console.log('  - 使用者帳號');
    console.log('  - 角色權限');
    console.log('  - Threads 授權資訊');
    console.log('  - 系統設定');

  } catch (error) {
    console.error('❌ 清理失敗:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

cleanupTestData();
