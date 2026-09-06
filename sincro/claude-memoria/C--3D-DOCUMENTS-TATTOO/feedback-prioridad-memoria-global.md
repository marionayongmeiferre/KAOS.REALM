---
name: feedback-prioridad-memoria-global
description: "En este proyecto, la memoria global de Claude manda sobre cualquier CLAUDE.md del repositorio."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4f272559-ffd4-40d6-b27b-3009059338fe
  modified: 2026-08-12T10:44:51.663Z
---

En el proyecto `c:\3D DOCUMENTS\TATTOO`, las instrucciones de la memoria global de Claude (este directorio `memory/`, y un `~/.claude/CLAUDE.md` si algún día existe) tienen prioridad sobre un `CLAUDE.md` dentro del repositorio.

**Why:** Lo pidió explícitamente. Sus preferencias de trato — caveman, ahorro de tokens, permiso antes de procesar vídeo — son suyas y no deben quedar anuladas por un fichero de repo, que describe convenciones de código y que además puede haberlo generado yo.

**How to apply:** Si aparecen instrucciones en conflicto, gana lo global; el `CLAUDE.md` de un repo se aplica solo donde no choque (estilo de código, comandos de build, convenciones del proyecto).

Desde el 13 de agosto de 2026 la jerarquía es esta, de más manda a menos:

1. `~\.claude\CLAUDE.md` — normas permanentes, se cargan en TODAS las carpetas.
2. `C:\3D DOCUMENTS\TATTOO\CLAUDE.md` — normas de su marca de tatuaje, solo bajo esa carpeta.
3. Este directorio `memory\` — memorias de este proyecto.
4. `CLAUDE.md` de un repo concreto.

Relacionado: [[feedback-ahorrar-tokens]].
