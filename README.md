# Threads 半自動發文系統

一套具備人工審稿機制的 Threads 半自動發文平台,支援 AI 產文、相似度檢查、LINE 審稿流程及 Threads 官方 API 發文。

## 系統特色

- ✅ **雙引擎 AI 產文**: ChatGPT 5.2 主引擎 + Gemini 3 備援
- ✅ **智慧相似度檢查**: 自動比對最近 60 篇內容,避免重複
- ✅ **LINE 審稿流程**: Flex Message 互動式審稿
- ✅ **Threads 官方 API**: 合規發文,支援 Token 自動刷新
- ✅ **多帳號管理**: 支援多個 Threads 帳號
- ✅ **完整審計日誌**: 所有操作可追蹤
- ✅ **任務佇列系統**: Redis + BullMQ 高可靠性
- ✅ **自動排程**: 每日產文、審稿提醒、Token 刷新

## 技術棧

- **Backend**: Node.js + TypeScript + Express
- **Database**: MySQL 8.0
- **Cache/Queue**: Redis + BullMQ
- **AI**: OpenAI API (GPT) + Google Generative AI (Gemini)
- **發文**: Threads Official API
- **通知**: LINE Messaging API

## 專案結構

\`\`\`
threads-bot/
├── src/
│   ├── config/           # 環境配置
│   ├── database/         # 資料庫連接與 migration
│   ├── models/           # 資料模型
│   ├── services/         # 業務邏輯服務
│   ├── controllers/      # API 控制器
│   ├── routes/           # API 路由
│   ├── workers/          # 背景任務 Worker
│   ├── middlewares/      # Express 中介層
│   ├── cron/             # 排程任務
│   ├── utils/            # 工具函數
│   ├── types/            # TypeScript 型別定義
│   ├── index.ts          # API Server 入口
│   └── worker.ts         # Worker 入口
├── package.json
├── tsconfig.json
└── .env.example
\`\`\`

## 安裝與設定

### 1. 安裝依賴

\`\`\`bash
npm install
\`\`\`

### 2. 環境變數設定

複製 \`.env.example\` 為 \`.env.local\`:

\`\`\`bash
cp .env.example .env.local
\`\`\`

編輯 \`.env.local\` 並填入必要的設定:

\`\`\`env
APP_ENV=local
APP_BASE_URL=http://localhost:3000
APP_PORT=3000

MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=threads_posting

REDIS_URL=redis://localhost:6379

OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...

JWT_SECRET=your_jwt_secret_key
ENCRYPTION_KEY=your_32_character_encryption_key
\`\`\`

### 3. 資料庫初始化

\`\`\`bash
npm run migrate
\`\`\`

### 4. 啟動服務

需要同時啟動 API Server 和 Worker:

**終端機 1 - API Server:**
\`\`\`bash
npm run dev
\`\`\`

**終端機 2 - Worker:**
\`\`\`bash
npm run worker
\`\`\`

## 主要功能流程

### 1. 內容產生流程

1. 系統觸發產文 (手動或排程)
2. Worker 使用 GPT 5.2 產生內容
3. 自動計算 embedding 並比對相似度
4. 相似度 > 0.86 → 重試最多 3 次
5. 仍超標 → 切換 Gemini 3
6. 產生成功 → 建立 revision 並更新狀態為 PENDING_REVIEW

### 2. LINE 審稿流程

1. 產文完成後自動推送 Flex Message 至審稿者 LINE
2. 審稿者可選擇:
   - ✅ **確認發文**: 進入發文佇列
   - ↻ **重新產出**: 重新觸發產文
   - ⊘ **略過**: 標記為 SKIPPED
3. 操作使用一次性 token,確保安全性

### 3. Threads 發文流程

1. 審稿者確認後,post 進入 PUBLISHING 狀態
2. Worker 取得預設 Threads 帳號的 access token
3. 呼叫 Threads API 建立並發佈貼文
4. 成功 → POSTED,記錄 post URL
5. 失敗 → FAILED,記錄錯誤訊息

### 4. Token 自動刷新

1. 排程每 6 小時檢查 token 狀態
2. 到期前 7 天且距上次刷新超過 24 小時
3. 自動呼叫 Threads API refresh endpoint
4. 更新加密 token 與到期時間
5. 失效 → 標記 ACTION_REQUIRED,通知管理員

## API 端點

### Posts

- `POST /api/posts` - 建立新貼文並觸發產文
- `GET /api/posts/:id` - 取得貼文詳情
- `GET /api/posts/status/:status` - 依狀態查詢貼文
- `POST /api/posts/:id/approve` - 手動核准貼文
- `POST /api/posts/:id/skip` - 略過貼文

### Review (LINE Webhook)

- `GET /api/review/approve?token=xxx` - 核准發文
- `GET /api/review/regenerate?token=xxx` - 重新產生
- `GET /api/review/skip?token=xxx` - 略過

## 資料庫 Schema

詳細 schema 請參考 \`src/database/migrate.ts\`

主要資料表:
- \`users\` - 使用者
- \`roles\` - 角色
- \`posts\` - 貼文主體
- \`post_revisions\` - 貼文版本
- \`review_requests\` - 審稿請求
- \`threads_accounts\` - Threads 帳號
- \`threads_auth\` - Threads 授權 token
- \`post_embeddings\` - 內容 embedding
- \`jobs\` - 任務記錄
- \`audit_logs\` - 審計日誌

## 部署至 Zeabur

1. 將程式碼推送至 Git repository
2. 在 Zeabur 建立新專案
3. 新增 MySQL 和 Redis 服務
4. 設定環境變數 (與 .env.local 相同內容)
5. 部署兩個服務:
   - **API Service**: 執行 \`npm start\`
   - **Worker Service**: 執行 \`npm run worker\`

## 開發指令

\`\`\`bash
npm run dev        # 開發模式啟動 API Server
npm run worker     # 啟動 Worker
npm run build      # 編譯 TypeScript
npm start          # 生產模式啟動 API Server
npm run migrate    # 執行資料庫 migration
npm run lint       # 程式碼檢查
npm test           # 執行測試
\`\`\`

## 安全性

- ✅ Threads access token 使用 AES 加密儲存
- ✅ 審稿 token 使用 crypto.randomBytes 產生
- ✅ JWT 認證保護 API 端點
- ✅ LINE webhook 簽章驗證
- ✅ 防止重複發文 (PUBLISHING 鎖定機制)
- ✅ 所有操作記錄審計日誌

## 注意事項

1. **OpenAI API Key**: 需要有效的 API key 並確保有足夠額度
2. **Gemini API Key**: 作為備援引擎
3. **LINE Bot**: 需要建立 LINE Bot 並取得 Channel Access Token
4. **Threads API**: 需要透過 Meta 開發者平台申請並完成 OAuth 流程
5. **Encryption Key**: 必須為 32 字元以上的強密碼

## 授權

MIT License

## 作者

Built with ❤️ for automated Threads content management
