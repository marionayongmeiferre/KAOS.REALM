// KAOS.REALM — manipulación directa sobre una previa (v1)
//
// Un lienzo con foto/gráfico y texto encima deja de ser una imagen fija: se
// puede pinchar cada pieza, arrastrarla, girarla y editar el texto con doble
// clic, con una retícula de diseño que hace de guía y que imanta las piezas
// a sus líneas.
//
// Esto NO pinta el contenido. El contenido lo sigue pintando quien sea (reel.js,
// carrusel.js…). Aquí sólo va la capa de encima: retícula, caja de selección,
// tirador de giro y el campo de texto. Por eso la retícula nunca sale en el
// vídeo ni en el PNG exportado — vive en otro lienzo, superpuesto.
//
// Se monta así:
//
//   KAOS_DIRECTO.montar(canvas, {
//     W: 1080, H: 1920,
//     piezas: () => [{ id, tipo, x, y, w, h, rot, texto, tam }],
//     alMover:  (id, x, y) => {...},
//     alGirar:  (id, deg)  => {...},
//     alEditar: (id, txt)  => {...},
//     repintar: () => {...},
//   });
//
// Dos formas de vivir encima del lienzo:
//
//   · Por defecto la capa CAPTURA el ratón y manda ella: eso es el reel, donde
//     todo lo que se toca son piezas suyas.
//   · Con `pasivo: true` la capa no coge ni un clic: sólo pinta la retícula, la
//     caja y las guías, y quien la monta sigue llevando el ratón por su cuenta.
//     Eso es el flash post, que ya tiene sus tiradores de escala, su borrar y
//     su doble clic sobre los «N CM». Ahí se le dice qué está elegido con
//     `seleccionar(id)`, se le encienden guías con `pistas(...)` y se le pide
//     abrir el texto con `editar(id)`.
//
// Y `marco: elemento` para no envolver el lienzo cuando el sitio donde vive ya
// está posicionado (el flash post centra el lienzo con flex y envolverlo le
// rompía el alto máximo).
//
// Las coordenadas van SIEMPRE en píxeles del diseño (0..W, 0..H), nunca en
// píxeles de pantalla: así el mismo código vale con la previa a 300 px de ancho
// o a pantalla completa.
(function (root) {
  "use strict";

  // ------------------------------------------------------------- la retícula
  // 6 columnas y 12 filas dentro del margen. Seis columnas se parten en dos y
  // en tres sin decimales, que es de donde salen las medias y los tercios que
  // se usan al componer. El margen es el mismo 5,5% que usan las esquinas del
  // marco, para que las guías caigan justo donde ya está el marco y no invente
  // un segundo margen que pelee con él.
  const REJ = { cols: 6, filas: 12, margen: 0.055 };

  // Cuánto tiene que acercarse una pieza a una línea para que la agarre, en px
  // de diseño. 14 sobre 1080 es un pelo más de un 1% del ancho: se nota que
  // imanta, pero no impide dejar algo a propósito ligeramente descuadrado.
  const IMAN = 14;
  // Al girar, imanta a los múltiplos de 15° si estás a menos de 5°.
  const IMAN_GIRO = 5, PASO_GIRO = 15;
  // Distancia del tirador de giro al borde de arriba de la pieza.
  const TIRADOR = 34;

  const VERDE = "#c8ff2e", MAGENTA = "#ff2e88";

  // `margen` opcional en fracción del ancho. El reel usa el de fábrica (5,5%,
  // que es donde caen las esquinas de su marco); el flash post pasa su propio
  // sangrado, para que las guías caigan sobre el marco que ella ve y no
  // inventen un segundo margen que pelee con él.
  function lineas(W, H, margen) {
    const m = Math.round(W * (margen != null ? margen : REJ.margen));
    const anchoUtil = W - m * 2, altoUtil = H - m * 2;
    const vs = [], hs = [];
    for (let i = 0; i <= REJ.cols; i++) vs.push(m + (anchoUtil * i) / REJ.cols);
    for (let i = 0; i <= REJ.filas; i++) hs.push(m + (altoUtil * i) / REJ.filas);
    return { vs: vs, hs: hs, m: m };
  }

  // Devuelve el desplazamiento que hay que aplicar para caer sobre una línea,
  // mirando el centro de la pieza y también sus dos bordes: al componer se
  // alinea tanto por el eje como por el canto, y forzar sólo el centro deja
  // los textos cortos flotando respecto a los largos.
  function imantar(centro, medio, guias) {
    let mejor = null;
    const puntos = [centro, centro - medio, centro + medio];
    for (const gu of guias) {
      for (const p of puntos) {
        const d = gu - p;
        if (Math.abs(d) <= IMAN && (mejor === null || Math.abs(d) < Math.abs(mejor.d))) {
          mejor = { d: d, g: gu };
        }
      }
    }
    return mejor;
  }

  // ------------------------------------------------------------------ montar
  function montar(canvas, opts) {
    if (!canvas || !opts || typeof opts.piezas !== "function") return null;
    const W = opts.W || canvas.width, H = opts.H || canvas.height;
    const pasivo = !!opts.pasivo;

    // Dos maneras de colgarse del lienzo:
    //   · `marco` dado: ya hay un contenedor posicionado (el flash post). La
    //     capa se coloca a mano encima del lienzo y se recoloca al repintar,
    //     porque ese lienzo cambia de tamaño según la hoja y la ventana.
    //   · Sin `marco`: se envuelve el lienzo, que es lo más simple y es lo que
    //     hace el reel.
    let marco = opts.marco || null;
    const suelto = !!marco;
    if (!suelto) {
      marco = canvas.parentElement;
      if (!marco || !marco.classList.contains("dir-marco")) {
        marco = document.createElement("div");
        marco.className = "dir-marco";
        canvas.parentNode.insertBefore(marco, canvas);
        marco.appendChild(canvas);
      }
    }

    const capa = document.createElement("canvas");
    capa.className = "dir-capa" + (suelto ? " dir-capa-suelta" : "");
    capa.width = W; capa.height = H;
    if (pasivo) capa.style.pointerEvents = "none";
    marco.appendChild(capa);

    // Cuánto se desplaza el lienzo dentro del marco. Envuelto siempre es 0,0;
    // suelto depende de cómo lo esté centrando el contenedor.
    function hueco() {
      if (!suelto) return { x: 0, y: 0, w: 0, h: 0 };
      const r = canvas.getBoundingClientRect(), m = marco.getBoundingClientRect();
      return { x: r.left - m.left, y: r.top - m.top, w: r.width, h: r.height };
    }
    function encajarCapa() {
      if (!suelto) return;
      const q = hueco();
      capa.style.left = q.x + "px";
      capa.style.top = q.y + "px";
      capa.style.width = q.w + "px";
      capa.style.height = q.h + "px";
    }

    const campo = document.createElement("textarea");
    campo.className = "dir-campo";
    campo.rows = 1;
    campo.hidden = true;
    marco.appendChild(campo);

    const g = lineas(W, H, opts.margen);
    // Rectángulo opcional {x0,y0,x1,y1} en píxeles de diseño: la parte que el
    // sitio donde se publica NO tapa con su interfaz. Se dibuja junto con las
    // demás guías y nunca llega al fichero exportado. Quien monta la capa
    // decide si hay zona o no — aquí sólo se pinta.
    const segura = opts.segura || null;
    // La interfaz del sitio donde se publica, dibujada encima para ver qué va a
    // tapar: {bloques:[{x,y,w,h,txt}], iconos:[{x,y,r}]}. Es un calco, no una
    // captura: sólo tiene que decir DÓNDE están las cosas, no cómo son.
    const ig = opts.ig || null;
    let sel = null;          // id de la pieza seleccionada
    let arrastre = null;     // {id, modo:'mover'|'girar', ...}
    let pistas = [];         // líneas que están imantando ahora mismo
    let verRejilla = true;
    let editando = null;
    let vivo = true;

    // ------------------------------------------------------------ pantalla
    // La previa se ve a un tamaño y el diseño mide otro. Todo lo que entra por
    // el ratón se traduce a píxeles de diseño antes de tocarlo.
    function aDiseno(ev) {
      const r = canvas.getBoundingClientRect();
      return {
        x: ((ev.clientX - r.left) / Math.max(1, r.width)) * W,
        y: ((ev.clientY - r.top) / Math.max(1, r.height)) * H,
      };
    }
    // Grosor de línea que se ve igual de fino sea cual sea el tamaño de previa.
    function fino() {
      const r = canvas.getBoundingClientRect();
      return Math.max(1, W / Math.max(1, r.width));
    }

    function dentro(p, x, y) {
      const a = (-(p.rot || 0) * Math.PI) / 180;
      const dx = x - p.x, dy = y - p.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      return Math.abs(lx) <= p.w / 2 && Math.abs(ly) <= p.h / 2;
    }
    function buscar(x, y) {
      const ps = opts.piezas() || [];
      // De arriba abajo: si dos se pisan, gana la que está pintada encima.
      for (let i = ps.length - 1; i >= 0; i--) if (dentro(ps[i], x, y)) return ps[i];
      return null;
    }
    function porId(id) {
      const ps = opts.piezas() || [];
      for (const p of ps) if (p.id === id) return p;
      return null;
    }
    // Dónde cae el tirador de giro de una pieza, en píxeles de diseño: el punto
    // (0, -h/2 - TIRADOR) de la pieza, girado con ella.
    function tirador(p) {
      const a = ((p.rot || 0) * Math.PI) / 180;
      const d = p.h / 2 + TIRADOR;
      return { x: p.x + Math.sin(a) * d, y: p.y - Math.cos(a) * d };
    }

    // ------------------------------------------------------------ pintar
    function pintar() {
      encajarCapa();
      const c = capa.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      if (!vivo) return;
      const lw = fino();

      if (verRejilla) {
        // Muy tenue: es una guía, no un dibujo. Si se ve más de la cuenta deja
        // de leerse el diseño, que es lo que ella está mirando.
        c.save();
        c.strokeStyle = "rgba(255,255,255,0.13)";
        c.lineWidth = lw;
        for (const x of g.vs) { c.beginPath(); c.moveTo(x, g.m); c.lineTo(x, H - g.m); c.stroke(); }
        for (const y of g.hs) { c.beginPath(); c.moveTo(g.m, y); c.lineTo(W - g.m, y); c.stroke(); }
        // Los ejes centrales algo más marcados: son las guías que más se usan.
        c.strokeStyle = "rgba(255,255,255,0.26)";
        c.beginPath(); c.moveTo(W / 2, g.m); c.lineTo(W / 2, H - g.m); c.stroke();
        c.beginPath(); c.moveTo(g.m, H / 2); c.lineTo(W - g.m, H / 2); c.stroke();
        c.restore();

        // La zona segura, si la hay. Se apaga lo de fuera en vez de dibujar una
        // caja más: así se ve de un vistazo qué franja se come la interfaz de
        // Instagram, sin sumar otra línea a un lienzo que ya tiene retícula.
        if (segura) {
          c.save();
          c.fillStyle = "rgba(0,0,0,0.34)";
          c.fillRect(0, 0, W, segura.y0);
          c.fillRect(0, segura.y1, W, H - segura.y1);
          c.fillRect(0, segura.y0, segura.x0, segura.y1 - segura.y0);
          c.fillRect(segura.x1, segura.y0, W - segura.x1, segura.y1 - segura.y0);
          c.strokeStyle = "rgba(255,255,255,0.34)";
          c.lineWidth = lw;
          c.setLineDash([lw * 8, lw * 6]);
          c.strokeRect(segura.x0, segura.y0,
                       segura.x1 - segura.x0, segura.y1 - segura.y0);
          c.restore();
        }

        // EL CALCO DE INSTAGRAM.
        // Las franjas oscurecidas ya dicen «aquí no», pero no dicen QUÉ hay.
        // Dibujando los iconos donde van de verdad, se entiende de un vistazo
        // por qué ese trozo no sirve — y se coloca mirando, no adivinando.
        if (ig) {
          c.save();
          c.strokeStyle = "rgba(255,255,255,0.30)";
          c.fillStyle = "rgba(255,255,255,0.30)";
          c.lineWidth = lw * 1.5;
          for (const b of (ig.bloques || [])) {
            c.strokeRect(b.x, b.y, b.w, b.h);
            if (!b.txt) continue;
            c.save();
            c.font = "600 " + Math.round(W * 0.022) + "px system-ui, sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(b.txt, b.x + b.w / 2, b.y + b.h / 2);
            c.restore();
          }
          // Los seis de la derecha: corazón, comentar, compartir, enviar, los
          // tres puntos y su foto de perfil.
          for (const i of (ig.iconos || [])) {
            c.beginPath();
            c.arc(i.x, i.y, i.r, 0, Math.PI * 2);
            c.stroke();
          }
          c.restore();
        }
      }

      // Las guías que están agarrando ahora, encendidas, para que vea POR QUÉ
      // se le ha ido la pieza a ese sitio en vez de parecer que patina sola.
      if (pistas.length) {
        c.save();
        c.strokeStyle = MAGENTA;
        c.lineWidth = lw * 2;
        for (const p of pistas) {
          c.beginPath();
          if (p.v != null) { c.moveTo(p.v, 0); c.lineTo(p.v, H); }
          else { c.moveTo(0, p.h); c.lineTo(W, p.h); }
          c.stroke();
        }
        c.restore();
      }

      const p = sel ? porId(sel) : null;
      if (!p) return;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(((p.rot || 0) * Math.PI) / 180);
      c.strokeStyle = VERDE;
      c.lineWidth = lw * 2;
      c.setLineDash([lw * 8, lw * 6]);
      c.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.setLineDash([]);
      if (p.girar !== false) {
        c.beginPath();
        c.moveTo(0, -p.h / 2);
        c.lineTo(0, -p.h / 2 - TIRADOR);
        c.stroke();
        c.beginPath();
        c.arc(0, -p.h / 2 - TIRADOR, lw * 7, 0, Math.PI * 2);
        c.fillStyle = VERDE;
        c.fill();
      }
      c.restore();
    }

    // ------------------------------------------------------------ editar
    function abrirCampo(p) {
      if (!p || p.tipo !== "texto") return;
      editando = p.id;
      const r = canvas.getBoundingClientRect();
      const k = r.width / W;
      const q = hueco();
      campo.value = p.texto || "";
      campo.hidden = false;
      campo.style.left = (q.x + (p.x - p.w / 2) * k) + "px";
      campo.style.top = (q.y + (p.y - p.h / 2) * k) + "px";
      campo.style.width = Math.max(90, p.w * k) + "px";
      campo.style.height = Math.max(30, p.h * k) + "px";
      campo.style.fontSize = Math.max(11, (p.tam || 40) * k * 0.85) + "px";
      campo.focus();
      campo.select();
      pintar();
    }
    function cerrarCampo(guardar) {
      if (!editando) return;
      const id = editando;
      editando = null;
      campo.hidden = true;
      if (guardar && opts.alEditar) opts.alEditar(id, campo.value);
      if (opts.repintar) opts.repintar();
      pintar();
    }
    campo.addEventListener("blur", () => cerrarCampo(true));
    campo.addEventListener("keydown", (e) => {
      // Enter cierra. Se deja Shift+Enter para el día que algún texto sea de
      // varias líneas; hoy los del reel son de una.
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); cerrarCampo(true); }
      if (e.key === "Escape") { e.preventDefault(); cerrarCampo(false); }
      e.stopPropagation();
    });

    // ------------------------------------------------------------ ratón
    function bajar(e) {
      if (!vivo || editando) return;
      const q = aDiseno(e);
      const p = sel ? porId(sel) : null;

      // Primero el tirador de giro de lo que ya está elegido: cae fuera de la
      // caja, así que si se mirara la caja antes, nunca se llegaría a él.
      if (p && p.girar !== false) {
        const t = tirador(p);
        const rr = fino() * 16;
        if ((q.x - t.x) * (q.x - t.x) + (q.y - t.y) * (q.y - t.y) <= rr * rr) {
          arrastre = { id: p.id, modo: "girar", rot0: p.rot || 0,
                       ang0: Math.atan2(q.y - p.y, q.x - p.x) };
          try { capa.setPointerCapture(e.pointerId); } catch (_) {}
          return;
        }
      }

      const hit = buscar(q.x, q.y);
      sel = hit ? hit.id : null;
      if (hit && hit.mover !== false) {
        arrastre = { id: hit.id, modo: "mover", dx: hit.x - q.x, dy: hit.y - q.y };
        try { capa.setPointerCapture(e.pointerId); } catch (_) {}
      }
      // Aquí NO se llama a preventDefault. Cancelar el pointerdown se lleva por
      // delante el doble clic en algunos navegadores, y el doble clic es justo
      // lo que abre el texto. Que arrastrar no haga scroll ni seleccione lo
      // arregla el CSS de .dir-capa (touch-action y user-select).
      if (opts.alElegir) opts.alElegir(sel);
      pintar();
    }

    function mover(e) {
      if (!arrastre) return;
      const q = aDiseno(e);
      const p = porId(arrastre.id);
      if (!p) return;

      if (arrastre.modo === "girar") {
        const ang = Math.atan2(q.y - p.y, q.x - p.x);
        let deg = arrastre.rot0 + ((ang - arrastre.ang0) * 180) / Math.PI;
        // Sin la tecla Alt, imanta a los múltiplos de 15°.
        if (!e.altKey) {
          const cerca = Math.round(deg / PASO_GIRO) * PASO_GIRO;
          if (Math.abs(deg - cerca) <= IMAN_GIRO) deg = cerca;
        }
        while (deg > 180) deg -= 360;
        while (deg < -180) deg += 360;
        if (opts.alGirar) opts.alGirar(p.id, Math.round(deg * 10) / 10);
      } else {
        let x = q.x + arrastre.dx, y = q.y + arrastre.dy;
        pistas = [];
        // Alt pisa la imantación: a veces hace falta dejar algo justo fuera de
        // la línea, y si no hay forma de saltársela la guía pasa de ayudar a
        // estorbar.
        if (!e.altKey) {
          const ix = imantar(x, p.w / 2, g.vs.concat([W / 2]));
          const iy = imantar(y, p.h / 2, g.hs.concat([H / 2]));
          if (ix) { x += ix.d; pistas.push({ v: ix.g }); }
          if (iy) { y += iy.d; pistas.push({ h: iy.g }); }
        }
        if (opts.alMover) opts.alMover(p.id, Math.round(x), Math.round(y));
      }
      if (opts.repintar) opts.repintar();
      pintar();
    }

    function soltar(e) {
      if (!arrastre) return;
      arrastre = null;
      pistas = [];
      try { capa.releasePointerCapture(e.pointerId); } catch (_) {}
      if (opts.alSoltar) opts.alSoltar();
      pintar();
    }
    function doble(e) {
      if (!vivo) return;
      const q = aDiseno(e);
      const hit = buscar(q.x, q.y);
      if (hit && hit.tipo === "texto") { sel = hit.id; abrirCampo(hit); }
    }

    // En pasivo la capa no engancha nada: quien la monta ya tiene su propio
    // ratón montado sobre el lienzo de debajo y dos manejadores peleándose por
    // el mismo gesto es peor que no tener capa.
    if (!pasivo) {
      capa.addEventListener("pointerdown", bajar);
      capa.addEventListener("pointermove", mover);
      capa.addEventListener("pointerup", soltar);
      capa.addEventListener("pointercancel", soltar);
      capa.addEventListener("dblclick", doble);
    }

    // Flechas para afinar al píxel: arrastrando nunca se clava un valor
    // redondo, y con Mayúsculas salta de 10 en 10.
    function teclas(e) {
      if (!vivo || editando || !sel) return;
      const p = porId(sel);
      if (!p) return;
      if (e.key === "Escape") { sel = null; pintar(); return; }
      if (e.key === "Enter") { e.preventDefault(); abrirCampo(p); return; }
      const paso = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -paso;
      else if (e.key === "ArrowRight") dx = paso;
      else if (e.key === "ArrowUp") dy = -paso;
      else if (e.key === "ArrowDown") dy = paso;
      else return;
      e.preventDefault();
      if (opts.alMover) opts.alMover(p.id, p.x + dx, p.y + dy);
      if (opts.repintar) opts.repintar();
      pintar();
    }
    if (!pasivo) document.addEventListener("keydown", teclas);

    function refrescar() { pintar(); }
    function rejilla(v) { verRejilla = !!v; pintar(); }
    function activar(v) {
      vivo = !!v;
      capa.style.display = vivo ? "" : "none";
      if (!vivo) { sel = null; cerrarCampo(false); }
      pintar();
    }
    function deseleccionar() { sel = null; cerrarCampo(false); pintar(); }
    // Para el modo pasivo: quien manda es el de fuera, así que le dice a la
    // capa qué está elegido, qué guías encender y cuándo abrir el texto.
    function seleccionar(id) { sel = id || null; pintar(); }
    function editar(id) {
      const p = porId(id);
      if (p) { sel = id; abrirCampo(p); }
    }
    function marcarGuias(list) { pistas = list || []; pintar(); }
    function destruir() {
      document.removeEventListener("keydown", teclas);
      capa.remove();
      campo.remove();
    }

    pintar();
    return { refrescar: refrescar, rejilla: rejilla, activar: activar,
             deseleccionar: deseleccionar, destruir: destruir, capa: capa,
             seleccionar: seleccionar, editar: editar, pistas: marcarGuias,
             editando: function () { return editando; } };
  }

  // `imantar` sale fuera a propósito: el flash post lleva su propio arrastre
  // (tiene tiradores de escala y borrar que aquí no existen) y tiene que imantar
  // con LOS MISMOS números que el reel. Dos copias de esta cuenta acabarían
  // imantando distinto en cada sitio.
  root.KAOS_DIRECTO = { montar: montar, REJ: REJ, lineas: lineas, IMAN: IMAN,
                        imantar: imantar, IMAN_GIRO: IMAN_GIRO, PASO_GIRO: PASO_GIRO };
})(window);
