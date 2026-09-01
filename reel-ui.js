// KAOS.REALM — panel del reel de ruleta (v1)
//
// Sólo pantalla: elegir diseños, escribir la frase y el CTA, ver la previa y
// dar a grabar. Toda la pintura y la grabación viven en reel.js.
(function (root) {
  "use strict";

  const REEL = root.KAOS_REEL;
  const GAL = root.KAOS_GALLERY;
  if (!REEL || !GAL) { console.warn("reel-ui: falta reel.js o gallery.js"); return; }

  const $ = (s) => document.querySelector(s);
  const D = {
    openBtn:  $("#reelOpenBtn"),
    modal:    $("#reelModal"),
    closeBtn: $("#reelCloseBtn"),
    canvas:   $("#reelCanvas"),
    tira:     $("#reelTira"),
    addBtn:   $("#reelAddBtn"),
    flashDay: $("#reelFlashDayBtn"),
    clearBtn: $("#reelClearBtn"),
    hojaSel:  $("#reelHojaSel"),
    colFrase: $("#reelColFrase"),
    colCta:   $("#reelColCta"),
    colHand:  $("#reelColHandle"),
    colMarco: $("#reelColMarco"),
    marcoAv:  $("#reelMarcoAviso"),
    fondoSel: $("#reelFondoSel"),
    frase:    $("#reelFrase"),
    cta:      $("#reelCta"),
    dur:      $("#reelDur"),
    durVal:   $("#reelDurVal"),
    vidInput: $("#reelVideoInput"),
    vidBtn:   $("#reelVideoBtn"),
    vidQuit:  $("#reelVideoQuitBtn"),
    fondoInp: $("#reelFondoInput"),
    fondoBtn: $("#reelFondoBtn"),
    playBtn:  $("#reelPlayBtn"),
    recBtn:   $("#reelRecBtn"),
    status:   $("#reelStatus"),
    aviso:    $("#reelAviso"),
  };
  if (!D.modal || !D.openBtn) { console.warn("reel-ui: falta el marcado"); return; }

  let st = REEL.estado();
  let pararPrevia = null;
  let grabando = false;

  function items() {
    const all = GAL.load();
    return st.ids.map(id => all.find(x => x.id === id)).filter(Boolean);
  }
  function decir(txt, malo) {
    D.status.textContent = txt || "—";
    D.status.classList.toggle("warn", !!malo);
  }

  // ---------------------------------------------------------------- tira
  function pintarTira() {
    const list = items();
    D.tira.textContent = "";
    list.forEach((it, i) => {
      const c = document.createElement("div");
      c.className = "reel-chip";
      const im = document.createElement("img");
      im.src = it.thumbUrl || it.layerUrl;
      im.alt = "";
      const n = document.createElement("span");
      n.className = "reel-chip-n";
      n.textContent = String(i + 1);
      const x = document.createElement("button");
      x.className = "reel-chip-x";
      x.textContent = "✕";
      x.title = "Quitar del reel";
      x.addEventListener("click", () => {
        st.ids = st.ids.filter(id => id !== it.id);
        REEL.guardar(st);
        pintarTira();
      });
      c.append(im, n, x);
      D.tira.appendChild(c);
    });
    const n = list.length;
    D.recBtn.disabled = n < 2 || grabando;
    D.playBtn.disabled = n < 2;
    decir(n ? n + " diseños en la ruleta" : "Añade al menos 2 diseños.");
    if (n) dibujarQuieto();
  }

  // Un fotograma fijo para que vea el encuadre sin tener que darle a PREVIA.
  async function dibujarQuieto() {
    const list = items();
    if (!list.length) return;
    const piezas = await REEL.preparar(st, list);
    REEL.pintarFrame(D.canvas.getContext("2d"), piezas, st.dur - 0.01);
  }

  // ---------------------------------------------------------------- elegir
  function pedirDiseno(alElegir, titulo, filtro) {
    document.dispatchEvent(new CustomEvent("kaos-pedir-diseno", {
      detail: { alElegir: alElegir, titulo: titulo, filtro: filtro },
    }));
  }
  D.addBtn.addEventListener("click", () => {
    const puestos = new Set(st.ids);
    pedirDiseno((it) => {
      st.ids.push(it.id);
      REEL.guardar(st);
      pintarTira();
    }, "Añadir al reel", (it) => !puestos.has(it.id));
  });
  D.flashDay.addEventListener("click", () => {
    // El atajo obvio: el reel de ruleta es justo para anunciar el flash day.
    const ids = GAL.conTag("FLASH DAY").map(it => it.id);
    if (!ids.length) { decir("No hay ningún diseño marcado como FLASH DAY.", true); return; }
    st.ids = ids.slice(0, 12);   // más de 12 no se distinguen a esa velocidad
    REEL.guardar(st);
    pintarTira();
  });
  D.clearBtn.addEventListener("click", () => {
    st.ids = [];
    REEL.guardar(st);
    pintarTira();
  });

  // ------------------------------------------------- desde una hoja guardada
  // El atajo que pidió: si ya montó el flash post, los diseños ya están
  // elegidos y en orden; no tiene sentido volver a picarlos uno a uno.
  function pintarHojas() {
    if (!D.hojaSel) return;
    const list = (root.KAOS_STORE && root.KAOS_STORE.sessions) ? root.KAOS_STORE.sessions() : [];
    D.hojaSel.textContent = "";
    const cero = document.createElement("option");
    cero.value = "";
    cero.textContent = list.length ? "— elige una hoja —" : "— no tienes hojas guardadas —";
    D.hojaSel.appendChild(cero);
    for (const h of list) {
      const n = (h.data && h.data.selectedIds) ? h.data.selectedIds.length : 0;
      const o = document.createElement("option");
      o.value = h.id;
      o.textContent = h.name + " · " + n + " diseños";
      D.hojaSel.appendChild(o);
    }
    D.hojaSel.value = "";
  }
  if (D.hojaSel) D.hojaSel.addEventListener("change", () => {
    const id = D.hojaSel.value;
    if (!id) return;
    const h = root.KAOS_STORE.getSession(id);
    const ids = (h && h.data && h.data.selectedIds) || [];
    // Los diseños de una hoja vieja pueden haberse borrado de la galería. Se
    // filtran aquí para que no salgan huecos negros en la ruleta.
    const hay = new Set(GAL.load().map(x => x.id));
    const buenos = ids.filter(x => hay.has(x));
    if (!buenos.length) { decir("Esa hoja ya no tiene diseños en la galería.", true); D.hojaSel.value = ""; return; }
    st.ids = buenos.slice(0, 12);
    REEL.guardar(st);
    pintarTira();
    const perdidos = ids.length - buenos.length;
    const recorte = buenos.length > 12 ? " (me quedo con los 12 primeros: más no se distinguen)" : "";
    decir("Cargados " + st.ids.length + " diseños de «" + h.name + "»"
      + (perdidos ? ", " + perdidos + " ya no están en la galería" : "") + recorte);
    D.hojaSel.value = "";
  });

  // ------------------------------------------------------ colores del texto
  function enlazarColor(sel, campo, conAuto) {
    if (!sel) return;
    sel.textContent = "";
    if (conAuto) {
      // Sólo el marco. Es la opción buena por defecto: el fondo lo elige ella y
      // cualquier color fijo acaba tarde o temprano encima de un fondo del
      // mismo color, y ahí el marco desaparece.
      const a = document.createElement("option");
      a.value = "auto";
      a.textContent = "AUTO (contrasta con el fondo)";
      sel.appendChild(a);
    }
    for (const k in REEL.PALETA) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = REEL.PALETA[k].nombre;
      sel.appendChild(o);
    }
    sel.value = st[campo] || "secondary";
    sel.addEventListener("change", () => {
      st[campo] = sel.value;
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  enlazarColor(D.colFrase, "colFrase");
  enlazarColor(D.colMarco, "colMarco", true);
  enlazarColor(D.colCta, "colCta");
  enlazarColor(D.colHand, "colHandle");

  // Marco y frase del mismo color no rompen nada, pero el marco deja de hacer
  // su trabajo: si los dos son verde lima, el ojo ve una sola mancha de color y
  // el titular ya no destaca. No se le prohíbe — se le avisa y decide ella.
  function avisarMarco() {
    if (!D.marcoAv) return;
    D.marcoAv.hidden = st.colMarco !== st.colFrase;
  }
  if (D.colFrase) D.colFrase.addEventListener("change", avisarMarco);
  if (D.colMarco) D.colMarco.addEventListener("change", avisarMarco);
  avisarMarco();

  // ------------------------------------------------------------ fondo fijo
  // Un desplegable con todas las recetas más la opción de que vayan rotando,
  // que es como estaba antes. Se llena al abrir, no aquí: las fotos que ella
  // sube entran en la lista y hay que releerlas cada vez.
  function pintarFondos() {
    if (!D.fondoSel) return;
    const recs = REEL.recetas(st);
    D.fondoSel.textContent = "";
    recs.forEach((r, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.nombre || ("FONDO " + (i + 1));
      D.fondoSel.appendChild(o);
    });
    const rot = document.createElement("option");
    rot.value = "rotar";
    rot.textContent = "— uno distinto por diseño —";
    D.fondoSel.appendChild(rot);
    D.fondoSel.value = st.fondoFijo === false ? "rotar"
      : String((st.fondoIdx || 0) % Math.max(1, recs.length));
  }
  if (D.fondoSel) D.fondoSel.addEventListener("change", () => {
    if (D.fondoSel.value === "rotar") { st.fondoFijo = false; }
    else { st.fondoFijo = true; st.fondoIdx = parseInt(D.fondoSel.value, 10) || 0; }
    REEL.guardar(st);
    dibujarQuieto();
  });

  // ---------------------------------------------------------------- ajustes
  function enlazarTexto(el, campo) {
    el.value = st[campo] || "";
    el.addEventListener("input", () => {
      st[campo] = el.value;
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  enlazarTexto(D.frase, "frase");
  enlazarTexto(D.cta, "cta");

  D.dur.value = st.dur;
  D.durVal.textContent = st.dur + "s";
  D.dur.addEventListener("input", () => {
    st.dur = parseFloat(D.dur.value);
    D.durVal.textContent = st.dur + "s";
    REEL.guardar(st);
  });

  D.vidBtn.addEventListener("click", () => D.vidInput.click());
  D.vidInput.addEventListener("change", () => {
    const f = D.vidInput.files && D.vidInput.files[0];
    D.vidInput.value = "";
    if (!f) return;
    // objectURL, no data:. Un vídeo en base64 en localStorage reventaría la
    // cuota; además así no se copia el fichero a ningún sitio.
    if (st.fondoVideoUrl) URL.revokeObjectURL(st.fondoVideoUrl);
    st.fondoVideoUrl = URL.createObjectURL(f);
    D.vidQuit.disabled = false;
    decir("Vídeo de fondo puesto: " + f.name + " (se pierde al recargar la página).");
    dibujarQuieto();
  });
  D.vidQuit.addEventListener("click", () => {
    if (st.fondoVideoUrl) URL.revokeObjectURL(st.fondoVideoUrl);
    st.fondoVideoUrl = null;
    D.vidQuit.disabled = true;
    dibujarQuieto();
  });

  D.fondoBtn.addEventListener("click", () => D.fondoInp.click());
  D.fondoInp.addEventListener("change", async () => {
    const files = Array.prototype.slice.call(D.fondoInp.files || []);
    D.fondoInp.value = "";
    for (const f of files) {
      const data = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(f);
      });
      if (data) st.fondosPropios.push(data);
    }
    REEL.guardar(st);
    pintarFondos();
    decir(st.fondosPropios.length + " fotos tuyas disponibles como fondo.");
    dibujarQuieto();
  });

  // ---------------------------------------------------------------- previa
  D.playBtn.addEventListener("click", async () => {
    if (pararPrevia) { pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA"; return; }
    const list = items();
    if (list.length < 2) return;
    D.playBtn.textContent = "■ PARAR";
    const piezas = await REEL.preparar(st, list);
    pararPrevia = REEL.previsualizar(D.canvas, piezas, () => {
      pararPrevia = null;
      D.playBtn.textContent = "▶ PREVIA";
    });
  });

  // ---------------------------------------------------------------- grabar
  D.recBtn.addEventListener("click", async () => {
    const list = items();
    if (list.length < 2 || grabando) return;
    if (pararPrevia) { pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA"; }
    grabando = true;
    D.recBtn.disabled = true;
    const etiqueta = D.recBtn.textContent;
    try {
      const piezas = await REEL.preparar(st, list);
      decir("Grabando… tarda lo que dura el reel (" + st.dur + "s). No cambies de pestaña.");
      const out = await REEL.grabar(piezas, (p) => {
        D.recBtn.textContent = "GRABANDO " + Math.round(p * 100) + "%";
        REEL.pintarFrame(D.canvas.getContext("2d"), piezas, p * st.dur);
      });
      const nombre = "kaos-realm_reel_" + Date.now() + "." + out.ext;
      // "Guardar como" de Windows si el navegador lo tiene; si no, a Descargas
      // como siempre. Un reel pesa bastante y acaba en la carpeta que ella
      // quiera, no en el montón de Descargas.
      let guardado = false;
      if (typeof window.showSaveFilePicker === "function") {
        try {
          const h = await window.showSaveFilePicker({
            suggestedName: nombre,
            id: "kaosFlash",
            startIn: "videos",
            types: [{ description: "Vídeo", accept: { [out.blob.type || "video/mp4"]: ["." + out.ext] } }],
          });
          const w = await h.createWritable();
          await w.write(out.blob);
          await w.close();
          guardado = true;
        } catch (e) {
          if (e && e.name === "AbortError") { decir("Grabado, pero no lo has guardado."); return; }
          console.warn("guardar como no disponible", e);
        }
      }
      if (!guardado) {
        const url = URL.createObjectURL(out.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20000);
      }
      if (out.esMp4) {
        decir("Listo. " + (Math.round(out.blob.size / 1e5) / 10) + " MB en MP4, súbelo tal cual.");
        D.aviso.hidden = true;
      } else {
        // No es un detalle menor: Instagram no traga WebM. Decirlo claro.
        decir("Listo, pero ha salido en WebM.", true);
        D.aviso.hidden = false;
      }
    } catch (e) {
      decir(String((e && e.message) || e), true);
    } finally {
      grabando = false;
      D.recBtn.disabled = false;
      D.recBtn.textContent = etiqueta;
    }
  });

  // ---------------------------------------------------------------- abrir
  function abrir() {
    D.modal.style.display = "";
    D.canvas.width = REEL.W;
    D.canvas.height = REEL.H;
    D.vidQuit.disabled = !st.fondoVideoUrl;
    pintarHojas();
    pintarFondos();
    pintarTira();
  }
  function cerrar() {
    if (pararPrevia) { pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA"; }
    D.modal.style.display = "none";
  }
  D.openBtn.addEventListener("click", abrir);
  D.closeBtn.addEventListener("click", cerrar);
  D.modal.addEventListener("click", (e) => { if (e.target === D.modal) cerrar(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && D.modal.style.display !== "none") cerrar();
  });
})(window);
