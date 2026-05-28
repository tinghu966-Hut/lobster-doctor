@echo off
chcp 65001 >nul
title 🦐 龙虾医生 — 构建 EXE
color 0B

echo.
echo  ============================================
echo       🦐 龙虾医生 v1.0 — 构建脚本
echo  ============================================
echo.

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

:: Step 1: Install dependencies
echo 📦 [1/4] 安装依赖...
call "C:\Program Files\nodejs\npm.cmd" install
if %errorlevel% neq 0 (
    echo ❌ 依赖安装失败
    pause
    exit /b 1
)
echo ✅ 依赖安装完成
echo.

:: Step 2: Install pkg bundler globally if not present
echo 🔧 [2/4] 检查打包工具...
where pkg >nul 2>&1
if %errorlevel% neq 0 (
    echo    正在安装 pkg 打包工具...
    call "C:\Program Files\nodejs\npm.cmd" install -g pkg
    if %errorlevel% neq 0 (
        echo ❌ pkg 安装失败
        pause
        exit /b 1
    )
)
echo ✅ 打包工具就绪
echo.

:: Step 3: Bundle into standalone EXE
echo 🔨 [3/4] 打包为独立 EXE 文件...
if not exist "dist\" mkdir dist

pkg main.js ^
    --targets node18-win-x64 ^
    --output dist\lobster-doctor.exe ^
    --public ^
    --public-packages "*" ^
    --assets public/**/*

if %errorlevel% neq 0 (
    echo ❌ 打包失败
    pause
    exit /b 1
)
echo ✅ 打包完成：dist\lobster-doctor.exe
echo.

:: Step 4: Copy additional distribution files
echo 📋 [4/4] 复制分发文件...

if not exist "dist\" mkdir dist

:: Create version.txt
(
    echo 龙虾医生 Lobster Doctor
    echo 版本: 1.0.0
    echo 构建日期: %DATE% %TIME%
    echo 平台: Windows x64
) > dist\version.txt

:: Copy public assets to dist folder for runtime
if exist "public\" (
    xcopy /E /I /Y public dist\public >nul
)

:: Copy README if exists
if exist "dist\README.txt" (
    echo ✅ 分发文件已更新
) else (
    echo ⚠️  dist\README.txt 不存在，请手动创建
)

echo ✅ 构建完成！
echo.
echo   输出文件: dist\lobster-doctor.exe
echo   版本文件: dist\version.txt
echo.
echo   使用方式: 直接双击 dist\lobster-doctor.exe 即可运行
echo.
pause
