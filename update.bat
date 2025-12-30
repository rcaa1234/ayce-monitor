@echo off
chcp 65001 >nul
echo.
echo ====================================
echo   檢查並更新套件
echo ====================================
echo.

echo [1/2] 🔍 檢查可更新的套件...
echo.
call npm outdated
echo.

echo [2/2] 📦 更新所有套件...
echo.
call npm update

if errorlevel 1 (
    echo ❌ 更新失敗！請檢查錯誤訊息。
    pause
    exit /b 1
)

echo.
echo ✓ 套件更新完成！
echo.
echo 提示：如果您想要更新到最新的主要版本（可能有破壞性變更），
echo 請執行: npm install <package-name>@latest
echo.

pause
