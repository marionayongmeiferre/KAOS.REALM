---
name: herramienta-calcador
description: "CALCADOR convierte una foto de referencia en medidas (puntas, simetría, contorno) para copiar siluetas sin dibujarlas a ojo."
metadata:
  node_type: memory
  type: project
  originSessionId: 4524105c-eb62-4b5d-aba0-c1ec1a29452e
  modified: 2026-09-05T09:10:00.000Z
---

`TATTOO_FLASH_CREATOR\herramientas\CALCADOR\trazar.py` — se ejecuta con
`python trazar.py referencias\foto.jpg` y deja en `salida\` un `.json` con
medidas y un `.png` de comparación.

**Ojo con la ruta:** vive DENTRO del repositorio del flash creator a propósito,
para que viaje al clonarlo. Antes colgaba de la carpeta madre (`CALCADOR\`) y
aquí estaba escrita la ruta absoluta `C:\3D DOCUMENTS\TATTOO\CALCADOR`; en su
segundo ordenador —donde la carpeta madre es `C:\CLAUDE_TREBALLS\TATTOO`— esa
ruta no existe, Claude pedía el calcador y no había manera de dárselo. La copia
de casa sigue en `CALCADOR\` con toda su `salida\`; la buena es la del
repositorio.

**Por qué existe:** para copiar las siluetas de sus referencias yo escribía las
curvas Bézier a ojo y corregía mirando capturas — el corazón gótico costó cuatro
rondas. El calcador saca el contorno real, la firma radial (hasta dónde llega la
tinta en cada ángulo), el orden de simetría por FFT y la simetría de espejo, así
que las proporciones salen medidas y no adivinadas.

**Cómo aplicarlo:** cuando pida copiar una forma nueva, pedirle que guarde la
foto en `herramientas\CALCADOR\referencias\` y diga el nombre — yo no puedo
escribir en disco las imágenes que pega en el chat. Antes de escribir el código
de la forma, calcar y leer el JSON. Validado contra cinco figuras de geometría
conocida en `referencias\_pruebas\` (estrella de 8 → 8, cruz de 4 → 4, borrón
asimétrico → espejo 0.50 frente a 1.00 de los simétricos); si empieza a fallar,
relanzar sobre esas cinco para separar fallo de la herramienta y fallo de la
foto.

`salida\` no viaja con el repositorio: son 181 ficheros de resultados que se
rehacen solos. Se crea la primera vez que se ejecuta.

Alimenta al generador de piezas de `TATTOO_FLASH_CREATOR\mandalas.js`, que es
parte de [[proyecto-content-planner-multinicho]].
