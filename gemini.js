// KAOS.REALM — Google Gemini image provider (v1)
//
// Two capabilities the HF spaces never had:
//   · text→image  (generate a new subject from a prompt)
//   · image→image (EDIT the photo you already have — "make the skull metallic",
//                  "remove the hand", "turn it into a woodcut")
//
// Needs a free Google AI Studio API key: https://aistudio.google.com/apikey
// The key lives in localStorage on this device only and is sent straight to
// Google from the browser.
(function (root) {
  const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  const MODELS = [
    {
      id: "gemini-2.5-flash-image",
      label: "Gemini 2.5 Flash Image",
      sub: "nano-banana · generates AND edits your photo · fast",
      kind: "both",
    },
    {
      id: "gemini-2.5-flash-image-preview",
      label: "Gemini 2.5 Flash Image (preview)",
      sub: "fallback channel if the stable id 404s",
      kind: "both",
    },
    {
      id: "imagen-4.0-generate-001",
      label: "Imagen 4",
      sub: "text→image only · highest fidelity · no editing",
      kind: "t2i",
    },
  ];
  function listModels() { return MODELS.slice(); }
  function getModel(id) { return MODELS.find(m => m.id === id) || MODELS[0]; }

  function canvasToB64(src, maxLong) {
    let c = src;
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const s = Math.min(1, (maxLong || 1024) / Math.max(sw, sh));
    if (s < 1 || !src.toDataURL) {
      c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(sw * s));
      c.height = Math.max(1, Math.round(sh * s));
      const cx = c.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(src, 0, 0, c.width, c.height);
    }
    return c.toDataURL("image/png").split(",")[1];
  }
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("El resultado de Gemini no se pudo abrir"));
      img.src = dataUrl;
    });
  }
  function friendlyError(status, body) {
    const msg = (body && body.error && body.error.message) || ("HTTP " + status);
    if (status === 400 && /API key/i.test(msg)) return "La API key de Gemini no es válida.";
    if (status === 403) return "Esa API key no tiene permiso para este modelo (o falta activar la Generative Language API).";
    if (status === 404) return "El modelo no existe para tu key — prueba otro modelo en CONFIGURE.";
    if (status === 429) return "Cuota de Gemini agotada por ahora. Espera un minuto o usa otra key.";
    return "Gemini: " + msg;
  }

  // ---- generate / edit ---------------------------------------------------
  // opts: { key, model, prompt, sourceCanvas?, aspect?, onProgress? }
  async function generate(opts = {}) {
    const key = (opts.key || "").trim();
    if (!key) throw new Error("Pega tu API key de Gemini en CONFIGURE primero.");
    const model = getModel(opts.model);
    const prompt = (opts.prompt || "").trim();
    if (!prompt) throw new Error("Escribe una instrucción.");
    if (opts.onProgress) opts.onProgress("SENDING");

    let url, body;
    if (model.id.startsWith("imagen")) {
      url = BASE + model.id + ":predict";
      body = {
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: opts.aspect || "1:1" },
      };
    } else {
      const parts = [{ text: prompt }];
      if (opts.sourceCanvas) {
        parts.push({ inline_data: { mime_type: "image/png", data: canvasToB64(opts.sourceCanvas, 1024) } });
      }
      url = BASE + model.id + ":generateContent";
      body = { contents: [{ role: "user", parts }] };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(friendlyError(res.status, json));
    if (opts.onProgress) opts.onProgress("DECODING");

    let b64 = null, mime = "image/png";
    if (json && json.predictions && json.predictions[0]) {
      b64 = json.predictions[0].bytesBase64Encoded || null;
      mime = json.predictions[0].mimeType || mime;
    } else {
      const cands = (json && json.candidates) || [];
      for (const c of cands) {
        for (const p of ((c.content && c.content.parts) || [])) {
          const inl = p.inlineData || p.inline_data;
          if (inl && inl.data) { b64 = inl.data; mime = inl.mimeType || inl.mime_type || mime; break; }
        }
        if (b64) break;
      }
      if (!b64) {
        // the model sometimes answers with text when it refuses
        const txt = cands[0] && cands[0].content && (cands[0].content.parts || [])
          .map(p => p.text).filter(Boolean).join(" ");
        throw new Error(txt ? ("Gemini no devolvió imagen: " + txt.slice(0, 160)) : "Gemini no devolvió imagen.");
      }
    }
    return await loadImage("data:" + mime + ";base64," + b64);
  }

  async function generateVariations(briefs, onProgress, cfg) {
    const out = [];
    // Gemini free tier rate-limits hard on parallel calls — run them in sequence.
    for (let i = 0; i < briefs.length; i++) {
      try {
        out.push(await generate(Object.assign({}, cfg, {
          prompt: briefs[i].prompt,
          onProgress: (s) => onProgress && onProgress(i, s),
        })));
      } catch (e) { out.push(e); }
    }
    return out;
  }

  root.KAOS_GEMINI = { listModels, getModel, generate, generateVariations };
})(window);
