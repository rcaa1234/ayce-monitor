# 貼文統計功能 - 完整實作計劃（修訂版）

## 功能概述

建立一個全面的貼文統計與分析系統，提供以下核心功能：

1. **貼文成效追蹤** - 自動同步 Threads Insights 數據（按讚、留言、分享、觸及、參與度等）
2. **樣板分析** - 統計各樣板的平均表現、成功率、使用次數
3. **時段分析** - 分析不同時段的發文成效，找出最佳發文時間
4. **趨勢圖表** - 視覺化呈現歷史數據趨勢和成長軌跡
5. **UCB 效能優化** - 基於真實數據優化智能排程的樣板與時段選擇

---

## 資料庫架構設計

### 新增資料表

#### 1. `post_insights` - 貼文洞察數據（最新狀態）
```sql
CREATE TABLE post_insights (
  id VARCHAR(36) PRIMARY KEY,
  post_id VARCHAR(36) NOT NULL,
  likes INT DEFAULT 0,
  replies INT DEFAULT 0,
  reposts INT DEFAULT 0,
  quotes INT DEFAULT 0,
  views INT DEFAULT 0,
  reach INT DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0.00 COMMENT '參與率 (%)',
  last_synced_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  UNIQUE KEY unique_post (post_id),
  INDEX idx_last_synced (last_synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 2. `post_insights_history` - 貼文洞察歷史快照
```sql
CREATE TABLE post_insights_history (
  id VARCHAR(36) PRIMARY KEY,
  post_id VARCHAR(36) NOT NULL,
  snapshot_date DATE NOT NULL COMMENT '快照日期',
  likes INT DEFAULT 0,
  replies INT DEFAULT 0,
  reposts INT DEFAULT 0,
  quotes INT DEFAULT 0,
  views INT DEFAULT 0,
  reach INT DEFAULT 0,
  engagement_rate DECIMAL(5,2) DEFAULT 0.00,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  UNIQUE KEY unique_post_snapshot (post_id, snapshot_date),
  INDEX idx_snapshot_date (snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**資料保留政策：**
- 保留所有貼文的完整每日快照前 90 天
- 90 天後僅保留每週最後一天的快照（共保留 1 年）
- 1 年後僅保留每月最後一天的快照（永久保留）

#### 3. `template_performance` - 樣板成效統計（每日彙總）
```sql
CREATE TABLE template_performance (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36) NOT NULL,
  stat_date DATE NOT NULL COMMENT '統計日期',
  posts_count INT DEFAULT 0 COMMENT '使用次數',
  avg_likes DECIMAL(10,2) DEFAULT 0.00,
  avg_replies DECIMAL(10,2) DEFAULT 0.00,
  avg_reposts DECIMAL(10,2) DEFAULT 0.00,
  avg_views DECIMAL(10,2) DEFAULT 0.00,
  avg_reach DECIMAL(10,2) DEFAULT 0.00,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
  total_likes INT DEFAULT 0,
  total_replies INT DEFAULT 0,
  total_reposts INT DEFAULT 0,
  total_views INT DEFAULT 0,
  avg_content_length DECIMAL(10,2) DEFAULT 0.00 COMMENT '平均內容長度',
  hashtag_usage_count INT DEFAULT 0 COMMENT 'hashtag 使用次數',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES post_templates(id) ON DELETE CASCADE,
  UNIQUE KEY unique_template_date (template_id, stat_date),
  INDEX idx_stat_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 4. `timeslot_performance` - 時段成效統計（每日彙總）
```sql
CREATE TABLE timeslot_performance (
  id VARCHAR(36) PRIMARY KEY,
  timeslot_id VARCHAR(36) NOT NULL,
  stat_date DATE NOT NULL,
  posts_count INT DEFAULT 0,
  avg_likes DECIMAL(10,2) DEFAULT 0.00,
  avg_replies DECIMAL(10,2) DEFAULT 0.00,
  avg_reposts DECIMAL(10,2) DEFAULT 0.00,
  avg_views DECIMAL(10,2) DEFAULT 0.00,
  avg_reach DECIMAL(10,2) DEFAULT 0.00,
  avg_engagement_rate DECIMAL(5,2) DEFAULT 0.00,
  total_likes INT DEFAULT 0,
  total_replies INT DEFAULT 0,
  total_reposts INT DEFAULT 0,
  total_views INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (timeslot_id) REFERENCES time_slots(id) ON DELETE CASCADE,
  UNIQUE KEY unique_timeslot_date (timeslot_id, stat_date),
  INDEX idx_stat_date (stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 擴充現有資料表

#### 擴充 `posts` 表
```sql
ALTER TABLE posts
  ADD COLUMN content_length INT DEFAULT 0 COMMENT '內容字數',
  ADD COLUMN has_media BOOLEAN DEFAULT FALSE COMMENT '是否含圖片/影片',
  ADD COLUMN media_type ENUM('NONE', 'IMAGE', 'VIDEO', 'CAROUSEL') DEFAULT 'NONE',
  ADD COLUMN hashtag_count INT DEFAULT 0 COMMENT 'hashtag 數量',
  ADD INDEX idx_content_length (content_length),
  ADD INDEX idx_media_type (media_type);
```

#### 擴充 `post_performance_log` 表（用於 UCB 回饋）
```sql
ALTER TABLE post_performance_log
  ADD COLUMN insights_synced BOOLEAN DEFAULT FALSE COMMENT '是否已同步 Insights',
  ADD COLUMN insights_synced_at DATETIME NULL COMMENT 'Insights 同步時間',
  ADD INDEX idx_insights_synced (insights_synced);
```

---

## 任務拆解（Phase 0-6，共 40 項任務）

### **Phase 0：技術基礎設施與政策**

#### Task 0.1：選擇資料庫遷移工具
- **描述：** 評估並選擇資料庫遷移管理工具（Knex.js 或 TypeORM）
- **工作內容：**
  - 比較 Knex.js 與 TypeORM 的優缺點
  - 根據專案需求選擇合適工具
  - 安裝並初始化遷移環境
  - 建立 `migrations/` 目錄結構
- **預期產出：** package.json 新增遷移工具依賴，migrations/ 目錄結構建立

#### Task 0.2：建立資料保留政策自動清理排程
- **描述：** 實作 post_insights_history 的資料保留政策
- **工作內容：**
  - 建立 `src/cron/data-retention.ts`
  - 實作三階段保留邏輯：
    - 90 天內：保留所有每日快照
    - 90-365 天：僅保留每週最後一天
    - 365 天以上：僅保留每月最後一天
  - 設定每日凌晨 2:00 執行清理排程
  - 記錄清理日誌（刪除數量、執行時間）
- **預期產出：** 自動清理排程，減少歷史資料儲存成本

#### Task 0.3：建立 Threads API 速率限制處理機制
- **描述：** 實作 exponential backoff 重試邏輯與速率限制追蹤
- **工作內容：**
  - 建立 `src/utils/threads-api-limiter.ts`
  - 實作 exponential backoff（初始 1s → 2s → 4s → 8s）
  - 追蹤 API 呼叫次數與時間窗口
  - 當達到速率限制時自動延遲請求
  - 記錄 429 錯誤與重試狀態
- **預期產出：** 提升 Threads API 呼叫穩定性，避免超出速率限制

#### Task 0.4：建立日誌與警報系統
- **描述：** 整合 Discord/Slack Webhook 發送異常警報
- **工作內容：**
  - 建立 `src/services/alert.service.ts`
  - 支援 Discord 與 Slack Webhook 通知
  - 定義警報等級（INFO, WARN, ERROR, CRITICAL）
  - 整合到 logger，自動發送 ERROR/CRITICAL 級別通知
  - 新增 `.env` 設定：`ALERT_WEBHOOK_URL`, `ALERT_WEBHOOK_TYPE`
- **預期產出：** 即時異常通知，快速響應系統問題

#### Task 0.5：Redis 快取架構設計（多實例支援）
- **描述：** 設計 Redis 快取策略，支援多實例部署
- **工作內容：**
  - 建立 `src/services/cache.service.ts`
  - 實作快取層：insights 資料、template 統計、timeslot 統計
  - 設定 TTL：insights (1小時)、統計 (24小時)
  - 實作快取失效機制（資料更新時自動清除）
  - 支援本機開發時回退到 in-memory cache
- **預期產出：** 提升查詢效能，支援水平擴展

---

### **Phase 1：資料庫遷移與核心數據收集**

#### Task 1.1：建立資料庫遷移檔案
- **描述：** 使用選定的遷移工具建立 4 個新資料表與 2 個資料表擴充
- **工作內容：**
  - 建立 `migrations/YYYYMMDDHHMMSS_create_statistics_tables.ts`
  - 建立 4 個新表：post_insights, post_insights_history, template_performance, timeslot_performance
  - 擴充 posts 表（content_length, has_media, media_type, hashtag_count）
  - 擴充 post_performance_log 表（insights_synced, insights_synced_at）
  - 編寫 rollback 邏輯
- **預期產出：** 可重複執行的資料庫遷移檔案

#### Task 1.2：執行遷移並驗證
- **描述：** 在開發環境執行遷移並驗證資料表結構
- **工作內容：**
  - 執行 `npm run migrate`
  - 驗證所有資料表與欄位正確建立
  - 測試 rollback 功能
  - 更新 `scripts/verify-database-schema.js` 加入新欄位檢查
- **預期產出：** 資料庫結構完整建立並通過驗證

#### Task 1.3：實作內容分析工具
- **描述：** 建立工具函數分析貼文內容特徵
- **工作內容：**
  - 建立 `src/utils/content-analyzer.ts`
  - 實作函數：
    - `calculateContentLength(text: string): number` - 計算內容長度
    - `extractHashtags(text: string): string[]` - 提取 hashtag
    - `detectMediaType(post: any): MediaType` - 偵測媒體類型
  - 單元測試覆蓋率 > 80%
- **預期產出：** 內容分析工具模組

#### Task 1.4：更新貼文建立流程
- **描述：** 在貼文建立時自動分析並儲存內容特徵
- **工作內容：**
  - 修改 `src/models/post.model.ts` 的 `create()` 方法
  - 在插入 posts 表時計算並儲存 content_length, hashtag_count, media_type
  - 修改 `src/workers/generate.worker.ts` 呼叫內容分析工具
- **預期產出：** 新建貼文自動記錄內容特徵

#### Task 1.5：實作 Threads Insights API 客戶端（含速率限制）
- **描述：** 建立呼叫 Threads Insights API 的服務模組
- **工作內容：**
  - 建立 `src/services/threads-insights.service.ts`
  - 實作 `getPostInsights(postId: string, accessToken: string)` 方法
  - 整合 Task 0.3 的速率限制處理機制
  - 支援欄位：likes, replies, reposts, quotes, views, reach
  - 錯誤處理：404（貼文不存在）、403（權限不足）、429（速率限制）
  - 計算 engagement_rate = (likes + replies + reposts) / views * 100
- **預期產出：** 可靠的 Insights API 客戶端

#### Task 1.6：實作 Insights 資料同步服務
- **描述：** 建立同步 Insights 資料到資料庫的服務
- **工作內容：**
  - 建立 `src/services/insights-sync.service.ts`
  - 實作 `syncPostInsights(postId: string)` - 同步單一貼文
  - 實作 `syncAllRecentPosts()` - 批次同步最近 30 天的貼文
  - 更新 `post_insights` 表（upsert 操作）
  - 建立每日快照到 `post_insights_history`
  - 更新 `post_performance_log.insights_synced = true`
  - 整合 Task 0.5 的快取機制（同步後清除快取）
- **預期產出：** Insights 同步服務模組

---

### **Phase 2：定時同步與彙總統計**

#### Task 2.1：建立 Insights 同步排程（含進度追蹤）
- **描述：** 設定每 4 小時自動同步 Insights 資料
- **工作內容：**
  - 在 `src/cron/scheduler.ts` 新增 `insightsSyncScheduler`
  - 設定排程：每 4 小時執行（0 */4 * * *）
  - 呼叫 `insightsSync.syncAllRecentPosts()`
  - 記錄同步開始/結束時間、成功/失敗數量
  - 使用 Redis 儲存同步進度狀態（總數、已完成數、失敗數）
  - 同步失敗時發送警報（Task 0.4）
- **預期產出：** 自動化 Insights 同步排程

#### Task 2.2：實作樣板成效彙總服務（含內容特徵分析）
- **描述：** 計算各樣板的平均表現並儲存到 template_performance
- **工作內容：**
  - 建立 `src/services/template-stats.service.ts`
  - 實作 `calculateTemplatePerformance(templateId: string, date: Date)`
  - 查詢該樣板在指定日期的所有貼文
  - 計算平均值：likes, replies, reposts, views, reach, engagement_rate
  - 計算總和：total_likes, total_replies, total_reposts, total_views
  - **新增內容特徵分析：**
    - `avg_content_length` - 平均內容長度
    - `hashtag_usage_count` - 使用 hashtag 的貼文數量
  - Upsert 到 `template_performance` 表
  - 整合快取清除
- **預期產出：** 樣板統計彙總服務

#### Task 2.3：實作時段成效彙總服務
- **描述：** 計算各時段的平均表現並儲存到 timeslot_performance
- **工作內容：**
  - 建立 `src/services/timeslot-stats.service.ts`
  - 實作 `calculateTimeslotPerformance(timeslotId: string, date: Date)`
  - 查詢該時段在指定日期的所有貼文
  - 計算平均值與總和（同 Task 2.2）
  - Upsert 到 `timeslot_performance` 表
  - 整合快取清除
- **預期產出：** 時段統計彙總服務

#### Task 2.4：建立每日彙總排程
- **描述：** 每日凌晨 1:00 執行統計彙總
- **工作內容：**
  - 在 `src/cron/scheduler.ts` 新增 `dailyStatsAggregation`
  - 設定排程：每日 01:00 執行（0 1 * * *）
  - 呼叫 templateStats 與 timeslotStats 服務
  - 計算前一日（T-1）的統計數據
  - 記錄執行日誌
- **預期產出：** 每日自動統計彙總

---

### **Phase 3：前端 UI 與視覺化**

#### Task 3.1：建立「貼文統計」頁面框架
- **描述：** 新增統計頁面的 HTML 結構與導航
- **工作內容：**
  - 在 `public/index.html` 新增 `<div id="statistics" class="tab-content">` 區塊
  - 新增導航按鈕「📊 貼文統計」
  - 建立子分頁：總覽、樣板分析、時段分析、貼文明細
  - 設定頁面切換邏輯
- **預期產出：** 統計頁面基礎框架

#### Task 3.2：實作總覽儀表板
- **描述：** 顯示整體統計摘要與關鍵指標
- **工作內容：**
  - 新增 HTML 區塊：
    - 總貼文數、總按讚數、總留言數、總分享數
    - 平均參與率、平均觸及人數
    - 最近 7 天趨勢圖（使用 Chart.js 折線圖）
  - 實作 `loadStatisticsOverview()` 函數
  - 呼叫 API `/api/statistics/overview`
  - 使用 Chart.js 繪製趨勢折線圖
- **預期產出：** 統計總覽儀表板

#### Task 3.3：實作樣板分析頁面（含內容特徵）
- **描述：** 顯示各樣板的詳細成效統計
- **工作內容：**
  - 新增 HTML 表格：樣板名稱、使用次數、平均按讚、平均留言、平均分享、參與率
  - **新增欄位：平均內容長度、Hashtag 使用率**
  - 可依欄位排序（點擊表頭切換升序/降序）
  - 點擊樣板顯示該樣板的歷史趨勢圖（Chart.js 折線圖）
  - 實作 `loadTemplateAnalysis()` 函數
  - 呼叫 API `/api/statistics/templates`
- **預期產出：** 樣板分析頁面

#### Task 3.4：實作時段分析頁面（含熱力圖）
- **描述：** 顯示各時段的詳細成效統計與視覺化熱力圖
- **工作內容：**
  - 新增 HTML 表格：時段、使用次數、平均按讚、平均留言、平均分享、參與率
  - **新增熱力圖（Heatmap）：**
    - X 軸：時段（00:00-23:00）
    - Y 軸：星期（週一到週日）
    - 顏色深度：代表參與率高低
    - 使用 Chart.js + chartjs-chart-matrix 外掛
  - 可依欄位排序
  - 點擊時段顯示該時段的歷史趨勢圖
  - 實作 `loadTimeslotAnalysis()` 函數
  - 呼叫 API `/api/statistics/timeslots` 與 `/api/statistics/heatmap`
- **預期產出：** 時段分析頁面與熱力圖

#### Task 3.5：實作貼文明細頁面（含匯出功能）
- **描述：** 顯示所有貼文的詳細 Insights 數據
- **工作內容：**
  - 新增 HTML 表格：貼文 ID、內容預覽、發布時間、按讚、留言、分享、觸及、參與率
  - 支援分頁（每頁 20 筆）
  - 支援篩選：日期範圍、樣板、時段
  - **新增 CSV 匯出按鈕：**
    - 點擊後下載目前篩選結果的 CSV 檔案
    - 包含所有欄位：ID, 內容, 發布時間, 按讚, 留言, 分享, 觸及, 參與率
    - 使用 JavaScript 產生 CSV（無需後端）
  - 點擊貼文顯示完整內容與 Threads 連結
  - 實作 `loadPostDetails()` 函數
  - 呼叫 API `/api/statistics/posts`
- **預期產出：** 貼文明細頁面與 CSV 匯出功能

#### Task 3.6：整合 Chart.js 資料視覺化
- **描述：** 安裝並設定 Chart.js 與相關外掛
- **工作內容：**
  - 安裝 Chart.js：`npm install chart.js chartjs-chart-matrix`
  - 在 `public/index.html` 引入 CDN 或打包
  - 建立 `public/js/charts.js` 封裝常用圖表函數
  - 實作函數：
    - `createLineChart(canvasId, data, options)` - 折線圖
    - `createBarChart(canvasId, data, options)` - 長條圖
    - `createHeatmapChart(canvasId, data, options)` - 熱力圖
  - 設定統一的顏色主題與樣式
- **預期產出：** Chart.js 整合與圖表工具函數

#### Task 3.7：實作同步進度 UI
- **描述：** 顯示 Insights 同步進度條與狀態
- **工作內容：**
  - 在統計頁面頂部新增進度條區塊
  - 顯示：同步狀態（進行中/完成/失敗）、進度百分比、已完成數/總數
  - 實作 `checkSyncProgress()` 函數
  - 每 2 秒輪詢 API `/api/statistics/sync-status`
  - 從 Redis 讀取同步進度（Task 2.1）
  - 同步完成後自動重新載入統計數據
- **預期產出：** 同步進度 UI 元件

---

### **Phase 4：後端 API 開發**

#### Task 4.1：實作統計總覽 API
- **描述：** 建立 GET /api/statistics/overview 端點
- **工作內容：**
  - 在 `src/routes/index.ts` 新增路由
  - 建立 `src/controllers/statistics.controller.ts`
  - 實作 `getOverview()` 方法：
    - 查詢總貼文數（posts 表）
    - 查詢總按讚/留言/分享數（post_insights 表彙總）
    - 計算平均參與率、平均觸及
    - 查詢最近 7 天的每日趨勢數據
  - 整合快取（TTL: 1小時）
  - 回傳 JSON 格式
- **預期產出：** 統計總覽 API 端點

#### Task 4.2：實作樣板統計 API（含內容特徵）
- **描述：** 建立 GET /api/statistics/templates 端點
- **工作內容：**
  - 實作 `getTemplateStatistics()` 方法
  - 查詢 `template_performance` 表（最近 30 天彙總）
  - 計算每個樣板的總使用次數、平均表現
  - **包含內容特徵：avg_content_length, hashtag_usage_count**
  - 支援查詢參數：
    - `start_date`, `end_date` - 日期範圍
    - `sort_by` - 排序欄位（likes, engagement_rate 等）
    - `order` - 升序/降序
  - 整合快取（TTL: 24小時）
  - 回傳 JSON 陣列
- **預期產出：** 樣板統計 API 端點

#### Task 4.3：實作時段統計 API
- **描述：** 建立 GET /api/statistics/timeslots 端點
- **工作內容：**
  - 實作 `getTimeslotStatistics()` 方法
  - 查詢 `timeslot_performance` 表（最近 30 天彙總）
  - 計算每個時段的總使用次數、平均表現
  - 支援查詢參數：同 Task 4.2
  - 整合快取（TTL: 24小時）
  - 回傳 JSON 陣列
- **預期產出：** 時段統計 API 端點

#### Task 4.4：實作熱力圖資料 API
- **描述：** 建立 GET /api/statistics/heatmap 端點
- **工作內容：**
  - 實作 `getHeatmapData()` 方法
  - 查詢 posts 與 post_insights，依星期與小時分組
  - 計算每個 [星期, 小時] 組合的平均參與率
  - 回傳格式：
    ```json
    [
      {"day": 1, "hour": 9, "engagement_rate": 3.5},
      {"day": 1, "hour": 12, "engagement_rate": 4.2},
      ...
    ]
    ```
  - 整合快取（TTL: 24小時）
- **預期產出：** 熱力圖資料 API 端點

#### Task 4.5：實作貼文明細 API
- **描述：** 建立 GET /api/statistics/posts 端點
- **工作內容：**
  - 實作 `getPostDetails()` 方法
  - JOIN posts, post_insights, post_templates, time_slots
  - 支援查詢參數：
    - `page`, `limit` - 分頁
    - `start_date`, `end_date` - 日期範圍
    - `template_id` - 樣板篩選
    - `timeslot_id` - 時段篩選
  - 回傳欄位：post_id, content, posted_at, likes, replies, reposts, views, reach, engagement_rate, template_name, timeslot_label
  - 回傳總筆數與分頁資訊
- **預期產出：** 貼文明細 API 端點

#### Task 4.6：實作同步狀態 API
- **描述：** 建立 GET /api/statistics/sync-status 端點
- **工作內容：**
  - 實作 `getSyncStatus()` 方法
  - 從 Redis 讀取同步進度（Task 2.1 儲存的狀態）
  - 回傳格式：
    ```json
    {
      "status": "running", // running, completed, failed
      "total": 150,
      "completed": 75,
      "failed": 2,
      "progress": 50,
      "started_at": "2024-01-15T10:00:00Z",
      "estimated_completion": "2024-01-15T10:05:00Z"
    }
    ```
  - 無快取（即時查詢）
- **預期產出：** 同步狀態 API 端點

#### Task 4.7：實作手動觸發同步 API
- **描述：** 建立 POST /api/statistics/sync 端點
- **工作內容：**
  - 實作 `triggerSync()` 方法
  - 檢查是否已有同步任務正在執行（避免重複觸發）
  - 非同步呼叫 `insightsSync.syncAllRecentPosts()`
  - 立即回傳 202 Accepted 與任務 ID
  - 需要 JWT 驗證（僅管理員可觸發）
- **預期產出：** 手動同步觸發 API 端點

---

### **Phase 5：UCB 整合與優化**

#### Task 5.1：更新 UCB 樣板選擇邏輯
- **描述：** 整合真實 Insights 數據到 UCB 樣板選擇
- **工作內容：**
  - 修改 `src/services/ucb.service.ts` 的 `selectTemplate()` 方法
  - 查詢 `template_performance` 表取得真實平均參與率
  - 使用 engagement_rate 作為 reward 值（取代模擬數據）
  - 保留 exploration_factor 機制
  - 對於新樣板（使用次數 < min_trials_per_template）給予探索機會
- **預期產出：** 基於真實數據的樣板選擇

#### Task 5.2：更新 UCB 時段選擇邏輯
- **描述：** 整合真實 Insights 數據到 UCB 時段選擇
- **工作內容：**
  - 修改 `ucb.service.ts` 的 `selectTimeSlot()` 方法
  - 查詢 `timeslot_performance` 表取得真實平均參與率
  - 使用 engagement_rate 作為 reward 值
  - 保留 exploration_factor 機制
  - 對於新時段（使用次數 < min_trials_per_template）給予探索機會
- **預期產出：** 基於真實數據的時段選擇

#### Task 5.3：實作 A/B 測試建議
- **描述：** 基於統計數據提供 A/B 測試建議
- **工作內容：**
  - 建立 `src/services/ab-test.service.ts`
  - 分析樣板成效差異，找出表現顯著不同的樣板組合
  - 建議值得進行 A/B 測試的樣板對（高表現 vs 待優化）
  - 建議最佳測試時段（基於 timeslot_performance）
  - 建立 API 端點 GET /api/statistics/ab-test-suggestions
- **預期產出：** A/B 測試建議功能

---

### **Phase 6：測試與優化**

#### Task 6.1：建立測試貼文與模擬數據
- **描述：** 建立測試腳本產生模擬貼文與 Insights 數據
- **工作內容：**
  - 建立 `scripts/seed-test-insights.js`
  - 產生 100+ 筆測試貼文（不同樣板、時段）
  - 模擬 Insights 數據（合理的按讚/留言/分享範圍）
  - 產生歷史快照（過去 30 天）
  - 執行彙總統計
- **預期產出：** 測試數據腳本

#### Task 6.2：前端整合測試
- **描述：** 測試所有前端頁面與 API 整合
- **工作內容：**
  - 測試總覽頁面數據載入與圖表顯示
  - 測試樣板分析頁面排序與篩選功能
  - 測試時段分析頁面與熱力圖顯示
  - 測試貼文明細分頁與篩選
  - 測試 CSV 匯出功能
  - 測試同步進度 UI 與手動同步觸發
  - 測試響應式設計（行動裝置）
- **預期產出：** 前端功能驗證報告

#### Task 6.3：API 效能測試
- **描述：** 測試 API 回應時間與資料庫查詢效能
- **工作內容：**
  - 使用 Apache Bench 或 wrk 進行壓力測試
  - 測試各 API 端點在 1000 筆貼文下的回應時間
  - 檢查資料庫慢查詢（使用 EXPLAIN）
  - 優化索引（必要時新增複合索引）
  - 驗證快取命中率
  - 目標：所有 API 回應時間 < 500ms (p95)
- **預期產出：** 效能測試報告與優化建議

#### Task 6.4：Insights 同步穩定性測試
- **描述：** 測試大量貼文同步的穩定性與速率限制處理
- **工作內容：**
  - 模擬同步 500+ 筆貼文
  - 測試速率限制觸發與 exponential backoff 機制
  - 測試同步中斷後的恢復機制
  - 測試 API 錯誤處理（404, 403, 429, 500）
  - 驗證同步進度追蹤準確性
  - 驗證警報通知正常觸發
- **預期產出：** 同步穩定性驗證報告

#### Task 6.5：資料保留政策測試
- **描述：** 驗證歷史資料清理排程正確執行
- **工作內容：**
  - 建立跨越 90 天、365 天的測試快照資料
  - 執行清理排程
  - 驗證保留邏輯：
    - 90 天內：保留所有每日快照
    - 90-365 天：僅保留每週最後一天
    - 365 天以上：僅保留每月最後一天
  - 檢查清理日誌記錄
- **預期產出：** 資料保留政策驗證報告

#### Task 6.6：部署到 Zeabur 並驗證
- **描述：** 部署完整功能到生產環境
- **工作內容：**
  - 執行資料庫遷移（生產環境）
  - 部署更新的 API 與 Worker 服務
  - 驗證環境變數設定（REDIS_URL, ALERT_WEBHOOK_URL 等）
  - 執行一次完整的 Insights 同步
  - 驗證前端頁面正常載入
  - 驗證所有圖表與數據正確顯示
  - 監控錯誤日誌 24 小時
- **預期產出：** 生產環境部署完成

---

## 技術架構建議

### 資料庫遷移工具選擇

**選項 1: Knex.js**
- 優點：輕量、彈性高、支援 raw SQL
- 缺點：需手動維護 schema 同步

**選項 2: TypeORM**
- 優點：ORM 整合、自動 schema 同步、migration CLI 完善
- 缺點：學習曲線較高

**建議：Knex.js**（專案已使用 raw SQL，保持一致性）

### 日誌與警報

**建議整合：**
- Discord Webhook：開發環境與即時警報
- Slack Webhook：生產環境與團隊通知

**警報觸發條件：**
- Insights 同步失敗率 > 10%
- API 回應時間 > 2s
- 資料庫連接失敗
- Redis 連接失敗

### 快取策略

**Redis 快取層級：**
1. **API Response Cache** - TTL: 1-24小時（依資料更新頻率）
2. **Database Query Cache** - 快取常用查詢結果
3. **Session Cache** - 多實例共享使用者 session

**快取失效機制：**
- Insights 同步完成後清除相關快取
- 統計彙總完成後清除統計快取
- 手動觸發清除（管理後台）

---

## 預期成果

1. **完整的貼文成效追蹤系統** - 自動同步 Threads Insights 數據
2. **視覺化分析儀表板** - 總覽、樣板、時段、明細四大分析頁面
3. **智能化內容優化** - 基於真實數據的 UCB 樣板與時段選擇
4. **高可用性架構** - 支援多實例部署、速率限制處理、異常警報
5. **數據驅動決策** - 提供 A/B 測試建議與內容特徵分析

---

## 開發優先順序

**P0（核心功能）：** Phase 1-2（資料收集與同步）
**P1（視覺化）：** Phase 3-4（前端 UI 與 API）
**P2（優化）：** Phase 5（UCB 整合）
**P3（完善）：** Phase 0, Phase 6（基礎設施與測試）

建議開發順序：
1. 先建立 Phase 0 基礎設施（Task 0.3-0.5 優先）
2. 執行 Phase 1-2 建立數據收集能力
3. 實作 Phase 3-4 提供視覺化介面
4. 整合 Phase 5 優化 UCB 演算法
5. 完成 Phase 6 測試與部署

---

**文件版本：** v2.0（已整合優化建議）
**最後更新：** 2026-01-03
**總任務數：** 40 項
**預估開發週期：** 依任務優先順序逐步實作
