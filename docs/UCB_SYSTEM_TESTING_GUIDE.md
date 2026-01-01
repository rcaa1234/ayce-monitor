# UCB 智能排程系統測試指南

## 🎯 系統概述

UCB 智能排程系統已完全實作並可立即使用。本系統會:
1. 每天自動使用 UCB 演算法選擇最佳時段和模板
2. 自動建立排程並執行
3. 持續學習和優化發文策略

---

## ✅ 檢查清單

### 前置準備
- [x] 資料庫遷移已完成 (26 個 migrations)
- [x] 範例資料已初始化 (3 個模板, 2 個時段, 1 個配置)
- [x] API 端點已建立 (11 個新端點)
- [x] 網頁介面已建立 (2 個新頁面)
- [x] Cron jobs 已註冊 (每日自動排程 + 執行器)

---

## 🚀 快速測試流程

### 步驟 1: 啟動系統

```bash
# 確保系統正在運行
npm run dev
```

### 步驟 2: 訪問網頁介面

1. 訪問主介面: http://localhost:3000/index.html
2. 登入系統
3. 點擊「📝 模板管理」分頁
4. 點擊「🤖 UCB 智能排程」分頁

### 步驟 3: 檢查模板

訪問: http://localhost:3000/templates.html

**應該看到:**
- 3 個範例模板:
  - 知識分享型
  - 生活觀察型
  - 勵志啟發型
- 每個模板顯示使用次數和平均互動率
- 可以新增/編輯/刪除模板

**測試動作:**
1. 點擊「+ 新增模板」
2. 填寫:
   - 名稱: 測試模板
   - 描述: 這是一個測試模板
   - 提示詞: 請產生一篇簡短的測試貼文
3. 點擊「儲存」
4. 確認模板出現在列表中

### 步驟 4: 檢查 UCB 配置

訪問: http://localhost:3000/smart-scheduling.html

**應該看到:**
- UCB 參數配置表單:
  - 探索係數: 1.5
  - 最少試驗次數: 5
  - 每天發文次數: 1
  - 自動排程: 已啟用
- 系統統計:
  - 模板數量: 4 (3個範例 + 1個測試)
  - 時段數量: 2
- 自動排程歷史（可能為空）

### 步驟 5: 手動觸發排程（測試 UCB）

在 UCB 智能排程頁面:

1. 點擊「🚀 立即觸發排程（測試用）」
2. 確認彈出視窗
3. 等待 1-2 秒
4. 應該看到成功訊息: 「排程已建立！」
5. 右側「自動排程歷史」應該出現一筆新記錄

**檢查排程記錄:**
- 狀態: 待執行 (黃色)
- 發文時間: 今天的某個時間 (在 19:00-22:30 或 14:00-17:00 之間)
- 使用的模板: UCB 選擇的模板
- AI 決策原因: 顯示 UCB 選擇邏輯

### 步驟 6: 等待排程執行

**執行時間:**
- 排程執行器每 5 分鐘檢查一次
- 如果排程時間已到期,會自動執行

**執行後的變化:**
1. 排程狀態變為「已生成」(藍色)
2. 系統建立一個新的 Post (DRAFT)
3. 加入生成佇列
4. Worker 開始生成內容
5. 生成完成後發送到 LINE 審核

**查看執行結果:**
```bash
# 查看日誌
# 應該看到類似:
# "Checking for auto-scheduled posts to execute..."
# "Created post xxx for auto-schedule yyy"
# "✓ Auto-schedule xxx executed successfully"
```

---

## 🧪 完整測試案例

### 測試 1: UCB 選擇邏輯

**目的:** 驗證 UCB 會在探索階段輪流嘗試不同模板

**步驟:**
1. 訪問 UCB 智能排程頁面
2. 連續觸發 5 次排程
3. 觀察每次選擇的模板

**預期結果:**
- 前 5 次應該選擇不同的模板（探索階段）
- 每個模板至少被選中 1 次
- AI 決策原因顯示「探索階段：該模板使用次數不足」

### 測試 2: 排程執行

**目的:** 驗證排程會在時間到期時自動執行

**步驟:**
1. 手動觸發一個排程
2. 修改資料庫中的 `scheduled_time` 為當前時間之前:
   ```sql
   UPDATE daily_auto_schedule
   SET scheduled_time = DATE_SUB(NOW(), INTERVAL 1 MINUTE)
   WHERE status = 'PENDING'
   ORDER BY created_at DESC
   LIMIT 1;
   ```
3. 等待最多 5 分鐘（排程執行器的週期）
4. 查看排程狀態

**預期結果:**
- 排程狀態變為「已生成」
- 建立了新的 Post
- 日誌顯示「Auto-schedule xxx executed successfully」

### 測試 3: 模板 CRUD

**目的:** 驗證模板管理功能

**新增模板:**
1. 訪問模板管理頁面
2. 點擊「+ 新增模板」
3. 填寫資料並儲存
4. 確認出現在列表中

**編輯模板:**
1. 點擊某個模板的「編輯」按鈕
2. 修改名稱或提示詞
3. 儲存
4. 確認變更已套用

**刪除模板:**
1. 點擊「刪除」按鈕
2. 確認提示
3. 確認模板從列表中消失

### 測試 4: UCB 參數調整

