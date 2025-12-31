# 🚀 開始申請 Threads Insights 權限

## 現在就開始！只需 3 步驟

---

## ✅ 第 1 步：添加權限（5 分鐘）

### 1.1 打開 Meta Developer Console
點擊這個連結（會直接開啟您的 App）：
👉 **https://developers.facebook.com/apps/1451334755998289/use-cases/**

### 1.2 添加 Insights 權限
1. 找到 **"Threads"** 區塊
2. 點擊 **"Customize"** 或 **"Settings"**
3. 在 **Permissions** 找到 **"Add permissions"**
4. 勾選 `threads_manage_insights`
5. 點擊 **"Save Changes"**

### 1.3 確認狀態
- 🟡 **Development Mode** → 權限立即生效，繼續下一步！
- 🟢 **Live Mode** → 需要提交 App Review（1-3 天），或先切回 Development Mode 測試

✅ **完成第 1 步後，繼續第 2 步**

---

## ✅ 第 2 步：重新連結帳號（2 分鐘）

### 2.1 啟動系統
打開終端機，執行：
```bash
npm run dev
```

### 2.2 打開管理介面
在瀏覽器打開：
```
https://f78893dc2f1a.ngrok-free.app/
```

### 2.3 刪除舊連結（如果有）
1. 登入管理介面
2. 前往 **Threads 帳號管理**
3. 如果有已連結的帳號，點擊 **"刪除"**

### 2.4 重新連結
1. 點擊 **"連結新 Threads 帳號"**
2. 在授權頁面確認看到 `threads_manage_insights` 權限
3. 點擊 **"授權"**
4. 等待跳轉回管理介面

✅ **完成第 2 步後，繼續第 3 步**

---

## ✅ 第 3 步：測試驗證（2 分鐘）

### 方式 A：使用自動化測試腳本（推薦）

在終端機執行：
```bash
node scripts/quick-test-insights.js
```

**預期輸出：**
```
🚀 快速測試 Threads Insights API

📋 步驟 1/4: 取得 Access Token...
✓ 已取得 Token (@yourthreadsaccount)

📋 步驟 2/4: 檢查 Token 權限...
   權限列表: threads_basic, threads_content_publish, threads_manage_insights
   ✅ 具有 threads_manage_insights 權限

📋 步驟 3/4: 取得測試用貼文...
   ✓ 使用貼文: ABC123XYZ

📋 步驟 4/4: 呼叫 Insights API...
   ✅ API 呼叫成功！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Insights 數據:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   views     : 2,341
   likes     : 128
   replies   : 23
   reposts   : 15
   quotes    : 5
   shares    : 8
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   總互動數: 179
   互動率:   7.65%

✅ 測試成功！
```

### 方式 B：在 LINE Bot 測試

1. 打開 LINE
2. 輸入 `/data`
3. 應該會看到真實數字（不是隨機數字）

✅ **看到真實數據 = 大功告成！🎉**

---

## ❌ 如果測試失敗

### 錯誤 1: "缺少 threads_manage_insights 權限"
**原因**：Token 還沒有新權限
**解決**：
1. 確認第 1 步的權限已儲存
2. 確實刪除舊連結並重新授權（第 2 步）
3. 等待 5 分鐘後重試

### 錯誤 2: "找不到 Threads 帳號連結"
**原因**：資料庫沒有連結記錄
**解決**：重新執行第 2 步（重新連結帳號）

### 錯誤 3: "找不到已發布的貼文"
**原因**：資料庫沒有已發布的貼文
**解決**：先發布至少一篇貼文再測試

### 錯誤 4: API 返回 403 或 400
**原因**：
- Token 權限不足
- Meta 還在處理權限變更
- Insights API 尚未對您的帳號開放

**解決**：
1. 檢查 Meta Developer Console 確認權限已添加
2. 等待 10-15 分鐘後重試
3. 如果是 Live Mode，確認 App Review 已通過

---

## 📚 詳細文件

如果需要更詳細的說明：

- 📖 **完整申請指南**：[APPLY_INSIGHTS_PERMISSION.md](./APPLY_INSIGHTS_PERMISSION.md)
- 📖 **設定說明**：[THREADS_INSIGHTS_SETUP.md](./THREADS_INSIGHTS_SETUP.md)
- 🧪 **手動測試腳本**：[test-insights-api.js](./test-insights-api.js)

---

## 🛠️ 輔助工具

### 查看目前的 Token 資訊
```bash
node scripts/get-token-info.js
```
會顯示：
- Token 狀態（有效/過期）
- 帳號資訊
- 解密後的 Access Token
- 可用於測試的貼文清單

### 快速測試 API
```bash
node scripts/quick-test-insights.js
```
會自動：
- 從資料庫取得 Token
- 檢查權限
- 呼叫 Insights API
- 顯示測試結果

---

## ✅ 完成檢查清單

請依序完成：

- [ ] 第 1 步：在 Meta Developer Console 添加 `threads_manage_insights` 權限
- [ ] 第 2 步：刪除舊連結並重新授權
- [ ] 第 3 步：執行 `node scripts/quick-test-insights.js` 測試
- [ ] ✅ 看到真實的 Insights 數據

---

## 🎉 成功後會怎樣？

完成後，系統會：
- ✅ 每 4 小時自動同步貼文數據
- ✅ LINE Bot `/data` 顯示真實數據
- ✅ 可追蹤哪些內容最受歡迎
- ✅ 分析粉絲成長趨勢

---

## 🆘 需要幫助？

遇到問題請：
1. 截圖錯誤訊息
2. 執行 `node scripts/get-token-info.js` 取得詳細資訊
3. 告訴我在哪一步卡住

我會協助您解決！😊

---

## 🚀 準備好了嗎？

**現在就開始吧！**
1. 點擊 https://developers.facebook.com/apps/1451334755998289/use-cases/
2. 開始第 1 步：添加權限
3. 有任何問題隨時告訴我！
