@echo off
:: ArchitectureV1 Agent — install autostart entry on Windows.
:: Adds a shortcut to start-silent.vbs in the user's Startup folder so the agent
:: launches every time you log in.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%~dp0start-silent.vbs"
set "SHORTCUT=%STARTUP%\ArchitectureV1Agent.lnk"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.Save()"

if exist "%SHORTCUT%" (
  echo.
  echo Installed: %SHORTCUT%
  echo The agent will start automatically when you log in.
) else (
  echo Failed to install autostart entry.
)
pause
