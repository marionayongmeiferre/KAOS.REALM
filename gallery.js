// KAOS.REALM — gallery + flash-post composer (v3)
(function (root) {
  // ============ BACKGROUND PHOTO ============
  // La foto de fondo la elige ella. Antes era un fichero fijo, "flash-bg.png",
  // que NO existe en la carpeta: la imagen fallaba en silencio (onerror ->
  // resolve(null)) y el fondo no salía nunca, sin ningún aviso. Por eso parecía
  // que la casilla «foto de fondo» no hacía nada.
  let _bgPhotoImg = null;
  // Fondo por defecto de las hojas: su foto de fondo de flash. Vive aqui dentro
  // porque el servidor solo sirve ficheros de su propia carpeta.
  const FONDO_FLASH = "uploads/fondo_flash.JPG";
  // El letrero de neón del estudio. Es el fondo que sale en la mayoría de sus
  // posts de tatuaje terminado, así que vive aquí como fondo de marca y no como
  // «una foto que subió un día»: se elige por su nombre en todos los editores.
  const FONDO_NEON = "uploads/fondo_neon.jpg";
  // Los fondos de la marca, en un solo sitio. Quien ofrezca elegir fondo lee
  // esta lista; así añadir uno nuevo es una línea y aparece en todas partes, en
  // vez de tener que acordarse de tocar el reel, el flash post y lo que venga.
  const FONDOS_MARCA = [
    { nombre: "FLASH", src: FONDO_FLASH },
    { nombre: "NEÓN",  src: FONDO_NEON },
  ];
  let _bgPhotoSrc = FONDO_FLASH;
  function setBgPhoto(src) {
    if (src === _bgPhotoSrc) return;
    _bgPhotoSrc = src || null;
    _bgPhotoImg = null;           // la que estaba en memoria ya no vale
  }
  function bgPhotoSrc() { return _bgPhotoSrc; }
  function loadBgPhoto() {
    if (!_bgPhotoSrc) return Promise.resolve(null);
    if (_bgPhotoImg) return Promise.resolve(_bgPhotoImg);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { _bgPhotoImg = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = _bgPhotoSrc;
    });
  }

  // ============ LOGO ============
  let _logoImg = null;
  const _logoSrc = "uploads/kaos_logo.PNG";
  function loadLogo() {
    if (_logoImg) return Promise.resolve(_logoImg);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { _logoImg = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = _logoSrc;
    });
  }

  // ============ STORAGE ============
  //
  // Los diseños YA NO viven en localStorage.
  //
  // Medido el 26/8/2026: su galeria pesaba 8,44 MB. localStorage da 5 MB para
  // TODO. `saveRaw` hacia esto:
  //
  //     while (items.length > 0) {
  //       try { localStorage.setItem(...); return true; } catch (e) { items.pop(); }
  //     }
  //
  // o sea, cuando no cabia iba tirando diseños por la cola, en silencio, hasta
  // que cabia. Cada diseño nuevo se comia uno viejo y ella no se enteraba: por
  // eso «cuando añado, desaparecen».
  //
  // Ahora viven en IndexedDB, que no tiene ese techo. La clave vieja de
  // localStorage NO se toca ni se borra: se queda como ultima copia de lo que
  // hubiera, y solo se lee para migrar la primera vez.
  const STORAGE_KEY = "kaos.gallery.v1";
  const MAX_ITEMS = 2000;

  const DB_NOMBRE = "kaos.realm.gallery";
  const DB_TIENDA = "items";
  let _idb = null;
  function idb() {
    if (_idb) return _idb;
    _idb = new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NOMBRE, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains(DB_TIENDA)) d.createObjectStore(DB_TIENDA, { keyPath: "id" });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error || new Error("IndexedDB no disponible"));
    });
    return _idb;
  }
  function idbTodos() {
    return idb().then((d) => new Promise((res, rej) => {
      const r = d.transaction(DB_TIENDA, "readonly").objectStore(DB_TIENDA).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    }));
  }
  function idbEscribir(poner, quitar) {
    if (!poner.length && !quitar.length) return Promise.resolve();
    return idb().then((d) => new Promise((res, rej) => {
      const t = d.transaction(DB_TIENDA, "readwrite");
      const st = t.objectStore(DB_TIENDA);
      for (const it of poner) st.put(it);
      for (const id of quitar) st.delete(id);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }

  let _cache = null;              // la lista de verdad mientras la app corre
  const _sellos = new Map();      // id -> sello de lo que ya esta escrito en IndexedDB
  let _pendiente = null;
  let _listo = null;

  function leerLegado() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { console.warn("galeria: no se pudo leer la copia vieja", e); return []; }
  }
  function persistirYa() {
    clearTimeout(_pendiente); _pendiente = null;
    const poner = [], vivos = new Set();
    for (const it of _cache || []) {
      if (!it || !it.id) continue;
      vivos.add(it.id);
      if (_sellos.get(it.id) !== stamp(it)) poner.push(it);
    }
    const quitar = [];
    _sellos.forEach((_, id) => { if (!vivos.has(id)) quitar.push(id); });
    if (!poner.length && !quitar.length) return Promise.resolve();
    return idbEscribir(poner, quitar).then(() => {
      for (const it of poner) _sellos.set(it.id, stamp(it));
      for (const id of quitar) _sellos.delete(id);
    }).catch((e) => {
      console.warn("galeria: no se pudo guardar en IndexedDB", e);
      // Red de seguridad: si IndexedDB no existiera, se intenta la clave vieja.
      // Puede no caber — pero aqui NO se tira nada para hacer sitio: se avisa y
      // se deja como esta. El servidor sigue teniendo la copia buena.
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache || [])); }
      catch (e2) { console.warn("galeria: tampoco cabe en localStorage; la copia buena esta en el servidor", e2); }
    });
  }
  function persistir() {
    clearTimeout(_pendiente);
    _pendiente = setTimeout(persistirYa, 300);
  }
  // Arranque: se junta lo que haya en IndexedDB con lo que quedara en la clave
  // vieja de localStorage, gana la fecha mas nueva, y lo que solo estuviera en
  // localStorage se sube a IndexedDB.
  function arrancar() {
    if (_listo) return _listo;
    _cache = leerLegado();
    _listo = idbTodos().then((filas) => {
      const porId = new Map();
      for (const f of filas) {
        if (!f || !f.id) continue;
        porId.set(f.id, f);
        _sellos.set(f.id, stamp(f));
      }
      for (const it of _cache) {
        if (!it || !it.id) continue;
        const cur = porId.get(it.id);
        if (!cur || stamp(it) > stamp(cur)) porId.set(it.id, it);
      }
      _cache = Array.from(porId.values());
      return persistirYa();
    }).catch((e) => {
      // Sin IndexedDB se sigue con lo que hubiera: mejor eso que nada.
      console.warn("galeria: IndexedDB no disponible", e);
    }).then(() => { changed(); return _cache; });
    return _listo;
  }

  const MAX_TOMBS = 200;

  // Sello de modificación. `ts` es cuándo NACIÓ el diseño y manda el orden de la
  // rejilla; `mts` es cuándo se TOCÓ por última vez (medida, carpeta, borrado) y
  // es lo que decide quién gana al sincronizar. Separarlos evita que cambiar los
  // centímetros mande el diseño al principio de la galería.
  function stamp(r) { return Math.max((r && r.ts) || 0, (r && r.mts) || 0); }
  function nacimiento(r) { return (r && r.bts) || (r && r.ts) || 0; }

  // Tocar un diseño (medida, carpeta) le pone fecha de AHORA en `ts`, y guarda
  // la de nacimiento en `bts` la primera vez.
  //
  // Podría bastar con `mts`, que es más limpio, pero el servidor sólo entiende
  // `ts`: mientras no se reinicie, un cambio con la fecha vieja pierde contra
  // la copia sin tocar del otro aparato y la medida se pierde sola. Moviendo
  // `ts` gana en los dos servidores, el viejo y el nuevo, sin reiniciar nada.
  // El orden de la rejilla no se descoloca porque se ordena por `bts`.
  function touch(it) {
    if (!it) return it;
    if (it.bts == null) it.bts = it.ts || Date.now();
    it.ts = Date.now();
    it.mts = it.ts;
    return it;
  }
  function changed() {
    try { document.dispatchEvent(new CustomEvent("kaos-gallery-changed")); } catch (e) {}
  }

  // loadRaw incluye las lápidas (los borrados). load() las esconde: es lo que
  // usan la rejilla, el composer y todo lo demás.
  function loadRaw() {
    if (_cache == null) arrancar();
    return _cache;
  }
  // Ordenada por fecha de nacimiento, no por la de tocar: así editar los
  // centímetros de un diseño viejo no lo manda de golpe al principio.
  function load() {
    return loadRaw()
      .filter(i => i && !i.deleted)
      .sort((a, b) => nacimiento(b) - nacimiento(a));
  }

  // NUNCA tira nada. Si algo no se pudiera escribir, se avisa por consola y la
  // lista sigue entera en memoria — lo que no se hace es borrarle diseños para
  // hacer sitio, que es lo que pasaba antes.
  function saveRaw(items) {
    const vistos = new Set();
    const out = [];
    for (const it of items || []) {
      if (!it || !it.id || vistos.has(it.id)) continue;
      vistos.add(it.id); out.push(it);
    }
    _cache = out;
    persistir();
    return true;
  }
  // Guardar una lista SIN lápidas no debe deshacer un borrado: si alguien
  // (el sync, una copia de seguridad) escribe la galería limpia, las lápidas
  // locales se vuelven a meter. Sin esto el diseño borrado resucitaba.
  function save(items) {
    const byId = new Map();
    const out = [];
    for (const it of items || []) {
      if (!it || !it.id || byId.has(it.id)) continue;
      byId.set(it.id, it); out.push(it);
    }
    let tombs = 0;
    for (const t of loadRaw()) {
      if (!t || !t.deleted) continue;
      const cur = byId.get(t.id);
      if (cur && stamp(cur) >= stamp(t)) continue;   // lo han vuelto a crear después
      if (cur) out.splice(out.indexOf(cur), 1, t);
      else if (tombs++ < MAX_TOMBS) out.push(t);
      byId.set(t.id, t);
    }
    return saveRaw(out);
  }
  function shrinkPng(srcCanvas, maxDim) {
    const w = srcCanvas.width, h = srcCanvas.height;
    let nw = w, nh = h;
    if (w > maxDim || h > maxDim) { const s = maxDim / Math.max(w, h); nw = Math.round(w * s); nh = Math.round(h * s); }
    const c = document.createElement("canvas");
    c.width = nw; c.height = nh;
    c.getContext("2d").drawImage(srcCanvas, 0, 0, nw, nh);
    return c.toDataURL("image/png");
  }

  // Trim a canvas to the tight bbox of its non-transparent pixels (alpha > threshold).
  // Returns { canvas, x, y, w, h } where x/y are offsets into the source.
  function trimAlpha(srcCanvas, threshold) {
    threshold = threshold == null ? 8 : threshold;
    const w = srcCanvas.width, h = srcCanvas.height;
    const ctx = srcCanvas.getContext("2d", { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { canvas: srcCanvas, x: 0, y: 0, w, h };
    const tw = maxX - minX + 1, th = maxY - minY + 1;
    if (tw === w && th === h) return { canvas: srcCanvas, x: 0, y: 0, w, h };
    const c = document.createElement("canvas");
    c.width = tw; c.height = th;
    c.getContext("2d").drawImage(srcCanvas, -minX, -minY);
    return { canvas: c, x: minX, y: minY, w: tw, h: th };
  }
  function makeThumbWithPaper(srcCanvas, maxDim) {
    const lw = srcCanvas.width, lh = srcCanvas.height;
    const s = maxDim / Math.max(lw, lh);
    const w = Math.round(lw * s), h = Math.round(lh * s);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    // Solid white so the PNG's ink reads clearly in the gallery grid.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.9);
  }
  // ------------------------------------------------------------- huella
  //
  // POR QUÉ EXISTE ESTO
  //
  // Cada diseño se identifica por un `id` que se inventa al añadirlo
  // («g_<hora>_<azar>»). Una hoja de flash guarda los ids de los diseños que
  // lleva. Si un diseño se borra de la galería y luego se vuelve a subir EL
  // MISMO ARCHIVO, el id nuevo no tiene nada que ver con el viejo: para la
  // hoja ese diseño sigue perdido aunque lo tenga delante.
  //
  // La huella es una firma sacada del DIBUJO, no del id: si el dibujo es el
  // mismo, la firma es la misma, lo hayas subido hoy o el mes pasado.
  //
  // Cómo se hace: se encoge el diseño a 16x16 y de cada casilla se guarda
  // cuánta tinta hay (opacidad por oscuridad), en 16 niveles. Salen 256
  // caracteres. No es el archivo byte a byte a propósito: volver a guardar un
  // PNG no da bytes idénticos, y entre el PC y el iPad tampoco se encogen las
  // imágenes exactamente igual. La silueta, en cambio, aguanta.
  const HUELLA_N = 16;
  function huellaDe(canvas) {
    try {
      const c = document.createElement("canvas");
      c.width = HUELLA_N; c.height = HUELLA_N;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.clearRect(0, 0, HUELLA_N, HUELLA_N);
      x.drawImage(canvas, 0, 0, HUELLA_N, HUELLA_N);
      const d = x.getImageData(0, 0, HUELLA_N, HUELLA_N).data;
      let s = "";
      for (let i = 0; i < HUELLA_N * HUELLA_N; i++) {
        const a = d[i * 4 + 3] / 255;
        const lum = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
        // Tinta = lo que hay dibujado: opaco y oscuro. Un diseño suyo es línea
        // negra sobre transparente, así que esto lo describe bien.
        const tinta = a * (1 - lum);
        s += Math.min(15, Math.round(tinta * 15)).toString(16);
      }
      return s;
    } catch (e) { return null; }
  }
  // Dos huellas del mismo dibujo no salen idénticas: al encoger, cada navegador
  // redondea a su manera. Se acepta un nivel de diferencia por casilla y hasta
  // un 8% de casillas fuera. Por debajo son el mismo dibujo; por encima, dos
  // diseños distintos — y los suyos son muy distintos entre sí, no fotos casi
  // iguales, así que el margen no confunde a dos vecinos.
  function parecidas(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let mal = 0;
    const tope = a.length * 0.08;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16)) > 1) {
        mal++;
        if (mal > tope) return false;
      }
    }
    return true;
  }
  // El diseño de la galería que corresponde a esta huella, o null.
  function buscarPorHuella(h) {
    if (!h) return null;
    for (const it of load()) if (it.huella && parecidas(it.huella, h)) return it;
    return null;
  }

  // Los diseños de antes de que existiera la huella no la tienen. Se les
  // calcula cargando su `layerUrl`, de poquito en poco: son cientos de
  // imágenes y hacerlo del tirón dejaría la galería colgada al abrir.
  //
  // Se hace una vez y se guarda. A partir de ahí, si borra un diseño y vuelve
  // a subir el mismo archivo, sus hojas lo reconocen.
  let _firmando = null;
  function firmarPendientes() {
    if (_firmando) return _firmando;
    _firmando = (async function () {
      const items = load();
      const faltan = items.filter((i) => i && !i.huella && i.layerUrl);
      if (!faltan.length) return 0;
      let hechos = 0;
      for (const it of faltan) {
        const img = await new Promise((res) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => res(null);
          im.src = it.layerUrl;
        });
        if (img) {
          const h = huellaDe(img);
          if (h) { it.huella = h; hechos++; }
        }
        // Un respiro entre diseño y diseño: con 300 en la galería, sin esto la
        // pestaña se queda pillada un buen rato nada más abrir.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (hechos) save(items);
      return hechos;
    })();
    return _firmando;
  }

  function add(layerCanvas, opts) {
    const items = load();
    const id = "g_" + Date.now() + "_" + (Math.random() * 1e6 | 0);
    // TRIM the layer to its non-transparent bbox so Instagram packing aligns by silhouette.
    const trimmed = trimAlpha(layerCanvas, 8).canvas;
    const layerUrl = shrinkPng(trimmed, 900);
    const thumbUrl = makeThumbWithPaper(trimmed, 360);
    const item = {
      id, ts: Date.now(),
      style: opts.style || "—",
      paper: opts.paper || "#d9d4c8",
      w: trimmed.width, h: trimmed.height,
      sizeCm: opts.sizeCm != null ? opts.sizeCm : 10,
      layerUrl, thumbUrl,
      // Se saca del recorte, que es lo mismo que hay dentro de `layerUrl`: así
      // la huella de un diseño nuevo y la de uno viejo (que se calcula
      // cargando su `layerUrl`) salen comparables.
      huella: huellaDe(trimmed),
    };
    items.unshift(item);
    while (items.length > MAX_ITEMS) items.pop();
    save(items);
    return item;
  }
  // Borrar deja una LÁPIDA en vez de quitar la fila. Si sólo se quitara, el
  // servidor seguiría teniendo el diseño y te lo devolvería en la siguiente
  // sincronización: borrabas, y al recargar volvía a aparecer.
  function remove(id) {
    const items = loadRaw().filter(i => i && i.id !== id);
    items.unshift({ id, ts: Date.now(), mts: Date.now(), deleted: true });
    saveRaw(items);
    changed();
    return load();
  }
  function clear() {
    _cache = [];
    persistirYa();
    localStorage.removeItem(STORAGE_KEY);
    paperCache = null; paperCacheKey = null;
  }
  function count() { return load().length; }

  // ============ FOLDERS (by style tag) ============
  const FOLDERS_KEY = "kaos.gallery.folders.v1";
  function loadFolders() {
    try { const raw = localStorage.getItem(FOLDERS_KEY); return raw ? JSON.parse(raw) : []; }
    catch (e) { return []; }
  }
  function saveFolders(list) {
    try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function listFolders() {
    // Union of persisted folder names and any style tag actually in use.
    const persisted = loadFolders();
    const used = new Set(load().map(it => (it.style || "").trim()).filter(Boolean));
    const out = persisted.slice();
    for (const s of used) if (!out.includes(s)) out.push(s);
    return out;
  }
  function addFolder(name) {
    name = String(name || "").trim();
    if (!name) return null;
    const list = loadFolders();
    if (!list.includes(name)) { list.push(name); saveFolders(list); }
    return name;
  }
  function renameFolder(from, to) {
    from = String(from || "").trim(); to = String(to || "").trim();
    if (!from || !to || from === to) return;
    const list = loadFolders().map(n => n === from ? to : n);
    if (!list.includes(to)) list.push(to);
    saveFolders(list);
    const items = load();
    for (const it of items) if ((it.style || "") === from) { it.style = to; touch(it); }
    save(items);
    changed();
  }
  function removeFolder(name, moveTo) {
    name = String(name || "").trim();
    if (!name) return;
    saveFolders(loadFolders().filter(n => n !== name));
    const items = load();
    for (const it of items) if ((it.style || "") === name) { it.style = moveTo || ""; touch(it); }
    save(items);
    changed();
  }
  function setItemFolder(id, folder) {
    const items = load();
    const it = items.find(i => i.id === id);
    if (!it) return;
    it.style = String(folder || "").trim();
    touch(it);
    save(items);
    changed();
  }
  // Set the approximate max tattoo size (in cm) for one gallery item.
  //
  // `touch` es obligatorio: sin él el diseño conserva su sello viejo, y al
  // sincronizar el otro aparato lo pisa con su copia sin la medida. Era el
  // motivo de que los centímetros puestos en el iPad se perdieran solos.
  function setSize(id, cm) {
    const items = load();
    const it = items.find(i => i.id === id);
    if (!it) return;
    let v = Math.round(Number(cm));
    if (!isFinite(v)) v = 0;
    it.sizeCm = Math.max(0, Math.min(200, v));
    touch(it);
    save(items);
    changed();
    return it.sizeCm;
  }

  // ============ ETIQUETAS ============
  // Son distintas de las carpetas (`it.style`): una carpeta es un sitio y un
  // diseño sólo puede estar en una. Una etiqueta es una marca y un mismo diseño
  // puede llevar varias — un flash puede ser de flash day Y quedarse luego como
  // permanente. Por eso `tags` es una lista y no un campo suelto.
  const ETIQUETAS = ["FLASH DAY", "PERMANENTE"];
  function tags(it) { return (it && Array.isArray(it.tags)) ? it.tags : []; }
  function tieneTag(it, tag) { return tags(it).indexOf(tag) >= 0; }
  function toggleTag(id, tag) {
    const items = load();
    const it = items.find(i => i.id === id);
    if (!it) return null;
    const lista = tags(it).slice();
    const k = lista.indexOf(tag);
    if (k >= 0) lista.splice(k, 1); else lista.push(tag);
    it.tags = lista;
    touch(it);           // sin esto el otro aparato lo pisa al sincronizar
    save(items);
    changed();
    return lista;
  }
  function conTag(tag) { return load().filter(it => tieneTag(it, tag)); }

  // ============ FONTS ============
  const FONTS = {
    cursive:     { family: "Thei Personal Use", weight: "400", sample: "Kaos" },
    gothic:      { family: "UnifrakturCook",  weight: "700", sample: "Kaos" },
    blackletter: { family: "Pirata One",      weight: "400", sample: "Kaos" },
    serif:       { family: "Cinzel",          weight: "700", sample: "KAOS" },
    bebas:       { family: "Bebas Neue",      weight: "400", sample: "KAOS" },
    anton:       { family: "Anton",           weight: "400", sample: "KAOS" },
    typewriter:  { family: "Special Elite",   weight: "400", sample: "Kaos" },
    marker:      { family: "Permanent Marker",weight: "400", sample: "Kaos" },
    rye:         { family: "Rye",             weight: "400", sample: "KAOS" },
    mono:        { family: "JetBrains Mono",  weight: "700", sample: "KAOS" },
    helvExt:     { family: "Helvetica Neue LT Std 73 BEx", weight: "700", sample: "KAOS" },
  };
  async function ensureFonts(ids) {
    if (!document.fonts) return;
    for (const id of ids) {
      const f = FONTS[id];
      if (!f) continue;
      try {
        await document.fonts.load(`${f.weight} 80px "${f.family}"`);
        await document.fonts.load(`16px "${f.family}"`);
      } catch (e) {}
    }
  }
  function fontStr(id, sizePx) {
    const f = FONTS[id] || FONTS.gothic;
    return `${f.weight} ${sizePx}px "${f.family}", serif`;
  }

  // Resolve a decor-color name to a paint config. "gray" applies a multiply
  // + low-alpha wash (same look as the logo) instead of a solid fill.
  function resolveDecor(name, opts) {
    switch (name) {
      case "white":     return { fill: "#ffffff", stroke: null, alpha: 1,   comp: "source-over" };
      case "primary":   return { fill: opts.brandPrimary   || "#ff3d5c", stroke: null, alpha: 1, comp: "source-over" };
      case "secondary": return { fill: opts.brandSecondary || "#d4ff2f", stroke: null, alpha: 1, comp: "source-over" };
      case "gray":      return { fill: "#0a0908", stroke: null, alpha: 0.28, comp: "multiply" };
      case "black":
      default:          return { fill: "#0a0908", stroke: null, alpha: 1,   comp: "source-over" };
    }
  }
  function applyDecor(ctx, dc) {
    ctx.fillStyle = dc.fill;
    ctx.globalAlpha = dc.alpha;
    ctx.globalCompositeOperation = dc.comp;
  }

  // ============ RNG ============
  function rng(seed) {
    let s = (seed | 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ============ PAPER (seeded, cached) ============
  let paperCache = null;
  let paperCacheKey = null;
  function paintPaperSeeded(ctx, W, H, color, seed) {
    const rand = rng(seed || 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * 28;
      d[i]     = clamp(d[i]     + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n * 0.9, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n * 0.8, 0, 255);
    }
    const cx = W / 2, cy = H / 2, maxD = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy;
        const r = Math.sqrt(dx * dx + dy * dy) / maxD;
        const v = Math.pow(r, 2) * 36;
        const i = (y * W + x) * 4;
        d[i]     = clamp(d[i]     - v, 0, 255);
        d[i + 1] = clamp(d[i + 1] - v, 0, 255);
        d[i + 2] = clamp(d[i + 2] - v, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function getPaperLayer(W, H, color, seed) {
    const key = `${W}|${H}|${color}|${seed}`;
    if (paperCache && paperCacheKey === key && paperCache.width === W && paperCache.height === H) return paperCache;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    paintPaperSeeded(c.getContext("2d"), W, H, color, seed);
    paperCache = c;
    paperCacheKey = key;
    return paperCache;
  }

  // ============ LAYOUT TEMPLATES ============
  const TIGHT_CELLS = {
    1: [
      { x: 0.08, y: 0.03, w: 0.84, h: 0.84 },
    ],
    3: [
      { x: 0,    y: 0,    w: 1,    h: 0.50 },
      { x: 0,    y: 0.50, w: 0.50, h: 0.50 },
      { x: 0.50, y: 0.50, w: 0.50, h: 0.50 },
    ],
    4: [
      { x: 0,    y: 0,    w: 0.50, h: 0.50 },
      { x: 0.50, y: 0,    w: 0.50, h: 0.50 },
      { x: 0,    y: 0.50, w: 0.50, h: 0.50 },
      { x: 0.50, y: 0.50, w: 0.50, h: 0.50 },
    ],
    5: [
      { x: 0,    y: 0,    w: 0.50, h: 0.34 },
      { x: 0.50, y: 0,    w: 0.50, h: 0.34 },
      { x: 0,    y: 0.34, w: 1,    h: 0.32 },
      { x: 0,    y: 0.66, w: 0.50, h: 0.34 },
      { x: 0.50, y: 0.66, w: 0.50, h: 0.34 },
    ],
    2: [
      { x: 0, y: 0,    w: 1, h: 0.50 },
      { x: 0, y: 0.50, w: 1, h: 0.50 },
    ],
    6: [
      { x: 0,       y: 0,    w: 1/3, h: 0.50 },
      { x: 1/3,     y: 0,    w: 1/3, h: 0.50 },
      { x: 2/3,     y: 0,    w: 1/3, h: 0.50 },
      { x: 0,       y: 0.50, w: 1/3, h: 0.50 },
      { x: 1/3,     y: 0.50, w: 1/3, h: 0.50 },
      { x: 2/3,     y: 0.50, w: 1/3, h: 0.50 },
    ],
    7: [
      { x: 0,       y: 0,    w: 1/3, h: 1/3 },
      { x: 1/3,     y: 0,    w: 1/3, h: 1/3 },
      { x: 2/3,     y: 0,    w: 1/3, h: 1/3 },
      { x: 0,       y: 1/3,  w: 0.50, h: 1/3 },
      { x: 0.50,    y: 1/3,  w: 0.50, h: 1/3 },
      { x: 0,       y: 2/3,  w: 0.50, h: 1/3 },
      { x: 0.50,    y: 2/3,  w: 0.50, h: 1/3 },
    ],
    8: [
      { x: 0,       y: 0,    w: 0.25, h: 0.50 },
      { x: 0.25,    y: 0,    w: 0.25, h: 0.50 },
      { x: 0.50,    y: 0,    w: 0.25, h: 0.50 },
      { x: 0.75,    y: 0,    w: 0.25, h: 0.50 },
      { x: 0,       y: 0.50, w: 0.25, h: 0.50 },
      { x: 0.25,    y: 0.50, w: 0.25, h: 0.50 },
      { x: 0.50,    y: 0.50, w: 0.25, h: 0.50 },
      { x: 0.75,    y: 0.50, w: 0.25, h: 0.50 },
    ],
  };
  // Any count without a template: generated grid, so no count can crash.
  function gridCells(n) {
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ x: (i % cols) / cols, y: Math.floor(i / cols) / rows, w: 1 / cols, h: 1 / rows });
    return out;
  }

  // ---- organic packing: pieces are dropped at random positions and pulled tight
  // against their neighbours, so nothing lines up into rows or columns ----
  function overlaps(a, rects, skip) {
    for (let j = 0; j < rects.length; j++) {
      if (j === skip) continue;
      const o = rects[j];
      if (a.x1 > o.cx - o.w / 2 && a.x0 < o.cx + o.w / 2 && a.y1 > o.cy - o.h / 2 && a.y0 < o.cy + o.h / 2) return true;
    }
    return false;
  }
  function boxAt(cx, cy, w, h) { return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 }; }
  function fitsRegion(b, region) {
    return b.x0 >= region.x && b.y0 >= region.y && b.x1 <= region.x + region.w && b.y1 <= region.y + region.h;
  }
  // slide a placed box toward a neighbour cluster until it touches (kills dead space
  // without producing aligned edges, because each piece settles in its own direction)
  function settle(r, rects, region, rand) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
    for (let pass = 0; pass < 3; pass++) {
      const d = dirs[Math.floor(rand() * dirs.length)];
      let step = Math.max(region.w, region.h) * 0.05;
      while (step > Math.max(region.w, region.h) * 0.002) {
        const cx = r.cx + d[0] * step, cy = r.cy + d[1] * step;
        const b = boxAt(cx, cy, r.w, r.h);
        if (fitsRegion(b, region) && !overlaps(b, rects, rects.indexOf(r))) { r.cx = cx; r.cy = cy; }
        else step /= 2;
      }
    }
  }
  function organicPack(boxes, region, rand) {
    const rects = [];
    for (const b of boxes) {
      if (b.w > region.w || b.h > region.h) return null;
      let best = null, bestCost = Infinity;
      const tries = 260;
      for (let t = 0; t < tries; t++) {
        const cx = region.x + b.w / 2 + rand() * (region.w - b.w);
        const cy = region.y + b.h / 2 + rand() * (region.h - b.h);
        const box = boxAt(cx, cy, b.w, b.h);
        if (overlaps(box, rects, -1)) continue;
        // hug the existing cluster: shortest edge gap to any neighbour, plus a mild
        // pull toward the region centre so the group stays a mass, not a ring
        let near = Infinity;
        for (const o of rects) {
          const dx = Math.max(0, Math.abs(cx - o.cx) - (b.w + o.w) / 2);
          const dy = Math.max(0, Math.abs(cy - o.cy) - (b.h + o.h) / 2);
          near = Math.min(near, Math.hypot(dx, dy));
        }
        if (!rects.length) near = 0;
        const dc = Math.hypot(cx - (region.x + region.w / 2), cy - (region.y + region.h / 2));
        const cost = near * 3 + dc * 0.35;
        if (cost < bestCost) { bestCost = cost; best = { i: b.i, cx, cy, w: b.w, h: b.h }; }
      }
      if (!best) return null;
      rects.push(best);
      settle(best, rects, region, rand);
    }
    return rects;
  }
  // ---- ink coverage: how much of the bbox the artwork actually fills. Used so every
  // design lands at a similar VISUAL mass — a thin dagger gets long, a solid cross stays
  // compact — instead of every bbox being scaled to the same size.
  const inkCache = new Map();
  const trimCache = new Map(); // url -> {x,y,w,h} fractions of the opaque bbox
  const maskCache = new Map(); // url -> {w,h, data:Uint8Array} silhouette of the TRIMMED artwork
  function trimOf(it) { return (it && trimCache.get(it.layerUrl)) || { x: 0, y: 0, w: 1, h: 1 }; }
  function maskOf(it) {
    if (it && maskCache.has(it.layerUrl)) return maskCache.get(it.layerUrl);
    // Fallback: a full-rectangle mask so packing still works if measureInk hasn't run.
    return { w: 4, h: 4, data: new Uint8Array([1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]) };
  }
  function inkMeasured(items) { return items.every(it => !it || inkCache.has(it.layerUrl)); }
  async function measureInk(items) {
    for (const it of items) {
      if (!it || inkCache.has(it.layerUrl)) continue;
      let ratio = 0.45, trim = { x: 0, y: 0, w: 1, h: 1 };
      try {
        const img = await loadImage(it.layerUrl);
        const S = 128, c = document.createElement("canvas");
        c.width = S; c.height = S;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, 0, 0, S, S);
        const d = cx.getImageData(0, 0, S, S).data;
        // opaque bounding box: ignore fully transparent padding around the artwork
        let minX = S, minY = S, maxX = -1, maxY = -1;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (d[(y * S + x) * 4 + 3] > 20) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        if (maxX >= minX && maxY >= minY) {
          trim = { x: minX / S, y: minY / S, w: (maxX - minX + 1) / S, h: (maxY - minY + 1) / S };
        }
        // ink coverage measured INSIDE the trimmed box
        let ink = 0, cells = 0;
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const p = (y * S + x) * 4;
          cells++;
          const a = d[p + 3] / 255;
          if (a < 0.08) continue;
          const lum = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255;
          ink += a * (1 - lum * 0.75);
        }
        if (cells > 0) ratio = Math.max(0.05, Math.min(1, ink / cells));
        // Build a trimmed silhouette mask at ~96px longest side so the packer
        // can nest pieces by their actual shape (not the bbox).
        if (maxX >= minX && maxY >= minY) {
          const tw = (maxX - minX + 1), th = (maxY - minY + 1);
          const M = 96;
          const mw = tw >= th ? M : Math.max(6, Math.round(M * tw / th));
          const mh = th >= tw ? M : Math.max(6, Math.round(M * th / tw));
          const mc = document.createElement("canvas");
          mc.width = mw; mc.height = mh;
          const mctx = mc.getContext("2d", { willReadFrequently: true });
          mctx.drawImage(img,
            trim.x * img.naturalWidth, trim.y * img.naturalHeight,
            trim.w * img.naturalWidth, trim.h * img.naturalHeight,
            0, 0, mw, mh);
          const mdat = mctx.getImageData(0, 0, mw, mh).data;
          const mask = new Uint8Array(mw * mh);
          for (let k = 0; k < mask.length; k++) mask[k] = mdat[k * 4 + 3] > 20 ? 1 : 0;
          maskCache.set(it.layerUrl, { w: mw, h: mh, data: mask });
        }
      } catch (e) {}
      trimCache.set(it.layerUrl, trim);
      inkCache.set(it.layerUrl, ratio);
    }
  }
  // Equal visual mass, measured on the TRIMMED artwork so transparent padding never
  // counts as size. cm only nudges it.
  function naturalBox(it, i) {
    const t = trimOf(it);
    const a = ((it.w || 1) * t.w) / ((it.h || 1) * t.h);
    const ink = Math.max(0.06, Math.min(0.9, inkCache.has(it.layerUrl) ? inkCache.get(it.layerUrl) : 0.45));
    const cm = Math.max(3, Math.min(80, it.sizeCm > 0 ? it.sizeCm : 10));
    // equal BOX AREA for every design (so an elongated piece is not automatically
    // bigger than a square one), with a mild correction for sparse ink
    const area = Math.pow(0.42 / ink, 0.25) * Math.pow(cm / 10, 0.15);
    return { i, w: area * Math.sqrt(a), h: area / Math.sqrt(a) };
  }
  // grow each piece into the dead space the packer left, keeping aspect and gaps
  function inflate(rects, region, gap, rand) {
    const order = rects.map((_, i) => i).sort(() => (rand ? rand() : Math.random()) - 0.5);
    for (let pass = 0; pass < 4; pass++) {
      for (const i of order) {
        const r = rects[i];
        let lo = 1, hi = 1.60;
        for (let it = 0; it < 14; it++) {
          const f = (lo + hi) / 2;
          const w = r.w * f, h = r.h * f;
          const x0 = r.cx - w / 2 - gap, y0 = r.cy - h / 2 - gap;
          const x1 = r.cx + w / 2 + gap, y1 = r.cy + h / 2 + gap;
          let ok = x0 >= region.x && y0 >= region.y && x1 <= region.x + region.w && y1 <= region.y + region.h;
          if (ok) for (let j = 0; j < rects.length && ok; j++) {
            if (j === i) continue;
            const o = rects[j];
            if (x1 > o.cx - o.w / 2 && x0 < o.cx + o.w / 2 && y1 > o.cy - o.h / 2 && y0 < o.cy + o.h / 2) ok = false;
          }
          if (ok) lo = f; else hi = f;
        }
        if (lo > 1.001) { r.w *= lo; r.h *= lo; }
      }
    }
    return rects;
  }
  // ---- silhouette-based packing --------------------------------------------
  // Pieces nest by their ACTUAL alpha silhouette (not bbox) on a raster grid,
  // dilated by `gap` cells so every piece keeps the same clear halo from its
  // neighbours. Overlaps are impossible because the occupancy grid records the
  // dilated footprint of everything already placed.
  function silhouettePack(items, region, gapPx) {
    const cellPx = Math.max(3, Math.min(9, Math.round(Math.min(region.w, region.h) / 170)));
    const gW = Math.max(6, Math.floor(region.w / cellPx));
    const gH = Math.max(6, Math.floor(region.h / cellPx));
    const gapCells = Math.max(1, Math.ceil(gapPx / cellPx));
    const occ = new Uint8Array(gW * gH);
    // Summed-area table over `occ` — lets each candidate's bbox occupancy be
    // read in O(1). If the bbox sum is 0 the mask can't overlap anything, so
    // the slow pixel-by-pixel test only runs near already-placed pieces.
    const IW = gW + 1;
    const integ = new Int32Array(IW * (gH + 1));
    function rebuildInteg() {
      for (let i = 0; i < integ.length; i++) integ[i] = 0;
      for (let y = 0; y < gH; y++) {
        let rowSum = 0;
        const rowBase = y * gW;
        const intBase = (y + 1) * IW;
        const prevBase = y * IW;
        for (let x = 0; x < gW; x++) {
          rowSum += occ[rowBase + x];
          integ[intBase + x + 1] = integ[prevBase + x + 1] + rowSum;
        }
      }
    }
    const sorted = items.slice().sort((a, b) => (b.boxW * b.boxH) - (a.boxW * a.boxH));
    const placed = [];
    const rcx = gW / 2, rcy = gH / 2;
    for (const item of sorted) {
      const iw = Math.max(3, Math.round(item.boxW / cellPx));
      const ih = Math.max(3, Math.round(item.boxH / cellPx));
      if (iw > gW || ih > gH) return null;
      const mw = item.mask.w, mh = item.mask.h, md = item.mask.data;
      const inkOff = [];   // linear offsets into occ from top-left of the placement
      const inkXY = [];    // parallel (x,y) pairs — used when stamping
      for (let y = 0; y < ih; y++) {
        const sy = Math.min(mh - 1, Math.floor(y * mh / ih));
        for (let x = 0; x < iw; x++) {
          const sx = Math.min(mw - 1, Math.floor(x * mw / iw));
          if (md[sy * mw + sx]) { inkOff.push(y * gW + x); inkXY.push(x, y); }
        }
      }
      if (!inkOff.length) { inkOff.push(0); inkXY.push(0, 0); }
      rebuildInteg();
      let bestGx = -1, bestGy = -1, bestCost = Infinity;
      const maxGy = gH - ih, maxGx = gW - iw;
      for (let gy = 0; gy <= maxGy; gy++) {
        const dyc = gy + ih / 2 - rcy;
        const rowMin = dyc * dyc;                 // best cost anywhere in this row
        if (rowMin >= bestCost) continue;
        const intBase1 = gy * IW;
        const intBase2 = (gy + ih) * IW;
        for (let gx = 0; gx <= maxGx; gx++) {
          const dxc = gx + iw / 2 - rcx;
          const cost = dxc * dxc + rowMin;
          if (cost >= bestCost) continue;
          // bbox occupancy sum via SAT — 0 means "no possible overlap"
          const s = integ[intBase2 + gx + iw] - integ[intBase2 + gx]
                  - integ[intBase1 + gx + iw] + integ[intBase1 + gx];
          if (s > 0) {
            const base = gy * gW + gx;
            let ok = true;
            for (let k = 0; k < inkOff.length; k++) {
              if (occ[base + inkOff[k]]) { ok = false; break; }
            }
            if (!ok) continue;
          }
          bestCost = cost; bestGx = gx; bestGy = gy;
        }
      }
      if (bestGx < 0) return null;
      // Stamp DILATED footprint so every future piece keeps ≥ gapPx of clear.
      const g = gapCells;
      for (let k = 0; k < inkXY.length; k += 2) {
        const px = bestGx + inkXY[k], py = bestGy + inkXY[k + 1];
        for (let dy = -g; dy <= g; dy++) {
          const y = py + dy;
          if (y < 0 || y >= gH) continue;
          const rem = g * g - dy * dy;
          if (rem < 0) continue;
          const dxMax = Math.floor(Math.sqrt(rem));
          const rowBase = y * gW;
          const x0 = Math.max(0, px - dxMax), x1 = Math.min(gW - 1, px + dxMax);
          for (let x = x0; x <= x1; x++) occ[rowBase + x] = 1;
        }
      }
      placed.push({
        i: item.i,
        cx: region.x + (bestGx + iw / 2) * cellPx,
        cy: region.y + (bestGy + ih / 2) * cellPx,
        w: item.boxW, h: item.boxH,
      });
    }
    return placed;
  }
  function packSilhouetteRegion(items, region, gapPx) {
    if (!items.length) return [];
    // Sum of natural bbox area; s0 = scale where bboxes tile the region exactly.
    // Silhouettes interlock, so we look above s0 too.
    const totalArea = items.reduce((s, it) => s + it.baseW * it.baseH, 0) || 1;
    const s0 = Math.sqrt(region.w * region.h / totalArea);
    let lo = s0 * 0.35, hi = s0 * 1.8, best = null;
    for (let iter = 0; iter < 12; iter++) {
      const s = (lo + hi) / 2;
      const scaled = items.map(it => ({
        i: it.i, mask: it.mask,
        boxW: it.baseW * s, boxH: it.baseH * s,
      }));
      const res = silhouettePack(scaled, region, gapPx);
      if (res) { best = res; lo = s; } else hi = s;
    }
    if (!best) return null;
    return centerGroup(best, region).map(r => ({
      i: r.i, cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: 0,
    }));
  }

  // ---- deterministic contact-point packer -------------------------------------
  // Every piece is dropped at the position CLOSEST TO THE CENTRE where it still
  // clears its neighbours by exactly `gap`. No randomness, so spacing is uniform
  // everywhere and the group grows as one mass from the middle out (instead of the
  // old random-drop packer, which left big holes and wildly uneven gaps).
  function packContact(boxes, region, gap, preset, anchor) {
    const placed = (preset || []).map(r => ({ i: -1, cx: r.cx, cy: r.cy, w: r.w, h: r.h }));
    const ax = anchor ? anchor[0] : 0.5, ay = anchor ? anchor[1] : 0.5;
    const RCX = region.x + region.w * ax, RCY = region.y + region.h * ay;
    const seq = boxes.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const fits = (cx, cy, w, h) =>
      cx - w / 2 >= region.x - 0.01 && cy - h / 2 >= region.y - 0.01 &&
      cx + w / 2 <= region.x + region.w + 0.01 && cy + h / 2 <= region.y + region.h + 0.01;
    const clearOf = (cx, cy, w, h) => {
      for (let k = 0; k < placed.length; k++) {
        const o = placed[k];
        if (Math.abs(cx - o.cx) < (w + o.w) / 2 + gap - 0.01 &&
            Math.abs(cy - o.cy) < (h + o.h) / 2 + gap - 0.01) return false;
      }
      return true;
    };
    for (const b of seq) {
      if (b.w > region.w + 0.01 || b.h > region.h + 0.01) return null;
      const cand = [];
      if (!placed.length) cand.push([RCX, RCY]);
      for (const o of placed) {
        // touch positions on each side of an already-placed piece
        const xs = [o.cx - (o.w + b.w) / 2 - gap, o.cx + (o.w + b.w) / 2 + gap];
        const ys = [o.cy - (o.h + b.h) / 2 - gap, o.cy + (o.h + b.h) / 2 + gap];
        // cross-axis positions: centred on, or flush with, ANY placed piece's edges
        const ax = [o.cx], ay = [o.cy];
        for (const q of placed) {
          ax.push(q.cx, q.cx - q.w / 2 + b.w / 2, q.cx + q.w / 2 - b.w / 2);
          ay.push(q.cy, q.cy - q.h / 2 + b.h / 2, q.cy + q.h / 2 - b.h / 2);
        }
        for (const x of xs) for (const y of ay) cand.push([x, y]);
        for (const y of ys) for (const x of ax) cand.push([x, y]);
      }
      // coarse sweep as a safety net so a piece always finds SOME legal spot
      const N = 22;
      for (let gx = 0; gx <= N; gx++) for (let gy = 0; gy <= N; gy++)
        cand.push([region.x + b.w / 2 + gx * (region.w - b.w) / N,
                   region.y + b.h / 2 + gy * (region.h - b.h) / N]);
      let best = null, bestCost = Infinity;
      for (const c of cand) {
        const cx = c[0], cy = c[1];
        if (!fits(cx, cy, b.w, b.h) || !clearOf(cx, cy, b.w, b.h)) continue;
        const cost = Math.hypot(cx - RCX, cy - RCY);
        if (cost < bestCost) { bestCost = cost; best = { i: b.i, cx, cy, w: b.w, h: b.h }; }
      }
      if (!best) return null;
      placed.push(best);
    }
    return placed.filter(r => r.i >= 0);
  }
  // slide the whole packed group so its bounding box is centred on the sheet
  function centerGroup(rects, region) {
    if (!rects.length) return rects;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2);
      y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2);
    }
    const dx = (region.x + region.w / 2) - (x0 + x1) / 2;
    const dy = (region.y + region.h / 2) - (y0 + y1) / 2;
    for (const r of rects) { r.cx += dx; r.cy += dy; }
    return rects;
  }
  // Try a handful of placement ORDERS and growth ANCHORS at the same scale — growing
  // the cluster from a corner instead of dead centre often unlocks a much tighter
  // arrangement (and the whole group gets re-centred on the sheet afterwards anyway).
  const ANCHORS = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]];
  function packBest(boxes, region, gap) {
    const base = boxes.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const tries = ANCHORS.map(a => [base, a]);
    for (let k = 1; k <= 2; k++) {
      const rand = rng(k * 131 + 7);
      const ord = base.map(b => ({ b, k: rand() })).sort((p, q) => p.k - q.k).map(o => o.b);
      tries.push([ord, ANCHORS[0]], [ord, ANCHORS[1 + (k % 4)]]);
    }
    let best = null, bestSpread = Infinity;
    for (const [ord, anchor] of tries) {
      const res = packContact(ord, region, gap, null, anchor);
      if (!res) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of res) {
        x0 = Math.min(x0, r.cx - r.w / 2); x1 = Math.max(x1, r.cx + r.w / 2);
        y0 = Math.min(y0, r.cy - r.h / 2); y1 = Math.max(y1, r.cy + r.h / 2);
      }
      const spread = (x1 - x0) * (y1 - y0); // most compact bounding box wins
      if (spread < bestSpread) { bestSpread = spread; best = res; }
    }
    return best;
  }
  function packRegion(nat, region, gap, rand) {
    if (!nat.length) return [];
    // binary-search one global scale: biggest size at which everything still fits,
    // so the sheet fills up without any piece being singled out and inflated.
    const area = nat.reduce((s, b) => s + b.w * b.h, 0) || 1;
    const s0 = Math.sqrt(region.w * region.h / area);
    let lo = s0 * 0.05, hi = s0 * 1.6, best = null;
    for (let iter = 0; iter < 19; iter++) {
      const s = (lo + hi) / 2;
      const packed = packBest(nat.map(b => ({ i: b.i, w: b.w * s, h: b.h * s })), region, gap);
      if (packed) { best = packed; lo = s; } else hi = s;
    }
    if (!best) return null;
    // Grow each piece into any remaining dead space (aspect preserved) so the
    // group reads as a solid mass rather than a sprinkle with big air pockets.
    inflate(best, region, gap, rand);
    return centerGroup(best, region).map(r => ({ i: r.i, cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: 0 }));
  }
  // Re-pack every piece EXCEPT the one the user just moved, keeping all current
  // sizes: the moved piece stays put and the rest close back around it.
  function relaxAround(placements, fixedIdx, region, gap) {
    const fixed = placements[fixedIdx];
    if (!fixed) return placements;
    fixed.cx = Math.min(region.x + region.w - fixed.w / 2, Math.max(region.x + fixed.w / 2, fixed.cx));
    fixed.cy = Math.min(region.y + region.h - fixed.h / 2, Math.max(region.y + fixed.h / 2, fixed.cy));
    const boxes = placements.map((p, i) => ({ i, w: p.w, h: p.h })).filter(b => b.i !== fixedIdx);
    const pre = [{ cx: fixed.cx, cy: fixed.cy, w: fixed.w, h: fixed.h }];
    for (const g of [gap, gap * 0.6, gap * 0.3, 0]) {
      const res = packContact(boxes, region, g, pre);
      if (res) { res.forEach(r => { placements[r.i].cx = r.cx; placements[r.i].cy = r.cy; }); break; }
    }
    return placements;
  }
  // Re-distribute everything from the CURRENT sizes (never rescales) — the Scatter
  // button. `seed` only varies which equal-area piece is laid down first.
  function repackKeepSizes(placements, region, gap, seed) {
    const rand = rng(seed || 1);
    const boxes = placements.map((p, i) => ({ i, w: p.w, h: p.h, k: rand() }));
    boxes.sort((a, b) => (b.w * b.h - a.w * a.h) || (a.k - b.k));
    const anchor = ANCHORS[(seed || 1) % ANCHORS.length];
    for (const g of [gap, gap * 0.6, gap * 0.3, 0]) {
      const res = packContact(boxes, region, g, null, anchor) || packContact(boxes, region, g);
      if (res) {
        centerGroup(res, region).forEach(r => { placements[r.i].cx = r.cx; placements[r.i].cy = r.cy; });
        break;
      }
    }
    return placements;
  }
  // Gentle "push away" around a fixed piece: everyone keeps their current
  // position unless they overlap `fixed` (with `gap` clearance), in which case
  // they slide along the vector from fixed's centre by JUST enough to clear.
  // A few relaxation passes resolve chain-collisions. No global repack.
  function nudgeAround(placements, fixedIdx, region, gap) {
    const fixed = placements[fixedIdx];
    if (!fixed) return placements;
    // Clamp the fixed piece inside the region first.
    fixed.cx = Math.min(region.x + region.w - fixed.w / 2, Math.max(region.x + fixed.w / 2, fixed.cx));
    fixed.cy = Math.min(region.y + region.h - fixed.h / 2, Math.max(region.y + fixed.h / 2, fixed.cy));
    const g = gap;
    // Rectangle overlap test on inflated bboxes (bbox + gap/2 on each side).
    function overlap(a, b) {
      const dx = Math.abs(a.cx - b.cx) - (a.w + b.w) / 2 - g;
      const dy = Math.abs(a.cy - b.cy) - (a.h + b.h) / 2 - g;
      return dx < 0 && dy < 0 ? { dx, dy } : null;
    }
    // Minimum translation vector to separate `a` from `b` (`a` is the mover).
    function mtv(a, b, ov) {
      // Push along the axis that needs the least distance to clear.
      const pushX = -ov.dx;                       // >0 when they overlap
      const pushY = -ov.dy;
      const sx = a.cx >= b.cx ? 1 : -1;
      const sy = a.cy >= b.cy ? 1 : -1;
      return pushX <= pushY ? [sx * pushX, 0] : [0, sy * pushY];
    }
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = 0; i < placements.length; i++) {
        if (i === fixedIdx) continue;
        const a = placements[i];
        // Test against fixed first (root of the disturbance)…
        let ov = overlap(a, fixed);
        if (ov) {
          const [ex, ey] = mtv(a, fixed, ov);
          a.cx += ex; a.cy += ey; moved = true;
        }
        // …then against every other piece (cascades from earlier passes).
        for (let j = 0; j < placements.length; j++) {
          if (j === i || j === fixedIdx) continue;
          const b = placements[j];
          ov = overlap(a, b);
          if (!ov) continue;
          const [ex, ey] = mtv(a, b, ov);
          // Split the correction between the two so nobody teleports.
          a.cx += ex * 0.5; a.cy += ey * 0.5;
          b.cx -= ex * 0.5; b.cy -= ey * 0.5;
          moved = true;
        }
        // Clamp to region.
        a.cx = Math.min(region.x + region.w - a.w / 2, Math.max(region.x + a.w / 2, a.cx));
        a.cy = Math.min(region.y + region.h - a.h / 2, Math.max(region.y + a.h / 2, a.cy));
      }
      if (!moved) break;
    }
    return placements;
  }

  // positions after a manual scale/drag without changing sizes and never lets
  // pieces overlap. Preserves ordering by ink area so big pieces anchor first.
  function repackKeepSizesSilhouette(placements, items, region, gapPx) {
    if (!placements.length) return placements;
    const nats = placements.map((p, i) => ({
      i, mask: maskOf(items[i]), boxW: p.w, boxH: p.h,
    }));
    const res = silhouettePack(nats, region, gapPx);
    if (!res) return placements;
    const centered = centerGroup(res, region);
    for (const r of centered) { placements[r.i].cx = r.cx; placements[r.i].cy = r.cy; }
    return placements;
  }
  function usableRegion(opts) {
    const W = opts.width, H = opts.height;
    const bleedPx = (opts.bleed || 0) * Math.min(W, H);
    const titleSize = Math.round(W * 0.045);
    const handleSize = Math.round(W * 0.026);
    const headerH = (opts.title ? titleSize * 1.15 : 0) + (opts.handle ? handleSize * 1.8 : 0);
    // Fixed footer clearance — decoupled from the actual footer text so
    // typing/editing the footer or footer title doesn't shift the designs.
    const footerH = handleSize * 3.2;
    const clear = bleedPx + Math.round(Math.min(W, H) * 0.008);
    const x = Math.max(bleedPx, clear), y = Math.max(bleedPx + headerH, clear);
    return { x, y, w: W - x - Math.max(bleedPx, clear), h: H - y - Math.max(bleedPx + footerH, clear) };
  }
  function computeDefaultPlacements(items, opts) {
    if (items.length <= 1) return gridPlacements(items, opts);
    const W = opts.width, H = opts.height;
    const bleedPx = (opts.bleed || 0) * Math.min(W, H);
    const titleSize = Math.round(W * 0.045);
    const handleSize = Math.round(W * 0.026);
    const hasTitle  = !!(opts.title  && opts.title.length);
    const hasHandle = !!(opts.handle && opts.handle.length);
    const hasFooter = !!(opts.footer && opts.footer.length);
    const headerH = (hasTitle ? titleSize * 1.15 : 0) + (hasHandle ? handleSize * 1.8 : 0);
    // Fixed footer clearance — see usableRegion().
    const footerH = handleSize * 3.2;
    // designs sit close to the frame: only clear the bleed, header/footer and a hair of
    // breathing room from the corner marks
    const cornerClear = bleedPx + Math.round(Math.min(W, H) * 0.008);
    const usableX = Math.max(bleedPx, cornerClear);
    const usableY = Math.max(bleedPx + headerH, cornerClear);
    const usableW = W - usableX - Math.max(bleedPx, cornerClear);
    const usableH = H - usableY - Math.max(bleedPx + footerH, cornerClear);
    const gap = (typeof opts.gap === "number" ? opts.gap : 0.006) * Math.min(W, H);
    const rand = rng(opts.seed || 1);
    const band = computeCenterFooterBand(W, H, opts);

    const regions = [];
    if (band) {
      const topH = band.top - usableY, botH = (usableY + usableH) - band.bottom;
      if (topH > usableH * 0.18) regions.push({ x: usableX, y: usableY, w: usableW, h: topH });
      if (botH > usableH * 0.18) regions.push({ x: usableX, y: band.bottom, w: usableW, h: botH });
    }
    if (!regions.length) regions.push({ x: usableX, y: usableY, w: usableW, h: usableH });
    const nats = items.map((it, i) => {
      const n = naturalBox(it, i);
      return { i, baseW: n.w, baseH: n.h, mask: maskOf(it) };
    });
    const cap = regions.map(r => r.w * r.h);
    const sumCap = cap.reduce((a, b) => a + b, 0) || 1;
    const totalNat = nats.reduce((s, b) => s + b.baseW * b.baseH, 0) || 1;
    const buckets = regions.map(() => []);
    const assigned = regions.map(() => 0);
    nats.slice().sort((a, b) => (b.baseW * b.baseH) - (a.baseW * a.baseH)).forEach(b => {
      let pick = 0, bestDeficit = -Infinity;
      for (let k = 0; k < regions.length; k++) {
        const deficit = cap[k] / sumCap - assigned[k] / totalNat;
        if (deficit > bestDeficit) { bestDeficit = deficit; pick = k; }
      }
      buckets[pick].push(b); assigned[pick] += b.baseW * b.baseH;
    });
    const out = new Array(items.length);
    regions.forEach((r, k) => {
      const res = packSilhouetteRegion(buckets[k], r, gap);
      if (res) res.forEach(p => {
        out[p.i] = { cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot || 0, scale: 1, baseW: p.w, baseH: p.h };
      });
    });
    for (let i = 0; i < out.length; i++) if (!out[i]) return gridPlacements(items, opts);
    return out;
  }

  function gridPlacements(items, opts) {
    const W = opts.width, H = opts.height;
    const bleedPx = (opts.bleed || 0) * Math.min(W, H);
    const titleSize = Math.round(W * 0.045);
    const handleSize = Math.round(W * 0.026);
    const hasTitle  = !!(opts.title  && opts.title.length);
    const hasHandle = !!(opts.handle && opts.handle.length);
    const hasFooter = !!(opts.footer && opts.footer.length);
    const headerH = (hasTitle ? titleSize * 1.15 : 0) + (hasHandle ? handleSize * 1.8 : 0);
    // Fixed footer clearance — see usableRegion().
    const footerH = handleSize * 3.2;
    // Keep designs clear of the corner marks (see drawOrnamentCorners: margin + len from each edge)
    const cornerClear = bleedPx + Math.round(Math.min(W, H) * 0.008);
    const usableX = Math.max(bleedPx, cornerClear);
    const usableY = Math.max(bleedPx + headerH, cornerClear);
    const usableW = W - usableX - Math.max(bleedPx, cornerClear);
    const usableH = H - usableY - Math.max(bleedPx + footerH, cornerClear);
    const cells = TIGHT_CELLS[items.length] || gridCells(items.length || 1);
    const rand = rng(opts.seed || 1);
    const gap = (typeof opts.gap === "number" ? opts.gap : 0.006) * Math.min(W, H);
    const band = computeCenterFooterBand(W, H, opts);

    return items.map((it, i) => {
      const cell = cells[i];
      const cellX = usableX + cell.x * usableW;
      const cellY = usableY + cell.y * usableH;
      const cellW = cell.w * usableW;
      const cellH = cell.h * usableH;
      const innerW = cellW - gap * 2;
      const innerH = cellH - gap * 2;
      const ar = it.w / it.h;
      let w, h;
      if (innerW / innerH > ar) { h = innerH; w = h * ar; }
      else { w = innerW; h = w / ar; }
      let cx = cellX + cellW / 2;
      let cy = cellY + cellH / 2;
      let rot = 0;
      if (opts.layout === "scatter") {
        rot = (rand() - 0.5) * 14;
        w *= 0.92; h *= 0.92;
      }
      // Keep clear of a centered footer block: push the piece to whichever
      // side of the band it's already closer to, shrinking only if it must.
      if (band) {
        const top = cy - h / 2, bottom = cy + h / 2;
        if (bottom > band.top && top < band.bottom) {
          if (cy < H / 2) {
            const minTop = usableY;
            let newH = h, newTop = band.top - newH;
            if (newTop < minTop) { newH = band.top - minTop; newTop = minTop; }
            const s = Math.max(0.1, newH / h);
            w *= s; h = newH; cy = newTop + h / 2;
          } else {
            const maxBottom = usableY + usableH;
            let newH = h, newBottom = band.bottom + newH;
            if (newBottom > maxBottom) { newH = maxBottom - band.bottom; newBottom = maxBottom; }
            const s = Math.max(0.1, newH / h);
            w *= s; h = newH; cy = newBottom - h / 2;
          }
        }
      }
      return { cx, cy, w, h, rot, scale: 1, baseW: w, baseH: h };
    });
  }

  // Reserves a horizontal exclusion band around H/2 when the footer is set to
  // "center", so designs and stamps can be routed around it instead of covering it.
  function computeCenterFooterBand(W, H, opts) {
    if (opts.footerPos !== "center" || !opts.footer || !opts.footer.length) return null;
    const footerSize = Math.round(W * 0.016 * (opts.footerSize || 1));
    const hasFooterTitle = !!(opts.footerTitle && opts.footerTitle.length);
    const footerTitleSize = Math.round(footerSize * 1.7);
    const lineCount = opts.footer.trim().split(" ").length > 1 ? 2 : 1;
    const lineH = footerSize * 1.5;
    const titleGap = hasFooterTitle ? footerTitleSize * 1.5 : 0;
    const blockH = lineCount * lineH + (hasFooterTitle ? footerTitleSize + titleGap : 0);
    const pad = footerSize * 1.6;
    return { top: H / 2 - blockH / 2 - pad, bottom: H / 2 + blockH / 2 + pad };
  }

  // ============ IMAGE CACHE ============
  const imgCache = new Map();
  function loadImage(url) {
    if (imgCache.has(url)) return Promise.resolve(imgCache.get(url));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { imgCache.set(url, img); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ============ ORNAMENT IMAGE ============
  let _ornamentImg = null;
  const _ornamentSrc = "uploads/download (8).jpg";
  function loadOrnament() {
    if (_ornamentImg) return Promise.resolve(_ornamentImg);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { _ornamentImg = img; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = _ornamentSrc;
    });
  }

  // ============ HELPERS ============
  function drawSpacedText(ctx, text, cx, cy, spaceEm, halo) {
    const chars = text.split("");
    const widths = chars.map(c => ctx.measureText(c).width);
    const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
    const fontSize = m ? parseFloat(m[1]) : 12;
    const space = fontSize * spaceEm;
    const total = widths.reduce((a, b) => a + b, 0) + space * (chars.length - 1);
    let x = cx - total / 2;
    const prev = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < chars.length; i++) {
      if (halo) ctx.strokeText(chars[i], x, cy);
      ctx.fillText(chars[i], x, cy);
      x += widths[i] + space;
    }
    ctx.textAlign = prev;
    return total;
  }
  function drawCorner(ctx, x, y, sx, sy, style) {
    style = style || "ornament";
    if (style === "none") return;
    // "ornament" is the only style now — drawn from the loaded ornament image
    // (handled async in renderCollage). This function is a no-op for ornament.
    // Kept for API compatibility.
  }
  // Corner marks — simple L-shaped lines at each corner (called from renderCollage)
  async function drawOrnamentCorners(ctx, W, H, bleedPx, style, cornerColorName, opts) {
    if (style === "none") return;
    const margin = bleedPx + Math.round(Math.min(W, H) * 0.035);
    const len = Math.round(Math.min(W, H) * 0.08);
    ctx.save();
    const dc = resolveDecor(cornerColorName || "black", opts || {});
    ctx.strokeStyle = dc.fill;
    ctx.globalAlpha = dc.alpha;
    ctx.globalCompositeOperation = dc.comp;
    ctx.lineWidth = 1;
    const corners = [
      [margin, margin, 1, 1],           // top-left
      [W - margin, margin, -1, 1],      // top-right
      [margin, H - margin, 1, -1],      // bottom-left
      [W - margin, H - margin, -1, -1], // bottom-right
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + len * dy);
      ctx.lineTo(x, y);
      ctx.lineTo(x + len * dx, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ============ ETIQUETAS DE CM ============
  // Los "N CM" debajo de cada diseño. Guarda además dónde ha quedado cada uno
  // en `canvas._sizeLabelPositions`, que es lo que usa el doble clic para
  // editar la medida. Trabaja en unidades lógicas (sin escalar).
  function drawSizeLabels(canvas, ctx, items, placements, opts, W, H) {
    const sizeLabelPositions = [];
    if (opts.showSizes) {
      const labelSize = Math.round(W * (items.length <= 1 ? 0.034 : 0.019));
      ctx.save();
      ctx.fillStyle = opts.brandPrimary || "#ff3d5c";
      ctx.strokeStyle = opts.paper && opts.paper !== "transparent" ? opts.paper : "#d9d4c8";
      ctx.lineWidth = Math.max(2, labelSize * 0.22);
      ctx.lineJoin = "round";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = fontStr("helvExt", labelSize);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const p = placements[i];
        if (!p) continue;
        const cm = it.sizeCm != null ? it.sizeCm : 10;
        if (!(cm > 0)) continue;
        // Use the ROTATED bounding box so the label always sits below the true
        // silhouette — otherwise a rotated design overlaps its own CM tag.
        const rot = (p.rot || 0) * Math.PI / 180;
        const rotH = Math.abs(p.w * Math.sin(rot)) + Math.abs(p.h * Math.cos(rot));
        // Enforce a minimum 0.5 cm gap between the design edge and the top of
        // the label (in real physical units).
        const pxPerCm = Math.max(p.w, p.h) / cm;
        const gapPx = labelSize * 0.8 + 0.5 * pxPerCm;
        const yy = Math.min(H - labelSize * 0.6, p.cy + rotH / 2 + gapPx);
        drawSpacedText(ctx, cm + " CM", p.cx, yy, 0.14, true);
        const textW = ctx.measureText(cm + " CM").width * 1.4;
        sizeLabelPositions.push({ idx: i, id: it.id, cx: p.cx, cy: yy, w: textW, h: labelSize * 1.4, cm });
      }
      ctx.restore();
    }
    // Expose for click-to-edit
    canvas._sizeLabelPositions = sizeLabelPositions;
  }
  // Versión para quien pinta por su cuenta (la previa en modo sticker): se
  // encarga ella de la escala y del contexto.
  function pintarEtiquetasCm(canvas, items, placements, opts) {
    const rs = (opts && opts.renderScale) || 1;
    const ctx = canvas.getContext("2d");
    const W = Math.round(canvas.width / rs), H = Math.round(canvas.height / rs);
    ctx.save();
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    drawSizeLabels(canvas, ctx, items, placements || [], opts || {}, W, H);
    ctx.restore();
  }

  // ============ RENDER ============
  async function renderCollage(canvas, items, opts) {
    // renderScale < 1 => backing store smaller than the design ("logical") size.
    // All drawing below stays in logical units; iOS just has far less canvas
    // memory to hold (oversized canvases there render black).
    const rs = opts.renderScale || 1;
    const W = Math.round(canvas.width / rs), H = Math.round(canvas.height / rs);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Paper from cache (at device resolution). opts.paper === "transparent"
    // (or null) leaves the canvas transparent — used by the sticker-sheet
    // export so only the stickers themselves float on transparency.
    if (opts.paper !== "transparent" && opts.paper != null) {
      ctx.drawImage(getPaperLayer(canvas.width, canvas.height, opts.paper, opts.seed || 1), 0, 0);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    if (opts.bgPhoto) {
      const bg = await loadBgPhoto();
      if (bg) {
        // cover-fit: scale to fill W×H, cropping whichever axis overflows
        const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight);
        const dw = bg.naturalWidth * s, dh = bg.naturalHeight * s;
        const dx = (W - dw) / 2, dy = (H - dh) / 2;
        ctx.save();
        ctx.globalAlpha = opts.bgPhotoOpacity != null ? opts.bgPhotoOpacity : 1;
        ctx.drawImage(bg, dx, dy, dw, dh);
        // lighten wash: pulls the photo back toward the paper tone
        const light = opts.bgPhotoLight != null ? opts.bgPhotoLight : 0;
        if (light > 0) {
          ctx.globalAlpha = light * 0.75;
          ctx.fillStyle = opts.paper || "#d4cbc0";
          ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();
      }
    }
    await ensureFonts([opts.titleFont, opts.handleFont, opts.stampFont].filter(Boolean));

    const titleSize  = Math.round(W * 0.045);
    const handleSize = Math.round(W * 0.026);
    const bleedPx    = (opts.bleed || 0) * Math.min(W, H);
    const hasTitle   = !!(opts.title  && opts.title.length);
    const hasHandle  = !!(opts.handle && opts.handle.length);
    const hasFooter  = !!(opts.footer && opts.footer.length);

    // Items
    const imgs = await Promise.all(items.map(it => loadImage(it.layerUrl)));
    const placements = opts.placements || [];
    const shadowAmt  = opts.shadow != null ? opts.shadow : 0.35;
    const order      = opts.order || items.map((_, i) => i);

    // opts.xorOverlap: draw the designs into their own layer with XOR between them,
    // so where two pieces cross the overlap drops out (reads as a negative) while
    // everything that doesn't cross stays solid ink.
    const artLayer = opts.xorOverlap ? document.createElement("canvas") : null;
    let actx = ctx;
    if (artLayer) {
      artLayer.width = Math.round(W * rs); artLayer.height = Math.round(H * rs);
      actx = artLayer.getContext("2d");
      if (rs !== 1) actx.setTransform(rs, 0, 0, rs, 0, 0);
    }
    for (const idx of order) {
      const img = imgs[idx];
      const p   = placements[idx];
      if (!p) continue;
      const ctx = actx;
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate((p.rot || 0) * Math.PI / 180);
      // Espejo: se voltea sobre su propio centro y DESPUÉS de girar, para que
      // girar y espejar se puedan combinar sin que uno deshaga al otro. La
      // sombra va con la misma transformación, así que acompaña sola.
      if (p.espejo) ctx.scale(-1, 1);
      if (shadowAmt > 0) {
        ctx.shadowColor = `rgba(0,0,0,${shadowAmt * 0.55})`;
        ctx.shadowBlur = Math.round(W * 0.012);
        ctx.shadowOffsetX = Math.round(W * 0.003);
        ctx.shadowOffsetY = Math.round(W * 0.005);
      }
      // draw only the artwork's opaque region, so the placement box IS the silhouette
      const t = trimOf(items[idx]);
      ctx.globalCompositeOperation = artLayer ? "xor" : "multiply";
      ctx.drawImage(img, t.x * img.width, t.y * img.height, t.w * img.width, t.h * img.height,
        -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (artLayer) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(artLayer, 0, 0);
      ctx.restore();
      if (rs !== 1) ctx.setTransform(rs, 0, 0, rs, 0, 0);
      artLayer.width = artLayer.height = 1;
    }

    // Size labels (approx max tattoo size in cm). Vive fuera de renderCollage
    // porque el modo sticker de la previa no pasa por aquí y también las
    // necesita: si no, marcar «mostrar cm» no hacía nada en ese modo.
    drawSizeLabels(canvas, ctx, items, placements, opts, W, H);

    // Stamps
    const stamps = Math.max(0, Math.min(8, opts.stamps | 0));
    if (stamps > 0) {
      const stampText = (opts.stampText && opts.stampText.length) ? opts.stampText : (opts.title || "KAOS.REALM");
      const stampSize = Math.round((opts.stampSize || 1) * W * 0.022);
      const stampOp = opts.stampOpacity != null ? opts.stampOpacity : 0.8;
      const slots = [
        { x: 0.85, y: 0.22 }, { x: 0.16, y: 0.50 },
        { x: 0.84, y: 0.55 }, { x: 0.16, y: 0.28 },
        { x: 0.50, y: 0.95 }, { x: 0.15, y: 0.85 },
        { x: 0.86, y: 0.86 }, { x: 0.50, y: 0.15 },
        { x: 0.90, y: 0.08 }, { x: 0.10, y: 0.08 },
        { x: 0.08, y: 0.65 }, { x: 0.92, y: 0.70 },
        { x: 0.30, y: 0.92 }, { x: 0.70, y: 0.92 },
        { x: 0.06, y: 0.40 }, { x: 0.94, y: 0.40 },
      ];
      const rand = rng((opts.seed || 1) + 999);
      const shuffled = slots.slice().sort(() => rand() - 0.5);
      const footerBand = computeCenterFooterBand(W, H, opts);
      ctx.globalAlpha = stampOp;
      const _sdc = resolveDecor(opts.stampColor || "black", opts);
      ctx.fillStyle = _sdc.fill;
      ctx.globalAlpha = stampOp * _sdc.alpha;
      ctx.globalCompositeOperation = _sdc.comp;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = fontStr(opts.stampFont || opts.titleFont || "gothic", stampSize);
      const stampTextW = ctx.measureText(stampText).width;
      // Half-extent of the stamp's rotated bbox (used both to keep it fully on-canvas and to test overlap)
      const stampHalf = Math.max(stampTextW, stampSize) * 0.62;
      const safeMinX = bleedPx + stampHalf, safeMaxX = W - bleedPx - stampHalf;
      const safeMinY = bleedPx + stampHalf, safeMaxY = H - bleedPx - stampHalf;
      // Per-image alpha masks (small, cached) so overlap respects the PNG's actual silhouette, not its full square
      const maskSize = 40;
      const alphaMasks = imgs.map((img) => {
        if (!img) return null;
        try {
          const c = document.createElement("canvas");
          c.width = maskSize; c.height = maskSize;
          const mctx = c.getContext("2d", { willReadFrequently: true });
          mctx.clearRect(0, 0, maskSize, maskSize);
          mctx.drawImage(img, 0, 0, maskSize, maskSize);
          return mctx.getImageData(0, 0, maskSize, maskSize).data;
        } catch (e) { return null; }
      });
      const sampleAlpha = (idx, wx, wy) => {
        const mask = alphaMasks[idx];
        const p = placements[idx];
        if (!mask || !p) return 255; // no mask data — assume opaque (safe fallback)
        const rad = -((p.rot || 0) * Math.PI / 180);
        const dx = wx - p.cx, dy = wy - p.cy;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        const u = (lx + p.w / 2) / p.w, v = (ly + p.h / 2) / p.h;
        if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
        const mx = Math.min(maskSize - 1, Math.floor(u * maskSize));
        const my = Math.min(maskSize - 1, Math.floor(v * maskSize));
        return mask[(my * maskSize + mx) * 4 + 3];
      };
      const ALPHA_THRESH = 24;
      const overlapsArt = (cx, cy, rot) => {
        const rad = rot * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const pts = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([ux, uy]) => {
          const lx = ux * stampHalf, ly = uy * (stampSize * 0.6);
          return [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
        });
        for (let idx = 0; idx < placements.length; idx++) {
          if (!placements[idx]) continue;
          for (const [wx, wy] of pts) {
            if (sampleAlpha(idx, wx, wy) > ALPHA_THRESH) return true;
          }
        }
        return false;
      };
      let placed = 0;
      for (let i = 0; i < shuffled.length && placed < stamps; i++) {
        const s = shuffled[i];
        const cx = Math.min(safeMaxX, Math.max(safeMinX, s.x * W));
        const cy = Math.min(safeMaxY, Math.max(safeMinY, s.y * H));
        if (footerBand && cy + stampHalf * 0.5 > footerBand.top && cy - stampHalf * 0.5 < footerBand.bottom) continue;
        const rot = (rand() - 0.5) * 28;
        if (overlapsArt(cx, cy, rot)) continue;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot * Math.PI / 180);
        ctx.fillText(stampText, 0, 0);
        ctx.restore();
        placed++;
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // Header
    // `cajasTexto` es opcional: si quien llama pasa un objeto, se le anota
    // dónde ha caído cada texto (en unidades de diseño) para poder pincharlo
    // en la previa. Se apunta AL PINTAR, no en una cuenta aparte: dos cuentas
    // separadas acaban descuadradas en cuanto cambie una tipografía. Es lo
    // mismo que hace `piezas._cajas` en el reel.
    const cajasTexto = opts.cajasTexto || null;
    // Un poco de aire alrededor: la caja ceñida al píxel es incómoda de acertar
    // con el dedo en el iPad.
    const cajaDe = (cx, yBase, ancho, alto) => ({
      x: cx, y: yBase - alto * 0.35, w: ancho + 24, h: alto * 1.35, rot: 0, tam: alto,
    });
    if (hasTitle) {
      ctx.save();
      applyDecor(ctx, resolveDecor(opts.titleColor || "black", opts));
      ctx.font = fontStr(opts.titleFont || "gothic", titleSize);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const yT = bleedPx + titleSize;
      ctx.fillText(opts.title, W / 2, yT);
      if (cajasTexto) cajasTexto.title = cajaDe(W / 2, yT, ctx.measureText(opts.title).width, titleSize);
      ctx.restore();
    }
    if (hasHandle) {
      ctx.save();
      applyDecor(ctx, resolveDecor(opts.handleColor || "black", opts));
      ctx.font = fontStr(opts.handleFont || "mono", handleSize);
      const y = bleedPx + (hasTitle ? titleSize * 1.20 : 0) + handleSize;
      const anchoH = drawSpacedText(ctx, opts.handle, W / 2, y, 0.30);
      if (cajasTexto) cajasTexto.handle = cajaDe(W / 2, y, anchoH, handleSize);
      ctx.restore();
    }
    // Footer — centered, forced onto two rows; size and position (bottom/center/top) are tweakable,
    // plus an optional small all-caps footer title sitting above it.
    const footerAtTop = (opts.footerPos === "top");
    const footerAtCenter = (opts.footerPos === "center");
    if (hasFooter) {
      ctx.save();
      applyDecor(ctx, resolveDecor(opts.footerColor || "black", opts));
      const footerSize = Math.round(W * 0.016 * (opts.footerSize || 1));
      const hasFooterTitle = !!(opts.footerTitle && opts.footerTitle.length);
      const footerTitleSize = Math.round(footerSize * 1.7);
      ctx.font = fontStr(opts.handleFont || "mono", footerSize);
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      // Split into two balanced rows (break near the middle word, on a space)
      const words = opts.footer.split(" ");
      let lines;
      if (words.length > 1) {
        let bestI = 1, bestDiff = Infinity;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(" ").length;
          const b = words.slice(i).join(" ").length;
          const diff = Math.abs(a - b);
          if (diff < bestDiff) { bestDiff = diff; bestI = i; }
        }
        lines = [words.slice(0, bestI).join(" "), words.slice(bestI).join(" ")];
      } else {
        lines = [opts.footer];
      }
      const lineH = footerSize * 1.5;
      const titleGap = hasFooterTitle ? footerTitleSize * 1.5 : 0;
      let startY;
      if (footerAtTop) {
        startY = bleedPx + (hasTitle ? titleSize * 1.20 : 0) + (hasHandle ? handleSize * 1.6 : (hasTitle ? handleSize * 0.4 : 0)) + footerSize + titleGap;
      } else if (footerAtCenter) {
        startY = H / 2 - ((lines.length - 1) * lineH) / 2;
      } else {
        startY = H - bleedPx - footerSize * 0.5 - (lines.length - 1) * lineH;
      }
      if (hasFooterTitle) {
        ctx.font = fontStr(opts.titleFont || "gothic", footerTitleSize);
        ctx.fillText(opts.footerTitle.toUpperCase(), W / 2, startY - titleGap);
        if (cajasTexto) {
          cajasTexto.footerTitle = cajaDe(W / 2, startY - titleGap,
            ctx.measureText(opts.footerTitle.toUpperCase()).width, footerTitleSize);
        }
        ctx.font = fontStr(opts.handleFont || "mono", footerSize);
      }
      let anchoPie = 0;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], W / 2, startY + i * lineH);
        anchoPie = Math.max(anchoPie, ctx.measureText(lines[i]).width);
      }
      if (cajasTexto) {
        // El pie va en dos renglones: la caja los abraza a los dos, porque para
        // ella es UN texto, no dos.
        const alto = footerSize + (lines.length - 1) * lineH;
        cajasTexto.footer = { x: W / 2, y: startY + ((lines.length - 1) * lineH) / 2 - footerSize * 0.35,
                              w: anchoPie + 24, h: alto * 1.35, rot: 0, tam: footerSize };
      }
      ctx.restore();
    }

    // Logo watermark — placed inline with the (bottom) footer text; stays near the bottom edge either way
    const logo = await loadLogo();
    if (logo) {
      const logoH = Math.round(W * 0.10);
      const logoW = Math.round(logoH * (logo.naturalWidth / logo.naturalHeight));
      const logoHandleSize = Math.round(handleSize * 0.45);
      const footerAtBottom = hasFooter && !footerAtTop && !footerAtCenter;
      const logoY = H - bleedPx - (footerAtBottom ? handleSize * 3.2 : handleSize * 1.2) - logoHandleSize * 1.9 - logoH;
      const logoDC = resolveDecor(opts.logoColor || "gray", opts);
      if (opts.logoColor && opts.logoColor !== "gray") {
        // Tint the logo: draw into a temp canvas then replace opaque pixels
        // with the target colour via source-in, preserving alpha edges.
        const tlc = document.createElement("canvas");
        tlc.width = logoW; tlc.height = logoH;
        const tctx = tlc.getContext("2d");
        tctx.drawImage(logo, 0, 0, logoW, logoH);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = logoDC.fill;
        tctx.fillRect(0, 0, logoW, logoH);
        ctx.save();
        ctx.globalAlpha = logoDC.alpha;
        ctx.globalCompositeOperation = logoDC.comp;
        ctx.drawImage(tlc, W / 2 - logoW / 2, logoY);
        ctx.restore();
        tlc.width = tlc.height = 1;
      } else {
        // "gray" (default): multiply + low alpha, matching the original look.
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.28;
        ctx.drawImage(logo, W / 2 - logoW / 2, logoY, logoW, logoH);
        ctx.restore();
      }
      ctx.save();
      applyDecor(ctx, resolveDecor(opts.watermarkColor || "gray", opts));
      ctx.font = fontStr("helvExt", logoHandleSize);
      drawSpacedText(ctx, "@KAOS.REALM", W / 2, logoY + logoH + logoHandleSize * 0.55, 0.24);
      ctx.restore();
    }

    // Corner ornaments (async image-based)
    const cs = opts.cornerStyle || "ornament";
    await drawOrnamentCorners(ctx, W, H, bleedPx, cs, opts.cornerColor, opts);

    // Selection chrome
    if (opts.selectedIndex != null && placements[opts.selectedIndex]) {
      const p = placements[opts.selectedIndex];
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate((p.rot || 0) * Math.PI / 180);
      ctx.strokeStyle = "#c9342a";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      const pad = 4;
      ctx.strokeRect(-p.w / 2 - pad, -p.h / 2 - pad, p.w + pad * 2, p.h + pad * 2);
      ctx.setLineDash([]);
      // corner dots
      ctx.fillStyle = "#c9342a";
      const dots = [
        [-p.w / 2 - pad, -p.h / 2 - pad],
        [ p.w / 2 + pad, -p.h / 2 - pad],
        [-p.w / 2 - pad,  p.h / 2 + pad],
        [ p.w / 2 + pad,  p.h / 2 + pad],
      ];
      for (const [x, y] of dots) {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  root.KAOS_GALLERY = {
    FONTS,
    ensureFonts,
    setBgPhoto, bgPhotoSrc, loadBgPhoto, FONDO_FLASH, FONDO_NEON, FONDOS_MARCA,
    pintarEtiquetasCm,
    ETIQUETAS, tags, tieneTag, toggleTag, conTag,
    load, loadRaw, save, add, remove, clear, count,
    // Promesa: se cumple cuando la galeria esta cargada de IndexedDB.
    listo: arrancar,
    setSize,
    listFolders, addFolder, renameFolder, removeFolder, setItemFolder,
    computeDefaultPlacements,
    relaxAround,
    nudgeAround,
    repackKeepSizes,
    repackKeepSizesSilhouette,
    usableRegion,
    measureInk,
    inkMeasured,
    trimOf,
    renderCollage,
    paintPaperSeeded,
    // Reconocer un diseño por su dibujo y no por su id: ver el comentario de
    // «huella», arriba.
    huellaDe, parecidas, buscarPorHuella, firmarPendientes,
  };

  // Se empieza a cargar en cuanto se lee el fichero, sin esperar a que nadie la
  // pida: asi la rejilla la encuentra ya puesta.
  arrancar();
  // Cuando la galería ya está en pie, se les calcula la huella a los diseños de
  // antes, sin prisa y por detrás. Va tras `requestIdleCallback` para que no
  // compita con la primera pintada, que es lo que ella está esperando ver.
  arrancar().then(() => {
    const luego = root.requestIdleCallback || ((f) => setTimeout(f, 1200));
    luego(() => { firmarPendientes().catch(() => {}); });
  }).catch(() => {});
})(window);
