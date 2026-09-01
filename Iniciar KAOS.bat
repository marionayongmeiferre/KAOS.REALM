@echo off
title KAOS.REALM - servidor
cd /d "%~dp0"

REM ---------------------------------------------------------------------
REM  Arranca las dos piezas de KAOS:
REM
REM    Node   :8787  la app entera (composer, ideas, galeria, sync, post edit)
REM    Python :8765  solo el motor de recorte de fondo (rembg)
REM
REM  Tu solo abres la de 8787. Node le pasa por dentro al de Python lo que
REM  haga falta, asi que en el navegador hay UNA sola direccion.
REM  El de Python va aparte porque rembg es una red neuronal de 470 MB que
REM  no corre ni en Node ni en el navegador.
REM ---------------------------------------------------------------------

set "POSTEDIT=%~dp0..\AI_TATTOO_POST_EDIT"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js no esta instalado o no esta en el PATH.
  echo   Descargalo en https://nodejs.org  ^(version LTS^)
  echo.
  pause
  exit /b 1
)

REM ---- 1. el motor de recorte (POST EDIT) -----------------------------
if not exist "%POSTEDIT%\venv\Scripts\python.exe" (
  echo.
  echo   AVISO: no encuentro el motor de retoque de fotos.
  echo   Buscaba aqui: %POSTEDIT%\venv
  echo.
  echo   KAOS arranca igual; solo la seccion POST EDIT quedara apagada.
  echo.
  goto arrancar_node
)

echo.
echo   Comprobando el motor de retoque de fotos...
curl -s -o nul --max-time 3 http://127.0.0.1:8765/api/backgrounds
if not errorlevel 1 (
  echo   Ya estaba encendido.
  goto arrancar_node
)

echo   Encendiendolo. Tarda cerca de medio minuto: carga el modelo de recorte.
start "KAOS motor de recorte" /d "%POSTEDIT%" cmd /k ".\venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8765

REM Esperar a que responda de verdad, no a que aparezca la ventana. Abrir el
REM navegador antes de tiempo era lo que hacia parecer que estaba roto.
set /a intentos=0
:esperar
set /a intentos+=1
curl -s -o nul --max-time 3 http://127.0.0.1:8765/api/backgrounds
if not errorlevel 1 goto motor_listo
if %intentos% geq 45 goto motor_falla
<nul set /p "=."
timeout /t 2 /nobreak >nul
goto esperar

:motor_falla
echo.
echo   El motor de recorte no responde despues de minuto y medio.
echo   Mira la ventana "KAOS motor de recorte": ahi sale el error.
echo   KAOS arranca igual; solo POST EDIT quedara apagado.
goto arrancar_node

:motor_listo
echo.
echo   Motor de recorte listo.

REM ---- 2. la app ------------------------------------------------------
:arrancar_node
echo.
echo   Arrancando KAOS.REALM...
echo   Deja esta ventana abierta mientras uses la app.
echo   Ctrl+C para parar.
echo.

REM Abrir el navegador un par de segundos mas tarde, en paralelo, para dar
REM tiempo a que el servidor coja el puerto. El servidor corre en ESTA
REM ventana, que es lo que lo mantiene vivo y muestra su registro
REM (incluida la direccion de Tailscale para el iPad).
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:8787"

node server.js

echo.
echo   El servidor se ha parado.
echo   La ventana "KAOS motor de recorte" sigue abierta; cierrala tambien.
pause
