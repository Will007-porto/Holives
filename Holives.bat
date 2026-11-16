@echo off
cd /d "%~dp0"
if not exist node_moduleslectron\distlectron.exe call npm install
start "" node_moduleslectron\distlectron.exe .
