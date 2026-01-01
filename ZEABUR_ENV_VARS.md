# Zeabur 環境變數設定清單

## ⚠️ 重要提醒
在 Zeabur 的 threads-bot 服務 → Variables 標籤中新增以下環境變數。
新增完成後**必須點擊右上角 Redeploy** 才會生效！

---

## 📋 必須新增的環境變數

### 1. 應用程式設定
```
APP_ENV=production
```

### 2. MySQL 資料庫名稱
```
MYSQL_DATABASE=zeabur
```
⚠️ **重要**：Zeabur 自動生成的資料庫名稱是 `zeabur`，不是預設的 `threads_posting`

### 3. OpenAI API Key
```
OPENAI_API_KEY=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
```

### 4. Gemini API Key
```
GEMINI_API_KEY=AIzaSyCmhWHgQwih_ujeUp0n0OaV41Tg83hNhfU
```

### 5. LINE Bot Token
```
LINE_CHANNEL_ACCESS_TOKEN=xc+OfQsSHoba5eetxcfq/EJu/ONYuppuchZA6Fl43ewCv6k6G3Ze08qXvxE+BBsdbBnroNCbNw3642vTeKqrIbBjLF7KwGlZKcHghnU9or7y1wSfhPpLdGWFuC+sa8LQnGtZOLOUrID283b8m6A9sQdB04t89/1O/w1cDnyilFU=
```

### 6. LINE Bot Secret
```
LINE_CHANNEL_SECRET=e941620bec50333617097ee78109b276
```

### 7. JWT Secret
```
JWT_SECRET=vLgQTlrhmglbeTVqQqqrAv5Lh0sBJgqIcbyCqot/JH8=
```

### 8. Encryption Key
```
ENCRYPTION_KEY=xEkE9mxAk5bBToNwljH71AV9Fly2627ZAet49sbzWP4=
```

### 9. Threads Client ID
```
THREADS_CLIENT_ID=1451334755998289
```

### 10. Threads Client Secret
```
THREADS_CLIENT_SECRET=9b1ec34716790fbdb6a6738d26fc70cb
```

---

## 🌐 部署後需要更新的環境變數

這兩個變數需要等 Zeabur 部署完成並取得域名後才能設定：

### 取得 Zeabur 域名
1. 進入 threads-bot 服務
2. 切換到 **Domains**（域名）標籤
3. 複製 Zeabur 自動分配的域名（例如：`threads-bot-xxx.zeabur.app`）

### 設定域名相關環境變數
```
APP_BASE_URL=https://你的zeabur域名
THREADS_REDIRECT_URI=https://你的zeabur域名/api/threads/oauth/callback
```

例如：
```
APP_BASE_URL=https://threads-bot-abc123.zeabur.app
THREADS_REDIRECT_URI=https://threads-bot-abc123.zeabur.app/api/threads/oauth/callback
```

---

## ✅ 已自動設定的環境變數（無需手動新增）

以下變數由 Zeabur 自動生成，程式碼會自動讀取：

- ✅ `REDIS_CONNECTION_STRING` → 程式自動讀取
- ✅ `REDIS_URI` → 程式自動讀取
- ✅ `REDIS_HOST` → 程式自動讀取
- ✅ `REDIS_PORT` → 程式自動讀取
- ✅ `REDIS_PASSWORD` → 程式自動讀取
- ✅ `MYSQL_HOST` → 程式自動讀取
- ✅ `MYSQL_PORT` → 程式自動讀取
- ✅ `MYSQL_USERNAME` → 程式自動讀取
- ✅ `MYSQL_PASSWORD` → 程式自動讀取
- ✅ `PORT` → 程式自動讀取

---

## 🔄 設定完成後的步驟

1. **儲存環境變數**
2. **點擊 Redeploy**（重新部署）
3. **等待 3-5 分鐘**讓部署完成
4. **查看 Logs**（日誌）確認是否成功啟動
5. **取得域名**並更新 `APP_BASE_URL` 和 `THREADS_REDIRECT_URI`
6. **再次 Redeploy**

---

## 🆘 常見問題

### Q: 為什麼 Worker 一直顯示 ECONNRESET？
A: 可能是：
1. MYSQL_DATABASE 沒有設定為 `zeabur`
2. 缺少必要的 API Keys
3. Redis 連接配置問題

### Q: 如何確認環境變數已生效？
A: 查看部署日誌，應該會看到 "Configuration warnings" 列出缺少的環境變數

### Q: 部署成功後如何測試？
A: 訪問 `https://你的域名/health` 應該會返回 `{"status":"ok"}`
