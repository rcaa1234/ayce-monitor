# 系統架構文件

## 系統架構概覽

\`\`\`
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面層                              │
├─────────────────────────────────────────────────────────────────┤
│  Admin Web (未來)  │  LINE Bot  │  Threads  │  REST API Client │
└──────────┬──────────┴─────┬──────┴─────┬─────┴──────────┬───────┘
           │                │            │                │
           ▼                ▼            ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Server (Express)                     │
├─────────────────────────────────────────────────────────────────┤
│  Controllers  │  Middlewares  │  Routes  │  Services           │
├─────────────────────────────────────────────────────────────────┤
│  • Post       │  • Auth       │  • /api  │  • AI Service       │
│  • Review     │  • RBAC       │  • /webhook│ • Content Service│
│               │               │          │  • LINE Service     │
│               │               │          │  • Threads Service  │
│               │               │          │  • Queue Service    │
└───────────────┴───────────────┴──────────┴─────────────┬────────┘
                                                          │
                    ┌─────────────────────────────────────┤
                    ▼                                     ▼
        ┌────────────────────────┐          ┌─────────────────────┐
        │   Redis (BullMQ)       │          │   MySQL Database    │
        ├────────────────────────┤          ├─────────────────────┤
        │ • Generate Queue       │          │ • users             │
        │ • Publish Queue        │          │ • posts             │
        │ • Token Refresh Queue  │          │ • post_revisions    │
        └────────────┬───────────┘          │ • review_requests   │
                     │                      │ • threads_accounts  │
                     │                      │ • audit_logs        │
                     │                      └─────────────────────┘
                     ▼
        ┌────────────────────────┐
        │   Workers (BullMQ)     │
        ├────────────────────────┤
        │ • Generate Worker      │◄─────┐
        │ • Publish Worker       │      │
        │ • Token Refresh Worker │      │
        └────────────┬───────────┘      │
                     │                   │
        ┌────────────┴───────────┐      │
        │   Cron Schedulers      │──────┘
        ├────────────────────────┤
        │ • Daily Generation     │
        │ • Review Reminders     │
        │ • Token Refresh Check  │
        │ • Expired Reviews      │
        └────────────────────────┘
                     │
        ┌────────────┴───────────────────────────────┐
        │         External Services                   │
        ├─────────────────────────────────────────────┤
        │ • OpenAI (GPT-5.2)                         │
        │ • Google Generative AI (Gemini 3)         │
        │ • LINE Messaging API                       │
        │ • Threads API (Meta)                       │
        └─────────────────────────────────────────────┘
\`\`\`

## 資料流程圖

### 1. 內容產生流程

\`\`\`
觸發產文
  │
  ├─► API Request / Cron Schedule
  │
  ▼
建立 Post (DRAFT)
  │
  ├─► 寫入 MySQL posts 表
  │
  ▼
加入產文佇列
  │
  ├─► BullMQ: Generate Queue
  │
  ▼
Generate Worker 處理
  │
  ├─► 1. GPT-5.2 產生內容
  │   └─► 失敗 → Gemini 3 備援
  │
  ├─► 2. 生成 Embedding
  │   └─► OpenAI text-embedding-3-small
  │
  ├─► 3. 相似度檢查
  │   ├─► 查詢最近 60 篇 embeddings
  │   ├─► 計算 cosine similarity
  │   └─► > 0.86 → 重試 (最多 3 次)
  │
  ├─► 4. 建立 Revision
  │   └─► 寫入 post_revisions 表
  │
  ├─► 5. 儲存 Embedding
  │   └─► 寫入 post_embeddings 表
  │
  ▼
更新狀態: PENDING_REVIEW
  │
  ▼
發送 LINE 審稿通知
  │
  ├─► 建立 review_request
  ├─► 生成一次性 token
  └─► 推送 Flex Message
\`\`\`

### 2. LINE 審稿流程

\`\`\`
審稿者收到 LINE 通知
  │
  ├─► Flex Message 顯示內容預覽
  │
  ▼
選擇操作
  │
  ├─► ✅ Approve
  │   │
  │   ├─► 驗證 token + LINE user ID
  │   ├─► 標記 review_request 為 USED
  │   ├─► 更新 post 狀態: APPROVED
  │   ├─► 加入發文佇列
  │   └─► 寫入 audit_logs
  │
  ├─► ↻ Regenerate
  │   │
  │   ├─► 驗證 token + LINE user ID
  │   ├─► 標記 review_request 為 USED
  │   ├─► 觸發新的產文任務
  │   └─► 寫入 audit_logs
  │
  └─► ⊘ Skip
      │
      ├─► 驗證 token + LINE user ID
      ├─► 標記 review_request 為 USED
      ├─► 更新 post 狀態: SKIPPED
      └─► 寫入 audit_logs
\`\`\`

### 3. Threads 發文流程

\`\`\`
發文佇列
  │
  ├─► BullMQ: Publish Queue
  │
  ▼
Publish Worker 處理
  │
  ├─► 1. 檢查 post 狀態
  │   └─► 防止重複發文 (PUBLISHING 鎖)
  │
  ├─► 2. 更新狀態: PUBLISHING
  │
  ├─► 3. 取得 Threads 帳號
  │   ├─► 查詢預設帳號 (is_default = 1)
  │   └─► 解密 access_token
  │
  ├─► 4. 呼叫 Threads API
  │   ├─► Step 1: Create Media Container
  │   │   POST /{user_id}/threads
  │   │   { media_type: "TEXT", text: content }
  │   │
  │   ├─► Step 2: Publish Container
  │   │   POST /{user_id}/threads_publish
  │   │   { creation_id: container_id }
  │   │
  │   └─► Step 3: Get Permalink
  │       GET /{post_id}?fields=permalink
  │
  ├─► 5. 更新 post
  │   ├─► 狀態: POSTED
  │   ├─► posted_at: NOW()
  │   └─► post_url: permalink
  │
  └─► 6. 記錄 audit_log
      └─► action: post_published
\`\`\`

### 4. Token 自動刷新流程

\`\`\`
Cron Scheduler (每 6 小時)
  │
  ▼
檢查需要刷新的 Token
  │
  ├─► 條件:
  │   • expires_at < NOW() + 7 days
  │   • last_refreshed_at < NOW() - 24 hours
  │   • status = 'OK'
  │
  ▼
加入刷新佇列
  │
  ├─► BullMQ: Token Refresh Queue
  │
  ▼
Token Refresh Worker
  │
  ├─► 1. 取得當前 token (解密)
  │
  ├─► 2. 呼叫 Threads API
  │   └─► GET /refresh_access_token
  │       ?grant_type=th_refresh_token
  │       &access_token={token}
  │
  ├─► 3. 更新資料庫
  │   ├─► 加密新 token
  │   ├─► 更新 expires_at
  │   ├─► 更新 last_refreshed_at
  │   └─► status = 'OK'
  │
  ├─► 4. 失敗處理
  │   ├─► status = 'ACTION_REQUIRED'
  │   └─► 通知管理員 (LINE)
  │
  └─► 5. 記錄 audit_log
\`\`\`

## 模組職責說明

### API Server 層

#### Controllers
- **PostController**: 處理貼文相關 API 請求
- **ReviewController**: 處理 LINE 審稿回調

#### Middlewares
- **auth.middleware**: JWT 認證與授權
- **RBAC**: 角色權限檢查

#### Services
- **AIService**: AI 引擎整合 (GPT + Gemini)
- **ContentService**: 產文邏輯 + 相似度檢查
- **LINEService**: LINE Bot 訊息推送
- **ThreadsService**: Threads API 操作
- **QueueService**: 任務佇列管理

### Data 層

#### Models
- **UserModel**: 使用者 CRUD
- **PostModel**: 貼文 + Revision CRUD
- **EmbeddingModel**: Embedding 管理
- **AuditModel**: 審計日誌

### Worker 層

#### Workers
- **GenerateWorker**: 處理產文任務
- **PublishWorker**: 處理發文任務
- **TokenRefreshWorker**: 處理 token 刷新

### Scheduler 層

#### Cron Jobs
- **dailyGeneration**: 每日自動產文
- **checkExpiredReviews**: 清理過期審稿
- **tokenRefreshCheck**: 檢查需刷新的 token
- **dailyReviewReminder**: 審稿提醒

## 安全機制

### 1. 認證授權
\`\`\`
API Request
  │
  ▼
JWT Token 驗證
  │
  ├─► 解析 token
  ├─► 檢查簽章
  └─► 驗證有效期
  │
  ▼
載入使用者資料
  │
  ├─► 查詢 users 表
  ├─► 檢查 status = ACTIVE
  └─► 載入角色清單
  │
  ▼
RBAC 權限檢查
  │
  ├─► 檢查所需角色
  └─► admin 角色有全部權限
  │
  ▼
執行業務邏輯
\`\`\`

### 2. 資料加密
\`\`\`
Threads Access Token
  │
  ├─► AES 加密 (crypto-js)
  ├─► 使用 ENCRYPTION_KEY
  └─► 儲存到 threads_auth 表
  │
取用時
  │
  ├─► 從資料庫讀取
  ├─► AES 解密
  └─► 在記憶體中使用 (不記錄日誌)
\`\`\`

### 3. 審稿 Token
\`\`\`
建立 Review Request
  │
  ├─► crypto.randomBytes(64)
  ├─► 轉為 hex (128 字元)
  ├─► 一次性使用
  └─► 24 小時過期
  │
驗證時
  │
  ├─► 檢查 token 存在
  ├─► 檢查 status = PENDING
  ├─► 檢查未過期
  ├─► 驗證 LINE user ID 匹配
  └─► 使用後標記 USED
\`\`\`

### 4. 防止重複發文
\`\`\`
發文前
  │
  ├─► 檢查 post.status
  ├─► 若為 PUBLISHING → 拒絕
  ├─► 若為 POSTED → 拒絕
  └─► 設定為 PUBLISHING (作為鎖)
  │
發文完成
  │
  └─► 更新為 POSTED (釋放鎖)
\`\`\`

## 錯誤處理策略

### 1. 產文錯誤
\`\`\`
GPT 產文失敗
  │
  ├─► 重試 3 次
  │   └─► 仍失敗
  │       └─► 切換 Gemini
  │           └─► 仍失敗
  │               └─► 狀態: FAILED
  │                   └─► 記錄錯誤
\`\`\`

### 2. 發文錯誤
\`\`\`
Threads API 失敗
  │
  ├─► 分類錯誤碼
  │   ├─► TOKEN_EXPIRED
  │   ├─► PERMISSION_ERROR
  │   ├─► RATE_LIMIT
  │   ├─► NETWORK_ERROR
  │   └─► UNKNOWN_ERROR
  │
  ├─► 記錄到 post
  │   ├─► last_error_code
  │   └─► last_error_message
  │
  ├─► 更新狀態: FAILED
  │
  └─► Worker 自動重試 (最多 3 次)
\`\`\`

### 3. Token 刷新錯誤
\`\`\`
Token 刷新失敗
  │
  ├─► 更新 status: ACTION_REQUIRED
  ├─► 記錄 audit_log
  └─► 通知管理員 (LINE)
\`\`\`

## 擴展性設計

### 水平擴展
- API Server: 無狀態,可多實例部署
- Worker: 支援多實例並行處理
- Redis: 可使用 cluster 模式
- MySQL: 支援 read replica

### 垂直擴展
- 增加 Worker concurrency
- 調整 Queue limiter
- 優化資料庫查詢

### 功能擴展
- 新增 Worker 類型
- 新增 Cron 任務
- 新增 API 端點
- 新增 AI 引擎

## 監控指標

### 系統健康
- API 回應時間
- Worker 處理速度
- Queue 長度
- 錯誤率

### 業務指標
- 每日產文數
- 審稿通過率
- 發文成功率
- Token 刷新成功率

### 資源使用
- CPU 使用率
- 記憶體使用
- 資料庫連線數
- Redis 記憶體

## 部署架構

### 本機開發
\`\`\`
localhost:3000 (API Server)
localhost:6379 (Redis)
localhost:3306 (MySQL)
\`\`\`

### Zeabur 生產環境
\`\`\`
┌──────────────────────┐
│  threads-api         │ (Zeabur Service 1)
│  Port: 3000          │
│  CMD: npm start      │
└──────────────────────┘

┌──────────────────────┐
│  threads-worker      │ (Zeabur Service 2)
│  CMD: node dist/worker.js │
└──────────────────────┘

┌──────────────────────┐
│  MySQL 8.0           │ (Zeabur Database)
└──────────────────────┘

┌──────────────────────┐
│  Redis 6.0+          │ (Zeabur Cache)
└──────────────────────┘
\`\`\`

---

**文件版本**: 1.0
**最後更新**: 2024
