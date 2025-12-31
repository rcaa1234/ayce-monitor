/**
 * 使用正確的 Media ID 測試 Insights API
 */
const mysql = require('mysql2/promise');
const axios = require('axios');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

async function testInsights() {
  console.log('🧪 測試 Threads Insights API (使用正確的 Media ID)\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  // 獲取 Token
  const [rows] = await connection.execute(`
    SELECT t.access_token FROM threads_auth t
    JOIN threads_accounts ta ON t.account_id = ta.id
    WHERE ta.status = 'ACTIVE'
    ORDER BY t.created_at DESC LIMIT 1
  `);

  const bytes = CryptoJS.AES.decrypt(rows[0].access_token, process.env.ENCRYPTION_KEY);
  const accessToken = bytes.toString(CryptoJS.enc.Utf8);

  // 測試幾個不同的 Media ID
  const testMediaIds = [
    '18094762843934891',  // 最新的貼文
    '17993599598904701',  // DS4BXARkif_
    '18076066292197812',  // DS15f6fGFj3
  ];

  for (const mediaId of testMediaIds) {
    console.log(`\n📊 測試 Media ID: ${mediaId}`);
    console.log('━'.repeat(60));

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

      console.log('✅ 成功！\n');
      console.log('數據:');
      response.data.data.forEach(metric => {
        const value = metric.values[0]?.value || 0;
        console.log(`   ${metric.name.padEnd(10)}: ${value.toLocaleString()}`);
      });

    } catch (error) {
      console.log('❌ 失敗');
      if (error.response) {
        console.log(`   狀態: ${error.response.status}`);
        console.log(`   錯誤: ${error.response.data.error.message}`);
      }
    }
  }

  await connection.end();
  console.log('\n' + '━'.repeat(60));
  console.log('✅ 測試完成\n');
}

testInsights().catch(console.error);
