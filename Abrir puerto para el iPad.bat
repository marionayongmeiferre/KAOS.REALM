@echo off
title KAOS.REALM - abrir el puerto para el iPad
cd /d "%~dp0"

REM ---------------------------------------------------------------------
REM  Esto se ejecuta UNA VEZ. Deja el iPad entrando por Tailscale desde
REM  cualquier sitio, no solo desde la WiFi de casa.
REM
REM  Que hace exactamente:
REM    1. ABRE  el puerto 8787 (KAOS entero) SOLO a los aparatos de tu
REM             cuenta de Tailscale, el rango 100.64.0.0/10.
REM             No lo abre a internet ni a la WiFi del estudio.
REM    2. QUITA la regla vieja del 8765, que ya no sirve: el motor de
REM             recorte ahora escucha solo dentro del ordenador, y quien
REM             habla con el es el servidor de KAOS.
REM
REM  Deshacer: vuelve a ejecutarlo y elige la opcion 2.
REM ---------------------------------------------------------------------

REM Pedir permisos de administrador. Sin esto Windows no deja tocar el
REM cortafuegos y el .bat fallaria sin decir por que.
net session >nul 2>&1
if errorlevel 1 (
  echo   Windows va a pedirte permiso de administrador. Dile que SI.
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:menu
cls
echo.
echo   ===========================================================
echo    KAOS.REALM - acceso desde el iPad
echo   ===========================================================
echo.
echo    1 = Abrir el puerto 8787 para tus aparatos de Tailscale
echo        y quitar la regla vieja del 8765
echo.
echo    2 = Deshacer ^(quitar el 8787^)
echo.
echo    3 = Salir sin tocar nada
echo.
set "op="
set /p "op=   Elige 1, 2 o 3: "

if "%op%"=="1" goto abrir
if "%op%"=="2" goto cerrar
if "%op%"=="3" exit /b
goto menu

:abrir
echo.
echo   Abriendo el 8787...
REM Se borra antes por si ya existiera, para no acumular reglas repetidas
REM cada vez que se ejecute esto.
powershell -NoProfile -Command "Remove-NetFirewallRule -DisplayName 'KAOS.REALM (Tailscale)' -ErrorAction SilentlyContinue"
powershell -NoProfile -Command "New-NetFirewallRule -DisplayName 'KAOS.REALM (Tailscale)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -RemoteAddress 100.64.0.0/10 -Profile Any -Description 'KAOS.REALM: la app entera, incluido POST EDIT. Solo aparatos del tailnet.' | Out-Null"
if errorlevel 1 (
  echo   FALLO al crear la regla.
  goto fin
)
echo   Hecho: el 8787 queda abierto solo para tus aparatos.

echo.
echo   Quitando la regla vieja del 8765...
powershell -NoProfile -Command "if (Get-NetFirewallRule -DisplayName 'KAOS Auto Edit (Tailscale)' -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName 'KAOS Auto Edit (Tailscale)'; '   Quitada.' } else { '   No estaba: ya se habia quitado.' }"

echo.
echo   ===========================================================
echo    En el iPad, abre esta direccion:
echo   ===========================================================
echo.
set "TS=C:\Program Files\Tailscale\tailscale.exe"
if exist "%TS%" (
  for /f "tokens=*" %%i in ('"%TS%" ip -4 2^>nul') do set "TSIP=%%i"
)
if defined TSIP (
  echo        http://%TSIP%:8787
  echo.
  echo    Esa direccion NO cambia nunca. En Safari:
  echo    Compartir - Anadir a pantalla de inicio, y la tienes a un toque.
  echo.
  echo    El iPad necesita Tailscale encendido y la misma cuenta que
  echo    este ordenador. Y el portatil tiene que estar encendido con
  echo    "Iniciar KAOS.bat" en marcha: el trabajo lo hace el.
) else (
  echo    Tailscale no responde. Abre su app en este PC, inicia sesion
  echo    y vuelve a ejecutar esto.
)
goto fin

:cerrar
echo.
powershell -NoProfile -Command "if (Get-NetFirewallRule -DisplayName 'KAOS.REALM (Tailscale)' -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName 'KAOS.REALM (Tailscale)'; '   Regla quitada. El iPad ya solo entrara por la misma WiFi.' } else { '   No habia nada que quitar.' }"

:fin
echo.
pause
