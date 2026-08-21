@echo off
rem ---------------------------------------------------------------------------
rem  Tibia Sounds Config - uruchamianie jednym klikiem.
rem
rem  Ten sam plik dziala w dwoch miejscach:
rem    * obok zainstalowanej aplikacji  -> odpala plik .exe
rem    * w katalogu projektu (zrodla)   -> w razie potrzeby instaluje zaleznosci
rem                                        i uruchamia `npm start`
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

set "APP=Tibia Sounds Config.exe"

rem --- wersja zainstalowana / portable -------------------------------------
if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)

rem --- katalog projektu -----------------------------------------------------
if not exist "package.json" (
  echo.
  echo   Nie znalazlem ani "%APP%", ani projektu w tym katalogu:
  echo   %CD%
  echo.
  pause
  exit /b 1
)

rem Bez Node.js zostaje jeszcze lokalny build, jesli ktos go wczesniej zrobil.
where npm >nul 2>nul
if errorlevel 1 (
  if exist "dist\win-unpacked\%APP%" (
    start "" "dist\win-unpacked\%APP%"
    exit /b 0
  )
  echo.
  echo   Brak Node.js w PATH. Zainstaluj Node 20.11 lub nowszy: https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instaluje zaleznosci, to potrwa chwile...
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install nie powiodl sie.
    echo.
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 (
  echo.
  echo   Aplikacja zakonczyla sie bledem.
  echo.
  pause
  exit /b 1
)
