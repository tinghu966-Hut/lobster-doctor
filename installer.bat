@echo off
chcp 65001 >nul
title 🦐 龙虾医生 — 安装程序
color 0B

echo.
echo  ============================================
echo       🦐 龙虾医生 v1.0
echo       OpenClaw 中文伴侣工具
echo  ============================================
echo.
echo  欢迎使用龙虾医生！本工具将帮助您：
echo    1. 检测系统环境
echo    2. 创建桌面快捷方式
echo    3. 快速启动龙虾医生
echo.
echo  按任意键继续安装...
pause >nul

set SCRIPT_DIR=%~dp0
set DESKTOP=%USERPROFILE%\Desktop
set APP_PATH=%SCRIPT_DIR%dist\lobster-doctor.exe

:: Step 1: Check Node.js
echo.
echo 🔍 [1/4] 检测 Node.js 环境...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  未检测到 Node.js
    echo    打开下载页面...
    start https://nodejs.org
    echo.
    echo ┌──────────────────────────────────────┐
    echo │  ❌ 需要 Node.js 才能运行               │
    echo │                                        │
    echo │  请安装 Node.js 后重新运行本安装程序    │
    echo │  下载页面已自动打开                     │
    echo └──────────────────────────────────────┘
    pause
    exit /b 1
)

for /f "tokens=1,2,3 delims=v." %%a in ('node --version') do set NODE_VER=%%a.%%b
echo ✅ Node.js v%NODE_VER% 已安装
echo.

:: Step 2: Check bundled EXE
echo 📦 [2/4] 检测程序文件...
if not exist "%APP_PATH%" (
    echo ⚠️  未找到 lobster-doctor.exe
    echo    请先运行 build.bat 构建程序
    echo.
    set BUILD_SCRIPT=%SCRIPT_DIR%build.bat
    if exist "%BUILD_SCRIPT%" (
        echo    正在运行构建脚本...
        call "%BUILD_SCRIPT%"
    ) else (
        echo ❌ 找不到 build.bat，请重新解压安装包
        pause
        exit /b 1
    )
)
echo ✅ 程序文件就绪
echo.

:: Step 3: Create desktop shortcut
echo 📌 [3/4] 创建桌面快捷方式...
set VBS=%TEMP%\lobster_lnk.vbs
(
    echo Set WshShell = WScript.CreateObject("WScript.Shell"^)
    echo Set lnk = WshShell.CreateShortcut("%DESKTOP%\🦐 龙虾医生.lnk"^)
    echo lnk.TargetPath = "%APP_PATH%"
    echo lnk.WorkingDirectory = "%SCRIPT_DIR%dist"
    echo lnk.Description = "🦐 龙虾医生 — OpenClaw 中文伴侣工具"
    echo lnk.IconLocation = "%APP_PATH%,0"
    echo lnk.Save
) > "%VBS%"
cscript //nologo "%VBS%" >nul 2>&1
del "%VBS%" >nul 2>&1
echo ✅ 桌面快捷方式已创建：🦐 龙虾医生
echo.

:: Step 4: Done
echo 🚀 [4/4] 安装完成！
echo.
echo ┌──────────────────────────────────────┐
echo │  ✅ 龙虾医生安装成功！                 │
echo │                                        │
echo │  双击桌面图标即可启动：                │
echo │  🦐 龙虾医生                           │
echo │                                        │
echo │  如有问题，请查阅 README.txt           │
echo └──────────────────────────────────────┘
echo.
echo  按任意键启动龙虾医生...
pause >nul

:: Launch the app
if exist "%APP_PATH%" (
    start "" "%APP_PATH%"
) else (
    echo ❌ 找不到 lobster-doctor.exe，请重新安装
    pause
)

exit /b 0
