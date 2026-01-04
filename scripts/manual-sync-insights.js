/**
 * Manual Insights Sync Script
 * 手動觸發 Insights 同步，用於測試和初始化
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
require('dotenv').config();

async function syncInsights() {
  console.log('🔄 開始手動同步 Insights...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\n');

    // 1. 檢查已發布但未同步 Insights 的貼文
    const [pendingPosts] = await connection.execute(`
      SELECT p.id, p.threads_media_id, p.posted_at
      FROM posts p
      LEFT JOIN post_insights pi ON p.id = pi.post_id
      WHERE p.status = 'POSTED'
        AND p.threads_media_id IS NOT NULL
        AND pi.id IS NULL
      ORDER BY p.posted_at DESC
      LIMIT 10
    `);

    console.log(`找到 ${pendingPosts.length} 篇待同步的貼文\n`);

    if (pendingPosts.length === 0) {
      console.log('✅ 所有已發布貼文都已同步 Insights');
      return;
    }

    // 2. 顯示待同步的貼文
    console.log('待同步貼文列表：');
    pendingPosts.forEach((post, idx) => {
      console.log(`  ${idx + 1}. ID: ${post.id}`);
      console.log(`     Threads Media ID: ${post.threads_media_id}`);
      console.log(`     Posted at: ${post.posted_at}`);
    });

    // 3. 調用同步 API
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const syncUrl = `${baseUrl}/api/statistics/sync`;

    console.log(`\n📡 調用同步 API: ${syncUrl}`);
    console.log(`   參數: { days: 7, limit: 50 }\n`);

    try {
      const response = await axios.post(syncUrl, {
        days: 7,
        limit: 50
      }, {
        timeout: 30000
      });

      if (response.data.success) {
        console.log('✅ 同步請求已發送成功');
        console.log(`   訊息: ${response.data.message}`);
        console.log('\n⏳ 同步過程在背景執行，請稍後檢查結果');
        console.log('   約需等待 10-30 秒後再次檢查');
      } else {
        console.log('❌ 同步請求失敗');
        console.log(`   錯誤: ${response.data.error}`);
      }
    } catch (apiError) {
      if (apiError.code === 'ECONNREFUSED') {
        console.log('❌ 無法連接到 API 服務');
        console.log('   請確認：');
        console.log('   1. 服務是否正在運行');
        console.log(`   2. BASE_URL 設定是否正確: ${baseUrl}`);
      } else {
        console.log('❌ API 請求失敗:', apiError.message);
      }
    }

    // 4. 等待一段時間後檢查結果
    console.log('\n⏳ 等待 15 秒後檢查同步結果...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    const [afterSync] = await connection.execute(`
      SELECT COUNT(*) as synced_count
      FROM post_insights pi
      WHERE pi.post_id IN (${pendingPosts.map(p => `'${p.id}'`).join(',')})
    `);

    const syncedCount = afterSync[0].synced_count;
    console.log(`\n📊 同步結果：`);
    console.log(`   已同步: ${syncedCount}/${pendingPosts.length} 篇`);

    if (syncedCount > 0) {
      console.log('\n✅ 部分或全部貼文已成功同步 Insights！');

      // 顯示同步後的數據
      const [insights] = await connection.execute(`
        SELECT pi.post_id, pi.views, pi.likes, pi.replies, pi.reposts, pi.last_synced_at
        FROM post_insights pi
        WHERE pi.post_id IN (${pendingPosts.map(p => `'${p.id}'`).join(',')})
      `);

      console.log('\n同步的 Insights 數據：');
      insights.forEach((insight, idx) => {
        console.log(`  ${idx + 1}. Post ID: ${insight.post_id}`);
        console.log(`     Views: ${insight.views}, Likes: ${insight.likes}, Replies: ${insight.replies}`);
        console.log(`     Last synced: ${insight.last_synced_at}`);
      });
    } else if (syncedCount === 0) {
      console.log('\n⚠️ 同步尚未完成，可能原因：');
      console.log('   1. Threads API 回應較慢');
      console.log('   2. Access Token 無效或過期');
      console.log('   3. 貼文太新（Insights 需要一段時間才會有數據）');
      console.log('\n建議：');
      console.log('   - 檢查 Runtime Logs 中的錯誤訊息');
      console.log('   - 等待幾分鐘後再次執行此腳本');
      console.log('   - 確認 Threads Access Token 是否有效');
    }

  } catch (error) {
    console.error('\n❌ 同步過程發生錯誤:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

syncInsights()
  .then(() => {
    console.log('\n✅ 腳本執行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
