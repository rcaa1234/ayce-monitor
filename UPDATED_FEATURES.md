# 🎉 系統更新說明

## 📋 新增功能總覽

本次更新完全按照您的需求重新設計了系統流程，實現了真正的**半自動化 Threads 發文系統**。

---

## ✨ 主要更新內容

### 1. 全新的系統設定頁面 ⚙️

訪問前端設定標籤，您現在可以：

#### 🤖 AI 引擎選擇
- **OpenAI GPT-4** 或 **Google Gemini**
- 選擇您偏好的 AI 引擎來生成內容

#### ✏️ 自訂提示詞
- **預設風格**：專業正式、輕鬆隨興、幽默風趣、教育知識
- **自訂提示詞編輯器**：完全自訂 AI 生成的風格和內容方向
- 風格範例會自動填入，也可手動編輯

#### 📅 每週自動排程
- **週一至週日**：每天都可獨立設定
- **自訂時間**：設定每天幾點自動產生文章
- **彈性開關**：可以選擇只在特定日期產文（例如：只在工作日）

#### 🧪 測試生成功能
- **即時測試**：不儲存到資料庫
- **可調整篇數**：1-10 篇
- **即時預覽**：查看當前設定下 AI 生成的效果

---

### 2. LINE Bot 編輯功能 ✏️

現在用戶可以在 LINE 中直接編輯內容！

#### 使用流程：

1. **收到 LINE 審核通知**
   - 系統自動生成文章後推送到 LINE

2. **三種操作方式**：
   - ✅ **直接核准** - 使用 AI 生成的原始內容發布
   - 🔄 **重新生成** - AI 重新產生一篇新的
   - ✏️ **編輯後發布** - **新功能！**

3. **編輯流程**：
   - 在 LINE 聊天室直接回覆修改後的文字
   - 系統收到後顯示確認訊息
   - 點擊「確認發布」即可使用修改後的內容發布

#### 技術實現：
- 新增 `POST /api/webhook/line` 端點接收 LINE 訊息
- 新增 `edited_content` 欄位儲存用戶修改的內容
- 新增 `GET /api/review/approve-edited` 處理編輯後的核准

---

### 3. 智能排程系統 📆

根據您的設定自動產文：

#### 動態 Cron 排程
- 系統啟動時讀取設定
- 為每個啟用的日期建立獨立的 cron job
- 支援不同日期設定不同時間

#### 自動化流程：
```
1. 到達排程時間
   ↓
2. 系統讀取 AI 引擎和提示詞設定
   ↓
3. 自動生成一篇文章
   ↓
4. 推送到 LINE 等待審核
   ↓
5. 用戶在 LINE 中選擇：核准/重新生成/編輯後發布
   ↓
6. 自動發布到 Threads
```

---

## 🔧 技術更新

### 資料庫變更

1. **新增 `system_settings` 表**
   ```sql
   - id: 設定 ID
   - setting_key: 設定鍵名
   - setting_value: 設定值
   - setting_type: 資料類型（STRING/NUMBER/BOOLEAN/JSON）
   ```

2. **`review_requests` 表新增欄位**
   ```sql
   - edited_content: 儲存用戶編輯後的內容（MEDIUMTEXT）
   ```

### API 端點新增

1. **設定管理**
   - `GET /api/settings` - 讀取所有設定
   - `PUT /api/settings` - 更新設定
   - `POST /api/settings/test-generate` - 測試生成

2. **LINE Bot**
   - `POST /api/webhook/line` - 接收 LINE 訊息
   - `GET /api/review/approve-edited` - 編輯後核准

### 程式碼更新

1. **新增檔案**
   - `src/models/settings.model.ts` - 設定資料模型
   - `migrations/add-system-settings.js` - 建立設定表
   - `migrations/add-edited-content.js` - 新增編輯欄位

2. **修改檔案**
   - `src/routes/index.ts` - 新增所有 API 端點
   - `src/cron/scheduler.ts` - 動態排程系統
   - `src/services/threads.service.ts` - 修正欄位名稱
   - `public/index.html` - 全新設定頁面

