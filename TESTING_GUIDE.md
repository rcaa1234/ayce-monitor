# API 測試指南

本系統是純後端 API,可以使用以下方式進行測試。

---

## 📋 測試工具選擇

### 方式 1: Postman (推薦給初學者)
- 下載: https://www.postman.com/downloads/
- 圖形化介面,操作簡單

### 方式 2: curl (命令列)
- Windows 10+ 內建
- 適合快速測試

### 方式 3: VS Code REST Client 擴充套件
- 在 VS Code 中直接測試
- 本文件提供 `.http` 檔案範例

---

## 🔐 認證流程

大部分 API 需要 JWT Token 認證。

### Step 1: 登入取得 Token

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@example.com\",\"password\":\"admin123\"}"
```

**回應範例:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "xxx",
    "email": "admin@example.com",
    "name": "Admin",
    "roles": ["admin"]
  }
}
```

**重要**: 複製 `token` 的值,後續請求會用到!

---

## 🧪 完整測試流程

### 1. 健康檢查 (無需認證)

```bash
curl http://localhost:3000/api/health
```

### 2. 建立貼文

```bash
curl -X POST http://localhost:3000/api/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的TOKEN" \
  -d "{
    \"topic\": \"科技趨勢\",
    \"keywords\": [\"AI\", \"機器學習\", \"未來科技\"],
    \"targetTone\": \"專業但易懂\",
    \"targetLength\": 500,
    \"scheduledFor\": \"2024-12-25T10:00:00Z\"
  }"
```

**回應範例:**
```json
{
  "id": "post-uuid-123",
  "status": "DRAFT",
  "topic": "科技趨勢",
  "createdAt": "2024-12-23T..."
}
```

### 3. 觸發內容生成

```bash
curl -X POST http://localhost:3000/api/posts/post-uuid-123/generate \
  -H "Authorization: Bearer 你的TOKEN"
```

**會發生什麼:**
1. 系統加入生成任務到 Queue
2. Worker 開始用 AI 產生內容
3. 檢查與過去 60 篇的相似度
4. 若相似度 < 0.86,發送 LINE 審稿通知

### 4. 查詢貼文狀態

```bash
curl http://localhost:3000/api/posts/post-uuid-123 \
  -H "Authorization: Bearer 你的TOKEN"
```

**狀態變化:**
- `DRAFT` → `GENERATING` → `PENDING_REVIEW` → `APPROVED` → `PUBLISHING` → `POSTED`

### 5. 查詢所有貼文

```bash
curl "http://localhost:3000/api/posts?status=PENDING_REVIEW&page=1&limit=10" \
  -H "Authorization: Bearer 你的TOKEN"
```

### 6. 審核貼文 (模擬 LINE 審核)

```bash
curl -X POST http://localhost:3000/api/review/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的TOKEN" \
  -d "{
    \"postId\": \"post-uuid-123\",
    \"revisionId\": \"revision-uuid-456\",
    \"action\": \"approve\"
  }"
```

**可用動作:**
- `approve` - 核准發布
- `regenerate` - 重新產生
- `skip` - 跳過此次發文

### 7. 手動觸發發布

```bash
curl -X POST http://localhost:3000/api/posts/post-uuid-123/publish \
  -H "Authorization: Bearer 你的TOKEN"
```

---

## 🎯 快速測試腳本 (Windows PowerShell)

建立檔案 `test.ps1`:

```powershell
# 1. 登入
$response = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"email":"admin@example.com","password":"admin123"}'

$token = $response.token
Write-Host "Token: $token"

# 2. 建立貼文
$post = Invoke-RestMethod -Uri "http://localhost:3000/api/posts" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body '{"topic":"測試主題","keywords":["測試"],"targetTone":"輕鬆","targetLength":300}'

$postId = $post.id
Write-Host "Post ID: $postId"

# 3. 觸發生成
Invoke-RestMethod -Uri "http://localhost:3000/api/posts/$postId/generate" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"}

Write-Host "內容生成中..."

# 4. 查詢狀態
Start-Sleep -Seconds 5
$status = Invoke-RestMethod -Uri "http://localhost:3000/api/posts/$postId" `
  -Headers @{Authorization="Bearer $token"}

Write-Host "狀態: $($status.status)"
```

執行:
```bash
powershell -ExecutionPolicy Bypass -File test.ps1
```

---

## 📝 REST Client 檔案 (VS Code)

安裝 VS Code 的 "REST Client" 擴充套件後,建立 `api-test.http`:

```http
### 變數
@baseUrl = http://localhost:3000/api
@token = 取得token後貼在這裡

### 健康檢查
GET {{baseUrl}}/health

### 登入
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "admin123"
}

### 建立貼文
POST {{baseUrl}}/posts
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "topic": "AI 人工智慧的未來",
  "keywords": ["AI", "深度學習", "神經網路"],
  "targetTone": "專業但平易近人",
  "targetLength": 500,
  "scheduledFor": "2024-12-25T10:00:00Z"
}

### 查詢貼文
GET {{baseUrl}}/posts?status=DRAFT
Authorization: Bearer {{token}}

### 觸發生成
POST {{baseUrl}}/posts/貼文ID/generate
Authorization: Bearer {{token}}

### 查詢單一貼文
GET {{baseUrl}}/posts/貼文ID
Authorization: Bearer {{token}}
```

---

## 🔍 檢查系統運作

### 查看日誌檔案

```bash
# 查看所有日誌
type logs\all.log

# 查看錯誤日誌
type logs\error.log

# 即時監控 (PowerShell)
Get-Content logs\all.log -Wait -Tail 20
```

### 查看資料庫

```bash
mysql -u root -p threads_bot_db

# 查看所有貼文
SELECT id, topic, status, created_at FROM posts;

