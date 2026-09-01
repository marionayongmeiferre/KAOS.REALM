# Identidad de marca

La marca de Mariona (paleta, tono de voz, pilares de contenido, reglas de gancho) vive en un único sitio: `../AI_CONTENT_PLANNER/BRAND-BOOK.md`.

Leerlo antes de generar o editar cualquier diseño, flash, copy o miniatura para su cuenta — no reinventar tono ni paleta aquí, ni duplicar su contenido en este archivo. Si algo de marca cambia, se edita en el brand book, no aquí.

# POST EDIT vive en otra carpeta

La sección POST EDIT **no** es código de aquí: es `../AI_TATTOO_POST_EDIT`, un
servidor Python aparte que se incrusta en un iframe. Va aparte porque el recorte
de fondo lo hace **rembg**, una red neuronal de 470 MB que no corre ni en Node ni
en el navegador. El recorte que hay aquí (relleno por color desde las esquinas,
en `surreal.js`) sirve para un dibujo sobre papel blanco, no para separar a una
persona del fondo de una foto.

`server.js` le reenvía estas rutas y sólo estas — se comprobó una por una que no
chocan con las suyas (`/api/state`, `/api/sync`, `/api/usage`, `/api/asset/`):

    /static/  /assets/  /api/backgrounds  /api/logo
    /api/cutout  /api/smooth  /api/projects  /api/export

**Si tocas esa lista, o añades rutas nuevas a cualquiera de los dos servidores,
comprueba que siguen sin solaparse.** Un choque ahí no da error: simplemente una
de las dos apps deja de funcionar sin decir por qué.

Las 1300 líneas de `AI_TATTOO_POST_EDIT/static/app.js` (profundidad, neón,
gizmos, proyectos guardados) están probadas y **no se reescriben** sólo para que
compartan pestaña. Si algo del editor falla, se arregla allí.
