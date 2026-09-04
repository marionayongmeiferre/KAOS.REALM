// KAOS.REALM — barra de borradores, la misma para todos los editores
//
// Un borrador es un trabajo a medias: se guarda tal como está y se recupera
// para seguir. Vive en store.js (IndexedDB, tienda `borradores`), separado de
// las hojas de flash terminadas.
//
// Cada editor la monta con una línea:
//
//   KAOS_BORRADORES.montar(caja, {
//     tipo:   "reel",              // para no mezclar editores
//     leer:   () => st,            // qué guardar (algo que aguante JSON)
//     poner:  (data) => { ... },   // cómo volver a ese estado
//     nombre: () => "Reel de 12",  // opcional, para el nombre por defecto
//     foto:   () => canvas,        // opcional: el lienzo del que sale la
//                                  // miniatura de la tarjeta
//   });
//
// Lo que NO guarda: nada que no sobreviva a un JSON. En el reel eso es el
// vídeo de fondo, que es un objectURL y muere al recargar. Se avisa en vez de
// guardar una referencia rota.
//
// POR QUÉ YA NO ES UN DESPLEGABLE
// Era un <select> con «nombre · fecha». Sus borradores se llaman todos parecido
// y la fecha no dice qué hay dentro, así que para encontrar uno había que ir
// abriéndolos por descarte — y abrir uno PISA lo que tengas en pantalla. Ahora
// es una rejilla de tarjetas con la foto de cada borrador: se elige mirando.
(function (root) {
  "use strict";

  const ST = root.KAOS_STORE;
  if (!ST || !ST.borradores) { console.warn("borradores-ui: falta store.js"); return; }

  function cuando(ts) {
    const d = new Date(ts);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const hora = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return mismoDia ? "hoy " + hora : d.toLocaleDateString() + " " + hora;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Una foto pequeña del lienzo que le pase el editor. 360 px de lado mayor y
  // JPEG al 72%: unos 20 KB. En localStorage habría sido una barbaridad; en
  // IndexedDB, que es donde viven ahora, no se nota.
  function miniatura(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    try {
      const k = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(canvas.width * k));
      c.height = Math.max(1, Math.round(canvas.height * k));
      const x = c.getContext("2d");
      // Fondo debajo: el lienzo puede tener transparencia, y un JPEG sin fondo
      // la pinta en negro sucio o en blanco según el navegador.
      x.fillStyle = "#0a0908";
      x.fillRect(0, 0, c.width, c.height);
      x.imageSmoothingQuality = "high";
      x.drawImage(canvas, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.72);
    } catch (e) { return null; }
  }

  // Qué borrador tiene abierto cada editor. Es un apunte, no datos: si se
  // pierde, lo único que pasa es que el siguiente guardado pregunta el nombre.
  const K_ABIERTO = "kaos.borrador.abierto.v1";
  function todosAbiertos() {
    try { return JSON.parse(localStorage.getItem(K_ABIERTO) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function leerAbierto(tipo) {
    const id = todosAbiertos()[tipo];
    // Se comprueba que siga existiendo: si lo borró, apuntar a un id fantasma
    // haría que el siguiente guardado se perdiera en el aire.
    return (id && ST.abrirBorrador(id)) ? id : null;
  }
  function apuntarAbierto(tipo, id) {
    try {
      const t = todosAbiertos();
      if (id) t[tipo] = id; else delete t[tipo];
      localStorage.setItem(K_ABIERTO, JSON.stringify(t));
    } catch (e) { /* sin apunte se sigue trabajando igual */ }
  }

  function montar(caja, opts) {
    if (!caja || !opts || !opts.tipo) return null;
    const tipo = opts.tipo;
    // CUÁL ESTÁ ABIERTO, ENTRE RECARGAS.
    //
    // Esto era una variable normal y moría al recargar la página. El efecto:
    // seguías con el mismo trabajo, dabas a guardar, y como la app ya no
    // recordaba cuál tenías abierto te pedía nombre y creaba OTRO borrador. A
    // las pocas veces tenías cinco copias del mismo y ninguna era «la buena».
    //
    // Ahora se apunta en el disco. Al volver, si ese borrador sigue existiendo,
    // se sigue sobrescribiendo ése.
    let actual = leerAbierto(tipo);

    caja.classList.add("borr-barra");
    caja.textContent = "";

    const bAbrir = document.createElement("button");
    bAbrir.className = "icon-btn borr-abrir";
    const bGuardar = document.createElement("button");
    bGuardar.className = "icon-btn";
    bGuardar.textContent = "GUARDAR BORRADOR";
    const nota = document.createElement("div");
    nota.className = "tip borr-nota";
    caja.append(bAbrir, bGuardar, nota);

    function decir(txt) { nota.textContent = txt || ""; }

    function pintar() {
      const n = ST.borradores(tipo).length;
      bAbrir.textContent = n ? "BORRADORES · " + n : "SIN BORRADORES";
      bAbrir.disabled = !n;
    }

    // --------------------------------------------------------- el elegidor
    // Usa las mismas clases que el diálogo de hojas guardadas del flash post,
    // a propósito: una sola manera de enseñar trabajo guardado en toda la app.
    function abrirElegidor() {
      const list = ST.borradores(tipo);
      if (!list.length) return;
      const tarjetas = list.map((b, i) => {
        const foto = b.thumb
          ? `<img src="${b.thumb}" alt="" loading="lazy">`
          // Un borrador de antes de que existieran las miniaturas. Se dice, en
          // vez de dejar un hueco gris que parezca roto.
          : `<div class="kd-card-sinfoto">SIN<br>MINIATURA</div>`;
        return `
        <button class="kd-card${b.id === actual ? " kd-card-actual" : ""}"
                data-id="${b.id}" data-act="open" style="--i:${i}">
          <span class="kd-card-foto">${foto}</span>
          <span class="kd-card-pie">
            <span class="kd-card-name">${esc(b.nombre)}</span>
            <span class="kd-card-meta">${cuando(b.ts)}</span>
          </span>
          <span class="kd-card-x" data-act="del" title="Borrar" aria-label="Borrar">✕</span>
        </button>`;
      }).join("");

      const back = document.createElement("div");
      back.className = "kaos-dialog-back";
      back.innerHTML = `<div class="kaos-dialog">
        <div class="kd-title">Seguir un borrador <span class="kd-cuenta">${list.length}</span></div>
        <div class="kd-cards">${tarjetas}</div>
        <div class="kd-actions"><button class="icon-btn" data-act="close">CERRAR</button></div>
      </div>`;
      document.body.appendChild(back);

      back.addEventListener("click", (e) => {
        // El objetivo del clic puede ser la <img> o un <span> de dentro de la
        // tarjeta, que no llevan `data-act`. Se sube hasta el primero que lo
        // tenga: la ✕ está más adentro que la tarjeta, así que gana ella y
        // borrar sigue siendo borrar.
        const quien = e.target.closest && e.target.closest("[data-act]");
        const act = quien && quien.dataset.act;
        // Clic en el fondo, fuera del cuadro: cerrar. Es lo que espera el dedo.
        if (!act && e.target === back) { back.remove(); return; }
        if (!act) return;
        if (act === "close") { back.remove(); return; }
        const card = quien.closest(".kd-card");
        if (!card) return;
        const id = card.dataset.id;

        if (act === "del") {
          // La ✕ vive DENTRO de la tarjeta, y la tarjeta abre el borrador: sin
          // esto el mismo clic borraría y abriría a la vez.
          e.stopPropagation();
          const bx = quien;
          if (bx.dataset.seguro !== "1") {        // primer toque sólo pregunta
            // Preguntar siempre antes de borrar, aunque sea un borrador: puede
            // llevar media tarde de trabajo dentro.
            bx.dataset.seguro = "1";
            bx.textContent = "¿BORRAR?";
            bx.classList.add("peligro");
            setTimeout(() => {
              if (!bx.isConnected) return;
              bx.dataset.seguro = "0"; bx.textContent = "✕";
              bx.classList.remove("peligro");
            }, 4000);
            return;
          }
          const nombre = (ST.abrirBorrador(id) || {}).nombre || "";
          card.classList.add("kd-card-fuera");
          setTimeout(() => {
            ST.borrarBorrador(id);
            if (actual === id) { actual = null; apuntarAbierto(tipo, null); }
            pintar();
            decir("Borrado «" + nombre + "».");
            back.remove();
            if (ST.borradores(tipo).length) abrirElegidor();
          }, 220);
          return;
        }

        if (act === "open") {
          const b = ST.abrirBorrador(id);
          back.remove();
          if (!b) { pintar(); decir("Ese borrador ya no está."); return; }
          actual = id;
          apuntarAbierto(tipo, actual);
          try { opts.poner(JSON.parse(JSON.stringify(b.data))); }
          catch (err) { decir("No he podido abrirlo: " + err.message); return; }
          pintar();
          decir("Sigues con «" + b.nombre + "». Al guardar se sobrescribe éste.");
        }
      });

      // Escape cierra. Se quita solo al cerrar para no dejar escuchadores vivos.
      const fuga = (ev) => {
        if (ev.key !== "Escape") return;
        back.remove();
        document.removeEventListener("keydown", fuga);
      };
      document.addEventListener("keydown", fuga);
    }

    bAbrir.addEventListener("click", abrirElegidor);

    bGuardar.addEventListener("click", () => {
      let data;
      try { data = JSON.parse(JSON.stringify(opts.leer())); }
      catch (e) { decir("No he podido guardar: " + e.message); return; }
      const sugerido = (opts.nombre && opts.nombre()) || ("Borrador " + cuando(Date.now()));
      // Sobrescribe el que esté abierto; si no hay ninguno, pide nombre para el
      // nuevo. Así seguir trabajando no deja veinte copias del mismo.
      let nombre = sugerido;
      if (!actual) {
        const puesto = prompt("Nombre del borrador:", sugerido);
        if (puesto === null) return;
        nombre = puesto.trim() || sugerido;
      }
      let thumb = null;
      try { thumb = miniatura(opts.foto && opts.foto()); } catch (e) {}
      const b = ST.guardarBorrador(tipo, nombre, data, actual, thumb);
      actual = b.id;
      apuntarAbierto(tipo, actual);
      pintar();
      decir("Guardado «" + b.nombre + "» · " + cuando(b.ts)
        + (opts.aviso ? " — " + opts.aviso : ""));
    });

    pintar();
    // IndexedDB tarda un pestañeo en abrir: cuando termine puede haber
    // borradores que en el primer pintado no estaban. Y con ellos, el que ella
    // tenía abierto: si no se vuelve a mirar aquí, en ese primer intento parece
    // que no existe y el siguiente guardado crearía uno nuevo — justo lo que
    // esto viene a arreglar.
    if (ST.alEstarListo) ST.alEstarListo(() => {
      if (!actual) actual = leerAbierto(tipo);
      pintar();
    });
    // `refrescar` para cuando el editor cambie de estado por su cuenta.
    return { refrescar: pintar, actual: () => actual, decir: decir };
  }

  root.KAOS_BORRADORES = { montar: montar };
})(window);
