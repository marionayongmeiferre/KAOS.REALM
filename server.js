#!/usr/bin/env node
/*
 * KAOS.REALM — local sync server
 * ------------------------------
 * Serves the app over HTTP and keeps one shared copy of the library on disk,
 * so the PC and the iPad see the same gallery, sheets and asset pieces.
 *
 *   node server.js            -> http://localhost:8787
 *   node server.js --port 9000
 *
 * Reach it from the iPad over Tailscale: with both devices on your tailnet,
 * open  http://<this-machine's-tailscale-name>:8787  in Safari.
 * `tailscale status` prints the name. No port forwarding, no extra account.
 *
 * On-disk layout (created on first run, sits next to this file):
 *   .data/state.json          gallery + sheets + asset metadata
 *   .data/assets/<id>.<ext>   the asset blobs themselves
 *
 * Storage model: last-write-wins per record id, merged by timestamp. Two
 * devices editing the SAME record inside the same millisecond can clobber
 * each other; anything else merges cleanly.
 */

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const url = require("url");
const os = require("os");

const ROOT = __dirname;
const DATA = path.join(ROOT, ".data");
const ASSET_DIR = path.join(DATA, "assets");
const STATE = path.join(DATA, "state.json");

const argv = process.argv.slice(2);
const portArg = argv.indexOf("--port");
const PORT = portArg >= 0 ? parseInt(argv[portArg + 1], 10) : 8787;

// ---- POST EDIT (AI_TATTOO_POST_EDIT) -------------------------------------
// El recorte de fondo lo hace rembg, una red neuronal de 470 MB que sólo corre
// en Python. En vez de reescribir sus 1300 líneas de interfaz —y arriesgarse a
// perder profundidad, neón y los gizmos, que ya funcionan— ese servidor sigue
// vivo en su puerto y aquí se le reenvían las peticiones tal cual. Desde el
// navegador todo sale de una sola dirección: la de este servidor.
//
// Las rutas de las dos apps no se pisan; se comprobó una por una:
//   este servidor  /api/state  /api/sync  /api/usage  /api/asset/…
//   Python         /api/cutout /api/smooth /api/piel /api/projects /api/export
//                  /api/backgrounds /api/logo /static/… /assets/…
const pyPortArg = argv.indexOf("--postedit-port");
const PY_PORT = pyPortArg >= 0 ? parseInt(argv[pyPortArg + 1], 10) : 8765;
const PY_PREFIXES = [
  "/static/", "/assets/",
  "/api/backgrounds", "/api/logo", "/api/cutout", "/api/smooth",
  // /api/piel: los arreglos de piel (rojez, manchas de calco, reflejos).
  // Comprobado que no choca con las de aqui: /api/state, /api/sync,
  // /api/usage y /api/asset/.
  "/api/piel",
  "/api/projects", "/api/export",
];
const isPostEdit = (p) => PY_PREFIXES.some((x) => p === x || p.startsWith(x));
const MAX_BODY = 64 * 1024 * 1024; // 64 MB — a full-res sheet PNG can be chunky

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".otf": "font/otf", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const EXT_FOR = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg",
  "image/webp": ".webp", "image/gif": ".gif",
};

// ---------------------------------------------------------------- state ----
const EMPTY = { v: 2, ts: 0, gallery: [], sheets: [], assets: [] };
let writing = Promise.resolve();

async function readState() {
  try { return Object.assign({}, EMPTY, JSON.parse(await fsp.readFile(STATE, "utf8"))); }
  catch (e) { return Object.assign({}, EMPTY); }
}
// Serialised + atomic: concurrent syncs queue up, and a crash mid-write can
// never leave a half-written state.json behind.
function writeState(next) {
  writing = writing.then(async () => {
    const tmp = STATE + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(next));
    await fsp.rename(tmp, STATE);
  }).catch((e) => console.error("state write failed:", e.message));
  return writing;
}

