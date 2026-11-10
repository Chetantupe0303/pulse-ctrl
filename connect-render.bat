@echo off
echo ===================================================
echo   PulseCtrl - Laptop Helper Cloud Launcher
echo ===================================================
echo.
set /p RENDER_URL="Enter your Render URL (e.g. pulse-ctrl.onrender.com) or press Enter to use saved: "
if not "%RENDER_URL%"=="" (
  node helper/index.js --server=%RENDER_URL%
) else (
  node helper/index.js
)
pause
