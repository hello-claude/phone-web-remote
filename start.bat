@echo off
REM One-click launcher for Phone Web Remote server (Windows). Double-click to run.
REM First run auto-installs dependencies, then starts the server.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing dependencies ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
call npm start
pause
