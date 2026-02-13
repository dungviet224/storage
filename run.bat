@echo off
title Media Storage Server
echo ======================================
echo   Media Storage Server - Launcher
echo ======================================
echo.

:: Kill process on port 3900 if exists
echo [*] Checking port 3900...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3900 " ^| findstr "LISTENING"') do (
    echo [!] Port 3900 occupied by PID %%a - killing...
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)
echo [OK] Port 3900 is free.
echo.

:: Check node_modules
if not exist "%~dp0node_modules" (
    echo [*] Installing dependencies...
    cd /d "%~dp0"
    npm install
    echo.
)

:: Start server
echo [*] Starting server...
echo.
cd /d "%~dp0"
node server.js
pause
