@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deployment\doctor.ps1" %*
if errorlevel 1 (echo Checks failed. See the error above. & pause & exit /b 1)
pause
