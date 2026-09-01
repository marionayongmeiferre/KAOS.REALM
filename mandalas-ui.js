// KAOS.REALM — panel de mini mandalas (v1)
//
// Sólo pantalla: tirar una tanda, elegir las que valgan y mandarlas a la
// galería. El dibujo vive entero en mandalas.js.
(function (root) {
  "use strict";

  const M = root.KAOS_MANDALA;
  const GAL = root.KAOS_GALLERY;
  if (!M || !GAL) { console.warn("mandalas-ui: falta mandalas.js o gallery.js"); return; }

  const $ = (s) => document.querySelector(s);
  const D = {
    openBtn:  $("#mandalaOpenBtn"),
    aCompose: $("#mandalaComposeBtn"),
    modal:    $("#mandalaModal"),
    closeBtn: $("#mandalaCloseBtn"),
    grid:     $("#mandalaGrid"),
    fams:     $("#mandalaFamilias"),
    cm:       $("#mandalaCm"),
    cmVal:    $("#mandalaCmVal"),
    cuantas:  $("#mandalaCuantas"),
    flashday: $("#mandalaFlashDay"),
    rollBtn:  $("#mandalaRollBtn"),
    todasBtn: $("#mandalaTodasBtn"),
    addBtn:   $("#mandalaAddBtn"),
    status:   $("#mandalaStatus"),
    precio:   $("#mandalaPrecio"),
  };
  if (!D.modal || !D.openBtn) { console.warn("mandalas-ui: falta el marcado"); return; }

  const K = "kaos.mandala.v1";
  const POR_DEFECTO = { cm: 4, familia: "", flashday: true, semilla: 0 };
  let st = (function () {
    try {
      const j = JSON.parse(localStorage.getItem(K) || "null");
      if (j) return Object.assign({}, POR_DEFECTO, j);
    } catch (e) {}
    return Object.assign({}, POR_DEFECTO);
  })();
  function guardar() { try { localStorage.setItem(K, JSON.stringify(st)); } catch (e) {} }

  let tanda = [];               // [{canvas, familia, simetria, semilla}]
  let elegidas = new Set();     // índices de `tanda`

  function decir(txt, malo) {
    D.status.textContent = txt || "—";
    D.status.classList.toggle("warn", !!malo);
  }

  // ------------------------------------------------------------- precio
  // Lo que se le cobra a la clienta por una pieza de este tamaño. Sale de
  // precio.js, que es donde vive la fórmula — aquí no se calcula nada.
  function pintarPrecio() {
    if (!D.precio) return;
    const P = root.KAOS_PRECIO;
    if (!P) { D.precio.textContent = ""; return; }
    try {
      // Estilo 3 = blackwork / ornamental, que es lo que son estas piezas.
      const r = P.rangoFlash({ w: st.cm, h: st.cm, estilo: "3", det: 2, dens: "0.6" });
      D.precio.textContent = "A " + st.cm + " cm te sale a " + r.texto
        + (r.tocaMinimo ? " (toca el mínimo del estudio)" : "");
    } catch (e) { D.precio.textContent = ""; }
  }

  // ------------------------------------------------------------- gustos
  //
  // Aprendizaje sencillo y honesto: de cada pieza se guarda SOLO lo que se
  // puede medir — su familia y su simetria — con un punto por cada vez que ella
  // dice que esta bien y uno menos por cada vez que dice que esta mal. Nada de
  // imagenes: son cuatro numeros en una linea.
  //
  // Al tirar otra vuelta, las combinaciones con puntos negativos se descartan y
  // se prueba otra semilla. Cuanto peor puntuada, mas se descarta. Las buenas no
  // se fuerzan: salen mas simplemente porque las malas dejan de salir. Y elegir
  // una familia a mano manda siempre sobre esto.
  const GUSTOS_KEY = "kaos.mandalas.gustos.v1";
  let gustos = {};
  try { gustos = JSON.parse(localStorage.getItem(GUSTOS_KEY) || "{}") || {}; } catch (e) { gustos = {}; }
  function guardarGustos() {
    try { localStorage.setItem(GUSTOS_KEY, JSON.stringify(gustos)); } catch (e) {}
  }
  const claveFam = (p) => "f:" + p.familia;
  const claveSim = (p) => "s:" + p.familia + ":" + (p.simetria || 1);
  function puntos(p) {
    return (gustos[claveFam(p)] || 0) + (gustos[claveSim(p)] || 0);
  }
  function votar(p, signo) {
    gustos[claveFam(p)] = (gustos[claveFam(p)] || 0) + signo;
    gustos[claveSim(p)] = (gustos[claveSim(p)] || 0) + signo;
    guardarGustos();
  }
  function filtroGustos(info) {
    const n = puntos(info);
    if (n >= 0) return true;
    // -1 descarta 1 de cada 3 veces; a partir de -3, casi siempre.
    return Math.random() > Math.min(0.9, -n * 0.3);
  }
  function resumenGustos() {
    const bien = [], mal = [];
    for (const k of Object.keys(gustos)) {
      if (k.indexOf("f:") !== 0) continue;
      const fam = k.slice(2), n = gustos[k];
      if (n > 0) bien.push(M.FAMILIAS[fam] || fam);
      else if (n < 0) mal.push(M.FAMILIAS[fam] || fam);
    }
    if (!bien.length && !mal.length) return "";
    const p = [];
    if (bien.length) p.push("saca más: " + bien.join(", "));
    if (mal.length) p.push("evita: " + mal.join(", "));
    return p.join(" · ");
  }

  // ------------------------------------------------------------- rejilla
  function pintarRejilla() {
    D.grid.textContent = "";
    tanda.forEach((p, i) => {
      // La tarjeta va dentro de un envoltorio para que los pulgares sean
      // botones de verdad al lado del boton de la tarjeta, y no botones metidos
      // dentro de otro boton — que ni es HTML valido ni se deja pulsar bien.
      const wrap = document.createElement("div");
      wrap.className = "mand-wrap";
      const card = document.createElement("button");
      card.className = "mand-card" + (elegidas.has(i) ? " on" : "");
      card.type = "button";
      // El canvas se copia a tamaño de miniatura: el original es de 1200 px y
      // meter doce de esos en el DOM se nota en el iPad.
      const mini = document.createElement("canvas");
      mini.width = 260; mini.height = 260;
      mini.getContext("2d").drawImage(p.canvas, 0, 0, 260, 260);
      card.appendChild(mini);
      const tag = document.createElement("span");
      tag.className = "mand-tag";
      tag.textContent = M.FAMILIAS[p.familia] + (p.simetria > 1 ? " ·" + p.simetria : "");
      card.appendChild(tag);
      card.addEventListener("click", () => {
        if (elegidas.has(i)) elegidas.delete(i); else elegidas.add(i);
        card.classList.toggle("on");
        sincronizar();
      });
      wrap.appendChild(card);

      const votos = document.createElement("div");
      votos.className = "mand-votos";
      const hazVoto = (txt, signo, titulo) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mand-voto";
        b.textContent = txt;
        b.title = titulo;
        b.setAttribute("aria-label", titulo);
        b.addEventListener("click", () => {
          votar(p, signo);
          b.classList.add("hecho");
          decir(resumenGustos() || "Apuntado.");
        });
        return b;
      };
      votos.appendChild(hazVoto("👍", 1, "Esta bien: saca más como esta"));
      votos.appendChild(hazVoto("👎", -1, "Esta mal: evita las de este tipo"));
      wrap.appendChild(votos);

      D.grid.appendChild(wrap);
    });
    sincronizar();
  }
  function sincronizar() {
    const n = elegidas.size;
    D.addBtn.disabled = !n;
    if (D.aCompose) {
      D.aCompose.disabled = !n || !root.KAOS_SURREAL;
      D.aCompose.textContent = n ? ("→ " + n + " AL COLLAGE") : "→ AL COLLAGE";
    }
    D.addBtn.textContent = n ? ("AÑADIR " + n + " A LA GALERÍA") : "AÑADIR A LA GALERÍA";
    D.todasBtn.textContent = (n === tanda.length && n) ? "NINGUNA" : "TODAS";
    if (n) decir(n + " de " + tanda.length + " elegidas");
    else decir("Toca las que te valgan. Con 👍 y 👎 aprendo cuáles sacarte."
      + (resumenGustos() ? " — " + resumenGustos() : ""));
  }

  function tirar() {
    // La semilla avanza siempre: «otra vuelta» tiene que dar piezas nuevas, no
    // volver a barajar las mismas.
    st.semilla = (st.semilla || Math.floor(Math.random() * 1e6)) + 104729;
    guardar();
    const n = parseInt(D.cuantas.value, 10) || 12;
    // Con familia elegida a mano manda ella: el filtro solo entra en la mezcla
    // automatica, donde es donde tiene sentido evitar lo que no le gusta.
    tanda = M.tanda(n, st.semilla, st.familia || null, st.familia ? null : filtroGustos);
    elegidas = new Set();
    pintarRejilla();
  }

  // ------------------------------------------------------------- controles
  D.rollBtn.addEventListener("click", tirar);
  D.todasBtn.addEventListener("click", () => {
    if (elegidas.size === tanda.length) elegidas = new Set();
    else elegidas = new Set(tanda.map((_, i) => i));
    pintarRejilla();
  });

  // Iconos en vez de desplegable: cada botón dibuja una pieza de su familia con
  // una semilla fija, así se elige por lo que se ve y no por leer un nombre.
  // Semillas escogidas a mano, mirando el resultado: una al azar te puede dar
  // una pieza fea y el icono es la carta de presentación de la familia.
  const MUESTRAS = { roseton: 310163, cruz: 120676, estrella: 50865, flor: 39919,
                     diamante: 20946, destellos: 29946, luna: 19973,
                     espinas: 29946, corazon: 10000, cyber: 31337, fuego: 39919,
                     ornamental: 10973,
                     graffity: 12345 };
  function pintarFamilias() {
    if (!D.fams || D.fams.childElementCount) { marcarFamilia(); return; }
    const claves = [""].concat(Object.keys(M.FAMILIAS));
    for (const k of claves) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mand-fam";
      b.dataset.fam = k;
      b.title = k ? M.FAMILIAS[k] : "TODAS MEZCLADAS";
      const cv = document.createElement("canvas");
      cv.width = 88; cv.height = 88;
      if (k) {
        const full = document.createElement("canvas");
        M.pieza(full, MUESTRAS[k] || 12345, k);
        cv.getContext("2d").drawImage(full, 0, 0, 88, 88);
        full.width = full.height = 1;
      } else {
        // «todas»: cuatro cuartos de cuatro familias distintas
        const ctx = cv.getContext("2d");
        const mix = ["roseton", "cruz", "luna", "ornamental"];
        mix.forEach((f, i) => {
          const full = document.createElement("canvas");
          M.pieza(full, MUESTRAS[f] || 12345, f);
          ctx.drawImage(full, (i % 2) * 44 + 3, Math.floor(i / 2) * 44 + 3, 38, 38);
          full.width = full.height = 1;
        });
      }
      b.appendChild(cv);
      const t = document.createElement("span");
      t.textContent = k ? M.FAMILIAS[k].split(" ")[0] : "TODAS";
      b.appendChild(t);
      b.addEventListener("click", () => {
        st.familia = k;
        guardar();
        marcarFamilia();
        tirar();
      });
      D.fams.appendChild(b);
    }
    marcarFamilia();
  }
  function marcarFamilia() {
    if (!D.fams) return;
    Array.prototype.forEach.call(D.fams.children, (b) =>
      b.classList.toggle("on", b.dataset.fam === (st.familia || "")));
  }
  D.cuantas.addEventListener("change", tirar);
  D.cm.addEventListener("input", () => {
    st.cm = parseInt(D.cm.value, 10) || 4;
    D.cmVal.textContent = st.cm + " cm";
    guardar();
    pintarPrecio();
  });
  if (D.flashday) D.flashday.addEventListener("change", () => {
    st.flashday = D.flashday.checked;
    guardar();
  });

  // ------------------------------------------------------------- guardar
  D.addBtn.addEventListener("click", () => {
    if (!elegidas.size) return;
    D.addBtn.disabled = true;
    const idx = Array.from(elegidas).sort((a, b) => a - b);
    let puestas = 0;
    try {
      for (const i of idx) {
        const p = tanda[i];
        const it = GAL.add(p.canvas, { style: "MINI MANDALAS", sizeCm: st.cm });
        // La etiqueta es el motivo de todo esto: se generan PARA el flash day,
        // así que llegan ya marcadas y el botón de FLASH DAY las recoge solas.
        if (st.flashday && it) GAL.toggleTag(it.id, "FLASH DAY");
        puestas++;
      }
    } catch (e) {
      // Lo normal aquí es que se llene el almacén del navegador. Decirlo, no
      // tragárselo: si no, parece que se han guardado y no están.
      decir("Se han guardado " + puestas + " y el navegador se ha llenado. "
        + "Borra diseños viejos de la galería o haz un backup.", true);
      D.addBtn.disabled = false;
      avisarGaleria();
      return;
    }
    // Las guardadas se quitan de la tanda: si no, es facilísimo darle dos veces
    // y meter la misma pieza duplicada en la galería.
    tanda = tanda.filter((_, i) => !elegidas.has(i));
    elegidas = new Set();
    pintarRejilla();
    decir(puestas + " añadidas a la galería" + (st.flashday ? ", marcadas como FLASH DAY" : "") + ".");
    avisarGaleria();
  });
  function avisarGaleria() {
    try { document.dispatchEvent(new CustomEvent("kaos-gallery-changed")); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent("kaos-assets-changed")); } catch (e) {}
  }

  // ------------------------------------------------------------- abrir
  // Las piezas elegidas se meten en el collage como un elemento más, para
  // montarlas encima de una foto o combinarlas entre ellas. No pasan por la
  // galería: aquí no se está guardando nada, se está componiendo.
  if (D.aCompose) D.aCompose.addEventListener("click", async () => {
    if (!elegidas.size || !root.KAOS_SURREAL) return;
    D.aCompose.disabled = true;
    const idx = Array.from(elegidas).sort((a, b) => a - b);
    // Se abre ANTES de meter nada: surreal.js necesita su lienzo montado para
    // colocar los elementos, y si no lo está el primero se pierde.
    root.KAOS_SURREAL.open();
    let puestas = 0;
    for (const i of idx) {
      try {
        await root.KAOS_SURREAL.addCanvas(tanda[i].canvas, "mandala-" + tanda[i].familia);
        puestas++;
      } catch (e) { console.warn("mandala al collage", e); }
    }
    elegidas = new Set();
    pintarRejilla();
    decir(puestas + " en el collage. Muévelas desde la pestaña COMPOSE.");
    cerrar();
  });

  function abrir() {
    D.modal.style.display = "";
    // Los iconos se pintan al abrir, no al cargar: así una familia nueva en
    // mandalas.js aparece sola sin tocar el HTML.
    pintarFamilias();
    D.cm.value = st.cm;
    D.cmVal.textContent = st.cm + " cm";
    if (D.flashday) D.flashday.checked = !!st.flashday;
    pintarPrecio();
    if (!tanda.length) tirar(); else pintarRejilla();
  }
  function cerrar() { D.modal.style.display = "none"; }
  D.openBtn.addEventListener("click", abrir);
  // El camino de vuelta: desde el collage, ir a buscar mandalas. Es el mismo
  // panel de siempre, sólo que abierto desde allí.
  const desdeCompose = $("#composeMandalaBtn");
  if (desdeCompose) desdeCompose.addEventListener("click", abrir);
  D.closeBtn.addEventListener("click", cerrar);
  D.modal.addEventListener("click", (e) => { if (e.target === D.modal) cerrar(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && D.modal.style.display !== "none") cerrar();
  });
})(window);
