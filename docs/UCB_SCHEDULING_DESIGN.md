# UCB 智能排程系統設計文檔

## 🎯 系統目標

每天自動發布一篇 Threads 貼文,使用 UCB (Upper Confidence Bound) 演算法自動選擇最佳時段和模板組合,持續優化發文策略。

---

## 📊 資料庫架構

### 1. content_templates (內容模板表)
用途:儲存提示詞模板,與排程系統分離

```sql
CREATE TABLE content_templates (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE COMMENT '模板名稱',
  prompt TEXT NOT NULL COMMENT 'AI 生成提示詞',
  description TEXT COMMENT '模板描述',
  enabled BOOLEAN DEFAULT true COMMENT '是否啟用',

  -- UCB 統計數據
  total_uses INT UNSIGNED DEFAULT 0 COMMENT '總使用次數',
  total_views INT UNSIGNED DEFAULT 0 COMMENT '總瀏覽數',
  total_engagement INT UNSIGNED DEFAULT 0 COMMENT '總互動數',
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '平均互動率(%)',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_enabled (enabled),
  INDEX idx_performance (avg_engagement_rate DESC)
);
```

### 2. schedule_time_slots (時段配置表)
用途:定義可發文的時段,及每個時段可用的模板池

```sql
CREATE TABLE schedule_time_slots (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '時段名稱,例如:晚間黃金時段',
  start_hour TINYINT UNSIGNED NOT NULL COMMENT '開始小時 (0-23)',
  start_minute TINYINT UNSIGNED NOT NULL COMMENT '開始分鐘 (0-59)',
  end_hour TINYINT UNSIGNED NOT NULL COMMENT '結束小時 (0-23)',
  end_minute TINYINT UNSIGNED NOT NULL COMMENT '結束分鐘 (0-59)',

  -- 該時段可用的模板 ID 列表 (JSON Array)
  allowed_template_ids JSON NOT NULL COMMENT '可用模板ID列表,例如:["id1","id2"]',

  -- 活躍日期設定
  active_days JSON NOT NULL COMMENT '活躍星期,例如:[1,2,3,4,5,6,7]',

  enabled BOOLEAN DEFAULT true COMMENT '是否啟用',
  priority INT DEFAULT 0 COMMENT '優先級 (數字越大優先級越高)',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_enabled (enabled)
);
```

### 3. post_performance_log (貼文表現記錄)
用途:記錄每次發文的詳細表現,用於 UCB 計算

```sql
CREATE TABLE post_performance_log (
  id CHAR(36) PRIMARY KEY,
  post_id CHAR(36) NOT NULL COMMENT '關聯的貼文 ID',
  template_id CHAR(36) COMMENT '使用的模板 ID',
  time_slot_id CHAR(36) COMMENT '使用的時段 ID',

  -- 發文時間資訊
  posted_year SMALLINT UNSIGNED COMMENT '發文年份',
  posted_month TINYINT UNSIGNED COMMENT '發文月份 (1-12)',
  posted_day TINYINT UNSIGNED COMMENT '發文日期 (1-31)',
  posted_hour TINYINT UNSIGNED COMMENT '發文小時 (0-23)',
  posted_minute TINYINT UNSIGNED COMMENT '發文分鐘 (0-59)',
  posted_weekday TINYINT UNSIGNED COMMENT '星期幾 (1=週一...7=週日)',

  -- 表現數據
  views INT UNSIGNED DEFAULT 0 COMMENT '瀏覽數',
  likes INT UNSIGNED DEFAULT 0 COMMENT '按讚數',
  replies INT UNSIGNED DEFAULT 0 COMMENT '回覆數',
  reposts INT UNSIGNED DEFAULT 0 COMMENT '轉發數',
  quotes INT UNSIGNED DEFAULT 0 COMMENT '引用數',
  shares INT UNSIGNED DEFAULT 0 COMMENT '分享數',
  engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '互動率 (%)',

  -- UCB 決策記錄
  ucb_score DECIMAL(10,4) COMMENT 'UCB 分數',
  was_exploration BOOLEAN DEFAULT false COMMENT '是否為探索性選擇',
  selection_reason TEXT COMMENT '選擇原因說明',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES content_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (time_slot_id) REFERENCES schedule_time_slots(id) ON DELETE SET NULL,

  INDEX idx_post (post_id),
  INDEX idx_template (template_id),
  INDEX idx_time_slot (time_slot_id),
  INDEX idx_posted_time (posted_year, posted_month, posted_day)
);
```

