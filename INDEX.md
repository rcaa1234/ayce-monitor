# Threads 半自動發文系統 - 文件索引

歡迎使用 Threads 半自動發文系統!本系統已完整實作並可立即部署使用。

---

## 📚 文件導覽

### 🚀 新手入門 (按順序閱讀)

1. **[README.md](README.md)** - 從這裡開始!
   - 系統概述與功能特色
   - 技術棧介紹
   - 主要流程說明
   - API 端點列表

2. **[QUICKSTART.md](QUICKSTART.md)** - 5 分鐘快速開始
   - 最小化設定步驟
   - 快速測試指引
   - 常見問題解決

3. **[SETUP.md](SETUP.md)** - 完整設置指南
   - 詳細安裝步驟
   - 外部服務設定 (OpenAI, Gemini, LINE, Threads)
   - 本機開發環境
   - Zeabur 生產部署
   - 疑難排解

### 📖 深入理解

4. **[ARCHITECTURE.md](ARCHITECTURE.md)** - 系統架構
   - 架構概覽圖
   - 資料流程圖
   - 模組職責說明
   - 安全機制
   - 擴展性設計

5. **[PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)** - 專案總結
   - 已實作功能清單
   - 資料庫 schema
   - 技術亮點
   - 程式碼統計
   - 擴充建議

### 🔧 日常使用

6. **[CHEATSHEET.md](CHEATSHEET.md)** - 速查表
   - 常用指令
   - SQL 查詢範例
   - API 端點速查
   - 除錯技巧
   - 環境變數參考

### 📊 專案管理

7. **[COMPLETION_REPORT.md](COMPLETION_REPORT.md)** - 完工報告
   - 專案達成狀態
   - 交付物清單
   - 驗收標準
   - 程式碼統計

---

## 🗂️ 專案結構

