/**
 * 手動觸發 Insights 同步測試（簡化版）
 */
const mysql = require('mysql2/promise');
const axios = require('axios');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

async function manualSync() {
  console.log('🔄 手動同步 Insights 數據\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 1. 獲取一篇有 Media ID 的貼文
    const [posts] = await connection.execute(`
      SELECT id, post_url, threads_media_id
      FROM posts
      WHERE status = 'POSTED'
        AND threads_media_id IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT 1
    `);

    if (posts.length === 0) {
      console.log('❌ 找不到有 Media ID 的貼文');
      return;
    }

    const post = posts[0];
    console.log('📋 測試貼文:');
    console.log(`   ID:       ${post.id}`);
    console.log(`   Media ID: ${post.threads_media_id}`);
    console.log(`   URL:      ${post.post_url}\n`);

    // 2. 獲取 Access Token
    const [authRows] = await connection.execute(`
      SELECT t.access_token
      FROM threads_auth t
      JOIN threads_accounts ta ON t.account_id = ta.id
      WHERE ta.status = 'ACTIVE'
      ORDER BY t.created_at DESC
      LIMIT 1
    `);

    const bytes = CryptoJS.AES.decrypt(authRows[0].access_token, process.env.ENCRYPTION_KEY);
    const accessToken = bytes.toString(CryptoJS.enc.Utf8);

    // 3. 呼叫 Insights API
    console.log('📡 呼叫 Threads Insights API...\n');
    const response = await axios.get(
      `https://graph.threads.net/v1.0/${post.threads_media_id}/insights`,
      {
        params: {
          metric: 'views,likes,replies,reposts,quotes,shares',
          access_token: accessToken,
        },
      }
    );

    // 4. 解析數據
    const metrics = response.data.data;
    const insights = {
      views: 0,
      likes: 0,
      replies: 0,
      reposts: 0,
      quotes: 0,
      shares: 0,
    };

    metrics.forEach(metric => {
      insights[metric.name] = metric.values[0]?.value || 0;
    });

    console.log('✅ 成功獲取 Insights 數據！\n');
    console.log('━'.repeat(60));
    console.log('📊 數據:');
    console.log('━'.repeat(60));
    Object.entries(insights).forEach(([key, value]) => {
      console.log(`   ${key.padEnd(10)}: ${value.toLocaleString()}`);
    });
    console.log('━'.repeat(60));

    // 5. 計算並保存到資料庫
    const totalInteractions = insights.likes + insights.replies + insights.reposts + insights.shares;
    const engagementRate = insights.views > 0 ? (totalInteractions / insights.views * 100).toFixed(2) : 0;

    console.log(`\n   總互動數: ${totalInteractions.toLocaleString()}`);
    console.log(`   互動率:   ${engagementRate}%\n`);

    // 使用 INSERT ... ON DUPLICATE KEY UPDATE
    const postInsightId = require('crypto').randomBytes(16).toString('hex').slice(0, 36);
    await connection.execute(`
      INSERT INTO post_insights (
        id, post_id, views, likes, replies, reposts, quotes, shares, engagement_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        views = VALUES(views),
        likes = VALUES(likes),
        replies = VALUES(replies),
        reposts = VALUES(reposts),
        quotes = VALUES(quotes),
        shares = VALUES(shares),
        engagement_rate = VALUES(engagement_rate),
        fetched_at = CURRENT_TIMESTAMP
    `, [
      postInsightId,
      post.id,
      insights.views,
      insights.likes,
      insights.replies,
      insights.reposts,
      insights.quotes,
      insights.shares,
      parseFloat(engagementRate),
    ]);

    console.log('✅ 數據已保存到資料庫！\n');

    // 6. 驗證保存的數據
    const [savedInsights] = await connection.execute(`
      SELECT * FROM post_insights WHERE post_id = ? ORDER BY fetched_at DESC LIMIT 1
    `, [post.id]);

    if (savedInsights.length > 0) {
      const data = savedInsights[0];
      console.log('━'.repeat(60));
      console.log('✓ 資料庫驗證:');
      console.log('━'.repeat(60));
      console.log(`   瀏覽數: ${data.views}`);
      console.log(`   按讚數: ${data.likes}`);
      console.log(`   互動率: ${data.engagement_rate}%`);
      console.log(`   更新時間: ${new Date(data.fetched_at).toLocaleString('zh-TW')}`);
      console.log('━'.repeat(60));
      console.log('\n🎉 所有功能正常運作！這些是真實數據！');
    }

  } catch (error) {
    console.error('\n❌ 錯誤:', error.message);
    if (error.response) {
      console.error('API 錯誤:', JSON.stringify(error.response.data, null, 2));
    }
  } finally {
    await connection.end();
  }
}

manualSync();
