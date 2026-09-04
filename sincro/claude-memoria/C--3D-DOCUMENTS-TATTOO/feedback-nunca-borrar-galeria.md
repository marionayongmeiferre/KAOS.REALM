---
name: feedback-nunca-borrar-galeria
description: Nunca perder diseños de la galería del Flash Creator; son irremplazables y no hay papelera.
metadata:
  type: feedback
---

Los diseños de la galería de `TATTOO_FLASH_CREATOR` no se tocan nunca. Nada de
código que los tire para hacer sitio, ni borrados sin preguntar, ni "ya los
recupera el servidor".

**Why:** El 26 de agosto de 2026 perdió diseños sin enterarse. `saveRaw()` en
`gallery.js` guardaba la galería en localStorage y, cuando no cabía (8,44 MB de
diseños en un cajón de 5 MB), iba haciendo `items.pop()` en silencio hasta que
cabía. Cada diseño nuevo se comía uno viejo. Su reacción: "NUNCA ME BORRES LOS
DISEÑOS DE LA GALERIA". Son dibujos suyos, no hay copia en ningún otro sitio.

**How to apply:** La galería vive ahora en IndexedDB (`kaos.realm.gallery`), sin
el techo de 5 MB, y `saveRaw` ya no descarta nada. Antes de tocar cualquier cosa
que escriba la galería, comprobar que no puede perder filas. Si algo no cabe o
no se puede escribir, avisar — nunca recortar la lista. El servidor
(`.data/state.json`) une por id y no borra: es la copia buena.

Lo único que borra de verdad es la ✕ de cada tarjeta, un clic y sin confirmar.
Está pendiente ponerle confirmación y papelera. Ver [[condiciones-estudio-tattoo]].
