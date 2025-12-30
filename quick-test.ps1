# Threads 半自動發文系統 - 快速測試腳本
# 使用方式: powershell -ExecutionPolicy Bypass -File quick-test.ps1

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Threads 半自動發文系統 - 快速測試" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:3000/api"

# 測試 1: 健康檢查
Write-Host "[1/6] 測試健康檢查端點..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET
    Write-Host "✓ 健康檢查成功" -ForegroundColor Green
    Write-Host "  - 狀態: $($health.status)" -ForegroundColor Gray
    Write-Host "  - 時間: $($health.timestamp)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ 健康檢查失敗!" -ForegroundColor Red
    Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  請確認 API Server 是否運行在 http://localhost:3000" -ForegroundColor Red
    exit 1
}

# 測試 2: 登入
Write-Host "[2/6] 測試登入功能..." -ForegroundColor Yellow
try {
    $loginData = @{
        email = "admin@example.com"
        password = "admin123"
    } | ConvertTo-Json

    $authResponse = Invoke-RestMethod -Uri "$baseUrl/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginData

    $token = $authResponse.token
    Write-Host "✓ 登入成功" -ForegroundColor Green
    Write-Host "  - 使用者: $($authResponse.user.name) ($($authResponse.user.email))" -ForegroundColor Gray
    Write-Host "  - 角色: $($authResponse.user.roles -join ', ')" -ForegroundColor Gray
    Write-Host "  - Token: $($token.Substring(0, 20))..." -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ 登入失敗!" -ForegroundColor Red
    Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  請確認資料庫已執行 migration 和 seed" -ForegroundColor Red
    exit 1
}

