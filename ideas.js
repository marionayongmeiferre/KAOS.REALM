// KAOS.REALM — IDEAS: peticiones reales, generador de ideas, referencias y precio
//
// Cuatro cosas encadenadas, en el orden en que se usan de verdad:
//
//   1. PETICIONES  — lo que la gente le pide en persona, por DM o en historias.
//                    Se escribe a mano. Es la única fuente real que hay: la API
//                    de Instagram NO devuelve los votos de las encuestas ni las
//                    respuestas a las pegatinas de preguntas. No es que falte un
//                    permiso — Meta nunca ha expuesto ese dato. Así que esto no
//                    es el plan B, es la entrada principal.
//   2. IDEAS       — 5 propuestas surrealistas cada vez. 👍 se guardan como
//                    lista de tareas de diseño, 👎 se guardan también: saber qué
//                    NO le encaja vale tanto como saber qué sí.
//   3. REFERENCIAS — parte una idea en sus elementos ("pingüino con tutú" →
//                    pingüino, tutú) y busca fotos reales de cada uno. Se eligen
//                    y van directas al Surreal Composer.
//   4. PRECIO      — rango aproximado con precio.js, el mismo cálculo que la
//                    calculadora. Rango y no cifra: la zona del cuerpo la decide
//                    la clienta y mueve el precio hasta un 40%.
(function (root) {
  "use strict";

  const K_NOTES  = "kaos.ideas.notes.v1";
  const K_SAVED  = "kaos.ideas.saved.v1";
  const K_REJECT = "kaos.ideas.rejected.v1";
  const MAX_REJECT = 300;   // suficiente para sesgar la generación sin engordar

  // ===================== almacén =====================
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]") || []; }
    catch (e) { return []; }
  }
  function write(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); return true; }
    catch (e) { console.warn("ideas: no se pudo guardar", key, e); return false; }
  }
  const uid = (p) => p + "_" + Date.now() + "_" + ((Math.random() * 1e6) | 0);

  function notes()    { return read(K_NOTES); }
  function saved()    { return read(K_SAVED); }
  function rejected() { return read(K_REJECT); }

  function addNote(text, kind) {
    const t = (text || "").trim();
    if (!t) return null;
    const list = notes();
    // Si ya está apuntada, no se duplica: se sube el contador. Que te pidan la
    // misma cosa cinco veces es justo el dato que interesa.
    const same = list.find(n => n.text.toLowerCase() === t.toLowerCase() && n.kind === kind);
    if (same) { same.n = (same.n || 1) + 1; same.ts = Date.now(); write(K_NOTES, list); return same; }
    const row = { id: uid("n"), text: t, kind: kind || "pedido", n: 1, ts: Date.now() };
    list.unshift(row);
    write(K_NOTES, list);
    return row;
  }
  function bumpNote(id, delta) {
    const list = notes();
    const n = list.find(x => x.id === id);
    if (!n) return;
    n.n = Math.max(1, (n.n || 1) + delta);
    write(K_NOTES, list);
  }
  function removeNote(id) { write(K_NOTES, notes().filter(n => n.id !== id)); }

  function saveIdea(idea) {
    const list = saved();
    if (list.some(x => x.text.toLowerCase() === idea.text.toLowerCase())) return null;
    const row = {
      id: uid("i"), text: idea.text, elems: idea.elems || [], porque: idea.porque || "",
      ts: Date.now(), hecho: false, precio: null, refs: [],
    };
    list.unshift(row);
    write(K_SAVED, list);
    return row;
  }
  function updateIdea(id, patch) {
    const list = saved();
    const it = list.find(x => x.id === id);
    if (!it) return null;
    Object.assign(it, patch);
    write(K_SAVED, list);
    return it;
  }
  function removeIdea(id) { write(K_SAVED, saved().filter(i => i.id !== id)); }

  function rejectIdea(idea) {
    const list = rejected();
    list.unshift({ id: uid("r"), text: idea.text, elems: idea.elems || [], ts: Date.now() });
    write(K_REJECT, list.slice(0, MAX_REJECT));
  }

  // ===================== generador local =====================
  // Motor de reserva: funciona sin conexión y sin API key. La gracia no está en
  // el vocabulario sino en el choque — objeto cotidiano + rasgo que no le toca.
  const OBJETOS = [
    "una bomba", "un cuchillo", "una pistola", "una llave", "un reloj de bolsillo",
    "una taza", "una vela", "un candado", "un espejo de mano", "una jaula",
    "un teléfono antiguo", "una máquina de coser", "un paraguas", "una cerilla",
    "un yunque", "una brújula", "una cuchara", "un tocadiscos", "una bombilla",
    "un ancla", "una silla", "un violín", "unas tijeras", "una linterna",
    "un tarro de cristal", "una carta del tarot", "un dado", "una campana",
  ];
  const SERES = [
    "un girasol", "una rosa", "un cactus", "una seta", "un sauce",
    "un gato", "un cuervo", "una polilla", "una serpiente", "un pulpo",
    "un pingüino", "una liebre", "un ciervo", "un escarabajo", "una medusa",
    "un caballito de mar", "una araña", "un murciélago", "un pez luna", "una abeja",
  ];
  const RASGOS = [
    "dientes de vampiro", "ojos por todas partes", "raíces vivas", "alas de polilla",
    "pinchos", "escamas", "venas de mármol", "manos humanas", "tentáculos",
    "un ojo que parpadea", "plumas negras", "espinas de rosa", "una boca cosida",
    "costuras a la vista", "cuernos de ciervo", "hilos que la sujetan",
    "grietas de porcelana", "musgo creciendo dentro",
  ];
  const ACCIONES = [
    "dispara flores", "llora miel", "echa raíces en el aire", "se está deshaciendo en humo",
    // Ojo al género: las acciones se pegan a objetos y seres de los dos, así
    // que ninguna puede llevar concordancia ("se traga a sí misma" chocaba con
    // "un violín"). Todas neutras.
    "sangra tinta", "florece por dentro", "se devora a sí", "gotea cera",
    "arde sin consumirse", "respira", "se abre como una flor", "atrapa la luz",
  ];
  const REFLEJOS = [
    "unos ojos reflejados", "una cara que no es la tuya", "una habitación vacía",
    "un cielo de tormenta", "la luna", "una mano que saluda",
  ];

  // No todo objeto vale como MATERIAL. «de tazas» se entiende — algo construido
  // a base de tazas. «de tocadiscos» no dice nada: un tocadiscos es grande, uno
  // solo y no se repite. Aquí sólo entran cosas pequeñas, contables y que
  // puedes imaginar apiladas o cosidas entre sí.
  const MATERIALES = [
    "una llave", "una taza", "una vela", "un candado", "una cerilla",
    "una cuchara", "una bombilla", "unas tijeras", "un dado", "una campana",
    "un cuchillo", "una carta del tarot",
  ];

  // Materiales de MASA. Éstos sí admiten «de» a secas, porque en castellano
  // «una rosa de mármol» es correcto y «una rosa de cucharas» no: «de» sólo
  // significa «hecho de» cuando lo que sigue es una materia, no cosas contadas.
  const MASA = [
    "mármol", "cera", "humo", "cristal", "hierro oxidado", "papel quemado",
    "ceniza", "porcelana rota", "cuerda", "alambre", "vidrio de mar", "carbón",
  ];

  // Para «con X dentro» el objeto tiene que TENER dentro. Una cerilla no.
  const CONTENEDORES = [
    "una taza", "una jaula", "un espejo de mano", "un reloj de bolsillo",
    "una bombilla", "un tarro de cristal", "una linterna", "una campana",
    "un teléfono antiguo", "una brújula",
  ];

  // Rasgos que la cosa YA tiene: «un pulpo con tentáculos» no es surrealista,
  // es describirlo. Los que repiten la palabra («un ciervo con cuernos de
  // ciervo») los caza sola la comprobación de texto de encaja().
  const OBVIO = {
    "un pulpo": ["tentáculos"],
    "una medusa": ["tentáculos"],
    "una serpiente": ["escamas"],
    "un pez luna": ["escamas"],
    "un escarabajo": ["escamas"],
    "una araña": ["ojos por todas partes", "tentáculos"],
    "un murciélago": ["alas de polilla"],
    "una abeja": ["alas de polilla"],
    "un cactus": ["pinchos", "espinas de rosa"],
    "una rosa": ["pinchos", "espinas de rosa"],
    "una máquina de coser": ["costuras a la vista", "hilos que la sujetan"],
    "una jaula": ["pinchos"],
  };

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // "una bomba" -> "bomba". Los artículos leen bien en la frase pero estorban
  // al buscar imágenes.
  function limpio(s) { return String(s).replace(/^(un|una|unos|unas|el|la|los|las)\s+/i, "").trim(); }

  // Lo que se manda a Wikimedia/Openverse tiene que ser una COSA, no una frase.
  // «ojos por todas partes» devuelve fotos de cualquier cosa menos ojos, porque
  // esos buscadores casan palabras sueltas del pie de foto. Se corta por la
  // primera preposición o relativo y se deja el sustantivo.
  // Ojo: «de» NO corta a propósito — «hoja de arce» o «bola de cristal» son la
  // cosa entera, y partirlas empeoraría la búsqueda.
  const CORTES = /\s+(por|con|sin|en|sobre|entre|bajo|tras|hacia|que|donde|como|para|y|o)\s+/i;
  function terminoBusqueda(t) {
    let x = limpio(String(t || "")).toLowerCase()
      .replace(/[.,;:!?¡¿"()]/g, " ").replace(/\s+/g, " ").trim();
    const m = CORTES.exec(x);
    if (m && m.index > 0) x = x.slice(0, m.index).trim();
    // Aun sin preposición, cinco palabras no son una cosa. Nos quedamos con las
    // tres primeras, que es donde vive el sustantivo y su complemento con «de».
    const w = x.split(" ");
    if (w.length > 3) x = w.slice(0, 3).join(" ");
    return x.trim();
  }

  // El género sale del artículo, que ya está escrito en la lista: «una rosa» es
  // femenino, «un ciervo» masculino. Hace falta para decir «hecha de» o «hecho
  // de» — la única forma correcta de expresar el material en castellano. Antes
  // se esquivaba con «de» a secas, y de ahí salía «una rosa de cucharas».
  function hechoDe(x) { return /^unas?\s/i.test(x) ? " hecha de " : " hecho de "; }

  // El mismo dato, suelto, para los participios de las explicaciones. Sin esto
  // salía "una medusa ... hecho de vidrio" y "apilando candados, pegadas": el
  // género lo lleva escrito el artículo de cada lista, sólo hay que mirarlo.
  function fem(x) { return hechoDe(x) === " hecha de "; }
  function conc(x, f, m) { return fem(x) ? f : m; }

  // ¿Pega este rasgo con esta cosa? No, si ya lo tiene. Dos redes: la palabra
  // repetida («un ciervo con cuernos de ciervo») y la lista OBVIO para los que
  // no comparten palabra pero son igual de evidentes («un pulpo con tentáculos»).
  function encaja(cosa, rasgo) {
    const nucleo = limpio(cosa).split(" ")[0].toLowerCase();
    if (rasgo.toLowerCase().includes(nucleo)) return false;
    // Un rasgo que dice "dentro" necesita que la cosa tenga dentro. Los bichos
    // siempre lo tienen; los objetos, sólo los de CONTENEDORES. Sin esto salía
    // "una cuchara con musgo creciendo dentro".
    if (/dentro/.test(rasgo) && OBJETOS.indexOf(cosa) >= 0 && CONTENEDORES.indexOf(cosa) < 0) return false;
    return !(OBVIO[cosa] || []).includes(rasgo);
  }

  // Saca una pareja cosa+rasgo que no chirríe. Si en 40 intentos no sale (no
  // debería), busca a mano el primero que valga, en vez de rendirse y soltar
  // una frase mala.
  function pareja(pool) {
    for (let n = 0; n < 40; n++) {
      const c = pick(pool), r = pick(RASGOS);
      if (encaja(c, r)) return { c: c, r: r };
    }
    const c = pick(pool);
    return { c: c, r: RASGOS.find((r) => encaja(c, r)) || pick(RASGOS) };
  }

  // Plural en castellano, lo justo para que la frase no chirríe:
  //   · "tijeras" ya es plural, se deja      (añadir la ese daba "tijerass")
  //   · "reloj de bolsillo" pluraliza el sustantivo de delante, no el de
  //     detrás ("relojes de bolsillo", nunca "reloj de bolsillos")
  //   · vocal → +s, consonante → +es, y la zeta pasa a ce
  function plural(s) {
    const p = String(s).split(/\s+(?:de|del|de la)\s+/);
    if (p.length > 1) return plural(p[0]) + s.slice(p[0].length);
    if (/s$/i.test(s)) return s;
    if (/z$/i.test(s)) return s.slice(0, -1) + "ces";
    if (/[aeiou]$/i.test(s)) return s + "s";
    // "violín" -> "violines", no "violínes": al alargar la palabra la sílaba
    // tónica deja de necesitar tilde.
    const sinTilde = s.replace(/([áéíóú])([nsl])$/i, (m, v, c) =>
      "aeiou"["áéíóú".indexOf(v.toLowerCase())] + c);
    return sinTilde + "es";
  }

  // Cada patrón devuelve { text, elems }. `elems` es lo que luego se busca en
  // internet, así que guarda las piezas por separado ya desde el principio en
  // vez de intentar adivinarlas del texto después.
  // Ella lo dijo claro: «un cactus hecho de velas? que significa eso. necesito
  // mas info». Tenía razón — la frase sola es un acertijo. El generador de IA ya
  // devolvía un «porque» (qué se ve en el dibujo) y el local no, así que las
  // ideas de la máquina llegaban desnudas y las de Gemini explicadas.
  //
  // Cada patrón SABE lo que ha juntado y por qué: él mismo escribe la
  // explicación. No hace falta adivinarla después leyendo el texto, que es lo
  // que habría salido mal.
  const PATRONES = [
    () => { const { c: o, r } = pareja(OBJETOS); return { text: o + " con " + r,
      porque: "Se dibuja " + o + " tal cual, reconocible, pero con " + r + ". "
            + "Lo que llama la atención es el choque: el objeto es normal y ese añadido no pinta nada ahí.",
      elems: [limpio(o), r] }; },
    () => { const { c: s, r } = pareja(SERES); return { text: s + " con " + r,
      porque: "La cosa entera, con su silueta de siempre, pero con " + r + ". "
            + "El dibujo va de ese añadido: es lo que hay que agrandar.",
      elems: [limpio(s), r] }; },
    () => { const o = pick(OBJETOS), a = pick(ACCIONES); return { text: o + " que " + a,
      porque: "Aquí lo que se dibuja no es " + o + ", es el gesto: " + a + ". "
            + "El objeto puede ser sencillo; lo que tiene que leerse es que está haciendo algo imposible.",
      elems: [limpio(o)] }; },
    () => { const s = pick(SERES), a = pick(ACCIONES); return { text: s + " que " + a,
      porque: "Tal cual es, pero en mitad de algo que no debería poder hacer: " + a + ". "
            + "Se dibuja el momento, no el retrato.",
      elems: [limpio(s)] }; },
    () => { const s = pick(SERES); let s2 = pick(SERES); while (s2 === s) s2 = pick(SERES); return { text: s + " con cabeza de " + limpio(s2),
      porque: "Del cuello para abajo, " + s + ". Del cuello para arriba, la cabeza de " + s2 + ". "
            + "Los dos cuerpos se dibujan enteros y bien; la costura del cuello es la gracia.",
      elems: [limpio(s), limpio(s2)] }; },
    () => { const o = pick(OBJETOS), s = pick(SERES); return { text: o + " con cabeza de " + limpio(s),
      porque: "El cuerpo es " + o + " — su forma, su tamaño — y donde tocaría la tapa o la punta sale la cabeza de " + s + ". "
            + "Objeto abajo, bicho arriba.",
      elems: [limpio(o), limpio(s)] }; },
    () => { const o = pick(CONTENEDORES), r = pick(REFLEJOS); return { text: o + " con " + r + " dentro",
      porque: "Se dibuja " + o + " " + conc(o, "abierta", "abierto") + " o de frente, y lo que se ve dentro no es lo que tocaría: es " + r + ". "
            + "Como una ventana a otro sitio metida en un objeto de andar por casa.",
      elems: [limpio(o)] }; },
    // Cosas contadas: exigen el participio. Sin él, "una rosa de cucharas" no
    // se entiende, porque "de" a secas no significa "hecho de".
    () => { const s = pick(SERES), o = pick(MATERIALES); const pl = plural(limpio(o));
      const hecha = conc(s, "construida", "construido");
      return { text: s + hechoDe(s) + pl,
      porque: "La silueta es la de " + s + " y se reconoce de lejos, pero de cerca no hay carne ni piel: "
            + "está " + hecha + " apilando " + pl + ", " + conc(o, "pegadas unas a otras", "pegados unos a otros")
            + " hasta rellenar la forma. De lejos la forma, de cerca el montón de piezas.",
      elems: [limpio(s), limpio(o)] }; },
    // Materia: aquí "de" a secas SÍ es correcto — "un ciervo de mármol".
    () => { const s = pick(SERES), m = pick(MASA); return { text: s + " de " + m,
      porque: "Mismo dibujo de " + s + ", misma pose, pero " + conc(s, "hecha", "hecho") + " de " + m
            + ": cambia la textura y el peso, no la forma. Como una estatua de " + m + " en vez de la cosa viva.",
      elems: [limpio(s), m] }; },
    () => { const o = pick(OBJETOS), m = pick(MASA); return { text: o + " de " + m,
      porque: "El objeto de siempre, con su forma exacta, pero el material es " + m + ". "
            + "Todo el dibujo va en la textura: si no se nota que es " + m + ", la idea no se ve.",
      elems: [limpio(o), m] }; },
  ];

  function generarLocal(n) {
    const evita = new Set(rejected().map(r => r.text.toLowerCase()));
    const yaHay = new Set(saved().map(s => s.text.toLowerCase()));
    const out = [], vistos = new Set();
    // Barajar y recorrer, en vez de sortear cada vez. Sorteando salían tiradas
    // con cuatro frases del mismo molde seguidas, y eso parece un generador
    // roto aunque cada frase por separado esté bien.
    const orden = PATRONES.map((_, i) => i);
    for (let i = orden.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = orden[i]; orden[i] = orden[j]; orden[j] = t;
    }
    let intentos = 0, cursor = 0;
    while (out.length < n && intentos++ < n * 60) {
      const idea = PATRONES[orden[cursor++ % orden.length]]();
      const k = idea.text.toLowerCase();
      if (vistos.has(k) || evita.has(k) || yaHay.has(k)) continue;
      vistos.add(k);
      out.push(idea);
    }
    return out;
  }

  // ===================== generador con IA =====================
  // Usa la key de Gemini que ya está guardada para las imágenes. Modelo de
  // texto, no de imagen: aquí sólo se piden frases.
  // ===================== estilos visuales =====================
  // El estilo manda sobre la idea: «una llave con dientes» se dibuja distinto en
  // high contrast que en línea fina, y hay ideas que en un estilo funcionan y en
  // otro no se leen. Por eso el estilo entra en el prompt, no se decide después.
  const ESTILOS = {
    contraste: {
      label: "HIGH CONTRAST / SURREALISM",
      desc: "collage surrealista: recortes de imágenes distintas pegados como en una revista, "
          + "manchas negras macizas contra blanco puro, cero grises y cero degradados, "
          + "cortes duros y siluetas que se leen a cinco centímetros",
      pide: "Piensa en collage: dos o tres recortes reconocibles que no deberían ir juntos, "
          + "encajados como si los hubieras cortado con tijeras. Que haya una masa negra grande "
          + "que sostenga la composición.",
    },
    finelinea: {
      label: "LÍNEA FINA",
      desc: "línea fina continua, poco relleno, mucho blanco, detalle pequeño y delicado",
      pide: "Ideas que se sostengan solo con el contorno. Nada que necesite una mancha negra "
          + "para entenderse.",
    },
    blackwork: {
      label: "BLACKWORK",
      desc: "negro sólido dominante, formas contundentes, poco detalle interior",
      pide: "Ideas de silueta: que se reconozcan siendo una sombra negra entera.",
    },
    ignorant: {
      label: "IGNORANT / NAÍF",
      desc: "trazo tosco a propósito, dibujo torpe y directo, humor seco",
      pide: "Ideas simples y con chiste. Cuanto más tonta y más clara, mejor.",
    },
  };
  const K_ESTILO = "kaos.ideas.estilo.v1";
  function estiloActual() {
    try { const v = localStorage.getItem(K_ESTILO); if (v && ESTILOS[v]) return v; } catch (e) {}
    return "contraste";   // el que más hace
  }
  function setEstilo(id) {
    if (!ESTILOS[id]) return estiloActual();
    try { localStorage.setItem(K_ESTILO, id); } catch (e) {}
    return id;
  }

  // ===================== referencias visuales (moodboard) =====================
  // Fotos de tatuajes o flashes que le gustan, guardadas por estilo. Se le pasan
  // a Gemini cuando pide ideas, para que mire lo que ya le gusta en vez de
  // adivinar. Se guardan reducidas: en localStorage caben unos 5 MB y una foto
  // de móvil sin tocar se lo come de una.
  const K_REFS = "kaos.ideas.refs.v1";
  const MAX_REFS = 60;
  function refs(estilo) {
    const all = read(K_REFS);
    return estilo ? all.filter(r => r.estilo === estilo) : all;
  }
  // Reduce a JPEG de 512 px de lado largo. Suficiente para que un modelo lea el
  // estilo, y ~40 KB en vez de 4 MB.
  function encoger(dataUrl, lado) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const L = lado || 512;
        const s = Math.min(1, L / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * s));
        c.height = Math.max(1, Math.round(im.naturalHeight * s));
        const cx = c.getContext("2d");
        cx.fillStyle = "#fff";
        cx.fillRect(0, 0, c.width, c.height);   // los PNG con alfa saldrían negros en JPEG
        cx.imageSmoothingQuality = "high";
        cx.drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.72));
      };
      im.onerror = () => rej(new Error("No se pudo leer esa imagen."));
      im.crossOrigin = "anonymous";
      im.src = dataUrl;
    });
  }
  async function addRef(dataUrl, estilo) {
    const img = await encoger(dataUrl, 512);
    const list = refs();
    list.unshift({ id: uid("ref"), img: img, estilo: estilo || estiloActual(), lectura: "", ts: Date.now() });
    write(K_REFS, list.slice(0, MAX_REFS));
    return list[0];
  }
  function removeRef(id) { write(K_REFS, refs().filter(r => r.id !== id)); }
  function updateRef(id, patch) {
    const list = refs();
    const r = list.find(x => x.id === id);
    if (!r) return null;
    Object.assign(r, patch);
    write(K_REFS, list);
    return r;
  }

  const TEXT_MODEL = "gemini-2.5-flash";
  const TEXT_URL = "https://generativelanguage.googleapis.com/v1beta/models/" + TEXT_MODEL + ":generateContent";

  function geminiKey() {
    try { return (root.KAOS_HF && KAOS_HF.getConfig().geminiKey) || ""; }
    catch (e) { return ""; }
  }

  function construirPrompt(n, estiloId) {
    const est = ESTILOS[estiloId] || ESTILOS[estiloActual()];
    // Lo que el modelo ha ido leyendo de sus referencias. Esto es lo que hace
    // que aprenda: cada foto que añade suma una frase sobre su lenguaje visual,
    // y todas juntas se le devuelven al pedir ideas.
    const lecturas = refs(estiloId || estiloActual())
      .map(r => (r.lectura || "").trim()).filter(Boolean).slice(0, 12);
    const megusta = saved().slice(0, 25).map(s => "· " + s.text);
    const nome = rejected().slice(0, 25).map(r => "· " + r.text);
    const pedidos = notes().slice(0, 30)
      .sort((a, b) => (b.n || 1) - (a.n || 1))
      .map(x => "· " + x.text + (x.n > 1 ? " (pedido " + x.n + " veces)" : "") + (x.kind === "agotado" ? " [agotado, lo siguen pidiendo]" : ""));

    return [
      "Eres la ayudante de ideas de una tatuadora de Barcelona. Su estilo es surrealista:",
      "coge un objeto o un ser corriente y le injerta un rasgo que no le toca. Ejemplos suyos:",
      "una bomba con pinchos · un cuchillo con unos ojos reflejados · una flor con dientes de vampiro ·",
      "una pistola que dispara flores · un girasol con cabeza de gato.",
      "",
      "",
      "ESTILO QUE VA A TATUAR AHORA: " + est.label + ".",
      "Se dibuja así: " + est.desc + ".",
      est.pide,
      lecturas.length
        ? "\nLO QUE SE HA LEÍDO DE SUS REFERENCIAS DE ESTE ESTILO (es su lenguaje visual, respétalo):\n"
          + lecturas.map(l => "· " + l).join("\n")
        : "",
      "",
      "Proponle " + n + " ideas NUEVAS de diseño para tatuar EN ESE ESTILO.",
      "",
      "Reglas:",
      "- La idea tiene que poder dibujarse en ese estilo. Si el estilo es de silueta,",
      "  no propongas algo que sólo se entienda con detalle diminuto, y al revés.",
      "- Español. Minúsculas. Una frase corta cada una, como los ejemplos.",
      "- Dos elementos concretos y visibles como mucho. Nada abstracto ('la melancolía' no se tatúa).",
      "- Tiene que funcionar en tinta negra sobre piel: siluetas claras, nada de niebla ni degradados.",
      "- No repitas ninguna de las listas de abajo.",
      // El motor local ya no puede escribir frases sin sentido; a Gemini hay
      // que pedírselo, porque combina libremente. Son las mismas cuatro reglas.
      "- PROHIBIDO lo que no se entienda de un vistazo. Si tú no sabrías dibujarlo",
      "  sin dudar, no la propongas. «un cactus hecho de velas» no vale: nadie sabe",
      "  qué está viendo. «un cactus con las espinas encendidas como cerillas» sí,",
      "  porque se ve.",
      "- Que la frase SIGNIFIQUE algo, por surrealista que sea. En concreto:",
      "  · «hecho de X» sólo con cosas pequeñas y repetibles (de llaves, de tazas, de dados).",
      "    «un pulpo de tocadiscos» no significa nada: no se descarta, es que no se entiende.",
      "  · «con X dentro» sólo si la cosa tiene dentro (una taza sí, una cerilla no).",
      "  · nada de rasgos que la cosa ya tiene: «un pulpo con tentáculos» es describirlo, no inventarlo.",
      "  · dos elementos distintos: «un gato con cabeza de gato» no dice nada.",
      megusta.length ? "\nLE GUSTARON (ve por ahí):\n" + megusta.join("\n") : "",
      nome.length ? "\nLAS DESCARTÓ (no insistas por ahí):\n" + nome.join("\n") : "",
      pedidos.length ? "\nLE PIDEN ESTO DE VERDAD (pesa mucho, son clientas reales):\n" + pedidos.join("\n") : "",
      "",
      "",
      "Cada idea lleva además un \"porque\": UNA frase llana explicando QUÉ SE VE en el",
      "dibujo y por qué funciona. Nada de poesía ni de significados profundos: describe",
      "la imagen, como si se la contaras a alguien que la va a dibujar ahora mismo.",
      "Si no eres capaz de escribir ese \"porque\", la idea no vale y no la pongas.",
      "",
      "Responde SOLO con JSON, sin texto alrededor:",
      '{"ideas":[{"texto":"un pingüino con tutú",',
      '  "elementos":["pingüino","tutú"],',
      '  "porque":"un pingüino de pie, de frente, con un tutú de bailarina en la cintura; el contraste entre el traje del pingüino y el tutú se lee al momento."}]}',
      '"elementos" son las piezas que hay que buscar EN UN BUSCADOR DE FOTOS. Por eso:',
      "  · un solo sustantivo concreto cada uno, una o dos palabras como mucho;",
      "  · en singular y SIN adjetivos, sin posiciones y sin frases.",
      '  Ejemplo: para "una polilla con ojos por todas partes" los elementos son',
      '  ["polilla","ojo"], NUNCA ["ojos por todas partes"]: eso no se busca en ningún sitio.',
    ].filter(Boolean).join("\n");
  }

  function parseIdeasJSON(txt) {
    let s = String(txt || "").trim();
    // El modelo envuelve en ```json casi siempre por mucho que se le diga.
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    const j = JSON.parse(s);
    const arr = Array.isArray(j.ideas) ? j.ideas : [];
    return arr
      .map(x => ({
        text: String(x.texto || x.text || "").trim(),
        porque: String(x.porque || x.explicacion || "").trim(),
        elems: (Array.isArray(x.elementos) ? x.elementos : (x.elems || []))
          .map(e => terminoBusqueda(limpio(String(e)))).filter(Boolean)
          .filter((e, i, a) => a.indexOf(e) === i),
      }))
      .filter(x => x.text);
  }

  // Trocea un data: en {mime, base64} para mandarlo como parte de imagen.
  function partirData(dataUrl) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ""));
    return m ? { mime_type: m[1], data: m[2] } : null;
  }

  async function generarIA(n, estiloId) {
    const key = geminiKey();
    if (!key) throw new Error("sin key");
    const est = estiloId || estiloActual();
    // Se le enseñan sus referencias de verdad, no sólo se le describen. Máximo
    // 6: con más, la petición se hace lenta y el modelo se dispersa.
    const partes = [{ text: construirPrompt(n, est) }];
    const fotos = refs(est).slice(0, 6).map(r => partirData(r.img)).filter(Boolean);
    if (fotos.length) {
      partes.push({ text: "\nEstas " + fotos.length + " imágenes son referencias suyas de este estilo. "
        + "Mira cómo resuelve las formas y por dónde va su gusto, y propón en esa línea." });
      for (const f of fotos) partes.push({ inline_data: f });
    }
    const res = await fetch(TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: partes }],
        generationConfig: { temperature: 1.15, responseMimeType: "application/json" },
      }),
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) {
      const m = (json && json.error && json.error.message) || ("HTTP " + res.status);
      throw new Error(res.status === 429 ? "Gemini sin cuota ahora mismo." : m);
    }
    const cont = ((json.candidates || [])[0] || {}).content;
    const txt = ((cont && cont.parts) || []).map(p => p.text).filter(Boolean).join("");
    const ideas = parseIdeasJSON(txt);
    if (!ideas.length) throw new Error("Gemini no devolvió ideas.");
    return ideas.slice(0, n);
  }

  // Con IA si hay key, y si falla se cae al motor local en vez de dejarla
  // mirando un error: siempre tiene que salir algo.
  async function generar(n, estiloId) {
    n = n || 5;
    const est = estiloId || estiloActual();
    if (geminiKey()) {
      try { return { ideas: await generarIA(n, est), motor: "gemini", estilo: est }; }
      catch (e) { return { ideas: generarLocal(n), motor: "local", estilo: est, aviso: String(e.message || e) }; }
    }
    return { ideas: generarLocal(n), motor: "local", estilo: est };
  }

  // Lee una referencia: en qué estilo cae y qué la hace ser de ese estilo. Es lo
  // que le da memoria — la frase que devuelve se guarda en la referencia y se le
  // reinyecta cada vez que pide ideas.
  async function clasificarRef(id) {
    const key = geminiKey();
    if (!key) throw new Error("Hace falta la key de Gemini para leer referencias.");
    const r = refs().find(x => x.id === id);
    if (!r) throw new Error("Esa referencia ya no está.");
    const foto = partirData(r.img);
    if (!foto) throw new Error("Esa referencia no se puede leer.");
    const catalogo = Object.keys(ESTILOS)
      .map(k => "· " + k + " = " + ESTILOS[k].label + " (" + ESTILOS[k].desc + ")").join("\n");
    const res = await fetch(TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: [
            "Esta es una referencia de tatuaje o de flash que le gusta a una tatuadora.",
            "Clasifícala en UNO de estos estilos:", catalogo, "",
            "Y escribe UNA frase corta, en español y en minúsculas, sobre qué la hace ser de ese",
            "estilo: cómo resuelve las formas, el contraste, la composición. Nada de adjetivos",
            "vacíos ('bonito', 'impactante'): describe lo que se ve.",
            "",
            "Responde SOLO con JSON:",
            '{"estilo":"contraste","lectura":"recortes fotográficos pegados sobre una mancha negra maciza"}',
          ].join("\n") },
          { inline_data: foto },
        ] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) {
      const m = (json && json.error && json.error.message) || ("HTTP " + res.status);
      throw new Error(res.status === 429 ? "Gemini sin cuota ahora mismo." : m);
    }
    const cont = ((json.candidates || [])[0] || {}).content;
    const txt = ((cont && cont.parts) || []).map(p => p.text).filter(Boolean).join("");
    let j = {};
    try {
      let s = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const a = s.indexOf("{"), b = s.lastIndexOf("}");
      if (a >= 0 && b > a) s = s.slice(a, b + 1);
      j = JSON.parse(s);
    } catch (e) { throw new Error("Gemini no devolvió una lectura válida."); }
    const patch = { lectura: String(j.lectura || "").trim() };
    if (ESTILOS[j.estilo]) patch.estilo = j.estilo;
    return updateRef(id, patch);
  }

  // ===================== búsqueda de referencias =====================
  // Wikimedia Commons: sin clave, sin límite y todo con licencia libre. Es la
  // única fuente que no puede dejar de funcionar el día que caduque un token.
  async function buscarCommons(q, limite) {
    const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
      action: "query", format: "json", origin: "*",
      generator: "search", gsrsearch: "filetype:bitmap " + q,
      gsrnamespace: "6", gsrlimit: String(limite || 20),
      prop: "imageinfo", iiprop: "url", iiurlwidth: "400",
    });
    const r = await fetch(url);
    if (!r.ok) throw new Error("Commons HTTP " + r.status);
    const j = await r.json();
    const pages = (j.query && j.query.pages) || {};
    return Object.keys(pages).map(k => {
      const p = pages[k];
      const ii = (p.imageinfo || [])[0] || {};
      return {
        fuente: "commons",
        titulo: String(p.title || "").replace(/^File:/, ""),
        thumb: ii.thumburl || ii.url,
        full: ii.thumburl || ii.url,   // el original puede pesar 40 MB
        pagina: ii.descriptionurl || "",
      };
    }).filter(x => x.thumb);
  }

  // Openverse suma fotografía moderna, que en Commons escasea (un tutú de
  // ballet sale mejor aquí que en un archivo enciclopédico).
  async function buscarOpenverse(q, limite) {
    const url = "https://api.openverse.org/v1/images/?" + new URLSearchParams({
      q, page_size: String(limite || 20),
    });
    const r = await fetch(url);
    if (!r.ok) throw new Error("Openverse HTTP " + r.status);
    const j = await r.json();
    return (j.results || []).map(x => ({
      fuente: "openverse",
      titulo: x.title || q,
      thumb: x.thumbnail || x.url,
      full: x.url,
      pagina: x.foreign_landing_url || "",
    })).filter(x => x.thumb);
  }

  // Las dos a la vez, y si una se cae la otra sigue sirviendo.
  async function buscarImagenes(q, limite) {
    const n = Math.max(8, Math.round((limite || 24) / 2));
    // Se limpia aquí también, no sólo al recibir las ideas: así las ideas que ya
    // tenía guardadas de antes (con elementos tipo «ojos por todas partes»)
    // también buscan bien, sin tener que tocarlas una a una.
    q = terminoBusqueda(q) || String(q || "").trim();
    const rs = await Promise.allSettled([buscarCommons(q, n), buscarOpenverse(q, n)]);
    const out = [];
    for (const r of rs) if (r.status === "fulfilled") out.push.apply(out, r.value);
    if (!out.length) {
      const err = rs.filter(r => r.status === "rejected")[0];
      throw new Error(err ? ("No se pudo buscar: " + (err.reason && err.reason.message))
                          : ("Sin resultados para «" + q + "»."));
    }
    // Intercaladas, para que no salgan 20 de una fuente y luego 20 de la otra.
    const a = out.filter(x => x.fuente === "commons"), b = out.filter(x => x.fuente === "openverse");
    const mix = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) mix.push(a[i]);
      if (b[i]) mix.push(b[i]);
    }
    return mix;
  }

  // ===================== llevar al composer =====================
  // El Surreal Composer ya sabe recortar el fondo de lo que le eches; sólo hay
  // que darle un File. Se descarga la imagen a mano en vez de pasarle la URL
  // porque el canvas quedaría contaminado y no se podría exportar el flash.
  async function urlAFile(url, nombre) {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) throw new Error("No se pudo descargar la imagen (HTTP " + r.status + ")");
    const blob = await r.blob();
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    return new File([blob], (nombre || "ref").replace(/[^\w\-]+/g, "_").slice(0, 40) + "." + ext,
                    { type: blob.type || "image/png" });
  }

  async function alComposer(items) {
    if (!root.KAOS_SURREAL || !KAOS_SURREAL.addFiles) {
      throw new Error("El Surreal Composer no está disponible.");
    }
    const files = [];
    for (const it of items) {
      try { files.push(await urlAFile(it.full || it.thumb, it.titulo)); }
      catch (e) { console.warn("referencia saltada", it.titulo, e); }
    }
    if (!files.length) throw new Error("Ninguna imagen se dejó descargar. Prueba con otras.");
    KAOS_SURREAL.open();
    await KAOS_SURREAL.addFiles(files);
    return files.length;
  }

  // ===================== imagen generada =====================
  // Reaprovecha el proveedor ya configurado (Gemini o un Space gratis de
  // HuggingFace). No hay proveedor nuevo que configurar.
  function promptDeIdea(texto) {
    return "Tattoo flash illustration of " + texto + ". " +
      "Black ink on white background, bold clean outlines, high contrast, " +
      "no color, no grey wash, no background scenery, centered single subject, " +
      "surrealist mashup, illustrative tattoo design.";
  }
  async function generarImagen(texto, onProgress) {
    if (!root.KAOS_HF) throw new Error("El módulo de generación no cargó.");
    return await KAOS_HF.generate({ prompt: promptDeIdea(texto), onProgress: onProgress });
  }

  // ===================== precio =====================
  // Valores por defecto de un flash suyo típico. Se pueden tocar por idea.
  const PRECIO_BASE = { w: 10, h: 12, dens: "0.6", estilo: "3", det: 3, color: "1.0", fill: "1.0" };

  function calcularPrecio(params) {
    if (!root.KAOS_PRECIO) throw new Error("Falta precio.js.");
    return KAOS_PRECIO.rangoFlash(Object.assign({}, PRECIO_BASE, params || {}));
  }

  root.KAOS_IDEAS = {
    // peticiones
    notes: notes, addNote: addNote, bumpNote: bumpNote, removeNote: removeNote,
    // ideas
    saved: saved, rejected: rejected, saveIdea: saveIdea, updateIdea: updateIdea,
    removeIdea: removeIdea, rejectIdea: rejectIdea,
    generar: generar, generarLocal: generarLocal,
    // referencias
    buscarImagenes: buscarImagenes, terminoBusqueda: terminoBusqueda, alComposer: alComposer, urlAFile: urlAFile,
    // estilo visual y moodboard
    ESTILOS: ESTILOS, estiloActual: estiloActual, setEstilo: setEstilo,
    refs: refs, addRef: addRef, removeRef: removeRef, updateRef: updateRef,
    clasificarRef: clasificarRef,
    // imagen y precio
    generarImagen: generarImagen, promptDeIdea: promptDeIdea,
    calcularPrecio: calcularPrecio, PRECIO_BASE: PRECIO_BASE,
    limpio: limpio,
  };
})(window);
