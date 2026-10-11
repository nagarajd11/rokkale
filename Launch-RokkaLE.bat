@echo off
title RokkaLE App Launcher
echo Starting RokkaLE App Server...

cd /d "%~dp0"

:: Start python server in background if not already running
netstat -ano | findstr :8080 >nul
if %errorlevel% neq 0 (
    start /b python server.py >nul 2>&1
    timeout /t 1 >nul
)

:: Try opening with Chrome app mode
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app="http://localhost:8080"
    exit
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --app="http://localhost:8080"
    exit
)

:: Try opening with Edge app mode
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:8080"
    exit
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="http://localhost:8080"
    exit
)

:: Fallback to default browser
start http://localhost:8080
exit
