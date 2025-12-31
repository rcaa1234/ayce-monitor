/**
 * 直接測試 Insights 同步功能（使用 TypeScript）
 */
import '../src/config/dotenv'; // Load environment variables
import logger from '../src/utils/logger';
import threadsInsightsService from '../src/services/threads-insights.service';
import { PostModel } from '../src/models/post.model';
import { InsightsModel } from '../src/models/insights.model';

async function testDirectSync() {
  console.log('🧪 直接測試 Insights 同步功能\n');

  try {
    // 1. 獲取最近的貼文
    const recentPosts = await PostModel.getRecentPosted(3);
    console.log(`找到 ${recentPosts.length} 篇最近發布的貼文\n`);

    if (recentPosts.length === 0) {
      console.log('⚠️  沒有找到已發布的貼文');
      return;
    }

    // 2. 測試同步單篇貼文
    const testPost = recentPosts[0];
    console.log('📋 測試貼文:');
    console.log(`   ID:        ${testPost.id}`);
    console.log(`   URL:       ${testPost.post_url}`);
    console.log(`   Media ID:  ${testPost.threads_media_id || '(無)'}\n`);

    if (!testPost.threads_media_id) {
      console.log('❌ 此貼文沒有 threads_media_id，無法同步');
      console.log('   請先執行: node scripts/backfill-media-ids.js\n');
      return;
    }

    console.log('🔄 開始同步 Insights...\n');
    const success = await threadsInsightsService.syncPostInsights(testPost.id);

    if (success) {
      console.log('✅ 同步成功！\n');

      // 查詢同步後的數據
      const insights = await InsightsModel.getPostInsights(testPost.id);

      if (insights) {
        console.log('━'.repeat(60));
        console.log('📊 Insights 數據:');
        console.log('━'.repeat(60));
        console.log(`   瀏覽數: ${insights.views.toLocaleString()}`);
        console.log(`   按讚數: ${insights.likes.toLocaleString()}`);
        console.log(`   回覆數: ${insights.replies.toLocaleString()}`);
        console.log(`   轉發數: ${insights.reposts.toLocaleString()}`);
        console.log(`   引用數: ${insights.quotes.toLocaleString()}`);
        console.log(`   分享數: ${insights.shares.toLocaleString()}`);
        console.log(`   互動率: ${insights.engagement_rate}%`);
        console.log('━'.repeat(60));
        console.log(`\n✅ 這是真實數據，不是模擬數據！`);
      }
    } else {
      console.log('❌ 同步失敗，請檢查日誌');
    }

    // 3. 測試批次同步
    console.log('\n━'.repeat(60));
    console.log('🔄 測試批次同步（最近 7 天的貼文）...\n');
    await threadsInsightsService.syncRecentPostsInsights(7, 10);
    console.log('\n✅ 批次同步完成！');

  } catch (error: any) {
    console.error('\n❌ 發生錯誤:', error.message);
    console.error(error.stack);
  } finally {
    process.exit(0);
  }
}

testDirectSync();
