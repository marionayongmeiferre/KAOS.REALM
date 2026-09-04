---
name: feedback-video-permiso
description: Nunca procesar/editar vídeos sin permiso explícito previo del usuario
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5f5598c7-c129-498e-a696-7a0a942d378b
  modified: 2026-08-01T07:46:46.861Z
---

Nunca ejecutar procesamiento de vídeo (transcripción, subtítulos, ffmpeg, render, exportar) sin pedir permiso explícito antes de correr el comando, aunque el usuario ya haya pedido la tarea en general o pasado el archivo.

**Why:** Usuario corrigió tras que se procesara REEL_3D.mp4 (transcripción + subtítulos + burn-in ffmpeg) sin confirmación explícita del paso de ejecución, aunque había pedido la funcionalidad.

**How to apply:** Antes de cualquier acción que toque/genere/exporte un archivo de vídeo (transcribir, generar subs, ffmpeg render, cortar, etc.), parar y preguntar confirmación explícita en chat, incluso si el usuario ya describió el resultado deseado o subió el archivo. Aplica también a otras tareas de vídeo futuras en este proyecto, no solo subtítulos.
