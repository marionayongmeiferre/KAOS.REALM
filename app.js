// KAOS.REALM — app controller (v3)
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ============== STATE ==============
  const state = {
    style: "surrealist",
    shape: "none",
    shapeXf: { x: 50, y: 50, scale: 1, rot: 0 },
    // The crop shape stays put; the DESIGN moves/scales/rotates inside it.
    designXf: { x: 0, y: 0, scale: 1, rot: 0 },
    shapeOutline: 0,
    // Color plano con el que se rellena lo que la forma recorta y el diseno no
    // tapa: "" (vacio), "negro" o "blanco".
    shapeFill: "",
    elementMasks: [],
    paper: "#d9d4c8",
    img: null,
    lastLayer: null,
    mask: {
      data: null, w: 0, h: 0,
      editMode: false,
      tool: "flood",
      brushSize: 40,
      tolerance: 30,
      feather: 0,
      isDrawing: false,
      lastXY: null,
      anyChanges: false,
      rev: 0,
      lassoPoints: [],
      lassoActive: false,
    },
    history: { undo: [], redo: [], MAX: 25 },
    tweaks: {
      surrealist: { bp: 36, wp: 245, gamma: 0.95, contrast: 1.30, grain: 22 },
      calco: { bp: 0, wp: 255, gamma: 1.0, sensitivity: 35, detail: 40, blur: 3, gapClose: 2, thickness: 1, clean: 65 },
      threshold: {
        bp: 0, wp: 255, gamma: 1.0, localBoost: 0.5, smooth: 1,
        mode: "hard",
        threshold: 128, stippleOpacity: 55, windowSize: 25, bias: 8, edgeSens: 40,
        outlineWidth: 0, despeckle: 35,
      },
      compose: { paperGrain: 14, topGrain: 7, shadow: 0.35 },
    },
  };
  const DEFAULT_TWEAKS = JSON.parse(JSON.stringify(state.tweaks));

  // Bumped whenever the source photo itself is replaced (upload, prep, AI) so the
  // render cache can never serve a stale layer.
  let srcToken = 0;

  // ============== DOM ==============
  const fileInput = $("#fileInput");
  const uploadBtn = $("#uploadBtn");
  const downloadBtn = $("#downloadBtn");
  const duplicateResultBtn = $("#duplicateResultBtn");
  const transparentBgChk = $("#transparentBgChk");
  const sinPapelChk = $("#sinPapelChk");
  const resetBtn = $("#resetBtn");
  const reprocessBtn = $("#reprocessBtn");
  const dropzone = $("#dropzone");
  const paperEl = $("#paper");
  const outCanvas = $("#outCanvas");
  const empty = $("#empty");
  const dimsLabel = $("#dimsLabel");
  const analysis = $("#analysis");
  const analysisToggle = $("#analysisToggle");
  const maskEditBtn = $("#maskEditBtn");
  const maskTools = $("#maskTools");
  const autoMaskBtn = $("#autoMaskBtn");
  const resetMaskBtn = $("#resetMaskBtn");
  const maskCoverage = $("#maskCoverage");
  const stageEl = $(".stage");
  const undoBtn = $("#undoBtn");
  const redoBtn = $("#redoBtn");
  const galleryBtn = $("#galleryBtn");
  const galleryCount = $("#galleryCount");
  const styleUndoBtn = $("#styleUndoBtn");
  const styleRedoBtn = $("#styleRedoBtn");

  // ============== TWEAK HANDLERS ==============
  $$('input[type="range"][data-tweak]').forEach(r => {
    r.addEventListener("input", () => {
      const k = r.dataset.tweak;
      const sec = r.dataset.section;
      const v = parseFloat(r.value);
      if (sec === "mask") {
        if (k === "tolerance") state.mask.tolerance = v;
        if (k === "brushSize") state.mask.brushSize = v;
        if (k === "feather") state.mask.feather = v;
      } else if (sec) {
        state.tweaks[sec][k] = v;
      }
      const label = r.closest(".control").querySelector('[data-val="' + sec + "." + k + '"]');
      if (label) label.textContent = formatVal(k, v);
      scheduleDraft();
    });
  });
  function formatVal(k, v) {
    if (["gamma", "contrast", "boost", "density", "dotSize", "shadow", "localBoost"].includes(k)) return v.toFixed(2);
    if (k === "outlineWidth") return (Math.round(v * 2) / 2).toString(); // honours 1.5 half-steps
    return Math.round(v).toString();
  }
  $$('.tog[data-tweak]').forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.tweak;
      const sec = btn.dataset.section;
      if (sec && sec !== "mask") pushStyleUndo();
      $$(`.tog[data-tweak="${k}"][data-section="${sec || ''}"]`).forEach(b => b.setAttribute("aria-selected", b === btn));
      const raw = btn.dataset.val;
      const num = parseFloat(raw);
      const val = isNaN(num) ? raw : num;
      if (sec === "mask") {
        if (k === "tool") { state.mask.tool = val; updateToolUI(); }
      } else if (sec) {
        state.tweaks[sec][k] = val;
      }
      if (sec === "threshold" && k === "mode") updateThreshModeUI();
      schedule();
    });
  });
  function updateThreshModeUI() {
    const mode = state.tweaks.threshold.mode;
    $$('[data-thresh-show]').forEach(el => {
      const shows = el.dataset.threshShow.split(",");
      el.style.display = shows.includes(mode) ? "" : "none";
    });
  }
  updateThreshModeUI();
  function updateToolUI() {
    const t = state.mask.tool;
    $$('[data-tool-show]').forEach(el => {
      const shows = el.dataset.toolShow.split(",");
      el.style.display = shows.includes(t) ? "" : "none";
    });
  }
  updateToolUI();

  // ============== STYLE SWITCHER ==============
  $$("#styles .style-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const s = btn.dataset.style;
      if (s !== state.style) pushStyleUndo();
      state.style = s;
      $$("#styles .style-btn").forEach(b => b.setAttribute("aria-selected", b === btn));
      $$(".ctl-group").forEach(g => g.style.display = "none");
      const grp = $("#ctl-" + s);
      if (grp) grp.style.display = "";
      if (s === "calco" && state.img) { autoTuneCurrent(); } else { schedule(); }
    });
  });

  // ============== PAPER ==============
  // ---- Paper picker (built-in + saved customs) ----
  const PAPER_KEY = "kaos.realm.papers.v1";
  function loadSavedPapers() {
    try { return JSON.parse(localStorage.getItem(PAPER_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCustomPaper(hex) {
    hex = (hex || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    const arr = loadSavedPapers();
    if (arr.includes(hex)) return;
    arr.unshift(hex);
    while (arr.length > 8) arr.pop();
    localStorage.setItem(PAPER_KEY, JSON.stringify(arr));
    renderPaperPicker();
  }
  function deleteCustomPaper(hex) {
    const arr = loadSavedPapers().filter(x => x !== hex);
    localStorage.setItem(PAPER_KEY, JSON.stringify(arr));
    renderPaperPicker();
  }
  function setActivePaper(hex, fromVariant) {
    state.paper = hex;
    $$('#papers .tog, #papers .swatch').forEach(b => b.setAttribute("aria-selected", b.dataset.paper === hex));
    if (!fromVariant) {
      // user-initiated
    }
    schedule();
  }
  function renderPaperPicker() {
    const papers = $("#papers");
    if (!papers) return;
    // Keep first 3 preset buttons; rebuild custom swatches afterwards
    papers.querySelectorAll(".swatch").forEach(n => n.remove());
    for (const hex of loadSavedPapers()) {
      const b = document.createElement("button");
      b.className = "tog swatch";
      b.dataset.paper = hex;
      b.title = hex + " — right-click to remove";
      b.style.background = hex;
      b.setAttribute("aria-selected", state.paper === hex ? "true" : "false");
      b.addEventListener("click", () => setActivePaper(hex));
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); if (confirm("Remove saved paper " + hex + "?")) deleteCustomPaper(hex); });
      papers.appendChild(b);
    }
    // Sync selected state of presets
    $$("#papers .tog").forEach(b => b.setAttribute("aria-selected", b.dataset.paper === state.paper ? "true" : "false"));
  }
  $$('#papers .tog').forEach(btn => {
    btn.addEventListener("click", () => { pushStyleUndo(); setActivePaper(btn.dataset.paper); });
  });
  // Custom paper input
  const paperPicker = $("#paperPicker");
  const paperPickerSave = $("#paperPickerSave");
  if (paperPicker) {
    paperPicker.addEventListener("input", (e) => setActivePaper(e.target.value));
    paperPicker.value = state.paper;
  }
  if (paperPickerSave) {
    paperPickerSave.addEventListener("click", () => {
      saveCustomPaper(paperPicker.value);
      flashSave();
    });
  }
  renderPaperPicker();

  // ---- Toast (tiny status banner over the stage) ----
  let toastEl = null;
  function showToast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "kaos-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove("show"), ms || 4200);
  }

  // ============== PREP PHOTO — precise 3-point levels ==============
  // You sample the real darkest tone, a real mid grey and the real white ON the
  // photo; those three become black point / gamma / white point exactly. No blind
  // intensity slider.
  const prepSection = $("#prepSection");
  const prepBtn = $("#prepBtn");
  const prepClarity = $("#prepClarity");
  const prepClarityVal = $("#prepClarityVal");
  let originalImg = null;          // untouched source before any prep
  const prepPts = { black: null, mid: null, white: null };
  let prepPicking = null;          // "black" | "mid" | "white" | null
  const PICK_ORDER = ["black", "mid", "white"];

  function syncPrepPicks() {
    $$("#prepPickRow .pick-btn").forEach(b => {
      const k = b.dataset.pick, v = prepPts[k];
      b.setAttribute("aria-selected", prepPicking === k ? "true" : "false");
      b.classList.toggle("set", v != null);
      b.querySelector(".pk-val").textContent = v == null ? "—" : Math.round(v);
      const g = v == null ? null : Math.round(v);
      b.querySelector(".pk-sw").style.background = g == null ? "transparent" : "rgb(" + g + "," + g + "," + g + ")";
    });
    prepBtn.disabled = !(prepPts.black != null && prepPts.white != null);
    // 0 pulsaciones en 13 dias: estaba siempre a la vista, tambien cuando no
    // habia nada que deshacer, asi que se leia como decorado. Ahora solo sale
    // cuando de verdad hay un original al que volver.
    const volver = $("#prepResetBtn");
    if (volver) volver.hidden = !originalImg;
    stageEl.classList.toggle("picking", !!prepPicking);
    schedule();
  }
  $$("#prepPickRow .pick-btn").forEach(b => b.addEventListener("click", () => {
    prepPicking = prepPicking === b.dataset.pick ? null : b.dataset.pick;
    if (prepPicking) showToast("Toca en la foto el punto " + b.querySelector(".pk-lbl").textContent, 2600);
    syncPrepPicks();
  }));
  prepClarity.addEventListener("input", () => { prepClarityVal.textContent = prepClarity.value; });
  // While picking, the canvas shows the RAW photo — you can't judge a mid grey on a
  // pure black-and-white render.
  function renderSourcePreview() {
    const src = originalImg || state.img;
    if (!src) return;
    outCanvas.width = src.width; outCanvas.height = src.height;
    outCanvas.getContext("2d").drawImage(src, 0, 0);
  }
  function histoPoints(src) {
    const c = document.createElement("canvas");
    const sc = Math.min(1, 420 / Math.max(src.width, src.height));
    c.width = Math.max(1, Math.round(src.width * sc));
    c.height = Math.max(1, Math.round(src.height * sc));
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.drawImage(src, 0, 0, c.width, c.height);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    const vals = [];
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      vals.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    vals.sort((a, b) => a - b);
    const at = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))] : 0;
    const bp = Math.round(at(0.01)), wp = Math.round(at(0.99));
    // the mid sample is the average of the tones strictly BETWEEN the two ends —
    // a plain median just returns the white backdrop on a cut-out photo
    let sum = 0, n = 0;
    for (const v of vals) { if (v > bp + 4 && v < wp - 4) { sum += v; n++; } }
    const mid = n ? Math.round(sum / n) : Math.round((bp + wp) / 2);
    return { bp, mid, wp };
  }
  $("#prepAutoBtn").addEventListener("click", () => {
    const src = originalImg || state.img;
    if (!src) return;
    const p = histoPoints(src);
    prepPts.black = p.bp; prepPts.mid = p.mid; prepPts.white = p.wp;
    prepPicking = null;
    syncPrepPicks();
    showToast("3 puntos rellenados por histograma — retócalos o aplica", 3200);
  });
  function swapSource(next) {
    state.img = next;
    srcToken++;
    const keepMask = state.mask.data && state.mask.w === next.width && state.mask.h === next.height ? state.mask.data : null;
    const keepAny = state.mask.anyChanges;
    initMask(next.width, next.height);
    if (keepMask) { state.mask.data = keepMask; state.mask.anyChanges = keepAny; updateCoverage(); }
    clearHistory();
    schedule();
  }
  function aplicarPrep(avisar) {
    const src = originalImg || state.img;
    if (!src || prepPts.black == null || prepPts.white == null) return;
    if (!originalImg) originalImg = state.img;
    prepPicking = null;
    // siempre desde el original: mover el deslizador no acumula contraste
    swapSource(KAOS.prepPhotoLevels(src, prepPts, parseInt(prepClarity.value, 10)));
    prepBtn.classList.add("flash");
    setTimeout(() => prepBtn.classList.remove("flash"), 600);
    syncPrepPicks();
    if (avisar) showToast("Rango reequilibrado · negro " + Math.round(prepPts.black) + " · blanco " + Math.round(prepPts.white), 3200);
  }
  prepBtn.addEventListener("click", () => aplicarPrep(true));
  // Una vez aplicado, Clarity se ve sola al soltar el deslizador. Antes habia
  // que volver a APLICAR para ver el efecto: 44 idas y vueltas en el registro.
  // La primera vez sigue siendo ella quien pulsa, para no tocar la foto sin querer.
  prepClarity.addEventListener("change", () => { if (originalImg) aplicarPrep(false); });
  $("#prepResetBtn").addEventListener("click", () => {
    if (!originalImg) { showToast("Ya estás en el original"); return; }
    swapSource(originalImg);
    originalImg = null;
    prepPicking = null;
    syncPrepPicks();
    showToast("Vuelta al original");
  });
  // capture phase: the eyedropper wins over mask / text / shape dragging
  document.addEventListener("pointerdown", (e) => {
    if (!prepPicking || !state.img || e.target !== outCanvas) return;
    e.preventDefault(); e.stopPropagation();
    const src = originalImg || state.img;
    const rect = outCanvas.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * src.width;
    const sy = ((e.clientY - rect.top) / rect.height) * src.height;
    prepPts[prepPicking] = KAOS.sampleLum(src, sx, sy, Math.max(2, Math.round(src.width / 220)));
    const i = PICK_ORDER.indexOf(prepPicking);
    prepPicking = (i >= 0 && i < 2 && prepPts[PICK_ORDER[i + 1]] == null) ? PICK_ORDER[i + 1] : null;
    syncPrepPicks();
  }, true);
  syncPrepPicks();

  // ============== UPLOAD ==============
  const emptyEl = $("#empty");
  if (emptyEl) {
    emptyEl.addEventListener("click", () => fileInput.click());
    // El cartel de «drop a soul» ya no se usa: lo sustituye el lienzo del
    // collage, que es donde ella suelta las fotos. El nodo se queda por si algo
    // más lo mira, pero apagado.
    emptyEl.style.display = "none";
  }
  // Nada más abrir, sin ninguna foto cargada, lo que se ve es el collage.
  if (window.KAOS_SURREAL) KAOS_SURREAL.open();
  // Removed from the UI: the empty canvas (line above), drag-drop and paste all
  // do the same thing. Guarded so it can come back without a code change.
  uploadBtn?.addEventListener("click", () => fileInput.click());
  // Las fotos se SUMAN, nunca se sustituyen. Antes, una foto suelta iba derecha
  // al estilo y pisaba a la anterior: metías una, metías otra, y la primera
  // desaparecía. Ahora sólo va derecha al estilo la primera de todas; en cuanto
  // ya hay algo en el lienzo, la nueva entra en el collage y las dos se pueden
  // mover y editar a la vez desde STYLE.
  async function recibirFotos(lista) {
    const fs = Array.prototype.slice.call(lista || []);
    if (!fs.length) return;
    if (!window.KAOS_SURREAL) { loadFile(fs[0]); return; }
    const enCollage = KAOS_SURREAL.hayElementos();
    const yaHay = enCollage || !!state.img;
    if (fs.length === 1 && !yaHay) { loadFile(fs[0]); return; }
    KAOS_SURREAL.open();
    // La foto que ya estaba suelta en el lienzo se mete en el collage antes que
    // las nuevas: si no, al encender el collage se quedaría debajo y perdida.
    if (!enCollage && state.img) await KAOS_SURREAL.addCanvas(state.img, "foto");
    await KAOS_SURREAL.addFiles(fs);
  }
  fileInput.addEventListener("change", (e) => recibirFotos(e.target.files));
  let dragCount = 0;
  window.addEventListener("dragenter", (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.types.includes("Files")) { dragCount++; dropzone.classList.add("active"); }
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => {
    dragCount--; if (dragCount <= 0) { dragCount = 0; dropzone.classList.remove("active"); }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault(); dragCount = 0; dropzone.classList.remove("active");
    recibirFotos(e.dataTransfer.files);
  });
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) if (it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) recibirFotos([f]); break; }
  });
  function loadFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1400;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
      adoptSourceCanvas(c, { autoRemoveBg: true });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // Adopt an externally produced canvas as the source. Used by Surreal Composer.
  function adoptSourceCanvas(canvas, opts) {
    const MAX = 1400;
    let w = canvas.width, h = canvas.height;
    let src = canvas;
    if (w > MAX || h > MAX) {
      const s = MAX / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
      const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
      c2.getContext("2d", { willReadFrequently: true }).drawImage(canvas, 0, 0, w, h);
      src = c2;
    }
    state.img = src;
    srcToken++;
    state.elementMasks = (opts && opts.elementMasks) || [];
    renderDistressTargets();
    originalImg = null; // reset prep history for new image
    prepPts.black = prepPts.mid = prepPts.white = null;
    prepPicking = null;
    syncPrepPicks();
    prepSection.style.display = "";
    initMask(w, h);
    if (opts && opts.autoRemoveBg) {
      smartAutoMask();
      state.mask.anyChanges = true;
      updateCoverage();
    }
    clearHistory();
    dimsLabel.textContent = w + " × " + h;
    empty.style.display = "none";
    paperEl.style.display = "";
    // Ya hay foto en el lienzo: el collage se quita de en medio para dejarla
    // ver. Si ella tiene piezas montadas, se queda — mandan las piezas.
    if (window.KAOS_SURREAL && !KAOS_SURREAL.hayElementos()) KAOS_SURREAL.close();
    downloadBtn.disabled = false;
    if (saveProjectBtn) saveProjectBtn.disabled = false;
    currentProjectId = null; currentProjectName = "";
    if (duplicateResultBtn) duplicateResultBtn.disabled = false;

    if (opts && opts.style) {
      switchStyle(opts.style);
    }
    if (opts && opts.autoTune) {
      // Wait a tick so initMask & switchStyle settle, then auto-tune.
      requestAnimationFrame(() => { autoTuneCurrent(); });
    } else {
      schedule();
    }

    // Show re-compose button if we came from surreal composer
    if (opts && (opts.style || opts.autoTune)) {
      hasFinishedSurreal = true;
      if (surrealRecomposeBtn) surrealRecomposeBtn.style.display = "";
    }
  }

  function switchStyle(s) {
    const btn = $('#styles .style-btn[data-style="' + s + '"]');
    if (btn) btn.click();
  }

  function autoTuneCurrent() {
    if (!state.img || !window.KAOS_SURREAL) { schedule(); return; }
    if (state.style === "surrealist") {
      const t = KAOS_SURREAL.autoTuneSurrealist(state.img);
      Object.assign(state.tweaks.surrealist, t);
      syncSliders("surrealist");
      flashAutoTune();
    } else if (state.style === "threshold") {
      const t = KAOS_SURREAL.autoTuneThreshold(state.img);
      Object.assign(state.tweaks.threshold, t);
      syncSliders("threshold");
      // mode toggle button
      $$('.tog[data-section="threshold"][data-tweak="mode"]').forEach(b => {
        b.setAttribute("aria-selected", b.dataset.val === t.mode);
      });
      updateThreshModeUI();
      flashAutoTune();
    } else if (state.style === "calco") {
      const t = KAOS_SURREAL.autoTuneCalco(state.img);
      Object.assign(state.tweaks.calco, t);
      syncSliders("calco");
      flashAutoTune();
    }
    schedule();
  }

  function syncSliders(sec) {
    const obj = state.tweaks[sec];
    Object.keys(obj).forEach(k => {
      const r = document.querySelector('input[type="range"][data-section="' + sec + '"][data-tweak="' + k + '"]');
      if (r) {
        r.value = obj[k];
        const label = r.closest(".control").querySelector('[data-val="' + sec + "." + k + '"]');
        if (label) label.textContent = formatVal(k, obj[k]);
      }
    });
  }

  function flashAutoTune() {
    $$('.btn.auto-tune').forEach(b => {
      b.classList.remove("flash");
      void b.offsetWidth;
      b.classList.add("flash");
    });
  }

  // ============== AUTO-TUNE BUTTONS ==============
  $$('.btn.auto-tune').forEach(b => {
    b.addEventListener("click", () => {
      if (!state.img) { alert("Upload an image first."); return; }
      pushStyleUndo();
      const target = b.dataset.auto;
      if (target && target !== state.style) switchStyle(target);
      requestAnimationFrame(() => autoTuneCurrent());
    });
  });

  // ============== RESET ==============
  // RESET wipes the slate: no photo, no mask, and none of the creative choices
  // (shape, text, wear, invert, levels) from the previous design survive it.
  resetBtn.addEventListener("click", () => {
    state.img = null; state.mask.data = null; state.mask.editMode = false;
    state.mask.anyChanges = false; state.mask.rev = 0; state.mask.feather = 0;
    state.mask.lassoPoints = []; state.mask.lassoActive = false;
    state.elementMasks = [];
    state.lastLayer = null; originalImg = null; clearHistory(); setMaskEditUI(false);
    baseCaches.length = 0;
    srcToken++;
    applyStyleSnap({
      style: "surrealist",
      tweaks: JSON.parse(JSON.stringify(DEFAULT_TWEAKS)),
      paper: "#d9d4c8",
      shape: "none",
      shapeXf: { x: 50, y: 50, scale: 1, rot: 0 },
      designXf: { x: 0, y: 0, scale: 1, rot: 0 },
      shapeOutline: 0,
      shapeFill: "",
      invert: false,
      distress: false, distressAmount: 40, distressNoiseType: "fine", distressTarget: "design",
      distressTexScale: 1, distressEdge: 100, distressScratch: 100,
      textOverlay: { enabled: false, text: "", size: 8, x: 50, y: 85, rot: 0, font: "cursive" },
      textXor: false,
    });
    syncSliders("compose");
    styleHistory.undo.length = 0; styleHistory.redo.length = 0; updateStyleHistoryUI();
    prepPts.black = prepPts.mid = prepPts.white = null;
    syncPrepPicks();
    transparentBgChk.checked = false;
    if (sinPapelChk) { sinPapelChk.checked = false; aplicarSinPapel(); }
    // Antes aquí volvía el cartel de «drop a soul». Ahora el lienzo vacío ES el
    // collage: se enciende y ella suelta las fotos encima directamente.
    paperEl.style.display = "none";
    empty.style.display = "none";
    // Vaciar ANTES de abrir. El lienzo del collage es ahora el lienzo
    // principal, así que si no se vacía, RESET dejaba todas las fotos puestas y
    // parecía que el botón no hacía nada.
    if (window.KAOS_SURREAL) { if (KAOS_SURREAL.vaciar) KAOS_SURREAL.vaciar(); KAOS_SURREAL.open(); }
    prepSection.style.display = "none";
    downloadBtn.disabled = true; dimsLabel.textContent = "";
    if (saveProjectBtn) saveProjectBtn.disabled = true;
    currentProjectId = null; currentProjectName = "";
    if (duplicateResultBtn) duplicateResultBtn.disabled = true;
    fileInput.value = "";
    updateTextGizmo(); updateDesignGizmo();
  });
  if (duplicateResultBtn) {
    duplicateResultBtn.addEventListener("click", () => {
      pasarCollageAlLienzo();
      if (!state.lastLayer) return;
      const c = document.createElement("canvas");
      c.width = state.lastLayer.width; c.height = state.lastLayer.height;
      c.getContext("2d").drawImage(state.lastLayer, 0, 0);
      KAOS_GALLERY.add(c, { style: state.style, paper: state.paper });
      refreshGalleryCount();
      flashSave();
      showToast("Duplicated to gallery.");
    });
  }
  // Removed from the UI: rendering is already scheduled on every change, so
  // this was only ever a "redraw if it got stuck" button.
  reprocessBtn?.addEventListener("click", () => schedule());

  // ============== EL COLLAGE TAMBIEN SE GUARDA ==============
  // Si su trabajo solo vive en el collage (piezas montadas y ninguna foto
  // suelta en el lienzo), GUARDAR, EXPORT y DUPLICAR se quedaban apagados: solo
  // se encendian al adoptar una foto. Los botones que pasaban el collage al
  // lienzo estan escondidos desde que el collage ES el lienzo, asi que no habia
  // ninguna forma de guardar lo montado. Ahora se pasa solo al guardar.
  let _firmaAplanada = null;
  function pasarCollageAlLienzo() {
    // SIEMPRE que haya piezas montadas, no solo la primera vez.
    //
    // Antes esto se saltaba si ya habia foto en el lienzo, y esa foto era la
    // fusion de la vez anterior: se guardaba el montaje de entonces. Todo lo
    // anadido despues — una mandala, un tenido, mover una pieza — no salia.
    // Mientras haya collage, el collage es lo que vale.
    if (!(window.KAOS_SURREAL && KAOS_SURREAL.hayElementos())) return false;
    // Si el montaje esta igual que la ultima vez que se aplano, no se rehace:
    // volver a adoptar reinicia la mascara, y le borraria lo que acabe de pintar.
    const firma = KAOS_SURREAL.firma ? KAOS_SURREAL.firma() : String(Date.now());
    if (state.img && firma === _firmaAplanada) return false;
    const fusion = KAOS_SURREAL.lienzoFusionado && KAOS_SURREAL.lienzoFusionado();
    if (!fusion || !fusion.width) return false;
    const masks = KAOS_SURREAL.elementMasks ? KAOS_SURREAL.elementMasks() : [];
    // Adoptar una foto nueva olvida en que proyecto estaba, porque normalmente
    // es otra foto distinta. Aqui no: es el mismo trabajo de siempre, un poco
    // mas montado. Si no se guardase, GUARDAR crearia un proyecto nuevo cada vez.
    const proyId = currentProjectId, proyNombre = currentProjectName;
    adoptSourceCanvas(fusion, { elementMasks: masks });
    currentProjectId = proyId; currentProjectName = proyNombre;
    _firmaAplanada = firma;
    render();   // sincrono: sin esto, DUPLICAR no encuentra todavia la capa
    return true;
  }
  document.addEventListener("kaos-collage", (e) => {
    const hay = !!(e.detail && e.detail.hay);
    const puede = hay || !!state.img;
    downloadBtn.disabled = !puede;
    if (saveProjectBtn) saveProjectBtn.disabled = !puede;
    if (duplicateResultBtn) duplicateResultBtn.disabled = !puede;
  });

  // ============== EXPORT + GALLERY SAVE ==============
  // On iOS the share sheet is the only route into the Photos app ("Save Image"),
  // so use it when it's available and fall back to a plain download everywhere else.
  const isIOS = /iP(hone|ad|od)/.test(navigator.platform || "") ||
    (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || "")) ||
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  // ------------------------------------------------------- dónde se guarda
  // Antes todo caía en la carpeta de Descargas sin preguntar. Ahora, en los
  // navegadores que lo permiten (Chrome y Edge en el PC), sale el "Guardar
  // como" de Windows y elige ella la carpeta. En el iPad no existe esa ventana:
  // allí manda el menú de compartir, que es la única puerta a la app Fotos.
  const puedeGuardarComo = typeof window.showSaveFilePicker === "function";
  const puedeElegirCarpeta = typeof window.showDirectoryPicker === "function";

  // Cuando se exportan varias imágenes de golpe (todas las hojas, todos los
  // stickers) NO se pregunta una vez por archivo: se pregunta la carpeta una
  // sola vez y allí van todas. Vive sólo durante ese lote y se borra al acabar,
  // para que nunca guarde en un sitio que ella no acabe de elegir.
  let carpetaLote = null;
  async function abrirCarpetaLote(cuantas) {
    carpetaLote = null;
    if (!puedeElegirCarpeta || cuantas < 2) return;
    try {
      carpetaLote = await window.showDirectoryPicker({ id: "kaosFlash", mode: "readwrite", startIn: "pictures" });
    } catch (e) {
      // Si le da a cancelar, no es un error: se guarda como siempre.
      carpetaLote = null;
    }
  }
  function cerrarCarpetaLote() { carpetaLote = null; }

  async function escribir(handle, blob) {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function saveImage(canvas, filename) {
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (!blob) { showToast("No se pudo generar el PNG"); return; }

    // 1) lote con carpeta ya elegida: directo, sin preguntar de nuevo
    if (carpetaLote) {
      try {
        await escribir(await carpetaLote.getFileHandle(filename, { create: true }), blob);
        return;
      } catch (e) { console.warn("no se pudo escribir en la carpeta elegida", e); carpetaLote = null; }
    }

    // 2) "Guardar como" de verdad. El `id` hace que la ventana se vuelva a
    // abrir en la última carpeta que usó, así que a partir de la segunda vez
    // es un solo clic.
    if (puedeGuardarComo) {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: filename,
          id: "kaosFlash",
          startIn: "pictures",
          types: [{ description: "Imagen PNG", accept: { "image/png": [".png"] } }],
        });
        await escribir(h, blob);
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;          // le dio a cancelar
        // SecurityError: el render tardó tanto que el navegador ya no considera
        // que venga de un clic suyo. No es culpa de ella; se guarda y punto.
        console.warn("guardar como no disponible esta vez", e);
      }
    }

    // 3) iPad: el menú de compartir es la única ruta hasta Fotos
    try {
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }

    // 4) lo de siempre: a Descargas
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }
  downloadBtn.addEventListener("click", async () => {
    pasarCollageAlLienzo();
    if (!state.img) return;
    const wasEdit = state.mask.editMode;
    if (wasEdit) { state.mask.editMode = false; render(); }
    const wantTransparent = transparentBgChk.checked || sinPapel();
    downloadBtn.disabled = true;
    const oldLabel = downloadBtn.textContent;
    downloadBtn.textContent = "FULL HD…";
    // full-resolution re-render: the preview is deliberately half-size
    const hi = buildLayer(EXPORT_LONG);
    const exportCanvas = wantTransparent ? hi : KAOS.composeOnPaper(hi, state.paper, state.tweaks.compose);
    await saveImage(exportCanvas, "kaos-realm_" + state.style + (wantTransparent ? "_t" : "") + "_" + Date.now() + ".png");
    if (isIOS) showToast("Elige “Guardar imagen” para mandarlo a Fotos", 4000);
    downloadBtn.textContent = oldLabel;
    downloadBtn.disabled = false;
    KAOS_GALLERY.add(hi, { style: state.style, paper: state.paper });
    refreshGalleryCount();
    flashSave();
    if (wasEdit) { state.mask.editMode = true; setMaskEditUI(true); render(); }
  });
  function flashSave() {
    galleryBtn.classList.add("flash");
    setTimeout(() => galleryBtn.classList.remove("flash"), 600);
  }
  function refreshGalleryCount() { galleryCount.textContent = KAOS_GALLERY.count(); }
  refreshGalleryCount();
  // Bridge for auxiliary modules (scan.js etc.)
  window.KAOS_TOAST = showToast;
  document.addEventListener("kaos-gallery-changed", refreshGalleryCount);
  // La galeria se carga de IndexedDB en cuanto arranca la pagina, y eso tarda un
  // instante. Si la rejilla ya esta abierta cuando llega, hay que repintarla:
  // si no, se quedaria enseñando la lista vacia del primer momento.
  document.addEventListener("kaos-gallery-changed", () => {
    if (galleryModal && galleryModal.style.display !== "none") renderGalleryGrid();
  });

  // ============== SIDEBAR TABS ==============
  // One long scroll was unusable on the iPad; the panel is now four short tabs.
  const sideTabs = $("#sideTabs");
  if (sideTabs) {
    const panels = $$(".side-panel");
    const showTab = (name) => {
      $$(".side-tab", sideTabs).forEach(t => t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false"));
      panels.forEach(p => { p.hidden = p.dataset.panel !== name; });
      const sc = $(".side-scroll");
      if (sc) sc.scrollTop = 0;
      try { localStorage.setItem("kaos.sideTab", name); } catch (e) {}
    };
    $$(".side-tab", sideTabs).forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
    let saved = null;
    try { saved = localStorage.getItem("kaos.sideTab"); } catch (e) {}
    showTab(saved && $('.side-panel[data-panel="' + saved + '"]') ? saved : "style");
    // jumping to the mask tab whenever mask editing starts keeps the tools in reach
    window.KAOS_SHOW_TAB = showTab;

    // ---------------------------------------------------- COMPOSE
    // La pestaña COMPOSE y el collage son la misma cosa: entrar en la pestaña
    // enciende el collage sobre el lienzo, salirse lo apaga. Antes había un
    // botón que abría una ventana aparte y era el segundo sitio donde soltar
    // fotos; ahora es un modo de la pantalla de siempre.
    const escenario = $("#surrealModal");
    const componiendo = () => !!escenario && escenario.style.display !== "none";
    // COMPOSE ya no es una pestaña: sus mandos viven dentro del panel de STYLE,
    // encima de los del estilo. Aquí sólo queda avisar al collage de que se
    // repinte cuando ella vuelve a STYLE, por si cambió algo mientras tanto.
    $$(".side-tab", sideTabs).forEach(t => t.addEventListener("click", () => {
      if (window.KAOS_SURREAL && componiendo() && KAOS_SURREAL.refrescarPrevia) {
        KAOS_SURREAL.refrescarPrevia();
      }
    }));

    // surreal.js se cierra solo al acabar un collage (los botones de FINISH
    // dejan el resultado en el lienzo principal y apagan el escenario). Cuando
    // eso pasa hay que devolver la barra a STYLE, o se quedarían los mandos del
    // collage abiertos sin collage debajo. Se vigila el propio elemento en vez
    // de envolver open/close: surreal.js se llama a sí mismo por dentro y una
    // envoltura se saltaría justo esos casos.
    if (escenario && window.MutationObserver) {
      let antes = componiendo();
      new MutationObserver(() => {
        const ahora = componiendo();
        if (ahora === antes) return;
        antes = ahora;
        // Componer y dar estilo son la misma faena y viven en la misma
        // pestaña, así que encender el collage lleva a STYLE, no a otro sitio.
        showTab("style");
      }).observe(escenario, { attributes: true, attributeFilter: ["style"] });
    }
  }

  // ============== ANALYSIS DRAWER ==============
  // STYLE NOTES drawer removed from the UI at the user's request.
  analysisToggle?.addEventListener("click", () => {
    analysis.classList.toggle("open");
    analysisToggle.textContent = analysis.classList.contains("open") ? "STYLE NOTES ↓" : "STYLE NOTES ↑";
  });

  // ============== MASK ==============
  function initMask(w, h) {
    state.mask.w = w; state.mask.h = h;
    state.mask.data = new Uint8Array(w * h);
    state.mask.data.fill(255);
    state.mask.anyChanges = false;
    updateCoverage();
  }
  function updateCoverage() {
    if (!state.mask.data) { maskCoverage.textContent = "—"; return; }
    let kept = 0;
    for (let i = 0; i < state.mask.data.length; i++) if (state.mask.data[i] > 128) kept++;
    const pct = Math.round((kept / state.mask.data.length) * 100);
    maskCoverage.textContent = pct + "% KEPT";
    // every mask mutation funnels through here — the render cache keys off this
    state.mask.rev = (state.mask.rev || 0) + 1;
  }
  maskEditBtn.addEventListener("click", () => {
    // Con dos o mas fotos, el collage tapa el lienzo entero: cada clic caia en
    // el y movia la pieza en vez de pintar. Al entrar en MASK se aplana el
    // montaje y se aparta el collage, que es lo que deja pintar encima.
    const entrando = !state.mask.editMode;
    if (entrando && window.KAOS_SURREAL && KAOS_SURREAL.hayElementos()) {
      pasarCollageAlLienzo();
      KAOS_SURREAL.close();
      showToast("Collage aplanado para poder pintar la máscara");
    }
    if (!state.img) return;
    state.mask.editMode = !state.mask.editMode;
    setMaskEditUI(state.mask.editMode);
    schedule();
  });
  function setMaskEditUI(on) {
    if (on && window.KAOS_SHOW_TAB) window.KAOS_SHOW_TAB("mask");
    maskEditBtn.classList.toggle("active", on);
    maskEditBtn.textContent = on ? "DONE — APPLY MASK" : "EDIT MASK";
    maskTools.style.display = on ? "" : "none";
    stageEl.classList.toggle("mask-mode", on);
  }
  autoMaskBtn.addEventListener("click", () => {
    if (!state.img || !state.mask.data) return;
    pushUndo(); autoFromCorners(); state.mask.anyChanges = true;
    updateCoverage(); schedule();
  });
  resetMaskBtn.addEventListener("click", () => {
    if (!state.mask.data) return;
    pushUndo(); state.mask.data.fill(255); state.mask.anyChanges = false;
    updateCoverage(); schedule();
  });
  function getSrcData() {
    return state.img.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, state.mask.w, state.mask.h).data;
  }
  function autoFromCorners() {
    const src = getSrcData();
    const w = state.mask.w, h = state.mask.h;
    const corners = [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]];
    for (const [x, y] of corners) floodFill(src, w, h, state.mask.data, x, y, state.mask.tolerance);
  }
  // Smart auto-cut: samples perimeter points, clusters them by colour, floods
  // from each cluster — catches gradient/uneven backgrounds better than corners alone.
  function smartAutoMask() {
    const src = getSrcData();
    const w = state.mask.w, h = state.mask.h;
    const samples = [];
    const N_PER_SIDE = 8;
    for (let i = 0; i < N_PER_SIDE; i++) {
      const t = (i + 0.5) / N_PER_SIDE;
      samples.push([Math.round(t * (w - 1)), 2]);
      samples.push([Math.round(t * (w - 1)), h - 3]);
      samples.push([2, Math.round(t * (h - 1))]);
      samples.push([w - 3, Math.round(t * (h - 1))]);
    }
    const tol = Math.max(20, state.mask.tolerance);
    const T2 = tol * tol;
    const clusters = [];
    for (const [x, y] of samples) {
      const i = (y * w + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      let merged = false;
      for (const c of clusters) {
        const dr = c.r - r, dg = c.g - g, db = c.b - b;
        if (dr * dr + dg * dg + db * db < T2) { c.r = (c.r + r) >> 1; c.g = (c.g + g) >> 1; c.b = (c.b + b) >> 1; merged = true; break; }
      }
      if (!merged) clusters.push({ r, g, b, sx: x, sy: y });
    }
    for (const c of clusters) floodFill(src, w, h, state.mask.data, c.sx, c.sy, tol);
    const c2 = Math.max(15, Math.round(tol * 0.7));
    for (const [x, y] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) floodFill(src, w, h, state.mask.data, x, y, c2);
  }
  // `value` is what the matched region gets written into the mask:
  //   0   = hide it   (the "Click" tool — masks the background out)
  //   255 = bring it back (the "Click+" tool — un-masks a region you cut by mistake)
  // Colour matching always reads the ORIGINAL pixels, so a region that is
  // currently hidden can still be flood-matched and restored.
  function floodFill(src, w, h, m, sx, sy, tolerance, value) {
    const v = value === undefined ? 0 : value;
    const i0 = (sy * w + sx) * 4;
    const r0 = src[i0], g0 = src[i0 + 1], b0 = src[i0 + 2];
    const T2 = tolerance * tolerance;
    const stack = [sx, sy];
    const visited = new Uint8Array(w * h);
    while (stack.length) {
      const y = stack.pop(); const x = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const j = y * w + x;
      if (visited[j]) continue;
      visited[j] = 1;
      const i = j * 4;
      const dr = src[i] - r0, dg = src[i + 1] - g0, db = src[i + 2] - b0;
      if (dr * dr + dg * dg + db * db > T2) continue;
      m[j] = v;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }
  function brushAt(cx, cy, radius, restore) {
    const r2 = radius * radius;
    const w = state.mask.w, h = state.mask.h;
    const x0 = Math.max(0, cx - radius), x1 = Math.min(w - 1, cx + radius);
    const y0 = Math.max(0, cy - radius), y1 = Math.min(h - 1, cy + radius);
    const v = restore ? 255 : 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) state.mask.data[y * w + x] = v;
      }
    }
  }
  function lineBrush(x0, y0, x1, y1, radius, restore) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, radius / 2)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      brushAt(Math.round(x0 + dx * t), Math.round(y0 + dy * t), radius, restore);
    }
  }

  // Polygon scanline fill into a Uint8 mask (value 0 or 255).
  function fillPolygonToMask(mask, w, h, polyXY, value) {
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

  // ============== UNDO / REDO ==============
  function snap() { return new Uint8Array(state.mask.data); }
  function pushUndo() {
    if (!state.mask.data) return;
    state.history.undo.push(snap());
    if (state.history.undo.length > state.history.MAX) state.history.undo.shift();
    state.history.redo.length = 0;
    updateHistoryUI();
  }
  function undo() {
    if (!state.history.undo.length || !state.mask.data) return;
    state.history.redo.push(snap());
    state.mask.data = state.history.undo.pop();
    state.mask.anyChanges = true;
    updateCoverage(); updateHistoryUI(); schedule();
  }
  function redo() {
    if (!state.history.redo.length || !state.mask.data) return;
    state.history.undo.push(snap());
    state.mask.data = state.history.redo.pop();
    state.mask.anyChanges = true;
    updateCoverage(); updateHistoryUI(); schedule();
  }
  function clearHistory() {
    state.history.undo.length = 0; state.history.redo.length = 0;
    updateHistoryUI();
  }
  function updateHistoryUI() {
    undoBtn.disabled = state.history.undo.length === 0;
    redoBtn.disabled = state.history.redo.length === 0;
  }
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  // ============== STYLE UNDO / REDO ==============
  const styleHistory = { undo: [], redo: [], MAX: 30 };
  function styleSnap() {
    return {
      style: state.style,
      tweaks: JSON.parse(JSON.stringify(state.tweaks)),
      paper: state.paper,
      shape: state.shape,
      shapeXf: JSON.parse(JSON.stringify(state.shapeXf)),
      designXf: JSON.parse(JSON.stringify(state.designXf)),
      shapeOutline: state.shapeOutline,
      shapeFill: state.shapeFill,
      invert: invertEnabled,
      distress: distressEnabled,
      distressAmount: distressAmount,
      distressTexScale: distressTexScale,
      distressEdge: distressEdge,
      distressScratch: distressScratch,
      distressTarget: distressTarget,
      distressNoiseType: distressNoiseType,
      textOverlay: JSON.parse(JSON.stringify(textOverlay)),
      textXor: textXor,
    };
  }
  function pushStyleUndo() {
    styleHistory.undo.push(styleSnap());
    if (styleHistory.undo.length > styleHistory.MAX) styleHistory.undo.shift();
    styleHistory.redo.length = 0;
    updateStyleHistoryUI();
  }
  function styleUndo() {
    if (!styleHistory.undo.length) return;
    styleHistory.redo.push(styleSnap());
    const snap = styleHistory.undo.pop();
    applyStyleSnap(snap);
    updateStyleHistoryUI();
  }
  function styleRedo() {
    if (!styleHistory.redo.length) return;
    styleHistory.undo.push(styleSnap());
    const snap = styleHistory.redo.pop();
    applyStyleSnap(snap);
    updateStyleHistoryUI();
  }
  function applyStyleSnap(snap) {
    state.tweaks = JSON.parse(JSON.stringify(snap.tweaks));
    if (snap.style !== state.style) {
      state.style = snap.style;
      $$("#styles .style-btn").forEach(b => b.setAttribute("aria-selected", b.dataset.style === snap.style));
      $$(".ctl-group").forEach(g => g.style.display = "none");
      const grp = $("#ctl-" + snap.style);
      if (grp) grp.style.display = "";
    }
    if (snap.paper !== state.paper) setActivePaper(snap.paper, true);
    state.shape = snap.shape || "none";
    if (snap.shapeXf) Object.assign(state.shapeXf, snap.shapeXf);
    state.shapeOutline = snap.shapeOutline || 0;
    state.shapeFill = snap.shapeFill || "";
    Object.assign(state.designXf, snap.designXf || { x: 0, y: 0, scale: 1, rot: 0 });
    syncShapeUI();
    syncDesignUI();
    invertEnabled = !!snap.invert;
    invertChk.checked = invertEnabled;
    distressEnabled = !!snap.distress;
    distressAmount = snap.distressAmount || 40;
    distressTexScale = snap.distressTexScale == null ? 1 : snap.distressTexScale;
    distressEdge = snap.distressEdge == null ? 100 : snap.distressEdge;
    distressScratch = snap.distressScratch == null ? 100 : snap.distressScratch;
    distressNoiseType = snap.distressNoiseType || "fine";
    distressTarget = snap.distressTarget || "design";
    renderDistressTargets();
    $$("#distressNoiseType .tog").forEach(b => b.setAttribute("aria-selected", b.dataset.noise === distressNoiseType));
    distressChk.checked = distressEnabled;
    distressCtl.style.display = distressEnabled ? "" : "none";
    distressAmt.value = distressAmount;
    distressVal.textContent = distressAmount;
    syncDistressUI();
    Object.assign(textOverlay, snap.textOverlay || { enabled: false, text: "", size: 8, x: 50, y: 85, rot: 0, font: "cursive" });
    textOverlayChk.checked = textOverlay.enabled;
    textOverlayCtl.style.display = textOverlay.enabled ? "" : "none";
    textOverlayInput.value = textOverlay.text;
    textOverlaySize.value = textOverlay.size; $("#textOverlaySizeVal").textContent = textOverlay.size;
    textOverlayRot.value = textOverlay.rot; $("#textOverlayRotVal").textContent = textOverlay.rot + "°";
    textXor = !!snap.textXor;
    if (textXorChk) textXorChk.checked = textXor;
    renderTextFontPicker();
    updateTextGizmo();
    syncSliders(state.style);
    if (state.style === "threshold") {
      $$('.tog[data-section="threshold"][data-tweak="mode"]').forEach(b => {
        b.setAttribute("aria-selected", b.dataset.val === state.tweaks.threshold.mode);
      });
      updateThreshModeUI();
    }
    schedule();
  }
  function updateStyleHistoryUI() {
    if (styleUndoBtn) styleUndoBtn.disabled = styleHistory.undo.length === 0;
    if (styleRedoBtn) styleRedoBtn.disabled = styleHistory.redo.length === 0;
  }
  styleUndoBtn.addEventListener("click", styleUndo);
  styleRedoBtn.addEventListener("click", styleRedo);
  // Push style undo when slider interaction starts
  $$('input[type="range"][data-tweak]').forEach(r => {
    r.addEventListener("pointerdown", () => {
      if (r.dataset.section && r.dataset.section !== "mask") pushStyleUndo();
    });
  });

  // ============== CANVAS POINTER (mask edit) ==============
  function getXY(e) {
    const rect = outCanvas.getBoundingClientRect();
    const sx = outCanvas.width / rect.width;
    const sy = outCanvas.height / rect.height;
    return [Math.round((e.clientX - rect.left) * sx), Math.round((e.clientY - rect.top) * sy)];
  }
  outCanvas.addEventListener("pointerdown", (e) => {
    if (!state.mask.editMode || !state.img) return;
    e.preventDefault();
    outCanvas.setPointerCapture(e.pointerId);
    const [x, y] = getXY(e);
    const m = state.mask;
    if (m.tool === "flood" || m.tool === "floodRestore") {
      pushUndo();
      const src = getSrcData();
      floodFill(src, m.w, m.h, m.data, x, y, m.tolerance, m.tool === "floodRestore" ? 255 : 0);
      m.anyChanges = true; updateCoverage(); schedule();
    } else if (m.tool === "lasso" || m.tool === "lassoCut") {
      pushUndo();
      m.lassoPoints = [x, y];
      m.lassoActive = true;
      schedule();
    } else if (m.tool === "erase" || m.tool === "restore") {
      pushUndo();
      const r = Math.max(1, Math.round(m.brushSize / 2));
      brushAt(x, y, r, m.tool === "restore");
      m.isDrawing = true; m.lastXY = [x, y]; m.anyChanges = true;
      updateCoverage(); schedule();
    }
  });
  outCanvas.addEventListener("pointermove", (e) => {
    if (!state.mask.editMode) return;
    showBrushCursor(e);
    const [x, y] = getXY(e);
    const m = state.mask;
    if (m.lassoActive) {
      const p = m.lassoPoints;
      const lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) > 4) { p.push(x, y); schedule(); }
      return;
    }
    if (m.isDrawing && (m.tool === "erase" || m.tool === "restore")) {
      const r = Math.max(1, Math.round(m.brushSize / 2));
      if (m.lastXY) lineBrush(m.lastXY[0], m.lastXY[1], x, y, r, m.tool === "restore");
      else brushAt(x, y, r, m.tool === "restore");
      m.lastXY = [x, y]; updateCoverage(); schedule();
    }
  });
  function endStroke() {
    if (state.mask.lassoActive) {
      state.mask.lassoActive = false;
      if (state.mask.lassoPoints.length >= 6) {
        if (state.mask.tool === "lassoCut") {
          // Lazo quitar: whatever you loop around DISAPPEARS.
          fillPolygonToMask(state.mask.data, state.mask.w, state.mask.h, state.mask.lassoPoints, 0);
        } else {
          // Lazo dejar: zero out everything OUTSIDE the loop.
          const oldMask = new Uint8Array(state.mask.data);
          state.mask.data.fill(0);
          fillPolygonToMask(state.mask.data, state.mask.w, state.mask.h, state.mask.lassoPoints, 255);
          for (let i = 0; i < state.mask.data.length; i++) if (oldMask[i] < 128) state.mask.data[i] = 0;
        }
        state.mask.anyChanges = true;
        updateCoverage();
      }
      state.mask.lassoPoints = [];
      schedule();
    }
    state.mask.isDrawing = false; state.mask.lastXY = null;
  }
  outCanvas.addEventListener("pointerup", endStroke);
  outCanvas.addEventListener("pointercancel", endStroke);
  outCanvas.addEventListener("pointerleave", () => { endStroke(); hideBrushCursor(); });

  const brushCursor = $("#brushCursor");
  function showBrushCursor(e) {
    const t = state.mask.tool;
    if (t !== "erase" && t !== "restore") { hideBrushCursor(); return; }
    const rect = outCanvas.getBoundingClientRect();
    const sx = rect.width / outCanvas.width;
    const dispR = (state.mask.brushSize / 2) * sx;
    brushCursor.style.display = "block";
    brushCursor.style.width = (dispR * 2) + "px";
    brushCursor.style.height = (dispR * 2) + "px";
    brushCursor.style.left = (e.clientX - dispR) + "px";
    brushCursor.style.top = (e.clientY - dispR) + "px";
    brushCursor.dataset.tool = t;
  }
  function hideBrushCursor() { brushCursor.style.display = "none"; }

  // ============== UNDO / REDO ROUTER ==============
  // One shortcut, many editing surfaces. Each surface declares when it owns
  // the screen; the first match in this list wins, so ⌘Z always acts on
  // whatever the user is actually looking at instead of silently editing the
  // panel hidden behind a modal.
  //
  // Order = topmost surface first. `style` is last and always active, so it is
  // the fallback for the STYLE / FINISH / PAPER tabs.
  function isShown(el) { return !!el && el.style.display !== "none"; }
  const UNDO_CONTEXTS = [
    {
      name: "scan",
      active: () => isShown($("#scanModal")),
      // Scan has no editable history of its own; swallow the shortcut so it
      // can't reach through and mangle the style panel underneath.
      undo: () => showToast("Escanear no tiene deshacer"),
      redo: () => showToast("Escanear no tiene rehacer"),
    },
    {
      name: "surreal",
      active: () => isShown($("#surrealModal")) && !!window.KAOS_SURREAL,
      undo: () => KAOS_SURREAL.undo(),
      redo: () => KAOS_SURREAL.redo(),
    },
    {
      name: "compose",
      active: () => isShown(composeView),
      undo: () => composeUndo(),
      redo: () => composeRedo(),
    },
    {
      name: "mask",
      active: () => state.mask.editMode,
      undo: () => undo(),
      redo: () => redo(),
    },
    {
      name: "style",
      active: () => true,
      undo: () => styleUndo(),
      redo: () => styleRedo(),
    },
  ];
  function routeUndo(wantRedo) {
    for (const ctx of UNDO_CONTEXTS) {
      let on = false;
      try { on = ctx.active(); } catch (err) { on = false; }
      if (!on) continue;
      try { wantRedo ? ctx.redo() : ctx.undo(); }
      catch (err) { console.warn("undo/redo failed in context " + ctx.name, err); }
      return;
    }
  }

  // ============== KEYBOARD ==============
  // Typing must never be hijacked: bail on ANY text-entry target, including
  // contenteditable and the number/search inputs the old check let through.
  function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return false;
    return !/^(button|checkbox|radio|range|color|file|submit|reset|image)$/i.test(el.type || "text");
  }
  window.addEventListener("keydown", (e) => {
    if (isTextEntry(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      routeUndo(e.shiftKey || e.altKey);
    }
    else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      routeUndo(true);
    }
    else if (e.key === "Escape") {
      if (galleryModal.style.display !== "none") closeGallery();
      else if (state.mask.editMode) { state.mask.editMode = false; setMaskEditUI(false); schedule(); }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (composeView.style.display !== "none" && composeState.selectedIndex != null) {
        e.preventDefault();
        removeSelected();
      }
    }
  });

  // ============== INVERT / NEGATIVE ==============
  const invertChk = $("#invertChk");
  let invertEnabled = false;
  if (invertChk) {
    invertChk.addEventListener("change", (e) => {
      invertEnabled = e.target.checked;
      pushStyleUndo();
      schedule();
    });
  }

  // ============== SHAPE MASK — placeable by hand, optional contour ==============
  const shapeCtl = $("#shapeCtl");
  const shapeScaleSl = $("#shapeScale"), shapeRotSl = $("#shapeRot"), shapeOutlineSl = $("#shapeOutline");
  function syncShapeUI() {
    $$("#shapes .shape-btn").forEach(b => b.setAttribute("aria-selected", b.dataset.shape === state.shape ? "true" : "false"));
    shapeCtl.style.display = state.shape === "none" ? "none" : "";
    updateDesignGizmo();
    shapeScaleSl.value = state.shapeXf.scale;
    $("#shapeScaleVal").textContent = (+state.shapeXf.scale).toFixed(2);
    shapeRotSl.value = state.shapeXf.rot;
    $("#shapeRotVal").textContent = Math.round(state.shapeXf.rot) + "°";
    shapeOutlineSl.value = state.shapeOutline;
    $("#shapeOutlineVal").textContent = (Math.round(state.shapeOutline * 2) / 2).toString();
    $$("#shapeFill .tog").forEach(b => b.setAttribute("aria-selected", (b.dataset.fill || "") === (state.shapeFill || "") ? "true" : "false"));
  }
  const shapeFillRow = $("#shapeFill");
  if (shapeFillRow) {
    shapeFillRow.addEventListener("click", (e) => {
      const b = e.target.closest(".tog");
      if (!b) return;
      const v = b.dataset.fill || "";
      if (v === (state.shapeFill || "")) return;
      pushStyleUndo();
      state.shapeFill = v;
      syncShapeUI();
      schedule();
    });
  }
  $$("#shapes .shape-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.shape === state.shape) return;
      pushStyleUndo();
      state.shape = btn.dataset.shape;
      syncShapeUI();
      schedule();
    });
  });
  [shapeScaleSl, shapeRotSl, shapeOutlineSl].forEach(sl => sl.addEventListener("pointerdown", () => pushStyleUndo()));
  shapeScaleSl.addEventListener("input", (e) => {
    state.shapeXf.scale = parseFloat(e.target.value);
    $("#shapeScaleVal").textContent = state.shapeXf.scale.toFixed(2);
    scheduleDraft();
  });
  shapeRotSl.addEventListener("input", (e) => {
    state.shapeXf.rot = parseInt(e.target.value, 10);
    $("#shapeRotVal").textContent = state.shapeXf.rot + "°";
    scheduleDraft();
  });
  shapeOutlineSl.addEventListener("input", (e) => {
    state.shapeOutline = parseFloat(e.target.value);
    $("#shapeOutlineVal").textContent = (Math.round(state.shapeOutline * 2) / 2).toString();
    schedule();
  });
  // ============== DESIGN TRANSFORM — move / scale / rotate the artwork ==============
  // The crop shape is a fixed window; what moves is the design behind it.
  const designScaleSl = $("#designScale"), designRotSl = $("#designRot");
  function syncDesignUI() {
    const d = state.designXf;
    if (designScaleSl) { designScaleSl.value = d.scale; $("#designScaleVal").textContent = (+d.scale).toFixed(2); }
    if (designRotSl) { designRotSl.value = d.rot; $("#designRotVal").textContent = Math.round(d.rot) + "°"; }
    updateDesignGizmo();
  }
  if (designScaleSl) {
    [designScaleSl, designRotSl].forEach(sl => sl.addEventListener("pointerdown", () => pushStyleUndo()));
    designScaleSl.addEventListener("input", (e) => {
      state.designXf.scale = parseFloat(e.target.value);
      $("#designScaleVal").textContent = state.designXf.scale.toFixed(2);
      updateDesignGizmo();
      scheduleDraft();
    });
    designRotSl.addEventListener("input", (e) => {
      state.designXf.rot = parseInt(e.target.value, 10);
      $("#designRotVal").textContent = state.designXf.rot + "°";
      updateDesignGizmo();
      scheduleDraft();
    });
    $("#designResetBtn").addEventListener("click", () => {
      pushStyleUndo();
      Object.assign(state.designXf, { x: 0, y: 0, scale: 1, rot: 0 });
      syncDesignUI();
      schedule();
    });
  }
  syncShapeUI();

  // ============== DISTRESS / WORN ==============
  const distressChk = $("#distressChk");
  const distressCtl = $("#distressCtl");
  const distressAmt = $("#distressAmt");
  const distressVal = $("#distressVal");
  let distressEnabled = false;
  let distressAmount = 40;
  let distressNoiseType = "fine";
  let distressSeed = 4242;
  // Manual texture controls: patch size, how much the wear favours edges, scratch density.
  var distressTexScale = 1, distressEdge = 100, distressScratch = 100;
  var distressTexSl = $("#distressTex"), distressEdgeSl = $("#distressEdge"), distressScratchSl = $("#distressScratch");
  function syncDistressUI() {
    if (!distressTexSl) return;
    distressTexSl.value = distressTexScale;
    $("#distressTexVal").textContent = (+distressTexScale).toFixed(2);
    distressEdgeSl.value = distressEdge;
    $("#distressEdgeVal").textContent = distressEdge;
    distressScratchSl.value = distressScratch;
    $("#distressScratchVal").textContent = distressScratch;
  }
  function wearOpts() { return { texScale: distressTexScale, edgeBias: distressEdge, scratch: distressScratch }; }
  // Where the wear bites: the design, the cursive text, everything, or ONE of the
  // photos the design is stitched from ("el:<id>").
  let distressTarget = "design";
  const distressElementsRow = $("#distressElements");
  function renderDistressTargets() {
    const masks = state.elementMasks || [];
    distressElementsRow.innerHTML = "";
    distressElementsRow.style.display = masks.length > 1 ? "" : "none";
    if (masks.length > 1) {
      masks.forEach((m, i) => {
        const b = document.createElement("button");
        b.className = "tog";
        b.dataset.target = "el:" + m.id;
        b.textContent = (i + 1) + " · " + String(m.name || "capa").slice(0, 14);
        distressElementsRow.appendChild(b);
      });
    }
    if (distressTarget.startsWith("el:") && !masks.some(m => "el:" + m.id === distressTarget)) distressTarget = "design";
    $$("#distressCtl .tog[data-target]").forEach(b => {
      b.setAttribute("aria-selected", b.dataset.target === distressTarget ? "true" : "false");
      if (!b._wired) {
        b._wired = true;
        b.addEventListener("click", () => {
          if (b.dataset.target === distressTarget) return;
          pushStyleUndo();
          distressTarget = b.dataset.target;
          renderDistressTargets();
          schedule();
        });
      }
    });
    const hint = $("#distressTargetHint");
    if (hint) hint.textContent = masks.length > 1 ? "/ " + masks.length + " fotos en el diseño" : "";
  }
  renderDistressTargets();
  distressChk.addEventListener("change", (e) => {
    pushStyleUndo();
    distressEnabled = e.target.checked;
    distressCtl.style.display = distressEnabled ? "" : "none";
    schedule();
  });
  $$("#distressNoiseType .tog").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.noise === distressNoiseType) return;
      pushStyleUndo();
      $$("#distressNoiseType .tog").forEach(b => b.setAttribute("aria-selected", b === btn));
      distressNoiseType = btn.dataset.noise;
      distressSeed = (Math.random() * 1e6) | 0;
      schedule();
    });
  });
  distressAmt.addEventListener("pointerdown", () => pushStyleUndo());
  distressAmt.addEventListener("input", (e) => {
    distressAmount = parseInt(e.target.value, 10);
    distressVal.textContent = distressAmount;
    scheduleDraft();
  });
  if (distressTexSl) {
    [distressTexSl, distressEdgeSl, distressScratchSl].forEach(sl => sl.addEventListener("pointerdown", () => pushStyleUndo()));
    distressTexSl.addEventListener("input", (e) => {
      distressTexScale = parseFloat(e.target.value);
      $("#distressTexVal").textContent = distressTexScale.toFixed(2);
      scheduleDraft();
    });
    distressEdgeSl.addEventListener("input", (e) => {
      distressEdge = parseInt(e.target.value, 10);
      $("#distressEdgeVal").textContent = distressEdge;
      scheduleDraft();
    });
    distressScratchSl.addEventListener("input", (e) => {
      distressScratch = parseInt(e.target.value, 10);
      $("#distressScratchVal").textContent = distressScratch;
      scheduleDraft();
    });
    $("#distressShuffle").addEventListener("click", () => {
      pushStyleUndo();
      distressSeed = (Math.random() * 1e6) | 0;
      schedule();
    });
    syncDistressUI();
  }

  // ============== CURSIVE TEXT OVERLAY ==============
  const textOverlayChk = $("#textOverlayChk");
  const textOverlayCtl = $("#textOverlayCtl");
  const textOverlayInput = $("#textOverlayInput");
  const textOverlaySize = $("#textOverlaySize");
  const textOverlayRot = $("#textOverlayRot");
  const textOverlay = { enabled: false, text: "", size: 8, x: 50, y: 85, rot: 0, font: "cursive" };
  const textXorChk = $("#textXorChk");
  let textXor = false;
  if (textXorChk) textXorChk.addEventListener("change", (e) => {
    pushStyleUndo();
    textXor = e.target.checked;
    schedule();
  });
  function renderTextFontPicker() {
    const el = $("#textOverlayFontPicker");
    if (!el || !window.KAOS_GALLERY) return;
    el.innerHTML = "";
    Object.entries(KAOS_GALLERY.FONTS).forEach(([id, f]) => {
      const btn = document.createElement("button");
      btn.className = "font-pick";
      btn.style.fontFamily = `"${f.family}", serif`;
      btn.style.fontWeight = f.weight;
      btn.textContent = f.sample;
      if (id === textOverlay.font) btn.setAttribute("aria-selected", "true");
      btn.addEventListener("click", () => {
        pushStyleUndo();
        textOverlay.font = id;
        renderTextFontPicker();
        schedule();
      });
      el.appendChild(btn);
    });
  }
  textOverlayChk.addEventListener("change", (e) => {
    pushStyleUndo();
    textOverlay.enabled = e.target.checked;
    textOverlayCtl.style.display = textOverlay.enabled ? "" : "none";
    if (textOverlay.enabled) renderTextFontPicker();
    schedule();
  });
  textOverlayInput.addEventListener("input", (e) => { textOverlay.text = e.target.value; scheduleDraft(); });
  textOverlayInput.addEventListener("focus", () => pushStyleUndo());
  [textOverlaySize, textOverlayRot].forEach(sl => sl.addEventListener("pointerdown", () => pushStyleUndo()));
  textOverlaySize.addEventListener("input", (e) => { textOverlay.size = parseInt(e.target.value, 10); $("#textOverlaySizeVal").textContent = textOverlay.size; scheduleDraft(); });
  textOverlayRot.addEventListener("input", (e) => { textOverlay.rot = parseInt(e.target.value, 10); $("#textOverlayRotVal").textContent = textOverlay.rot + "°"; scheduleDraft(); });

  // ----- on-canvas gizmo for the cursive text: rotate + resize by hand -----
  const textGizmo = $("#textGizmo"), tgRot = $("#tgRot"), tgScale = $("#tgScale");
  let tgDrag = null;
  function textAnchor() {
    const bb = getTextBBox();
    if (!bb || !outCanvas.width) return null;
    const cRect = outCanvas.getBoundingClientRect();
    const s = cRect.width / outCanvas.width;
    return { bb, s, sx: cRect.left + bb.x * s, sy: cRect.top + bb.y * s, cRect };
  }
  function updateTextGizmo() {
    if (!textGizmo) return;
    const anc = (!state.mask.editMode) && textAnchor();
    if (!anc) { textGizmo.style.display = "none"; return; }
    const wrap = $("#canvasWrap").getBoundingClientRect();
    textGizmo.style.display = "";
    textGizmo.style.left = (anc.sx - wrap.left) + "px";
    textGizmo.style.top = (anc.sy - wrap.top) + "px";
    textGizmo.style.width = (anc.bb.halfW * 2 * anc.s) + "px";
    textGizmo.style.height = (anc.bb.halfH * 2 * anc.s) + "px";
    textGizmo.style.transform = "translate(-50%,-50%) rotate(" + (anc.bb.rot || 0) + "deg)";
  }
  function startTg(mode, e) {
    const anc = textAnchor();
    if (!anc) return;
    e.preventDefault(); e.stopPropagation();
    pushStyleUndo();
    tgDrag = {
      mode,
      startDist: Math.hypot(e.clientX - anc.sx, e.clientY - anc.sy) || 1,
      startSize: textOverlay.size,
      startAng: Math.atan2(e.clientY - anc.sy, e.clientX - anc.sx),
      startRot: textOverlay.rot || 0,
    };
  }
  if (tgRot) tgRot.addEventListener("pointerdown", (e) => startTg("rot", e));
  if (tgScale) tgScale.addEventListener("pointerdown", (e) => startTg("scale", e));
  window.addEventListener("pointermove", (e) => {
    if (!tgDrag) return;
    const anc = textAnchor();
    if (!anc) return;
    if (tgDrag.mode === "rot") {
      const ang = Math.atan2(e.clientY - anc.sy, e.clientX - anc.sx);
      let deg = tgDrag.startRot + (ang - tgDrag.startAng) * 180 / Math.PI;
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      textOverlay.rot = Math.round(deg);
      textOverlayRot.value = textOverlay.rot;
      $("#textOverlayRotVal").textContent = textOverlay.rot + "°";
    } else {
      const dist = Math.hypot(e.clientX - anc.sx, e.clientY - anc.sy);
      const size = Math.max(3, Math.min(60, Math.round(tgDrag.startSize * dist / tgDrag.startDist)));
      textOverlay.size = size;
      textOverlaySize.value = size;
      $("#textOverlaySizeVal").textContent = size;
    }
    updateTextGizmo();
    scheduleDraft();
  });
  window.addEventListener("pointerup", () => { tgDrag = null; });
  window.addEventListener("resize", () => updateTextGizmo());
  renderTextFontPicker();

  // ----- drag text directly on canvas -----
  let textDrag = null;
  function getTextBBox() {
    if (!textOverlay.enabled || !textOverlay.text || !outCanvas.width) return null;
    const w = outCanvas.width, h = outCanvas.height;
    const size = (textOverlay.size / 100) * Math.min(w, h);
    const x = (textOverlay.x / 100) * w, y = (textOverlay.y / 100) * h;
    const ctx = outCanvas.getContext("2d");
    const f = window.KAOS_GALLERY && KAOS_GALLERY.FONTS[textOverlay.font];
    ctx.font = (f ? f.weight : "400") + " " + size + "px " + (f ? `"${f.family}"` : "'Italianno'") + ", cursive";
    const tw = ctx.measureText(textOverlay.text).width;
    return { x, y, halfW: tw / 2 + 14, halfH: size / 2 + 14, rot: textOverlay.rot || 0 };
  }
  function hitTextAt(mx, my) {
    const b = getTextBBox();
    if (!b) return false;
    const rad = -b.rot * Math.PI / 180;
    const dx = mx - b.x, dy = my - b.y;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    return Math.abs(lx) <= b.halfW && Math.abs(ly) <= b.halfH;
  }
  function clampPct(v) { return Math.max(0, Math.min(100, v)); }
  outCanvas.addEventListener("pointerdown", (e) => {
    if (state.mask.editMode || !textOverlay.enabled || !textOverlay.text) return;
    const [mx, my] = getXY(e);
    if (!hitTextAt(mx, my)) return;
    e.preventDefault();
    outCanvas.setPointerCapture(e.pointerId);
    pushStyleUndo();
    textDrag = { offX: mx - (textOverlay.x / 100) * outCanvas.width, offY: my - (textOverlay.y / 100) * outCanvas.height };
  });
  outCanvas.addEventListener("pointermove", (e) => {
    if (!textDrag) return;
    const [mx, my] = getXY(e);
    const w = outCanvas.width, h = outCanvas.height;
    textOverlay.x = clampPct(((mx - textDrag.offX) / w) * 100);
    textOverlay.y = clampPct(((my - textDrag.offY) / h) * 100);
    scheduleDraft();
  });
  function endTextDrag() { textDrag = null; }
  outCanvas.addEventListener("pointerup", endTextDrag);
  outCanvas.addEventListener("pointercancel", endTextDrag);

  // ----- drag the DESIGN itself on the canvas (the crop shape stays put) -----
  // Only meaningful with a shape mask on: the shape is the fixed window.
  // Deltas are measured in CLIENT space against the rect captured at pointerdown,
  // so a re-render that resizes the canvas mid-drag can't make the design jump.
  let designDrag = null;
  function designEditable() { return !!state.img && !!state.shape && state.shape !== "none"; }
  outCanvas.addEventListener("pointerdown", (e) => {
    if (state.mask.editMode || prepPicking || textDrag || dgDrag || !designEditable()) return;
    e.preventDefault();
    outCanvas.setPointerCapture(e.pointerId);
    pushStyleUndo();
    const r = outCanvas.getBoundingClientRect();
    designDrag = {
      cx: e.clientX, cy: e.clientY,
      x0: state.designXf.x, y0: state.designXf.y,
      w: r.width || 1, h: r.height || 1,
    };
  });
  outCanvas.addEventListener("pointermove", (e) => {
    if (!designDrag) return;
    const dx = ((e.clientX - designDrag.cx) / designDrag.w) * 100;
    const dy = ((e.clientY - designDrag.cy) / designDrag.h) * 100;
    state.designXf.x = Math.max(-100, Math.min(100, designDrag.x0 + dx));
    state.designXf.y = Math.max(-100, Math.min(100, designDrag.y0 + dy));
    updateDesignGizmo();
    scheduleDraft();
  });
  const endDesignDrag = () => { designDrag = null; };
  outCanvas.addEventListener("pointerup", endDesignDrag);
  outCanvas.addEventListener("pointercancel", endDesignDrag);

  // ----- on-canvas gizmo: corners scale, top knob rotates -----
  var designGizmo = $("#designGizmo");
  var dgDrag = null;
  function updateDesignGizmo() {
    if (!designGizmo) return;
    if (!state.img || (state.mask && state.mask.editMode) || prepPicking || !outCanvas.width || !state.shape || state.shape === "none") {
      designGizmo.style.display = "none";
      return;
    }
    const cRect = outCanvas.getBoundingClientRect();
    const wrap = $("#canvasWrap").getBoundingClientRect();
    const s = cRect.width / outCanvas.width;
    const d = state.designXf;
    const cx = outCanvas.width / 2 + (d.x / 100) * outCanvas.width;
    const cy = outCanvas.height / 2 + (d.y / 100) * outCanvas.height;
    designGizmo.style.display = "";
    designGizmo.style.left = (cRect.left + cx * s - wrap.left) + "px";
    designGizmo.style.top = (cRect.top + cy * s - wrap.top) + "px";
    designGizmo.style.width = (outCanvas.width * (d.scale || 1) * s) + "px";
    designGizmo.style.height = (outCanvas.height * (d.scale || 1) * s) + "px";
    designGizmo.style.transform = "translate(-50%,-50%) rotate(" + (d.rot || 0) + "deg)";
  }
  function dgCenter() {
    const cRect = outCanvas.getBoundingClientRect();
    const s = cRect.width / outCanvas.width;
    const d = state.designXf;
    return {
      x: cRect.left + (outCanvas.width / 2 + (d.x / 100) * outCanvas.width) * s,
      y: cRect.top + (outCanvas.height / 2 + (d.y / 100) * outCanvas.height) * s,
    };
  }
  $$("#designGizmo .dg-h").forEach(h => {
    h.addEventListener("pointerdown", (e) => {
      if (!state.img || !outCanvas.width) return;
      e.preventDefault(); e.stopPropagation();
      pushStyleUndo();
      const c = dgCenter();
      dgDrag = {
        mode: h.dataset.dg,
        dist: Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1,
        startScale: state.designXf.scale || 1,
        ang: Math.atan2(e.clientY - c.y, e.clientX - c.x),
        startRot: state.designXf.rot || 0,
      };
    });
  });
  window.addEventListener("pointermove", (e) => {
    if (!dgDrag) return;
    const c = dgCenter();
    if (dgDrag.mode === "rot") {
      let deg = dgDrag.startRot + (Math.atan2(e.clientY - c.y, e.clientX - c.x) - dgDrag.ang) * 180 / Math.PI;
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      state.designXf.rot = Math.round(deg);
    } else {
      const dist = Math.hypot(e.clientX - c.x, e.clientY - c.y);
      state.designXf.scale = Math.max(0.2, Math.min(3, +(dgDrag.startScale * dist / dgDrag.dist).toFixed(3)));
    }
    syncDesignUI();
    scheduleDraft();
  });
  window.addEventListener("pointerup", () => { dgDrag = null; });
  window.addEventListener("resize", () => updateDesignGizmo());

  // ============== RE-COMPOSE ==============
  // Show re-compose button in surreal composer after first finish
  let hasFinishedSurreal = false;
  const surrealRecomposeBtn = $("#surrealRecomposeBtn");
  if (surrealRecomposeBtn) {
    surrealRecomposeBtn.addEventListener("click", () => {
      if (window.KAOS_SURREAL) KAOS_SURREAL.open();
    });
  }

  // ============== RENDER ==============
  let pending = null;
  function schedule() {
    if (!state.img) return;
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => { pending = null; render(); });
  }
  // While you are typing or dragging, the preview renders at HALF resolution so it
  // keeps up with your finger; ~0.3 s after you stop it repaints at full preview
  // quality. Nothing about the export changes.
  // Time-based rather than a flag, so a dropped timer can never leave the preview
  // stuck at draft quality: any repaint 320 ms after the last interaction is full.
  let lastDraft = 0, settleTimer = null;
  function scheduleDraft() {
    lastDraft = Date.now();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { lastDraft = 0; schedule(); }, 320);
    schedule();
  }
  function render() {
    // Si el collage está abierto, su previa tiene que responder a los mandos de
    // estilo: es lo que permite mover las piezas y tocar el estilo a la vez.
    // Va ANTES del corte de abajo a propósito — componiendo puede no haber aún
    // imagen en el lienzo principal, y la previa sí tiene qué pintar.
    if (window.KAOS_SURREAL && KAOS_SURREAL.refrescarPrevia) KAOS_SURREAL.refrescarPrevia();
    if (!state.img) return;
    if (prepPicking) renderSourcePreview();
    else if (state.mask.editMode) renderMaskPreview();
    else renderStyled();
    fitPaper();
    updateTextGizmo();
    updateDesignGizmo();
  }
  function renderMaskPreview() {
    const w = state.mask.w, h = state.mask.h;
    outCanvas.width = w; outCanvas.height = h;
    const ctx = outCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(state.img, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const m = state.mask.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      if (m[j] < 128) {
        d[i]     = (d[i]     * 0.25 + 220 * 0.75) | 0;
        d[i + 1] = (d[i + 1] * 0.25 + 30  * 0.75) | 0;
        d[i + 2] = (d[i + 2] * 0.25 + 40  * 0.75) | 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Lasso preview
    if (state.mask.lassoActive && state.mask.lassoPoints.length >= 4) {
      const p = state.mask.lassoPoints;
      ctx.save();
      ctx.strokeStyle = "#c9342a";
      ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) / 400));
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
      ctx.restore();
    }
  }
  // The on-screen preview runs the whole pipeline at HALF-ish resolution (fast, and
  // iOS keeps far less canvas memory alive); exports re-run it off-screen at full HD.
  const PREVIEW_LONG = 1100, DRAFT_LONG = 620, EXPORT_LONG = 1920;
  function srcDims(src) { return [src.naturalWidth || src.width, src.naturalHeight || src.height]; }
  function downscaleTo(src, maxLong) {
    const [sw, sh] = srcDims(src);
    const s = Math.min(1, maxLong / Math.max(sw, sh));
    if (s >= 1) return { canvas: src, scale: 1 };
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * s));
    c.height = Math.max(1, Math.round(sh * s));
    const cx = c.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, 0, c.width, c.height);
    return { canvas: c, scale: s };
  }
  // radii measured in pixels have to follow the resolution, or the half-size preview
  // would not look like the full-size export
  function scaledTweaks(t, s) {
    if (s >= 1) return t;
    const o = JSON.parse(JSON.stringify(t));
    if (o.threshold) {
      o.threshold.smooth = Math.round((o.threshold.smooth || 0) * s);
      o.threshold.windowSize = Math.max(3, Math.round((o.threshold.windowSize || 25) * s));
    }
    if (o.calco && o.calco.blur != null) o.calco.blur = Math.max(0, o.calco.blur * s);
    if (o.surrealist && o.surrealist.grain != null) o.surrealist.grain = o.surrealist.grain;
    return o;
  }
  // The style pass (threshold / calco / surrealist + wear) is the expensive part;
  // stamping the cursive text on top is nearly free. Caching the styled base means
  // typing, dragging, rotating or resizing the text repaints in a few ms instead of
  // re-running the whole pipeline on every keystroke.
  const baseCaches = [];   // keeps the draft AND the full-quality base alive
  function baseKey(maxLong) {
    return JSON.stringify([
      maxLong, state.style, state.tweaks[state.style],
      invertEnabled, state.mask.anyChanges, state.mask.rev || 0, state.mask.feather,
      distressEnabled, distressAmount, distressNoiseType, distressSeed, distressTarget,
      distressTexScale, distressEdge, distressScratch,
      state.shape, state.shapeXf, state.shapeOutline, state.shapeFill, state.designXf,
      state.img && state.img.width, state.img && state.img.height, srcToken,
    ]);
  }
  function wearRegion() {
    if (!distressTarget.startsWith("el:")) return null;
    const id = distressTarget.slice(3);
    const m = (state.elementMasks || []).find(x => x.id === id);
    return m ? m.canvas : null;
  }
  function buildBase(maxLong) {
    const key = baseKey(maxLong);
    const hit = baseCaches.find(e => e.key === key);
    if (hit) return hit.canvas;
    const full = state.mask.anyChanges ? KAOS.maskSource(state.img, state.mask.data, state.mask.feather) : state.img;
    const { canvas: workSrc, scale } = downscaleTo(full, maxLong);
    const t = scaledTweaks(state.tweaks, scale);
    let layer;
    if (state.style === "surrealist") layer = KAOS.styleSurrealist(workSrc, t.surrealist);
    else if (state.style === "calco") layer = KAOS.styleCalco(workSrc, t.calco);
    else layer = KAOS.styleThreshold(workSrc, t.threshold);
    if (invertEnabled) layer = invertCanvas(layer);
    if (distressEnabled && distressTarget !== "text") {
      layer = KAOS.distressLayer(layer, distressAmount, distressNoiseType, distressSeed, wearRegion(), wearOpts());
    }
    if (designMoved()) layer = transformDesignLayer(layer, state.designXf);
    if (state.shape !== "none") layer = KAOS.applyShape(layer, state.shape, 0.04, state.shapeXf, state.shapeOutline, state.shapeFill);
    baseCaches.unshift({ key, canvas: layer });
    while (baseCaches.length > 3) baseCaches.pop();
    return layer;
  }
  function designMoved() {
    const d = state.designXf;
    return Math.abs(d.x) > 0.01 || Math.abs(d.y) > 0.01 ||
      Math.abs((d.scale || 1) - 1) > 0.002 || Math.abs(d.rot || 0) > 0.01;
  }
  // Move / scale / rotate the artwork inside the same frame. Whatever leaves the
  // frame is cropped, and the vacated area stays transparent (paper shows through).
  function transformDesignLayer(src, xf) {
    const w = src.width, h = src.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.translate(w / 2 + (xf.x / 100) * w, h / 2 + (xf.y / 100) * h);
    ctx.rotate((xf.rot || 0) * Math.PI / 180);
    const s = xf.scale || 1;
    ctx.scale(s, s);
    ctx.drawImage(src, -w / 2, -h / 2);
    return c;
  }
  // Con qué se puede teñir una foto. Rojo es el que pidió; magenta y lima salen
  // del brand book (negro + un acento, y el lima es el color fijo de la firma).
  const TINTES = { rojo: "#c9342a", magenta: "#e0218a", lima: "#c6f000" };

  // Cambia el color de la tinta de UNA de las fotos del collage.
  //
  // Va aquí, y no en el collage, por un motivo: si la foto se tiñera ANTES, el
  // estilo estaría mirando una foto roja y decidiría otros umbrales — teñir le
  // cambiaría el dibujo, no sólo el color. Aquí la capa ya está hecha: se
  // recorta la tinta que cae dentro de esa foto y se le cambia el color
  // conservando el alfa, o sea el grosor y el grano del trazo.
  function teñirCapa(layer, masks) {
    const con = (masks || []).filter(m => m.tinte && TINTES[m.tinte] && m.canvas);
    if (!con.length) return layer;
    const w = layer.width, h = layer.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    ctx.drawImage(layer, 0, 0);
    for (const m of con) {
      const trozo = document.createElement("canvas");
      trozo.width = w; trozo.height = h;
      const tc = trozo.getContext("2d");
      tc.drawImage(layer, 0, 0);
      tc.globalCompositeOperation = "destination-in";   // sólo lo de esta foto
      tc.drawImage(m.canvas, 0, 0, w, h);
      tc.globalCompositeOperation = "source-in";        // mismo trazo, otro color
      tc.fillStyle = TINTES[m.tinte];
      tc.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "destination-out"; // fuera el negro de ahí
      ctx.drawImage(m.canvas, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(trozo, 0, 0);
      trozo.width = trozo.height = 1;
    }
    return out;
  }

  function buildLayer(maxLong) {
    const base = teñirCapa(buildBase(maxLong), state.elementMasks);
    if (!(textOverlay.enabled && textOverlay.text)) return base;
    let tl = KAOS.textLayer(base.width, base.height, textOverlay);
    if (distressEnabled && (distressTarget === "text" || distressTarget === "all")) {
      tl = KAOS.distressLayer(tl, distressAmount, distressNoiseType, (distressSeed + 977) | 0, null, wearOpts());
    }
    return KAOS.drawTextOverlay(base, { pre: tl, xor: textXor, text: textOverlay.text });
  }
  // SIN PAPEL: la tinta se queda sobre transparente, que es lo que en un montaje
  // se comporta como MULTIPLY — sin el rectangulo blanco detras del diseno.
  function sinPapel() { return !!(sinPapelChk && sinPapelChk.checked); }
  // El soporte de la previa pasa a damero: sobre el crema de siempre no se
  // notaria que el fondo blanco ya no esta y el modo pareceria no hacer nada.
  function aplicarSinPapel() {
    if (paperEl) paperEl.classList.toggle("sin-papel", sinPapel());
  }
  if (sinPapelChk) {
    sinPapelChk.addEventListener("change", () => {
      aplicarSinPapel();
      // Con el papel quitado, exportar sobre papel no tendria sentido: la
      // casilla de abajo se sincroniza sola para que las dos digan lo mismo.
      if (sinPapelChk.checked && transparentBgChk) transparentBgChk.checked = true;
      render();
    });
  }
  function renderStyled() {
    const layer = buildLayer((Date.now() - lastDraft < 340) ? DRAFT_LONG : PREVIEW_LONG);
    state.lastLayer = layer;
    const composed = sinPapel() ? layer : KAOS.composeOnPaper(layer, state.paper, state.tweaks.compose);
    outCanvas.width = composed.width;
    outCanvas.height = composed.height;
    const octx = outCanvas.getContext("2d");
    octx.clearRect(0, 0, outCanvas.width, outCanvas.height);
    octx.drawImage(composed, 0, 0);
  }
  // NEGATIVE: swap ink and emptiness. Whatever was inked becomes empty (the paper
  // shows through) and whatever was empty becomes ink — no white pixels involved,
  // so it still composites and exports as a transparent layer.
  function invertCanvas(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 10; d[i + 1] = 9; d[i + 2] = 8;
      d[i + 3] = 255 - d[i + 3];
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  function fitPaper() {
    const wrap = $("#canvasWrap");
    const rect = wrap.getBoundingClientRect();
    const aw = outCanvas.width, ah = outCanvas.height;
    if (!aw) return;
    // The preview swaps between draft (620px) and full (1100px) renders while you
    // drag sliders. Normalising to one nominal long side keeps BOTH fitting to the
    // same on-screen box, so the canvas no longer zooms in and out as you tweak.
    const k = PREVIEW_LONG / Math.max(aw, ah);
    const nw = aw * k, nh = ah * k;
    const scale = Math.min(rect.width / nw, rect.height / nh, 1);
    paperEl.style.width = (nw * scale) + "px";
    paperEl.style.height = (nh * scale) + "px";
    outCanvas.style.width = "100%";
    outCanvas.style.height = "100%";
  }
  window.addEventListener("resize", fitPaper);

  // ============== GALLERY MODAL ==============
  const galleryModal = $("#galleryModal");
  const galleryView = $("#galleryView");
  const composeView = $("#composeView");
  const galleryGrid = $("#galleryGrid");
  const gallerySubtitle = $("#gallerySubtitle");
  const composeBtn = $("#composeBtn");
  const selStatus = $("#selStatus");
  const backToGalleryBtn = $("#backToGalleryBtn");
  const galleryCloseBtn = $("#galleryCloseBtn");
  const galleryClearBtn = $("#galleryClearBtn");
  const galleryImportBtn = $("#galleryImportBtn");
  const galleryImportInput = $("#galleryImportInput");
  const composeCanvas = $("#composeCanvas");
  const shuffleBtn = $("#shuffleBtn");
  const exportCollageBtn = $("#exportCollageBtn");

  const composeState = {
    width: 1080, height: 1350,
    _layout: "tight",
    _userChoseLayout: false,
    get layout() { return this._layout; },
    set layout(v) {
      // Guard: only accept "manual" when the user explicitly clicked the
      // Manual button. Every other write silently keeps the previous mode.
      if (v === "manual" && !this._userChoseLayout) return;
      this._layout = v;
    },
    xorOverlap: false,
    paper: "#d4cbc0",
    bleed: 0.02,
    gap: 0.02,          // safety space between designs (fraction of min(W,H))
    // El fondo tiene tres modos, no un sí/no:
    //   papel      -> sólo el papel
    //   papelFoto  -> su foto mezclada con el papel (la regula «luz del fondo»)
    //   sticker    -> su foto a sangre y los diseños recortados como pegatinas
    // `bgPhoto` se sigue calculando a partir de esto, porque lo leen el pintado
    // y las hojas que ya tiene guardadas.
    bgMode: "papelFoto",
    bgImg: null,          // data: de la foto que elija ella
    bgPhoto: false,
    bgPhotoOpacity: 1,
    bgPhotoLight: 0.6,
    brandPrimary: (function(){ try { return localStorage.getItem("kaos.brand.primary") || "#ff3d5c"; } catch(e) { return "#ff3d5c"; } })(),
    brandSecondary: (function(){ try { return localStorage.getItem("kaos.brand.secondary") || "#d4ff2f"; } catch(e) { return "#d4ff2f"; } })(),
    // Marca: el título en magenta rojizo, el handle en verde lima. Son los dos
    // colores fijos del brand book, no una decisión de cada hoja.
    titleColor: "primary",
    handleColor: "secondary",
    footerColor: "black",
    stampColor: "black",
    watermarkColor: "gray",
    cornerColor: "black",
    logoColor: "gray",
    stickerWithFrame: false,
    pagePlacements: {},
    title: "DISEÑOS DISPONIBLES",
    handle: "DISEÑOS DISPONIBLES",
    footer: "Disponibles! Si os interesa alguno no dudeis en responderme a esta misma historia :)",
    footerTitle: "",
    footerSize: 1.0,
    footerPos: "bottom",
    titleFont: "helvExt",
    handleFont: "helvExt",
    stampFont: "gothic",
    stampText: "@KAOS.REALM",
    stamps: 3,
    stampSize: 1.0,
    stampOpacity: 0.80,
    shadow: 0.35,
    seed: 1,
    showSizes: true,
    cornerStyle: "ornament",
    selectedIds: [],   // gallery selection
    placements: [],    // {cx,cy,w,h,rot,scale,baseW,baseH} per item
    order: [],         // draw order indices
    sheetMode: false,  // "one sheet each" preview mode
    sheetTargets: [],  // items queued for individual export
    sheetIndex: 0,     // which target is currently previewed
    pairStart: 0,      // left sheet index shown in the two-up sheet preview
    pairActive: null,  // which pair canvas currently owns the selection
    selectedIndex: null,
  };

  // ----- gallery open/close/import/clear -----
  galleryBtn.addEventListener("click", openGallery);
  galleryCloseBtn.addEventListener("click", () => askSaveSheet(closeGallery));
  galleryClearBtn.addEventListener("click", () => {
    if (!confirm("Clear all gallery items?")) return;
    KAOS_GALLERY.clear();
    composeState.selectedIds = [];
    refreshGalleryCount();
    renderGalleryGrid();
  });
  galleryImportBtn.addEventListener("click", () => galleryImportInput.click());
  galleryImportInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    const added = [];
    for (const f of files) { const it = await importFile(f); if (it) added.push(it); }
    e.target.value = "";
    refreshGalleryCount();
    // If a sheet is open, the import lands ON that sheet — not just in the gallery.
    const inSheet = composeView && composeView.style.display !== "none";
    if (inSheet && added.length) {
      const ids = added.map(i => i.id);
      composeState.selectedIds = composeState.selectedIds.concat(ids);
      if (composeState.pageAssignment && composeState.pageAssignment.length) {
        const page = Math.min(composeState.pageIndex || 0, composeState.pageAssignment.length - 1);
        composeState.pageAssignment[page] = (composeState.pageAssignment[page] || []).concat(ids);
      }
      composeState.pagePlacements = {};
      composeState.selectedIndex = null;
      composeState.pairActive = null;
      composeDirty = true;
      await KAOS_GALLERY.measureInk(currentItems());
      resetPlacements();
      updatePageToolbar();
      if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
      else renderCompose();
      showToast(ids.length + (ids.length === 1 ? " diseño añadido a esta hoja" : " diseños añadidos a esta hoja"));
      return;
    }
    renderGalleryGrid();
  });
  function importFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        const item = KAOS_GALLERY.add(c, { style: "imported", paper: "#d9d4c8" });
        URL.revokeObjectURL(url);
        resolve(item);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // ============== SAVED PROJECTS (manual, never automatic) ==============
  // "GUARDAR" freezes the photo, the cut-out and every setting into this device so
  // you can come back days later and keep editing. Nothing is stored unless you
  // press it.
  const saveProjectBtn = $("#saveProjectBtn");
  const openProjectBtn = $("#openProjectBtn");
  let currentProjectId = null, currentProjectName = "";

  function canvasOf(src) {
    const c = document.createElement("canvas");
    c.width = src.naturalWidth || src.width;
    c.height = src.naturalHeight || src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }
  function projectSnapshot() {
    return {
      v: 1,
      src: canvasOf(state.img).toDataURL("image/png"),
      orig: (originalImg && originalImg !== state.img) ? canvasOf(originalImg).toDataURL("image/png") : null,
      mask: state.mask.data
        ? { w: state.mask.w, h: state.mask.h, any: state.mask.anyChanges, packed: KAOS_STORE.packMask(state.mask.data) }
        : null,
      style: state.style,
      tweaks: JSON.parse(JSON.stringify(state.tweaks)),
      paper: state.paper,
      shape: state.shape,
      shapeXf: JSON.parse(JSON.stringify(state.shapeXf)),
      designXf: JSON.parse(JSON.stringify(state.designXf)),
      shapeOutline: state.shapeOutline,
      shapeFill: state.shapeFill,
      invert: invertEnabled,
      distress: distressEnabled,
      distressAmount, distressNoiseType, distressSeed, distressTarget,
      distressTexScale, distressEdge, distressScratch,
      textOverlay: JSON.parse(JSON.stringify(textOverlay)),
      textXor,
      transparent: !!transparentBgChk.checked,
      sinPapel: sinPapel(),
      elementMasks: (state.elementMasks || []).map(m => ({ id: m.id, name: m.name, url: m.canvas.toDataURL("image/png") })),
      prepPts: JSON.parse(JSON.stringify(prepPts)),
    };
  }
  function projectThumb() {
    const t = document.createElement("canvas");
    const long = 260;
    const sc = Math.min(1, long / Math.max(outCanvas.width, outCanvas.height));
    t.width = Math.max(1, Math.round(outCanvas.width * sc));
    t.height = Math.max(1, Math.round(outCanvas.height * sc));
    const cx = t.getContext("2d");
    cx.fillStyle = state.paper; cx.fillRect(0, 0, t.width, t.height);
    cx.drawImage(outCanvas, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.72);
  }
  async function doSaveProject(name, asCopy) {
    saveProjectBtn.disabled = true;
    const old = saveProjectBtn.textContent;
    saveProjectBtn.textContent = "GUARDANDO…";
    try {
      const row = await KAOS_STORE.saveProject({
        id: asCopy ? null : currentProjectId,
        name, thumb: projectThumb(), data: projectSnapshot(),
      });
      currentProjectId = row.id; currentProjectName = row.name;
      showToast("Diseño guardado · " + row.name);
    } catch (e) {
      console.warn(e);
      showToast("No se pudo guardar: " + (e.message || e), 5000);
    }
    saveProjectBtn.textContent = old;
    saveProjectBtn.disabled = !state.img;
  }
  if (saveProjectBtn) saveProjectBtn.addEventListener("click", () => {
    pasarCollageAlLienzo();
    if (!state.img) return;
    const def = currentProjectName || ("Diseño " + new Date().toLocaleDateString() + " " + new Date().toTimeString().slice(0, 5));
    const back = dialog(`
      <div class="kd-title">Guardar este diseño</div>
      <div class="kd-body">Guarda la foto, el recorte y todos los ajustes en este dispositivo para seguir editando cuando quieras.</div>
      <input class="text-input kd-input" type="text" maxlength="60" value="${escapeAttr(def)}">
      <div class="kd-actions">
        <button class="icon-btn" data-act="cancel">CANCELAR</button>
        ${currentProjectId ? '<button class="icon-btn" data-act="copy">GUARDAR COPIA</button>' : ""}
        <button class="btn" data-act="save">GUARDAR</button>
      </div>`);
    const input = back.querySelector(".kd-input");
    input.focus(); input.select();
    back.addEventListener("click", (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      const name = input.value.trim() || def;
      back.remove();
      if (act === "save") doSaveProject(name, false);
      else if (act === "copy") doSaveProject(name, true);
    });
  });

  async function openProjectsDialog() {
    const list = await KAOS_STORE.listProjects();
    const rows = list.length ? list.map(p => `
      <div class="kd-row" data-id="${p.id}">
        <img class="kd-thumb" src="${p.thumb || ""}" alt="">
        <div class="kd-row-main">
          <div class="kd-row-name">${escapeAttr(p.name)}</div>
          <div class="kd-row-meta">${new Date(p.ts).toLocaleString()}</div>
        </div>
        <button class="icon-btn" data-act="open">ABRIR</button>
        <button class="icon-btn" data-act="del">✕</button>
      </div>`).join("") : '<div class="kd-body">Todavía no has guardado ningún diseño. Pulsa ◉ GUARDAR con un diseño abierto.</div>';
    const back = dialog(`
      <div class="kd-title">Mis diseños guardados</div>
      <div class="kd-list">${rows}</div>
      <div class="kd-actions"><button class="icon-btn" data-act="close">CERRAR</button></div>`);
    back.addEventListener("click", async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === "close") { back.remove(); return; }
      const row = e.target.closest(".kd-row");
      if (!row) return;
      if (act === "del") {
        await KAOS_STORE.deleteProject(row.dataset.id);
        if (currentProjectId === row.dataset.id) { currentProjectId = null; currentProjectName = ""; }
        back.remove(); openProjectsDialog(); return;
      }
      if (act === "open") { back.remove(); loadProject(row.dataset.id); }
    });
  }
  if (openProjectBtn) openProjectBtn.addEventListener("click", openProjectsDialog);

  function imgFromUrl(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("imagen dañada"));
      im.src = url;
    });
  }
  async function loadProject(id) {
    let row;
    try { row = await KAOS_STORE.getProject(id); } catch (e) { showToast("No se pudo abrir"); return; }
    if (!row || !row.data) { showToast("Ese diseño ya no está"); return; }
    const d = row.data;
    showToast("Abriendo " + row.name + "…", 2000);
    try {
      const im = await imgFromUrl(d.src);
      const c = canvasOf(im);
      state.img = c; srcToken++;
      originalImg = d.orig ? canvasOf(await imgFromUrl(d.orig)) : null;
      initMask(c.width, c.height);
      if (d.mask && d.mask.w === c.width && d.mask.h === c.height) {
        state.mask.data = KAOS_STORE.unpackMask(d.mask.packed, c.width * c.height);
        state.mask.anyChanges = !!d.mask.any;
        updateCoverage();
      }
      state.elementMasks = [];
      for (const m of (d.elementMasks || [])) {
        try { state.elementMasks.push({ id: m.id, name: m.name, canvas: canvasOf(await imgFromUrl(m.url)) }); } catch (e) {}
      }
      Object.assign(prepPts, d.prepPts || { black: null, mid: null, white: null });
      distressSeed = d.distressSeed || 4242;
      clearHistory();
      state.mask.editMode = false; setMaskEditUI(false);
      prepSection.style.display = "";
      dimsLabel.textContent = c.width + " × " + c.height;
      empty.style.display = "none";
      paperEl.style.display = "";
      downloadBtn.disabled = false;
      saveProjectBtn.disabled = false;
      if (duplicateResultBtn) duplicateResultBtn.disabled = false;
      transparentBgChk.checked = !!d.transparent;
      if (sinPapelChk) { sinPapelChk.checked = !!d.sinPapel; aplicarSinPapel(); }
      renderDistressTargets();
      syncPrepPicks();
      applyStyleSnap({
        style: d.style, tweaks: d.tweaks, paper: d.paper,
        shape: d.shape, shapeXf: d.shapeXf, shapeOutline: d.shapeOutline, shapeFill: d.shapeFill, designXf: d.designXf,
        invert: d.invert, distress: d.distress, distressAmount: d.distressAmount,
        distressNoiseType: d.distressNoiseType, distressTarget: d.distressTarget,
        textOverlay: d.textOverlay, textXor: d.textXor,
      });
      currentProjectId = row.id; currentProjectName = row.name;
      showToast("Listo · " + row.name);
    } catch (e) {
      console.warn(e);
      showToast("No se pudo abrir ese diseño");
    }
  }

  // ============== SAVED SHEETS + BACKUP ==============
  // Nothing is ever written automatically: leaving the composer ASKS first.
  let composeDirty = false;
  let currentSessionId = null;
  let currentSessionName = "";
  const SESSION_SKIP = new Set(["pairActive", "sheetTargets", "selectedIndex", "sheetMode", "sheetIndex", "_inkPending"]);
  function sheetSessionData() {
    const o = {};
    for (const k in composeState) {
      if (SESSION_SKIP.has(k)) continue;
      const v = composeState[k];
      if (typeof v === "function" || (v && v.nodeType)) continue;
      try { JSON.stringify(v); o[k] = v; } catch (e) {}
    }
    return JSON.parse(JSON.stringify(o));
  }
  function dialog(html) {
    const back = document.createElement("div");
    back.className = "kaos-dialog-back";
    back.innerHTML = '<div class="kaos-dialog">' + html + "</div>";
    document.body.appendChild(back);
    return back;
  }
  function askSaveSheet(next) {
    if (!composeDirty || !composeView || composeView.style.display === "none") { next(); return; }
    const def = currentSessionName || ("Hoja " + new Date().toLocaleDateString() + " " +
      new Date().toTimeString().slice(0, 5));
    const back = dialog(`
      <div class="kd-title">¿Guardar esta hoja?</div>
      <div class="kd-body">Se guarda la distribución, tamaños y textos para retomarla luego.</div>
      <input class="text-input kd-input" type="text" maxlength="40" value="${def.replace(/"/g, "")}">
      <div class="kd-actions">
        <button class="icon-btn" data-act="cancel">CANCELAR</button>
        <button class="icon-btn" data-act="discard">SALIR SIN GUARDAR</button>
        <button class="btn" data-act="save">GUARDAR Y SALIR</button>
      </div>`);
    const input = back.querySelector(".kd-input");
    input.focus(); input.select();
    back.addEventListener("click", (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === "cancel") { back.remove(); return; }
      if (act === "save") {
        const s = KAOS_STORE.saveSession(input.value.trim() || def, sheetSessionData(), currentSessionId);
        currentSessionId = s.id; currentSessionName = s.name;
        showToast("Hoja guardada · " + s.name);
      }
      composeDirty = false;
      back.remove();
      next();
    });
  }
  backToGalleryBtn.addEventListener("click", () => askSaveSheet(() => {
    composeView.style.display = "none";
    galleryView.style.display = "";
    syncBotonAnadir();
    renderGalleryGrid();
  }));
  // Lo que ocupan las hojas guardadas, en KB.
  function pesoHojasKB() {
    try { return Math.round(JSON.stringify(KAOS_STORE.sessions()).length / 1024); }
    catch (e) { return 0; }
  }

  // Vuelve a comprimir la foto de fondo de las hojas YA guardadas.
  //
  // encogerFondo() arregla las nuevas, pero las de antes siguen con la foto en
  // crudo: dos hojas suyas ocupaban 965 y 274 KB, y de eso la colocación de los
  // diseños era 1 KB. Todo lo demás era la foto sin encoger.
  //
  // No borra ninguna hoja ni toca los diseños: sólo cambia esa foto por la
  // misma más pequeña.
  async function compactarHojas() {
    const antes = pesoHojasKB();
    let tocadas = 0;
    for (const s of KAOS_STORE.sessions()) {
      const d = s.data;
      if (!d || !d.bgImg || d.bgImg.length < 120000) continue;
      const flaca = await encogerFondo(d.bgImg);
      // Sólo se cambia si el ahorro es de verdad. Si no, pulsar el botón dos
      // veces iría recomprimiendo lo ya comprimido y perdiendo calidad a cambio
      // de nada.
      if (!flaca || flaca.length >= d.bgImg.length * 0.9) continue;
      d.bgImg = flaca;
      KAOS_STORE.saveSession(s.name, d, s.id);
      tocadas++;
    }
    return { tocadas: tocadas, antes: antes, despues: pesoHojasKB() };
  }

  const sessionsBtn = $("#sessionsBtn");
  if (sessionsBtn) sessionsBtn.addEventListener("click", openSessionsDialog);
  // La misma puerta, pero a la vista: 37 de las 102 aperturas de la galeria eran
  // solo para llegar hasta aqui.
  const sheetsTopBtn = $("#sheetsTopBtn");
  if (sheetsTopBtn) sheetsTopBtn.addEventListener("click", openSessionsDialog);
  function openSessionsDialog() {
    const list = KAOS_STORE.sessions();
    const rows = list.length ? list.map(s => `
      <div class="kd-row" data-id="${s.id}">
        <div class="kd-row-main">
          <div class="kd-row-name">${s.name}</div>
          <div class="kd-row-meta">${new Date(s.ts).toLocaleString()} · ${(s.data && s.data.selectedIds ? s.data.selectedIds.length : 0)} diseños</div>
        </div>
        <button class="icon-btn" data-act="open">ABRIR</button>
        <button class="icon-btn" data-act="del">✕</button>
      </div>`).join("") : '<div class="kd-body">Aún no has guardado ninguna hoja.</div>';
    const kb = pesoHojasKB();
    const back = dialog(`
      <div class="kd-title">Hojas guardadas</div>
      <div class="kd-list">${rows}</div>
      <div class="kd-body">Ocupan ${kb} KB. El navegador da unos 5000 KB para todo (galería incluida).</div>
      <div class="kd-actions">
        <button class="icon-btn" data-act="compactar">ALIGERAR FOTOS DE FONDO</button>
        <button class="icon-btn" data-act="close">CERRAR</button>
      </div>`);
    back.addEventListener("click", (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      if (act === "close") { back.remove(); return; }
      if (act === "compactar") {
        e.target.disabled = true;
        e.target.textContent = "ALIGERANDO…";
        compactarHojas().then((r) => {
          back.remove();
          showToast(r.tocadas
            ? "Aligeradas " + r.tocadas + " hojas · " + r.antes + " KB → " + r.despues + " KB"
            : "Nada que aligerar: las fotos ya están al tamaño bueno.", 7000);
        });
        return;
      }
      const row = e.target.closest(".kd-row");
      if (!row) return;
      if (act === "del") {
        const b = e.target;
        if (b.dataset.seguro !== "1") {          // primer toque solo pregunta
          b.dataset.seguro = "1";
          b.textContent = "¿BORRAR?";
          b.classList.add("peligro");
          setTimeout(() => {
            if (!b.isConnected) return;
            b.dataset.seguro = "0"; b.textContent = "✕"; b.classList.remove("peligro");
          }, 4000);
          return;
        }
        KAOS_STORE.deleteSession(row.dataset.id); back.remove(); openSessionsDialog(); return;
      }
      if (act === "open") { back.remove(); openSession(row.dataset.id); }
    });
  }
  function openSession(id) {
    const s = KAOS_STORE.getSession(id);
    if (!s || !s.data) return;
    const have = new Set(KAOS_GALLERY.load().map(i => i.id));
    Object.assign(composeState, s.data);
    composeState.selectedIds = (composeState.selectedIds || []).filter(x => have.has(x));
    composeState.pageAssignment = (composeState.pageAssignment || []).map(g => g.filter(x => have.has(x))).filter(g => g.length);
    composeState.selectedIndex = null;
    composeState.pairActive = null;
    composeState.sheetMode = false;
    if (composeState.selectedIds.length < 3) { showToast("Esa hoja ya no tiene suficientes diseños en la galería"); return; }
    currentSessionId = s.id; currentSessionName = s.name;
    composeDirty = false;
    galleryModal.style.display = "";
    galleryView.style.display = "none";
    composeView.style.display = "";
    syncBotonAnadir();
    if (!composeState.pageAssignment.length) ensurePageAssignment();
    composeState.pageIndex = Math.min(composeState.pageIndex || 0, composeState.pageAssignment.length - 1);
    syncLayoutUI();
    updatePageToolbar();
    renderFontPickers();
    syncControls();
    // Restore the exact arrangement the user saved. Only rebuild from scratch
    // when neither the main placements nor the per-page cache made it in —
    // otherwise we'd overwrite the positions, sizes and rotations they set.
    const hasMain = Array.isArray(composeState.placements) && composeState.placements.length;
    const hasPages = Object.keys(composeState.pagePlacements || {}).length;
    if (!hasMain && !hasPages) resetPlacements();
    renderCompose();
    showToast("Hoja recuperada · " + s.name);
  }
  const backupExportBtn = $("#backupExportBtn");
  const backupImportBtn = $("#backupImportBtn");
  const backupImportInput = $("#backupImportInput");
  if (backupExportBtn) backupExportBtn.addEventListener("click", async () => {
    backupExportBtn.disabled = true;
    try {
      const how = await KAOS_STORE.exportBackup();
      if (how !== "cancel") showToast("Backup creado · guárdalo en iCloud/Drive y restaura en el otro dispositivo", 5000);
    } catch (e) { showToast("No se pudo crear el backup"); }
    backupExportBtn.disabled = false;
  });
  if (backupImportBtn) backupImportBtn.addEventListener("click", () => backupImportInput.click());
  if (backupImportInput) backupImportInput.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const r = await KAOS_STORE.importBackup(f);
      refreshGalleryCount();
      renderGalleryGrid();
      document.dispatchEvent(new CustomEvent("kaos-assets-changed"));
      showToast(`Restaurado · ${r.incoming} diseños (${r.total} en total) · ${r.sheets} hojas · ${r.assets || 0} assets`, 5000);
    } catch (err) { showToast("Backup no válido: " + (err && err.message ? err.message : err)); }
  });
  window.addEventListener("beforeunload", (e) => {
    if (!composeDirty || !composeView || composeView.style.display === "none") return;
    e.preventDefault();
    e.returnValue = "";
  });
  function openGallery() {
    galleryModal.style.display = "";
    galleryView.style.display = "";
    syncBotonAnadir();
    composeView.style.display = "none";
    renderGalleryGrid();
  }
  function closeGallery() { galleryModal.style.display = "none"; }

  let galleryFilter = "ALL"; // "ALL" or a folder name
  const galleryFolders = $("#galleryFolders");
  function renderFolderTabs(allItems) {
    if (!galleryFolders) return;
    galleryFolders.innerHTML = "";
    const folders = KAOS_GALLERY.listFolders();
    const counts = {};
    let untagged = 0;
    for (const it of allItems) {
      const s = (it.style || "").trim();
      if (!s) untagged++;
      else counts[s] = (counts[s] || 0) + 1;
    }
    const makeTab = (label, key, count) => {
      const b = document.createElement("button");
      b.className = "folder-tab" + (galleryFilter === key ? " active" : "");
      b.dataset.folder = key;
      b.innerHTML = `<span>${label}</span><span class="count">${count}</span>`;
      b.addEventListener("click", () => { galleryFilter = key; renderGalleryGrid(); });
      b.addEventListener("contextmenu", (e) => {
        if (key === "ALL" || key === "__UNTAGGED__") return;
        e.preventDefault();
        const nxt = prompt("Rename folder (empty = delete, keeps items untagged):", label);
        if (nxt == null) return;
        const clean = nxt.trim();
        if (!clean) {
          if (confirm(`Delete folder "${label}"?\nIts designs become untagged.`)) {
            KAOS_GALLERY.removeFolder(key, "");
            if (galleryFilter === key) galleryFilter = "ALL";
            renderGalleryGrid();
          }
        } else if (clean !== label) {
          KAOS_GALLERY.renameFolder(key, clean);
          if (galleryFilter === key) galleryFilter = clean;
          renderGalleryGrid();
        }
      });
      galleryFolders.appendChild(b);
    };
    makeTab("ALL", "ALL", allItems.length);
    for (const f of folders) makeTab(f.toUpperCase(), f, counts[f] || 0);
    if (untagged > 0) makeTab("UNTAGGED", "__UNTAGGED__", untagged);
    const addBtn = document.createElement("button");
    addBtn.className = "folder-tab";
    addBtn.innerHTML = "<span>+ NEW FOLDER</span>";
    addBtn.addEventListener("click", () => {
      const name = prompt("Folder name:");
      if (!name) return;
      const clean = name.trim();
      if (!clean) return;
      KAOS_GALLERY.addFolder(clean);
      galleryFilter = clean;
      renderGalleryGrid();
    });
    galleryFolders.appendChild(addBtn);

    // Atajos de flash day / permanentes: un toque y quedan seleccionados todos
    // los que llevan esa etiqueta, listos para pasar al editor de posts. Van
    // aquí y no en el pie porque es donde ya mira para filtrar.
    const sep = document.createElement("span");
    sep.className = "folder-sep";
    galleryFolders.appendChild(sep);
    for (const tag of KAOS_GALLERY.ETIQUETAS) {
      const n = allItems.filter(it => KAOS_GALLERY.tieneTag(it, tag)).length;
      const b = document.createElement("button");
      b.className = "folder-tab tag-tab";
      b.textContent = tag + (n ? " · " + n : "");
      b.disabled = !n;
      b.title = "Seleccionar los " + n + " diseños con la etiqueta " + tag;
      b.addEventListener("click", () => {
        const ids = KAOS_GALLERY.conTag(tag).map(it => it.id);
        if (!ids.length) return;
        // Reemplaza la selección: es lo que quiere un flash day, empezar limpia.
        composeState.selectedIds = ids;
        renderGalleryGrid();
        showToast(ids.length + " diseños de " + tag + " seleccionados");
      });
      galleryFolders.appendChild(b);
    }
  }
  function openMoveMenu(anchor, itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (!ids.length) return;
    const existing = document.querySelector(".move-menu");
    if (existing) existing.remove();
    const menu = document.createElement("div");
    menu.className = "move-menu";
    if (ids.length > 1) {
      const hdr = document.createElement("div");
      hdr.className = "move-menu-header";
      hdr.textContent = `MOVE ${ids.length} DESIGNS TO…`;
      menu.appendChild(hdr);
    }
    const folders = KAOS_GALLERY.listFolders();
    const opts = ["", ...folders, "__NEW__"];
    for (const f of opts) {
      const row = document.createElement("button");
      row.className = "move-menu-item";
      row.textContent = f === "__NEW__" ? "+ NEW FOLDER…" : (f || "· UNTAGGED");
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        let target = f;
        if (f === "__NEW__") {
          const name = prompt("New folder name:");
          if (!name) { menu.remove(); return; }
          target = name.trim();
          if (!target) { menu.remove(); return; }
          KAOS_GALLERY.addFolder(target);
        }
        for (const id of ids) KAOS_GALLERY.setItemFolder(id, target);
        composeState.selectedIds = [];
        menu.remove();
        renderGalleryGrid();
        showToast(`Moved ${ids.length} design${ids.length === 1 ? "" : "s"} to ${target || "UNTAGGED"}`);
      });
      menu.appendChild(row);
    }
    const r = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = (r.bottom + 4) + "px";
    menu.style.left = Math.max(6, Math.min(window.innerWidth - 200, r.left)) + "px";
    document.body.appendChild(menu);
    const close = (e) => {
      if (menu.contains(e.target)) return;
      menu.remove();
      document.removeEventListener("mousedown", close, true);
    };
    setTimeout(() => document.addEventListener("mousedown", close, true), 0);
  }
  function renderGalleryGrid() {
    const allItems = KAOS_GALLERY.load();
    renderFolderTabs(allItems);
    let items = allItems;
    if (galleryFilter === "__UNTAGGED__") items = allItems.filter(it => !(it.style || "").trim());
    else if (galleryFilter !== "ALL") items = allItems.filter(it => (it.style || "").trim() === galleryFilter);
    galleryGrid.innerHTML = "";
    if (allItems.length === 0) {
      galleryView.classList.add("empty");
      gallerySubtitle.textContent = "EMPTY · EXPORT TO ADD";
    } else {
      galleryView.classList.remove("empty");
      const label = galleryFilter === "ALL" ? "" : ` · ${galleryFilter.toUpperCase()}`;
      gallerySubtitle.textContent = items.length + " item" + (items.length === 1 ? "" : "s") + label;
    }
    for (const it of items) {
      const card = document.createElement("div");
      card.className = "gallery-card";
      card.dataset.id = it.id;
      const idx = composeState.selectedIds.indexOf(it.id);
      if (idx >= 0) card.classList.add("selected");
      card.innerHTML = `
        <img src="${it.layerUrl}" alt="">
        <div class="check">${idx >= 0 ? "✓" : ""}</div>
        <div class="sel-order">${idx >= 0 ? idx + 1 : ""}</div>
        <button class="del" title="Delete">✕</button>
        <button class="move" title="Move to folder">▾</button>
        <div class="cm-tag" title="Approx. max tattoo size in cm">
          <input class="cm-input" type="number" min="0" max="200" step="1" value="${it.sizeCm != null ? it.sizeCm : 10}">
          <span class="cm-unit">cm</span>
        </div>
        <div class="tag-chips">
          ${KAOS_GALLERY.ETIQUETAS.map(t =>
            `<button class="tag-chip${KAOS_GALLERY.tieneTag(it, t) ? " on" : ""}" data-tag="${t}" title="Marcar como ${t}">${t}</button>`
          ).join("")}
        </div>
        <div class="meta">
          <span>${(it.style || "· SIN CARPETA").toUpperCase()}</span>
          <span>${formatDate(it.ts)}</span>
        </div>
      `;
      card.addEventListener("click", (e) => {
        if (e.target.closest(".cm-tag")) return;
        // El chip marca/desmarca la etiqueta; no debe seleccionar el diseño.
        const chip = e.target.closest(".tag-chip");
        if (chip) {
          e.stopPropagation();
          KAOS_GALLERY.toggleTag(it.id, chip.dataset.tag);
          renderGalleryGrid();
          return;
        }
        if (e.target.classList.contains("move")) {
          e.stopPropagation();
          openMoveMenu(e.target, [it.id]);
          return;
        }
        if (e.target.classList.contains("del")) {
          KAOS_GALLERY.remove(it.id);
          composeState.selectedIds = composeState.selectedIds.filter(x => x !== it.id);
          refreshGalleryCount();
          renderGalleryGrid();
          return;
        }
        toggleSelect(it.id);
      });
      const cmInput = card.querySelector(".cm-input");
      if (cmInput) {
        cmInput.addEventListener("pointerdown", (e) => e.stopPropagation());
        cmInput.addEventListener("click", (e) => e.stopPropagation());
        cmInput.addEventListener("change", (e) => {
          const v = KAOS_GALLERY.setSize(it.id, e.target.value);
          if (v != null) e.target.value = v;
        });
      }
      galleryGrid.appendChild(card);
    }
    updateComposeButton();
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function toggleSelect(id) {
    const idx = composeState.selectedIds.indexOf(id);
    if (idx >= 0) composeState.selectedIds.splice(idx, 1);
    else composeState.selectedIds.push(id);
    renderGalleryGrid();
  }
  function updateComposeButton() {
    const n = composeState.selectedIds.length;
    if (n < 3) { composeBtn.disabled = true; selStatus.textContent = `ELIGE 3 O MÁS (LLEVAS ${n})`; }
    else {
      composeBtn.disabled = false;
      const pages = pageBounds(n).length;
      selStatus.textContent = pages > 1 ? `${n} ELEGIDOS · ${pages} HOJAS · LISTO` : `${n} ELEGIDOS · LISTO`;
    }
    const moveBtn = document.getElementById("moveSelectedBtn");
    if (moveBtn) {
      moveBtn.disabled = n < 1;
      moveBtn.textContent = n < 1 ? "MOVE TO FOLDER…" : `MOVE ${n} TO FOLDER…`;
    }
  }
  const selectAllBtn = $("#selectAllBtn");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const all = KAOS_GALLERY.load();
      if (!all.length) return;
      // Scope Select All to whatever the current folder filter shows.
      const visible = galleryFilter === "ALL" ? all
        : galleryFilter === "__UNTAGGED__" ? all.filter(it => !(it.style || "").trim())
        : all.filter(it => (it.style || "").trim() === galleryFilter);
      const allSelected = visible.length > 0 && visible.every(it => composeState.selectedIds.includes(it.id));
      if (allSelected) {
        const visIds = new Set(visible.map(it => it.id));
        composeState.selectedIds = composeState.selectedIds.filter(id => !visIds.has(id));
      } else {
        const set = new Set(composeState.selectedIds);
        for (const it of visible) set.add(it.id);
        composeState.selectedIds = Array.from(set);
      }
      renderGalleryGrid();
      refreshGalleryCount();
    });
  }
  const moveSelectedBtn = $("#moveSelectedBtn");
  if (moveSelectedBtn) {
    moveSelectedBtn.addEventListener("click", () => {
      if (!composeState.selectedIds.length) return;
      openMoveMenu(moveSelectedBtn, composeState.selectedIds.slice());
    });
  }
  composeBtn.addEventListener("click", () => {
    if (composeState.selectedIds.length < 3) return;
    galleryView.style.display = "none";
    composeView.style.display = "";
    composeState.selectedIndex = null;
    composeState.layout = "tight";
    composeState.pageIndex = 0;
    composeState.pairStart = 0;
    currentSessionId = null;
    currentSessionName = "";
    composeDirty = false;
    ensurePageAssignment();
    if (composeState.sheetMode) exitSheetMode();
    syncLayoutUI();
    updatePageToolbar();
    resetPlacements();
    renderFontPickers();
    syncControls();
    renderCompose();
  });
  // Cuántos diseños caben en una hoja. Ella lo quiere en 5: a partir del sexto
  // el reparto salta a dos hojas. Estaba en 8, y el rótulo de la galería decía 5,
  // así que anunciaba dos hojas y luego apretaba los ocho en una.
  const PAGE_SIZE = 5;
  // Balanced chunking: ceil(n/PAGE_SIZE) pages, remainder spread across the first pages.
  function pageBounds(n) {
    const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
    const base = Math.floor(n / pages), rem = n % pages;
    const bounds = []; let start = 0;
    for (let i = 0; i < pages; i++) { const size = base + (i < rem ? 1 : 0); bounds.push([start, start + size]); start += size; }
    return bounds;
  }
  function pageCount() { return composeState.pageAssignment ? composeState.pageAssignment.length : pageBounds(composeState.selectedIds.length).length; }
  // Auto-assign selected ids into balanced pages of up to 8 each. Called once per
  // compose-session open; after that the user's manual drag assignment (which
  // decides which design lands on which sheet) is authoritative.
  function ensurePageAssignment() {
    const bounds = pageBounds(composeState.selectedIds.length);
    composeState.pageAssignment = bounds.map(([s, e]) => composeState.selectedIds.slice(s, e));
  }
  function updatePageToolbar() {
    if (!sheetPair) return;
    if (composeState.sheetMode) { hidePair(); return; }
    const pages = pageCount();
    if (pages <= 1) { hidePair(); return; }
    showPair();
  }
  const sheetPair = $("#sheetPair");
  const sheetCanvasL = $("#sheetCanvasL");
  const sheetCanvasR = $("#sheetCanvasR");
  const sheetPairToolbar = $("#sheetPairToolbar");
  const sheetPairLabel = $("#sheetPairLabel");
  const pairPrevBtn = $("#pairPrevBtn");
  const pairNextBtn = $("#pairNextBtn");
  function hidePair() {
    if (sheetPair) sheetPair.style.display = "none";
    if (sheetPairToolbar) sheetPairToolbar.style.display = "none";
    composeCanvas.style.display = "";
  }
  function showPair() {
    composeCanvas.style.display = "none";
    sheetPair.style.display = "";
    const pages = pageCount();
    if (composeState.pairStart >= pages) composeState.pairStart = Math.max(0, pages - 2);
    sheetPairToolbar.style.display = pages > 2 ? "" : "none";
    renderSheetPair();
  }
  function pageKey(ids) { return ids.join("|"); }
  // iPad/iOS blanks canvases out once total canvas memory gets large: preview at a
  // capped resolution, and render every export off-screen at full size.
  const PREVIEW_MAX = 1400;
  function previewScale() { return Math.min(1, PREVIEW_MAX / Math.max(composeState.width, composeState.height)); }
  function sheetRenderOpts(rec, selectedIndex, renderScale) {
    return {
      xorOverlap: composeState.xorOverlap,
      renderScale: renderScale || 1,
      paper: composeState.paper, bleed: composeState.bleed,
      bgPhoto: composeState.bgPhoto, bgPhotoOpacity: composeState.bgPhotoOpacity, bgPhotoLight: composeState.bgPhotoLight,
      placements: rec.placements, order: rec.order, layout: rec.layout,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
      footerTitle: composeState.footerTitle, footerSize: composeState.footerSize, footerPos: composeState.footerPos,
      titleFont: composeState.titleFont, handleFont: composeState.handleFont,
      stampFont: composeState.stampFont, stampText: composeState.stampText, stamps: composeState.stamps,
      stampSize: composeState.stampSize, stampOpacity: composeState.stampOpacity,
      shadow: composeState.shadow, seed: composeState.seed, showSizes: composeState.showSizes,
      cornerStyle: composeState.cornerStyle,
      brandPrimary: composeState.brandPrimary,
      brandSecondary: composeState.brandSecondary,
      titleColor: composeState.titleColor,
      handleColor: composeState.handleColor,
      footerColor: composeState.footerColor,
      stampColor: composeState.stampColor,
      watermarkColor: composeState.watermarkColor,
      cornerColor: composeState.cornerColor,
      logoColor: composeState.logoColor,
      selectedIndex: selectedIndex,
    };
  }
  function placementsFor(items, ids) {
    const key = pageKey(ids);
    const cached = composeState.pagePlacements[key];
    if (cached && cached.placements.length === items.length && cached.w === composeState.width
        && cached.h === composeState.height && cached.bleed === composeState.bleed && cached.gap === composeState.gap) return cached;
    const placements = KAOS_GALLERY.computeDefaultPlacements(items, {
      width: composeState.width, height: composeState.height, bleed: composeState.bleed, layout: "tight", gap: composeState.gap,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
      footerTitle: composeState.footerTitle, footerSize: composeState.footerSize, footerPos: composeState.footerPos,
      seed: composeState.seed,
    });
    const rec = { placements, order: items.map((_, k) => k), w: composeState.width, h: composeState.height, bleed: composeState.bleed, gap: composeState.gap, layout: "tight" };
    composeState.pagePlacements[key] = rec;
    return rec;
  }
  async function paintSheetCanvas(canvas, pageIdx) {
    const all = KAOS_GALLERY.load();
    const ids = composeState.pageAssignment[pageIdx] || [];
    const items = ids.map(id => all.find(x => x.id === id)).filter(Boolean);
    canvas._pageIdx = pageIdx;
    canvas._items = items;
    canvas._key = pageKey(ids);
    const rs = previewScale();
    const pw = Math.round(composeState.width * rs), ph = Math.round(composeState.height * rs);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas._rscale = rs;
    if (!items.length) {
      const c0 = canvas.getContext("2d");
      c0.setTransform(1, 0, 0, 1, 0, 0);
      c0.clearRect(0, 0, canvas.width, canvas.height);
      canvas._placements = []; canvas._order = [];
      return;
    }
    if (!KAOS_GALLERY.inkMeasured(items)) await KAOS_GALLERY.measureInk(items);
    const rec = placementsFor(items, ids);
    canvas._placements = rec.placements; canvas._order = rec.order;
    await pintarHoja(canvas, items, sheetRenderOpts(rec, (composeState.pairActive === canvas) ? composeState.selectedIndex : null, rs), rec);
  }
  // repaint just one pair canvas (used while dragging/rotating an element on it)
  let pairRAF = null;
  function repaintPair(canvas) {
    if (pairRAF) cancelAnimationFrame(pairRAF);
    pairRAF = requestAnimationFrame(() => { pairRAF = null; paintSheetCanvas(canvas, canvas._pageIdx); });
  }
  function updatePairActiveHighlight() {
    const active = composeState.pageIndex || 0;
    sheetCanvasL.classList.toggle("active", sheetCanvasL._pageIdx === active);
    sheetCanvasR.classList.toggle("active", sheetCanvasR._pageIdx === active);
  }
  async function renderSheetPair() {
    const pages = pageCount();
    if (sheetPairLabel) sheetPairLabel.textContent = pages > 2
      ? `SHEETS ${composeState.pairStart + 1}-${Math.min(composeState.pairStart + 2, pages)} / ${pages}`
      : `SHEETS 1-${pages}`;
    await paintSheetCanvas(sheetCanvasL, composeState.pairStart);
    if (composeState.pairStart + 1 < pages) {
      sheetCanvasR.parentElement.style.display = "";
      await paintSheetCanvas(sheetCanvasR, composeState.pairStart + 1);
    } else {
      sheetCanvasR.parentElement.style.display = "none";
      if (composeState.pairActive === sheetCanvasR) { composeState.pairActive = null; composeState.selectedIndex = null; updateItemPanel(); }
    }
    updatePairActiveHighlight();
  }
  if (pairPrevBtn) pairPrevBtn.addEventListener("click", () => {
    composeState.pairStart = Math.max(0, composeState.pairStart - 2);
    clearPairSelection();
    renderSheetPair();
  });
  if (pairNextBtn) pairNextBtn.addEventListener("click", () => {
    const pages = pageCount();
    composeState.pairStart = Math.min(Math.max(0, pages - 2), composeState.pairStart + 2);
    clearPairSelection();
    renderSheetPair();
  });
  function clearPairSelection() {
    composeState.pairActive = null;
    composeState.selectedIndex = null;
    updateItemPanel();
  }
  // ----- select / move / rotate elements on the two full-size sheet previews,
  // and drag an element across to the other sheet to reassign it -----
  function sheetXY(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const rs = canvas._rscale || 1;
    return [(clientX - rect.left) * (canvas.width / rect.width) / rs, (clientY - rect.top) * (canvas.height / rect.height) / rs];
  }
  function sheetHitTest(canvas, mx, my) {
    const order = canvas._order || [], placements = canvas._placements || [];
    for (let i = order.length - 1; i >= 0; i--) {
      const idx = order[i]; const p = placements[idx];
      if (!p) continue;
      const cos = Math.cos(-(p.rot || 0) * Math.PI / 180), sin = Math.sin(-(p.rot || 0) * Math.PI / 180);
      const dx = mx - p.cx, dy = my - p.cy;
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2) return idx;
    }
    return -1;
  }
  function nearestInsertIndex(canvas, mx) {
    const items = canvas._items || [], placements = canvas._placements || [];
    for (let i = 0; i < items.length; i++) { const p = placements[i]; if (p && mx < p.cx) return i; }
    return items.length;
  }
  function nearestItemIndex(canvas, mx, my) {
    const placements = canvas._placements || [];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]; if (!p) continue;
      const d = Math.hypot(mx - p.cx, my - p.cy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  function pointCanvasAt(clientX, clientY) {
    for (const cv of [sheetCanvasL, sheetCanvasR]) {
      if (cv.parentElement.style.display === "none") continue;
      const r = cv.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return cv;
    }
    return null;
  }
  const sheetDrag = { active: false, id: null, idx: -1, canvas: null, fromPage: -1, ghost: null, moved: false, startX: 0, startY: 0, offX: 0, offY: 0 };
  function startSheetDrag(cv, e) {
    const [mx, my] = sheetXY(cv, e.clientX, e.clientY);
    const idx = sheetHitTest(cv, mx, my);
    composeState.pageIndex = cv._pageIdx;
    updatePairActiveHighlight();
    if (idx < 0) { clearPairSelection(); repaintPair(cv); return; }
    const it = cv._items[idx];
    if (!it) return;
    const p = cv._placements[idx];
    // select it: item panel + gizmo now target this sheet
    composeState.pairActive = cv;
    composeState.selectedIndex = idx;
    cv._order = (cv._order || []).filter(x => x !== idx).concat([idx]);
    const rec = composeState.pagePlacements[cv._key];
    if (rec) rec.order = cv._order;
    updateItemPanel();
    repaintPair(cv);
    pushComposeUndo();   // pre-drag state, so ⌘Z puts the design back
    sheetDrag.active = true; sheetDrag.id = it.id; sheetDrag.idx = idx; sheetDrag.canvas = cv;
    sheetDrag.fromPage = cv._pageIdx; sheetDrag.moved = false;
    sheetDrag.startX = e.clientX; sheetDrag.startY = e.clientY;
    sheetDrag.offX = mx - p.cx; sheetDrag.offY = my - p.cy;
    sheetDrag.thumbUrl = it.layerUrl;
  }
  function moveSheetDrag(e) {
    if (!sheetDrag.active) return;
    if (!sheetDrag.moved && Math.hypot(e.clientX - sheetDrag.startX, e.clientY - sheetDrag.startY) > 4) sheetDrag.moved = true;
    if (!sheetDrag.moved) return;
    const over = pointCanvasAt(e.clientX, e.clientY);
    const crossing = over && over !== sheetDrag.canvas;
    if (crossing) {
      // heading to the other sheet: show a floating ghost + highlight the target
      if (!sheetDrag.ghost) {
        const g = document.createElement("img");
        g.src = sheetDrag.thumbUrl; g.className = "sheet-drag-ghost";
        document.body.appendChild(g);
        sheetDrag.ghost = g;
      }
      sheetDrag.ghost.style.left = e.clientX + "px";
      sheetDrag.ghost.style.top = e.clientY + "px";
      [sheetCanvasL, sheetCanvasR].forEach(cv => cv.classList.toggle("drag-target", cv === over));
    } else {
      if (sheetDrag.ghost) { sheetDrag.ghost.remove(); sheetDrag.ghost = null; }
      [sheetCanvasL, sheetCanvasR].forEach(cv => cv.classList.remove("drag-target"));
      // move the element freely inside its own sheet
      const p = sheetDrag.canvas._placements[sheetDrag.idx];
      if (p) {
        const [mx, my] = sheetXY(sheetDrag.canvas, e.clientX, e.clientY);
        p.cx = mx - sheetDrag.offX; p.cy = my - sheetDrag.offY;
        composeDirty = true;
        updateGizmo();
        repaintPair(sheetDrag.canvas);
      }
    }
  }
  function endSheetDrag(e) {
    if (!sheetDrag.active) return;
    [sheetCanvasL, sheetCanvasR].forEach(cv => cv.classList.remove("drag-target"));
    if (sheetDrag.ghost) { sheetDrag.ghost.remove(); sheetDrag.ghost = null; }
    const target = sheetDrag.moved ? pointCanvasAt(e.clientX, e.clientY) : null;
    const moving = target && target !== sheetDrag.canvas && target._pageIdx != null;
    if (moving) {
      const fromArr = composeState.pageAssignment[sheetDrag.fromPage];
      const toArr = composeState.pageAssignment[target._pageIdx];
      const srcPos = fromArr.indexOf(sheetDrag.id);
      const [dmx, dmy] = sheetXY(target, e.clientX, e.clientY);
      if (toArr && toArr.length >= PAGE_SIZE && srcPos >= 0) {
        // target sheet is full → swap with the design it was dropped on (or the nearest one)
        let hit = sheetHitTest(target, dmx, dmy);
        if (hit < 0) hit = nearestItemIndex(target, dmx, dmy);
        const other = (target._items || [])[hit];
        const tPos = other ? toArr.indexOf(other.id) : -1;
        if (tPos >= 0) {
          fromArr[srcPos] = other.id;
          toArr[tPos] = sheetDrag.id;
          clearPairSelection();
          resetPlacements();
          updatePageToolbar();
          showToast("Diseños intercambiados");
        }
      } else if (srcPos >= 0) {
        fromArr.splice(srcPos, 1);
        const [mx] = sheetXY(target, e.clientX, e.clientY);
        toArr.splice(nearestInsertIndex(target, mx), 0, sheetDrag.id);
        if (composeState.pageAssignment.length > 1) composeState.pageAssignment = composeState.pageAssignment.filter(g => g.length > 0);
        if (composeState.pageIndex >= composeState.pageAssignment.length) composeState.pageIndex = composeState.pageAssignment.length - 1;
        clearPairSelection();
        resetPlacements();
        updatePageToolbar();
      }
    }
    sheetDrag.active = false;
    if (!moving && sheetDrag.moved && sheetDrag.canvas && (sheetDrag.canvas._placements || []).length > 1) {
      KAOS_GALLERY.relaxAround(sheetDrag.canvas._placements, sheetDrag.idx, sheetRegion(), sheetGap());
      composeDirty = true;
    }
    if (!moving) updateGizmo();
    if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
  }
  [sheetCanvasL, sheetCanvasR].forEach(cv => {
    if (cv) cv.addEventListener("pointerdown", (e) => { e.preventDefault(); startSheetDrag(cv, e); });
  });
  document.addEventListener("pointermove", moveSheetDrag);
  document.addEventListener("pointerup", endSheetDrag);

  // ----- one sheet per design (individual pages) -----
  // Clicking the button no longer exports immediately: it opens a live single-sheet
  // preview (reusing all the Brand/Stamps/Corners/Footer controls in this same panel)
  // so settings can be tweaked per-batch before any file is downloaded.
  const sheetsEachComposeBtn = $("#sheetsEachComposeBtn");
  const sheetToolbar = $("#sheetToolbar");
  const sheetToolbarLabel = $("#sheetToolbarLabel");
  const sheetPrevBtn = $("#sheetPrevBtn");
  const sheetNextBtn = $("#sheetNextBtn");
  const flashActions = $("#flashActions");
  const sheetActions = $("#sheetActions");
  const exportThisSheetBtn = $("#exportThisSheetBtn");
  const exportAllSheetsBtn = $("#exportAllSheetsBtn");

  if (sheetsEachComposeBtn) sheetsEachComposeBtn.addEventListener("click", enterSheetMode);

  function enterSheetMode() {
    const all = KAOS_GALLERY.load();
    if (!all.length) { showToast("Gallery is empty — export some designs first."); return; }
    let targets = composeState.selectedIds.map(id => all.find(x => x.id === id)).filter(Boolean);
    if (!targets.length) targets = all;
    composeState.sheetMode = true;
    composeState.sheetTargets = targets;
    composeState.sheetIndex = 0;
    composeState.selectedIndex = null;
    if (flashActions) flashActions.style.display = "none";
    if (sheetActions) sheetActions.style.display = "";
    if (sheetToolbar) sheetToolbar.style.display = "";
    updateSheetToolbarLabel();
    renderCompose();
  }
  function exitSheetMode() {
    composeState.sheetMode = false;
    if (flashActions) flashActions.style.display = "";
    if (sheetActions) sheetActions.style.display = "none";
    if (sheetToolbar) sheetToolbar.style.display = "none";
    updatePageToolbar();
    renderCompose();
  }
  function updateSheetToolbarLabel() {
    const n = composeState.sheetTargets.length;
    const i = composeState.sheetIndex + 1;
    if (sheetToolbarLabel) sheetToolbarLabel.textContent = "Sheet " + i + "/" + n;
  }
  if (sheetPrevBtn) sheetPrevBtn.addEventListener("click", () => {
    const n = composeState.sheetTargets.length;
    composeState.sheetIndex = (composeState.sheetIndex - 1 + n) % n;
    updateSheetToolbarLabel();
    renderCompose();
  });
  if (sheetNextBtn) sheetNextBtn.addEventListener("click", () => {
    const n = composeState.sheetTargets.length;
    composeState.sheetIndex = (composeState.sheetIndex + 1) % n;
    updateSheetToolbarLabel();
    renderCompose();
  });
  // "back to gallery" should also drop out of sheet mode if it was active
  const _origBackToGallery = backToGalleryBtn;
  if (_origBackToGallery) _origBackToGallery.addEventListener("click", () => { if (composeState.sheetMode) exitSheetMode(); });

  async function renderOneSheet(canvas, item, overrides) {
    const opts = Object.assign({
      width: composeState.width, height: composeState.height,
      bleed: composeState.bleed, layout: "tight", gap: composeState.gap,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
      footerTitle: composeState.footerTitle, footerSize: composeState.footerSize, footerPos: composeState.footerPos,
      bgPhoto: composeState.bgPhoto, bgPhotoOpacity: composeState.bgPhotoOpacity, bgPhotoLight: composeState.bgPhotoLight,
      seed: composeState.seed,
    }, overrides || {});
    const items = [item];
    const placements = KAOS_GALLERY.computeDefaultPlacements(items, opts);
    const rs = (overrides && overrides.renderScale != null) ? overrides.renderScale : (canvas === composeCanvas ? previewScale() : 1);
    const pw = Math.round(opts.width * rs), ph = Math.round(opts.height * rs);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas._rscale = rs;
    await KAOS_GALLERY.renderCollage(canvas, items, {
      renderScale: rs,
      paper: composeState.paper,
      bleed: composeState.bleed,
      bgPhoto: composeState.bgPhoto,
      bgPhotoOpacity: composeState.bgPhotoOpacity,
      bgPhotoLight: composeState.bgPhotoLight,
      placements,
      order: [0],
      layout: "tight",
      title: composeState.title,
      handle: composeState.handle,
      footer: composeState.footer,
      footerTitle: composeState.footerTitle,
      footerSize: composeState.footerSize,
      footerPos: composeState.footerPos,
      titleFont: composeState.titleFont,
      handleFont: composeState.handleFont,
      stampFont: composeState.stampFont,
      stampText: composeState.stampText,
      stamps: composeState.stamps,
      stampSize: composeState.stampSize,
      stampOpacity: composeState.stampOpacity,
      shadow: composeState.shadow,
      seed: composeState.seed,
      xorOverlap: composeState.xorOverlap,
      showSizes: true,
      cornerStyle: composeState.cornerStyle,
      brandPrimary: composeState.brandPrimary,
      brandSecondary: composeState.brandSecondary,
      titleColor: composeState.titleColor,
      handleColor: composeState.handleColor,
      footerColor: composeState.footerColor,
      stampColor: composeState.stampColor,
      watermarkColor: composeState.watermarkColor,
      cornerColor: composeState.cornerColor,
      logoColor: composeState.logoColor,
      selectedIndex: null,
    });
  }

  if (exportThisSheetBtn) exportThisSheetBtn.addEventListener("click", async () => {
    const it = composeState.sheetTargets[composeState.sheetIndex];
    if (!it) return;
    const off = document.createElement("canvas");
    await renderOneSheet(off, it, { renderScale: 1 });
    await saveImage(off, "kaos-realm_sheet_" + (composeState.sheetIndex + 1) + ".png");
    off.width = off.height = 1;
    showToast("Exported 1 sheet.");
  });

  if (exportAllSheetsBtn) exportAllSheetsBtn.addEventListener("click", async () => {
    const targets = composeState.sheetTargets;
    if (!targets.length) return;
    exportAllSheetsBtn.disabled = true;
    const oldLabel = exportAllSheetsBtn.textContent;
    await abrirCarpetaLote(targets.length);
    const off = document.createElement("canvas");
    for (let i = 0; i < targets.length; i++) {
      exportAllSheetsBtn.textContent = "RENDERING " + (i + 1) + "/" + targets.length + "…";
      await renderOneSheet(off, targets[i]);
      await saveImage(off, "kaos-realm_sheet_" + (i + 1) + ".png");
      await new Promise(r => setTimeout(r, 400)); // stagger so the browser allows multiple downloads
    }
    cerrarCarpetaLote();
    exportAllSheetsBtn.textContent = oldLabel;
    exportAllSheetsBtn.disabled = false;
    showToast("Exported " + targets.length + " sheet" + (targets.length === 1 ? "" : "s") + ".");
  });

  // ----- agujeros cerrados de un sticker -----
  // El contorno del sticker se saca engordando la mancha de tinta. Eso cierra
  // los huecos pequeños, pero uno grande —el blanco de un ojo, el hueco de una
  // herradura— se queda sin tapar y en el PNG sale transparente: un agujero en
  // medio de la pegatina.
  //
  // Aquí se distingue el "fuera" del "dentro" a la manera de siempre: se entra
  // por los bordes del lienzo y se anda por lo transparente. Todo lo
  // transparente al que NO se llega desde el borde está encerrado por tinta, o
  // sea, es dentro — y el dentro es papel.
  //
  // Se puede entrar por el borde sin miedo porque el halo deja siempre un marco
  // transparente alrededor: nunca hay dibujo pegado al canto.
  function cerrarHuecos(canvas) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return;
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const fuera = new Uint8Array(w * h);
    const pila = new Int32Array(w * h);
    let n = 0;
    function meter(i) {
      if (fuera[i] || d[i * 4 + 3] >= 128) return;   // ya visto, o es tinta
      fuera[i] = 1;
      pila[n++] = i;
    }
    for (let x = 0; x < w; x++) { meter(x); meter((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { meter(y * w); meter(y * w + w - 1); }
    while (n) {
      const i = pila[--n];
      const x = i % w, y = (i / w) | 0;
      if (x > 0) meter(i - 1);
      if (x < w - 1) meter(i + 1);
      if (y > 0) meter(i - w);
      if (y < h - 1) meter(i + w);
    }
    // Todo lo que no se alcanzó desde el borde se pone opaco, sin mirar cuánta
    // transparencia tenía. Al principio sólo se rellenaba lo del todo
    // transparente, y el filo dentado que deja el suavizado —píxeles a medio
    // camino— se quedaba a medias: sobre un fondo oscuro salía un aro de puntos
    // alrededor del hueco tapado. Dentro es dentro: papel entero.
    let tocados = 0;
    for (let i = 0; i < w * h; i++) {
      if (fuera[i]) continue;
      const q = i * 4;
      if (d[q + 3] === 255 && d[q] === 255) continue;   // ya era papel
      d[q] = 255; d[q + 1] = 255; d[q + 2] = 255; d[q + 3] = 255;
      tocados++;
    }
    if (tocados) ctx.putImageData(img, 0, 0);
  }

  // ----- stickers: one PNG per design, tight 0.5 cm halo, no CM labels -----
  // Each design gets its own PNG at the same paper texture as the sheet, cropped tight
  // to the artwork with ~0.5 cm of paper visible on every side (like die-cut stickers).
  // The per-item sizeCm sets px/cm so the halo is a real physical 0.5 cm; if sizeCm is
  // missing we fall back to ~6% of the design's short side.
  const stickersExportBtn = $("#stickersExportBtn");
  async function renderSticker(item, targetCanvas, extra) {
    extra = extra || {};
    // Load design (already trimmed to alpha bbox by gallery.add()).
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = item.layerUrl;
    });
    const dw = img.naturalWidth, dh = img.naturalHeight;
    const cm = item.sizeCm > 0 ? item.sizeCm : 10;
    const pxPerCm = Math.max(dw, dh) / cm;
    const halo = Math.max(20, Math.round(pxPerCm * 0.5));

    // Rotation from the composition (radians). If provided, the sticker is
    // rendered pre-rotated to the same angle — the output canvas is the
    // rotated bounding box + halo.
    const rot = ((extra.rotDeg || 0) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rot)), sin = Math.abs(Math.sin(rot));
    const rW = dw * cos + dh * sin, rH = dw * sin + dh * cos;
    const W = Math.round(rW + halo * 2), H = Math.round(rH + halo * 2);
    targetCanvas.width = W; targetCanvas.height = H;
    const ctx = targetCanvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Pre-rotated ink canvas (design at current rotation).
    const rotated = document.createElement("canvas");
    rotated.width = W; rotated.height = H;
    const rctx = rotated.getContext("2d");
    rctx.translate(W / 2, H / 2);
    rctx.rotate(rot);
    rctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);

    // 1) Silhouette = rotated design alpha dilated by halo.
    const silh = document.createElement("canvas");
    silh.width = W; silh.height = H;
    const sctx = silh.getContext("2d");
    sctx.drawImage(rotated, 0, 0);
    const steps = Math.max(24, Math.round(halo * 0.9));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      sctx.drawImage(rotated, Math.cos(a) * halo, Math.sin(a) * halo);
    }
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, W, H);
    sctx.globalCompositeOperation = "source-over";
    cerrarHuecos(silh);   // lo que quede encerrado por tinta también es papel

    // 2) Sticker interior = SAME background as the sheet (paper + bg photo if
    // enabled), cover-fit into this sticker's canvas — matches the sticker
    // sheet look.
    const interior = document.createElement("canvas");
    interior.width = W; interior.height = H;
    const ictx = interior.getContext("2d");
    KAOS_GALLERY.paintPaperSeeded(ictx, W, H, composeState.paper || "#d9d4c8",
      (composeState.seed || 1) + (item.id ? item.id.charCodeAt(item.id.length - 1) : 0));
    if (composeState.bgPhoto) {
      // Una sola fuente para la foto, en gallery.js. Antes cada sitio se la
      // cargaba por su cuenta desde una ruta fija que no existía en la carpeta.
      const bg = await KAOS_GALLERY.loadBgPhoto();
      if (bg) {
        const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
        const bw = bg.naturalWidth * s, bh = bg.naturalHeight * s;
        const bx = (W - bw) / 2, by = (H - bh) / 2;
        ictx.save();
        ictx.globalAlpha = composeState.bgPhotoOpacity != null ? composeState.bgPhotoOpacity : 1;
        ictx.drawImage(bg, bx, by, bw, bh);
        const light = composeState.bgPhotoLight != null ? composeState.bgPhotoLight : 0;
        if (light > 0) {
          ictx.globalAlpha = light * 0.75;
          ictx.fillStyle = composeState.paper || "#d4cbc0";
          ictx.fillRect(0, 0, W, H);
        }
        ictx.restore();
      }
    }

    // 3) Compose onto target: drop shadow (silhouette shape), then paper via
    // source-in, then ink on top.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = Math.round(halo * 0.6);
    ctx.shadowOffsetX = Math.round(halo * 0.10);
    ctx.shadowOffsetY = Math.round(halo * 0.20);
    ctx.drawImage(silh, 0, 0);
    ctx.restore();
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(interior, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(rotated, 0, 0);

    silh.width = silh.height = 1;
    interior.width = interior.height = 1;
    rotated.width = rotated.height = 1;
  }
  if (stickersExportBtn) stickersExportBtn.addEventListener("click", async () => {
    // Prefer the sheet's currently-queued items (if user entered "one sheet each"),
    // else the current selection, else the full gallery.
    let targets = composeState.sheetTargets && composeState.sheetTargets.length
      ? composeState.sheetTargets.slice() : null;
    if (!targets) {
      const all = KAOS_GALLERY.load();
      targets = composeState.selectedIds
        .map(id => all.find(x => x.id === id)).filter(Boolean);
      if (!targets.length) targets = all;
    }
    if (!targets.length) { showToast("Gallery is empty — export some designs first."); return; }
    stickersExportBtn.disabled = true;
    const oldLabel = stickersExportBtn.textContent;
    await abrirCarpetaLote(targets.length);
    const off = document.createElement("canvas");
    const withFrame = !!composeState.stickerWithFrame;
    for (let i = 0; i < targets.length; i++) {
      stickersExportBtn.textContent = "STICKER " + (i + 1) + "/" + targets.length + "…";
      try {
        if (withFrame) {
          // Full-sheet frame around a single sticker: place the item centered
          // in the sheet's usable region using the same placement math as
          // normal compositions, then render the sticker sheet with paper on.
          const items = [targets[i]];
          const placements = KAOS_GALLERY.computeDefaultPlacements(items, {
            width: composeState.width, height: composeState.height,
            bleed: composeState.bleed, layout: "tight", gap: composeState.gap,
            title: composeState.title, handle: composeState.handle, footer: composeState.footer,
            footerTitle: composeState.footerTitle, footerSize: composeState.footerSize,
            footerPos: composeState.footerPos, seed: composeState.seed,
          });
          off.width = composeState.width; off.height = composeState.height;
          await renderStickerLayer(off, items, { placements, order: [0], layout: "tight" }, { withFrame: true });
        } else {
          // Use the CURRENT rotation from the composition so individual
          // stickers keep the same orientation as shown on the sheet.
          // Placements live in (a) sheetPair canvases when two-up, (b)
          // composeState.placements for the flat single-sheet compose, or
          // (c) composeState.pagePlacements[key] when pages are in use.
          let rotDeg = 0;
          const inPair = sheetPair && sheetPair.style.display !== "none";
          const tid = targets[i].id;
          if (inPair) {
            for (const cv of [sheetCanvasL, sheetCanvasR]) {
              if (!cv || !cv._items || !cv._placements) continue;
              const j = cv._items.findIndex(x => x.id === tid);
              if (j >= 0 && cv._placements[j]) { rotDeg = cv._placements[j].rot || 0; break; }
            }
          }
          if (!rotDeg) {
            const items = currentItems();
            const idx = items.findIndex(x => x.id === tid);
            if (idx >= 0 && composeState.placements && composeState.placements[idx]) {
              rotDeg = composeState.placements[idx].rot || 0;
            }
          }
          if (!rotDeg && composeState.pagePlacements) {
            const all = KAOS_GALLERY.load();
            for (const key of Object.keys(composeState.pagePlacements)) {
              const rec = composeState.pagePlacements[key];
              if (!rec || !rec.placements) continue;
              const ids = key.split("|");
              const pageItems = ids.map(id => all.find(x => x.id === id)).filter(Boolean);
              const j = pageItems.findIndex(x => x.id === tid);
              if (j >= 0 && rec.placements[j]) { rotDeg = rec.placements[j].rot || 0; break; }
            }
          }
          await renderSticker(targets[i], off, { rotDeg });
        }
        await saveImage(off, "kaos-realm_sticker_" + (i + 1) + ".png");
      } catch (e) { console.warn("sticker failed", e); }
      await new Promise(r => setTimeout(r, 380));
    }
    cerrarCarpetaLote();
    off.width = off.height = 1;
    stickersExportBtn.textContent = oldLabel;
    stickersExportBtn.disabled = false;
    showToast("Exported " + targets.length + " sticker" + (targets.length === 1 ? "" : "s") + ".");
  });

  // Sticker-with-frame toggle
  const stickerWithFrameChk = $("#stickerWithFrameChk");
  if (stickerWithFrameChk) {
    stickerWithFrameChk.checked = !!composeState.stickerWithFrame;
    stickerWithFrameChk.addEventListener("change", (e) => {
      composeState.stickerWithFrame = e.target.checked;
      composeDirty = true;
    });
  }

  // ----- compose controls -----
  $$("#composeSize .tog").forEach(b => b.addEventListener("click", () => {
    $$("#composeSize .tog").forEach(x => x.setAttribute("aria-selected", x === b));
    composeState.width = parseInt(b.dataset.w, 10);
    composeState.height = parseInt(b.dataset.h, 10);
    $("#composeSizeVal").textContent = composeState.width + "×" + composeState.height;
    resetPlacements(); renderCompose();
  }));
  $$("#composeLayout .tog").forEach(b => b.addEventListener("click", () => {
    const mode = b.dataset.layout;
    // User explicitly picked a layout — open the gate so "manual" is accepted.
    composeState._userChoseLayout = true;
    // Scatter = re-distribute what's ALREADY on the sheet: positions change,
    // sizes (including any you set by hand) are left exactly as they are.
    if (mode === "scatter") { scatterCurrent(); return; }
    composeState.layout = mode;
    syncLayoutUI();
    if (mode !== "manual") { composeState.pagePlacements = {}; resetPlacements(); }
    if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    else renderCompose();
    composeState._userChoseLayout = false;
  }));
  $$("#composePaper .tog").forEach(b => b.addEventListener("click", () => {
    $$("#composePaper .tog").forEach(x => x.setAttribute("aria-selected", x === b));
    composeState.paper = b.dataset.paper;
    renderCompose();
  }));

  // Brand colours: persisted separately (they're identity, not per-composition).
  const brandPrimaryPicker = $("#brandPrimaryPicker");
  const brandSecondaryPicker = $("#brandSecondaryPicker");
  if (brandPrimaryPicker) {
    brandPrimaryPicker.value = composeState.brandPrimary;
    brandPrimaryPicker.addEventListener("input", (e) => {
      composeState.brandPrimary = e.target.value;
      try { localStorage.setItem("kaos.brand.primary", e.target.value); } catch(_) {}
      composeDirty = true;
      renderCompose();
      if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    });
  }
  if (brandSecondaryPicker) {
    brandSecondaryPicker.value = composeState.brandSecondary;
    brandSecondaryPicker.addEventListener("input", (e) => {
      composeState.brandSecondary = e.target.value;
      try { localStorage.setItem("kaos.brand.secondary", e.target.value); } catch(_) {}
      composeDirty = true;
      renderCompose();
      if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    });
  }

  // Element colours — each element (title, handle, footer, stamp text,
  // @KAOS.REALM watermark, corners) can be painted in black / white /
  // primary / secondary. Watermark also has a "gray" option (multiply, low
  // alpha) that matches the logo's washed grey look.
  (function initElementColors(){
    const host = $("#elementColors");
    if (!host) return;
    const rows = [
      { key: "titleColor",     label: "TITLE" },
      { key: "handleColor",    label: "HANDLE" },
      { key: "footerColor",    label: "FOOTER" },
      { key: "stampColor",     label: "STAMP" },
      { key: "watermarkColor", label: "@KAOS.REALM", extra: [{ c: "gray", swatch: "#8a8681" }] },
      { key: "cornerColor",    label: "CORNERS" },
      { key: "logoColor",      label: "LOGO", extra: [{ c: "gray", swatch: "#8a8681" }] },
    ];
    const base = [
      { c: "black", swatch: "#0a0908" },
      { c: "white", swatch: "#ffffff" },
      { c: "primary", swatch: composeState.brandPrimary },
      { c: "secondary", swatch: composeState.brandSecondary },
    ];
    const chipStyle = "width:18px;height:18px;border-radius:50%;border:1.5px solid #7a766c;cursor:pointer;padding:0;flex:0 0 auto";
    function syncRow(row) {
      row.chips.forEach(chip => {
        const on = composeState[row.key] === chip.dataset.c;
        chip.style.outline = on ? "2px solid var(--hot,#c9342a)" : "none";
        chip.style.outlineOffset = on ? "2px" : "0";
      });
    }
    for (const r of rows) {
      const labelEl = document.createElement("div");
      labelEl.textContent = r.label;
      host.appendChild(labelEl);
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      r.chips = [];
      const items = base.concat(r.extra || []);
      for (const it of items) {
        const b = document.createElement("button");
        b.dataset.c = it.c;
        b.title = it.c;
        b.style.cssText = chipStyle + ";background:" + it.swatch;
        b.addEventListener("click", () => {
          composeState[r.key] = it.c;
          syncRow(r);
          composeDirty = true;
          renderCompose();
          if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
        });
        rowEl.appendChild(b);
        r.chips.push(b);
      }
      host.appendChild(rowEl);
      syncRow(r);
    }
    // When brand colors change, update the primary/secondary swatches in-place.
    function refreshBrandSwatches() {
      for (const r of rows) {
        for (const chip of r.chips) {
          if (chip.dataset.c === "primary") chip.style.background = composeState.brandPrimary;
          if (chip.dataset.c === "secondary") chip.style.background = composeState.brandSecondary;
        }
      }
    }
    if (brandPrimaryPicker) brandPrimaryPicker.addEventListener("input", refreshBrandSwatches);
    if (brandSecondaryPicker) brandSecondaryPicker.addEventListener("input", refreshBrandSwatches);
  })();
  $$("#composeCorners .tog").forEach(b => b.addEventListener("click", () => {
    $$("#composeCorners .tog").forEach(x => x.setAttribute("aria-selected", x === b));
    composeState.cornerStyle = b.dataset.corner;
    renderCompose();
  }));
  $("#composeBleed").addEventListener("input", (e) => {
    composeState.bleed = parseFloat(e.target.value) / 100;
    $("#composeBleedVal").textContent = e.target.value + "%";
    // Same principle as gap: don't wipe the layout. Just clamp every piece into
    // the new usable region and resolve any collisions that appear when the
    // region shrinks. Larger bleed → nothing to do (region grew).
    if (composeState.layout !== "manual" && (composeState.placements || []).length > 1) {
      reflowForRegion(composeState.placements, sheetRegion(), sheetGap());
    }
    renderCompose();
  });
  const composeGapEl = $("#composeGap");
  if (composeGapEl) {
    composeGapEl.addEventListener("input", (e) => {
      // Slider is 0..80 tenths-of-percent → 0%..8% of min(W,H).
      const prevGap = composeState.gap || 0;
      composeState.gap = parseFloat(e.target.value) / 1000;
      $("#composeGapVal").textContent = (composeState.gap * 100).toFixed(1) + "%";
      // Tight/Scatter used to full-reset here, wiping every position. Now we
      // just adjust the current placements subtly to honour the new gap: pieces
      // that would violate the new clearance push apart along their contact
      // axis; everything else stays exactly where it is.
      if (composeState.layout !== "manual" && (composeState.placements || []).length > 1) {
        reflowForGap(composeState.placements, sheetRegion(), prevGap, composeState.gap);
      }
      renderCompose();
    });
  }
  $("#composeTitle").addEventListener("input", (e) => { composeState.title = e.target.value; composeDirty = true; renderCompose(); });
  $("#composeHandle").addEventListener("input", (e) => { composeState.handle = e.target.value; composeDirty = true; renderCompose(); });
  $("#composeFooter").addEventListener("input", (e) => { composeState.footer = e.target.value; composeDirty = true; renderCompose(); });
  $("#composeFooterTitle").addEventListener("input", (e) => { composeState.footerTitle = e.target.value; composeDirty = true; renderCompose(); });
  $("#composeFooterSize").addEventListener("input", (e) => {
    composeState.footerSize = parseFloat(e.target.value);
    $("#footerSizeVal").textContent = composeState.footerSize.toFixed(2);
    renderCompose();
  });
  $("#composeFooterPos").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-footerpos]");
    if (!btn) return;
    composeState.footerPos = btn.dataset.footerpos;
    $("#composeFooterPos").querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    if (composeState.layout !== "manual") resetPlacements();
    renderCompose();
  });
  $("#composeStampText").addEventListener("input", (e) => { composeState.stampText = e.target.value; composeDirty = true; renderCompose(); });
  $("#composeStamps").addEventListener("input", (e) => {
    composeState.stamps = parseInt(e.target.value, 10);
    $("#stampCountVal").textContent = composeState.stamps;
    renderCompose();
  });
  $("#composeStampSize").addEventListener("input", (e) => {
    composeState.stampSize = parseFloat(e.target.value);
    $("#stampSizeVal").textContent = composeState.stampSize.toFixed(2);
    renderCompose();
  });
  $("#composeStampOpacity").addEventListener("input", (e) => {
    composeState.stampOpacity = parseFloat(e.target.value);
    $("#stampOpacityVal").textContent = composeState.stampOpacity.toFixed(2);
    renderCompose();
  });
  $("#composeShadow").addEventListener("input", (e) => {
    composeState.shadow = parseFloat(e.target.value);
    $("#composeShadowVal").textContent = composeState.shadow.toFixed(2);
    renderCompose();
  });
  function pedirAnadirALaHoja() {
    const puestos = new Set(composeState.selectedIds);
    elegirDeGaleria(anadirALaHoja, "Añadir a esta hoja", (it) => !puestos.has(it.id));
  }
  // Dos botones para lo mismo a propósito: el de arriba, junto a «+ IMPORT»,
  // y el del panel de ajustes. El de arriba SÓLO sale en el editor de posts;
  // en la Flash Gallery lo esconde syncBotonAnadir, porque ahí todavía no hay
  // hoja donde meter nada y sólo confunde.
  for (const id of ["#addFromGalleryBtn", "#addFromGalleryTopBtn"]) {
    const b = $(id);
    if (b) b.addEventListener("click", pedirAnadirALaHoja);
  }
  // La GALERÍA y el EDITOR DE POSTS comparten ventana, así que esto pone al día
  // lo que cambia entre las dos: el título (sin esto las dos ponían «Flash
  // Gallery») y el botón de «+ A ESTA HOJA», que sólo tiene sentido en el editor.
  function syncBotonAnadir() {
    const enEditor = composeView && composeView.style.display !== "none";
    const t = $("#galleryModalTitle");
    if (t) t.textContent = enEditor ? "Editor de posts" : "Flash Gallery";
    const top = $("#addFromGalleryTopBtn");
    if (top) top.style.display = enEditor ? "" : "none";
  }

  // ---- fondo: tres modos en vez de una casilla ----
  const composeBgModo = $("#composeBgModo");
  if (composeBgModo) {
    composeBgModo.addEventListener("click", (e) => {
      const b = e.target.closest(".tog");
      if (!b) return;
      composeState.bgMode = b.dataset.bg;
      aplicarBgMode();
      composeDirty = true;
      repintarHoja();
    });
  }
  const bgFotoInput = $("#bgFotoInput");
  if ($("#bgFotoBtn")) $("#bgFotoBtn").addEventListener("click", () => bgFotoInput.click());
  if (bgFotoInput) {
    bgFotoInput.addEventListener("change", () => {
      const f = bgFotoInput.files && bgFotoInput.files[0];
      bgFotoInput.value = "";
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        // Si elige foto estando en PAPEL, saltar sola al modo con foto: si no,
        // la pone, no ve ningún cambio y parece que no ha funcionado.
        if (composeState.bgMode === "papel") composeState.bgMode = "papelFoto";
        ponerFondo(fr.result);
      };
      fr.onerror = () => showToast("No se pudo leer esa foto");
      fr.readAsDataURL(f);
    });
  }
  if ($("#bgFotoGaleriaBtn")) $("#bgFotoGaleriaBtn").addEventListener("click", () => {
    elegirDeGaleria((it) => {
      if (composeState.bgMode === "papel") composeState.bgMode = "papelFoto";
      ponerFondo(it.layerUrl || it.thumbUrl);
    }, "Elige la foto de fondo");
  });
  if ($("#bgFotoQuitarBtn")) $("#bgFotoQuitarBtn").addEventListener("click", () => ponerFondo(null));
  const composeBgPhotoLight = $("#composeBgPhotoLight");
  if (composeBgPhotoLight) {
    composeBgPhotoLight.value = composeState.bgPhotoLight;
    $("#bgPhotoLightVal").textContent = composeState.bgPhotoLight.toFixed(2);
    composeBgPhotoLight.addEventListener("input", (e) => {
      composeState.bgPhotoLight = parseFloat(e.target.value);
      $("#bgPhotoLightVal").textContent = composeState.bgPhotoLight.toFixed(2);
      renderCompose();
      if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    });
  }
  const composeXorChk = $("#composeXorChk");
  if (composeXorChk) {
    composeXorChk.addEventListener("change", (e) => {
      composeState.xorOverlap = e.target.checked;
      if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
      else renderCompose();
    });
  }
  const composeShowSizes = $("#composeShowSizes");
  if (composeShowSizes) {
    composeShowSizes.addEventListener("change", (e) => {
      composeState.showSizes = e.target.checked;
      renderCompose();
    });
  }
  shuffleBtn.addEventListener("click", () => {
    composeState.seed = (Math.random() * 1e9) | 0;
    composeState.selectedIds.sort(() => Math.random() - 0.5);
    composeState.selectedIndex = null;
    composeState.layout = composeState.layout === "manual" ? "tight" : composeState.layout;
    syncLayoutUI();
    resetPlacements();
    renderCompose();
  });
  // Exports always render off-screen at the full design size, so the on-screen
  // (memory-capped) previews never limit output quality.
  // EXPORT guarda EXACTAMENTE lo que enseña la vista previa. En modo
  // «FOTO / STICKER» eso es su foto de fondo con los diseños recortados
  // encima; antes este botón llamaba siempre al pintado plano y le devolvía
  // una hoja normal, sin las pegatinas y sin su fondo.
  async function exportFullRes(items, rec, filename) {
    const off = document.createElement("canvas");
    off.width = composeState.width; off.height = composeState.height;
    if (composeState.bgMode === "sticker" && items.length) {
      await componerSticker(off, items, rec);
    } else {
      await KAOS_GALLERY.renderCollage(off, items, sheetRenderOpts(rec, null, 1));
    }
    await saveImage(off, filename);
    off.width = off.height = 1;
  }
  exportCollageBtn.addEventListener("click", () => {
    // in two-up sheet mode, export exactly what the highlighted preview shows
    if (sheetPair && sheetPair.style.display !== "none") {
      const cv = [sheetCanvasL, sheetCanvasR].find(c => c._pageIdx === (composeState.pageIndex || 0)) || sheetCanvasL;
      exportFullRes(cv._items || [], { placements: cv._placements, order: cv._order, layout: "manual" },
        "kaos-realm_flash_sheet" + ((cv._pageIdx || 0) + 1) + "_" + Date.now() + ".png");
      return;
    }
    if (!composeCanvas.width) return;
    exportFullRes(currentItems(), { placements: composeState.placements, order: composeState.order, layout: composeState.layout },
      "kaos-realm_flash_" + Date.now() + ".png");
  });

  // ----- STICKER SHEET export ---------------------------------------------
  // Same composition, title, subtitle, footer, logo, corners — but every
  // design is drawn as a die-cut sticker (paper halo following its silhouette
  // + soft shadow) instead of flat multiplied ink. Intended as a post cover.
  const exportStickerSheetBtn = $("#exportStickerSheetBtn");
  async function renderStickerLayer(canvas, items, rec, layerOpts) {
    layerOpts = layerOpts || {};
    const withFrame = !!layerOpts.withFrame;
    // 1) Render sheet chrome (title + subtitle + footer + logo + corners).
    // By default the canvas is transparent (sticker-sheet look — only the
    // stickers float). When `withFrame` is true, the full sheet background
    // is kept so exported stickers get the same paper + bg photo behind them
    // as a normal composition.
    const W = canvas.width, H = canvas.height;
    const chromeOpts = Object.assign({}, sheetRenderOpts(
      { placements: [], order: [], layout: rec.layout, w: W, h: H, bleed: composeState.bleed, gap: composeState.gap },
      null, 1
    ));
    chromeOpts.showSizes = false;
    chromeOpts.stamps = 0;
    // Sin marco la hoja se queda en transparente (pliego de pegatinas para
    // troquelar). CON marco se pinta el fondo entero de la hoja — papel y foto
    // — igual que en una composicion normal: `sheetRenderOpts` ya los trae,
    // asi que basta con NO borrarlos. Antes se borraban siempre y el marco no
    // hacia nada: salia la hoja transparente con la foto metida DENTRO de cada
    // pegatina, que al guardarse en PNG se veia como disenos rojos sobre negro.
    if (!withFrame) {
      chromeOpts.paper = "transparent";
      chromeOpts.bgPhoto = null;
    }
    await KAOS_GALLERY.renderCollage(canvas, [], chromeOpts);

    // 2) Build a world-aligned BACKGROUND canvas — the same paper + bg photo
    // + light wash that renderCollage would normally paint behind the sheet.
    // Each sticker's interior samples from this so the photo shows through
    // the die-cut "holes" in world orientation (like the sticker was cut out
    // of the sheet).
    const worldBg = document.createElement("canvas");
    worldBg.width = W; worldBg.height = H;
    const wbctx = worldBg.getContext("2d");
    // paper base
    KAOS_GALLERY.paintPaperSeeded(wbctx, W, H, composeState.paper || "#d9d4c8", composeState.seed || 1);
    // optional bg photo (same cover-fit + opacity + light wash as renderCollage).
    // En modo sticker el halo tiene que ser papel: si le metes la misma foto que
    // hay detrás, la pegatina se camufla con el fondo y no se ve el recorte.
    // Con marco, el halo va SIEMPRE en papel: la foto ya esta detras de la hoja,
    // y si la pegatina la llevara tambien dentro se camuflaria con el fondo y
    // no se veria el recorte.
    if (composeState.bgPhoto && !layerOpts.soloPapel && !withFrame) {
      const bg = await KAOS_GALLERY.loadBgPhoto();
      if (bg) {
        const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
        const dw = bg.naturalWidth * s, dh = bg.naturalHeight * s;
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        wbctx.save();
        wbctx.globalAlpha = composeState.bgPhotoOpacity != null ? composeState.bgPhotoOpacity : 1;
        wbctx.drawImage(bg, dx, dy, dw, dh);
        const light = composeState.bgPhotoLight != null ? composeState.bgPhotoLight : 0;
        if (light > 0) {
          wbctx.globalAlpha = light * 0.75;
          wbctx.fillStyle = composeState.paper || "#d4cbc0";
          wbctx.fillRect(0, 0, W, H);
        }
        wbctx.restore();
      }
    }

    // 2) Overlay each design as a sticker at its placement.
    const ctx = canvas.getContext("2d");
    const placements = rec.placements || [];
    const order = rec.order && rec.order.length ? rec.order : items.map((_, i) => i);
    // Load images
    const imgs = await Promise.all(items.map(it => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = it.layerUrl;
    })));

    for (const idx of order) {
      const it = items[idx];
      const p = placements[idx];
      const img = imgs[idx];
      if (!it || !p || !img) continue;
      const cm = it.sizeCm > 0 ? it.sizeCm : 10;
      const pxPerCm = Math.max(p.w, p.h) / cm;
      const halo = Math.max(6, Math.round(pxPerCm * 0.5));
      const dw = Math.round(p.w), dh = Math.round(p.h);
      const SW = dw + halo * 2, SH = dh + halo * 2;
      const rot = (p.rot || 0) * Math.PI / 180;

      // Silhouette (design alpha dilated by halo) — axis-aligned to the ink.
      const silh = document.createElement("canvas");
      silh.width = SW; silh.height = SH;
      const sctx = silh.getContext("2d");
      sctx.drawImage(img, halo, halo, dw, dh);
      const steps = Math.max(24, Math.round(halo * 0.9));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        sctx.drawImage(img, halo + Math.cos(a) * halo, halo + Math.sin(a) * halo, dw, dh);
      }
      sctx.globalCompositeOperation = "source-in";
      sctx.fillStyle = "#ffffff";
      sctx.fillRect(0, 0, SW, SH);
      sctx.globalCompositeOperation = "source-over";
      cerrarHuecos(silh);   // igual que en el sticker suelto, para que casen

      // Assemble the sticker in its LOCAL (ink-aligned) frame. Fill the FULL
      // canvas with worldBg (paper + bg photo), counter-rotated so the photo
      // stays world-aligned once the sticker is placed with rotation `rot`,
      // then clip to the silhouette via destination-in.
      const sticker = document.createElement("canvas");
      sticker.width = SW; sticker.height = SH;
      const stx = sticker.getContext("2d");
      stx.save();
      stx.translate(SW / 2, SH / 2);
      stx.rotate(-rot);
      stx.translate(-p.cx, -p.cy);
      stx.drawImage(worldBg, 0, 0);
      stx.restore();
      // clip to silhouette
      stx.globalCompositeOperation = "destination-in";
      stx.drawImage(silh, 0, 0);
      stx.globalCompositeOperation = "source-over";
      // subtle inner darken along the edge, so the die-cut reads
      stx.globalCompositeOperation = "source-atop";
      const grd = stx.createRadialGradient(SW / 2, SH / 2, Math.min(SW, SH) * 0.35, SW / 2, SH / 2, Math.max(SW, SH) * 0.55);
      grd.addColorStop(0, "rgba(0,0,0,0)");
      grd.addColorStop(1, "rgba(0,0,0,0.18)");
      stx.fillStyle = grd;
      stx.fillRect(0, 0, SW, SH);
      stx.globalCompositeOperation = "source-over";
      // ink on top
      stx.save();
      stx.globalCompositeOperation = "multiply";
      stx.drawImage(img, halo, halo, dw, dh);
      stx.restore();

      // Stamp onto the sheet at the placement's transform, with a drop shadow
      // that follows the sticker's silhouette (alpha).
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate(rot);
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = Math.round(halo * 0.6);
      ctx.shadowOffsetX = Math.round(halo * 0.10);
      ctx.shadowOffsetY = Math.round(halo * 0.20);
      ctx.drawImage(sticker, -SW / 2, -SH / 2, SW, SH);
      ctx.restore();

      // free temp canvases
      silh.width = silh.height = 1;
      sticker.width = sticker.height = 1;
    }
    // free the world-bg helper
    worldBg.width = worldBg.height = 1;
  }

  // Un solo sitio decide CÓMO se pinta una hoja en la vista previa. En modo
  // «FOTO / STICKER» la previa tiene que enseñar lo mismo que exporta el botón
  // de stickers: la foto a sangre y cada diseño recortado con su halo de papel
  // y su sombra. Antes la previa usaba el pintado normal y el modo parecía no
  // hacer nada.
  //
  // La capa de stickers se pinta a tamaño real de hoja y se reduce al final,
  // porque `renderStickerLayer` trabaja con las coordenadas sin escalar de las
  // colocaciones: pintarla directamente en un lienzo de previa sacaría los
  // diseños fuera del encuadre.
  // La hoja de «FOTO / STICKER» montada entera: su foto de fondo a sangre y
  // encima los diseños recortados como pegatinas. Un solo sitio, porque la
  // usan la vista previa Y la exportación — antes cada una pintaba lo suyo y
  // por eso lo que guardaba no era lo que estaba mirando.
  async function componerSticker(canvas, items, rec) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bg = await KAOS_GALLERY.loadBgPhoto();
    if (bg) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
      const dw = bg.naturalWidth * s, dh = bg.naturalHeight * s;
      ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = composeState.paper || "#d9d4c8";
      ctx.fillRect(0, 0, W, H);
    }
    const capa = document.createElement("canvas");
    capa.width = composeState.width;
    capa.height = composeState.height;
    // `soloPapel` deja el halo en papel aunque detrás haya foto: si el halo
    // llevara la misma foto, la pegatina se camuflaría con el fondo y no se
    // vería el recorte.
    await renderStickerLayer(capa, items, rec, { soloPapel: true });
    ctx.drawImage(capa, 0, 0, W, H);
    capa.width = capa.height = 1;
  }

  async function pintarHoja(canvas, items, opts, rec) {
    if (composeState.bgMode !== "sticker" || !items.length) {
      return KAOS_GALLERY.renderCollage(canvas, items, opts);
    }
    await componerSticker(canvas, items, rec);
    // Los «N CM» van DESPUÉS y sobre el lienzo de la previa, no dentro de la
    // capa de stickers: el pintado de stickers los apaga a propósito (en la
    // hoja exportada estorban) y además así el doble clic para editar la
    // medida sigue encontrándolos donde los busca.
    KAOS_GALLERY.pintarEtiquetasCm(canvas, items, rec.placements || [], opts);
  }

  if (exportStickerSheetBtn) exportStickerSheetBtn.addEventListener("click", async () => {
    let items, rec;
    if (sheetPair && sheetPair.style.display !== "none") {
      const cv = [sheetCanvasL, sheetCanvasR].find(c => c._pageIdx === (composeState.pageIndex || 0)) || sheetCanvasL;
      items = cv._items || [];
      rec = { placements: cv._placements, order: cv._order, layout: "manual" };
    } else {
      if (!composeCanvas.width) return;
      items = currentItems();
      rec = { placements: composeState.placements, order: composeState.order, layout: composeState.layout };
    }
    if (!items.length) { showToast("Gallery is empty — export some designs first."); return; }
    exportStickerSheetBtn.disabled = true;
    const oldLabel = exportStickerSheetBtn.textContent;
    exportStickerSheetBtn.textContent = "RENDERING STICKER SHEET…";
    try {
      const off = document.createElement("canvas");
      off.width = composeState.width; off.height = composeState.height;
      // Con marco: esta hoja es una portada de post, no un pliego para
      // troquelar. Sin fondo salia transparente y en PNG se veia negra.
      await renderStickerLayer(off, items, rec, { withFrame: true });
      await saveImage(off, "kaos-realm_sticker-sheet_" + Date.now() + ".png");
      off.width = off.height = 1;
      showToast("Exported sticker sheet.");
    } catch (e) {
      console.warn("sticker sheet failed", e);
      showToast("Sticker sheet export failed.");
    }
    exportStickerSheetBtn.textContent = oldLabel;
    exportStickerSheetBtn.disabled = false;
  });

  function syncLayoutUI() {
    $$("#composeLayout .tog").forEach(x => x.setAttribute("aria-selected", x.dataset.layout === composeState.layout));
  }
  function syncControls() {
    $("#composeTitle").value = composeState.title;
    $("#composeHandle").value = composeState.handle;
    $("#composeFooter").value = composeState.footer;
    $("#composeFooterTitle").value = composeState.footerTitle;
    $("#composeFooterSize").value = composeState.footerSize;
    $("#footerSizeVal").textContent = composeState.footerSize.toFixed(2);
    $("#composeFooterPos").querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.footerpos === composeState.footerPos ? "true" : "false"));
    $("#composeStampText").value = composeState.stampText;
    $("#composeStamps").value = composeState.stamps;
    $("#stampCountVal").textContent = composeState.stamps;
    $("#composeStampSize").value = composeState.stampSize;
    $("#stampSizeVal").textContent = composeState.stampSize.toFixed(2);
    $("#composeStampOpacity").value = composeState.stampOpacity;
    $("#stampOpacityVal").textContent = composeState.stampOpacity.toFixed(2);
    $("#composeShadow").value = composeState.shadow;
    $("#composeShadowVal").textContent = composeState.shadow.toFixed(2);
    if ($("#composeShowSizes")) $("#composeShowSizes").checked = composeState.showSizes;
    if (composeXorChk) composeXorChk.checked = !!composeState.xorOverlap;
    // Las hojas guardadas antes de los modos sólo traen el sí/no. Se traduce:
    // si tenían foto encendida y hay foto, es «papel + foto».
    if (!composeState.bgMode || composeState.bgMode === "papel") composeState.bgMode = "papelFoto";
    aplicarBgMode();
    $("#composeBleed").value = Math.round(composeState.bleed * 100);
    $("#composeBleedVal").textContent = Math.round(composeState.bleed * 100) + "%";
    if ($("#composeGap")) {
      $("#composeGap").value = Math.round(composeState.gap * 1000);
      $("#composeGapVal").textContent = (composeState.gap * 100).toFixed(1) + "%";
    }
    $("#composeSizeVal").textContent = composeState.width + "×" + composeState.height;

    // Brand color pickers + element color chips + sticker toggle
    const bp = $("#brandPrimaryPicker"); if (bp) bp.value = composeState.brandPrimary || "#ff3d5c";
    const bs = $("#brandSecondaryPicker"); if (bs) bs.value = composeState.brandSecondary || "#d4ff2f";
    const ec = $("#elementColors");
    if (ec) {
      // Update every chip's selected outline + refresh primary/secondary swatches.
      ec.querySelectorAll("div > div").forEach(rowEl => {
        const chips = rowEl.querySelectorAll("button[data-c]");
        // Find this row's key by matching its buttons against composeState.
        chips.forEach(chip => {
          if (chip.dataset.c === "primary") chip.style.background = composeState.brandPrimary || "#ff3d5c";
          if (chip.dataset.c === "secondary") chip.style.background = composeState.brandSecondary || "#d4ff2f";
        });
      });
      const rows = [
        ["titleColor",     "TITLE"], ["handleColor", "HANDLE"], ["footerColor", "FOOTER"],
        ["stampColor",     "STAMP"], ["watermarkColor", "@KAOS.REALM"],
        ["cornerColor",    "CORNERS"], ["logoColor", "LOGO"],
      ];
      const labels = Array.from(ec.children);
      for (let i = 0; i < labels.length; i += 2) {
        const rowEl = labels[i + 1];
        if (!rowEl) continue;
        const rowIdx = i / 2;
        const key = rows[rowIdx] && rows[rowIdx][0];
        if (!key) continue;
        rowEl.querySelectorAll("button[data-c]").forEach(chip => {
          const on = composeState[key] === chip.dataset.c;
          chip.style.outline = on ? "2px solid var(--hot,#c9342a)" : "none";
          chip.style.outlineOffset = on ? "2px" : "0";
        });
      }
    }
    const swf = $("#stickerWithFrameChk"); if (swf) swf.checked = !!composeState.stickerWithFrame;
  }

  // ----- font pickers -----
  function renderFontPickers() {
    for (const target of ["title", "handle"]) {
      const el = $("#" + target + "FontPicker");
      if (!el) continue;
      el.innerHTML = "";
      const currentId = composeState[target + "Font"];
      Object.entries(KAOS_GALLERY.FONTS).forEach(([id, f]) => {
        const btn = document.createElement("button");
        btn.className = "font-pick";
        btn.style.fontFamily = `"${f.family}", serif`;
        btn.style.fontWeight = f.weight;
        btn.textContent = f.sample;
        if (id === currentId) btn.setAttribute("aria-selected", "true");
        btn.addEventListener("click", () => {
          composeState[target + "Font"] = id;
          if (target === "title") composeState.stampFont = id; // stamps inherit title font
          renderFontPickers();
          composeDirty = true; // font change should count as a change to save
          if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
          else renderCompose();
        });
        el.appendChild(btn);
      });
    }
  }

  // ----- placements -----
  // One shared definition of the packing frame + spacing, so hand-moves, resizes and
  // Scatter all reflow against exactly the same geometry the auto-layout used.
  function sheetRegion() {
    return KAOS_GALLERY.usableRegion({
      width: composeState.width, height: composeState.height, bleed: composeState.bleed,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
    });
  }
  // Adjust current placements to fit a new usable region (bleed change). Pieces
  // outside the region are pulled inside along the shortest vector; then the
  // gap-reflow resolves any collisions that came from the squeeze.
  function reflowForRegion(placements, region, gapPx) {
    for (const p of placements) {
      p.cx = Math.min(region.x + region.w - p.w / 2, Math.max(region.x + p.w / 2, p.cx));
      p.cy = Math.min(region.y + region.h - p.h / 2, Math.max(region.y + p.h / 2, p.cy));
    }
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i], b = placements[j];
          if (!a || !b) continue;
          const ox = (a.w + b.w) / 2 + gapPx - Math.abs(a.cx - b.cx);
          const oy = (a.h + b.h) / 2 + gapPx - Math.abs(a.cy - b.cy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) {
            const s = a.cx < b.cx ? 1 : -1;
            a.cx -= s * ox / 2; b.cx += s * ox / 2;
          } else {
            const s = a.cy < b.cy ? 1 : -1;
            a.cy -= s * oy / 2; b.cy += s * oy / 2;
          }
          moved = true;
        }
      }
      for (const p of placements) {
        p.cx = Math.min(region.x + region.w - p.w / 2, Math.max(region.x + p.w / 2, p.cx));
        p.cy = Math.min(region.y + region.h - p.h / 2, Math.max(region.y + p.h / 2, p.cy));
      }
      if (!moved) break;
    }
  }
  function sheetGap() { return Math.min(composeState.width, composeState.height) * (composeState.gap || 0.02); }
  // Adjust current placements to match a new gap WITHOUT full re-layout.
  // Only pairs that violate the new clearance push apart (along their shorter
  // axis of overlap) by the minimum amount needed. When the new gap is smaller
  // than the old one nothing moves — existing spacing already satisfies it.
  function reflowForGap(placements, region, oldGapFrac, newGapFrac) {
    const minWH = Math.min(composeState.width, composeState.height);
    const newGapPx = (newGapFrac || 0) * minWH;
    if ((newGapFrac || 0) <= (oldGapFrac || 0) + 1e-6) return;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i], b = placements[j];
          if (!a || !b) continue;
          const ox = (a.w + b.w) / 2 + newGapPx - Math.abs(a.cx - b.cx);
          const oy = (a.h + b.h) / 2 + newGapPx - Math.abs(a.cy - b.cy);
          if (ox <= 0 || oy <= 0) continue;
          if (ox < oy) {
            const s = a.cx < b.cx ? 1 : -1;
            a.cx -= s * ox / 2; b.cx += s * ox / 2;
          } else {
            const s = a.cy < b.cy ? 1 : -1;
            a.cy -= s * oy / 2; b.cy += s * oy / 2;
          }
          moved = true;
        }
      }
      // clamp to region every pass so nothing drifts off-sheet
      for (const p of placements) {
        p.cx = Math.min(region.x + region.w - p.w / 2, Math.max(region.x + p.w / 2, p.cx));
        p.cy = Math.min(region.y + region.h - p.h / 2, Math.max(region.y + p.h / 2, p.cy));
      }
      if (!moved) break;
    }
  }
  let scatterSeed = 1;
  function scatterCurrent() {
    const region = sheetRegion(), gap = sheetGap();
    const targets = [];
    if (sheetPair && sheetPair.style.display !== "none") {
      [sheetCanvasL, sheetCanvasR].forEach(cv => {
        if (cv && cv._placements && cv._placements.length > 1) targets.push(cv._placements);
      });
    } else if (composeState.placements.length > 1) targets.push(composeState.placements);
    if (!targets.length) return;
    scatterSeed++;
    targets.forEach(ps => KAOS_GALLERY.repackKeepSizes(ps, region, gap, scatterSeed));
    composeDirty = true;
    if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    else renderCompose();
    showToast("Redistribuido · tamaños intactos");
  }
  // Traduce el modo elegido a lo que entiende el pintado. En «sticker» la luz
  // se fuerza a 0: ese modo es la foto tal cual, y lavarla con papel encima
  // sería justo lo contrario de lo que se busca.
  function aplicarBgMode() {
    const m = composeState.bgMode || "papelFoto";
    // Si no ha elegido foto suya, se usa la foto de fondo de flash de la marca.
    // Antes se pasaba null y el modo «papel + foto» salía sin foto ninguna.
    const foto = composeState.bgImg || KAOS_GALLERY.FONDO_FLASH;
    KAOS_GALLERY.setBgPhoto(m === "papel" ? null : foto);
    composeState.bgPhoto = m !== "papel";
    if (m === "sticker") composeState.bgPhotoLight = 0;
    const fila = $("#bgPhotoLightRow");
    if (fila) fila.style.display = m === "papelFoto" ? "" : "none";
    const aviso = $("#bgFotoAviso");
    if (aviso) {
      // Ya nunca falta foto: si no pone la suya, sale la de fondo de flash.
      aviso.hidden = !!composeState.bgImg;
      aviso.textContent = "Estás usando la foto de fondo de flash de la marca. Elige otra si quieres.";
    }
    document.querySelectorAll("#composeBgModo .tog").forEach((b) => {
      b.setAttribute("aria-selected", b.dataset.bg === m ? "true" : "false");
    });
    const quitar = $("#bgFotoQuitarBtn");
    if (quitar) quitar.disabled = !composeState.bgImg;
  }
  // Encoge la foto de fondo antes de guardarla con la hoja.
  //
  // Entraba en crudo: una foto del movil son 3024x4032 y en base64 casi 1 MB.
  // Medido en sus hojas guardadas: «high contrast» ocupaba 967 KB, de los
  // cuales 965 eran la foto y 1 la colocacion de los disenos. Tres hojas se
  // comian 1,24 MB de los 5 MB que da el navegador para TODO.
  //
  // La hoja se publica a 1400 px de largo, asi que a 1600 sobra y no se nota.
  function encogerFondo(origen) {
    return new Promise((res) => {
      // Por debajo de 120 KB no vale la pena ni mirarlo. Por encima decide el
      // tamaño en píxeles, no el peso: recomprimir una foto que ya está a
      // medida sólo le quita calidad sin ahorrar nada.
      if (!origen || origen.length < 120000) return res(origen);
      const im = new Image();
      im.onload = () => {
        const MAX = 1600;
        let w = im.naturalWidth, h = im.naturalHeight;
        const e = Math.min(1, MAX / Math.max(w, h));
        if (e >= 1 && origen.length < 500000) return res(origen);
        w = Math.round(w * e); h = Math.round(h * e);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const x = c.getContext("2d");
        // Sobre negro: si la foto trae transparencia, el JPG la pondria blanca.
        x.fillStyle = "#000000"; x.fillRect(0, 0, w, h);
        x.drawImage(im, 0, 0, w, h);
        res(c.toDataURL("image/jpeg", 0.85));
      };
      im.onerror = () => res(origen);
      im.src = origen;
    });
  }

  // La pone y repinta. `origen` puede ser un data: o null.
  async function ponerFondo(origen) {
    composeState.bgImg = origen ? await encogerFondo(origen) : null;
    aplicarBgMode();
    composeDirty = true;
    repintarHoja();
  }
  // Un solo sitio que decida qué vista hay que repintar: el composer tiene tres
  // (hoja suelta, par de hojas, y «una hoja por diseño») y equivocarse deja la
  // pantalla como estaba y parece que el botón no hace nada.
  function repintarHoja() {
    if (composeState.sheetMode || (sheetPair && sheetPair.style.display !== "none")) renderSheetPair();
    else renderCompose();
  }

  // Selector de diseños de la galería. Lo usan dos cosas: elegir la foto de
  // fondo, y meter un diseño en la hoja que está abierta. `filtro` deja fuera
  // los que ya están puestos.
  function elegirDeGaleria(alElegir, titulo, filtro) {
    const items = KAOS_GALLERY.load().filter(filtro || (() => true));
    if (!items.length) { showToast("No hay diseños en la galería para eso"); return; }
    const capa = document.createElement("div");
    capa.className = "picker-capa";
    const cab = document.createElement("div");
    cab.className = "picker-cab";
    const t = document.createElement("span");
    t.textContent = titulo || "Elige un diseño";
    const x = document.createElement("button");
    x.className = "icon-btn";
    x.textContent = "✕ CERRAR";
    x.addEventListener("click", () => capa.remove());
    cab.append(t, x);
    const rej = document.createElement("div");
    rej.className = "picker-rej";
    for (const it of items) {
      const b = document.createElement("button");
      b.className = "picker-it";
      const im = document.createElement("img");
      im.src = it.thumbUrl || it.layerUrl;
      im.alt = "";
      b.appendChild(im);
      b.addEventListener("click", () => { capa.remove(); alElegir(it); });
      rej.appendChild(b);
    }
    capa.append(cab, rej);
    capa.addEventListener("click", (e) => { if (e.target === capa) capa.remove(); });
    document.body.appendChild(capa);
  }

  // El panel de ideas vive en otro fichero y no puede llamar a `elegirDeGaleria`
  // directamente. Pide el selector por evento y aquí se le sirve, para no tener
  // dos rejillas de galería distintas que mantener.
  document.addEventListener("kaos-pedir-diseno", (e) => {
    const d = (e && e.detail) || {};
    if (typeof d.alElegir !== "function") return;
    elegirDeGaleria(d.alElegir, d.titulo, d.filtro);
  });

  // Mete en la hoja ABIERTA un diseño que ya está en la galería. Es distinto de
  // «+ IMPORT», que trae ficheros nuevos del disco a la galería y no toca la
  // hoja: ese era el botón que no hacía lo que ella quería.
  function anadirALaHoja(it) {
    if (composeState.selectedIds.indexOf(it.id) < 0) composeState.selectedIds.push(it.id);
    const pa = composeState.pageAssignment;
    if (pa) {
      const p = composeState.pageIndex || 0;
      if (!pa[p]) pa[p] = [];
      if (pa[p].indexOf(it.id) < 0) pa[p].push(it.id);
    }
    composeState.pagePlacements = {};   // la colocación cacheada ya no sirve
    composeState.selectedIndex = null;
    resetPlacements();
    composeDirty = true;
    updatePageToolbar();
    repintarHoja();
    showToast("Añadido a esta hoja");
  }

  function resetPlacements() {
    const items = currentItems();
    if (items.length < 3) { composeState.placements = []; composeState.order = []; return; }
    // ink coverage may not be measured yet on first paint; recompute once (one-shot)
    if (!KAOS_GALLERY.inkMeasured(items) && !composeState._inkPending) {
      composeState._inkPending = true;
      KAOS_GALLERY.measureInk(items).then(() => {
        composeState._inkPending = false;
        composeState.pagePlacements = {};
        resetPlacements();
        if (composeState.sheetMode || (sheetPair && sheetPair.style.display !== "none")) renderSheetPair();
        else renderCompose();
      });
    }
    composeState.placements = KAOS_GALLERY.computeDefaultPlacements(items, {
      width: composeState.width, height: composeState.height,
      bleed: composeState.bleed, layout: composeState.layout, gap: composeState.gap,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
      footerTitle: composeState.footerTitle, footerSize: composeState.footerSize, footerPos: composeState.footerPos,
      seed: composeState.seed,
    });
    composeState.order = items.map((_, i) => i);
  }
  function currentItems() {
    const all = KAOS_GALLERY.load();
    const sel = composeState.selectedIds
      .map(id => all.find(x => x.id === id))
      .filter(Boolean);
    if (sel.length <= PAGE_SIZE && !composeState.pageAssignment) return sel;
    if (composeState.pageAssignment) {
      const ids = composeState.pageAssignment[composeState.pageIndex || 0] || [];
      return ids.map(id => all.find(x => x.id === id)).filter(Boolean);
    }
    const bounds = pageBounds(sel.length)[composeState.pageIndex || 0] || [0, PAGE_SIZE];
    return sel.slice(bounds[0], bounds[1]);
  }

  // ----- drag-to-move on compose canvas -----
  const drag = { active: false, idx: -1, offX: 0, offY: 0, moved: false };
  function composeXY(e) {
    const rect = composeCanvas.getBoundingClientRect();
    const rs = composeCanvas._rscale || 1;
    const sx = composeCanvas.width / rect.width / rs;
    const sy = composeCanvas.height / rect.height / rs;
    return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
  }
  function hitTest(mx, my) {
    for (let i = composeState.order.length - 1; i >= 0; i--) {
      const idx = composeState.order[i];
      const p = composeState.placements[idx];
      if (!p) continue;
      const cos = Math.cos(-(p.rot || 0) * Math.PI / 180);
      const sin = Math.sin(-(p.rot || 0) * Math.PI / 180);
      const dx = mx - p.cx, dy = my - p.cy;
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2) return idx;
    }
    return -1;
  }
  composeCanvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    composeCanvas.setPointerCapture(e.pointerId);
    const [mx, my] = composeXY(e);
    const idx = hitTest(mx, my);
    composeState.selectedIndex = idx >= 0 ? idx : null;
    if (idx >= 0) {
      pushComposeUndo();   // pre-drag state, so ⌘Z puts the design back
      drag.active = true; drag.idx = idx; drag.moved = false;
      drag.offX = mx - composeState.placements[idx].cx;
      drag.offY = my - composeState.placements[idx].cy;
      // bring to front of order on click
      composeState.order = composeState.order.filter(x => x !== idx);
      composeState.order.push(idx);
      composeCanvas.classList.add("dragging");
    }
    updateItemPanel();
    renderCompose();
  });
  composeCanvas.addEventListener("pointermove", (e) => {
    if (!drag.active) return;
    const [mx, my] = composeXY(e);
    const p = composeState.placements[drag.idx];
    p.cx = mx - drag.offX;
    p.cy = my - drag.offY;
    drag.moved = true;
    updateGizmo();
    renderCompose();
  });
  function endDrag() {
    if (drag.active && drag.moved && composeState.placements.length > 1) {
      // Only nudge neighbours the dragged piece actually overlaps — every other
      // piece stays exactly where it was.
      KAOS_GALLERY.nudgeAround(composeState.placements, drag.idx, sheetRegion(), sheetGap());
      composeDirty = true;
      renderCompose();
    }
    drag.active = false;
    composeCanvas.classList.remove("dragging");
  }

  // ----- double-click on size label to edit -----
  composeCanvas.addEventListener("dblclick", (e) => {
    const labels = composeCanvas._sizeLabelPositions;
    if (!labels || !labels.length) return;
    const [mx, my] = composeXY(e);
    for (const lbl of labels) {
      if (Math.abs(mx - lbl.cx) < lbl.w / 2 && Math.abs(my - lbl.cy) < lbl.h / 2) {
        // Show inline input over the label
        const rect = composeCanvas.getBoundingClientRect();
        const sx = rect.width * (composeCanvas._rscale || 1) / composeCanvas.width;
        const screenX = rect.left + lbl.cx * sx;
        const screenY = rect.top + lbl.cy * sx;
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "1";
        inp.max = "200";
        inp.step = "1";
        inp.value = lbl.cm;
        inp.className = "cm-edit-overlay";
        inp.style.cssText = `
          position: fixed; left: ${screenX - 30}px; top: ${screenY - 14}px;
          width: 60px; height: 28px; z-index: 9999;
          background: #1b1916; color: #e5dccd; border: 1px solid #c9342a;
          border-radius: 3px; text-align: center; font: 700 14px "JetBrains Mono", monospace;
          outline: none;
        `;
        document.body.appendChild(inp);
        inp.focus();
        inp.select();
        const commit = () => {
          const v = KAOS_GALLERY.setSize(lbl.id, inp.value);
          inp.remove();
          renderCompose();
        };
        inp.addEventListener("blur", commit);
        inp.addEventListener("keydown", (ke) => {
          if (ke.key === "Enter") { ke.preventDefault(); inp.blur(); }
          if (ke.key === "Escape") { inp.value = lbl.cm; inp.blur(); }
        });
        return;
      }
    }
  });
  composeCanvas.addEventListener("pointerup", endDrag);
  composeCanvas.addEventListener("pointercancel", endDrag);

  // ----- item panel -----
  const itemPanel = $("#composeItemPanel");
  const itemPanelHint = $("#itemPanelHint");
  // The item panel / gizmo act on whichever surface holds the selection: the
  // single big canvas, or one of the two full-size sheet previews.
  function editCanvas() { return composeState.pairActive || composeCanvas; }
  function editPlacements() {
    const c = editCanvas();
    return c === composeCanvas ? composeState.placements : (c._placements || []);
  }
  function editOrder(v) {
    const c = editCanvas();
    if (c === composeCanvas) { if (v) composeState.order = v; return composeState.order; }
    if (v) { c._order = v; const rec = composeState.pagePlacements[c._key]; if (rec) rec.order = v; }
    return c._order || [];
  }
  function editRepaint() {
    const c = editCanvas();
    if (c === composeCanvas) renderCompose(); else repaintPair(c);
  }

  // ============== COMPOSE UNDO / REDO ==============
  // Snapshots exactly the surface editPlacements()/editOrder() expose, so it
  // covers the single sheet and each page of a pair without special-casing.
  // Placements are shallow-cloned (not JSON round-tripped) to keep any image
  // references inside them alive.
  const composeHistory = { undo: [], redo: [], MAX: 40 };
  function composeSnap() {
    return {
      canvas: editCanvas(),
      placements: editPlacements().map(p => Object.assign({}, p)),
      order: (editOrder() || []).slice(),
      selectedIndex: composeState.selectedIndex,
    };
  }
  function composeApply(s) {
    // A snapshot only means anything on the canvas it came from — after a page
    // switch the indices refer to different designs.
    if (s.canvas !== editCanvas()) return false;
    const target = editPlacements();
    target.length = 0;
    for (const p of s.placements) target.push(p);
    editOrder(s.order.slice());
    composeState.selectedIndex = s.selectedIndex;
    composeDirty = true;
    editRepaint();
    updateItemPanel();
    return true;
  }
  function pushComposeUndo() {
    if (!composeView || composeView.style.display === "none") return;
    composeHistory.undo.push(composeSnap());
    if (composeHistory.undo.length > composeHistory.MAX) composeHistory.undo.shift();
    composeHistory.redo.length = 0;
  }
  function composeUndo() {
    while (composeHistory.undo.length) {
      const prev = composeHistory.undo.pop();
      if (prev.canvas !== editCanvas()) continue; // stale: from another page
      const now = composeSnap();
      if (composeApply(prev)) { composeHistory.redo.push(now); return; }
    }
    showToast("Nada que deshacer en la hoja");
  }
  function composeRedo() {
    while (composeHistory.redo.length) {
      const next = composeHistory.redo.pop();
      if (next.canvas !== editCanvas()) continue;
      const now = composeSnap();
      if (composeApply(next)) { composeHistory.undo.push(now); return; }
    }
    showToast("Nada que rehacer en la hoja");
  }
  function editMarkManual() {
    // Sizes stay user-owned but the layout MODE persists (tight stays tight).
    // Positions are reflowed by the silhouette packer at scale/drag end.
    composeDirty = true;
  }
  function editXY(e) { return sheetXY(editCanvas(), e.clientX, e.clientY); }
  $("#itemFwdBtn").addEventListener("click", () => {
    if (composeState.selectedIndex == null) return;
    pushComposeUndo();
    const idx = composeState.selectedIndex;
    editOrder(editOrder().filter(x => x !== idx).concat([idx]));
    editRepaint();
  });
  $("#itemBwdBtn").addEventListener("click", () => {
    if (composeState.selectedIndex == null) return;
    pushComposeUndo();
    const idx = composeState.selectedIndex;
    editOrder([idx].concat(editOrder().filter(x => x !== idx)));
    editRepaint();
  });
  $("#itemRemoveBtn").addEventListener("click", removeSelected);
  function removeSelected() {
    if (composeState.selectedIndex == null) return;
    const idx = composeState.selectedIndex;
    const pc = composeState.pairActive;
    if (pc) {
      const it = pc._items[idx];
      if (it) {
        composeState.selectedIds = composeState.selectedIds.filter(x => x !== it.id);
        composeState.pageAssignment = composeState.pageAssignment.map(g => g.filter(x => x !== it.id));
        if (composeState.pageAssignment.length > 1) composeState.pageAssignment = composeState.pageAssignment.filter(g => g.length > 0);
        if (composeState.pageIndex >= composeState.pageAssignment.length) composeState.pageIndex = composeState.pageAssignment.length - 1;
      }
      clearPairSelection();
      resetPlacements();
      updatePageToolbar();
      renderCompose();
      return;
    }
    composeState.selectedIds.splice(idx, 1);
    composeState.selectedIndex = null;
    if (composeState.selectedIds.length < 3) {
      // bounce back to gallery
      composeView.style.display = "none";
      galleryView.style.display = "";
    syncBotonAnadir();
      renderGalleryGrid();
      return;
    }
    composeState.layout = "tight";
    syncLayoutUI();
    resetPlacements();
    renderCompose();
  }
  function updateItemPanel() {
    if (composeState.selectedIndex == null) {
      itemPanel.style.display = "none";
      updateGizmo();
      return;
    }
    const p = editPlacements()[composeState.selectedIndex];
    if (!p) { itemPanel.style.display = "none"; updateGizmo(); return; }
    itemPanel.style.display = "";
    itemPanelHint.textContent = "#" + (composeState.selectedIndex + 1);
    $("#itemScaleVal").textContent = (p.scale || 1).toFixed(2);
    $("#itemRotVal").textContent = Math.round(p.rot || 0) + "°";
    updateGizmo();
  }

  // ----- on-canvas gizmo (scale corners + rotate handle) -----
  const composeGizmo = $("#composeGizmo");
  const gizmoStick = $("#gizmoStick");
  const gizmoRotate = $("#gizmoRotate");
  const gizmoDelete = $("#gizmoDelete");
  const gizmoCorners = $$(".gizmo-corner", composeGizmo);
  const composeWrap = $(".compose-canvas-wrap");

  function canvasScale() {
    const c = editCanvas();
    const rect = c.getBoundingClientRect();
    return (rect.width * (c._rscale || 1) / c.width) || 1;
  }
  function canvasToWrap(x, y) {
    const cRect = editCanvas().getBoundingClientRect();
    const wRect = composeWrap.getBoundingClientRect();
    const s = canvasScale();
    return { x: (cRect.left - wRect.left) + x * s, y: (cRect.top - wRect.top) + y * s };
  }
  function rotatePt(lx, ly, deg) {
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return [lx * cos - ly * sin, ly * cos + lx * sin];
  }
  function updateGizmo() {
    if (composeState.selectedIndex == null) { composeGizmo.style.display = "none"; return; }
    const p = editPlacements()[composeState.selectedIndex];
    if (!p) { composeGizmo.style.display = "none"; return; }
    composeGizmo.style.display = "";
    const rot = p.rot || 0;
    const hw = p.w / 2, hh = p.h / 2;
    const cornerLocal = {
      nw: [-hw, -hh], ne: [hw, -hh], sw: [-hw, hh], se: [hw, hh],
    };
    gizmoCorners.forEach((el) => {
      const [lx, ly] = cornerLocal[el.dataset.corner];
      const [rx, ry] = rotatePt(lx, ly, rot);
      const pt = canvasToWrap(p.cx + rx, p.cy + ry);
      el.style.left = pt.x + "px";
      el.style.top = pt.y + "px";
    });
    const gap = 46;
    const [rux, ruy] = rotatePt(0, -hh - gap, rot);
    const rotPt = canvasToWrap(p.cx + rux, p.cy + ruy);
    gizmoRotate.style.left = rotPt.x + "px";
    gizmoRotate.style.top = rotPt.y + "px";
    const [tux, tuy] = rotatePt(0, -hh, rot);
    const [rdx, rdy] = rotatePt(0, hh + gap * 0.7, rot);
    const delPt = canvasToWrap(p.cx + rdx, p.cy + rdy);
    gizmoDelete.style.left = delPt.x + "px";
    gizmoDelete.style.top = delPt.y + "px";
    const topPt = canvasToWrap(p.cx + tux, p.cy + tuy);
    const dx = rotPt.x - topPt.x, dy = rotPt.y - topPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx) * 180 / Math.PI - 90;
    gizmoStick.style.left = topPt.x + "px";
    gizmoStick.style.top = topPt.y + "px";
    gizmoStick.style.height = len + "px";
    gizmoStick.style.transform = `rotate(${ang}deg)`;
  }

  // quick delete: drop the selected design out of this sheet
  function deleteSelectedDesign() {
    const idx = composeState.selectedIndex;
    if (idx == null) return;
    const cv = composeState.pairActive;
    const items = (cv && cv._items) ? cv._items : currentItems();
    const it = items[idx];
    if (!it) return;
    pushComposeUndo();
    if (cv && cv._items && composeState.pageAssignment) {
      const arr = composeState.pageAssignment[cv._pageIdx] || [];
      const p = arr.indexOf(it.id);
      if (p >= 0) arr.splice(p, 1);
    } else if (composeState.pageAssignment) {
      composeState.pageAssignment.forEach(a => { const p = a.indexOf(it.id); if (p >= 0) a.splice(p, 1); });
    }
    composeState.selectedIds = composeState.selectedIds.filter(x => x !== it.id);
    composeState.selectedIndex = null;
    composeState.pairActive = null;
    composeState.pagePlacements = {};
    resetPlacements();
    updatePageToolbar();
    updateGizmo();
    if (sheetPair && sheetPair.style.display !== "none") renderSheetPair();
    else renderCompose();
    showToast("Diseño quitado del sheet");
  }
  // Do the delete on pointerdown: preventDefault() here suppresses the synthetic
  // click on touch, which is why the ✕ did nothing on the iPad.
  let delGuard = 0;
  gizmoDelete.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    delGuard = Date.now();
    deleteSelectedDesign();
  });
  gizmoDelete.addEventListener("click", (e) => {
    e.stopPropagation();
    if (Date.now() - delGuard < 700) return; // already handled by pointerdown
    deleteSelectedDesign();
  });
  window.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && composeState.selectedIndex != null
        && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "")) {
      e.preventDefault();
      deleteSelectedDesign();
    }
  });

  let gizmoDrag = null; // { mode: 'scale'|'rotate', idx, cx, cy, startDist, startScale, baseW, baseH, startAngle, startRot }
  function gizmoPointerDown(mode, corner) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = composeState.selectedIndex;
      if (idx == null) return;
      const p = editPlacements()[idx];
      if (!p) return;
      const [mx, my] = editXY(e);
      if (mode === "scale") {
        const dist = Math.hypot(mx - p.cx, my - p.cy) || 1;
        gizmoDrag = { mode, idx, cx: p.cx, cy: p.cy, startDist: dist, startScale: p.scale || 1, baseW: p.baseW, baseH: p.baseH };
      } else {
        const ang = Math.atan2(my - p.cy, mx - p.cx) * 180 / Math.PI;
        gizmoDrag = { mode, idx, cx: p.cx, cy: p.cy, startAngle: ang, startRot: p.rot || 0 };
      }
      e.target.setPointerCapture(e.pointerId);
      pushComposeUndo();   // capture the pre-drag state, before any movement
      editMarkManual();
    };
  }
  gizmoCorners.forEach((el) => el.addEventListener("pointerdown", gizmoPointerDown("scale", el.dataset.corner)));
  gizmoRotate.addEventListener("pointerdown", gizmoPointerDown("rotate"));
  window.addEventListener("pointermove", (e) => {
    if (!gizmoDrag) return;
    const p = editPlacements()[gizmoDrag.idx];
    if (!p) return;
    const [mx, my] = editXY(e);
    if (gizmoDrag.mode === "scale") {
      const dist = Math.hypot(mx - gizmoDrag.cx, my - gizmoDrag.cy) || 1;
      const s = Math.max(0.2, Math.min(3.5, gizmoDrag.startScale * (dist / gizmoDrag.startDist)));
      p.scale = s;
      p.w = gizmoDrag.baseW * s;
      p.h = gizmoDrag.baseH * s;
      $("#itemScaleVal").textContent = s.toFixed(2);
    } else {
      const ang = Math.atan2(my - gizmoDrag.cy, mx - gizmoDrag.cx) * 180 / Math.PI;
      let rot = gizmoDrag.startRot + (ang - gizmoDrag.startAngle);
      while (rot > 180) rot -= 360;
      while (rot < -180) rot += 360;
      p.rot = rot;
      $("#itemRotVal").textContent = Math.round(rot) + "°";
    }
    updateGizmo();
    editRepaint();
  });
  function relaxAfterResize() {
    if (!gizmoDrag || gizmoDrag.mode !== "scale") return;
    const ps = editPlacements();
    const region = KAOS_GALLERY.usableRegion({
      width: composeState.width, height: composeState.height, bleed: composeState.bleed,
      title: composeState.title, handle: composeState.handle, footer: composeState.footer,
    });
    const gap = sheetGap();
    // Only nudge neighbours that actually overlap the just-scaled piece.
    // Every other piece stays exactly where it was; layout mode is untouched.
    KAOS_GALLERY.nudgeAround(ps, gizmoDrag.idx, region, gap);
    composeDirty = true;
    gizmoDrag = null;
    editRepaint();
    updateGizmo();
  }
  window.addEventListener("pointerup", () => { relaxAfterResize(); gizmoDrag = null; });
  window.addEventListener("pointercancel", () => { gizmoDrag = null; });
  window.addEventListener("resize", () => updateGizmo());

  // ----- compose render (rAF-debounced) -----
  let composeRAF = null;
  function renderCompose() {    return new Promise((resolve) => {
      if (composeRAF) cancelAnimationFrame(composeRAF);
      composeRAF = requestAnimationFrame(async () => {
        composeRAF = null;
        if (composeState.sheetMode) {
          const it = composeState.sheetTargets[composeState.sheetIndex];
          if (it) await renderOneSheet(composeCanvas, it);
          resolve();
          return;
        }
        const items = currentItems();
        if (items.length < 3) { resolve(); return; }
        const rs = previewScale();
        const pw = Math.round(composeState.width * rs), ph = Math.round(composeState.height * rs);
        if (composeCanvas.width !== pw || composeCanvas.height !== ph) {
          composeCanvas.width = pw;
          composeCanvas.height = ph;
        }
        composeCanvas._rscale = rs;
        await pintarHoja(composeCanvas, items, {
          renderScale: rs,
          paper: composeState.paper,
          bleed: composeState.bleed,
          bgPhoto: composeState.bgPhoto,
          bgPhotoOpacity: composeState.bgPhotoOpacity,
          bgPhotoLight: composeState.bgPhotoLight,
          placements: composeState.placements,
          order: composeState.order,
          layout: composeState.layout,
          title: composeState.title,
          handle: composeState.handle,
          footer: composeState.footer,
          footerTitle: composeState.footerTitle,
          footerSize: composeState.footerSize,
          footerPos: composeState.footerPos,
          titleFont: composeState.titleFont,
          handleFont: composeState.handleFont,
          stampFont: composeState.stampFont,
          stampText: composeState.stampText,
          stamps: composeState.stamps,
          stampSize: composeState.stampSize,
          stampOpacity: composeState.stampOpacity,
          shadow: composeState.shadow,
          seed: composeState.seed,
          showSizes: composeState.showSizes,
          cornerStyle: composeState.cornerStyle,
          brandPrimary: composeState.brandPrimary,
          brandSecondary: composeState.brandSecondary,
          titleColor: composeState.titleColor,
          handleColor: composeState.handleColor,
          footerColor: composeState.footerColor,
          stampColor: composeState.stampColor,
          watermarkColor: composeState.watermarkColor,
          cornerColor: composeState.cornerColor,
          logoColor: composeState.logoColor,
          selectedIndex: composeState.selectedIndex,
        }, { placements: composeState.placements, order: composeState.order, layout: composeState.layout });
        updateGizmo();
        resolve();
      });
    }).then(() => {
      if (sheetPair && sheetPair.style.display !== "none" && !composeState.sheetMode) return renderSheetPair();
    });
  }

  // ============== AI DIALOGS ==============
  const aiOverlay = $("#aiOverlay");
  const aiVarOverlay = $("#aiVarOverlay");
  const aiTitle = $("#aiTitle");
  const aiPromptInput = $("#aiPromptInput");
  const aiPromptLabel = $("#aiPromptLabel");
  const aiElementsBlock = $("#aiElementsBlock");
  const aiPresets = $("#aiPresets");
  const aiStatus = $("#aiStatus");
  const aiGoBtn = $("#aiGoBtn");
  const aiModeBlock = $("#aiModeBlock");
  let aiCurrentTask = null;
  let aiMode = "fal"; // 'fal' | 'tweaks'

  // ============== HF / GRADIO CONNECT ==============
  const falChip = $("#falChip");
  const falState = $("#falState");
  const falConfigBtn = $("#falConfigBtn");
  const falModal = $("#falModal");
  const falModalCloseBtn = $("#falModalCloseBtn");
  const falKeyInput = $("#falKeyInput");
  const falKeyShowBtn = $("#falKeyShowBtn");
  const falKeyHint = $("#falKeyHint");
  const falModelList = $("#falModelList");
  const falSaveBtn = $("#falSaveBtn");
  const falDisconnectBtn = $("#falDisconnectBtn");
  const falModalStatus = $("#falModalStatus");
  const hfStepsInput = $("#hfSteps");
  const hfStepsVal = $("#hfStepsVal");
  const hfGuidanceInput = $("#hfGuidance");
  const hfGuidanceVal = $("#hfGuidanceVal");
  const hfSizeInput = $("#hfSize");
  const hfSizeVal = $("#hfSizeVal");
  const gemKeyInput = $("#gemKeyInput");
  const gemKeyShowBtn = $("#gemKeyShowBtn");
  const gemModelList = $("#gemModelList");
  const gemEditChk = $("#gemEditChk");
  const genProviderRow = $("#genProviderRow");
  const genGeminiBlock = $("#genGeminiBlock");
  const genHfBlock = $("#genHfBlock");
  const falLabel = $("#falLabel");
  let falModalSelectedSpace = null;
  let genProvider = "gemini";
  let gemSelectedModel = null;

  function updateFalChip() {
    if (!window.KAOS_HF) return;
    const cfg = KAOS_HF.getConfig();
    const ready = KAOS_HF.connected();
    falChip.dataset.state = ready ? "on" : "off";
    if (falLabel) falLabel.textContent = KAOS_HF.providerLabel();
    if (!cfg.enabled) { falState.textContent = "disabled"; return; }
    if (cfg.provider === "gemini") {
      falState.textContent = cfg.geminiKey ? (cfg.geminiEdit ? "edita tu foto" : "crea nueva") : "falta API key";
    } else {
      falState.textContent = (cfg.hfToken ? "auth" : "anon");
    }
  }
  function renderGemModelList() {
    if (!window.KAOS_GEMINI || !gemModelList) return;
    const sel = gemSelectedModel || KAOS_HF.getConfig().geminiModel;
    gemModelList.innerHTML = "";
    for (const m of KAOS_GEMINI.listModels()) {
      const b = document.createElement("button");
      b.className = "fal-model";
      b.type = "button";
      b.setAttribute("aria-selected", m.id === sel ? "true" : "false");
      b.innerHTML = '<span class="name">' + m.label + '</span><span class="sub">' + m.sub + '</span>';
      b.addEventListener("click", () => { gemSelectedModel = m.id; renderGemModelList(); });
      gemModelList.appendChild(b);
    }
  }
  function syncProviderUI() {
    $$("#genProviderRow .tog").forEach(b => b.setAttribute("aria-selected", b.dataset.provider === genProvider ? "true" : "false"));
    genGeminiBlock.style.display = genProvider === "gemini" ? "" : "none";
    genHfBlock.style.display = genProvider === "hf" ? "" : "none";
  }
  if (genProviderRow) $$("#genProviderRow .tog").forEach(b => b.addEventListener("click", () => {
    genProvider = b.dataset.provider;
    syncProviderUI();
  }));
  if (gemKeyShowBtn) gemKeyShowBtn.addEventListener("click", () => {
    gemKeyInput.type = gemKeyInput.type === "password" ? "text" : "password";
  });
  function renderFalModelList() {
    if (!window.KAOS_HF) return;
    const cfg = KAOS_HF.getConfig();
    const selected = falModalSelectedSpace || cfg.spaceId;
    falModelList.innerHTML = "";
    for (const s of KAOS_HF.listSpaces()) {
      const b = document.createElement("button");
      b.className = "fal-model";
      b.type = "button";
      b.setAttribute("aria-selected", s.id === selected ? "true" : "false");
      b.innerHTML = `<span class="name">${s.label}</span><span class="sub">${s.sub} · ${s.id}</span>`;
      b.addEventListener("click", () => {
        falModalSelectedSpace = s.id;
        renderFalModelList();
      });
      falModelList.appendChild(b);
    }
  }
  function openFalModal() {
    if (!window.KAOS_HF) return;
    const cfg = KAOS_HF.getConfig();
    genProvider = cfg.provider || "gemini";
    gemSelectedModel = cfg.geminiModel;
    gemKeyInput.value = cfg.geminiKey || "";
    gemKeyInput.type = "password";
    gemEditChk.checked = cfg.geminiEdit !== false;
    renderGemModelList();
    syncProviderUI();
    falKeyInput.value = cfg.hfToken || "";
    falKeyInput.type = "password";
    falModalStatus.textContent = "";
    falModalSelectedSpace = cfg.spaceId;
    hfStepsInput.value = cfg.steps;
    hfStepsVal.textContent = cfg.steps;
    hfGuidanceInput.value = cfg.guidance;
    hfGuidanceVal.textContent = (+cfg.guidance).toFixed(2);
    hfSizeInput.value = cfg.size;
    hfSizeVal.textContent = cfg.size;
    renderFalModelList();
    falModal.style.display = "";
    setTimeout(() => falKeyInput.focus(), 60);
  }
  function closeFalModal() { falModal.style.display = "none"; }
  falConfigBtn.addEventListener("click", openFalModal);
  falModalCloseBtn.addEventListener("click", closeFalModal);
  falKeyShowBtn.addEventListener("click", () => {
    falKeyInput.type = falKeyInput.type === "password" ? "text" : "password";
  });
  hfStepsInput.addEventListener("input", () => { hfStepsVal.textContent = hfStepsInput.value; });
  hfGuidanceInput.addEventListener("input", () => { hfGuidanceVal.textContent = (+hfGuidanceInput.value).toFixed(2); });
  hfSizeInput.addEventListener("input", () => { hfSizeVal.textContent = hfSizeInput.value; });
  falSaveBtn.addEventListener("click", () => {
    KAOS_HF.setConfig({
      provider: genProvider,
      geminiKey: gemKeyInput.value.trim(),
      geminiModel: gemSelectedModel || KAOS_HF.getConfig().geminiModel,
      geminiEdit: !!gemEditChk.checked,
      hfToken: falKeyInput.value.trim(),
      spaceId: falModalSelectedSpace || KAOS_HF.getConfig().spaceId,
      steps: parseInt(hfStepsInput.value, 10),
      guidance: parseFloat(hfGuidanceInput.value),
      size: parseInt(hfSizeInput.value, 10),
      enabled: true,
    });
    if (genProvider === "gemini" && !gemKeyInput.value.trim()) {
      falModalStatus.textContent = "Guardado, pero falta la API key de Gemini.";
      updateFalChip();
      return;
    }
    falModalStatus.textContent = "Guardado.";
    updateFalChip();
    setTimeout(closeFalModal, 600);
  });
  falDisconnectBtn.addEventListener("click", () => {
    if (!confirm("¿Borrar la configuración de IA (keys + parámetros)?")) return;
    KAOS_HF.clearConfig();
    gemKeyInput.value = "";
    falKeyInput.value = "";
    falModalStatus.textContent = "Reset.";
    updateFalChip();
    openFalModal(); // re-render with defaults
  });
  falModal.addEventListener("click", (e) => { if (e.target === falModal) closeFalModal(); });
  updateFalChip();

  function openAi(task) {
    aiCurrentTask = task;
    aiOverlay.style.display = "";
    aiStatus.textContent = "";
    aiGoBtn.disabled = false;
    aiTitle.textContent = task.title;
    aiPromptLabel.textContent = task.promptLabel;
    aiPromptInput.placeholder = task.placeholder;
    aiPromptInput.value = task.defaultValue || "";

    // Gemini can EDIT the photo you already have or CREATE a new one — pick here.
    aiMode = "fal";
    const gemCfg = window.KAOS_HF ? KAOS_HF.getConfig() : {};
    if (task.modeToggle && gemCfg.provider === "gemini") {
      aiModeBlock.style.display = "";
      syncGemEditRow();
      updateAiModeUI(task);
    } else {
      aiModeBlock.style.display = "none";
      if (task.modeToggle) updateAiModeUI(task);
    }

    // elements block — caller may pass array of {id, thumbUrl, name, onNameChange}
    if (task.elements && task.elements.length) {
      aiElementsBlock.style.display = "";
      const list = $("#aiElements");
      list.innerHTML = "";
      task.elements.forEach((el) => {
        const row = document.createElement("div");
        row.className = "ai-elem-row";
        const safe = (el.name || "").replace(/"/g, "&quot;");
        row.innerHTML = `
          <img src="${el.thumbUrl || ""}" alt="">
          <input type="text" value="${safe}" placeholder="name this element" maxlength="32">
        `;
        const inp = row.querySelector("input");
        inp.addEventListener("input", () => { if (el.onNameChange) el.onNameChange(inp.value); });
        list.appendChild(row);
      });
    } else {
      aiElementsBlock.style.display = "none";
    }
    aiPresets.innerHTML = "";
    if (task.presets) {
      for (const p of task.presets) {
        const b = document.createElement("button");
        b.className = "ai-preset";
        b.textContent = p;
        b.addEventListener("click", () => { aiPromptInput.value = p; });
        aiPresets.appendChild(b);
      }
    }
    setTimeout(() => aiPromptInput.focus(), 50);
  }
  function closeAi() {
    aiOverlay.style.display = "none";
    aiCurrentTask = null;
  }
  $("#aiCloseBtn").addEventListener("click", closeAi);
  $("#aiCancelBtn").addEventListener("click", closeAi);

  // EDIT MY PHOTO / CREATE NEW (Gemini only)
  function syncGemEditRow() {
    const cfg = window.KAOS_HF ? KAOS_HF.getConfig() : {};
    const on = cfg.geminiEdit !== false;
    $$('#aiGemEditRow .tog').forEach(b => {
      b.setAttribute("aria-selected", ((b.dataset.gemedit === "1") === on) ? "true" : "false");
    });
  }
  $$('#aiGemEditRow .tog').forEach(btn => {
    btn.addEventListener("click", () => {
      if (!window.KAOS_HF) return;
      const wantEdit = btn.dataset.gemedit === "1";
      KAOS_HF.setConfig({ geminiEdit: wantEdit });
      if (gemEditChk) gemEditChk.checked = wantEdit;
      syncGemEditRow();
      if (aiCurrentTask) updateAiModeUI(aiCurrentTask);
      if (typeof updateFalChip === "function") updateFalChip();
    });
  });

  function updateAiModeUI(task) {
    const canEdit = window.KAOS_HF && KAOS_HF.canEdit();
    aiTitle.textContent = task.title + (canEdit ? " · editar" : " · crear");
    aiPromptLabel.textContent = canEdit ? "Qué quieres cambiar en la foto" : "Describe la imagen nueva";
    aiPromptInput.placeholder = canEdit
      ? "p. ej. ponle un casco de gladiador, quita el fondo, más sombras duras"
      : (task.falPlaceholder || "describe la imagen entera que quieres generar");
    aiPresets.innerHTML = "";
    const presets = canEdit ? (task.editPresets || DEFAULT_EDIT_PRESETS) : (task.falPresets || DEFAULT_FAL_PRESETS);
    for (const p of presets) {
      const b = document.createElement("button");
      b.className = "ai-preset";
      b.textContent = p;
      b.addEventListener("click", () => { aiPromptInput.value = p; });
      aiPresets.appendChild(b);
    }
  }

  const DEFAULT_EDIT_PRESETS = [
    "quita el fondo por completo, deja solo el sujeto sobre blanco",
    "luz más dura y direccional, sombras profundas, blanco y negro marcado",
    "convierte esto en un grabado a plumilla, líneas finas, sin color",
    "añade humo y polvo alrededor del sujeto",
    "más detalle y textura en la piel y el metal",
    "recorta a primer plano centrado del sujeto",
  ];

  const DEFAULT_FAL_PRESETS = [
    "convert into a traditional black-ink tattoo flash, no color, pure black on cream paper",
    "transform into a 19th-century stippled engraving with fine dotwork on aged paper",
    "render as a rough medieval woodcut print, harsh hand-carved lines, Dürer style",
    "make it surreal Dalí-inspired, melting and dreamlike, grayscale, paper grain",
    "add bold dramatic shadows, deep blacks, high contrast blackwork tattoo style",
    "redraw as Japanese irezumi linework, bold black outlines, no color",
  ];
  aiGoBtn.addEventListener("click", async () => {
    if (!aiCurrentTask) return;
    aiGoBtn.disabled = true;
    aiStatus.textContent = "Generando con " + (window.KAOS_HF ? KAOS_HF.providerLabel() : "IA") + "…";
    try {
      await aiCurrentTask.run(aiPromptInput.value, aiMode);
      closeAi();
    } catch (e) {
      console.error(e);
      aiStatus.textContent = (aiMode === "fal" ? "HF failed: " : "AI failed: ") + (e && e.message || e);
      aiGoBtn.disabled = false;
    }
  });

  // Helper: replace state.img with a new image (e.g. from HF) and re-pipeline
  function adoptFromImage(img, opts) {
    const MAX = 1400;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const s = Math.min(1, MAX / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    adoptSourceCanvas(c, opts || {});
  }

  // ---- PROMPT (Gemini: edit the current photo, or generate a new one) ----
  // Removed from the UI: ai.js needs window.claude.complete, which only exists
  // inside the Claude Artifacts sandbox — it can never work when self-hosted.
  $("#aiPromptBtn")?.addEventListener("click", () => {
    if (!state.img) { alert("Upload or compose an image first."); return; }
    if (!(window.KAOS_HF && KAOS_HF.connected())) {
      alert("Configura la IA de imágenes: pulsa CONFIGURE en la barra lateral y pega tu API key de Gemini.");
      return;
    }
    openAi({
      title: "Prompt",
      modeToggle: true,
      promptLabel: "Qué quieres cambiar en la foto",
      placeholder: "p. ej. ponle un casco de gladiador, quita el fondo, más sombras duras",
      falPlaceholder: "describe la imagen entera que quieres generar",
      run: async (prompt) => {
        if (!prompt.trim()) throw new Error("Escribe qué quieres hacer.");
        const editing = KAOS_HF.canEdit();
        aiStatus.textContent = editing ? "Editando tu foto…" : "Generando imagen nueva…";
        const img = await KAOS_HF.generate({
          prompt,
          sourceCanvas: originalImg || state.img,
          onProgress: (s) => { aiStatus.textContent = KAOS_HF.providerLabel() + " · " + s; },
        });
        adoptFromImage(img);
        showToast("✨ " + (editing ? "Foto editada · " : "Imagen generada · ") + prompt.slice(0, 60));
      },
    });
  });

  function clampTweaksInPlace(style, t) {
    const lim = (k, lo, hi) => { if (k in t) t[k] = Math.max(lo, Math.min(hi, +t[k] || 0)); };
    if (style === "surrealist") {
      lim("bp",0,120); lim("wp",160,255); lim("gamma",0.4,1.6); lim("contrast",0.5,2.5); lim("grain",0,60);
      ["bp","wp","grain"].forEach(k => { if (k in t) t[k] = Math.round(t[k]); });
    } else if (style === "threshold") {
      lim("bp",0,200); lim("wp",55,255); lim("gamma",0.3,2.5); lim("localBoost",0,3); lim("smooth",0,6);
      lim("threshold",20,240); lim("stippleOpacity",5,100); lim("windowSize",3,80); lim("bias",0,60); lim("outlineWidth",0,5); lim("despeckle",0,100);
      ["bp","wp","smooth","threshold","stippleOpacity","windowSize","bias","despeckle"].forEach(k => { if (k in t) t[k] = Math.round(t[k]); });
      if ("mode" in t && !["hard","dotwork","adaptive","edges"].includes(t.mode)) delete t.mode;
    } else if (style === "calco") {
      lim("bp",0,200); lim("wp",55,255); lim("gamma",0.3,2.5);
      lim("sensitivity",0,100); lim("detail",0,100); lim("blur",0,12); lim("gapClose",0,5); lim("thickness",0,5); lim("clean",0,100);
      ["bp","wp","sensitivity","detail","blur","gapClose","thickness","clean"].forEach(k => { if (k in t) t[k] = Math.round(t[k]); });
    }
  }

  // ---- VARIATIONS ----
  const aiVarGrid = $("#aiVarGrid");
  const aiVarStatus = $("#aiVarStatus");
  $("#aiVarCloseBtn").addEventListener("click", () => aiVarOverlay.style.display = "none");
  $("#aiVarRegen").addEventListener("click", () => runVariations());
  // Removed from the UI — same reason as aiPromptBtn above.
  $("#aiVariationsBtn")?.addEventListener("click", () => {
    if (!state.img) { alert("Upload or compose an image first."); return; }
    const hfOn = window.KAOS_HF && KAOS_HF.connected();
    const claudeOn = window.KAOS_AI && KAOS_AI.available();
    if (!hfOn && !claudeOn) { alert("Configure HF Gradio (CONFIGURE in sidebar) or run in an environment with Claude available."); return; }
    aiVarOverlay.style.display = "";
    runVariations();
  });

  async function runVariations() {
    aiVarGrid.innerHTML = "";
    const hfOn = window.KAOS_HF && KAOS_HF.connected();
    if (hfOn) {
      await runHfVariations();
    } else {
      await runTweakVariations();
    }
  }

  // ---- HF-mode variations: real image generation via Gradio Space ----
  async function runHfVariations() {
    aiVarStatus.textContent = "Asking AI for 4 prompt directions…";
    let briefs;
    try {
      if (window.KAOS_AI && KAOS_AI.available()) {
        briefs = await KAOS_AI.suggestFalVariationBriefs("");
      } else {
        briefs = KAOS_HF.DEFAULT_VARIATION_BRIEFS;
      }
    } catch (e) {
      console.warn("Brief generation failed, using defaults:", e);
      briefs = KAOS_HF.DEFAULT_VARIATION_BRIEFS;
    }

    aiVarGrid.innerHTML = "";
    const cards = briefs.map((v) => {
      const card = document.createElement("div");
      card.className = "ai-var-card loading";
      card.innerHTML = `
        <div class="thumb" style="aspect-ratio: 1/1; background:#1b1916"></div>
        <div class="meta">
          <div class="name">${escapeAttr(v.name)}</div>
          <div class="vtags"><span class="vtag fal">${escapeAttr(KAOS_HF.providerLabel())}</span></div>
          <div class="blurb">${escapeAttr(v.blurb || "")}</div>
        </div>
        <div class="progress" data-progress>QUEUED</div>
      `;
      aiVarGrid.appendChild(card);
      return card;
    });
    aiVarStatus.textContent = "Generating 4 variations on Hugging Face · this may take 20-60s…";

    const results = await KAOS_HF.generateVariations(briefs, (i, status) => {
      const p = cards[i] && cards[i].querySelector("[data-progress]");
      if (p) p.textContent = status;
    }, { sourceCanvas: originalImg || state.img });

    let okCount = 0;
    for (let i = 0; i < briefs.length; i++) {
      const card = cards[i];
      const result = results[i];
      const prog = card.querySelector("[data-progress]");
      if (prog) prog.remove();
      card.classList.remove("loading");
      if (result instanceof Error) {
        card.classList.add("errored");
        const err = document.createElement("div");
        err.className = "err-msg";
        err.textContent = (result.message || "Failed").slice(0, 140);
        card.appendChild(err);
        continue;
      }
      okCount++;
      const thumb = card.querySelector(".thumb");
      const img = document.createElement("img");
      img.className = "thumb";
      const c = document.createElement("canvas");
      c.width = result.naturalWidth || result.width;
      c.height = result.naturalHeight || result.height;
      c.getContext("2d").drawImage(result, 0, 0);
      img.src = c.toDataURL("image/jpeg", 0.85);
      thumb.replaceWith(img);
      card.addEventListener("click", () => {
        adoptFromImage(result);
        showToast("✨ HF variation applied · " + briefs[i].name);
        aiVarOverlay.style.display = "none";
      });
      card.style.cursor = "pointer";
    }
    aiVarStatus.textContent = okCount + " / " + briefs.length + " generated. Click one to adopt it as your new source image.";
  }

  // ---- TWEAK-mode variations: legacy slider/style variations ----
  async function runTweakVariations() {
    aiVarStatus.textContent = "Generating four bold directions on your current image…";
    try {
      const variations = await KAOS_AI.suggestVariations(state.style, state.tweaks[state.style], state.shape, state.paper, "");
      variations.forEach(v => clampTweaksInPlace(v.style, v.tweaks));
      variations.forEach(v => { v.shape = "none"; }); // frame feature removed
      aiVarStatus.textContent = "Rendering previews…";
      const previews = await Promise.all(variations.map(v => renderVariantPreview(v)));
      aiVarGrid.innerHTML = "";
      for (let i = 0; i < variations.length; i++) {
        const v = variations[i];
        const card = document.createElement("div");
        card.className = "ai-var-card";
        const tagBits = [
          `<span class="vtag">${(v.style||state.style).slice(0,5).toUpperCase()}</span>`,
          v.tweaks && v.tweaks.mode ? `<span class="vtag mode">${v.tweaks.mode.toUpperCase()}</span>` : "",
          v.shape && v.shape !== "none" ? `<span class="vtag">${v.shape.toUpperCase()}</span>` : "",
          v.paper ? `<span class="vtag paper" style="background:${v.paper}"></span>` : "",
        ].filter(Boolean).join("");
        card.innerHTML = `
          <img class="thumb" src="${previews[i]}" alt="">
          <div class="meta">
            <div class="name">${escapeAttr(v.name || ("Variant " + (i+1)))}</div>
            <div class="vtags">${tagBits}</div>
            <div class="blurb">${escapeAttr(v.blurb || "")}</div>
          </div>
        `;
        card.addEventListener("click", () => {
          applyVariation(v);
          aiVarOverlay.style.display = "none";
        });
        aiVarGrid.appendChild(card);
      }
      aiVarStatus.textContent = "Click a direction to apply it. Each one shifts style, mode, paper or frame — not just a number.";
    } catch (e) {
      console.error(e);
      aiVarStatus.textContent = "AI failed: " + (e && e.message || e);
    }
  }

  function applyVariation(v) {
    pushStyleUndo();
    // Style switch (also flips ctl-group)
    if (v.style && v.style !== state.style) switchStyle(v.style);
    const style = v.style || state.style;
    // Tweaks
    Object.assign(state.tweaks[style], v.tweaks || {});
    syncSliders(style);
    if (v.tweaks && v.tweaks.mode) {
      $$('.tog[data-section="threshold"][data-tweak="mode"]').forEach(b => {
        b.setAttribute("aria-selected", b.dataset.val === v.tweaks.mode);
      });
      updateThreshModeUI();
    }
    // Paper
    if (v.paper) setActivePaper(v.paper, true);
    // Shape
    if (v.shape) {
      state.shape = v.shape;
      $$('#shapes .tog').forEach(b => b.setAttribute("aria-selected", b.dataset.shape === v.shape));
    }
    flashAutoTune();
    schedule();
  }
  function escapeAttr(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }

  async function renderVariantPreview(v) {
    const workSrc = state.mask.anyChanges ? KAOS.maskSource(state.img, state.mask.data) : state.img;
    const MAX = 360;
    let w = workSrc.width, h = workSrc.height;
    const s = Math.min(1, MAX / Math.max(w, h));
    w = Math.round(w * s); h = Math.round(h * s);
    const small = document.createElement("canvas");
    small.width = w; small.height = h;
    small.getContext("2d").drawImage(workSrc, 0, 0, w, h);
    const style = v.style || state.style;
    const tweaks = Object.assign({}, state.tweaks[style], v.tweaks || {});
    let layer;
    if (style === "surrealist") layer = KAOS.styleSurrealist(small, tweaks);
    else if (style === "calco") layer = KAOS.styleCalco(small, tweaks);
    else layer = KAOS.styleThreshold(small, tweaks);
    if (v.shape && v.shape !== "none") layer = KAOS.applyShape(layer, v.shape, 0.04);
    const paper = v.paper || state.paper;
    const composed = KAOS.composeOnPaper(layer, paper, state.tweaks.compose);
    return composed.toDataURL("image/jpeg", 0.82);
  }

  // ============== PUBLIC API ==============
  window.KAOS_APP = {
    // Lo pregunta surreal.js: si NO hay foto en el lienzo principal, el collage
    // se queda puesto haciendo de pantalla de inicio. Si la hay, el collage se
    // aparta y deja ver el dibujo.
    hayImagen: () => !!state.img,
    // Lo llama surreal.js cuando ella anade fotos con el doble clic en el
    // lienzo. Tiene que pasar por aqui y no por addFiles a secas: si ya habia
    // una foto suelta en el estilo, esta funcion la mete en el collage antes
    // que la nueva. Yendo derecho a addFiles, la primera se quedaba fuera.
    recibirFotos,
    setSourceCanvas: function (canvas, opts) { adoptSourceCanvas(canvas, opts || {}); },
    autoTuneCurrent: autoTuneCurrent,
    switchStyle: switchStyle,
    openAi: openAi,
    closeAi: closeAi,
    previewSurrealStyle: async function (canvas, maxLado, masks) {
      if (!window.KAOS) return null;
      const MAX = maxLado || 420;
      let w = canvas.width, h = canvas.height;
      const s = Math.min(1, MAX / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const small = document.createElement("canvas");
      small.width = w; small.height = h;
      small.getContext("2d").drawImage(canvas, 0, 0, w, h);
      const t = state.tweaks;
      let layer;
      if (state.style === "surrealist") layer = KAOS.styleSurrealist(small, t.surrealist);
      else if (state.style === "calco") layer = KAOS.styleCalco(small, t.calco);
      else layer = KAOS.styleThreshold(small, t.threshold);
      layer = teñirCapa(layer, masks);
      if (invertEnabled) layer = invertCanvas(layer);
      if (distressEnabled) layer = KAOS.distressLayer(layer, distressAmount, distressNoiseType, distressSeed, null, wearOpts());
      if (state.shape !== "none") layer = KAOS.applyShape(layer, state.shape, 0.04, state.shapeXf, state.shapeOutline, state.shapeFill);
      if (textOverlay.enabled && textOverlay.text) layer = KAOS.drawTextOverlay(layer, textOverlay);
      return KAOS.composeOnPaper(layer, state.paper, t.compose);
    },
  };
})();
