// KAOS.REALM — surreal composer + auto-tune (v4)
(function (root) {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

  // ============================================================
  // ======================== AUTO-TUNE =========================
  // ============================================================
  function buildHistogram(srcCanvas, useMask) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    const hist = new Uint32Array(256);
    let total = 0;
    let sum = 0, sumSq = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (useMask && d[i + 3] < 8) continue;
      const g = Math.round(lum(d[i], d[i + 1], d[i + 2]));
      hist[g]++;
      total++;
      sum += g;
      sumSq += g * g;
    }
    return { hist, total, mean: total ? sum / total : 128, std: total ? Math.sqrt(sumSq / total - (sum / total) ** 2) : 60 };
  }

  function percentile(hist, total, p) {
    let acc = 0, target = total * p;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  // Otsu's threshold — maximizes between-class variance
  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, wF = 0;
    let varMax = 0, best = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > varMax) { varMax = v; best = t; }
    }
    return best;
  }

  // Otsu's "separability" (between-class / total variance) — high = bimodal
  function otsuSeparability(hist, total) {
    let mean = 0;
    for (let i = 0; i < 256; i++) mean += i * hist[i];
    mean /= total;
    let totalVar = 0;
    for (let i = 0; i < 256; i++) totalVar += hist[i] * (i - mean) ** 2;
    totalVar /= total;
    if (totalVar < 1) return 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0;
    let varMax = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF) / (total * total);
      if (v > varMax) varMax = v;
    }
    return varMax / totalVar;
  }

  // Cheap "lighting unevenness" — std of downsampled luminance.
  function unevennessScore(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    const tileX = 12, tileY = 12;
    const tiles = [];
    for (let ty = 0; ty < tileY; ty++) {
      for (let tx = 0; tx < tileX; tx++) {
        let sum = 0, n = 0;
        const x0 = ((tx * w) / tileX) | 0, x1 = (((tx + 1) * w) / tileX) | 0;
        const y0 = ((ty * h) / tileY) | 0, y1 = (((ty + 1) * h) / tileY) | 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * w + x) * 4;
            if (d[i + 3] < 8) continue;
            sum += lum(d[i], d[i + 1], d[i + 2]);
            n++;
          }
        }
        if (n > 0) tiles.push(sum / n);
      }
    }
    if (tiles.length < 4) return 0;
    const m = tiles.reduce((a, b) => a + b, 0) / tiles.length;
    let v = 0;
    for (const t of tiles) v += (t - m) ** 2;
    return Math.sqrt(v / tiles.length); // std across tiles
  }

  // Cheap noise / texture score — sum of |neighbour diff| on downsampled gray.
  function highFreqScore(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    const step = Math.max(1, Math.min(w, h) > 800 ? 4 : 2);
    for (let y = step; y < h - step; y += step) {
      for (let x = step; x < w - step; x += step) {
        const i  = (y * w + x) * 4;
        const i1 = (y * w + x + step) * 4;
        const i2 = ((y + step) * w + x) * 4;
        if (d[i + 3] < 8) continue;
        const g  = lum(d[i],  d[i + 1],  d[i + 2]);
        const g1 = lum(d[i1], d[i1 + 1], d[i1 + 2]);
        const g2 = lum(d[i2], d[i2 + 1], d[i2 + 2]);
        sum += Math.abs(g - g1) + Math.abs(g - g2);
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  // ----- public auto-tuners ------
  function autoTuneSurrealist(srcCanvas) {
    const { hist, total, mean, std } = buildHistogram(srcCanvas, true);
    // Robust black / white points — tighter than before so blacks crush
    // and the figure separates clearly from background (reference-style).
    let bp = percentile(hist, total, 0.02);
    let wp = percentile(hist, total, 0.985);
    // Push BP up a bit and WP down a bit to crush shadows / blow highlights
    bp = Math.min(120, Math.round(bp + 8));
    wp = Math.max(180, Math.round(wp - 4));
    if (wp - bp < 40) { bp = Math.max(0, mean - 50); wp = Math.min(255, mean + 60); }
    // Gamma: drive the post-level mean slightly DARK (~108) so the subject reads
    const target = 110;
    const meanNorm = clamp((mean - bp) / Math.max(1, wp - bp), 0.05, 0.95);
    let gamma = Math.log(target / 255) / Math.log(meanNorm);
    gamma = clamp(gamma, 0.55, 1.45);
    // Contrast: lean punchier; low-std images get even more
    let contrast = clamp(1.85 - std / 90, 1.15, 2.10);
    const grain = 22;
    return { bp: Math.round(bp), wp: Math.round(wp), gamma: +gamma.toFixed(2), contrast: +contrast.toFixed(2), grain };
  }

  function autoTuneThreshold(srcCanvas) {
    const stats = buildHistogram(srcCanvas, true);
    const { hist, total, mean, std } = stats;

    // Pre-level: gentle BP/WP — don't crush shadows or blow highlights
    let bp = percentile(hist, total, 0.005);
    let wp = percentile(hist, total, 0.995);
    if (wp - bp < 40) { bp = Math.max(0, mean - 60); wp = Math.min(255, mean + 60); }

    // Gamma: aim to push midtones slightly dark so subject reads well,
    // but NOT so dark that we lose all midtone detail.
    const meanNorm = clamp((mean - bp) / Math.max(1, wp - bp), 0.05, 0.95);
    let gamma = Math.log(0.45) / Math.log(meanNorm); // aim mid-grey at .45
    gamma = clamp(gamma, 0.4, 1.8);

    // Analysis scores
    const uneven = unevennessScore(srcCanvas);
    const hf     = highFreqScore(srcCanvas);
    const sep    = otsuSeparability(hist, total);
    const otsuT  = otsuThreshold(hist, total);

    // Local boost — moderate; too much creates noise
    let localBoost = clamp((uneven - 8) / 18, 0.2, 1.8);
    // Pre-smooth — more for noisy input
    let smooth = clamp(Math.round((hf - 8) / 8), 0, 3);

    // ---- MODE PICK ----
    // STRONGLY bias toward dotwork — it preserves volume through stipple
    // and handles most photographic subjects better than hard/adaptive.
    // Only pick hard for cleanly bimodal images (already stencil-like).
    // Only pick edges for actual line art.
    let mode = "dotwork"; // default

    let extremeMass = 0;
    for (let i = 0; i <= 30; i++) extremeMass += hist[i];
    for (let i = 225; i <= 255; i++) extremeMass += hist[i];
    const extremeFrac = extremeMass / total;

    if (extremeFrac > 0.88 && hf > 8) {
      mode = "edges"; // actual line art
    } else if (sep > 0.80 && extremeFrac > 0.70) {
      mode = "hard"; // already very bimodal, stencil makes sense
    }
    // Everything else → dotwork (photos, textures, objects, portraits)

    // ---- THRESHOLD ----
    // For dotwork: set threshold at or slightly below Otsu so solid blacks
    // capture the main darks, and the stipple band handles the rest.
    // Lower threshold = more solid black, higher = more goes to stipple.
    let threshold;
    if (mode === "dotwork") {
      // Pull threshold down from Otsu so main shapes are solid black
      threshold = clamp(Math.round(otsuT * 0.75), 40, 170);
    } else {
      threshold = clamp(otsuT, 50, 210);
    }

    const windowSize = clamp(Math.round(Math.min(srcCanvas.width, srcCanvas.height) / 14), 16, 65);
    const bias       = clamp(Math.round(std / 4.5), 5, 25);
    const edgeSens   = clamp(Math.round(50 - std / 4), 22, 70);


    // ---- STIPPLE OPACITY ----
    // How dark the dot fringe prints. Bimodal/high-contrast images can take darker
    // dots; flat or noisy ones read better with a lighter, airier fringe.
    let stippleOpacity = 55;
    if (sep > 0.70) stippleOpacity = 70;
    else if (sep > 0.55) stippleOpacity = 62;
    if (hf > 20) stippleOpacity -= 10;
    if (std < 45) stippleOpacity -= 8;
    stippleOpacity = clamp(Math.round(stippleOpacity), 20, 90);

    // ---- DESPECKLE ----
    let despeckle = 25;
    if (sep < 0.55) despeckle += 15;
    if (hf > 14)    despeckle += 10;
    if (hf > 24)    despeckle += 8;
    // Dotwork uses lower despeckle to keep stipple dots intact
    if (mode === "dotwork") despeckle = clamp(Math.round(despeckle * 0.6), 0, 40);
    else despeckle = clamp(Math.round(despeckle), 0, 85);

    return {
      bp: Math.round(bp), wp: Math.round(wp), gamma: +gamma.toFixed(2),
      localBoost: +localBoost.toFixed(2),
      smooth,
      mode,
      threshold, stippleOpacity, windowSize, bias, edgeSens,
      despeckle,
      _info: { mean: Math.round(mean), std: Math.round(std), uneven: Math.round(uneven), hf: Math.round(hf), sep: +sep.toFixed(2), extremeFrac: +extremeFrac.toFixed(2) },
    };
  }

  // ============================================================
  // ====================== SURREAL COMPOSER ====================
  // ============================================================
  // Element: { id, name, src (canvas, original size), mask (Uint8Array, src-size),
  //            cx, cy, scale, rot, flipX, opacity, blend, feather, tolerance }
  const S = {
    canvas: null, ctx: null,
    W: 1080, H: 1350,
    bg: "transparent",
    elements: [],
    order: [],          // draw order (indices into elements)
    selectedIdx: null,
    tool: "none",       // none | flood | lassoCut | lasso | erase | restore
    brush: 40,          // brush diameter in canvas px (erase / restore)
    brushing: false,
    lastLocal: null,
    drag: null,
    lassoActive: false,
    lassoPoints: [],    // canvas-space points [x,y,x,y,...]
    open: false,
  };

  function uid() { return "sur_" + Date.now().toString(36) + "_" + ((Math.random() * 1e6) | 0); }

  function cloneCanvas(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  // ============== UNDO / REDO ==============
  const sHistory = { undo: [], redo: [], MAX: 12 };
  let _wheelUndoT = 0;
  // Encendida por defecto. Antes había que acordarse de pulsar STYLE PREVIEW, y
  // sin ella el collage y el estilo eran dos mundos: movías las piezas a ciegas
  // sin ver cómo iban a quedar una vez pasadas por el estilo.
  let livePreviewOn = false;

  // ---------- el collage, ya pasado por el estilo ----------
  // Ella lo pidió así: mover las fotos y tocar el estilo como si fueran una
  // sola cosa. Para eso el lienzo no puede enseñar las fotos crudas — tiene que
  // enseñar cómo van a quedar. Pero pasarlas por el estilo en cada fotograma
  // del arrastre iría a tirones, así que:
  //
  //   · mientras arrastra  -> se pinta crudo, que es instantáneo
  //   · al soltar          -> se rehace con estilo y se cambia
  //
  // Así el arrastre va suelto y el resultado aparece en cuanto levanta el dedo.
  let estiloLienzo = null;      // el collage con estilo, ya pintado
  let estiloTimer = null;
  function ensuciarEstilo() {
    clearTimeout(estiloTimer);
    estiloTimer = setTimeout(rehacerEstilo, 180);
  }
  async function rehacerEstilo() {
    if (!window.KAOS_APP || !KAOS_APP.previewSurrealStyle) return;
    if (!S.elements.length) { estiloLienzo = null; return; }
    try {
      const hasResources = S.elements.some(e => e.isResource);
      const base = hasResources ? bakeMergedCanvas("no-resources") : bakeMergedCanvas();
      const hecho = await KAOS_APP.previewSurrealStyle(base, 900, elementMasks());
      if (!hecho) return;
      if (hasResources) {
        const res = bakeMergedCanvas("resources");
        const rW = hecho.width, rH = hecho.height;
        const sX = rW / S.W, sY = rH / S.H;
        const rc = document.createElement("canvas");
        rc.width = rW; rc.height = rH;
        const rctx = rc.getContext("2d");
        rctx.drawImage(res, 0, 0, rW, rH);
        hecho.getContext("2d").drawImage(rc, 0, 0);
      }
      estiloLienzo = hecho;
      render();
    } catch (e) { console.warn("no se pudo pintar el collage con estilo", e); }
  }
  let livePreviewRAF = null;
  function scheduleLivePreview() {
    // El lienzo con estilo se rehace SIEMPRE, mire ella el recuadro pequeño o
    // no: es el dibujo principal, no un extra.
    ensuciarEstilo();
    if (!livePreviewOn || livePreviewRAF) return;
    livePreviewRAF = requestAnimationFrame(() => { livePreviewRAF = null; updateLivePreview(); });
  }
  async function updateLivePreview() {
    // Aquí ponía `D.livePreviewCanvas`, y `D` no existe a esta altura del
    // fichero: el cacheado se llama `dom` y `D` sólo vive dentro de las
    // funciones que hacen `const D = getDom()`. O sea que esto reventaba en la
    // primera línea, siempre — y como reventaba dentro de una función async, el
    // fallo se iba por el desagüe sin salir por ningún lado. La previa de
    // estilo no ha funcionado nunca; se veía la caja vacía y parecía que el
    // collage no daba para más.
    const D = getDom();
    if (!window.KAOS_APP || !KAOS_APP.previewSurrealStyle || !D.livePreviewCanvas) return;
    if (!S.elements.length) return;
    const merged = bakeMergedCanvas();
    try {
      const styled = await KAOS_APP.previewSurrealStyle(merged);
      if (!styled) return;
      const c = D.livePreviewCanvas;
      c.width = styled.width; c.height = styled.height;
      c.getContext("2d").drawImage(styled, 0, 0);
    } catch (e) { console.warn("la previa de estilo falló", e); }
  }

  function surrealSnap() {
    return {
      elements: S.elements.map(e => ({
        id: e.id, name: e.name, w: e.w, h: e.h,
        cx: e.cx, cy: e.cy, scale: e.scale, rot: e.rot,
        flipX: e.flipX, opacity: e.opacity, blend: e.blend,
        feather: e.feather, tolerance: e.tolerance, tinte: e.tinte || null,
        mask: new Uint8Array(e.mask),
        src: cloneCanvas(e.src),
        origSrc: e.origSrc ? cloneCanvas(e.origSrc) : null,
      })),
      order: S.order.slice(),
      selectedIdx: S.selectedIdx,
      W: S.W, H: S.H, bg: S.bg,
    };
  }
  function pushSurrealUndo() {
    sHistory.undo.push(surrealSnap());
    if (sHistory.undo.length > sHistory.MAX) sHistory.undo.shift();
    sHistory.redo.length = 0;
    updateSurrealHistoryUI();
  }
  function surrealUndoFn() {
    if (!sHistory.undo.length) return;
    sHistory.redo.push(surrealSnap());
    applySurrealSnap(sHistory.undo.pop());
    updateSurrealHistoryUI();
  }
  function surrealRedoFn() {
    if (!sHistory.redo.length) return;
    sHistory.undo.push(surrealSnap());
    applySurrealSnap(sHistory.redo.pop());
    updateSurrealHistoryUI();
  }
  function applySurrealSnap(snap) {
    S.W = snap.W; S.H = snap.H; S.bg = snap.bg;
    S.selectedIdx = snap.selectedIdx;
    S.order = snap.order.slice();
    S.elements = snap.elements.map(e => ({
      id: e.id, name: e.name, w: e.w, h: e.h,
      cx: e.cx, cy: e.cy, scale: e.scale, rot: e.rot,
      flipX: e.flipX, opacity: e.opacity, blend: e.blend,
      feather: e.feather, tolerance: e.tolerance,
      mask: new Uint8Array(e.mask),
      src: cloneCanvas(e.src),
      origSrc: e.origSrc ? cloneCanvas(e.origSrc) : null,
      _thumb: null, _renderCanvas: null, _renderKey: null,
      _maskVer: Date.now(),
    }));
    S.elements.forEach(e => rebuildThumb(e));
    sizeCanvas();
    render();
    renderLayerList();
    syncPanel();
    updateEmpty();
    $$("#surrealSize .tog").forEach(b => {
      b.setAttribute("aria-selected", parseInt(b.dataset.w) === S.W && parseInt(b.dataset.h) === S.H);
    });
    $$("#surrealBg .tog").forEach(b => {
      b.setAttribute("aria-selected", b.dataset.bg === S.bg);
    });
  }
  function clearSurrealHistory() {
    sHistory.undo.length = 0;
    sHistory.redo.length = 0;
    updateSurrealHistoryUI();
  }
  function updateSurrealHistoryUI() {
    const ub = document.getElementById("surrealUndoBtn");
    const rb = document.getElementById("surrealRedoBtn");
    if (ub) ub.disabled = sHistory.undo.length === 0;
    if (rb) rb.disabled = sHistory.redo.length === 0;
  }

  // ---------- DOM refs (lazy) ----------
  let dom = null;
  let dragLayerElIdx = null;   // element index currently being drag-reordered
  function getDom() {
    if (dom) return dom;
    dom = {
      modal:        $("#surrealModal"),
      canvas:       $("#surrealCanvas"),
      wrap:         $("#surrealCanvasWrap"),
      empty:        $("#surrealEmpty"),
      hint:         $("#surrealHint"),
      layers:       $("#surrealLayers"),
      layerCount:   $("#surrealLayerCount"),
      panel:        $("#surrealElementPanel"),
      panelHint:    $("#surrealElementHint"),
      scale:        $("#surrealScale"),
      scaleVal:     $("#surrealScaleVal"),
      rot:          $("#surrealRot"),
      rotVal:       $("#surrealRotVal"),
      op:           $("#surrealOp"),
      opVal:        $("#surrealOpVal"),
      feather:      $("#surrealFeather"),
      featherVal:   $("#surrealFeatherVal"),
      tol:          $("#surrealTol"),
      tolVal:       $("#surrealTolVal"),
      blend:        $("#surrealBlend"),
      tinte:        $("#surrealTinte"),
      tool:         $("#surrealCutTool"),
      brush:        $("#surrealBrush"),
      brushVal:     $("#surrealBrushVal"),
      brushCtl:     $("#surrealBrushCtl"),
      cutTip:       $("#surrealCutTip"),
      size:         $("#surrealSize"),
      bg:           $("#surrealBg"),
      addInput:     $("#surrealAddInput"),
      addBtn:       $("#surrealAddBtn"),
      clearBtn:     $("#surrealClearBtn"),
      closeBtn:     $("#surrealCloseBtn"),
      openBtn:      $("#surrealOpenBtn"),
      autoCutBtn:   $("#surrealAutoCut"),
      resetCutBtn:  $("#surrealResetCut"),
      fwdBtn:       $("#surrealFwdBtn"),
      bwdBtn:       $("#surrealBwdBtn"),
      flipBtn:      $("#surrealFlipBtn"),
      dupBtn:       $("#surrealDupBtn"),
      removeBtn:    $("#surrealRemoveBtn"),
      finishReal:   $("#surrealFinishRealistic"),
      finishContr:  $("#surrealFinishContrast"),
      sendRaw:      $("#surrealSendRaw"),
      livePreviewToggle: $("#surrealLivePreviewToggle"),
      livePreviewBox:    $("#surrealLivePreview"),
      livePreviewCanvas: $("#surrealLivePreviewCanvas"),
    };
    return dom;
  }

  function open() {
    const D = getDom();
    S.open = true;
    engancharClicAnadir();
    D.modal.style.display = "";
    // La caja de la previa nace escondida en el HTML y el interruptor nace
    // apagado. Como ahora la previa va encendida de serie, hay que ponerlos de
    // acuerdo aquí: si no, la previa se pinta pero no se ve.
    if (D.livePreviewBox) D.livePreviewBox.style.display = livePreviewOn ? "" : "none";
    if (D.livePreviewToggle) D.livePreviewToggle.setAttribute("aria-selected", livePreviewOn ? "true" : "false");
    S.canvas = D.canvas;
    S.ctx = S.canvas.getContext("2d");
    sizeCanvas();
    render();
  }
  function close() {
    const D = getDom();
    S.open = false;
    D.modal.style.display = "none";
  }

  function sizeCanvas() {
    S.canvas.width  = S.W;
    S.canvas.height = S.H;
  }

  // Los mandos de papel (color, grano, sombra) sólo salen si hay papel. Con el
  // fondo transparente no hay nada que ajustar y sólo estorban.
  // Anadir fotos sin boton: UN clic en el lienzo abre el buscador de archivos.
  //
  // Solo si el clic cae en hueco: si cae encima de una foto la esta eligiendo,
  // y si viene de arrastrar la esta soltando. Abrir el dialogo en esos dos
  // casos haria imposible trabajar. Por eso se mira que no haya arrastre en
  // curso y que no haya nada bajo el dedo.
  function engancharClicAnadir() {
    const D = getDom();
    if (D.canvas && !D.canvas._clicAnadir) {
      D.canvas._clicAnadir = true;
      let bajoX = 0, bajoY = 0;
      D.canvas.addEventListener("pointerdown", (e) => { bajoX = e.clientX; bajoY = e.clientY; });
      D.canvas.addEventListener("click", (e) => {
        if (Math.hypot(e.clientX - bajoX, e.clientY - bajoY) > 4) return;   // ha arrastrado
        if (S.drag) return;
        if (hayElementoBajo(e)) return;                                     // ha elegido una foto
        if (D.addInput) D.addInput.click();
      });
    }
    if (D.empty && !D.empty._clicAnadir) {
      D.empty._clicAnadir = true;
      D.empty.addEventListener("click", () => { if (D.addInput) D.addInput.click(); });
    }
  }

  // Que hay justo debajo del dedo. Se reusa el mismo calculo que la seleccion:
  // el lienzo se ve escalado por CSS, asi que hay que pasar de pixeles de
  // pantalla a pixeles del lienzo antes de comparar con las cajas.
  function hayElementoBajo(e) {
    const r = S.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (S.W / r.width);
    const y = (e.clientY - r.top) * (S.H / r.height);
    for (let i = S.order.length - 1; i >= 0; i--) {
      const el = S.elements[S.order[i]];
      if (!el) continue;
      const hw = (el.w * el.scale) / 2, hh = (el.h * el.scale) / 2;
      const a = -el.rot * Math.PI / 180;
      const dx = x - el.cx, dy = y - el.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return true;
    }
    return false;
  }

  function sincronizarPapel() {
    const caja = document.getElementById("paperSoloPapel");
    const aviso = document.getElementById("paperAvisoTransparente");
    const hayPapel = S.bg === "paper";
    if (caja) caja.hidden = !hayPapel;
    if (aviso) aviso.hidden = hayPapel;
  }

  function selected() { return S.selectedIdx != null ? S.elements[S.selectedIdx] : null; }

  // Deja el collage en blanco. Lo llama el botón de vaciar y también el RESET
  // grande de app.js: ese borraba la foto del estilo pero no las del collage, y
  // como el lienzo del collage ES ahora el lienzo principal, todo seguía ahí.
  function vaciar() {
    S.elements = []; S.order = []; S.selectedIdx = null;
    estiloLienzo = null;
    clearTimeout(estiloTimer);
    if (S.ctx) { render(); renderLayerList(); updateEmpty(); }
  }

  // ---------- adding elements ----------
  // Un lienzo ya pintado (una mini mandala, por ejemplo) entra como un elemento
  // más. Se convierte a PNG y se mete por la misma puerta que una foto: así
  // hereda el recorte, las capas, el giro y todo lo demás sin código nuevo.
  async function addCanvas(canvas, nombre) {
    // Tal cual viene: tinta sobre transparente.
    //
    // Antes se le pintaba un fondo BLANCO detras. Era un apano para el recorte
    // automatico, que miraba solo el color de las esquinas: una mandala llega
    // en negro sobre nada, la esquina transparente se leia como negro y el
    // recorte se comia el dibujo entero. Con el blanco detras el recorte tenia
    // algo que quitar... pero solo llegaba al blanco de FUERA. El de dentro de
    // los petalos se quedaba, y la mandala entraba con las tripas blancas.
    //
    // Ya no hace falta: `addFile` mira si la imagen viene recortada y entonces
    // no la toca.
    const copia = document.createElement("canvas");
    copia.width = canvas.width;
    copia.height = canvas.height;
    copia.getContext("2d").drawImage(canvas, 0, 0);
    const blob = await new Promise((res) => copia.toBlob(res, "image/png"));
    copia.width = copia.height = 1;
    if (!blob) return;
    await addFiles([new File([blob], (nombre || "mandala") + ".png", { type: "image/png" })], { isResource: true });
  }

  async function addFiles(files, opts) {
    if (files.length > 0) pushSurrealUndo();
    for (const f of files) await addFile(f, opts);
    render();
    renderLayerList();
    updateEmpty();
    scheduleLivePreview();
  }
  function addFile(file, opts) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);

        // initial mask = all kept
        const mask = new Uint8Array(w * h);
        mask.fill(255);

        // sensible initial placement & scale: fit ~60% of canvas
        const fit = Math.min(S.W * 0.65 / w, S.H * 0.65 / h);
        const isFirst = S.elements.length === 0;
        const e = {
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 16) || "layer",
          src: c, mask, w, h,
          origSrc: cloneCanvas(c),
          cx: S.W / 2 + (Math.random() - 0.5) * S.W * 0.1,
          cy: S.H / 2 + (Math.random() - 0.5) * S.H * 0.1,
          scale: fit,
          rot: 0,
          flipX: false,
          opacity: 1.0,
          blend: "source-over",
          // Sin teñir. Ver TINTES: null = la foto tal cual.
          tinte: null,
          feather: 2,
          tolerance: 30,
          _thumb: null,
          isResource: !!(opts && opts.isResource),
        };
        S.elements.push(e);
        S.order.push(S.elements.length - 1);
        S.selectedIdx = S.elements.length - 1;

        // Recorte automatico SOLO si la imagen trae fondo que quitar.
        //
        // Un diseno de su galeria ya viene recortado: es tinta sobre
        // transparente. Ahi el borde transparente se lee como rgba(0,0,0,0),
        // o sea negro, y el relleno desde las esquinas se comia tambien la
        // tinta negra del dibujo — entraba el elemento, salia el recuadro de
        // seleccion y dentro no habia nada.
        if (!yaRecortada(c, w, h)) smartAutoCut(e);
        rebuildThumb(e);

        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    });
  }

  // ---------- cutout ops on per-element source ----------
  function getSrcData(e) {
    return e.src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, e.w, e.h).data;
  }
  function floodFillElement(e, sx, sy, tolerance) {
    if (sx < 0 || sy < 0 || sx >= e.w || sy >= e.h) return;
    const src = getSrcData(e);
    const i0 = (sy * e.w + sx) * 4;
    const r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2];
    const T2 = tolerance * tolerance;
    const stack = [sx, sy];
    const visited = new Uint8Array(e.w * e.h);
    while (stack.length) {
      const y = stack.pop(); const x = stack.pop();
      if (x < 0 || y < 0 || x >= e.w || y >= e.h) continue;
      const j = y * e.w + x;
      if (visited[j]) continue;
      visited[j] = 1;
      const i = j * 4;
      const dr = src[i] - r0, dg = src[i + 1] - g0, db = src[i + 2] - b0;
      if (dr * dr + dg * dg + db * db > T2) continue;
      e.mask[j] = 0;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }
  function restoreFloodElement(e, sx, sy, tolerance) {
    if (sx < 0 || sy < 0 || sx >= e.w || sy >= e.h) return;
    const src = getSrcData(e);
    const i0 = (sy * e.w + sx) * 4;
    const r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2];
    const T2 = tolerance * tolerance;
    const stack = [sx, sy];
    const visited = new Uint8Array(e.w * e.h);
    while (stack.length) {
      const y = stack.pop(); const x = stack.pop();
      if (x < 0 || y < 0 || x >= e.w || y >= e.h) continue;
      const j = y * e.w + x;
      if (visited[j]) continue;
      visited[j] = 1;
      const i = j * 4;
      const dr = src[i] - r0, dg = src[i + 1] - g0, db = src[i + 2] - b0;
      if (dr * dr + dg * dg + db * db > T2) continue;
      e.mask[j] = 255;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }
  function autoCutFromCorners(e) {
    // Legacy quick flood from the 4 corners.
    const corners = [[2, 2], [e.w - 3, 2], [2, e.h - 3], [e.w - 3, e.h - 3]];
    for (const [x, y] of corners) floodFillElement(e, x, y, e.tolerance);
  }
  // Smart background removal: samples MANY perimeter points, clusters them
  // by colour, and floods from each distinct cluster. Catches gradient
  // backgrounds and backgrounds that don't hit the corners cleanly.
  // ¿La imagen viene ya sin fondo? Se mira el borde: si la mayoria de los
  // pixeles del contorno son transparentes, no hay fondo que quitar.
  function yaRecortada(canvas, w, h) {
    if (w < 4 || h < 4) return false;
    const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let vistos = 0, transparentes = 0;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const x = Math.round(t * (w - 1)), y = Math.round(t * (h - 1));
      for (const [px, py] of [[x, 1], [x, h - 2], [1, y], [w - 2, y]]) {
        vistos++;
        if (d[(py * w + px) * 4 + 3] < 16) transparentes++;
      }
    }
    return vistos > 0 && transparentes / vistos >= 0.6;
  }
  function smartAutoCut(e) {
    const w = e.w, h = e.h;
    if (w < 4 || h < 4) return;
    const src = getSrcData(e);
    // Sample ~32 points around the perimeter
    const samples = [];
    const N_PER_SIDE = 8;
    for (let i = 0; i < N_PER_SIDE; i++) {
      const t = (i + 0.5) / N_PER_SIDE;
      samples.push([Math.round(t * (w - 1)), 2]);            // top
      samples.push([Math.round(t * (w - 1)), h - 3]);        // bottom
      samples.push([2, Math.round(t * (h - 1))]);            // left
      samples.push([w - 3, Math.round(t * (h - 1))]);        // right
    }
    // Cluster by RGB distance using tolerance²
    const tol = Math.max(20, e.tolerance);
    const T2 = tol * tol;
    const clusters = []; // [{r,g,b}]
    for (const [x, y] of samples) {
      const i = (y * w + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      let merged = false;
      for (const c of clusters) {
        const dr = c.r - r, dg = c.g - g, db = c.b - b;
        if (dr * dr + dg * dg + db * db < T2) {
          c.r = (c.r + r) >> 1; c.g = (c.g + g) >> 1; c.b = (c.b + b) >> 1;
          merged = true; break;
        }
      }
      if (!merged) clusters.push({ r, g, b, sx: x, sy: y });
    }
    // Flood from one representative pixel of each cluster
    for (const c of clusters) floodFillElement(e, c.sx, c.sy, tol);
    // Final cleanup pass: a slightly tighter flood from the 4 corners
    // catches any leftover edge halo.
    const c2 = Math.max(15, Math.round(tol * 0.7));
    for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) {
      floodFillElement(e, x, y, c2);
    }
  }
  function resetCutout(e) { e.mask.fill(255); }

  // ----- brush cut / restore, same feel as the styler's mask editor -----
  function brushElement(e, lx, ly, r, restore) {
    const v = restore ? 255 : 0;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(lx - r)), x1 = Math.min(e.w - 1, Math.ceil(lx + r));
    const y0 = Math.max(0, Math.floor(ly - r)), y1 = Math.min(e.h - 1, Math.ceil(ly + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y - ly;
      for (let x = x0; x <= x1; x++) {
        const dx = x - lx;
        if (dx * dx + dy * dy <= r2) e.mask[y * e.w + x] = v;
      }
    }
  }
  function brushLineElement(e, x0, y0, x1, y1, r, restore) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, r * 0.4)));
    for (let i = 0; i <= steps; i++) {
      brushElement(e, x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, r, restore);
    }
  }
  function localBrushRadius(e) {
    return Math.max(1, (S.brush / 2) / (e.scale || 1));
  }

  // Polygon scanline fill into Uint8 mask. polyXY are element-local pixel coords.
  function fillPolygonToElementMask(e, polyXY, value) {
    const w = e.w, h = e.h, mask = e.mask;
    if (polyXY.length < 6) return;
    let minY = h, maxY = 0;
    for (let i = 1; i < polyXY.length; i += 2) {
      if (polyXY[i] < minY) minY = polyXY[i];
      if (polyXY[i] > maxY) maxY = polyXY[i];
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(h - 1, Math.ceil(maxY));
    const n = polyXY.length / 2;
    for (let y = minY; y <= maxY; y++) {
      const nodes = [];
      for (let i = 0; i < n; i++) {
        const x1 = polyXY[i * 2], y1 = polyXY[i * 2 + 1];
        const j = (i + 1) % n;
        const x2 = polyXY[j * 2], y2 = polyXY[j * 2 + 1];
        if ((y1 < y && y2 >= y) || (y2 < y && y1 >= y)) {
          nodes.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
        }
      }
      nodes.sort((a, b) => a - b);
      for (let k = 0; k + 1 < nodes.length; k += 2) {
        const xa = Math.max(0, Math.floor(nodes[k]));
        const xb = Math.min(w - 1, Math.ceil(nodes[k + 1]));
        for (let x = xa; x <= xb; x++) mask[y * w + x] = value;
      }
    }
  }

  // ---------- per-element thumb ----------
  function rebuildThumb(e) {
    const TS = 48;
    const ar = e.w / e.h;
    let tw, th;
    if (ar >= 1) { tw = TS; th = Math.round(TS / ar); } else { th = TS; tw = Math.round(TS * ar); }
    const c = document.createElement("canvas");
    c.width = tw; c.height = th;
    const ctx = c.getContext("2d");
    // checkerboard
    ctx.fillStyle = "#2a2722"; ctx.fillRect(0, 0, tw, th);
    for (let y = 0; y < th; y += 4) {
      for (let x = (y % 8 === 0 ? 0 : 4); x < tw; x += 8) {
        ctx.fillStyle = "#1b1916"; ctx.fillRect(x, y, 4, 4);
      }
    }
    // masked element preview
    const mc = bakeMaskedCanvas(e);
    ctx.drawImage(mc, 0, 0, tw, th);
    e._thumb = c.toDataURL("image/png");
  }

  // Build a canvas of element source with mask applied as alpha (no feather; quick).
  function bakeMaskedCanvas(e) {
    const c = document.createElement("canvas");
    c.width = e.w; c.height = e.h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(e.src, 0, 0);
    const img = ctx.getImageData(0, 0, e.w, e.h);
    const d = img.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (e.mask[j] < 128) d[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // El color con el que se puede teñir cada foto vive en app.js (TINTES): allí
  // es donde la capa de estilo ya está hecha y se le puede cambiar el color sin
  // alterar el dibujo. Aquí sólo se guarda CUÁL quiere cada elemento.

  // High-quality bake with optional feather (1-D box blur on alpha).
  function bakeMaskedFeathered(e) {
    const base = bakeMaskedCanvas(e);
    if (!e.feather || e.feather < 1) return base;
    const w = e.w, h = e.h;
    const ctx = base.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const alpha = new Float32Array(w * h);
    for (let i = 3, j = 0; i < d.length; i += 4, j++) alpha[j] = d[i];
    const r = Math.max(1, Math.round(e.feather));
    const tmp = new Float32Array(w * h);
    const div = r * 2 + 1;
    // horizontal
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += alpha[y * w + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / div;
        sum -= alpha[y * w + clamp(x - r, 0, w - 1)];
        sum += alpha[y * w + clamp(x + r + 1, 0, w - 1)];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        const blurred = sum / div;
        const j = y * w + x;
        d[j * 4 + 3] = blurred;
        sum -= tmp[clamp(y - r, 0, h - 1) * w + x];
        sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x];
      }
    }
    ctx.putImageData(img, 0, 0);
    return base;
  }

  // Cache the feathered bake per element (invalidate on mask/feather change).
  function getRenderCanvas(e) {
    const key = e.mask.byteLength + ":" + e.feather + ":" + (e._maskVer || 0);
    if (e._renderCanvas && e._renderKey === key) return e._renderCanvas;
    e._renderCanvas = bakeMaskedFeathered(e);
    e._renderKey = key;
    return e._renderCanvas;
  }
  function invalidate(e) {
    e._maskVer = (e._maskVer || 0) + 1;
    e._renderCanvas = null;
    rebuildThumb(e);
  }

  // ---------- render ----------
  // Negro liso. Antes eran cuadros de tablero, la señal de «aquí no hay nada»
  // de los programas de retoque. Ella lo quiere negro: es su color de marca y
  // el dibujo, que va en tinta negra sobre nada, se lee mejor sin el damero
  // vibrando por debajo.
  function paintCheckerBg() {
    S.ctx.fillStyle = "#0a0908";
    S.ctx.fillRect(0, 0, S.W, S.H);
  }
  function paintPaperBg() {
    const c = window.KAOS_GALLERY && KAOS_GALLERY.paintPaperSeeded;
    if (c) { c(S.ctx, S.W, S.H, "#d9d4c8", 7); return; }
    S.ctx.fillStyle = "#d9d4c8";
    S.ctx.fillRect(0, 0, S.W, S.H);
  }

  // app.js necesita saber si hay piezas montadas para encender o apagar
  // GUARDAR / EXPORT / DUPLICAR. Solo se avisa cuando pasa de vacio a lleno o
  // al reves, no en cada repintado de un arrastre.
  let _habiaElementos = null;
  function avisarSiCambia() {
    const hay = S.elements.length > 0;
    if (hay === _habiaElementos) return;
    _habiaElementos = hay;
    document.dispatchEvent(new CustomEvent("kaos-collage", { detail: { hay: hay } }));
  }
  function render() {
    if (!S.ctx) return;
    avisarSiCambia();
    const W = S.W, H = S.H;
    S.ctx.clearRect(0, 0, W, H);
    if (S.bg === "paper") paintPaperBg();
    else paintCheckerBg();

    // Con estilo si lo hay y no está arrastrando; crudo mientras arrastra.
    if (estiloLienzo && !S.drag) {
      S.ctx.drawImage(estiloLienzo, 0, 0, W, H);
    } else {
      for (const idx of S.order) {
        const e = S.elements[idx];
        if (!e) continue;
        const rc = getRenderCanvas(e);
        S.ctx.save();
        S.ctx.globalAlpha = e.opacity;
        S.ctx.globalCompositeOperation = e.blend || "source-over";
        S.ctx.translate(e.cx, e.cy);
        S.ctx.rotate(e.rot * Math.PI / 180);
        const sx = e.flipX ? -1 : 1;
        S.ctx.scale(e.scale * sx, e.scale);
        S.ctx.drawImage(rc, -e.w / 2, -e.h / 2);
        S.ctx.restore();
      }
    }

    // selection chrome — interactive box with corner resize handles + rotation handle
    if (S.selectedIdx != null) {
      const e = S.elements[S.selectedIdx];
      if (e) {
        const { corners, rotate, hw, hh, ds } = elementHandlePoints(e);
        S.ctx.save();
        S.ctx.translate(e.cx, e.cy);
        S.ctx.rotate(e.rot * Math.PI / 180);
        // dashed bounding box
        S.ctx.strokeStyle = "#c9342a";
        S.ctx.lineWidth = 1.5 * ds;
        S.ctx.setLineDash([10 * ds, 6 * ds]);
        S.ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
        S.ctx.setLineDash([]);
        // rotation arm + knob
        S.ctx.lineWidth = 1.5 * ds;
        S.ctx.beginPath();
        S.ctx.moveTo(0, -hh);
        S.ctx.lineTo(rotate[0], rotate[1]);
        S.ctx.stroke();
        const hr = 7 * ds;
        S.ctx.lineWidth = 2 * ds;
        S.ctx.fillStyle = "#1b1916";
        S.ctx.beginPath();
        S.ctx.arc(rotate[0], rotate[1], hr, 0, Math.PI * 2);
        S.ctx.fill(); S.ctx.stroke();
        // corner square handles
        const sq = 9 * ds;
        for (const [x, y] of corners) {
          S.ctx.fillStyle = "#1b1916";
          S.ctx.lineWidth = 2 * ds;
          S.ctx.beginPath();
          S.ctx.rect(x - sq / 2, y - sq / 2, sq, sq);
          S.ctx.fill(); S.ctx.stroke();
        }
        S.ctx.restore();
      }
    }

    // Lasso preview
    if (S.lassoActive && S.lassoPoints.length >= 4) {
      S.ctx.save();
      S.ctx.strokeStyle = "#ffd24a";
      S.ctx.lineWidth = 2;
      S.ctx.setLineDash([8, 6]);
      S.ctx.beginPath();
      const p = S.lassoPoints;
      S.ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) S.ctx.lineTo(p[i], p[i + 1]);
      S.ctx.stroke();
      S.ctx.restore();
    }
    scheduleLivePreview();
  }

  function updateEmpty() {
    const D = getDom();
    const has = S.elements.length > 0;
    // Los mandos del collage se ven SIEMPRE: son la puerta de entrada. Los
    // escondía cuando no había piezas y así no había por dónde empezar un
    // collage — al quitar la pestaña COMPOSE, esa era la única entrada que
    // quedaba y la tapé.
    const sec = document.getElementById("composeSeccion");
    if (sec) sec.hidden = false;

    // El LIENZO del collage es otra cosa: ese sí tapa el lienzo normal, así que
    // sólo sale cuando hay algo que enseñar. Se enciende al meter la primera
    // pieza y se apaga al quitar la última, sin que ella tenga que pulsar nada.
    // El collage se queda puesto salvo que haya una foto en el lienzo
    // principal. Sin foto y sin piezas es la pantalla de inicio — el sitio
    // donde soltar las fotos, que antes era el cartel de «drop a soul».
    const hayFoto = !!(window.KAOS_APP && KAOS_APP.hayImagen && KAOS_APP.hayImagen());
    const tapando = D.modal.style.display !== "none";
    if (!hayFoto || has) { if (!tapando) open(); }
    else if (tapando) close();
    D.empty.style.display = has ? "none" : "";
    D.layerCount.textContent = S.elements.length;
    D.panel.style.display = (S.selectedIdx != null) ? "" : "none";
    D.finishReal.disabled = D.finishContr.disabled = D.sendRaw.disabled = !has;
    // Sin piezas no hay de dónde volver: el botón se apaga en vez de quedarse
    // ahí ofreciendo salir de un sitio donde no estás.
    if (D.closeBtn) D.closeBtn.disabled = !has;
  }

  // Duplicar una capa. Vive fuera de los botones porque la piden dos sitios:
  // el «⧉ DUP» del panel del elemento seleccionado y el ⧉ de cada fila de la
  // lista de capas. La copia sale 28 px abajo y a la derecha para que se vea
  // que hay dos y no parezca que no ha pasado nada.
  function duplicarElemento(idx) {
    if (idx == null) return;
    const src = S.elements[idx];
    if (!src) return;
    pushSurrealUndo();
    const clone = {
      id: uid(), name: (src.name || "layer") + " copy",
      src: cloneCanvas(src.src), mask: new Uint8Array(src.mask), w: src.w, h: src.h,
      origSrc: src.origSrc ? cloneCanvas(src.origSrc) : null,
      cx: src.cx + 28, cy: src.cy + 28,
      scale: src.scale, rot: src.rot, flipX: src.flipX,
      opacity: src.opacity, blend: src.blend, feather: src.feather, tolerance: src.tolerance,
      _thumb: null,
    };
    S.elements.push(clone);
    S.order.push(S.elements.length - 1);
    S.selectedIdx = S.elements.length - 1;
    rebuildThumb(clone);
    render(); renderLayerList(); syncPanel();
  }

  function renderLayerList() {
    const D = getDom();
    D.layers.innerHTML = "";
    // render top-to-bottom (top of order = top of stack = first in list)
    const orderTopFirst = S.order.slice().reverse();
    for (const idx of orderTopFirst) {
      const e = S.elements[idx];
      if (!e) continue;
      const row = document.createElement("div");
      row.className = "surreal-layer";
      row.dataset.elidx = idx;
      if (idx === S.selectedIdx) row.classList.add("selected");
      row.innerHTML = `
        <span class="grip" title="Drag to reorder">⠿</span>
        <img class="thumb" src="${e._thumb || ""}" alt="">
        <input class="name" type="text" value="${escapeHtml(e.name)}" maxlength="24" data-name>
        <span class="sz">${Math.round(e.scale * 100)}%</span>
        <button class="dup" type="button" title="Duplicar esta capa">⧉</button>
      `;
      row.querySelector(".dup").addEventListener("click", (ev) => {
        ev.stopPropagation();          // duplicar, no solo seleccionar la fila
        duplicarElemento(idx);
      });
      const nameInput = row.querySelector("[data-name]");
      nameInput.addEventListener("click", ev => ev.stopPropagation());
      nameInput.addEventListener("input", ev => { e.name = ev.target.value || "layer"; });
      row.addEventListener("click", (ev) => {
        if (ev.target === nameInput) return;
        S.selectedIdx = idx;
        syncPanel();
        render();
        renderLayerList();
      });

      // ----- drag to reorder (grip is the drag source, row is the drop zone) -----
      const grip = row.querySelector(".grip");
      grip.setAttribute("draggable", "true");
      grip.addEventListener("dragstart", (ev) => {
        dragLayerElIdx = idx;
        ev.dataTransfer.effectAllowed = "move";
        try { ev.dataTransfer.setData("text/plain", String(idx)); } catch (e) {}
        row.classList.add("dragging");
      });
      grip.addEventListener("dragend", () => {
        dragLayerElIdx = null;
        $$(".surreal-layer", D.layers).forEach(r => r.classList.remove("dragging", "drop-above", "drop-below"));
      });
      row.addEventListener("dragover", (ev) => {
        if (dragLayerElIdx == null) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const below = (ev.clientY - rect.top) > rect.height / 2;
        row.classList.toggle("drop-below", below);
        row.classList.toggle("drop-above", !below);
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-above", "drop-below"));
      row.addEventListener("drop", (ev) => {
        if (dragLayerElIdx == null) return;
        ev.preventDefault();
        row.classList.remove("drop-above", "drop-below");
        if (dragLayerElIdx !== idx) {
          const rect = row.getBoundingClientRect();
          const below = (ev.clientY - rect.top) > rect.height / 2;
          reorderLayer(dragLayerElIdx, idx, below);
        }
      });

      D.layers.appendChild(row);
    }
    updateEmpty();
  }
  // Cualquier cambio que altere COMO se ve el montaje tiene que rehacer tambien
  // el lienzo con estilo, que va cacheado aparte. Si solo se llama a `render()`
  // se repinta la version guardada de antes: el cambio se hacia por dentro pero
  // en pantalla no se movia nada — asi es como el orden de capas parecia roto.
  function repintarTodo() {
    render();
    renderLayerList();
    scheduleLivePreview();
  }

  // Move element srcIdx to just above/below targetIdx in the visual stack.
  function reorderLayer(srcIdx, targetIdx, below) {
    pushSurrealUndo();
    let vis = S.order.slice().reverse(); // panel order = top of stack first
    const from = vis.indexOf(srcIdx);
    if (from < 0) return;
    vis.splice(from, 1);
    const to = vis.indexOf(targetIdx);
    if (to < 0) vis.push(srcIdx);
    else vis.splice(below ? to + 1 : to, 0, srcIdx);
    S.order = vis.reverse();
    repintarTodo();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

  function syncPanel() {
    const e = selected();
    const D = getDom();
    if (!e) { D.panel.style.display = "none"; return; }
    D.panel.style.display = "";
    D.panelHint.textContent = e.name;
    D.scale.value = e.scale;     D.scaleVal.textContent = e.scale.toFixed(2);
    D.rot.value = e.rot;         D.rotVal.textContent = Math.round(e.rot) + "°";
    D.op.value = e.opacity;      D.opVal.textContent = e.opacity.toFixed(2);
    D.feather.value = e.feather; D.featherVal.textContent = e.feather;
    D.tol.value = e.tolerance;   D.tolVal.textContent = e.tolerance;
    $$('#surrealBlend .tog').forEach(b => b.setAttribute("aria-selected", b.dataset.blend === (e.blend || "source-over")));
    $$('#surrealTinte .tog').forEach(b => b.setAttribute("aria-selected", (b.dataset.tinte || "") === (e.tinte || "")));
    $$('#surrealCutTool .tog').forEach(b => b.setAttribute("aria-selected", b.dataset.tool === S.tool));
    syncCutTool();
  }
  // Mirrors the styler's mask editor: brush size only for the brushes, a tip per lasso.
  function syncCutTool() {
    const D = getDom();
    const brushy = S.tool === "erase" || S.tool === "restore";
    if (D.brushCtl) D.brushCtl.style.display = brushy ? "" : "none";
    if (D.brush) { D.brush.value = S.brush; D.brushVal.textContent = S.brush; }
    if (D.cutTip) {
      const tips = {
        flood: "Toca un color de fondo: desaparece la zona parecida (usa <b>Tolerance</b>).",
        lassoCut: "Rodea <b>lo que quieres tapar</b>: todo lo de dentro del lazo desaparece.",
        lasso: "Rodea <b>lo que quieres conservar</b>: todo lo de fuera del lazo desaparece.",
        erase: "Pinta para <b>borrar</b> a mano.",
        restore: "Pinta para <b>recuperar</b> lo borrado.",
      };
      const t = tips[S.tool];
      D.cutTip.style.display = t ? "" : "none";
      D.cutTip.innerHTML = t || "";
    }
    if (D.canvas) D.canvas.style.cursor = S.tool === "none" ? "default" : "crosshair";
  }

  // ---------- pointer ----------
  function canvasXY(e) {
    const rect = S.canvas.getBoundingClientRect();
    const sx = S.canvas.width / rect.width;
    const sy = S.canvas.height / rect.height;
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
  }
  // map canvas point → element-local (unrotated, unscaled) source-pixel coords
  function canvasToElement(e, mx, my) {
    const dx = mx - e.cx, dy = my - e.cy;
    const cos = Math.cos(-e.rot * Math.PI / 180), sin = Math.sin(-e.rot * Math.PI / 180);
    let lx = dx * cos - dy * sin;
    let ly = dx * sin + dy * cos;
    lx /= e.scale; ly /= e.scale;
    if (e.flipX) lx = -lx;
    return [Math.round(lx + e.w / 2), Math.round(ly + e.h / 2)];
  }
  function hitTest(mx, my) {
    for (let k = S.order.length - 1; k >= 0; k--) {
      const idx = S.order[k];
      const e = S.elements[idx];
      if (!e) continue;
      const [lx, ly] = canvasToElement(e, mx, my);
      if (lx < 0 || ly < 0 || lx >= e.w || ly >= e.h) continue;
      const j = ly * e.w + lx;
      if (e.mask[j] >= 128) return idx;
    }
    return -1;
  }

  // ---------- selection handles (resize / rotate) ----------
  function displayScale() {
    if (!S.canvas) return 1;
    const rect = S.canvas.getBoundingClientRect();
    return rect.width ? S.canvas.width / rect.width : 1;
  }
  // Handle positions in box-local (rotated) coordinates.
  function elementHandlePoints(e) {
    const hw = e.w * e.scale / 2, hh = e.h * e.scale / 2;
    const ds = displayScale();
    const armLen = 30 * ds;
    return {
      corners: [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]],
      rotate: [0, -hh - armLen],
      hw, hh, ds,
    };
  }
  // Map a canvas point into the element's box-local (unrotated) frame.
  function boxLocalPoint(e, mx, my) {
    const dx = mx - e.cx, dy = my - e.cy;
    const cos = Math.cos(-e.rot * Math.PI / 180), sin = Math.sin(-e.rot * Math.PI / 180);
    return [dx * cos - dy * sin, dx * sin + dy * cos];
  }
  // Returns {type:"rotate"} or {type:"scale", corner} if the pointer is over a handle.
  function handleAt(e, mx, my) {
    const { corners, rotate, ds } = elementHandlePoints(e);
    const [lx, ly] = boxLocalPoint(e, mx, my);
    const tol = 13 * ds;
    if (Math.hypot(lx - rotate[0], ly - rotate[1]) <= tol) return { type: "rotate" };
    for (let i = 0; i < corners.length; i++) {
      if (Math.hypot(lx - corners[i][0], ly - corners[i][1]) <= tol) return { type: "scale", corner: i };
    }
    return null;
  }

  function setupCanvasHandlers() {
    const D = getDom();
    D.canvas.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      D.canvas.setPointerCapture(ev.pointerId);
      if (S.elements.length > 0) pushSurrealUndo();
      const [mx, my] = canvasXY(ev);

      if (S.tool === "flood") {
        const e = selected();
        if (!e) return;
        const [lx, ly] = canvasToElement(e, mx, my);
        floodFillElement(e, lx, ly, e.tolerance);
        invalidate(e);
        render();
        renderLayerList();
        return;
      }
      if (S.tool === "erase" || S.tool === "restore") {
        const e = selected();
        if (!e) return;
        const [lx, ly] = canvasToElement(e, mx, my);
        brushElement(e, lx, ly, localBrushRadius(e), S.tool === "restore");
        S.brushing = true;
        S.lastLocal = [lx, ly];
        invalidate(e);
        render();
        return;
      }
      if (S.tool === "lasso" || S.tool === "lassoCut") {
        if (!selected()) return;
        S.lassoActive = true;
        S.lassoPoints = [mx, my];
        render();
        return;
      }

      // resize / rotate handles on the currently-selected element
      if (S.tool === "none" && S.selectedIdx != null) {
        const sel = S.elements[S.selectedIdx];
        const h = sel ? handleAt(sel, mx, my) : null;
        if (h) {
          if (h.type === "rotate") {
            const ang = Math.atan2(my - sel.cy, mx - sel.cx) * 180 / Math.PI;
            S.drag = { mode: "rotate", idx: S.selectedIdx, startAng: ang, startRot: sel.rot };
          } else {
            const halfDiag = Math.hypot(sel.w / 2, sel.h / 2) || 1;
            S.drag = { mode: "scale", idx: S.selectedIdx, halfDiag };
          }
          return;
        }
      }

      const idx = hitTest(mx, my);
      if (idx >= 0) {
        S.selectedIdx = idx;
        // NOTE: selecting does NOT change stacking order — order is controlled
        // manually via the Layers panel (drag) or the FWD/BACK buttons.
        const e = S.elements[idx];
        S.drag = { mode: "move", idx, ox: mx - e.cx, oy: my - e.cy };
      } else {
        S.selectedIdx = null;
        S.drag = null;
      }
      syncPanel();
      render();
      renderLayerList();
    });
    D.canvas.addEventListener("pointermove", (ev) => {
      if (S.brushing) {
        const e = selected();
        if (!e) return;
        const [mx, my] = canvasXY(ev);
        const [lx, ly] = canvasToElement(e, mx, my);
        const r = localBrushRadius(e);
        if (S.lastLocal) brushLineElement(e, S.lastLocal[0], S.lastLocal[1], lx, ly, r, S.tool === "restore");
        else brushElement(e, lx, ly, r, S.tool === "restore");
        S.lastLocal = [lx, ly];
        invalidate(e);
        render();
        return;
      }
      if (S.lassoActive) {
        const [mx, my] = canvasXY(ev);
        const p = S.lassoPoints;
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(mx - lx, my - ly) > 3) { p.push(mx, my); render(); }
        return;
      }
      if (!S.drag) {
        // hover cursor feedback over selection handles
        if (S.tool === "none" && S.selectedIdx != null) {
          const [hx, hy] = canvasXY(ev);
          const sel = S.elements[S.selectedIdx];
          const h = sel ? handleAt(sel, hx, hy) : null;
          D.canvas.style.cursor = h ? (h.type === "rotate" ? "grab" : "nwse-resize") : "default";
        }
        return;
      }
      const [mx, my] = canvasXY(ev);
      const e = S.elements[S.drag.idx];
      if (!e) return;
      if (S.drag.mode === "scale") {
        const dist = Math.hypot(mx - e.cx, my - e.cy);
        e.scale = clamp(dist / S.drag.halfDiag, 0.05, 6);
        syncPanel(); render(); renderLayerList();
      } else if (S.drag.mode === "rotate") {
        const ang = Math.atan2(my - e.cy, mx - e.cx) * 180 / Math.PI;
        let r = S.drag.startRot + (ang - S.drag.startAng);
        while (r > 180) r -= 360;
        while (r < -180) r += 360;
        e.rot = clamp(r, -180, 180);
        syncPanel(); render();
      } else {
        e.cx = mx - S.drag.ox;
        e.cy = my - S.drag.oy;
        render();
      }
    });
    const endDrag = () => {
      if (S.brushing) {
        S.brushing = false;
        S.lastLocal = null;
        renderLayerList();
      }
      if (S.lassoActive) {
        S.lassoActive = false;
        if (S.lassoPoints.length >= 6) {
          const e = selected();
          if (e) {
            const localPoly = [];
            for (let i = 0; i < S.lassoPoints.length; i += 2) {
              const [lx, ly] = canvasToElement(e, S.lassoPoints[i], S.lassoPoints[i + 1]);
              localPoly.push(lx, ly);
            }
            if (S.tool === "lassoCut") {
              // Lazo quitar: whatever you loop around DISAPPEARS.
              fillPolygonToElementMask(e, localPoly, 0);
            } else {
              // Lazo dejar: zero out everything OUTSIDE the polygon, keep inside
              const oldMask = new Uint8Array(e.mask);
              e.mask.fill(0);
              fillPolygonToElementMask(e, localPoly, 255);
              for (let i = 0; i < e.mask.length; i++) {
                if (oldMask[i] < 128) e.mask[i] = 0;
              }
            }
            invalidate(e);
          }
        }
        S.lassoPoints = [];
        render(); renderLayerList();
      }
      S.drag = null;
      // Al soltar se rehace el collage con estilo: durante el arrastre se pinta
      // crudo para que vaya suelto, y este es el momento de enseñar el
      // resultado de verdad.
      ensuciarEstilo();
    };
    D.canvas.addEventListener("pointerup", endDrag);
    D.canvas.addEventListener("pointercancel", endDrag);

    // wheel: scale, shift+wheel: rotate
    D.canvas.addEventListener("wheel", (ev) => {
      const e = selected();
      if (!e) return;
      ev.preventDefault();
      if (Date.now() - _wheelUndoT > 400) { pushSurrealUndo(); _wheelUndoT = Date.now(); }
      if (ev.shiftKey) {
        e.rot = clamp(e.rot + (ev.deltaY > 0 ? 2 : -2), -180, 180);
      } else {
        const factor = ev.deltaY > 0 ? 0.96 : 1.04;
        e.scale = clamp(e.scale * factor, 0.05, 6);
      }
      syncPanel();
      render();
      renderLayerList();
    }, { passive: false });
  }

  // ---------- finish / send to main ----------
  function bakeMergedCanvas(filter) {
    const out = document.createElement("canvas");
    out.width = S.W; out.height = S.H;
    const ctx = out.getContext("2d");
    if (S.bg === "paper" && filter !== "resources") {
      if (window.KAOS_GALLERY && KAOS_GALLERY.paintPaperSeeded) KAOS_GALLERY.paintPaperSeeded(ctx, S.W, S.H, "#d9d4c8", 7);
      else { ctx.fillStyle = "#d9d4c8"; ctx.fillRect(0, 0, S.W, S.H); }
    }
    for (const idx of S.order) {
      const e = S.elements[idx];
      if (!e) continue;
      if (filter === "no-resources" && e.isResource) continue;
      if (filter === "resources" && !e.isResource) continue;
      const rc = getRenderCanvas(e);
      ctx.save();
      ctx.globalAlpha = e.opacity;
      ctx.globalCompositeOperation = e.blend || "source-over";
      ctx.translate(e.cx, e.cy);
      ctx.rotate(e.rot * Math.PI / 180);
      const sx = e.flipX ? -1 : 1;
      ctx.scale(e.scale * sx, e.scale);
      ctx.drawImage(rc, -e.w / 2, -e.h / 2);
      ctx.restore();
    }
    return out;
  }

  function sendToMain(opts) {
    const merged = bakeMergedCanvas();
    if (!window.KAOS_APP || !KAOS_APP.setSourceCanvas) { console.warn("KAOS_APP not ready"); return; }
    KAOS_APP.setSourceCanvas(merged, Object.assign({ elementMasks: elementMasks() }, opts || {}));
    // Show re-compose button for future re-entry
    const rcBtn = document.getElementById("surrealRecomposeBtn");
    if (rcBtn) rcBtn.style.display = "";
    close();
  }

  // ---------- wire-up ----------
  function init() {
    const D = getDom();
    if (!D.modal) return;

    D.openBtn.addEventListener("click", open);
    D.closeBtn.addEventListener("click", close);
    D.addBtn.addEventListener("click", () => D.addInput.click());
    D.addInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (!files.length) return;
      // Por la puerta de app.js, no derecho a addFiles: si ya habia una foto
      // suelta puesta en el estilo, alli se mete en el collage ANTES que la
      // nueva. Yendo derecho, esa primera se quedaba fuera y parecia que la
      // nueva la habia sustituido.
      if (root.KAOS_APP && root.KAOS_APP.recibirFotos) await root.KAOS_APP.recibirFotos(files);
      else await addFiles(files);
    });

    // ===== RESOURCES PANEL =====
    const resourceTabs = $$("#resourceTabs .tog");
    const resourceGrid = $("#resourceGrid");
    const resourceUploadBtn = $("#resourceUploadBtn");
    const resourceUploadInput = $("#resourceUploadInput");

    // The library is 100% user-owned now — no shipped placeholder art. Every
    // piece lives in IndexedDB (KAOS_STORE assets), so it survives reloads and
    // rides along in the backup file that syncs to the iPad.
    let activeCat = "eyes";

    // La galeria no es una categoria mas de la libreria: son sus disenos ya
    // terminados, que viven en KAOS_GALLERY y no en KAOS_STORE. Se ensenan en
    // la misma rejilla porque la forma de usarlos es la misma -- clic y cae en
    // el lienzo -- pero aqui NO hay boton de borrar: desde el collage no se
    // toca la galeria.
    async function renderGaleriaGrid() {
      const items = window.KAOS_GALLERY ? KAOS_GALLERY.load() : [];
      if (!items.length) {
        resourceGrid.innerHTML =
          '<div class="res-empty">La galeria esta vacia. Los disenos que guardes ' +
          'desde el lienzo o desde LIBRETA salen aqui.</div>';
        return;
      }
      for (const it of items) {
        const div = document.createElement("div");
        div.className = "res-thumb";
        div.title = "Anadir este diseno al collage";
        const img = document.createElement("img");
        // El thumb lleva papel detras, asi se ve sobre el panel oscuro. Lo que
        // se anade al lienzo es layerUrl, que es la tinta sin fondo.
        img.src = it.thumbUrl || it.layerUrl;
        img.alt = it.style || "diseno";
        img.loading = "lazy";
        div.appendChild(img);
        const label = document.createElement("div");
        label.className = "res-name";
        label.textContent = it.style || "diseno";
        div.appendChild(label);
        div.addEventListener("click", () => addResourceToCanvas(it.layerUrl));
        resourceGrid.appendChild(div);
      }
    }

    async function renderResourceGrid() {
      resourceGrid.innerHTML = "";
      const rows = window.KAOS_STORE ? await KAOS_STORE.listAssets(activeCat) : [];
      if (!rows.length) {
        resourceGrid.innerHTML =
          '<div class="res-empty">Vacío — pulsa <b>+ AÑADIR</b> para subir tus propios ' +
          activeCat + '.<br>Se guardan en este dispositivo y viajan en el backup.</div>';
        return;
      }
      for (const row of rows) {
        const div = document.createElement("div");
        div.className = "res-thumb";
        div.title = row.name + " — click para añadir al lienzo";
        const img = document.createElement("img");
        img.src = KAOS_STORE.assetURL(row);
        img.alt = row.name;
        img.loading = "lazy";
        div.appendChild(img);
        const label = document.createElement("div");
        label.className = "res-name";
        label.textContent = row.name;
        div.appendChild(label);
        const del = document.createElement("button");
        del.className = "res-del";
        del.type = "button";
        del.title = "Borrar de la librería";
        del.textContent = "✕";
        del.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`¿Borrar "${row.name}" de la librería?`)) return;
          await KAOS_STORE.deleteAsset(row.id);
          renderResourceGrid();
        });
        div.appendChild(del);
        div.addEventListener("click", () => addResourceToCanvas(img.src));
        resourceGrid.appendChild(div);
      }
    }
    // Re-render when a backup import brings in new pieces.
    document.addEventListener("kaos-assets-changed", renderResourceGrid);

    async function addResourceToCanvas(url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = url; });
      if (!img.naturalWidth) return;
      const maxDim = 600;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (url.endsWith(".svg") && (w < 50 || h < 50)) { w = maxDim; h = maxDim; }
      if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      const file = new File([blob], "resource.png", { type: "image/png" });
      await addFiles([file], { isResource: true });
    }

    resourceTabs.forEach(btn => btn.addEventListener("click", () => {
      resourceTabs.forEach(b => b.setAttribute("aria-selected", b === btn));
      activeCat = btn.dataset.cat;
      renderResourceGrid();
    }));

    resourceUploadBtn.addEventListener("click", () => resourceUploadInput.click());
    resourceUploadInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      resourceUploadInput.value = "";
      if (!files.length) return;
      if (!window.KAOS_STORE) {
        if (window.KAOS_TOAST) KAOS_TOAST("No se pudo abrir el almacén local");
        return;
      }
      let ok = 0;
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
        try { await KAOS_STORE.addAsset(activeCat, name, file); ok++; }
        catch (err) { console.warn("no se pudo guardar el asset", file.name, err); }
      }
      await renderResourceGrid();
      if (window.KAOS_TOAST) {
        KAOS_TOAST(ok === files.length
          ? `${ok} guardado${ok === 1 ? "" : "s"} en ${activeCat}`
          : `${ok}/${files.length} guardados — el resto falló`);
      }
    });

    renderResourceGrid();

    D.clearBtn.addEventListener("click", () => {
      if (!S.elements.length || !confirm("¿Quitar todas las fotos del collage?")) return;
      pushSurrealUndo();
      vaciar();
    });

    // canvas size
    $$("#surrealSize .tog").forEach(b => b.addEventListener("click", () => {
      $$("#surrealSize .tog").forEach(x => x.setAttribute("aria-selected", x === b));
      S.W = parseInt(b.dataset.w, 10); S.H = parseInt(b.dataset.h, 10);
      sizeCanvas(); render();
    }));
    // bg
    $$("#surrealBg .tog").forEach(b => b.addEventListener("click", () => {
      $$("#surrealBg .tog").forEach(x => x.setAttribute("aria-selected", x === b));
      S.bg = b.dataset.bg;
      render();
      sincronizarPapel();
    }));
    sincronizarPapel();

    // sliders
    D.scale.addEventListener("input", e => { const v=selected(); if(v){ v.scale = parseFloat(e.target.value); D.scaleVal.textContent = v.scale.toFixed(2); render(); renderLayerList(); }});
    D.rot.addEventListener("input", e => { const v=selected(); if(v){ v.rot = parseFloat(e.target.value); D.rotVal.textContent = Math.round(v.rot)+"°"; render(); }});
    D.op.addEventListener("input", e => { const v=selected(); if(v){ v.opacity = parseFloat(e.target.value); D.opVal.textContent = v.opacity.toFixed(2); render(); }});
    D.feather.addEventListener("input", e => { const v=selected(); if(v){ v.feather = parseInt(e.target.value,10); D.featherVal.textContent = v.feather; invalidate(v); render(); }});
    D.tol.addEventListener("input", e => { const v=selected(); if(v){ v.tolerance = parseInt(e.target.value,10); D.tolVal.textContent = v.tolerance; }});
    // Push surreal undo on slider interaction start
    [D.scale, D.rot, D.op, D.feather, D.tol].forEach(sl => {
      sl.addEventListener("pointerdown", () => { if (selected()) pushSurrealUndo(); });
    });

    // teñir: sólo afecta al elemento elegido, no a todo el collage
    $$("#surrealTinte .tog").forEach(b => b.addEventListener("click", () => {
      const e = selected(); if (!e) return;
      pushSurrealUndo();
      $$("#surrealTinte .tog").forEach(x => x.setAttribute("aria-selected", x === b));
      e.tinte = b.dataset.tinte || null;
      invalidate(e); render(); renderLayerList(); scheduleLivePreview();
    }));

    // blend
    $$("#surrealBlend .tog").forEach(b => b.addEventListener("click", () => {
      const e = selected(); if (!e) return;
      pushSurrealUndo();
      $$("#surrealBlend .tog").forEach(x => x.setAttribute("aria-selected", x === b));
      e.blend = b.dataset.blend; render();
    }));
    // tool
    $$("#surrealCutTool .tog").forEach(b => b.addEventListener("click", () => {
      $$("#surrealCutTool .tog").forEach(x => x.setAttribute("aria-selected", x === b));
      S.tool = b.dataset.tool;
      syncCutTool();
    }));
    if (D.brush) {
      D.brush.addEventListener("input", (ev) => {
        S.brush = parseInt(ev.target.value, 10);
        D.brushVal.textContent = S.brush;
      });
    }
    D.autoCutBtn.addEventListener("click", () => {
      const e = selected(); if (!e) return;
      pushSurrealUndo();
      smartAutoCut(e); invalidate(e); render(); renderLayerList();
    });
    D.resetCutBtn.addEventListener("click", () => {
      const e = selected(); if (!e) return;
      pushSurrealUndo();
      resetCutout(e); invalidate(e); repintarTodo();
    });
    D.fwdBtn.addEventListener("click", () => {
      if (S.selectedIdx == null) return;
      pushSurrealUndo();
      S.order = S.order.filter(x => x !== S.selectedIdx);
      S.order.push(S.selectedIdx);
      repintarTodo();
    });
    D.bwdBtn.addEventListener("click", () => {
      if (S.selectedIdx == null) return;
      pushSurrealUndo();
      S.order = S.order.filter(x => x !== S.selectedIdx);
      S.order.unshift(S.selectedIdx);
      repintarTodo();
    });
    D.flipBtn.addEventListener("click", () => {
      const e = selected(); if (!e) return;
      pushSurrealUndo();
      e.flipX = !e.flipX; render(); scheduleLivePreview();
    });
    D.removeBtn.addEventListener("click", () => {
      if (S.selectedIdx == null) return;
      pushSurrealUndo();
      const idx = S.selectedIdx;
      S.elements.splice(idx, 1);
      // rebuild order: remove idx, decrement indices > idx
      S.order = S.order.filter(x => x !== idx).map(x => (x > idx ? x - 1 : x));
      S.selectedIdx = null;
      repintarTodo();
    });
    D.dupBtn.addEventListener("click", () => duplicarElemento(S.selectedIdx));
    if (D.livePreviewToggle) {
      D.livePreviewToggle.addEventListener("click", () => {
        livePreviewOn = !livePreviewOn;
        D.livePreviewToggle.setAttribute("aria-selected", livePreviewOn ? "true" : "false");
        D.livePreviewBox.style.display = livePreviewOn ? "" : "none";
        if (livePreviewOn) scheduleLivePreview();
      });
    }

    // finish
    D.finishReal.addEventListener("click", () => sendToMain({ style: "surrealist", autoTune: true }));
    D.finishContr.addEventListener("click", () => sendToMain({ style: "threshold", autoTune: true }));
    D.sendRaw.addEventListener("click", () => sendToMain({ }));

    // ----- AI auto-compose -----
    if (D.aiComposeBtn) {} // (placeholder)
    $("#surrealAiComposeBtn").addEventListener("click", openAutoComposeDialog);
    $("#surrealMatchBtn").addEventListener("click", matchScene);

    setupCanvasHandlers();
    // Surreal undo/redo buttons
    const sUndoBtn = document.getElementById("surrealUndoBtn");
    const sRedoBtn = document.getElementById("surrealRedoBtn");
    if (sUndoBtn) sUndoBtn.addEventListener("click", surrealUndoFn);
    if (sRedoBtn) sRedoBtn.addEventListener("click", surrealRedoFn);
    updateSurrealHistoryUI();
    updateEmpty();
  }

  // boot when DOM ready
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ============================================================
  // ====================== AI AUTO-COMPOSE =====================
  // ============================================================
  function openAutoComposeDialog() {
    if (!window.KAOS_AI || !KAOS_AI.available()) { alert("AI is not available in this environment."); return; }
    if (S.elements.length < 2) { alert("Add at least 2 elements first."); return; }
    if (!window.KAOS_APP || !KAOS_APP.openAi) { alert("App not ready."); return; }

    // Build editable element list. We mutate e.name as user types.
    const elemList = S.elements.map((e) => ({
      id: e.id, thumbUrl: e._thumb, name: e.name,
      onNameChange: (v) => { e.name = v || "layer"; },
    }));

    KAOS_APP.openAi({
      title: "AI Auto-compose",
      promptLabel: "Describe the final image",
      placeholder: "e.g. the cat wearing the spike collar around its neck",
      elements: elemList,
      presets: [
        "the cat wearing the spike collar",
        "head growing inside the sunflower",
        "shark body with human legs",
      ],
      run: async (prompt) => {
        if (!prompt || !prompt.trim()) throw new Error("Type a brief first.");
        // CRITICAL — re-run smart background removal on every element so the
        // composed result is clean (no leftover backgrounds in the merged image).
        for (const e of S.elements) {
          e.mask.fill(255);
          smartAutoCut(e);
          invalidate(e);
        }
        const plan = await KAOS_AI.autoComposeLayout(
          S.elements.map(e => ({ id: e.id, name: e.name, w: e.w, h: e.h })),
          { W: S.W, H: S.H },
          prompt
        );
        applyAutoLayout(plan);
      },
    });
  }

  function applyAutoLayout(plan) {
    pushSurrealUndo();
    // plan: [{ id, cx_pct, cy_pct, scale_pct, rotation_deg, z, flipX, host, blend, feather }]
    const byId = new Map(S.elements.map((e, i) => [e.id, { e, i }]));
    let hostId = null;
    // First pass: reset transforms + blend/feather.
    for (const p of plan) {
      const found = byId.get(p.id);
      if (!found) continue;
      const { e } = found;
      const fitScale = Math.min(S.W * 0.65 / e.w, S.H * 0.65 / e.h);
      e.cx = (p.cx_pct / 100) * S.W;
      e.cy = (p.cy_pct / 100) * S.H;
      e.scale = fitScale * (p.scale_pct / 100);
      e.rot = p.rotation_deg || 0;
      e.flipX = !!p.flipX;
      if (p.blend) e.blend = p.blend;
      if (p.feather != null) e.feather = p.feather;
      invalidate(e); // feather change → rebuild masked bake + thumb
      if (p.host) hostId = e.id;
    }
    // Z-order
    const sorted = plan.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    S.order = sorted.map(p => byId.get(p.id) && byId.get(p.id).i).filter(i => i != null);
    // Append any elements not in plan to top
    S.elements.forEach((_, i) => { if (!S.order.includes(i)) S.order.push(i); });
    // ---- UNIFY: harmonise tone/lighting toward the host so the montage reads as
    // ONE edited subject rather than separate pasted cut-outs. ----
    if (!hostId) hostId = pickHostByArea();
    unifyTones(hostId);
    render();
    renderLayerList();
    syncPanel();
  }

  // Largest effective silhouette = the host whose lighting others should match.
  function pickHostByArea() {
    let bestId = S.elements[0] && S.elements[0].id, bestArea = -1;
    for (const e of S.elements) {
      let area = 0;
      for (let i = 0; i < e.mask.length; i++) if (e.mask[i] > 128) area++;
      area *= e.scale * e.scale;
      if (area > bestArea) { bestArea = area; bestId = e.id; }
    }
    return bestId;
  }

  // Restore an element's pixels from its pristine snapshot so repeated tone ops
  // don't accumulate / degrade.
  function restoreOrigSrc(e) {
    if (!e.origSrc) return;
    const ctx = e.src.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, e.w, e.h);
    ctx.drawImage(e.origSrc, 0, 0);
  }

  // Pull every non-host element's luminance toward the host's mean/contrast.
  function unifyTones(hostId) {
    const host = S.elements.find(e => e.id === hostId);
    if (!host) return;
    for (const e of S.elements) restoreOrigSrc(e); // start from pristine each time
    const hostStats = computeElementLumStats(host);
    for (const e of S.elements) {
      if (e.id === hostId) continue;
      const stats = computeElementLumStats(e);
      const targetMean = hostStats.mean;
      const targetStd = Math.max(20, hostStats.std);
      const stdRatio = clamp(targetStd / Math.max(1, stats.std), 0.65, 1.6);
      applyLumRemap(e, stats.mean, stdRatio, targetMean);
      invalidate(e);
    }
  }

  // ============================================================
  // ====================== MATCH SCENE =========================
  // ============================================================
  // Heuristic tone match: shift each non-host element's luminance to match host.
  // Optionally AI-assisted host pick + perspective skew.
  async function matchScene() {
    if (S.elements.length < 2) { alert("Add at least 2 elements first."); return; }
    pushSurrealUndo();
    let hostId = null;
    let skewMap = new Map();
    if (window.KAOS_AI && KAOS_AI.available()) {
      try {
        const hints = await KAOS_AI.matchSceneHints(
          S.elements.map(e => ({ id: e.id, name: e.name })),
          ""
        );
        hostId = hints.hostId;
        (hints.perElement || []).forEach(p => skewMap.set(p.id, p));
      } catch (e) { console.warn("AI hints failed, falling back", e); }
    }
    if (!hostId) {
      // fallback: largest visible-area element is host.
      let bestId = S.elements[0].id, bestArea = 0;
      for (const e of S.elements) {
        let area = 0;
        for (let i = 0; i < e.mask.length; i++) if (e.mask[i] > 128) area++;
        if (area > bestArea) { bestArea = area; bestId = e.id; }
      }
      hostId = bestId;
    }
    const host = S.elements.find(e => e.id === hostId);
    if (!host) return;
    const hostStats = computeElementLumStats(host);

    for (const e of S.elements) {
      if (e.id === hostId) continue;
      const stats = computeElementLumStats(e);
      const targetMean = hostStats.mean;
      const targetStd  = Math.max(20, hostStats.std);
      const stdRatio   = targetStd / Math.max(1, stats.std);
      // remap each pixel: (v - mean) * ratio + targetMean
      applyLumRemap(e, stats.mean, stdRatio, targetMean);
      // apply AI skew hint if any (small CSS-like skew via canvas transform)
      const hint = skewMap.get(e.id);
      if (hint) {
        e.skewX = clamp(hint.skewX_deg || 0, -25, 25);
        e.skewY = clamp(hint.skewY_deg || 0, -25, 25);
        e.scale *= clamp(hint.scale || 1, 0.7, 1.3);
      }
      invalidate(e);
    }
    render(); renderLayerList();
  }

  function computeElementLumStats(e) {
    const d = e.src.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, e.w, e.h).data;
    let n = 0, sum = 0, sumSq = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (e.mask[j] < 128) continue;
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += g; sumSq += g * g; n++;
    }
    if (!n) return { mean: 128, std: 60 };
    const mean = sum / n;
    const std = Math.sqrt(Math.max(1, sumSq / n - mean * mean));
    return { mean, std };
  }
  function applyLumRemap(e, srcMean, stdRatio, targetMean) {
    const ctx = e.src.getContext("2d", { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, e.w, e.h);
    const d = img.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (e.mask[j] < 128) continue;
      for (let k = 0; k < 3; k++) {
        const v = d[i + k];
        const out = (v - srcMean) * stdRatio + targetMean;
        d[i + k] = clamp(out, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ===== Auto-tune: CALCO (stencil line art) =====
  function autoTuneCalco(srcCanvas) {
    const stats = buildHistogram(srcCanvas, true);
    const { hist, total, mean, std } = stats;
    const hf = highFreqScore(srcCanvas);
    const sep = otsuSeparability(hist, total);

    // Levels: gentle stretch
    let bp = percentile(hist, total, 0.008);
    let wp = percentile(hist, total, 0.992);
    if (wp - bp < 40) { bp = Math.max(0, mean - 60); wp = Math.min(255, mean + 60); }

    const meanNorm = clamp((mean - bp) / Math.max(1, wp - bp), 0.05, 0.95);
    let gamma = Math.log(0.5) / Math.log(meanNorm);
    gamma = clamp(gamma, 0.5, 1.8);

    // Sensitivity: NEVER go below 25 — too low = blank canvas
    // High contrast images still need lines detected
    let sensitivity = 40;
    if (std < 40) sensitivity = 55;       // flat image needs more pickup
    else if (std > 70) sensitivity = 30;  // contrasty → be selective but not blank
    // DON'T subtract for high hf — it causes blank results

    // Detail boost: low to avoid picking up textures
    let detail = 30;
    if (std < 45) detail = 45;
    if (hf > 15) detail = 15;            // textured → minimize texture pickup

    // Blur: MODERATE — too much deforms actual contour lines
    // Keep it low, rely on cleanup to remove texture noise instead
    let blur = 3;
    if (hf > 15) blur = 4;
    if (hf < 6) blur = 2;

    // Gap closing
    let gapClose = 2;

    // Thickness: 1 for clean lines
    let thickness = 1;

    // Clean: moderate — too high removes actual contour lines
    let clean = 50;
    if (hf > 15) clean = 60;
    if (hf > 25) clean = 70;

    return {
      bp: Math.round(bp), wp: Math.round(wp), gamma: +gamma.toFixed(2),
      sensitivity: clamp(Math.round(sensitivity), 25, 90),
      detail: clamp(Math.round(detail), 5, 90),
      blur: clamp(blur, 0, 12),
      gapClose: clamp(gapClose, 0, 5),
      thickness: clamp(thickness, 0, 5),
      clean: clamp(Math.round(clean), 0, 100),
    };
  }

  // Per-element silhouettes at merge resolution. The main app keeps these so the
  // wear filter can be aimed at ONE of the photos the design is stitched from.
  // Retrato del montaje en una linea. app.js lo usa para saber si el collage ha
  // cambiado desde la ultima vez que lo aplano: si no ha cambiado, no vuelve a
  // aplanarlo — y asi no le borra la mascara que ella acabe de pintar.
  function firma() {
    const p = [S.W, S.H, S.bg];
    for (const idx of S.order) {
      const e = S.elements[idx];
      if (!e) continue;
      p.push(e.id, e.cx | 0, e.cy | 0, (e.scale * 1000) | 0, e.rot | 0,
             e.flipX ? 1 : 0, (e.opacity * 100) | 0, e.blend || "", e.tinte || "",
             e.feather, e._maskVer || 0);
    }
    return p.join("|");
  }
  function elementMasks() {
    const out = [];
    for (const idx of S.order) {
      const e = S.elements[idx];
      if (!e) continue;
      if (e.isResource) continue;
      const c = document.createElement("canvas");
      c.width = S.W; c.height = S.H;
      const ctx = c.getContext("2d");
      const rc = getRenderCanvas(e);
      ctx.save();
      ctx.translate(e.cx, e.cy);
      ctx.rotate(e.rot * Math.PI / 180);
      ctx.scale(e.scale * (e.flipX ? -1 : 1), e.scale);
      ctx.drawImage(rc, -e.w / 2, -e.h / 2);
      ctx.restore();
      out.push({ id: e.id, name: e.name || ("capa " + (out.length + 1)), canvas: c, tinte: e.tinte || null });
    }
    // Cada silueta se recorta con lo que tenga POR ENCIMA.
    //
    // Sin esto, el tenido no respetaba el orden de capas: para pintar una pieza
    // de color, app.js borra del montaje todo lo que cae dentro de su silueta y
    // vuelve a pintarlo tenido. Si la silueta iba entera, una pieza tenida
    // borraba lo que tenia delante y salia siempre la primera, subiera o bajara
    // ella la capa. `S.order` va de abajo a arriba, asi que lo de arriba de cada
    // una son las siguientes de la lista.
    for (let i = 0; i < out.length; i++) {
      const ctx = out[i].canvas.getContext("2d");
      ctx.globalCompositeOperation = "destination-out";
      for (let j = i + 1; j < out.length; j++) ctx.drawImage(out[j].canvas, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    return out;
  }

  root.KAOS_SURREAL = {
    open, close,
    // Lo llama app.js cada vez que ella toca un mando de estilo: así la previa
    // del collage responde a la pestaña STYLE en vez de quedarse congelada.
    refrescarPrevia: scheduleLivePreview,
    // Lo pregunta app.js antes de tapar o destapar el lienzo del collage.
    hayElementos: () => S.elements.length > 0,
    // El RESET de app.js lo usa para vaciar también el collage.
    vaciar,
    // Mete un lienzo ya dibujado como elemento más (lo usa mandalas-ui.js).
    addCanvas,
    // El collage entero aplanado en un lienzo. Lo pide app.js al guardar: si
    // el trabajo solo vive aqui, es esto lo que hay que guardar.
    lienzoFusionado: bakeMergedCanvas,
    firma,
    // Lo usa ideas.js para mandar aquí las referencias que ella elige de
    // internet, sin pasar por el diálogo de archivos.
    addFiles,
    autoTuneSurrealist,
    autoTuneThreshold,
    autoTuneCalco,
    elementMasks,
    undo: surrealUndoFn,
    redo: surrealRedoFn,
  };
})(window);
