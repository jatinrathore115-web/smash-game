@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)
echo Starting LUMA RIFT - your browser will open automatically.
call npx vite --open
