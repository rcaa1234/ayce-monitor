/**
 * 測試更新後的 Insights 同步功能
 */
const mysql = require('mysql2/promise');
const CryptoJS = require('crypto-js');

require('dotenv').config({ path: '.env.local' });

async function testSync() {
  console.log('🧪 測試 Insights 同步功能\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: 'root',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    // 查詢已發布的貼文
    const [posts] = await connection.execute(`
      SELECT id, post_url, threads_media_id, posted_at
      FROM posts
      WHERE status = 'POSTED'
        AND threads_media_id IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT 3
    `);

    console.log(`找到 ${posts.length} 篇貼文可以測試\n`);
    console.log('━'.repeat(80));

    for (const post of posts) {
      console.log(`\n📋 貼文資訊:`);
      console.log(`   ID:       ${post.id}`);
      console.log(`   Media ID: ${post.threads_media_id}`);
      console.log(`   URL:      ${post.post_url}`);
      console.log(`   發布時間: ${new Date(post.posted_at).toLocaleString('zh-TW')}`);

      // 檢查是否已有 insights 數據
      const [insights] = await connection.execute(`
        SELECT views, likes, replies, engagement_rate, fetched_at
        FROM post_insights
        WHERE post_id = ?
        ORDER BY fetched_at DESC
        LIMIT 1
      `, [post.id]);

      if (insights.length > 0) {
        const data = insights[0];
        console.log(`\n   ✓ 已有 Insights 數據:`);
        console.log(`     瀏覽數: ${data.views}`);
        console.log(`     按讚數: ${data.likes}`);
        console.log(`     回覆數: ${data.replies}`);
        console.log(`     互動率: ${data.engagement_rate}%`);
        console.log(`     更新時間: ${new Date(data.fetched_at).toLocaleString('zh-TW')}`);
      } else {
        console.log(`\n   ⚠️  尚無 Insights 數據`);
      }
    }

    console.log('\n' + '━'.repeat(80));
    console.log('\n💡 手動觸發同步測試:');
    console.log('   npm run dev');
    console.log('   然後在另一個終端執行:');
    console.log(`   curl -X POST http://localhost:3000/api/analytics/sync \\`);
    console.log(`     -H "Authorization: Bearer YOUR_JWT_TOKEN" \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"type": "recent", "days": 7}'\n`);

  } catch (error) {
    console.error('❌ 錯誤:', error.message);
  } finally {
    await connection.end();
  }
}

testSync();
