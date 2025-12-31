/**
 * 取得並解密 Threads Access Token
 * 用於測試和驗證權限
 */

const mysql = require('mysql2/promise');
const CryptoJS = require('crypto-js');

// 從環境變數讀取設定
require('dotenv').config({ path: '.env.local' });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// 解密函數 (使用 CryptoJS，與系統一致)
function decrypt(encryptedData) {
  try {
    if (!ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY not found in environment');
    }
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
      throw new Error('Decryption returned empty string');
    }
    return decrypted;
  } catch (error) {
    console.error('解密失敗:', error.message);
    return null;
  }
}

async function getTokenInfo() {
  console.log('🔍 正在取得 Threads Token 資訊...\n');

  let connection;
  try {
    // 連接資料庫
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });

    console.log('✓ 已連接到資料庫\n');

    // 查詢最新的 Token
    const [rows] = await connection.execute(`
      SELECT
        ta.id as account_id,
        ta.username,
        ta.account_id as threads_user_id,
        t.access_token as encrypted_token,
        t.expires_at,
        t.created_at,
        t.status
      FROM threads_auth t
      JOIN threads_accounts ta ON t.account_id = ta.id
      WHERE ta.status = 'ACTIVE'
      ORDER BY t.created_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      console.log('⚠️  找不到 Threads 帳號連結');
      console.log('   請先在管理介面連結 Threads 帳號\n');
      return;
    }

    const tokenInfo = rows[0];

    // 解密 Token
    const decryptedToken = decrypt(tokenInfo.encrypted_token);

    if (!decryptedToken) {
      console.log('❌ 無法解密 Token');
      return;
    }

    // 顯示資訊
    console.log('📋 Threads 帳號資訊:');
    console.log('━'.repeat(60));
    console.log(`帳號 ID:        ${tokenInfo.account_id}`);
    console.log(`使用者名稱:     @${tokenInfo.username}`);
    console.log(`Threads User ID: ${tokenInfo.threads_user_id}`);
    console.log(`狀態:           ${tokenInfo.status}`);
    console.log(`建立時間:       ${new Date(tokenInfo.created_at).toLocaleString('zh-TW')}`);
    console.log(`過期時間:       ${new Date(tokenInfo.expires_at).toLocaleString('zh-TW')}`);
    console.log('━'.repeat(60));
    console.log('\n📝 Access Token (已解密):');
    console.log('━'.repeat(60));
    console.log(decryptedToken);
    console.log('━'.repeat(60));

    // 檢查是否過期
    const expiresAt = new Date(tokenInfo.expires_at);
    const now = new Date();
    const daysUntilExpiry = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));

    console.log('\n⏰ Token 狀態:');
    if (daysUntilExpiry > 7) {
      console.log(`   ✅ Token 有效，還有 ${daysUntilExpiry} 天過期`);
    } else if (daysUntilExpiry > 0) {
      console.log(`   ⚠️  Token 即將過期，剩餘 ${daysUntilExpiry} 天`);
    } else {
      console.log(`   ❌ Token 已過期 ${Math.abs(daysUntilExpiry)} 天`);
    }

    // 取得最近的貼文供測試用
    console.log('\n📊 最近的已發布貼文 (供測試用):');
    console.log('━'.repeat(60));

    const [posts] = await connection.execute(`
      SELECT
        id,
        post_url,
        posted_at
      FROM posts
      WHERE status = 'POSTED' AND post_url IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT 5
    `);

    if (posts.length > 0) {
      posts.forEach((post, index) => {
        // 從 URL 提取 Media ID
        const match = post.post_url.match(/\/post\/([^/?]+)/);
        const mediaId = match ? match[1] : 'N/A';

        console.log(`\n${index + 1}. 貼文 ID: ${post.id}`);
        console.log(`   Media ID: ${mediaId}`);
        console.log(`   發布時間: ${new Date(post.posted_at).toLocaleString('zh-TW')}`);
        console.log(`   URL: ${post.post_url}`);
      });
    } else {
      console.log('   沒有已發布的貼文');
    }
    console.log('━'.repeat(60));

    // 提供測試指令
    if (posts.length > 0) {
      const firstPost = posts[0];
      const match = firstPost.post_url.match(/\/post\/([^/?]+)/);
      const mediaId = match ? match[1] : '';

      console.log('\n🧪 測試 Insights API 的指令:');
      console.log('━'.repeat(60));
      console.log('\n1. 編輯測試腳本:');
      console.log(`   打開 test-insights-api.js`);
      console.log(`
   將以下值填入:
   const ACCESS_TOKEN = '${decryptedToken.substring(0, 20)}...'; // (已顯示在上方)
   const MEDIA_ID = '${mediaId}';
      `);
      console.log('\n2. 執行測試:');
      console.log('   node test-insights-api.js');
      console.log('\n3. 或使用 curl 直接測試:');
      console.log(`   curl "https://graph.threads.net/v1.0/${mediaId}/insights?metric=views,likes&access_token=${decryptedToken.substring(0, 20)}..."`);
      console.log('━'.repeat(60));
    }

    console.log('\n✅ 資訊取得完成！\n');

  } catch (error) {
    console.error('\n❌ 發生錯誤:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   請確認 MySQL 資料庫已啟動');
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 執行
getTokenInfo();
