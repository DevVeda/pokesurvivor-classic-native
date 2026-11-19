/* web.js — la web con las mismas pantallas que el resto de versiones (ui.js, dibujadas en un lienzo encima del juego).
 * Hace de plataforma para ui.js («ps»: tamaño, reloj, leer archivos de la web, abrir enlaces) y le pasa el teclado, el
 * ratón, el dedo y el mando del navegador. Mientras ui.js tiene una pantalla abierta, el juego no los ve (como browser.js
 * en las consolas): las teclas se paran aquí, el lienzo de encima coge los clics y el mando no le llega.
 * Orden en index.html: js/env.js → este → js/app.js → qr.js → ui.js. La interfaz HTML de la web se queda oculta.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  // @step server/boot
  // Servidor elegido en Ajustes → Cuenta (localStorage ps.server), mezclado con el del build antes de js/app.js (boot.js).
  window.PS_ENV_DEFAULT = window.PS_ENV || {};
  try {
    const p = JSON.parse(localStorage.getItem('ps.server') || 'null');
    if (p && p.firebase && p.firebase.apiKey && p.firebase.projectId) window.PS_ENV = Object.assign({}, window.PS_ENV_DEFAULT, p, { admins: [] });
  } catch (e) { console.error('[web] ps.server: ' + e.message); }

  // El lienzo de ui.js, del tamaño de la ventana (como mucho 1080 de alto); al cambiar, ui.js se reescala (psResize).
  // (una pestaña cargada en segundo plano puede dar 0 al principio: 16:9 hasta que tenga tamaño)
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // Calidad alta (o auto en ordenador): a la resolución de la pantalla. Si no, 1080 como mucho (más barato), y el
  // navegador lo estira con image-rendering: pixelated (style.css), que en retina/1440p se veía a bloques.
  const cap = () => (window.G && G.Settings && G.Settings.fx >= 2 ? 1e9 : 1080);
  const size = () => { const ih = innerHeight || 720, h = Math.min(cap(), Math.round(ih * dpr)); return [Math.round(h * (innerWidth || 1280) / ih), h]; };
  let [W, H] = size();
  const cv = document.createElement('canvas');
  cv.id = 'ps-ui'; cv.width = W; cv.height = H;
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:60;pointer-events:none;touch-action:none';
  document.body.appendChild(cv);
  window.psUiCanvas = cv;   // ui.js pinta aquí, no en el lienzo del juego
  const css = document.createElement('style');
  // Oculta pero maquetada (no display:none): ui.js pinta lienzos de la web que miden su tamaño, como la escena de la Tienda
  // Kecleon (#shop-scene, getBoundingClientRect). Los descendientes también: alguno se pone visible por su cuenta (.mb-slide.on).
  const HIDE = 'body.psui > :not(#game):not(#ps-ui):not(#rotate):not(script):not(noscript)';
  css.textContent = `${HIDE}, ${HIDE} * { visibility: hidden !important; pointer-events: none !important; }`;
  document.head.appendChild(css);

  const get = p => { const x = new XMLHttpRequest(); try { x.open('GET', p, false); x.send(); return x.status === 200 ? x.responseText : null; } catch (e) { return null; } };
  window.ps = {
    W, H, GPU: true, PLATFORM: 'web', ROOT: '', LANG: navigator.language,
    now: () => performance.now(), log: (...a) => console.log(...a),
    // ui.js lee archivos del juego (VERSION, news.json, index.html, version.json): aquí, los de la web. No escribe nada.
    readFile: p => (String(p).startsWith('/game/') ? get(p.slice(6)) : null),
    writeFile: () => false,
    open_url: u => { const w = window.open(u, '_blank'); if (w) w.opener = null; return !!w; },
  };
  // Lo que puede la web (la tabla de las demás, en browser.js).
  const coarse = matchMedia('(pointer: coarse)').matches;
  ps.CAN = { page: true, browser: true, keyboard: !coarse, touch: coarse, sysKeyboard: false, filePicker: false, extension: false,
             resolution: false, relaunch: false, consoleAccount: false, padApplet: false };
  // Pantalla completa (el botón de la barra de arriba de ui.js, como el #btn-full de la web vieja). En el móvil, además se
  // intenta fijar en horizontal. iPhone: Safari no deja; abriéndolo desde «Añadir a pantalla de inicio», sí (el aviso).
  const canFull = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => !!navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  ps.fullOk = () => canFull() || (isIOS && !standalone());
  ps.full = () => {
    if (!canFull()) {
      if (window.G) G.UI.toast(G.T('En iPhone, Safari no deja poner las webs a pantalla completa. Pulsa Compartir y luego "Añadir a pantalla de inicio": abriendo el juego desde ese icono se juega a pantalla completa.'), 9000);
      return;
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const el = document.documentElement, p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* nada */ } }).catch(() => {});
  };
  // La web es la del servidor: la cuenta online siempre (sin conexión = invitado, Cloud.set de ui.js).
  window.psCloudOn = true;

  // ---------------- entrada ----------------
  // Las pantallas de ui.js leen un mando «standard» (psPadRaw): el de verdad más el teclado (como KEY_PAD de browser.js).
  const KEY_PAD = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15, KeyW: 12, KeyS: 13, KeyA: 14, KeyD: 15,
                    Enter: 0, Space: 0, NumpadEnter: 0, Escape: 1, Backspace: 1, KeyZ: 2, KeyR: 3, KeyQ: 4, KeyE: 5, Tab: 9 };
  const kb = new Set(), taps = new Set(), raw = { buttons: Array(18).fill(false), axes: [0, 0, 0, 0] };
  const mouse = window.psMouse = { x: 0, y: 0, moved: false, click: 0, right: 0, wheel: 0 };
  window.psKeys = !matchMedia('(pointer: coarse)').matches;   // teclas (ordenador) hasta que se toque un mando
  window.psPadRaw = () => raw;
  window.psLogical = { get w() { return innerWidth; }, get h() { return innerHeight; } };   // (el HUD del juego, en píxeles CSS)
  const uiOwns = () => !!(window.psPadHeld || window.psPadRelease);

  // En captura y antes que el juego (este archivo va antes de js/app.js): con una pantalla de ui.js, la tecla no le llega.
  addEventListener('keydown', e => {
    const sink = window.psTextSink;   // un campo de texto de ui.js con el foco: lo escrito va a él
    if (sink) {
      if (sink.live && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) sink('\n');   // (sale del campo y sigue moviendo)
      else {
        if (e.key === 'Backspace') sink('\b');
        else if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') sink('\n');
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) sink(e.key);
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
    }
    window.psKeys = true;
    const k = KEY_PAD[e.code];
    // (taps: una pulsación y suelta en el mismo fotograma también cuenta. raw, ya: si esta tecla le llega al juego y abre una
    // pantalla de ui.js —Esc pausa—, ésta la ve como ya pulsada y no como una nueva; si no, el mismo Esc cerraba la pausa)
    if (k !== undefined) { kb.add(k); taps.add(k); raw.buttons[k] = true; }
    const dg = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);   // 1-9: esa carta, objeto o vínculo
    if (dg && !e.repeat) mouse.num = +dg[1];
    if (uiOwns()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    // El teclado como otro jugador (core.js, psKbSolo): al juego (el J1) sólo le llegan mover (core.js lo lee para el del
    // teclado) y la pausa; sus acciones (Q/E, Z, R, 1-8) las lee core.js (psKbBits, psKbDigit). Como browser.js.
    if (window.psKbSolo && !/^(Arrow\w+|Key[WASDP]|Escape)$/.test(e.code)) {
      if (dg && !e.repeat) window.psKbDigit = +dg[1];
      e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  addEventListener('keyup', e => { const k = KEY_PAD[e.code]; if (k !== undefined) kb.delete(k); }, true);   // (al juego también: que no se quede pulsada)
  addEventListener('blur', () => { kb.clear(); taps.clear(); });

  // Ratón y dedo sobre el lienzo de ui.js (sólo coge eventos con una pantalla abierta: pointer-events, en frame).
  // El dedo, como en Android (browser.js): tocar y soltar sin arrastrar es un clic; arrastrar desplaza la vista.
  const at = e => [e.clientX * W / innerWidth, e.clientY * H / innerHeight];
  let drag = null;
  cv.addEventListener('pointermove', e => {
    const [x, y] = at(e);
    if (e.pointerType === 'mouse') { window.psKeys = true; Object.assign(mouse, { x, y, moved: true }); return; }
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on && Math.abs(y - drag.y0) * 540 / H > 10) drag.on = true;
    if (drag.on) { mouse.wheel += (y - drag.y) * 540 / H / 48; drag.y = y; }
  });
  cv.addEventListener('pointerdown', e => {
    const [x, y] = at(e);
    Object.assign(mouse, { x, y });
    if (e.pointerType !== 'mouse') { if (!drag) drag = { id: e.pointerId, y0: y, y, on: false }; return; }
    window.psKeys = true;
    if (e.button === 2) mouse.right++; else if (e.button === 0) mouse.click++;
  });
  cv.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) { const [x, y] = at(e); Object.assign(mouse, { x, y }); mouse.click++; }
    drag = null;
  });
  cv.addEventListener('pointercancel', () => { drag = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); mouse.wheel -= e.deltaY / (e.deltaMode ? 3 : 100); }, { passive: false });   // (en muescas; hacia arriba, +)
  cv.addEventListener('contextmenu', e => e.preventDefault());

  // ---------------- mandos y cooperativo local: las reglas de main.c (p_added, p_poll, p_removed, js_core_kb) ----------------
  // El primer mando es el J1. Los siguientes esperan su confirmar (✕/A; en Nintendo la A, a la derecha) y entran en la
  // primera plaza libre (J2-J4); al desconectarse la sueltan (en partida, pausa). El teclado: con el J1 si no tiene mando;
  // si lo tiene, Enter/Espacio en partida o en la sala de ui.js lo mete como otro jugador (ps.core_kb). El dedo, siempre J1.
  // ponytail: las mismas reglas que main.c, escritas otra vez aquí; si cambian, en los dos sitios.
  const getPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  const typeOf = id => (/054c|playstation|dualsense|dualshock/i.test(id) ? 'ps' : /057e|nintendo|pro controller|joy-con/i.test(id) ? 'nintendo'
    : /28de|steam/i.test(id) ? 'steamdeck' : 'xbox');
  // Nintendo: confirmar es la A (derecha) y volver la B (abajo). Aquí se cambian, una vez para todo el JS (ui.js, core.js
  // y el juego), como js_pad de main.c en las demás: el botón 0 es siempre «confirmar».
  const buttonsOf = g => (typeOf(g.id) === 'nintendo' ? [g.buttons[1], g.buttons[0], ...[...g.buttons].slice(2)] : g.buttons);
  const view = g => (g && typeOf(g.id) === 'nintendo'
    ? { id: g.id, index: g.index, connected: g.connected, mapping: g.mapping, timestamp: g.timestamp, axes: g.axes,
        buttons: buttonsOf(g), vibrationActuator: g.vibrationActuator }
    : g);
  const slots = [null, null, null, null], waiting = new Set();   // el Gamepad.index de cada jugador; los que esperan
  let kbSlot = 0;                                                // la plaza del teclado (0: con el J1)
  const live = () => { const m = new Map(); for (const g of getPads()) if (g && g.connected && g.mapping === 'standard') m.set(g.index, g); return m; };
  const padOf = i => { if (slots[i] === null) return null; for (const g of getPads()) if (g && g.connected && g.index === slots[i]) return g; return null; };
  function pollPads() {
    const m = live();
    let lost = 0;
    for (let i = 0; i < 4; i++) if (slots[i] !== null && !m.has(slots[i])) {
      console.log('[p' + (i + 1) + '] mando desconectado'); slots[i] = null; lost++;
      if (!i && kbSlot) { console.log('[p1] el teclado vuelve al jugador 1'); kbSlot = 0; }
    }
    for (const w of [...waiting]) if (!m.has(w)) waiting.delete(w);
    for (const [idx, g] of m) {
      if (slots.includes(idx)) continue;
      if (!waiting.has(idx)) {
        if (slots[0] === null) { slots[0] = idx; console.log('[p1] mando: ' + g.id); continue; }
        waiting.add(idx); console.log('[local] mando nuevo (' + g.id + '), en espera de confirmar');
      }
      const ok = buttonsOf(g)[0];
      if (!ok || !ok.pressed) continue;
      let me = 1;
      while (me < 4 && (slots[me] !== null || me === kbSlot)) me++;
      if (me < 4) { slots[me] = idx; waiting.delete(idx); console.log('[p' + (me + 1) + '] confirma: entra el jugador ' + (me + 1)); }
    }
    // Mando desconectado en partida: pausa (como padLost de browser.js; gamepad.js de la web no lo hace).
    if (lost && window.G && G.Game.state === 'playing' && !(G.Judgment && G.Judgment.cinematic) && !G.UI.isOpen('scr-pause')) {
      try { G.Game.togglePause(); } catch (e) { console.error('[web] pausa: ' + e.message); }
    }
  }
  // El juego (gamepad.js, G.Pad) sólo ve el mando del J1, y nada con una pantalla de ui.js abierta.
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => (uiOwns() || !padOf(0) ? [] : [view(padOf(0))]) });
  // ps.core_pads() / ps.core_kb(unirse | -1) / ps.pad(i) / ps.rumble(…, i): lo mismo que main.c (lo leen core.js y ui.js).
  ps.core_pads = () => slots.reduce((b, s, i) => (s !== null ? b | 1 << i : b), 1) | 1 << kbSlot;
  ps.core_kb = (a = 0) => {
    if (kbSlot && a < 0) { console.log('[p1] el teclado vuelve al jugador 1'); kbSlot = 0; }
    if (!kbSlot && slots[0] !== null && a > 0) {
      let me = 1;
      while (me < 4 && slots[me] !== null) me++;
      if (me < 4) { kbSlot = me; console.log('[p' + (me + 1) + '] Enter en el teclado: entra el jugador ' + (me + 1)); }
    }
    return kbSlot;
  };
  const STD_TO_SDL = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 9, 5: 10, 8: 4, 9: 6, 10: 7, 11: 8, 12: 11, 13: 12, 14: 13, 15: 14, 16: 5, 17: 15 };
  ps.pad = (i = 0) => {
    const g = padOf(i);
    if (!g) return {};
    const t = typeOf(g.id);
    let b = 0;
    buttonsOf(g).forEach((x, k) => { const s = STD_TO_SDL[k]; if (x.pressed && s !== undefined) b |= 1 << s; });
    return { b, lx: g.axes[0] || 0, ly: g.axes[1] || 0, rx: g.axes[2] || 0, ry: g.axes[3] || 0,
             l2: g.buttons[6] ? g.buttons[6].value : 0, r2: g.buttons[7] ? g.buttons[7].value : 0, type: t };
  };
  ps.rumble = (lo, hi, ms, i = 0) => {
    const g = padOf(i), a = g && g.vibrationActuator;
    if (a && a.playEffect) a.playEffect('dual-rumble', { duration: ms, weakMagnitude: Math.min(1, hi), strongMagnitude: Math.min(1, lo) }).catch(() => {});
  };
  // Las teclas como botones de SDL, para el teclado como otro jugador (core.js; la sala de ui.js).
  window.psKbBits = () => { let b = 0; for (const k of kb) if (STD_TO_SDL[k] !== undefined) b |= 1 << STD_TO_SDL[k]; return b; };

  // ui.js lee el mando del J1 más el teclado (salvo si el teclado es de otro jugador: psKbOwn, la sala de ui.js).
  let lastB = '', lastStick = false;
  function readPad() {
    pollPads();
    raw.buttons.fill(false); raw.axes.fill(0);
    const p = padOf(0);
    if (p) {
      const t = typeOf(p.id);
      buttonsOf(p).forEach((b, i) => { if (i < 18) raw.buttons[i] = b.pressed; });
      for (let i = 0; i < 4; i++) raw.axes[i] = p.axes[i] || 0;
      window.psPadType = t;
      // Tocó el mando (un botón nuevo o el stick que sale del centro): iconos de mando en vez de teclas.
      const b = raw.buttons.map(Number).join(''), stick = Math.abs(raw.axes[0]) > 0.5 || Math.abs(raw.axes[1]) > 0.5;
      if ((b !== lastB && raw.buttons.some(Boolean)) || (stick && !lastStick)) window.psKeys = false;
      lastB = b; lastStick = stick;
    }
    const own = performance.now() - (window.psKbOwnT || 0) < 250 && window.psKbOwn;   // (como browser.js)
    for (const k of kb) if (own !== true && !(own && k === 0)) raw.buttons[k] = true;
    for (const k of taps) if (own !== true && !(own && k === 0)) raw.buttons[k] = true;
    taps.clear();
  }

  const ctx = cv.getContext('2d');
  function frame(t) {
    requestAnimationFrame(frame);
    const [w, h] = size();
    if (w !== W || h !== H) { W = cv.width = ps.W = w; H = cv.height = ps.H = h; window.psResize(); }
    readPad();
    // Al cerrarse una pantalla, el juego sigue sin ver nada hasta soltarlo todo (si no, el ✕ que la cerró le llegaba).
    if (window.psPadRelease && !raw.buttons.some(Boolean)) window.psPadRelease = false;
    cv.style.pointerEvents = window.psPadHeld ? 'auto' : 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    try { window.psOverlay(t); } catch (e) { console.error('[web] ui.js:', e); }
  }

  // Con trucos (ui.js, psDevOn) la partida, el ranking y el perfil no salen a la nube, como net.js en las demás versiones:
  // se corta en la escritura misma de Firestore, por la ruta.
  const DEV_OUT = /^(saves|runs|lb|lbs|profiles)(\/|$)/;
  function devGuard(fs) {
    const blocks = ref => !!(window.psDevOn && window.psDevOn() && ref && DEV_OUT.test(String(ref.path || '')));
    const guard = (C, names, refOf, skipped) => C && C.prototype && names.forEach(k => {
      const f = C.prototype[k];
      if (typeof f !== 'function' || f._psDev) return;
      C.prototype[k] = function (...a) { return blocks(refOf(this, a)) ? skipped(this) : f.apply(this, a); };
      C.prototype[k]._psDev = true;
    });
    guard(fs.DocumentReference, ['set', 'update', 'delete'], self => self, () => Promise.resolve());
    guard(fs.CollectionReference, ['add'], self => self, self => Promise.resolve(self.doc()));
    guard(fs.Transaction, ['set', 'update', 'delete'], (self, a) => a[0], self => self);
    guard(fs.WriteBatch, ['set', 'update', 'delete'], (self, a) => a[0], self => self);
  }

  // Suelo por adelantado (el adelanto de boot.js en las nativas, sin hilos: en V8 generar un trozo cuesta ~0,2 ms, pero
  // pintarlo 2-10 ms, más en un móvil): en los ratos libres del navegador se pintan los trozos de alrededor del jugador
  // (caché de world.js), para no pintarlos de golpe en el fotograma en que se cruza un borde.
  const RING = [];
  for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) RING.push([dx, dy]);
  const noCtx = { set imageSmoothingEnabled(v) {}, globalAlpha: 1, drawImage() {} };
  const idle = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 6 }), 100));   // (Safari viejo)
  let ringAt = '', ringI = 0;
  function prepaint(dl) {
    const pl = G.Game && G.Game.player, Wd = G.World;
    if (pl && Wd && Wd.CW && G.Game.state !== 'ui') {
      const pcx = Math.floor(pl.x / Wd.CW), pcy = Math.floor(pl.y / Wd.CW), here = pcx + ',' + pcy;
      if (here !== ringAt) { ringAt = here; ringI = 0; }
      while (ringI < RING.length && dl.timeRemaining() > 4) {
        const x = (pcx + RING[ringI][0] + 0.5) * Wd.CW, y = (pcy + RING[ringI][1] + 0.5) * Wd.CW;
        ringI++;
        try { Wd.drawGround(noCtx, { w: 1, h: 1, left: () => x, top: () => y }); } catch (e) { /* nada */ }
      }
    }
    idle(prepaint, { timeout: 1000 });
  }

  // Antes que el arranque de la web (main.js, también en DOMContentLoaded): ya están G y ui.js.
  addEventListener('DOMContentLoaded', () => {
    if (!window.G || !window.psOverlay) { css.remove(); cv.remove(); return console.error('[web] sin ui.js: queda la interfaz HTML'); }
    document.body.classList.add('psui');
    G.UI.hideAll();
    // El navegador no deja sonar hasta el primer clic o tecla (ui.js quita la pantalla «Pulsa para empezar» de la web).
    const unlock = () => { G.Audio.unlock(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); };
    addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
    const t = setInterval(() => { const fs = window.firebase && window.firebase.firestore; if (fs && fs.DocumentReference) { clearInterval(t); devGuard(fs); } }, 500);
    requestAnimationFrame(frame);
    idle(prepaint, { timeout: 1000 });
  });
})();
