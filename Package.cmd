@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deployment\package.ps1" %*
if errorlevel 1 (echo Packaging failed. See the error above. & pause & exit /b 1)
