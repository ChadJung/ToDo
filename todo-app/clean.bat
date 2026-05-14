@echo off
REM ============================================================
REM  TodoApp - clean build caches
REM  Removes previous build output and electron-builder cache
REM  so the next "npm run build" picks up fresh source.
REM ============================================================
setlocal
cd /d "%~dp0"

echo [1/2] Removing dist folder...
if exist "dist" (
    rmdir /s /q "dist"
    echo       dist removed.
) else (
    echo       dist not found, skipping.
)

echo [2/2] Removing electron-builder cache...
if exist "%LOCALAPPDATA%\electron-builder\Cache" (
    rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
    echo       electron-builder cache removed.
) else (
    echo       electron-builder cache not found, skipping.
)

echo.
echo Done. Run "npm run build" for a clean build.
endlocal
pause
