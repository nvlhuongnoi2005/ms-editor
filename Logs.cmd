@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deployment\control.ps1" -Action logs %*
pause
