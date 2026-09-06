// KAOS.REALM — backup file (cross-device) + saved flash-sheet sessions
(function (root) {

  // ================================================================ ALMACÉN
  //
  // POR QUÉ ESTO CAMBIÓ DE SITIO
  //
  // Las hojas y los borradores vivían en `localStorage`. El navegador da unos
  // 5 MB para TODO el dominio, y cada hoja se lleva dentro la foto de fondo:
  // una suya ocupaba 965 KB. Con la galería compartiendo ese mismo cajón, a la
  // décima hoja el navegador empezaba a decir que no.
  //
  // Y lo peor no era el techo, era el silencio: `setItem` lanzaba, el `catch`
  // lo escribía en la consola, y arriba se seguía enseñando «Hoja guardada».
  // Parecía un tope de 10; era un fallo que nadie contaba.
  //
  // Ahora van a IndexedDB, que no tiene ese techo, igual que ya se hizo con la
  // galería. Las claves viejas de localStorage NO se borran: se leen una vez
  // para subir lo que hubiera y se quedan de última copia.
  //
  // La API de fuera sigue siendo SÍNCRONA a propósito. `sessions()` se llama
  // desde media app y volverla asíncrona obligaría a tocar decenas de sitios
  // por nada. El truco es el de gallery.js: una lista en memoria que es la de
  // verdad mientras la app corre, y la escritura al disco va detrás sin que
  // nadie la espere.
  const SESS_KEY = "kaos.sheets.v1";
  const BORR_KEY_LEGADO = "kaos.borradores.v1";
  // Ya no es el techo de nada, es una red por si algún día se llena de basura.
  const MAX_SESS = 300;

  const DB_NOMBRE = "kaos.realm.store";
  const T_HOJAS = "hojas", T_BORR = "borradores";
  let _dbAlm = null;
  function dbAlm() {
    if (_dbAlm) return _dbAlm;
    _dbAlm = new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NOMBRE, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains(T_HOJAS)) d.createObjectStore(T_HOJAS, { keyPath: "id" });
        if (!d.objectStoreNames.contains(T_BORR)) d.createObjectStore(T_BORR, { keyPath: "id" });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error("IndexedDB no disponible"));
    });
    return _dbAlm;
  }
  function idbTodos(tienda) {
    return dbAlm().then((d) => new Promise((res, rej) => {
      const r = d.transaction(tienda, "readonly").objectStore(tienda).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }));
  }
  function idbEscribir(tienda, poner, sacar) {
    if (!poner.length && !sacar.length) return Promise.resolve();
    return dbAlm().then((d) => new Promise((res, rej) => {
      const t = d.transaction(tienda, "readwrite");
      const st = t.objectStore(tienda);
      for (const it of poner) st.put(it);
      for (const id of sacar) st.delete(id);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  // Guardar es lo que ella acaba de pedir con un clic: si falla, se dice. El
  // silencio de antes es justo lo que la hizo pensar que había un tope de 10.
  function pegar(tienda, fila) {
    idbEscribir(tienda, [fila], []).catch((e) => {
      console.warn("almacén: no se pudo guardar", e);
      if (root.KAOS_AVISO) root.KAOS_AVISO("No he podido guardar: " + ((e && e.message) || e));
    });
  }
  function quitar(tienda, id) {
    idbEscribir(tienda, [], [id]).catch((e) => console.warn("almacén: no se pudo borrar", e));
  }

  function leerLegado(clave) {
    try { return JSON.parse(localStorage.getItem(clave) || "[]") || []; }
    catch (e) { return []; }
  }
  // Las listas de verdad mientras la app corre. Arrancan con lo que hubiera en
  // localStorage para que en el primer pintado no parezca que se ha perdido
  // todo mientras IndexedDB abre.
  let _hojas = leerLegado(SESS_KEY);
  let _borr = leerLegado(BORR_KEY_LEGADO);
  let _listo = null;
  const porFecha = (a, b) => (b.ts || 0) - (a.ts || 0);

  // Funde lo de IndexedDB con lo de localStorage: gana la copia más reciente de
  // cada id, para que abrirla en el iPad después de trabajar en el PC no
  // resucite una versión vieja.
  function fundir(deIdb, deLegado) {
    const porId = new Map();
    for (const f of deIdb) if (f && f.id) porId.set(f.id, f);
    for (const f of deLegado) {
      if (!f || !f.id) continue;
      const hay = porId.get(f.id);
      if (!hay || (f.ts || 0) > (hay.ts || 0)) porId.set(f.id, f);
    }
    return Array.from(porId.values()).sort(porFecha);
  }

  function arrancar() {
    if (_listo) return _listo;
    _listo = Promise.all([idbTodos(T_HOJAS), idbTodos(T_BORR)])
      .then(([h, b]) => {
        _hojas = fundir(h, _hojas);
        _borr = fundir(b, _borr);
        // Sube lo que sólo estaba en localStorage. Una vez.
        const subirH = _hojas.filter(x => !h.some(y => y.id === x.id));
        const subirB = _borr.filter(x => !b.some(y => y.id === x.id));
        return idbEscribir(T_HOJAS, subirH, []).then(() => idbEscribir(T_BORR, subirB, []));
      })
      .catch((e) => {
        // Sin IndexedDB se sigue con lo de localStorage: peor, pero algo.
        console.warn("almacén: IndexedDB no disponible", e);
      })
      .then(() => {
        for (const f of _avisar) { try { f(); } catch (e) {} }
      });
    return _listo;
  }
  // Quien pinte una lista se apunta aquí para repintarla cuando IndexedDB haya
  // abierto: en ese instante pueden aparecer hojas que no estaban.
  const _avisar = [];
  function alEstarListo(f) { if (typeof f === "function") _avisar.push(f); }

  // --------------------------------------------------------------- hojas
  function sessions() { return _hojas.slice().sort(porFecha); }
  // `thumb` es la miniatura en data:. Opcional, para no romper a quien llamaba
  // con tres argumentos.
  // `thumb`: 360 px, para la tarjeta de la lista.
  // `render`: 1080 px, para meter la hoja como página de un reel. Van
  // separados porque son dos trabajos distintos: la lista carga veinte a la
  // vez y no puede permitirse veinte imágenes grandes, y el vídeo no puede
  // permitirse una de 360 estirada al triple.
  function saveSession(name, data, id, thumb, render) {
    const now = Date.now();
    if (id) {
      const found = _hojas.find(x => x.id === id);
      if (found) {
        found.name = name || found.name; found.ts = now; found.data = data;
        // Sin imagen nueva se conserva la que hubiera: mejor una foto de hace
        // un rato que una tarjeta en blanco.
        if (thumb) found.thumb = thumb;
        if (render) found.render = render;
        pegar(T_HOJAS, found);
        return found;
      }
    }
    const s = {
      id: "s_" + now + "_" + (Math.random() * 1e6 | 0),
      name: name || ("Hoja " + new Date(now).toLocaleDateString()),
      ts: now, data, thumb: thumb || null, render: render || null,
    };
    _hojas.unshift(s);
    while (_hojas.length > MAX_SESS) {
      const fuera = _hojas.pop();
      if (fuera) quitar(T_HOJAS, fuera.id);
    }
    pegar(T_HOJAS, s);
    return s;
  }
  function getSession(id) { return _hojas.find(s => s.id === id) || null; }
  function deleteSession(id) {
    _hojas = _hojas.filter(s => s.id !== id);
    quitar(T_HOJAS, id);
  }

  // ---------------------------------------------------------- borradores
  // Un trabajo a medias, de cualquier editor. Van en su propio cajón y no en
  // `sessions()` a propósito: ahí viven las hojas de flash TERMINADAS, y el
  // desplegable «desde una hoja guardada» del reel las lee. Si los borradores
  // se mezclaran, ese desplegable se llenaría de cosas a medio hacer.
  //
  // Cada borrador lleva `tipo` (reel, carrusel, flash…) para que cada editor
  // vea sólo los suyos.
  // Mismo cambio que las hojas: la lista de verdad está en memoria y el disco
  // es IndexedDB. Ver el comentario grande de ALMACÉN, arriba.
  const MAX_BORR = 200;

  // Sin `tipo` los devuelve todos; con `tipo`, sólo los de ese editor.
  function borradores(tipo) {
    const list = _borr.slice().sort(porFecha);
    return tipo ? list.filter(b => b.tipo === tipo) : list;
  }
  function guardarBorrador(tipo, nombre, data, id, thumb) {
    const now = Date.now();
    if (id) {
      const hay = _borr.find(x => x.id === id);
      if (hay) {
        hay.nombre = nombre || hay.nombre; hay.ts = now; hay.data = data;
        if (thumb) hay.thumb = thumb;
        pegar(T_BORR, hay);
        return hay;
      }
    }
    const b = {
      id: "b_" + now + "_" + (Math.random() * 1e6 | 0),
      tipo: tipo || "otro",
      nombre: nombre || ("Borrador " + new Date(now).toLocaleString()),
      ts: now, data, thumb: thumb || null,
    };
    _borr.unshift(b);
    // El tope es por tipo, no global: si no, montar veinte reels borraría los
    // borradores de flash sin avisar.
    let vistos = 0;
    for (let i = 0; i < _borr.length; i++) {
      if (_borr[i].tipo !== b.tipo) continue;
      vistos++;
      if (vistos > MAX_BORR) { quitar(T_BORR, _borr[i].id); _borr.splice(i, 1); i--; }
    }
    pegar(T_BORR, b);
    return b;
  }
  function abrirBorrador(id) { return _borr.find(b => b.id === id) || null; }
  function borrarBorrador(id) {
    _borr = _borr.filter(b => b.id !== id);
    quitar(T_BORR, id);
  }

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
            // `replaceSessions` y no la función vieja de localStorage: ahora
            // esto tiene que bajar también a IndexedDB, que es donde viven.
            replaceSessions(Array.from(m.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
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
    const nuevas = (list || []).slice(0, MAX_SESS);
    // Lo que ya no viene del servidor se borra también del disco: si no, la
    // fila se quedaría en IndexedDB y volvería a aparecer en la próxima carga.
    const quedan = new Set(nuevas.map(s => s && s.id));
    for (const v of _hojas) if (v && v.id && !quedan.has(v.id)) quitar(T_HOJAS, v.id);
    _hojas = nuevas;
    idbEscribir(T_HOJAS, nuevas.filter(Boolean), [])
      .catch((e) => console.warn("almacén: sync no pudo escribir", e));
    return true;
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
    borradores, guardarBorrador, abrirBorrador, borrarBorrador,
    listo: arrancar, alEstarListo: alEstarListo,
    listProjects, saveProject, getProject, deleteProject, packMask, unpackMask,
    listAssets, listAssetsRaw, addAsset, deleteAsset, assetURL, blobToB64, b64ToBlob,
    replaceSessions, putAssetRow, getAsset,
  };

  // Abrir IndexedDB en cuanto se carga el fichero, sin esperar a que alguien
  // pida una hoja: así, para cuando ella pulse «Hojas guardadas», la lista ya
  // está fundida. Nadie espera a esta promesa; quien necesite repintar cuando
  // termine se apunta con `alEstarListo`.
  arrancar();
})(window);