// Merge by id, newest wins. Used for all three collections.
//
// `ts` is when the record was BORN; `mts` (optional) is when it was last
// TOUCHED — a size edit, a folder move, a deletion. The winner is decided by
// whichever is later, so an edited record beats an untouched copy of itself
// without its creation date moving and reshuffling the gallery.
const stamp = (r) => Math.max((r && r.ts) || 0, (r && r.mts) || 0);
function mergeById(mine, theirs, cap) {
  const m = new Map();
  for (const row of mine || []) if (row && row.id) m.set(row.id, row);
  for (const row of theirs || []) {
    if (!row || !row.id) continue;
    const cur = m.get(row.id);
    if (!cur || stamp(row) >= stamp(cur)) m.set(row.id, row);
  }
  const out = Array.from(m.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return cap ? out.slice(0, cap) : out;
}

// ---------------------------------------------------------------- utils ----
function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ "Cache-Control": "no-store" }, headers || {}));
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { "Content-Type": MIME[".json"] });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > (limit || MAX_BODY)) { reject(new Error("payload too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
// Assets are addressed by id only; never let a client-supplied string escape
// the assets directory.
function safeAssetPath(name) {
  const base = path.basename(String(name));
  if (!/^[A-Za-z0-9._-]+$/.test(base)) return null;
  const p = path.join(ASSET_DIR, base);
  return p.startsWith(ASSET_DIR + path.sep) ? p : null;
}

// ------------------------------------------------------------- handlers ----
async function handleAPI(req, res, pathname) {
  // GET /api/state — everything except asset bytes
  if (pathname === "/api/state" && req.method === "GET") {
    return sendJSON(res, 200, await readState());
  }

  // POST /api/sync — client sends its state, server merges, returns the union.
  // Both sides end up identical in one round trip.
  if (pathname === "/api/sync" && req.method === "POST") {
    let incoming;
    try { incoming = JSON.parse((await readBody(req)).toString("utf8")); }
    catch (e) { return sendJSON(res, 400, { error: "cuerpo JSON no valido" }); }

    const mine = await readState();
    const merged = {
      v: 2,
      ts: Date.now(),
      gallery: mergeById(mine.gallery, incoming.gallery),
      sheets: mergeById(mine.sheets, incoming.sheets, 20),
      assets: mergeById(mine.assets, incoming.assets),
    };
    await writeState(merged);

    // A tombstone that won the merge means the bytes on disk are now garbage.
    // Try every known extension rather than trusting the tombstone's `type`:
    // older clients dropped that field, and a stale blob left behind would be
    // served again to any device that later asked for this id.
    const EXTS = Object.values(EXT_FOR);
    for (const a of merged.assets) {
      if (!a.deleted) continue;
      for (const ext of EXTS) {
        const f = safeAssetPath(a.id + ext);
        if (f) await fsp.unlink(f).catch(() => {});
      }
    }

    // Tell the client which asset blobs the server is still missing, so it
    // uploads only those instead of re-sending the whole library every time.
    // Tombstones are skipped — nobody should upload bytes for a deleted piece.
    const have = new Set(await fsp.readdir(ASSET_DIR).catch(() => []));
    const missing = merged.assets
      .filter(a => !a.deleted)
      .filter(a => !have.has(a.id + (EXT_FOR[a.type] || ".png")))
      .map(a => a.id);
    return sendJSON(res, 200, Object.assign({ missingAssets: missing }, merged));
  }

  // POST /api/usage — el registro de interaccion, para poder rehacer la interfaz
  // con pruebas y no a ojo.
  //
  // Se FUNDE con lo que ya hay, no se reemplaza. Antes se sobrescribia entero,
  // dando por hecho que el navegador siempre trae la lista completa. Falso: un
  // navegador distinto, una ventana de incognito o una prueba automatica llegan
  // con la lista vacia y se llevaban por delante meses de registro. Paso el
  // 26-08-2026 con 1849 pulsaciones. Funde por marca de tiempo + control.
  if (pathname === "/api/usage" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString("utf8")); }
    catch (e) { return sendJSON(res, 400, { error: "cuerpo JSON no valido" }); }

    let viejos = [];
    try {
      const prev = JSON.parse(await fsp.readFile(path.join(DATA, "usage.json"), "utf8"));
      if (Array.isArray(prev.events)) viejos = prev.events;
    } catch (e) { /* no habia fichero todavia */ }

    const nuevos = Array.isArray(body.events) ? body.events : [];
    const porClave = new Map();
    for (const ev of viejos.concat(nuevos)) {
      if (!ev || typeof ev.t !== "number") continue;
      porClave.set(ev.t + "|" + ev.id, ev);       // el mismo evento no entra dos veces
    }
    const todos = Array.from(porClave.values()).sort((a, b) => a.t - b.t).slice(-6000);
    const salida = { updated: Date.now(), events: todos };

    const tmp = path.join(DATA, "usage.json.tmp");
    await fsp.writeFile(tmp, JSON.stringify(salida));
    await fsp.rename(tmp, path.join(DATA, "usage.json"));
    return sendJSON(res, 200, { ok: true, events: todos.length });
  }

  // GET / PUT / DELETE  /api/asset/<id>
  const m = pathname.match(/^\/api\/asset\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const state = await readState();
    const row = state.assets.find(a => a.id === id);
    const ext = EXT_FOR[(row && row.type) || "image/png"] || ".png";
    const file = safeAssetPath(id + ext);
    if (!file) return sendJSON(res, 400, { error: "id no valido" });

    if (req.method === "PUT") {
      await fsp.mkdir(ASSET_DIR, { recursive: true });
      await fsp.writeFile(file, await readBody(req));
      return sendJSON(res, 200, { ok: true, id });
    }
    if (req.method === "GET") {
      try {
        const buf = await fsp.readFile(file);
        return send(res, 200, buf, { "Content-Type": (row && row.type) || "image/png" });
      } catch (e) { return sendJSON(res, 404, { error: "asset no encontrado" }); }
    }
    if (req.method === "DELETE") {
      await fsp.unlink(file).catch(() => {});
      const next = Object.assign({}, state, {
        ts: Date.now(),
        assets: state.assets.filter(a => a.id !== id),
      });
      await writeState(next);
      return sendJSON(res, 200, { ok: true });
    }
  }

  return sendJSON(res, 404, { error: "endpoint desconocido" });
}

// Reenvía la petición entera al servidor de Python y devuelve su respuesta tal
// cual. Se usa `pipe` en los dos sentidos en vez de leer el cuerpo en memoria:
// una foto de 20 MB no tiene por qué caber en RAM dos veces, y así la barra de
// progreso de la subida es real.
function proxyPostEdit(req, res) {
  const up = http.request({
    hostname: "127.0.0.1",
    port: PY_PORT,
    path: req.url,
    method: req.method,
    // El Host tiene que apuntar al destino real: si va el del navegador,
    // FastAPI arma mal las redirecciones (y `/` redirige a /static/index.html).
    headers: Object.assign({}, req.headers, { host: "127.0.0.1:" + PY_PORT }),
  }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });

  up.on("error", (e) => {
    console.error("POST EDIT no responde:", e.message);
    if (res.headersSent) return res.end();
    sendJSON(res, 502, {
      error: "El motor de retoque de fotos no está arrancado.",
      detalle: "Es el que recorta el fondo con IA y va aparte porque necesita Python. "
             + "Arráncalo con «Iniciar KAOS Auto Edit.bat» en AI_TATTOO_POST_EDIT, "
             + "o usa «Iniciar KAOS.bat», que abre los dos.",
      puerto: PY_PORT,
    });
  });

  req.pipe(up);
}

