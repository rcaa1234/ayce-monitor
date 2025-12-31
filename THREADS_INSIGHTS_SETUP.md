# 📊 Threads Insights API 設定指南

## 🎯 目標
讓您的自動發文系統能夠獲取**真實的** Threads 數據（瀏覽、按讚、回覆等），而不是模擬數據。

---

## ✅ 前置需求

### 1. Meta Developer App 設定
您需要一個 Meta Developer App，並且已經設定好 Threads API 基礎功能。

### 2. 需要的權限
目前您的 App 應該已有：
- ✓ `threads_basic` - 基礎存取
- ✓ `threads_content_publish` - 發文權限

**還需要添加（這是關鍵）：**
- ⚠️ `threads_manage_insights` - **獲取分析數據的權限**

---

## 📝 步驟 1: 在 Meta Developer Console 添加 Insights 權限

### 1.1 登入 Meta Developer
前往 [Meta for Developers](https://developers.facebook.com/)

### 1.2 選擇您的 App
找到您用於 Threads API 的應用程式

### 1.3 添加權限
1. 左側選單 → **App Settings** → **Basic**
2. 找到 **Threads** 區塊
3. 點擊 **Add or Remove Permissions**
4. 勾選以下權限：
   - ☑️ `threads_basic`
   - ☑️ `threads_content_publish`
   - ☑️ **`threads_manage_insights`** ⭐ (新增這個)
5. 點擊 **Save Changes**

### 1.4 提交 App Review（如果需要）
如果您的 App 狀態是 "Development Mode"：
- 您可以立即使用這些權限（僅限測試帳號）
- 不需要 App Review

如果您的 App 已經是 "Live Mode"：
- 需要提交 **App Review** 讓 Meta 審核 `threads_manage_insights` 權限
- 審核時間通常 1-3 個工作天
- 需要說明為什麼需要這個權限（例如：「用於分析我自己帳號的貼文表現」）

---

## 📝 步驟 2: 重新獲取 Access Token

因為添加了新權限，您需要重新授權並獲取新的 Access Token。

### 2.1 在網頁管理介面重新連結 Threads 帳號

1. 登入您的自動發文系統管理介面
2. 前往 **Threads 帳號管理**
3. **刪除現有的連結**（如果有）
4. 點擊 **連結新帳號**
5. 完成 OAuth 授權流程
6. 新的 Token 會包含 `threads_manage_insights` 權限

### 2.2 驗證新 Token 的權限

執行測試腳本來驗證：

```bash
# 1. 先取得您的 Access Token
# 可以從資料庫查詢：
mysql -u root -p threads_bot_db
SELECT access_token FROM threads_auth ORDER BY created_at DESC LIMIT 1;

# 2. 編輯測試腳本
# 打開 test-insights-api.js，填入：
# - ACCESS_TOKEN: 剛查詢到的 token (解密後)
# - MEDIA_ID: 任一已發布貼文的 ID

# 3. 執行測試
node test-insights-api.js
```

**預期輸出：**
```
🔍 測試 Threads Insights API...

📋 步驟 1: 檢查 Access Token 權限
✓ Token 資訊:
  - App ID: 123456789
  - 權限: ['threads_basic', 'threads_content_publish', 'threads_manage_insights']
  - 是否有效: true
✓ Token 具有 insights 權限

📊 步驟 2: 獲取貼文 Insights
✓ 成功獲取 Insights 數據！

📈 數據結果:
  - views: 2,341
  - likes: 128
  - replies: 23
  - reposts: 15
  - quotes: 5
  - shares: 8

✅ API 測試成功！您的 Token 可以正常獲取 Insights 數據。
```

---

## 📝 步驟 3: 測試系統整合

### 3.1 手動觸發同步

使用 API 端點手動測試：

```bash
# 取得您的 JWT Token
TOKEN="your_jwt_token_here"

# 同步最近的貼文數據
curl -X POST http://localhost:3000/api/analytics/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "recent",
    "days": 7,
    "limit": 10
  }'
```

**成功的回應：**
```json
{
  "success": true,
  "message": "Recent posts insights synced successfully"
}
```

### 3.2 檢查日誌

查看伺服器日誌，確認沒有權限錯誤：

```bash
# 如果使用 PM2
pm2 logs server

# 或直接看 console
npm run dev
```

**成功的日誌範例：**
```
Fetching insights for media 123456789...
✓ Successfully fetched insights for 123456789: 2341 views
✓ Synced insights for post abc-def-ghi: 2341 views, 171 interactions
```

**如果有權限問題，會看到：**
```
⚠️  Insights API 權限不足或不可用: (#100) Missing permissions
   請確認您的 Access Token 具有 "threads_manage_insights" 權限
   使用模擬數據作為替代方案
```

---

## 📝 步驟 4: 在 LINE Bot 查看真實數據

完成上述設定後：

1. 在 LINE 輸入 `/data`
2. 應該會看到**真實的數據**，不是隨機數字

**範例輸出：**
```
📊 數據監控總覽

📢 帳號：@yourthreadsaccount

📈 過去 7 天統計：
  • 發文數：5 篇
  • 總瀏覽：12,450 次
  • 按讚數：523
  • 回覆數：87
  • 轉發數：34

👥 帳號數據：
  • 追蹤者：1,234
  • 新增粉絲：+23

🏆 最佳表現：
  • 互動率：8.5%
  • 瀏覽數：3,200
  • 按讚數：180
  • 連結：https://www.threads.net/...
```

---

## 🔧 常見問題

### Q1: 我看到「使用模擬數據作為替代方案」是什麼意思？
**A:** 這表示 Insights API 呼叫失敗，系統使用隨機數據代替。原因可能是：
1. Access Token 沒有 `threads_manage_insights` 權限
2. Meta 還沒批准您的 App Review
3. Threads Insights API 對您的帳號尚未開放

### Q2: 如何確認 Token 有正確的權限？
**A:** 執行測試腳本 `node test-insights-api.js`，它會顯示您的 Token 包含哪些權限。

### Q3: App Review 需要多久？
**A:** 通常 1-3 個工作天。在審核期間，Development Mode 下的測試帳號可以立即使用。

### Q4: 數據多久更新一次？
**A:** 系統每 4 小時自動同步一次。您也可以手動觸發同步。

### Q5: 能追蹤手動發的貼文嗎？
**A:** 目前只追蹤系統自動發布的貼文。如果需要追蹤所有貼文，需要修改代碼從 Threads API 抓取帳號所有貼文清單。

---

## 📚 參考資源

- [Threads API 官方文檔](https://developers.facebook.com/docs/threads)
- [Threads Insights API](https://developers.facebook.com/docs/threads/insights)
- [Meta App Review 指南](https://developers.facebook.com/docs/app-review)
- [Threads API Integration Guide](https://www.ayrshare.com/threads-api-integration-authorization-posting-analytics-with-ayrshare/)
- [Getting Threads Metrics Tutorial](https://creativewritingwizard.com/2024/08/13/a-guide-to-getting-threads-metrics-via-threads-api/)

---

## ✅ 檢查清單

完成以下所有步驟後，您的系統就能獲取真實數據：

- [ ] 在 Meta Developer Console 添加 `threads_manage_insights` 權限
- [ ] 提交 App Review（如果是 Live Mode）
- [ ] 重新連結 Threads 帳號獲取新 Token
- [ ] 執行 `node test-insights-api.js` 驗證權限
- [ ] 手動觸發同步測試 API 整合
- [ ] 在 LINE Bot 輸入 `/data` 確認看到真實數據
- [ ] 檢查日誌確認沒有權限錯誤

---

## 🆘 需要幫助？

如果遇到問題：
1. 檢查 [test-insights-api.js](./test-insights-api.js) 的輸出
2. 查看伺服器日誌中的詳細錯誤訊息
3. 確認 Access Token 包含正確的權限
4. 確認 Media ID 正確（從 post_url 中提取）
