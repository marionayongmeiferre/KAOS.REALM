// KAOS.REALM — usage log (local only)
//
// Records WHICH control was pressed, IN WHAT ORDER, and HOW LONG each step
// took, so the interface can be reorganised from evidence instead of guesses.
//
// What it never records: images, file names, design content, prompt text, API
// keys — nothing you type or draw. Only element ids, visible button labels,
// the active tab, and timings.
//
// Where it lives: localStorage on this device. If server.js is running it also
// POSTs to /api/usage, which writes .data/usage.json on your own machine. It
// never leaves your network.
//
// To see a summary yourself, open the browser console and run:
//     KAOS_USAGE.report()
// To wipe everything:
//     KAOS_USAGE.clear()
(function (root) {
  const KEY = "kaos.usage.v1";
  const MAX = 3000;          // ring buffer; oldest fall off the front
  const IDLE_GAP = 120000;   // 2 min of silence means "left the app"

  let events = [];
  try { events = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { events = []; }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        if (events.length > MAX) events = events.slice(-MAX);
        localStorage.setItem(KEY, JSON.stringify(events));
      } catch (e) {
        // Quota blown — drop the oldest half rather than lose new data.
        events = events.slice(-Math.floor(MAX / 2));
        try { localStorage.setItem(KEY, JSON.stringify(events)); } catch (e2) {}
      }
      pushToServer();
    }, 1500);
  }

  let serverTimer = null;
  function pushToServer() {
    if (!/^https?:$/.test(location.protocol)) return;
    clearTimeout(serverTimer);
    serverTimer = setTimeout(() => {
      fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updated: Date.now(), events }),
      }).catch(() => { /* server not running — localStorage still has it */ });
    }, 8000);
  }

  function activeTab() {
    const t = document.querySelector(".side-tab[aria-selected='true']");
    return (t && t.dataset.tab) || "";
  }
  // Which modal is on top, if any — "where was I when I pressed this".
  function activeSurface() {
    const ids = ["surrealModal", "scanModal", "galleryModal"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.style.display !== "none") return id.replace("Modal", "");
    }
    const cv = document.getElementById("composeView");
    if (cv && cv.style.display !== "none") return "compose";
    return "main";
  }

  // Un deslizador sin id igual tiene nombre a la vista: la etiqueta de encima.
  // Sin esto los 109 movimientos de deslizador del primer informe se guardaron
  // todos como "anon", que no dice cual se movio.
  function nombreDeslizador(el) {
    const caja = el.closest(".control, .control-row, label");
    const lab = caja && caja.querySelector("label");
    const txt = lab ? (lab.textContent || "").trim().slice(0, 24) : "";
    return txt ? "sld:" + txt : "";
  }

  // Que interfaz es. El flash y el editor de posts se sirven desde el mismo
  // puerto, asi que comparten localStorage y fichero: sin esto sus pulsaciones
  // quedan mezcladas en el mismo monton y no hay forma de separarlas despues.
  const APP = (function () {
    const m = document.querySelector("meta[name=\"kaos-app\"]");
    return m ? (m.getAttribute("content") || "").slice(0, 24) : "";
  })();

  // A stable name for a control: prefer its id, else a data-* pair, else label.
  function identify(el) {
    if (el.id) return el.id;
    if (el.tagName === "INPUT") { const n = nombreDeslizador(el); if (n) return n; }
    if (el.dataset && el.dataset.tweak && el.dataset.val) return el.dataset.tweak + ":" + el.dataset.val;
    if (el.dataset && el.dataset.tab) return "tab:" + el.dataset.tab;
    if (el.dataset && el.dataset.cat) return "cat:" + el.dataset.cat;
    const txt = (el.textContent || "").trim().slice(0, 24);
    return txt ? "txt:" + txt : (el.className || "").split(" ")[0] || "anon";
  }

  let last = null;   // previous event, for dwell + repeat collapsing
  function record(id, label) {
    const now = Date.now();
    // Same control hammered in a row (undo undo undo) collapses into one row
    // with a counter — that pattern is a signal in itself.
    if (last && last.id === id && now - last.t < 4000) {
      last.rep = (last.rep || 1) + 1;
      last.t = now;
      persist();
      return;
    }
    const ev = { t: now, id: id, tab: activeTab(), at: activeSurface() };
    if (APP) ev.app = APP;   // el flash y el editor de posts comparten puerto
    if (label && label !== id) ev.label = label;
    if (last) {
      const gap = now - last.t;
      // Time spent on the previous step. Long gaps mean "walked away", not
      // "stared at this button", so they're flagged instead of counted.
      if (gap < IDLE_GAP) last.dwell = gap; else last.idle = true;
    }
    events.push(ev);
    last = ev;
    persist();
  }

  // One listener on the document, capture phase, so it still sees clicks whose
  // handler stops propagation.
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button, .tog, .side-tab, .res-thumb, [role='button']");
    if (!el) return;
    record(identify(el), (el.textContent || "").trim().slice(0, 24));
  }, true);

  // Sliders: log the control, not every intermediate value.
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el || el.tagName !== "INPUT") return;
    if (el.type === "range" || el.type === "checkbox" || el.type === "color") {
      record(el.id || identify(el), el.type);
    }
  }, true);

  root.KAOS_USAGE = {
    // Human-readable summary, printed in the console.
    report() {
      const counts = {}, pairs = {}, dwells = {};
      let prev = null;
      for (const e of events) {
        const n = (e.rep || 1);
        counts[e.id] = (counts[e.id] || 0) + n;
        if (e.dwell) (dwells[e.id] = dwells[e.id] || []).push(e.dwell);
        if (prev) { const k = prev.id + " -> " + e.id; pairs[k] = (pairs[k] || 0) + 1; }
        prev = e;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const flow = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15);
      const slow = Object.entries(dwells)
        .map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length / 1000)])
        .sort((a, b) => b[1] - a[1]).slice(0, 10);
      console.log("=== MAS PULSADOS ===");            console.table(top.slice(0, 25));
      console.log("=== SECUENCIAS COMUNES ===");      console.table(flow);
      console.log("=== DONDE SE TARDA MAS (seg) ==="); console.table(slow);
      console.log("total eventos:", events.length,
        "desde", events[0] ? new Date(events[0].t).toLocaleString() : "-");
      return { total: events.length, top, flow, slow };
    },
    // Controls that exist on screen but were never touched — removal candidates.
    unused() {
      const seen = new Set(events.map(e => e.id));
      return Array.from(document.querySelectorAll("button[id], .tog[data-val]"))
        .map(el => identify(el))
        .filter(id => !seen.has(id));
    },
    raw() { return events.slice(); },
    clear() {
      events = []; last = null;
      try { localStorage.removeItem(KEY); } catch (e) {}
      return "borrado";
    },
  };
})(window);
