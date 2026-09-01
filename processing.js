// KAOS.REALM — image processing kernels
(function (root) {
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function applyLevels(g, bp, wp, gamma) {
    let v = (g - bp) / Math.max(1, wp - bp);
    v = clamp(v, 0, 1);
    return Math.pow(v, gamma);
  }

  // ===== Box blur (RGBA) — used by surrealist =====
  function gaussianBlur(srcData, w, h, radius) {
    if (radius <= 0) return srcData;
    const r = Math.max(1, Math.round(radius));
    const tmp = new Uint8ClampedArray(srcData.length);
    for (let p = 0; p < 3; p++) {
      boxBlurH(srcData, tmp, w, h, r);
      boxBlurV(tmp, srcData, w, h, r);
    }
    return srcData;
  }
  function boxBlurH(src, dst, w, h, r) {
    for (let y = 0; y < h; y++) {
      let sR = 0, sG = 0, sB = 0, sA = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) {
        const i = (row + clamp(x, 0, w - 1)) * 4;
        sR += src[i]; sG += src[i + 1]; sB += src[i + 2]; sA += src[i + 3];
      }
      const div = r * 2 + 1;
      for (let x = 0; x < w; x++) {
        const di = (row + x) * 4;
        dst[di] = sR / div; dst[di + 1] = sG / div; dst[di + 2] = sB / div; dst[di + 3] = sA / div;
        const oi = (row + clamp(x - r, 0, w - 1)) * 4;
        const ni = (row + clamp(x + r + 1, 0, w - 1)) * 4;
        sR += src[ni] - src[oi]; sG += src[ni + 1] - src[oi + 1];
        sB += src[ni + 2] - src[oi + 2]; sA += src[ni + 3] - src[oi + 3];
      }
    }
  }
  function boxBlurV(src, dst, w, h, r) {
    for (let x = 0; x < w; x++) {
      let sR = 0, sG = 0, sB = 0, sA = 0;
      for (let y = -r; y <= r; y++) {
        const i = (clamp(y, 0, h - 1) * w + x) * 4;
        sR += src[i]; sG += src[i + 1]; sB += src[i + 2]; sA += src[i + 3];
      }
      const div = r * 2 + 1;
      for (let y = 0; y < h; y++) {
        const di = (y * w + x) * 4;
        dst[di] = sR / div; dst[di + 1] = sG / div; dst[di + 2] = sB / div; dst[di + 3] = sA / div;
        const oi = (clamp(y - r, 0, h - 1) * w + x) * 4;
        const ni = (clamp(y + r + 1, 0, h - 1) * w + x) * 4;
        sR += src[ni] - src[oi]; sG += src[ni + 1] - src[oi + 1];
        sB += src[ni + 2] - src[oi + 2]; sA += src[ni + 3] - src[oi + 3];
      }
    }
  }

  // ===== Box blur (grayscale Float32) — used by threshold =====
  function boxBlurGray(src, w, h, r) {
    if (r <= 0) return new Float32Array(src);
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const div = r * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[y * w + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / div;
        sum -= src[y * w + clamp(x - r, 0, w - 1)];
        sum += src[y * w + clamp(x + r + 1, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum / div;
        sum -= tmp[clamp(y - r, 0, h - 1) * w + x];
        sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  // ===== Flood-fill background reachable from the canvas border (0/1 fg mask in) =====
  function floodOutside(fg, w, h) {
    const outside = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) { pushIfBg(x, 0); pushIfBg(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIfBg(0, y); pushIfBg(w - 1, y); }
    function pushIfBg(x, y) {
      const i = y * w + x;
      if (!fg[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !fg[i - 1] && !outside[i - 1]) { outside[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !fg[i + 1] && !outside[i + 1]) { outside[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !fg[i - w] && !outside[i - w]) { outside[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !fg[i + w] && !outside[i + w]) { outside[i + w] = 1; stack.push(i + w); }
    }
    return outside;
  }

  // ===== Binary erosion (complement of dilation) =====
  function erodeBinary(mask, w, h, r) {
    if (r <= 0) return mask;
    const inv = new Uint8Array(mask.length);
    for (let j = 0; j < mask.length; j++) inv[j] = mask[j] ? 0 : 1;
    const dInv = dilateBinary(inv, w, h, r);
    const out = new Uint8Array(mask.length);
    for (let j = 0; j < out.length; j++) out[j] = dInv[j] ? 0 : 1;
    return out;
  }

  // ===== Constrained dilation: grow a 0/1 seed r px, but ONLY into `allow` pixels =====
  // Used by the outline so the line can never spill onto the design itself (and can
  // never leak through a hairline into an interior hole).
  function dilateWithin(seed, allow, w, h, r) {
    let cur = seed;
    for (let it = 0; it < r; it++) {
      const next = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const j = y * w + x;
          if (!allow[j]) continue;
          if (cur[j] ||
              (x > 0 && cur[j - 1]) || (x < w - 1 && cur[j + 1]) ||
              (y > 0 && cur[j - w]) || (y < h - 1 && cur[j + w]) ||
              (x > 0 && y > 0 && cur[j - w - 1]) || (x < w - 1 && y > 0 && cur[j - w + 1]) ||
              (x > 0 && y < h - 1 && cur[j + w - 1]) || (x < w - 1 && y < h - 1 && cur[j + w + 1])) next[j] = 1;
        }
      }
      cur = next;
    }
    return cur;
  }

  // ===== Binary dilation (square kernel) — thickens a 0/1 mask by r px =====
  function dilateBinary(mask, w, h, r) {
    if (r <= 0) return mask;
    let cur = mask;
    for (let pass = 0; pass < r; pass++) {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (cur[i]) { out[i] = 1; continue; }
          if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) ||
              (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) out[i] = 1;
        }
      }
      cur = out;
    }
    return cur;
  }

  // ===== Sobel edge magnitude =====
  function sobelMag(gray, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] + gray[i - w + 1]
                   - 2 * gray[i - 1] + 2 * gray[i + 1]
                   - gray[i + w - 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
                   + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        out[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy) * 0.5);
      }
    }
    return out;
  }

  // ===== Style: Surrealist Photocollage =====
  function styleSurrealist(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    const bp = opts.bp, wp = opts.wp, gamma = opts.gamma, contrast = opts.contrast;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let g = lum(d[i], d[i + 1], d[i + 2]);
      g = applyLevels(g, bp, wp, gamma) * 255;
      let n = (g - 128) / 128;
      n = Math.tanh(n * contrast);
      g = clamp(128 + n * 128, 0, 255);
      d[i] = d[i + 1] = d[i + 2] = g;
    }

    if (opts.grain > 0) {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const n = (Math.random() - 0.5) * opts.grain * 2;
        d[i] = clamp(d[i] + n, 0, 255);
        d[i + 1] = clamp(d[i + 1] + n, 0, 255);
        d[i + 2] = clamp(d[i + 2] + n, 0, 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ===== Binary mask cleanup (despeckle + hole-fill + smooth) =====
  // Removes isolated ink specks (secondary reflections / sensor noise) and fills
  // pinholes so solid masses read cleanly. Operates on a 0/1 Uint8Array.
  function removeSmallComponents(ink, w, h, minArea, targetVal) {
    // Flood-fill 8-connected components of value === targetVal; clear those
    // whose area < minArea (set them to 1 - targetVal).
    const N = w * h;
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    const fillVal = targetVal ? 0 : 1;
    for (let s = 0; s < N; s++) {
      if (seen[s] || ink[s] !== targetVal) continue;
      let sp = 0; stack[sp++] = s; seen[s] = 1;
      const comp = []; comp.push(s);
      while (sp > 0) {
        const p = stack[--sp];
        const px = p % w, py = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const np = ny * w + nx;
            if (seen[np] || ink[np] !== targetVal) continue;
            seen[np] = 1; stack[sp++] = np; comp.push(np);
          }
        }
      }
      if (comp.length < minArea) {
        for (let k = 0; k < comp.length; k++) ink[comp[k]] = fillVal;
      }
    }
  }
  // Morphological close→open with a 3×3 kernel, `iter` passes. Closes hairline
  // gaps then shaves single-pixel nubs → smoother, more deliberate edges.
  function morphSmooth(ink, w, h, iter) {
    const dilate = (src) => {
      const o = new Uint8Array(src.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (src[ny * w + nx]) { v = 1; break; }
        }
        o[y * w + x] = v;
      }
      return o;
    };
    const erode = (src) => {
      const o = new Uint8Array(src.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { v = 0; break; }
          if (!src[ny * w + nx]) { v = 0; break; }
        }
        o[y * w + x] = v;
      }
      return o;
    };
    let m = ink;
    for (let i = 0; i < iter; i++) m = erode(dilate(m)); // close
    for (let i = 0; i < iter; i++) m = dilate(erode(m)); // open
    ink.set(m);
  }

  // ===== Style: High Contrast (multi-mode) =====
  function styleThreshold(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // 1) Pre-levels → grayscale
    const gray = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let g = lum(d[i], d[i + 1], d[i + 2]);
      g = applyLevels(g, opts.bp, opts.wp, opts.gamma) * 255;
      gray[j] = g;
    }

    // 2) Local boost (unsharp pre-amp) — fixes "dirty" uneven lighting
    if (opts.localBoost > 0) {
      const blur = boxBlurGray(gray, w, h, 16);
      const amt = opts.localBoost;
      for (let j = 0; j < gray.length; j++) {
        gray[j] = clamp(gray[j] + amt * (gray[j] - blur[j]), 0, 255);
      }
    }

    // 3) Pre-smooth (denoise)
    const smoothed = opts.smooth > 0 ? boxBlurGray(gray, w, h, opts.smooth) : gray;

    // 4) Mode → build a binary ink mask (0/1)
    const ink = new Uint8Array(w * h);        // solid ink
    const stip = new Uint8Array(w * h);       // stipple fringe (drawn lighter)
    const ringPix = new Uint8Array(w * h);    // outline ring (lives OUTSIDE the alpha)
    const INK_R = 10, INK_G = 9, INK_B = 8;

    if (opts.mode === "hard") {
      const T = opts.threshold;
      for (let j = 0; j < smoothed.length; j++) if (smoothed[j] < T) ink[j] = 1;
    } else if (opts.mode === "dotwork") {
      // Dotwork stipple with LOCAL adaptive threshold so objects with wildly
      // different tonal zones (bright blade + dark handle) both get rendered.
      // Each pixel's black/stipple/white boundary is set by its local neighborhood
      // mean, not a single global cut-off — same idea as adaptive mode but
      // rendered as solid-black + stipple-fringe instead of hard binary.
      // Wide fixed fringe → lots of dots. How DARK those dots are is the
      // stippleOpacity control (they render at partial alpha over the paper).
      const band = 140;
      const win = Math.max(5, opts.windowSize || 25);
      const bias = opts.bias != null ? opts.bias : 8;
      const globalT = opts.threshold;
      // local mean for adaptive boundary
      const localMean = boxBlurGray(smoothed, w, h, win);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const j = y * w + x;
          const g = smoothed[j];
          // Per-pixel threshold: blend of local mean and global cut-off.
          // Bias shifts the local threshold darker (more ink).
          const T = Math.min(localMean[j] - bias, globalT);
          const whiteT = Math.min(250, T + band);
          if (g < T) {
            ink[j] = 1;              // solid pure black, crisp
          } else if (g < whiteT) {
            const t = (g - T) / band;
            const prob = clamp((1 - t) * 0.92, 0, 0.92);
            const hv = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
            if ((hv - Math.floor(hv)) < prob) stip[j] = 1;
          }
        }
      }
    } else if (opts.mode === "adaptive") {
      // local-mean threshold — uses each pixel's neighborhood, immune to lighting.
      const win = Math.max(3, opts.windowSize | 0);
      const mean = boxBlurGray(smoothed, w, h, win);
      const bias = opts.bias;
      for (let j = 0; j < smoothed.length; j++) {
        if (smoothed[j] < mean[j] - bias) ink[j] = 1;
      }
    } else if (opts.mode === "edges") {
      const edges = sobelMag(smoothed, w, h);
      const sens = opts.edgeSens;
      for (let j = 0; j < edges.length; j++) if (edges[j] > sens) ink[j] = 1;
    }

    // 5) Clean-up — kills tiny secondary-reflection specks & pinholes and
    // consolidates the solid masses, so low-contrast metallic sources don't read
    // as "dirty". Skipped for dotwork (its dots are intentionally tiny).
    // Runs BEFORE the outline overlay below — otherwise despeckle's small-
    // component removal shreds the thin 1px ring at diagonal turns (where it
    // breaks into disconnected 4-connected fragments) and deletes it entirely.
    const despeckle = opts.despeckle || 0;
    if (despeckle > 0 && opts.mode !== "dotwork") {
      const frac = despeckle / 100;
      // minimum kept area scales with image size and the slider
      const minBlack = Math.max(6, Math.round(w * h * frac * 0.0016));
      const minHole  = Math.max(6, Math.round(w * h * frac * 0.0012));
      removeSmallComponents(ink, w, h, minBlack, 1); // drop isolated ink specks
      removeSmallComponents(ink, w, h, minHole, 0);  // fill little white pinholes
      if (frac > 0.5) morphSmooth(ink, w, h, 1);      // gently smooth edges
    }

    // 5b) Outline — traces the silhouette AND every interior hole (chain links, gaps
    // between wing and body...). The line always grows INTO the background, never
    // into the artwork: outward around the outside, inward into each hole. Small
    // holes get a half-thickness line so they don't seal shut; big holes get the
    // full thickness. Drawn LAST, after despeckle, so it can't be despeckled away.
    const olW = clamp(opts.outlineWidth || 0, 0, 5);
    if (olW > 0 && opts.mode !== "edges") {
      let minA = 255, maxA = 0;
      for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a < minA) minA = a; if (a > maxA) maxA = a; }
      const hasAlphaMask = (maxA - minA) > 40;
      let fg;
      if (hasAlphaMask) {
        fg = new Uint8Array(w * h);
        for (let j = 0, i = 3; j < fg.length; j++, i += 4) fg[j] = d[i] >= 128 ? 1 : 0;
      } else {
        fg = new Uint8Array(w * h);
        for (let j = 0; j < fg.length; j++) fg[j] = (ink[j] || stip[j]) ? 1 : 0;
      }
      // Closing dilation to bridge sparse-pattern gaps (dotwork/stipple) is only
      // needed when ink itself is sparse — for solid modes (hard/adaptive) ink is
      // already a closed shape, so padding it would push the ring away from the
      // real edge. Gate it to dotwork only, and keep it small.
      const closedFg = (hasAlphaMask || opts.mode !== "dotwork") ? fg : dilateBinary(fg, w, h, 4);
      const outside = floodOutside(closedFg, w, h);
      // Every background pixel the line is allowed to occupy.
      const bg = new Uint8Array(w * h);
      for (let j = 0; j < bg.length; j++) bg[j] = closedFg[j] ? 0 : 1;
      // Thickness is resolution-independent: 1 slider unit ≈ 0.3% of the short side.
      const unit = Math.max(1, Math.min(w, h) / 320);
      const tFull = Math.max(1, Math.round(olW * unit));
      const tHalf = Math.max(1, Math.round(olW * unit / 2));
      // seeds: background pixels touching the REAL silhouette (fg, not the padded one)
      const seedAt = (region) => {
        const s = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const j = y * w + x;
            if (!region[j] || !bg[j]) continue;
            if ((x > 0 && fg[j - 1]) || (x < w - 1 && fg[j + 1]) ||
                (y > 0 && fg[j - w]) || (y < h - 1 && fg[j + w])) s[j] = 1;
          }
        }
        return s;
      };
      const ring = new Uint8Array(w * h);
      const holeRings = new Uint8Array(w * h);
      // --- outer silhouette: grows outward, capped to the outside region ---
      const outerAllow = new Uint8Array(w * h);
      for (let j = 0; j < outerAllow.length; j++) outerAllow[j] = (outside[j] && bg[j]) ? 1 : 0;
      const outerRing = dilateWithin(seedAt(outerAllow), outerAllow, w, h, tFull);
      for (let j = 0; j < ring.length; j++) if (outerRing[j]) ring[j] = 1;
      // --- interior holes: label each enclosed background pocket, size it, grow inward ---
      const seen = new Uint8Array(w * h);
      for (let start = 0; start < bg.length; start++) {
        if (!bg[start] || outside[start] || seen[start]) continue;
        const cells = [];
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const p = stack.pop();
          cells.push(p);
          const px = p % w, py = (p - px) / w;
          if (px > 0 && bg[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (px < w - 1 && bg[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (py > 0 && bg[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
          if (py < h - 1 && bg[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
        }
        // equivalent radius of the pocket decides thin vs full line
        const r = Math.sqrt(cells.length / Math.PI);
        if (r < 1.6) continue;                       // pinhole: leave it alone
        let t = (r < tFull * 4) ? tHalf : tFull;     // small hole → half thickness
        const isSmall = r < tFull * 4;
        t = Math.max(1, Math.min(t, Math.floor(r * 0.55))); // never seal the hole shut
        const holeAllow = new Uint8Array(w * h);
        for (const p of cells) holeAllow[p] = 1;
        const hr = dilateWithin(seedAt(holeAllow), holeAllow, w, h, t);
        // big pockets read as part of the silhouette → same weight + smoothing as the
        // outer line; small pockets stay crisp so the blur can't seal them.
        const dst = isSmall ? holeRings : ring;
        for (let j = 0; j < dst.length; j++) if (hr[j]) dst[j] = 1;
      }
      // Keep hard corners: the ring comes out of an 8-connected (chebyshev) dilation,
      // which already offsets sharp corners as corners. Blurring it used to round every
      // sharp point off, so instead we only fill single-pixel staircase notches — a
      // pixel joins the line when most of its neighbours are already line.
      for (let j = 0; j < ring.length; j++) if (ring[j] || holeRings[j]) ringPix[j] = 1;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const j = y * w + x;
          if (ringPix[j] || !bg[j] || fg[j]) continue;
          const n = ring[j - 1] + ring[j + 1] + ring[j - w] + ring[j + w] +
            ring[j - w - 1] + ring[j - w + 1] + ring[j + w - 1] + ring[j + w + 1];
          if (n >= 5) ringPix[j] = 1;
        }
      }
    }

    // 6) Composite → pixels. Source alpha (the cutout mask) clips ink and stipple,
    // but NOT the outline ring: the ring by definition sits just outside the
    // silhouette, so clipping it would erase the whole line (that was the bug).
    const stipA = Math.round(clamp(
      opts.stippleOpacity != null ? opts.stippleOpacity / 100 : 0.55, 0.05, 1) * 255);
    const ringA = 255;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < ink.length; j++) {
      const i = j * 4;
      let a = 0;
      if (d[i + 3] >= 128) a = ink[j] ? 255 : (stip[j] ? stipA : 0);
      if (ringPix[j] && ringA > a) a = ringA;
      if (!a) continue;
      out[i] = INK_R; out[i + 1] = INK_G; out[i + 2] = INK_B; out[i + 3] = a;
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    return c;
  }

  // ===== Style: Halftone dots =====
  function styleHalftone(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const sCan = document.createElement("canvas");
    sCan.width = w; sCan.height = h;
    const sCtx = sCan.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(srcCanvas, 0, 0);
    if (opts.smooth > 0) {
      const sImg = sCtx.getImageData(0, 0, w, h);
      gaussianBlur(sImg.data, w, h, opts.smooth);
      sCtx.putImageData(sImg, 0, 0);
    }
    const srcData = sCtx.getImageData(0, 0, w, h).data;
    const cell = Math.max(2, opts.cell | 0);
    const angle = (opts.angle || 0) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);

    function sampleAt(cx, cy) {
      const r = Math.max(1, Math.floor(cell / 2));
      let sum = 0, n = 0;
      const x0 = Math.max(0, cx - r), x1 = Math.min(w - 1, cx + r);
      const y0 = Math.max(0, cy - r), y1 = Math.min(h - 1, cy + r);
      // If masked-out (alpha=0), skip (the source canvas may have been masked)
      let alphaSum = 0;
      for (let y = y0; y <= y1; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          const i = (y * w + x) * 4;
          sum += lum(srcData[i], srcData[i + 1], srcData[i + 2]);
          alphaSum += srcData[i + 3];
          n++;
        }
      }
      if (n === 0 || alphaSum / n < 64) return 255;
      return sum / n;
    }

    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const oCtx = out.getContext("2d");
    oCtx.clearRect(0, 0, w, h);
    oCtx.fillStyle = "#0a0908";
    const diag = Math.sqrt(w * w + h * h);
    const boost = opts.boost || 1.0;
    const gamma = opts.gamma || 1.0;
    for (let v = -diag; v < diag; v += cell) {
      for (let u = -diag; u < diag; u += cell) {
        const x = Math.round(u * cos - v * sin + w / 2);
        const y = Math.round(u * sin + v * cos + h / 2);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const L = sampleAt(x, y) / 255;
        let dark = Math.pow(1 - L, gamma) * boost;
        dark = clamp(dark, 0, 1);
        const r = dark * (cell / 2) * Math.SQRT2;
        if (r < 0.3) continue;
        oCtx.beginPath();
        oCtx.arc(x, y, r, 0, Math.PI * 2);
        oCtx.fill();
      }
    }
    return out;
  }

  // ===== Style: Stipple / engraving =====
  function styleStipple(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const sCan = document.createElement("canvas");
    sCan.width = w; sCan.height = h;
    const sCtx = sCan.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(srcCanvas, 0, 0);
    if (opts.smooth > 0) {
      const sImg = sCtx.getImageData(0, 0, w, h);
      gaussianBlur(sImg.data, w, h, opts.smooth);
      sCtx.putImageData(sImg, 0, 0);
    }
    const srcData = sCtx.getImageData(0, 0, w, h).data;

    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const oCtx = out.getContext("2d");
    oCtx.fillStyle = "#0a0908";
    const dotSize = opts.dotSize || 1;
    const density = opts.density || 0.5;
    const gamma = opts.gamma || 1.0;
    const totalDots = Math.floor(w * h * density);
    let placed = 0, tries = 0;
    while (placed < totalDots && tries < totalDots * 4) {
      tries++;
      const x = (Math.random() * w) | 0;
      const y = (Math.random() * h) | 0;
      const i = (y * w + x) * 4;
      if (srcData[i + 3] < 64) continue;
      const L = lum(srcData[i], srcData[i + 1], srcData[i + 2]) / 255;
      const dark = Math.pow(1 - L, gamma);
      if (Math.random() > dark) continue;
      oCtx.beginPath();
      oCtx.arc(x, y, dotSize, 0, Math.PI * 2);
      oCtx.fill();
      placed++;
    }
    return out;
  }

  // ===== Frame shape =====
  // Builds the shape outline as a path centred on (0,0) in a box of ww × hh.
  function shapePath(ctx, shape, ww, hh) {
    ctx.beginPath();
    if (shape === "rect" || shape === "square") {
      ctx.rect(-ww / 2, -hh / 2, ww, hh);
    } else if (shape === "oval") {
      ctx.ellipse(0, 0, ww / 2, hh / 2, 0, 0, Math.PI * 2);
    } else if (shape === "heart") {
      const N = 200, sx = ww / 32, sy = hh / 32;
      for (let k = 0; k <= N; k++) {
        const t = (k / N) * Math.PI * 2;
        const px = 16 * Math.pow(Math.sin(t), 3);
        const py = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        const X = px * sx, Y = py * sy;
        if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
    } else if (shape === "star" || shape === "starLong") {
      const points = 5;
      const outerR = Math.min(ww, hh) / 2;
      const innerR = outerR * (shape === "starLong" ? 0.32 : 0.5);
      const stretchY = shape === "starLong" ? Math.max(1.35, hh / ww) : 1;
      for (let k = 0; k < points * 2; k++) {
        const r = k % 2 === 0 ? outerR : innerR;
        const ang = (k / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const X = Math.cos(ang) * r, Y = Math.sin(ang) * r * stretchY;
        if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
    } else if (shape === "destello") {
      // Destello de ocho puntas: las cuatro rectas largas (la de arriba, la mas
      // larga de todas) y las cuatro diagonales cortas, con el nucleo pequeno y
      // los filos metidos hacia dentro para que salgan como agujas.
      const rayos = [
        [-90, 1.00], [-45, 0.25], [0, 0.51], [45, 0.25],
        [90, 0.49], [135, 0.25], [180, 0.51], [-135, 0.25],
      ];
      const hx = ww / 2, hy = hh / 2;
      const valle = 0.075;                 // el nucleo: donde se juntan las agujas
      const pt = (grados, r) => {
        const a = grados * Math.PI / 180;
        return [Math.cos(a) * r * hx, Math.sin(a) * r * hy];
      };
      for (let k = 0; k < rayos.length; k++) {
        const [gA, rA] = rayos[k];
        const [gB, rB] = rayos[(k + 1) % rayos.length];
        // El angulo del valle es el punto medio entre dos puntas. Se calcula
        // sumando 22,5 grados y no promediando: promediar da la mitad opuesta
        // al pasar de 180 a -135 y el filo cruzaria la figura entera.
        const gV = gA + 22.5;
        const [ax, ay] = pt(gA, rA);
        const [vx, vy] = pt(gV, valle);
        const [bx, by] = pt(gB, rB);
        if (k === 0) ctx.moveTo(ax, ay);
        // Control tirado hacia el centro: filo concavo, punta de aguja.
        ctx.quadraticCurveTo(vx * 0.55, vy * 0.55, bx, by);
      }
      ctx.closePath();
    } else if (shape === "diamond") {
      ctx.moveTo(0, -hh / 2); ctx.lineTo(ww / 2, 0); ctx.lineTo(0, hh / 2); ctx.lineTo(-ww / 2, 0);
      ctx.closePath();
    } else if (shape === "hex") {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
        const X = Math.cos(a) * ww / 2, Y = Math.sin(a) * hh / 2;
        if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.closePath();
    } else if (shape === "arch") {
      const r = ww / 2;
      ctx.moveTo(-r, hh / 2); ctx.lineTo(-r, -hh / 2 + r);
      ctx.arc(0, -hh / 2 + r, r, Math.PI, 0);
      ctx.lineTo(r, hh / 2); ctx.closePath();
    }
  }
  // xf: { x, y, scale, rot } — x/y are percentages of the canvas (50/50 = centre),
  // scale multiplies the fitted box, rot is degrees. outlineW: 0–5 slider units.
  // `relleno`: "negro" | "blanco" pinta de color plano el hueco de la forma al
  // que el diseno no llega. Va DENTRO del recorte y DEBAJO de la tinta, asi que
  // la forma sale entera y maciza en vez de con el papel asomando por detras.
  function applyShape(layerCanvas, shape, paddingPct, xf, outlineW, relleno) {
    if (shape === "none") return layerCanvas;
    const w = layerCanvas.width, h = layerCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    const t = xf || {};
    const sc = t.scale != null ? t.scale : 1;
    const cx = ((t.x != null ? t.x : 50) / 100) * w;
    const cy = ((t.y != null ? t.y : 50) / 100) * h;
    const pad = paddingPct;
    const ww = w * (1 - pad * 2) * sc, hh = h * (1 - pad * 2) * sc;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((t.rot || 0) * Math.PI) / 180);
    shapePath(ctx, shape, ww, hh);
    ctx.save();
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (relleno === "negro" || relleno === "blanco") {
      ctx.fillStyle = relleno === "negro" ? "rgb(10,9,8)" : "rgb(255,255,255)";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
    const olw = clamp(outlineW || 0, 0, 5);
    if (olw > 0) {
      ctx.lineWidth = Math.max(1, olw * Math.max(1, Math.min(w, h) / 320) * 1.6);
      ctx.strokeStyle = "rgb(10,9,8)";
      ctx.lineJoin = "miter";
      ctx.miterLimit = 8;
      ctx.stroke();
    }
    ctx.restore();
    return out;
  }

  // ===== Worn / distressed erosion (natural wear) =====
  // Real wear is COHERENT, not per-pixel random: ink flakes off in soft organic
  // patches, and it always starts where the ink is most exposed — outer edges and
  // thin strokes — while deep solid masses survive longest. So: fractal (fBm) value
  // noise for the patch shapes, weighted by how buried each pixel is inside the ink.
  function fbmField(w, h, cellX, cellY, octaves, rand) {
    const field = new Float32Array(w * h);
    let amp = 1, norm = 0, cx = cellX, cy = cellY;
    for (let o = 0; o < octaves; o++) {
      const gw = Math.max(2, Math.ceil(w / cx) + 2), gh = Math.max(2, Math.ceil(h / cy) + 2);
      const g = new Float32Array(gw * gh);
      for (let i = 0; i < g.length; i++) g[i] = rand();
      for (let y = 0; y < h; y++) {
        const fy = y / cy, gy = fy | 0, ty = fy - gy, sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < w; x++) {
          const fx = x / cx, gx = fx | 0, tx = fx - gx, sx = tx * tx * (3 - 2 * tx);
          const i00 = gy * gw + gx, i01 = i00 + gw;
          const a = g[i00] + (g[i00 + 1] - g[i00]) * sx;
          const b = g[i01] + (g[i01 + 1] - g[i01]) * sx;
          field[y * w + x] += (a + (b - a) * sy) * amp;
        }
      }
      norm += amp; amp *= 0.52;
      cx = Math.max(2, cx / 2.1); cy = Math.max(2, cy / 2.1);
    }
    for (let i = 0; i < field.length; i++) field[i] /= norm;
    return field;
  }
  // fBm fields are the expensive part of the wear pass and depend only on size,
  // cell size, octaves and seed — never on the artwork. Cache a handful so dragging
  // a slider (or typing under a text-targeted wear) doesn't rebuild them each frame.
  const _fbmCache = [];
  function cachedFbm(w, h, cellX, cellY, octaves, seed) {
    const key = [w, h, Math.round(cellX * 100), Math.round(cellY * 100), octaves, seed].join("|");
    const hit = _fbmCache.find(e => e.key === key);
    if (hit) return hit.field;
    const field = fbmField(w, h, cellX, cellY, octaves, mulberry32(seed));
    _fbmCache.unshift({ key, field });
    while (_fbmCache.length > 6) _fbmCache.pop();
    return field;
  }
  function mulberry32(seed) {
    let t = (seed | 0) || 1;
    return function () {
      t = (t + 0x6D2B79F5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  // a hand-drawn-feeling scratch: short random-walk polyline, tapered at both ends
  function wearStroke(ctx, x, y, ang, len, width, w, h, rand) {
    const steps = Math.max(3, Math.round(len / 14));
    ctx.lineCap = "round";
    let px = x, py = y, a = ang;
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 0.5;
      const seg = len / steps;
      const nx = px + Math.cos(a) * seg, ny = py + Math.sin(a) * seg;
      const t = s / (steps - 1);
      const taper = Math.sin(Math.PI * (0.15 + 0.85 * t));
      ctx.lineWidth = Math.max(0.4, width * taper);
      ctx.strokeStyle = "rgba(0,0,0," + (0.25 + 0.5 * taper) + ")";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      px = nx; py = ny;
      if (px < -20 || py < -20 || px > w + 20 || py > h + 20) break;
    }
  }
  // seed keeps the wear pattern STABLE: identical while you drag the sliders, and
  // identical between the half-size preview and the full-HD export.
  function distressLayer(srcCanvas, amount, noiseType, seed, region, opts) {
    noiseType = noiseType || "fine";
    // opts: texScale (how big the wear patches read), edgeBias (0 = uniform wear,
    // 100 = eats edges/thin strokes first), scratch (scratch + pinhole density).
    opts = opts || {};
    const texScale = clamp(opts.texScale || 1, 0.2, 4);
    const edgeBias = clamp(opts.edgeBias == null ? 100 : opts.edgeBias, 0, 100) / 100;
    const scratchMul = clamp(opts.scratch == null ? 100 : opts.scratch, 0, 200) / 100;
    const w = srcCanvas.width, h = srcCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const amt = clamp(amount, 0, 100) / 100;
    if (amt <= 0) return out;
    // Optional region: wear only touches pixels the region canvas marks as opaque.
    let reg = null, regCan = null;
    if (region) {
      regCan = document.createElement("canvas");
      regCan.width = w; regCan.height = h;
      const rc = regCan.getContext("2d", { willReadFrequently: true });
      rc.drawImage(region, 0, 0, w, h);
      const rd = rc.getImageData(0, 0, w, h).data;
      reg = new Uint8Array(w * h);
      for (let j = 0, i = 3; j < reg.length; j++, i += 4) reg[j] = rd[i];
    }
    const short = Math.max(32, Math.min(w, h));
    const rand = mulberry32(((seed || 4242) ^ 0x5bf03635) | 0);
    const pixRand = mulberry32(((seed || 4242) ^ 0x1a2b3c4d) | 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;

    // --- how buried is each pixel? blurred coverage: 1 = deep solid, low = edge/hairline
    const alpha = new Float32Array(w * h);
    for (let j = 0, i = 3; j < alpha.length; j++, i += 4) alpha[j] = d[i];
    const cover = boxBlurGray(alpha, w, h, Math.max(2, Math.round(short * 0.012)));

    // --- patch shape per texture: cell sizes drive how big the missing areas read
    let cellX, cellY, oct = 4, bite = 0.9, feather = 0.16;
    if (noiseType === "coarse")        { cellX = cellY = short / 6;  bite = 1.0; feather = 0.2; }
    else if (noiseType === "scratches"){ cellX = short / 60; cellY = short / 3.2; oct = 3; bite = 0.75; feather = 0.1; }
    else if (noiseType === "speckle")  { cellX = cellY = short / 40; oct = 3; bite = 0.7; feather = 0.06; }
    else                               { cellX = cellY = short / 22; bite = 0.85; feather = 0.14; }
    cellX *= texScale; cellY *= texScale;
    const field = cachedFbm(w, h, cellX, cellY, oct, (seed || 4242) | 0);
    // second, much larger octave: the occasional big rubbed-away area
    const macroCell = (short / 2.6) * texScale;
    const macro = cachedFbm(w, h, macroCell, macroCell, 2, ((seed || 4242) + 7919) | 0);
    const cut = 1 - amt * bite;

    for (let j = 0, i = 3; j < field.length; j++, i += 4) {
      if (d[i] < 6) continue;
      if (reg && reg[j] < 100) continue;
      const rawExp = clamp(1.18 - cover[j] / 255, 0.12, 1); // edges & thin strokes first
      const exposure = edgeBias * rawExp + (1 - edgeBias) * 0.62;
      const wear = field[j] * (0.42 + 0.85 * exposure) + macro[j] * 0.22 * amt;
      const over = wear - cut;
      if (over <= 0) continue;
      let keep = 1 - over / feather;
      if (keep < 0) keep = 0;
      // a hair of grain inside the surviving fringe so the break isn't a clean edge
      if (keep > 0 && keep < 0.9) keep *= 0.75 + pixRand() * 0.25;
      d[i] = d[i] * keep;
    }
    ctx.putImageData(img, 0, 0);

    // --- scratches: few, curved, tapered. Only "scratches" leans on them.
    const count = Math.round(amt * (noiseType === "scratches" ? 16 : noiseType === "coarse" ? 4 : 6) * scratchMul);
    // Painted on their own layer so a region can clip them before they bite.
    const scr = document.createElement("canvas");
    scr.width = w; scr.height = h;
    const sctx = scr.getContext("2d");
    sctx.fillStyle = sctx.strokeStyle = "#000";
    const grainAng = rand() * Math.PI;  // one dominant rub direction, like paper against a pocket
    for (let s = 0; s < count; s++) {
      const ang = grainAng + (rand() - 0.5) * (noiseType === "scratches" ? 0.5 : 2.2);
      wearStroke(sctx, rand() * w, rand() * h, ang,
        (0.08 + rand() * (noiseType === "scratches" ? 0.5 : 0.22)) * Math.max(w, h),
        (short / 900) * texScale * (0.7 + rand() * (noiseType === "coarse" ? 3.2 : 1.8)), w, h, rand);
    }
    // --- pinholes: clustered where the ink is already thin, power-law sizes
    if (noiseType === "speckle") {
      const holes = Math.round(amt * scratchMul * (w * h) / (2600 * texScale * texScale));
      for (let k = 0; k < holes; k++) {
        const x = rand() * w, y = rand() * h;
        const j = ((y | 0) * w + (x | 0));
        if (field[j] < 0.42) continue;
        const r = (short / 700) * texScale * (0.6 + Math.pow(rand(), 3) * 6);
        sctx.globalAlpha = 0.55 + rand() * 0.45;
        sctx.beginPath();
        sctx.arc(x, y, r, 0, Math.PI * 2);
        sctx.fill();
      }
      sctx.globalAlpha = 1;
    }
    if (regCan) {
      sctx.globalCompositeOperation = "destination-in";
      sctx.drawImage(regCan, 0, 0);
      sctx.globalCompositeOperation = "source-over";
    }
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(scr, 0, 0);
    ctx.restore();
    return out;
  }

  // ===== Cursive text overlay =====
  // opts.xor: where the text crosses the artwork the overlap is knocked out
  // (reads as a negative), while both keep their solid ink everywhere else.
  function drawTextOverlay(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    if (!opts.text && !opts.pre) return out;
    // opts.pre: an already-rendered text layer (used when the wear filter is
    // targeted at the text only — it is distressed before it lands here).
    const tl = opts.pre || textLayer(w, h, opts);
    ctx.globalCompositeOperation = opts.xor ? "xor" : "source-over";
    ctx.drawImage(tl, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }
  function textLayer(w, h, opts) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    if (opts.text) drawTextInto(c.getContext("2d"), opts, w, h);
    return c;
  }
  function drawTextInto(ctx, opts, w, h) {
    const size = (opts.size / 100) * Math.min(w, h);
    ctx.save();
    ctx.translate((opts.x / 100) * w, (opts.y / 100) * h);
    ctx.rotate((opts.rot || 0) * Math.PI / 180);
    let fontCss = "'Italianno', cursive", weight = "400";
    if (opts.font && window.KAOS_GALLERY && KAOS_GALLERY.FONTS[opts.font]) {
      const f = KAOS_GALLERY.FONTS[opts.font];
      fontCss = `"${f.family}", serif`;
      weight = f.weight;
    }
    ctx.font = weight + " " + size + "px " + fontCss;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = opts.color || "#0a0908";
    ctx.fillText(opts.text, 0, 0);
    ctx.restore();
  }

  // ===== Compose onto paper =====
  // The paper substrate (colour + grain + vignette) and the top grain used to be
  // rebuilt pixel by pixel on EVERY frame — 300 ms per repaint at preview size, which
  // is what made typing the cursive text feel like wading through treacle. Both are
  // now cached per size/colour/amount and composited with a single drawImage.
  let paperBgCache = { key: null, canvas: null };
  function paperBackground(w, h, paperColor, grain) {
    const key = w + "x" + h + "|" + paperColor + "|" + grain;
    if (paperBgCache.key === key && paperBgCache.canvas) return paperBgCache.canvas;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = paperColor;
    ctx.fillRect(0, 0, w, h);
    if (grain > 0) {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const cx = w / 2, cy = h / 2;
      const maxD = Math.sqrt(cx * cx + cy * cy);
      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const r = Math.sqrt(dx * dx + dy * dy) / maxD;
          const v = r * r * 28;
          const n = (Math.random() - 0.5) * grain * 2;
          const i = (y * w + x) * 4;
          d[i] = clamp(d[i] + n - v, 0, 255);
          d[i + 1] = clamp(d[i + 1] + n * 0.9 - v, 0, 255);
          d[i + 2] = clamp(d[i + 2] + n * 0.8 - v, 0, 255);
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    paperBgCache = { key, canvas: c };
    return c;
  }
  let topGrainCache = { key: null, canvas: null };
  function topGrainLayer(w, h, amt) {
    const key = w + "x" + h + "|" + amt;
    if (topGrainCache.key === key && topGrainCache.canvas) return topGrainCache.canvas;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt * 2;
      const v = n >= 0 ? 255 : 0;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
      d[i + 3] = Math.min(255, Math.abs(n));
    }
    ctx.putImageData(img, 0, 0);
    topGrainCache = { key, canvas: c };
    return c;
  }
  function composeOnPaper(processedLayer, paperColor, opts) {
    const w = processedLayer.width, h = processedLayer.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    ctx.drawImage(paperBackground(w, h, paperColor, opts.paperGrain || 0), 0, 0);

    if (opts.shadow > 0) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0," + (opts.shadow * 0.6) + ")";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(processedLayer, 0, 0);
      ctx.restore();
    }

    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(processedLayer, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    if (opts.topGrain > 0) ctx.drawImage(topGrainLayer(w, h, opts.topGrain), 0, 0);

    return out;
  }

  // ===== Feather a binary 0/255 mask into a soft-edged alpha ramp =====
  function clampI(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function boxBlur1D(src, w, h, r) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + clampI(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += src[row + clampI(x + r + 1, 0, w - 1)] - src[row + clampI(x - r, 0, w - 1)];
      }
    }
    const out = new Float32Array(src.length);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[clampI(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[clampI(y + r + 1, 0, h - 1) * w + x] - tmp[clampI(y - r, 0, h - 1) * w + x];
      }
    }
    return out;
  }
  function featherMaskAlpha(m, w, h, radius) {
    radius = Math.max(0, Math.min(40, radius | 0));
    if (radius <= 0) return m;
    let src = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) src[i] = m[i];
    for (let p = 0; p < 3; p++) src = boxBlur1D(src, w, h, radius);
    const out = new Uint8ClampedArray(m.length);
    for (let i = 0; i < m.length; i++) out[i] = src[i];
    return out;
  }

  // ===== Mask helper: bake mask into source as alpha=0 for masked pixels =====
  function maskSource(srcCanvas, m, feather) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    if (!m) return out;
    const alphaMask = (feather && feather > 0) ? featherMaskAlpha(m, w, h, feather) : m;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const a = alphaMask[j];
      if (a >= 250) continue;
      const f = a / 255;
      d[i]     = Math.round(d[i]     * f + 255 * (1 - f));
      d[i + 1] = Math.round(d[i + 1] * f + 255 * (1 - f));
      d[i + 2] = Math.round(d[i + 2] * f + 255 * (1 - f));
      d[i + 3] = Math.round(d[i + 3] * f);
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  // ===== Prep Photo: optimize source for tattoo processing =====
  // Analyzes histogram, auto-stretches levels, boosts midtone contrast,
  // and enhances local contrast so the style effects get clean input.
  // intensity: 0-100 (0 = no change, 100 = aggressive)
  function prepPhoto(srcCanvas, intensity) {
    const str = clamp((intensity != null ? intensity : 60) / 100, 0, 1);
    const w = srcCanvas.width, h = srcCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;

    // 1) Build luminance histogram
    const hist = new Uint32Array(256);
    const lumArr = new Float32Array(n);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const L = lum(d[i], d[i + 1], d[i + 2]);
      lumArr[j] = L;
      hist[Math.round(clamp(L, 0, 255))]++;
    }

    // 2) Auto-levels: find clip percentiles
    const clipPct = 0.005 + str * 0.02; // 0.5% to 2.5% clip
    const clipN = Math.floor(n * clipPct);
    let cumLo = 0, bp = 0;
    for (let i = 0; i < 256; i++) { cumLo += hist[i]; if (cumLo >= clipN) { bp = i; break; } }
    let cumHi = 0, wp = 255;
    for (let i = 255; i >= 0; i--) { cumHi += hist[i]; if (cumHi >= clipN) { wp = i; break; } }
    if (wp <= bp + 10) { wp = Math.min(255, bp + 50); }

    // 3) Compute mean and std for adaptive S-curve
    let sum = 0, sum2 = 0;
    for (let j = 0; j < n; j++) { sum += lumArr[j]; sum2 += lumArr[j] * lumArr[j]; }
    const mean = sum / n;
    const std = Math.sqrt(sum2 / n - mean * mean);

    // 4) S-curve strength: more if image is flat, less if already contrasty
    const flatness = clamp(1 - std / 80, 0, 1); // std<30 = flat, std>80 = contrasty
    const sCurve = 0.15 + str * 0.35 * (0.4 + flatness * 0.6);

    // 5) Local contrast (simplified unsharp on luminance)
    // Build blurred luminance for local contrast
    const blurR = Math.max(3, Math.round(Math.min(w, h) * 0.04));
    const lumBlur = new Float32Array(n);
    // horizontal box blur
    for (let y = 0; y < h; y++) {
      let s = 0, cnt = 0;
      for (let x = -blurR; x <= blurR; x++) {
        const cx = clamp(x, 0, w - 1);
        s += lumArr[y * w + cx]; cnt++;
      }
      for (let x = 0; x < w; x++) {
        lumBlur[y * w + x] = s / cnt;
        const ol = clamp(x - blurR, 0, w - 1);
        const nr = clamp(x + blurR + 1, 0, w - 1);
        s += lumArr[y * w + nr] - lumArr[y * w + ol];
      }
    }
    // vertical pass
    const lumBlur2 = new Float32Array(n);
    for (let x = 0; x < w; x++) {
      let s = 0, cnt = 0;
      for (let y = -blurR; y <= blurR; y++) {
        const cy = clamp(y, 0, h - 1);
        s += lumBlur[cy * w + x]; cnt++;
      }
      for (let y = 0; y < h; y++) {
        lumBlur2[y * w + x] = s / cnt;
        const ol = clamp(y - blurR, 0, h - 1);
        const nr = clamp(y + blurR + 1, 0, h - 1);
        s += lumBlur[nr * w + x] - lumBlur[ol * w + x];
      }
    }

    const localStr = str * 0.5; // local contrast amount

    // 6) Apply per-pixel: levels stretch → S-curve → local contrast boost
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      for (let c = 0; c < 3; c++) {
        let v = d[i + c];

        // Levels stretch
        v = clamp((v - bp) / Math.max(1, wp - bp) * 255, 0, 255);

        // S-curve contrast (sigmoid around 128)
        const norm = v / 255;
        const curved = norm + sCurve * norm * (1 - norm) * (norm - 0.5) * 4;
        v = clamp(curved * 255, 0, 255);

        // Local contrast: push away from local mean
        if (localStr > 0) {
          const localMean = lumBlur2[j];
          const localNorm = clamp((localMean - bp) / Math.max(1, wp - bp) * 255, 0, 255);
          const diff = v - localNorm;
          v = clamp(v + diff * localStr, 0, 255);
        }

        d[i + c] = Math.round(v);
      }
    }

    ctx.putImageData(img, 0, 0);
    return out;
  }

  // ===== Style: CALCO (Canny edge stencil for tattoo transfer) =====
  // Full Canny pipeline optimized for CLEAN tattoo stencils:
  // Heavy pre-blur to kill textures → Sobel → NMS → hysteresis → gap closing → aggressive cleanup
  function styleCalco(srcCanvas, opts) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const N = w * h;

    // --- 1) Levels + grayscale ---
    const gray = new Float32Array(N);
    const bp = opts.bp || 0, wp = opts.wp || 255, gamma = opts.gamma || 1.0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      let g = lum(d[i], d[i + 1], d[i + 2]);
      g = applyLevels(g, bp, wp, gamma) * 255;
      gray[j] = g;
    }

    // --- 2) Moderate blur (kill noise, preserve edge structure) ---
    const blurR = clamp(opts.blur != null ? opts.blur : 3, 0, 12);
    let blurred = gray;
    if (blurR > 0) {
      // Single-pass box blur — enough for noise, doesn't destroy contours
      blurred = boxBlurGray(blurred, w, h, blurR);
    }

    // --- 3) Local contrast boost (pull out main shapes from flat areas) ---
    const detail = opts.detail != null ? opts.detail / 100 : 0.4;
    if (detail > 0) {
      const localR = Math.max(12, Math.round(Math.min(w, h) * 0.06));
      const localMean = boxBlurGray(blurred, w, h, localR);
      for (let j = 0; j < N; j++) {
        blurred[j] = clamp(blurred[j] + detail * 2.0 * (blurred[j] - localMean[j]), 0, 255);
      }
    }

    // --- 4) Sobel gradient magnitude + direction ---
    const mag = new Float32Array(N);
    const dir = new Float32Array(N);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const j = y * w + x;
        const tl = blurred[(y-1)*w+x-1], tc = blurred[(y-1)*w+x], tr = blurred[(y-1)*w+x+1];
        const ml = blurred[y*w+x-1],                               mr = blurred[y*w+x+1];
        const bl = blurred[(y+1)*w+x-1], bc = blurred[(y+1)*w+x], br = blurred[(y+1)*w+x+1];
        const gx = -tl + tr - 2*ml + 2*mr - bl + br;
        const gy = -tl - 2*tc - tr + bl + 2*bc + br;
        mag[j] = Math.sqrt(gx * gx + gy * gy);
        let angle = Math.atan2(gy, gx) * 180 / Math.PI;
        if (angle < 0) angle += 180;
        if (angle < 22.5 || angle >= 157.5) dir[j] = 0;
        else if (angle < 67.5)  dir[j] = 1;
        else if (angle < 112.5) dir[j] = 2;
        else dir[j] = 3;
      }
    }

    // --- 5) Non-maximum suppression (thin edges to 1px) ---
    const nms = new Float32Array(N);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const j = y * w + x;
        const m = mag[j];
        let n1 = 0, n2 = 0;
        const d4 = dir[j];
        if (d4 === 0)      { n1 = mag[j - 1];     n2 = mag[j + 1]; }
        else if (d4 === 1) { n1 = mag[(y-1)*w+x+1]; n2 = mag[(y+1)*w+x-1]; }
        else if (d4 === 2) { n1 = mag[(y-1)*w+x];   n2 = mag[(y+1)*w+x]; }
        else               { n1 = mag[(y-1)*w+x-1]; n2 = mag[(y+1)*w+x+1]; }
        nms[j] = (m >= n1 && m >= n2) ? m : 0;
      }
    }

    // --- 6) Hysteresis thresholding ---
    // sensitivity (0-100): higher = more lines
    const sens = clamp(opts.sensitivity != null ? opts.sensitivity : 35, 0, 100);
    let maxMag = 0;
    for (let j = 0; j < N; j++) if (nms[j] > maxMag) maxMag = nms[j];
    if (maxMag < 1) maxMag = 1;
    // Higher base thresholds = less noise, only strong edges
    const hiPct = clamp(0.35 - sens * 0.003, 0.04, 0.50);
    const loPct = hiPct * 0.45;
    const hiT = maxMag * hiPct;
    const loT = maxMag * loPct;

    const edge = new Uint8Array(N);
    for (let j = 0; j < N; j++) {
      if (nms[j] >= hiT) edge[j] = 2;
      else if (nms[j] >= loT) edge[j] = 1;
    }

    // BFS: connect weak edges to strong
    const stack = [];
    for (let j = 0; j < N; j++) { if (edge[j] === 2) stack.push(j); }
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nj = ny * w + nx;
          if (edge[nj] === 1) { edge[nj] = 2; stack.push(nj); }
        }
      }
    }

    // --- 7) Build ink mask ---
    const ink = new Uint8Array(N);
    for (let j = 0; j < N; j++) { if (edge[j] === 2) ink[j] = 1; }

    // --- 8) Gap closing: dilate then thin back ---
    // Close small gaps in contour lines to make them continuous
    const gapClose = clamp(opts.gapClose != null ? opts.gapClose : 2, 0, 5);
    let closed = ink;
    if (gapClose > 0) {
      // Dilate
      let tmp = closed;
      for (let pass = 0; pass < gapClose; pass++) {
        const next = new Uint8Array(N);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const j = y * w + x;
            if (tmp[j] || tmp[j-1] || tmp[j+1] || tmp[j-w] || tmp[j+w]) next[j] = 1;
          }
        }
        tmp = next;
      }
      // Erode back (but keep pixels that were original edges)
      for (let pass = 0; pass < gapClose; pass++) {
        const next = new Uint8Array(N);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const j = y * w + x;
            if (ink[j]) { next[j] = 1; continue; } // keep original edges
            if (tmp[j] && tmp[j-1] && tmp[j+1] && tmp[j-w] && tmp[j+w]) next[j] = 1;
          }
        }
        tmp = next;
      }
      closed = tmp;
    }

    // --- 9) Line thickness ---
    const thickness = clamp(opts.thickness != null ? opts.thickness : 1, 0, 5);
    let thickInk = closed;
    if (thickness > 0) {
      for (let pass = 0; pass < thickness; pass++) {
        const next = new Uint8Array(N);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const j = y * w + x;
            if (thickInk[j]) { next[j] = 1; continue; }
            if (thickInk[j-1] || thickInk[j+1] || thickInk[j-w] || thickInk[j+w]) next[j] = 1;
          }
        }
        thickInk = next;
      }
    }

    // --- 10) Aggressive cleanup (remove small fragments + isolated dots) ---
    const cleanLevel = clamp(opts.clean != null ? opts.clean : 60, 0, 100);
    if (cleanLevel > 0) {
      // Pass 1: Remove isolated dots (pixels with few neighbors in 5x5 area)
      const dotThreshold = Math.max(2, Math.round(3 + cleanLevel / 20));
      const cleaned1 = new Uint8Array(N);
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const j = y * w + x;
          if (!thickInk[j]) continue;
          let neighbors = 0;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (thickInk[(y+dy)*w+x+dx]) neighbors++;
            }
          }
          if (neighbors >= dotThreshold) cleaned1[j] = 1;
        }
      }
      // Pass 2: Remove small connected components
      const minArea = Math.max(8, Math.round(N * (cleanLevel / 100) * 0.002));
      removeSmallComponents(cleaned1, w, h, minArea, 1);
      thickInk = cleaned1;
    }

    // --- 11) Composite: ink on transparent ---
    const INK_R = 10, INK_G = 9, INK_B = 8;
    const out = new Uint8ClampedArray(N * 4);
    for (let j = 0; j < N; j++) {
      if (thickInk[j]) {
        out[j*4] = INK_R; out[j*4+1] = INK_G; out[j*4+2] = INK_B; out[j*4+3] = 255;
      }
    }
    // Respect source alpha (mask)
    for (let i = 3, j = 0; i < d.length; i += 4, j++) {
      if (d[i] < 128) out[j*4+3] = 0;
    }

    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    return c;
  }

  // ===== Precise 3-point levels =====
  // You pick the darkest tone, a mid tone and the white on the actual photo; those
  // three samples become black point / gamma / white point exactly, so the whole
  // contrast range is rebalanced around real pixels instead of a blind slider.
  // pts: { black, mid, white } luminances 0–255. clarity: 0–100 local contrast.
  function prepPhotoLevels(srcCanvas, pts, clarity) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(srcCanvas, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    let bp = clamp(pts.black != null ? pts.black : 0, 0, 254);
    let wp = clamp(pts.white != null ? pts.white : 255, 1, 255);
    if (wp <= bp + 4) wp = Math.min(255, bp + 5);
    let e = 1;
    if (pts.mid != null) {
      const m = clamp((pts.mid - bp) / (wp - bp), 0.02, 0.98);
      e = Math.log(0.5) / Math.log(m);
      e = clamp(e, 0.2, 5);
    }
    // 256-entry LUT — exact and fast
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const n = clamp((v - bp) / (wp - bp), 0, 1);
      lut[v] = Math.round(Math.pow(n, e) * 255);
    }
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
    }
    ctx.putImageData(img, 0, 0);

    const cl = clamp((clarity || 0) / 100, 0, 1);
    if (cl > 0) {
      const im2 = ctx.getImageData(0, 0, w, h);
      const d2 = im2.data;
      const gray = new Float32Array(w * h);
      for (let i = 0, j = 0; i < d2.length; i += 4, j++) gray[j] = lum(d2[i], d2[i + 1], d2[i + 2]);
      const blur = boxBlurGray(gray, w, h, Math.max(2, Math.round(Math.min(w, h) * 0.03)));
      const k = cl * 0.9;
      for (let i = 0, j = 0; i < d2.length; i += 4, j++) {
        const boost = (gray[j] - blur[j]) * k;
        d2[i] = clamp(d2[i] + boost, 0, 255);
        d2[i + 1] = clamp(d2[i + 1] + boost, 0, 255);
        d2[i + 2] = clamp(d2[i + 2] + boost, 0, 255);
      }
      ctx.putImageData(im2, 0, 0);
    }
    return out;
  }

  // Average luminance in a small disc around (x,y) — what the eyedropper reads.
  function sampleLum(srcCanvas, x, y, r) {
    r = Math.max(1, r || 3);
    const w = srcCanvas.width, h = srcCanvas.height;
    const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
    const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
    const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const dd = ctx.getImageData(x0, y0, Math.max(1, x1 - x0 + 1), Math.max(1, y1 - y0 + 1)).data;
    let s = 0, n = 0;
    for (let i = 0; i < dd.length; i += 4) { s += lum(dd[i], dd[i + 1], dd[i + 2]); n++; }
    return n ? s / n : 0;
  }

  root.KAOS = {
    styleSurrealist, styleThreshold, styleHalftone, styleStipple,
    styleCalco, applyShape, shapePath, composeOnPaper, maskSource, prepPhoto,
    prepPhotoLevels, sampleLum, distressLayer, drawTextOverlay, textLayer,
  };
})(window);
