/**
 * Direct Insights Sync
 * 直接調用服務層同步 Insights（不使用 HTTP API）
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

// 檢查是否為生產環境
const rootDir = path.join(__dirname, '..');
const isProduction = require('fs').existsSync(path.join(rootDir, 'dist'));

async function directSync() {
  console.log('🔄 直接同步 Insights 數據...\n');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'threads_bot_db',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
  });

  try {
    console.log('✓ 連接資料庫成功\n');

    // 1. 檢查待同步貼文
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

    console.log('待同步貼文列表：');
    pendingPosts.forEach((post, idx) => {
      console.log(`  ${idx + 1}. ID: ${post.id}`);
      console.log(`     Threads Media ID: ${post.threads_media_id}`);
      console.log(`     Posted at: ${post.posted_at}`);
    });

    // 2. 載入服務模組
    console.log(`\n📦 載入服務模組（${isProduction ? '生產環境' : '開發環境'}）...`);

    let threadsInsightsService, createDatabasePool;

    if (isProduction) {
      // 生產環境：使用編譯後的 JS
      const insightsModule = require(path.join(rootDir, 'dist/services/threads-insights.service'));
      threadsInsightsService = insightsModule.default || insightsModule;

      const connectionModule = require(path.join(rootDir, 'dist/database/connection'));
      createDatabasePool = connectionModule.createDatabasePool;
    } else {
      // 開發環境：使用 TypeScript
      require('ts-node/register');

      const insightsModule = require(path.join(rootDir, 'src/services/threads-insights.service'));
      threadsInsightsService = insightsModule.default || insightsModule;

      const connectionModule = require(path.join(rootDir, 'src/database/connection'));
      createDatabasePool = connectionModule.createDatabasePool;
    }

    console.log('✓ 服務模組載入成功\n');

    // 3. 初始化資料庫連接池（服務需要）
    if (typeof createDatabasePool === 'function') {
      await createDatabasePool();
      console.log('✓ 資料庫連接池初始化完成\n');
    }

    // 4. 執行同步
    console.log('⏳ 開始同步 Insights 數據（最近 7 天，最多 50 篇）...\n');

    await threadsInsightsService.syncRecentPostsInsights(7, 50);

    console.log('\n✅ 同步服務執行完成');

    // 5. 檢查同步結果
    console.log('\n⏳ 檢查同步結果...');

    const [afterSync] = await connection.execute(`
      SELECT COUNT(*) as synced_count
      FROM post_insights pi
      WHERE pi.post_id IN (${pendingPosts.map(p => `'${p.id}'`).join(',')})
    `);

    const syncedCount = afterSync[0].synced_count;
    console.log(`\n📊 同步結果：`);
    console.log(`   已同步: ${syncedCount}/${pendingPosts.length} 篇`);

    if (syncedCount > 0) {
      console.log('\n✅ 成功同步 Insights！');

      // 顯示同步後的數據
      const [insights] = await connection.execute(`
        SELECT pi.post_id, pi.views, pi.likes, pi.replies, pi.reposts, pi.last_synced_at
        FROM post_insights pi
        WHERE pi.post_id IN (${pendingPosts.map(p => `'${p.id}'`).join(',')})
      `);

      console.log('\n同步的 Insights 數據：');
      insights.forEach((insight, idx) => {
        console.log(`  ${idx + 1}. Post ID: ${insight.post_id.substring(0, 8)}...`);
        console.log(`     Views: ${insight.views}, Likes: ${insight.likes}, Replies: ${insight.replies}, Reposts: ${insight.reposts}`);
        console.log(`     Last synced: ${insight.last_synced_at}`);
      });
    } else {
      console.log('\n⚠️ 同步未產生數據，可能原因：');
      console.log('   1. Threads Access Token 無效或過期');
      console.log('   2. 貼文太新（Insights 需要一段時間才會有數據）');
      console.log('   3. Threads API 回應錯誤');
      console.log('\n建議：');
      console.log('   - 檢查環境變數中的 Threads Access Token');
      console.log('   - 查看 Runtime Logs 中的錯誤訊息');
      console.log('   - 等待幾分鐘後再次嘗試');
    }

  } catch (error) {
    console.error('\n❌ 同步過程發生錯誤:', error.message);
    console.error('\n完整錯誤：');
    console.error(error);
  } finally {
    await connection.end();
  }
}

directSync()
  .then(() => {
    console.log('\n✅ 腳本執行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
