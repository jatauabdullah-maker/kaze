@echo off
setlocal EnableDelayedExpansion
title Kaze Server
cd /d "%~dp0"

set "PY=runtime\python\python.exe"
set "YTDLP=bin\yt-dlp.exe"
set "FFMPEG=bin\ffmpeg.exe"
set "FFPROBE=bin\ffprobe.exe"
set "PYVER=3.12.8"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-embed-amd64.zip"
set "FFURL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

if "%~1"=="5" goto silentstart

:menu
cls
echo.
echo   ============================================
echo               K A Z E   S E R V E R
echo          video grabber - local companion
echo   ============================================
echo.
echo    1. Initialize / Repair  ^(install or update everything^)
echo    2. Start server now
echo    3. Auto-start ON  ^(always available, starts with Windows^)
echo    4. Turn OFF       ^(stop server + remove auto-start^)
echo    5. Exit
echo.
set /p CHOICE=  Select option: 

if "%CHOICE%"=="1" goto init
if "%CHOICE%"=="2" goto startnow
if "%CHOICE%"=="3" goto autostart
if "%CHOICE%"=="4" goto turnoff
if "%CHOICE%"=="5" exit /b 0
goto menu

:validpe
if not exist "%~1" exit /b 1
for %%F in ("%~1") do if %%~zF LSS 20000 exit /b 1
powershell -NoProfile -Command "$fs=[IO.File]::OpenRead('%~1');$b=New-Object byte[] 2;$null=$fs.Read($b,0,2);$fs.Close();if([Text.Encoding]::ASCII.GetString($b)-ne'MZ'){exit 1}"
if errorlevel 1 exit /b 1
exit /b 0

:fetchurl
curl -L -sS --retry 2 -o "%~2" "%~1" 2>nul
if not errorlevel 1 if exist "%~2" exit /b 0
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing"
if exist "%~2" exit /b 0
exit /b 1

:init
cls
echo.
echo   [1/3] Portable Python runtime...
if exist "%PY%" (
    echo         already installed - keeping
) else (
    if not exist "runtime" mkdir "runtime"
    call :fetchurl "%PYURL%" "%TEMP%\kaze-py.zip" || goto fail
    powershell -NoProfile -Command "Expand-Archive -Force '%TEMP%\kaze-py.zip' '%CD%\runtime\python'"
    del "%TEMP%\kaze-py.zip" >nul 2>&1
)
call :validpe "%PY%" || goto fail
echo         OK

echo   [2/3] yt-dlp engine ^(fresh latest build^)...
if not exist "bin" mkdir "bin"
del "%YTDLP%" >nul 2>&1
call :fetchurl "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" "%TEMP%\kaze-ytdlp.bin" || goto fail
move /y "%TEMP%\kaze-ytdlp.bin" "%YTDLP%" >nul
call :validpe "%YTDLP%" || goto fail
echo         OK

echo   [3/3] FFmpeg ^(merging + audio convert^)...
call :validpe "%FFMPEG%"
if not errorlevel 1 (
    echo         already installed - keeping
) else (
    del "%FFMPEG%" "%FFPROBE%" >nul 2>&1
    call :fetchurl "%FFURL%" "%TEMP%\kaze-ff.zip" || goto fail
    if exist "%TEMP%\kaze-ff" rmdir /s /q "%TEMP%\kaze-ff" >nul 2>&1
    powershell -NoProfile -Command "Expand-Archive -Force '%TEMP%\kaze-ff.zip' '%TEMP%\kaze-ff'"
    powershell -NoProfile -Command "Get-ChildItem '%TEMP%\kaze-ff' -Recurse -Include ffmpeg.exe,ffprobe.exe | Copy-Item -Destination '%CD%\bin' -Force"
    del "%TEMP%\kaze-ff.zip" >nul 2>&1
    rmdir /s /q "%TEMP%\kaze-ff" >nul 2>&1
)
call :validpe "%FFMPEG%" || goto fail
echo         OK
echo.
echo   ============================================
echo     DONE - everything installed and updated.
echo     If downloads ever fail later, run this
echo     option again to repair + update yt-dlp.
echo   ============================================
echo.
pause
goto menu

:startnow
call :validpe "%PY%" || goto needinit
call :validpe "%YTDLP%" || goto needinit
echo   Starting server...
start "KazeServer" /min cmd /c """%PY%" "server.py"""
timeout /t 2 /nobreak >nul
call :checkrunning && (echo   Server is UP - you can close this and go back to the site.) || (echo   Server did not start - check kaze-server.log next to the bat.)
timeout /t 3 /nobreak >nul
goto menu

:needinit
echo   Components missing or broken - running Initialize first...
timeout /t 2 /nobreak >nul
goto init

:silentstart
cd /d "%~dp0"
call :validpe "%PY%" || exit /b 1
call :validpe "%YTDLP%" || exit /b 1
start "KazeServer" /min cmd /c """%PY%" "server.py"""
exit /b 0

:autostart
schtasks /Create /TN "KazeServer" /TR "\"%~f0\" 5" /SC ONLOGON /RL LIMITED /F >nul 2>&1
if errorlevel 1 (
    echo   Could not create the auto-start task.
) else (
    call :stopproc
    start "KazeServer" /min cmd /c """%PY%" "server.py"""
    echo   Auto-start enabled. Server is running now and will
    echo   always be available when you log into Windows.
)
timeout /t 3 /nobreak >nul
goto menu

:turnoff
call :stopproc
schtasks /Delete /TN "KazeServer" /F >nul 2>&1
echo   Server stopped. Auto-start removed.
timeout /t 3 /nobreak >nul
goto menu

:stopproc
if exist "server.pid" (
    set /p KPID=<server.pid
    if not "!KPID!"=="" taskkill /PID !KPID! /F >nul 2>&1
    del "server.pid" >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq KazeServer*" /F >nul 2>&1
exit /b 0

:checkrunning
set "OK=0"
if exist "server.pid" (
    set /p CPID=<server.pid
    tasklist /FI "PID eq %CPID%" 2>nul | find /I "python" >nul && set "OK=1"
)
exit /b %OK%

:fail
echo.
echo   Download or verification failed ^(file looked broken^).
echo   Check your internet and run option 1 again.
pause
goto menu