**目的:** 驗證參數變更會影響 UCB 行為

**步驟:**
1. 訪問 UCB 智能排程頁面
2. 修改參數:
   - 探索係數: 2.0 (更激進)
   - 最少試驗次數: 3
3. 點擊「儲存配置」
4. 觸發新排程
5. 觀察是否更容易選擇使用次數少的模板

### 測試 5: 每日自動排程

**目的:** 驗證系統會在每天 00:00 自動建立排程

**步驟:**
1. 等待到隔天 00:00:00
2. 或手動觸發（在 scheduler.ts 中呼叫 `createDailyAutoSchedule()`）
3. 檢查 `daily_auto_schedule` 表

**預期結果:**
- 每天自動建立一筆新排程
- 使用 UCB 選擇的時段和模板
- 記錄了 UCB 分數和選擇原因

---

## 📊 資料庫查詢

### 查看所有模板
```sql
SELECT id, name, total_uses, avg_engagement_rate, enabled
FROM content_templates
ORDER BY avg_engagement_rate DESC;
```

### 查看時段配置
```sql
SELECT id, name, start_hour, start_minute, end_hour, end_minute,
       allowed_template_ids, active_days, priority
FROM schedule_time_slots
WHERE enabled = true;
```

### 查看自動排程歷史
```sql
SELECT das.*,
       ct.name as template_name,
       sts.name as time_slot_name
FROM daily_auto_schedule das
LEFT JOIN content_templates ct ON das.selected_template_id = ct.id
LEFT JOIN schedule_time_slots sts ON das.selected_time_slot_id = sts.id
ORDER BY das.schedule_date DESC
LIMIT 10;
```

### 查看 UCB 配置
```sql
SELECT * FROM smart_schedule_config WHERE enabled = true;
```

### 查看貼文表現記錄
```sql
SELECT ppl.*,
       ct.name as template_name,
       p.status as post_status
FROM post_performance_log ppl
LEFT JOIN content_templates ct ON ppl.template_id = ct.id
LEFT JOIN posts p ON ppl.post_id = p.id
ORDER BY ppl.posted_at DESC
LIMIT 10;
```

---

## 🔍 常見問題排解

### 問題 1: 觸發排程後沒有建立記錄

**可能原因:**
1. 今天已經有排程了（`daily_auto_schedule` 有 `UNIQUE KEY uk_schedule_date`）
2. 沒有啟用的時段或模板
3. 自動排程被停用

**解決方法:**
```sql
-- 檢查今天是否已有排程
SELECT * FROM daily_auto_schedule WHERE schedule_date = CURDATE();

-- 刪除今天的排程（測試用）
DELETE FROM daily_auto_schedule WHERE schedule_date = CURDATE();

-- 檢查是否有啟用的時段和模板
SELECT COUNT(*) FROM content_templates WHERE enabled = true;
SELECT COUNT(*) FROM schedule_time_slots WHERE enabled = true;

-- 檢查配置
SELECT * FROM smart_schedule_config WHERE enabled = true;
```

### 問題 2: 排程狀態一直是「待執行」

**可能原因:**
1. 排程時間還沒到
2. 排程執行器沒有啟動
3. Worker 沒有運行

**解決方法:**
```bash
# 檢查系統是否正在運行
npm run dev

# 查看日誌是否有執行記錄
# 應該每 5 分鐘看到:
# "Checking for auto-scheduled posts to execute..."
```

### 問題 3: UCB 一直選擇同一個模板

**可能原因:**
1. 其他模板已達到最少試驗次數,且該模板表現最好
2. 探索係數設定太低

**解決方法:**
- 提高探索係數 (例如從 1.5 改為 2.0)
- 或增加最少試驗次數 (例如從 5 改為 10)

---

## 📈 預期行為

### 初期（第 1-2 週）
- ✅ 每個模板都會被嘗試多次
- ✅ UCB 分數較高（探索獎勵主導）
- ✅ 選擇原因顯示「探索階段」

### 中期（第 3-8 週）
- ✅ 表現好的模板被選中頻率增加
- ✅ 但仍保持一定探索（約 20-30%）
- ✅ UCB 分數開始反映真實表現

### 穩定期（第 9 週後）
- ✅ 穩定在最佳策略（約 70% 用最好的）
- ✅ 持續探索（約 30%）
- ✅ 自動適應趨勢變化

---

## ✅ 完整驗收標準

- [ ] 可以在模板管理頁面新增/編輯/刪除模板
- [ ] 可以在 UCB 配置頁面調整參數
- [ ] 手動觸發排程可以成功建立記錄
- [ ] 排程執行器會自動執行到期的排程
- [ ] UCB 會根據歷史數據選擇模板
- [ ] 探索階段會輪流嘗試不同模板
- [ ] 每天 00:00 會自動建立排程
- [ ] 排程歷史頁面顯示 AI 決策原因
- [ ] 所有操作有完整的日誌記錄

---

## 🎉 成功！

如果以上測試都通過,恭喜! UCB 智能排程系統已完全就緒並可投入使用。

系統會持續學習你的受眾偏好,自動優化發文策略,讓你的 Threads 帳號表現越來越好！

---

**文檔版本**: 1.0
**建立日期**: 2025-12-31
