// KAOS.REALM — sección POST EDIT
//
// Abre el editor de fotos (AI_TATTOO_POST_EDIT) dentro de un modal. El editor
// entero corre en Python, y server.js le reenvía las peticiones, así que desde
// el navegador sale de esta misma dirección — para ella es una sección más.
//
// Aquí sólo hay tres cosas: abrir, cerrar, y avisar en castellano llano cuando
// el servidor de Python no está arrancado. Sin eso el iframe se quedaría en
// blanco y no habría forma de saber por qué.
(function (root) {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const D = {
    openBtn:  $("#postEditOpenBtn"),
    modal:    $("#postEditModal"),
    closeBtn: $("#postEditCloseBtn"),
    reload:   $("#postEditReloadBtn"),
    frame:    $("#postEditFrame"),
    down:     $("#postEditDown"),
    downTitle:$("#postEditDownTitle"),
    downText: $("#postEditDownText"),
    diag:     $("#postEditDiag"),
    retry:    $("#postEditRetryBtn"),
  };
  if (!D.modal || !D.openBtn) { console.warn("postedit: falta el marcado"); return; }

  const SRC = "/static/index.html";

  // La ruta más barata del editor: no procesa nada, sólo lista los fondos.
  // Sirve para saber si Python está vivo antes de cargar el iframe.
  //
  // Devuelve el MOTIVO, no un sí/no. "No responde" a secas no distingue entre
  // el motor apagado, el portátil dormido y el iPad sin red, y son tres
  // arreglos distintos. Desde el iPad no hay consola donde mirarlo.
  async function comprobar() {
    let r;
    try {
      r = await fetch("/api/backgrounds", { cache: "no-store" });
    } catch (e) {
      return {
        ok: false,
        titulo: "no llego ni a KAOS.",
        texto: "Esta página está abierta, pero el servidor ya no contesta. "
             + "Suele ser que el portátil se ha dormido, ha perdido la red, o que "
             + "se cerró la ventana negra de «Iniciar KAOS.bat».",
        diag: "fetch falló: " + ((e && e.message) || e),
      };
    }

    if (r.ok) return { ok: true };

    // El 502 lo pone server.js cuando KAOS está vivo pero Python no. Trae su
    // propia explicación, así que se enseña esa en vez de inventar otra.
    if (r.status === 502) {
      let d = null;
      try { d = await r.json(); } catch (e) {}
      return {
        ok: false,
        titulo: "el motor de recorte no está arrancado.",
        texto: (d && d.detalle)
             || "Arráncalo con «Iniciar KAOS.bat», que enciende los dos.",
        diag: "502 · KAOS vivo, Python callado en el puerto " + ((d && d.puerto) || "8765"),
      };
    }

    return {
      ok: false,
      titulo: "el motor contestó algo raro.",
      texto: "Mira la ventana negra «KAOS motor de recorte» en el portátil: "
           + "ahí sale el error de verdad.",
      diag: "HTTP " + r.status + " " + (r.statusText || ""),
    };
  }

  async function cargar() {
    D.down.hidden = true;
    D.frame.style.display = "";
    D.reload.disabled = true;

    const estado = await comprobar();
    D.reload.disabled = false;

    if (estado.ok) {
      // Sello de tiempo para que al recargar no reviva la copia en caché,
      // que es justo lo que no quieres cuando algo acaba de fallar.
      D.frame.src = SRC + "?t=" + Date.now();
      return;
    }

    D.frame.removeAttribute("src");
    D.frame.style.display = "none";
    if (D.downTitle) D.downTitle.textContent = estado.titulo;
    if (D.downText) D.downText.textContent = estado.texto;
    if (D.diag) D.diag.textContent = estado.diag + " · " + new Date().toLocaleTimeString();
    D.down.hidden = false;
  }

  async function abrir() {
    D.modal.style.display = "";
    await cargar();
  }

  function cerrar() {
    D.modal.style.display = "none";
    // Se descarga el iframe al cerrar: el editor mantiene la foto a tamaño
    // completo en un canvas, y en el iPad eso acaba tumbando la pestaña si se
    // queda de fondo mientras trabajas en el composer.
    D.frame.removeAttribute("src");
  }

  D.openBtn.addEventListener("click", abrir);
  D.closeBtn.addEventListener("click", cerrar);
  D.reload.addEventListener("click", cargar);
  D.retry.addEventListener("click", cargar);

  // No cierra al tocar fuera, al revés que los otros modales: aquí dentro hay
  // trabajo sin guardar y un toque despistado en el borde se lo llevaría.
  // Sólo el botón y Escape.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && D.modal.style.display !== "none") cerrar();
  });

  root.KAOS_POSTEDIT = { abrir: abrir, cerrar: cerrar, cargar: cargar };
})(window);
