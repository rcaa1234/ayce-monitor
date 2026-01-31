/**
 * 新功能測試腳本
 * 測試危機預警和內容推薦功能的完整性
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('🧪 開始測試新功能...\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean | Promise<boolean>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(r => {
        if (r) {
          console.log(`✅ ${name}`);
          passed++;
        } else {
          console.log(`❌ ${name}`);
          failed++;
        }
      });
    } else if (result) {
      console.log(`✅ ${name}`);
      passed++;
    } else {
      console.log(`❌ ${name}`);
      failed++;
    }
  } catch (e: any) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ========================================
// 1. 檢查服務檔案存在
// ========================================
console.log('\n📁 檢查服務檔案...');

test('危機預警服務存在', () => {
  return fs.existsSync(path.join(__dirname, '../src/services/crisis-alert.service.ts'));
});

test('內容推薦服務存在', () => {
  return fs.existsSync(path.join(__dirname, '../src/services/content-recommendation.service.ts'));
});

test('Prompt Builder 服務存在', () => {
  return fs.existsSync(path.join(__dirname, '../src/services/prompt-builder.service.ts'));
});

// ========================================
// 2. 檢查服務方法
// ========================================
console.log('\n🔧 檢查服務方法...');

const crisisServiceContent = fs.readFileSync(
  path.join(__dirname, '../src/services/crisis-alert.service.ts'),
  'utf-8'
);

test('危機預警: getActiveConfigs 方法', () => {
  return crisisServiceContent.includes('async getActiveConfigs');
});

test('危機預警: analyzeNegativeSurge 方法', () => {
  return crisisServiceContent.includes('async analyzeNegativeSurge');
});

test('危機預警: runCrisisCheck 方法', () => {
  return crisisServiceContent.includes('async runCrisisCheck');
});

test('危機預警: getConfig 方法', () => {
  return crisisServiceContent.includes('async getConfig');
});

test('危機預警: updateConfig 方法', () => {
  return crisisServiceContent.includes('async updateConfig');
});

const recommendServiceContent = fs.readFileSync(
  path.join(__dirname, '../src/services/content-recommendation.service.ts'),
  'utf-8'
);

test('內容推薦: getBrandProfile 方法', () => {
  return recommendServiceContent.includes('async getBrandProfile');
});

test('內容推薦: updateBrandProfile 方法', () => {
  return recommendServiceContent.includes('async updateBrandProfile');
});

test('內容推薦: extractTopicClusters 方法', () => {
  return recommendServiceContent.includes('async extractTopicClusters');
});

test('內容推薦: analyzeTopicRelevance 方法', () => {
  return recommendServiceContent.includes('async analyzeTopicRelevance');
});

test('內容推薦: runContentRecommendation 方法', () => {
  return recommendServiceContent.includes('async runContentRecommendation');
});

test('內容推薦: getTodayTopTopic 方法', () => {
  return recommendServiceContent.includes('async getTodayTopTopic');
});

test('內容推薦: markTopicAsUsed 方法', () => {
  return recommendServiceContent.includes('async markTopicAsUsed');
});

const promptBuilderContent = fs.readFileSync(
  path.join(__dirname, '../src/services/prompt-builder.service.ts'),
  'utf-8'
);

test('Prompt Builder: TopicContext 介面', () => {
  return promptBuilderContent.includes('export interface TopicContext');
});

test('Prompt Builder: buildTopicContextBlock 方法', () => {
  return promptBuilderContent.includes('buildTopicContextBlock');
});

test('Prompt Builder: getTodayTopicContext 方法', () => {
  return promptBuilderContent.includes('async getTodayTopicContext');
});

// ========================================
// 3. 檢查路由註冊
// ========================================
console.log('\n🛤️ 檢查 API 路由...');

const routesContent = fs.readFileSync(
  path.join(__dirname, '../src/routes/monitor.routes.ts'),
  'utf-8'
);

test('路由: GET /crisis/config', () => {
  return routesContent.includes("router.get('/crisis/config'");
});

test('路由: GET /crisis/config/:brandId', () => {
  return routesContent.includes("router.get('/crisis/config/:brandId'");
});

test('路由: PUT /crisis/config/:brandId', () => {
  return routesContent.includes("router.put('/crisis/config/:brandId'");
});

test('路由: GET /crisis/logs', () => {
  return routesContent.includes("router.get('/crisis/logs'");
});

test('路由: PUT /crisis/logs/:id/resolve', () => {
  return routesContent.includes("router.put('/crisis/logs/:id/resolve'");
});

test('路由: POST /crisis/check', () => {
  return routesContent.includes("router.post('/crisis/check'");
});

test('路由: GET /recommendations/profile', () => {
  return routesContent.includes("router.get('/recommendations/profile'");
});

test('路由: PUT /recommendations/profile', () => {
  return routesContent.includes("router.put('/recommendations/profile'");
});

test('路由: GET /recommendations/topics', () => {
  return routesContent.includes("router.get('/recommendations/topics'");
});

test('路由: GET /recommendations/suggestions', () => {
  return routesContent.includes("router.get('/recommendations/suggestions'");
});

test('路由: POST /recommendations/generate', () => {
  return routesContent.includes("router.post('/recommendations/generate'");
});

// ========================================
// 4. 檢查排程器
// ========================================
console.log('\n⏰ 檢查排程器...');

const schedulerContent = fs.readFileSync(
  path.join(__dirname, '../src/cron/scheduler.ts'),
  'utf-8'
);

test('排程: crisisAlertScheduler 定義', () => {
  return schedulerContent.includes('crisisAlertScheduler');
});

test('排程: contentRecommendationScheduler 定義', () => {
  return schedulerContent.includes('contentRecommendationScheduler');
});

test('排程: crisisAlertScheduler 啟動', () => {
  return schedulerContent.includes('crisisAlertScheduler.start()');
});

test('排程: contentRecommendationScheduler 啟動', () => {
  return schedulerContent.includes('contentRecommendationScheduler.start()');
});

// ========================================
// 5. 檢查資料庫 Migration
// ========================================
console.log('\n💾 檢查資料庫 Migration...');

const migrateContent = fs.readFileSync(
  path.join(__dirname, '../src/database/migrate.ts'),
  'utf-8'
);

test('Migration: crisis_alert_config 表', () => {
  return migrateContent.includes('CREATE TABLE IF NOT EXISTS crisis_alert_config');
});

test('Migration: crisis_alert_logs 表', () => {
  return migrateContent.includes('CREATE TABLE IF NOT EXISTS crisis_alert_logs');
});

test('Migration: brand_profiles 表', () => {
  return migrateContent.includes('CREATE TABLE IF NOT EXISTS brand_profiles');
});

test('Migration: content_topics 表', () => {
  return migrateContent.includes('CREATE TABLE IF NOT EXISTS content_topics');
});

test('Migration: content_suggestions 表', () => {
  return migrateContent.includes('CREATE TABLE IF NOT EXISTS content_suggestions');
});

test('Migration: posts.used_topic_id 欄位', () => {
  return migrateContent.includes('used_topic_id');
});

test('Migration: brand_profiles 預設資料', () => {
  return migrateContent.includes("INSERT IGNORE INTO brand_profiles");
});

// ========================================
// 6. 檢查前端 UI
// ========================================
console.log('\n🖥️ 檢查前端 UI...');

const htmlContent = fs.readFileSync(
  path.join(__dirname, '../public/index.html'),
  'utf-8'
);

test('前端: 危機預警 sub-tab 按鈕', () => {
  return htmlContent.includes("switchMonitorTab('crisis')");
});

test('前端: 內容推薦 sub-tab 按鈕', () => {
  return htmlContent.includes("switchMonitorTab('recommend')");
});

test('前端: monitorCrisisTab 容器', () => {
  return htmlContent.includes('id="monitorCrisisTab"');
});

test('前端: monitorRecommendTab 容器', () => {
  return htmlContent.includes('id="monitorRecommendTab"');
});

test('前端: 危機預警設定欄位', () => {
  return htmlContent.includes('id="crisisBaselineDays"') &&
         htmlContent.includes('id="crisisTriggerMultiplier"') &&
         htmlContent.includes('id="crisisCooldownMinutes"');
});

test('前端: Brand Profile 設定欄位', () => {
  return htmlContent.includes('id="profileName"') &&
         htmlContent.includes('id="profileIndustry"') &&
         htmlContent.includes('id="profileProducts"') &&
         htmlContent.includes('id="profileRelevantTopics"');
});

test('前端: loadCrisisData 函數', () => {
  return htmlContent.includes('async function loadCrisisData');
});

test('前端: loadRecommendData 函數', () => {
  return htmlContent.includes('async function loadRecommendData');
});

test('前端: saveCrisisConfig 函數', () => {
  return htmlContent.includes('async function saveCrisisConfig');
});

test('前端: saveBrandProfile 函數', () => {
  return htmlContent.includes('async function saveBrandProfile');
});

test('前端: triggerCrisisCheck 函數', () => {
  return htmlContent.includes('async function triggerCrisisCheck');
});

test('前端: triggerRecommendation 函數', () => {
  return htmlContent.includes('async function triggerRecommendation');
});

test('前端: loadTopics 函數', () => {
  return htmlContent.includes('async function loadTopics');
});

test('前端: loadSuggestions 函數', () => {
  return htmlContent.includes('async function loadSuggestions');
});

test('前端: adoptSuggestion 函數', () => {
  return htmlContent.includes('async function adoptSuggestion');
});

test('前端: rejectSuggestion 函數', () => {
  return htmlContent.includes('async function rejectSuggestion');
});

// ========================================
// 7. 檢查 Generate Worker 整合
// ========================================
console.log('\n🔗 檢查 Generate Worker 整合...');

const workerContent = fs.readFileSync(
  path.join(__dirname, '../src/workers/generate.worker.ts'),
  'utf-8'
);

test('Worker: 取得 topicContext', () => {
  return workerContent.includes('getTodayTopicContext');
});

test('Worker: 傳遞 topicContext 到 buildFullPrompt', () => {
  return workerContent.includes('buildFullPrompt(masterPrompt, plan, topicContext)');
});

test('Worker: 標記 topic 為已使用', () => {
  return workerContent.includes('markTopicAsUsed');
});

test('Worker: 儲存 used_topic_id', () => {
  return workerContent.includes('used_topic_id');
});

// ========================================
// 結果統計
// ========================================
setTimeout(() => {
  console.log('\n' + '='.repeat(50));
  console.log(`📊 測試結果: ${passed} 通過, ${failed} 失敗`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 所有測試通過！');
  } else {
    console.log('\n⚠️ 有測試失敗，請檢查上面的錯誤訊息。');
    process.exit(1);
  }
}, 100);
