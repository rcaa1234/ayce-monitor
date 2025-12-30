@echo off
chcp 65001 >nul
echo.
echo ====================================
echo   重置並重新啟動系統
echo ====================================
echo.

echo [1/3] 🧹 清理測試資料...
call npm run cleanup
echo.

echo [2/3] 🔄 檢查套件...
if not exist "node_modules\" (
    echo 安裝套件中...
    call npm install
)
echo.

echo [3/3] 🚀 啟動系統...
echo.
call npm run dev
