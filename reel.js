// KAOS.REALM — reel de ruleta (v1)
//
// Coge unos cuantos diseños de la galería y monta un vídeo vertical 1080x1920:
// cada diseño sale como pegatina recortada, con un fondo distinto, y van
// cambiando muy rápido al principio y cada vez más lento, hasta pararse en uno
// — como una ruleta. Encima va una frase y un CTA.
//
// Por qué canvas + MediaRecorder y no ffmpeg: esto corre en su navegador, en el
// PC y en el iPad, sin instalar nada. La contrapartida está abajo, en
// `mejorFormato`: el contenedor que sale depende del navegador, y no siempre es
// el que Instagram acepta. Se avisa, no se disimula.
(function (root) {
  "use strict";

  const W = 1080, H = 1920;              // 9:16, el formato de reel
  const VERDE = "#d4ff2f";               // texto en pantalla: siempre verde lima
  const MAGENTA = "#ff3d5c";
  const HUESO = "#e8e2d4";
  const NEGRO = "#0a0908";
  const FUENTE = '"Helvetica Neue LT Std 73 BEx", Impact, sans-serif';

  const K_EST = "kaos.reel.v1";

  // ---------------------------------------------------------------- estado
  const POR_DEFECTO = {
    ids: [],                 // diseños elegidos, en orden
    frase: "¿CUÁL TE TOCA?",
    cta: "PÁRALO Y ESCRÍBEME",
    dur: 8,                  // segundos totales
    parada: 2.2,             // cuánto aguanta el ganador al final
    minInt: 0.06,            // el cambio más rápido, al principio
    maxInt: 0.85,            // el más lento, justo antes de parar
    fondoVideoUrl: null,     // vídeo de fondo opcional (objectURL)
    fondosPropios: [],       // fotos suyas como fondo, en data:
    // Antes cada diseño llevaba un fondo distinto y el fondo parpadeaba a la
    // velocidad de la ruleta: mareaba y no dejaba mirar el diseño, que es lo
    // único que importa en esta pieza. Ahora el fondo se queda quieto y lo
    // único que cambia es el dibujo. Poniéndolo en false vuelve a rotar.
    fondoFijo: true,
    fondoIdx: 0,             // cuál de las recetas se usa cuando está fijo
    fps: 30,
    // Colores del texto, con los mismos nombres que el editor de posts para que
    // no tenga que aprenderse otra paleta. El verde lima sigue siendo el que
    // manda la marca, así que es el que viene puesto.
    colFrase: "secondary",
    colCta: "secondary",
    colHandle: "secondary",
    // El marco tiene color propio. Antes se pintaba con el color de la frase, y
    // marco y titular salían siempre del mismo verde: dos cosas distintas
    // gritando lo mismo. Con el magenta de marca el marco enmarca y la frase se
    // lee, que es lo que tiene que pasar.
    // "auto" y no un color fijo: el fondo cambia según lo que elija, y con el
    // marco en magenta sobre un fondo magenta el marco desaparecía del todo.
    // Auto mira el fondo ya pintado y saca hueso sobre oscuro, negro sobre
    // claro. Distinto del titular siempre, que es lo que ella pidió.
    colMarco: "auto",
    marco: true,             // las esquinas de línea, como en el flash post
    logo: true,              // su logo encima del @
  };
  // Mismos nombres que resolveDecor del editor de posts.
  const PALETA = {
    secondary: { nombre: "VERDE LIMA", hex: VERDE },
    primary:   { nombre: "MAGENTA",    hex: MAGENTA },
    white:     { nombre: "BLANCO",     hex: "#ffffff" },
    black:     { nombre: "NEGRO",      hex: NEGRO },
    hueso:     { nombre: "HUESO",      hex: HUESO },
  };
  function color(nombre) { return (PALETA[nombre] || PALETA.secondary).hex; }

  // Mira las cuatro esquinas del lienzo ya pintado y decide si el marco tiene
  // que ir claro u oscuro. Son cuatro lecturas de 10x10 píxeles: nada al lado
  // de pintar el fotograma entero.
  function marcoAuto(ctx) {
    const m = Math.round(W * 0.055);
    const pts = [[m, m], [W - m - 10, m], [m, H - m - 10], [W - m - 10, H - m - 10]];
    let suma = 0, n = 0;
    for (const q of pts) {
      let d;
      try { d = ctx.getImageData(Math.max(0, q[0]), Math.max(0, q[1]), 10, 10).data; }
      catch (e) { continue; }                       // lienzo sucio: se deja el claro
      for (let i = 0; i < d.length; i += 4) {
        suma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
    }
    if (!n) return HUESO;
    return (suma / n) < 150 ? HUESO : NEGRO;
  }
  function estado() {
    try {
      const j = JSON.parse(localStorage.getItem(K_EST) || "null");
      // El vídeo de fondo es un objectURL: muere al recargar y guardarlo
      // dejaría un fondo roto sin explicación. Se descarta a propósito.
      if (j) return Object.assign({}, POR_DEFECTO, j, { fondoVideoUrl: null });
    } catch (e) {}
    return Object.assign({}, POR_DEFECTO);
  }
  function guardar(st) {
    try {
      const copia = Object.assign({}, st);
      delete copia.fondoVideoUrl;
      localStorage.setItem(K_EST, JSON.stringify(copia));
    } catch (e) {}
    return st;
  }

  // ---------------------------------------------------------------- ritmo
  // La ruleta: dos fases y luego el ganador.
  //   1) Rápida: intervalos que crecen desde minInt (el "whirr" de ruleta).
  //      Dura al menos una vuelta completa de todos los diseños.
  //   2) Lenta: UNA vuelta completa de TODOS los diseños, repartiendo a partes
  //      iguales el tiempo que quede. Antes la desaceleración era continua y se
  //      cortaba donde pillase: con 8 diseños podía enseñar sólo 6 en la parte
  //      lenta. Ahora los enseña todos siempre.
  function ritmo(st, nSlots) {
    const pasos = [];
    let t = 0, iv = st.minInt, k = 0;
    const fin = Math.max(1, st.dur - st.parada);

    // Fase rápida: al menos una vuelta completa (k < nSlots), y después
    // sigue mientras los intervalos sean cortos. El umbral marca cuándo la
    // ruleta ya "va lenta" y es hora de pasar a la vuelta completa.
    const umbralLento = st.maxInt * 0.3;
    while (t < fin && (k < nSlots || iv < umbralLento) && pasos.length < 400) {
      const hasta = Math.min(fin, t + iv);
      pasos.push({ desde: t, hasta: hasta, slot: k % nSlots });
      t = hasta;
      k++;
      iv = Math.min(st.maxInt, iv * 1.115);
    }

    // Fase lenta: una vuelta completa de TODOS los diseños.
    if (t < fin) {
      const ivLento = (fin - t) / nSlots;
      for (let j = 0; j < nSlots; j++) {
        const hasta = Math.min(fin, t + ivLento);
        pasos.push({ desde: t, hasta: hasta, slot: k % nSlots });
        t = hasta;
        k++;
      }
    }

    // El ganador: el que quede al parar, sostenido hasta el final.
    const ganador = pasos.length ? (pasos[pasos.length - 1].slot + 1) % nSlots : 0;
    pasos.push({ desde: fin, hasta: st.dur, slot: ganador, ganador: true });
    return pasos;
  }
  function slotEn(pasos, t) {
    for (let i = pasos.length - 1; i >= 0; i--) if (t >= pasos[i].desde) return pasos[i];
    return pasos[0] || { slot: 0 };
  }

  // ---------------------------------------------------------------- fondos
  // Cada diseño necesita un fondo distinto. Se turnan: colores planos de marca,
  // la foto de fondo de flash, el patrón, y las fotos que ella meta.
  // Llevan nombre para poder listarlas en el desplegable del panel: si no, ella
  // tendría que elegir un fondo a ciegas por número.
  const RECETAS = [
    { nombre: "MAGENTA",       tipo: "color", v: MAGENTA },
    { nombre: "FOTO DE FLASH", tipo: "img",   v: "uploads/fondo_flash.JPG" },
    { nombre: "NEGRO",         tipo: "color", v: NEGRO },
    { nombre: "PATRÓN",        tipo: "img",   v: "uploads/patron_fondo.PNG" },
    { nombre: "HUESO",         tipo: "color", v: HUESO },
    { nombre: "VERDE LIMA",    tipo: "color", v: VERDE },
  ];
  function recetas(st) {
    const propias = (st.fondosPropios || []).map((v, i) => ({ nombre: "TU FOTO " + (i + 1), tipo: "img", v: v }));
    // Las suyas primero: si se ha molestado en meterlas, quiere verlas.
    return propias.concat(RECETAS);
  }

  const _cache = new Map();
  function cargarImg(src) {
    if (_cache.has(src)) return _cache.get(src);
    const p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => res(null);   // un fondo que falta no debe romper el reel
      im.src = src;
    });
    _cache.set(src, p);
    return p;
  }

  function cubrir(ctx, img, w, h) {
    const iw = img.naturalWidth || img.videoWidth;
    const ih = img.naturalHeight || img.videoHeight;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  // ---------------------------------------------------------------- sticker
  // Mismo truco que la hoja de stickers: se dilata la silueta del dibujo para
  // sacar un halo de papel, se rellena de blanco, y encima va la tinta en
  // multiply. Aquí va aparte (y no reusa el de app.js) porque aquel depende del
  // estado del editor de posts, y el reel no tiene editor abierto.
  // `ancho` y `alto` son la CAJA máxima, no el tamaño final: el dibujo se mete
  // dentro respetando su proporción. Antes sólo se fijaba el ancho, así que un
  // diseño muy alargado se salía por arriba y por abajo del encuadre.
  function pintarSticker(ctx, img, cx, cy, ancho, alto, rot) {
    if (!img || !img.naturalWidth) return;
    const r = img.naturalHeight / img.naturalWidth;
    // La rotación agranda la caja que ocupa: se descuenta antes de encajar,
    // si no un diseño inclinado vuelve a asomar por el borde.
    const a = Math.abs((rot || 0) * Math.PI / 180);
    const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    const escalaW = ancho / (cos + r * sin);
    const escalaH = alto  / (sin + r * cos);
    const w = Math.min(escalaW, escalaH);
    const dw = Math.round(w), dh = Math.round(w * r);
    const halo = Math.max(10, Math.round(ancho * 0.045));
    const SW = dw + halo * 2, SH = dh + halo * 2;

    const st = document.createElement("canvas");
    st.width = SW; st.height = SH;
    const sx = st.getContext("2d");

    // silueta dilatada -> papel blanco
    sx.drawImage(img, halo, halo, dw, dh);
    const pasos = 28;
    for (let k = 0; k < pasos; k++) {
      const a = (k / pasos) * Math.PI * 2;
      sx.drawImage(img, halo + Math.cos(a) * halo, halo + Math.sin(a) * halo, dw, dh);
    }
    sx.globalCompositeOperation = "source-in";
    sx.fillStyle = "#fdfbf5";
    sx.fillRect(0, 0, SW, SH);
    sx.globalCompositeOperation = "source-over";
    // tinta encima
    sx.globalCompositeOperation = "multiply";
    sx.drawImage(img, halo, halo, dw, dh);
    sx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot || 0) * Math.PI / 180);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = halo * 0.9;
    ctx.shadowOffsetY = halo * 0.35;
    ctx.drawImage(st, -SW / 2, -SH / 2, SW, SH);
    ctx.restore();
    st.width = st.height = 1;
  }

  // ---------------------------------------------------------------- texto
  // Mayúsculas y bold siempre: es regla de marca. El verde lima también lo era,
  // y sigue siendo el que viene puesto por defecto, pero ella pidió poder
  // cambiarlo como en el editor de posts, así que el color sí se elige.
  function ajustar(ctx, texto, maxAncho, tamInicial) {
    let t = tamInicial;
    do {
      ctx.font = "700 " + t + "px " + FUENTE;
      if (ctx.measureText(texto).width <= maxAncho) break;
      t -= 4;
    } while (t > 28);
    return t;
  }
  function pintarTexto(ctx, texto, y, tam, hex) {
    if (!texto) return;
    const t = String(texto).toUpperCase();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const usado = ajustar(ctx, t, W * 0.86, tam);
    // Contorno negro fino: sobre una foto clara el verde lima solo no se lee.
    ctx.lineWidth = Math.max(4, usado * 0.09);
    ctx.strokeStyle = "rgba(10,9,8,0.85)";
    ctx.lineJoin = "round";
    ctx.strokeText(t, W / 2, y);
    ctx.fillStyle = hex || VERDE;
    ctx.fillText(t, W / 2, y);
    ctx.restore();
  }

  // ------------------------------------------------------------------ marco
  // Las mismas esquinas en L que lleva el flash post (drawOrnamentCorners de
  // gallery.js), con las proporciones del formato vertical.
  function pintarMarco(ctx, hex) {
    const margen = Math.round(W * 0.055);
    const largo = Math.round(W * 0.10);
    ctx.save();
    ctx.strokeStyle = hex || MAGENTA;
    ctx.lineWidth = 3;
    ctx.lineCap = "square";
    const esquinas = [
      [margen, margen, 1, 1],
      [W - margen, margen, -1, 1],
      [margen, H - margen, 1, -1],
      [W - margen, H - margen, -1, -1],
    ];
    for (const e of esquinas) {
      ctx.beginPath();
      ctx.moveTo(e[0], e[1] + largo * e[3]);
      ctx.lineTo(e[0], e[1]);
      ctx.lineTo(e[0] + largo * e[2], e[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame
  // Pinta el fotograma del segundo `t`. `piezas` es lo que devuelve `preparar`.
  function pintarFrame(ctx, piezas, t) {
    const st = piezas.st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const paso = slotEn(piezas.pasos, t);
    const i = paso.slot % Math.max(1, piezas.slots.length);
    const slot = piezas.slots[i];

    // 1) fondo: el vídeo si lo hay, y si no la receta de este slot
    if (piezas.video && piezas.video.readyState >= 2) {
      cubrir(ctx, piezas.video, W, H);
      // Una capa oscura suave para que la pegatina y el texto despeguen.
      ctx.fillStyle = "rgba(10,9,8,0.28)";
      ctx.fillRect(0, 0, W, H);
    } else if (slot && slot.fondo) {
      if (slot.fondo.tipo === "color") { ctx.fillStyle = slot.fondo.v; ctx.fillRect(0, 0, W, H); }
      else if (slot.fondo.img) cubrir(ctx, slot.fondo.img, W, H);
      else { ctx.fillStyle = NEGRO; ctx.fillRect(0, 0, W, H); }
    } else {
      ctx.fillStyle = NEGRO;
      ctx.fillRect(0, 0, W, H);
    }

    // 2) el marco de esquinas, igual que el flash post
    if (st.marco !== false) {
      const cm = st.colMarco || "auto";
      pintarMarco(ctx, cm === "auto" ? marcoAuto(ctx) : color(cm));
    }

    // 3) la pegatina. Al parar da un golpecito de escala, para que se note.
    // La caja va entre la frase de arriba y el CTA de abajo, así que un diseño
    // muy alargado se encoge en vez de comerse el texto o salirse.
    if (slot && slot.img) {
      let escala = 1;
      if (paso.ganador) {
        const d = t - paso.desde;
        escala = 1 + 0.10 * Math.exp(-d * 6) * Math.cos(d * 22);   // rebote corto
      }
      pintarSticker(ctx, slot.img, W / 2, H * 0.495,
        W * 0.72 * escala, H * 0.50 * escala, slot.rot);
    }

    // 4) frase arriba, CTA abajo, logo y firma en el pie
    pintarTexto(ctx, st.frase, H * 0.135, 96, color(st.colFrase));
    pintarTexto(ctx, st.cta, H * 0.845, 72, color(st.colCta));
    // Jerarquía del pie: la firma es el LOGO, no el texto. Antes iban casi del
    // mismo tamaño (logo 58 px, texto 34 px) y a un palmo de distancia parecían
    // dos firmas peleándose. Ahora el logo manda —es el lettering dibujado a
    // mano de la marca— y el @ baja a letra pequeña debajo, apagado, como el
    // pie de una firma. Se lee primero el dibujo, luego dónde encontrarla.
    const hexH = color(st.colHandle);
    let yLogo = H * 0.949;
    if (st.logo !== false && piezas.logo) {
      const lg = piezas.logo;
      const lh = Math.round(H * 0.046);
      const lw = Math.round(lh * (lg.naturalWidth / lg.naturalHeight));
      // El logo es negro sobre transparente: se tiñe del color del handle para
      // que sobre un fondo oscuro no desaparezca. Se tiñe UNA vez y se guarda:
      // rehacerlo en cada fotograma son 30 lienzos por segundo para nada.
      if (piezas._logoTeñido !== hexH) {
        const tc = document.createElement("canvas");
        tc.width = lw; tc.height = lh;
        const tx = tc.getContext("2d");
        tx.drawImage(lg, 0, 0, lw, lh);
        tx.globalCompositeOperation = "source-in";
        tx.fillStyle = hexH;
        tx.fillRect(0, 0, lw, lh);
        piezas._logoCache = tc;
        piezas._logoTeñido = hexH;
      }
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(piezas._logoCache, W / 2 - lw / 2, yLogo - lh - 16);
      ctx.restore();
    }
    ctx.save();
    ctx.textAlign = "center";
    // Más pequeño y más separado por dentro: el espaciado entre letras lo hace
    // leer como un pie de firma y no como un segundo titular.
    ctx.font = "700 24px " + FUENTE;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    // Contorno negro fino, igual que la frase: con sólo bajarle la opacidad
    // sobre un fondo magenta se volvía barro y no se leía el arroba.
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(10,9,8,0.8)";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.85;
    ctx.strokeText("@KAOS.REALM", W / 2, yLogo);
    ctx.fillStyle = hexH;
    ctx.fillText("@KAOS.REALM", W / 2, yLogo);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.restore();
  }

  // ---------------------------------------------------------------- preparar
  // Carga todo lo que hace falta ANTES de grabar. Si se cargara sobre la marcha,
  // los primeros fotogramas saldrían vacíos y el reel empezaría en negro.
  async function preparar(st, items) {
    const recs = recetas(st);
    const slots = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const rec = st.fondoFijo === false ? recs[i % recs.length]
                                        : recs[(st.fondoIdx || 0) % recs.length];
      const par = await Promise.all([
        cargarImg(it.layerUrl || it.thumbUrl),
        rec.tipo === "img" ? cargarImg(rec.v) : Promise.resolve(null),
      ]);
      slots.push({
        img: par[0],
        fondo: rec.tipo === "img" ? { tipo: "img", img: par[1] } : rec,
        // Una inclinación fija por diseño (no aleatoria por fotograma: si no,
        // temblaría). Alterna a un lado y a otro.
        rot: (i % 2 ? 1 : -1) * (2 + (i * 1.7) % 4),
      });
    }
    let video = null;
    if (st.fondoVideoUrl) {
      const v = document.createElement("video");
      v.src = st.fondoVideoUrl;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      const ok = await new Promise((res) => {
        v.onloadeddata = () => res(true);
        v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 4000);   // no colgarse si no tira
      });
      video = ok ? v : null;
    }
    const logo = st.logo === false ? null : await cargarImg("uploads/kaos_logo.PNG");
    return { st: st, slots: slots, pasos: ritmo(st, Math.max(1, slots.length)), video: video, logo: logo };
  }

  // ---------------------------------------------------------------- previa
  // Bucle en pantalla. Devuelve una función para pararlo.
  function previsualizar(canvas, piezas, alAcabar) {
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();
    let vivo = true;
    if (piezas.video) piezas.video.play().catch(() => {});
    (function paso() {
      if (!vivo) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= piezas.st.dur) {
        pintarFrame(ctx, piezas, piezas.st.dur - 0.01);
        vivo = false;
        if (piezas.video) piezas.video.pause();
        if (alAcabar) alAcabar();
        return;
      }
      pintarFrame(ctx, piezas, t);
      requestAnimationFrame(paso);
    })();
    return function parar() { vivo = false; if (piezas.video) piezas.video.pause(); };
  }

  // ---------------------------------------------------------------- grabar
  // Instagram quiere MP4. Safari sabe grabar MP4; Chrome casi siempre sólo WebM.
  // Se pide MP4 primero y, si no puede, se devuelve WebM diciéndolo — es mejor
  // que le salga un fichero que no sube sin saber por qué.
  function mejorFormato() {
    const cands = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    if (typeof MediaRecorder === "undefined") return null;
    for (let i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return null;
  }

  function grabar(piezas, alProgreso) {
    return new Promise(function (resolve, reject) {
      const mime = mejorFormato();
      if (!mime) { reject(new Error("Este navegador no sabe grabar vídeo (MediaRecorder).")); return; }
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const fps = piezas.st.fps || 30;
      const stream = canvas.captureStream(fps);
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 }); }
      catch (e) { reject(new Error("No se pudo abrir el grabador: " + e.message)); return; }

      const trozos = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
      rec.onerror = function (e) { reject(new Error("El grabador falló: " + (e.error && e.error.name))); };
      rec.onstop = function () {
        canvas.width = canvas.height = 1;
        const blob = new Blob(trozos, { type: mime });
        resolve({
          blob: blob,
          mime: mime,
          ext: mime.indexOf("mp4") >= 0 ? "mp4" : "webm",
          esMp4: mime.indexOf("mp4") >= 0,
        });
      };

      // Se pinta a reloj de pared, no fotograma a fotograma: `captureStream`
      // muestrea el canvas en tiempo real, así que el vídeo dura lo que dura la
      // grabación. Es la razón de que grabar 8 segundos tarde 8 segundos.
      const dur = piezas.st.dur;
      if (piezas.video) { try { piezas.video.currentTime = 0; piezas.video.play(); } catch (e) {} }
      rec.start();
      const t0 = performance.now();
      (function paso() {
        const t = (performance.now() - t0) / 1000;
        if (t >= dur) {
          pintarFrame(ctx, piezas, dur - 0.01);
          if (piezas.video) piezas.video.pause();
          setTimeout(function () { try { rec.stop(); } catch (e) {} }, 120);
          return;
        }
        pintarFrame(ctx, piezas, t);
        if (alProgreso) alProgreso(t / dur);
        requestAnimationFrame(paso);
      })();
    });
  }

  root.KAOS_REEL = {
    recetas,
    W: W, H: H,
    estado: estado, guardar: guardar, POR_DEFECTO: POR_DEFECTO,
    ritmo: ritmo, preparar: preparar, pintarFrame: pintarFrame,
    previsualizar: previsualizar, grabar: grabar, mejorFormato: mejorFormato,
    PALETA: PALETA, color: color,
  };
})(window);
