// KAOS.REALM — Hugging Face Gradio client (v1)
//
// Connects directly to public HF Gradio Spaces from the browser to
// generate images. Equivalent of the user's Python snippet:
//
//   from gradio_client import Client
//   client = Client("stabilityai/stable-diffusion-3.5-large-turbo")
//   result = client.predict(prompt=..., negative_prompt=..., seed=0,
//       guidance_scale=1.5, num_inference_steps=4, width=1024, height=1024,
//       api_name="/predict")
//
// IMPORTANT: SD 3.5 Turbo is TEXT-TO-IMAGE only — it does NOT edit your
// existing source image. The result replaces the current image, which the
// existing tattoo styling pipeline then renders on top of.
//
// Exposes window.KAOS_HF with:
//   connected()      -> bool (always true if Gradio client loads OK)
//   getConfig()      -> { hfToken, spaceId, ... }
//   setConfig(cfg)   -> persist
//   clearConfig()
//   listSpaces()     -> known spaces
//   generate(opts)   -> Promise<HTMLImageElement>
//   generateVariations(briefs, onProgress) -> Promise<HTMLImageElement[]>
//   DEFAULT_VARIATION_BRIEFS
//
(function (root) {
  const STORE_KEY = "kaos.realm.hf.v1";

  // ---- Known Gradio spaces ---------------------------------------------
  // Each entry describes how to call the Space:
  //   id           : "<user>/<space>"
  //   label/sub    : UI strings
  //   apiName      : Gradio API endpoint (e.g. "/predict")
  //   buildInput(opts) -> args object/array passed to predict
  //   defaults     : { guidance_scale, num_inference_steps, width, height, negative_prompt }
  //   parseOutput(data) -> string (url)
  const SPACES = [
    {
      id: "black-forest-labs/FLUX.1-schnell",
      label: "FLUX.1 schnell (text→img)",
      sub: "public · open · fast · usually online · text-to-image",
      apiName: "/infer",
      kind: "t2i",
      defaults: {
        guidance_scale: 0,
        num_inference_steps: 4,
        width: 1024,
        height: 1024,
      },
      async buildInput(opts) {
        return {
          prompt: opts.prompt,
          seed: opts.seed ?? 0,
          randomize_seed: true,
          width: opts.width ?? this.defaults.width,
          height: opts.height ?? this.defaults.height,
          // schnell is a 1-4 step distilled model
          num_inference_steps: Math.min(4, opts.num_inference_steps ?? this.defaults.num_inference_steps),
        };
      },
      parseOutput: parseImageOutput,
    },
    {
      id: "multimodalart/stable-diffusion-3.5-large",
      label: "SD 3.5 Large (img→img)",
      sub: "edits your image · strength control · /image_to_image",
      apiName: "/image_to_image",
      kind: "i2i",
      defaults: {
        negative_prompt: "blurry, low quality, deformed anatomy",
        strength: 0.6,
        guidance_scale: 1.5,
        num_inference_steps: 4,
        seed: 0,
      },
      async buildInput(opts, helpers) {
        // image is a Blob (from canvas). gradio JS client accepts Blob for file inputs.
        const blob = await helpers.canvasToBlob(opts.sourceCanvas, "image/png");
        return {
          image: blob,
          prompt: opts.prompt,
          negative_prompt: opts.negative_prompt ?? this.defaults.negative_prompt,
          strength: opts.strength ?? this.defaults.strength,
          guidance_scale: opts.guidance_scale ?? this.defaults.guidance_scale,
          num_inference_steps: opts.num_inference_steps ?? this.defaults.num_inference_steps,
          seed: opts.seed ?? 0,
        };
      },
      parseOutput: parseImageOutput,
    },
    {
      id: "stabilityai/stable-diffusion-3.5-large-turbo",
      label: "SD 3.5 Turbo (text→img)",
      sub: "fast · 4 steps · text-to-image · no source image",
      apiName: "/predict",
      kind: "t2i",
      defaults: {
        negative_prompt: "blurry, low quality, distorted, color photograph",
        guidance_scale: 1.5,
        num_inference_steps: 4,
        width: 1024,
        height: 1024,
      },
      async buildInput(opts) {
        return {
          prompt: opts.prompt,
          negative_prompt: opts.negative_prompt ?? this.defaults.negative_prompt,
          seed: opts.seed ?? 0,
          guidance_scale: opts.guidance_scale ?? this.defaults.guidance_scale,
          num_inference_steps: opts.num_inference_steps ?? this.defaults.num_inference_steps,
          width: opts.width ?? this.defaults.width,
          height: opts.height ?? this.defaults.height,
        };
      },
      parseOutput: parseImageOutput,
    },
  ];

  function parseImageOutput(data) {
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
      if (!item) continue;
      if (typeof item === "string") return item;
      if (item.url) return item.url;
      if (item.path) return item.path;
      // Nested object (e.g. result.data[0].value.url)
      if (item.value) {
        if (typeof item.value === "string") return item.value;
        if (item.value.url) return item.value.url;
        if (item.value.path) return item.value.path;
      }
    }
    return null;
  }

  function listSpaces() { return SPACES.slice(); }
  function getSpace(id) { return SPACES.find(s => s.id === id) || SPACES[0]; }

  // ---- Config -----------------------------------------------------------
  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveConfig(cfg) { localStorage.setItem(STORE_KEY, JSON.stringify(cfg || {})); }
  function getConfig() {
    const c = loadConfig();
    return {
      provider: c.provider || "gemini",
      geminiKey: c.geminiKey || "",
      geminiModel: c.geminiModel || "gemini-2.5-flash-image",
      geminiEdit: c.geminiEdit !== false,
      hfToken: c.hfToken || "",
      spaceId: c.spaceId || SPACES[0].id,
      steps: c.steps || 4,
      guidance: c.guidance ?? 1.5,
      size: c.size || 1024,
      strength: c.strength ?? 0.6,
      enabled: c.enabled !== false, // default on
    };
  }
  function setConfig(partial) {
    const cur = loadConfig();
    saveConfig(Object.assign({}, cur, partial));
  }
  function clearConfig() { localStorage.removeItem(STORE_KEY); }

  // ---- Gradio client (lazy ESM import) ---------------------------------
  let _ClientPromise = null;
  function loadGradioClient() {
    if (_ClientPromise) return _ClientPromise;
    _ClientPromise = (async () => {
      // esm.sh bundles @gradio/client as a single ESM module
      const mod = await import("https://esm.sh/@gradio/client@1.8.0");
      if (!mod.Client) throw new Error("Failed to load @gradio/client (no Client export)");
      return mod.Client;
    })().catch((e) => {
      _ClientPromise = null;
      throw e;
    });
    return _ClientPromise;
  }

  // The 'connected' concept here just means: Gradio JS client is reachable.
  // The actual call may still fail at runtime (rate limits, quota).
  // We treat it as enabled by default; the user can disable via the modal.
  function connected() {
    const c = getConfig();
    if (c.enabled === false) return false;
    if (c.provider === "gemini") return !!c.geminiKey;
    return true;
  }
  // Short human label for the sidebar chip.
  function providerLabel() {
    const c = getConfig();
    if (c.provider === "gemini") {
      const m = root.KAOS_GEMINI && KAOS_GEMINI.getModel(c.geminiModel);
      return "GEMINI · " + (m ? m.label.replace(/^Gemini\s*/, "") : "image");
    }
    const s = SPACES.find(x => x.id === c.spaceId);
    return "HF · " + (s ? s.label : "space");
  }
  // Does the active provider edit the photo you already have?
  function canEdit() {
    const c = getConfig();
    if (c.provider === "gemini") return c.geminiEdit && !/^imagen/.test(c.geminiModel);
    return getSpace(c.spaceId).kind === "i2i";
  }

  // ---- Cache the Client instance per spaceId+token ---------------------
  const _clientCache = new Map();
  async function getApp() {
    const cfg = getConfig();
    const key = (cfg.spaceId || "") + "|" + (cfg.hfToken || "");
    if (_clientCache.has(key)) return _clientCache.get(key);
    let Client;
    try {
      Client = await loadGradioClient();
    } catch (e) {
      throw new Error("Couldn't load the Hugging Face client library. Check your internet connection and try again.");
    }
    const opts = {};
    if (cfg.hfToken) opts.hf_token = cfg.hfToken;
    let app;
    try {
      app = await Client.connect(cfg.spaceId, opts);
    } catch (e) {
      const msg = String((e && e.message) || e || "");
      // The Gradio client throws "Space metadata could not be loaded" when a
      // Space is sleeping, gated/private, has moved, or is rate-limiting anon calls.
      if (/metadata|could not|not found|space/i.test(msg)) {
        throw new Error(
          'Space "' + cfg.spaceId + '" couldn\'t be reached — it may be sleeping, gated, or moved. ' +
          'Try CONFIGURE → pick "FLUX.1 schnell" (public), and/or paste a free HF token to lift anonymous limits.'
        );
      }
      throw new Error("Couldn't connect to Hugging Face: " + msg);
    }
    _clientCache.set(key, app);
    return app;
  }

  // ---- Image loader ----------------------------------------------------
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load result image"));
      img.src = url;
    });
  }

  // ---- Generate ONE image ----------------------------------------------
  async function generate(opts = {}) {
    const cfg = getConfig();
    if (cfg.provider === "gemini") {
      if (!root.KAOS_GEMINI) throw new Error("El módulo de Gemini no cargó.");
      return await KAOS_GEMINI.generate({
        key: cfg.geminiKey,
        model: cfg.geminiModel,
        prompt: opts.prompt,
        sourceCanvas: (cfg.geminiEdit && opts.sourceCanvas) ? opts.sourceCanvas : null,
        onProgress: opts.onProgress,
      });
    }
    const space = getSpace(cfg.spaceId);
    const input = space.buildInput({
      prompt: opts.prompt,
      negative_prompt: opts.negative_prompt,
      seed: opts.seed ?? Math.floor(Math.random() * 2147483647),
      guidance_scale: opts.guidance_scale ?? cfg.guidance,
      num_inference_steps: opts.num_inference_steps ?? cfg.steps,
      width: opts.width ?? cfg.size,
      height: opts.height ?? cfg.size,
    });
    if (opts.onProgress) opts.onProgress("CONNECTING");
    const app = await getApp();
    if (opts.onProgress) opts.onProgress("GENERATING");
    const result = await app.predict(space.apiName, input);
    const url = space.parseOutput(result && result.data);
    if (!url) throw new Error("Space returned no image URL");
    if (opts.onProgress) opts.onProgress("LOADING");
    return await loadImage(url);
  }

  // ---- Generate multiple variations in parallel ------------------------
  // briefs: [{ name, prompt }]
  // onProgress(index, status)
  async function generateVariations(briefs, onProgress, extra) {
    const cfg = getConfig();
    if (cfg.provider === "gemini") {
      return await KAOS_GEMINI.generateVariations(briefs, onProgress, {
        key: cfg.geminiKey, model: cfg.geminiModel,
        sourceCanvas: (cfg.geminiEdit && extra && extra.sourceCanvas) ? extra.sourceCanvas : null,
      });
    }
    const tasks = briefs.map((brief, i) => {
      const onP = (s) => onProgress && onProgress(i, s);
      return generate({ prompt: brief.prompt, onProgress: onP })
        .catch(err => err);
    });
    return await Promise.all(tasks);
  }

  // ---- Default variation briefs ----------------------------------------
  const DEFAULT_VARIATION_BRIEFS = [
    {
      name: "INKED BLACKWORK",
      blurb: "solid black tattoo · high contrast",
      prompt: "Traditional black-ink tattoo flash illustration, pure solid black ink on cream paper, bold confident outlines, no color, no shading, Americana tattoo aesthetic, centered subject, white background.",
    },
    {
      name: "STIPPLE DOTWORK",
      blurb: "engraving · 19th century · dotwork",
      prompt: "19th century stippled engraving, fine dotwork only, no solid fills, no color, botanical illustration style, black ink dots on aged cream paper, scientific engraving aesthetic, centered subject.",
    },
    {
      name: "WOODCUT ETCHING",
      blurb: "harsh lines · medieval · Dürer",
      prompt: "Medieval woodcut print in the style of Albrecht Dürer, harsh hand-carved black lines, crude crosshatching, no smooth gradients, no color, black ink on aged paper, visible cut marks, dramatic.",
    },
    {
      name: "SURREAL PORTRAIT",
      blurb: "Dalí-esque · melting · dreamlike",
      prompt: "Surreal Dali-inspired photoreal black-and-white portrait, melting dreamlike imagery, impossible geometry, desaturated grayscale, heavy paper grain, vintage photograph pasted onto cream stock.",
    },
  ];

  root.KAOS_HF = {
    connected,
    providerLabel,
    canEdit,
    getConfig,
    setConfig,
    clearConfig,
    listSpaces,
    loadGradioClient,
    generate,
    generateVariations,
    DEFAULT_VARIATION_BRIEFS,
  };
})(window);
