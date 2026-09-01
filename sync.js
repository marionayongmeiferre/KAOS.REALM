// KAOS.REALM — sync client (talks to server.js)
//
// Only active when the app is served over http(s). Opened as a file:// page it
// stays completely dormant, so nothing changes if you just double-click the
// HTML like before.
//
// One round trip per sync:
//   1. POST /api/sync with local gallery + sheets + asset METADATA (no blobs)
//   2. server merges by id (newest ts wins) and returns the union, plus the
//      list of asset ids whose bytes it is still missing
//   3. we upload those bytes, and download any blob we have metadata for but
//      no local copy of
//
// Conflict rule matches the server: last write wins per record id. Editing the
// same record on two devices in the same millisecond can lose one edit;
// anything else merges.
(function (root) {
  const isHTTP = /^https?:$/.test(location.protocol);
  const state = {
    enabled: isHTTP,
    busy: false,
    lastOk: 0,
    lastError: null,
    pending: false,
  };
  const listeners = new Set();
  function emit() { listeners.forEach(fn => { try { fn(status()); } catch (e) {} }); }
  function status() {
    return {
      enabled: state.enabled, busy: state.busy,
      lastOk: state.lastOk, lastError: state.lastError,
    };
  }
  function onChange(fn) { listeners.add(fn); fn(status()); return () => listeners.delete(fn); }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ cache: "no-store" }, opts));
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return res;
  }

  // Metadata only — the blob rides separately so the JSON stays small.
  // Tombstones (deleted:true) MUST be included: they are how a deletion on one
  // device reaches the other.
  async function localAssetMeta() {
    if (!root.KAOS_STORE) return [];
    const rows = await KAOS_STORE.listAssetsRaw();
    return rows.map(a => ({
      id: a.id, cat: a.cat, name: a.name, ts: a.ts, type: a.type,
      deleted: !!a.deleted,
    }));
  }

  async function sync(opts) {
    const quiet = opts && opts.quiet;
    if (!state.enabled) throw new Error("Servidor no activo — abre la app por http://, no como archivo");
    if (state.busy) { state.pending = true; return; }
    state.busy = true; state.lastError = null; emit();
    try {
      const payload = {
        // loadRaw, no load: las lápidas TIENEN que viajar. Son la única forma
        // de que un borrado hecho aquí llegue al otro aparato; mandando sólo lo
        // vivo, el servidor conserva el diseño y lo devuelve al sincronizar.
        gallery: root.KAOS_GALLERY
          ? (KAOS_GALLERY.loadRaw ? KAOS_GALLERY.loadRaw() : KAOS_GALLERY.load())
          : [],
        sheets: root.KAOS_STORE ? KAOS_STORE.sessions() : [],
        assets: await localAssetMeta(),
      };
      const merged = await (await api("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })).json();

      // --- write the merged view back locally ---
      if (root.KAOS_GALLERY && Array.isArray(merged.gallery)) KAOS_GALLERY.save(merged.gallery);
      if (root.KAOS_STORE && Array.isArray(merged.sheets)) KAOS_STORE.replaceSessions(merged.sheets);

      // --- push the blobs the server asked for ---
      let pushed = 0;
      for (const id of merged.missingAssets || []) {
        const row = await KAOS_STORE.getAsset(id);
        if (!row || !row.blob) continue; // metadata came from the other device
        try {
          await api("/api/asset/" + encodeURIComponent(id), { method: "PUT", body: row.blob });
          pushed++;
        } catch (e) { console.warn("no se pudo subir el asset", id, e); }
      }

      // --- apply the merged asset list locally ---
      let pulled = 0, removed = 0;
      for (const meta of merged.assets || []) {
        const mine = await KAOS_STORE.getAsset(meta.id);
        if (meta.deleted) {
          // Deleted elsewhere: drop our copy (and its bytes) but keep the
          // tombstone, so we don't resurrect it for a third device.
          if (mine && !mine.deleted) {
            await KAOS_STORE.putAssetRow({
              id: meta.id, cat: meta.cat, name: meta.name, ts: meta.ts, deleted: true,
            });
            removed++;
          }
          continue;
        }
        if (mine && !mine.deleted) continue;      // already have the bytes
        if (mine && mine.deleted && mine.ts >= meta.ts) continue; // our delete is newer
        try {
          const blob = await (await api("/api/asset/" + encodeURIComponent(meta.id))).blob();
          await KAOS_STORE.putAssetRow(Object.assign({}, meta, { blob }));
          pulled++;
        } catch (e) { /* server has metadata but no bytes yet — next pass */ }
      }

      state.lastOk = Date.now();
      if (pulled || removed) document.dispatchEvent(new CustomEvent("kaos-assets-changed"));
      if (!quiet && root.KAOS_TOAST) {
        const bits = [];
        if (pushed) bits.push(pushed + " subidos");
        if (pulled) bits.push(pulled + " bajados");
        if (removed) bits.push(removed + " borrados");
        KAOS_TOAST("Sincronizado" + (bits.length ? " · " + bits.join(" · ") : " · al día"));
      }
      return { pushed, pulled, removed, gallery: (merged.gallery || []).length };
    } catch (e) {
      state.lastError = e && e.message ? e.message : String(e);
      // Si el servidor no existe (GitHub Pages, hosting estático) y nunca hemos
      // sincronizado con éxito, desactivar sync para esta sesión en vez de
      // insistir cada vez que toca la galería.
      if (!state.lastOk && /404|Failed to fetch|NetworkError|Load failed/i.test(state.lastError)) {
        state.enabled = false;
        const btn = document.getElementById("syncBtn");
        if (btn) btn.hidden = true;
        emit();
      }
      if (!quiet && root.KAOS_TOAST) KAOS_TOAST("Sync falló: " + state.lastError, 5000);
      throw e;
    } finally {
      state.busy = false; emit();
      if (state.pending) { state.pending = false; setTimeout(() => sync({ quiet: true }).catch(() => {}), 200); }
    }
  }

  // Coalesce bursts of edits into a single round trip.
  //
  // La espera es corta a propósito. Con los 4 segundos de antes, tocar los
  // centímetros en el iPad y cambiar de app dejaba el cambio dentro: iOS congela
  // la pestaña de fondo y el temporizador no llegaba a saltar nunca. En el
  // portátil no pasaba, y por eso parecía que sólo fallaba desde el iPad.
  let debounce = null;
  let ultimoCambio = 0;
  function schedule(ms) {
    if (!state.enabled) return;
    ultimoCambio = Date.now();
    clearTimeout(debounce);
    debounce = setTimeout(() => sync({ quiet: true }).catch(() => {}), ms || 800);
  }
  // ¿Hay algo tocado aquí que todavía no ha salido?
  function pendiente() { return ultimoCambio > state.lastOk; }

  // ---- topbar button + status dot -------------------------------------
  function wireButton() {
    const btn = document.getElementById("syncBtn");
    const label = document.getElementById("syncLabel");
    if (!btn) return;
    if (!state.enabled) { btn.hidden = true; return; }   // file:// — stays hidden
    btn.hidden = false;
    btn.addEventListener("click", () => sync().catch(() => {}));
    onChange((s) => {
      btn.dataset.state = s.busy ? "busy" : s.lastError ? "error" : s.lastOk ? "ok" : "idle";
      btn.title = s.busy ? "Sincronizando…"
        : s.lastError ? "Último intento falló: " + s.lastError
        : s.lastOk ? "Sincronizado " + new Date(s.lastOk).toLocaleTimeString()
        : "Sincronizar con el iPad";
      if (label) label.textContent = s.busy ? "SYNC…" : "SYNC";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireButton);
  else wireButton();

  if (state.enabled) {
    document.addEventListener("kaos-gallery-changed", () => schedule());
    document.addEventListener("kaos-assets-changed", () => schedule());
    // Al esconderse la pestaña: soltar YA lo que quede pendiente, sin esperar.
    // Al volver: subir lo nuestro antes que nada, y luego ponerse al día con lo
    // que haya hecho el otro aparato.
    const alEsconderse = () => {
      clearTimeout(debounce);
      if (pendiente()) sync({ quiet: true }).catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return alEsconderse();
      if (pendiente() || Date.now() - state.lastOk > 30000) schedule(300);
    });
    // pagehide es el único que iOS dispara de forma fiable al cerrar o cambiar
    // de pestaña; unload no llega.
    window.addEventListener("pagehide", alEsconderse);
    window.addEventListener("load", () => setTimeout(() => sync({ quiet: true }).catch(() => {}), 800));
  }

  root.KAOS_SYNC = { now: sync, schedule, status, onChange, enabled: () => state.enabled };
})(window);
