@echo off
REM Rebind Ollama to 0.0.0.0:11434 so Docker containers on Windows can reach it.
REM Edit OLLAMA_EXE below to match your Ollama installation path.

set "OLLAMA_EXE=C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe"

echo Stopping Ollama...
taskkill /F /IM ollama.exe 2>nul
timeout /T 2 /NOBREAK >nul

echo Starting Ollama on 0.0.0.0:11434...
set "OLLAMA_HOST=0.0.0.0:11434"
start /B "" "%OLLAMA_EXE%" serve

echo Ollama should now be reachable from Docker containers at host.docker.internal:11434
pause
