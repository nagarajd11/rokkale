@echo off
title Push RokkaLE to GitHub
cd /d "%~dp0"

echo ========================================================
echo   Pushing RokkaLE to https://github.com/nagarajd11/rokkale
echo ========================================================
echo.

git push -u origin main

echo.
if %errorlevel% equ 0 (
    echo ========================================================
    echo   [SUCCESS] RokkaLE code is now live on your GitHub!
    echo ========================================================
    echo   Next: Connect this repo to Render.com to go live!
) else (
    echo [NOTE] If a browser window opened, click "Authorize GitHub"
    echo and run this file once more.
)
echo.
pause
