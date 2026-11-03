@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SensiBot

where py >nul 2>nul
if not errorlevel 1 (
  py "%~dp0servidor.py"
  goto end
)

where python >nul 2>nul
if not errorlevel 1 (
  python "%~dp0servidor.py"
  goto end
)

echo.
echo No se encontro Python en este equipo.
echo Instala Python desde https://www.python.org/downloads/ y vuelve a intentarlo.
echo.
pause
exit /b 1

:end
pause
