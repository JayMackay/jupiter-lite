@echo off
setlocal
set "JUPITER_LAUNCH_ROOT=%~dp0"
if exist "%JUPITER_LAUNCH_ROOT%src-tauri\target\release\jupiter.exe" (
  start "" "%JUPITER_LAUNCH_ROOT%src-tauri\target\release\jupiter.exe" --repo "%JUPITER_LAUNCH_ROOT%."
  exit /b 0
)
echo Build Jupiter locally with: npm run desktop:build -- --no-bundle
echo The local Rust toolchain and Windows build tools are required.
pause
