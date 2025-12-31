/**
 * 從 Threads API 獲取正確的 Media IDs
 */
const mysql = require('mysql2/promise');
const axios = require('axios');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function decrypt(encryptedData) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return null;
  }
}

async function getMediaIds() {
  console.log('🔍 獲取 Threads Media IDs\n');

  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });

    // 獲取 Token 和 Account ID
    const [authRows] = await connection.execute(`
      SELECT t.access_token, ta.account_id, ta.username
      FROM threads_auth t
      JOIN threads_accounts ta ON t.account_id = ta.id
      WHERE ta.status = 'ACTIVE'
      ORDER BY t.created_at DESC
      LIMIT 1
    `);

    if (authRows.length === 0) {
      console.log('❌ 找不到 Threads 帳號');
      return;
    }

    const accessToken = decrypt(authRows[0].access_token);
    const userId = authRows[0].account_id;  // Threads User ID
    const username = authRows[0].username;

    if (!accessToken) {
      console.log('❌ Token 解密失敗');
      return;
    }

    console.log(`✓ 帳號: @${username}`);
    console.log(`✓ User ID: ${userId}\n`);

    // 呼叫 Threads API 獲取 Media IDs
    console.log('📡 呼叫 Threads API...');
    console.log(`   GET /v1.0/${userId}/threads\n`);

    const response = await axios.get(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      {
        params: {
          fields: 'id,text,timestamp,permalink',
          limit: 10,
          access_token: accessToken,
        },
      }
    );

    console.log('✅ 成功獲取貼文列表\n');
    console.log('━'.repeat(80));
    console.log('📋 最近的貼文 Media IDs:');
    console.log('━'.repeat(80));

    const media = response.data.data;

    if (media.length === 0) {
      console.log('   沒有找到貼文');
    } else {
      media.forEach((post, index) => {
        const text = post.text ? post.text.substring(0, 50) : '(無文字)';
        const timestamp = new Date(post.timestamp).toLocaleString('zh-TW');

        console.log(`\n${index + 1}. Media ID: ${post.id}`);
        console.log(`   URL: ${post.permalink}`);
        console.log(`   文字: ${text}${post.text && post.text.length > 50 ? '...' : ''}`);
        console.log(`   時間: ${timestamp}`);
      });

      console.log('\n' + '━'.repeat(80));
      console.log('\n✅ 現在可以使用這些 Media ID 來測試 Insights API');
      console.log(`\n測試指令範例 (使用第一個貼文):`);
      console.log(`node -e "const axios = require('axios'); axios.get('https://graph.threads.net/v1.0/${media[0].id}/insights', { params: { metric: 'views,likes', access_token: 'YOUR_TOKEN' }}).then(r => console.log(r.data)).catch(e => console.error(e.response.data));"`);
    }

  } catch (error) {
    console.error('\n❌ 發生錯誤:', error.message);
    if (error.response) {
      console.error('API 錯誤:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

getMediaIds();
