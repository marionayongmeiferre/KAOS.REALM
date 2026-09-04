# SUBIR-TODO.ps1
#
# Sube TODO a GitHub con un solo comando: codigo, galeria y memorias.
#
#     & "C:\3D DOCUMENTS\TATTOO\TATTOO_FLASH_CREATOR\SUBIR-TODO.ps1"
#
# No pregunta nada y no borra nada. Si un repositorio no tiene cambios, lo
# dice y pasa al siguiente.
#
# QUE SUBE, Y POR QUE ESTA AQUI Y NO EN .gitignore
#
#   sincro\galeria.json        copia de .data\state.json (unos 10 MB)
#   sincro\claude-memoria\     las notas de Claude sobre tu manera de trabajar
#   sincro\CLAUDE-general.md   tus normas de siempre
#
# `.data\` sigue ignorado a proposito: lo reescribe el servidor cada vez que
# tocas un diseno y no puede ir a git tal cual. Esta copia de `sincro\` se hace
# SOLO cuando ejecutas este script, o sea cuando tu decides que este es un buen
# momento para guardar. Cuesta unos 10 MB por subida; si algun dia el
# repositorio se hace pesado, se saca esta parte a iCloud y ya.
#
# LO QUE NO SUBE: los transcripts de las conversaciones (963 MB), node_modules
# y venv. Ni son tuyos ni hacen falta fuera de este ordenador.

$ErrorActionPreference = "Continue"
# La carpeta madre sale de DONDE ESTA ESTE SCRIPT, no escrita a mano: el script
# vive en <raiz>\TATTOO_FLASH_CREATOR, asi que la raiz es la carpeta de encima.
# Asi funciona igual en "C:\3D DOCUMENTS\TATTOO" que en "C:\CLAUDE_TREBALLS" o
# donde sea, sin tocar una linea.
$Raiz = Split-Path $PSScriptRoot -Parent
$Flash = Join-Path $Raiz "TATTOO_FLASH_CREATOR"

Write-Host ""
Write-Host "=== PREPARANDO LO QUE NO ES CODIGO ==="

# --- la galeria -----------------------------------------------------------
$sincro = Join-Path $Flash "sincro"
if (-not (Test-Path $sincro)) { New-Item -ItemType Directory -Force $sincro | Out-Null }
$estado = Join-Path $Flash ".data\state.json"
if (Test-Path $estado) {
  Copy-Item $estado (Join-Path $sincro "galeria.json") -Force
  $mb = [math]::Round((Get-Item $estado).Length / 1MB, 1)
  Write-Host "  galeria: $mb MB"
} else {
  Write-Host "  galeria: aun no hay .data\state.json (normal si nunca has abierto la app aqui)"
}

# --- las memorias de Claude ----------------------------------------------
# Solo las carpetas `memory`. El resto de `.claude\projects` son transcripts de
# conversaciones: casi un giga, y no sirven de nada en otro ordenador.
$claudeProj = Join-Path $env:USERPROFILE ".claude\projects"
$memDestino = Join-Path $sincro "claude-memoria"
if (Test-Path $claudeProj) {
  if (-not (Test-Path $memDestino)) { New-Item -ItemType Directory -Force $memDestino | Out-Null }
  Get-ChildItem $claudeProj -Directory | ForEach-Object {
    $m = Join-Path $_.FullName "memory"
    if (Test-Path $m) {
      robocopy $m (Join-Path $memDestino $_.Name) /E /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
    }
  }
  Write-Host "  memorias de Claude: copiadas"
}
$normas = Join-Path $env:USERPROFILE ".claude\CLAUDE.md"
if (Test-Path $normas) {
  Copy-Item $normas (Join-Path $sincro "CLAUDE-general.md") -Force
  Write-Host "  normas generales: copiadas"
}

# --- subir cada repositorio ----------------------------------------------
$repos = @("TATTOO_FLASH_CREATOR", "AI_TATTOO_POST_EDIT", "AI_CONTENT_PLANNER", "AI_REEL_EDITOR")
$fecha = Get-Date -Format "yyyy-MM-dd HH:mm"

Write-Host ""
Write-Host "=== SUBIENDO ==="
foreach ($r in $repos) {
  $d = Join-Path $Raiz $r
  if (-not (Test-Path (Join-Path $d ".git"))) { Write-Host "  $r : no es un repositorio, salto"; continue }

  Push-Location $d
  $hay = git status --porcelain
  if ([string]::IsNullOrWhiteSpace($hay)) {
    # Aunque no haya cambios, puede haber commits de otra vez sin subir.
    git push 2>&1 | Out-Null
    Write-Host "  $r : sin cambios"
    Pop-Location
    continue
  }
  git add -A 2>&1 | Out-Null
  git commit -q -m "Trabajo del $fecha

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" 2>&1 | Out-Null
  $rama = git branch --show-current
  git push origin $rama 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  $r : subido"
  } else {
    # Lo normal: has subido algo desde el otro ordenador. Se trae primero y se
    # reintenta. Si aun asi falla, se dice y NO se fuerza nada: forzar aqui
    # seria machacar el trabajo del otro sitio.
    Write-Host "  $r : hay algo nuevo en GitHub, lo traigo primero..."
    git pull --rebase 2>&1 | Out-Null
    git push origin $rama 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "  $r : subido" }
    else { Write-Host "  $r : NO he podido subir. Dimelo y lo miro." }
  }
  Pop-Location
}

Write-Host ""
Write-Host "LISTO. En el otro ordenador ejecuta BAJAR-TODO.ps1"
Write-Host ""
