// KAOS.REALM — el panel lateral, plano (fase 2, segunda versión)
// ====================================================================
// La primera versión metía todo en desplegables. Estaba mal, y ella lo dijo:
// "es mas lento de trabajar y acceder". Tenía razón — cambiaba 133 saltos de
// pestaña por un clic antes de CADA acción. Y visualmente era un montón de
// cajas grises, o sea justo la "UI genérica encajonada de IA" que prohíbe la
// norma 6 de su CLAUDE.md.
//
// El planteamiento correcto sale de separar los dos problemas:
//
//   · BUSCAR: 133 de sus 245 cambios de pestaña fueron seguidos sin tocar
//     nada. Eso se arregla con que TODO esté a la vista y con una barra que
//     salte a cada zona. No escondiendo.
//   · LARGO: el scroll largo ya falló en iPad (está escrito en app.js). Pero
//     no falló por tener todo a la vista: falló porque son 218 mandos y ella
//     no toca 108 de ellos. Se arregla quitando de en medio LO QUE NO USA,
//     no plegando lo que sí.
//
// Así que: panel plano, todo lo que usa siempre visible y a cero clics. Lo
// único que se pliega es lo que tiene CERO pulsaciones suyas en 10 días, en
// un "avanzado" por zona. Nunca se esconde algo que haya tocado.
//
// La barra de pestañas deja de filtrar y pasa a saltar: sigue estando, sigue
// donde estaba, pero ya no esconde tres cuartas partes del panel.
//
// SEGURIDAD: si algo falla, se devuelven las pestañas de siempre.
// ====================================================================
(function (root) {
  "use strict";

  const K_USO = "kaos.usage.v1";        // sólo se LEE
  const K_AVANZADO = "kaos.panel.avanzado.v1";
  const MINIMO_DATOS = 50;

  // Nombres en castellano, diciendo qué hacen. "MASK" no significa nada a las
  // nueve de la mañana. El orden lo mandan sus pulsaciones: recortar el fondo
  // es su mando más usado (62) y estaba escondido tras 67 viajes a una pestaña.
  const ZONAS = [
    { panel: "mask",   nombre: "RECORTAR",  largo: "RECORTAR EL FONDO" },
    { panel: "style",  nombre: "FOTO",      largo: "FOTO Y ESTILO" },
    { panel: "finish", nombre: "ACABADO",   largo: "ACABADO" },
    { panel: "paper",  nombre: "PAPEL",     largo: "PAPEL Y FORMATO" },
  ];

  // Bloques sin título propio que sí son cosas distintas. Se reconocen por lo
  // que llevan dentro. Comprobado contra el marcado: el panel STYLE tiene 11
  // bloques hijos y CERO títulos directos — los títulos van dentro.
  const NOMBRA = [
    { dentro: ".surreal-side", nombre: "COMPONER" },
    { dentro: "#prepBtn",      nombre: "PREPARAR LA FOTO" },
    { clase: "styles",         nombre: "ESTILO" },
  ];

  function leerUso() {
    try {
      const ev = JSON.parse(localStorage.getItem(K_USO) || "[]");
      if (!Array.isArray(ev) || ev.length < MINIMO_DATOS) return null;
      const c = {};
      for (const e of ev) if (e && e.id) c[e.id] = (c[e.id] || 0) + (e.rep || 1);
      return c;
    } catch (e) { return null; }
  }

  // El mismo nombre que le pone `identify()` en usage.js. Tiene que ser igual:
  // media interfaz son botones sin id que se apuntan por su texto
  // (`txt:02HIGH CONTRAST`, 30 pulsaciones). Contando sólo los que tienen id,
  // el selector de estilo salía con peso 0 y se habría escondido justo lo que
  // más usa. Su peso real es 48.
  function claveDe(el) {
    if (el.id) return el.id;
    const d = el.dataset || {};
    if (d.tweak && d.val) return d.tweak + ":" + d.val;
    if (d.tab) return "tab:" + d.tab;
    if (d.cat) return "cat:" + d.cat;
    const txt = (el.textContent || "").trim().slice(0, 24);
    return txt ? "txt:" + txt : null;
  }
  const PULSABLES = "button, .tog, .style-btn, .pick-btn, input, select";
  function pesoDe(el, uso) {
    if (!uso || !el || !el.querySelectorAll) return 0;
    let n = 0;
    const suma = (x) => { const k = claveDe(x); if (k && uso[k]) n += uso[k]; };
    if (el.matches && el.matches(PULSABLES)) suma(el);
    for (const c of el.querySelectorAll(PULSABLES)) suma(c);
    return n;
  }

  function tituloDe(el) {
    if (!el || !el.classList) return null;
    for (const r of NOMBRA) {
      try {
        if (r.clase && el.classList.contains(r.clase)) return { texto: r.nombre };
        if (r.dentro && el.querySelector && el.querySelector(r.dentro)) return { texto: r.nombre };
      } catch (e) {}
    }
    if (el.classList.contains("section-title")) return { nodo: el, propio: true };
    const t = el.querySelector ? el.querySelector(".section-title") : null;
    if (t && !t.hidden) return { nodo: t };
    return null;
  }

  function montar() {
    const scroll = document.querySelector(".side-scroll");
    const tabs = document.querySelector("#sideTabs");
    if (!scroll) return false;
    const paneles = Array.from(scroll.querySelectorAll(".side-panel"));
    if (paneles.length < 2) return false;

    const uso = leerUso();
    let avanzadoAbierto = false;
    try { avanzadoAbierto = localStorage.getItem(K_AVANZADO) === "1"; } catch (e) {}

    const cajas = {};

    for (const panel of paneles) {
      const nombre = panel.dataset.panel;
      const zona = ZONAS.filter((z) => z.panel === nombre)[0];
      panel.hidden = false;

      const sueltos = [];
      const grupos = [];
      let actual = null;
      for (const h of Array.from(panel.children)) {
        // Las rayas sueltas sobran: ahora separa la tipografía de los rótulos.
        if (h.classList && h.classList.contains("rule")) { h.remove(); continue; }
        const t = tituloDe(h);
        if (t) {
          actual = { titulo: t, nodos: t.propio ? [] : [h], peso: pesoDe(h, uso) };
          grupos.push(actual);
        } else if (actual) {
          actual.nodos.push(h);
          actual.peso += pesoDe(h, uso);
        } else {
          // Lo que va antes del primer título: siempre visible, arriba.
          sueltos.push(h);
        }
      }
      // Se reparte DESPUÉS de recorrerlo entero: un bloque puede recibir uso
      // por un hermano de detrás, y decidiéndolo sobre la marcha un mando muy
      // usado podría acabar escondido sólo por el orden en que apareció.
      const vivos = grupos.filter((g) => !uso || g.peso > 0);
      const muertos = grupos.filter((g) => uso && g.peso === 0);

      // --- rótulo de zona ---
      const rotulo = document.createElement("div");
      rotulo.className = "zn-rotulo";
      const num = document.createElement("span");
      num.className = "zn-num";
      num.textContent = String(ZONAS.indexOf(zona) + 1).padStart(2, "0");
      const nom = document.createElement("span");
      nom.className = "zn-nom";
      nom.textContent = zona ? zona.largo : (nombre || "").toUpperCase();
      rotulo.appendChild(num);
      rotulo.appendChild(nom);

      const caja = document.createElement("section");
      caja.className = "zn";
      caja.id = "zn-" + nombre;
      caja.appendChild(rotulo);
      for (const n of sueltos) caja.appendChild(n);

      const pintar = (g, destino) => {
        if (g.titulo.texto) {
          const t = document.createElement("div");
          t.className = "section-title";
          t.textContent = g.titulo.texto;
          destino.appendChild(t);
        } else if (g.titulo.nodo) {
          destino.appendChild(g.titulo.nodo);
        }
        for (const n of g.nodos) destino.appendChild(n);
      };
      for (const g of vivos) pintar(g, caja);

      // --- lo que nunca ha tocado, fuera de en medio ---
      // Es el único pliegue que queda, y por definición no esconde nada que
      // haya usado: son bloques con CERO pulsaciones suyas en 10 días.
      if (muertos.length) {
        const det = document.createElement("details");
        det.className = "zn-avanzado";
        det.open = avanzadoAbierto;
        const sum = document.createElement("summary");
        sum.textContent = "AVANZADO · " + muertos.length;
        det.appendChild(sum);
        const dentro = document.createElement("div");
        dentro.className = "zn-avanzado-cuerpo";
        for (const g of muertos) pintar(g, dentro);
        det.appendChild(dentro);
        det.addEventListener("toggle", () => {
          try { localStorage.setItem(K_AVANZADO, det.open ? "1" : "0"); } catch (e) {}
        });
        caja.appendChild(det);
      }

      panel.replaceWith(caja);
      cajas[nombre] = caja;
    }

    // Orden por uso real, moviendo nodos: así el orden que se ve, el de
    // lectura y el del teclado son el mismo.
    for (const z of ZONAS) if (cajas[z.panel]) scroll.appendChild(cajas[z.panel]);

    // --- la barra deja de filtrar y pasa a saltar ---
    // Mismo sitio, misma pinta, pero ya no esconde tres zonas de cuatro.
    if (tabs) {
      const botones = Array.from(tabs.querySelectorAll(".side-tab"));
      const nuevo = tabs.cloneNode(false);      // clon vacío: se van los listeners viejos
      nuevo.className = (tabs.className || "") + " zn-nav";
      for (const z of ZONAS) {
        if (!cajas[z.panel]) continue;
        const viejo = botones.filter((b) => b.dataset.tab === z.panel)[0];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "side-tab";
        b.dataset.tab = z.panel;
        b.textContent = z.nombre;
        if (viejo && viejo.title) b.title = viejo.title;
        b.addEventListener("click", () => {
          try { cajas[z.panel].scrollIntoView({ block: "start", behavior: "smooth" }); }
          catch (e) { cajas[z.panel].scrollIntoView(); }
        });
        nuevo.appendChild(b);
      }
      tabs.replaceWith(nuevo);

      // Marcar dónde está según lo que se ve, no según lo último pulsado: si
      // se desplaza a mano, la barra tiene que seguirla o miente.
      if (root.IntersectionObserver) {
        const marcar = (n) => {
          const bs = nuevo.querySelectorAll(".side-tab");
          for (const b of bs) b.setAttribute("aria-selected", b.dataset.tab === n ? "true" : "false");
        };
        const obs = new root.IntersectionObserver((ents) => {
          const v = ents.filter((e) => e.isIntersecting)
                        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          if (v && v.target.id) marcar(v.target.id.replace("zn-", ""));
        }, { root: scroll, rootMargin: "-10% 0px -70% 0px", threshold: 0 });
        for (const z of ZONAS) if (cajas[z.panel]) obs.observe(cajas[z.panel]);
      }
    }

    // app.js llama a esto al empezar a recortar. Ya no hay que enseñar nada
    // escondido: sólo llevarla hasta la zona.
    root.KAOS_SHOW_TAB = function (nombre) {
      const c = cajas[nombre];
      if (!c) return;
      try { c.scrollIntoView({ block: "start", behavior: "smooth" }); }
      catch (e) { c.scrollIntoView(); }
    };

    document.documentElement.classList.add("zn-on");
    return true;
  }

  function arrancar() {
    try {
      if (!montar()) return;
    } catch (e) {
      console.warn("panel-lateral: me vuelvo a las pestañas ->", e);
      const tabs = document.querySelector("#sideTabs");
      if (tabs) tabs.hidden = false;
      document.documentElement.classList.remove("zn-on");
    }
  }

  if (document.readyState === "complete") setTimeout(arrancar, 0);
  else root.addEventListener("load", () => setTimeout(arrancar, 0));
})(window);
