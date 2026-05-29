```bat
@echo off
title Kill Port 3000

echo ============================
echo Suche Prozesse auf Port 3000
echo ============================
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    echo Kille PID %%a
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo ============================
echo Fertig
echo ============================
echo.

```
