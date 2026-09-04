/* KAOS · Escanear libreta
   Toma una foto de la libreta con varios diseños dibujados en papel,
   detecta cada diseño como un blob (dilate + connected components),
   deja al usuario marcar cuáles quiere, y exporta cada uno como PNG
   con fondo transparente (paper → alpha 0). */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let imgCanvas = null;           // copia a 2000 px: lo que se ve y sobre lo que se detecta
  let fullImg = null;             // la foto ORIGINAL, intacta — de aqui sale el recorte final
  let fullURL = null;             // su object URL, se libera al cargar otra
  let paperY = 240;               // estimated paper luminance
  let mask = null;                // Uint8Array: 1 = ink pixel
  let labels = null;              // Int32Array: connected-component label per pixel (0 = none)
  let boxes = [];                 // [{x,y,w,h,label,ink,id,selected}]
  // pad 0 por defecto: cada diseño se guarda ajustado a su silueta, sin hueco
  // alrededor, porque el hueco solo ocupa disco.
  const params = { sens: 45, merge: 22, min: 4, pad: 0 };

  const scanModal = document.getElementById("scanModal");
  if (!scanModal) return;  // markup not present yet — bail out safely
  const scanCanvas = $("#scanCanvas");
  const scanBoxes = $("#scanBoxes");
  const scanInner = $("#scanCanvasInner");
  const scanCanvasWrap = $("#scanCanvasWrap");
  const scanEmpty = $("#scanEmpty");
  const scanList = $("#scanList");
  const scanCount = $("#scanCount");
  const scanFileInput = $("#scanFileInput");
  const scanReloadBtn = $("#scanReloadBtn");
  const scanCloseBtn = $("#scanCloseBtn");
  const scanRedetectBtn = $("#scanRedetectBtn");
  const scanExportBtn = $("#scanExportBtn");
  const scanAllBtn = $("#scanAllBtn");
  const scanNoneBtn = $("#scanNoneBtn");
  const scanOpenBtn = $("#scanOpenBtn");
  const scanKeepTones = $("#scanKeepTones");
  const scanAddGallery = $("#scanAddGallery");

  // ---- sliders ----
  function wireRange(id, key, valId) {
    const r = $(id), v = $(valId);
    r.addEventListener("input", () => {
      params[key] = parseInt(r.value, 10);
      v.textContent = r.value;
    });
  }
  wireRange("#scanSens", "sens", "#scanSensVal");
  wireRange("#scanMerge", "merge", "#scanMergeVal");
  wireRange("#scanMin", "min", "#scanMinVal");
  wireRange("#scanPad", "pad", "#scanPadVal");

  // ============ OPEN / CLOSE ============
  if (scanOpenBtn) scanOpenBtn.addEventListener("click", openModal);
  scanCloseBtn.addEventListener("click", closeModal);
  scanModal.addEventListener("click", (e) => { if (e.target === scanModal) closeModal(); });
  scanReloadBtn.addEventListener("click", () => scanFileInput.click());
  scanFileInput.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = "";
  });
  scanEmpty.addEventListener("click", () => scanFileInput.click());

  function openModal() {
    scanModal.style.display = "";
    if (!imgCanvas) {
      scanEmpty.style.display = "";
      scanBoxes.innerHTML = "";
      scanList.innerHTML = "";
      scanCount.textContent = "—";
    }
  }
  function closeModal() { scanModal.style.display = "none"; }

  // paste / drag-drop while modal is open
  scanCanvasWrap.addEventListener("paste", handlePaste);
  window.addEventListener("paste", (e) => { if (scanModal.style.display !== "none") handlePaste(e); });
  ["dragenter", "dragover"].forEach((ev) =>
    scanCanvasWrap.addEventListener(ev, (e) => { e.preventDefault(); scanCanvasWrap.classList.add("drop"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    scanCanvasWrap.addEventListener(ev, (e) => { e.preventDefault(); scanCanvasWrap.classList.remove("drop"); })
  );
  scanCanvasWrap.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) loadFile(f);
  });
  function handlePaste(e) {
    const items = (e.clipboardData || {}).items || [];
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); loadFile(f); return; }
      }
    }
  }

  // ============ LOAD FILE ============
  // Some browsers (Safari on macOS, iOS) decode HEIC natively via createImageBitmap
  // or the <img> tag; Chrome/Firefox don't. Where the browser can't decode we lazy-
  // load a converter (MIT / free). We try two independent libraries because heic2any
  // is stuck on an old libheif that chokes on newer iPhone HEICs (10-bit HDR, HEIC
  // sequences); heic-to ships a current libheif build.
  let converterPromise = null;
  function loadHeicConverter() {
    if (converterPromise) return converterPromise;
    converterPromise = (async () => {
      // Attempt 1: heic-to (ESM, current libheif) — handles modern iPhone HEIC/HEIF.
      try {
        const mod = await import("https://cdn.jsdelivr.net/npm/heic-to@1/+esm");
        if (mod && typeof mod.heicTo === "function") {
          return async (file) => await mod.heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
        }
      } catch (e) { console.warn("heic-to load failed", e); }
      // Attempt 2: heic2any (older, still works for classic HEICs).
      const urls = [
        "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js",
        "https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js",
      ];
      for (const u of urls) {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement("script");
            s.src = u; s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
          if (window.heic2any) {
            return async (file) => await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
          }
        } catch (_) { /* try next */ }
      }
      throw new Error("No pude cargar ningún conversor HEIC");
    })();
    return converterPromise;
  }
  function isHeic(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    return type === "image/heic" || type === "image/heif" ||
           name.endsWith(".heic") || name.endsWith(".heif");
  }
  // Sniff the first bytes: real HEIC has "ftypheic"/"ftypheix"/"ftypmif1"/"ftyphevc" at offset 4.
  async function sniffHeic(file) {
    try {
      const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
      const s = String.fromCharCode.apply(null, buf.slice(4, 12));
      return /ftyp(heic|heix|mif1|hevc|heim|heis|hevm|hevs)/i.test(s);
    } catch (_) { return false; }
  }
  // Estaba dentro de fileToImage. Se saca para que lo pueda usar tambien
  // normalizar, que es la puerta por la que entran las fotos del resto de la
  // app: no puede haber dos maneras distintas de saber si el navegador entiende
  // un fichero.
  const tryDecode = (blob) => new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => res({ im, url });
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode failed")); };
    im.src = url;
  });

  // Devuelve un fichero que el navegador SI sabe abrir.
  //
  // Un HEIC de iPhone no lo decodifica ni Chrome ni Edge (Safari si). Antes,
  // soltar una foto HEIC en el lienzo principal no hacia NADA: ni cargaba ni
  // avisaba. Aqui dentro ya habia un conversor —lo usa el escaner de libreta—,
  // asi que se abre para que lo use tambien el resto de la app en vez de
  // escribir otro.
  //
  // Si no es HEIC, o si el navegador puede solo, devuelve el mismo fichero sin
  // tocarlo: convertir por si acaso perderia calidad a cambio de nada.
  async function normalizar(file) {
    if (!file) return file;
    const looksHeic = isHeic(file) || await sniffHeic(file);
    if (!looksHeic) return file;
    try {
      const r = await tryDecode(file);
      if (r && r.url) URL.revokeObjectURL(r.url);
      return file;                       // el navegador se apana solo
    } catch (_) { /* hay que convertir */ }
    if (window.KAOS_TOAST) window.KAOS_TOAST("Convirtiendo HEIC…", 6000);
    const convert = await loadHeicConverter();   // si falla, lanza y lo cuenta quien llama
    const jpg = await convert(file);
    const blob = Array.isArray(jpg) ? jpg[0] : jpg;
    const nombre = (file.name || "foto").replace(/\.(heic|heif)$/i, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  }

  async function fileToImage(file) {
    const looksHeic = isHeic(file) || await sniffHeic(file);
    if (!looksHeic) return tryDecode(file);
    // HEIC path — try native decode first, fall back to converter.
    try { return await tryDecode(file); }
    catch (_) {
      if (window.KAOS_TOAST) window.KAOS_TOAST("Convirtiendo HEIC…", 6000);
      let convert;
      try { convert = await loadHeicConverter(); }
      catch (e) { throw new Error("No pude cargar el conversor HEIC — comprueba tu conexión"); }
      let jpg;
      try {
        jpg = await convert(file);
      } catch (e) {
        console.warn("heic conversion failed", e);
        throw new Error("HEIC no reconocido — prueba a exportar como JPG desde el móvil");
      }
      const blob = Array.isArray(jpg) ? jpg[0] : jpg;
      return tryDecode(blob);
    }
  }
  function loadFile(file) {
    fileToImage(file).then(({ im, url }) => {
      // Dos resoluciones a propósito:
      //   imgCanvas (2000 px) para ver y detectar — rápido, y en el iPad no
      //                       revienta la memoria al pintar cada cambio.
      //   fullImg   (original) para el recorte final — los diseños se guardan
      //                       en HD para poder reimprimirlos; sacarlos de la
      //                       copia reducida los dejaba a media resolución.
      const MAX = 2000;
      let w = im.naturalWidth, h = im.naturalHeight;
      const s = Math.min(1, MAX / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      imgCanvas = document.createElement("canvas");
      imgCanvas.width = w; imgCanvas.height = h;
      imgCanvas.getContext("2d").drawImage(im, 0, 0, w, h);

      // La foto original se queda viva hasta que se cargue otra: es de donde
      // se recorta. Por eso su URL se libera aquí y no justo después de pintar.
      if (fullURL) URL.revokeObjectURL(fullURL);
      fullImg = im;
      fullURL = url;
      scanEmpty.style.display = "none";
      drawSource();
      fitCanvas();
      detect();
    }).catch((err) => {
      console.warn("scan: no se pudo abrir la foto", err);
      const msg = (err && err.message) ? err.message : "No se pudo abrir esa foto";
      if (window.KAOS_TOAST) window.KAOS_TOAST(msg, 6000);
    });
  }

  function drawSource() {
    scanCanvas.width = imgCanvas.width;
    scanCanvas.height = imgCanvas.height;
    scanCanvas.getContext("2d").drawImage(imgCanvas, 0, 0);
  }

  function fitCanvas() {
    if (!imgCanvas) return;
    const cw = imgCanvas.width, ch = imgCanvas.height;
    const availW = scanCanvasWrap.clientWidth - 24;
    const availH = scanCanvasWrap.clientHeight - 24;
    const s = Math.max(0.05, Math.min(availW / cw, availH / ch, 1));
    const rw = Math.round(cw * s), rh = Math.round(ch * s);
    scanInner.style.width = rw + "px";
    scanInner.style.height = rh + "px";
    scanCanvas.style.width = rw + "px";
    scanCanvas.style.height = rh + "px";
  }
  window.addEventListener("resize", fitCanvas);

  // ============ DETECTION ============
  scanRedetectBtn.addEventListener("click", () => { if (imgCanvas) detect(); });

  // Detection state, kept at the COARSE detection resolution so extract() can
  // sample the local paper luminance + component labels without recomputing.
  const det = { paperMap: null, labels: null, w: 0, h: 0, sx: 1, sy: 1 };

  // ---- separable rolling MAX (O(N) monotonic deque) --------------------------
  // Used for the local-paper estimate: the brightest pixel in a big window is
  // basically the real paper luminance (ink pixels are dark, so they lose the
  // max even if the drawing dominates that area). A blur-based estimate got
  // dragged down by ink and made near-invisible alpha ramps.
  function maxFilter(Y, w, h, r) {
    if (r <= 0) return Y.slice();
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const dq = new Int32Array(Math.max(w, h) + 4);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let head = 0, tail = 0;
      for (let x = 0; x < w + r; x++) {
        if (x < w) {
          while (head < tail && Y[row + dq[tail - 1]] <= Y[row + x]) tail--;
          dq[tail++] = x;
        }
        while (head < tail && dq[head] < x - 2 * r) head++;
        const outX = x - r;
        if (outX >= 0 && outX < w) tmp[row + outX] = Y[row + dq[head]];
      }
    }
    for (let x = 0; x < w; x++) {
      let head = 0, tail = 0;
      for (let y = 0; y < h + r; y++) {
        if (y < h) {
          while (head < tail && tmp[dq[tail - 1] * w + x] <= tmp[y * w + x]) tail--;
          dq[tail++] = y;
        }
        while (head < tail && dq[head] < y - 2 * r) head++;
        const outY = y - r;
        if (outY >= 0 && outY < h) out[outY * w + x] = tmp[dq[head] * w + x];
      }
    }
    return out;
  }

  // ---- separable box blur (O(N)) — float in, float out ----
  function boxBlur(Y, w, h, r) {
    if (r <= 0) return Y.slice();
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0, count = 0;
      for (let x = 0; x <= r && x < w; x++) { sum += Y[row + x]; count++; }
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / count;
        const addX = x + r + 1;
        if (addX < w) { sum += Y[row + addX]; count++; }
        const remX = x - r;
        if (remX >= 0) { sum -= Y[row + remX]; count--; }
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let y = 0; y <= r && y < h; y++) { sum += tmp[y * w + x]; count++; }
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / count;
        const addY = y + r + 1;
        if (addY < h) { sum += tmp[addY * w + x]; count++; }
        const remY = y - r;
        if (remY >= 0) { sum -= tmp[remY * w + x]; count--; }
      }
    }
    return out;
  }

  // ---- rolling-max dilate (O(N)) ----
  function dilate(m, w, h, r) {
    if (r <= 0) return m.slice();
    const out1 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let cnt = 0;
      for (let x = 0; x <= r && x < w; x++) if (m[y * w + x]) cnt++;
      for (let x = 0; x < w; x++) {
        out1[y * w + x] = cnt > 0 ? 1 : 0;
        const addX = x + r + 1;
        if (addX < w && m[y * w + addX]) cnt++;
        const remX = x - r;
        if (remX >= 0 && m[y * w + remX]) cnt--;
      }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let cnt = 0;
      for (let y = 0; y <= r && y < h; y++) if (out1[y * w + x]) cnt++;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = cnt > 0 ? 1 : 0;
        const addY = y + r + 1;
        if (addY < h && out1[addY * w + x]) cnt++;
        const remY = y - r;
        if (remY >= 0 && out1[remY * w + x]) cnt--;
      }
    }
    return out;
  }

  // ---- rolling-min erode (O(N)) — an "empty" pixel in the window kills the centre ----
  function erode(m, w, h, r) {
    if (r <= 0) return m.slice();
    const out1 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let zeros = 0;
      for (let x = 0; x <= r && x < w; x++) if (!m[y * w + x]) zeros++;
      for (let x = 0; x < w; x++) {
        out1[y * w + x] = zeros === 0 ? 1 : 0;
        const addX = x + r + 1;
        if (addX < w && !m[y * w + addX]) zeros++;
        const remX = x - r;
        if (remX >= 0 && !m[y * w + remX]) zeros--;
      }
    }
    const out = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let zeros = 0;
      for (let y = 0; y <= r && y < h; y++) if (!out1[y * w + x]) zeros++;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = zeros === 0 ? 1 : 0;
        const addY = y + r + 1;
        if (addY < h && !out1[addY * w + x]) zeros++;
        const remY = y - r;
        if (remY >= 0 && !out1[remY * w + x]) zeros--;
      }
    }
    return out;
  }

  // ---- XY-cut recursive splitter: find the tallest empty band that divides the
  //      region, cut there, recurse. This is the textbook document-layout method
  //      and it handles "designs laid out in rows/columns" — which is exactly a
  //      notebook page — much better than a single connected-components pass.
  function xyCut(mask, w, h, x0, y0, x1, y1, minSide, minGap, depth, out) {
    if (depth > 12) { pushIfInk(mask, w, x0, y0, x1, y1, out); return; }
    const rw = x1 - x0, rh = y1 - y0;
    if (rw <= minSide || rh <= minSide) { pushIfInk(mask, w, x0, y0, x1, y1, out); return; }

    // Row and column ink counts inside this region.
    const rows = new Int32Array(rh);
    const cols = new Int32Array(rw);
    for (let y = 0; y < rh; y++) {
      const rowBase = (y0 + y) * w;
      let s = 0;
      for (let x = 0; x < rw; x++) if (mask[rowBase + x0 + x]) { s++; cols[x]++; }
      rows[y] = s;
    }

    // Find the widest "empty" band on each axis (a run of rows/cols with ink
    // count below inkFloor). Skip the outer margin so a whitespace border
    // doesn't count as a valid split.
    const inkFloor = Math.max(1, Math.round(Math.min(rw, rh) * 0.008));
    const margin = Math.round(Math.min(rw, rh) * 0.05);
    const findGap = (arr, len) => {
      let best = { start: 0, end: 0, len: 0 };
      let s = -1;
      for (let i = margin; i < len - margin; i++) {
        if (arr[i] <= inkFloor) {
          if (s < 0) s = i;
        } else if (s >= 0) {
          if (i - s > best.len) best = { start: s, end: i, len: i - s };
          s = -1;
        }
      }
      if (s >= 0 && (len - margin) - s > best.len) best = { start: s, end: len - margin, len: (len - margin) - s };
      return best;
    };
    const gapY = findGap(rows, rh);
    const gapX = findGap(cols, rw);

    // Pick the axis with the tallest valid gap — recurse across it.
    const canSplitY = gapY.len >= minGap;
    const canSplitX = gapX.len >= minGap;
    if (canSplitY && (!canSplitX || gapY.len >= gapX.len)) {
      const mid = Math.floor((gapY.start + gapY.end) / 2);
      xyCut(mask, w, h, x0, y0, x1, y0 + mid, minSide, minGap, depth + 1, out);
      xyCut(mask, w, h, x0, y0 + mid, x1, y1, minSide, minGap, depth + 1, out);
      return;
    }
    if (canSplitX) {
      const mid = Math.floor((gapX.start + gapX.end) / 2);
      xyCut(mask, w, h, x0, y0, x0 + mid, y1, minSide, minGap, depth + 1, out);
      xyCut(mask, w, h, x0 + mid, y0, x1, y1, minSide, minGap, depth + 1, out);
      return;
    }
    // Terminal: no more splits — this is one design (or one cluster of them).
    pushIfInk(mask, w, x0, y0, x1, y1, out);
  }
  function pushIfInk(mask, w, x0, y0, x1, y1, out) {
    // Shrink the region to the actual ink bounding box inside it — trims the
    // whitespace around each design so the box hugs the drawing.
    let minx = x1, miny = y1, maxx = x0 - 1, maxy = y0 - 1, count = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * w;
      for (let x = x0; x < x1; x++) {
        if (mask[row + x]) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
          count++;
        }
      }
    }
    if (count > 0 && maxx >= minx && maxy >= miny) {
      out.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, ink: count });
    }
  }

  function detect() {
    const srcW = imgCanvas.width, srcH = imgCanvas.height;

    // 1. Downsample to a coarse grid so detection stays fast.
    const DET = 600;
    const s = Math.min(1, DET / Math.max(srcW, srcH));
    const w = Math.max(80, Math.round(srcW * s));
    const h = Math.max(80, Math.round(srcH * s));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cctx = c.getContext("2d");
    cctx.drawImage(imgCanvas, 0, 0, w, h);
    const src = cctx.getImageData(0, 0, w, h);
    const d = src.data;

    // 2. Luminance.
    const Y = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      Y[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }

    // 3. Local paper luminance via ROLLING MAX over a big window. The max of a
    //    region is basically the paper (ink is dark → loses the max). A blur
    //    would get dragged down by the ink and misreport paper as much darker
    //    than it really is, killing the alpha ramp in extract().
    const paperR = Math.max(20, Math.round(Math.min(w, h) * 0.22));
    const paperMap = maxFilter(Y, w, h, paperR);

    // 4. Ink mask.
    mask = new Uint8Array(w * h);
    const sens = params.sens;
    for (let i = 0; i < w * h; i++) {
      if (paperMap[i] - Y[i] > sens) mask[i] = 1;
    }

    // 5. Denoise: kill isolated single-pixel specks (paper texture / JPEG noise)
    //    with a light erosion, then restore stroke width with a matching dilation.
    //    This preserves organic strokes while removing salt-and-pepper.
    const denoised = dilate(erode(mask, w, h, 1), w, h, 1);

    // 6. Morphological CLOSING with a big kernel groups nearby strokes of the
    //    same organic drawing into a single connected blob. Organic drawings
    //    are rarely closed contours — but their strokes always sit close to
    //    each other, and neighbouring designs sit apart. So "designs = clusters
    //    of ink strokes" is the right primitive, not "designs = closed shapes".
    //    The `merge` slider controls how aggressively strokes get glued together.
    //    La escala importa mucho: con /200 el radio salía ~50 px sobre una
    //    rejilla de 600, o sea el 10% de la página, y pegaba TODOS los diseños
    //    en una sola mancha — el detector devolvía siempre un único recuadro.
    //    /2000 deja el radio en ~1% del lado corto: suficiente para unir los
    //    trazos de un mismo dibujo, corto para no saltar al dibujo de al lado.
    const closeR = Math.max(2, Math.round(params.merge * Math.min(w, h) / 2000));
    //    Cierre SIMÉTRICO: erosionar menos de lo que se dilató dejaba cada
    //    mancha hinchada, y dos diseños cercanos acababan tocándose.
    const closed = erode(dilate(denoised, w, h, closeR), w, h, closeR);

    // 7. Connected components on the closed ink mask → one blob per cluster of
    //    strokes = one design.
    labels = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    let nLab = 0;
    const cc = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!closed[idx] || labels[idx]) continue;
        nLab++;
        let sp = 0;
        stack[sp++] = idx;
        labels[idx] = nLab;
        let minx = x, miny = y, maxx = x, maxy = y, area = 0, ink = 0;
        // Bounding box of the ORIGINAL ink (pre-dilation), so we don't inflate
        // the reported box by the closing radius.
        let ixMin = x, iyMin = y, ixMax = x, iyMax = y, hasInk = false;
        while (sp) {
          const p = stack[--sp];
          const px = p % w, py = (p / w) | 0;
          if (px < minx) minx = px;
          if (px > maxx) maxx = px;
          if (py < miny) miny = py;
          if (py > maxy) maxy = py;
          area++;
          if (mask[p]) {
            ink++;
            if (!hasInk) { ixMin = ixMax = px; iyMin = iyMax = py; hasInk = true; }
            else {
              if (px < ixMin) ixMin = px;
              if (px > ixMax) ixMax = px;
              if (py < iyMin) iyMin = py;
              if (py > iyMax) iyMax = py;
            }
          }
          if (px > 0) { const np = p - 1; if (closed[np] && !labels[np]) { labels[np] = nLab; stack[sp++] = np; } }
          if (px < w - 1) { const np = p + 1; if (closed[np] && !labels[np]) { labels[np] = nLab; stack[sp++] = np; } }
          if (py > 0) { const np = p - w; if (closed[np] && !labels[np]) { labels[np] = nLab; stack[sp++] = np; } }
          if (py < h - 1) { const np = p + w; if (closed[np] && !labels[np]) { labels[np] = nLab; stack[sp++] = np; } }
        }
        if (!hasInk) continue; // pure holes without ink shouldn't happen but guard anyway
        cc.push({
          x: ixMin, y: iyMin,
          w: ixMax - ixMin + 1, h: iyMax - iyMin + 1,
          bx: minx, by: miny, bw: maxx - minx + 1, bh: maxy - miny + 1,
          label: nLab, area: area, ink: ink,
        });
      }
    }

    // 8. Filter: minimum side, minimum ink content, drop whole-page blob.
    const minSide = params.min / 100 * Math.min(w, h);
    const minInk = Math.max(20, w * h * 0.0008);
    const refined = cc.filter((b) => {
      if (Math.min(b.w, b.h) < minSide) return false;
      if (b.ink < minInk) return false;
      if (b.bw >= w * 0.95 && b.bh >= h * 0.95) return false;
      // Reject long thin borders / margin lines: extreme aspect ratio + low ink density.
      const ratio = Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h));
      const density = b.ink / Math.max(1, b.w * b.h);
      if (ratio > 12 && density < 0.05) return false;
      return true;
    });

    // 10. Sort into reading order and map coords back to source pixels.
    const sxScale = srcW / w, syScale = srcH / h;
    boxes = refined
      .sort((a, b) => {
        const row = Math.max(4, Math.round(h * 0.08));
        const ra = Math.floor((a.y + a.h / 2) / row);
        const rb = Math.floor((b.y + b.h / 2) / row);
        return ra !== rb ? ra - rb : (a.x + a.w / 2) - (b.x + b.w / 2);
      })
      .map((b, i) => ({
        cx: b.x, cy: b.y, cw: b.w, ch: b.h, label: b.label, ink: b.ink,
        x: Math.round(b.x * sxScale),
        y: Math.round(b.y * syScale),
        w: Math.round(b.w * sxScale),
        h: Math.round(b.h * syScale),
        id: "b" + i, selected: true,
      }));

    det.paperMap = paperMap;
    det.labels = labels;
    det.w = w; det.h = h;
    det.sx = sxScale; det.sy = syScale;

    renderBoxes();
    renderList();
    updateCount();
  }

  // ============ RENDER ============
  function renderBoxes() {
    scanBoxes.innerHTML = "";
    if (!boxes.length || !imgCanvas) return;
    const w = imgCanvas.width, h = imgCanvas.height;
    boxes.forEach((b, i) => {
      const el = document.createElement("div");
      el.className = "scan-box" + (b.selected ? " selected" : "");
      el.style.left = (b.x / w * 100) + "%";
      el.style.top = (b.y / h * 100) + "%";
      el.style.width = (b.w / w * 100) + "%";
      el.style.height = (b.h / h * 100) + "%";
      el.innerHTML = '<span class="n">' + (i + 1) + '</span><button class="scan-box-x" title="Quitar">✕</button>';
      el.addEventListener("click", (ev) => {
        if (ev.target.closest(".scan-box-x")) return; // handled below
        if (justDragged) return;
        toggleBox(b.id);
      });
      const xbtn = el.querySelector(".scan-box-x");
      xbtn.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); });
      xbtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeBox(b.id);
      });
      scanBoxes.appendChild(el);
    });
  }

  function renderList() {
    scanList.innerHTML = "";
    if (!boxes.length) {
      scanList.innerHTML = '<div class="scan-list-empty">Sin detección — sube una foto o ajusta la sensibilidad</div>';
      return;
    }
    boxes.forEach((b, i) => {
      const div = document.createElement("div");
      div.className = "scan-list-item" + (b.selected ? " selected" : "");
      const thumb = document.createElement("canvas");
      const tw = 90;
      const s = tw / Math.max(b.w, b.h);
      thumb.width = Math.round(b.w * s);
      thumb.height = Math.round(b.h * s);
      const tctx = thumb.getContext("2d");
      tctx.drawImage(imgCanvas, b.x, b.y, b.w, b.h, 0, 0, thumb.width, thumb.height);
      div.appendChild(thumb);
      const n = document.createElement("span");
      n.className = "n"; n.textContent = i + 1;
      div.appendChild(n);
      div.addEventListener("click", () => toggleBox(b.id));
      scanList.appendChild(div);
    });
  }

  function toggleBox(id) {
    const b = boxes.find((x) => x.id === id);
    if (!b) return;
    b.selected = !b.selected;
    renderBoxes(); renderList(); updateCount();
  }

  function removeBox(id) {
    boxes = boxes.filter((b) => b.id !== id);
    // Re-number remaining boxes' visible index only (id kept).
    renderBoxes(); renderList(); updateCount();
  }

  function updateCount() {
    const sel = boxes.filter((b) => b.selected).length;
    scanCount.textContent = boxes.length + " · " + sel + " marcados";
    scanExportBtn.disabled = sel === 0;
  }

  scanAllBtn.addEventListener("click", () => { boxes.forEach((b) => (b.selected = true)); renderBoxes(); renderList(); updateCount(); });
  scanNoneBtn.addEventListener("click", () => { boxes.forEach((b) => (b.selected = false)); renderBoxes(); renderList(); updateCount(); });
  const scanClearBtn = $("#scanClearBtn");
  if (scanClearBtn) scanClearBtn.addEventListener("click", () => { boxes = []; renderBoxes(); renderList(); updateCount(); });

  // ============ MANUAL DRAG-TO-DRAW ============
  // If the automatic detection misses (or the user just wants to be precise),
  // they drag a rectangle straight on the photo. Each drag becomes a box.
  let dragState = null;
  let justDragged = false;
  function pointerToImgCoords(e) {
    if (!imgCanvas) return null;
    const r = scanInner.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: (e.clientX - r.left) / r.width * imgCanvas.width,
      y: (e.clientY - r.top) / r.height * imgCanvas.height,
    };
  }
  scanInner.addEventListener("pointerdown", (e) => {
    if (!imgCanvas) return;
    if (e.target.closest(".scan-box")) return; // let box handlers own it
    const p = pointerToImgCoords(e);
    if (!p) return;
    dragState = { startX: p.x, startY: p.y, box: null, pointerId: e.pointerId };
    justDragged = false;
    try { scanInner.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  scanInner.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const p = pointerToImgCoords(e);
    if (!p) return;
    const x = Math.max(0, Math.min(imgCanvas.width, Math.min(dragState.startX, p.x)));
    const y = Math.max(0, Math.min(imgCanvas.height, Math.min(dragState.startY, p.y)));
    const w = Math.min(imgCanvas.width - x, Math.abs(p.x - dragState.startX));
    const h = Math.min(imgCanvas.height - y, Math.abs(p.y - dragState.startY));
    if (!dragState.box) {
      if (Math.max(w, h) < 6) return;
      const b = { x, y, w, h, id: "m" + Date.now() + Math.floor(Math.random() * 1000), selected: true, manual: true };
      boxes.push(b);
      dragState.box = b;
    } else {
      dragState.box.x = x; dragState.box.y = y; dragState.box.w = w; dragState.box.h = h;
    }
    renderBoxes();
  });
  function endDrag(e) {
    if (!dragState) return;
    try { scanInner.releasePointerCapture(dragState.pointerId); } catch (_) {}
    if (dragState.box) {
      if (dragState.box.w < 12 || dragState.box.h < 12) {
        boxes = boxes.filter((b) => b.id !== dragState.box.id);
      } else {
        justDragged = true;
        setTimeout(() => (justDragged = false), 250);
      }
    }
    dragState = null;
    renderBoxes(); renderList(); updateCount();
  }
  scanInner.addEventListener("pointerup", endDrag);
  scanInner.addEventListener("pointercancel", endDrag);

  // ============ EXTRACT one design as transparent PNG ============
  // Two modes, controlled by "PRESERVAR TONOS":
  //   OFF (default) — pure binary. A pixel darker than its local paper by more
  //                   than `blackThr` becomes solid black; anything else stays
  //                   transparent. No grey transitions, no paper bleed-through
  //                   — this is what the user asked for.
  //   ON            — soft ramp keeping the original RGB (useful for coloured
  //                   pens / sketch tones).
  // Recorta UN diseño y le quita el papel.
  //
  // Replica a mano lo que ella hacía a mano: lazo alrededor de la silueta,
  // fondo fuera, y guardado ajustado al dibujo. La clave es la silueta — antes
  // esto recortaba el RECTÁNGULO del diseño y se llevaba dentro lo que hubiera
  // (la raya del cuaderno, la esquina del dibujo de al lado, una sombra).
  function extract(b) {
    const dispW = imgCanvas.width, dispH = imgCanvas.height;

    // Escala copia-de-trabajo → foto original. El recorte sale de la original
    // para que los PNG queden en HD.
    const fs = (fullImg && fullImg.naturalWidth) ? (fullImg.naturalWidth / dispW) : 1;

    // Margen de trabajo fijo: sólo para no cortar un trazo que asome fuera del
    // recuadro detectado. NO es el margen de salida — ése lo decide trimAlpha.
    const work = Math.round(Math.min(dispW, dispH) * 0.03);
    const dx0 = Math.max(0, b.x - work);
    const dy0 = Math.max(0, b.y - work);
    const dx1 = Math.min(dispW, b.x + b.w + work);
    const dy1 = Math.min(dispH, b.y + b.h + work);

    const sx0 = Math.round(dx0 * fs), sy0 = Math.round(dy0 * fs);
    const cw = Math.max(1, Math.round((dx1 - dx0) * fs));
    const ch = Math.max(1, Math.round((dy1 - dy0) * fs));

    const cut = document.createElement("canvas");
    cut.width = cw; cut.height = ch;
    const cctx = cut.getContext("2d", { willReadFrequently: true });
    if (fullImg) cctx.drawImage(fullImg, sx0, sy0, cw, ch, 0, 0, cw, ch);
    else cctx.drawImage(imgCanvas, dx0, dy0, cw, ch, 0, 0, cw, ch);
    const srcData = cctx.getImageData(0, 0, cw, ch);
    const d = srcData.data;

    const out = new ImageData(cw, ch);
    const od = out.data;
    const keepTones = !!scanKeepTones.checked;
    const yAt = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    // ---- la silueta ----
    // det.labels dice a qué diseño pertenece cada celda de la rejilla de
    // detección. Se dilata un poco porque esa rejilla es gruesa (una celda son
    // varios píxeles de la foto) y sin holgura recortaría los bordes del trazo.
    const gw = det.w, gh = det.h;
    let territory = null;
    // Los recuadros que dibuja ella a mano no tienen silueta detectada: ahí el
    // recuadro ES su decisión, así que se respeta tal cual y sólo se le quita
    // el papel. Sin esto saldrían PNG vacíos.
    const porSilueta = b.label != null && det.labels && gw > 0;
    if (porSilueta) {
      const terr = new Uint8Array(gw * gh);
      for (let i = 0; i < terr.length; i++) if (det.labels[i] === b.label) terr[i] = 1;
      territory = dilate(terr, gw, gh, 2);
    } else if (b.manual && det.labels && gw > 0) {
      // Recuadro dibujado a mano: se usa como INDICACION, no como tijera.
      //
      // Antes recortaba por el rectangulo pelado, asi que se llevaba todo lo
      // que cayera dentro — el trozo del dibujo de al lado incluido. Ahora
      // dentro del recuadro se mira que manchas de tinta hay y se recorta
      // siguiendo su forma:
      //   · la mancha que este dentro por mas de la mitad se coge ENTERA,
      //     aunque asome un poco fuera del recuadro;
      //   · de la mancha principal, si no llega a esa mitad, se coge solo el
      //     trozo de dentro (asi puede quedarse con una parte de un dibujo
      //     grande a proposito);
      //   · lo demas que asome por dentro del recuadro se queda fuera.
      const gx0 = Math.max(0, Math.floor(b.x / det.sx));
      const gx1 = Math.min(gw, Math.ceil((b.x + b.w) / det.sx));
      const gy0 = Math.max(0, Math.floor(b.y / det.sy));
      const gy1 = Math.min(gh, Math.ceil((b.y + b.h) / det.sy));
      const total = new Map(), dentro = new Map();
      for (let i = 0; i < gw * gh; i++) {
        const L = det.labels[i];
        if (L) total.set(L, (total.get(L) || 0) + 1);
      }
      for (let gy = gy0; gy < gy1; gy++) {
        for (let gx = gx0; gx < gx1; gx++) {
          const L = det.labels[gy * gw + gx];
          if (L) dentro.set(L, (dentro.get(L) || 0) + 1);
        }
      }
      const enteras = new Set();
      let principal = 0, mejor = 0;
      dentro.forEach((n, L) => {
        if (n > mejor) { mejor = n; principal = L; }
        if (n / (total.get(L) || n) >= 0.5) enteras.add(L);
      });
      const terr = new Uint8Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const i = gy * gw + gx;
          const L = det.labels[i];
          if (!L) continue;
          if (enteras.has(L)) { terr[i] = 1; continue; }
          if (L === principal && gx >= gx0 && gx < gx1 && gy >= gy0 && gy < gy1) terr[i] = 1;
        }
      }
      let algo = false;
      for (let i = 0; i < terr.length && !algo; i++) if (terr[i]) algo = true;
      // Si ahi no habia tinta reconocible, se vuelve al rectangulo de siempre
      // en vez de devolverle un PNG vacio.
      if (algo) territory = dilate(terr, gw, gh, 2);
    }
    const recortaPorSilueta = !!territory;
    const bx0 = b.x, by0 = b.y, bx1 = b.x + b.w, by1 = b.y + b.h;

    // ---- el papel ----
    // Luminancia local del papel, la misma que usó la detección (máximo móvil).
    // El método anterior —percentil 90 dentro del recuadro— fallaba justo con
    // los diseños grandes: si el dibujo llena su recuadro, el percentil 90 cae
    // sobre la tinta, el umbral se va al negro y no recorta nada.
    const pmap = det.paperMap;
    const gsx = fs * det.sx, gsy = fs * det.sy;   // original → rejilla gruesa

    const inkOffset = Math.max(15, params.sens);
    const inkRange = Math.max(30, params.sens * 1.4);
    const soft = 7;   // rampa de alfa: sin ella el contorno sale dentado

    for (let py = 0; py < ch; py++) {
      let gy = Math.round((sy0 + py) / gsy);
      if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      const gRow = gy * gw;
      for (let px = 0; px < cw; px++) {
        const j = (py * cw + px) * 4;
        let gx = Math.round((sx0 + px) / gsx);
        if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
        const gi = gRow + gx;

        // Fuera de la silueta de ESTE diseño: transparente, sin mirar el color.
        if (recortaPorSilueta) {
          if (!territory[gi]) { od[j + 3] = 0; continue; }
        } else {
          // Recuadro manual: se recorta por el rectángulo que dibujó ella.
          const dX = (sx0 + px) / fs, dY = (sy0 + py) / fs;
          if (dX < bx0 || dX >= bx1 || dY < by0 || dY >= by1) { od[j + 3] = 0; continue; }
        }

        const paperLum = pmap[gi];
        const lum = yAt(j);

        if (keepTones) {
          const t = (paperLum - lum) / inkRange;
          const a = t <= 0 ? 0 : t >= 1 ? 1 : t;
          od[j] = d[j]; od[j + 1] = d[j + 1]; od[j + 2] = d[j + 2];
          od[j + 3] = Math.round(a * 255);
        } else {
          const t = (paperLum - inkOffset + soft - lum) / (2 * soft);
          const a = t <= 0 ? 0 : t >= 1 ? 1 : t;
          od[j] = 0; od[j + 1] = 0; od[j + 2] = 0;
          od[j + 3] = Math.round(a * 255);
        }
      }
    }

    // Ajustado a la silueta. params.pad es un porcentaje del propio diseño, y
    // vale 0 por defecto: sin hueco alrededor.
    return trimAlpha(out, cw, ch, params.pad);
  }

  // Recorta el lienzo al rectángulo mínimo que contiene algo visible. padPct es
  // un porcentaje del lado mayor del diseño, no píxeles de la foto: así un
  // margen del 5% se ve igual en un diseño pequeño que en uno grande.
  function trimAlpha(imgData, w, h, padPct) {
    const d = imgData.data;
    let minx = w, miny = h, maxx = -1, maxy = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) {
      const c = document.createElement("canvas");
      c.width = 1; c.height = 1;
      return c;
    }
    // 1 px de respiro siempre, para no comerse el borde suavizado del trazo.
    const padOut = Math.max(1, Math.round((padPct || 0) / 100 * Math.max(maxx - minx + 1, maxy - miny + 1)));
    minx = Math.max(0, minx - padOut);
    miny = Math.max(0, miny - padOut);
    maxx = Math.min(w - 1, maxx + padOut);
    maxy = Math.min(h - 1, maxy + padOut);
    const cw = maxx - minx + 1, ch = maxy - miny + 1;
    // Compose full ImageData then crop
    const full = document.createElement("canvas");
    full.width = w; full.height = h;
    full.getContext("2d").putImageData(imgData, 0, 0);
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(full, minx, miny, cw, ch, 0, 0, cw, ch);
    return c;
  }

  // ============ REVISIÓN ANTES DE GUARDAR ============
  // Antes esto exportaba a ciegas: pulsabas y salían 12 ficheros sin haber
  // visto ninguno. Ahora primero se enseñan ya recortados, con la opción de
  // limpiar las líneas, y se guarda lo que ella apruebe — suelto o a galería.
  const revision   = document.getElementById("scanRevision");
  const revRejilla = document.getElementById("revRejilla");
  const revCuenta  = document.getElementById("revCuenta");
  const revLimpiar = document.getElementById("revLimpiar");
  const revSuave   = document.getElementById("revSuave");
  const revMota    = document.getElementById("revMota");
  const vistaFoto  = scanModal.querySelector(".scan-view");

  let fichas = [];        // { crudo, limpio, limpia, tarjeta, hueco, pie, i }
  let sello = 0;
  let recalcTimer = null;

  function aviso(txt) {
    if (!txt) return;
    if (window.KAOS_TOAST) window.KAOS_TOAST(txt); else console.log(txt);
  }
  function nombreDe(i) {
    return "kaos-realm_libreta_" + sello + "_" + String(i + 1).padStart(2, "0") + ".png";
  }
  function lienzoDe(f) { return (f.limpia && f.limpio) ? f.limpio : f.crudo; }

  function opcionesLimpieza(cv) {
    // El deslizador va de 0 a 14 y lo traduce limpiar.js a radio de suavizado
    // de forma, en proporción al tamaño del diseño. La versión anterior movía
    // la tolerancia entre 0,50 y 0,90 px en todo su recorrido — medio píxel,
    // que es no hacer nada.
    return {
      suave: parseInt(revSuave.value, 10),
      mota: parseInt(revMota.value, 10) / 100,
    };
  }

  function pintarFicha(f) {
    const cv = lienzoDe(f);
    f.hueco.innerHTML = "";
    const vista = document.createElement("canvas");
    const lado = 190;
    const k = Math.min(lado / cv.width, lado / cv.height, 1);
    vista.width = Math.max(1, Math.round(cv.width * k));
    vista.height = Math.max(1, Math.round(cv.height * k));
    const c = vista.getContext("2d");
    c.imageSmoothingQuality = "high";
    c.drawImage(cv, 0, 0, vista.width, vista.height);
    f.hueco.appendChild(vista);
    f.pie.textContent = cv.width + " × " + cv.height + (f.limpia ? " · limpio" : " · tal cual");
  }

  function recalcular() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(async () => {
      const quiere = revLimpiar.checked;
      for (const f of fichas) {
        f.limpia = quiere;
        if (quiere && window.KAOS_LIMPIAR) {
          f.tarjeta.classList.add("trabajando");
          // Un respiro entre diseño y diseño: si no, la pestaña se queda tiesa
          // mientras se limpian doce.
          await new Promise((r) => setTimeout(r, 0));
          try {
            f.limpio = KAOS_LIMPIAR.vectorizar(f.crudo, opcionesLimpieza(f.crudo));
          } catch (e) {
            console.warn("no se pudo limpiar", e);
            f.limpio = null; f.limpia = false;
          }
          f.tarjeta.classList.remove("trabajando");
        }
        pintarFicha(f);
      }
    }, 180);
  }

  function abrirRevision() {
    const elegidos = boxes.filter((b) => b.selected);
    if (!elegidos.length) return;
    sello = Date.now();
    revRejilla.innerHTML = "";
    fichas = elegidos.map((b, i) => {
      const tarjeta = document.createElement("div");
      tarjeta.className = "rev-ficha";
      tarjeta.innerHTML =
        '<div class="rev-lienzo"></div>' +
        '<div class="rev-pie"></div>' +
        '<div class="rev-acts">' +
          '<button class="icon-btn flex" data-que="orig">TAL CUAL</button>' +
          '<button class="icon-btn flex" data-que="guardar">↓ GUARDAR</button>' +
          '<button class="icon-btn flex" data-que="galeria" title="Mandar a la galería">★</button>' +
        '</div>';
      revRejilla.appendChild(tarjeta);
      const f = {
        crudo: extract(b), limpio: null, limpia: true, tarjeta: tarjeta,
        hueco: tarjeta.querySelector(".rev-lienzo"),
        pie: tarjeta.querySelector(".rev-pie"),
        i: i,
      };
      tarjeta.addEventListener("click", async (e) => {
        const que = e.target.dataset && e.target.dataset.que;
        if (!que) return;
        if (que === "orig") {
          // Ver el original de ESTE diseño sin tocar los demás.
          f.limpia = !f.limpia;
          if (f.limpia && !f.limpio && window.KAOS_LIMPIAR) {
            f.limpio = KAOS_LIMPIAR.vectorizar(f.crudo, opcionesLimpieza(f.crudo));
          }
          e.target.textContent = f.limpia ? "TAL CUAL" : "LIMPIO";
          pintarFicha(f);
          return;
        }
        if (que === "guardar") {
          const n = nombreDe(f.i);
          const r = await KAOS_GUARDAR.imagen(lienzoDe(f), n);
          aviso(KAOS_GUARDAR.comoFue(r, n));
          return;
        }
        if (que === "galeria") {
          if (!window.KAOS_GALLERY) return;
          try {
            KAOS_GALLERY.add(lienzoDe(f), { style: "libreta", paper: "#d9d4c8" });
            document.dispatchEvent(new CustomEvent("kaos-gallery-changed"));
            aviso("A la galería.");
          } catch (err) { aviso("No cabe en la galería."); }
        }
      });
      return f;
    });
    revCuenta.textContent = fichas.length + (fichas.length === 1 ? " diseño" : " diseños");
    revision.hidden = false;
    if (vistaFoto) vistaFoto.style.display = "none";
    fichas.forEach(pintarFicha);
    recalcular();
  }

  function cerrarRevision() {
    revision.hidden = true;
    if (vistaFoto) vistaFoto.style.display = "";
    fichas = [];
    revRejilla.innerHTML = "";
  }

  document.getElementById("revVolverBtn").addEventListener("click", cerrarRevision);
  revLimpiar.addEventListener("change", recalcular);
  revSuave.addEventListener("input", () => {
    document.getElementById("revSuaveVal").textContent = revSuave.value;
  });
  revSuave.addEventListener("change", () => {
    fichas.forEach((f) => { f.limpio = null; });
    recalcular();
  });
  revMota.addEventListener("input", () => {
    document.getElementById("revMotaVal").textContent = (revMota.value / 100).toFixed(2);
  });
  revMota.addEventListener("change", () => {
    fichas.forEach((f) => { f.limpio = null; });
    recalcular();
  });

  document.getElementById("revTodosBtn").addEventListener("click", async (e) => {
    if (!fichas.length) return;
    const b = e.target;
    b.disabled = true;
    const viejo = b.textContent;
    // Una sola pregunta de carpeta para todo el lote, no doce.
    await KAOS_GUARDAR.abrirCarpeta(fichas.length);
    let ultimo = "";
    for (let i = 0; i < fichas.length; i++) {
      b.textContent = "GUARDANDO " + (i + 1) + "/" + fichas.length + "…";
      ultimo = await KAOS_GUARDAR.imagen(lienzoDe(fichas[i]), nombreDe(i));
      if (ultimo === "cancelado") break;
    }
    KAOS_GUARDAR.cerrarCarpeta();
    b.textContent = viejo;
    b.disabled = false;
    if (ultimo && ultimo !== "cancelado") aviso("Guardados " + fichas.length + " diseños.");
  });

  document.getElementById("revGaleriaBtn").addEventListener("click", () => {
    if (!fichas.length || !window.KAOS_GALLERY) return;
    let n = 0;
    for (const f of fichas) {
      try { KAOS_GALLERY.add(lienzoDe(f), { style: "libreta", paper: "#d9d4c8" }); n++; }
      catch (e) { break; }
    }
    document.dispatchEvent(new CustomEvent("kaos-gallery-changed"));
    aviso(n === fichas.length ? "Los " + n + " a la galería." : "Cabían " + n + ". La galería está llena.");
  });

  scanExportBtn.addEventListener("click", abrirRevision);

  // Expose for the sidebar button in app.js
  window.KAOS_SCAN = { open: openModal, close: closeModal, normalizar: normalizar };
})();
