@echo off
rem Terminal Grid installer for Windows: double-click it. Installs Node.js if missing, copies the app to
rem %LOCALAPPDATA%\Terminal Grid, adds a desktop + Start menu shortcut and the right-click "Terminal Grid" entry.
rem Run with /uninstall to remove everything.
title Terminal Grid installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
