@echo off
REM Launch the Python host. Requires Python on PATH and: pip install yt-dlp
cd /d "%~dp0"
python "%~dp0tubestack_ytdlp_host.py"
