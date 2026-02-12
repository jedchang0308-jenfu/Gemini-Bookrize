@echo off
chcp 65001 >nul
title Installer Assistant
color 0b

echo.
echo ===============================================================
echo            Gemini Bookrize - 安裝小幫手
echo ===============================================================
echo.
echo 步驟 1: 即將為您打開 Chrome 擴充功能頁面...
echo.
echo    請看瀏覽器視窗的【右上角】...
echo    找到「開發人員模式 (Developer mode)」開關，並將它打開。
echo.
timeout /t 3 >nul
start chrome chrome://extensions/

echo 步驟 2: 請將本資料夾中的檔案載入
echo.
echo    ✅ 確定開發人員模式已開啟後：
echo.
echo    您可以直接「拖曳」本資料夾到該視窗中間。
echo    (或者點擊左上角「載入未封裝項目」選擇本資料夾)
echo.
echo ===============================================================
echo 安裝完成後，請重新整理 Gemini 頁面即可使用！
echo.
pause
