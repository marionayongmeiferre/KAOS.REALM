// KAOS.REALM — panel del reel de ruleta (v1)
//
// Sólo pantalla: elegir diseños, escribir la frase y el CTA, ver la previa y
// dar a grabar. Toda la pintura y la grabación viven en reel.js.
(function (root) {
  "use strict";

  const REEL = root.KAOS_REEL;
  const GAL = root.KAOS_GALLERY;
  if (!REEL || !GAL) { console.warn("reel-ui: falta reel.js o gallery.js"); return; }

  const $ = (s) => document.querySelector(s);
  const D = {
    openBtn:  $("#reelOpenBtn"),
    modal:    $("#reelModal"),
    closeBtn: $("#reelCloseBtn"),
    canvas:   $("#reelCanvas"),
    tira:     $("#reelTira"),
    addBtn:   $("#reelAddBtn"),
    flashDay: $("#reelFlashDayBtn"),
    clearBtn: $("#reelClearBtn"),
    hojaSel:  $("#reelHojaSel"),
    colFrase: $("#reelColFrase"),
    colCta:   $("#reelColCta"),
    colHand:  $("#reelColHandle"),
    colMarco: $("#reelColMarco"),
    marcoTam: $("#reelMarcoTam"),
    marcoTamVal: $("#reelMarcoTamVal"),
    marcoAv:  $("#reelMarcoAviso"),
    fondoSel: $("#reelFondoSel"),
    frase:    $("#reelFrase"),
    cta:      $("#reelCta"),
    cierreTxt: $("#reelCierreTxt"),
    vueltas:  $("#reelVueltas"),
    vueltasVal: $("#reelVueltasVal"),
    durVal:   $("#reelDurVal"),
    durTip:   $("#reelDurTip"),
    lento:    $("#reelLento"),
    lentoVal: $("#reelLentoVal"),
    barrido:  $("#reelBarrido"),
    barridoVal: $("#reelBarridoVal"),
    barridoTip: $("#reelBarridoTip"),
    parada:   $("#reelParada"),
    paradaVal: $("#reelParadaVal"),
    cierre:   $("#reelCierre"),
    cierreVal: $("#reelCierreVal"),
    vidInput: $("#reelVideoInput"),
    vidBtn:   $("#reelVideoBtn"),
    vidQuit:  $("#reelVideoQuitBtn"),
    fondoInp: $("#reelFondoInput"),
    fondoBtn: $("#reelFondoBtn"),
    rejilla:  $("#reelRejilla"),
    txtAdd:   $("#reelTxtAddBtn"),
    txtLista: $("#reelTxtLista"),
    txtLabel: $("#reelTxtLabel"),
    modo:     $("#reelModo"),
    fmt:      $("#reelFormato"),
    fmtTip:   $("#reelFormatoTip"),
    modoTip:  $("#reelModoTip"),
    ruletaCaja: $("#reelRuletaCaja"),
    zig:      $("#reelZigzag"),
    zoom:     $("#reelHojaZoom"),
    hojaY:    $("#reelHojaY"),
    hojaYVal: $("#reelHojaYVal"),
    zigVel:   $("#reelZigVel"),
    zigFr:    $("#reelZigFrames"),
    zigFrVal: $("#reelZigFramesVal"),
    zigVelVal: $("#reelZigVelVal"),
    zoomVal:  $("#reelHojaZoomVal"),
    zigVal:   $("#reelZigzagVal"),
    pasesCaja: $("#reelPasesCaja"),
    paso:     $("#reelPaso"),
    pasoVal:  $("#reelPasoVal"),
    hojasBtn: $("#reelHojasBtn"),
    hojasLista: $("#reelHojasLista"),
    hojasTip: $("#reelHojasTip"),
    portOn:   $("#reelPortadaOn"),
    portFila: $("#reelPortadaFila"),
    portDur:  $("#reelPortadaDur"),
    portDurVal: $("#reelPortadaDurVal"),
    portVer:  $("#reelPortadaVer"),
    resetPos: $("#reelResetPos"),
    playBtn:  $("#reelPlayBtn"),
    recBtn:   $("#reelRecBtn"),
    borr:     $("#reelBorradores"),
    status:   $("#reelStatus"),
    aviso:    $("#reelAviso"),
  };
  if (!D.modal || !D.openBtn) { console.warn("reel-ui: falta el marcado"); return; }

  // Cuántos diseños caben en una ruleta. Estaba en 12 porque el ritmo viejo no
  // dejaba ver más; ahora la pasada rápida se mide en segundos y da igual
  // cuántos haya, así que el tope es sólo para que la tira no sea infinita.
  const TOPE = 50;

  let st = REEL.estado();
  let pararPrevia = null;
  let grabando = false;

  function items() {
    const all = GAL.load();
    return st.ids.map(id => all.find(x => x.id === id)).filter(Boolean);
  }
  // Cuántas piezas tiene el vídeo AHORA MISMO. Cada modo cuenta lo suyo: la
  // ruleta cuenta diseños sueltos, el pase de flash post cuenta hojas. Sumarlos
  // encendía GRABAR en un modo por lo que hubiera en el otro.
  function cuantasPiezas() {
    return esPases() ? hojasSrc().length : items().length;
  }
  // La ruleta necesita al menos dos: con una no hay nada que girar. Una hoja
  // sola, en cambio, ya es un vídeo — se queda en pantalla con su vaivén y su
  // portada detrás.
  function MINIMO() { return esPases() ? 1 : 2; }

  function decir(txt, malo) {
    D.status.textContent = txt || "—";
    D.status.classList.toggle("warn", !!malo);
  }

  // ---------------------------------------------------------------- tira
  function pintarTira() {
    const list = items();
    D.tira.textContent = "";
    list.forEach((it, i) => {
      const c = document.createElement("div");
      c.className = "reel-chip";
      const im = document.createElement("img");
      im.src = it.thumbUrl || it.layerUrl;
      im.alt = "";
      const n = document.createElement("span");
      n.className = "reel-chip-n";
      n.textContent = String(i + 1);
      const x = document.createElement("button");
      x.className = "reel-chip-x";
      x.textContent = "✕";
      x.title = "Quitar del reel";
      x.addEventListener("click", () => {
        st.ids = st.ids.filter(id => id !== it.id);
        REEL.guardar(st);
        pintarTira();
      });
      c.append(im, n, x);
      D.tira.appendChild(c);
    });
    const n = list.length;
    const piezas = cuantasPiezas();
    D.recBtn.disabled = piezas < MINIMO() || grabando;
    D.playBtn.disabled = piezas < MINIMO();
    D.addBtn.disabled = n >= TOPE;
    pintarBarrido();
    decir(piezas
      ? (esPases() ? piezas + (piezas === 1 ? " hoja" : " hojas")
                   : piezas + (piezas === 1 ? " diseño" : " diseños") + " en la ruleta")
      : (esPases() ? "Añade una hoja de flash." : "Añade al menos 2 diseños."));
    if (piezas) dibujarQuieto();
  }

  // ------------------------------------------------------- manipulación directa
  // El fotograma quieto no es una imagen: cada pieza se puede pinchar, arrastrar
  // y girar, y los textos se editan con doble clic. La capa de encima (retícula,
  // caja, tirador) la pone lienzo-directo.js; aquí sólo se le dice dónde está
  // cada cosa y qué hacer cuando ella la mueve.
  let directo = null;         // la capa montada
  let ultimasPiezas = null;   // lo que devolvió el último `preparar`
  let tQuieto = 0;            // el segundo del fotograma que se está viendo
  // Si está mirando la portada, el fotograma quieto es el de la portada y la
  // capa de edición trabaja sobre SUS textos. Es el mismo lienzo y la misma
  // retícula: sólo cambia qué fotograma está congelado debajo.
  let verPortada = false;

  // Traduce las cajas que ha anotado reel.js al formato que espera la capa.
  // El orden importa: la última gana si dos se pisan, y encima de la pegatina
  // siempre mandan los textos.
  function piezasEditables() {
    if (!ultimasPiezas) return [];
    const c = REEL.cajas(ultimasPiezas);
    const out = [];
    const meter = (id, tipo, caja, texto) => {
      if (!caja) return;
      out.push({ id: id, tipo: tipo, x: caja.x, y: caja.y, w: caja.w, h: caja.h,
                 rot: caja.rot || 0, texto: texto, tam: caja.tam });
    };
    // En la portada no hay diseño, ni frase, ni CTA: sólo la firma y lo suyo.
    // Ofrecer piezas que ese fotograma no pinta dejaría cajas señalando a
    // sitios vacíos.
    if (!verPortada) {
      meter("arte", "arte", c.arte);
      meter("cta", "texto", c.cta, st.cta);
      meter("frase", "texto", c.frase, st.frase);
    }
    meter("firma", "firma", c.firma);
    // Los suyos, los últimos: si uno cae encima de la frase, manda el que ella
    // acaba de poner, que es lo que está mirando.
    const pre = prefijoAhora();
    for (const t of textosAhora()) meter(pre + t.id, "texto", c[pre + t.id], t.txt);
    return out;
  }

  // Repinta el fotograma con lo que ya está cargado. Sin `await` y sin volver a
  // montar pegatinas: arrastrar dispara esto en cada movimiento del dedo, y
  // rehacer las pegatinas ahí dejaría la previa a tirones.
  function repintarQuieto() {
    if (!ultimasPiezas) return;
    REEL.pintarFrame(D.canvas.getContext("2d"), ultimasPiezas, tQuieto);
  }

  // Sus textos guardan el sitio dentro de ellos mismos, no en `pos`: `pos`
  // tiene cuatro piezas que siempre están, y estos aparecen y desaparecen.
  // Un texto suyo, sea del cuerpo del reel («t:») o de la portada («p:»). Los
  // dos juegos son iguales por dentro, así que mover, girar y escribir salen
  // gratis para la portada: basta con encontrarla aquí.
  function suyo(id) {
    const s = String(id), pre = s.slice(0, 2), k = s.slice(2);
    if (pre === "t:") {
      for (const t of (st.textos || [])) if (t.id === k) return t;
      return null;
    }
    if (pre === "p:") {
      for (const t of ((st.portada && st.portada.textos) || [])) if (t.id === k) return t;
      return null;
    }
    return null;
  }
  // Los textos del sitio en el que ella está ahora: la portada si la está
  // mirando, el cuerpo del reel si no.
  function textosAhora() {
    return verPortada ? ((st.portada && st.portada.textos) || []) : (st.textos || []);
  }
  function prefijoAhora() { return verPortada ? "p:" : "t:"; }
  function moverPieza(id, x, y) {
    const mio = suyo(id);
    if (mio) {
      mio.x = Math.min(1, Math.max(0, x / REEL.W));
      mio.y = Math.min(1, Math.max(0, y / REEL.H));
      return;
    }
    if (!st.pos) st.pos = REEL.sitios(st);
    const p = st.pos[id] || (st.pos[id] = {});
    // Se guarda en fracción del lienzo, no en píxeles: ver el comentario de
    // SITIOS en reel.js.
    p.x = Math.min(1, Math.max(0, x / REEL.W));
    p.y = Math.min(1, Math.max(0, y / REEL.H));
  }
  function girarPieza(id, deg) {
    const mio = suyo(id);
    if (mio) { mio.rot = deg; return; }
    if (!st.pos) st.pos = REEL.sitios(st);
    const p = st.pos[id] || (st.pos[id] = {});
    p.rot = deg;
  }
  function editarPieza(id, txt) {
    const mio = suyo(id);
    if (mio) {
      // Dejarlo en blanco lo quita. Es lo que se espera al borrarlo entero, y
      // ahorra tener que ir a buscar una papelera en el panel de al lado.
      const limpio = String(txt || "").trim();
      if (!limpio) st.textos = (st.textos || []).filter(t => t !== mio);
      else mio.txt = limpio;
      REEL.guardar(st);
      pintarTextos();
      dibujarQuieto();
      return;
    }
    if (id === "frase") { st.frase = txt; if (D.frase) D.frase.value = txt; }
    else if (id === "cta") { st.cta = txt; if (D.cta) D.cta.value = txt; }
    REEL.guardar(st);
  }

  // De que tamano se monto la capa. Si el formato cambia hay que rehacerla:
  // la capa pinta en pixeles de diseno, y con el tamano viejo la reticula, las
  // guias y las cajas de agarrar quedan todas corridas.
  let directoWH = "";
  function montarDirecto() {
    if (!root.KAOS_DIRECTO) return;
    const wh = REEL.W + "x" + REEL.H;
    if (directo && directoWH === wh) return;
    if (directo) { directo.destruir(); directo = null; }
    directoWH = wh;
    directo = KAOS_DIRECTO.montar(D.canvas, {
      W: REEL.W, H: REEL.H,
      // La franja que Instagram tapa con su cabecera y su pie, dibujada encima
      // de la previa. Va con el mismo interruptor que la retícula: es una guía
      // más, no un mando nuevo que aprenderse. Sin esto, mover un texto a mano
      // vuelve a dejarlo debajo del botón de compartir y no se nota hasta
      // haberlo subido.
      segura: REEL.zona ? REEL.zona() : null,
      // El calco de la interfaz de Instagram, sacado de una captura suya real.
      // Va con el mismo interruptor que la retícula: es una guía más.
      ig: REEL.zonasIG ? REEL.zonasIG() : null,
      piezas: piezasEditables,
      alMover: moverPieza,
      alGirar: girarPieza,
      alEditar: editarPieza,
      repintar: repintarQuieto,
      // Guardar en cada movimiento del dedo serían cientos de escrituras por
      // arrastre. Se guarda al soltar, que es cuando la decisión está tomada.
      alSoltar: () => REEL.guardar(st),
    });
    if (directo && D.rejilla) directo.rejilla(D.rejilla.checked !== false);
  }

  // Mientras corre la previa o la grabación la capa estorba: taparía el vídeo
  // con la retícula y dejaría una caja de selección encima de un fotograma que
  // ya no es ese. Se apaga y se vuelve a encender al acabar.
  function capaViva(v) { if (directo) directo.activar(v); }

  if (D.rejilla) {
    D.rejilla.addEventListener("change", () => {
      if (directo) directo.rejilla(D.rejilla.checked);
    });
  }
  if (D.resetPos) {
    // Una salida siempre a mano: moviendo a ojo es facilísimo dejar la
    // composición peor que estaba, y sin esto habría que ir devolviendo cada
    // pieza a su sitio a pulso.
    D.resetPos.addEventListener("click", () => {
      st.pos = JSON.parse(JSON.stringify(REEL.SITIOS));
      REEL.guardar(st);
      if (directo) directo.deseleccionar();
      dibujarQuieto();
      decir("Todo a su sitio de fábrica.");
    });
  }

  // Un fotograma fijo para que vea el encuadre sin tener que darle a PREVIA.
  let montando = false;
  // Las hojas de flash elegidas, ya pintadas y en el orden en que van. Se lee
  // `render` (1080 px) y no `thumb` (360 px): la miniatura sirve para la
  // tarjeta de una lista, no para llenar un vídeo vertical.
  //
  // Una hoja guardada antes de que esto existiera no tiene `render`. No se
  // inventa nada: se salta, y el panel avisa de cuáles hay que volver a
  // guardar.
  // Describe una hoja guardada pieza a pieza para que reel.js la redibuje.
  //
  // No se le pasa la foto de la hoja: esa lleva pegado su fondo, y aquí el
  // fondo lo pone el reel. Se le pasan los diseños y dónde iba cada uno, y el
  // reel los dibuja con la misma pegatina del flash post, sin nada detrás.
  //
  // `placements` NO lleva id dentro: va emparejado por posición con
  // `selectedIds`. Un diseño que ya no esté en la galería se salta, y su
  // colocación con él — por eso se recorre por índice y no por lista filtrada.
  function hojaPiezas(h) {
    if (!h || !h.data) return null;
    const d = h.data;
    const ids = d.selectedIds || [];
    const pl = Array.isArray(d.placements) ? d.placements : [];
    if (!ids.length || pl.length !== ids.length) return null;
    const todos = GAL.load();
    const piezas = [];
    for (let i = 0; i < ids.length; i++) {
      const it = todos.find((x) => x.id === ids[i]);
      const p = pl[i];
      if (!it || !p) continue;
      // `espejo` también: si lo volteó en la hoja, en el reel tiene que salir
      // volteado. Sin esto, el mismo diseño miraba a un lado en el flash post y
      // al otro en el vídeo.
      piezas.push({ item: it, cx: p.cx, cy: p.cy, w: p.w, h: p.h,
                    rot: p.rot || 0, espejo: !!p.espejo });
    }
    if (!piezas.length) return null;
    return { W: d.width || 1080, H: d.height || 1350, piezas: piezas };
  }
  function hojasSrc() {
    const ST = root.KAOS_STORE;
    if (!ST || !ST.getSession) return [];
    const out = [];
    for (const id of (st.hojas || [])) {
      const p = hojaPiezas(ST.getSession(id));
      if (p) out.push(p);
    }
    return out;
  }
  // Hojas elegidas que no se pueden dibujar: o se guardaron sin colocaciones, o
  // sus diseños ya no están en la galería. Se cuentan para poder decirlo en vez
  // de que desaparezcan del vídeo sin explicación.
  function hojasSinRender() {
    const ST = root.KAOS_STORE;
    if (!ST || !ST.getSession) return 0;
    let n = 0;
    for (const id of (st.hojas || [])) if (!hojaPiezas(ST.getSession(id))) n++;
    return n;
  }

  async function dibujarQuieto() {
    const list = items();
    // Cada modo mira LO SUYO: en flash post da igual que tenga diseños en la
    // ruleta, lo que se pinta son hojas. Si no hay nada del modo actual, no hay
    // nada que dibujar.
    const hojas = hojasSrc();
    if (esPases() ? !hojas.length : !list.length) return;
    // Montar una pegatina lleva su rato (papel, halo y cerrar los huecos de
    // dentro). La primera vez con muchos diseños se nota, así que se avisa en
    // vez de dejar el panel como colgado.
    let tarde = null, avisado = false;
    if (!montando) {
      montando = true;
      tarde = setTimeout(() => {
        avisado = true;
        decir("Montando las pegatinas… (" + list.length + " diseños)");
      }, 400);
    }
    let piezas;
    try {
      piezas = await REEL.preparar(st, list, hojas);
    } finally {
      if (tarde) {
        clearTimeout(tarde);
        montando = false;
        // Devolver el mensaje de siempre: si no, se queda el "montando" puesto
        // para siempre y parece que no ha terminado.
        if (avisado) decir(list.length + " diseños en la ruleta");
      }
    }
    // El fotograma quieto es el del GANADOR, no el ultimo del todo: el ultimo
    // ahora es el cierre con el logo, y de previa taparia el encuadre del
    // diseno, que es justo lo que ella esta mirando al montar la ruleta.
    const cierre = st.cierre > 0 ? st.cierre : 0;
    ultimasPiezas = piezas;
    tQuieto = piezas.dur - cierre - 0.01;
    // Si está montando la portada, el fotograma congelado es el de la portada:
    // no se puede colocar un texto sobre algo que no estás viendo. Se busca su
    // tramo en el ritmo en vez de calcularlo aparte, para que no haya dos
    // cuentas del mismo instante que puedan descuadrarse.
    if (verPortada) {
      const tramo = (piezas.pasos || []).find((p) => p.portada);
      if (tramo) tQuieto = tramo.desde + 0.01;
      else verPortada = false;      // la portada está apagada: no hay nada que ver
    }
    REEL.pintarFrame(D.canvas.getContext("2d"), piezas, tQuieto);
    // Después de pintar, no antes: la capa pregunta dónde ha quedado cada pieza
    // y eso sólo se sabe una vez pintado el fotograma.
    montarDirecto();
    capaViva(true);
    if (directo) directo.refrescar();
  }

  // ---------------------------------------------------------------- elegir
  function pedirDiseno(alElegir, titulo, filtro) {
    document.dispatchEvent(new CustomEvent("kaos-pedir-diseno", {
      detail: { alElegir: alElegir, titulo: titulo, filtro: filtro },
    }));
  }
  D.addBtn.addEventListener("click", () => {
    if (st.ids.length >= TOPE) { decir("Ya hay " + TOPE + " diseños, que es el tope.", true); return; }
    const puestos = new Set(st.ids);
    pedirDiseno((it) => {
      st.ids.push(it.id);
      REEL.guardar(st);
      pintarTira();
    }, "Añadir al reel", (it) => !puestos.has(it.id));
  });
  D.flashDay.addEventListener("click", () => {
    // El atajo obvio: el reel de ruleta es justo para anunciar el flash day.
    const ids = GAL.conTag("FLASH DAY").map(it => it.id);
    if (!ids.length) { decir("No hay ningún diseño marcado como FLASH DAY.", true); return; }
    st.ids = ids.slice(0, TOPE);
    REEL.guardar(st);
    pintarTira();
  });
  D.clearBtn.addEventListener("click", () => {
    st.ids = [];
    REEL.guardar(st);
    pintarTira();
  });

  // ------------------------------------------------- desde una hoja guardada
  // El atajo que pidió: si ya montó el flash post, los diseños ya están
  // elegidos y en orden; no tiene sentido volver a picarlos uno a uno.
  function pintarHojas() {
    if (!D.hojaSel) return;
    const list = (root.KAOS_STORE && root.KAOS_STORE.sessions) ? root.KAOS_STORE.sessions() : [];
    D.hojaSel.textContent = "";
    const cero = document.createElement("option");
    cero.value = "";
    cero.textContent = list.length ? "— elige una hoja —" : "— no tienes hojas guardadas —";
    D.hojaSel.appendChild(cero);
    for (const h of list) {
      const n = (h.data && h.data.selectedIds) ? h.data.selectedIds.length : 0;
      const o = document.createElement("option");
      o.value = h.id;
      o.textContent = h.name + " · " + n + " diseños";
      D.hojaSel.appendChild(o);
    }
    D.hojaSel.value = "";
  }
  if (D.hojaSel) D.hojaSel.addEventListener("change", () => {
    const id = D.hojaSel.value;
    if (!id) return;
    const h = root.KAOS_STORE.getSession(id);
    const ids = (h && h.data && h.data.selectedIds) || [];
    // Los diseños de una hoja vieja pueden haberse borrado de la galería. Se
    // filtran aquí para que no salgan huecos negros en la ruleta.
    const hay = new Set(GAL.load().map(x => x.id));
    const buenos = ids.filter(x => hay.has(x));
    if (!buenos.length) { decir("Esa hoja ya no tiene diseños en la galería.", true); D.hojaSel.value = ""; return; }
    st.ids = buenos.slice(0, TOPE);
    REEL.guardar(st);
    pintarTira();
    const perdidos = ids.length - buenos.length;
    const recorte = buenos.length > TOPE ? " (me quedo con los " + TOPE + " primeros)" : "";
    decir("Cargados " + st.ids.length + " diseños de «" + h.name + "»"
      + (perdidos ? ", " + perdidos + " ya no están en la galería" : "") + recorte);
    D.hojaSel.value = "";
  });

  // ------------------------------------------------------ colores del texto
  // Antes esto era un desplegable con los nombres de los colores. Para elegir
  // un color había que leer "MAGENTA" e imaginárselo, y con el panel cerrado no
  // se veía cuál estaba puesto. Ahora son los colores, se pincha y ya.
  function enlazarColor(caja, campo, conAuto, obj) {
    if (!caja) return;
    const dueno = obj || st;
    caja.textContent = "";
    const botones = [];
    const poner = (valor, hex, titulo, esAuto) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reel-col" + (esAuto ? " reel-col-auto" : "");
      b.dataset.valor = valor;
      b.title = titulo;
      b.setAttribute("aria-label", titulo);
      if (esAuto) b.textContent = "A"; else b.style.background = hex;
      b.addEventListener("click", () => {
        dueno[campo] = valor;
        REEL.guardar(st);
        marcar();
        caja.dispatchEvent(new Event("change", { bubbles: true }));
        dibujarQuieto();
      });
      caja.appendChild(b);
      botones.push(b);
    };
    // Sólo el marco lleva AUTO. Es la opción buena por defecto: el fondo lo
    // elige ella y cualquier color fijo acaba tarde o temprano encima de un
    // fondo del mismo color, y ahí el marco desaparece.
    if (conAuto) poner("auto", null, "AUTO (contrasta con el fondo)", true);
    for (const k in REEL.PALETA) poner(k, REEL.PALETA[k].hex, REEL.PALETA[k].nombre, false);

    function marcar() {
      const v = dueno[campo] || (conAuto ? "auto" : "secondary");
      for (const b of botones) {
        const on = b.dataset.valor === v;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    marcar();
  }
  enlazarColor(D.colFrase, "colFrase");
  enlazarColor(D.colMarco, "colMarco", true);
  enlazarColor(D.colCta, "colCta");
  enlazarColor(D.colHand, "colHandle");

  // Marco y frase del mismo color no rompen nada, pero el marco deja de hacer
  // su trabajo: si los dos son verde lima, el ojo ve una sola mancha de color y
  // el titular ya no destaca. No se le prohíbe — se le avisa y decide ella.
  function avisarMarco() {
    if (!D.marcoAv) return;
    D.marcoAv.hidden = st.colMarco !== st.colFrase;
  }
  if (D.colFrase) D.colFrase.addEventListener("change", avisarMarco);
  if (D.colMarco) D.colMarco.addEventListener("change", avisarMarco);
  avisarMarco();

  // ------------------------------------------------------------ sus textos
  // Frase y CTA son dos sitios fijos que siempre están. Esto es lo otro: un
  // texto suelto que se pone donde haga falta —un precio, una fecha, un
  // "quedan 2"— y que se arrastra, se gira y se escribe en la propia previa,
  // igual que los demás.
  const TOPE_TXT = 6;
  function nuevoId() {
    return "x" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  // Añade a la lista que ella esté mirando: si está montando la portada, el
  // texto nuevo es de la portada. Un solo botón para las dos cosas — poner dos
  // «+ TEXTO» distintos sería pedirle que se acuerde de cuál es cuál.
  function listaTextos() {
    if (verPortada) {
      if (!st.portada) st.portada = { activa: true, dur: 2.2, textos: [] };
      if (!st.portada.textos) st.portada.textos = [];
      return st.portada.textos;
    }
    if (!st.textos) st.textos = [];
    return st.textos;
  }
  function anadirTexto() {
    const lista = listaTextos();
    if (lista.length >= TOPE_TXT) {
      decir("Ya hay " + TOPE_TXT + " textos. Un reel con más no se lee.", true);
      return;
    }
    // Cae a un tercio de arriba: ni encima de la frase ni encima del diseño,
    // que son los dos sitios donde caer sería caer sobre algo. De ahí se
    // arrastra a donde toque.
    const t = { id: nuevoId(), txt: "TEXTO NUEVO", x: 0.5, y: 0.30,
                rot: 0, tam: 56, col: "secondary" };
    lista.push(t);
    REEL.guardar(st);
    pintarTextos();
    // Se abre a escribir solo: si no, aparece un "TEXTO NUEVO" en medio y hay
    // que adivinar que se edita con doble clic.
    Promise.resolve(dibujarQuieto()).then(() => {
      if (directo) directo.editar(prefijoAhora() + t.id);
    });
  }
  function quitarTexto(t) {
    const lista = listaTextos();
    const i = lista.indexOf(t);
    if (i >= 0) lista.splice(i, 1);
    REEL.guardar(st);
    pintarTextos();
    dibujarQuieto();
  }
  function pintarTextos() {
    if (!D.txtLista) return;
    D.txtLista.textContent = "";
    if (D.txtLabel) {
      D.txtLabel.textContent = verPortada ? "Textos de la portada" : "Textos sueltos";
    }
    for (const t of textosAhora()) {
      const fila = document.createElement("div");
      fila.className = "reel-txt";

      const cab = document.createElement("div");
      cab.className = "reel-txt-cab";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.maxLength = 40;
      inp.value = t.txt || "";
      inp.placeholder = "Texto";
      inp.addEventListener("input", () => {
        t.txt = inp.value;
        REEL.guardar(st);
        dibujarQuieto();
      });
      const x = document.createElement("button");
      x.type = "button";
      x.className = "icon-btn mini";
      x.textContent = "✕";
      x.title = "Quitar este texto";
      x.setAttribute("aria-label", "Quitar este texto");
      x.addEventListener("click", () => quitarTexto(t));
      cab.append(inp, x);

      const filaTam = document.createElement("div");
      filaTam.className = "control-row";
      const lab = document.createElement("label");
      lab.textContent = "Tamaño";
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = (t.tam || 56) + " px";
      filaTam.append(lab, val);
      const rng = document.createElement("input");
      rng.type = "range";
      rng.min = "24"; rng.max = "140"; rng.step = "2";
      rng.value = String(t.tam || 56);
      rng.addEventListener("input", () => {
        t.tam = parseInt(rng.value, 10) || 56;
        val.textContent = t.tam + " px";
        REEL.guardar(st);
        dibujarQuieto();
      });

      const col = document.createElement("div");
      col.className = "reel-colores";

      fila.append(cab, filaTam, rng, col);
      D.txtLista.appendChild(fila);
      enlazarColor(col, "col", false, t);
    }
    if (D.txtAdd) D.txtAdd.disabled = textosAhora().length >= TOPE_TXT;
  }
  if (D.txtAdd) D.txtAdd.addEventListener("click", anadirTexto);

  // ================================================ MODO, HOJAS Y PORTADA
  //
  // El modo no cambia NADA de lo que se pinta: cambia el reloj. Por eso vive
  // aquí y no en reel.js — allí sólo hay dos funciones de ritmo, y ésta es la
  // que decide cuál se usa.

  const nf = (v) => String(Math.round(v * 10) / 10).replace(".", ",");
  function esPases() { return st.modo === "pases"; }

  function pintarModo() {
    if (!D.modo) return;
    for (const b of D.modo.querySelectorAll(".seg-b")) {
      const on = b.dataset.modo === (st.modo || "ruleta");
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (D.fmt) {
      for (const b of D.fmt.querySelectorAll(".seg-b")) {
        const on = b.dataset.fmt === (st.formato || "alto");
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    if (D.fmtTip) {
      D.fmtTip.textContent = (st.formato === "9:16")
        ? "1080x1920, el de Instagram. Lo amplía para llenar la pantalla y se come "
          + "un 9% por cada lado, así que los márgenes van anchos a propósito."
        : "1080x2340. OJO: Instagram RECORTA arriba y abajo en cuanto seleccionas "
          + "el vídeo, y encima sigue ampliando a lo ancho. Sólo para otros sitios.";
      D.fmtTip.classList.toggle("warn", st.formato !== "9:16");
    }
    if (D.pasesCaja) D.pasesCaja.hidden = !esPases();
    // En «desde flash post» no se eligen diseños sueltos: se eligen hojas. Los
    // mandos de la ruleta se esconden enteros en vez de quedarse ahí sin hacer
    // nada, que es lo que hace pensar que la app está rota.
    if (D.ruletaCaja) D.ruletaCaja.hidden = esPases();
    if (D.modoTip) {
      D.modoTip.textContent = esPases()
        ? "Pasa hojas de flash enteras, sin el fondo con el que las guardaste y a "
          + "todo el ancho bueno del reel. La frase y el CTA no salen aquí: la hoja "
          + "ocupa ese sitio."
        : "Los diseños salen sueltos, como pegatinas: pasan todos rápido, frenan, "
          + "se para en uno y remata con tu logotipo.";
    }
    const z = st.hojaZoom != null ? st.hojaZoom : 1;
    if (D.zoom) D.zoom.value = String(z);
    if (D.zoomVal) D.zoomVal.textContent = Math.round(z * 100) + "%";
    const y = st.hojaY != null ? st.hojaY : 0.04;
    if (D.hojaY) D.hojaY.value = String(y);
    if (D.hojaYVal) D.hojaYVal.textContent = (y > 0 ? "+" : "") + Math.round(y * 100) + "%";
    const vu = st.vueltas != null ? st.vueltas : 1;
    if (D.vueltas) D.vueltas.value = String(vu);
    if (D.vueltasVal) D.vueltasVal.textContent = String(vu);
    const mt = st.marcoTam != null ? st.marcoTam : 1;
    if (D.marcoTam) D.marcoTam.value = String(mt);
    if (D.marcoTamVal) D.marcoTamVal.textContent = Math.round(mt * 100) + "%";
    const fr = st.zigFrames != null ? st.zigFrames : 3;
    if (D.zigFr) D.zigFr.value = String(fr);
    if (D.zigFrVal) D.zigFrVal.textContent = String(fr);
    const vv = st.zigVel != null ? st.zigVel : 4;
    if (D.zigVel) D.zigVel.value = String(vv);
    if (D.zigVelVal) D.zigVelVal.textContent = nf(vv) + "/s";
    if (D.zig) D.zig.value = String(st.zigzag != null ? st.zigzag : 1.6);
    if (D.zigVal) D.zigVal.textContent = nf(st.zigzag != null ? st.zigzag : 1.6) + "°";
    // Los mandos de la ruleta (barrido, frenada, parada) no pintan nada en modo
    // pases: se apagan en vez de dejarlos moviéndose sin efecto, que es la peor
    // manera de explicar que algo no aplica.
    for (const el of [D.barrido, D.lento, D.parada]) {
      if (!el) continue;
      el.disabled = esPases();
      const fila = el.closest(".control-row");
      if (fila) fila.classList.toggle("apagada", esPases());
    }
    if (D.paso) D.paso.value = String(st.paso || 1.5);
    if (D.pasoVal) D.pasoVal.textContent = nf(st.paso || 1.5) + " s";
    const port = st.portada || {};
    if (D.portOn) D.portOn.checked = !!port.activa;
    if (D.portFila) D.portFila.hidden = !port.activa;
    if (D.portDur) D.portDur.value = String(port.dur || 2.2);
    if (D.portDurVal) D.portDurVal.textContent = nf(port.dur || 2.2) + " s";
    if (D.portVer) {
      D.portVer.textContent = verPortada ? "VOLVER AL REEL" : "MONTAR PORTADA";
      D.portVer.classList.toggle("on", verPortada);
    }
  }

  if (D.modo) {
    D.modo.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-b");
      if (!b) return;
      st.modo = b.dataset.modo === "pases" ? "pases" : "ruleta";
      // Salir de pases con la portada abierta dejaría la previa congelada en un
      // fotograma que ese modo ni siquiera monta.
      if (!esPases()) verPortada = false;
      REEL.guardar(st);
      // pintarTira es quien enciende PREVIA y GRABAR. Sin esto, al cambiar de
      // modo los botones se quedaban como estaban en el modo anterior — que es
      // justo por lo que en flash post no se podía ni previsualizar.
      pintarModo(); pintarTextos(); pintarTira();
    });
  }
  if (D.fmt) {
    D.fmt.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-b");
      if (!b) return;
      st.formato = b.dataset.fmt === "9:16" ? "9:16" : "alto";
      REEL.guardar(st);
      // El lienzo cambia de tamano: hay que rehacer la previa entera, no solo
      // repintarla.  ya hace justo eso.
      REEL.formato(st.formato);
      D.canvas.width = REEL.W;
      D.canvas.height = REEL.H;
      pintarModo();
      dibujarQuieto();
    });
  }
  if (D.paso) {
    D.paso.addEventListener("input", () => {
      st.paso = parseFloat(D.paso.value) || 1.5;
      if (D.pasoVal) D.pasoVal.textContent = nf(st.paso) + " s";
      REEL.guardar(st); pintarBarrido(); dibujarQuieto();
    });
  }
  if (D.zoom) {
    D.zoom.addEventListener("input", () => {
      st.hojaZoom = parseFloat(D.zoom.value);
      if (isNaN(st.hojaZoom)) st.hojaZoom = 1;
      if (D.zoomVal) D.zoomVal.textContent = Math.round(st.hojaZoom * 100) + "%";
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  if (D.hojaY) {
    D.hojaY.addEventListener("input", () => {
      st.hojaY = parseFloat(D.hojaY.value);
      if (isNaN(st.hojaY)) st.hojaY = 0.04;
      if (D.hojaYVal) D.hojaYVal.textContent =
        (st.hojaY > 0 ? "+" : "") + Math.round(st.hojaY * 100) + "%";
      REEL.guardar(st); dibujarQuieto();
    });
  }
  if (D.cierreTxt) {
    D.cierreTxt.addEventListener("input", () => {
      st.cierreTxt = D.cierreTxt.value;
      REEL.guardar(st); dibujarQuieto();
    });
  }
  if (D.vueltas) {
    D.vueltas.addEventListener("input", () => {
      st.vueltas = parseInt(D.vueltas.value, 10) || 1;
      if (D.vueltasVal) D.vueltasVal.textContent = String(st.vueltas);
      REEL.guardar(st); pintarBarrido(); dibujarQuieto();
    });
  }
  if (D.marcoTam) {
    D.marcoTam.addEventListener("input", () => {
      st.marcoTam = parseFloat(D.marcoTam.value);
      if (isNaN(st.marcoTam)) st.marcoTam = 1;
      if (D.marcoTamVal) D.marcoTamVal.textContent = Math.round(st.marcoTam * 100) + "%";
      REEL.guardar(st); dibujarQuieto();
    });
  }
  if (D.zigFr) {
    D.zigFr.addEventListener("input", () => {
      st.zigFrames = parseInt(D.zigFr.value, 10) || 3;
      if (D.zigFrVal) D.zigFrVal.textContent = String(st.zigFrames);
      REEL.guardar(st); dibujarQuieto();
    });
  }
  if (D.zigVel) {
    D.zigVel.addEventListener("input", () => {
      st.zigVel = parseFloat(D.zigVel.value);
      if (isNaN(st.zigVel)) st.zigVel = 4;
      if (D.zigVelVal) D.zigVelVal.textContent = nf(st.zigVel) + "/s";
      REEL.guardar(st); dibujarQuieto();
    });
  }
  if (D.zig) {
    D.zig.addEventListener("input", () => {
      st.zigzag = parseFloat(D.zig.value);
      if (isNaN(st.zigzag)) st.zigzag = 1.6;
      if (D.zigVal) D.zigVal.textContent = nf(st.zigzag) + "°";
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  if (D.portOn) {
    D.portOn.addEventListener("change", () => {
      if (!st.portada) st.portada = { activa: false, dur: 2.2, textos: [] };
      st.portada.activa = D.portOn.checked;
      if (!st.portada.activa) verPortada = false;
      REEL.guardar(st);
      pintarModo(); pintarTextos(); dibujarQuieto();
    });
  }
  if (D.portDur) {
    D.portDur.addEventListener("input", () => {
      if (!st.portada) st.portada = { activa: true, dur: 2.2, textos: [] };
      st.portada.dur = parseFloat(D.portDur.value) || 2.2;
      if (D.portDurVal) D.portDurVal.textContent = nf(st.portada.dur) + " s";
      REEL.guardar(st); pintarBarrido(); dibujarQuieto();
    });
  }
  // Montar la portada = congelar la previa en ella. La capa de edición es la
  // MISMA (misma retícula, mismo imantado, mismo doble clic): lo único que
  // cambia es que debajo hay otro fotograma y que los textos que ofrece son los
  // de la portada.
  if (D.portVer) {
    D.portVer.addEventListener("click", () => {
      if (!st.portada || !st.portada.activa) return;
      verPortada = !verPortada;
      if (directo) directo.deseleccionar();
      pintarModo(); pintarTextos(); dibujarQuieto();
      decir(verPortada
        ? "Montando la portada. Doble clic para escribir; se arrastra igual."
        : "");
    });
  }

  // ------------------------------------------------------------ las hojas
  function pintarHojasPases() {
    if (!D.hojasLista) return;
    const ST = root.KAOS_STORE;
    D.hojasLista.textContent = "";
    (st.hojas || []).forEach((id, i) => {
      const h = ST && ST.getSession ? ST.getSession(id) : null;
      const fila = document.createElement("div");
      fila.className = "reel-txt reel-hoja";
      const im = document.createElement("img");
      im.className = "reel-hoja-mini";
      im.alt = "";
      if (h && (h.thumb || h.render)) im.src = h.thumb || h.render;
      const txt = document.createElement("div");
      txt.className = "reel-hoja-txt";
      txt.textContent = h ? h.name : "(esta hoja ya no está)";
      if (h && !hojaPiezas(h)) {
        // Honesto en vez de silencioso: no se puede inventar una versión grande
        // de una hoja que se guardó cuando no se guardaba.
        const av = document.createElement("div");
        av.className = "tip warn";
        av.textContent = "No se puede dibujar: le faltan diseños en la galería.";
        txt.appendChild(av);
      }
      // El orden de esta lista ES el orden en que salen en el vídeo, así que
      // tiene que poder cambiarse sin quitar y volver a poner. Se usa el índice
      // del bucle y no : la misma hoja puede estar puesta dos veces, y
      // entonces  devolvería siempre la primera.
      const mover = (a, b) => {
        const l = st.hojas || [];
        if (b < 0 || b >= l.length) return;
        const t = l[a]; l[a] = l[b]; l[b] = t;
        REEL.guardar(st);
        pintarHojasPases(); pintarTira();
      };
      const sube = document.createElement("button");
      sube.type = "button";
      sube.className = "icon-btn mini";
      sube.textContent = "▲";
      sube.title = "Subir";
      sube.setAttribute("aria-label", "Subir esta hoja");
      sube.disabled = i <= 0;
      sube.addEventListener("click", () => mover(i, i - 1));
      const baja = document.createElement("button");
      baja.type = "button";
      baja.className = "icon-btn mini";
      baja.textContent = "▼";
      baja.title = "Bajar";
      baja.setAttribute("aria-label", "Bajar esta hoja");
      baja.disabled = i < 0 || i >= (st.hojas || []).length - 1;
      baja.addEventListener("click", () => mover(i, i + 1));

      const x = document.createElement("button");
      x.type = "button";
      x.className = "icon-btn mini";
      x.textContent = "✕";
      x.title = "Quitar esta hoja";
      x.setAttribute("aria-label", "Quitar esta hoja");
      x.addEventListener("click", () => {
        // Por índice, no por id, por lo mismo: quitar «la segunda» tiene que
        // quitar esa, no las dos.
        (st.hojas || []).splice(i, 1);
        REEL.guardar(st);
        pintarHojasPases(); pintarTira();
      });
      fila.append(im, txt, sube, baja, x);
      D.hojasLista.appendChild(fila);
    });
    const malas = hojasSinRender();
    if (D.hojasTip) {
      D.hojasTip.textContent = malas
        ? malas + (malas === 1 ? " hoja no se puede dibujar y se salta."
                              : " hojas no se pueden dibujar y se saltan.")
        : "Van en este orden, una cada " + nf(st.paso || 2) + " s.";
      D.hojasTip.classList.toggle("warn", !!malas);
    }
  }

  // Elegir una hoja: la misma rejilla de tarjetas que el resto de la app, para
  // que reconozca la hoja mirándola y no leyendo su nombre.
  function pedirHoja() {
    const ST = root.KAOS_STORE;
    const list = (ST && ST.sessions) ? ST.sessions() : [];
    if (!list.length) { decir("No tienes hojas de flash guardadas todavía.", true); return; }
    const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const tarjetas = list.map((h, i) => `
      <button class="kd-card" data-id="${h.id}" data-act="pick" style="--i:${i}">
        <span class="kd-card-foto">${h.thumb
          ? `<img src="${h.thumb}" alt="" loading="lazy">`
          : `<div class="kd-card-sinfoto">SIN<br>MINIATURA</div>`}</span>
        <span class="kd-card-pie">
          <span class="kd-card-name">${esc(h.name)}</span>
          <span class="kd-card-meta">${hojaPiezas(h) ? "lista" : "le faltan diseños"}</span>
        </span>
      </button>`).join("");
    const back = document.createElement("div");
    back.className = "kaos-dialog-back";
    back.innerHTML = `<div class="kaos-dialog">
      <div class="kd-title">Añadir una hoja <span class="kd-cuenta">${list.length}</span></div>
      <div class="kd-cards">${tarjetas}</div>
      <div class="kd-actions"><button class="icon-btn" data-act="close">CERRAR</button></div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener("click", (e) => {
      const quien = e.target.closest && e.target.closest("[data-act]");
      const act = quien && quien.dataset.act;
      if (!act && e.target === back) { back.remove(); return; }
      if (!act) return;
      if (act === "close") { back.remove(); return; }
      const card = quien.closest(".kd-card");
      if (!card) return;
      back.remove();
      st.hojas = (st.hojas || []).concat([card.dataset.id]);
      REEL.guardar(st);
      pintarHojasPases(); pintarTira();
    });
  }
  if (D.hojasBtn) D.hojasBtn.addEventListener("click", pedirHoja);

  // ------------------------------------------------------------ fondo fijo
  // Miniaturas, no desplegable: un fondo es una imagen y el nombre no dice cómo
  // queda. Se pintan al abrir, no aquí: las fotos que ella sube entran en la
  // lista y hay que releerlas cada vez.
  function pintarFondos() {
    if (!D.fondoSel) return;
    const recs = REEL.recetas(st);
    D.fondoSel.textContent = "";
    const poner = (valor, nombre, pinta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reel-fondo";
      b.dataset.valor = valor;
      b.title = nombre;
      b.setAttribute("aria-label", nombre);
      pinta(b);
      const n = document.createElement("span");
      n.className = "reel-fondo-n";
      n.textContent = nombre;
      b.appendChild(n);
      b.addEventListener("click", () => {
        if (valor === "rotar") st.fondoFijo = false;
        else { st.fondoFijo = true; st.fondoIdx = parseInt(valor, 10) || 0; }
        REEL.guardar(st);
        marcar();
        dibujarQuieto();
      });
      D.fondoSel.appendChild(b);
    };
    recs.forEach((r, i) => {
      poner(String(i), r.nombre || ("FONDO " + (i + 1)), (b) => {
        if (r.tipo === "color") { b.style.background = r.v; return; }
        const im = document.createElement("img");
        im.src = r.v; im.alt = "";
        b.appendChild(im);
      });
    });
    poner("rotar", "ROTAR", (b) => { b.classList.add("reel-fondo-rotar"); });
    D.fondoSel.lastChild.title = "Un fondo distinto por diseño";

    function marcar() {
      const v = st.fondoFijo === false ? "rotar"
        : String((st.fondoIdx || 0) % Math.max(1, recs.length));
      for (const b of D.fondoSel.children) b.classList.toggle("on", b.dataset.valor === v);
    }
    marcar();
  }

  // ---------------------------------------------------------------- ajustes
  function enlazarTexto(el, campo) {
    el.value = st[campo] || "";
    el.addEventListener("input", () => {
      st[campo] = el.value;
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  enlazarTexto(D.frase, "frase");
  enlazarTexto(D.cta, "cta");

  // Ritmo al final y cierre con el logo. Los dos cambian la cuenta del ritmo,
  // asi que se vuelve a montar la previa: si no, se veria la de antes.
  if (D.lento) {
    D.lento.value = st.lento;
    D.lentoVal.textContent = (+st.lento).toFixed(2) + "s";
    D.lento.addEventListener("input", () => {
      st.lento = parseFloat(D.lento.value);
      D.lentoVal.textContent = st.lento.toFixed(2) + "s";
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  // La pasada rápida y la parada. Las dos cambian la cuenta del ritmo, así que
  // se vuelve a montar la previa.
  if (D.barrido) {
    D.barrido.value = st.barrido;
    pintarBarrido();
    D.barrido.addEventListener("input", () => {
      st.barrido = parseFloat(D.barrido.value);
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  // Los dos textos que dependen de cuántos diseños haya: cuánto le toca a cada
  // uno en la pasada rápida, y cuánto dura el reel entero.
  function pintarBarrido() {
    // El total sale de las piezas del modo en el que está. Sumar los dos daba
    // una duración que no se correspondía con lo que se iba a grabar.
    const n = cuantasPiezas();
    if (D.barridoVal) D.barridoVal.textContent = (+st.barrido).toFixed(1) + "s";
    if (D.barridoTip) {
      D.barridoTip.innerHTML = n
        ? "Pasa <b>una vez</b> por los " + n + " diseños en " + (+st.barrido).toFixed(1)
          + "s — " + coma(Math.max(st.minInt || 0.03, st.barrido / n), 2) + "s cada uno."
        : "Lo que tarda en pasar <b>una vez</b> por todos los diseños al principio.";
    }
    pintarTotal(n);
  }
  function coma(x, d) { return x.toFixed(d).replace(".", ","); }

  function pintarTotal(n) {
    if (!D.durVal) return;
    if (!n) { D.durVal.textContent = "—"; return; }
    const total = REEL.duracion(st, n);
    D.durVal.textContent = coma(total, 1) + "s";
    // Instagram corta los reels en 90 s. Es el único límite duro que hay aquí,
    // así que se avisa en vez de dejar que lo descubra al subirlo.
    const caja = D.durVal.parentElement;
    if (caja) caja.classList.toggle("largo", total > 90);
    if (!D.durTip) return;
    D.durTip.innerHTML = total > 90
      ? "<b>Pasa de 90s y a Instagram no le vale.</b> Quita diseños, baja el "
        + "«Ritmo al final» o acorta la parada."
      : n + " rápidos + " + n + " despacio a " + coma(st.lento, 2) + "s"
        + " + " + coma(st.parada, 1) + "s parado"
        + (st.cierre > 0 ? " + " + coma(st.cierre, 1) + "s de logo" : "") + ".";
  }
  if (D.parada) {
    D.parada.value = st.parada;
    D.paradaVal.textContent = (+st.parada).toFixed(1) + "s";
    D.parada.addEventListener("input", () => {
      st.parada = parseFloat(D.parada.value);
      D.paradaVal.textContent = st.parada.toFixed(1) + "s";
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }
  if (D.cierre) {
    D.cierre.value = st.cierre;
    D.cierreVal.textContent = (+st.cierre).toFixed(1) + "s";
    D.cierre.addEventListener("input", () => {
      st.cierre = parseFloat(D.cierre.value);
      D.cierreVal.textContent = st.cierre.toFixed(1) + "s";
      pintarBarrido();
      REEL.guardar(st);
      dibujarQuieto();
    });
  }

  D.vidBtn.addEventListener("click", () => D.vidInput.click());
  D.vidInput.addEventListener("change", () => {
    const f = D.vidInput.files && D.vidInput.files[0];
    D.vidInput.value = "";
    if (!f) return;
    // objectURL, no data:. Un vídeo en base64 en localStorage reventaría la
    // cuota; además así no se copia el fichero a ningún sitio.
    if (st.fondoVideoUrl) URL.revokeObjectURL(st.fondoVideoUrl);
    st.fondoVideoUrl = URL.createObjectURL(f);
    D.vidQuit.disabled = false;
    decir("Vídeo de fondo puesto: " + f.name + " (se pierde al recargar la página).");
    dibujarQuieto();
  });
  D.vidQuit.addEventListener("click", () => {
    if (st.fondoVideoUrl) URL.revokeObjectURL(st.fondoVideoUrl);
    st.fondoVideoUrl = null;
    D.vidQuit.disabled = true;
    dibujarQuieto();
  });

  D.fondoBtn.addEventListener("click", () => D.fondoInp.click());
  D.fondoInp.addEventListener("change", async () => {
    const files = Array.prototype.slice.call(D.fondoInp.files || []);
    D.fondoInp.value = "";
    for (const f of files) {
      const data = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => res(null);
        fr.readAsDataURL(f);
      });
      if (data) st.fondosPropios.push(data);
    }
    REEL.guardar(st);
    pintarFondos();
    decir(st.fondosPropios.length + " fotos tuyas disponibles como fondo.");
    dibujarQuieto();
  });

  // ---------------------------------------------------------------- previa
  D.playBtn.addEventListener("click", async () => {
    if (pararPrevia) {
      pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA";
      dibujarQuieto();
      return;
    }
    if (cuantasPiezas() < MINIMO()) return;
    const list = items();
    D.playBtn.textContent = "■ PARAR";
    capaViva(false);
    const piezas = await REEL.preparar(st, list, hojasSrc());
    pararPrevia = REEL.previsualizar(D.canvas, piezas, () => {
      pararPrevia = null;
      D.playBtn.textContent = "▶ PREVIA";
      // Vuelve al fotograma quieto con la capa puesta: si no, se queda el
      // último frame del cierre y ya no hay nada que pinchar.
      dibujarQuieto();
    });
  });

  // ---------------------------------------------------------------- grabar
  D.recBtn.addEventListener("click", async () => {
    if (cuantasPiezas() < MINIMO() || grabando) return;
    const list = items();
    if (pararPrevia) { pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA"; }
    grabando = true;
    D.recBtn.disabled = true;
    capaViva(false);
    const etiqueta = D.recBtn.textContent;
    try {
      const piezas = await REEL.preparar(st, list, hojasSrc());
      decir("Grabando… tarda lo que dura el reel (" + coma(piezas.dur, 1) + "s). No cambies de pestaña.");
      const out = await REEL.grabar(piezas, (p) => {
        D.recBtn.textContent = "GRABANDO " + Math.round(p * 100) + "%";
        REEL.pintarFrame(D.canvas.getContext("2d"), piezas, p * piezas.dur);
      });
      const nombre = "kaos-realm_reel_" + Date.now() + "." + out.ext;
      // "Guardar como" de Windows si el navegador lo tiene; si no, a Descargas
      // como siempre. Un reel pesa bastante y acaba en la carpeta que ella
      // quiera, no en el montón de Descargas.
      let guardado = false;
      if (typeof window.showSaveFilePicker === "function") {
        try {
          const h = await window.showSaveFilePicker({
            suggestedName: nombre,
            id: "kaosFlash",
            startIn: "videos",
            types: [{ description: "Vídeo", accept: { [out.blob.type || "video/mp4"]: ["." + out.ext] } }],
          });
          const w = await h.createWritable();
          await w.write(out.blob);
          await w.close();
          guardado = true;
        } catch (e) {
          if (e && e.name === "AbortError") { decir("Grabado, pero no lo has guardado."); return; }
          console.warn("guardar como no disponible", e);
        }
      }
      if (!guardado) {
        const url = URL.createObjectURL(out.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 20000);
      }
      if (out.esMp4) {
        decir("Listo. " + (Math.round(out.blob.size / 1e5) / 10) + " MB en MP4, súbelo tal cual.");
        D.aviso.hidden = true;
      } else {
        // No es un detalle menor: Instagram no traga WebM. Decirlo claro.
        decir("Listo, pero ha salido en WebM.", true);
        D.aviso.hidden = false;
      }
    } catch (e) {
      decir(String((e && e.message) || e), true);
    } finally {
      grabando = false;
      D.recBtn.disabled = false;
      D.recBtn.textContent = etiqueta;
      // Deja la previa como estaba, editable. Al grabar el lienzo se queda con
      // el último fotograma del cierre y sin la capa encima.
      dibujarQuieto();
    }
  });

  // ----------------------------------------------------------- borradores
  // Un reel a medias: los diseños elegidos, la frase, los colores y los ritmos.
  // El vídeo de fondo no cabe en un borrador (es un objectURL, muere al
  // recargar), así que se avisa en vez de guardar una referencia rota.
  if (D.borr && root.KAOS_BORRADORES) {
    KAOS_BORRADORES.montar(D.borr, {
      tipo: "reel",
      nombre: () => esPases()
        ? "Flash post de " + (st.hojas || []).length + " hojas"
        : "Reel de " + st.ids.length + " diseños",
      // La previa quieta es exactamente el fotograma del ganador: la mejor foto
      // posible del borrador sin tener que dibujar nada aparte.
      foto: () => D.canvas,
      aviso: st.fondoVideoUrl ? "el vídeo de fondo hay que volver a ponerlo" : "",
      leer: () => {
        const copia = Object.assign({}, st);
        delete copia.fondoVideoUrl;
        return copia;
      },
      poner: (data) => {
        // El vídeo que hubiera puesto ahora se conserva: el borrador no lo
        // guarda, así que tampoco tiene por qué quitarlo.
        const video = st.fondoVideoUrl;
        st = Object.assign(REEL.estado(), data, { fondoVideoUrl: video });
        REEL.guardar(st);
        sincronizarMandos();
        pintarFondos();
        // La pieza que estuviera elegida es de la composición anterior: al
        // abrir otro borrador se sueltan las cajas para no dejar una selección
        // señalando a un sitio que ya no existe.
        if (directo) directo.deseleccionar();
        pintarTira();
      },
    });
  }

  // Devuelve todos los mandos al valor que marque el estado. Hace falta al
  // abrir un borrador: si no, los deslizadores se quedan donde estaban y
  // enseñan una cosa mientras el reel hace otra.
  function sincronizarMandos() {
    if (D.frase) D.frase.value = st.frase || "";
    if (D.cta) D.cta.value = st.cta || "";
    if (D.cierreTxt) D.cierreTxt.value = st.cierreTxt || "";
    const pares = [[D.lento, D.lentoVal, "lento", 2], [D.barrido, D.barridoVal, "barrido", 1],
                   [D.parada, D.paradaVal, "parada", 1], [D.cierre, D.cierreVal, "cierre", 1]];
    for (const [inp, val, campo, dec] of pares) {
      if (!inp) continue;
      inp.value = st[campo];
      if (val) val.textContent = (+st[campo]).toFixed(dec) + "s";
    }
    enlazarColor(D.colFrase, "colFrase");
    enlazarColor(D.colMarco, "colMarco", true);
    enlazarColor(D.colCta, "colCta");
    enlazarColor(D.colHand, "colHandle");
    avisarMarco();
    pintarTextos();
  }

  // ---------------------------------------------------------------- abrir
  function abrir() {
    D.modal.style.display = "";
    // El formato se fija ANTES de medir el lienzo: si no, la previa se queda
    // con el tamano del formato anterior y todo sale descuadrado.
    REEL.formato(st.formato);
    D.canvas.width = REEL.W;
    D.canvas.height = REEL.H;
    D.vidQuit.disabled = !st.fondoVideoUrl;
    // Las pegatinas salen del papel del flash post. Si lo cambió mientras el
    // panel estaba cerrado, se rehacen; si no, la caché las devuelve al vuelo.
    if (REEL.olvidarPegatinas) REEL.olvidarPegatinas();
    pintarModo();
    pintarHojasPases();
    pintarFondos();
    pintarTextos();
    pintarTira();
  }
  function cerrar() {
    if (pararPrevia) { pararPrevia(); pararPrevia = null; D.playBtn.textContent = "▶ PREVIA"; }
    D.modal.style.display = "none";
  }
  D.openBtn.addEventListener("click", abrir);
  D.closeBtn.addEventListener("click", cerrar);
  D.modal.addEventListener("click", (e) => { if (e.target === D.modal) cerrar(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && D.modal.style.display !== "none") cerrar();
  });
})(window);
