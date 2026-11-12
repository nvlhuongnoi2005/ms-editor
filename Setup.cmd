@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deployment\setup.ps1" %*
if errorlevel 1 (echo Setup failed. See the error above. & pause & exit /b 1)
