@echo off
rem Starts the akko server and opens it in the browser.
rem Keep this window open while you use the app; close it (or press Ctrl+C) to stop the server.

title Japanese akko
cd /d "%~dp0"
set "URL=http://127.0.0.1:3000"

rem already running? then just open the page
powershell -NoProfile -Command "try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
    echo The server is already running. Opening %URL%
    start "" "%URL%"
    exit /b
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed. Get it from https://nodejs.org/ and run this again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo First start: installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo.
echo  ==================================================
echo    DON'T CLOSE THIS WINDOW
echo    it runs the akko server. closing it stops the app.
echo    (you can minimize it)
echo  ==================================================
echo.

rem the server opens the browser itself once it's listening
set "AKKO_OPEN=1"
node server.js
echo.
echo The server stopped.
pause
