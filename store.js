// KAOS.REALM — backup file (cross-device) + saved flash-sheet sessions
(function (root) {
  const SESS_KEY = "kaos.sheets.v1";
  const MAX_SESS = 50;

  function sessions() {
    try { return JSON.parse(localStorage.getItem(SESS_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeSessions(list) {
    try { localStorage.setItem(SESS_KEY, JSON.stringify(list)); return true; }
    catch (e) { console.warn("session save failed", e); return false; }
  }
  function saveSession(name, data, id) {
    const list = sessions();
    const now = Date.now();
    if (id) {
      const found = list.find(x => x.id === id);
      if (found) { found.name = name || found.name; found.ts = now; found.data = data; writeSessions(list); return found; }
    }
    const s = {
      id: "s_" + now + "_" + (Math.random() * 1e6 | 0),
      name: name || ("Hoja " + new Date(now).toLocaleDateString()),
      ts: now, data,
    };
    list.unshift(s);
    while (list.length > MAX_SESS) list.pop();
    writeSessions(list);
    return s;
  }
  function getSession(id) { return sessions().find(s => s.id === id) || null; }
  function deleteSession(id) { writeSessions(sessions().filter(s => s.id !== id)); }

  // ---- backup file: gallery (with cm sizes) + saved sheets + asset library ----
  // v2 adds `assets`: the user's uploaded library pieces, base64-encoded so the
  // whole thing stays one portable .json you can drop in iCloud and open on the iPad.
  async function backupBlob() {
    const assetRows = [];
    // listAssets() already filters tombstones — a backup should carry the
    // library as it stands, not a delete log.
    for (const a of await listAssets()) {
      try {
        assetRows.push({
          id: a.id, cat: a.cat, name: a.name, ts: a.ts,
          type: a.type || "image/png",
          b64: await blobToB64(a.blob),
        });
      } catch (e) { console.warn("asset skipped in backup", a.id, e); }
    }
    const payload = {
      v: 2, ts: Date.now(),
      gallery: root.KAOS_GALLERY ? root.KAOS_GALLERY.load() : [],
      sheets: sessions(),
      assets: assetRows,
    };
    return new Blob([JSON.stringify(payload)], { type: "application/json" });
  }
  async function exportBackup() {
    const blob = await backupBlob();
    const name = "kaos-realm-backup_" + new Date().toISOString().slice(0, 10) + ".json";
    // La escalera unica de guardar (guardar.js). Antes esto probaba a
    // compartir primero y en Windows la copia no se guardaba en ninguna
    // parte: se abria el panel de compartir, que no tiene "guardar como".
    if (root.KAOS_GUARDAR) {
      const r = await root.KAOS_GUARDAR.fichero(blob, name, { id: "kaosBackup" });
      return r === "cancelado" ? "cancel" : r;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return "downloaded";
  }
  function importBackup(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const p = JSON.parse(fr.result);
          if (!p || !Array.isArray(p.gallery)) throw new Error("archivo no reconocido");
          const byId = new Map(root.KAOS_GALLERY.load().map(i => [i.id, i]));
          for (const it of p.gallery) byId.set(it.id, it); // incoming wins (carries edited cm)
          const merged = Array.from(byId.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
          root.KAOS_GALLERY.save(merged);
          let sheetsIn = 0;
          if (Array.isArray(p.sheets)) {
            const m = new Map(sessions().map(x => [x.id, x]));
            for (const x of p.sheets) { m.set(x.id, x); sheetsIn++; }
            writeSessions(Array.from(m.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_SESS));
          }
          // v2: asset library. Keyed by id, so re-importing the same file is a
          // no-op instead of duplicating every piece.
          let assetsIn = 0;
          if (Array.isArray(p.assets) && p.assets.length) {
            const have = new Set((await listAssets()).map(a => a.id));
            const s = await tx("readwrite", ASSETS);
            for (const a of p.assets) {
              if (!a || !a.b64 || have.has(a.id)) continue;
              try {
                await req(s.put({
                  id: a.id, cat: a.cat || "eyes", name: a.name || "sin nombre",
                  ts: a.ts || Date.now(), type: a.type || "image/png",
                  blob: b64ToBlob(a.b64, a.type),
                }));
                assetsIn++;
              } catch (e) { console.warn("asset skipped on import", a.id, e); }
            }
          }
          resolve({ incoming: p.gallery.length, total: merged.length, sheets: sheetsIn, assets: assetsIn });
        } catch (e) { reject(e); }
      };
      fr.onerror = () => reject(new Error("no se pudo leer el archivo"));
      fr.readAsText(file);
    });
  }

  // ================= SAVED PROJECTS (work in progress) =================
  // Only ever written when the user presses SAVE. Lives in IndexedDB so the
  // source photo + cut-out mask can be stored full size without hitting the
  // 5 MB localStorage wall.
  const DB_NAME = "kaos.realm.projects";
  const STORE = "projects";
  const ASSETS = "assets";
  let _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      // v2 adds the `assets` store — user-uploaded library pieces (eyes, mouths,
      // skulls…). Kept in IndexedDB, not localStorage, so a PNG of any size fits.
      const rq = indexedDB.open(DB_NAME, 2);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: "id" });
        if (!d.objectStoreNames.contains(ASSETS)) {
          const s = d.createObjectStore(ASSETS, { keyPath: "id" });
          s.createIndex("cat", "cat", { unique: false });
        }
      };
      rq.onsuccess = () => { _db = rq.result; resolve(_db); };
      rq.onerror = () => reject(rq.error || new Error("IndexedDB no disponible"));
    });
  }
  function tx(mode, store) {
    const name = store || STORE;
    return db().then(d => d.transaction(name, mode).objectStore(name));
  }
  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  // Run-length encode the 0/255 cut-out mask — typically 100x smaller than raw.
  function packMask(u8) {
    const runs = [];
    let cur = u8[0] > 128 ? 1 : 0, n = 0;
    for (let i = 0; i < u8.length; i++) {
      const v = u8[i] > 128 ? 1 : 0;
      if (v === cur) n++;
      else { runs.push(n); cur = v; n = 1; }
    }
    runs.push(n);
    return { first: u8[0] > 128 ? 1 : 0, runs };
  }
  function unpackMask(packed, len) {
    const out = new Uint8Array(len);
    let v = packed.first ? 255 : 0, i = 0;
    for (const n of packed.runs) {
      const end = Math.min(len, i + n);
      if (v) out.fill(255, i, end);
      i = end;
      v = v ? 0 : 255;
      if (i >= len) break;
    }
    return out;
  }
  async function listProjects() {
    try {
      const s = await tx("readonly");
      const all = await req(s.getAll());
      return all.map(p => ({ id: p.id, name: p.name, ts: p.ts, thumb: p.thumb }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    } catch (e) { console.warn(e); return []; }
  }
  async function saveProject(rec) {
    const s = await tx("readwrite");
    const id = rec.id || ("p_" + Date.now() + "_" + (Math.random() * 1e6 | 0));
    const row = { id, name: rec.name || "Sin nombre", ts: Date.now(), thumb: rec.thumb || null, data: rec.data };
    await req(s.put(row));
    return row;
  }
  async function getProject(id) {
    const s = await tx("readonly");
    return await req(s.get(id));
  }
  async function deleteProject(id) {
    const s = await tx("readwrite");
    await req(s.delete(id));
  }

  // ================= ASSET LIBRARY (user-uploaded pieces) =================
  // Every piece the user drops into the RESOURCES panel lands here, so it
  // survives a reload and rides along in the backup file / server sync.
  // Blobs are stored raw; callers get an object URL via assetURL().
  const _assetURLs = new Map(); // id -> object URL, revoked on delete

  async function listAssets(cat) {
    try {
      const s = await tx("readonly", ASSETS);
      const all = await req(s.getAll());
      return all
        .filter(a => !a.deleted)
        .filter(a => !cat || a.cat === cat)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    } catch (e) { console.warn("listAssets failed", e); return []; }
  }
  // Every row, tombstones included — the sync client needs these to tell the
  // other device about deletions.
  async function listAssetsRaw() {
    try {
      const s = await tx("readonly", ASSETS);
      return await req(s.getAll());
    } catch (e) { return []; }
  }
  async function addAsset(cat, name, blob) {
    const s = await tx("readwrite", ASSETS);
    const row = {
      id: "a_" + Date.now() + "_" + (Math.random() * 1e6 | 0),
      cat, name: name || "sin nombre", ts: Date.now(),
      type: blob.type || "image/png", blob,
    };
    await req(s.put(row));
    return row;
  }
  // Soft delete. A hard delete would come straight back on the next sync: the
  // server still holds the row, and the merge can't tell "deleted here" from
  // "not seen here yet". A tombstone carries a newer ts, so it wins and the
  // deletion propagates to the other device.
  async function deleteAsset(id) {
    const s = await tx("readwrite", ASSETS);
    const prev = await req(s.get(id));
    await req(s.put({
      id,
      cat: (prev && prev.cat) || "eyes",
      name: (prev && prev.name) || "",
      // `type` is kept so the server can work out the on-disk filename and
      // actually delete the bytes; only the blob itself is dropped.
      type: (prev && prev.type) || "image/png",
      ts: Date.now(),
      deleted: true,
    }));
    const u = _assetURLs.get(id);
    if (u) { URL.revokeObjectURL(u); _assetURLs.delete(id); }
  }
  // Stable object URL per asset — reused so the same blob isn't re-registered
  // on every grid re-render (that leaked a URL per repaint before).
  function assetURL(row) {
    let u = _assetURLs.get(row.id);
    if (!u) { u = URL.createObjectURL(row.blob); _assetURLs.set(row.id, u); }
    return u;
  }

  // ---- base64 <-> Blob, so assets can travel inside the JSON backup ----
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: type || "image/png" });
  }

  // ---- primitives the sync client needs -------------------------------
  // saveSession()/addAsset() mint a fresh id every call, which would duplicate
  // every record on each sync pass. These write a row with the id it already
  // has, so the server's last-write-wins merge stays stable.
  function replaceSessions(list) {
    return writeSessions((list || []).slice(0, MAX_SESS));
  }
  async function putAssetRow(row) {
    const s = await tx("readwrite", ASSETS);
    await req(s.put({
      id: row.id, cat: row.cat || "eyes", name: row.name || "sin nombre",
      ts: row.ts || Date.now(), type: row.type || "image/png", blob: row.blob,
    }));
    return row;
  }
  async function getAsset(id) {
    try {
      const s = await tx("readonly", ASSETS);
      return await req(s.get(id));
    } catch (e) { return null; }
  }

  root.KAOS_STORE = {
    sessions, saveSession, getSession, deleteSession, exportBackup, importBackup,
    listProjects, saveProject, getProject, deleteProject, packMask, unpackMask,
    listAssets, listAssetsRaw, addAsset, deleteAsset, assetURL, blobToB64, b64ToBlob,
    replaceSessions, putAssetRow, getAsset,
  };
})(window);
