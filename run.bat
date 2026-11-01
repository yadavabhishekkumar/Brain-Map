@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo ==========================================================
echo    UPSC Brain Map  -  One-Click Launcher
echo ==========================================================
echo.

REM ---------- 1. Check / start Docker ----------
echo [1/5] Checking Docker...
docker info >nul 2>&1
if not errorlevel 1 goto docker_ready

echo        Docker daemon is not running. Starting Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else (
    echo        WARNING: Docker Desktop was not found at the default path.
    echo        Start Docker Desktop manually, then run this script again.
    goto finish
)

echo        Waiting for the Docker daemon (first boot can take a minute)...
:wait_docker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto wait_docker

:docker_ready
echo        Docker is ready.

REM ---------- 2. Start databases ----------
echo.
echo [2/5] Starting databases - PostgreSQL and Elasticsearch...
docker compose up -d
if errorlevel 1 (
    echo        ERROR: could not start the databases. Open Docker Desktop and retry.
    goto finish
)
echo        Waiting for the databases to become healthy (first pull may take a while)...
docker compose up -d --wait

REM ---------- 3. Backend ----------
echo.
echo [3/5] Preparing the backend...
if not exist "%ROOT%backend\node_modules" (
    echo        Installing backend dependencies - first run only...
    pushd "%ROOT%backend"
    call npm install --no-audit --no-fund
    popd
)

REM ---------- 4. Frontend ----------
echo.
echo [4/5] Preparing the frontend...
if not exist "%ROOT%frontend\node_modules" (
    echo        Installing frontend dependencies - first run only...
    pushd "%ROOT%frontend"
    call npm install --no-audit --no-fund
    popd
)

REM ---------- 5. Launch servers ----------
echo.
echo [5/5] Launching the backend and frontend in separate windows...
start "UPSC Backend"  /D "%ROOT%backend"  cmd /k "npm start"
start "UPSC Frontend" /D "%ROOT%frontend" cmd /k "npm run dev"

echo        Waiting for the frontend to be ready...
timeout /t 6 /nobreak >nul
start "" http://localhost:5173

echo.
echo ==========================================================
echo    All set!
echo.
echo    Frontend : http://localhost:5173
echo    Backend  : http://localhost:4000
echo    Notes    : stored locally in backend\storage
echo.
echo    Keep the two new windows open while you work.
echo    To stop: close those windows, then run  docker compose down
echo ==========================================================
echo.

:finish
pause
endlocal
