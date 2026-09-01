/* KAOS_LIMPIAR — deja un diseño escaneado como si lo hubiera pasado a vectorial.
 *
 * QUIEN LO LLAMA: scan.js (la pantalla de revision de LIBRETA), a traves de
 * KAOS_LIMPIAR.vectorizar(lienzo, opciones). Nadie mas. No hay otra copia de
 * esto en el proyecto.
 *
 * QUE QUIERE DECIR "LIMPIAR" AQUI: que el trazo salga firme y seguro, como
 * redibujado con la pluma en digital. No es quitarle ruido a una foto. Es
 * que el borde deje de temblar — pero SIN redondear las puntas.
 *
 * Historia de los tres intentos, porque explica por que esta hecho asi:
 *
 *   1o (fallido) — quitar puntos del contorno con Douglas-Peucker. El temblor
 *      no esta en los PUNTOS, esta en la FORMA: aunque le quites puntos, la
 *      linea sigue ondulando igual. Ademas el deslizador entero movia la
 *      tolerancia de 0,50 a 0,90 px. Medio pixel.
 *
 *   2o (a medias) — difuminar la silueta entera y volver a cortarla por la
 *      mitad. Eso SI quita el temblor. Pero redondea por igual todo lo que
 *      sea mas pequeño que el radio, y una punta de un diseño es exactamente
 *      eso: algo pequeño y afilado. Salian las esquinas romas. Lo dijo ella:
 *      "las esquinas o cantos agudos / con punta los redondea, cuando lo que
 *      quiero es que se mantengan afilados".
 *
 *   3o (este) — el temblor y una punta se distinguen mirando LEJOS del punto,
 *      no al lado. Con brazos de varios pixeles, un temblor apenas dobla el
 *      camino (angulo casi llano) y una punta lo dobla de golpe. Asi que:
 *      primero se marcan las puntas de verdad, y luego se suaviza el contorno
 *      dejandolas CLAVADAS en su sitio. Los lados se enderezan, la punta no se
 *      mueve. Y al pintar, la punta se dibuja en angulo y el resto en curva.
 *
 * El orden completo:
 *
 *   1. Se decide, pixel a pixel, que es tinta y que es papel.
 *   2. Se tiran las motas sueltas del escaner.
 *   3. Se tapan los poros blancos de dentro del trazo.
 *   4. Se recorre el contorno.
 *   5. Se marcan las puntas y los cantos, comprobando el angulo a DOS
 *      distancias: el temblor solo lo aparenta a la corta.
 *   6. Se suaviza el contorno por tramos entre canto y canto, con los cantos
 *      clavados, promediando cada punto con sus vecinos del camino.
 *   7. Se quitan los puntos que ya no dicen nada (los cantos nunca se quitan).
 *   8. Se repinta al doble de tamaño: curvas en los lados, angulo en los
 *      cantos, y se repasa con un pincel de un pixel para devolver el medio
 *      pixel que se pierde al trazar por el centro de los pixeles del borde.
 *
 * Ya NO hay ningun difuminado de la silueta, ni siquiera de radio 1: medido
 * con una estrella de puntas de 36 grados, solo esa pasada minima ya metia la
 * punta 3 px para dentro. Los pelillos de un pixel los quita igual el
 * suavizado de contorno.
 *
 * Los agujeros se resuelven con relleno "evenodd": se pintan todos los
 * contornos, los de fuera y los de dentro, y la regla par-impar deja huecos
 * donde toca sin tener que saber quien esta dentro de quien.
 *
 * FORMA DE LOS DATOS. Un contorno es un array de puntos [x, y] en pixeles,
 * por ejemplo [[12,4],[13,4],[13,5]]. En paralelo va una marca por punto,
 * Uint8Array, 1 = punta clavada: [0,1,0]. simplificar() devuelve los dos
 * juntos: { pts: [[12,4],[13,5]], fijo: [0,1] }.
 *
 * Entra un lienzo con fondo transparente y tinta oscura (lo que devuelve el
 * escaner). Sale un lienzo nuevo del mismo tamaño. El original no se toca.
 */
