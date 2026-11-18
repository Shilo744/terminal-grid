@echo off
node "%~dp0..\heb-demo.js"
ping -n 900 127.0.0.1 >nul
