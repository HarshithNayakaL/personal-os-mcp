@echo off
cd /d "%~dp0"
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 exit /b 1
