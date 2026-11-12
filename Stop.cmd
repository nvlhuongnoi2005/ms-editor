@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deployment\control.ps1" -Action stop %*
if errorlevel 1 (echo Stop failed. See the error above. & pause & exit /b 1)