### 4. smart_schedule_config (智能排程配置)
用途:全域配置,控制 UCB 行為

```sql
CREATE TABLE smart_schedule_config (
  id CHAR(36) PRIMARY KEY,

  -- UCB 參數
  exploration_factor DECIMAL(3,2) DEFAULT 1.50 COMMENT 'UCB 探索係數 (1.0-2.0)',
  min_trials_per_template INT DEFAULT 5 COMMENT '每個模板最少試驗次數',

  -- 排程設定
  posts_per_day TINYINT UNSIGNED DEFAULT 1 COMMENT '每天發文次數',
  auto_schedule_enabled BOOLEAN DEFAULT true COMMENT '是否啟用自動排程',

  -- 執行時間設定
  schedule_check_cron VARCHAR(50) DEFAULT '0 */5 * * * *' COMMENT 'Cron 表達式',

  enabled BOOLEAN DEFAULT true COMMENT '是否啟用',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 5. daily_auto_schedule (每日自動排程記錄)
用途:記錄系統自動建立的排程

```sql
CREATE TABLE daily_auto_schedule (
  id CHAR(36) PRIMARY KEY,
  schedule_date DATE NOT NULL COMMENT '排程日期',

  -- AI 選擇結果
  selected_time_slot_id CHAR(36) COMMENT '選擇的時段',
  selected_template_id CHAR(36) COMMENT '選擇的模板',
  scheduled_time DATETIME NOT NULL COMMENT '預定發文時間',

  -- 執行狀態
  status ENUM('PENDING', 'GENERATED', 'POSTED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING',
  post_id CHAR(36) COMMENT '生成的貼文 ID',

  -- UCB 決策數據
  ucb_score DECIMAL(10,4) COMMENT 'UCB 分數',
  selection_reason TEXT COMMENT '選擇原因',

  executed_at DATETIME COMMENT '實際執行時間',
  error_message TEXT COMMENT '錯誤訊息',

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (selected_time_slot_id) REFERENCES schedule_time_slots(id),
  FOREIGN KEY (selected_template_id) REFERENCES content_templates(id),
  FOREIGN KEY (post_id) REFERENCES posts(id),

  UNIQUE KEY uk_schedule_date (schedule_date),
  INDEX idx_status (status),
  INDEX idx_scheduled_time (scheduled_time)
);
```

---

## 🤖 UCB 演算法實作

### UCB 公式
```
UCB分數 = 平均互動率 + exploration_factor × √(ln(總發文數) / 該模板使用次數)
```

### 決策流程

```javascript
// 1. 取得所有啟用的時段和模板
const timeSlots = await getEnabledTimeSlots();
const templates = await getEnabledTemplates();

// 2. 計算目前時間最適合的時段
const bestTimeSlot = selectBestTimeSlot(timeSlots);

// 3. 取得該時段允許的模板
const allowedTemplates = templates.filter(t =>
  bestTimeSlot.allowed_template_ids.includes(t.id)
);

// 4. 計算每個模板的 UCB 分數
const totalPosts = await getTotalPostsCount();
const scores = allowedTemplates.map(template => ({
  template,
  ucbScore: calculateUCB(template, totalPosts, explorationFactor)
}));

// 5. 選擇最高分的模板
const selected = scores.sort((a, b) => b.ucbScore - a.ucbScore)[0];

// 6. 記錄選擇原因
const reason = template.total_uses < minTrials
  ? '探索階段：該模板數據不足'
  : `UCB選擇：分數=${selected.ucbScore.toFixed(4)}`;
```

### UCB 計算函數

```typescript
function calculateUCB(
  template: Template,
  totalPosts: number,
  explorationFactor: number
): number {
  // 如果使用次數不足,給予高優先級
  if (template.total_uses < minTrialsPerTemplate) {
    return 999 + Math.random(); // 隨機化避免固定順序
  }

  // 計算平均互動率 (歸一化到 0-1)
  const avgRate = template.avg_engagement_rate / 100;

  // 計算探索獎勵
  const explorationBonus = explorationFactor * Math.sqrt(
    Math.log(totalPosts) / template.total_uses
  );

  return avgRate + explorationBonus;
}
```

---

## 🎨 網頁介面架構

### 1. 模板管理頁面 (templates.html)
功能:
- ✅ 列出所有模板 (顯示名稱、描述、使用次數、平均互動率)
- ✅ 新增模板 (名稱、描述、提示詞)
- ✅ 編輯模板
- ✅ 刪除模板
- ✅ 啟用/停用模板
- ✅ 查看模板詳細統計 (歷史表現圖表)

### 2. 智能排程配置頁面 (smart-scheduling.html)
功能:
- ✅ 設定時段 (名稱、時間範圍、優先級)
- ✅ 為時段配置可用模板 (多選)
- ✅ 設定活躍日期 (週一到週日)
- ✅ 調整 UCB 參數 (探索係數、最少試驗次數)
- ✅ 設定每天發文次數
- ✅ 查看自動排程歷史
- ✅ 查看 AI 決策分析 (為什麼選這個模板)

### 3. 排程分析儀表板 (scheduling-dashboard.html)
功能:
- ✅ 時段表現分析 (哪個時段表現最好)
- ✅ 模板表現分析 (哪個模板最受歡迎)
- ✅ 時段×模板組合分析 (最佳組合推薦)
- ✅ UCB 學習曲線 (探索vs利用比例變化)
- ✅ 預測未來表現

---

## 🔄 自動排程執行流程

### 每日自動排程 (每天 00:00 執行)
```
1. 檢查今天是否已建立排程
2. 如果沒有:
   a. 取得所有啟用的時段
   b. 過濾今天活躍的時段
   c. 選擇優先級最高的時段
   d. 使用 UCB 從該時段的模板池選擇最佳模板
   e. 在該時段內隨機選擇一個發文時間
   f. 建立 daily_auto_schedule 記錄
```

### 排程執行器 (每 5 分鐘檢查)
```
1. 查詢 status='PENDING' 且 scheduled_time <= NOW() 的排程
2. 對每個排程:
   a. 取得選定的模板提示詞
   b. 建立 Post (DRAFT)
   c. 加入生成佇列
   d. 更新排程 status='GENERATED'
   e. 記錄到 post_performance_log (初始值)
```

### Insights 同步後更新 (每 4 小時)
```
1. 更新 post_performance_log 的表現數據
2. 重新計算每個模板的統計:
   - total_uses
   - total_views
   - total_engagement
   - avg_engagement_rate
3. UCB 自動使用最新數據優化未來選擇
```

---

## 📈 預期效果

### 第 1-2 週 (探索期)
- 每個模板都會被嘗試多次
- 系統收集各模板在不同時段的表現
- UCB 分數主要由探索獎勵主導

### 第 3-8 週 (學習期)
- 表現好的模板被選中頻率增加
- 但仍保持一定探索 (約 20-30%)
- 開始發現最佳時段×模板組合

### 第 9 週後 (優化期)
- 穩定在最佳策略 (約 70%)
- 持續探索 (約 30%)
- 自動適應趨勢變化

---

## 🔧 可調整參數

### exploration_factor (探索係數)
- **1.0** = 保守 (更依賴歷史數據)
- **1.5** = 平衡 (推薦)
- **2.0** = 激進 (更願意嘗試新模板)

### min_trials_per_template (最少試驗次數)
- **3** = 快速收斂
- **5** = 平衡 (推薦)
- **10** = 充分探索

---

## ✅ 優勢總結

1. ✅ **完全自動化** - 不需手動建立排程
2. ✅ **持續優化** - AI 自動學習最佳策略
3. ✅ **保證探索** - 不會錯過潛力模板
4. ✅ **適應變化** - 趨勢改變時自動調整
5. ✅ **可視化分析** - 清楚看到 AI 的決策過程
6. ✅ **靈活配置** - 可自訂時段、模板、參數

---

**文檔版本**: 1.0
**建立日期**: 2025-12-31
