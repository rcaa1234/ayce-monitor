# 快速開始指南

本指南將帶你在 5 分鐘內完成系統基本設置並運行第一個測試。

## 前置條件檢查

確認你已安裝:
- ✅ Node.js 18+ (`node --version`)
- ✅ MySQL 8.0+ (`mysql --version`)
- ✅ Redis (`redis-cli ping`)

## 快速設置 (5 分鐘)

### 1. 安裝依賴 (1 分鐘)

\`\`\`bash
npm install
\`\`\`

### 2. 建立資料庫 (30 秒)

\`\`\`bash
mysql -u root -p -e "CREATE DATABASE threads_posting CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
\`\`\`

### 3. 設定環境變數 (1 分鐘)

\`\`\`bash
cp .env.example .env.local
\`\`\`

**最小化設定** - 編輯 `.env.local`,只需填入這些:

\`\`\`env
# 資料庫 (必填)
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=你的MySQL密碼
MYSQL_DATABASE=threads_posting

# Redis (必填)
REDIS_URL=redis://localhost:6379

# 加密金鑰 (必填 - 隨機產生)
ENCRYPTION_KEY=請輸入至少32個字元的隨機字串

# JWT Secret (必填 - 隨機產生)
JWT_SECRET=請輸入至少32個字元的隨機字串

# AI Keys (測試時可先不填,但無法產文)
OPENAI_API_KEY=
GEMINI_API_KEY=

# LINE (測試時可先不填,但無法審稿)
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
\`\`\`

### 4. 初始化資料庫 (1 分鐘)

\`\`\`bash
npm run setup
\`\`\`

這會執行:
- 資料庫 migration (建立所有表格)
- 種子資料 (建立角色和管理員帳號)

### 5. 啟動服務 (30 秒)

開啟兩個終端機:

**終端機 1:**
\`\`\`bash
npm run dev
\`\`\`

**終端機 2:**
\`\`\`bash
npm run worker
\`\`\`

### 6. 測試 (30 秒)

\`\`\`bash
curl http://localhost:3000/api/health
\`\`\`

看到 `{"status":"ok"}` 就成功了! 🎉

## 接下來做什麼?

### 階段 1: 完整設定 AI Keys

1. 取得 OpenAI API Key: https://platform.openai.com/api-keys
2. 取得 Gemini API Key: https://ai.google.dev/
3. 更新 `.env.local` 中的 keys
4. 重啟服務

### 階段 2: 設定 LINE Bot

1. 建立 LINE Bot: https://developers.line.biz/
2. 取得 Channel Access Token 和 Secret
3. 更新 `.env.local`
4. 設定 Webhook URL (使用 ngrok 本機測試)
5. 取得你的 LINE User ID
6. 更新管理員帳號:

\`\`\`sql
UPDATE users
SET line_user_id = '你的LINE_USER_ID'
WHERE email = 'admin@example.com';
\`\`\`

### 階段 3: 設定 Threads 帳號

1. 完成 Meta 開發者註冊
2. 建立應用程式啟用 Threads API
3. 完成 OAuth 流程
4. 將 token 存入資料庫

詳細步驟請參考 [SETUP.md](SETUP.md)

## 測試產文流程 (需要 AI Keys)

### 使用 API 觸發產文

首先需要建立 JWT token。簡單測試可以暫時跳過認證:

\`\`\`bash
# 直接透過資料庫觸發
mysql -u root -p threads_posting

# 建立測試貼文
INSERT INTO posts (id, status, created_by)
VALUES (UUID(), 'DRAFT', (SELECT id FROM users LIMIT 1));

# 記下 post ID
SELECT id FROM posts ORDER BY created_at DESC LIMIT 1;
\`\`\`

然後手動加入 Queue:

\`\`\`bash
# 使用 redis-cli
redis-cli

# 加入產文任務
LPUSH bull:content-generation:wait '{"postId":"你的POST_ID","createdBy":"USER_ID"}'
\`\`\`

Worker 會自動處理並產生內容!

## 常見問題

### Q: 看到 "Missing required environment variables"

**A:** 檢查 `.env.local` 是否有設定 MySQL 和 Redis 連線資訊

### Q: Migration 失敗

**A:** 確認:
1. MySQL 服務正在運行
2. 資料庫已建立
3. 連線資訊正確

### Q: Worker 無法連接 Redis

**A:** 確認:
1. Redis 服務正在運行: `redis-cli ping`
2. REDIS_URL 格式正確

### Q: 如何產生安全的 ENCRYPTION_KEY?

**A:** 使用以下指令:

\`\`\`bash
# macOS/Linux
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
\`\`\`

## 目錄結構說明

\`\`\`
threads-bot/
├── src/
│   ├── config/         # 環境配置載入
│   ├── database/       # 資料庫連線、migration、seed
│   ├── models/         # 資料存取層 (User, Post, etc.)
│   ├── services/       # 業務邏輯 (AI, LINE, Threads, Queue)
│   ├── controllers/    # API 控制器
│   ├── routes/         # API 路由定義
│   ├── workers/        # 背景任務處理器
│   ├── middlewares/    # Express 中介層 (認證等)
│   ├── cron/           # 排程任務
│   ├── utils/          # 工具函數
│   └── types/          # TypeScript 型別定義
├── logs/               # 日誌檔案 (自動建立)
├── .env.local          # 本機環境變數 (你需要建立)
└── README.md           # 完整文件
\`\`\`

## 下一步

- 📖 閱讀 [README.md](README.md) 了解系統架構
- 🔧 查看 [SETUP.md](SETUP.md) 進行完整設定
- 🚀 參考 API 文件開始使用

需要幫助? 查看 logs 或建立 GitHub Issue!
