@echo off
setlocal
cd /d "%~dp0"
echo ArchitectureV1 Agent debug mode
echo Using config.json unless ARCH_SERVER_URL or --server is provided.
node agent.js --debug
pause
