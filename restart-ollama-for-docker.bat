@echo off
echo Stopping Ollama...
taskkill /F /IM ollama.exe 2>nul
timeout /t 2 /nobreak >nul
echo Starting Ollama on 0.0.0.0:11434 so Docker containers can reach it...
set OLLAMA_HOST=0.0.0.0:11434
start "" "C:\Users\raza\AppData\Local\Programs\Ollama\ollama.exe" serve
echo Ollama started. You can verify with: ollama list