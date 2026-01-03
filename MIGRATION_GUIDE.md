# 統計功能資料庫遷移指南

本指南說明如何在 Zeabur 生產環境執行統計功能的資料庫遷移。

## 📋 遷移概要

此遷移將建立 **4 個新表**並擴充 **2 個現有表**，以支援完整的統計分析功能。

### 新建立的表

1. **post_insights** - 儲存貼文的即時數據（按讚數、回覆數、觀看數等）
2. **post_insights_history** - 儲存歷史數據快照，用於趨勢分析
3. **template_performance** - 樣板效能統計（每日匯總）
4. **timeslot_performance** - 時段效能統計（每日匯總）

### 擴充的表

1. **posts** - 新增內容分析欄位
   - `content_length` - 內容字數
   - `has_media` - 是否含圖片/影片
   - `media_type` - 媒體類型（NONE, IMAGE, VIDEO, CAROUSEL）
   - `hashtag_count` - hashtag 數量

2. **post_performance_log** - 新增同步追蹤欄位
   - `insights_synced` - 是否已同步 Insights
   - `insights_synced_at` - Insights 同步時間

## ✅ 前置條件檢查

在執行遷移前，請確認：

1. ✅ Zeabur 已部署最新版本（commit `28eb066`）
2. ✅ 資料庫中存在以下基礎表：
   - `posts`
   - `content_templates`
   - `schedule_time_slots`
3. ✅ 有資料庫的完整存取權限（CREATE, ALTER, DROP）

## 🚀 執行步驟

### 步驟 1：等待 Zeabur 部署完成

確認 Zeabur 已完成部署 commit `28eb066`。可以透過以下方式確認：

1. 前往 Zeabur Dashboard
2. 檢查最新部署的 commit hash
3. 確認部署狀態為「成功」

### 步驟 2：執行前置驗證

在 Zeabur Terminal 執行以下指令，檢查資料庫狀態：

```bash
npm run verify:migration
```

此腳本會檢查：
- ✓ 基礎表是否存在
- ✓ posts 表的 ID 類型和 collation
- ✓ 統計表是否已建立（避免重複遷移）
- ✓ 表欄位擴充狀態

**預期輸出**：

```
============================================================
統計功能資料庫遷移驗證與執行工具
============================================================

✓ 已連接到資料庫

【步驟 1/5】檢查基礎表結構...
✓ 所有基礎表都存在
  - posts
  - content_templates
  - schedule_time_slots

【步驟 2/5】檢查 posts 表結構...
✓ posts.id 欄位資訊:
  - Type: char(36)
  - Collation: utf8mb4_0900_ai_ci

【步驟 3/5】檢查統計表狀態...
✓ 統計表尚未建立，可以執行遷移

【步驟 4/5】檢查表欄位擴充狀態...
✓ posts 表尚未擴充，遷移將新增內容分析欄位
✓ post_performance_log 表尚未擴充，遷移將新增同步追蹤欄位

【步驟 5/5】準備執行遷移

遷移將執行以下操作:
  1. 建立 post_insights 表（儲存貼文即時數據）
  2. 建立 post_insights_history 表（儲存歷史快照）
  3. 建立 template_performance 表（樣板效能統計）
  4. 建立 timeslot_performance 表（時段效能統計）
  5. 擴充 posts 表（新增內容分析欄位）
  6. 擴充 post_performance_log 表（新增同步追蹤欄位）

============================================================
✅ 前置檢查完成，資料庫結構符合要求
============================================================

請執行以下指令開始遷移:

  npm run migrate:statistics:prod
```

### 步驟 3：執行資料庫遷移

確認驗證通過後，執行遷移：

```bash
npm run migrate:statistics:prod
```

**預期輸出**：

```
Starting statistics tables migration...
✓ Created post_insights table
✓ Created post_insights_history table
✓ Created template_performance table
✓ Created timeslot_performance table
✓ Extended posts table with content analysis fields
✓ Extended post_performance_log table with insights sync tracking
✅ Statistics tables migration completed successfully
```

