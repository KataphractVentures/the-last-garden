@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 or later, then reopen this launcher.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo This launcher requires Node.js 22 or later.
  pause
  exit /b 1
)
node tools/serve.mjs
if errorlevel 1 pause
endlocal
