// KAOS.REALM — AI helpers (Claude integration) (v5)
//
// v5 changes:
//  - tweakFromPrompt: returns { tweaks, summary, mode? }. The model is forced
//    to actually emit changed values (with reasoning) and a short summary
//    we show in the status bar so the user can SEE what shifted.
//  - suggestVariations: now returns FOUR genuinely-divergent directions:
//    each variation can change STYLE, MODE, PAPER colour, FRAME shape,
//    EDGE-OVERLAY (outline lock), plus extreme tweaks. So the user gets
//    options that are visibly different, not micro-adjustments.
//  - autoComposeLayout: unchanged contract; the caller now smart-cuts
//    backgrounds before invoking.
//
(function (root) {
  function safeJson(text) {
    if (!text) return null;
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch (e) {} }
    const m = text.match(/[{\[][\s\S]*[}\]]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  }
  function claudeAvailable() {
    return !!(root.claude && typeof root.claude.complete === "function");
  }
  async function callClaude(prompt) {
    if (!claudeAvailable()) throw new Error("AI is unavailable in this environment.");
    return await root.claude.complete({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
    });
  }
  function clamp(v, lo, hi) { v = Number(v); if (!isFinite(v)) return (lo + hi) / 2; return v < lo ? lo : v > hi ? hi : v; }

  // ============================================================
  // AUTO-COMPOSE: text + named elements -> layout plan
  // ============================================================
  async function autoComposeLayout(elements, canvas, userPrompt) {
    const elemBrief = elements.map((e, i) => ({
      id: e.id, index: i, name: e.name || ("element_" + i),
      aspect: +(e.w / e.h).toFixed(2),
    }));
    const prompt = [
      "You are an art director planning a surrealist photomontage tattoo flash.",
      "Return ONLY a JSON object with this exact shape:",
      "{ \"layout\": [ { \"id\": \"<element id>\", \"cx_pct\": 0-100, \"cy_pct\": 0-100, \"scale_pct\": 5-180, \"rotation_deg\": -180-180, \"z\": integer, \"flipX\": boolean, \"host\": boolean, \"blend\": \"normal\"|\"multiply\"|\"screen\"|\"overlay\", \"feather\": 0-14 } ] }",
      "Rules:",
      "- cx_pct, cy_pct are the element CENTER as a percent of canvas width/height.",
      "- scale_pct is the size relative to a sensible fit (100 = ~65% of canvas).",
      "- z controls layering (lower = behind). The 'host' or 'background' subject is BEHIND grafted parts.",
      "- GOAL: the elements must read as ONE single edited creature/object, not separate stickers floating apart.",
      "- So make grafted parts OVERLAP the host so seams touch. Place each part where it would physically attach (a collar around the neck, a head on top of the body, a flower replacing a face).",
      "- Mark exactly ONE element as \"host\": true — the main body whose lighting the others should match. Everything else host:false.",
      "- \"feather\" softens the cut edge so the seam blends — use 4-10 for parts that sit ON the host (collars, grafted heads/limbs), 0-2 for the host itself.",
      "- \"blend\": use \"multiply\" for things that should sink into shadow/contact (collars, straps, things wrapping around), \"normal\" otherwise. Only use screen/overlay for glow-like elements.",
      "- Be physically plausible. For 'cat wearing a spike collar', place the collar around the lower portion of the cat's neck, scaled to its width, rotated to follow the neckline, overlapping it, feather 6, blend multiply.",
      "- Use ONLY the ids I gave you. Every element must appear once.",
      "",
      "Canvas size: " + canvas.W + "x" + canvas.H + " px.",
      "Elements: " + JSON.stringify(elemBrief),
      "Brief: " + JSON.stringify(userPrompt || ""),
      "",
      "Reply with the JSON object only, no commentary, no markdown fences.",
    ].join("\n");
    const text = await callClaude(prompt);
    const parsed = safeJson(text);
    if (!parsed || !Array.isArray(parsed.layout)) throw new Error("AI returned unparseable layout");
    const idMap = new Map(elements.map(e => [e.id, e]));
    const blendMap = { normal: "source-over", "source-over": "source-over", multiply: "multiply", screen: "screen", overlay: "overlay" };
    return parsed.layout
      .filter(p => idMap.has(p.id))
      .map(p => ({
        id: p.id,
        cx_pct: clamp(p.cx_pct, 0, 100),
        cy_pct: clamp(p.cy_pct, 0, 100),
        scale_pct: clamp(p.scale_pct, 5, 220),
        rotation_deg: clamp(p.rotation_deg || 0, -180, 180),
        z: Number.isFinite(p.z) ? p.z : 0,
        flipX: !!p.flipX,
        host: !!p.host,
        blend: blendMap[String(p.blend || "").toLowerCase()] || "source-over",
        feather: clamp(p.feather != null ? p.feather : 2, 0, 20),
      }));
  }

  // ============================================================
  // VARIATIONS — 4 dramatically-different art directions
  // ============================================================
  // Each variation may change: style (surrealist|threshold), tweaks,
  // mode (for threshold), shape (none|rect|oval|heart), paper hex.
  //
  // Returns: [{ name, blurb, style, shape, paper, tweaks }]
  async function suggestVariations(currentStyle, currentTweaks, currentShape, currentPaper, userBrief) {
    const prompt = [
      "You are an art director generating four DRAMATICALLY DIFFERENT tattoo-flash directions for a single source image.",
      "Each direction should feel like a deliberate, distinct aesthetic — not a small tweak. Push extremes.",
      "",
      "AVAILABLE STYLES:",
      "- 'surrealist' : photoreal grayscale, levels + grain, paper feel. Tweaks: bp(0-120), wp(160-255), gamma(0.4-1.6), contrast(0.5-2.5), grain(0-60).",
      "- 'threshold'  : pure black on paper. Modes: 'hard' (clean cut-off), 'dotwork' (stochastic stipple, preserves blacks/whites), 'adaptive' (local mean - keeps detail in uneven lighting), 'edges' (pure outline).",
      "  Tweaks: bp(0-200), wp(55-255), gamma(0.3-2.5), localBoost(0-3), smooth(0-6), threshold(20-240), stippleOpacity(5-100, dotwork only: how dark the dot fringe prints, low=airy grey, high=near solid black), windowSize(3-80), bias(0-60), outlineWidth(0-5 in 0.5 steps: sticker outline traced on the silhouette and its interior holes, 0=off), despeckle(0-100 — raise to 55-90 for clean solid shapes from noisy/low-contrast metallic sources).",
      "",
      "DIVERGENCE GOALS — the 4 variations MUST collectively span:",
      "  • at least 2 different STYLES (mix surrealist + threshold)",
      "  • at least 3 different THRESHOLD MODES across the threshold variations",
      "  • at least 2 different PAPER colours (choose from: #d9d4c8 cream, #c9c3b4 stone, #e5dccd bone, #efe7d0 vellum, #b8a78a tobacco, #1b1916 black-blackwork, #d9c0a8 sepia)",
      "  • at least 2 different FRAMES (none, rect, oval, heart)",
      "  • For 'sticker / cut-out' directions: USE outlineWidth 1-5 (0.5 steps) to trace the silhouette and its interior holes.",
      "",
      "VARIATION FLAVOURS to draw from (pick four different ones):",
      "  - HEAVY DOTWORK STIPPLE: threshold dotwork, paper cream, grain feel, outlineWidth 1.5.",
      "  - INKED BLACKWORK: threshold hard, low cutoff, deep blacks, outlineWidth 3, oval frame.",
      "  - FADED MEMORY: surrealist, lifted blacks, low contrast, heavy grain, tobacco paper.",
      "  - HARSH PHOTOCOPY: threshold hard, high contrast, no smoothing, harsh.",
      "  - ETCHING / LINE-ART: threshold edges, fine outline only, vellum paper.",
      "  - HIGH-KEY PORTRAIT: surrealist, lifted whites, soft contrast, bone paper.",
      "  - GRITTY NEWSPAPER: threshold dotwork, heavy grain.",
      "  - WHITE-INK-ON-BLACK: threshold hard, paper black, INVERTED look (just use black paper for now).",
      "  - SOFT MEZZOTINT: threshold adaptive, fine window, mid bias, dotwork feel.",
      "",
      "Return ONLY this JSON shape (no markdown):",
      "{ \"variations\": [",
      "  { \"name\": \"<2-4 WORDS ALL CAPS>\", \"blurb\": \"<8-14 word art direction>\",",
      "    \"style\": \"surrealist\"|\"threshold\",",
      "    \"shape\": \"none\"|\"rect\"|\"oval\"|\"heart\",",
      "    \"paper\": \"#hex\",",
      "    \"tweaks\": { ... matching the chosen style's schema, including 'mode' for threshold } }",
      "  ] }",
      "Exactly 4 variations. Values inside ranges. Be bold.",
      "",
      "Current state: style=" + currentStyle + " tweaks=" + JSON.stringify(currentTweaks),
      "Current paper: " + currentPaper + ", frame: " + currentShape,
      "Optional brief: " + JSON.stringify(userBrief || ""),
      "",
      "JSON only.",
    ].join("\n");

    const text = await callClaude(prompt);
    const parsed = safeJson(text);
    if (!parsed || !Array.isArray(parsed.variations)) throw new Error("AI returned unparseable variations");
    return parsed.variations.slice(0, 4).map(v => ({
      name: String(v.name || "VARIANT").toUpperCase().slice(0, 28),
      blurb: String(v.blurb || ""),
      style: (v.style === "threshold" || v.style === "surrealist") ? v.style : currentStyle,
      shape: ["none", "rect", "oval", "heart"].includes(v.shape) ? v.shape : "none",
      paper: typeof v.paper === "string" && /^#?[0-9a-f]{3,8}$/i.test(v.paper) ? (v.paper.startsWith("#") ? v.paper : "#" + v.paper) : currentPaper,
      tweaks: v.tweaks || {},
    }));
  }

  // ============================================================
  // PROMPT TWEAK — natural language → real, visible changes
  // ============================================================
  // Returns { tweaks: {...}, mode?: "...", summary: "what changed in plain English" }
  async function tweakFromPrompt(style, currentTweaks, userPrompt) {
    const schemaSurreal = "{ \"bp\": 0-120 int, \"wp\": 160-255 int, \"gamma\": 0.4-1.6 number, \"contrast\": 0.5-2.5 number, \"grain\": 0-60 int }";
    const schemaThresh  = "{ \"bp\": 0-200 int, \"wp\": 55-255 int, \"gamma\": 0.3-2.5 number, \"localBoost\": 0-3 number, \"smooth\": 0-6 int, \"mode\": \"hard\"|\"dotwork\"|\"adaptive\"|\"edges\", \"threshold\": 20-240 int, \"stippleOpacity\": 5-100 int (dotwork only: 10-30=narrow stencil fringe, 60-100=wide dot gradient), \"windowSize\": 3-80 int, \"bias\": 0-60 int, \"outlineWidth\": 0-100 int, \"despeckle\": 0-100 int }";
    const schema = style === "surrealist" ? schemaSurreal : schemaThresh;

    const prompt = [
      "You translate natural-language image-edit instructions into actual slider values for a tattoo-flash app.",
      "Style currently in use: '" + style + "'.",
      "Current tweak values: " + JSON.stringify(currentTweaks),
      "",
      "Guidelines for what changes mean:",
      "- 'darker / deeper blacks' -> raise bp, lower wp slightly, lower threshold (threshold mode), or lower gamma.",
      "- 'lift mid-tones / less crushed' -> raise gamma above 1, raise threshold.",
      "- 'more grain / dirtier' -> raise grain (surrealist), or switch to 'dotwork' mode (threshold) and raise localBoost.",
      "- 'cleaner / less noise' -> lower grain, raise smooth, mode 'hard'.",
      "- 'too dirty / remove specks / messy shadows / cleaner shapes' -> raise despeckle to 55-90 (threshold modes), raise smooth, raise outlineWidth to 1.5-3 for a sticker outline.",
      "- 'sharper detail / preserve features' -> raise localBoost, smaller windowSize.",
      "- 'high contrast / punchy' -> raise contrast (surrealist), shrink wp-bp gap.",
      "- 'softer / faded' -> raise wp, lower contrast, raise gamma.",
      "- 'sticker outline / contour line' -> raise outlineWidth to 1.5-3 (threshold); 0 = no outline.",
      "- 'switch to dotwork/adaptive/hard/edges' -> set mode accordingly.",
      "",
      "Return ONLY this JSON (no markdown, no commentary):",
      "{",
      "  \"tweaks\": " + schema + " — INCLUDE EVERY KEY YOU'RE CHANGING (omit ones you keep). At least 1 key.",
      "  \"summary\": \"<one short sentence in plain English describing the visible change>\"",
      "}",
      "",
      "User instruction: " + JSON.stringify(userPrompt),
      "JSON only.",
    ].join("\n");

    const text = await callClaude(prompt);
    const parsed = safeJson(text);
    if (!parsed) throw new Error("AI returned unparseable response. Try rephrasing.");
    // Accept either { tweaks: {...}, summary } OR a flat object (legacy)
    let tweaks = parsed.tweaks && typeof parsed.tweaks === "object" ? parsed.tweaks : null;
    if (!tweaks) {
      // Try treating the whole object as tweaks (back-compat)
      tweaks = {};
      for (const k of Object.keys(parsed)) {
        if (k === "summary" || k === "explanation" || k === "note") continue;
        tweaks[k] = parsed[k];
      }
    }
    if (!tweaks || Object.keys(tweaks).length === 0) {
      throw new Error("AI didn't propose any changes. Try a more specific instruction.");
    }
    const summary = parsed.summary || parsed.explanation || parsed.note || "Applied AI-suggested tweaks.";
    return { tweaks, summary };
  }

  // ============================================================
  // MATCH SCENE — unchanged
  // ============================================================
  async function matchSceneHints(elements, userPrompt) {
    if (!claudeAvailable() || elements.length < 2) {
      return { hostId: elements[0] && elements[0].id, perElement: elements.map(e => ({ id: e.id, skewX_deg: 0, skewY_deg: 0, scale: 1 })) };
    }
    const brief = elements.map((e, i) => ({ id: e.id, index: i, name: e.name || "" }));
    const prompt = [
      "You match perspective hints between cut-out images.",
      "Pick the HOST element (whose perspective others should adopt).",
      "Suggest small skew (-25..25 deg) and scale (0.7..1.3) for each non-host element.",
      "Return ONLY: { \"hostId\": \"<id>\", \"perElement\": [ { \"id\": \"<id>\", \"skewX_deg\": n, \"skewY_deg\": n, \"scale\": n } ] }",
      "Elements: " + JSON.stringify(brief),
      "Brief: " + JSON.stringify(userPrompt || ""),
      "JSON only.",
    ].join("\n");
    try {
      const text = await callClaude(prompt);
      const parsed = safeJson(text);
      if (parsed && parsed.hostId && Array.isArray(parsed.perElement)) return parsed;
    } catch (e) {}
    return { hostId: elements[0].id, perElement: elements.map(e => ({ id: e.id, skewX_deg: 0, skewY_deg: 0, scale: 1 })) };
  }

  // ============================================================
  // FAL VARIATION BRIEFS — 4 prompts for image-regeneration
  // ============================================================
  // Returns: [{ name, blurb, prompt }] — used to drive fal.ai variations.
  async function suggestFalVariationBriefs(userBrief) {
    if (!claudeAvailable()) {
      // Caller will fall back to KAOS_FAL.DEFAULT_VARIATION_BRIEFS
      throw new Error("Claude unavailable for brief generation");
    }
    const prompt = [
      "You are an art director generating 4 DRAMATICALLY DIFFERENT image-edit prompts for a tattoo flash app.",
      "Each prompt will be sent to an image-editing AI (fal.ai nano-banana / FLUX Kontext) to TRANSFORM a single source photo.",
      "The 4 prompts must produce visibly distinct artistic outputs — different styles, eras, mediums.",
      "",
      "GOAL: tattoo flash aesthetic — black ink, cream paper, traditional / dotwork / engraving / surreal / woodcut / blackwork / etching.",
      "RULES for each prompt:",
      "  - 30-90 words",
      "  - Specify medium (woodcut, dotwork, ink wash, engraving, etc.)",
      "  - Specify color treatment (always grayscale or black-only — NO color)",
      "  - Mention paper / background substrate",
      "  - End with something concrete about line quality or texture",
      "",
      "Pick 4 from this palette (or invent in the same vein):",
      "  - INKED BLACKWORK (solid black, no gray, hard cut-outs, traditional Americana)",
      "  - STIPPLE DOTWORK (tiny black dots, 19th-c engraving, botanical illustration)",
      "  - SURREAL PHOTOREAL (Dalí-esque, desaturated grayscale, paper grain)",
      "  - WOODCUT ETCHING (harsh hand-carved lines, Dürer, crude crosshatching)",
      "  - JAPANESE IREZUMI LINEWORK (bold black outlines, traditional Japanese tattoo)",
      "  - SAILOR JERRY (classic American traditional flash, bold simple shapes)",
      "  - MEZZOTINT (smooth tonal gradients via fine dotwork)",
      "  - GRITTY NEWSPAPER (low-fi photocopy, harsh contrast, halftone)",
      "  - PEN AND INK CROSSHATCH (fine pen lines, detailed crosshatching)",
      "  - ART NOUVEAU LINE (Mucha-style flowing black linework)",
      "",
      "Return ONLY this JSON (no markdown):",
      "{ \"variations\": [",
      "  { \"name\": \"<2-4 WORDS ALL CAPS>\", \"blurb\": \"<6-12 word description>\", \"prompt\": \"<full edit prompt>\" }",
      "] }",
      "Exactly 4. Be bold and divergent.",
      "",
      "Optional user brief: " + JSON.stringify(userBrief || ""),
      "JSON only.",
    ].join("\n");

    const text = await callClaude(prompt);
    const parsed = safeJson(text);
    if (!parsed || !Array.isArray(parsed.variations) || parsed.variations.length < 1) {
      throw new Error("AI returned unparseable variation briefs");
    }
    return parsed.variations.slice(0, 4).map(v => ({
      name: String(v.name || "VARIANT").toUpperCase().slice(0, 28),
      blurb: String(v.blurb || ""),
      prompt: String(v.prompt || "").slice(0, 1200),
    }));
  }

  root.KAOS_AI = {
    available: claudeAvailable,
    autoComposeLayout,
    suggestVariations,
    suggestFalVariationBriefs,
    tweakFromPrompt,
    matchSceneHints,
  };
})(window);