\`\`\`
threads-bot/
├── 📄 文件 (8 個 Markdown 文件)
│   ├── README.md              # 系統概述
│   ├── QUICKSTART.md          # 快速開始
│   ├── SETUP.md               # 設置指南
│   ├── ARCHITECTURE.md        # 系統架構
│   ├── PROJECT_SUMMARY.md     # 專案總結
│   ├── CHEATSHEET.md          # 速查表
│   ├── COMPLETION_REPORT.md   # 完工報告
│   └── INDEX.md               # 本文件
│
├── ⚙️ 配置檔案
│   ├── package.json           # NPM 配置
│   ├── tsconfig.json          # TypeScript 配置
│   ├── .eslintrc.json         # ESLint 配置
│   ├── .env.example           # 環境變數範例
│   └── .gitignore             # Git 忽略
│
└── 💻 原始碼 (src/)
    ├── config/                # 環境配置
    ├── database/              # 資料庫 (connection, migrate, seed)
    ├── models/                # 資料模型 (User, Post, Embedding, Audit)
    ├── services/              # 服務層 (AI, Content, LINE, Threads, Queue)
    ├── controllers/           # 控制器 (Post, Review)
    ├── routes/                # 路由定義
    ├── middlewares/           # 中介層 (Auth)
    ├── workers/               # 背景任務 (Generate, Publish, TokenRefresh)
    ├── cron/                  # 排程任務
    ├── utils/                 # 工具函數 (Encryption, Logger, Similarity, UUID)
    ├── types/                 # TypeScript 型別
    ├── index.ts               # API Server 入口
    └── worker.ts              # Worker 入口
\`\`\`

---

## 🎯 依使用情境選擇文件

### 情境 1: 我是第一次使用
👉 閱讀順序:
1. [README.md](README.md) - 了解系統
2. [QUICKSTART.md](QUICKSTART.md) - 快速測試
3. [SETUP.md](SETUP.md) - 完整設置

### 情境 2: 我要部署到生產環境
👉 閱讀順序:
1. [SETUP.md](SETUP.md) - 完整設置指南
2. [CHEATSHEET.md](CHEATSHEET.md) - 環境變數與指令
3. [ARCHITECTURE.md](ARCHITECTURE.md) - 理解架構

### 情境 3: 我要理解系統架構
👉 閱讀順序:
1. [ARCHITECTURE.md](ARCHITECTURE.md) - 系統架構
2. [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - 專案總結
3. 程式碼 (src/) - 實作細節

### 情境 4: 我要擴充功能
👉 閱讀順序:
1. [ARCHITECTURE.md](ARCHITECTURE.md) - 理解架構
2. [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) - 擴充建議
3. 相關程式碼模組

### 情境 5: 遇到問題需要除錯
👉 參考:
1. [CHEATSHEET.md](CHEATSHEET.md) - 除錯技巧
2. [SETUP.md](SETUP.md) - 疑難排解
3. logs/ 目錄 - 查看日誌

### 情境 6: 日常使用與維護
👉 參考:
1. [CHEATSHEET.md](CHEATSHEET.md) - 常用指令速查
2. logs/ - 監控日誌

---

## 🔑 關鍵功能快速連結

### 產文系統
- 雙引擎實作: [src/services/ai.service.ts](src/services/ai.service.ts)
- 內容生成: [src/services/content.service.ts](src/services/content.service.ts)
- 相似度計算: [src/utils/similarity.ts](src/utils/similarity.ts)

### 審稿系統
- LINE 服務: [src/services/line.service.ts](src/services/line.service.ts)
- 審稿控制器: [src/controllers/review.controller.ts](src/controllers/review.controller.ts)

### 發文系統
- Threads 服務: [src/services/threads.service.ts](src/services/threads.service.ts)
- 發文 Worker: [src/workers/publish.worker.ts](src/workers/publish.worker.ts)

### 排程系統
- Cron 排程: [src/cron/scheduler.ts](src/cron/scheduler.ts)
- Token 刷新: [src/workers/token-refresh.worker.ts](src/workers/token-refresh.worker.ts)

### 資料庫
- Schema Migration: [src/database/migrate.ts](src/database/migrate.ts)
- 種子資料: [src/database/seed.ts](src/database/seed.ts)

---

## 📊 專案數據

### 程式碼統計
- **總檔案數**: 38 個
- **TypeScript 程式碼**: ~3,675 行
- **文件**: ~3,500 行
- **資料表**: 11 個

### 核心模組
- **Models**: 4 個
- **Services**: 5 個
- **Controllers**: 2 個
- **Workers**: 3 個
- **Cron Jobs**: 4 個

### 文件完整度
- **完整文件**: 8 份
- **總文件大小**: ~50KB
- **程式碼註解**: ✅ 完整

---

## 🚀 快速指令參考

\`\`\`bash
# 初始化
npm install
npm run setup

# 開發
npm run dev      # API Server
npm run worker   # Background Worker

# 生產
npm run build
npm start        # API Server
node dist/worker.js  # Worker

# 資料庫
npm run migrate  # 執行 migration
npm run seed     # 種子資料

# 工具
npm run lint     # 程式碼檢查
\`\`\`

---

## 🆘 獲得幫助

### 文件內容
- 基本概念 → [README.md](README.md)
- 快速開始 → [QUICKSTART.md](QUICKSTART.md)
- 完整設置 → [SETUP.md](SETUP.md)
- 系統架構 → [ARCHITECTURE.md](ARCHITECTURE.md)
- 日常使用 → [CHEATSHEET.md](CHEATSHEET.md)

### 常見問題
查看 [SETUP.md](SETUP.md) 的「疑難排解」章節

### 日誌檢查
\`\`\`bash
tail -f logs/all.log    # 所有日誌
tail -f logs/error.log  # 錯誤日誌
\`\`\`

### 聯絡支援
- GitHub Issues
- 電子郵件

---

## ✅ 檢查清單

### 初次設置
- [ ] 安裝 Node.js 18+
- [ ] 安裝 MySQL 8.0+
- [ ] 安裝 Redis
- [ ] 複製 .env.example 為 .env.local
- [ ] 填寫必要環境變數
- [ ] 執行 npm install
- [ ] 執行 npm run setup
- [ ] 啟動服務測試

### 生產部署
- [ ] 準備生產環境的環境變數
- [ ] 設定 MySQL 和 Redis 服務
- [ ] 執行 migration
- [ ] 部署 API Service
- [ ] 部署 Worker Service
- [ ] 設定 LINE Webhook URL
- [ ] 設定 Threads OAuth Redirect URI
- [ ] 測試健康檢查端點
- [ ] 監控日誌

---

## 🎓 學習路徑

### 第 1 天: 基礎認識
- [ ] 閱讀 README.md
- [ ] 執行 QUICKSTART.md
- [ ] 理解系統概念

### 第 2 天: 深入理解
- [ ] 閱讀 ARCHITECTURE.md
- [ ] 理解資料流程
- [ ] 查看程式碼結構

### 第 3 天: 實際操作
- [ ] 完整設置環境
- [ ] 測試產文流程
- [ ] 測試審稿流程
- [ ] 測試發文流程

### 第 4-5 天: 進階使用
- [ ] 自訂產文風格
- [ ] 設定 Threads 帳號
- [ ] 配置 LINE Bot
- [ ] 監控與維護

---

## 📌 重要提醒

### 安全性
- ⚠️ 絕不將 .env.local 提交到 git
- ⚠️ 使用強密碼作為 ENCRYPTION_KEY 和 JWT_SECRET
- ⚠️ 定期更新依賴套件
- ⚠️ 生產環境使用 HTTPS

### 維護
- 📅 定期備份資料庫
- 📅 監控日誌檔案大小
- 📅 檢查 Redis 記憶體使用
- 📅 監控 Threads Token 狀態

### 效能
- 🎯 調整 Worker concurrency
- 🎯 設定適當的 Queue limiter
- 🎯 優化資料庫查詢
- 🎯 監控 API 回應時間

---

## 🎉 開始使用

準備好了嗎?從這裡開始:

1. **完全新手** → [QUICKSTART.md](QUICKSTART.md)
2. **需要完整設置** → [SETUP.md](SETUP.md)
3. **想理解架構** → [ARCHITECTURE.md](ARCHITECTURE.md)
4. **日常使用** → [CHEATSHEET.md](CHEATSHEET.md)

---

**祝您使用愉快!** 🚀

如有任何問題,請參考相關文件或聯絡支援。

---

**文件版本**: 1.0
**最後更新**: 2024
