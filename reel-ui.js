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
    lento:    $("#reelLento"),
    lentoVal: $("#reelLentoVal"),
    barrido:  $("#reelBarrido"),
    barridoVal: $("#reelBarridoVal"),
    barridoTip: $("#reelBarridoTip"),
    parada:   $("#reelParada"),
    paradaVal: $("#reelParadaVal"),
    cierre:   $("#reelCierre"),
    cierreVal: $("#reelCierreVal"),
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

  // Cuántos diseños caben en una ruleta. Estaba en 12 porque el ritmo viejo no
  // dejaba ver más; ahora la pasada rápida se mide en segundos y da igual
  // cuántos haya, así que el tope es sólo para que la tira no sea infinita.
  const TOPE = 50;

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
    D.addBtn.disabled = n >= TOPE;
    pintarBarrido();
    decir(n ? n + " diseños en la ruleta" : "Añade al menos 2 diseños.");
    if (n) dibujarQuieto();
  }

  // Un fotograma fijo para que vea el encuadre sin tener que darle a PREVIA.
  async function dibujarQuieto() {
    const list = items();
    if (!list.length) return;
    const piezas = await REEL.preparar(st, list);
    // El fotograma quieto es el del GANADOR, no el ultimo del todo: el ultimo
    // ahora es el cierre con el logo, y de previa taparia el encuadre del
    // diseno, que es justo lo que ella esta mirando al montar la ruleta.
    const cierre = st.cierre > 0 ? st.cierre : 0;
    REEL.pintarFrame(D.canvas.getContext("2d"), piezas, st.dur - cierre - 0.01);
  }

  // ---------------------------------------------------------------- elegir
  function pedirDiseno(alElegir, titulo, filtro) {
    document.dispatchEvent(new CustomEvent("kaos-pedir-diseno", {
      detail: { alElegir: alElegir, titulo: titulo, filtro: filtro },
    }));
  }
  D.addBtn.addEventListener("click", () => {
    if (st.ids.length >= TOPE) { decir("Ya hay " + TOPE + " diseños, que es el tope.", true); return; }
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
    st.ids = ids.slice(0, TOPE);
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
    st.ids = buenos.slice(0, TOPE);
    REEL.guardar(st);
    pintarTira();
    const perdidos = ids.length - buenos.length;
    const recorte = buenos.length > TOPE ? " (me quedo con los " + TOPE + " primeros)" : "";
    decir("Cargados " + st.ids.length + " diseños de «" + h.name + "»"
      + (perdidos ? ", " + perdidos + " ya no están en la galería" : "") + recorte);
    D.hojaSel.value = "";
  });

  // ------------------------------------------------------ colores del texto
  // Antes esto era un desplegable con los nombres de los colores. Para elegir
  // un color había que leer "MAGENTA" e imaginárselo, y con el panel cerrado no
  // se veía cuál estaba puesto. Ahora son los colores, se pincha y ya.
  function enlazarColor(caja, campo, conAuto) {
    if (!caja) return;
    caja.textContent = "";
    const botones = [];
    const poner = (valor, hex, titulo, esAuto) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reel-col" + (esAuto ? " reel-col-auto" : "");
      b.dataset.valor = valor;
      b.title = titulo;
      b.setAttribute("aria-label", titulo);
      if (esAuto) b.textContent = "A"; else b.style.background = hex;
      b.addEventListener("click", () => {
        st[campo] = valor;
        REEL.guardar(st);
        marcar();
        caja.dispatchEvent(new Event("change", { bubbles: true }));
        dibujarQuieto();
      });
      caja.appendChild(b);
      botones.push(b);
    };
    // Sólo el marco lleva AUTO. Es la opción buena por defecto: el fondo lo
    // elige ella y cualquier color fijo acaba tarde o temprano encima de un
    // fondo del mismo color, y ahí el marco desaparece.
    if (conAuto) poner("auto", null, "AUTO (contrasta con el fondo)", true);
    for (const k in REEL.PALETA) poner(k, REEL.PALETA[k].hex, REEL.PALETA[k].nombre, false);

    function marcar() {
      const v = st[campo] || (conAuto ? "auto" : "secondary");
      for (const b of botones) {
        const on = b.dataset.valor === v;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    marcar();
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
  // Miniaturas, no desplegable: un fondo es una imagen y el nombre no dice cómo
  // queda. Se pintan al abrir, no aquí: las fotos que ella sube entran en la
  // lista y hay que releerlas cada vez.
  function pintarFondos() {
    if (!D.fondoSel) return;
    const recs = REEL.recetas(st);
    D.fondoSel.textContent = "";
    const poner = (valor, nombre, pinta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reel-fondo";
      b.dataset.valor = valor;
      b.title = nombre;
      b.setAttribute("aria-label", nombre);
      pinta(b);
      const n = document.createElement("span");
      n.className = "reel-fondo-n";
      n.textContent = nombre;
      b.appendChild(n);
      b.addEventListener("click", () => {
        if (valor === "rotar") st.fondoFijo = false;
        else { st.fondoFijo = true; st.fondoIdx = parseInt(valor, 10) || 0; }
        REEL.guardar(st);
        marcar();
        dibujarQuieto();
      });
      D.fondoSel.appendChild(b);
    };
    recs.forEach((r, i) => {
      poner(String(i), r.nombre || ("FONDO " + (i + 1)), (b) => {
        if (r.tipo === "color") { b.style.background = r.v; return; }
        const im = document.createElement("img");
        im.src = r.v; im.alt = "";
        b.appendChild(im);
      });
    });
    poner("rotar", "ROTAR", (b) => { b.classList.add("reel-fondo-rotar"); });
    D.fondoSel.lastChild.title = "Un fondo distinto por diseño";

    function marcar() {
      const v = st.fondoFijo === false ? "rotar"
        : String((st.fondoIdx || 0) % Math.max(1, recs.length));
      for (const b of D.fondoSel.children) b.classList.toggle("on", b.dataset.valor === v);
    }
    marcar();
  }

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
    pintarBarrido();
    REEL.guardar(st);
  });

  // Ritmo al final y cierre con el logo. Los dos cambian la cuenta del ritmo,
  // asi que se vuelve a montar la previa: si no, se veria la de antes.
  if (D.lento) {
    D.lento.value = st.lento;
    D.lentoVal.textContent = (+st.lento).toFixed(2) + "s";
    D.lento.addEventListener("input", () => {
      st.lento = parseFloat(D.lento.value);
      D.lentoVal.textContent = st.lento.toFixed(2) + "s";
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  // La pasada rápida y la parada. Las dos cambian la cuenta del ritmo, así que
  // se vuelve a montar la previa.
  if (D.barrido) {
    D.barrido.value = st.barrido;
    pintarBarrido();
    D.barrido.addEventListener("input", () => {
      st.barrido = parseFloat(D.barrido.value);
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  // Enseñar el tiempo por diseño de la pasada rápida: es el dato que le importa
  // y depende de cuántos diseños haya puesto, no sólo del mando.
  function pintarBarrido() {
    if (!D.barridoVal) return;
    D.barridoVal.textContent = (+st.barrido).toFixed(1) + "s";
    if (!D.barridoTip) return;
    const n = st.ids.length;
    if (!n) {
      D.barridoTip.innerHTML = "Lo que tarda en pasar <b>una vez</b> por todos los diseños al principio.";
      return;
    }
    // El barrido no puede comerse todo el giro: reel.js lo recorta al 70%. Si
    // aquí se enseñara el número del mando y no el recortado, el tiempo por
    // diseño que pone no sería el que va a ver.
    const giro = Math.max(1, st.dur - st.parada - (st.cierre || 0));
    const b = Math.max(0.2, Math.min(+st.barrido, giro * 0.7));
    const cada = Math.max(st.minInt || 0.03, b / n);
    D.barridoTip.innerHTML = "Pasa <b>una vez</b> por los " + n + " diseños en "
      + (cada * n).toFixed(1).replace(".", ",") + "s — "
      + cada.toFixed(2).replace(".", ",") + "s cada uno."
      + (b < +st.barrido ? " (recortado: el reel es corto)" : "");
  }
  if (D.parada) {
    D.parada.value = st.parada;
    D.paradaVal.textContent = (+st.parada).toFixed(1) + "s";
    D.parada.addEventListener("input", () => {
      st.parada = parseFloat(D.parada.value);
      D.paradaVal.textContent = st.parada.toFixed(1) + "s";
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  if (D.cierre) {
    D.cierre.value = st.cierre;
    D.cierreVal.textContent = (+st.cierre).toFixed(1) + "s";
    D.cierre.addEventListener("input", () => {
      st.cierre = parseFloat(D.cierre.value);
      D.cierreVal.textContent = st.cierre.toFixed(1) + "s";
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }

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
