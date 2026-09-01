// KAOS — núcleo de precio (copia maestra)
//
// Aquí vive UNA sola vez la fórmula que convierte un diseño en horas y en un
// precio de cliente. La usan dos sitios:
//
//   · calculadora-precios-tattoo.html  → precio exacto de un encargo concreto
//   · TATTOO_FLASH_CREATOR/precio.js   → rango aproximado que sale en el flash
//
// Lo que NO está aquí, a propósito: la cascada fiscal (IVA, reparto con el
// estudio, cuota, IRPF, neto). Eso es cuenta suya, no del cliente, y solo tiene
// sentido en la calculadora. El flash solo necesita saber qué se le cobra a
// quien lo pide.
//
// Copia maestra: C:\3D DOCUMENTS\TATTOO\precio.js
// Réplica:       C:\3D DOCUMENTS\TATTOO\TATTOO_FLASH_CREATOR\precio.js
// Al tocar la maestra hay que replicar la otra en el mismo turno.
(function (root) {

  // ---- tablas ----------------------------------------------------------
  // [nombre, multiplicador de horas]
  const ESTILOS = [
    ["Fineline / minimal", 0.9],
    ["Lettering", 1.0],
    ["Old school / traditional", 1.1],
    ["Blackwork / ornamental", 1.2],
    ["Tribal / maorí", 1.2],
    ["Acuarela", 1.3],
    ["Neotradicional", 1.4],
    ["Anime / ilustrativo", 1.4],
    ["Japonés / irezumi", 1.5],
    ["Dotwork / puntillismo", 1.6],
    ["Realismo B&G", 2.0],
    ["Micro-realismo", 2.2],
    ["Realismo color", 2.3]
  ];

  const ZONAS = [
    ["Antebrazo", 1.0], ["Brazo (exterior)", 1.0], ["Gemelo / pantorrilla", 1.0], ["Muslo", 1.0],
    ["Hombro", 1.05], ["Espalda", 1.1], ["Pecho", 1.1],
    ["Cara interna del brazo", 1.15], ["Abdomen", 1.15],
    ["Glúteo / ingle", 1.2], ["Pie / tobillo", 1.25], ["Costillas", 1.3],
    ["Rodilla / codo", 1.35], ["Cuello / garganta", 1.35],
    ["Mano / dedos", 1.4], ["Cabeza", 1.4]
  ];

  const DETALLE = { 1: [0.8, "Muy simple"], 2: [0.9, "Sencillo"], 3: [1.0, "Medio"], 4: [1.25, "Alto"], 5: [1.5, "Extremo"] };

  const DISENO = {
    cliente:      { pct: 0,  rate: 0,  txt: "El cliente trae el dibujo terminado: no cobras diseño, solo preparas la plantilla. Ojo con los derechos del dibujo si no es suyo." },
    clienteadapt: { pct: 15, rate: 60, txt: "Trae una idea o una imagen que hay que redibujar, limpiar o adaptar a la zona." },
    flash:        { pct: 0,  rate: 0,  txt: "Sin horas de diseño: la pieza ya está dibujada." },
    adapt:        { pct: 10, rate: 60, txt: "Retoques y adaptación de un flash existente." },
    custom:       { pct: 25, rate: 60, txt: "Boceto original: referencias, dibujo y una ronda de cambios." },
    custom2:      { pct: 40, rate: 70, txt: "Varias propuestas, composición compleja o proyecto a medida." }
  };

  const DEFAULTS = {
    w: 12, h: 12, dens: "0.6", estilo: "3", det: 3, color: "1.0", fill: "1.0",
    zona: "0", piel: "1.0", cover: "1.0", adj: 0,
    dis: "custom", dpct: 25, drate: 60,
    nivel: "65", rate: 65, min: 60, split: 60, maxses: 4, urg: false,
    splitbase: "neto", iva: 21, ivamode: "inc",
    setup: 25, minextra: 60, dto: 0, dtodesde: "2",
    cartauto: true, cart: 6, cartp: 1.6,
    maqp: 700, maqv: 4, hmes: 60, otro: 0,
    cuotasel: "90", cuota: 90, fijos: 120, irpf: 15, obj: 35, dep: 20
  };

  // Los factores se solapan entre sí (un "realismo color" ya presupone color y
  // saturación), así que multiplicarlos todos dispara el resultado en los casos
  // extremos. A partir de ×4 se comprime el exceso en vez de acumularlo.
  const TOPE = 4, COMP = 0.55;

  const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; };

  function styleFactor(i) { const e = ESTILOS[+i]; return e ? e[1] : 1; }
  function styleName(i) { const e = ESTILOS[+i]; return e ? e[0] : ""; }
  function zoneFactor(i) { const z = ZONAS[+i]; return z ? z[1] : 1; }
  function zoneName(i) { const z = ZONAS[+i]; return z ? z[0] : ""; }

  // ---- horas de tatuaje ------------------------------------------------
  // s: { w, h, dens, estilo, det, color, fill, zona, piel, cover, adj }
  // estilo y zona son ÍNDICES de sus tablas (dos entradas pueden compartir
  // multiplicador, por eso no se puede usar el valor como identificador).
  function horas(s) {
    const area = Math.max(1, num(s.w) * num(s.h) * num(s.dens, 0.6));
    const base = 0.08 * Math.pow(area, 0.7);

    let mult = styleFactor(s.estilo)
             * (DETALLE[s.det] ? DETALLE[s.det][0] : 1)
             * num(s.color, 1)
             * num(s.fill, 1)
             * zoneFactor(s.zona)
             * num(s.piel, 1)
             * num(s.cover, 1);
    if (mult > TOPE) mult = TOPE * (1 + (Math.pow(mult / TOPE, COMP) - 1));

    let h = base * mult * (1 + num(s.adj) / 100);
    h = Math.max(0.25, Math.round(h * 4) / 4);   // redondeo a cuartos de hora
    return { area, horas: h };
  }

  // ---- precio de cliente ----------------------------------------------
  // Añade a lo anterior las horas de diseño y el mínimo del estudio.
  function precioCliente(s) {
    const r = horas(s);
    const h = r.horas;

    const hDis = Math.round(h * (num(s.dpct) / 100) * 4) / 4;
    const eurDis = hDis * num(s.rate, DEFAULTS.rate) * (num(s.drate) / 100);

    const eurTat = h * num(s.rate, DEFAULTS.rate);
    const minimo = num(s.min, DEFAULTS.min);
    let precio = Math.max(minimo, eurTat) + eurDis;
    const tocaMinimo = eurTat < minimo;

    const eurUrg = s.urg ? precio * 0.15 : 0;
    precio += eurUrg;

    const sinRedondear = precio;
    precio = Math.round(precio / 5) * 5;                 // redondeo comercial a 5 €
    const eurRedondeo = precio - sinRedondear;

    const sesiones = Math.max(1, Math.ceil(h / Math.max(0.5, num(s.maxses, DEFAULTS.maxses))));

    return { area: r.area, horas: h, hDis, horasTrabajadas: h + hDis, eurTat, eurDis, eurUrg,
             tocaMinimo, eurRedondeo, precio, sesiones };
  }

  // ---- rango para un flash --------------------------------------------
  // Al dibujar un flash se conocen tamaño, estilo, detalle, color y relleno.
  // NO se conoce dónde se lo pondrá el cliente ni cómo es su piel, y eso mueve
  // el precio hasta un 40%. Por eso esto devuelve un RANGO, nunca una cifra:
  // publicar "120 €" y luego cobrar 160 porque va en las costillas es una
  // discusión con la clienta garantizada.
  //
  // El mínimo asume zona fácil (antebrazo, factor 1.0) y el máximo una zona
  // cara pero corriente (costillas, 1.3). Mano y cabeza quedan fuera a
  // propósito: son excepción, no rango normal.
  const ZONA_FACIL = 0;   // Antebrazo
  const ZONA_CARA  = 11;  // Costillas

  function rangoFlash(s) {
    // Un flash ya está dibujado: sin horas de diseño que cobrar.
    const base = Object.assign({}, DEFAULTS, s, { dpct: 0, drate: 0, cover: "1.0", piel: "1.0", urg: false });
    const bajo = precioCliente(Object.assign({}, base, { zona: ZONA_FACIL }));
    const alto = precioCliente(Object.assign({}, base, { zona: ZONA_CARA }));
    return {
      min: bajo.precio,
      max: alto.precio,
      horas: bajo.horas,
      sesiones: bajo.sesiones,
      tocaMinimo: bajo.tocaMinimo,
      // Si el mínimo del estudio se come toda la horquilla, las dos cifras
      // coinciden y enseñar "60–60 €" queda absurdo.
      texto: bajo.precio >= alto.precio
        ? ("desde " + bajo.precio + " €")
        : (bajo.precio + "–" + alto.precio + " €"),
    };
  }

  root.KAOS_PRECIO = {
    ESTILOS, ZONAS, DETALLE, DISENO, DEFAULTS,
    styleFactor, styleName, zoneFactor, zoneName,
    horas, precioCliente, rangoFlash,
  };
})(typeof window !== "undefined" ? window : globalThis);