# 查看審核請求
SELECT post_id, status, created_at FROM review_requests;

# 查看任務佇列
SELECT id, name, status, created_at FROM jobs;
```

### 查看 Redis Queue

```bash
docker exec -it threads-redis redis-cli

# 查看所有 keys
KEYS *

# 查看 Queue 長度
LLEN bull:content-generation:wait
LLEN bull:post-publishing:wait
```

---

## ⚠️ 注意事項

### 1. 預設管理員帳號

**必須先修改 LINE User ID!**

```bash
mysql -u root -p threads_bot_db

UPDATE users
SET line_user_id = '你的LINE_USER_ID'
WHERE email = 'admin@example.com';
```

否則無法收到審稿通知。

### 2. AI API Keys

如果沒有設定 `OPENAI_API_KEY` 或 `GEMINI_API_KEY`,內容生成會失敗。

**開發測試用設定 (.env.local):**

```env
# 如果只是測試資料流程,可以暫時跳過 AI
# 但實際使用必須要有至少一個 API Key

OPENAI_API_KEY=sk-your-key-here
# 或
GEMINI_API_KEY=your-gemini-key-here
```

### 3. Threads 帳號設定

發布功能需要先設定 Threads 帳號:

```bash
# 透過 OAuth 流程取得 Token (需要實作前端 OAuth callback)
# 或手動插入測試資料

INSERT INTO threads_accounts (user_id, username, account_id)
VALUES ('你的user_id', 'threads帳號名稱', 'threads_account_id');

INSERT INTO threads_auth (account_id, access_token, token_type, expires_at)
VALUES ('threads_account_id', '加密後的token', 'Bearer', DATE_ADD(NOW(), INTERVAL 60 DAY));
```

---

## 🎬 完整工作流程測試

### 情境: 建立並發布一篇貼文

```bash
# Step 1: 登入
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  > token.json

# Step 2: 設定 Token (PowerShell)
$token = (Get-Content token.json | ConvertFrom-Json).token

# Step 3: 建立貼文
$post = Invoke-RestMethod -Uri "http://localhost:3000/api/posts" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body '{"topic":"AI趨勢","keywords":["ChatGPT","自動化"],"targetTone":"專業","targetLength":400}'

# Step 4: 觸發內容生成
Invoke-RestMethod -Uri "http://localhost:3000/api/posts/$($post.id)/generate" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"}

# Step 5: 等待生成 (約 10-30 秒)
Start-Sleep -Seconds 20

# Step 6: 檢查狀態
$status = Invoke-RestMethod -Uri "http://localhost:3000/api/posts/$($post.id)" `
  -Headers @{Authorization="Bearer $token"}

Write-Host "狀態: $($status.status)"
Write-Host "內容: $($status.latestRevision.content)"

# Step 7: 如果是 PENDING_REVIEW,進行審核
# (實際場景會透過 LINE Bot 審核)

# Step 8: 核准貼文
Invoke-RestMethod -Uri "http://localhost:3000/api/review/approve" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"} `
  -ContentType "application/json" `
  -Body "{`"postId`":`"$($post.id)`",`"revisionId`":`"$($status.latestRevision.id)`",`"action`":`"approve`"}"

# Step 9: 發布到 Threads (需要先設定 Threads 帳號)
Invoke-RestMethod -Uri "http://localhost:3000/api/posts/$($post.id)/publish" `
  -Method POST `
  -Headers @{Authorization="Bearer $token"}
```

---

## 📊 監控儀表板 (可選)

如果需要圖形化監控,可以使用:

1. **BullMQ Board** (Queue 監控)
   ```bash
   npm install -g bull-board
   bull-board
   ```

2. **MySQL Workbench** (資料庫視覺化)

3. **Redis Commander** (Redis 視覺化)
   ```bash
   docker run -d -p 8081:8081 rediscommander/redis-commander
   # 開啟 http://localhost:8081
   ```

---

## 🐛 常見問題

### Q1: Token 過期怎麼辦?
A: 重新執行登入 API 取得新 Token

### Q2: 為什麼沒收到 LINE 通知?
A: 檢查 `users` 表的 `line_user_id` 是否正確

### Q3: 內容生成失敗?
A: 檢查 `logs/error.log` 和 AI API Key 設定

### Q4: 發布失敗?
A: 確認已設定 Threads 帳號和有效的 access token

---

## 📚 API 端點總覽

| 端點 | 方法 | 需認證 | 說明 |
|------|------|--------|------|
| `/api/health` | GET | ❌ | 健康檢查 |
| `/api/auth/login` | POST | ❌ | 登入 |
| `/api/posts` | GET | ✅ | 查詢貼文列表 |
| `/api/posts` | POST | ✅ | 建立貼文 |
| `/api/posts/:id` | GET | ✅ | 查詢單一貼文 |
| `/api/posts/:id` | PATCH | ✅ | 更新貼文 |
| `/api/posts/:id` | DELETE | ✅ | 刪除貼文 |
| `/api/posts/:id/generate` | POST | ✅ | 觸發內容生成 |
| `/api/posts/:id/publish` | POST | ✅ | 發布貼文 |
| `/api/review/approve` | POST | ✅ | 審核貼文 |
| `/api/line/webhook` | POST | ❌ | LINE Webhook (由 LINE 呼叫) |
| `/api/threads/oauth/callback` | GET | ❌ | Threads OAuth Callback |

---

## 🎉 開始測試!

建議測試順序:

1. ✅ 健康檢查
2. ✅ 登入取得 Token
3. ✅ 建立貼文
4. ✅ 查詢貼文
5. ✅ 觸發生成 (如果有 AI API Key)
6. ✅ 查看日誌檔案
7. ✅ 查看資料庫資料

祝測試順利! 🚀
