/**
 * Threads API Insights 測試腳本
 * 用於測試您的 Access Token 是否有 insights 權限
 */

const axios = require('axios');

// 請替換為您的實際值
const ACCESS_TOKEN = 'YOUR_ACCESS_TOKEN_HERE';
const MEDIA_ID = 'YOUR_MEDIA_ID_HERE'; // 從 post_url 提取的 media ID

async function testInsightsAPI() {
  console.log('🔍 測試 Threads Insights API...\n');

  try {
    // 測試 1: 檢查 Token 權限
    console.log('📋 步驟 1: 檢查 Access Token 權限');
    const debugResponse = await axios.get(
      `https://graph.threads.net/v1.0/debug_token`,
      {
        params: {
          input_token: ACCESS_TOKEN,
          access_token: ACCESS_TOKEN,
        },
      }
    );

    console.log('✓ Token 資訊:');
    console.log('  - App ID:', debugResponse.data.data.app_id);
    console.log('  - 權限:', debugResponse.data.data.scopes);
    console.log('  - 是否有效:', debugResponse.data.data.is_valid);
    console.log('  - 過期時間:', new Date(debugResponse.data.data.expires_at * 1000).toLocaleString());

    // 檢查是否有 insights 權限
    const hasInsightsPermission = debugResponse.data.data.scopes.includes('threads_manage_insights');
    if (!hasInsightsPermission) {
      console.log('\n⚠️  警告: 您的 Token 沒有 "threads_manage_insights" 權限！');
      console.log('   請前往 Meta Developer Console 申請此權限。\n');
      return;
    }

    console.log('✓ Token 具有 insights 權限\n');

    // 測試 2: 獲取貼文 Insights
    console.log('📊 步驟 2: 獲取貼文 Insights');
    const insightsResponse = await axios.get(
      `https://graph.threads.net/v1.0/${MEDIA_ID}/insights`,
      {
        params: {
          metric: 'views,likes,replies,reposts,quotes,shares',
          access_token: ACCESS_TOKEN,
        },
      }
    );

    console.log('✓ 成功獲取 Insights 數據！\n');
    console.log('📈 數據結果:');

    insightsResponse.data.data.forEach(metric => {
      const value = metric.values[0]?.value || 0;
      console.log(`  - ${metric.name}: ${value.toLocaleString()}`);
    });

    console.log('\n✅ API 測試成功！您的 Token 可以正常獲取 Insights 數據。');

  } catch (error) {
    console.error('\n❌ API 測試失敗:');

    if (error.response) {
      console.error('  狀態碼:', error.response.status);
      console.error('  錯誤訊息:', error.response.data);

      if (error.response.status === 400 || error.response.status === 403) {
        console.error('\n💡 可能的原因:');
        console.error('  1. Access Token 沒有 "threads_manage_insights" 權限');
        console.error('  2. Media ID 不正確');
        console.error('  3. 該貼文不屬於您的帳號');
        console.error('  4. Threads API Insights 尚未對您的帳號開放');
      }
    } else {
      console.error('  錯誤:', error.message);
    }
  }
}

// 執行測試
testInsightsAPI();
