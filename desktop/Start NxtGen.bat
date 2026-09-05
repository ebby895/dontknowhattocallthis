@echo off
setlocal EnableDelayedExpansion
title NxtGen Deal Engine

rem ---------------------------------------------------------------------------
rem Double-click launcher for the NxtGen Deal Engine.
rem
rem First run: creates a private virtual environment next to this file, installs
rem the dependencies and downloads Chromium. Takes a few minutes.
rem Every run after that: launches straight into the app.
rem
rem The venv keeps everything inside this folder, so nothing is installed into
rem the system Python and removing the folder removes all of it.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"

set "VENV=.venv"
set "STAMP=%VENV%\.setup-complete"

echo.
echo   Eb's Price Glitch Command Center
echo   ================================
echo.

rem --- Find Python -----------------------------------------------------------
rem The py launcher ships with the python.org installer and is the most reliable
rem way to find a real Python. Fall back to whatever "python" resolves to.

set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (
    python --version >nul 2>&1 && set "PY=python"
)

if not defined PY (
    echo   Python is not installed.
    echo.
    echo   Get it from:  https://www.python.org/downloads/
    echo.
    echo   IMPORTANT: on the first screen of the installer, tick
    echo   "Add python.exe to PATH" before clicking Install.
    echo.
    echo   Then double-click this file again.
    echo.
    pause
    exit /b 1
)

rem --- First-run setup -------------------------------------------------------

if exist "%STAMP%" goto :launch

echo   First run - setting up. This takes a few minutes.
echo   You only have to wait through this once.
echo.

if not exist "%VENV%" (
    echo   [1/3] Creating the environment...
    %PY% -m venv "%VENV%"
    if errorlevel 1 (
        echo.
        echo   Could not create the environment.
        echo   Copy the error above and send it to Claude.
        echo.
        pause
        exit /b 1
    )
)

echo   [2/3] Installing dependencies...
call "%VENV%\Scripts\python.exe" -m pip install --upgrade pip --quiet
call "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo   Dependency install failed.
    echo   Copy the error above and send it to Claude.
    echo.
    pause
    exit /b 1
)

echo   [3/3] Downloading the browser...
call "%VENV%\Scripts\python.exe" -m playwright install chromium
if errorlevel 1 (
    echo.
    echo   Browser download failed - check your internet connection.
    echo   Copy the error above and send it to Claude.
    echo.
    pause
    exit /b 1
)

echo. > "%STAMP%"
echo.
echo   Setup complete.
echo.

rem --- Launch ----------------------------------------------------------------

:launch
echo   Starting...
echo.
echo   A Chrome window will open on x.com. If you are not signed in,
echo   sign in there once - it is remembered from then on.
echo.

call "%VENV%\Scripts\python.exe" run.py
set "RC=%errorlevel%"

if not "%RC%"=="0" (
    echo.
    echo   The app exited with an error ^(code %RC%^).
    echo   Copy everything above and send it to Claude.
    echo.
    pause
)

endlocal
