// KAOS.REALM — generador de mini mandalas (v1)
//
// Dibuja ornamentos pequeños de tinta maciza: rosetones, cruces, rombos, flores
// y dagas. Para flash days: diseños chicos, baratos y en cantidad.
//
// Por qué procedural y no IA: esto tiene que dar cien piezas en un segundo, sin
// conexión, sin key y sin coste, y sobre todo tiene que salir TATUABLE. Un
// generador de imágenes te da grises, texturas y detalle que no aguanta a 4 cm.
// Aquí sólo hay negro y transparente, y los tamaños mínimos están puestos a
// mano para que la silueta se lea de lejos.
//
// Cómo consigue la simetría: se dibuja UN brazo, mirando a las 12 en punto, y
// se repite girándolo. Cada brazo se pinta además espejado, que es lo que hace
// que la pieza sea simétrica de verdad y no un dibujo torcido que lo parece.
(function (root) {
  "use strict";

  const LADO = 1200;          // lienzo cuadrado de trabajo
  const R = LADO * 0.44;      // radio útil: deja aire alrededor

  // Grosor mínimo. Es la regla que hace la diferencia entre un dibujo bonito en
  // pantalla y un tatuaje que a los dos años sigue leyéndose: nada más fino que
  // esto, porque a 4 cm la tinta se abre y lo cierra.
  const MIN = LADO * 0.018;

  // ---------------------------------------------------------------- azar
  // Determinista: la misma semilla da siempre el mismo dibujo. Hace falta para
  // poder repintar la pieza (los huecos van en una segunda pasada) y para que
  // «otra vuelta» sea una tirada nueva de verdad, no un refresco al azar.
  function rng(semilla) {
    let s = (semilla | 0) || 1;
    // Calentar el generador antes de usarlo. Sin esto el PRIMER valor es casi
    // proporcional a la semilla, y como las semillas de una tanda van de 9973
    // en 9973, la familia salía por turnos en vez de sorteada: tiradas con
    // ocho estrellas de doce.
    s = Math.imul(s ^ (s >>> 16), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    s = (s ^ (s >>> 16)) | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function ent(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function num(r, a, b) { return a + r() * (b - a); }
  function una(r, lista) { return lista[Math.floor(r() * lista.length) % lista.length]; }
  function quiza(r, p) { return r() < p; }

  // ============================================================== TRAZOS
  // Todos trabajan en coordenadas del brazo: el centro de la pieza es (0,0) y
  // +Y va HACIA FUERA (el lienzo está volteado en `pieza`). Así «y» es siempre
  // «a qué distancia del centro», que es como se piensa un ornamento.

  // Pétalo apuntado. El de toda la vida: sale del eje, se ensancha y acaba en
  // punta. Es la pieza que más se repite en la foto de referencia.
  function hoja(ctx, y0, largo, ancho, puntaX) {
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(ancho * 0.95, y0 + largo * 0.12,
                      ancho * 1.00, y0 + largo * 0.58,
                      ancho * puntaX, y0 + largo);
    ctx.bezierCurveTo(ancho * 0.34, y0 + largo * 0.56,
                      ancho * 0.20, y0 + largo * 0.20,
                      0, y0);
    ctx.fill();
  }

  // Punta / aguja: lados cóncavos, para que pinche. Es lo que hace la daga y
  // las puntas de los rombos.
  function punta(ctx, y0, largo, ancho) {
    ctx.beginPath();
    ctx.moveTo(-ancho / 2, y0);
    ctx.quadraticCurveTo(-ancho * 0.14, y0 + largo * 0.62, 0, y0 + largo);
    ctx.quadraticCurveTo(ancho * 0.14, y0 + largo * 0.62, ancho / 2, y0);
    ctx.closePath();
    ctx.fill();
  }

  // Barra ahusada: el brazo de una cruz.
  function barra(ctx, y0, y1, w0, w1) {
    ctx.beginPath();
    ctx.moveTo(-w0 / 2, y0);
    ctx.lineTo(w0 / 2, y0);
    ctx.lineTo(w1 / 2, y1);
    ctx.lineTo(-w1 / 2, y1);
    ctx.closePath();
    ctx.fill();
  }

  function rombo(ctx, y, alto, ancho) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ancho / 2, y + alto / 2);
    ctx.lineTo(0, y + alto);
    ctx.lineTo(-ancho / 2, y + alto / 2);
    ctx.closePath();
    ctx.fill();
  }

  // Aro: el contorno cerrado de la pieza (rombo o círculo). Se pinta una sola
  // vez y no por brazo, porque cuatro trozos girados no cierran bien en los
  // vértices — de ahí salía un aspa en vez de un diamante.
  function aro(ctx, cfg) {
    ctx.save();
    ctx.lineJoin = "miter";
    ctx.lineWidth = cfg.grosor;
    ctx.beginPath();
    if (cfg.forma === "circulo") {
      ctx.arc(0, 0, cfg.radio, 0, Math.PI * 2);
    } else {
      ctx.moveTo(0, cfg.radio);
      ctx.lineTo(cfg.radio, 0);
      ctx.lineTo(0, -cfg.radio);
      ctx.lineTo(-cfg.radio, 0);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  function bola(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(r, MIN * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // Voluta: el rizo. Se pinta como una espiral trazada que se va afinando, en
  // vez de como un contorno relleno — sale más limpio y es como se tatúa.
  function voluta(ctx, x0, y0, radio, vueltas, grosor, sentido, aIni) {
    const N = 46;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let px = null, py = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = aIni + sentido * t * vueltas * Math.PI * 2;
      const rr = radio * (1 - 0.60 * t);
      const x = x0 + Math.cos(a) * rr, y = y0 + Math.sin(a) * rr;
      if (px !== null) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.lineWidth = Math.max(grosor * (1 - 0.86 * t), MIN * 0.55);
        ctx.stroke();
      }
      px = x; py = y;
    }
  }

  // Tallo: una curva que se va afinando. Es LA pieza del ornamento vegetal —
  // todo lo demás (hojas, flores, rizos) se cuelga de un tallo.
  function bez(p0, c1, c2, p1, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
  }
  function tallo(ctx, p0, c1, c2, p1, g0, g1) {
    const N = 34;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let pr = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const q = bez(p0, c1, c2, p1, t);
      if (pr) {
        ctx.beginPath();
        ctx.moveTo(pr[0], pr[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.lineWidth = Math.max(MIN * 0.55, g0 + (g1 - g0) * t);
        ctx.stroke();
      }
      pr = q;
    }
    return pr;
  }

  // Rizo que ARRANCA en un punto, en vez de girar alrededor de un centro. Es
  // lo que deja engancharlo al final de un tallo sin que se note el empalme.
  function rizoDesde(ctx, px, py, radio, vueltas, grosor, sentido, aIni) {
    const cx = px - Math.cos(aIni) * radio;
    const cy = py - Math.sin(aIni) * radio;
    voluta(ctx, cx, cy, radio, vueltas, grosor, sentido, aIni);
  }

  // Hoja de hiedra / corazón: se engancha por la punta, y los dos lóbulos van
  // al otro extremo. Sale mucho en la segunda referencia.
  function hojaCorazon(ctx, tam) {
    const w = tam * 0.64, h = tam;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(w * 0.95, h * 0.20, w * 1.05, h * 0.74, w * 0.52, h * 0.96);
    ctx.bezierCurveTo(w * 0.22, h * 1.07, w * 0.07, h * 0.93, 0, h * 0.74);
    ctx.bezierCurveTo(-w * 0.07, h * 0.93, -w * 0.22, h * 1.07, -w * 0.52, h * 0.96);
    ctx.bezierCurveTo(-w * 1.05, h * 0.74, -w * 0.95, h * 0.20, 0, 0);
    ctx.fill();
  }

  // Hoja lobulada de tres puntas.
  function hojaLoba(ctx, tam) {
    hoja(ctx, 0, tam, tam * 0.34, 0.08);
    for (const lado of [-1, 1]) {
      ctx.save();
      ctx.rotate(lado * 0.85);
      ctx.scale(lado, 1);
      hoja(ctx, tam * 0.10, tam * 0.62, tam * 0.28, 0.20);
      ctx.restore();
    }
  }

  // Florecilla de cinco pétalos.
  function florCinco(ctx, x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i / 5) * Math.PI * 2);
      bola(ctx, 0, r * 0.72, r * 0.46);
      ctx.restore();
    }
    bola(ctx, 0, 0, r * 0.44);
    ctx.restore();
  }

  // Lente / aguja: punta en los dos extremos y lados cóncavos, más ancha en el
  // primer tercio. Son los cuatro rayos largos de la estrella de 8 puntas.
  function lente(ctx, y0, largo, ancho) {
    const w = ancho / 2, L = largo;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.bezierCurveTo(w, y0 + L * 0.16, w, y0 + L * 0.34, 0, y0 + L);
    ctx.bezierCurveTo(-w, y0 + L * 0.34, -w, y0 + L * 0.16, 0, y0);
    ctx.closePath();
    ctx.fill();
  }

  // Dardo: punta en el centro, se ensancha, hace una MUESCA a media altura y
  // se va en una cola finísima. Es la forma de las dos últimas referencias, y
  // la muesca es justo lo que la distingue de un triángulo cualquiera.
  function dardo(ctx, y0, largo, ancho) {
    const w = ancho / 2, L = largo;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    // El bulto va pronto, la muesca muerde fuerte (de 1.00 a 0.46) y la cola se
    // come el 65% restante afilándose casi a un pelo. Sin eso salía una punta
    // gorda cualquiera en vez del dardo de la referencia.
    ctx.bezierCurveTo(w * 0.80, y0 + L * 0.09, w * 1.00, y0 + L * 0.16, w * 0.96, y0 + L * 0.24);
    ctx.bezierCurveTo(w * 0.92, y0 + L * 0.30, w * 0.50, y0 + L * 0.29, w * 0.46, y0 + L * 0.36);
    ctx.bezierCurveTo(w * 0.42, y0 + L * 0.48, w * 0.12, y0 + L * 0.80, 0, y0 + L);
    ctx.bezierCurveTo(-w * 0.12, y0 + L * 0.80, -w * 0.42, y0 + L * 0.48, -w * 0.46, y0 + L * 0.36);
    ctx.bezierCurveTo(-w * 0.50, y0 + L * 0.29, -w * 0.92, y0 + L * 0.30, -w * 0.96, y0 + L * 0.24);
    ctx.bezierCurveTo(-w * 1.00, y0 + L * 0.16, -w * 0.80, y0 + L * 0.09, 0, y0);
    ctx.closePath();
    ctx.fill();
  }

  // Gancho / coma: la lengüeta que remata muchos brazos.
  function gancho(ctx, x0, y0, largo, grosor, lado) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + lado * largo * 0.85, y0 + largo * 0.30,
                         x0 + lado * largo * 0.62, y0 + largo * 0.92);
    ctx.quadraticCurveTo(x0 + lado * largo * 0.30, y0 + largo * 0.34,
                         x0 - lado * grosor * 0.5, y0 + grosor * 0.35);
    ctx.closePath();
    ctx.fill();
  }

  // Trébol de tres lóbulos, para rematar cruces.
  function trebol(ctx, y, r) {
    bola(ctx, 0, y + r * 1.5, r);
    bola(ctx, -r * 1.15, y + r * 0.55, r * 0.92);
    bola(ctx, r * 1.15, y + r * 0.55, r * 0.92);
  }

  // ============================================================== FAMILIAS
  // Cada receta pinta UN brazo. `m` es el modo: "tinta" rellena, "hueco" sólo
  // marca los calados. Se llama dos veces con la misma semilla, y por eso las
  // dos pasadas coinciden exactamente.

  function esHueco(m) { return m === "hueco"; }

  // Rosetón: el más común de la hoja de referencia. Anillos de pétalos que van
  // creciendo hacia fuera, con bolitas de remate.
  function brazoRoseton(ctx, r, m, rec) {
    const anillos = rec.anillos;
    for (let k = 0; k < anillos.length; k++) {
      const an = anillos[k];
      if (!esHueco(m)) {
        // El par de pétalos abiertos en V
        for (const lado of [-1, 1]) {
          ctx.save();
          ctx.rotate(lado * an.abre);
          ctx.scale(lado, 1);
          hoja(ctx, an.y, an.largo, an.ancho, an.puntaX);
          ctx.restore();
        }
        // El pétalo del eje, más largo
        if (an.eje) hoja(ctx, an.y, an.largo * 1.22, an.ancho * 0.62, 0.05);
        if (an.bola) bola(ctx, 0, an.y + an.largo * 1.42, an.bolaR);
        if (an.rizo) {
          for (const lado of [-1, 1]) {
            voluta(ctx, lado * an.ancho * 1.15, an.y + an.largo * 0.55,
              an.largo * 0.34, 0.78, MIN * 1.5, lado, lado > 0 ? -0.4 : Math.PI + 0.4);
          }
        }
      } else if (an.calado) {
        // El calado: un punto en blanco dentro del pétalo. Es lo que da el aire
        // de sello antiguo en vez de mancha negra.
        for (const lado of [-1, 1]) {
          ctx.save();
          ctx.rotate(lado * an.abre);
          ctx.scale(lado, 1);
          bola(ctx, an.ancho * 0.52, an.y + an.largo * 0.50, an.largo * 0.13);
          ctx.restore();
        }
      }
    }
  }

  // Cruz patada / gótica: el brazo sale estrecho del centro, se abre en dos
  // cuernos y de ahí se recoge en una punta central. Todos los lados van
  // CÓNCAVOS — es lo que la separa de una cruz de palos y lo que la hace ser
  // la cruz de la referencia.
  function brazoCruz(ctx, r, m, cfg, k, n) {
    // El brazo de abajo es el PIE y va aparte. Con giro 0 y cuatro brazos, el
    // que apunta hacia abajo es el k=2: el trazo se dibuja hacia +Y local y
    // rotate(a) lo manda al ángulo a + 90°, así que k=2 (a = 180°) mira a 270°.
    const esPie = (n === 4 && k === 2);
    const L = cfg.largo * (esPie ? cfg.pie : 1);
    if (esHueco(m)) {
      if (cfg.calado) bola(ctx, 0, L * 0.58, MIN * 0.9);
      return;
    }
    const w0 = cfg.cuello, wM = cfg.cuerno, hy = L * cfg.cuernoY;
    ctx.beginPath();
    ctx.moveTo(w0, 0);
    // cuello -> cuerno: sale casi recto y se abre de golpe al final
    ctx.bezierCurveTo(w0 * 1.05, hy * 0.44, wM * 0.40, hy * 0.72, wM, hy);
    if (cfg.puntaCentral) {
      // cuerno -> punta del medio, con el filo hundido hacia dentro
      ctx.bezierCurveTo(wM * 0.44, hy + (L - hy) * 0.28, wM * 0.15, hy + (L - hy) * 0.56, 0, L);
      ctx.bezierCurveTo(-wM * 0.15, hy + (L - hy) * 0.56, -wM * 0.44, hy + (L - hy) * 0.28, -wM, hy);
    } else {
      // sin punta central: los dos cuernos unidos por un arco hundido
      ctx.bezierCurveTo(wM * 0.60, L * 0.86, -wM * 0.60, L * 0.86, -wM, hy);
    }
    ctx.bezierCurveTo(-wM * 0.40, hy * 0.72, -w0 * 1.05, hy * 0.44, -w0, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Estrella: cuatro agujas en los ejes y cuatro dardos en las diagonales. Con
  // las agujas apagadas queda el aspa de cuatro dardos de la última referencia.
  function piezaEstrella(ctx, r, m, cfg) {
    if (esHueco(m)) return;
    if (cfg.agujas) {
      for (let k = 0; k < 4; k++) {
        ctx.save();
        ctx.rotate(k * Math.PI / 2);
        lente(ctx, cfg.hueco, cfg.largoAguja, cfg.anchoAguja);
        ctx.restore();
      }
    }
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.rotate(Math.PI / 4 + k * Math.PI / 2);
      dardo(ctx, cfg.huecoDardo, cfg.largoDardo, cfg.anchoDardo);
      ctx.restore();
    }
  }

  // Flor: pocos pétalos y muy gordos. Los números 12 y 14 de la referencia.
  function brazoFlor(ctx, r, m, cfg) {
    if (esHueco(m)) {
      if (cfg.calado) bola(ctx, 0, cfg.y + cfg.largo * 0.46, cfg.ancho * 0.26);
      return;
    }
    hoja(ctx, cfg.y, cfg.largo, cfg.ancho, cfg.puntaX);
    if (cfg.segundo) {
      // en el hueco entre dos pétalos grandes
      ctx.save();
      ctx.rotate(cfg.medio);
      hoja(ctx, cfg.y + cfg.largo * 0.10, cfg.largo * 0.55, cfg.ancho * 0.42, 0.30);
      ctx.scale(-1, 1);
      hoja(ctx, cfg.y + cfg.largo * 0.10, cfg.largo * 0.55, cfg.ancho * 0.42, 0.30);
      ctx.restore();
    }
  }

  // Rombo: contorno de diamante con relleno dentro.
  function brazoRombo(ctx, r, m, cfg) {
    if (esHueco(m)) {
      if (cfg.calado) bola(ctx, 0, R * 0.30, MIN * 1.1);
      return;
    }
    // Sólo el relleno de dentro: el contorno del rombo lo pinta `pieza`. Ocupa
    // casi todo el hueco a propósito — un ornamento pequeño dentro de un aro
    // grande no es un diseño, es un aro.
    if (cfg.hojaDentro) hoja(ctx, R * 0.03, R * 0.56, MIN * 5.2, 0.10);
    if (cfg.puntas) punta(ctx, R * 0.58, R * 0.34, MIN * 3.2);
  }

  // Daga: la única que no es radial. Va sola, con espejo vertical.
  function piezaDaga(ctx, r, m) {
    if (esHueco(m)) return;
    const largo = R * 1.32;          // la hoja
    const ancho = MIN * 9.0;
    ctx.save();
    // Se le da la vuelta al eje: dentro de esta función +Y va HACIA ABAJO, que
    // es como se piensa una daga (empuñadura arriba, punta abajo). Antes la
    // guarda acababa junto a la punta y salía un obelisco.
    ctx.scale(1, -1);
    ctx.translate(0, -R * 0.58);

    // hoja: base arriba, punta abajo
    punta(ctx, 0, largo, ancho);
    // guarda, en la base de la hoja
    barra(ctx, -MIN * 1.7, MIN * 1.7, R * 0.82, R * 0.60);
    // puntas de la guarda
    for (const lado of [-1, 1]) {
      ctx.save();
      ctx.translate(lado * R * 0.41, 0);
      ctx.rotate(lado * Math.PI / 2);
      punta(ctx, 0, R * 0.16, MIN * 3.2);
      ctx.restore();
    }
    // mango hacia arriba y pomo
    barra(ctx, -MIN * 1.7, -R * 0.36, MIN * 3.2, MIN * 2.4);
    bola(ctx, 0, -R * 0.42, MIN * 2.6);
    for (const lado of [-1, 1]) {
      ctx.save();
      ctx.translate(0, -R * 0.42);
      ctx.scale(lado, -1);
      hoja(ctx, MIN * 1.2, R * 0.20, MIN * 3.0, 0.35);
      ctx.restore();
    }
    ctx.restore();
  }

  // Cresta: simetría de ESPEJO, no radial. Es la flor de lis y los escudos
  // vegetales de la segunda referencia — un eje central y dos brazos que se
  // abren y se enroscan. Media hoja de esa referencia son piezas así, y el
  // generador no sabía hacer ninguna porque todo lo suyo giraba.
  function brazoCresta(ctx, r, m, cfg) {
    if (esHueco(m)) {
      if (cfg.calado) bola(ctx, 0, cfg.alto * 0.42, MIN * 1.1);
      return;
    }
    const A = cfg.alto;
    // Pétalo central: alto y ESTRECHO. Con el eje gordo los tres pétalos se
    // tocaban y salía un manchurrón sin dibujo dentro.
    hoja(ctx, 0, A, A * cfg.anchoEje, 0.04);
    if (cfg.bulbo) bola(ctx, 0, A * 0.24, A * cfg.anchoEje * 0.75);

    // Pétalo lateral. Todo lo suyo (incluido el rizo del final) se dibuja
    // DENTRO de su propio giro: así el rizo cae exactamente en su punta sin
    // tener que calcular la rotación a mano — que es donde me equivoqué antes.
    ctx.save();
    ctx.rotate(cfg.abre);
    const largoLat = A * cfg.largoLat;
    const anchoLat = A * cfg.anchoLat;
    hoja(ctx, cfg.salida, largoLat, anchoLat, cfg.curva);
    // la punta del pétalo está en (anchoLat*curva, salida+largoLat)
    rizoDesde(ctx, anchoLat * cfg.curva, cfg.salida + largoLat,
      A * 0.13, 0.82, cfg.grosorTallo, 1, cfg.rizoAng);
    if (cfg.hojas) {
      ctx.save();
      ctx.translate(anchoLat * 0.95, cfg.salida + largoLat * 0.42);
      ctx.rotate(-1.0);
      if (cfg.hojaTipo === "corazon") hojaCorazon(ctx, A * 0.24);
      else hojaLoba(ctx, A * 0.22);
      ctx.restore();
    }
    ctx.restore();

    // Voluta de apoyo, abajo y hacia fuera
    if (cfg.brazoBajo) {
      const f = tallo(ctx,
        [0, cfg.salida * 0.6],
        [A * 0.26, cfg.salida * 0.5],
        [A * 0.46, cfg.salida * 0.24],
        [A * 0.44, -A * 0.05],
        cfg.grosorTallo * 1.3, cfg.grosorTallo * 0.55);
      rizoDesde(ctx, f[0], f[1], A * 0.11, 0.78, cfg.grosorTallo * 0.6, -1, -1.5);
    }
    if (cfg.banda) barra(ctx, cfg.salida * 0.9, cfg.salida * 0.9 + A * 0.055,
                         A * 0.46, A * 0.46);
  }

  // Rama: un tallo suelto con hojas, sin espejo ninguno. Las esquinas y las
  // ramitas sueltas de la referencia. Es la única pieza asimétrica: por eso
  // lleva bandera propia, "sinEspejo".
  function piezaRama(ctx, r, m) {
    if (esHueco(m)) return;
    const g = MIN * num(r, 3.6, 5.2);
    const p0 = [-R * num(r, 0.55, 0.80), -R * num(r, 0.55, 0.85)];
    const p1 = [R * num(r, 0.30, 0.60), R * num(r, 0.35, 0.70)];
    const c1 = [p0[0] + R * num(r, 0.5, 1.1), p0[1] + R * num(r, 0.1, 0.5)];
    const c2 = [p1[0] - R * num(r, 0.5, 1.2), p1[1] - R * num(r, 0.2, 0.7)];
    const fin = tallo(ctx, p0, c1, c2, p1, g, g * 0.35);
    rizoDesde(ctx, fin[0], fin[1], R * num(r, 0.14, 0.22), num(r, 0.7, 1.05), g * 0.45, 1, num(r, 0, 6.2));
    // rizo también en el arranque: así el tallo no parece cortado
    rizoDesde(ctx, p0[0], p0[1], R * 0.13, 0.7, g * 0.5, -1, num(r, 2.4, 4.2));

    const cuantas = ent(r, 2, 3);
    const tipo = una(r, ["corazon", "corazon", "loba"]);
    for (let i = 0; i < cuantas; i++) {
      // Bien repartidas: apiñadas salía un racimo de uvas, no una rama.
      const t = 0.16 + (i / Math.max(1, cuantas - 1)) * 0.70;
      const q = bez(p0, c1, c2, p1, t);
      const q2 = bez(p0, c1, c2, p1, Math.min(1, t + 0.03));
      const ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]);
      const lado = i % 2 ? 1 : -1;
      ctx.save();
      ctx.translate(q[0], q[1]);
      ctx.rotate(ang - Math.PI / 2 + lado * num(r, 0.95, 1.45));
      // Pecíolo: el rabito que separa la hoja del tallo. Sin él las hojas se
      // pegan unas a otras y la rama se lee como una oruga, no como una rama.
      const rabo = R * num(r, 0.16, 0.26);
      tallo(ctx, [0, 0], [0, rabo * 0.4], [0, rabo * 0.7], [0, rabo], g * 0.55, g * 0.35);
      ctx.translate(0, rabo);
      const tam = R * num(r, 0.28, 0.38);
      if (tipo === "corazon") hojaCorazon(ctx, tam); else hojaLoba(ctx, tam);
      ctx.restore();
    }
    if (quiza(r, 0.55)) {
      const q = bez(p0, c1, c2, p1, num(r, 0.35, 0.7));
      florCinco(ctx, q[0], q[1], R * num(r, 0.12, 0.16));
    }
  }


  // ================================================= TRAZOS SUELTOS
  // Todo lo de arriba gira o hace espejo. Lo que viene ahora NO: son las piezas
  // sueltas de sus referencias (destellos, lunas, espinas, corazón). Se dibujan
  // de una vez, cada trazo colocado a mano, sin simetría radial ninguna.

  // Destello de cuatro puntas con los filos hundidos. Los cuatro brazos se
  // pasan sueltos a propósito: con las cuatro puntas iguales sale un clip art,
  // y en sus referencias no hay ni uno simétrico.
  function destello(ctx, x, y, brazos, cintura, giro) {
    ctx.save();
    ctx.translate(x, y);
    if (giro) ctx.rotate(giro);
    const pt = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 2 - i * Math.PI / 2;   // arriba, derecha, abajo, izquierda
      pt.push([Math.cos(a) * brazos[i], Math.sin(a) * brazos[i], a]);
    }
    ctx.beginPath();
    ctx.moveTo(pt[0][0], pt[0][1]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const am = pt[i][2] - Math.PI / 4;
      // El punto de control va MUY cerca del centro. Eso es lo que hunde el
      // filo y convierte una estrella de papel en un destello.
      const c = cintura * Math.min(brazos[i], brazos[j]);
      ctx.quadraticCurveTo(Math.cos(am) * c, Math.sin(am) * c, pt[j][0], pt[j][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Luna creciente de cuernos afilados: un círculo al que otro le muerde un
  // trozo. Se calcula dónde se cortan los dos y se une un arco con el otro; a
  // ojo, con curvas, los cuernos salen romos y deja de ser una luna.
  // Devuelve las medidas para poder colgarle espinas después.
  function creciente(ctx, ra, T, giro) {
    const rb = ra * 1.06;          // el mordisco, un pelo más grande
    const d = T + rb - ra;         // separación que deja el grosor T pedido
    const x = (d * d + ra * ra - rb * rb) / (2 * d);
    const y = Math.sqrt(Math.max(0, ra * ra - x * x));
    const aA = Math.atan2(y, x), aB = Math.atan2(y, x - d);
    ctx.save();
    if (giro) ctx.rotate(giro);
    ctx.beginPath();
    ctx.arc(0, 0, ra, aA, -aA, false);        // el lomo, por fuera
    ctx.arc(d, 0, rb, -aB, aB, true);         // la mordida, de vuelta
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return { ra: ra, rb: rb, d: d, aA: aA, aB: aB };
  }

  // Espina: base ancha, punta de alfiler y un poco de curva. El +X local es
  // hacia donde pincha.
  function pincho(ctx, x, y, ang, largo, base, curva) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const c = (curva || 0) * largo;
    ctx.beginPath();
    ctx.moveTo(0, -base / 2);
    ctx.quadraticCurveTo(largo * 0.55, -base * 0.10 + c * 0.5, largo, c);
    ctx.quadraticCurveTo(largo * 0.45, base * 0.14 + c * 0.5, 0, base / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Corazón gótico: punta abajo, dos lomos que acaban en cuerno y una muesca
  // honda en medio. No es el corazón de emoji — ese tiene los lomos redondos y
  // aquí lo que manda es la punta.
  // Con grosor, se dibuja el CONTORNO; sin él, se rellena. Su heart.jpg es un
  // armazón hueco, no una mancha: por eso hace falta poder trazarlo.
  function corazonGotico(ctx, w, h, grosor) {
    ctx.save();
    ctx.scale(1, -1);              // dentro de aquí +Y va hacia abajo
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.bezierCurveTo(-w * 0.50, h * 0.26, -w * 1.00, -h * 0.04, -w * 0.98, -h * 0.26);
    ctx.bezierCurveTo(-w * 0.96, -h * 0.54, -w * 0.56, -h * 0.64, -w * 0.34, -h * 0.52);
    ctx.bezierCurveTo(-w * 0.18, -h * 0.43, -w * 0.07, -h * 0.33, 0, -h * 0.16);
    ctx.bezierCurveTo(w * 0.07, -h * 0.33, w * 0.18, -h * 0.43, w * 0.34, -h * 0.52);
    ctx.bezierCurveTo(w * 0.56, -h * 0.64, w * 0.96, -h * 0.54, w * 0.98, -h * 0.26);
    ctx.bezierCurveTo(w * 1.00, -h * 0.04, w * 0.50, h * 0.26, 0, h * 0.62);
    ctx.closePath();
    if (grosor) { ctx.lineWidth = grosor; ctx.lineJoin = "round"; ctx.stroke(); }
    else ctx.fill();
    ctx.restore();
  }

  // Curva de grosor constante. tallo() adelgaza; para un dibujo de línea, donde
  // el trazo tiene que ser igual de gordo todo el recorrido, se le pasa el
  // mismo grosor por los dos extremos.
  function linea(ctx, p0, c1, c2, p1, g) { return tallo(ctx, p0, c1, c2, p1, g, g); }

  // Óvalo cerrado, redondeado por los DOS extremos, que sale del origen hacia
  // +Y. Es el pétalo de su flor_simple.jpg: en la foto cada pétalo es una
  // aceituna larga, roma por arriba y por abajo, y suelta del centro.
  //
  // `lazo` no valía para esto: acaba en punta en el origen, y con seis puntas
  // clavadas en el mismo sitio salía una rosca de engranaje, no una margarita.
  function ovalo(ctx, largo, ancho, g, torcido) {
    const t = torcido || 0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(ancho * (0.78 + t), largo * 0.05,
                      ancho * (1.02 + t), largo * 0.32,
                      ancho * 0.94,       largo * 0.63);
    ctx.bezierCurveTo(ancho * 0.82, largo * 0.91, ancho * 0.44, largo, 0, largo);
    ctx.bezierCurveTo(-ancho * 0.44, largo, -ancho * 0.82, largo * 0.91,
                      -ancho * 0.94, largo * 0.63);
    ctx.bezierCurveTo(-ancho * (1.02 - t), largo * 0.32,
                      -ancho * (0.78 - t), largo * 0.05, 0, 0);
    ctx.closePath();
    ctx.lineWidth = g;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // Lazo cerrado que arranca del origen, se abre y vuelve. Es el pétalo de sus
  // margaritas: una vuelta de rotulador, sin relleno.
  function lazo(ctx, largo, ancho, g, torcido) {
    const t = torcido || 0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(ancho * (0.30 + t), largo * 0.20, ancho * 1.00, largo * 0.62, 0, largo);
    ctx.bezierCurveTo(-ancho * 1.00, largo * 0.62, -ancho * (0.30 - t), largo * 0.20, 0, 0);
    ctx.closePath();
    ctx.lineWidth = g;
    ctx.lineJoin = "round";
    ctx.stroke();
  }


  // ======================================== DIBUJO POR CONTORNO CALCADO
  // Hay formas que NO salen apilando trozos básicos: se ven los empalmes. Dos
  // óvalos cruzados dejan una esquina viva donde se tocan, y eso lee rígido y
  // a plantilla. Para esas, lo honrado es reseguir la referencia — que es lo
  // que hay en contornos.js, calcado de sus fotos con CALCADOR/trazar.py.

  // Chaikin: corta cada esquina en dos y repite. Dos vueltas convierten un
  // polígono de píxeles en una curva sin que quede ni un vértice, y de paso se
  // come los dientes de sierra que deja el calco.
  function redondear(pts, vueltas) {
    let q = pts;
    for (let v = 0; v < (vueltas || 2); v++) {
      const o = [];
      for (let i = 0; i < q.length; i++) {
        const a = q[i], b = q[(i + 1) % q.length];
        o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        o.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q = o;
    }
    return q;
  }

  // Deformación suave: el radio se estira y encoge en ondas lentas alrededor de
  // la pieza. Sin esto, todas las flores de lis de una hoja serían la MISMA
  // pieza fotocopiada doce veces, y eso canta más que un empalme.
  // Un juego de números que define UNA variación. Se calcula una vez por pieza
  // y se aplica igual a todos sus trozos: si cada trozo sorteara lo suyo, los
  // calados no caerían donde toca.
  function planVariar(r, fuerza) {
    return {
      f: fuerza,
      f1: num(r, 0, Math.PI * 2), f2: num(r, 0, Math.PI * 2),
      k1: ent(r, 2, 4), k2: ent(r, 3, 6),
      // Estirado por ejes. Es lo que más cambia la silueta sin desfigurarla:
      // la misma flor de lis alta y estrecha o baja y ancha son dos piezas.
      ex: 1 + num(r, -0.24, 0.24),
      ey: 1 + num(r, -0.24, 0.24),
      // Ondas cruzadas: la X se mueve según la altura y la Y según el ancho.
      // Esto sí tuerce la forma.
      ax: num(r, 0, 0.16), ay: num(r, 0, 0.16),
      wx: num(r, 1.2, 2.6), wy: num(r, 1.2, 2.6),
      px: num(r, 0, Math.PI * 2), py: num(r, 0, Math.PI * 2),
      espejo: quiza(r, 0.5) ? -1 : 1,
    };
  }

  function deformar(pts, v) {
    return pts.map(function (q) {
      const a = Math.atan2(q[1], q[0]);
      const d = 1 + v.f * (Math.sin(a * v.k1 + v.f1) * 0.6 + Math.sin(a * v.k2 + v.f2) * 0.4);
      let x = q[0] * d * v.ex * v.espejo;
      let y = q[1] * d * v.ey;
      x += v.ax * Math.sin(y * v.wy + v.py);
      y += v.ay * Math.sin(x * v.wx + v.px);
      return [x, y];
    });
  }

  function pintarAros(ctx, aros) {
    for (const a of aros) {
      if (a.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(a[0][0], a[0][1]);
      for (let i = 1; i < a.length; i++) ctx.lineTo(a[i][0], a[i][1]);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Pinta una referencia calcada. En la pasada de tinta van los trozos macizos;
  // en la de hueco, los calados. Las dos pasadas deforman con la MISMA semilla,
  // así que los calados caen donde toca.
  function piezaContorno(ctx, r, m, clave, opts) {
    const CS = root.KAOS_CONTORNOS && root.KAOS_CONTORNOS[clave];
    if (!CS) return;
    const o = opts || {};
    const fuerza = o.fuerza != null ? o.fuerza : num(r, 0.025, 0.055);
    const giro = o.giro != null ? o.giro : num(r, -0.06, 0.06);

    // Se deforma y redondea TODO antes de medir la caja: si se midiera sólo lo
    // que se pinta en esta pasada, la escala cambiaría entre tinta y hueco y
    // los calados bailarían.
    const v = planVariar(r, fuerza);
    if (o.sinEspejo) v.espejo = 1;
    const todo = CS.c.map(function (c) {
      return { t: c.t, p: redondear(deformar(c.p, v), o.redondeo || 2) };
    });

    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const c of todo) for (const q of c.p) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    const ancho = Math.max(1e-6, x1 - x0), alto = Math.max(1e-6, y1 - y0);
    const caben = R * (o.llenar != null ? o.llenar : 1.06) * 2;
    const k = Math.min(caben / ancho, caben / alto);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

    ctx.save();
    ctx.rotate(giro);
    const quiere = esHueco(m) ? "h" : "t";
    const aros = [];
    for (const c of todo) {
      if (c.t !== quiere) continue;
      aros.push(c.p.map(function (q) { return [(q[0] - cx) * k, (q[1] - cy) * k]; }));
    }
    pintarAros(ctx, aros);
    ctx.restore();
  }

  // ORNAMENTAL — dos cosas muy distintas en la misma carpeta, así que dos
  // variantes: la flor de lis (ornamental2.jpg) y la cenefa horizontal, que
  // sale de ornamental.jpg o de ornamental1.jpg.
  function piezaOrnamental(ctx, r, m) {
    if (quiza(r, 0.45)) piezaContorno(ctx, r, m, "lis", { llenar: 1.05 });
    else piezaContorno(ctx, r, m, quiza(r, 0.5) ? "cenefa" : "cenefa2", { llenar: 1.10 });
  }

  // LUNA — pidió que fuera sólo la foto que dejó (Luna/moon1.jpg): creciente de
  // cuernos largos con un destello dentro y púas arriba y abajo. Se resigue
  // calcada; lo que cambia de una pieza a otra es la deformación y el giro.
  // LUNA — vuelve a construirse con formas solapadas, no calcada. Ella tenía
  // razón: es una imagen sencilla y limpia (un círculo mordido por otro, un
  // destello y dos púas), y construida sale un filo perfecto y una pieza
  // distinta cada vez. Calcada salía siempre la misma con temblor encima.
  function piezaLuna(ctx, r, m) {
    if (esHueco(m)) return;
    const ra = R * num(r, 0.60, 0.72);
    const T = ra * num(r, 0.34, 0.52);
    // Boca hacia arriba, como en moon1.jpg. El creciente abre hacia +X, así
    // que un cuarto de vuelta lo pone mirando al cielo.
    const giro = Math.PI / 2 + num(r, -0.12, 0.12);
    creciente(ctx, ra, T, giro);
    ctx.save();
    ctx.rotate(giro);
    const cx = ra * num(r, 0.30, 0.46);
    const vert = ra * num(r, 0.40, 0.58);
    destello(ctx, cx, 0,
             [vert, ra * num(r, 0.62, 0.88), vert, ra * num(r, 0.62, 0.88)],
             num(r, 0.10, 0.15), 0);
    ctx.restore();
    // Las dos púas de moon1: una sale hacia arriba desde el destello y otra
    // cuelga del fondo del creciente. Son lo que la separa de una luna
    // cualquiera.
    pincho(ctx, 0, ra * num(r, 0.55, 0.72), Math.PI / 2,
           ra * num(r, 0.85, 1.20), MIN * num(r, 1.5, 2.3), 0);
    pincho(ctx, 0, -ra * num(r, 0.80, 0.92), -Math.PI / 2,
           ra * num(r, 0.55, 0.85), MIN * num(r, 2.0, 3.2), 0);
  }

  // ESPINAS — su spikes.jpg. Corona de zarza: el arco y las púas sueltas.
  function piezaEspinas(ctx, r, m) {
    piezaContorno(ctx, r, m, "espinas",
                  { llenar: 1.02, fuerza: num(r, 0.010, 0.026) });
  }

  // CORAZÓN — su heart.jpg, calcado entero con sus diez calados.
  function piezaCorazon(ctx, r, m) {
    piezaContorno(ctx, r, m, "corazon",
                  { llenar: 1.02, fuerza: num(r, 0.008, 0.020) });
  }

  // CYBER — dos variantes: el sigilo de púas (cyber.jpg) y el tribal con
  // volutas (cyber2.jpg). La tercera foto, cyber1.jpg, se quedó fuera: tiene el
  // interior claro y al calcarla sale hueca, sólo el borde de la línea.
  function piezaCyber(ctx, r, m) {
    piezaContorno(ctx, r, m, quiza(r, 0.5) ? "cyber" : "cyber2",
                  { llenar: 1.06, fuerza: num(r, 0.015, 0.038) });
  }

  // FLOR — las dos variantes que pidió, ahora calcadas: la margarita de
  // rotulador (flor_simple.jpg) y la amapola maciza con tallo y hojas
  // (flor2.jpg). flor3.jpg se quedó fuera: al calcarla salen los dos marcos
  // cuadrados, no las flores de dentro.
  // FLOR — cada variante por el camino que le va. La margarita es trazo limpio
  // de rotulador: se dibuja con lazos y sale distinta cada vez. La amapola es
  // una silueta orgánica que no sale apilando óvalos: esa se calca.
  function piezaFlor(ctx, r, m) {
    if (quiza(r, 0.55)) {
      if (esHueco(m)) return;
      florSimple(ctx, r);
    } else {
      piezaContorno(ctx, r, m, "flor_org", { llenar: 1.04, fuerza: num(r, 0.020, 0.045) });
    }
  }

  // FUEGO — su fire.jpg. Construido no se parecía y lo dijo dos veces: es una
  // línea caligráfica con dos bulbos y colas de pelo, y eso no sale de apilar
  // rizos. Calcado.
  function piezaFuego(ctx, r, m) {
    piezaContorno(ctx, r, m, "fuego", { llenar: 1.06, fuerza: num(r, 0.020, 0.048) });
  }

  // ================================================== GRAFFITY
  // Otro mundo, como dijo. Tres cosas hacen que un tag lea a spray:
  //   1. trazo gordo de punta redonda, de una pasada
  //   2. CHORRETONES que cuelgan y acaban en gota
  //   3. NUBE de puntos alrededor: densa pegada al trazo, rala al alejarse
  // El degradado de sus fotos no se puede tatuar en gris: se hace a puntos, que
  // es como se sombrea a mano. De cerca son puntos; de lejos, spray.

  // Dos números al azar con campana de Gauss (Box-Muller). Hace falta para que
  // la nube caiga como spray de verdad y no como confeti repartido por igual.
  function gauss(r) {
    const u = Math.max(1e-9, r()), v2 = r();
    const m = Math.sqrt(-2 * Math.log(u));
    return [m * Math.cos(2 * Math.PI * v2), m * Math.sin(2 * Math.PI * v2)];
  }

  function trazoGordo(ctx, pts, g) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = g;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }

  // El mismo trazo, pero perdiendo tinta por el camino. En un spray de verdad
  // el bote descarga al empezar y va soltando menos según arrastras: el trazo
  // nace sólido y muere a medias.
  //
  // El degradado se crea DENTRO de la transformación de la pieza, así que gira
  // con ella: si se creara fuera, todas las piezas de la hoja tendrían la parte
  // opaca mirando al mismo sitio y cantaría.
  function trazoDesvanecido(ctx, pts, g, a0, a1) {
    const p0 = pts[0], p1 = pts[pts.length - 1];
    // Dos puntos iguales no dan degradado: el navegador lo pinta transparente.
    if (p0[0] === p1[0] && p0[1] === p1[1]) { trazoGordo(ctx, pts, g); return; }
    const grd = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
    grd.addColorStop(0, "rgba(0,0,0," + a0 + ")");
    grd.addColorStop(1, "rgba(0,0,0," + a1 + ")");
    ctx.save();
    ctx.strokeStyle = grd;
    trazoGordo(ctx, pts, g);
    ctx.restore();
  }

  // Chorretón: baja estrechándose y acaba en una gota más gorda que el hilo.
  // Sin la gota parece una raya; con ella, pintura que ha corrido.
  function chorreton(ctx, x, y, largo, g) {
    tallo(ctx, [x, y], [x, y - largo * 0.35], [x, y - largo * 0.70], [x, y - largo],
          g, g * 0.42);
    bola(ctx, x, y - largo, g * 0.38);
  }

  function piezaGraffity(ctx, r, m) {
    if (esHueco(m)) return;
    const g = MIN * num(r, 2.6, 4.2);          // el trazo, bien gordo
    const alto = R * num(r, 0.78, 0.96);
    const ancho = R * num(r, 0.62, 0.88);

    // El glifo: dos o tres trazos largos que se cruzan. No es una letra
    // concreta a propósito — un tag no tiene por qué leerse.
    const trazos = [];
    const n = ent(r, 2, 3);
    for (let k = 0; k < n; k++) {
      const pts = [];
      const nudos = ent(r, 3, 4);
      for (let i = 0; i < nudos; i++) {
        const t = i / (nudos - 1);
        pts.push([num(r, -ancho, ancho) * (0.55 + 0.45 * t),
                  alto - 2 * alto * t * num(r, 0.75, 1.02)]);
      }
      trazos.push(pts);
      // Arranca opaco y acaba entre el 45% y el 60%. No siempre lo mismo: dos
      // trazos con exactamente la misma caída se ven hechos con plantilla.
      trazoDesvanecido(ctx, pts, g * num(r, 0.75, 1.15), 1, num(r, 0.45, 0.60));
    }

    // Chorretones: cuelgan de puntos del glifo.
    const nch = ent(r, 3, 6);
    for (let k = 0; k < nch; k++) {
      const t = trazos[Math.floor(r() * trazos.length) % trazos.length];
      const q = t[Math.floor(r() * t.length) % t.length];
      chorreton(ctx, q[0] + num(r, -g * 0.3, g * 0.3), q[1],
                alto * num(r, 0.45, 1.05), g * num(r, 0.42, 0.72));
    }

    // La nube. Se tiran puntos alrededor del trazo con desvío de campana:
    // pegados al trazo caen muchos, lejos casi ninguno. Eso hace un bote.
    // El tamaño del punto baja con la distancia al trazo. Antes no bajaba: el
    // radio salía en MIN*0.18-0.30 y `bola` no deja bajar de MIN*0.5, así que
    // TODOS los puntos acababan clavados en ese mínimo y la nube salía plana,
    // como sal esparcida. Ahora el punto de al lado del trazo nace gordo y se
    // va encogiendo hasta ese mínimo, que es el punto más pequeño que se puede
    // tatuar de verdad (una picada de aguja): por debajo no tiene sentido.
    // La nube se abre más que antes y lleva menos puntos. Con la nube pegada
    // al trazo y los puntos gordos, todo se fundía en un borrón negro y el
    // glifo desaparecía: el degradado estaba, pero no se veía nada.
    const sigma = g * num(r, 1.10, 1.90);
    const gotas = ent(r, 260, 460);
    const rp = MIN * num(r, 0.95, 1.35);
    for (let k = 0; k < gotas; k++) {
      const t = trazos[Math.floor(r() * trazos.length) % trazos.length];
      const i = Math.floor(r() * (t.length - 1));
      const u = r();
      const bx = t[i][0] + (t[i + 1][0] - t[i][0]) * u;
      const by = t[i][1] + (t[i + 1][1] - t[i][1]) * u;
      const gg = gauss(r);
      const px2 = bx + gg[0] * sigma, py2 = by + gg[1] * sigma;
      if (Math.abs(px2) > R * 1.15 || Math.abs(py2) > R * 1.15) continue;
      // `gg` ya viene en unidades de sigma, o sea que su longitud ES la
      // distancia al trazo medida en anchos de nube. Sirve tal cual.
      const lejos = Math.sqrt(gg[0] * gg[0] + gg[1] * gg[1]);
      // Los que caen encima del trazo no se tiran: ahí ya hay tinta maciza y
      // sólo servían para engordar el borrón.
      if (lejos < 0.45) continue;
      const merma = 1 / (1 + lejos * 0.95);
      bola(ctx, px2, py2, rp * merma * num(r, 0.80, 1.20));
    }
  }

  // ------------------------------------------------- piezas sueltas
  // DESTELLOS: un ramillete o una cadena. Son sus referencias 2 y 4.
  function piezaDestellos(ctx, r, m) {
    if (esHueco(m)) return;
    const cintura = num(r, 0.11, 0.17);
    if (quiza(r, 0.5)) {
      // Ramillete: tres destellos abriéndose desde un punto de abajo, cada uno
      // con el brazo largo apuntando al origen. Eso es lo que los ata.
      const baseY = -R * 0.98;
      const abre = num(r, 0.30, 0.46);
      for (let k = 0; k < 3; k++) {
        const t = k - 1;                                   // -1, 0, 1
        const ang = Math.PI / 2 + t * abre;
        const d = R * (k === 1 ? num(r, 1.42, 1.60) : num(r, 1.05, 1.25));
        const cx = Math.cos(ang) * d, cy = baseY + Math.sin(ang) * d;
        const tam = R * (k === 1 ? num(r, 0.30, 0.36) : num(r, 0.24, 0.30));
        // El brazo largo se come casi toda la distancia hasta la base.
        const largo = d * num(r, 0.72, 0.84);
        destello(ctx, cx, cy, [tam * num(r, 0.75, 1.05), tam * num(r, 0.80, 1.10),
                               largo, tam * num(r, 0.80, 1.10)],
                 cintura, ang + Math.PI * 1.5);
      }
    } else {
      // Cadena: tres destellos en fila con un vaivén, unidos por los brazos.
      const n = 3;
      const paso = R * num(r, 0.70, 0.84);
      const lado = quiza(r, 0.5) ? 1 : -1;
      const ys = [], xs = [], tams = [];
      for (let k = 0; k < n; k++) {
        ys.push(R * 0.98 - k * paso);
        xs.push(lado * R * num(r, 0.02, 0.30) * (k === 1 ? -1 : 1));
        tams.push(R * num(r, 0.26, 0.36));
      }
      for (let k = 0; k < n; k++) {
        const arriba = k > 0
          ? Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]) * num(r, 0.62, 0.78)
          : tams[k] * num(r, 0.9, 1.4);
        const abajo = k < n - 1
          ? Math.hypot(xs[k] - xs[k + 1], ys[k] - ys[k + 1]) * num(r, 0.62, 0.78)
          : tams[k] * num(r, 0.9, 1.4);
        destello(ctx, xs[k], ys[k], [arriba, tams[k] * num(r, 0.85, 1.15),
                                     abajo, tams[k] * num(r, 0.85, 1.15)],
                 cintura, num(r, -0.22, 0.22));
      }
    }
  }

  // LUNA: creciente con un destello en la boca, los brazos horizontales
  // saliéndose por los dos lados. Es su primera referencia.
  function piezaLunaConstruida(ctx, r, m) {
    if (esHueco(m)) return;
    const ra = R * num(r, 0.68, 0.84);
    const T = ra * num(r, 0.30, 0.54);
    // Girada siempre: con la boca clavada a la derecha las seis tiradas de una
    // tanda salían calcadas.
    const giro = num(r, -0.9, 0.9);
    creciente(ctx, ra, T, giro);
    ctx.save();
    if (giro) ctx.rotate(giro);
    // El destello va en el hueco de la boca, no en el centro del círculo.
    const cx = ra * num(r, 0.28, 0.50);
    // Los brazos de arriba y abajo tienen que verse: si se quedan cortos, lo
    // que se lee es una flecha, no un destello de cuatro puntas.
    const vert = ra * num(r, 0.58, 0.80);
    destello(ctx, cx, 0,
             [vert, ra * num(r, 0.60, 0.88),
              vert, (cx + ra) * num(r, 1.00, 1.10)],
             num(r, 0.10, 0.15), num(r, -0.12, 0.12));
    ctx.restore();
  }

  // ESPINAS: la luna rota y llena de pinchos de su tercera referencia. El
  // truco es que los pinchos NO salen rectos del borde: van barridos, unos
  // hacia un cuerno y otros hacia el otro, como los de una zarza.
  function piezaEspinasConstruida(ctx, r, m) {
    const ra = R * num(r, 0.80, 0.92);
    const T = ra * num(r, 0.14, 0.22);
    const giro = num(r, -0.6, 0.6);
    if (esHueco(m)) {
      // Cuatro calados repartidos por el lomo: sin ellos la banda es un churro
      // negro y a 4 cm se cierra del todo.
      ctx.save();
      ctx.rotate(giro);
      for (let k = 0; k < 4; k++) {
        const t = Math.PI * (0.45 + k * 0.36);
        bola(ctx, Math.cos(t) * (ra - T * 0.5), Math.sin(t) * (ra - T * 0.5),
             MIN * num(r, 0.7, 1.1));
      }
      ctx.restore();
      return;
    }
    const c = creciente(ctx, ra, T, giro);
    ctx.save();
    ctx.rotate(giro);
    // Lomo de fuera: de aA a 2π-aA es el arco que ha quedado dibujado.
    const desde = c.aA, hasta = Math.PI * 2 - c.aA;
    const n = ent(r, 9, 14);
    for (let k = 0; k < n; k++) {
      const t = desde + (hasta - desde) * ((k + num(r, 0.15, 0.85)) / n);
      const largo = ra * (quiza(r, 0.35) ? num(r, 0.30, 0.46) : num(r, 0.12, 0.26));
      const barrido = num(r, 0.35, 0.85) * (t > Math.PI ? 1 : -1);
      pincho(ctx, Math.cos(t) * (ra - T * 0.25), Math.sin(t) * (ra - T * 0.25),
             t + barrido, largo, MIN * num(r, 1.3, 2.1), num(r, -0.14, 0.14));
    }
    // Boca de dentro: pinchos hacia el hueco, más cortos.
    const m2 = ent(r, 4, 7);
    for (let k = 0; k < m2; k++) {
      const u = c.aB + (Math.PI * 2 - c.aB * 2) * ((k + num(r, 0.2, 0.8)) / m2);
      const px = c.d + Math.cos(u) * c.rb, py = Math.sin(u) * c.rb;
      pincho(ctx, px, py, u + Math.PI + num(r, -0.6, 0.6),
             ra * num(r, 0.10, 0.22), MIN * num(r, 1.1, 1.7), num(r, -0.12, 0.12));
    }
    ctx.restore();
  }

  // CORAZÓN: el gótico calado de su quinta referencia. La silueta se pinta
  // entera y los huecos se muerden en la segunda pasada; por eso el calado va
  // en el modo "hueco" y no como trazos blancos.
  function piezaCorazonMaciza(ctx, r, m) {
    // Ancho y alto NO son libres: la silueta ocupa 1.96·w de ancho y 1.20·h de
    // alto, así que con estos dos parecidos salía un corazón achatado de
    // polilla. w a dos tercios de h deja la proporción de la referencia.
    const h = R * num(r, 0.90, 0.96), w = h * num(r, 0.60, 0.67);
    if (esHueco(m)) {
      // Reja: dos lentes por lomo y una raja en medio. Es lo que le da el aire
      // gótico en vez de corazón de tarta.
      // Cuatro celdas por lomo, abiertas en abanico desde la muesca. Lo negro
      // que queda ENTRE ellas son las costillas: por eso se vacían celda a
      // celda en vez de abrir un hueco grande y volver a pintar barras — en la
      // pasada de calado no se puede repintar nada.
      const paso = Math.PI * num(r, 0.20, 0.24);
      const ini = Math.PI * num(r, 0.02, 0.06);
      for (const lado of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          ctx.save();
          ctx.translate(lado * w * 0.20, -h * 0.16);
          ctx.rotate(-lado * (ini + k * paso));
          lente(ctx, h * num(r, 0.12, 0.18), h * num(r, 0.50, 0.60), w * num(r, 0.30, 0.38));
          ctx.restore();
        }
      }
      // Galón: dos rajas en V justo encima de la punta, para que la mitad de
      // abajo no se quede como una mancha lisa.
      for (const lado of [-1, 1]) {
        ctx.save();
        ctx.translate(lado * w * 0.10, -h * 0.28);
        ctx.rotate(-lado * num(r, 2.3, 2.6));
        lente(ctx, 0, h * num(r, 0.26, 0.36), w * num(r, 0.12, 0.17));
        ctx.restore();
      }
      return;
    }
    corazonGotico(ctx, w, h);
    // Espinas: en los dos cuernos, en los costados y una lengüeta en la muesca.
    for (const lado of [-1, 1]) {
      // cuerno de la cresta
      pincho(ctx, lado * w * 0.42, h * 0.54,
             lado > 0 ? num(r, 0.95, 1.25) : Math.PI - num(r, 0.95, 1.25),
             h * num(r, 0.22, 0.34), MIN * num(r, 1.7, 2.5), num(r, -0.1, 0.1));
      // costado, en el punto más ancho
      pincho(ctx, lado * w * 0.94, h * 0.22,
             lado > 0 ? num(r, -0.20, 0.20) : Math.PI - num(r, -0.20, 0.20),
             w * num(r, 0.16, 0.28), MIN * num(r, 1.4, 2.0), num(r, -0.1, 0.1));
    }
    // La lengüeta de la muesca, apuntando hacia abajo.
    pincho(ctx, 0, h * 0.20, -Math.PI / 2, h * num(r, 0.16, 0.26), MIN * num(r, 2.2, 3.2), 0);
  }


  // ---------------------------------------------- cyber sigilism y fuego
  // Las tres referencias de su carpeta Cyber tienen algo que ninguna familia
  // de aquí hacía: son TALLO, no brazos. Un eje que sube y se retuerce, con
  // pinchos colgando a los lados. Y son finísimas — relleno medido de 0.03 a
  // 0.07, cuando lo más fino que había era la daga con 0.10.

  // Se calcula primero y se pinta después, en dos funciones, porque algunas
  // salen con espejo (su cyber1 mide 0.97) y hay que pintar el MISMO dibujo dos
  // veces. Sorteando al pintar, cada mitad saldría distinta.
  function planCyber(r) {
    const alto = R * num(r, 0.98, 1.14);
    const desvio = num(r, 0.22, 0.46);           // cuánto se va de lado el eje
    const eje = {
      p0: [num(r, -0.08, 0.08) * R, -alto],
      c1: [num(r, -1, 1) * desvio * R, -alto * num(r, 0.25, 0.45)],
      c2: [num(r, -1, 1) * desvio * R, alto * num(r, 0.25, 0.45)],
      p1: [num(r, -0.08, 0.08) * R, alto],
      g0: MIN * num(r, 1.5, 2.4),
      g1: MIN * 0.5,
    };
    const n = ent(r, 7, 12);
    const pinchos = [];
    for (let k = 0; k < n; k++) {
      const t = 0.06 + 0.86 * ((k + num(r, 0.2, 0.8)) / n);
      const q = bez(eje.p0, eje.c1, eje.c2, eje.p1, t);
      const q2 = bez(eje.p0, eje.c1, eje.c2, eje.p1, Math.min(1, t + 0.02));
      const tang = Math.atan2(q2[1] - q[1], q2[0] - q[0]);
      const lado = (k % 2 === 0) ? 1 : -1;
      pinchos.push({
        x: q[0], y: q[1],
        // Sale del eje casi en perpendicular pero barrido hacia la punta: eso
        // es lo que le da aire de zarza en vez de espina de pescado.
        ang: tang + lado * num(r, 0.55, 1.15),
        largo: R * num(r, 0.16, 0.52) * (1 - t * 0.35),
        base: MIN * num(r, 1.1, 1.9),
        curva: num(r, -0.18, 0.18),
        cria: quiza(r, 0.35),
      });
    }
    return {
      eje: eje, pinchos: pinchos,
      espejo: quiza(r, 0.45),
      huecos: [num(r, 0.2, 0.4), num(r, 0.45, 0.65), num(r, 0.7, 0.9)],
    };
  }

  function pintarCyber(ctx, plan) {
    const e = plan.eje;
    tallo(ctx, e.p0, e.c1, e.c2, e.p1, e.g0, e.g1);
    for (const s of plan.pinchos) {
      pincho(ctx, s.x, s.y, s.ang, s.largo, s.base, s.curva);
      if (s.cria) {
        // Pincho colgado del pincho: es lo que enreda la silueta y la separa
        // de un peine.
        const mx = s.x + Math.cos(s.ang) * s.largo * 0.45;
        const my = s.y + Math.sin(s.ang) * s.largo * 0.45;
        pincho(ctx, mx, my, s.ang - 0.9, s.largo * 0.45, s.base * 0.7, s.curva);
      }
    }
  }

  function piezaCyberConstruida(ctx, r, m) {
    const plan = planCyber(r);
    if (esHueco(m)) {
      const e = plan.eje;
      for (const t of plan.huecos) {
        const q = bez(e.p0, e.c1, e.c2, e.p1, t);
        bola(ctx, q[0], q[1], MIN * 0.55);
      }
      return;
    }
    pintarCyber(ctx, plan);
    if (plan.espejo) {
      ctx.save();
      ctx.scale(-1, 1);
      pintarCyber(ctx, plan);
      ctx.restore();
    }
  }

  // FUEGO: su fire.jpg mide 0.31 de proporción y 0.06 de relleno — una llama
  // muy alta y muy estrecha. Son lenguas que arrancan del mismo eje y se
  // curvan alternando de lado.
  function piezaFuegoCintas(ctx, r, m) {
    if (esHueco(m)) return;
    const alto = R * num(r, 1.02, 1.16);
    const n = ent(r, 3, 5);
    for (let k = 0; k < n; k++) {
      const y0 = -alto + 2 * alto * (k / n) * num(r, 0.80, 1.00);
      const lado = (k % 2 === 0) ? 1 : -1;
      const largo = (alto - y0) * num(r, 0.55, 0.85);
      // El desvío va corto a propósito: con curvas anchas deja de ser una llama
      // y se convierte en una voluta. Manda la medida de su foto — 0.31 de
      // proporción es un ancho por debajo de un tercio del alto.
      const cur = num(r, 0.55, 1.05) * lado;
      tallo(ctx,
            [0, y0],
            [cur * R * 0.85, y0 + largo * 0.34],
            [-cur * R * 0.55, y0 + largo * 0.74],
            [cur * R * 0.28, y0 + largo],
            MIN * num(r, 1.7, 2.8), MIN * 0.35);
    }
  }


  // CORAZÓN — su heart.jpg. Lo que fallaba: yo pintaba un corazón MACIZO y le
  // mordía ranuras. El suyo es al revés — un armazón de línea, con dos ruedas
  // de radios dentro de los lomos y una V de barras en la mitad de abajo.
  // Tocando el calado no se llegaba nunca; había que darle la vuelta.
  function piezaCorazonLinea(ctx, r, m) {
    if (esHueco(m)) return;        // ya no hay calado: el dibujo ES la línea
    const h = R * num(r, 0.86, 0.96);
    const w = h * num(r, 0.70, 0.80);
    const g = MIN * num(r, 1.5, 2.0);

    corazonGotico(ctx, w, h, g);

    // Las dos ruedas de los lomos: un aro con radios, como naranja partida.
    for (const lado of [-1, 1]) {
      const rr = w * num(r, 0.25, 0.31);
      ctx.save();
      ctx.translate(lado * w * 0.45, h * 0.28);
      ctx.lineWidth = g * 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
      const radios = ent(r, 3, 4);
      const giro = num(r, 0, Math.PI);
      for (let k = 0; k < radios; k++) {
        const a = giro + k * Math.PI * 2 / radios;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        ctx.stroke();
      }
      ctx.restore();
    }

    // La V de abajo: dos barras que bajan de los costados y se juntan en la
    // punta. Son lo más gordo del dibujo y lo que le da aire de escudo.
    for (const lado of [-1, 1]) {
      tallo(ctx,
            [lado * w * 0.62, h * 0.14],
            [lado * w * 0.50, -h * 0.10],
            [lado * w * 0.26, -h * 0.34],
            [0, -h * 0.56],
            g * num(r, 1.8, 2.6), g * 0.6);
    }
    // Y una lengüeta que baja desde la muesca, entre las dos barras.
    pincho(ctx, 0, h * 0.14, -Math.PI / 2, h * num(r, 0.26, 0.36), g * num(r, 1.6, 2.4), 0);

    // Espinas de fuera: dos en las crestas, dos en los costados, una arriba.
    for (const lado of [-1, 1]) {
      pincho(ctx, lado * w * 0.40, h * 0.52,
             lado > 0 ? num(r, 0.95, 1.30) : Math.PI - num(r, 0.95, 1.30),
             h * num(r, 0.20, 0.32), g * num(r, 1.2, 1.8), num(r, -0.1, 0.1));
      pincho(ctx, lado * w * 0.90, h * 0.20,
             lado > 0 ? num(r, -0.25, 0.15) : Math.PI - num(r, -0.25, 0.15),
             w * num(r, 0.14, 0.26), g * num(r, 1.1, 1.6), num(r, -0.1, 0.1));
    }
    pincho(ctx, 0, h * 0.20, Math.PI / 2, h * num(r, 0.10, 0.18), g * num(r, 1.2, 1.8), 0);
  }

  // FUEGO — su fire.jpg. Antes eran cuatro cintas apiladas y salía una maraña.
  // Lo suyo es UNA línea larguísima que baja, se enrosca a media altura y se va
  // en cola de pelo, con un par de lenguas cortas arriba y un punto suelto.
  function piezaFuegoCaligrafico(ctx, r, m) {
    if (esHueco(m)) return;
    const alto = R * num(r, 1.00, 1.14);
    const g = MIN * num(r, 1.3, 1.9);
    const lado = quiza(r, 0.5) ? 1 : -1;
    const ancho = R * num(r, 0.20, 0.30);   // su llama mide 0.31: es estrecha

    // El eje: arranca fino arriba, cruza y sale por abajo en punta de aguja.
    tallo(ctx,
          [lado * ancho * 0.30, alto],
          [-lado * ancho * 1.10, alto * 0.30],
          [lado * ancho * 1.20, -alto * 0.35],
          [-lado * ancho * 0.35, -alto],
          g * 0.45, g * 0.30);
    // El cuerpo: dos o tres rizos encajados a media altura. La parte gorda.
    const nr = ent(r, 3, 4);
    for (let k = 0; k < nr; k++) {
      const y = alto * num(r, -0.22, 0.22);
      const x = lado * ancho * num(r, -0.35, 0.45);
      rizoDesde(ctx, x, y, ancho * num(r, 0.62, 1.00),
                num(r, 0.75, 1.25), g * num(r, 1.7, 2.6),
                quiza(r, 0.5) ? 1 : -1, num(r, 0, Math.PI * 2));
    }
    // Las lenguas de arriba: cortas, curvadas y acabadas en pelo.
    const nl = ent(r, 2, 3);
    for (let k = 0; k < nl; k++) {
      const y0 = alto * num(r, 0.05, 0.30);
      const lg = alto * num(r, 0.35, 0.62);
      const cur = lado * (k % 2 === 0 ? 1 : -1) * ancho * num(r, 0.55, 1.05);
      tallo(ctx,
            [lado * ancho * num(r, -0.25, 0.25), y0],
            [cur, y0 + lg * 0.40],
            [-cur * 0.55, y0 + lg * 0.75],
            [cur * 0.30, y0 + lg],
            g * num(r, 0.9, 1.4), g * 0.22);
    }
    // El punto suelto: en su foto hay uno y es lo que remata la composición.
    bola(ctx, lado * ancho * num(r, -0.5, 0.5), alto * num(r, -0.15, 0.15),
         g * num(r, 0.8, 1.2));
  }

  // FLOR — dos variantes, porque en su carpeta hay dos cosas muy distintas.
  //  simple:   flor.jpg, flor1.jpg y flor_simple.jpg. Margarita de rotulador,
  //            pétalos que son lazos abiertos y un tallo que ondula. Trazo
  //            gordo y parejo, como dibujada de una tirada.
  //  organica: flor2.jpg y flor3.jpg. Silueta rellena, capullo cerrado, tallo
  //            fino y dos hojas de punta.
  function piezaFlorConstruida(ctx, r, m) {
    if (esHueco(m)) return;
    if (quiza(r, 0.55)) florSimple(ctx, r); else florOrganica(ctx, r);
  }

  // La margarita de rotulador de flor_simple.jpg. Cuatro cosas la definen, y
  // las cuatro estaban mal antes:
  //
  //   1. Los pétalos son ACEITUNAS LARGAS, no gotas gordas: en la foto miden
  //      casi tres veces más de largo que de ancho.
  //   2. Van SUELTOS del centro. No se tocan entre ellos ni tocan el punto de
  //      en medio; queda blanco alrededor del corazón.
  //   3. No están repartidos a compás. Se agolpan dos por un lado y dejan un
  //      claro por el otro, como cuando dibujas rápido sin medir.
  //   4. El tallo es LARGO — más de la mitad del dibujo — y hace una ese que se
  //      va de lado antes de bajar. La cabeza es lo pequeño, no lo grande.
  //
  // Antes eran seis gotas iguales clavadas a compás en un mismo punto: salía
  // una rosca de engranaje.
  function florSimple(ctx, r) {
    const g = MIN * num(r, 1.9, 2.6);        // rotulador gordo
    const n = ent(r, 5, 6);
    const cy = R * num(r, 0.50, 0.60);       // la cabeza arriba del todo
    const pet = R * num(r, 0.38, 0.50);
    // Petalo gordo y redondo, no lengueta: en sus tres fotos son lobulos.
    const anc = pet * num(r, 0.34, 0.46);
    // EL CORAZON MANDA. Estaba al 13-18% del petalo y se perdia; en sus fotos
    // ocupa como un tercio de la flor y se ve desde lejos.
    const rc = pet * num(r, 0.30, 0.42);
    // Y PEGADO. Antes se separaba un grosor de trazo entero y la flor salia
    // desmontada, con el centro flotando en un agujero. Ahora el petalo
    // arranca justo sobre el aro y lo toca.
    const sep = rc * num(r, 0.90, 1.02);

    ctx.save();
    ctx.translate(0, cy);
    const giro = num(r, 0, Math.PI * 2);
    const paso = Math.PI * 2 / n;
    for (let k = 0; k < n; k++) {
      ctx.save();
      // El desvío del reparto es lo que la hace parecer dibujada a mano. A
      // compás exacto, hasta con los tamaños cambiados, sigue leyendo a rosca.
      // Menos desvio que antes: al 30% se abrian huecos y se montaban petalos.
      // Al 14% sigue leyendo a mano, pero la corona queda cerrada.
      ctx.rotate(giro + k * paso + num(r, -paso * 0.14, paso * 0.14));
      ctx.translate(0, sep);                 // suelto del centro
      ovalo(ctx, pet * num(r, 0.78, 1.18), anc * num(r, 0.82, 1.16), g,
            num(r, -0.18, 0.18));
      ctx.restore();
    }
    // El corazón: un aro chico y vacío. En la foto se ve el blanco dentro, así
    // que no lleva punto — rellenarlo le quitaba justo eso.
    ctx.lineWidth = g;
    ctx.beginPath();
    ctx.arc(0, 0, rc, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // El tallo: baja haciendo una ese ancha y sale por un lado abajo del todo.
    const lado = quiza(r, 0.5) ? 1 : -1;
    const abajo = -R * num(r, 1.02, 1.16);
    const arranque = cy - sep - pet * num(r, 0.30, 0.55);
    linea(ctx,
          [0, arranque],
          [lado * R * num(r, 0.26, 0.46), arranque - (arranque - abajo) * 0.30],
          [-lado * R * num(r, 0.16, 0.36), abajo + (arranque - abajo) * 0.28],
          [-lado * R * num(r, 0.10, 0.30), abajo], g);

    // La hoja: otro lazo, colgado a media altura y mirando hacia fuera. Aquí sí
    // va lazo y no óvalo — en la foto la hoja acaba en punta donde toca el
    // tallo, al revés que los pétalos.
    const th = num(r, 0.42, 0.60);           // dónde del tallo, de arriba abajo
    const hy = arranque + (abajo - arranque) * th;
    ctx.save();
    ctx.translate(lado * R * num(r, 0.02, 0.16), hy);
    ctx.rotate(-lado * num(r, 1.9, 2.5));
    // Hoja mas larga y mas estrecha: unas 3,5 veces mas larga que ancha, como
    // la de sus fotos. Antes era el doble y salia una gota, no una hoja.
    lazo(ctx, R * num(r, 0.32, 0.46), R * num(r, 0.085, 0.125), g, num(r, -0.2, 0.2));
    ctx.restore();
  }

  function florOrganica(ctx, r) {
    const cy = R * num(r, 0.40, 0.52);
    const tam = R * num(r, 0.34, 0.46);
    ctx.save();
    ctx.translate(0, cy);
    ctx.rotate(num(r, -0.35, 0.35));
    // Capullo: tres o cuatro pétalos macizos encajados, el de delante tapando.
    const n = ent(r, 3, 4);
    for (let k = 0; k < n; k++) {
      ctx.save();
      ctx.rotate(-0.5 + k * (1.0 / Math.max(1, n - 1)));
      hoja(ctx, -tam * 0.15, tam * num(r, 1.05, 1.35), tam * num(r, 0.62, 0.86),
           num(r, 0.30, 0.60));
      ctx.restore();
    }
    ctx.restore();

    // Tallo fino y casi recto: en su foto la flor pesa y el tallo sólo aguanta.
    const lado = quiza(r, 0.5) ? 1 : -1;
    const abajo = -R * num(r, 0.95, 1.12);
    const t0 = [0, cy + tam * 0.10];              // dentro de la cabeza
    const t1 = [lado * R * num(r, 0.06, 0.18), cy * 0.20];
    const t2 = [lado * R * num(r, 0.10, 0.26), abajo * 0.55];
    const t3 = [lado * R * num(r, 0.02, 0.16), abajo];
    tallo(ctx, t0, t1, t2, t3, MIN * num(r, 1.6, 2.4), MIN * 0.8);
    // Dos hojas de punta, una a cada lado y a distinta altura.
    for (const s2 of [-1, 1]) {
      const q = bez(t0, t1, t2, t3, num(r, 0.35, 0.70));
      ctx.save();
      ctx.translate(q[0], q[1]);
      ctx.rotate(-s2 * num(r, 1.05, 1.50));
      hoja(ctx, 0, R * num(r, 0.34, 0.52), R * num(r, 0.13, 0.20), num(r, 0.15, 0.45));
      ctx.restore();
    }
  }

  // ============================================================== RECETAS
  // Cresta y daga se quitaron a petición suya. El código que las dibujaba
  // (brazoCresta, piezaDaga) sigue en el fichero pero ya no se llama desde
  // ningún sitio: volver a ponerlas es devolverlas a esta lista y a la mezcla.
  // Rama fuera: nunca llegó a leerse como rama y no hay foto con la que
  // calcarla. Cresta y daga, fuera también a petición suya. El código que las
  // dibujaba sigue en el fichero pero ya no se llama desde ningún sitio.
  const FAMILIAS = {
    roseton:  "ROSETÓN",
    cruz:     "CRUZ",
    flor:     "FLOR",       // sale simple o orgánica
    diamante: "DIAMANTE",
    estrella: "ESTRELLA",
    // Las cuatro de abajo NO son mandalas: no giran ni hacen espejo. Son las
    // piezas sueltas que pidió — destellos, lunas, espinas, corazón.
    destellos: "DESTELLOS",
    luna:      "LUNA",
    espinas:   "ESPINAS",
    corazon:   "CORAZÓN",
    cyber:     "CYBER",
    fuego:     "FUEGO",
    ornamental: "ORNAMENTAL",   // sale lis o cenefa
    graffity:  "GRAFFITY",
  };

  // Las que se dibujan de una pieza en vez de repartir un brazo n veces.
  const SUELTAS = {
    destellos: piezaDestellos, luna: piezaLuna,
    espinas: piezaEspinas, corazon: piezaCorazon,
    cyber: piezaCyber, fuego: piezaFuego, ornamental: piezaOrnamental,
    graffity: piezaGraffity,
    // FLOR deja de ser radial: sus cinco referencias tienen TALLO, y un tallo
    // no se reparte en n brazos girados. La flor redonda se la queda el
    // rosetón, que es lo que la vieja hacía en realidad.
    flor: piezaFlor,
  };

  function receta(r, familiaPedida) {
    const familia = (familiaPedida && FAMILIAS[familiaPedida])
      ? familiaPedida
      // RAMA no entra en la mezcla: todavía se lee como bolas en un palo en vez
      // de como una rama, y no vale colarla entre las buenas. Sigue disponible
      // eligiéndola a mano en el selector, para poder afinarla el día que haya
      // una foto de referencia con la que calcarla.
      : una(r, ["roseton", "roseton", "cruz", "cruz", "cruz",
                "estrella", "estrella", "flor", "flor", "diamante",
                "destellos", "destellos", "luna", "luna", "espinas", "corazon",
                "cyber", "cyber", "fuego", "ornamental", "ornamental",
                "graffity", "graffity"]);

    if (SUELTAS[familia]) return { familia, n: 1, giro: 0, cfg: {} };

    if (familia === "daga") return { familia, n: 1, giro: 0, cfg: {} };

    // Sin espejo y sin centro: es una rama suelta, no una pieza simétrica.
    if (familia === "rama") return { familia, n: 1, giro: 0, sinEspejo: true, centro: false, cfg: {} };

    if (familia === "cresta") {
      const alto = R * num(r, 1.05, 1.45);
      return {
        familia, n: 1, giro: 0, centro: false,
        cfg: {
          alto: alto,
          anchoEje: num(r, 0.13, 0.19),
          anchoLat: num(r, 0.11, 0.16),
          largoLat: num(r, 0.52, 0.68),
          curva: num(r, 0.55, 0.90),
          abre: num(r, 1.00, 1.35),
          salida: alto * num(r, 0.04, 0.12),
          grosorTallo: MIN * num(r, 2.4, 3.6),
          rizoAng: num(r, 1.4, 2.6),
          bulbo: quiza(r, 0.6),
          hojas: quiza(r, 0.75),
          hojaTipo: una(r, ["corazon", "loba"]),
          brazoBajo: quiza(r, 0.6),
          banda: quiza(r, 0.5),
          flor: quiza(r, 0.35),
          calado: quiza(r, 0.3),
          bajar: alto * 0.42,
        },
      };
    }

    if (familia === "flor") {
      const n = una(r, [4, 4, 5, 6]);
      return {
        familia, n, giro: quiza(r, 0.4) ? Math.PI / n : 0,
        cfg: {
          y: R * 0.03,
          // Cortos y anchos. Con pétalos largos salía una estrella de mar, no
          // la flor maciza de la referencia.
          largo: R * num(r, 0.46, 0.64),
          ancho: R * num(r, 0.34, 0.50),
          puntaX: num(r, 0.20, 0.55),
          calado: quiza(r, 0.6),
          // Segundo anillo de pétalos chicos en los huecos: es lo que le da
          // cuerpo y la separa de una flor de guardería.
          segundo: quiza(r, 0.65),
          medio: Math.PI / n,      // justo en el hueco entre dos pétalos
        },
      };
    }

    if (familia === "diamante") {
      return {
        familia, n: 4, giro: quiza(r, 0.5) ? Math.PI / 4 : 0,
        // El contorno se pinta una vez en `pieza`, no por brazo: cuatro barras
        // giradas se pasaban de largo por los vértices y salía un aspa.
        aro: {
          forma: quiza(r, 0.72) ? "rombo" : "circulo",
          // Ceñido: con el aro casi en el borde, el ornamento de dentro se veía
          // como una mota perdida en medio de un plato vacío.
          radio: R * num(r, 0.66, 0.80),
          grosor: MIN * num(r, 1.9, 3.2),
        },
        cfg: { calado: quiza(r, 0.4), hojaDentro: true, puntas: quiza(r, 0.7) },
      };
    }

    if (familia === "cruz") {
      // El pie sale de la medida: proporcion = 2/(1+pie). Sus cruces dan 0.60 y
      // 0.65, o sea un pie de 2.1 a 2.3. Se deja 2.0-2.5 para que varíen.
      const pie = num(r, 2.0, 2.5);
      // Y el largo sale de que quepa: el alto entero es largo*(1+pie), y no
      // puede pasar de 1.9·R sin salirse del lienzo.
      const L = R * num(r, 0.52, 0.64);
      return {
        familia, n: 4, giro: 0,
        centroR: MIN * num(r, 1.2, 1.9),
        // Con el pie, el dibujo deja de estar centrado: cuelga hacia abajo. Se
        // sube media diferencia para que la pieza quede en medio del lienzo.
        subir: L * (pie - 1) / 2,
        cfg: {
          largo: L,
          pie: pie,
          // Afinadas: sus cruces tienen 0.10-0.13 de relleno y las mías tenían
          // 0.34-0.65. Eran brazos de barra, no de cruz gótica.
          cuello: R * num(r, 0.030, 0.062),   // lo estrecho, junto al centro
          cuerno: R * num(r, 0.12, 0.23),     // lo ancho, en los cuernos
          cuernoY: num(r, 0.58, 0.86),
          puntaCentral: quiza(r, 0.55),
          calado: quiza(r, 0.45),
        },
      };
    }

    if (familia === "estrella") {
      // Sin agujas queda el aspa de cuatro dardos; con ellas, la estrella de
      // ocho puntas. Son las dos últimas referencias, y sólo cambia esta línea.
      const conAgujas = quiza(r, 0.55);
      return {
        familia, n: 1, giro: 0, sinEspejo: true, centro: false,
        cfg: {
          agujas: conAgujas,
          hueco: R * num(r, 0.06, 0.13),
          largoAguja: R * num(r, 0.92, 1.02),
          anchoAguja: R * num(r, 0.17, 0.26),
          huecoDardo: conAgujas ? R * num(r, 0.06, 0.12) : 0,
          largoDardo: conAgujas ? R * num(r, 0.42, 0.58) : R * num(r, 0.95, 1.05),
          anchoDardo: R * num(r, 0.19, 0.26),
        },
      };
    }

    // rosetón
    const n = una(r, [4, 4, 4, 6, 8]);
    const cuantos = ent(r, 2, 3);
    const anillos = [];
    let y = R * num(r, 0.06, 0.13);
    for (let k = 0; k < cuantos; k++) {
      const ultimo = k === cuantos - 1;
      const largo = R * num(r, 0.26, 0.40) * (1 + k * 0.12);
      const ancho = Math.max(MIN * 2.0, R * num(r, 0.11, 0.19) * (1 + k * 0.10));
      anillos.push({
        y, largo, ancho,
        abre: num(r, 0.35, 0.85),
        puntaX: num(r, 0.02, 0.30),
        eje: k === 0 || quiza(r, 0.5),
        bola: ultimo || quiza(r, 0.4),
        bolaR: Math.max(MIN * 0.8, ancho * num(r, 0.28, 0.42)),
        rizo: quiza(r, 0.55),
        calado: quiza(r, 0.45),
      });
      y += largo * num(r, 0.62, 0.85);
      if (y > R * 0.72) break;
    }
    return { familia, n, giro: quiza(r, 0.3) ? Math.PI / n : 0, anillos, cfg: {} };
  }

  // ============================================================ SUAVIZADO
  // Lo que ella señaló: las piezas hechas de trozos apilados se ven rígidas
  // porque en cada empalme queda una esquina viva. Esto lo arregla de una vez
  // para toda la pieza — se desenfoca y se vuelve a cortar por la mitad. Es la
  // manera de redondear de verdad: las esquinas de fuera se redondean y las
  // muescas de dentro se rellenan, las dos con el radio del desenfoque, sin
  // tener que tocar ni un trazo del dibujo.
  //
  // El radio va CORTO a propósito: a 4 cm, 8 px de este lienzo son 0.27 mm.
  // Quita el canto de los empalmes y deja las puntas donde estaban.
  function suavizar(canvas, sigma) {
    if (!sigma) return;
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tc = tmp.getContext("2d");
    tc.filter = "blur(" + sigma + "px)";
    tc.drawImage(canvas, 0, 0);
    tc.filter = "none";
    const img = tc.getImageData(0, 0, tmp.width, tmp.height);
    const a = img.data;
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] >= 128) { a[i] = 255; a[i - 3] = 0; a[i - 2] = 0; a[i - 1] = 0; }
      else a[i] = 0;
    }
    tc.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 1;
  }

  // Cuánto se suaviza cada familia. Las que se montan apilando trozos son las
  // que lo necesitan. Las que ya se dibujan de una sola curva, o las que viven
  // de tener la punta afilada, van a cero: suavizarlas sólo les quita filo.
  // Las familias que se resiguen de una foto NO se suavizan: la foto ya trae el
  // trazo bueno, y desenfocarla sólo le quitaría las puntas.
  const SUAVE = {
    roseton: 9, diamante: 8,
    cruz: 4, ornamental: 4, corazon: 0, flor: 0,
    // Graffity a cero: la nube de spray son puntos sueltos a propósito, y
    // suavizar los pegaría entre ellos hasta hacer una mancha.
    graffity: 0, luna: 3,
    // La luna lleva más porque su foto tiene grano y el calco lo arrastra.
    luna: 8,
    estrella: 0, destellos: 0, espinas: 0, cyber: 0, fuego: 0,
  };

  // ============================================================== PIEZA
  // Pinta una pieza entera en el lienzo que se le pase. Fondo transparente y
  // tinta negra: es lo que espera la galería.
  // Caja de la tinta, medida en pequeño. No hace falta precision al pixel: solo
  // saber si se sale del cuadro y por cuanto. Mirar 300x300 en vez de 2000x2000
  // es ~50 veces menos trabajo.
  function cajaTinta(cv) {
    const N = 300;
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(cv, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (d[(j * N + i) * 4 + 3] > 8) {
          if (i < x0) x0 = i;
          if (i > x1) x1 = i;
          if (j < y0) y0 = j;
          if (j > y1) y1 = j;
        }
      }
    }
    if (x1 < 0) return null;
    const k = cv.width / N;
    // Una celda de holgura por cada lado: la rejilla es gruesa.
    return {
      x: Math.max(0, (x0 - 1) * k), y: Math.max(0, (y0 - 1) * k),
      w: Math.min(cv.width, (x1 + 2) * k) - Math.max(0, (x0 - 1) * k),
      h: Math.min(cv.height, (y1 + 2) * k) - Math.max(0, (y0 - 1) * k),
    };
  }

  function pieza(canvas, semilla, familiaPedida) {
    // Se dibuja en un lienzo MAS GRANDE que el de salida.
    //
    // Varias familias llegan a R*1.6 desde el centro, y el borde del cuadro
    // esta en R*1.14: lo que pasaba de ahi se cortaba en seco. Con holgura cabe
    // todo, y al final se encaja en el cuadro de siempre. Lo que ya cabia se
    // copia tal cual, sin encoger, asi que esas piezas salen igual que antes.
    const HOLGURA = 1.7;
    const GRANDE = Math.round(LADO * HOLGURA);
    const grande = document.createElement("canvas");
    grande.width = GRANDE; grande.height = GRANDE;
    const ctx = grande.getContext("2d");
    ctx.clearRect(0, 0, GRANDE, GRANDE);

    const rec = receta(rng(semilla), familiaPedida);

    // Dos pasadas: primero toda la tinta, después los calados. Si se mezclaran,
    // un pétalo pintado más tarde taparía el hueco del de al lado.
    for (const modo of ["tinta", "hueco"]) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(GRANDE / 2, GRANDE / 2);
      ctx.scale(1, -1);                    // +Y hacia fuera
      ctx.fillStyle = "#000000";
      ctx.strokeStyle = "#000000";
      ctx.globalCompositeOperation = modo === "hueco" ? "destination-out" : "source-over";

      if (SUELTAS[rec.familia]) {
        SUELTAS[rec.familia](ctx, rng(semilla + 7), modo);
      } else if (rec.familia === "daga") {
        piezaDaga(ctx, rng(semilla + 7), modo);
      } else if (rec.familia === "rama") {
        piezaRama(ctx, rng(semilla + 7), modo);
      } else if (rec.familia === "estrella") {
        piezaEstrella(ctx, rng(semilla + 7), modo, rec.cfg);
      } else {
        // El aro y el centro: una sola vez, no por brazo
        if (modo === "tinta" && rec.aro) aro(ctx, rec.aro);
        // La cresta crece hacia arriba desde su base: sin bajarla se sale por
        // arriba y deja todo el hueco de abajo vacío.
        if (rec.familia === "cresta") ctx.translate(0, -rec.cfg.bajar);
        // La cruz cuelga del pie: se sube para que no quede pegada abajo.
        if (rec.familia === "cruz") ctx.translate(0, rec.subir);
        if (modo === "tinta" && rec.centro !== false) {
          const rc = rng(semilla + 3);
          const rad = rec.centroR != null ? rec.centroR : Math.max(MIN * 1.1, R * num(rc, 0.06, 0.12));
          if (rec.familia !== "flor" || !rec.cfg.calado) bola(ctx, 0, 0, rad);
        }
        for (let k = 0; k < rec.n; k++) {
          const a = rec.giro + (k / rec.n) * Math.PI * 2;
          for (const espejo of (rec.sinEspejo ? [1] : [1, -1])) {
            ctx.save();
            ctx.rotate(a);
            ctx.scale(espejo, 1);
            const rb = rng(semilla + 11);
            if (rec.familia === "roseton") brazoRoseton(ctx, rb, modo, rec);
            else if (rec.familia === "cruz") brazoCruz(ctx, rb, modo, rec.cfg, k, rec.n);
            else if (rec.familia === "flor") brazoFlor(ctx, rb, modo, rec.cfg);
            else if (rec.familia === "diamante") brazoRombo(ctx, rb, modo, rec.cfg);
            else if (rec.familia === "cresta") brazoCresta(ctx, rb, modo, rec.cfg);
            ctx.restore();
          }
        }
      }
      ctx.restore();
    }
    // ---- encajar en el cuadro de salida ----
    canvas.width = LADO;
    canvas.height = LADO;
    const salida = canvas.getContext("2d");
    salida.clearRect(0, 0, LADO, LADO);
    const borde = (GRANDE - LADO) / 2;
    const caja = cajaTinta(grande);
    if (!caja) {
      // Nada dibujado: no hay que encajar nada.
    } else if (caja.x >= borde && caja.y >= borde &&
               caja.x + caja.w <= borde + LADO && caja.y + caja.h <= borde + LADO) {
      // Cabia de sobra: se copia el centro tal cual, sin tocar el tamaño.
      salida.drawImage(grande, borde, borde, LADO, LADO, 0, 0, LADO, LADO);
    } else {
      // Se salia: se encoge lo justo y se centra. Nunca se agranda.
      const margen = LADO * 0.03;
      const hueco = LADO - margen * 2;
      const esc = Math.min(1, hueco / caja.w, hueco / caja.h);
      const dw = caja.w * esc, dh = caja.h * esc;
      salida.drawImage(grande, caja.x, caja.y, caja.w, caja.h,
        (LADO - dw) / 2, (LADO - dh) / 2, dw, dh);
    }
    grande.width = grande.height = 1;
    suavizar(canvas, SUAVE[rec.familia] || 0);
    return { familia: rec.familia, simetria: rec.n, semilla: semilla };
  }

  // Una tanda de piezas distintas. Las semillas van seguidas para que «otra
  // vuelta» sea de verdad otra tanda y no vuelva a caer en las mismas.
  // `filtro(info)` es opcional y decide si una pieza vale. Se usa para el
  // aprendizaje: la ficha de una familia que ella ha marcado mal se descarta y
  // se prueba otra semilla. Si tras varios intentos no sale ninguna que pase,
  // se acepta la ultima — mas vale una pieza que un hueco.
  function tanda(n, desde, familia, filtro) {
    const out = [];
    const INTENTOS = 6;
    let salto = 0;
    for (let i = 0; i < n; i++) {
      const cv = document.createElement("canvas");
      let info = null;
      for (let k = 0; k < INTENTOS; k++) {
        info = pieza(cv, desde + (i + salto) * 9973, familia);   // primo: no se repite el patrón
        if (!filtro || filtro(info)) break;
        salto += n;            // otra semilla lejos, no la de al lado
      }
      out.push({ canvas: cv, familia: info.familia, simetria: info.simetria, semilla: info.semilla });
    }
    return out;
  }

  root.KAOS_MANDALA = {
    LADO: LADO, FAMILIAS: FAMILIAS,
    pieza: pieza, tanda: tanda,
  };
})(window);