### 步驟 4：驗證遷移結果

可選：執行以下指令確認表已正確建立：

```bash
npm run list:tables
```

應該看到新建立的 4 個統計表：
- post_insights
- post_insights_history
- template_performance
- timeslot_performance

### 步驟 5：測試統計功能

1. 登入系統網頁介面
2. 前往「總覽」頁面
3. 點擊右側「統計分析」面板
4. 確認 4 個子頁籤可以正常切換：
   - 📊 統計總覽
   - 📝 樣板分析
   - 🕒 時段分析
   - 📄 貼文明細
5. 測試「立即同步」按鈕
6. 確認數據顯示正常

## ⚠️ 常見問題

### Q1: 如果遷移失敗怎麼辦？

**A**: 遷移使用 transaction，失敗會自動 rollback。可以：

1. 查看錯誤訊息
2. 如果需要重新執行，先清理：
   ```bash
   npm run cleanup:statistics
   ```
3. 再次執行遷移

### Q2: 遷移執行時間需要多久？

**A**: 通常在 5-10 秒內完成（取決於資料庫效能）。

### Q3: 遷移會影響現有數據嗎？

**A**: 不會。遷移只：
- 建立新表（不影響現有數據）
- 在現有表新增欄位（使用 DEFAULT 值，不影響現有資料）

### Q4: 可以回滾遷移嗎？

**A**: 可以。執行清理腳本即可移除所有統計表和新增的欄位：

```bash
npm run cleanup:statistics
```

### Q5: 統計表已存在，重新執行遷移會怎樣？

**A**: 遷移腳本會偵測已存在的表：
- 如果表已存在，會跳過建立
- 如果欄位已存在，會跳過擴充
- 不會造成錯誤或資料遺失

## 📊 遷移後的下一步

遷移成功後，系統會：

1. **自動同步數據**：每 6 小時自動從 Threads API 同步 Insights 數據
2. **每日匯總**：每天 00:00 執行樣板和時段效能匯總
3. **歷史快照**：每天 01:00 建立數據快照供趨勢分析

您也可以：
- 手動觸發同步（透過 UI 的「立即同步」按鈕）
- 透過 API 存取統計數據
- 匯出 CSV 報表

## 🛠️ 相關指令

```bash
# 本地開發環境遷移（使用 ts-node）
npm run migrate:statistics

# 生產環境遷移（使用編譯後的 JS）
npm run migrate:statistics:prod

# 遷移前驗證
npm run verify:migration

# 清理統計表（回滾遷移）
npm run cleanup:statistics

# 檢查 posts 表結構
npm run check:posts-structure

# 列出所有資料表
npm run list:tables
```

## 📝 技術細節

### 外鍵約束

所有統計表都使用 `ON DELETE CASCADE`，確保資料一致性：

- `post_insights.post_id` → `posts.id`
- `post_insights_history.post_id` → `posts.id`
- `template_performance.template_id` → `content_templates.id`
- `timeslot_performance.timeslot_id` → `schedule_time_slots.id`

### 資料類型

- **ID 欄位**：統一使用 `CHAR(36)` 儲存 UUID
- **數值欄位**：使用 `INT` 和 `DECIMAL(10,2)` 確保精確度
- **參與率**：使用 `DECIMAL(5,2)` 儲存百分比（0.00-100.00）

### Collation

所有表統一使用 `utf8mb4_0900_ai_ci`，與現有表一致。

## ✅ 完成檢查清單

- [ ] Zeabur 已部署 commit `28eb066`
- [ ] 執行 `npm run verify:migration` 通過
- [ ] 執行 `npm run migrate:statistics:prod` 成功
- [ ] 4 個統計表已建立
- [ ] posts 表已擴充 4 個欄位
- [ ] post_performance_log 表已擴充 2 個欄位
- [ ] 統計 UI 可以正常開啟
- [ ] 手動同步功能正常運作

---

如有任何問題，請參考錯誤訊息或聯繫開發團隊。
