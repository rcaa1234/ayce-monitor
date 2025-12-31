/**
 * 快速測試 Threads Insights API
 * 自動從資料庫取得 Token 並測試
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// 解密函數 (使用 CryptoJS，與系統一致)
function decrypt(encryptedData) {
  try {
    if (!ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY not found');
    }
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
      throw new Error('Decryption returned empty string');
    }
    return decrypted;
  } catch (error) {
    console.error('Decrypt error:', error.message);
    return null;
  }
}

async function quickTest() {
  console.log('🚀 快速測試 Threads Insights API\n');

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

    // 1. 取得 Token
    console.log('📋 步驟 1/4: 取得 Access Token...');
    const [tokenRows] = await connection.execute(`
      SELECT t.access_token, ta.username
      FROM threads_auth t
      JOIN threads_accounts ta ON t.account_id = ta.id
      WHERE ta.status = 'ACTIVE'
      ORDER BY t.created_at DESC
      LIMIT 1
    `);

    if (tokenRows.length === 0) {
      console.log('❌ 找不到 Threads 帳號連結');
      console.log('   請先在管理介面連結 Threads 帳號\n');
      return;
    }

    const accessToken = decrypt(tokenRows[0].access_token);
    const username = tokenRows[0].username;

    if (!accessToken) {
      console.log('❌ Token 解密失敗');
      return;
    }

    console.log(`✓ 已取得 Token (@${username})\n`);

    // 2. 檢查 Token 權限
    console.log('📋 步驟 2/4: 檢查 Token 權限...');
    try {
      const debugResponse = await axios.get('https://graph.threads.net/v1.0/debug_token', {
        params: {
          input_token: accessToken,
          access_token: accessToken,
        },
      });

      const scopes = debugResponse.data.data.scopes || [];
      const hasInsights = scopes.includes('threads_manage_insights');

      console.log(`   權限列表: ${scopes.join(', ')}`);

      if (hasInsights) {
        console.log('   ✅ 具有 threads_manage_insights 權限\n');
      } else {
        console.log('   ⚠️  缺少 threads_manage_insights 權限');
        console.log('   請按照 APPLY_INSIGHTS_PERMISSION.md 的步驟添加權限\n');
        return;
      }
    } catch (error) {
      console.log('   ⚠️  無法驗證權限（跳過此步驟）\n');
    }

    // 3. 取得測試用貼文
    console.log('📋 步驟 3/4: 取得測試用貼文...');
    const [posts] = await connection.execute(`
      SELECT id, post_url, threads_media_id, posted_at
      FROM posts
      WHERE status = 'POSTED' AND threads_media_id IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT 1
    `);

    if (posts.length === 0) {
      console.log('   ⚠️  找不到已發布的貼文或貼文缺少 threads_media_id');
      console.log('   請先發布至少一篇貼文，或執行 node scripts/backfill-media-ids.js\n');
      return;
    }

    const post = posts[0];
    const mediaId = post.threads_media_id;

    console.log(`   ✓ 使用貼文: ${mediaId}`);
    console.log(`   發布時間: ${new Date(post.posted_at).toLocaleString('zh-TW')}\n`);

    // 4. 測試 Insights API
    console.log('📋 步驟 4/4: 呼叫 Insights API...');
    console.log(`   端點: https://graph.threads.net/v1.0/${mediaId}/insights`);

    try {
      const response = await axios.get(
        `https://graph.threads.net/v1.0/${mediaId}/insights`,
        {
          params: {
            metric: 'views,likes,replies,reposts,quotes,shares',
            access_token: accessToken,
          },
        }
      );

      console.log('   ✅ API 呼叫成功！\n');
      console.log('━'.repeat(60));
      console.log('📊 Insights 數據:');
      console.log('━'.repeat(60));

      const metrics = response.data.data;
      const result = {};

      metrics.forEach(metric => {
        const value = metric.values?.[0]?.value || 0;
        result[metric.name] = value;
        console.log(`   ${metric.name.padEnd(10)}: ${value.toLocaleString()}`);
      });

      console.log('━'.repeat(60));

      // 計算互動率
      const totalInteractions = (result.likes || 0) + (result.replies || 0) + (result.reposts || 0) + (result.shares || 0);
      const engagementRate = result.views > 0 ? (totalInteractions / result.views * 100).toFixed(2) : 0;

      console.log(`\n   總互動數: ${totalInteractions.toLocaleString()}`);
      console.log(`   互動率:   ${engagementRate}%`);

      console.log('\n✅ 測試成功！您的 Token 可以正常獲取 Insights 數據。');
      console.log('\n🎉 下一步:');
      console.log('   1. 在 LINE Bot 輸入 /data 查看數據');
      console.log('   2. 或使用 API 手動觸發同步:');
      console.log('      POST /api/analytics/sync');
      console.log('      { "type": "recent", "days": 7, "limit": 10 }\n');

    } catch (error) {
      console.log('   ❌ API 呼叫失敗\n');
      console.log('━'.repeat(60));
      console.log('錯誤詳情:');
      console.log('━'.repeat(60));

      if (error.response) {
        console.log(`   HTTP 狀態: ${error.response.status}`);
        console.log(`   錯誤訊息: ${JSON.stringify(error.response.data, null, 2)}`);

        if (error.response.status === 400 || error.response.status === 403) {
          console.log('\n💡 可能的原因:');
          console.log('   1. Token 沒有 threads_manage_insights 權限');
          console.log('   2. Media ID 不正確或貼文不屬於此帳號');
          console.log('   3. Threads Insights API 尚未對您的帳號開放');
          console.log('\n📖 解決方式:');
          console.log('   請參考 APPLY_INSIGHTS_PERMISSION.md 添加權限');
        }
      } else {
        console.log(`   錯誤: ${error.message}`);
      }
      console.log('━'.repeat(60));
      console.log('\n');
    }

  } catch (error) {
    console.error('\n❌ 發生錯誤:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 執行
quickTest();
