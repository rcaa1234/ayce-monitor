# Zeabur 部署指南

## 📦 部署前準備

### 1. 建立 Zeabur 專案

1. 登入 [Zeabur](https://zeabur.com)
2. 建立新專案
3. 連接你的 GitHub 倉庫

### 2. 新增服務

你需要新增以下三個服務：

#### ⚙️ Service 1: MySQL 資料庫
1. 在專案中點擊「Add Service」
2. 選擇「Prebuilt」→「MySQL」
3. 部署完成後，記下連線資訊

#### ⚙️ Service 2: Redis
1. 點擊「Add Service」
2. 選擇「Prebuilt」→「Redis」
3. 部署完成後，Redis URL 會自動產生

#### ⚙️ Service 3: Node.js 應用程式
1. 點擊「Add Service」
2. 選擇「Git」→ 選擇你的 GitHub 倉庫
3. Zeabur 會自動偵測 Node.js 專案

## 🔧 環境變數設定

在 Node.js 服務中設定以下環境變數：

### 應用程式設定
```
APP_ENV=production
APP_PORT=3000
```

### MySQL 資料庫（從 Zeabur MySQL 服務複製）
```
MYSQL_HOST=<zeabur-mysql-host>
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=<zeabur-mysql-password>
MYSQL_DATABASE=threads_posting
```

### Redis（從 Zeabur Redis 服務複製）
```
REDIS_URL=<zeabur-redis-url>
```

### AI 引擎 API Keys
```
OPENAI_API_KEY=<your-openai-api-key>
GEMINI_API_KEY=<your-gemini-api-key>
```

### LINE Bot
```
LINE_CHANNEL_ACCESS_TOKEN=<your-line-channel-access-token>
LINE_CHANNEL_SECRET=<your-line-channel-secret>
```

### JWT 與加密
```
JWT_SECRET=<generate-random-string-64-chars>
ENCRYPTION_KEY=<generate-random-string-44-chars>
```

### Threads API
```
THREADS_CLIENT_ID=<your-threads-client-id>
THREADS_CLIENT_SECRET=<your-threads-client-secret>
THREADS_REDIRECT_URI=https://<your-zeabur-domain>/api/threads/oauth/callback
```

### 應用程式 Base URL（Zeabur 部署後自動產生）
```
APP_BASE_URL=https://<your-zeabur-domain>
```

## 🚀 部署流程

### 1. 建立 MySQL 資料庫

部署完成後，需要先建立資料庫：

1. 進入 Zeabur MySQL 服務的「Connect」頁面
2. 使用提供的連線資訊連接到 MySQL（可用 phpMyAdmin 或命令列）
3. 執行以下 SQL：

```sql
CREATE DATABASE IF NOT EXISTS threads_posting CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

### 2. 設定環境變數

在 Node.js 服務中設定所有必要的環境變數（參考上方清單）

### 3. 部署應用程式

1. 推送代碼到 GitHub
2. Zeabur 會自動觸發部署
3. 部署過程中會：
   - 安裝依賴（npm install）
   - 編譯 TypeScript（npm run build）
   - 執行資料庫遷移（npm run migrate）
   - 啟動 API Server 和 Worker

### 4. 驗證部署

1. 檢查部署日誌，確認沒有錯誤
2. 訪問 `https://<your-domain>/health` 檢查健康狀態
3. 使用 Zeabur 提供的域名登入系統

## ⚠️ 重要注意事項

### 資料庫遷移
- 首次部署時，系統會自動執行資料庫遷移
- 如果遷移失敗，檢查 MySQL 連線設定

### Worker 進程
- Worker 和 API Server 在同一個容器中運行
- 確保 `concurrently` 套件已安裝

### Redis 連線
- 確認 Redis URL 格式正確：`redis://host:port`
- Zeabur 的 Redis 可能需要密碼認證

### 域名設定
- Zeabur 會自動分配一個域名
- 記得更新 `APP_BASE_URL` 和 `THREADS_REDIRECT_URI`

### LINE Bot Webhook
- 部署後，記得到 LINE Developers 更新 Webhook URL
- 新的 Webhook URL：`https://<your-domain>/api/line/webhook`

## 🔍 故障排除

### 1. 資料庫連線失敗
- 檢查 MySQL 環境變數是否正確
- 確認資料庫已建立
- 檢查 MySQL 服務是否正常運行

### 2. Redis 連線失敗
- 檢查 REDIS_URL 格式
- 確認 Redis 服務是否正常運行

### 3. 編譯失敗
- 檢查 TypeScript 語法錯誤
- 確認所有依賴已正確安裝

### 4. Worker 未運行
- 檢查部署日誌
- 確認 `start` 腳本包含 Worker 啟動命令

## 📊 監控與日誌

### 查看日誌
1. 進入 Zeabur 專案
2. 點擊 Node.js 服務
3. 切換到「Logs」標籤

### 效能監控
- Zeabur 提供基本的 CPU 和記憶體監控
- 建議設定警報通知

## 🔄 更新部署

1. 推送代碼到 GitHub
2. Zeabur 會自動重新部署
3. 資料庫遷移會自動執行（僅執行新的遷移）

## 💰 成本估算

### Zeabur 免費方案
- 可部署小型應用
- 有資源限制

### 付費方案
- MySQL: ~$5/月
- Redis: ~$3/月
- Node.js: 依用量計費

建議先使用免費方案測試，確認運作正常後再升級。

## 📝 檢查清單

部署前請確認：

- [ ] GitHub 倉庫已推送最新代碼
- [ ] MySQL 服務已建立並設定
- [ ] Redis 服務已建立
- [ ] 所有環境變數已設定
- [ ] API Keys 已準備好
- [ ] LINE Bot Webhook URL 已更新
- [ ] Threads OAuth Redirect URI 已更新

部署後請驗證：

- [ ] 應用程式可正常訪問
- [ ] 可以登入系統
- [ ] 資料庫遷移成功
- [ ] Worker 正常運行
- [ ] LINE Bot 可正常接收訊息
- [ ] Threads OAuth 登入正常
- [ ] UCB 排程功能正常

## 🆘 需要幫助？

如遇到問題：
1. 檢查 Zeabur 部署日誌
2. 查看應用程式錯誤日誌
3. 確認所有服務狀態正常
4. 檢查環境變數設定
