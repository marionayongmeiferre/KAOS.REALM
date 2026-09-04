# BAJAR-TODO.ps1
#
# En el OTRO ordenador. Trae todo de GitHub y lo deja funcionando.
#
#     & "C:\3D DOCUMENTS\TATTOO\TATTOO_FLASH_CREATOR\BAJAR-TODO.ps1"
#
# LA PRIMERA VEZ DE TODAS hay que traerse un repositorio a mano, porque este
# script vive dentro de el. Cuatro lineas, pegadas de una vez:
#
#     mkdir "C:\CLAUDE_TREBALLS"
#     cd "C:\CLAUDE_TREBALLS"
#     git clone https://github.com/marionayongmeiferre/KAOS.REALM.git TATTOO_FLASH_CREATOR
#     & ".\TATTOO_FLASH_CREATOR\BAJAR-TODO.ps1" -Primera
#
# El "-Primera" clona los otros tres. A partir de ahi, cada vez que quieras
# ponerte al dia, solo esto y nada mas:
#
#     & "C:\CLAUDE_TREBALLS\TATTOO_FLASH_CREATOR\BAJAR-TODO.ps1"
#
# La ruta no esta escrita dentro del script: sale de donde este el propio
# fichero. Si manana lo mueves a otro sitio, sigue funcionando.

param([switch]$Primera)

$ErrorActionPreference = "Continue"
# La carpeta madre sale de DONDE ESTA ESTE SCRIPT, no escrita a mano: el script
# vive en <raiz>\TATTOO_FLASH_CREATOR, asi que la raiz es la carpeta de encima.
# Asi funciona igual en "C:\3D DOCUMENTS\TATTOO" que en "C:\CLAUDE_TREBALLS" o
# donde sea, sin tocar una linea.
$Raiz = Split-Path $PSScriptRoot -Parent
$Flash = Join-Path $Raiz "TATTOO_FLASH_CREATOR"

# Nombre de carpeta -> repositorio. Los nombres de carpeta IMPORTAN: hay codigo
# y notas que los nombran tal cual.
$Repos = [ordered]@{
  "TATTOO_FLASH_CREATOR" = "https://github.com/marionayongmeiferre/KAOS.REALM.git"
  "AI_TATTOO_POST_EDIT"  = "https://github.com/marionayongmeiferre/AI_TATTOO_POST_EDIT.git"
  "AI_CONTENT_PLANNER"   = "https://github.com/marionayongmeiferre/AI-content-planner-app.git"
  "AI_REEL_EDITOR"       = "https://github.com/marionayongmeiferre/AI-VIDEO-EDITOR.git"
}

if (-not (Test-Path $Raiz)) { New-Item -ItemType Directory -Force $Raiz | Out-Null }

Write-Host ""
Write-Host "=== TRAYENDO EL CODIGO ==="
foreach ($nombre in $Repos.Keys) {
  $d = Join-Path $Raiz $nombre
  if (Test-Path (Join-Path $d ".git")) {
    Push-Location $d
    # --ff-only: si aqui hubiera trabajo sin subir, PARA en vez de mezclar a lo
    # loco. Mezclar sin mirar es como se pierde trabajo.
    git pull --ff-only 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $nombre : al dia" }
    else { Write-Host "  $nombre : OJO, aqui hay cambios sin subir. No lo toco. Dimelo." }
    Pop-Location
  } elseif ($Primera) {
    Write-Host "  $nombre : clonando..."
    git clone -q $Repos[$nombre] $d 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $nombre : listo" } else { Write-Host "  $nombre : no he podido clonar" }
  } else {
    Write-Host "  $nombre : no esta. Usa -Primera para traerlo."
  }
}

