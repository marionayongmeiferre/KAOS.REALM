---
name: herramienta-calcador
description: "CALCADOR convierte una foto de referencia en medidas (puntas, simetría, contorno) para copiar siluetas sin dibujarlas a ojo."
metadata: 
  node_type: memory
  type: project
  originSessionId: 4524105c-eb62-4b5d-aba0-c1ec1a29452e
  modified: 2026-08-25T08:21:45.094Z
---

`C:\3D DOCUMENTS\TATTOO\CALCADOR\trazar.py` — se ejecuta con
`python trazar.py referencias\foto.jpg` y deja en `salida\` un `.json` con
medidas y un `.png` de comparación.

**Por qué:** para copiar las siluetas de sus referencias yo escribía las curvas
Bézier a ojo y corregía mirando capturas — el corazón gótico costó cuatro
rondas. El calcador saca el contorno real, la firma radial (hasta dónde llega la
tinta en cada ángulo), el orden de simetría por FFT y la simetría de espejo, así
que las proporciones salen medidas y no adivinadas.

**Cómo aplicarlo:** cuando pida copiar una forma nueva, pedirle que guarde la
foto en `CALCADOR\referencias\` y diga el nombre — yo no puedo escribir en disco
las imágenes que pega en el chat. Antes de escribir el código de la forma,
calcar y leer el JSON. Validado contra cinco figuras de geometría conocida en
`referencias\_pruebas\` (estrella de 8 → 8, cruz de 4 → 4, borrón asimétrico →
espejo 0.50 frente a 1.00 de los simétricos); si empieza a fallar, relanzar
sobre esas cinco para separar fallo de la herramienta y fallo de la foto.

Alimenta al generador de piezas de `TATTOO_FLASH_CREATOR\mandalas.js`, que es
parte de [[proyecto-content-planner-multinicho]].
