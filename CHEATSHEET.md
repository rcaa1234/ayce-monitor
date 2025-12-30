# Threads 半自動發文系統 - 速查表

## 🚀 快速開始

### 安裝與啟動
\`\`\`bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數
cp .env.example .env.local
# 編輯 .env.local 填入必要資訊

# 3. 初始化資料庫
npm run setup

# 4. 啟動服務 (開兩個終端機)
npm run dev      # 終端機 1: API Server
npm run worker   # 終端機 2: Worker
\`\`\`

## 📋 常用指令

### NPM Scripts
\`\`\`bash
npm run dev          # 開發模式啟動 API Server
npm run worker       # 啟動背景 Worker
npm run build        # 編譯 TypeScript
npm start            # 生產模式啟動
npm run migrate      # 執行資料庫 migration
npm run seed         # 執行種子資料
npm run setup        # migrate + seed
npm run lint         # 程式碼檢查
\`\`\`

### 資料庫操作
\`\`\`bash
# 連接資料庫
mysql -u root -p threads_posting

# 重置資料庫
DROP DATABASE threads_posting;
CREATE DATABASE threads_posting CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
npm run setup

# 備份資料庫
mysqldump -u root -p threads_posting > backup.sql

# 還原資料庫
mysql -u root -p threads_posting < backup.sql
\`\`\`

### Redis 操作
\`\`\`bash
# 連接 Redis
redis-cli

# 查看所有 Queue
KEYS bull:*

# 查看特定 Queue 長度
LLEN bull:content-generation:wait
LLEN bull:post-publish:wait

# 清空所有 Queue
FLUSHDB

# 查看記憶體使用
INFO memory
\`\`\`

## 🗄️ 資料庫快速參考

### 貼文狀態
\`\`\`
DRAFT           → 草稿
GENERATING      → 產文中
PENDING_REVIEW  → 待審稿
APPROVED        → 已核准
PUBLISHING      → 發文中
POSTED          → 已發文
FAILED          → 失敗
ACTION_REQUIRED → 需要處理
SKIPPED         → 已略過
\`\`\`

### 常用 SQL 查詢
\`\`\`sql
-- 查看所有貼文及狀態
SELECT id, status, created_at FROM posts ORDER BY created_at DESC LIMIT 10;

-- 查看待審稿的貼文
SELECT * FROM posts WHERE status = 'PENDING_REVIEW';

-- 查看已發文的貼文
SELECT id, post_url, posted_at FROM posts WHERE status = 'POSTED';

-- 查看特定貼文的所有版本
SELECT * FROM post_revisions WHERE post_id = 'YOUR_POST_ID' ORDER BY revision_no DESC;

-- 查看待處理的審稿請求
SELECT * FROM review_requests WHERE status = 'PENDING' AND expires_at > NOW();

-- 查看 Threads 帳號狀態
SELECT a.username, a.status, t.expires_at, t.status as token_status
FROM threads_accounts a
INNER JOIN threads_auth t ON a.id = t.account_id;

-- 查看最近的審計日誌
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;

-- 更新管理員 LINE User ID
UPDATE users SET line_user_id = 'YOUR_LINE_USER_ID' WHERE email = 'admin@example.com';
\`\`\`

## 🔌 API 端點

### 健康檢查
\`\`\`bash
GET /api/health

curl http://localhost:3000/api/health
\`\`\`

### 貼文管理 (需要認證)
\`\`\`bash
# 建立貼文並觸發產文
POST /api/posts
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "topic": "科技趨勢",
  "keywords": ["AI", "未來"],
  "stylePreset": "專業"
}

# 查看貼文
GET /api/posts/:id
Authorization: Bearer YOUR_JWT_TOKEN

# 查看特定狀態的貼文
GET /api/posts/status/PENDING_REVIEW
Authorization: Bearer YOUR_JWT_TOKEN

# 核准貼文
POST /api/posts/:id/approve
Authorization: Bearer YOUR_JWT_TOKEN

# 略過貼文
POST /api/posts/:id/skip
Authorization: Bearer YOUR_JWT_TOKEN
\`\`\`

### LINE 審稿 (公開端點)
\`\`\`bash
# 核准發文
GET /api/review/approve?token=REVIEW_TOKEN&lineUserId=LINE_USER_ID

# 重新產生
GET /api/review/regenerate?token=REVIEW_TOKEN&lineUserId=LINE_USER_ID

# 略過
GET /api/review/skip?token=REVIEW_TOKEN&lineUserId=LINE_USER_ID
\`\`\`

## 🔑 環境變數參考

### 必填項目
\`\`\`env
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=threads_posting
REDIS_URL=redis://localhost:6379
ENCRYPTION_KEY=至少32字元的隨機字串
JWT_SECRET=至少32字元的隨機字串
\`\`\`

### 選填項目 (功能相關)
\`\`\`env
OPENAI_API_KEY=sk-...          # GPT 產文
GEMINI_API_KEY=...              # Gemini 備援
LINE_CHANNEL_ACCESS_TOKEN=...   # LINE 審稿
LINE_CHANNEL_SECRET=...         # LINE 驗證
\`\`\`

## 🐛 除錯技巧

### 查看日誌
\`\`\`bash
# 即時查看所有日誌
tail -f logs/all.log

# 只看錯誤日誌
tail -f logs/error.log

# 搜尋特定關鍵字
grep "ERROR" logs/all.log
grep "post_id" logs/all.log
\`\`\`

### 常見問題排查

#### API Server 無法啟動
\`\`\`bash
# 檢查 port 是否被佔用
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# 檢查環境變數
node -e "console.log(require('./src/config').default)"
\`\`\`

#### Worker 無法連接 Redis
\`\`\`bash
# 測試 Redis 連線
redis-cli ping

# 檢查 REDIS_URL
echo $REDIS_URL
\`\`\`

#### 資料庫連線失敗
\`\`\`bash
# 測試 MySQL 連線
mysql -h localhost -u root -p -e "SELECT 1"

# 檢查資料庫是否存在
mysql -u root -p -e "SHOW DATABASES LIKE 'threads_posting'"
\`\`\`

#### 產文沒有反應
\`\`\`bash
# 檢查 Queue 狀態
redis-cli LLEN bull:content-generation:wait

# 檢查 Worker 是否運行
ps aux | grep "worker"

# 檢查 API Key 是否設定
echo $OPENAI_API_KEY
\`\`\`

## 📊 監控指令

### 系統狀態
\`\`\`bash
# 查看 Node.js 進程
ps aux | grep node

# 查看記憶體使用
free -h  # Linux
top      # All platforms

# 查看磁碟空間
df -h
\`\`\`

### 資料庫狀態
\`\`\`sql
-- 查看連線數
SHOW PROCESSLIST;

-- 查看表格大小
SELECT
  table_name,
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS "Size (MB)"
FROM information_schema.TABLES
WHERE table_schema = "threads_posting"
ORDER BY (data_length + index_length) DESC;

-- 查看資料筆數
SELECT
  'posts' as table_name, COUNT(*) as count FROM posts
UNION ALL
SELECT 'post_revisions', COUNT(*) FROM post_revisions
UNION ALL
SELECT 'review_requests', COUNT(*) FROM review_requests
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs;
\`\`\`

### Queue 狀態
\`\`\`bash
# 進入 redis-cli
redis-cli

# 查看各 Queue 狀態
LLEN bull:content-generation:wait
LLEN bull:content-generation:active
LLEN bull:content-generation:completed
LLEN bull:content-generation:failed

LLEN bull:post-publish:wait
LLEN bull:post-publish:active

LLEN bull:token-refresh:wait
\`\`\`

## 🔧 開發技巧

### 手動觸發產文 (SQL)
\`\`\`sql
-- 1. 建立貼文
INSERT INTO posts (id, status, created_by)
VALUES (UUID(), 'DRAFT', (SELECT id FROM users LIMIT 1));

-- 2. 取得 post_id
SELECT id FROM posts ORDER BY created_at DESC LIMIT 1;

-- 3. 手動加入 Queue (使用 redis-cli)
-- LPUSH bull:content-generation:wait '{"postId":"YOUR_POST_ID","createdBy":"USER_ID"}'
\`\`\`

### 測試審稿流程
\`\`\`sql
-- 1. 建立測試 review request
INSERT INTO review_requests (id, post_id, revision_id, token, reviewer_user_id, status, expires_at)
VALUES (
  UUID(),
  'YOUR_POST_ID',
  'YOUR_REVISION_ID',
  'test_token_123456',
  'YOUR_USER_ID',
  'PENDING',
  DATE_ADD(NOW(), INTERVAL 24 HOUR)
);

-- 2. 測試審稿 URL
-- http://localhost:3000/api/review/approve?token=test_token_123456&lineUserId=YOUR_LINE_USER_ID
\`\`\`

### 產生測試資料
\`\`\`sql
-- 建立測試使用者
INSERT INTO users (id, email, name, status)
VALUES (UUID(), 'test@example.com', 'Test User', 'ACTIVE');

-- 分配角色
INSERT INTO user_roles (user_id, role_id)
SELECT
  (SELECT id FROM users WHERE email = 'test@example.com'),
  (SELECT id FROM roles WHERE name = 'content_creator');
\`\`\`

## 🔐 安全提醒

### 生產環境檢查清單
- [ ] 更改預設管理員密碼
- [ ] 使用強 JWT_SECRET
- [ ] 使用強 ENCRYPTION_KEY
- [ ] 設定適當的 CORS 政策
- [ ] 啟用 HTTPS
- [ ] 定期備份資料庫
- [ ] 監控 API 使用量
- [ ] 設定 rate limiting
- [ ] 定期更新依賴套件
- [ ] 檢查日誌異常活動

### 金鑰安全
\`\`\`bash
# 絕對不要提交到 git
echo ".env.local" >> .gitignore

# 定期輪換金鑰
# 使用密碼管理工具儲存

# 限制金鑰權限
chmod 600 .env.local
\`\`\`

## 📱 LINE Bot 設定

### Webhook URL
\`\`\`
本機測試 (使用 ngrok):
https://your-ngrok-url.ngrok.io/api/webhook/line

生產環境:
https://your-domain.com/api/webhook/line
\`\`\`

### 取得 LINE User ID
\`\`\`bash
# 1. 設定 Webhook
# 2. 傳訊息給 Bot
# 3. 檢查 server logs 或資料庫
# 4. webhook payload 中會有 userId 欄位
\`\`\`

## 🌐 Threads API 設定

### OAuth URL
\`\`\`
https://threads.net/oauth/authorize
  ?client_id=YOUR_CLIENT_ID
  &redirect_uri=YOUR_REDIRECT_URI
  &scope=threads_basic,threads_content_publish
  &response_type=code
\`\`\`

### 必要權限
- `threads_basic` - 基本資訊
- `threads_content_publish` - 發布內容

## 📚 文件快速連結

- [README.md](README.md) - 系統概述
- [QUICKSTART.md](QUICKSTART.md) - 5 分鐘快速開始
- [SETUP.md](SETUP.md) - 完整設置指南
- [ARCHITECTURE.md](ARCHITECTURE.md) - 系統架構
- [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - 專案總結

---

**提示**: 將此文件加入書籤,隨時參考! 📌
