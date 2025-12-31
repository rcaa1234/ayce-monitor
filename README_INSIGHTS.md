# 📊 Threads Insights 數據監控功能

## 🎯 快速開始

### 1️⃣ 添加權限（5分鐘）
👉 [點這裡打開 Meta Developer Console](https://developers.facebook.com/apps/1451334755998289/use-cases/)
- 找到 Threads → Customize → Add permissions
- 勾選 `threads_manage_insights`
- 儲存

### 2️⃣ 重新連結帳號（2分鐘）
```bash
npm run dev
```
然後打開：https://f78893dc2f1a.ngrok-free.app/
- 刪除舊連結
- 重新授權

### 3️⃣ 測試（1分鐘）
```bash
npm run insights:test
```

看到真實數據 = ✅ 成功！

---

## 📖 詳細文件

- 🚀 [開始使用](./START_HERE.md) - 最簡化的步驟指南
- 📋 [完整申請流程](./APPLY_INSIGHTS_PERMISSION.md) - 詳細的申請和測試步驟
- 📚 [設定說明](./THREADS_INSIGHTS_SETUP.md) - 技術文檔和故障排除

---

## 🛠️ 可用指令

```bash
# 快速測試 Insights API（推薦）
npm run insights:test

# 查看目前的 Token 資訊
npm run insights:info

# 手動測試（需要先編輯填入 Token）
node test-insights-api.js
```

---

## 📊 功能說明

完成設定後，系統會自動：

✅ **每 4 小時同步數據**
- 最近 7 天的貼文數據
- 帳號追蹤者變化
- 互動率統計

✅ **LINE Bot 查詢**
- 輸入 `/data` 查看統計
- 顯示過去 7 天數據
- 最佳表現貼文

✅ **API 端點**
- `GET /api/analytics/summary` - 總覽
- `GET /api/analytics/posts/:id` - 單篇數據
- `POST /api/analytics/sync` - 手動同步

---

## ❓ 常見問題

### Q: 為什麼數據是隨機的？
A: Token 沒有 `threads_manage_insights` 權限，請按照步驟 1-3 設定。

### Q: 權限已添加但還是失敗？
A: 確認已重新連結帳號（步驟 2），舊 Token 不包含新權限。

### Q: 要等多久才能使用？
A: Development Mode 立即可用，Live Mode 需要 1-3 天審核。

---

## 🆘 需要幫助？

執行診斷工具：
```bash
npm run insights:info
```

會顯示：
- Token 狀態
- 權限列表
- 可用的測試貼文
- 詳細的測試指令

---

**準備好了嗎？開始第 1 步！** 👆
