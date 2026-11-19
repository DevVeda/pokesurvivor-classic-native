/* ============ ui.js — utilidades comunes de la interfaz ============
 * - Mostrar / ocultar pantallas.
 * - Sprites animados de PMD dentro de <canvas> del DOM (menú, colección,
 *   gacha...). Se registran aquí y el bucle principal los anima con tick().
 * - Sonidos de interfaz (por delegación: cualquier botón suena solo).
 * - Panel de sonido, avisos (toast), monedas, chips de tipo, estrellas.
 */
G.UI = (() => {
  const $ = id => document.getElementById(id);
  // Qué ventana está abierta: native/shim/ui.js (en todas las plataformas) las marca con show / hide para el juego
  // (isOpen('scr-pause'), 'scr-levelup', 'scr-item', 'scr-bond', 'scr-over'…), aunque las pinte él. Se guarda aquí, no en el
  // HTML (casi todas esas pantallas ya no existen; la web vieja: rama main-web); si el elemento existe (la Tienda: el
  // puesto de los Kecleon mide su lienzo), también se le pone o quita .hidden.
  const SCREENS = ['scr-dex', 'scr-upgrades', 'scr-shop', 'scr-bag', 'scr-gacha', 'scr-levelup', 'scr-pause', 'scr-over',
                   'scr-lobby', 'scr-item', 'scr-bond'];
  const opened = new Set();

  function show(id) {
    for (const s of SCREENS) if (s !== id) hide(s);
    opened.add(id);
    const el = $(id); if (el) el.classList.remove('hidden');
  }
  function hide(id) { opened.delete(id); const el = $(id); if (el) el.classList.add('hidden'); }
  function hideAll() { for (const s of [...SCREENS, ...opened]) hide(s); }
  function isOpen(id) { return opened.has(id); }

  // La barra de arriba, el sonido, el aviso legal y «Acerca de» son los de native/shim/ui.js (la web vieja: rama main-web).
  // Estos pasos del mapa de flujos los describen.
  // @step meta/topbar screen "Barra monedas/tickets"
  // refreshCoins pinta monedas, tickets (y caramelos en Halloween) y el punto de sync: ok, pending,
  // syncing, offline, local o guest.
  // @sub cloud

  // @step menu/topbar event "Guardar / sonido"
  // btn-save sube a la nube (saveNow); btn-sound volumen; btn-full pantalla completa.
  // @sub cloud

  // @step controls/backdrop event "Clic en fondo"
  // Pulsar y soltar en el fondo oscuro de dex, upgrades, shop, bag, gacha, goals, friends, rank,
  // settings, news o support pulsa su Volver/Cerrar.
  // @next databack

  // @step settings/sound data "Sonido"
  // Volumen de música y efectos, silenciar todo.

  // @step settings/legal screen "Aviso legal"
  // Borrar cuenta (sólo sesión no invitada).
  // @screen scr-legal
  // @next del

  // @step settings/about screen "Acerca de"
  // Versión, créditos, guía y Pokédex (si PS_PAGES), aviso legal y contacto.
  // @next legal

  // ponytail: la barra HTML de monedas ya no existe; la de ui.js lee G.DB.save sola. Se deja para quien la llama.
  function refreshCoins() {}

  let toastEl = null, toastT = 0;
  function toast(msg, ms = 2200) {   // (ui.js la sustituye por la suya)
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }

  // ---------------- sprites en canvas del DOM ----------------

  const live = new Set();
  const byCanvas = new WeakMap();      // canvas -> su animación (para no recorrer todas)
  // Sólo se animan los canvas que están a la vista (la colección tiene cientos).
  const seen = new WeakMap();
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(es => es.forEach(e => seen.set(e.target, e.isIntersecting)), { rootMargin: '80px' })
    : null;

  /**
   * Anima un Pokémon dentro de un <canvas>.
   * opts: { anim='Idle', dir=0, shiny, silhouette, lively (ataca de vez en
   *         cuando), spin (va girando), shadow=true,
   *         scale=2   tamaño de píxel FIJO (×2 como en el juego): todos los
   *                   Pokémon de una vista salen con el mismo píxel, aunque
   *                   los gigantes no quepan enteros
   *         skin      disfraz (core/skins.js)
   *         hero      vista de un solo Pokémon: puede reducir la escala para
   *                   que quepa, porque ahí no se compara con nada }
   */
  function sprite(cv, dex, opts = {}) {
    const prev = byCanvas.get(cv);
    if (prev) live.delete(prev);
    const a = new G.Sprites.Animator(dex, 1, !!opts.shiny);
    a.dir = opts.dir || 0;
    a.skin = opts.skin || null;
    a.loop(opts.anim || 'Idle');
    const s = { cv, ctx: cv.getContext('2d'), a, dex, opts, t: Math.random() * 3, spinT: 0, sparkT: 0 };
    live.add(s);
    byCanvas.set(cv, s);
    if (io) io.observe(cv);
    return s;
  }

  function tick(dt) {
    for (const s of live) {
      if (!s.cv.isConnected) { live.delete(s); if (io) io.unobserve(s.cv); continue; }
      if (s.cv.offsetParent === null) continue;            // pantalla oculta
      if (io && seen.get(s.cv) === false) continue;         // fuera de la vista
      s.a.update(dt);

      if (s.opts.lively) {
        s.t -= dt;
        if (s.t <= 0) { s.t = G.U.rand(2.5, 4.5); s.a.play(G.U.pick(['Attack', 'Shoot', 'Charge'])); }
      }
      if (s.opts.spin) {
        s.spinT += dt;
        if (s.spinT > 1.4) { s.spinT = 0; s.a.dir = (s.a.dir + 7) % 8; }
      }

      const { cv, ctx } = s;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.imageSmoothingEnabled = false;

      // Escala entera para que los píxeles queden nítidos.
      const m = G.Sprites.animMeta(s.dex, 'Idle');
      const ay = m ? m.ay : 24;
      let k = s.opts.scale || 2;
      if (s.opts.hero) k = Math.max(1, Math.min(k, Math.floor(cv.height * 0.8 / ay)));
      s.a.scale = k / G.Sprites.PX;
      // Si no cabe de pie, se centra el cuerpo en el recuadro.
      const big = ay * k > cv.height * 0.8;
      const fx = cv.width / 2, fy = big ? cv.height / 2 + ay * k * 0.45 : cv.height * 0.88;

      if (s.opts.shadow !== false && !s.opts.silhouette) {
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.ellipse(fx, fy, 9 * k, 3.4 * k, 0, 0, 6.2832); ctx.fill();
      }
      if (s.opts.silhouette) {
        ctx.save();
        ctx.filter = 'brightness(0)';
        ctx.globalAlpha = 0.55;
        s.a.draw(ctx, fx, fy);
        ctx.restore();
      } else {
        s.a.draw(ctx, fx, fy);
      }

      // Recolor (opts.hueSwap = [de, a, nuevo tono]): los píxeles con un tono entre
      // `de` y `a` pasan a `nuevo` (el Kecleon morado de la tienda: sin sprite shiny quieto).
      if (s.opts.hueSwap) hueSwap(ctx, cv, s.opts.hueSwap);

      // Centelleos alrededor de los shiny: cada uno nace en un sitio al azar.
      if (s.opts.shiny && !s.opts.silhouette && s.opts.twinkle !== false) {
        s.tw = s.tw || [];
        s.sparkT -= dt;
        if (s.sparkT <= 0 && s.tw.length < 4) {
          s.sparkT = G.U.rand(0.18, 0.45);
          s.tw.push({ x: fx + G.U.rand(-0.32, 0.32) * cv.width, y: G.U.rand(0.12, 0.7) * cv.height, t: 0, life: G.U.rand(0.5, 0.8) });
        }
        for (let i = s.tw.length - 1; i >= 0; i--) {
          const w = s.tw[i];
          w.t += dt;
          if (w.t >= w.life) { s.tw.splice(i, 1); continue; }
          G.Icons.twinkle(ctx, w.x, w.y, w.t / w.life, Math.max(2, k));
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Cambia el tono de los píxeles entre h0 y h1 (grados) por h2, con su luz y saturación. */
  function hueSwap(ctx, cv, [h0, h1, h2]) {
    const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      if (c < 0.12) continue;                                   // grises: igual
      let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      h = (h * 60 + 360) % 360;
      if (h < h0 || h > h1) continue;
      const l = (mx + mn) / 2, sat = c / (1 - Math.abs(2 * l - 1));
      // HSL -> RGB con el tono nuevo.
      const C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs((h2 / 60) % 2 - 1)), m = l - C / 2;
      const [R, G2, B] = h2 < 60 ? [C, X, 0] : h2 < 120 ? [X, C, 0] : h2 < 180 ? [0, C, X] : h2 < 240 ? [0, X, C] : h2 < 300 ? [X, 0, C] : [C, 0, X];
      d[i] = (R + m) * 255; d[i + 1] = (G2 + m) * 255; d[i + 2] = (B + m) * 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Crea un <canvas> con un sprite animado (para rejillas). */
  function spriteCanvas(dex, w, h, opts) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    sprite(cv, dex, opts);
    return cv;
  }

  return { $, show, hide, hideAll, isOpen, refreshCoins, toast, sprite, spriteCanvas, tick, hueSwap };
})();

;