3. **修復問題**
   - ✅ Token refresh scheduler 的欄位名稱錯誤
   - ✅ OAuth long-lived token 轉換
   - ✅ User ID 參數不一致問題

---

## 🚀 使用指南

### 初次設定步驟

1. **啟動系統**
   ```bash
   npm run dev     # 終端機 1: API Server
   npm run worker  # 終端機 2: Background Workers
   ```

2. **登入前端**
   - 訪問 http://localhost:3000
   - 使用 `admin@example.com` / `admin123` 登入

3. **設定 Threads 帳號**
   - 點擊「👤 Threads 帳號」標籤
   - 點擊「連結新帳號」
   - 完成 OAuth 授權（需要 ngrok）

4. **配置系統設定**
   - 點擊「⚙️ 設定」標籤
   - 選擇 AI 引擎（GPT-4 或 Gemini）
   - 選擇發文風格或自訂提示詞
   - 設定每週排程（哪幾天、幾點）
   - 點擊「測試生成」查看效果
   - 點擊「儲存所有設定」

5. **測試流程**
   - 等待排程時間到達，或手動觸發
   - 檢查 LINE 是否收到通知
   - 在 LINE 中測試三種操作方式

---

## 📝 預設設定

系統初始化時會建立以下預設設定：

- **AI 引擎**: GPT-4
- **發文風格**: 專業正式
- **提示詞**: "請以專業、友善的語氣撰寫關於科技趨勢的文章"
- **排程**: 週一至週五早上 9:00
- **測試生成篇數**: 3 篇

---

## ⚠️ 重要提醒

### OAuth 設定

確保您的 `.env.local` 包含以下設定：

```env
# Threads OAuth
THREADS_CLIENT_ID=你的_CLIENT_ID
THREADS_CLIENT_SECRET=你的_CLIENT_SECRET
THREADS_REDIRECT_URI=https://你的ngrok網址.ngrok-free.app/api/threads/oauth/callback

# LINE Bot（如需使用審核功能）
LINE_CHANNEL_ACCESS_TOKEN=你的_LINE_TOKEN
LINE_CHANNEL_SECRET=你的_LINE_SECRET
```

### 重新授權 Threads

由於我們修正了 token 處理邏輯（現在使用 long-lived token），請：

1. 刪除舊的 Threads 帳號連結
2. 重新進行 OAuth 授權
3. 新的 token 有效期為 60 天

---

## 🔍 故障排除

### 設定無法儲存

- 檢查是否已執行 migration: `node migrations/add-system-settings.js`
- 檢查資料庫連線

### LINE Bot 無回應

- 確認 LINE webhook URL 已設定為 `https://你的ngrok網址/api/webhook/line`
- 檢查 LINE Channel Access Token 是否正確

### 排程沒有觸發

- 檢查伺服器時區設定（預設 Asia/Taipei）
- 確認設定頁面中有啟用對應的日期
- 查看伺服器日誌確認 cron 是否正常啟動

---

## 📊 系統架構

```
前端（設定為主）
  ├─ AI 引擎選擇
  ├─ 提示詞編輯
  ├─ 排程設定
  └─ 測試生成
       ↓
定時 Scheduler（根據設定）
  ├─ 週一 09:00 自動產文
  ├─ 週二 09:00 自動產文
  └─ ...
       ↓
AI 自動生成內容
  └─ 使用設定的引擎和提示詞
       ↓
推送到 LINE Bot
  ├─ ✅ 直接核准
  ├─ 🔄 重新生成
  └─ ✏️ 編輯後發布（回覆文字）
       ↓
自動發布到 Threads
```

---

## 🎯 下一步

現在所有功能都已完成！您可以：

1. ✅ 測試設定頁面的所有功能
2. ✅ 測試生成功能查看 AI 效果
3. ✅ 儲存設定並等待排程觸發
4. ✅ 在 LINE 中測試編輯功能
5. ✅ 重新授權 Threads 帳號獲取新 token

**系統已經準備就緒，可以開始使用了！** 🚀
