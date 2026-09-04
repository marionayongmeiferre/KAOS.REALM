// KAOS.REALM — reel de ruleta (v1)
//
// Coge unos cuantos diseños de la galería y monta un vídeo vertical 1080x1920:
// cada diseño sale como pegatina recortada, con un fondo distinto, y van
// cambiando muy rápido al principio y cada vez más lento, hasta pararse en uno
// — como una ruleta. Encima va una frase y un CTA.
//
// Por qué canvas + MediaRecorder y no ffmpeg: esto corre en su navegador, en el
// PC y en el iPad, sin instalar nada. La contrapartida está abajo, en
// `mejorFormato`: el contenedor que sale depende del navegador, y no siempre es
// el que Instagram acepta. Se avisa, no se disimula.
(function (root) {
  "use strict";

  // EL FORMATO DEL VIDEO, Y POR QUE HAY DOS
  //
  // Instagram enseña el reel a pantalla completa: escala el video hasta CUBRIR
  // la pantalla y recorta lo que sobra. Su iPhone es 1179x2556. Con un video
  // 9:16 (1080x1920) la cuenta sale asi:
  //
  //   escala = max(1179/1080, 2556/1920) = 1,33
  //   ancho escalado = 1438 px  ->  se salen 259 px  ->  9% POR CADA LADO
  //
  // Nueve por ciento por lado. Por eso lo veia con zoom y con los bordes
  // comidos: el margen lateral que teniamos era del 5,5%.
  //
  // Dos maneras de arreglarlo, y las dos estan aqui porque sirven para cosas
  // distintas:
  //
  // LO QUE SE PROBO Y NO FUNCIONO
  //
  // Se intento exportar mas alto (1080x2340) para que Instagram no tuviera que
  // ampliar. NO VALE: Instagram recorta a 9:16 en cuanto seleccionas el video,
  // antes de publicarlo, asi que lo alto pierde la parte de arriba y la de
  // abajo — y despues sigue ampliando a lo ancho igual. Sale perdiendo dos
  // veces. Comprobado subiendolo.
  //
  // Asi que el lienzo es 9:16 y punto, y el recorte lateral del 9% se combate
  // de la unica manera que queda: dejando margen de sobra. Con 13% por lado
  // quedan 4 puntos visibles despues del recorte, que es un margen que se ve
  // como margen y no como "por poco".
  //
  //   "9:16" 1080x1920 — el de Instagram. El unico que no pierde nada.
  //   "alto" 1080x2340 — para OTROS sitios. En Instagram lo recorta.
  const FORMATOS = {
    "9:16": { W: 1080, H: 1920, lados: 0.13, nombre: "9:16 INSTAGRAM" },
    alto:   { W: 1080, H: 2340, lados: 0.055, nombre: "ALTO · NO PARA IG" },
  };
  let FMT = "9:16";
  let W = FORMATOS[FMT].W, H = FORMATOS[FMT].H;
  // Cambia el lienzo. Hay que llamarla ANTES de preparar o pintar: todo lo
  // demas lee W y H en el momento, asi que con esto puesto sale solo.
  function formato(nombre) {
    const f = FORMATOS[nombre] || FORMATOS["9:16"];
    FMT = FORMATOS[nombre] ? nombre : "9:16";
    W = f.W; H = f.H;
    SEGURO.lados = f.lados;
    IG.lados = f.lados;
    return f;
  }
  function tam() { return { W: W, H: H, formato: FMT }; }
  const VERDE = "#d4ff2f";               // texto en pantalla: siempre verde lima
  const MAGENTA = "#ff3d5c";
  const HUESO = "#e8e2d4";
  const NEGRO = "#0a0908";
  const FUENTE = '"Helvetica Neue LT Std 73 BEx", Impact, sans-serif';

  const K_EST = "kaos.reel.v1";
  // Sube cuando cambia un valor por defecto que ya tenía guardado: si no, el
  // ajuste viejo de su localStorage gana y parece que el cambio no ha entrado.
  const VERSION = 9;

  // ZONA SEGURA
  // El vídeo sale a 1080x1920 entero, pero Instagram NO enseña los 1920: pone
  // su propia interfaz encima. Arriba la cabecera; abajo el pie de nombre,
  // texto, audio y botones, que es la franja que más se come; a los lados, el
  // recorte de las pantallas estrechas y la columna de iconos de la derecha.
  // Lo que caiga ahí queda tapado o pegado al borde — es lo que le pasó al
  // subirlo. Estas cifras son fracción del lienzo y marcan el rectángulo donde
  // SÍ se ve todo. Todo lo que se pinta encima (marco, textos, firma) se
  // coloca dentro; el fondo sigue llenando el lienzo entero, porque ahí que se
  // recorte no molesta.
  // LA INTERFAZ DE INSTAGRAM, MEDIDA
  //
  // Estas cifras NO son de oído: salen de una captura suya real de un reel ya
  // publicado, en su iPhone (3 de septiembre de 2026). Son fracción de la
  // pantalla, que es prácticamente lo mismo que fracción del vídeo porque
  // Instagram lo encaja a lo ancho.
  //
  // Cada bloque es una parte que Instagram TAPA con lo suyo:
  const IG = {
    // Arriba: hora, cobertura, batería, la flecha de volver y la cámara.
    arriba: 0.125,
    // Abajo: su foto, el nombre de la cuenta, la música, el texto del post, la
    // barra de progreso y la caja de «enviar un mensaje». Es la franja que más
    // se come, y la que le estaba tapando la firma.
    abajo: 0.235,
    // La columna de la derecha: corazón, comentarios, compartir, enviar, los
    // tres puntos y la miniatura del perfil.
    iconosX: 0.845,
    iconosY0: 0.42,
    iconosY1: 0.90,
    // Recorte lateral: la pantalla es más estrecha que el vídeo y se come un
    // poco por los lados.
    // Lo pone  segun el lienzo elegido: en 9:16 Instagram recorta
    // por los lados y hace falta mucho mas margen que en el alto.
    lados: 0.13,
  };
  const SEGURO = { lados: IG.lados, arriba: IG.arriba, abajo: IG.abajo };
  function zona() {
    return {
      x0: W * SEGURO.lados,
      x1: W * (1 - SEGURO.lados),
      y0: H * SEGURO.arriba,
      y1: H * (1 - SEGURO.abajo),
    };
  }
  // Lo que hay que dibujar encima de la previa para que ella VEA dónde va a
  // caer la interfaz de Instagram. Sólo guía: nunca entra en el vídeo.
  function zonasIG() {
    const iy0 = H * IG.iconosY0, iy1 = H * IG.iconosY1;
    const ix = W * IG.iconosX;
    // Los seis iconos de la derecha, repartidos por su columna. Se dibujan como
    // círculos porque es lo que se reconoce de un vistazo, no un rectángulo.
    const iconos = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      iconos.push({
        x: ix + (W - ix) * 0.42,
        y: iy0 + ((iy1 - iy0) / n) * (i + 0.5),
        r: W * 0.035,
      });
    }
    return {
      segura: zona(),
      bloques: [
        { x: 0, y: 0, w: W, h: H * IG.arriba, txt: "HORA · VOLVER · CÁMARA" },
        { x: 0, y: H * (1 - IG.abajo), w: W, h: H * IG.abajo, txt: "NOMBRE · TEXTO · MÚSICA" },
        { x: ix, y: iy0, w: W - ix, h: iy1 - iy0, txt: "" },
      ],
      iconos: iconos,
    };
  }

  // Dónde va cada pieza del fotograma, en fracción del lienzo (0..1) y no en
  // píxeles: así el mismo ajuste vale aunque mañana el reel se exporte a otro
  // tamaño. `rot` en grados. Antes estas cifras estaban clavadas dentro de
  // `pintarFrame`; ahora son estado, para poder moverlas arrastrando en la
  // previa y para que se guarden con el borrador.
  //
  // Las cifras de antes (frase 0.135, cta 0.845, firma 0.949) dejaban el CTA y
  // la firma justo debajo del pie de Instagram: en el móvil no se leían, y la
  // frase de arriba quedaba pegada al borde. Ahora las cuatro piezas viven
  // dentro de la zona segura de arriba.
  //
  // Segunda pasada, con las cifras medidas de su captura: la frase estaba a 4
  // puntos de la interfaz de arriba y la firma a 1,5 de la de abajo — por eso
  // se veia todo pegado a los bordes. Ahora cada pieza tiene aire de verdad, y
  // el dibujo se reparte lo que queda en medio.
  const SITIOS = {
    frase: { x: 0.5, y: 0.195, rot: 0 },
    arte:  { x: 0.5, y: 0.423, rot: 0 },
    cta:   { x: 0.5, y: 0.645, rot: 0 },
    firma: { x: 0.5, y: 0.730, rot: 0 },
  };
  // Mete un sitio {x,y} dentro de la zona segura. Se usa al migrar un borrador
  // viejo: sus textos podían estar en cualquier parte, incluso donde ya no se
  // ven.
  function meterEnZona(p) {
    if (!p) return p;
    const lim = (v, a, b) => Math.max(a, Math.min(b, v));
    p.x = lim(p.x != null ? p.x : 0.5, SEGURO.lados, 1 - SEGURO.lados);
    p.y = lim(p.y != null ? p.y : 0.5, SEGURO.arriba, 1 - SEGURO.abajo);
    return p;
  }
  // Rellena los huecos: un estado viejo puede traer sólo dos piezas movidas.
  function sitios(st) {
    const p = (st && st.pos) || {};
    const out = {};
    for (const k in SITIOS) out[k] = Object.assign({}, SITIOS[k], p[k] || {});
    return out;
  }

  // ---------------------------------------------------------------- estado
  const POR_DEFECTO = {
    // CÓMO SE MONTA EL VÍDEO. Dos maneras, y cambian sólo el reloj:
    //   "ruleta" — el de siempre: los diseños pasan rapidísimo y van frenando
    //              hasta pararse en uno, como una tragaperras.
    //   "pases"  — pase de páginas: cada cosa se queda en pantalla `paso`
    //              segundos, todas igual, y al final la portada. Sirve para
    //              enseñar hojas de flash enteras, que en la ruleta pasan
    //              demasiado rápido para leerlas.
    // Lo que se pinta es lo mismo en los dos: fondo, marco, la pieza, los
    // textos y la firma. Sólo cambia CUÁNTO dura cada una.
    modo: "ruleta",
    // Segundos por hoja. 2 s es lo que pidió: da tiempo a recorrer una hoja
    // entera sin que el vídeo se haga largo.
    paso: 2.0,
    // Vaivén de cada diseño dentro de la hoja: gira un poquito a un lado y al
    // otro sobre su propio centro, cada uno a su aire. Grados de amplitud; 0 lo
    // apaga. Es MUY poco a propósito — a partir de unos 3 grados deja de leerse
    // como que la hoja respira y empieza a parecer que el vídeo va mal.
    zigzag: 1.6,
    // Cuánto se agranda la hoja dentro del reel. 1 = lo justo para caber en la
    // zona segura. Por encima de 1 se sale de esa zona, que es justo lo que
    // ella quiere cuando prefiere ver los diseños grandes: lo que se pierde son
    // los márgenes, no un diseño por la mitad, porque la hoja va centrada.
    hojaZoom: 1,
    // Cuánto se baja la hoja respecto al centro de la franja buena, en fracción
    // del alto. Positivo = más abajo. Arranca un poco baja porque centrada del
    // todo quedaba alta en el móvil, con un vacío debajo.
    hojaY: 0.04,
    // Tamano del marco de esquinas. 1 = la zona segura entera. Se encoge o se
    // agranda sobre su centro, y en modo flash post baja con la hoja.
    marcoTam: 1,
    // Texto de la tarjeta de cierre, debajo del logo y del arroba. Vacio = no
    // sale nada, que es como viene.
    cierreTxt: "",
    // Lienzo del video. Ver FORMATOS, arriba.
    formato: "9:16",
    // Veces que se pasa por todas las hojas antes de la portada y el cierre.
    vueltas: 1,
    // Saltos por segundo del vaivén.
    zigVel: 4,
    // En cuantas posiciones distintas se para cada diseno. Es OTRA cosa que la
    // velocidad: 3 rapidos tiembla, 8 lentos parece un giro de verdad. 3 es lo
    // que habia antes de que esto se pudiera tocar.
    zigFrames: 3,
    // Hojas de flash guardadas que entran como páginas, por id. Van aparte de
    // `ids` porque una hoja es una imagen entera y un diseño es una pegatina
    // recortada: se pintan distinto.
    hojas: [],
    // La portada del final. Es un fotograma suyo, sin diseño: fondo, marco,
    // firma y los textos que ella ponga, con la misma retícula e imantado que
    // el resto del reel.
    //
    // Va al FINAL y no al principio a propósito: Instagram deja elegir como
    // carátula cualquier fotograma del vídeo, y si va la primera la ve todo el
    // que pasa por el feed antes de ver el contenido. Al final remata y sigue
    // sirviendo de carátula.
    portada: {
      activa: false,         // apagada por defecto: no cambia sus reels de ahora
      dur: 2.2,              // cuánto se queda en pantalla
      textos: [],            // los suyos, misma forma que `textos`
    },
    ids: [],                 // diseños elegidos, en orden
    frase: "¿CUÁL TE TOCA?",
    cta: "PÁRALO Y ESCRÍBEME",
    pos: JSON.parse(JSON.stringify(SITIOS)),
    // Textos que añade ella, además de la frase y el CTA. Cada uno lleva su
    // sitio encima: no van en `pos` porque `pos` tiene cuatro piezas fijas que
    // siempre existen, y estos van y vienen.
    //   { id, txt, x, y, rot, tam, col }
    // x e y en fracción del lienzo, igual que SITIOS.
    textos: [],
    // Ya no hay `dur`: la duracion la calcula `duracion()` a partir de cuantos
    // diseños haya y del ritmo. Ver el comentario de `ritmo`.
    // Cuánto aguanta el ganador antes del logo. Estaba en 2,2 s y se hacía un
    // hueco muerto entre el último diseño y el cierre: se para, y ahí quieto,
    // y el ojo ya se ha ido. Un segundo es suficiente para leer el diseño.
    parada: 1.0,
    // Cuánto dura la pasada rápida en la que salen TODOS los diseños una vez.
    // Es el mando que pidió: en vez de adivinar un intervalo, se dice cuánto
    // quiere que dure el barrido entero y el intervalo sale de dividir.
    barrido: 2.4,
    minInt: 0.03,            // el cambio más rápido que se admite
    maxInt: 0.85,            // tope duro del intervalo
    // A qué ritmo se queda una vez ha frenado. 0,7 s por diseño es lo que
    // tarda el ojo en verlo de verdad: por debajo se intuye, no se mira.
    lento: 0.7,
    // Cierre con el logotipo completo, en segundos. 0 lo quita.
    cierre: 1.4,
    fondoVideoUrl: null,     // vídeo de fondo opcional (objectURL)
    fondosPropios: [],       // fotos suyas como fondo, en data:
    // Antes cada diseño llevaba un fondo distinto y el fondo parpadeaba a la
    // velocidad de la ruleta: mareaba y no dejaba mirar el diseño, que es lo
    // único que importa en esta pieza. Ahora el fondo se queda quieto y lo
    // único que cambia es el dibujo. Poniéndolo en false vuelve a rotar.
    fondoFijo: true,
    fondoIdx: 0,             // cuál de las recetas se usa cuando está fijo
    fps: 30,
    // Colores del texto, con los mismos nombres que el editor de posts para que
    // no tenga que aprenderse otra paleta. El verde lima sigue siendo el que
    // manda la marca, así que es el que viene puesto.
    colFrase: "secondary",
    colCta: "secondary",
    colHandle: "secondary",
    // El marco tiene color propio. Antes se pintaba con el color de la frase, y
    // marco y titular salían siempre del mismo verde: dos cosas distintas
    // gritando lo mismo. Con el magenta de marca el marco enmarca y la frase se
    // lee, que es lo que tiene que pasar.
    // "auto" y no un color fijo: el fondo cambia según lo que elija, y con el
    // marco en magenta sobre un fondo magenta el marco desaparecía del todo.
    // Auto mira el fondo ya pintado y saca hueso sobre oscuro, negro sobre
    // claro. Distinto del titular siempre, que es lo que ella pidió.
    colMarco: "auto",
    marco: true,             // las esquinas de línea, como en el flash post
    logo: true,              // su logo encima del @
  };
  // Mismos nombres que resolveDecor del editor de posts.
  const PALETA = {
    secondary: { nombre: "VERDE LIMA", hex: VERDE },
    primary:   { nombre: "MAGENTA",    hex: MAGENTA },
    white:     { nombre: "BLANCO",     hex: "#ffffff" },
    black:     { nombre: "NEGRO",      hex: NEGRO },
    hueso:     { nombre: "HUESO",      hex: HUESO },
  };
  function color(nombre) { return (PALETA[nombre] || PALETA.secondary).hex; }

  // Mira las cuatro esquinas del lienzo ya pintado y decide si el marco tiene
  // que ir claro u oscuro. Son cuatro lecturas de 10x10 píxeles: nada al lado
  // de pintar el fotograma entero.
  function marcoAuto(ctx, st) {
    // Se mira justo donde van a caer las esquinas del marco, no las esquinas
    // del lienzo: desde que el marco vive dentro de la zona segura son sitios
    // distintos, y con un fondo de degradado el color de ahí no tiene nada que
    // ver con el del borde.
    const z = rectMarco(st);
    const pts = [
      [z.x0, z.y0], [z.x1 - 10, z.y0],
      [z.x0, z.y1 - 10], [z.x1 - 10, z.y1 - 10],
    ].map(function (q) { return [Math.round(q[0]), Math.round(q[1])]; });
    let suma = 0, n = 0;
    for (const q of pts) {
      let d;
      try { d = ctx.getImageData(Math.max(0, q[0]), Math.max(0, q[1]), 10, 10).data; }
      catch (e) { continue; }                       // lienzo sucio: se deja el claro
      for (let i = 0; i < d.length; i += 4) {
        suma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
    }
    if (!n) return HUESO;
    return (suma / n) < 150 ? HUESO : NEGRO;
  }
  function estado() {
    try {
      const j = JSON.parse(localStorage.getItem(K_EST) || "null");
      // El vídeo de fondo es un objectURL: muere al recargar y guardarlo
      // dejaría un fondo roto sin explicación. Se descarta a propósito.
      if (j) {
        const st = Object.assign({}, POR_DEFECTO, j, { fondoVideoUrl: null });
        if ((j.v || 1) < 2) {
          // v2: menos parada antes del logo y barrido rápido por tiempo.
          st.parada = POR_DEFECTO.parada;
          st.barrido = POR_DEFECTO.barrido;
          st.minInt = POR_DEFECTO.minInt;
        }
        // v3: la duracion se calcula. La que tuviera guardada ya no pinta nada.
        if ((j.v || 1) < 3) delete st.dur;
        // v4: las piezas se pueden mover. Un estado anterior no trae `pos`, y
        // `sitios()` le pone los sitios de siempre, que son exactamente donde
        // estaban antes clavados: al abrir el panel no ve ningún cambio.
        st.pos = sitios(st);
        // v5: zona segura de Instagram. Los sitios guardados son justo los que
        // el pie de Instagram tapaba, así que se tiran y se ponen los nuevos —
        // si se respetaran, el arreglo no se notaría y seguiría subiendo reels
        // con el CTA debajo del botón de compartir. Sus textos sueltos sí se
        // respetan: sólo se empujan adentro si se salen.
        if ((j.v || 1) < 5) {
          st.pos = JSON.parse(JSON.stringify(SITIOS));
          for (const t of (st.textos || [])) meterEnZona(t);
        }
        // v6: modo de montaje y portada. `Object.assign` ya ha puesto los
        // valores nuevos, pero `portada` es un objeto: si el borrador viejo no
        // lo trae hay que rellenarlo entero, y si lo trae a medias también.
        st.portada = Object.assign({}, POR_DEFECTO.portada, st.portada || {});
        if (!Array.isArray(st.portada.textos)) st.portada.textos = [];
        if (!Array.isArray(st.hojas)) st.hojas = [];
        if (st.modo !== "pases") st.modo = "ruleta";
        // v8: el cierre ya no repite el CTA. Se vacia tambien en los borradores
        // viejos: si no, seguirian sacando una frase que ella no eligio poner
        // ahi y que hasta ahora no podia quitar.
        if ((j.v || 1) < 8) st.cierreTxt = "";
        // v9: el formato alto se probo y lo recorta Instagram al seleccionarlo.
        // Se devuelve a 9:16 a todo el mundo: quedarse en alto es publicar con
        // la parte de arriba y la de abajo cortadas.
        if ((j.v || 1) < 9) {
          st.formato = "9:16";
          // Los sitios cambian con el formato: dejarle los viejos seria dejarle
          // la frase pegada al borde, que es justo de lo que se quejo.
          st.pos = JSON.parse(JSON.stringify(SITIOS));
          for (const t of (st.textos || [])) meterEnZona(t);
          if (st.portada && st.portada.textos) {
            for (const t of st.portada.textos) meterEnZona(t);
          }
        }
        // v7: las hojas pasan cada 2 s (antes 1,5) y se dibujan sin su fondo,
        // no como una foto. El ajuste viejo se tira: 1,5 s era el valor por
        // defecto de una versión que ella no llegó a usar.
        if ((j.v || 1) < 7) {
          st.paso = POR_DEFECTO.paso;
          st.zigzag = POR_DEFECTO.zigzag;
        }
        st.v = VERSION;
        return st;
      }
    } catch (e) {}
    return Object.assign({}, POR_DEFECTO, { v: VERSION });
  }
  function guardar(st) {
    try {
      const copia = Object.assign({}, st);
      delete copia.fondoVideoUrl;
      localStorage.setItem(K_EST, JSON.stringify(copia));
    } catch (e) {}
    return st;
  }

  // ---------------------------------------------------------------- ritmo
  // La ruleta tiene DOS pasadas completas, y las dos enseñan TODOS los diseños:
  //   1) PASADA RÁPIDA — todos, una vez, en el tiempo que diga `barrido`.
  //   2) FRENADA — cinco escalones para que no dé el salto de golpe.
  //   3) PASADA LENTA — todos otra vez, a `lento` (0,7 s) cada uno.
  //   4) GANADOR — se para en uno, y el remate con el logotipo.
  //
  // Antes la pasada lenta duraba lo que sobrara del reel, así que sólo le daba
  // tiempo a enseñar unos pocos: con 20 diseños se veían 4. Ahora es al revés
  // — la pasada lenta enseña los que haya y la duración del reel SALE de ahí.
  // Por eso ya no hay mando de segundos: el total se calcula y se enseña.
  //
  // Devuelve una lista de {desde, hasta, slot} en segundos.
  const ESCALONES = 5;   // pasos de frenada entre la pasada rápida y la lenta

  // PASE DE PÁGINAS. Todas las piezas el mismo rato, sin frenada ni ganador:
  // no es una tragaperras, es pasar hojas. Al final la portada y el remate del
  // logo, si los quiere.
  //
  // Devuelve la misma forma que `ritmo` ({desde, hasta, slot}) para que la
  // previa, el pintado y la grabación no tengan que saber en qué modo están.
  function ritmoPases(st, nSlots) {
    const pasos = [];
    const n = Math.max(1, nSlots);
    // Entre 0,3 s (ya casi no se lee) y 6 s (más es una foto fija, no un reel).
    // Hasta 0,2 s: a ese ritmo ya no se lee una hoja, pero sirve para pasar
    // muchas de golpe como remate. Ella decide.
    const paso = Math.max(0.2, Math.min(st.paso || 2, 6));
    const port = st.portada || {};
    const cierre = Math.max(0, st.cierre || 0);
    // Cuantas veces se pasa por todas las hojas. Con una hoja sola y tres
    // vueltas sale la misma tres veces seguidas, que tambien vale: cada pasada
    // trae el vaiven en otro sitio, asi que no se ve congelada.
    const vueltas = Math.max(1, Math.min(Math.round(st.vueltas) || 1, 8));
    let t = 0;
    for (let v = 0; v < vueltas; v++) {
      for (let i = 0; i < n; i++) {
        pasos.push({ desde: t, hasta: t + paso, slot: i });
        t += paso;
      }
    }
    // La última se marca como ganadora sólo para que el resto del código, que
    // ya sabe qué es un ganador, la trate como la pieza en la que se para.
    if (pasos.length) pasos[pasos.length - 1].ganador = true;
    if (port.activa) {
      const d = Math.max(0.6, port.dur || 2.2);
      pasos.push({ desde: t, hasta: t + d, slot: n - 1, portada: true });
      t += d;
    }
    if (cierre > 0) pasos.push({ desde: t, hasta: t + cierre, slot: n - 1, cierre: true });
    return pasos;
  }

  function ritmo(st, nSlots) {
    if ((st && st.modo) === "pases") return ritmoPases(st, nSlots);
    const pasos = [];
    const n = Math.max(1, nSlots);
    const cierre = Math.max(0, st.cierre || 0);
    const parada = Math.max(0.2, st.parada || 1);
    const lento = Math.max(0.05, Math.min(st.lento || 0.7, st.maxInt || 0.85));
    const barrido = Math.max(0.2, st.barrido || 2.4);
    const ivRapido = Math.max(st.minInt || 0.03, barrido / n);

    let t = 0, k = 0;
    const meter = (iv) => {
      pasos.push({ desde: t, hasta: t + iv, slot: k % n });
      t += iv; k++;
    };

    // 1) pasada rápida: todos una vez.
    for (let i = 0; i < n; i++) meter(ivRapido);

    // 2) frenada. Escalones repartidos a partes iguales en proporción, que es
    // como frena algo de verdad: no en saltos iguales sino cada vez menos.
    if (ivRapido < lento) {
      const f = Math.pow(lento / ivRapido, 1 / (ESCALONES + 1));
      let iv = ivRapido;
      for (let i = 0; i < ESCALONES; i++) { iv *= f; meter(iv); }
    }

    // 3) pasada lenta: todos otra vez, a ritmo de mirarlos.
    for (let i = 0; i < n; i++) meter(lento);

    // 4) el ganador: el siguiente al último, sostenido hasta el cierre.
    const fin = t;
    const ganador = k % n;
    pasos.push({ desde: fin, hasta: fin + parada, slot: ganador, ganador: true });
    // Y el remate: su logotipo entero, a pantalla completa.
    if (cierre > 0) {
      pasos.push({ desde: fin + parada, hasta: fin + parada + cierre, slot: ganador, cierre: true });
    }
    return pasos;
  }

  // Cuánto dura el reel entero. Ya no lo elige ella: sale de cuántos diseños
  // haya y de a qué ritmo quiera verlos. El panel lo enseña para que no sea
  // una sorpresa al darle a grabar.
  function duracion(st, nSlots) {
    const p = ritmo(st, nSlots);
    return p.length ? p[p.length - 1].hasta : 0;
  }
  function slotEn(pasos, t) {
    for (let i = pasos.length - 1; i >= 0; i--) if (t >= pasos[i].desde) return pasos[i];
    return pasos[0] || { slot: 0 };
  }

  // ------------------------------------------------------------- pegatinas
  // La pegatina la pinta app.js (`KAOS_APP.pegatina`, o sea `renderSticker`),
  // la misma que el flash post: papel con textura, huecos de dentro cerrados,
  // halo de medio centímetro y sombra. Aquí sólo se guarda el resultado.
  //
  // Dos cuidados, y los dos por el iPad:
  //   · Se cachea por diseño+giro. `dibujarQuieto` vuelve a preparar el reel
  //     cada vez que ella mueve un mando, y repintar 50 pegatinas a pelo (que
  //     llevan un relleno por inundación cada una) dejaba el panel clavado.
  //   · Se baja de tamaño. La caja donde cabe la pegatina en el reel son unos
  //     780 px; guardarlas a resolución original serían cientos de megas.
  const LADO_MAX = 860;
  const _pegatinas = new Map();

  async function pegatinaDe(item, rotDeg) {
    const app = root.KAOS_APP;
    if (!app || typeof app.pegatina !== "function") return null;
    const clave = (item.id || item.layerUrl || "") + "|" + Math.round(rotDeg * 10);
    if (_pegatinas.has(clave)) return _pegatinas.get(clave);
    let out = null;
    try {
      const grande = document.createElement("canvas");
      await app.pegatina(item, grande, { rotDeg: rotDeg });
      const lado = Math.max(grande.width, grande.height);
      if (lado <= LADO_MAX) {
        out = grande;
      } else {
        const e = LADO_MAX / lado;
        out = document.createElement("canvas");
        out.width = Math.round(grande.width * e);
        out.height = Math.round(grande.height * e);
        const c = out.getContext("2d");
        c.imageSmoothingQuality = "high";
        c.drawImage(grande, 0, 0, out.width, out.height);
        grande.width = grande.height = 1;
      }
    } catch (e) {
      // Si falla (un diseño sin layerUrl, por ejemplo) se sigue con el dibujo a
      // secas: mejor un reel sin papel que un reel que no sale.
      console.warn("reel: no pude montar la pegatina", e);
      out = null;
    }
    _pegatinas.set(clave, out);
    return out;
  }
  // Se vacía cuando cambia el papel del flash post: si no, seguiría enseñando
  // el papel viejo hasta recargar la página.
  function olvidarPegatinas() { _pegatinas.clear(); }

  // ---------------------------------------------------------------- fondos
  // Cada diseño necesita un fondo distinto. Se turnan: colores planos de marca,
  // la foto de fondo de flash, el patrón, y las fotos que ella meta.
  // Llevan nombre para poder listarlas en el desplegable del panel: si no, ella
  // tendría que elegir un fondo a ciegas por número.
  const RECETAS = [
    { nombre: "MAGENTA",       tipo: "color", v: MAGENTA },
    { nombre: "FOTO DE FLASH", tipo: "img",   v: "uploads/fondo_flash.JPG" },
    { nombre: "NEGRO",         tipo: "color", v: NEGRO },
    { nombre: "PATRÓN",        tipo: "img",   v: "uploads/patron_fondo.PNG" },
    { nombre: "HUESO",         tipo: "color", v: HUESO },
    { nombre: "VERDE LIMA",    tipo: "color", v: VERDE },
    // El letrero de neón del estudio, el que sale en la mayoría de sus posts.
    //
    // Va AL FINAL y no junto a la otra foto a propósito: `st.fondoIdx` guarda
    // la POSICIÓN en esta lista, así que meterlo en medio le habría cambiado el
    // fondo que tenga elegido ahora sin tocar nada. Los nuevos, al final.
    { nombre: "NEÓN",          tipo: "img",   v: "uploads/fondo_neon.jpg" },
  ];
  function recetas(st) {
    const propias = (st.fondosPropios || []).map((v, i) => ({ nombre: "TU FOTO " + (i + 1), tipo: "img", v: v }));
    // Las suyas primero: si se ha molestado en meterlas, quiere verlas.
    return propias.concat(RECETAS);
  }

  const _cache = new Map();
  function cargarImg(src) {
    if (_cache.has(src)) return _cache.get(src);
    const p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => res(null);   // un fondo que falta no debe romper el reel
      im.src = src;
    });
    _cache.set(src, p);
    return p;
  }

  function cubrir(ctx, img, w, h) {
    const iw = img.naturalWidth || img.videoWidth;
    const ih = img.naturalHeight || img.videoHeight;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  // ---------------------------------------------------------------- sticker
  // Mismo truco que la hoja de stickers: se dilata la silueta del dibujo para
  // sacar un halo de papel, se rellena de blanco, y encima va la tinta en
  // multiply. Aquí va aparte (y no reusa el de app.js) porque aquel depende del
  // estado del editor de posts, y el reel no tiene editor abierto.
  // `ancho` y `alto` son la CAJA máxima, no el tamaño final: el dibujo se mete
  // dentro respetando su proporción. Antes sólo se fijaba el ancho, así que un
  // diseño muy alargado se salía por arriba y por abajo del encuadre.
  // Mete una imagen entera dentro de una caja sin deformarla ni recortarla.
  // Devuelve el tamaño con el que ha quedado dibujada. Lo necesita `pintarFrame`
  // para saber dónde está de verdad la pegatina: la caja que se le da es un
  // hueco máximo, y un diseño apaisado ocupa mucho menos que ese hueco. Si la
  // caja de selección usara el hueco, se pincharía aire.
  function encajar(ctx, img, cx, cy, ancho, alto) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    if (!w || !h) return null;
    const e = Math.min(ancho / w, alto / h);
    const dw = w * e, dh = h * e;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    return { w: dw, h: dh };
  }

  function pintarSticker(ctx, img, cx, cy, ancho, alto, rot) {
    if (!img || !img.naturalWidth) return;
    const r = img.naturalHeight / img.naturalWidth;
    // La rotación agranda la caja que ocupa: se descuenta antes de encajar,
    // si no un diseño inclinado vuelve a asomar por el borde.
    const a = Math.abs((rot || 0) * Math.PI / 180);
    const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    const escalaW = ancho / (cos + r * sin);
    const escalaH = alto  / (sin + r * cos);
    const w = Math.min(escalaW, escalaH);
    const dw = Math.round(w), dh = Math.round(w * r);
    const halo = Math.max(10, Math.round(ancho * 0.045));
    const SW = dw + halo * 2, SH = dh + halo * 2;

    const st = document.createElement("canvas");
    st.width = SW; st.height = SH;
    const sx = st.getContext("2d");

    // silueta dilatada -> papel blanco
    sx.drawImage(img, halo, halo, dw, dh);
    const pasos = 28;
    for (let k = 0; k < pasos; k++) {
      const a = (k / pasos) * Math.PI * 2;
      sx.drawImage(img, halo + Math.cos(a) * halo, halo + Math.sin(a) * halo, dw, dh);
    }
    sx.globalCompositeOperation = "source-in";
    sx.fillStyle = "#fdfbf5";
    sx.fillRect(0, 0, SW, SH);
    sx.globalCompositeOperation = "source-over";
    // tinta encima
    sx.globalCompositeOperation = "multiply";
    sx.drawImage(img, halo, halo, dw, dh);
    sx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rot || 0) * Math.PI / 180);
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = halo * 0.9;
    ctx.shadowOffsetY = halo * 0.35;
    ctx.drawImage(st, -SW / 2, -SH / 2, SW, SH);
    ctx.restore();
    st.width = st.height = 1;
  }

  // ---------------------------------------------------------------- texto
  // Mayúsculas y bold siempre: es regla de marca. El verde lima también lo era,
  // y sigue siendo el que viene puesto por defecto, pero ella pidió poder
  // cambiarlo como en el editor de posts, así que el color sí se elige.
  function ajustar(ctx, texto, maxAncho, tamInicial) {
    let t = tamInicial;
    do {
      ctx.font = "700 " + t + "px " + FUENTE;
      if (ctx.measureText(texto).width <= maxAncho) break;
      t -= 4;
    } while (t > 28);
    return t;
  }
  // `p` es un sitio de `sitios()`: {x, y, rot} en fracción del lienzo. Devuelve
  // la caja que ha ocupado, en píxeles de diseño, para que se pueda pinchar.
  function pintarTexto(ctx, texto, p, tam, hex) {
    if (!texto) return null;
    const t = String(texto).toUpperCase();
    const cx = (p && p.x != null ? p.x : 0.5) * W;
    const cy = (p && p.y != null ? p.y : 0.5) * H;
    const rot = (p && p.rot) || 0;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Antes era W*0.86: una frase larga llegaba a 46 px del borde y en el móvil
    // se leía pegada. Ahora el tope es el ancho de la zona segura menos un
    // respiro, así que la letra encoge antes de tocar nada.
    const usado = ajustar(ctx, t, (zona().x1 - zona().x0) * 0.94, tam);
    ctx.translate(cx, cy);
    if (rot) ctx.rotate((rot * Math.PI) / 180);
    // Sin contorno. Lo llevaba para que el verde lima se leyera sobre una foto
    // clara, pero engorda la letra y ensucia el remate del tipo — se le veía el
    // borde negro pegado a cada trazo. Si algún fondo se come el texto, se
    // arregla con el color del texto o con el fondo, no repintando el borde.
    ctx.fillStyle = hex || VERDE;
    ctx.fillText(t, 0, 0);
    const ancho = ctx.measureText(t).width;
    ctx.restore();
    // Un pelín de aire alrededor: la caja ceñida al píxel es incómoda de
    // pinchar con el dedo en el iPad.
    return { x: cx, y: cy, w: ancho + 24, h: usado * 1.25, rot: rot, tam: usado };
  }

  // ------------------------------------------------- una hoja, sin su fondo
  //
  // Dibuja los diseños de una hoja de flash tal como ella los colocó, pero
  // sueltos: sin el papel ni la foto que la hoja llevara detrás. El fondo aquí
  // lo pone el reel.
  //
  // La hoja se escala para llenar el área buena —la zona segura, la que
  // Instagram no tapa— dejando abajo el sitio de la firma. Se escala por el
  // lado que primero se queda corto, no se recorta: recortar una hoja de flash
  // es cortarle un diseño a alguien por la mitad.
  //
  // EL VAIVÉN. Cada diseño gira un poquito sobre su PROPIO centro, a un lado y
  // al otro. Cada uno con su desfase y su velocidad —salidos de su posición en
  // la hoja, no al azar, para que no cambien entre la previa y la grabación—,
  // así que la hoja parece respirar en vez de moverse en bloque, que es lo que
  // pasaría si todos fueran a la vez.
  // TRES FOTOGRAMAS, A SALTOS.
  //
  // El vaivén no es un giro suave: son tres posiciones y ya, cambiando de
  // golpe, como una animación dibujada a mano de las de toda la vida (el
  // «hervido» de la línea). Un giro fluido de grado y medio no se lee como una
  // decisión, se lee como que el vídeo va flojo; a saltos se lee como estilo.
  //
  // Van en zigzag —izquierda, centro, derecha, centro— y no en rueda: saltando
  // de +1,6° a -1,6° de una vez el brinco sería el doble y cantaría.
  // FOTOGRAMAS Y VELOCIDAD SON DOS COSAS DISTINTAS.
  //
  //   fotogramas = en cuántas posiciones distintas se para el dibujo.
  //   velocidad  = cuántas veces por segundo cambia de posición.
  //
  // Con 3 fotogramas rápidos tiembla; con 8 lentos parece que gira de verdad.
  // Son dos mandos porque dan resultados que no se pueden conseguir tocando
  // sólo uno.
  //
  // El ciclo se construye subiendo de un extremo al otro y volviendo, sin
  // repetir los extremos: eso es lo que lo hace zigzag y no rueda. Con 3
  // fotogramas sale [-1, 0, 1, 0], que es exactamente como estaba.
  function framesZig(n) {
    n = Math.max(2, Math.min(Math.round(n) || 3, 8));
    const sube = [];
    for (let i = 0; i < n; i++) sube.push(-1 + (2 * i) / (n - 1));
    if (n === 2) return sube;                      // sólo izquierda y derecha
    return sube.concat(sube.slice(1, -1).reverse());
  }
  // Saltos por segundo del vaivén. Estaba en 7 y salía nervioso; 4 se lee como
  // dibujo animado a mano y no como que el vídeo tiembla. Se puede cambiar
  // desde el panel: esto es sólo el valor de partida.
  const ZZ_POR_SEG = 4;
  const HUECO_FIRMA = 0.085;          // parte de alto que se le deja al pie

  function pintarHojaSuelta(ctx, hoja, st, tLocal) {
    if (!hoja || !hoja.dibujos || !hoja.dibujos.length) return null;
    const z = zona();
    const cajaW = z.x1 - z.x0;
    const cajaH = (z.y1 - z.y0) - H * HUECO_FIRMA;
    // El zoom multiplica el encaje. Por encima de 1 la hoja se sale de la zona
    // segura a propósito: es lo que ella pidió —ver los diseños más grandes—, y
    // aquí lo que se recorta son los márgenes, no un diseño por la mitad,
    // porque la hoja sigue centrada.
    const zoom = Math.max(0.6, Math.min(st.hojaZoom != null ? st.hojaZoom : 1, 2));
    const k = Math.min(cajaW / hoja.W, cajaH / hoja.H) * zoom;
    const anch = hoja.W * k, alt = hoja.H * k;
    const ox = (z.x0 + z.x1) / 2 - anch / 2;
    // Antes se centraba en la zona segura MENOS el hueco de la firma, y eso la
    // empujaba hacia arriba: en el móvil quedaba alta, con un vacío debajo.
    // Ahora se centra en la franja buena de verdad y ella la baja o la sube con
    // `hojaY` (fracción del alto; positivo = más abajo).
    const desliz = Math.max(-0.2, Math.min(st.hojaY != null ? st.hojaY : 0.04, 0.2));
    const oy = z.y0 + (cajaH - alt) / 2 + H * desliz;

    const amp = Math.max(0, Math.min(st.zigzag != null ? st.zigzag : 1.6, 12));
    // Se calcula UNA vez por fotograma, no por diseno: con veinte disenos en la
    // hoja, rehacerlo veinte veces por cada pintada es tirar trabajo.
    const marcos = framesZig(st.zigFrames != null ? st.zigFrames : 3);
    hoja.dibujos.forEach((d, i) => {
      let ang = 0;
      if (amp > 0) {
        // Cada diseño empieza por un fotograma distinto y NO cambia todo a la
        // vez: si saltaran juntos parecería que parpadea la hoja entera en vez
        // de que cada dibujo tiene vida propia.
        const desfase = i + ((d.cx | 0) % 4);
        const vel = Math.max(0.4, Math.min(st.zigVel != null ? st.zigVel : ZZ_POR_SEG, 14));
        const paso = Math.floor(tLocal * vel) + desfase;
        ang = amp * marcos[((paso % marcos.length) + marcos.length) % marcos.length];
      }
      const cx = ox + d.cx * k, cy = oy + d.cy * k;
      const w = d.w * k, h = d.h * k;
      ctx.save();
      ctx.translate(cx, cy);
      // El giro que ella le dio en la hoja, más el vaivén. Los dos sobre el
      // mismo centro, así que se suman y ya.
      const giro = (d.rot || 0) + ang;
      if (giro) ctx.rotate((giro * Math.PI) / 180);
      // El espejo va después de girar, igual que en el flash post, para que
      // combinarlos dé el mismo resultado en los dos sitios.
      if (d.espejo) ctx.scale(-1, 1);
      // RESPETANDO LA PROPORCIÓN. Se encaja dentro de la caja por el lado que
      // primero se queda corto, en vez de estirar la imagen hasta llenarla.
      // Como la escala de la hoja (`k`) es la misma para todos, los tamaños
      // relativos entre diseños salen igual que en el flash post.
      const iw = d.img.width || d.img.naturalWidth;
      const ih = d.img.height || d.img.naturalHeight;
      if (iw && ih) {
        const e = Math.min(w / iw, h / ih);
        ctx.drawImage(d.img, -(iw * e) / 2, -(ih * e) / 2, iw * e, ih * e);
      }
      ctx.restore();
    });
    return { x: ox + anch / 2, y: oy + alt / 2, w: anch, h: alt, rot: 0 };
  }

  // ------------------------------------------------------------------ marco
  // Las mismas esquinas en L que lleva el flash post (drawOrnamentCorners de
  // gallery.js), con las proporciones del formato vertical.
  //
  // El marco ya no abraza el lienzo, abraza la ZONA SEGURA: si se pega al
  // borde de los 1080x1920, Instagram se come las esquinas de abajo con su pie
  // y las de arriba quedan detrás de la cabecera. Sobre el lienzo entero se ve
  // descentrado hacia arriba; en el móvil, que es donde se mira, sale centrado.
  // DONDE VA EL MARCO.
  //
  // Dos cosas que antes no se podian:
  //   · Tamano propio (marcoTam). Se encoge o se agranda sobre su centro.
  //     Por encima de 1 se sale de la zona segura, igual que la hoja: lo que se
  //     pierde son margenes, y es decision suya.
  //   · En modo flash post BAJA CON LA HOJA. Antes el marco se quedaba clavado
  //     en la zona segura mientras la hoja se movia con «Subir / bajar», y
  //     acababan descuadrados: el marco arriba y el dibujo abajo.
  function rectMarco(st) {
    const z = zona();
    const tam = Math.max(0.5, Math.min((st && st.marcoTam != null) ? st.marcoTam : 1, 1.3));
    const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2;
    const w = (z.x1 - z.x0) * tam, h = (z.y1 - z.y0) * tam;
    const dy = (st && st.modo === "pases")
      ? H * (st.hojaY != null ? st.hojaY : 0.04) : 0;
    return { x0: cx - w / 2, x1: cx + w / 2,
             y0: cy - h / 2 + dy, y1: cy + h / 2 + dy };
  }

  function pintarMarco(ctx, hex, st) {
    const z = rectMarco(st);
    const largo = Math.round(W * 0.10);
    ctx.save();
    ctx.strokeStyle = hex || MAGENTA;
    ctx.lineWidth = 3;
    ctx.lineCap = "square";
    const esquinas = [
      [z.x0, z.y0, 1, 1],
      [z.x1, z.y0, -1, 1],
      [z.x0, z.y1, 1, -1],
      [z.x1, z.y1, -1, -1],
    ];
    for (const e of esquinas) {
      ctx.beginPath();
      ctx.moveTo(e[0], e[1] + largo * e[3]);
      ctx.lineTo(e[0], e[1]);
      ctx.lineTo(e[0] + largo * e[2], e[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame
  // Pinta el fotograma del segundo `t`. `piezas` es lo que devuelve `preparar`.
  // El logo es negro sobre transparente: sobre un fondo oscuro desaparece, así
  // que se tiñe. Se guarda el resultado porque rehacerlo en cada fotograma son
  // 30 lienzos por segundo para nada.
  function logoTenido(piezas, hex, lw, lh) {
    const clave = hex + "|" + lw + "x" + lh;
    if (piezas._logoClave !== clave) {
      const tc = document.createElement("canvas");
      tc.width = lw; tc.height = lh;
      const tx = tc.getContext("2d");
      tx.drawImage(piezas.logo, 0, 0, lw, lh);
      tx.globalCompositeOperation = "source-in";
      tx.fillStyle = hex;
      tx.fillRect(0, 0, lw, lh);
      piezas._logoCache = tc;
      piezas._logoClave = clave;
    }
    return piezas._logoCache;
  }

  // El remate: su logotipo entero a pantalla completa, sobre el negro de marca.
  // Entra creciendo un poco y apareciendo, no de golpe.
  function pintarCierre(ctx, piezas, d) {
    const st = piezas.st;
    ctx.fillStyle = NEGRO;
    ctx.fillRect(0, 0, W, H);
    const cm = st.colMarco || "auto";
    if (st.marco !== false) pintarMarco(ctx, cm === "auto" ? marcoAuto(ctx, st) : color(cm), st);

    const hex = color(st.colHandle);
    const p = Math.min(1, Math.max(0, d / 0.32));
    const suave = p * p * (3 - 2 * p);          // entra y frena, sin tirón
    if (!piezas.logo) return;

    const lw = Math.round(W * 0.62);
    const lh = Math.round(lw * (piezas.logo.naturalHeight / piezas.logo.naturalWidth));
    const cy = H * 0.46;
    const esc = 0.90 + 0.10 * suave;
    ctx.save();
    ctx.globalAlpha = suave;
    ctx.translate(W / 2, cy);
    ctx.scale(esc, esc);
    ctx.drawImage(logoTenido(piezas, hex, lw, lh), -lw / 2, -lh / 2);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = suave;
    ctx.textAlign = "center";
    ctx.font = "700 40px " + FUENTE;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "8px";
    // Pegado al logo, no a 96 px. El arroba es el pie de la firma: separado
    // tanto parecía otro elemento suelto en medio de la pantalla.
    const yArroba = cy + lh / 2 + 34;
    ctx.fillStyle = hex;
    ctx.fillText("@KAOS.REALM", W / 2, yArroba);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.restore();

    // EL TEXTO DEL CIERRE.
    // Antes aqui se repetia el CTA del cuerpo, sin poder cambiarlo ni quitarlo.
    // Ahora es un texto suyo y viene VACIO: el cierre es el logotipo, y meterle
    // otra frase encima le quitaba fuerza. Si lo quiere, lo escribe.
    //
    // Va debajo del arroba, no en el sitio del CTA: ahi es una tarjeta de
    // cierre, y el orden que se lee es logo, arroba, frase.
    if (st.cierreTxt) {
      ctx.save();
      ctx.globalAlpha = suave;
      pintarTexto(ctx, st.cierreTxt, { x: 0.5, y: (yArroba + 96) / H, rot: 0 },
                  64, color(st.colCta));
      ctx.restore();
    }
  }

  function pintarFrame(ctx, piezas, t) {
    const st = piezas.st;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const paso = slotEn(piezas.pasos, t);
    if (paso.cierre) { pintarCierre(ctx, piezas, t - paso.desde); return; }
    // La portada es un fotograma normal al que se le quita el diseño, la frase
    // y el CTA. Todo lo demás —fondo, marco, firma— se queda, para que no
    // parezca una tarjeta pegada de otro vídeo.
    const enPortada = !!paso.portada;
    const i = paso.slot % Math.max(1, piezas.slots.length);
    const slot = piezas.slots[i];

    // 1) fondo: el vídeo si lo hay, y si no la receta de este slot
    if (piezas.video && piezas.video.readyState >= 2) {
      cubrir(ctx, piezas.video, W, H);
      // Una capa oscura suave para que la pegatina y el texto despeguen.
      ctx.fillStyle = "rgba(10,9,8,0.28)";
      ctx.fillRect(0, 0, W, H);
    } else if (slot && slot.fondo) {
      if (slot.fondo.tipo === "color") { ctx.fillStyle = slot.fondo.v; ctx.fillRect(0, 0, W, H); }
      else if (slot.fondo.img) cubrir(ctx, slot.fondo.img, W, H);
      else { ctx.fillStyle = NEGRO; ctx.fillRect(0, 0, W, H); }
    } else {
      ctx.fillStyle = NEGRO;
      ctx.fillRect(0, 0, W, H);
    }

    // 2) el marco de esquinas, igual que el flash post
    if (st.marco !== false) {
      const cm = st.colMarco || "auto";
      pintarMarco(ctx, cm === "auto" ? marcoAuto(ctx, st) : color(cm), st);
    }

    // 3) la pegatina. La caja va entre la frase de arriba y el CTA de abajo,
    // así que un diseño muy alargado se encoge en vez de comerse el texto o
    // salirse.
    //
    // El ganador salía con un rebote de escala (crecía un 10% y se sacudía).
    // Lo quitó: en un dibujo de línea fina el temblor se lee como un fallo de
    // encuadre, no como un remate, y es justo el momento en que hay que mirar
    // el diseño quieto. Ahora se para y ya.
    const S = sitios(st);
    const cajas = {};
    const ax = S.arte.x * W, ay = S.arte.y * H;
    ctx.save();
    if (S.arte.rot) { ctx.translate(ax, ay); ctx.rotate((S.arte.rot * Math.PI) / 180); ctx.translate(-ax, -ay); }
    // El alto baja de H*0.50 a H*0.42: al subir el CTA y la firma para que no
    // se los coma el pie de Instagram, la franja libre entre la frase y el CTA
    // se ha estrechado, y con la caja de antes el dibujo se solapaba con los
    // dos. El diseño se encoge un poco, pero se ve entero.
    // 0,38 y no 0,42: al bajar la frase y subir la firma para que respiren, la
    // franja libre del medio se ha estrechado. Un diseno mas pequeno que se ve
    // entero es mejor que uno grande pisando el titular.
    const ARTE_W = W * 0.72, ARTE_H = H * 0.38;
    if (enPortada) {
      // A propósito, nada: la portada la llena ella con sus textos.
    } else if (slot && slot.hoja) {
      const m = pintarHojaSuelta(ctx, slot.hoja, st, t - paso.desde);
      if (m) cajas.arte = m;
    } else if (slot && slot.pegatina) {
      // La buena: la misma pegatina que el flash post, ya girada.
      const m = encajar(ctx, slot.pegatina, ax, ay, ARTE_W, ARTE_H);
      if (m) cajas.arte = { x: ax, y: ay, w: m.w, h: m.h, rot: S.arte.rot };
    } else if (slot && slot.img) {
      // Red de seguridad por si app.js no está cargado (el reel se puede abrir
      // desde otra página) o el diseño no tiene capa que recortar.
      pintarSticker(ctx, slot.img, ax, ay, ARTE_W, ARTE_H, slot.rot);
      cajas.arte = { x: ax, y: ay, w: ARTE_W, h: ARTE_H, rot: S.arte.rot };
    }
    ctx.restore();

    // 4) frase arriba, CTA abajo, logo y firma en el pie
    // En la portada no van: la frase y el CTA son del cuerpo del reel. Si
    // salieran también aquí, ella tendría dos titulares peleándose por el mismo
    // sitio y no podría poner el suyo donde quiere.
    // Tampoco cuando lo que se enseña es una hoja entera: la hoja llena el área
    // buena, así que la frase y el CTA caerían justo encima de los diseños. Sus
    // textos sueltos sí siguen saliendo — ésos los coloca ella donde quiere.
    const hojaEntera = !!(slot && slot.hoja);
    if (!enPortada && !hojaEntera) {
      cajas.frase = pintarTexto(ctx, st.frase, S.frase, 96, color(st.colFrase));
      cajas.cta = pintarTexto(ctx, st.cta, S.cta, 72, color(st.colCta));
    }
    // Jerarquía del pie: la firma es el LOGO, no el texto. Antes iban casi del
    // mismo tamaño (logo 58 px, texto 34 px) y a un palmo de distancia parecían
    // dos firmas peleándose. Ahora el logo manda —es el lettering dibujado a
    // mano de la marca— y el @ baja a letra pequeña debajo, apagado, como el
    // pie de una firma. Se lee primero el dibujo, luego dónde encontrarla.
    const hexH = color(st.colHandle);
    const fx = S.firma.x * W, yLogo = S.firma.y * H;
    let anchoFirma = W * 0.34;
    // Cuanto sube la firma por encima de su punto de anclaje. Sin logo es solo
    // lo que mide el texto; con logo, lo que ocupe el logo.
    let topeArriba = -16;
    ctx.save();
    if (S.firma.rot) { ctx.translate(fx, yLogo); ctx.rotate((S.firma.rot * Math.PI) / 180); ctx.translate(-fx, -yLogo); }
    if (st.logo !== false && piezas.logo) {
      const lg = piezas.logo;
      // Un poco mas grande: el logo es el lettering dibujado a mano de la
      // marca y es lo que se reconoce en el pie, no el arroba.
      const lh = Math.round(H * 0.056);
      const lw = Math.round(lh * (lg.naturalWidth / lg.naturalHeight));
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(logoTenido(piezas, hexH, lw, lh), fx - lw / 2, yLogo - lh - 6);
      ctx.restore();
      anchoFirma = Math.max(anchoFirma, lw);
      // Hasta donde llega el logo por arriba, para que la caja de agarrar
      // cubra lo que de verdad se ve.
      topeArriba = -lh - 6;
    }
    ctx.save();
    ctx.textAlign = "center";
    // Más pequeño y más separado por dentro: el espaciado entre letras lo hace
    // leer como un pie de firma y no como un segundo titular.
    ctx.font = "700 21px " + FUENTE;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    // Sin contorno, igual que la frase. A plena opacidad para que se siga
    // leyendo sobre magenta sin necesidad de un borde negro.
    ctx.globalAlpha = 1;
    ctx.fillStyle = hexH;
    ctx.fillText("@KAOS.REALM", fx, yLogo);
    anchoFirma = Math.max(anchoFirma, ctx.measureText("@KAOS.REALM").width + 30);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.restore();
    ctx.restore();

    // La firma se mueve entera —logo y arroba juntos—, que es como se lee: si
    // se pudieran separar acabaria con el logo en una esquina y el @ en otra.
    //
    // La caja sale de lo que SE HA PINTADO, no de una cuenta aparte. Antes era
    // una estimacion y no cuadraba con el dibujo: fallabas por poco al agarrar
    // el logo, el clic caia en la hoja de detras y acababas moviendo la hoja
    // entera creyendo que el logo no se podia mover.
    //
    // Y un margen generoso alrededor: es la pieza mas pequena del fotograma y
    // se agarra con el dedo en el iPad.
    const PAD = 22;
    const arriba = yLogo + topeArriba;
    const abajo = yLogo + 7;                 // lo que baja la @ por debajo
    cajas.firma = { x: fx, y: (arriba + abajo) / 2,
                    w: anchoFirma + PAD * 2, h: (abajo - arriba) + PAD * 2,
                    rot: S.firma.rot };

    // 5) sus textos. Van los últimos: encima de todo lo demás, que es lo que
    // se espera de algo que acabas de añadir tú. No salen en el cierre —
    // igual que la frase— porque ahí el logo ocupa el centro y un texto suelto
    // le caería encima.
    // En la portada se pintan los SUYOS de la portada, no los del cuerpo: son
    // dos juegos distintos. El prefijo de la caja los distingue («p:» portada,
    // «t:» cuerpo) para que el panel sepa a cuál está tocando.
    const suyos = enPortada ? ((st.portada && st.portada.textos) || []) : (st.textos || []);
    const pre = enPortada ? "p:" : "t:";
    for (const t of suyos) {
      const caja = pintarTexto(ctx, t.txt, { x: t.x, y: t.y, rot: t.rot || 0 },
                               t.tam || 56, color(t.col || "secondary"));
      if (caja) cajas[pre + t.id] = caja;
    }

    // Se anotan las cajas de este fotograma para que el panel sepa dónde está
    // cada pieza y se pueda pinchar. Se calculan pintando, no aparte: dos
    // cuentas separadas acabarían descuadradas en cuanto cambie una tipografía.
    piezas._cajas = cajas;
  }

  // Lo que ha ocupado cada pieza en el último `pintarFrame`, en píxeles de
  // diseño. Vacío si aún no se ha pintado nada.
  function cajas(piezas) { return (piezas && piezas._cajas) || {}; }

  // ---------------------------------------------------------------- preparar
  // Carga todo lo que hace falta ANTES de grabar. Si se cargara sobre la marcha,
  // los primeros fotogramas saldrían vacíos y el reel empezaría en negro.
  // `hojasPie`: hojas de flash descritas pieza a pieza —
  //   [{ W, H, piezas: [{ item, cx, cy, w, h, rot }] }]
  // en coordenadas de la hoja. Opcional.
  //
  // Los dos modos NO se mezclan: la ruleta pasa diseños sueltos, el pase de
  // hojas pasa hojas. Mezclarlos daría un vídeo donde la mitad de las piezas
  // son de un tamaño y la otra mitad de otro, sin que se entienda por qué.
  async function preparar(st, items, hojasPie) {
    // Lo primero: dejar el lienzo del tamano que toque. Todo lo que viene
    // detras lee W y H en el momento, asi que si esto no va antes se prepara
    // un video con el tamano del formato anterior.
    formato(st.formato);
    const recs = recetas(st);
    const slots = [];
    const soloHojas = st.modo === "pases";
    for (let i = 0; soloHojas ? false : i < items.length; i++) {
      const it = items[i];
      const rec = st.fondoFijo === false ? recs[i % recs.length]
                                        : recs[(st.fondoIdx || 0) % recs.length];
      const par = await Promise.all([
        cargarImg(it.layerUrl || it.thumbUrl),
        rec.tipo === "img" ? cargarImg(rec.v) : Promise.resolve(null),
      ]);
      // Una inclinación fija por diseño (no aleatoria por fotograma: si no,
      // temblaría). Alterna a un lado y a otro.
      const rot = (i % 2 ? 1 : -1) * (2 + (i * 1.7) % 4);
      slots.push({
        img: par[0],
        // La pegatina ya viene girada de fábrica, así que al pintarla no se
        // vuelve a girar.
        pegatina: await pegatinaDe(it, rot),
        fondo: rec.tipo === "img" ? { tipo: "img", img: par[1] } : rec,
        rot: rot,
      });
    }
    // LAS HOJAS DE FLASH, REDIBUJADAS
    //
    // No se usa la foto que guardó la hoja: esa lleva pegado su fondo (el papel
    // o la foto que ella pusiera), y aquí el fondo lo pone el reel. Se dibuja
    // diseño a diseño con la MISMA pegatina del flash post, colocados como los
    // dejó, y escalados para llenar el área buena del reel.
    //
    // De paso, dibujando cada uno por separado, cada diseño puede moverse por
    // su cuenta: es lo que hace el vaivén.
    for (const h of (hojasPie || [])) {
      if (!h || !h.piezas || !h.piezas.length) continue;
      const dibujos = [];
      for (const p of h.piezas) {
        // SIN GIRAR. Antes se pedía la pegatina ya girada y luego se metía a la
        // fuerza en la caja de la colocación — pero al girar, el recuadro que
        // ocupa cambia de proporción, así que el dibujo salía estirado. Ahora
        // la pegatina viene recta, con su proporción intacta, y el giro se
        // aplica al pintarla.
        const peg = await pegatinaDe(p.item, 0);
        if (peg) dibujos.push({
          img: peg, cx: p.cx, cy: p.cy, w: p.w, h: p.h,
          rot: p.rot || 0, espejo: !!p.espejo,
        });
      }
      if (!dibujos.length) continue;
      const rec = st.fondoFijo === false
        ? recs[slots.length % recs.length]
        : recs[(st.fondoIdx || 0) % recs.length];
      slots.push({
        hoja: { W: h.W || 1080, H: h.H || 1350, dibujos: dibujos },
        fondo: rec.tipo === "img" ? { tipo: "img", img: await cargarImg(rec.v) } : rec,
        rot: 0,
      });
    }

    let video = null;
    if (st.fondoVideoUrl) {
      const v = document.createElement("video");
      v.src = st.fondoVideoUrl;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      const ok = await new Promise((res) => {
        v.onloadeddata = () => res(true);
        v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 4000);   // no colgarse si no tira
      });
      video = ok ? v : null;
    }
    // Se carga aunque haya quitado el logo del pie: el cierre lo necesita igual.
    const logo = (st.logo === false && !(st.cierre > 0))
      ? null : await cargarImg("uploads/kaos_logo.PNG");
    const pasos = ritmo(st, Math.max(1, slots.length));
    // La duracion viaja con las piezas: la calcula `ritmo` y todo lo que pinta
    // o graba la lee de aqui. Si cada sitio la volviera a calcular a su manera,
    // la previa y la grabacion acabarian durando cosas distintas.
    const dur = pasos.length ? pasos[pasos.length - 1].hasta : 0;
    return { st: st, slots: slots, pasos: pasos, dur: dur, video: video, logo: logo };
  }

  // ---------------------------------------------------------------- previa
  // Bucle en pantalla. Devuelve una función para pararlo.
  function previsualizar(canvas, piezas, alAcabar) {
    const ctx = canvas.getContext("2d");
    const t0 = performance.now();
    let vivo = true;
    if (piezas.video) piezas.video.play().catch(() => {});
    (function paso() {
      if (!vivo) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= piezas.dur) {
        pintarFrame(ctx, piezas, piezas.dur - 0.01);
        vivo = false;
        if (piezas.video) piezas.video.pause();
        if (alAcabar) alAcabar();
        return;
      }
      pintarFrame(ctx, piezas, t);
      requestAnimationFrame(paso);
    })();
    return function parar() { vivo = false; if (piezas.video) piezas.video.pause(); };
  }

  // ---------------------------------------------------------------- grabar
  // Instagram quiere MP4. Safari sabe grabar MP4; Chrome casi siempre sólo WebM.
  // Se pide MP4 primero y, si no puede, se devuelve WebM diciéndolo — es mejor
  // que le salga un fichero que no sube sin saber por qué.
  function mejorFormato() {
    const cands = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    if (typeof MediaRecorder === "undefined") return null;
    for (let i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return null;
  }

  function grabar(piezas, alProgreso) {
    return new Promise(function (resolve, reject) {
      const mime = mejorFormato();
      if (!mime) { reject(new Error("Este navegador no sabe grabar vídeo (MediaRecorder).")); return; }
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      const fps = piezas.st.fps || 30;
      const stream = canvas.captureStream(fps);
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 }); }
      catch (e) { reject(new Error("No se pudo abrir el grabador: " + e.message)); return; }

      const trozos = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
      rec.onerror = function (e) { reject(new Error("El grabador falló: " + (e.error && e.error.name))); };
      rec.onstop = function () {
        canvas.width = canvas.height = 1;
        const blob = new Blob(trozos, { type: mime });
        resolve({
          blob: blob,
          mime: mime,
          ext: mime.indexOf("mp4") >= 0 ? "mp4" : "webm",
          esMp4: mime.indexOf("mp4") >= 0,
        });
      };

      // Se pinta a reloj de pared, no fotograma a fotograma: `captureStream`
      // muestrea el canvas en tiempo real, así que el vídeo dura lo que dura la
      // grabación. Es la razón de que grabar 8 segundos tarde 8 segundos.
      const dur = piezas.dur;
      if (piezas.video) { try { piezas.video.currentTime = 0; piezas.video.play(); } catch (e) {} }
      rec.start();
      const t0 = performance.now();
      (function paso() {
        const t = (performance.now() - t0) / 1000;
        if (t >= dur) {
          pintarFrame(ctx, piezas, dur - 0.01);
          if (piezas.video) piezas.video.pause();
          setTimeout(function () { try { rec.stop(); } catch (e) {} }, 120);
          return;
        }
        pintarFrame(ctx, piezas, t);
        if (alProgreso) alProgreso(t / dur);
        requestAnimationFrame(paso);
      })();
    });
  }

  root.KAOS_REEL = {
    recetas,
    get W() { return W; }, get H() { return H; },
    FORMATOS: FORMATOS, formato: formato, tam: tam,
    estado: estado, guardar: guardar, POR_DEFECTO: POR_DEFECTO,
    ritmo: ritmo, duracion: duracion, preparar: preparar, pintarFrame: pintarFrame,
    olvidarPegatinas: olvidarPegatinas, cajas: cajas, sitios: sitios, SITIOS: SITIOS,
    SEGURO: SEGURO, zona: zona, IG: IG, zonasIG: zonasIG,
    previsualizar: previsualizar, grabar: grabar, mejorFormato: mejorFormato,
    PALETA: PALETA, color: color,
  };
})(window);
