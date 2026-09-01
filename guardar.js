/* KAOS_GUARDAR — una sola escalera de guardado para toda la app.
 *
 * Por que existe: habia cinco copias distintas de esto (app.js, scan.js,
 * store.js, carrusel.js, reel-ui.js) y NO eran iguales. Las de scan.js y
 * store.js probaban a compartir ANTES que a guardar, y en Windows
 * `navigator.canShare` dice que si, el panel de compartir se abre, no tiene
 * "guardar como"... y la foto no se guarda en ninguna parte. De ahi que
 * algunos botones de EXPORT no hicieran nada util.
 *
 * El orden correcto, y el motivo de cada peldaño:
 *   1. Carpeta de lote ya elegida — cuando exporta 12 diseños de golpe no se
 *      le pregunta 12 veces.
 *   2. "Guardar como" de verdad (showSaveFilePicker). Solo existe en
 *      ordenador. El `id` hace que la ventana vuelva a abrirse en la ultima
 *      carpeta que uso, asi que a partir de la segunda vez es un clic.
 *   3. Menu de compartir. SOLO si el peldaño 2 no existe, o sea: en el iPad.
 *      Alli es la unica puerta a la app Fotos, que es donde ella las quiere.
 *      En ordenador este peldaño se salta a proposito.
 *   4. Descargas de toda la vida.
 *
 * Nunca guarda sola en un sitio que ella no haya elegido: si le da a cancelar,
 * no pasa nada y no se escribe nada.
 */
(function (root) {
  "use strict";

  const puedeGuardarComo = typeof root.showSaveFilePicker === "function";
  const puedeElegirCarpeta = typeof root.showDirectoryPicker === "function";

  // En el iPad no hay "guardar como". Se detecta por lo que el navegador sabe
  // hacer, no por el nombre del aparato: los nombres mienten y cambian.
  const enTableta = !puedeGuardarComo && !!(root.navigator && root.navigator.canShare);

  const TIPOS = {
    png:  { desc: "Imagen PNG",  mime: "image/png",       ext: [".png"] },
    jpg:  { desc: "Foto JPG",    mime: "image/jpeg",      ext: [".jpg", ".jpeg"] },
    jpeg: { desc: "Foto JPG",    mime: "image/jpeg",      ext: [".jpg", ".jpeg"] },
    json: { desc: "Copia de seguridad", mime: "application/json", ext: [".json"] },
    webm: { desc: "Video WEBM",  mime: "video/webm",      ext: [".webm"] },
    mp4:  { desc: "Video MP4",   mime: "video/mp4",       ext: [".mp4"] },
  };
  function tipoDe(nombre) {
    const e = String(nombre || "").split(".").pop().toLowerCase();
    return TIPOS[e] || TIPOS.png;
  }

  let carpetaLote = null;

  async function escribirEn(handle, blob) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }

  /* Pregunta UNA vez la carpeta para un lote de varios ficheros. Si dice que
     no, o el navegador no sabe, se guarda de uno en uno como siempre. */
  async function abrirCarpeta(cuantos, id) {
    carpetaLote = null;
    if (!puedeElegirCarpeta || !(cuantos > 1)) return false;
    try {
      carpetaLote = await root.showDirectoryPicker({
        id: id || "kaosFlash", mode: "readwrite", startIn: "pictures",
      });
      return true;
    } catch (e) {
      carpetaLote = null;   // cancelar no es un fallo
      return false;
    }
  }
  function cerrarCarpeta() { carpetaLote = null; }

  /* Devuelve como ha acabado la cosa, para que quien llama pueda avisarla:
     "carpeta" | "fichero" | "compartido" | "descargas" | "cancelado" */
  async function fichero(blob, nombre, opciones) {
    if (!blob) return "cancelado";
    const t = tipoDe(nombre);
    const id = (opciones && opciones.id) || "kaosFlash";

    if (carpetaLote) {
      try {
        await escribirEn(await carpetaLote.getFileHandle(nombre, { create: true }), blob);
        return "carpeta";
      } catch (e) {
        console.warn("no se pudo escribir en la carpeta elegida", e);
        carpetaLote = null;
      }
    }

    if (puedeGuardarComo) {
      try {
        const h = await root.showSaveFilePicker({
          suggestedName: nombre,
          id: id,
          startIn: "pictures",
          types: [{ description: t.desc, accept: { [t.mime]: t.ext } }],
        });
        await escribirEn(h, blob);
        return "fichero";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelado";
        // SecurityError: tardo tanto en generarse que el navegador ya no lo
        // considera hijo de su clic. No es culpa suya: cae a Descargas.
        console.warn("guardar como no disponible esta vez", e);
      }
    } else {
      // Solo aqui, o sea solo en el iPad. Es el camino a Fotos.
      try {
        const f = new File([blob], nombre, { type: t.mime });
        if (root.navigator.canShare && root.navigator.canShare({ files: [f] })) {
          await root.navigator.share({ files: [f] });
          return "compartido";
        }
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelado";
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return "descargas";
  }

  async function imagen(canvas, nombre, opciones) {
    const t = tipoDe(nombre);
    const calidad = (opciones && opciones.calidad) || 0.95;
    const blob = await new Promise((res) => canvas.toBlob(res, t.mime, calidad));
    if (!blob) return "cancelado";
    return fichero(blob, nombre, opciones);
  }

  /* Frase para el aviso, para no repetirla en cinco sitios. */
  function comoFue(resultado, nombre) {
    if (resultado === "cancelado") return "";
    if (resultado === "compartido") return "Elige «Guardar imagen» para que vaya a Fotos.";
    if (resultado === "descargas") return "Guardado en Descargas: " + nombre;
    if (resultado === "carpeta") return "Guardado en la carpeta que elegiste.";
    return "Guardado: " + nombre;
  }

  root.KAOS_GUARDAR = {
    fichero: fichero,
    imagen: imagen,
    abrirCarpeta: abrirCarpeta,
    cerrarCarpeta: cerrarCarpeta,
    comoFue: comoFue,
    puedeGuardarComo: puedeGuardarComo,
    enTableta: enTableta,
  };
})(window);
