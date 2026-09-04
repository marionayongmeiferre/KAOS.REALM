---
name: feedback-ux-usage-study
description: "Instrumentar por defecto TODAS las interfaces de la usuaria con un registro de uso local, y proponerle semanalmente mejoras de UX basadas en normas reales"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4524105c-eb62-4b5d-aba0-c1ec1a29452e
  modified: 2026-08-26T00:00:00.000Z
---

Toda interfaz que Mariona use o que construyamos para ella lleva, **por defecto y sin que lo pida**, un registro de uso local (`usage.js`), y cada semana se le ofrece un informe de mejoras de UX derivado de esos datos.

**Why:** el 2026-08-12, rediseñando `TATTOO_FLASH_CREATOR`, propuse "subir UPLOAD arriba porque es lo primero que necesitas". Ella preguntó "upload para que lo necesito?" y tenía razón: el código mostraba que `uploadBtn` y el lienzo vacío llamaban ambos a `fileInput.click()`, y además funcionaban arrastrar y pegar. El botón sobraba entero. Mi diagnóstico de UX, hecho mirando una captura, estaba **invertido**. De ahí la conclusión: las decisiones de UX se toman con datos de uso reales, no con mis suposiciones. Ella lo pidió como estándar permanente para todas sus interfaces.

**How to apply:**

1. **Instrumentar.** Copiar `usage.js` de `c:\3D DOCUMENTS\TATTOO\TATTOO_FLASH_CREATOR\usage.js` y cargarlo al final del HTML. Registra id del control, etiqueta visible, pestaña/modal activo, orden, `dwell` (ms por paso) y `rep` (pulsaciones seguidas = fricción). Guarda en `localStorage` (`kaos.usage.v1`, anillo de 3000) y, si hay servidor, POST a `/api/usage` → `.data/usage.json`.
   **Nunca registrar** imágenes, nombres de archivo, contenido de diseños, texto escrito ni API keys. Solo interacción. Todo local, nunca sale de su red.

2. **Analizar con normas reales, no a ojo.** Invocar las skills instaladas antes de opinar: `ui-ux-pro-max`, `uxui-principles`, `a11y-architect`, `wcag-audit-patterns`, `accessibility-compliance-accessibility-audit`, `ux-audit`, `ui-review`. Aplicar también [[feedback_ui_design_standard]] (calidad awwwards, nada de UI genérica encajonada).
   Señales a buscar en los datos: controles con 0 pulsaciones (candidatos a borrar), `rep` alto (algo falla ahí), `dwell` alto (confuso o lento), secuencias frecuentes (merecen estar juntas y arriba), pasos que siempre preceden a otro (candidatos a fusionar).

3. **Ofrecer, no imponer — mecanismo semanal.** NO usar `/schedule`: las rutinas corren en la nube y no pueden leer ni `.data/usage.json` ni el `localStorage` de su navegador, ambos locales. En su lugar, marcador en disco:

   `c:\3D DOCUMENTS\TATTOO\.ux-review.json` → `{ lastReview: 1786450415668, lastFindings: 3 }` (epoch ms).

   Al empezar cualquier sesión que toque una de sus interfaces: leer el marcador. Si han pasado ≥7 días y hay datos de uso nuevos, ofrecer en UNA línea ("van N días de uso registrado, ¿te enseño lo que he visto?"). Solo si dice que sí, dar el detalle. Actualizar `lastReview` al revisar. Nunca aplicar cambios de UI sin su visto bueno.

4. **Nunca probar con navegador automático contra su servidor vivo.** El 2026-08-26 lancé Edge headless contra el 8787 para verificar cambios. Ese navegador arranca con `localStorage` vacío, `usage.js` empujó una lista de 2 eventos y `/api/usage` **sobrescribía el fichero entero**: se llevó por delante 1849 pulsaciones (13 días). Arreglado en `server.js`: ahora funde por `t|id` en vez de reemplazar, y guarda hasta 6000. Aun así, en las pruebas automáticas hay que anular `pushToServer` antes de tocar nada.

5. **Verificar antes de afirmar.** Antes de decir "esto sobra" o "esto debería estar arriba", **leer el código** para confirmar qué hace de verdad el control. El error del UPLOAD nació de no hacerlo.

Estado de instrumentación (2026-08-12), todo bajo `c:\3D DOCUMENTS\TATTOO`:

| Interfaz | Estado |
|---|---|
| `TATTOO_FLASH_CREATOR/` | instrumentada + servidor propio → `.data/usage.json` |
| `calculadora-precios-tattoo.html` | instrumentada, solo `localStorage` (no tiene servidor) |
| `AI_TATTOO_POST_EDIT/static/index.html` | instrumentada; `app.py` **sí** tiene ruta `/api/usage` (comprobado 2026-08-26, línea 240). Ojo: se abre desde `server.js` en el 8787, que NO reenvía `/api/usage` a Python, así que sus pulsaciones caen en el fichero del flash. Por eso cada página lleva `<meta name="kaos-app">` y cada evento guarda `app` |
| `content-planner-app/` | **pendiente** — es React/Next, hay que cargar el script desde el layout, no vale meter un `<script>` en un HTML |
| `Golden Cat/` | no aplica — el único HTML es una página de Telegram guardada, no una interfaz suya |

Relacionado: [[feedback_ui_design_standard]]. Las normas permanentes (caveman, ahorro de
tokens, Papelera, verificar antes de afirmar) están en `~\.claude\CLAUDE.md`.