# --- la galeria -----------------------------------------------------------
Write-Host ""
Write-Host "=== GALERIA Y MEMORIAS ==="
$sincro = Join-Path $Flash "sincro"
$galeria = Join-Path $sincro "galeria.json"
$dataDir = Join-Path $Flash ".data"
if (Test-Path $galeria) {
  if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force $dataDir | Out-Null }
  $destino = Join-Path $dataDir "state.json"
  # Si aqui ya habia una galeria, se guarda con fecha ANTES de pisarla. Nunca
  # se sobrescribe el trabajo de nadie sin dejar por donde volver.
  if (Test-Path $destino) {
    $sello = Get-Date -Format "yyyyMMdd-HHmmss"
    Copy-Item $destino (Join-Path $dataDir "state.ANTES-DE-BAJAR-$sello.json") -Force
    Write-Host "  la galeria que habia aqui: guardada como state.ANTES-DE-BAJAR-$sello.json"
  }
  Copy-Item $galeria $destino -Force
  Write-Host "  galeria: puesta"
} else {
  Write-Host "  galeria: no venia ninguna"
}

# --- memorias de Claude ---------------------------------------------------
$mem = Join-Path $sincro "claude-memoria"
if (Test-Path $mem) {
  $claudeProj = Join-Path $env:USERPROFILE ".claude\projects"
  # Primero, tal cual venian.
  Get-ChildItem $mem -Directory | ForEach-Object {
    robocopy $_.FullName (Join-Path $claudeProj (Join-Path $_.Name "memory")) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  }

  # Y ADEMAS con el nombre que le toca en ESTE ordenador.
  #
  # Claude nombra la carpeta de memoria a partir de la ruta de trabajo:
  # "C:\3D DOCUMENTS\TATTOO" se convierte en "C--3D-DOCUMENTS-TATTOO". Si aqui
  # la carpeta esta en otro sitio, el nombre es otro y Claude no encontraria
  # nada — tendria la memoria en el disco y aun asi no sabria quien eres.
  #
  # Como no esta escrito en ninguna parte si el guion bajo se cambia o se
  # respeta, se dejan las DOS versiones. Son 55 KB: sale mas barato copiar de
  # mas que adivinar mal.
  $origen = Join-Path $mem "C--3D-DOCUMENTS-TATTOO"
  if (Test-Path $origen) {
    $claves = @(
      ($Raiz -replace '[^A-Za-z0-9_]', '-'),
      ($Raiz -replace '[^A-Za-z0-9]', '-')
    ) | Select-Object -Unique
    foreach ($k in $claves) {
      if ($k -eq "C--3D-DOCUMENTS-TATTOO") { continue }
      robocopy $origen (Join-Path $claudeProj (Join-Path $k "memory")) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
      Write-Host "  memorias tambien como: $k"
    }
  }
  Write-Host "  memorias de Claude: puestas"
}
$normas = Join-Path $sincro "CLAUDE-general.md"
if (Test-Path $normas) {
  $claudeDir = Join-Path $env:USERPROFILE ".claude"
  if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Force $claudeDir | Out-Null }
  Copy-Item $normas (Join-Path $claudeDir "CLAUDE.md") -Force
  Write-Host "  normas generales: puestas"
}

# --- librerias ------------------------------------------------------------
# Se instalan solas. Son las que NO viajan por git a proposito: pesan gigas y
# se rehacen con un comando.
Write-Host ""
Write-Host "=== LIBRERIAS (la primera vez tarda un rato) ==="
foreach ($nombre in $Repos.Keys) {
  $d = Join-Path $Raiz $nombre
  if (-not (Test-Path $d)) { continue }
  if ((Test-Path (Join-Path $d "package.json")) -and -not (Test-Path (Join-Path $d "node_modules"))) {
    Write-Host "  $nombre : npm install..."
    Push-Location $d; npm install --silent 2>&1 | Out-Null; Pop-Location
  }
  if ((Test-Path (Join-Path $d "requirements.txt")) -and -not (Test-Path (Join-Path $d "venv"))) {
    Write-Host "  $nombre : creando venv e instalando..."
    Push-Location $d
    python -m venv venv 2>&1 | Out-Null
    & (Join-Path $d "venv\Scripts\pip.exe") install -q -r requirements.txt 2>&1 | Out-Null
    Pop-Location
  }
}

Write-Host ""
Write-Host "LISTO. Arranca el servidor del flash creator y abre la app."
Write-Host "Tu galeria ya esta puesta."
Write-Host ""
