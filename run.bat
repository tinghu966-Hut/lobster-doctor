@echo off
chcp 65001 >nul
title 🦐 龙虾保姆 v2.0

echo.
echo  🦐 龙虾保姆 — OpenClaw 一条龙服务伴侣 v2.0
echo  ─────────────────────────────
echo.

cd /d "%~dp0"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js！
    echo    请先安装 Node.js: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 检查依赖
if not exist "node_modules\" (
    echo 📦 首次启动，安装依赖...
    call npm install
    echo.
)

:: 启动
echo 🚀 启动龙虾保姆...
echo.
start http://127.0.0.1:18928
node main.js

pause