(function (root) {
  "use strict";

  const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  /* ---------- 1. tinta o papel ---------- */
  function binarizar(ctx, w, h, umbral) {
    const d = ctx.getImageData(0, 0, w, h).data;
    const m = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < m.length; i++, j += 4) {
      // La tinta puede venir como alfa (recorte del escaner) o como pixel
      // oscuro sobre blanco. Se admiten las dos.
      const a = d[j + 3];
      if (a < 8) { m[i] = 0; continue; }
      const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      const fuerza = a * (255 - lum) / 255;
      m[i] = fuerza >= umbral ? 1 : 0;
    }
    return m;
  }

  /* ---------- 2 y 3. regiones ----------
     Etiqueta por inundacion con pila propia: la recursion se queda sin sitio
     en un dibujo grande. `valor` dice que se esta etiquetando (1 = tinta,
     0 = papel). `conex` 8 para la tinta, 4 para el papel: si el papel se
     colara en diagonal, dos agujeros pegados por una esquina contarian como
     uno solo y se escaparia el de fuera. */
  function etiquetar(m, w, h, valor, conex) {
    const eti = new Int32Array(w * h).fill(-1);
    const areas = [];
    const tocaBorde = [];
    const semillas = [];
    const pila = new Int32Array(w * h);
    let n = 0;
    for (let p = 0; p < m.length; p++) {
      if (m[p] !== valor || eti[p] !== -1) continue;
      let tope = 0;
      pila[tope++] = p;
      eti[p] = n;
      let area = 0, borde = false;
      let mejor = p;
      while (tope > 0) {
        const q = pila[--tope];
        const qx = q % w, qy = (q / w) | 0;
        area++;
        if (qx === 0 || qy === 0 || qx === w - 1 || qy === h - 1) borde = true;
        const my = (mejor / w) | 0;
        if (qy < my || (qy === my && qx < mejor % w)) mejor = q;
        for (let k = 0; k < conex; k++) {
          const d = conex === 4 ? DIRS8[k * 2] : DIRS8[k];
          const nx = qx + d[0], ny = qy + d[1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (m[r] !== valor || eti[r] !== -1) continue;
          eti[r] = n;
          pila[tope++] = r;
        }
      }
      areas.push(area);
      tocaBorde.push(borde);
      semillas.push(mejor);
      n++;
    }
    return { eti: eti, areas: areas, tocaBorde: tocaBorde, semillas: semillas, n: n };
  }

  /* ---------- 5. contorno ----------
     Trazado de Moore: se camina por el borde de la region mirando los ocho
     vecinos en orden, empezando por donde veniamos. */
  function trazar(pertenece, sx, sy, tope) {
    const pts = [];
    let px = sx, py = sy;
    let bx = sx - 1, by = sy;
    let n = 0;
    do {
      pts.push([px, py]);
      let idx = 0;
      for (let k = 0; k < 8; k++) {
        if (px + DIRS8[k][0] === bx && py + DIRS8[k][1] === by) { idx = k; break; }
      }
      let encontrado = false;
      for (let k = 1; k <= 8; k++) {
        const j = (idx + k) % 8;
        const nx = px + DIRS8[j][0], ny = py + DIRS8[j][1];
        if (pertenece(nx, ny)) {
          const ant = (j + 7) % 8;
          bx = px + DIRS8[ant][0];
          by = py + DIRS8[ant][1];
          px = nx; py = ny;
          encontrado = true;
          break;
        }
      }
      if (!encontrado) break;      // pixel suelto, sin borde que recorrer
      n++;
    } while (!(px === sx && py === sy) && n < tope);
    return pts;
  }

  /* ---------- 6. DONDE HAY UNA PUNTA DE VERDAD ----------
     Para cada punto del contorno se miran dos vecinos LEJANOS, uno por lado,
     a `brazo` pasos. El angulo que forman los dos brazos lo dice todo:

       - lado recto o curva normal .... los brazos salen casi opuestos
       - temblor de la mano ........... igual: a esa distancia no se nota
       - punta del diseño ............. los brazos se cierran de golpe

     Se mide con el coseno para no calcular angulos: -1 es llano, 0 es escuadra,
     +1 es doblado del todo sobre si mismo. Se marca punta a partir de `corte`.

     SE MIRA A DOS DISTANCIAS, y tiene que doblar en las dos. Ese es el truco
     que separa un canto de un temblor, y evita tener que afinar un numero:

       - una cresta del temblor parece un canto si la miras de cerca, pero al
         doblar la distancia el camino ya se ve recto otra vez
       - un canto de verdad dobla igual lo mires de cerca o de lejos

     Con una sola distancia habia que elegir entre perder los cantos de dentro
     de un dibujo (los angulos de 110-120 grados, que tambien hay que respetar)
     o clavar las crestas del temblor. Con dos distancias entran los cantos y
     no entra el temblor.

     Dos guardas mas:
       - Si un brazo se dobla sobre si mismo, la distancia en linea recta al
         vecino sale mucho mas corta que los pasos dados. Eso no es una punta:
         es un pelo de un pixel. No se marca, para que el suavizado se lo lleve.
       - De varios puntos marcados seguidos se queda el mas cerrado. Si se
         clavaran todos, ese tramo entero dejaria de suavizarse. */
  function anguloEn(pts, i, brazo) {
    const n = pts.length;
    const c = pts[i];
    const a = pts[(i - brazo % n + n) % n];
    const b = pts[(i + brazo) % n];
    const ax = a[0] - c[0], ay = a[1] - c[1];
    const bx = b[0] - c[0], by = b[1] - c[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < brazo * 0.55 || lb < brazo * 0.55) return -2;   // pelo, no punta
    return (ax * bx + ay * by) / (la * lb);
  }
  function marcarPuntas(pts, brazo, corte) {
    const n = pts.length;
    const marca = new Uint8Array(n);
    if (n < brazo * 6 + 3) return marca;
    const fuerza = new Float32Array(n).fill(-2);
    for (let i = 0; i < n; i++) {
      const cerca = anguloEn(pts, i, brazo);
      if (cerca < corte) continue;
      const lejos = anguloEn(pts, i, brazo * 2);
      if (lejos < corte) continue;
      fuerza[i] = Math.min(cerca, lejos);
    }
    for (let i = 0; i < n; i++) {
      if (fuerza[i] < -1) continue;
      let mejor = true;
      for (let k = -brazo; k <= brazo && mejor; k++) {
        if (!k) continue;
        const j = (i + k + n) % n;
        if (fuerza[j] > fuerza[i]) mejor = false;
      }
      if (mejor) marca[i] = 1;
    }
    return marca;
  }

  /* ---------- 7. SUAVIZAR EL CONTORNO SIN TOCAR LAS PUNTAS ----------
     Se recorre el borde y se sustituye cada punto por la media de sus vecinos
     a lo largo del camino. Tres pasadas seguidas de esa media se parecen a una
     campana de Gauss, y el radio es justo lo que mueve el deslizador: los
     vaivenes mas cortos que el radio se aplanan, lo mas largo es la forma del
     dibujo y pasa entero.

     LAS PUNTAS PARTEN EL RECORRIDO. Cada punta marcada corta el contorno en
     tramos, y cada tramo se suaviza por su cuenta con sus dos extremos
     clavados. Asi la media nunca cruza una esquina: si cruzara, la punta
     seguiria clavada pero su base saldria redonda, que es peor todavia.

     Intento descartado por el camino: alternar una pasada que mete la forma y
     otra que la saca (Taubin), para no encoger nada. Sobre el papel es mejor,
     pero amplifica un 0,3 % las ondas justo por debajo del corte, y como hacen
     falta cientos de pasadas eso se multiplica hasta reventar: medido, con el
     deslizador a 3 la punta de la estrella se iba 17 px fuera del dibujo. */
  function cajaLinea(v, r, ini, fin, circular) {
    const n = fin - ini + 1;
    const div = 2 * r + 1;
    const out = new Float64Array(n);
    const dame = circular
      ? (k) => v[ini + ((k % n) + n) % n]
      : (k) => v[ini + Math.max(0, Math.min(n - 1, k))];
    let suma = 0;
    for (let k = -r; k <= r; k++) suma += dame(k);
    for (let i = 0; i < n; i++) {
      out[i] = suma / div;
      suma += dame(i + r + 1) - dame(i - r);
    }
    for (let i = 0; i < n; i++) v[ini + i] = out[i];
  }
  function suavizarContorno(pts, radio, fijo) {
    const n = pts.length;
    if (n < 8 || radio < 1) return pts;
    const x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = pts[i][0]; y[i] = pts[i][1]; }

    const anclas = [];
    for (let i = 0; i < n; i++) if (fijo[i]) anclas.push(i);

    if (anclas.length < 2) {
      // Ninguna punta: el contorno entero es un solo tramo, y cerrado.
      const r = Math.min(radio, Math.floor((n - 1) / 2));
      if (r >= 1) for (let k = 0; k < 3; k++) {
        cajaLinea(x, r, 0, n - 1, true);
        cajaLinea(y, r, 0, n - 1, true);
      }
    } else {
      // Un tramo por cada par de puntas seguidas, incluida la que da la vuelta.
      // Se copia el tramo aparte para poder cerrar sus extremos.
      for (let a = 0; a < anclas.length; a++) {
        const ini = anclas[a], fin = anclas[(a + 1) % anclas.length];
        const largo = (fin - ini + n) % n + 1;
        if (largo < 5) continue;
        const r = Math.min(radio, Math.floor((largo - 1) / 2));
        if (r < 1) continue;
        const tx = new Float64Array(largo), ty = new Float64Array(largo);
        for (let i = 0; i < largo; i++) {
          const j = (ini + i) % n;
          tx[i] = x[j]; ty[i] = y[j];
        }
        for (let k = 0; k < 3; k++) {
          cajaLinea(tx, r, 0, largo - 1, false);
          cajaLinea(ty, r, 0, largo - 1, false);
        }
        // los extremos son las puntas: vuelven a su sitio exacto
        for (let i = 1; i < largo - 1; i++) {
          const j = (ini + i) % n;
          x[j] = tx[i]; y[j] = ty[i];
        }
      }
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = [x[i], y[i]];
    return out;
  }

  /* ---------- 8. fuera los puntos que ya no dicen nada ----------
     Las puntas entran como anclas: se conservan siempre y ademas parten el
     recorrido, para que la simplificacion no atraviese una esquina de largo. */
  function simplificar(pts, eps, fijo) {
    const n = pts.length;
    if (n < 4 || eps <= 0) return { pts: pts, fijo: fijo };
    const guardar = new Uint8Array(n);
    guardar[0] = 1; guardar[n - 1] = 1;
    const anclas = [0];
    for (let i = 1; i < n - 1; i++) if (fijo[i]) { guardar[i] = 1; anclas.push(i); }
    anclas.push(n - 1);
    const pila = [];
    for (let k = 0; k < anclas.length - 1; k++) pila.push([anclas[k], anclas[k + 1]]);
    while (pila.length) {
      const par = pila.pop();
      const a = par[0], b = par[1];
      if (b - a < 2) continue;
      const ax = pts[a][0], ay = pts[a][1];
      const bx = pts[b][0], by = pts[b][1];
      const dx = bx - ax, dy = by - ay;
      const largo = Math.hypot(dx, dy) || 1;
      let peor = -1, dmax = 0;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / largo;
        if (d > dmax) { dmax = d; peor = i; }
      }
      if (dmax > eps && peor > 0) {
        guardar[peor] = 1;
        pila.push([a, peor], [peor, b]);
      }
    }
    const fp = [], ff = [];
    for (let i = 0; i < n; i++) if (guardar[i]) { fp.push(pts[i]); ff.push(fijo[i]); }
    return { pts: fp, fijo: ff };
  }

  function areaPoligono(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }

  /* ---------- 9. pintar: curva en los lados, angulo en las puntas ----------
     Un punto normal se usa como tirador de una curva que va de un punto medio
     al siguiente: asi el borde es curvo de verdad y no se ven facetas.
     Un punto marcado como punta se pinta con dos rectas que se cruzan en el,
     que es lo que hace que salga afilado y no romo. */
  function pintarCurvo(camino, pol, fijo) {
    const n = pol.length;
    if (n < 3) return;
    const mx = (pol[n - 1][0] + pol[0][0]) / 2;
    const my = (pol[n - 1][1] + pol[0][1]) / 2;
    camino.moveTo(mx + 0.5, my + 0.5);
    for (let i = 0; i < n; i++) {
      const c = pol[i], s = pol[(i + 1) % n];
      const fx = (c[0] + s[0]) / 2 + 0.5, fy = (c[1] + s[1]) / 2 + 0.5;
      if (fijo && fijo[i]) {
        camino.lineTo(c[0] + 0.5, c[1] + 0.5);
        camino.lineTo(fx, fy);
      } else {
        camino.quadraticCurveTo(c[0] + 0.5, c[1] + 0.5, fx, fy);
      }
    }
    camino.closePath();
  }

  /* ---------- todo junto ---------- */
  function vectorizar(origen, opciones) {
    const o = opciones || {};
    const w = origen.width, h = origen.height;
    if (!w || !h) return origen;

    const umbral  = o.umbral != null ? o.umbral : 96;    // 0-255
    const motaPct = o.mota   != null ? o.mota   : 0.15;  // % del area del trazo mayor
    const suave   = o.suave  != null ? o.suave  : 5;     // 0-14, el deslizador
    const escala  = o.escala != null ? o.escala : 2;
    const color   = o.color  || "#000000";

    const ctx = origen.getContext("2d", { willReadFrequently: true });
    let m = binarizar(ctx, w, h, umbral);

    // 2. motas fuera
    const tinta = etiquetar(m, w, h, 1, 8);
    let areaMax = 0;
    for (const a of tinta.areas) if (a > areaMax) areaMax = a;
    if (!areaMax) return origen;                 // no hay nada que limpiar
    const minTinta = Math.max(6, areaMax * (motaPct / 100));
    for (let p = 0; p < m.length; p++) {
      if (m[p] === 1 && tinta.areas[tinta.eti[p]] < minTinta) m[p] = 0;
    }

    // 3. agujeritos tapados. Solo los que NO tocan el borde: los que tocan
    //    son el papel de alrededor, no un poro dentro del trazo.
    const papel = etiquetar(m, w, h, 0, 4);
    const minAgujero = Math.max(8, areaMax * 0.0035);
    for (let p = 0; p < m.length; p++) {
      if (m[p] !== 0) continue;
      const e = papel.eti[p];
      if (papel.tocaBorde[e]) continue;
      if (papel.areas[e] < minAgujero) m[p] = 1;
    }

    // 4. Ya no hay difuminado de forma, ni siquiera de radio 1. Medido con
    //    una estrella de puntas de 36 grados: solo esa pasada minima ya metia
    //    la punta 3 px para dentro. Los pelillos de un pixel los quita igual
    //    el suavizado de contorno, porque marcarPuntas no los confunde con
    //    una punta (el brazo se le dobla sobre si mismo y no los clava).

    // EL DESLIZADOR = cuantos pixeles de borde se promedian. A 5 se aplanan
    // los vaivenes de menos de unos 10 px de largo; a 12, los de menos de 25.
    // Lo mas largo que eso es la forma del dibujo y pasa entero.
    const radio = suave <= 0 ? 0 : Math.max(1, Math.round(suave * 1.1));
    // El brazo crece con el deslizador porque un temblor mas gordo hay que
    // mirarlo desde mas lejos para no confundirlo con una esquina.
    const brazo   = Math.max(4, Math.round(3 + suave * 0.9));
    // 120 grados. Con el limite en 90 solo entraban las puntas de fuera y se
    // perdian los cantos de dentro (los angulos entrantes de una estrella o
    // de una hoja rondan los 113 grados) — y esos tambien son cantos. Se
    // puede ser generoso porque el angulo se comprueba a dos distancias: el
    // temblor no aguanta la segunda.
    const corte   = -0.50;
    const eps     = 0.6;

    // 5-8. contornos de la tinta y de los agujeros que quedan
    const tinta2 = etiquetar(m, w, h, 1, 8);
    const papel2 = etiquetar(m, w, h, 0, 4);
    const tope = (w + h) * 8 + 64;
    const poligonos = [];
    // Contadores para poder comprobar desde fuera que las puntas se detectan.
    // Sin esto no hay forma de saber si una punta redondeada es que no se
    // marco o que se marco y aun asi se movio.
    const cuenta = { contornos: 0, puntos: 0, puntas: 0 };

    function meter(campo, i, hueco) {
      const s = campo.semillas[i];
      const sx = s % w, sy = (s / w) | 0;
      const et = campo.eti;
      const pertenece = (x, y) => x >= 0 && y >= 0 && x < w && y < h && et[y * w + x] === i;
      const bruto = trazar(pertenece, sx, sy, tope);
      if (bruto.length < 6) return;
      const puntas = radio ? marcarPuntas(bruto, brazo, corte) : new Uint8Array(bruto.length);
      cuenta.contornos++;
      cuenta.puntos += bruto.length;
      for (let k = 0; k < puntas.length; k++) if (puntas[k]) cuenta.puntas++;
      const suavizado = suavizarContorno(bruto, radio, puntas);
      const r = simplificar(suavizado, eps, puntas);
      if (r.pts.length < 3) return;
      if (areaPoligono(r.pts) < 3) return;
      r.hueco = hueco;
      poligonos.push(r);
    }

    for (let i = 0; i < tinta2.n; i++) meter(tinta2, i, false);
    for (let i = 0; i < papel2.n; i++) {
      if (papel2.tocaBorde[i]) continue;      // eso es el papel de fuera
      meter(papel2, i, true);
    }
    if (!poligonos.length) return origen;

    // 9. repintado
    //
    // EL MEDIO PIXEL. El contorno se traza por el CENTRO de los pixeles del
    // borde, o sea que el camino va medio pixel por dentro de donde acaba la
    // tinta de verdad: por cada lado. El trazo salia un pixel mas delgado de
    // lo que era, y en una punta cerrada eso se multiplica — medido en una
    // estrella de 36 grados, la punta se metia 2 px. Se devuelve repasando el
    // camino con un pincel de un pixel: en los contornos de tinta pintando
    // (crece medio pixel hacia fuera) y en los de los agujeros borrando
    // (el agujero crece medio pixel hacia dentro). Con union en pico para que
    // las puntas salgan afiladas y no matadas.
    const grande = document.createElement("canvas");
    grande.width = Math.round(w * escala);
    grande.height = Math.round(h * escala);
    const g = grande.getContext("2d");
    g.scale(escala, escala);
    g.fillStyle = color;
    const camino = new Path2D();
    const caminoTinta = new Path2D();
    const caminoHueco = new Path2D();
    for (const pol of poligonos) {
      pintarCurvo(camino, pol.pts, pol.fijo);
      pintarCurvo(pol.hueco ? caminoHueco : caminoTinta, pol.pts, pol.fijo);
    }
    g.fill(camino, "evenodd");
    g.lineWidth = 1;
    g.lineJoin = "miter";
    g.miterLimit = 6;
    g.strokeStyle = color;
    g.stroke(caminoTinta);
    g.globalCompositeOperation = "destination-out";
    g.stroke(caminoHueco);
    g.globalCompositeOperation = "source-over";

    const salida = document.createElement("canvas");
    salida.width = w; salida.height = h;
    const s = salida.getContext("2d");
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = "high";
    s.drawImage(grande, 0, 0, w, h);
    grande.width = grande.height = 1;    // suelta la memoria, son lienzos grandes
    root.KAOS_LIMPIAR.ultimaCuenta = cuenta;
    return salida;
  }

  root.KAOS_LIMPIAR = { vectorizar: vectorizar, ultimaCuenta: null };
})(window);
