// KAOS.REALM — interfaz del panel IDEAS
//
// Toda la lógica vive en ideas.js; aquí sólo está el DOM. Se separan porque el
// motor de ideas y el cálculo de precio se pueden probar sin navegador, y
// mezclarlos con el pintado obligaría a abrir la app para comprobar una
// fórmula.
//
// El texto que escribe ella (peticiones, ideas) se mete SIEMPRE con
// textContent, nunca con innerHTML: un apóstrofe en "un ojo que no duerme"
// rompería el marcado, y una comilla rara podría hacer cosas peores.
(function (root) {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const IDEAS = root.KAOS_IDEAS;
  if (!IDEAS) { console.warn("ideas-ui: falta ideas.js"); return; }

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const show = (n) => { if (n) n.style.display = ""; };
  const hide = (n) => { if (n) n.style.display = "none"; };

  const D = {
    openBtn:    $("#ideasOpenBtn"),
    ctaBadge:   $("#ideasCtaBadge"),
    modal:      $("#ideasModal"),
    closeBtn:   $("#ideasCloseBtn"),
    tabs:       $("#ideasTabs"),
    cSaved:     $("#ideasCountSaved"),
    cNotes:     $("#ideasCountNotes"),

    rollBtn:    $("#ideasRollBtn"),
    engine:     $("#ideasEngine"),
    genList:    $("#ideasGenList"),
    genEmpty:   $("#ideasGenEmpty"),

    savedList:  $("#ideasSavedList"),
    savedEmpty: $("#ideasSavedEmpty"),

    noteInput:  $("#ideasNoteInput"),
    noteKind:   $("#ideasNoteKind"),
    noteAdd:    $("#ideasNoteAddBtn"),
    notesList:  $("#ideasNotesList"),
    notesEmpty: $("#ideasNotesEmpty"),

    refsModal:  $("#refsModal"),
    refsSub:    $("#refsSubtitle"),
    refsChips:  $("#refsChips"),
    refsInput:  $("#refsInput"),
    refsSearch: $("#refsSearchBtn"),
    refsClose:  $("#refsCloseBtn"),
    refsSend:   $("#refsSendBtn"),
    refsStatus: $("#refsStatus"),
    refsGrid:   $("#refsGrid"),

    estiloSel:  $("#ideasEstiloSel"),
    moodSel:    $("#refsEstiloSel"),
    moodInput:  $("#moodInput"),
    moodAdd:    $("#moodAddBtn"),
    moodGal:    $("#moodFromGalleryBtn"),
    moodRead:   $("#moodReadBtn"),
    moodStatus: $("#moodStatus"),
    moodGrid:   $("#moodGrid"),
    moodEmpty:  $("#moodEmpty"),
    cRefs:      $("#ideasCountRefs"),
  };
  if (!D.modal || !D.openBtn) { console.warn("ideas-ui: falta el marcado"); return; }

  let propuestas = [];      // las 5 de la tirada actual, sin guardar todavía
  let kindSel = "pedido";
  let precioAbierto = null; // id de la idea con el panel de precio desplegado

  function openIdeas() { D.modal.style.display = ""; pintarTodo(); }
  function closeIdeas() { D.modal.style.display = "none"; }

  D.openBtn.addEventListener("click", openIdeas);
  D.closeBtn.addEventListener("click", closeIdeas);
  D.modal.addEventListener("click", (e) => { if (e.target === D.modal) closeIdeas(); });

  // Escape cierra primero las referencias y sólo después el panel: si cerrara
  // los dos de golpe perdería la selección de fotos sin querer.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (D.refsModal && D.refsModal.style.display !== "none") { closeRefs(); return; }
    if (D.modal.style.display !== "none") closeIdeas();
  });

  // ---- pestañas ----
  D.tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".ideas-tab");
    if (!b) return;
    Array.prototype.forEach.call(D.tabs.children, (x) =>
      x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".ideas-pane").forEach((p) => {
      p.hidden = p.dataset.pane !== b.dataset.pane;
    });
  });

  // ===================== GENERAR =====================
  function tarjetaPropuesta(idea, i) {
    const card = el("div", "idea-card");
    card.appendChild(el("span", "idea-n", String(i + 1).padStart(2, "0")));
    card.appendChild(el("div", "idea-text", idea.text));
    // La explicación: qué se ve en el dibujo. Sin esto una idea como «un cactus
    // hecho de velas» no se entiende y no hay forma de decidir si vale.
    if (idea.porque) card.appendChild(el("div", "idea-porque", idea.porque));

    const acts = el("div", "idea-acts");
    const si = el("button", "idea-vote yes", "👍 GUARDAR");
    const no = el("button", "idea-vote no", "👎 NO");

    si.addEventListener("click", () => {
      const row = IDEAS.saveIdea(idea);
      card.classList.add("done", "liked");
      acts.textContent = row ? "guardada ✓" : "ya la tenías";
      pintarContadores();
      pintarGuardadas();
    });
    no.addEventListener("click", () => {
      IDEAS.rejectIdea(idea);
      card.classList.add("done", "nope");
      acts.textContent = "descartada — no te la vuelvo a proponer";
    });

    acts.appendChild(si); acts.appendChild(no);
    card.appendChild(acts);
    return card;
  }

  async function tirar() {
    D.rollBtn.disabled = true;
    D.rollBtn.textContent = "PENSANDO…";
    hide(D.genEmpty);
    try {
      const r = await IDEAS.generar(5, IDEAS.estiloActual());
      propuestas = r.ideas;
      D.genList.textContent = "";
      propuestas.forEach((idea, i) => D.genList.appendChild(tarjetaPropuesta(idea, i)));
      const nrefs = IDEAS.refs(r.estilo).length;
      D.engine.textContent = r.motor === "gemini"
        ? ("IA · " + (nrefs ? "mirando " + nrefs + " referencias tuyas" : "aprende de tus 👍👎"))
        : "local · sin conexión";
      D.engine.title = r.aviso ? ("La IA falló (" + r.aviso + "), tiras del motor local.") : "";
      D.engine.classList.toggle("warn", !!r.aviso);
      if (!propuestas.length) show(D.genEmpty);
    } catch (e) {
      D.genList.textContent = "";
      show(D.genEmpty);
      D.engine.textContent = String((e && e.message) || e);
      D.engine.classList.add("warn");
    } finally {
      D.rollBtn.disabled = false;
      D.rollBtn.textContent = "✦ DAME 5 IDEAS";
    }
  }
  D.rollBtn.addEventListener("click", tirar);

  // ===================== ESTILO (referencias visuales) =====================
  // Dos desplegables con la misma lista: el de GENERAR decide en qué estilo se
  // piden las ideas, el de aquí decide qué referencias se ven y en qué estilo
  // entran las nuevas. Se mantienen sincronizados a propósito — tener dos
  // estilos activos a la vez sólo confunde.
  function rellenarSelects() {
    const est = IDEAS.estiloActual();
    for (const sel of [D.estiloSel, D.moodSel]) {
      if (!sel) continue;
      sel.textContent = "";
      for (const k of Object.keys(IDEAS.ESTILOS)) {
        const o = document.createElement("option");
        o.value = k;
        o.textContent = IDEAS.ESTILOS[k].label;
        sel.appendChild(o);
      }
      sel.value = est;
    }
  }
  function cambiarEstilo(id) {
    IDEAS.setEstilo(id);
    rellenarSelects();
    pintarMood();
  }
  if (D.estiloSel) D.estiloSel.addEventListener("change", (e) => cambiarEstilo(e.target.value));
  if (D.moodSel) D.moodSel.addEventListener("change", (e) => cambiarEstilo(e.target.value));

  function tarjetaRef(r) {
    const c = el("div", "mood-card");
    const im = document.createElement("img");
    im.src = r.img;
    im.alt = "";
    const x = document.createElement("button");
    x.className = "mood-del";
    x.textContent = "✕";
    x.title = "Quitar esta referencia";
    x.addEventListener("click", () => {
      // Es una copia reducida guardada aquí, no su foto original: no se le
      // pregunta porque no pierde nada suyo.
      IDEAS.removeRef(r.id);
      pintarMood();
    });
    const t = el("div", "mood-lectura");
    t.textContent = r.lectura || "sin leer todavía";
    if (!r.lectura) t.classList.add("pendiente");
    c.append(im, x, t);
    return c;
  }
  function pintarMood() {
    if (!D.moodGrid) return;
    const est = IDEAS.estiloActual();
    const lista = IDEAS.refs(est);
    D.moodGrid.textContent = "";
    lista.forEach(r => D.moodGrid.appendChild(tarjetaRef(r)));
    if (D.moodEmpty) D.moodEmpty.hidden = lista.length > 0;
    if (D.cRefs) D.cRefs.textContent = String(IDEAS.refs().length);
    const sinLeer = lista.filter(r => !r.lectura).length;
    if (D.moodRead) {
      D.moodRead.disabled = !sinLeer;
      D.moodRead.textContent = sinLeer ? "LEER LAS " + sinLeer + " QUE FALTAN" : "TODAS LEÍDAS";
    }
    if (D.moodStatus) D.moodStatus.textContent = lista.length
      ? lista.length + " referencias de " + IDEAS.ESTILOS[est].label
      : "—";
  }

  async function meterRef(dataUrl) {
    try { await IDEAS.addRef(dataUrl, IDEAS.estiloActual()); }
    catch (e) {
      // El fallo típico es que localStorage se llene. Decirlo, no callarlo.
      if (D.moodStatus) {
        D.moodStatus.textContent = "No cupo: " + String(e.message || e);
        D.moodStatus.classList.add("warn");
      }
      return false;
    }
    return true;
  }
  if (D.moodAdd && D.moodInput) {
    D.moodAdd.addEventListener("click", () => D.moodInput.click());
    D.moodInput.addEventListener("change", async () => {
      const files = Array.prototype.slice.call(D.moodInput.files || []);
      D.moodInput.value = "";
      if (!files.length) return;
      if (D.moodStatus) { D.moodStatus.classList.remove("warn"); D.moodStatus.textContent = "guardando…"; }
      for (const f of files) {
        const data = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(f);
        });
        if (data) await meterRef(data);
      }
      pintarMood();
    });
  }
  if (D.moodGal) D.moodGal.addEventListener("click", async () => {
    const items = (root.KAOS_GALLERY ? KAOS_GALLERY.load() : []);
    if (!items.length) { if (D.moodStatus) D.moodStatus.textContent = "La galería está vacía."; return; }
    // Reutiliza el mismo selector de la galería que usa el editor de posts.
    const evt = new CustomEvent("kaos-pedir-diseno", {
      detail: {
        titulo: "Elige un diseño como referencia",
        alElegir: async (it) => {
          if (D.moodStatus) { D.moodStatus.classList.remove("warn"); D.moodStatus.textContent = "guardando…"; }
          await meterRef(it.layerUrl || it.thumbUrl);
          pintarMood();
        },
      },
    });
    document.dispatchEvent(evt);
  });
  if (D.moodRead) D.moodRead.addEventListener("click", async () => {
    const pend = IDEAS.refs(IDEAS.estiloActual()).filter(r => !r.lectura);
    if (!pend.length) return;
    D.moodRead.disabled = true;
    if (D.moodStatus) D.moodStatus.classList.remove("warn");
    let n = 0;
    for (const r of pend) {
      if (D.moodStatus) D.moodStatus.textContent = "leyendo " + (n + 1) + "/" + pend.length + "…";
      try { await IDEAS.clasificarRef(r.id); n++; }
      catch (e) {
        if (D.moodStatus) {
          D.moodStatus.textContent = String(e.message || e);
          D.moodStatus.classList.add("warn");
        }
        break;   // si falla una (sin key, sin cuota) fallarán todas
      }
    }
    pintarMood();
    if (n && D.moodStatus && !D.moodStatus.classList.contains("warn")) {
      D.moodStatus.textContent = n + " referencias leídas";
    }
  });

  // ===================== GUARDADAS =====================
  // Panel de precio: sólo aparece en la idea que lo pide, no en las 40 de la
  // lista. Los campos son los que ya se saben al dibujar un flash; la zona del
  // cuerpo y la piel no están porque las decide la clienta, y por eso el
  // resultado es un rango y no una cifra.
  function panelPrecio(item) {
    const box = el("div", "idea-precio");
    const P = root.KAOS_PRECIO;
    if (!P) { box.textContent = "Falta precio.js"; return box; }

    const guardado = (item.precio && item.precio.params) || {};
    const v = Object.assign({}, IDEAS.PRECIO_BASE, guardado);

    const campos = el("div", "idea-precio-campos");
    const inputs = {};

    function campo(label, id, node) {
      const w = el("label", "idea-campo");
      w.appendChild(el("span", "idea-campo-lbl", label));
      w.appendChild(node);
      inputs[id] = node;
      campos.appendChild(w);
    }
    function numero(id, min, max) {
      const i = document.createElement("input");
      i.type = "number"; i.min = String(min); i.max = String(max); i.step = "0.5";
      i.value = String(v[id]);
      return i;
    }
    function selectDe(id, opciones) {
      const s = document.createElement("select");
      opciones.forEach((par) => {
        const o = document.createElement("option");
        o.textContent = par[0]; o.value = String(par[1]);
        s.appendChild(o);
      });
      s.value = String(v[id]);
      return s;
    }

    campo("ancho cm", "w", numero("w", 1, 60));
    campo("alto cm", "h", numero("h", 1, 60));
    campo("estilo", "estilo", selectDe("estilo", P.ESTILOS.map((e, i) => [e[0], i])));
    campo("detalle", "det", selectDe("det", Object.keys(P.DETALLE).map(k => [P.DETALLE[k][1], k])));
    campo("color", "color", selectDe("color", [["Negro", "1.0"], ["Toques de color", "1.25"], ["A todo color", "1.5"]]));
    campo("relleno", "fill", selectDe("fill", [["Sólo línea", "0.85"], ["Normal", "1.0"], ["Muy relleno", "1.3"]]));

    const salida = el("div", "idea-precio-out");
    const detalle = el("div", "idea-precio-sub");

    function recalcular() {
      const params = {
        w: parseFloat(inputs.w.value) || 0,
        h: parseFloat(inputs.h.value) || 0,
        estilo: inputs.estilo.value,
        det: parseInt(inputs.det.value, 10),
        color: inputs.color.value,
        fill: inputs.fill.value,
      };
      const r = IDEAS.calcularPrecio(params);
      salida.textContent = r.texto;
      detalle.textContent = "≈ " + String(r.horas).replace(".", ",") + " h"
        + (r.sesiones > 1 ? " · " + r.sesiones + " sesiones" : "")
        + (r.tocaMinimo ? " · toca el mínimo del estudio" : "")
        + " · de antebrazo a costillas";
      IDEAS.updateIdea(item.id, { precio: { texto: r.texto, min: r.min, max: r.max, params: params } });
      pintarContadores();
    }
    Object.keys(inputs).forEach(k => inputs[k].addEventListener("input", recalcular));

    box.appendChild(campos);
    const res = el("div", "idea-precio-res");
    res.appendChild(salida); res.appendChild(detalle);
    box.appendChild(res);
    box.appendChild(el("div", "hint",
      "Es un rango a propósito: publicar una cifra exacta y luego cobrar más porque va en las costillas es una discusión con la clienta asegurada."));
    recalcular();
    return box;
  }

  function tarjetaGuardada(item) {
    const card = el("div", "idea-card saved" + (item.hecho ? " hecho" : ""));
    card.appendChild(el("div", "idea-text", item.text));
    if (item.porque) card.appendChild(el("div", "idea-porque", item.porque));

    if (item.elems && item.elems.length) {
      const chips = el("div", "idea-elems");
      item.elems.forEach(e => chips.appendChild(el("span", "idea-elem", e)));
      card.appendChild(chips);
    }
    if (item.precio && item.precio.texto) {
      card.appendChild(el("div", "idea-precio-badge", item.precio.texto));
    }

    const acts = el("div", "idea-acts");
    const bRef = el("button", "icon-btn", "REFERENCIAS");
    const bImg = el("button", "icon-btn ai", "✨ IMAGEN");
    const bEur = el("button", "icon-btn", "PRECIO");
    const bOk  = el("button", "icon-btn", item.hecho ? "↩ POR HACER" : "✓ HECHO");
    const bDel = el("button", "icon-btn", "✕");
    bDel.title = "Quitar de la lista";

    bRef.addEventListener("click", () => openRefs(item));
    bEur.addEventListener("click", () => {
      precioAbierto = (precioAbierto === item.id) ? null : item.id;
      pintarGuardadas();
    });
    bOk.addEventListener("click", () => {
      IDEAS.updateIdea(item.id, { hecho: !item.hecho });
      pintarContadores(); pintarGuardadas();
    });
    bDel.addEventListener("click", () => {
      // Es su lista de tareas: si la borra por error, la idea se pierde.
      if (!confirm("¿Quitar «" + item.text + "» de la lista?")) return;
      IDEAS.removeIdea(item.id);
      pintarContadores(); pintarGuardadas();
    });
    bImg.addEventListener("click", async () => {
      const antes = bImg.textContent;
      bImg.disabled = true;
      try {
        const img = await IDEAS.generarImagen(item.text, (s) => { bImg.textContent = s + "…"; });
        bImg.textContent = "abriendo…";
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        const blob = await new Promise(r => c.toBlob(r, "image/png"));
        const file = new File([blob], "idea.png", { type: "image/png" });
        closeIdeas();
        root.KAOS_SURREAL.open();
        await root.KAOS_SURREAL.addFiles([file]);
      } catch (e) {
        alert("No se pudo generar: " + ((e && e.message) || e));
      } finally {
        bImg.disabled = false;
        bImg.textContent = antes;
      }
    });

    [bRef, bImg, bEur, bOk, bDel].forEach(b => acts.appendChild(b));
    card.appendChild(acts);

    if (precioAbierto === item.id) card.appendChild(panelPrecio(item));
    return card;
  }

  function pintarGuardadas() {
    const list = IDEAS.saved();
    D.savedList.textContent = "";
    list.forEach(i => D.savedList.appendChild(tarjetaGuardada(i)));
    if (list.length) hide(D.savedEmpty); else show(D.savedEmpty);
  }

  // ===================== PETICIONES =====================
  D.noteKind.addEventListener("click", (e) => {
    const b = e.target.closest(".tog");
    if (!b) return;
    kindSel = b.dataset.kind;
    Array.prototype.forEach.call(D.noteKind.children, (x) =>
      x.setAttribute("aria-selected", String(x === b)));
  });

  function apuntar() {
    const t = D.noteInput.value.trim();
    if (!t) return;
    IDEAS.addNote(t, kindSel);
    D.noteInput.value = "";
    pintarContadores(); pintarNotas();
  }
  D.noteAdd.addEventListener("click", apuntar);
  D.noteInput.addEventListener("keydown", (e) => { if (e.key === "Enter") apuntar(); });

  function pintarNotas() {
    // Lo más pedido primero: es lo que debería dibujar antes.
    const list = IDEAS.notes().slice().sort((a, b) => (b.n || 1) - (a.n || 1) || b.ts - a.ts);
    D.notesList.textContent = "";
    list.forEach(n => {
      const row = el("div", "note-row" + (n.kind === "agotado" ? " agotado" : ""));
      const veces = el("button", "note-n", "×" + (n.n || 1));
      veces.title = "Me lo han vuelto a pedir";
      veces.addEventListener("click", () => { IDEAS.bumpNote(n.id, 1); pintarNotas(); });

      const del = el("button", "icon-btn", "✕");
      del.title = "Borrar";
      del.addEventListener("click", () => {
        if (!confirm("¿Borrar «" + n.text + "»?")) return;
        IDEAS.removeNote(n.id); pintarContadores(); pintarNotas();
      });

      row.appendChild(veces);
      row.appendChild(el("div", "note-text", n.text));
      row.appendChild(el("span", "note-tag", n.kind === "agotado" ? "AGOTADO" : "PEDIDO"));
      row.appendChild(del);
      D.notesList.appendChild(row);
    });
    if (list.length) hide(D.notesEmpty); else show(D.notesEmpty);
  }

  // ===================== REFERENCIAS =====================
  let refIdea = null;
  let seleccion = [];   // items elegidos, en el orden en que los tocó

  function openRefs(item) {
    refIdea = item;
    seleccion = [];
    D.refsSub.textContent = item.text;
    D.refsGrid.textContent = "";
    D.refsChips.textContent = "";
    D.refsStatus.textContent = "Toca un elemento para ver fotos reales de esa pieza.";

    const elems = (item.elems && item.elems.length) ? item.elems : [item.text];
    elems.forEach((e, i) => {
      const c = el("button", "ref-chip", e);
      c.addEventListener("click", () => {
        Array.prototype.forEach.call(D.refsChips.children, (x) =>
          x.setAttribute("aria-selected", String(x === c)));
        buscar(e);
      });
      D.refsChips.appendChild(c);
      if (i === 0) c.setAttribute("aria-selected", "true");
    });

    D.refsModal.style.display = "";
    actualizarEnviar();
    if (elems.length) buscar(elems[0]);
  }
  function closeRefs() { D.refsModal.style.display = "none"; }
  D.refsClose.addEventListener("click", closeRefs);
  D.refsModal.addEventListener("click", (e) => { if (e.target === D.refsModal) closeRefs(); });

  async function buscar(q) {
    D.refsGrid.textContent = "";
    D.refsStatus.textContent = "Buscando «" + q + "»…";
    try {
      const items = await IDEAS.buscarImagenes(q, 30);
      D.refsStatus.textContent = items.length
        + " fotos · Wikimedia Commons + Openverse · toca las que te sirvan";
      items.forEach(it => D.refsGrid.appendChild(celda(it)));
    } catch (e) {
      D.refsStatus.textContent = String((e && e.message) || e);
    }
  }

  function celda(it) {
    const fig = el("figure", "ref-cell");
    const img = document.createElement("img");
    // Sin crossOrigin el navegador cachea la imagen sin CORS y luego el fetch
    // para mandarla al composer falla por la copia guardada.
    img.crossOrigin = "anonymous";
    img.alt = it.titulo;
    img.loading = "lazy";
    img.src = it.thumb;
    img.addEventListener("error", () => fig.remove());

    fig.appendChild(img);
    fig.appendChild(el("figcaption", "ref-cap", it.fuente));

    fig.addEventListener("click", () => {
      const i = seleccion.indexOf(it);
      if (i >= 0) { seleccion.splice(i, 1); fig.classList.remove("sel"); }
      else { seleccion.push(it); fig.classList.add("sel"); }
      actualizarEnviar();
    });
    return fig;
  }

  function actualizarEnviar() {
    D.refsSend.textContent = "→ AL COMPOSER (" + seleccion.length + ")";
    D.refsSend.disabled = seleccion.length === 0;
  }

  D.refsSearch.addEventListener("click", () => {
    const q = D.refsInput.value.trim();
    if (q) buscar(q);
  });
  D.refsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const q = D.refsInput.value.trim(); if (q) buscar(q); }
  });

  D.refsSend.addEventListener("click", async () => {
    const antes = D.refsSend.textContent;
    D.refsSend.disabled = true;
    D.refsSend.textContent = "DESCARGANDO…";
    try {
      await IDEAS.alComposer(seleccion);
      if (refIdea) {
        IDEAS.updateIdea(refIdea.id, {
          refs: (refIdea.refs || []).concat(seleccion.map(s => s.pagina || s.full)),
        });
      }
      closeRefs(); closeIdeas();
    } catch (e) {
      D.refsStatus.textContent = String((e && e.message) || e);
      D.refsSend.disabled = false;
      D.refsSend.textContent = antes;
    }
  });

  // ===================== contadores =====================
  function pintarContadores() {
    const s = IDEAS.saved(), n = IDEAS.notes();
    const porHacer = s.filter(x => !x.hecho).length;
    D.cSaved.textContent = String(s.length);
    D.cNotes.textContent = String(n.length);
    if (D.ctaBadge) {
      D.ctaBadge.textContent = String(porHacer);
      D.ctaBadge.hidden = porHacer === 0;
    }
  }

  function pintarTodo() { pintarContadores(); pintarGuardadas(); pintarNotas(); rellenarSelects(); pintarMood(); }

  pintarContadores();   // el badge del sidebar tiene que estar bien al arrancar
  rellenarSelects();
})(window);
