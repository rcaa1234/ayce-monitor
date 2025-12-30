# 系統設置指南

## 前置需求

### 1. 系統需求
- Node.js >= 18.0.0
- MySQL 8.0+
- Redis 6.0+

### 2. 外部服務帳號

#### OpenAI API
1. 前往 https://platform.openai.com/
2. 建立 API Key
3. 確保帳戶有足夠的額度

#### Google Gemini API
1. 前往 https://ai.google.dev/
2. 取得 API Key
3. 啟用 Generative AI API

#### LINE Messaging API
1. 前往 https://developers.line.biz/
2. 建立 Provider 和 Channel (Messaging API)
3. 取得 Channel Access Token 和 Channel Secret
4. 設定 Webhook URL: `https://your-domain/api/webhook/line`

#### Threads API (Meta)
1. 前往 https://developers.facebook.com/
2. 建立應用程式
3. 啟用 Threads API
4. 設定 OAuth Redirect URI: `https://your-domain/api/threads/callback`
5. 完成 OAuth 授權流程取得 access token

## 本機開發設置

### 步驟 1: 克隆專案

\`\`\`bash
git clone <repository-url>
cd threads-bot
\`\`\`

### 步驟 2: 安裝依賴

\`\`\`bash
npm install
\`\`\`

### 步驟 3: 設置 MySQL

\`\`\`bash
# 登入 MySQL
mysql -u root -p

# 建立資料庫
CREATE DATABASE threads_posting CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

# 建立使用者 (選用)
CREATE USER 'threads_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON threads_posting.* TO 'threads_user'@'localhost';
FLUSH PRIVILEGES;
\`\`\`

### 步驟 4: 設置 Redis

\`\`\`bash
# 使用 Docker (推薦)
docker run -d -p 6379:6379 redis:latest

# 或安裝本機版本
# macOS: brew install redis
# Ubuntu: sudo apt-get install redis-server
\`\`\`

### 步驟 5: 環境變數設定

\`\`\`bash
cp .env.example .env.local
\`\`\`

編輯 `.env.local`:

\`\`\`env
APP_ENV=local
APP_BASE_URL=http://localhost:3000
APP_PORT=3000

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=threads_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=threads_posting

REDIS_URL=redis://localhost:6379

OPENAI_API_KEY=sk-proj-...
GEMINI_API_KEY=AIza...

LINE_CHANNEL_ACCESS_TOKEN=your_line_token
LINE_CHANNEL_SECRET=your_line_secret

JWT_SECRET=your_random_jwt_secret_at_least_32_chars
ENCRYPTION_KEY=your_random_encryption_key_32_chars
\`\`\`

### 步驟 6: 執行資料庫 Migration

\`\`\`bash
npm run migrate
\`\`\`

### 步驟 7: 建立初始使用者和角色

執行以下 SQL:

\`\`\`sql
-- 建立角色
INSERT INTO roles (id, name) VALUES
  (UUID(), 'admin'),
  (UUID(), 'content_creator'),
  (UUID(), 'reviewer');

-- 建立管理員使用者
INSERT INTO users (id, email, name, line_user_id, status)
VALUES (UUID(), 'admin@example.com', 'Admin User', 'YOUR_LINE_USER_ID', 'ACTIVE');

-- 分配 admin 角色
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'admin@example.com' AND r.name = 'admin';
\`\`\`

**如何取得 LINE User ID:**
1. 在 LINE Developers Console 啟用 Webhook
2. 傳訊息給你的 Bot
3. 檢查 webhook payload 中的 `userId` 欄位

### 步驟 8: 設置 Threads 帳號

需要手動完成 OAuth 流程:

1. 建立 OAuth URL:
   \`\`\`
   https://threads.net/oauth/authorize
     ?client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_REDIRECT_URI
     &scope=threads_basic,threads_content_publish
     &response_type=code
   \`\`\`

2. 取得 authorization code 後,使用以下 API 交換 token

3. 將 token 存入資料庫 (需要實作 admin API 或手動執行):

\`\`\`sql
-- 建立 Threads 帳號
INSERT INTO threads_accounts (id, username, status, is_default)
VALUES (UUID(), 'your_username', 'ACTIVE', 1);

-- 儲存加密的 token (需要使用程式加密)
-- 這部分建議透過 API 完成
\`\`\`

### 步驟 9: 啟動服務

開啟兩個終端機視窗:

**終端機 1 - API Server:**
\`\`\`bash
npm run dev
\`\`\`

**終端機 2 - Worker:**
\`\`\`bash
npm run worker
\`\`\`

服務啟動後:
- API Server: http://localhost:3000
- Health Check: http://localhost:3000/api/health

## 生產環境部署 (Zeabur)

### 步驟 1: 準備 Git Repository

\`\`\`bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
\`\`\`

### 步驟 2: Zeabur 設定

1. 登入 https://zeabur.com/
2. 建立新專案
3. 新增服務:
   - **MySQL**: 使用 Zeabur 提供的 MySQL 服務
   - **Redis**: 使用 Zeabur 提供的 Redis 服務

### 步驟 3: 部署 API Service

1. 新增服務 → 從 Git 匯入
2. 選擇你的 repository
3. 服務名稱: `threads-api`
4. Build Command: `npm run build`
5. Start Command: `npm start`

### 步驟 4: 部署 Worker Service

1. 再次新增服務 → 從同一個 Git repository
2. 服務名稱: `threads-worker`
3. Build Command: `npm run build`
4. Start Command: `node dist/worker.js`

### 步驟 5: 設定環境變數

在兩個服務中都設定相同的環境變數:

\`\`\`
APP_ENV=production
APP_BASE_URL=https://your-domain.zeabur.app
APP_PORT=3000

MYSQL_HOST=<zeabur-mysql-host>
MYSQL_PORT=3306
MYSQL_USER=<zeabur-mysql-user>
MYSQL_PASSWORD=<zeabur-mysql-password>
MYSQL_DATABASE=threads_posting

REDIS_URL=<zeabur-redis-url>

OPENAI_API_KEY=<your-key>
GEMINI_API_KEY=<your-key>
LINE_CHANNEL_ACCESS_TOKEN=<your-token>
LINE_CHANNEL_SECRET=<your-secret>
JWT_SECRET=<your-secret>
ENCRYPTION_KEY=<your-key>
\`\`\`

### 步驟 6: 執行 Migration

連接到 Zeabur MySQL 並執行 migration:

\`\`\`bash
# 設定環境變數指向 Zeabur MySQL
export MYSQL_HOST=<zeabur-host>
export MYSQL_USER=<zeabur-user>
export MYSQL_PASSWORD=<zeabur-password>
export MYSQL_DATABASE=threads_posting

# 執行 migration
npm run migrate
\`\`\`

### 步驟 7: 更新 LINE Webhook URL

在 LINE Developers Console 更新 Webhook URL:
\`\`\`
https://your-domain.zeabur.app/api/webhook/line
\`\`\`

### 步驟 8: 更新 Threads OAuth Redirect URI

在 Meta Developers Console 更新 Redirect URI:
\`\`\`
https://your-domain.zeabur.app/api/threads/callback
\`\`\`

## 測試

### 1. 測試 API Server

\`\`\`bash
curl http://localhost:3000/api/health
\`\`\`

預期回應:
\`\`\`json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
\`\`\`

### 2. 測試產文功能

\`\`\`bash
curl -X POST http://localhost:3000/api/posts \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "topic": "科技趨勢",
    "keywords": ["AI", "未來"]
  }'
\`\`\`

### 3. 測試 LINE Bot

1. 將 LINE Bot 加為好友
2. 等待產文完成
3. 應收到 Flex Message 審稿通知

## 疑難排解

### 問題: Migration 失敗

**解決方案:**
- 檢查 MySQL 連線設定
- 確認資料庫已建立
- 檢查使用者權限

### 問題: Worker 無法連接 Redis

**解決方案:**
- 確認 Redis 服務正在運行
- 檢查 REDIS_URL 格式正確
- 測試連線: `redis-cli ping`

### 問題: LINE Bot 無法收到訊息

**解決方案:**
- 確認 Webhook URL 設定正確
- 檢查 LINE Channel Secret 正確
- 查看 server logs 確認有收到 webhook

### 問題: Threads 發文失敗

**解決方案:**
- 確認 access token 有效
- 檢查 token 權限範圍包含 `threads_content_publish`
- 查看錯誤訊息確認問題

## 監控與維護

### 查看 Logs

\`\`\`bash
# 即時查看 logs
tail -f logs/all.log

# 查看錯誤 logs
tail -f logs/error.log
\`\`\`

### 監控 Queue

使用 BullMQ Dashboard 或查詢 Redis:

\`\`\`bash
redis-cli
> KEYS bull:*
> LLEN bull:content-generation:wait
\`\`\`

### 資料庫備份

\`\`\`bash
mysqldump -u threads_user -p threads_posting > backup.sql
\`\`\`

## 支援

如有問題,請查看:
- [README.md](README.md) - 系統概述
- [API 文件](docs/API.md) - API 詳細說明
- GitHub Issues - 回報問題
