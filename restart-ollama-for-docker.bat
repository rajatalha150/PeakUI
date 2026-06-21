@echo off
REM Rebind Ollama to 0.0.0.0:11434 so Docker containers on Windows can reach it.
REM Set PEAKUI_OLLAMA_EXE before running this script to override the default path.

if not defined PEAKUI_OLLAMA_EXE set "OLLAMA_EXE=C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe"
if defined PEAKUI_OLLAMA_EXE set "OLLAMA_EXE=%PEAKUI_OLLAMA_EXE%"

echo Stopping Ollama...
taskkill /F /IM ollama.exe 2>nul
timeout /T 2 /NOBREAK >nul

echo Starting Ollama on 0.0.0.0:11434...
set "OLLAMA_HOST=0.0.0.0:11434"
start /B "" "%OLLAMA_EXE%" serve

echo Ollama should now be reachable from Docker containers at host.docker.internal:11434
pause