async function handleStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/KAOS Tattoo Transformer.html";
  const file = path.join(ROOT, decodeURIComponent(pathname));
  // Don't serve anything outside the project, nor the data dir itself.
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA)) {
    return send(res, 403, "403");
  }
  try {
    const buf = await fsp.readFile(file);
    return send(res, 200, buf, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
  } catch (e) {
    return send(res, 404, "404 - no encontrado: " + pathname);
  }
}

// --------------------------------------------------------------- server ----
(async () => {
  await fsp.mkdir(ASSET_DIR, { recursive: true });

  http.createServer(async (req, res) => {
    const pathname = url.parse(req.url).pathname;
    try {
      // El proxy va primero: sus rutas son un conjunto cerrado y comprobado,
      // así que no puede tragarse nada de este servidor por accidente.
      if (isPostEdit(pathname)) proxyPostEdit(req, res);
      else if (pathname.startsWith("/api/")) await handleAPI(req, res, pathname);
      else await handleStatic(req, res, pathname);
    } catch (e) {
      console.error(req.method, pathname, "->", e.message);
      if (!res.headersSent) sendJSON(res, 500, { error: e.message });
    }
  }).listen(PORT, "0.0.0.0", () => {
    const nets = os.networkInterfaces();
    const addrs = [];
    for (const list of Object.values(nets)) {
      for (const n of list || []) {
        if (n.family === "IPv4" && !n.internal) addrs.push(n.address);
      }
    }
    console.log("\n  KAOS.REALM sync server");
    console.log("  ----------------------");
    console.log("  este equipo   http://localhost:" + PORT);
    for (const a of addrs) {
      // Tailscale hands out addresses in 100.x.y.z
      const tag = a.startsWith("100.") ? "   <- Tailscale: usa esta desde el iPad" : "";
      console.log("  red           http://" + a + ":" + PORT + tag);
    }
    console.log("\n  datos en      " + DATA);
    console.log("  Ctrl+C para parar\n");
  });
})();