# 測試 3: 建立貼文
Write-Host "[3/6] 測試建立貼文..." -ForegroundColor Yellow
try {
    $postData = @{
        topic = "AI 人工智慧測試主題"
        keywords = @("AI", "測試", "自動化")
        targetTone = "專業但易懂"
        targetLength = 400
        scheduledFor = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json

    $headers = @{
        Authorization = "Bearer $token"
    }

    $post = Invoke-RestMethod -Uri "$baseUrl/posts" `
        -Method POST `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $postData

    $postId = $post.id
    Write-Host "✓ 建立貼文成功" -ForegroundColor Green
    Write-Host "  - 貼文 ID: $postId" -ForegroundColor Gray
    Write-Host "  - 主題: $($post.topic)" -ForegroundColor Gray
    Write-Host "  - 狀態: $($post.status)" -ForegroundColor Gray
    Write-Host "  - 建立時間: $($post.createdAt)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ 建立貼文失敗!" -ForegroundColor Red
    Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 測試 4: 查詢貼文
Write-Host "[4/6] 測試查詢貼文..." -ForegroundColor Yellow
try {
    $postDetail = Invoke-RestMethod -Uri "$baseUrl/posts/$postId" `
        -Method GET `
        -Headers $headers

    Write-Host "✓ 查詢貼文成功" -ForegroundColor Green
    Write-Host "  - 貼文 ID: $($postDetail.id)" -ForegroundColor Gray
    Write-Host "  - 主題: $($postDetail.topic)" -ForegroundColor Gray
    Write-Host "  - 狀態: $($postDetail.status)" -ForegroundColor Gray
    Write-Host "  - 關鍵字: $($postDetail.keywords -join ', ')" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ 查詢貼文失敗!" -ForegroundColor Red
    Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
}

# 測試 5: 查詢貼文列表
Write-Host "[5/6] 測試查詢貼文列表..." -ForegroundColor Yellow
try {
    $postsList = Invoke-RestMethod -Uri "$baseUrl/posts?status=DRAFT&limit=5" `
        -Method GET `
        -Headers $headers

    Write-Host "✓ 查詢列表成功" -ForegroundColor Green
    Write-Host "  - 總數: $($postsList.total)" -ForegroundColor Gray
    Write-Host "  - 本頁數量: $($postsList.data.Count)" -ForegroundColor Gray
    Write-Host "  - 頁碼: $($postsList.pagination.page)/$($postsList.pagination.totalPages)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ 查詢列表失敗!" -ForegroundColor Red
    Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
}

# 測試 6: 觸發內容生成 (可選)
Write-Host "[6/6] 測試觸發內容生成 (可選)..." -ForegroundColor Yellow
Write-Host "⚠️  此步驟需要設定 AI API Key (OpenAI 或 Gemini)" -ForegroundColor Yellow

$userChoice = Read-Host "是否要測試內容生成? (y/N)"
if ($userChoice -eq 'y' -or $userChoice -eq 'Y') {
    try {
        $generateResponse = Invoke-RestMethod -Uri "$baseUrl/posts/$postId/generate" `
            -Method POST `
            -Headers $headers

        Write-Host "✓ 內容生成任務已加入 Queue" -ForegroundColor Green
        Write-Host "  - 任務 ID: $($generateResponse.jobId)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "⏳ 等待 Worker 處理..." -ForegroundColor Yellow

        # 等待 20 秒
        Start-Sleep -Seconds 20

        # 檢查狀態
        $updatedPost = Invoke-RestMethod -Uri "$baseUrl/posts/$postId" `
            -Method GET `
            -Headers $headers

        Write-Host "當前狀態: $($updatedPost.status)" -ForegroundColor Cyan

        if ($updatedPost.latestRevision) {
            Write-Host "已生成內容預覽:" -ForegroundColor Cyan
            $preview = $updatedPost.latestRevision.content.Substring(0, [Math]::Min(150, $updatedPost.latestRevision.content.Length))
            Write-Host "  $preview..." -ForegroundColor Gray
        } else {
            Write-Host "  尚未生成內容,請稍後查詢" -ForegroundColor Yellow
        }
        Write-Host ""
    } catch {
        Write-Host "✗ 內容生成失敗!" -ForegroundColor Red
        Write-Host "  錯誤: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  請檢查:" -ForegroundColor Yellow
        Write-Host "  1. .env.local 是否設定 OPENAI_API_KEY 或 GEMINI_API_KEY" -ForegroundColor Yellow
        Write-Host "  2. Worker 是否正在運行 (npm run worker)" -ForegroundColor Yellow
        Write-Host "  3. Redis 是否正在運行" -ForegroundColor Yellow
        Write-Host "  4. 查看 logs/error.log 了解詳細錯誤" -ForegroundColor Yellow
        Write-Host ""
    }
} else {
    Write-Host "⊘ 跳過內容生成測試" -ForegroundColor Gray
    Write-Host ""
}

# 總結
Write-Host "================================" -ForegroundColor Cyan
Write-Host "測試總結" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✓ 基本功能測試完成!" -ForegroundColor Green
Write-Host ""
Write-Host "建立的測試貼文 ID: $postId" -ForegroundColor Cyan
Write-Host ""
Write-Host "接下來可以:" -ForegroundColor Yellow
Write-Host "1. 使用 Postman 或 REST Client 進行更詳細的測試" -ForegroundColor White
Write-Host "2. 查看 api-test.http 檔案中的完整 API 範例" -ForegroundColor White
Write-Host "3. 設定 AI API Key 後測試完整的內容生成流程" -ForegroundColor White
Write-Host "4. 設定 LINE Bot 測試審稿流程" -ForegroundColor White
Write-Host "5. 設定 Threads 帳號測試發布流程" -ForegroundColor White
Write-Host ""
Write-Host "文件參考:" -ForegroundColor Yellow
Write-Host "- TESTING_GUIDE.md  - 完整測試指南" -ForegroundColor White
Write-Host "- CHEATSHEET.md     - 常用指令速查表" -ForegroundColor White
Write-Host "- README.md         - 系統概述" -ForegroundColor White
Write-Host ""
Write-Host "日誌檔案:" -ForegroundColor Yellow
Write-Host "- logs/all.log      - 所有日誌" -ForegroundColor White
Write-Host "- logs/error.log    - 錯誤日誌" -ForegroundColor White
Write-Host ""
Write-Host "祝測試順利! 🚀" -ForegroundColor Green
Write-Host ""
