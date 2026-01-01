# Zeabur 部署完整步驟指南

## 🔧 前置準備

### 1. 確認 GitHub 連接

1. 登入 [Zeabur](https://zeabur.com)
2. 點擊右上角頭像 → **Settings**
3. 左側選單選擇 **Integrations**
4. 點擊 **Connect GitHub**
5. 授權 Zeabur 訪問你的 GitHub 倉庫

---

## 📦 第一步：建立專案

1. 在 Zeabur Dashboard 點擊 **Create New Project**
2. 輸入專案名稱，例如：`threads-bot`
3. 選擇區域（建議選擇離你最近的區域）

---

## 🗄️ 第二步：新增 MySQL 服務

1. 在專案頁面點擊 **Add Service**
2. 選擇 **Prebuilt** 分頁
3. 找到並點擊 **MySQL**
4. 等待部署完成（通常 1-2 分鐘）

### 取得 MySQL 連線資訊

1. 點擊 MySQL 服務卡片
2. 切換到 **Connect** 標籤
3. 複製以下資訊（等等要用）：
   - Host
   - Port（通常是 3306）
   - Username（通常是 root）
   - Password

### 建立資料庫

**方法 A：使用 phpMyAdmin（推薦）**
1. 在 Connect 標籤找到 **phpMyAdmin** 連結
2. 點擊進入 phpMyAdmin
3. 點擊左側 **New**
4. 輸入資料庫名稱：`threads_posting`
5. 選擇 Collation：`utf8mb4_0900_ai_ci`
6. 點擊 **Create**

**方法 B：使用 SQL 命令**
```sql
CREATE DATABASE IF NOT EXISTS threads_posting
CHARACTER SET utf8mb4
COLLATE utf8mb4_0900_ai_ci;
```

---

## 📮 第三步：新增 Redis 服務

1. 回到專案頁面，再次點擊 **Add Service**
2. 選擇 **Prebuilt** 分頁
3. 找到並點擊 **Redis**
4. 等待部署完成

### 取得 Redis URL

1. 點擊 Redis 服務卡片
2. 切換到 **Connect** 標籤
3. 複製 **Connection String**（格式類似：`redis://host:port`）

---

## 💻 第四步：新增 Node.js 應用程式

### 從 Git 部署

1. 回到專案頁面，點擊 **Add Service**
2. 選擇 **Git** 分頁（⚠️ 不是 Prebuilt！）
3. 如果沒看到 Git 選項：
   - 確認已連接 GitHub（參考前置準備）
   - 重新整理頁面
4. 在倉庫列表中找到 `threads-bot`
5. 選擇 **main** 分支
6. 點擊 **Deploy**

### Zeabur 自動執行

部署時 Zeabur 會自動：
```bash
1. 克隆 Git 倉庫
2. npm install        # 安裝依賴
3. npm run build      # 編譯 TypeScript (postinstall 自動執行)
4. npm start          # 啟動應用程式
   ├─ npm run migrate # 執行資料庫遷移
   ├─ API Server      # 啟動在 port 3000
   └─ Worker          # 背景執行
```

---

## ⚙️ 第五步：設定環境變數

1. 點擊 Node.js 服務（threads-bot）卡片
2. 切換到 **Variables** 標籤
3. 點擊 **Add Variable** 逐一新增以下變數：

### 基本設定
```env
APP_ENV=production
APP_PORT=3000
```

### MySQL（從第二步複製）
```env
MYSQL_HOST=<從 MySQL 服務複製>
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=<從 MySQL 服務複製>
MYSQL_DATABASE=threads_posting
```

### Redis（從第三步複製）
```env
REDIS_URL=<從 Redis 服務複製，例如：redis://xxx.zeabur.app:6379>
```

### AI 引擎（使用你自己的 API Key）
```env
OPENAI_API_KEY=sk-proj-xxxxx
GEMINI_API_KEY=AIzaSyxxxxxx
```

### LINE Bot（從 LINE Developers 複製）
```env
LINE_CHANNEL_ACCESS_TOKEN=<你的 LINE Channel Access Token>
LINE_CHANNEL_SECRET=<你的 LINE Channel Secret>
```

### 安全性（生成隨機字串）
```env
JWT_SECRET=<64字元隨機字串>
ENCRYPTION_KEY=<44字元隨機字串>
```

**產生隨機字串的方法：**
```bash
# JWT_SECRET (64 字元)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# ENCRYPTION_KEY (44 字元)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Threads API（從 Meta Developers 複製）
```env
THREADS_CLIENT_ID=<你的 Threads App ID>
THREADS_CLIENT_SECRET=<你的 Threads App Secret>
```

### 應用程式 URL（等部署完成後更新）
```env
APP_BASE_URL=https://<zeabur-分配的域名>
THREADS_REDIRECT_URI=https://<zeabur-分配的域名>/api/threads/oauth/callback
```

4. 設定完成後，點擊右上角 **Save**

---

## 🔄 第六步：觸發重新部署

設定環境變數後需要重新部署：

1. 在 Node.js 服務頁面
2. 點擊右上角三個點 ⋮
3. 選擇 **Redeploy**
4. 等待部署完成（約 3-5 分鐘）

---

## 🌐 第七步：取得域名並更新環境變數

### 取得 Zeabur 域名

1. 部署完成後，點擊 Node.js 服務卡片
2. 切換到 **Domains** 標籤
3. Zeabur 會自動分配一個域名，例如：`threads-bot-xxx.zeabur.app`
4. 複製這個域名

### 更新環境變數

1. 回到 **Variables** 標籤
2. 更新以下兩個變數：
   ```env
   APP_BASE_URL=https://threads-bot-xxx.zeabur.app
   THREADS_REDIRECT_URI=https://threads-bot-xxx.zeabur.app/api/threads/oauth/callback
   ```
3. 儲存後再次 **Redeploy**

---

## 📱 第八步：更新外部服務

### 更新 LINE Bot Webhook

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 選擇你的 Bot
3. 進入 **Messaging API** 設定
4. 更新 **Webhook URL**：
   ```
   https://threads-bot-xxx.zeabur.app/api/line/webhook
   ```
5. 點擊 **Verify** 測試連線
6. 啟用 **Use webhook**

### 更新 Threads Redirect URI

1. 前往 [Meta for Developers](https://developers.facebook.com/)
2. 選擇你的 Threads App
3. 進入 **Threads** → **Settings**
4. 更新 **OAuth Redirect URIs**：
   ```
   https://threads-bot-xxx.zeabur.app/api/threads/oauth/callback
   ```
5. 儲存設定

---

## ✅ 第九步：驗證部署

### 1. 檢查服務狀態

在 Zeabur 專案頁面確認：
- ✅ MySQL: Running
- ✅ Redis: Running
- ✅ threads-bot: Running

### 2. 查看部署日誌

1. 點擊 threads-bot 服務
2. 切換到 **Logs** 標籤
3. 確認沒有錯誤訊息
4. 應該看到類似：
   ```
   ✓ MySQL database connected successfully
   ✓ Redis connected successfully
   Server is running on port 3000
   ✓ Generate worker started
   ✓ Publish worker started
   ```

### 3. 測試應用程式

1. **健康檢查**：訪問 `https://your-domain/health`
   - 應該看到：`{"status":"ok"}`

2. **登入系統**：訪問 `https://your-domain`
   - 使用預設帳號登入：
     - Email: `admin@example.com`
     - Password: `admin123`

3. **測試 LINE Bot**：
   - 發送訊息到你的 LINE Bot
   - 應該收到回應

4. **測試 Threads 連接**：
   - 在系統中連接 Threads 帳號
   - 確認 OAuth 流程正常

---

## 🎉 部署完成！

現在你的系統已經成功部署到 Zeabur 了！

### 下一步

1. **建立內容模板**：在「智能排程系統」中建立模板
2. **設定 UCB 排程**：配置 UCB 參數
3. **測試排程功能**：使用「立即觸發排程」測試
4. **監控系統**：定期查看 Logs 確認運作正常

### 自動部署

現在每次你推送代碼到 GitHub：
1. Zeabur 會自動偵測到更新
2. 自動重新建置和部署
3. 零停機時間更新

---

## ⚠️ 常見問題

### Q1: 部署失敗，顯示 "Build failed"
**A:** 檢查以下項目：
1. `package.json` 中的 scripts 是否正確
2. 所有依賴是否都在 `dependencies` 中
3. TypeScript 編譯是否有錯誤
4. 查看 Logs 取得詳細錯誤訊息

### Q2: 資料庫連線失敗
**A:** 確認：
1. MySQL 服務是否正常運行
2. 資料庫 `threads_posting` 是否已建立
3. 環境變數中的 MySQL 連線資訊是否正確
4. MYSQL_HOST 不要包含 `http://` 或 `https://`

### Q3: Redis 連線失敗
**A:** 確認：
1. Redis 服務是否正常運行
2. REDIS_URL 格式是否正確（`redis://host:port`）
3. 如果有密碼，格式應為：`redis://:password@host:port`

### Q4: Worker 沒有運行
**A:** 檢查：
1. Logs 中是否有 Worker 啟動訊息
2. `npm start` 是否正確執行了 concurrently
3. 確認 `package.json` 中的 start 腳本包含 Worker

### Q5: 環境變數沒有生效
**A:** 記得：
1. 修改環境變數後要 **Redeploy**
2. 變數名稱要完全正確（大小寫敏感）
3. 不要包含多餘的空格或引號

### Q6: LINE Bot 收不到訊息
**A:** 確認：
1. Webhook URL 是否正確更新
2. Webhook 驗證是否通過
3. LINE_CHANNEL_ACCESS_TOKEN 和 SECRET 是否正確
4. 系統 Logs 中是否有錯誤訊息

---

## 📊 監控建議

### 設定警報

1. 在 Zeabur 服務頁面
2. 設定 CPU、記憶體警報
3. 當資源使用過高時會收到通知

### 定期檢查

建議每天檢查：
- [ ] 服務狀態是否正常
- [ ] 錯誤日誌是否有異常
- [ ] UCB 排程是否正常執行
- [ ] LINE 通知是否正常發送

---

## 💰 成本參考

### Zeabur 定價（參考）

**免費方案**：
- 可部署小型應用
- 有資源和流量限制
- 適合測試使用

**Developer 方案** (~$5/月)：
- MySQL: 1GB 儲存
- Redis: 100MB
- 應用程式: 512MB RAM
- 適合個人使用

**Team 方案** (~$20/月)：
- 更多資源
- 更好效能
- 適合正式使用

建議：先使用免費方案測試，確認穩定後再升級。

---

## 🆘 需要幫助？

如果遇到問題：
1. 查看本文件的「常見問題」部分
2. 檢查 Zeabur Logs 取得詳細錯誤
3. 確認所有設定步驟都已完成
4. 參考主要的 `ZEABUR_DEPLOYMENT.md` 文件
