---
name: feedback-ahorrar-tokens
description: Quiere gastar menos tokens; compactar cuando la conversación se alarga y responder sin volcados largos.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4f272559-ffd4-40d6-b27b-3009059338fe
  modified: 2026-08-12T10:40:38.147Z
---

Compactar la conversación cuando acumule mucho texto, y en general evitar respuestas largas o volcados de salida de comandos.

**Why:** Lo pidió explícitamente para gastar menos tokens ("/compact siempre que haya mucho texto en la conversacion para gastar menos tokens"). Las sesiones de este proyecto se alargan mucho porque cada verificación con navegador y cada comprobación de servidor generan salida abundante.

**How to apply:** `/compact` solo puede lanzarlo ella — no es una herramienta invocable; si la conversación se alarga, sugerírselo en una línea. Por mi parte: filtrar la salida de los comandos en vez de volcarla entera (`grep`, `tail`, `Select-Object`), no repetir lo ya establecido, y dar solo la cifra o el resultado que decide algo.

El umbral de aviso y el porqué del número están en `~\.claude\CLAUDE.md`, norma 2.
