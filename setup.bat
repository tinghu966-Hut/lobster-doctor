@echo off
chcp 65001 >nul
title 🦐 龙虾医生 - 安装向导
color 0B

echo.
echo  ============================================
echo       🦐 龙虾医生 v1.0 — 安装向导
echo       OpenClaw 中文伴侣
echo  ============================================
echo.
echo  本工具将帮助您：
echo    1. 自动检测系统环境
echo    2. 安装 OpenClaw
echo    3. 安装必需依赖
echo    4. 创建桌面快捷方式
echo.

:: 检查 Node.js
echo 🔍 检测 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  未检测到 Node.js
    echo    正在打开下载页面...
    start https://nodejs.org
    echo.
    echo 请安装 Node.js 后重新运行本安装程序。
    pause
    exit /b 1
)

for /f "tokens=1,2,3 delims=v." %%a in ('node --version') do set NODE_VER=%%b
echo ✅ Node.js v%NODE_VER% 已安装
echo.

:: 创建桌面快捷方式
echo 📌 创建桌面快捷方式...
set SCRIPT_DIR=%~dp0
set DESKTOP=%USERPROFILE%\Desktop

:: 创建 VBS 快捷方式生成脚本
set VBS=%TEMP%\mklnk.vbs
(
echo Set WshShell = WScript.CreateObject("WScript.Shell"^)
echo Set lnk = WshShell.CreateShortcut("%DESKTOP%\🦐 龙虾医生.lnk"^)
echo lnk.TargetPath = "%SCRIPT_DIR%run.bat"
echo lnk.WorkingDirectory = "%SCRIPT_DIR%"
echo lnk.Description = "🦐 龙虾医生 — OpenClaw 中文伴侣"
echo lnk.IconLocation = "%SystemRoot%\system32\SHELL32.dll,242"
echo lnk.Save
) > "%VBS%"
cscript //nologo "%VBS%" >nul 2>&1
del "%VBS%" >nul 2>&1
echo ✅ 桌面快捷方式已创建
echo.

:: 安装 npm 依赖
echo 📦 安装依赖...
cd /d "%SCRIPT_DIR%"
call npm install >nul 2>&1
echo ✅ 依赖安装完成
echo.

:: 启动
echo 🚀 启动龙虾医生...
echo.
echo   桌面快捷方式已创建：🦐 龙虾医生
echo   双击即可打开本工具
echo.
start http://127.0.0.1:18928
start "" node main.js

echo ✅ 安装完成！浏览器已自动打开。
echo.
echo 如果浏览器未自动打开，请手动访问：
echo   http://127.0.0.1:18928
echo.
pause
