// KAOS.REALM — CARRUSEL (interfaz)
//
// Sólo DOM: el modelo, las plantillas y el pintado viven en carrusel.js.
//
// Las vistas previas son canvas pintados con la MISMA función que la
// exportación, a menor tamaño. Lo que ve es literalmente lo que va a publicar.
(function (root) {
  "use strict";

  const M = root.KAOS_CARRUSEL;
  const $ = (s) => document.querySelector(s);

  const D = {
    openBtn:  $("#carruselOpenBtn"),
    modal:    $("#carruselModal"),
    closeBtn: $("#carruselCloseBtn"),
    inicio:   $("#carruselInicio"),
    plantillas: $("#carruselPlantillas"),
    guardados:  $("#carruselGuardados"),
    guardarBtn: $("#carruselGuardarBtn"),
    editor:   $("#carruselEditor"),
    titulo:   $("#carruselTitulo"),
    tira:     $("#carruselTira"),
    campos:   $("#carruselCampos"),
    lienzo:   $("#carruselLienzo"),
    volverBtn:$("#carruselVolverBtn"),
    exportBtn:$("#carruselExportBtn"),
    sub:      $("#carruselSub"),
    estado:   $("#carruselEstado"),
    fichero:  $("#carruselFichero"),
  };
  if (!M || !D.modal || !D.openBtn) { console.warn("carrusel: falta el marcado"); return; }

  let actual = null;      // el carrusel abierto
  let sel = 0;            // slide seleccionada
  // Qué se mueve al arrastrar por encima de la previa. Es el mismo reparto que
  // el editor de fotos (fondo / logo / recorte): eliges la capa y arrastras,
  // en vez de adivinar qué has agarrado.
  let capa = "texto";     // "texto" | "firma"
  // Dónde ha quedado cada bloque en la previa, y cuál está elegido. Es lo que
  // convierte un lienzo de píxeles en algo que se puede pinchar, como en Canva.
  let cajas = [];
  let elegido = null;     // "titular" | "cuerpo" | "kicker" | "num" | "firma" | "txt:<id>"

  const ETIQUETA = { portada: "PORTADA", pilar: "PILAR", foto: "FOTO", cierre: "CIERRE" };

  function aviso(t, ms) {
    D.estado.textContent = t || "";
    if (t) setTimeout(() => { if (D.estado.textContent === t) D.estado.textContent = ""; }, ms || 4000);
  }

  // ------------------------------------------------------------- portada ----
  function pintarInicio() {
    D.plantillas.textContent = "";
    for (const clave of Object.keys(M.PLANTILLAS)) {
      const p = M.PLANTILLAS[clave];
      const b = document.createElement("button");
      b.className = "carr-plantilla";
      b.id = "carruselNueva_" + clave;          // usage.js registra el id
      const t = document.createElement("span");
      t.className = "carr-plantilla-t";
      t.textContent = p.nombre;
      const s = document.createElement("span");
      s.className = "carr-plantilla-s";
      s.textContent = p.pista;
      b.append(t, s);
      b.addEventListener("click", () => abrirCarrusel(M.crear(clave)));
      D.plantillas.appendChild(b);
    }

    D.guardados.textContent = "";
    const guardados = M.lista();
    if (!guardados.length) return;
    const h = document.createElement("div");
    h.className = "carr-sub";
    h.textContent = "EMPEZADOS";
    D.guardados.appendChild(h);
    for (const c of guardados) {
      const fila = document.createElement("div");
      fila.className = "carr-guardado";
      const nom = document.createElement("button");
      nom.className = "carr-guardado-nom";
      // Una portada no son "1 slides": es una portada. Se dice por su nombre.
      const mm = M.medidas(c);
      nom.textContent = c.titulo + " · " + (c.slides.length === 1
        ? (mm.recorte ? "portada de reel 9:16" : "portada 4:5")
        : c.slides.length + " slides");
      nom.addEventListener("click", () => abrirCarrusel(c));
      const del = document.createElement("button");
      del.className = "carr-guardado-del";
      del.textContent = "✕";
      del.title = "Borrar este carrusel";
      del.addEventListener("click", () => {
        if (!confirm("¿Borrar «" + c.titulo + "»? No se puede deshacer.")) return;
        M.borrar(c.id);
        pintarInicio();
      });
      fila.append(nom, del);
      D.guardados.appendChild(fila);
    }
  }

  // -------------------------------------------------------------- editor ----
  function abrirCarrusel(c) {
    actual = c; sel = 0;
    D.inicio.hidden = true;
    D.editor.hidden = false;
    D.titulo.value = c.titulo || "";
    pintarTira();
    pintarCampos();
  }
  function volver() {
    actual = null;
    D.editor.hidden = true;
    D.inicio.hidden = false;
    pintarInicio();
  }
  let yaAvisadoLleno = false;
  function persistir() {
    if (!actual) return;
    actual.titulo = D.titulo.value.trim() || "Carrusel";
    M.escribir(actual);
    // Si no cupo, se dice. Callarlo era lo que hacía que el nombre y la foto
    // desaparecieran sin que nada lo explicara.
    if (actual._noCabe && !yaAvisadoLleno) {
      yaAvisadoLleno = true;
      aviso("NO SE HA GUARDADO: el almacén del navegador está lleno ("
            + M.sitioUsadoKB() + " KB de unos 5000). Borra carruseles viejos en"
            + " ← PLANTILLAS, o diseños de la galería.", 12000);
    } else if (!actual._noCabe) {
      yaAvisadoLleno = false;
    }
  }

  async function pintarTira() {
    D.tira.textContent = "";
    for (let i = 0; i < actual.slides.length; i++) {
      const s = actual.slides[i];
      const cel = document.createElement("button");
      cel.className = "carr-mini" + (i === sel ? " sel" : "");
      const cv = document.createElement("canvas");
      cv.className = "carr-mini-cv";
      const num = document.createElement("span");
      num.className = "carr-mini-n";
      num.textContent = (i + 1) + " · " + (ETIQUETA[s.tipo] || s.tipo);
      cel.append(cv, num);
      cel.addEventListener("click", () => { sel = i; pintarTira(); pintarCampos(); });
      D.tira.appendChild(cel);
      // 216x270 = un quinto del tamaño real, misma proporción exacta.
      const m = M.medidas(actual);
      await M.pintarEn(cv, s, 216, Math.round(216 * m.H / m.W));
    }
  }

  async function pintarGrande() {
    if (!actual || !actual.slides[sel]) return;
    const m = M.medidas(actual);
    const sola = actual.slides.length === 1;
    if (D.sub) D.sub.textContent = sola
      ? (m.recorte ? "portada de reel · " + m.W + "×" + m.H + " · el cuadro marcado es lo que se ve en tu perfil"
                   : "portada de post · " + m.W + "×" + m.H)
      : "plantilla → escribes → " + m.W + "×" + m.H + " listo para Instagram";
    if (D.exportBtn) D.exportBtn.textContent = sola ? "↓ EXPORTAR PORTADA" : "↓ EXPORTAR TODAS";
    // La guía del cuadro del grid sólo en la previa grande: es para colocar el
    // titular, no para acabar dentro del PNG que sube.
    // cajas: dónde ha caído cada texto, para saber qué se pincha
    cajas = [];
    const anchoPrevia = 432;
    await M.pintarEn(D.lienzo, actual.slides[sel], anchoPrevia, Math.round(anchoPrevia * m.H / m.W),
                     { guiaRecorte: m.recorte, cajas: cajas });
    dibujarSeleccion();
  }

  function refrescar() {
    persistir();
    pintarGrande();
    // Sólo se repinta la miniatura tocada, no las doce.
    const cel = D.tira.children[sel];
    if (cel) {
      const mm = M.medidas(actual);
      M.pintarEn(cel.querySelector("canvas"), actual.slides[sel], 216, Math.round(216 * mm.H / mm.W));
    }
  }

  function campoTexto(etiqueta, valor, clave, multi) {
    const wrap = document.createElement("label");
    wrap.className = "carr-campo";
    const l = document.createElement("span");
    l.textContent = etiqueta;
    const inp = document.createElement(multi ? "textarea" : "input");
    if (multi) inp.rows = 4; else inp.type = "text";
    inp.value = valor || "";
    inp.addEventListener("input", () => {
      actual.slides[sel][clave] = inp.value;
      refrescar();
    });
    wrap.append(l, inp);
    return wrap;
  }

  // Un mando deslizante que guarda su valor como multiplicador (1 = como estaba).
  // Se escribe en la slide y se repinta; nada más.
  function campoMando(etiqueta, s, clave, min, max, id) {
    const wrap = document.createElement("label");
    wrap.className = "carr-campo";
    const l = document.createElement("span");
    const val = document.createElement("b");
    const inicial = Math.round((s[clave] != null ? s[clave] : 1) * 100);
    val.textContent = inicial + "%";
    l.append(document.createTextNode(etiqueta + " "), val);
    const sl = document.createElement("input");
    sl.type = "range"; sl.min = String(min); sl.max = String(max); sl.step = "5";
    sl.value = String(inicial);
    if (id) sl.id = id;
    sl.addEventListener("input", () => {
      s[clave] = parseInt(sl.value, 10) / 100;
      val.textContent = sl.value + "%";
      refrescar();
    });
    wrap.append(l, sl);
    return wrap;
  }

  function botonMini(texto, alPulsar, id) {
    const b = document.createElement("button");
    b.className = "carr-mini-btn";
    if (id) b.id = id;
    b.textContent = texto;
    b.addEventListener("click", alPulsar);
    return b;
  }

  function pintarCampos() {
    D.campos.textContent = "";
    const s = actual.slides[sel];
    if (!s) return;

    // --- tipo de slide ---
    const tipoFila = document.createElement("div");
    tipoFila.className = "carr-tipos";
    for (const t of ["portada", "pilar", "foto", "cierre"]) {
      const b = document.createElement("button");
      b.className = "carr-tipo" + (s.tipo === t ? " sel" : "");
      b.textContent = ETIQUETA[t];
      b.addEventListener("click", () => { s.tipo = t; pintarCampos(); refrescar(); });
      tipoFila.appendChild(b);
    }
    D.campos.appendChild(tipoFila);

    // --- campos según el tipo ---
    if (s.tipo === "foto") {
      D.campos.appendChild(campoTexto("FRASE EN PANTALLA (verde lima)", s.frase, "frase", false));
    } else if (s.tipo === "cierre") {
      D.campos.appendChild(campoTexto("TITULAR", s.titular, "titular", false));
      D.campos.appendChild(campoTexto("DEBAJO", s.cuerpo, "cuerpo", true));
    } else {
      if (s.tipo === "pilar") D.campos.appendChild(campoTexto("NÚMERO", s.num, "num", false));
      D.campos.appendChild(campoTexto("ANTETÍTULO", s.kicker, "kicker", false));
      D.campos.appendChild(campoTexto("TITULAR", s.titular, "titular", false));
      D.campos.appendChild(campoTexto("CUERPO", s.cuerpo, "cuerpo", true));
    }

    // --- fondo, foto, firma ---
    const acciones = document.createElement("div");
    acciones.className = "carr-acciones";

    const fondo = botonMini(s.fondo === "grafito" ? "FONDO: GRIS" : "FONDO: NEGRO", () => {
      s.fondo = s.fondo === "grafito" ? "negro" : "grafito";
      fondo.textContent = s.fondo === "grafito" ? "FONDO: GRIS" : "FONDO: NEGRO";
      refrescar();
    });

    const foto = botonMini(s.img ? "CAMBIAR FOTO" : "PONER FOTO",
      () => D.fichero.click(), "carruselFotoBtn");

    const galeria = botonMini("DE LA GALERÍA", elegirDeGaleria, "carruselGaleriaBtn");

    const quitar = botonMini("QUITAR FOTO", () => { s.img = null; pintarCampos(); refrescar(); });
    quitar.disabled = !s.img;

    const firma = botonMini(s.sinFirma ? "SIN FIRMA" : "CON FIRMA", () => {
      s.sinFirma = !s.sinFirma;
      firma.textContent = s.sinFirma ? "SIN FIRMA" : "CON FIRMA";
      refrescar();
    });
    firma.title = "La portada de «detrás de cámaras» es la única pieza que va sin logo";

    const logo = botonMini(s.logo === false ? "SIN LOGO" : "CON LOGO", () => {
      s.logo = s.logo === false;
      logo.textContent = s.logo === false ? "SIN LOGO" : "CON LOGO";
      refrescar();
    }, "carruselLogoBtn");
    logo.title = "El lettering dibujado, en verde lima, encima del arroba";

    acciones.append(fondo, foto, galeria, quitar, logo, firma);
    D.campos.appendChild(acciones);

    // --- mandos deslizantes ---
    if (s.tipo !== "foto") {
      D.campos.appendChild(campoMando("TAMAÑO DE LA LETRA", s, "tam", 60, 170, "carruselTam"));
    }
    if (s.tipo === "portada" || s.tipo === "pilar") {
      D.campos.appendChild(campoMando("AIRE ENTRE TITULAR Y CUERPO", s, "hueco", 30, 500, "carruselHueco"));
    }

    // --- textos sueltos ---
    const libres = document.createElement("div");
    libres.className = "carr-acciones";
    libres.appendChild(botonMini("+ TEXTO", () => {
      if (!s.textos) s.textos = [];
      const t = { id: "t_" + Date.now(), txt: "ESCRIBE AQUÍ",
                  x: 0.12, y: 0.30, t: 0.055, color: "lima", fuente: "titulo" };
      s.textos.push(t);
      elegido = "txt:" + t.id;
      pintarCampos(); refrescar();
      aviso("Doble clic encima para escribirlo.");
    }, "carruselAddTextoBtn"));

    if (elegido && elegido.indexOf("txt:") === 0) {
      const t = (s.textos || []).find((z) => "txt:" + z.id === elegido);
      if (t) {
        const col = botonMini("COLOR: " + (t.color || "lima").toUpperCase(), () => {
          const orden = ["lima", "hueso", "magenta", "negro"];
          t.color = orden[(orden.indexOf(t.color || "lima") + 1) % orden.length];
          pintarCampos(); refrescar();
        });
        const fu = botonMini(t.fuente === "mono" ? "LETRA: MÁQUINA" : "LETRA: TITULAR", () => {
          t.fuente = t.fuente === "mono" ? "titulo" : "mono";
          pintarCampos(); refrescar();
        });
        const bo = botonMini("BORRAR TEXTO", () => {
          s.textos = (s.textos || []).filter((z) => z.id !== t.id);
          elegido = null;
          pintarCampos(); refrescar();
        });
        bo.classList.add("peligro");
        libres.append(col, fu, bo);
      }
    }
    D.campos.appendChild(libres);

    // --- qué se mueve al arrastrar por la previa ---
    if (!s.sinFirma || s.tipo !== "foto") {
      const fila = document.createElement("div");
      fila.className = "carr-tipos";
      const et = { texto: "MOVER TEXTO", firma: "MOVER LOGO" };
      for (const c of ["texto", "firma"]) {
        const b = document.createElement("button");
        b.className = "carr-tipo" + (capa === c ? " sel" : "");
        b.textContent = et[c];
        b.addEventListener("click", () => { capa = c; pintarCampos(); });
        fila.appendChild(b);
      }
      D.campos.appendChild(fila);
      const nota = document.createElement("p");
      nota.className = "carr-nota";
      nota.textContent = "Pincha un texto en la imagen para elegirlo, arrástralo para moverlo y tira del cuadradito rojo para agrandarlo. Doble clic encima = escribirlo. Doble clic en el aire = todo a su sitio.";
      D.campos.appendChild(nota);
    }

    // --- orden y borrado de slides ---
    const orden = document.createElement("div");
    orden.className = "carr-acciones";
    const mover = (delta, txt) => {
      const b = botonMini(txt, () => {
        const [x] = actual.slides.splice(sel, 1);
        sel += delta;
        actual.slides.splice(sel, 0, x);
        persistir(); pintarTira(); pintarCampos();
      });
      b.disabled = sel + delta < 0 || sel + delta >= actual.slides.length;
      return b;
    };
    const nueva = botonMini("+ SLIDE", () => {
      actual.slides.splice(sel + 1, 0,
        { tipo: "pilar", fondo: "negro", num: "", kicker: "", titular: "", cuerpo: "", img: null });
      sel++;
      persistir(); pintarTira(); pintarCampos();
    }, "carruselAddSlideBtn");
    const borrar = botonMini("BORRAR SLIDE", () => {
      if (!confirm("¿Quitar esta slide del carrusel?")) return;
      actual.slides.splice(sel, 1);
      if (sel >= actual.slides.length) sel = actual.slides.length - 1;
      persistir(); pintarTira(); pintarCampos();
    });
    borrar.classList.add("peligro");
    borrar.disabled = actual.slides.length <= 1;

    orden.append(mover(-1, "← ANTES"), mover(1, "DESPUÉS →"), nueva, borrar);
    D.campos.appendChild(orden);

    pintarGrande();
  }

  // Trae un diseño de su galería de flashes a la slide.
  function elegirDeGaleria() {
    if (!root.KAOS_GALLERY) return aviso("La galería no está cargada.");
    const items = KAOS_GALLERY.load();
    if (!items.length) return aviso("Todavía no tienes diseños en la galería.");
    const capa = document.createElement("div");
    capa.className = "carr-picker";
    const rej = document.createElement("div");
    rej.className = "carr-picker-rej";
    for (const it of items) {
      const b = document.createElement("button");
      b.className = "carr-picker-it";
      const im = document.createElement("img");
      im.src = it.thumbUrl || it.layerUrl;
      im.alt = "";
      b.appendChild(im);
      b.addEventListener("click", async () => {
        capa.remove();
        aviso("Preparando la foto…");
        actual.slides[sel].img = await M.encoger(it.layerUrl || it.thumbUrl);
        aviso("");
        pintarCampos(); refrescar();
      });
      rej.appendChild(b);
    }
    const cerrar = botonMini("✕ CERRAR", () => capa.remove());
    capa.append(cerrar, rej);
    capa.addEventListener("click", (e) => { if (e.target === capa) capa.remove(); });
    D.modal.appendChild(capa);
  }

  D.fichero.addEventListener("change", () => {
    const f = D.fichero.files && D.fichero.files[0];
    D.fichero.value = "";
    if (!f || !actual) return;
    const fr = new FileReader();
    fr.onload = async () => {
      aviso("Preparando la foto…");
      actual.slides[sel].img = await M.encoger(fr.result);
      aviso("");
      pintarCampos(); refrescar();
    };
    fr.onerror = () => aviso("No se pudo leer esa foto.");
    fr.readAsDataURL(f);
  });

  // ---------------------------------------------------------- exportación ---
  D.exportBtn.addEventListener("click", async () => {
    if (!actual) return;
    persistir();
    D.exportBtn.disabled = true;
    try {
      const r = await M.exportarTodo(actual, (i, n) => {
        D.estado.textContent = "Montando " + i + " de " + n + "…";
      });
      if (r === "fichero") aviso("Portada guardada donde la has puesto.");
      if (r === "carpeta") aviso("Guardadas " + actual.slides.length + " imágenes en la carpeta que has elegido.");
      else if (r === "compartido") aviso("Listo — elige «Guardar en Fotos».");
      else if (r === "descargado") aviso("Descargadas " + actual.slides.length + " imágenes.");
      else if (r === "cancelado") aviso("Cancelado.");
      else aviso("No había nada que exportar.");
    } catch (e) {
      aviso("Falló la exportación: " + ((e && e.message) || e));
    } finally {
      D.exportBtn.disabled = false;
    }
  });

  // -------------------------------------------------------------- arrastre --
  // Se trabaja encima de la previa, como en Canva: pinchas un texto y queda
  // elegido, lo arrastras para colocarlo, tiras de la esquina para agrandarlo,
  // y con doble clic lo escribes ahí mismo.
  //
  // Todo se guarda en FRACCIONES del lienzo, nunca en píxeles: la previa mide
  // 432 de ancho y el PNG 1080, y con píxeles el texto saldría publicado en un
  // sitio distinto al que ella lo dejó.

  const TIRADOR = 13;   // lado del cuadradito de la esquina, en píxeles de previa

  function escala() {
    const r = D.lienzo.getBoundingClientRect();
    return { r: r, kx: D.lienzo.width / r.width, ky: D.lienzo.height / r.height };
  }
  // Coordenadas del ratón en píxeles DEL LIENZO, no de la pantalla.
  function enLienzo(e) {
    const s = escala();
    return [(e.clientX - s.r.left) * s.kx, (e.clientY - s.r.top) * s.ky];
  }
  function cajaDe(clave) { return cajas.find((c) => c.clave === clave) || null; }
  // El último de la lista gana: los textos sueltos se pintan al final, así que
  // si se solapan manda el que está encima, que es el que ella ve.
  function queHay(x, y) {
    for (let i = cajas.length - 1; i >= 0; i--) {
      const c = cajas[i];
      if (x >= c.x - 4 && x <= c.x + c.w + 4 && y >= c.y - 4 && y <= c.y + c.h + 4) return c.clave;
    }
    return null;
  }
  function enTirador(x, y) {
    const c = elegido && cajaDe(elegido);
    if (!c) return false;
    return x >= c.x + c.w - TIRADOR && x <= c.x + c.w + TIRADOR
        && y >= c.y + c.h - TIRADOR && y <= c.y + c.h + TIRADOR;
  }

  // Marco de lo elegido. Se pinta ENCIMA de la previa ya hecha, así que no
  // ensucia el PNG: ese se pinta aparte, sin pasar por aquí.
  function dibujarSeleccion() {
    const c = elegido && cajaDe(elegido);
    if (!c) return;
    const ctx = D.lienzo.getContext("2d");
    ctx.save();
    ctx.strokeStyle = "#e8174f";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(c.x - 4, c.y - 4, c.w + 8, c.h + 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#e8174f";
    ctx.fillRect(c.x + c.w - 4, c.y + c.h - 4, 9, 9);
    ctx.restore();
  }

  // Los bloques de plantilla guardan su ajuste en s.aj; los textos sueltos son
  // objetos propios. Esto devuelve dónde escribir, sea cual sea.
  function destino(s, clave) {
    if (clave && clave.indexOf("txt:") === 0) {
      const id = clave.slice(4);
      return (s.textos || []).find((t) => t.id === id) || null;
    }
    if (clave === "firma") {
      return { get x() { return s.fx || 0; }, set x(v) { s.fx = v; },
               get y() { return s.fy || 0; }, set y(v) { s.fy = v; },
               get t() { return 1; }, set t(v) { /* la firma no cambia de tamaño */ } };
    }
    if (!s.aj) s.aj = {};
    if (!s.aj[clave]) s.aj[clave] = { x: 0, y: 0, t: 1 };
    return s.aj[clave];
  }

  const arr = { modo: null, x: 0, y: 0, x0: 0, y0: 0, t0: 1, w0: 1 };

  D.lienzo.addEventListener("pointerdown", (e) => {
    if (!actual || !actual.slides[sel]) return;
    const s = actual.slides[sel];
    const p = enLienzo(e), mx = p[0], my = p[1];

    if (enTirador(mx, my)) {
      const d = destino(s, elegido);
      const c = cajaDe(elegido);
      arr.modo = "tamano";
      arr.x = mx; arr.y = my;
      arr.t0 = (elegido.indexOf("txt:") === 0) ? (d.t || 0.05) : (d.t || 1);
      arr.w0 = Math.max(12, c.w);
      D.lienzo.setPointerCapture(e.pointerId);
      return;
    }

    const golpe = queHay(mx, my);
    if (golpe) {
      if (golpe !== elegido) { elegido = golpe; pintarCampos(); }
      const d = destino(s, elegido);
      arr.modo = "mover";
      arr.x = mx; arr.y = my;
      arr.x0 = d.x || 0; arr.y0 = d.y || 0;
      D.lienzo.setPointerCapture(e.pointerId);
      return;
    }

    // Fuera de todo: se suelta la selección y se mueve el bloque entero, que es
    // lo que hacían los botones MOVER TEXTO / MOVER LOGO.
    if (elegido) { elegido = null; pintarCampos(); }
    arr.modo = "bloque";
    arr.x = mx; arr.y = my;
    const cx = capa === "firma" ? "fx" : "dx", cy = capa === "firma" ? "fy" : "dy";
    arr.x0 = s[cx] || 0; arr.y0 = s[cy] || 0;
    D.lienzo.setPointerCapture(e.pointerId);
  });

  D.lienzo.addEventListener("pointermove", (e) => {
    const p = enLienzo(e), mx = p[0], my = p[1];
    if (!arr.modo) {
      D.lienzo.style.cursor = enTirador(mx, my) ? "nwse-resize"
                            : (queHay(mx, my) ? "grab" : "crosshair");
      return;
    }
    const s = actual.slides[sel];
    const W = D.lienzo.width, H = D.lienzo.height;
    if (arr.modo === "tamano") {
      const f = Math.max(0.15, (arr.w0 + (mx - arr.x)) / arr.w0);
      destino(s, elegido).t = arr.t0 * f;
    } else if (arr.modo === "mover") {
      const d = destino(s, elegido);
      d.x = arr.x0 + (mx - arr.x) / W;
      d.y = arr.y0 + (my - arr.y) / H;
    } else {
      const cx = capa === "firma" ? "fx" : "dx", cy = capa === "firma" ? "fy" : "dy";
      s[cx] = arr.x0 + (mx - arr.x) / W;
      s[cy] = arr.y0 + (my - arr.y) / H;
    }
    pintarGrande();
  });

  function soltar(e) {
    if (!arr.modo) return;
    arr.modo = null;
    try { D.lienzo.releasePointerCapture(e.pointerId); } catch (x) {}
    refrescar();
  }
  D.lienzo.addEventListener("pointerup", soltar);
  D.lienzo.addEventListener("pointercancel", soltar);

  // Doble clic encima de un texto: se escribe ahí mismo.
  D.lienzo.addEventListener("dblclick", (e) => {
    if (!actual || !actual.slides[sel]) return;
    const s = actual.slides[sel];
    const p = enLienzo(e), mx = p[0], my = p[1];
    const golpe = queHay(mx, my);
    if (!golpe) {
      // En el aire: el bloque vuelve a su sitio, como antes.
      const cx = capa === "firma" ? "fx" : "dx", cy = capa === "firma" ? "fy" : "dy";
      s[cx] = 0; s[cy] = 0;
      refrescar();
      aviso(capa === "firma" ? "Logo a su sitio." : "Texto a su sitio.");
      return;
    }
    elegido = golpe;
    if (golpe === "firma") { pintarCampos(); return aviso("El arroba no se cambia: es tu firma."); }
    editarEncima(golpe);
  });

  // Un cuadro de escritura colocado justo encima del texto y del tamaño que se
  // ve. Un canvas no se puede escribir por dentro, así que se pone esto encima:
  // el efecto es el mismo, se escribe donde se mira.
  function editarEncima(clave) {
    const s = actual.slides[sel];
    const c = cajaDe(clave);
    if (!c) return;
    const suelto = clave.indexOf("txt:") === 0;
    const t = suelto ? destino(s, clave) : null;
    if (suelto && !t) return;
    const campo = suelto ? "txt" : clave;
    const es = escala();

    const ta = document.createElement("textarea");
    ta.className = "carr-edicion";
    ta.value = suelto ? (t.txt || "") : (s[campo] || "");
    ta.style.left = (es.r.left + window.scrollX + c.x / es.kx - 6) + "px";
    ta.style.top = (es.r.top + window.scrollY + c.y / es.ky - 6) + "px";
    ta.style.width = Math.max(140, c.w / es.kx + 24) + "px";
    ta.style.height = Math.max(32, c.h / es.ky + 14) + "px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    // Bandera, y no ta.parentNode: al quitar el cuadro salta su propio blur, y
    // en ese instante el nodo TODAVIA cuelga del documento, asi que la guarda
    // por parentNode no servia y entraba dos veces. La segunda reventaba con
    // NotFoundError: Failed to execute remove on Element.
    let cerrado = false;
    function cerrarEdicion(guardando) {
      if (cerrado) return;
      cerrado = true;
      if (guardando) {
        if (suelto) t.txt = ta.value;
        else s[campo] = ta.value;
      }
      ta.remove();
      pintarCampos();
      refrescar();
    }
    ta.addEventListener("blur", () => cerrarEdicion(true));
    ta.addEventListener("keydown", (ev) => {
      ev.stopPropagation();                       // que Escape no cierre el modal
      if (ev.key === "Escape") cerrarEdicion(false);
      // Enter guarda; Mayúsculas+Enter hace un salto de línea.
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); cerrarEdicion(true); }
    });
  }

  // ---------------------------------------------------------------- varios --
  function abrir() {
    D.modal.style.display = "";
    if (!actual) { D.editor.hidden = true; D.inicio.hidden = false; pintarInicio(); }
  }
  function cerrar() { persistir(); D.modal.style.display = "none"; }

  D.openBtn.addEventListener("click", abrir);
  D.closeBtn.addEventListener("click", cerrar);
  D.volverBtn.addEventListener("click", () => { persistir(); volver(); });
  // Se guarda solo a cada cambio, pero sin un botón no hay manera de saberlo.
  // Esto no guarda nada nuevo: lo dice.
  if (D.guardarBtn) D.guardarBtn.addEventListener("click", () => {
    if (!actual) return;
    persistir();
    const sola = actual.slides.length === 1;
    aviso((sola ? "Portada guardada" : "Carrusel guardado") + " · " + actual.titulo
          + " · la tienes en EMPEZADOS.");
  });
  D.titulo.addEventListener("input", persistir);

  // No cierra al tocar fuera: aquí hay texto escrito a mano y un toque en el
  // borde se lo llevaría por delante.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || D.modal.style.display === "none") return;
    const picker = D.modal.querySelector(".carr-picker");
    if (picker) return picker.remove();
    cerrar();
  });

  root.KAOS_CARRUSEL_UI = { abrir, cerrar };
})(window);
