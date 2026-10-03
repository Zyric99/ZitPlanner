@echo off
setlocal
set "KLASLOKAAL_DEV_MODE=True"
cd /d "%~dp0.."
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron wordt eenmalig geinstalleerd...
  call npm.cmd install --cache .npm-cache
  if errorlevel 1 (
    echo Installatie mislukt. Controleer je internetverbinding en probeer opnieuw.
    pause
    exit /b 1
  )
)
start "Zitplanner" "%CD%\node_modules\electron\dist\electron.exe" "%CD%\."
