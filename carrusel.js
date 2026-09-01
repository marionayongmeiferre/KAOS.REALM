// KAOS.REALM — CARRUSEL
//
// Monta un carrusel de Instagram (4:5, 1080x1350) a partir de plantillas.
//
// Lo que se ve en pantalla y lo que se exporta salen de la MISMA función de
// pintado, sólo que a distinto tamaño. Es a propósito: si la vista previa fuera
// HTML y la exportación canvas, acabarían separándose y publicaría algo que no
// es lo que vio.
//
// Reglas de marca aplicadas (AI_CONTENT_PLANNER/BRAND-BOOK.md):
//   · El verde lima es fijo y funcional: firma y texto en pantalla. No decora.
//   · El magenta está reservado a fotos reales de tatuaje con el neón detrás;
//     aquí sólo aparece en acentos finos (número, filete), nunca de titular a
//     pantalla completa sobre fondo plano.
//   · Tipografía Helvetica Neue LT Std 73 Bold Extended, mayúsculas.
(function (root) {
  "use strict";

  const KEY = "kaos.carrusel.v1";
  const W_REF = 1080, H_REF = 1350;          // 4:5, lo que pide Instagram

  // Una portada de reel no es 4:5: el reel es 9:16 y la carátula tiene que ir a
  // esa medida o Instagram la recorta por su cuenta. Por eso el formato viaja
  // en cada pieza, en vez de estar clavado en una constante.
  //
  // El dato importante de la de reel es el CUADRO DEL GRID: en el perfil no se
  // ve la carátula entera, se ve un cuadrado del centro. Todo lo que tenga que
  // reconocerse desde la cuadrícula —el logo, el titular— tiene que caer ahí
  // dentro. El brand book lo dice: hoy no tiene portadas de reel y usa el
  // fotograma que Instagram pilla al azar; si se hacen, que se reconozcan.
  const FORMATOS = {
    post: { nombre: "POST / CARRUSEL", W: 1080, H: 1350, recorte: null },
    reel: { nombre: "PORTADA DE REEL", W: 1080, H: 1920, recorte: 1 },
  };
  function medidas(carrusel) {
    return FORMATOS[(carrusel && carrusel.formato) || "post"] || FORMATOS.post;
  }

  const C = {
    negro: "#0a0908",
    grafito: "#4a4a48",
    lima: "#c8f51e",
    magenta: "#e8174f",
    hueso: "#ece6d7",
  };
  const FUENTE = '"Helvetica Neue LT Std 73 BEx", Impact, "Arial Black", sans-serif';
  // El salto de línea, sacado de su código: escribirlo a mano dentro de una
  // cadena es justo lo que se pierde al pasar el fichero por otras manos.
  const SALTO = String.fromCharCode(10);
  const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

  // ------------------------------------------------------------- almacén ----
  function cargar() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { console.warn("carrusel: no se pudo leer", e); return []; }
  }
  function guardar(lista) {
    try { localStorage.setItem(KEY, JSON.stringify(lista)); return true; }
    catch (e) { console.warn("carrusel: no cabe en el disco del navegador", e); return false; }
  }
  // Mismo criterio que la galería: `ts` se mueve al tocar (es lo que el
  // servidor sabe comparar) y `bts` guarda el nacimiento para el orden.
  function tocar(c) {
    if (!c) return c;
    if (c.bts == null) c.bts = c.ts || Date.now();
    c.ts = Date.now();
    c.mts = c.ts;
    return c;
  }
  function nacimiento(c) { return (c && c.bts) || (c && c.ts) || 0; }
  function lista() { return cargar().sort((a, b) => nacimiento(b) - nacimiento(a)); }

  function obtener(id) { return cargar().find((c) => c.id === id) || null; }
  // Devuelve el carrusel, y en c._noCabe deja aviso de que NO se pudo guardar.
  //
  // Antes esto se tragaba el fallo: si el navegador decía que no cabía, la
  // función devolvía el objeto igual y todo parecía normal, pero en el disco
  // seguía la versión vieja. Cambiabas el nombre y al volver estaba el de antes.
  function escribir(c) {
    const todos = cargar();
    const i = todos.findIndex((x) => x.id === c.id);
    tocar(c);
    if (i >= 0) todos[i] = c; else todos.unshift(c);
    c._noCabe = !guardar(todos);
    return c;
  }

  // Cuánto ocupa ya el almacén del navegador, en KB. Son 5 MB para TODA la
  // aplicación, galería incluida.
  function sitioUsadoKB() {
    let n = 0;
    try {
      for (const k in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, k)) n += (localStorage[k] || "").length;
      }
    } catch (e) { return -1; }
    return Math.round(n / 1024);
  }

  // Encoge una foto antes de guardarla.
  //
  // Una foto del móvil son 3024x4032 y, en base64, más de 1 MB. El almacén del
  // navegador son 5 MB para todo, así que una sola foto lo reventaba y se
  // perdían la foto Y el nombre del carrusel. La portada se publica a 1080 de
  // ancho: a 1600 sobra de largo y no se nota, y pasa de 1 MB a unos 200 KB.
  function encoger(dataUrl, maxLado) {
    const MAX = maxLado || 1600;
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        let w = im.naturalWidth, h = im.naturalHeight;
        if (w <= MAX && h <= MAX && dataUrl.length < 400000) return res(dataUrl);
        const e = Math.min(1, MAX / Math.max(w, h));
        w = Math.round(w * e); h = Math.round(h * e);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const x = c.getContext("2d");
        // Sobre negro: si la foto trae transparencia, el JPG la pondría blanca.
        x.fillStyle = C.negro; x.fillRect(0, 0, w, h);
        x.drawImage(im, 0, 0, w, h);
        res(c.toDataURL("image/jpeg", 0.85));
      };
      im.onerror = () => res(dataUrl);
      im.src = dataUrl;
    });
  }
  function borrar(id) {
    guardar(cargar().filter((c) => c.id !== id));
  }

  // ----------------------------------------------------------- plantillas ---
  // Los pilares salen del brand book, no me los invento: son los que la
  // diferencian como estudio.
  const PILARES = [
    { kicker: "EL AMBIENTE", titular: "LO ELIGES TÚ",
      cuerpo: "Hablo como una cotorra si quieres, o te dejo con tus cascos viendo una serie. Y la música siempre la eliges tú." },
    { kicker: "TU COMODIDAD", titular: "ES LA MÍA",
      cuerpo: "Pausas cuando quieras, parar a comer algo, lo que necesites. Dímelo en cualquier momento, sin sentir que interrumpes." },
    { kicker: "HORARIO", titular: "FLEXIBLE",
      cuerpo: "Si un domingo es tu único hueco libre, lo hablamos y miramos de cuadrarlo. Siempre se puede intentar." },
    { kicker: "RESUELVO", titular: "TODAS TUS DUDAS",
      cuerpo: "Tamaño, estilo, decisiones artísticas — lo que sea. Encantada de ayudarte a decidir, para eso estoy." },
    { kicker: "PROPÓN", titular: "TUS IDEAS",
      cuerpo: "Me adapto a tu estilo. Y si quieres cambiar algo de un diseño mío, adelante — no me ofende, al revés." },
    { kicker: "RETOQUE SI TU", titular: "PIEL LO NECESITA",
      cuerpo: "La cicatrización varía en cada persona, es normal. Y si pasa, va incluido, sin coste." },
  ];

  const PLANTILLAS = {
    confianza: {
      nombre: "Por qué tatuarte conmigo",
      pista: "Los 6 pilares del estudio. El carrusel que responde a «¿y por qué tú?».",
      construir() {
        const s = [{
          tipo: "portada", fondo: "negro",
          kicker: "GOLDEN CAT · BARCELONA",
          // Regla 3 del brand book: pregunta directa en el gancho. Es la
          // palanca más medida (mediana 270 likes contra 51).
          titular: "¿POR QUÉ TATUARTE CONMIGO?",
          cuerpo: "6 razones antes de escribirme por privado →",
          img: null,
        }];
        PILARES.forEach((p, i) => s.push({
          tipo: "pilar", fondo: i % 2 ? "negro" : "grafito",
          num: String(i + 1).padStart(2, "0"),
          kicker: p.kicker, titular: p.titular, cuerpo: p.cuerpo, img: null,
        }));
        s.push({
          tipo: "cierre", fondo: "negro",
          titular: "SI TE APETECE, HABLAMOS",
          cuerpo: "Sin compromiso. Escríbeme por privado.",
          img: null,
        });
        return s;
      },
    },
    disponibles: {
      nombre: "Diseños disponibles",
      pista: "Gancho primero y el catálogo después — la regla 5 prohíbe abrir directo a la hoja de flashes.",
      construir() {
        return [
          { tipo: "portada", fondo: "negro",
            kicker: "BUSCO LIENZOS",
            titular: "¿TE LLEVARÍAS ALGUNO DE ESTOS?",
            cuerpo: "Diseños que llevo semanas queriendo tatuar →", img: null },
          { tipo: "foto", fondo: "negro", frase: "ESTE ES MI FAVORITO", img: null },
          { tipo: "foto", fondo: "negro", frase: "", img: null },
          { tipo: "foto", fondo: "negro", frase: "", img: null },
          { tipo: "pilar", fondo: "grafito", num: "", kicker: "CONDICIONES",
            titular: "LO QUE INCLUYE",
            cuerpo: "Retoque gratis si tu piel lo necesita. Agua y café. La música la eliges tú.", img: null },
          { tipo: "cierre", fondo: "negro",
            titular: "DIME CUÁL Y TE PASO PRECIO",
            cuerpo: "Sin compromiso. Escríbeme por privado.", img: null },
        ];
      },
    },
    proceso: {
      nombre: "Cómo lo hice",
      pista: "Detrás de cámaras. La portada va sin logo, es la única pieza donde no aparece.",
      construir() {
        return [
          { tipo: "foto", fondo: "grafito", frase: "", img: null, sinFirma: true },
          { tipo: "pilar", fondo: "negro", num: "01", kicker: "LA IDEA",
            titular: "DE DÓNDE SALE", cuerpo: "", img: null },
          { tipo: "foto", fondo: "negro", frase: "", img: null },
          { tipo: "pilar", fondo: "grafito", num: "02", kicker: "EL PROCESO",
            titular: "CÓMO SE MONTA", cuerpo: "", img: null },
          { tipo: "foto", fondo: "negro", frase: "Y ASÍ DE CHULITO QUEDÓ, NENAS", img: null },
          { tipo: "cierre", fondo: "negro",
            titular: "¿TE APETECE UNO ASÍ?",
            cuerpo: "Escríbeme por privado.", img: null },
        ];
      },
    },
    // --------------------------------------------------------- portadas
    // Una sola imagen, misma estética que el carrusel. No es un carrusel de una
    // slide: es otra cosa con otro objetivo — que alguien pare de bajar.
    portada: {
      nombre: "Portada de post",
      pista: "Una sola imagen, 4:5. La cara del post en la cuadrícula.",
      formato: "post",
      construir() {
        return [{
          tipo: "portada", fondo: "negro",
          kicker: "GOLDEN CAT · BARCELONA",
          // Regla 3 del brand book: pregunta directa en el gancho, que es la
          // palanca más medida de su cuenta.
          titular: "¿QUÉ TE TATUARÍAS SI NO DOLIERA?",
          cuerpo: "", img: null,
        }];
      },
    },
    portadaReel: {
      nombre: "Portada de reel",
      pista: "Una sola imagen, 9:16, con el cuadro del grid marcado. Hoy tus reels no tienen carátula.",
      formato: "reel",
      construir() {
        return [{
          tipo: "portada", fondo: "negro",
          kicker: "",
          titular: "MIRA CÓMO QUEDÓ",
          cuerpo: "", img: null,
        }];
      },
    },
  };

  function crear(clave) {
    const p = PLANTILLAS[clave] || PLANTILLAS.confianza;
    const ahora = Date.now();
    return escribir({
      id: "c_" + ahora + "_" + ((Math.random() * 1e6) | 0),
      ts: ahora, bts: ahora, mts: ahora,
      plantilla: clave, titulo: p.nombre,
      formato: p.formato || "post",
      slides: p.construir(),
    });
  }

  // ------------------------------------------------------------- pintado ----
  // Todas las medidas van referidas al lienzo de 1080x1350 y se escalan con k,
  // así la vista previa pequeña es idéntica a la exportación.

  const cacheImg = new Map();
  function imagen(src) {
    if (!src) return Promise.resolve(null);
    if (cacheImg.has(src)) return cacheImg.get(src);
    const p = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
    cacheImg.set(src, p);
    return p;
  }

  function envolver(ctx, texto, maxW) {
    const lineas = [];
    for (const parrafo of String(texto || "").split("\n")) {
      let linea = "";
      for (const palabra of parrafo.split(/\s+/)) {
        if (!palabra) continue;
        const prueba = linea ? linea + " " + palabra : palabra;
        if (ctx.measureText(prueba).width > maxW && linea) { lineas.push(linea); linea = palabra; }
        else linea = prueba;
      }
      lineas.push(linea);
    }
    return lineas;
  }

  // Baja el cuerpo de letra hasta que el titular cabe en el ancho y en el
  // número de líneas permitido. Sin esto, un titular largo se sale del lienzo y
  // no lo ves hasta que ya has exportado.
  function encajar(ctx, texto, maxW, maxLineas, tamMax, tamMin, fuente) {
    for (let t = tamMax; t >= tamMin; t -= 2) {
      ctx.font = "700 " + t + "px " + fuente;
      const l = envolver(ctx, texto, maxW);
      if (l.length <= maxLineas) return { tam: t, lineas: l };
    }
    ctx.font = "700 " + tamMin + "px " + fuente;
    return { tam: tamMin, lineas: envolver(ctx, texto, maxW) };
  }

  function grano(ctx, W, H, fuerza) {
    const g = document.createElement("canvas");
    const n = 140;
    g.width = n; g.height = n;
    const gc = g.getContext("2d");
    const d = gc.createImageData(n, n);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    gc.putImageData(d, 0, 0);
    ctx.save();
    ctx.globalAlpha = fuerza == null ? 0.06 : fuerza;
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = ctx.createPattern(g, "repeat");
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function esquinas(ctx, k, W, H, color) {
    const m = 46 * k, l = 30 * k, g = 3 * k;
    ctx.strokeStyle = color; ctx.lineWidth = g; ctx.lineCap = "square";
    const dibuja = (x, y, sx, sy) => {
      ctx.beginPath();
      ctx.moveTo(x + sx * l, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * l);
      ctx.stroke();
    };
    dibuja(m, m, 1, 1);
    dibuja(W - m, m, -1, 1);
    dibuja(m, H - m, 1, -1);
    dibuja(W - m, H - m, -1, -1);
  }

  // Su logo es el lettering dibujado a mano, negro sobre transparente. Se tiñe
  // del color que toque y se guarda teñido: rehacerlo en cada repintado son
  // lienzos enteros tirados por nada.
  let logoImg = null, logoPromesa = null, logoTeñido = null, logoColor = "";
  function cargarLogo() {
    if (logoPromesa) return logoPromesa;
    logoPromesa = imagen("uploads/kaos_logo.PNG").then((im) => { logoImg = im; return im; });
    return logoPromesa;
  }
  function logoDe(color) {
    if (!logoImg) return null;
    if (logoTeñido && logoColor === color) return logoTeñido;
    const c = document.createElement("canvas");
    c.width = logoImg.naturalWidth; c.height = logoImg.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(logoImg, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    logoTeñido = c; logoColor = color;
    return c;
  }

  // La firma: el logo dibujado y, debajo y más pequeño, el arroba. Es la misma
  // jerarquía que en el reel — manda el dibujo, el @ dice dónde encontrarla.
  // El brand book pide el logo en verde lima; el arroba lo acompaña.
  function firmaCompleta(ctx, k, W, H, s, o) {
    const dx = (s.fx || 0) * W, dy = (s.fy || 0) * H;
    const der = W - 76 * k + dx;
    let y = H - 62 * k + dy;
    if (s.logo !== false) {
      const lg = logoDe(C.lima);
      if (lg) {
        // Proporcional al ALTO, como en el reel: si fuera al ancho, la portada
        // de reel (más alta) lo enseñaría más pequeño que la de post.
        //
        // Va al 6,2% del alto porque a 4% se perdía en la esquina. A este tamaño
        // el lettering se reconoce desde la cuadrícula del perfil, que es para
        // lo que está: el arroba de debajo es el pie, no la firma.
        const lh = Math.round(H * 0.062);
        const lw = Math.round(lh * (lg.width / lg.height));
        ctx.drawImage(lg, der - lw, y - lh - 26 * k, lw, lh);
      }
    }
    ctx.font = "700 " + Math.round(22 * k) + "px " + MONO;
    ctx.fillStyle = C.lima;
    ctx.globalAlpha = 0.85;
    ctx.textAlign = "right";
    ctx.fillText("@KAOS.REALM", der, y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    // Caja de la firma entera (logo + arroba), para poder agarrarla.
    const anchoF = Math.max(160 * k, ctx.measureText("@KAOS.REALM").width);
    const altoF = (s.logo !== false ? H * 0.062 + 26 * k : 0) + 30 * k;
    anotar(o, "firma", der - anchoF, y - altoF, anchoF, altoF + 12 * k);
  }

  // Dibuja la imagen recortada para cubrir el lienzo, sin deformarla.
  function cubrir(ctx, im, W, H) {
    const e = Math.max(W / im.width, H / im.height);
    const w = im.width * e, h = im.height * e;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }

  // Un bloque de texto se pinta y, de paso, apunta el rectángulo donde ha caído.
  // Sin esto no hay forma de saber en qué has hecho doble clic: el lienzo es
  // píxeles, no tiene botones.
  function anotar(o, clave, x, y, w, h) {
    if (!o.cajas) return;
    o.cajas.push({ clave: clave, x: x, y: y, w: w, h: h });
  }

  // Desplazamiento y tamaño propios de un bloque. Si nunca se ha tocado,
  // devuelve el sitio y el tamaño de la plantilla.
  function ajuste(s, clave) {
    const a = (s.aj && s.aj[clave]) || {};
    return { x: a.x || 0, y: a.y || 0, t: a.t != null ? a.t : 1 };
  }

  async function pintarSlide(ctx, s, W, H, opts) {
    const o = opts || {};
    const k = W / W_REF;
    // Tamaño de letra a gusto suyo, y el bloque de texto se puede desplazar.
    const tam = s.tam || 1;
    if (s.logo !== false) await cargarLogo();
    const margen = 100 * k;
    const anchoTexto = W - margen * 2;

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // --- fondo ---
    ctx.fillStyle = s.fondo === "grafito" ? C.grafito : C.negro;
    ctx.fillRect(0, 0, W, H);

    const im = await imagen(s.img);
    if (im) {
      cubrir(ctx, im, W, H);
      // Velo oscuro para que el texto en lima siga legible encima de la foto.
      if (s.tipo !== "foto" || s.frase) {
        const grad = ctx.createLinearGradient(0, H * 0.3, 0, H);
        grad.addColorStop(0, "rgba(10,9,8,0)");
        grad.addColorStop(1, "rgba(10,9,8,0.86)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
    }

    grano(ctx, W, H, im ? 0.04 : 0.07);
    if (s.tipo !== "foto") esquinas(ctx, k, W, H, o.acento === false ? C.lima : C.magenta);

    // --- contenido ---
    if (s.tipo === "foto") {
      if (!im) {
        ctx.fillStyle = "rgba(236,230,215,0.28)";
        ctx.font = "700 " + Math.round(30 * k) + "px " + MONO;
        ctx.textAlign = "center";
        ctx.fillText("PON UNA FOTO AQUÍ", W / 2, H / 2);
        ctx.textAlign = "left";
      }
      if (s.frase) {
        const f = encajar(ctx, s.frase.toUpperCase(), anchoTexto, 2, 70 * k, 34 * k, FUENTE);
        let y = H - 150 * k - (f.lineas.length - 1) * f.tam * 1.05;
        ctx.fillStyle = C.lima;
        for (const l of f.lineas) { ctx.fillText(l, margen, y); y += f.tam * 1.05; }
      }
    } else if (s.tipo === "cierre") {
      ctx.textAlign = "center";
      const t = encajar(ctx, (s.titular || "").toUpperCase(), anchoTexto, 3, 86 * k, 40 * k, FUENTE);
      let y = H / 2 - (t.lineas.length - 1) * t.tam * 0.53;
      ctx.fillStyle = C.lima;
      for (const l of t.lineas) { ctx.fillText(l, W / 2, y); y += t.tam * 1.06; }

      ctx.font = Math.round(26 * k) + "px " + MONO;
      ctx.fillStyle = C.hueso;
      y += 30 * k;
      for (const l of envolver(ctx, s.cuerpo || "", anchoTexto)) { ctx.fillText(l, W / 2, y); y += 38 * k; }

      ctx.fillStyle = C.magenta;
      ctx.fillRect(W / 2 - 40 * k, y + 26 * k, 80 * k, 4 * k);
      ctx.font = "700 " + Math.round(30 * k) + "px " + MONO;
      ctx.fillStyle = C.lima;
      ctx.fillText("@ KAOS . REALM", W / 2, y + 100 * k);
      ctx.textAlign = "left";
      ctx.restore();
      return;
    } else {
      // portada y pilar comparten maqueta: número, kicker, titular, cuerpo.
      // El bloque entero se mueve con dx/dy, y ADEMÁS cada trozo puede moverse
      // y crecer por su cuenta (s.aj). Así se coloca como en Canva sin perder
      // la maqueta de la plantilla, que es de donde parte todo.
      const mx = (s.dx || 0) * W, my = (s.dy || 0) * H;
      ctx.save();
      ctx.translate(mx, my);
      let y = H * (s.tipo === "portada" ? 0.42 : 0.40);

      // Ancho real de lo pintado, para poder pinchar justo encima y no en el
      // aire que sobra a la derecha.
      function anchoDe(lineas) {
        let w = 0;
        for (const l of lineas) w = Math.max(w, ctx.measureText(l).width);
        return w;
      }

      if (s.num) {
        const a = ajuste(s, "num");
        ctx.font = "700 " + Math.round(30 * k * tam * a.t) + "px " + MONO;
        ctx.fillStyle = C.magenta;
        const px = margen + a.x * W, py = 118 * k + a.y * H;
        ctx.fillText(s.num, px, py);
        const w = ctx.measureText(s.num).width, alt = 30 * k * tam * a.t;
        anotar(o, "num", px + mx, py - alt + my, w, alt * 1.3);
      }
      if (s.kicker) {
        const a = ajuste(s, "kicker");
        const t2 = 25 * k * tam * a.t;
        ctx.font = "700 " + Math.round(t2) + "px " + MONO;
        ctx.fillStyle = C.lima;
        const px = margen + a.x * W, py = y + a.y * H;
        ctx.fillText(s.kicker.toUpperCase(), px, py);
        anotar(o, "kicker", px + mx, py - t2 + my, ctx.measureText(s.kicker.toUpperCase()).width, t2 * 1.3);
        y += 52 * k * tam;
      }
      if (s.titular) {
        const a = ajuste(s, "titular");
        const t = encajar(ctx, s.titular.toUpperCase(), anchoTexto,
          s.tipo === "portada" ? 4 : 3, (s.tipo === "portada" ? 104 : 86) * k * tam * a.t, 40 * k * tam, FUENTE);
        ctx.fillStyle = C.lima;
        const px = margen + a.x * W;
        const y0 = y + a.y * H;
        let yy = y0;
        for (const l of t.lineas) { yy += t.tam * 0.92; ctx.fillText(l, px, yy); }
        anotar(o, "titular", px + mx, y0 + my, anchoDe(t.lineas), yy - y0 + t.tam * 0.3);
        ctx.fillStyle = C.magenta;
        ctx.fillRect(px, yy + 38 * k, 96 * k, 5 * k);
        // El aire entre el titular y el cuerpo. Los 38 no se tocan: ahí está la
        // raya magenta, y si el cuerpo subiera más se le montaría encima.
        const hueco = s.hueco != null ? s.hueco : 1;
        y = yy + (38 + 48 * hueco) * k;
      }
      if (s.cuerpo) {
        const a = ajuste(s, "cuerpo");
        const t2 = 27 * k * tam * a.t;
        ctx.font = Math.round(t2) + "px " + MONO;
        ctx.fillStyle = C.hueso;
        const px = margen + a.x * W;
        const y0 = y + a.y * H;
        let yy = y0;
        const ls = envolver(ctx, s.cuerpo, anchoTexto * 0.86);
        for (const l of ls) { ctx.fillText(l, px, yy); yy += 41 * k * tam * a.t; }
        anotar(o, "cuerpo", px + mx, y0 - t2 + my, anchoDe(ls), yy - y0 + t2 * 0.4);
      }
      ctx.restore();
    }

    // --- textos sueltos, los que añade ella ---
    // Van encima de todo menos de la firma. Cada uno lleva su sitio y su tamaño
    // en fracciones del lienzo, así la miniatura, la previa y el PNG coinciden.
    for (const t of (s.textos || [])) {
      if (!t.txt) continue;
      const alt = (t.t || 0.05) * H;
      const mono = t.fuente === "mono";
      ctx.font = (mono ? "700 " : "") + Math.round(alt) + "px " + (mono ? MONO : FUENTE);
      ctx.fillStyle = C[t.color] || C.lima;
      const px = (t.x != null ? t.x : 0.1) * W;
      let py = (t.y != null ? t.y : 0.5) * H;
      const ls = String(t.txt).split(SALTO);
      let w = 0;
      for (const l of ls) w = Math.max(w, ctx.measureText(l).width);
      const y0 = py;
      for (const l of ls) { ctx.fillText(l, px, py); py += alt * 1.12; }
      anotar(o, "txt:" + t.id, px, y0 - alt, w, py - y0 + alt * 0.3);
    }

    if (!s.sinFirma) firmaCompleta(ctx, k, W, H, s, o);

    // La guía del cuadro del grid. Sólo en pantalla — al exportar NO se pinta,
    // que si no acabaría dentro del PNG que sube.
    if (o.guiaRecorte) {
      const lado = Math.min(W, H * o.guiaRecorte);
      const x = (W - lado) / 2, y = (H - lado) / 2;
      ctx.save();
      ctx.strokeStyle = "rgba(232,23,79,0.85)";
      ctx.lineWidth = Math.max(2, 3 * k);
      ctx.setLineDash([14 * k, 10 * k]);
      ctx.strokeRect(x, y, lado, lado);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(10,9,8,0.45)";
      ctx.fillRect(0, 0, W, y);
      ctx.fillRect(0, y + lado, W, H - y - lado);
      ctx.fillStyle = "rgba(232,23,79,0.95)";
      ctx.font = "700 " + Math.round(22 * k) + "px " + MONO;
      ctx.textAlign = "center";
      ctx.fillText("ESTO ES LO QUE SE VE EN TU PERFIL", W / 2, y - 18 * k);
      ctx.textAlign = "left";
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------- exportación ---
  async function pintarEn(canvas, s, W, H, opts) {
    canvas.width = W; canvas.height = H;
    await pintarSlide(canvas.getContext("2d"), s, W, H, opts);
    return canvas;
  }

  function aBlob(canvas) {
    return new Promise((r) => canvas.toBlob(r, "image/png"));
  }

  async function exportarSlide(s, indice, carrusel) {
    const m = medidas(carrusel);
    const c = document.createElement("canvas");
    // Sin guía: la guía es para mirar, no para publicar.
    await pintarEn(c, s, m.W, m.H);
    const nombre = m.recorte
      ? "kaos-portada-reel-" + Date.now() + ".png"
      : (carrusel && carrusel.slides.length === 1
          ? "kaos-portada-" + Date.now() + ".png"
          : "kaos-carrusel-" + String(indice + 1).padStart(2, "0") + ".png");
    return { blob: await aBlob(c), nombre: nombre };
  }

  // En el iPad la descarga de varios ficheros seguidos no funciona: Safari sólo
  // deja pasar el primero. Por eso se usa la hoja de compartir cuando existe,
  // que sí acepta el lote entero y lo manda a Fotos de una vez.
  async function exportarTodo(carrusel, alProgreso) {
    const ficheros = [];
    for (let i = 0; i < carrusel.slides.length; i++) {
      if (alProgreso) alProgreso(i + 1, carrusel.slides.length);
      const { blob, nombre } = await exportarSlide(carrusel.slides[i], i, carrusel);
      if (blob) ficheros.push(new File([blob], nombre, { type: "image/png" }));
    }
    if (!ficheros.length) return "vacio";

    // Una portada es UN fichero: se pregunta dónde guardarlo, como cualquier
    // "guardar como". Pedirle que elija una carpeta entera para un solo archivo
    // era dar dos pasos donde hace falta uno.
    if (ficheros.length === 1 && typeof root.showSaveFilePicker === "function") {
      try {
        const h = await root.showSaveFilePicker({
          suggestedName: ficheros[0].name,
          id: "kaosFlash",
          startIn: "pictures",
          types: [{ description: "Imagen PNG", accept: { "image/png": [".png"] } }],
        });
        const w = await h.createWritable();
        await w.write(ficheros[0]);
        await w.close();
        return "fichero";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelado";
        console.warn("no se pudo guardar la portada, sigo con el método de siempre", e);
      }
    }

    // Un carrusel son varias imágenes de golpe. Con "Guardar como" saldrían
    // ocho ventanas seguidas, así que aquí se pregunta la CARPETA una sola vez
    // y dentro caen todas con su número de slide. Sólo Chrome y Edge en el PC;
    // en el iPad sigue mandando el menú de compartir, que es lo que hay.
    if (typeof root.showDirectoryPicker === "function") {
      try {
        const dir = await root.showDirectoryPicker({ id: "kaosFlash", mode: "readwrite", startIn: "pictures" });
        for (const f of ficheros) {
          const h = await dir.getFileHandle(f.name, { create: true });
          const w = await h.createWritable();
          await w.write(f);
          await w.close();
        }
        return "carpeta";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelado";
        console.warn("no se pudo guardar en carpeta, sigo con el método de siempre", e);
      }
    }

    try {
      if (navigator.canShare && navigator.canShare({ files: ficheros })) {
        await navigator.share({ files: ficheros, title: carrusel.titulo || "Carrusel" });
        return "compartido";
      }
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelado";
    }
    for (const f of ficheros) {
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url; a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      await new Promise((r) => setTimeout(r, 350));
    }
    return "descargado";
  }

  root.KAOS_CARRUSEL = {
    PLANTILLAS, PILARES, COLORES: C, W_REF, H_REF, FORMATOS, medidas,
    encoger, sitioUsadoKB,
    lista, obtener, crear, escribir, borrar,
    pintarSlide, pintarEn, exportarSlide, exportarTodo,
  };
})(window);
