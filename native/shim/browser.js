/* browser.js — lo que el juego espera del navegador, para correr en QuickJS en la PS5.
 *
 * - window, document y elementos falsos: la interfaz HTML (menús) no se ve todavía,
 *   pero su código corre sin romperse. Cada elemento acepta lo que le hagan.
 * - <canvas> e Image de verdad, sobre native/canvas.c (canvas.js).
 * - localStorage guardado en un archivo: ROOT/user/<usuario de la PS5>/localStorage.json (ps.USER, el título), o ROOT/localStorage.json.
 * - setTimeout / requestAnimationFrame, que avanza frame() (main.c lo llama cada fotograma).
 * - El DualSense como mando "standard" de la Gamepad API: js/core/gamepad.js funciona tal cual.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  const G_ = globalThis;
  // Lo que puede cada plataforma: ui.js, update.js y esto preguntan por ps.CAN, nunca por el nombre (ps.PLATFORM sólo
  // para enseñarlo). Plataforma nueva: una fila de esta tabla. La web pone la suya en web.js. (El arnés no pone
  // PLATFORM: como la PS5.)
  const P = ps.PLATFORM || 'ps5', is = (...a) => a.includes(P);
  ps.CAN = {
    page: false,                             // es la web misma (Google con su ventana, invitado sin guardar, sin pantalla de carga)
    browser: is('desktop', 'android'),       // hay navegador en el aparato: los enlaces se abren (si no, un QR)
    keyboard: is('desktop'),                 // teclado y ratón de entrada (psKeys; el teclado como otro jugador en el cooperativo)
    touch: is('android'),                    // pensada para el dedo (joystick táctil, ajustes del dedo, toque = elegir y pulsar)
    sysKeyboard: is('android'),              // teclado del sistema para escribir en los campos de ui.js (ps.text_mode)
    filePicker: is('android'),               // selector de archivos del sistema (ps.pick_file); si no, arrastrar a la ventana
    extension: is('desktop'),                // traer la partida de la web con la extensión del navegador (ps.net_inbox)
    resolution: is('desktop', 'android'),    // elegir la resolución en Ajustes (y reabrir: ps.relaunch)
    relaunch: is('desktop', 'android'),      // se puede reabrir solo (actualizaciones al momento); si no, al volver a abrirlo
    consoleAccount: is('ps5', 'switch'),     // la cuenta local es «la cuenta de la consola»
    padApplet: is('switch'),                 // el applet de mandos del sistema (ps.pad_setup)
  };
  const GAME = ps.ROOT + '/game/';
  const SAVE = (ps.DATA || ps.ROOT) + (ps.USER ? '/user/' + ps.USER : '') + '/localStorage.json';   // la partida de cada perfil (main.c; ps.DATA: donde se escribe)
  const noop = () => {};
  // El tamaño que el juego cree que tiene la pantalla (en "píxeles de navegador"). La cámara ajusta sola el
  // trozo de mundo visible; el HUD se dibuja en estos píxeles: con 1280x720 sale 1,5 veces más grande que con
  // 1920x1080 (en una tele, desde el sofá, se veía diminuto). Se dibuja igual a ps.W x ps.H (960x540).
  const LH = 720, LW = Math.round(LH * ps.W / ps.H);   // (1280 en 16:9; más ancho en un móvil: platform/sdl.c)
  G_.psLogical = { w: LW, h: LH };

  G_.window = G_; G_.self = G_; G_.top = G_; G_.parent = G_; G_.globalThis = G_;

  // ---------------- lo que QuickJS no trae ----------------
  // UTF-8 a mano (codec.js del cooperativo y db.js).
  G_.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(str = '') {
      const out = [];
      for (const ch of String(str)) {
        let c = ch.codePointAt(0);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
        else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
        else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      }
      return new Uint8Array(out);
    }
  };
  G_.TextDecoder = class TextDecoder {
    get encoding() { return 'utf-8'; }
    decode(buf) {
      if (!buf) return '';
      const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
      let s = '';
      for (let i = 0; i < b.length;) {
        const c = b[i++];
        let cp = c < 0x80 ? c : c < 0xe0 ? (c & 31) << 6 | b[i++] & 63 : c < 0xf0 ? (c & 15) << 12 | (b[i++] & 63) << 6 | b[i++] & 63
          : (c & 7) << 18 | (b[i++] & 63) << 12 | (b[i++] & 63) << 6 | b[i++] & 63;
        s += String.fromCodePoint(cp);
      }
      return s;
    }
  };
  G_.crypto = { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 0x100000000 >>> 0; return a; },
                randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === 'x' ? 15 : 3 | 8)).toString(16)) };
  // abort() avisa a quien escucha (fetch de net.js lo usa para cortar la petición).
  G_.AbortController = class AbortController {
    constructor() {
      const ls = [];
      this.signal = { aborted: false, reason: undefined, onabort: null,
                      addEventListener: (t, f) => { if (t === 'abort' && f) ls.push(f); },
                      removeEventListener: (t, f) => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
                      throwIfAborted() { if (this.aborted) throw this.reason; }, _ls: ls };
    }
    abort(reason) {
      const sg = this.signal;
      if (sg.aborted) return;
      sg.aborted = true;
      sg.reason = reason === undefined ? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) : reason;
      for (const f of sg._ls.slice()) try { f({ type: 'abort', target: sg }); } catch (e) { console.error(e); }
      if (typeof sg.onabort === 'function') try { sg.onabort({ type: 'abort', target: sg }); } catch (e) { console.error(e); }
    }
  };
  // Base64 (texto latin-1), como en el navegador: Firestore lo usa al leer los documentos.
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  G_.btoa = G_.btoa || (str => {
    str = String(str);
    let out = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i), b = str.charCodeAt(i + 1), c = str.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw Object.assign(new Error('btoa: carácter fuera de latin-1'), { name: 'InvalidCharacterError' });
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < str.length ? B64[n >> 6 & 63] : '=') + (i + 2 < str.length ? B64[n & 63] : '=');
    }
    return out;
  });
  G_.atob = G_.atob || (str => {
    str = String(str).replace(/[\t\n\f\r ]+/g, '');
    if (str.length % 4 === 0) str = str.replace(/==?$/, '');
    if (str.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(str)) throw Object.assign(new Error('atob: base64 no válido'), { name: 'InvalidCharacterError' });
    let out = '', buf = 0, bits = 0;
    for (const ch of str) {
      buf = (buf << 6) | B64.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); }
    }
    return out;
  });
  // Sin IndexedDB de verdad: abrir una base falla al momento (evento error), como en un navegador sin almacenamiento.
  // El SDK de Firebase lo descarta y guarda la sesión en localStorage. (Con indexedDB = undefined lo descartaba igual,
  // pero dejaba 10 «cannot read property 'open'» sin atender en el log a cada arranque.)
  if (!('indexedDB' in G_)) {
    const fail = () => {
      const r = eventTarget({ result: undefined, error: null, readyState: 'pending', onerror: null, onsuccess: null, onupgradeneeded: null });
      setTimeout(() => {
        r.error = Object.assign(new Error('IndexedDB no está disponible en la PS5'), { name: 'UnknownError' });
        r.readyState = 'done';
        r.dispatchEvent(Event('error'));
      }, 0);
      return r;
    };
    G_.indexedDB = { open: fail, deleteDatabase: fail, cmp: () => 0, databases: () => Promise.resolve([]) };
  }
  G_.MutationObserver = class MutationObserver { observe() {} disconnect() {} takeRecords() { return []; } };
  G_.NodeFilter = { SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
  G_.structuredClone = G_.structuredClone || (v => JSON.parse(JSON.stringify(v)));
  ps.load(ps.ROOT + '/shim/intl.js');   // Intl (también lo carga el hilo del suelo, tiles-worker.js)

  // ---------------- consola ----------------
  const fmt = a => a.map(v => {
    if (v instanceof Error) return v.message + '\n' + v.stack;
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }).join(' ');
  const say = (...a) => ps.log(fmt(a));
  G_.console = { log: say, info: say, debug: noop,
                 warn: (...a) => ps.log('[warn] ' + fmt(a)), error: (...a) => ps.log('[error] ' + fmt(a)),
                 trace: noop, table: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop };

  // ---------------- eventos ----------------
  function eventTarget(o) {
    const ls = {};
    o.addEventListener = (t, f) => { if (f) (ls[t] = ls[t] || []).push(f); };
    o.removeEventListener = (t, f) => { if (ls[t]) ls[t] = ls[t].filter(g => g !== f); };
    o.dispatchEvent = ev => {
      ev.target = ev.target || o; ev.currentTarget = o;
      (ls[ev.type] || []).slice().forEach(f => { try { f.call(o, ev); } catch (e) { console.error(e); } });
      const on = o['on' + ev.type];
      if (typeof on === 'function') try { on.call(o, ev); } catch (e) { console.error(e); }
      return !ev.defaultPrevented;
    };
    return o;
  }
  function Event(type, init) {
    return Object.assign({ type, defaultPrevented: false, bubbles: false, preventDefault() { this.defaultPrevented = true; },
                           stopPropagation: noop, stopImmediatePropagation: noop }, init);
  }
  G_.Event = Event; G_.CustomEvent = Event; G_.KeyboardEvent = Event; G_.MouseEvent = Event;
  G_.psEventTarget = eventTarget;   // para net.js (XMLHttpRequest, WebSocket)
  eventTarget(G_);

  // ---------------- temporizadores ----------------
  let timers = [], nextId = 1, rafs = [];
  G_.setTimeout = (f, ms, ...a) => { const id = nextId++; timers.push({ id, f, a, at: ps.now() + (+ms || 0) }); return id; };
  G_.setInterval = (f, ms, ...a) => { const id = nextId++; timers.push({ id, f, a, at: ps.now() + (+ms || 0), every: Math.max(1, +ms || 0) }); return id; };
  G_.clearTimeout = G_.clearInterval = id => { timers = timers.filter(t => t.id !== id); };
  G_.requestAnimationFrame = f => { const id = nextId++; rafs.push({ id, f }); G_.psRafs = (G_.psRafs || 0) + 1; return id; };
  G_.cancelAnimationFrame = id => { rafs = rafs.filter(r => r.id !== id); };
  G_.requestIdleCallback = f => setTimeout(() => f({ timeRemaining: () => 0, didTimeout: true }), 1);
  G_.cancelIdleCallback = clearTimeout;
  G_.queueMicrotask = f => Promise.resolve().then(f);
  G_.performance = { now: () => ps.now(), mark: noop, measure: noop, getEntriesByName: () => [] };

  function runTimers(now) {
    const due = timers.filter(t => t.at <= now);
    for (const t of due) {
      if (t.every) t.at = now + t.every; else timers = timers.filter(x => x !== t);
      try { t.f(...t.a); } catch (e) { console.error(e); }
    }
  }

  // ---------------- elementos falsos ----------------
  // Un objeto que acepta todo: lee undefined en lo que no conoce, salvo lo que la interfaz suele usar.
  function classList(el) {
    const set = new Set();
    return { add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)),
             toggle: (c, on) => { const v = on === undefined ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; },
             contains: c => set.has(c), replace: (a, b) => { set.delete(a); set.add(b); },
             get length() { return set.size; }, toString: () => [...set].join(' ') };
  }
  const byId = {};
  const none = () => [];
  function element(tag, id) {
    const el = eventTarget({
      tagName: String(tag || 'div').toUpperCase(), nodeName: String(tag || 'div').toUpperCase(), nodeType: 1, id: id || '',
      style: new Proxy({ setProperty: noop, removeProperty: noop, getPropertyValue: () => '' }, { set: (o, k, v) => { o[k] = v; return true; } }),
      dataset: new Proxy({}, { get: (o, k) => (k in o ? o[k] : '') }), children: [], childNodes: [], attributes: [], parentNode: null, parentElement: null,
      innerHTML: '', textContent: '', innerText: '', value: '', checked: false, disabled: false, hidden: false, tabIndex: 0,
      className: '', title: '', href: '', src: '', type: '', name: '', placeholder: '', scrollTop: 0, scrollLeft: 0,
      offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, scrollWidth: 0, scrollHeight: 0, offsetTop: 0, offsetLeft: 0,
      firstChild: null, lastChild: null, firstElementChild: null, nextElementSibling: null, previousElementSibling: null, options: [],
      appendChild(c) { this.children.push(c); this.childNodes.push(c); if (c) { c.parentNode = c.parentElement = this; } return c; },
      append(...cs) { cs.forEach(c => typeof c === 'object' && this.appendChild(c)); },
      prepend(...cs) { cs.forEach(c => typeof c === 'object' && this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, insertAdjacentElement(p, c) { return this.appendChild(c); },
      insertAdjacentHTML: noop, insertAdjacentText: noop,
      removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }, replaceChildren() { this.children = []; },
      replaceWith: noop, remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      setAttribute(k, v) { this['@' + k] = String(v); if (k === 'id') { this.id = v; byId[v] = this; } },
      // '' y no null: el código de la interfaz da por hecho que el elemento (y su atributo) existe.
      getAttribute(k) { return this['@' + k] === undefined ? '' : this['@' + k]; },
      hasAttribute(k) { return this['@' + k] !== undefined; }, removeAttribute(k) { delete this['@' + k]; },
      toggleAttribute(k, on) { on = on === undefined ? !this.hasAttribute(k) : on; on ? this.setAttribute(k, '') : this.removeAttribute(k); return on; },
      querySelector: () => element('div'), querySelectorAll: none, getElementsByTagName: none, getElementsByClassName: none,
      closest: () => null, matches: () => false, contains: () => false,
      getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      getClientRects: () => [], focus: noop, blur: noop, click() { this.dispatchEvent(Event('click')); }, select: noop,
      scrollIntoView: noop, scrollTo: noop, scrollBy: noop, animate: () => ({ finished: Promise.resolve(), cancel: noop, onfinish: null }),
      cloneNode() { return element(tag); }, attachShadow() { return element('div'); },
      showModal: noop, show: noop, close: noop, play: () => Promise.resolve(), pause: noop, load: noop, setPointerCapture: noop,
      releasePointerCapture: noop, requestFullscreen: () => Promise.resolve(), getContext: () => null,
    });
    el.classList = classList(el);
    if (id) byId[id] = el;
    return el;
  }

  // ---------------- canvas ----------------
  // Diagnóstico (18-11-2026): la tablet de anfitrión pasó de 170 a 500 MB de lienzos vivos (tras el recolector) en una
  // partida larga. Cada lienzo e imagen apunta quién lo creó; en cada pasada del recolector, [lienzos] dice los MB vivos
  // de cada uno. ponytail: un WeakRef por lienzo y una pila por lienzo nuevo; quitarlo cuando se encuentre la fuga.
  const cvLive = [];
  const cvSite = () => {
    const l = String(new Error().stack || '').split('\n').find(s => /\bat /.test(s) && !/browser\.js|<anonymous>/.test(s));
    return l ? l.trim().replace(/^at /, '').replace(/ \((?:.*[\/\\])?([^\/\\]+:\d+).*$/, ' $1') : '?';
  };
  const cvTrack = (el, site) => { if (typeof WeakRef === 'function') cvLive.push([new WeakRef(el), site]); };
  G_.psCvSites = () => {
    const by = {};
    for (let i = cvLive.length - 1; i >= 0; i--) {
      const el = cvLive[i][0].deref();
      if (!el) { cvLive[i] = cvLive[cvLive.length - 1]; cvLive.pop(); continue; }
      const e = by[cvLive[i][1]] || (by[cvLive[i][1]] = [0, 0]);
      e[0] += (el.width || 0) * (el.height || 0) * 4 / (1 << 20); e[1]++;
    }
    return Object.entries(by).sort((a, b) => b[1][0] - a[1][0]).slice(0, 8)
      .map(([k, [mb, n]]) => k + ' ' + mb.toFixed(0) + ' MB (' + n + ')').join(' · ');
  };
  function canvas(id, screen) {
    const el = element('canvas', id);
    let w = screen ? ps.W : 300, h = screen ? ps.H : 150, ctx = null;
    el._sid = screen ? ps.SCREEN : ps.cv_new(w, h);
    if (!screen && ps.cv_hold) el._hold = ps.cv_hold(el._sid);   // cuando el juego suelta el lienzo, se libera
    if (!screen) cvTrack(el, cvSite());
    const resize = () => {
      if (screen) return;   // la pantalla tiene su tamaño fijo (ps.W x ps.H)
      ps.cv_resize(el._sid, w, h);
      if (ctx) ctx._reset();   // el estado se reinicia, como en el navegador (el mismo contexto: el juego lo guarda)
    };
    Object.defineProperties(el, {
      width: { get: () => w, set: v => { w = Math.max(1, v | 0); resize(); } },
      height: { get: () => h, set: v => { h = Math.max(1, v | 0); resize(); } },
    });
    if (screen) {
      // Lo que mide el juego para decidir la resolución (game.js resize): LW x LH lógicos con
      // devicePixelRatio ps.W / LW = un lienzo de 960x540, el de la pantalla.
      el.clientWidth = LW; el.clientHeight = LH;
      el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: LW, bottom: LH, width: LW, height: LH });
    }
    el.getContext = type => type === '2d' ? (ctx = ctx || new CanvasRenderingContext2D(el)) : null;
    el.toDataURL = () => 'data:,';
    el.toBlob = f => f && f(null);
    return el;
  }

  // ---------------- imágenes ----------------
  // Se cargan (y descomprimen) en cola, con un tope de tiempo por fotograma: el juego precarga a veces 200+
  // hojas de golpe (7 animaciones por especie) y, todas en el mismo fotograma, era casi un segundo parado
  // y el sonido sin aire. Siempre al menos una por fotograma.
  const imgQueue = [];
  // Con ps.cv_load_async (canvas.c), los PNG se leen y descomprimen en otros hilos: aquí sólo se recogen (pollImages, cada
  // fotograma). Sin él (un eboot viejo), en este hilo con imgQueue y un tope de ms por fotograma.
  const imgWait = new Map();   // petición -> quien espera ese lienzo
  const pollImages = () => { if (imgWait.size) for (const [req, id] of ps.cv_load_poll()) { const f = imgWait.get(req); imgWait.delete(req); if (f) f(id); } };
  // Las que esperan algo en pantalla (el cargador de ui.js las espera). psImgBg: las pedidas mientras está a true son de
  // fondo (la precarga de la próxima partida, boot.js) y no hacen esperar al menú.
  let fgPending = 0;
  G_.psImgBg = false;
  G_.psImgsPending = () => fgPending;
  function loadImages(budgetMs) {
    const t0 = ps.now();
    do { const f = imgQueue.shift(); if (f) f(); } while (imgQueue.length && ps.now() - t0 < budgetMs);
  }
  const path = src => {
    src = String(src).split(/[?#]/)[0];
    if (/^[a-z]+:/i.test(src)) return null;   // de internet: aún no
    return GAME + src.replace(/^\.?\//, '');
  };
  G_.Image = function Image(w, h) {
    const img = eventTarget({ width: w || 0, height: h || 0, naturalWidth: 0, naturalHeight: 0, complete: false, _sid: -1,
                              decoding: 'auto', loading: 'eager', crossOrigin: null, alt: '', onload: null, onerror: null,
                              decode() { return this.complete && this._sid >= 0 ? Promise.resolve() : Promise.reject(new Error('decode')); } });
    let src = '';
    Object.defineProperty(img, 'src', {
      get: () => src,
      set: v => {
        src = String(v);
        // La imagen de antes se suelta ya (sprites.js evict: src = ''): el recolector no ve sus píxeles y tardaba.
        if (img._hold && ps.cv_release) { ps.cv_release(img._hold); img._hold = null; img._sid = -1; img.complete = false; img.width = img.height = img.naturalWidth = img.naturalHeight = 0; }
        if (!src) return;
        const p = path(src), mine = src, bg = G_.psImgBg;
        if (!bg) fgPending++;
        let counted = !bg;
        const done = id => {   // el lienzo ya cargado (o -1: no se pudo)
          if (counted) { counted = false; fgPending--; }
          if (id >= 0 && ps.cv_hold) { const h = ps.cv_hold(id); if (src !== mine) return; img._hold = h; }   // (sin dueño, se suelta solo)
          if (src !== mine) return;   // le cambiaron la imagen antes de cargarla
          if (id < 0) { img.complete = true; img.dispatchEvent(Event('error')); return; }
          img._sid = id;
          if (!img._tracked) { img._tracked = true; cvTrack(img, 'img ' + (/^assets\/pokemon\//.test(mine) ? 'pokemon' : mine.split(/[?#]/)[0].split('/').slice(0, 2).join('/'))); }
          const [iw, ih] = ps.cv_size(id);
          img.width = img.naturalWidth = iw; img.height = img.naturalHeight = ih;
          img.complete = true;
          img.dispatchEvent(Event('load'));
        };
        const req = p && ps.cv_load_async ? ps.cv_load_async(p) : -1;
        if (req > 0) { imgWait.set(req, done); return; }
        imgQueue.push(() => {
          if (src !== mine) return done(-1);   // (ya no hace falta; así se descuenta)
          let id = -1;
          try { if (p) id = ps.cv_load(p); } catch (e) { /* no está */ }
          done(id);
        });
      },
    });
    return img;
  };

  // ---------------- document ----------------
  const html = element('html'), head = element('head'), body = element('body');
  const document = eventTarget({
    documentElement: html, head, body, readyState: 'complete', hidden: false, visibilityState: 'visible',
    title: 'PokéSurvivor Classic', cookie: '', referrer: '', activeElement: body, fullscreenElement: null,
    fonts: { load: () => Promise.resolve([]), ready: Promise.resolve(), check: () => true, add: noop },
    // @step native/dom data "UI nativa vs DOM"
    // El DOM web es un stub; ui.js pinta a 960x540 escalado con PS5_TEXTS.
    getElementById(id) {
      if (id === 'game') return byId.game || canvas('game', true);
      if (byId[id]) return byId[id];
      // Como en una página: cuelga de algo (el juego hace p. ej. $('coins').parentElement.title = … al guardar).
      const el = element('div', id);
      if (!el.parentNode) el.parentNode = el.parentElement = body;
      return el;
    },
    createElement: tag => String(tag).toLowerCase() === 'canvas' ? canvas() : element(tag),
    createElementNS: (ns, tag) => element(tag), createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    createDocumentFragment: () => element('fragment'),
    // js/core/locales.js mete así el diccionario del idioma (js/lang/fr.js...): aquí se carga en el acto, como allí.
    write(html) { for (const m of String(html).matchAll(/<script[^>]*src="([^"?]+)/g)) ps.load(GAME + m[1].replace(/^\.?\//, '')); },
        createTreeWalker: root => ({ currentNode: root, nextNode: () => null, firstChild: () => null, parentNode: () => null }),
    querySelector: sel => (/^#[\w-]+$/.test(sel) ? document.getElementById(sel.slice(1)) : element('div')),
    querySelectorAll: none, getElementsByTagName: none, getElementsByClassName: none,
    exitFullscreen: () => Promise.resolve(), hasFocus: () => true, execCommand: () => false,
  });
  G_.document = document;
  G_.HTMLElement = G_.Element = G_.Node = function () {};
  G_.HTMLCanvasElement = function () {};
  G_.getComputedStyle = () => ({ getPropertyValue: () => '', paddingLeft: '0px', paddingTop: '0px' });
  // Android: pantalla táctil (la web pone así G.Settings.touch: joystick, botones del HUD, ajustes del móvil).
  const TOUCHY = ps.CAN.touch;
  G_.matchMedia = q => ({ matches: TOUCHY && /pointer:\s*coarse|hover:\s*none/.test(q), media: q, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop });

  // ---------------- window ----------------
  G_.devicePixelRatio = ps.W / LW;
  G_.innerWidth = LW; G_.innerHeight = LH;
  G_.outerWidth = G_.innerWidth; G_.outerHeight = G_.innerHeight;
  G_.screen = { width: G_.innerWidth, height: G_.innerHeight, availWidth: G_.innerWidth, availHeight: G_.innerHeight,
                orientation: { type: 'landscape-primary', angle: 0, addEventListener: noop } };
  G_.scrollX = G_.scrollY = 0; G_.scrollTo = noop; G_.focus = noop; G_.blur = noop; G_.print = noop;
  // hostname fuera de la lista de db.js: modo local (sin nube) hasta que haya red en la PS5.
  // reload(): volver a empezar el programa (main.c, ps.restart); si no se puede, no pasa nada (como antes).
  const reload = () => { flush(); if (!(ps.restart && ps.restart())) ps.log('[main] recargar: no se pudo reiniciar'); };
  G_.location = { href: 'ps5://pokesurvivor/', origin: 'ps5://pokesurvivor', protocol: 'ps5:', host: 'ps5', hostname: 'ps5',
                  port: '', pathname: '/', search: '', hash: '', reload, assign: noop, replace: noop };
  G_.history = { pushState: noop, replaceState: noop, back: noop, state: null, length: 1 };
  G_.alert = m => ps.log('[alert] ' + m);
  G_.confirm = m => { ps.log('[confirm] ' + m); return false; };
  G_.prompt = () => null;
  G_.open = () => null;
  G_.fetch = () => Promise.reject(new TypeError('sin red en la PS5 (todavía)'));
  G_.XMLHttpRequest = function () { return eventTarget({ open: noop, send() { setTimeout(() => this.dispatchEvent(Event('error')), 0); }, setRequestHeader: noop, abort: noop }); };
  G_.WebSocket = function () { throw new Error('sin red en la PS5 (todavía)'); };
  G_.URLSearchParams = G_.URLSearchParams || function (s) { const m = {}; String(s || '').replace(/^\?/, '').split('&').forEach(p => { if (p) { const [k, v = ''] = p.split('='); m[decodeURIComponent(k)] = decodeURIComponent(v); } });
    return { get: k => (k in m ? m[k] : null), has: k => k in m, set: (k, v) => { m[k] = String(v); }, toString: () => Object.keys(m).map(k => k + '=' + m[k]).join('&') }; };
  // URL: lo justo para el SDK de Firebase (Firestore saca .host de la dirección de cada petición suelta: sin esto,
  // las transacciones fallaban con «unknown» y el ranking no se guardaba). Direcciones absolutas, o relativas a base.
  // ponytail: sin usuario:contraseña ni normalizar «..»; si hace falta más, una implementación completa.
  G_.URL = G_.URL || function URL(url, base) {
    let s = String(url);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      if (base == null) throw new TypeError('URL no válida: ' + s);
      const b = new URL(base);
      s = s.startsWith('//') ? b.protocol + s : s.startsWith('/') ? b.origin + s : b.origin + b.pathname.replace(/[^/]*$/, '') + s;
    }
    const m = /^([a-z][a-z0-9+.-]*:)(?:\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
    if (!m) throw new TypeError('URL no válida: ' + s);
    const host = (m[2] || '').toLowerCase(), port = (/:(\d+)$/.exec(host) || [])[1] || '';
    Object.assign(this, { protocol: m[1].toLowerCase(), host, hostname: host.replace(/:\d+$/, ''), port,
      pathname: m[3] || (m[2] != null ? '/' : ''), search: m[4] && m[4].length > 1 ? m[4] : '', hash: m[5] && m[5].length > 1 ? m[5] : '' });
    this.origin = m[2] != null ? this.protocol + '//' + host : 'null';
    this.href = this.protocol + (m[2] != null ? '//' + host : '') + this.pathname + this.search + this.hash;
    this.searchParams = new G_.URLSearchParams(this.search);
    this.toString = this.toJSON = () => this.href;
  };

  // ---------------- localStorage (en archivo) ----------------
  let store = {};
  try { store = JSON.parse(ps.readFile(SAVE) || '{}') || {}; } catch (e) { console.error('localStorage dañado, se empieza vacío', e); }
  let dirty = false, lastFlush = 0;
  // later: en otro hilo (main.c), sin parar el juego; sin él (salir, recargar), se espera a que esté escrito.
  const flush = later => {
    if (!dirty) return;
    dirty = false;
    const t0 = ps.now(), json = JSON.stringify(store), t1 = ps.now();
    if (!(later && ps.writeFileLater ? ps.writeFileLater : ps.writeFile)(SAVE, json)) console.error('no se pudo guardar ' + SAVE);
    const t2 = ps.now();   // (diagnóstico: ¿es esto el bajón al tocar el volumen en partida?)
    if (t2 - t0 > 8) ps.log('[guardar] localStorage ' + Math.round(json.length / 1024) + ' KB: JSON ' + (t1 - t0).toFixed(1) + ' ms, escribir ' + (t2 - t1).toFixed(1) + ' ms');
  };
  G_.psFlush = () => flush();
  G_.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); dirty = true; },
    removeItem: k => { if (k in store) { delete store[k]; dirty = true; } },
    clear: () => { store = {}; dirty = true; },
    key: i => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  G_.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop, key: () => null, length: 0 };

  // ---------------- teclado y ratón (escritorio: main.c los manda a psInput; la PS5 no los tiene) ----------------
  // La partida los recibe como en la web: keydown/keyup con e.code (WASD/flechas…) y el ratón en píxeles de la ventana.
  // Las pantallas de ui.js (hechas para mando) los ven como mando: flechas/WASD la cruceta, Enter/Espacio ✕,
  // Esc/Retroceso ○, Q/E L1/R1 (kbPad, índices de la distribución standard; readPad los suma a raw).
  const CODE = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Return: 'Enter',
                 'Left Shift': 'ShiftLeft', 'Right Shift': 'ShiftRight', 'Left Ctrl': 'ControlLeft', 'Right Ctrl': 'ControlRight',
                 'Left Alt': 'AltLeft', 'Right Alt': 'AltRight', 'AC Back': 'Escape' };   // (AC Back: «atrás» de Android)
  const domCode = n => CODE[n] || (/^[A-Z]$/.test(n) ? 'Key' + n : /^[0-9]$/.test(n) ? 'Digit' + n : n);   // (SDL_GetScancodeName)
  const domKey = c => c.startsWith('Key') ? c.slice(3).toLowerCase() : c.startsWith('Digit') ? c.slice(5) : c === 'Space' ? ' ' : c;
  const KEY_PAD = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15, KeyW: 12, KeyS: 13, KeyA: 14, KeyD: 15,
                    Enter: 0, Space: 0, Escape: 1, Backspace: 1, KeyZ: 2, KeyR: 3, KeyQ: 4, KeyE: 5, Tab: 9 };   // (△ = R: cambiar las cartas, como la web)
  const kbPad = new Set();
  // Las teclas de kbPad como bits de ps.pad().b (SDL), para lo que lee el mando directamente (shim/core.js: cartas del núcleo).
  G_.psKbBits = () => { let b = 0; for (const bit in SDL_TO_STD) if (kbPad.has(SDL_TO_STD[bit])) b |= 1 << bit; return b; };
  let mouseX = 0, mouseY = 0;
  // psMouse: el ratón para ui.js, en píxeles de dibujo (ps.W x ps.H); ui.js lee y borra click/right/wheel.
  // psKeys: lo último que se tocó fue teclado o ratón (ui.js pinta teclas en vez de botones; readPad lo quita).
  G_.psMouse = { x: 0, y: 0, moved: false, click: 0, right: 0, wheel: 0 };
  G_.psKeys = ps.CAN.keyboard;   // con teclado, de entrada las teclas (hasta que se toque un mando)
  if (TOUCHY) G_.psPadType = 'xbox';         // Android sin mando: los iconos genéricos (se tocan como botones)
  // @step native/events
  G_.psInput = (type, name, n, x, y) => {
    const toGame = !G_.psPadHeld && !G_.psPadRelease;   // con una pantalla de ui.js abierta, el juego no lo ve (como el mando)
    // Ventana sin foco, o ⌘/Win soltada (macOS no manda el keyup de lo que se pulsó con ⌘): todo suelto. Si no, una tecla
    // de kbPad quedaba pulsada para siempre y psPadRelease no se quitaba: el juego dejaba de ver el teclado (atascado).
    if (type === 'blur' || (type === 'keyup' && / GUI$/.test(name))) {
      kbPad.clear(); G_.dispatchEvent(Event('blur', {}));
      if (type === 'blur') return;
    }
    if (type.startsWith('touch')) return touch(type, n, x, y);
    // (en Switch, el ratón es la pantalla táctil: siguen los iconos del mando)
    // (Android: tampoco el ratón ni «atrás», que es del sistema; sólo un teclado de verdad)
    if (type !== 'keyup' && name !== 'AC Back' && !(!ps.CAN.keyboard && type.startsWith('mouse'))) G_.psKeys = true;
    if (type === 'keydown' && name !== 'AC Back') G_.psKbSeen = true;   // (hay teclado, diga lo que diga ps.has_keyboard: ui.js noKb)
    if (type === 'wheel') {
      G_.psMouse.wheel += n / 100;   // (main.c la manda en centésimas de muesca)
      if (toGame) G_.dispatchEvent(Event('wheel', { deltaY: -n, deltaMode: 0, clientX: mouseX, clientY: mouseY, isTrusted: true }));
      return;
    }
    // Un campo de texto de ui.js con el foco (psTextSink): lo escrito y Retroceso/Enter/Esc van a él, no al juego ni al mando.
    // (un campo de los que se escriben directamente, liveField de ui.js: ↑/↓ lo sueltan y siguen moviendo entre filas)
    if (G_.psTextSink && G_.psTextSink.live && type === 'keydown' && (name === 'Up' || name === 'Down')) G_.psTextSink('\n');
    if (G_.psTextSink && type !== 'mousemove' && type !== 'mousedown' && type !== 'mouseup') {
      if (type === 'text') G_.psTextSink(name);
      else if (type === 'keydown' && name === 'Backspace') G_.psTextSink('\b');
      else if (type === 'keydown' && (name === 'Return' || name === 'Escape' || name === 'Tab')) G_.psTextSink('\n');
      return;
    }
    if (type === 'text') return;
    if (type === 'mousemove') Object.assign(G_.psMouse, { x, y, moved: true });
    if (type === 'mousedown') { Object.assign(G_.psMouse, { x, y }); if (n === 3) G_.psMouse.right++; else if (n === 1) G_.psMouse.click++; }
    if (type === 'keydown' || type === 'keyup') {
      const code = domCode(name), k = KEY_PAD[code];
      if (k !== undefined) { if (type === 'keydown') kbPad.add(k); else kbPad.delete(k); }
      // 1-9 (también los del teclado numérico): elegir esa carta, objeto o vínculo en ui.js (como en la web). Sin repetición.
      const dg = /^(?:Digit|Keypad )([1-9])$/.exec(code);
      if (dg && type === 'keydown' && !n) G_.psMouse.num = +dg[1];
      if (dg && type === 'keydown' && !n && G_.psKbSolo) G_.psKbDigit = +dg[1];   // (el teclado como otro jugador: core.js, 1-4 ataque, 5-8 esfera)
      // El teclado como otro jugador (core.js, psKbSolo): al juego (el jugador 1) sólo le llegan mover (G.Input.axis, que lee
      // core.js para el del teclado) y la pausa; sus acciones (Q/E, 1-4, Z, R…) las lee core.js con psKbBits.
      const solo = G_.psKbSolo && type === 'keydown' && !/^(Arrow\w+|Key[WASDP]|Escape)$/.test(code);
      if ((toGame && !solo) || type === 'keyup') G_.dispatchEvent(Event(type, { code, key: domKey(code), repeat: !!n, isTrusted: true }));   // (keyup siempre: que no se quede pulsada)
      return;
    }
    const cx = x * LW / ps.W, cy = y * LH / ps.H;
    const ev = { clientX: cx, clientY: cy, pageX: cx, pageY: cy, offsetX: cx, offsetY: cy, movementX: cx - mouseX, movementY: cy - mouseY,
                 button: n === 3 ? 2 : n === 2 ? 1 : 0, isTrusted: true, pointerType: 'mouse', pointerId: 1 };
    mouseX = cx; mouseY = cy;
    if ((!toGame || (G_.psKbSolo && type === 'mousedown')) && type !== 'mouseup') return;   // (clics del HUD: son del jugador 1)
    G_.dispatchEvent(Event(type, ev));
    if (type !== 'mousemove') G_.dispatchEvent(Event(type === 'mousedown' ? 'pointerdown' : 'pointerup', ev));
    // Y al lienzo del juego (#game), como el navegador: ahí escucha G.Touch los botones del HUD (cambiar de ataque con
    // un clic, usar una esfera, pausa). Sin esto, en el escritorio esos clics no llegaban.
    const cv = G_.document.getElementById('game');
    if (cv && cv.dispatchEvent) cv.dispatchEvent(Event(type === 'mousemove' ? 'pointermove' : type === 'mousedown' ? 'pointerdown' : 'pointerup', ev));
  };

  // ---------------- pantalla táctil (Android: main.c manda cada dedo; n = el dedo) ----------------
  // En partida, al juego como en un móvil: pointerdown/move/up con pointerType 'touch' (G.Touch de la web: joystick flotante,
  // anclado o fijo, apuntar con la mitad derecha, ataques, esferas y pausa del HUD). En las pantallas de ui.js, el primer
  // dedo es el ratón: tocar elige, levantarlo sin arrastrar es un clic y arrastrar desplaza la vista (la rueda). Cada dedo
  // sigue con quien lo cogió (el juego o ui.js) hasta levantarlo: si al tocar la pausa se abre su pantalla, ese dedo no
  // pulsa además lo que quede debajo al soltarlo.
  const fingers = {};
  let uiFinger = null;
  function touch(type, id, x, y) {
    let f = fingers[id];
    if (type === 'touchstart') f = fingers[id] = { game: !G_.psPadHeld && !G_.psPadRelease };
    if (!f) return;
    if (type === 'touchend') delete fingers[id];
    if (f.game) {
      const cx = x * LW / ps.W, cy = y * LH / ps.H;
      // (diagnóstico, «no me puedo mover»: un dedo del juego que se arrastra en partida sin que el joystick lo coja)
      const Gm = G_.G; if (type === 'touchmove' && Gm && Gm.Game && Gm.Game.state === 'playing' && Gm.Touch && !(Gm.Touch.vector() || [0, 0]).some(Boolean)) {
        if (!f.lost) f.lost = ps.now(); else if (f.lost > 0 && ps.now() - f.lost > 1000) { f.lost = -1; console.log('[toque] el dedo ' + id + ' se arrastra en partida y el joystick no lo coge (' + Object.keys(fingers).length + ' dedos)'); }
      } else if (f.lost > 0) f.lost = 0;
      const kind = type === 'touchstart' ? 'pointerdown' : type === 'touchend' ? 'pointerup' : 'pointermove';
      const ev = { clientX: cx, clientY: cy, pageX: cx, pageY: cy, offsetX: cx, offsetY: cy, button: 0,
                   buttons: kind === 'pointerup' ? 0 : 1, isTrusted: true, pointerType: 'touch', pointerId: id + 2 };
      const cv = G_.document.getElementById('game');
      if (cv && cv.dispatchEvent) cv.dispatchEvent(Event(kind, ev));
      G_.dispatchEvent(Event(kind, ev));
      return;
    }
    const m = G_.psMouse, k = 540 / ps.H;   // (ui.js maqueta a 960x540; su rueda, 48 px por muesca)
    if (type === 'touchstart') {
      if (uiFinger != null) return;
      uiFinger = id; f.y0 = f.y = y; f.drag = false;
      Object.assign(m, { x, y });   // (dónde empieza el arrastre: sólo desplaza la lista que hay debajo, ui.js mouseNav)
      // (sin moved: un dedo que se apoya no es «pasar el ratón»; si no, empezar a arrastrar elegía lo que hubiera debajo.
      // Elige el toque al levantarlo sin arrastrar, abajo)
      return;
    }
    if (id !== uiFinger) return;
    if (type === 'touchmove') {
      if (!f.drag && Math.abs(y - f.y0) * k > 10) f.drag = true;
      if (f.drag) { m.wheel += (y - f.y) * k / 48; f.y = y; }   // (el contenido sigue al dedo)
      return;
    }
    uiFinger = null;
    if (!f.drag) { Object.assign(m, { x, y }); m.click++; }
  }
  // El teclado del sistema mientras un campo de ui.js tiene el foco (el buscador de la Pokédex, nombre y contraseña): en
  // Android y en la Steam Deck (la de Steam sólo sin teclado de verdad: !psKeys). Ver ps.text_mode (main.c).
  let typing = false;
  function textMode() {
    if (!(TOUCHY || G_.psPadType === 'steamdeck') || !ps.text_mode || !!G_.psTextSink === typing) return;
    typing = !typing;
    ps.text_mode(typing, !G_.psKeys);
  }

  // ---------------- el DualSense como mando "standard" ----------------
  // Bits de ps.pad().b (SDL_GameControllerButton) -> índices de la distribución standard.
  const SDL_TO_STD = { 0: 0, 1: 1, 2: 2, 3: 3, 9: 4, 10: 5, 4: 8, 6: 9, 7: 10, 8: 11, 11: 12, 12: 13, 13: 14, 14: 15, 5: 16, 15: 17 };
  const btn = () => ({ pressed: false, touched: false, value: 0 });
  const gp = { id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: false,
               mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, btn),
               vibrationActuator: { type: 'dual-rumble',
                 playEffect: (t, p = {}) => { ps.rumble(p.strongMagnitude || 0, p.weakMagnitude || 0, p.duration || 200); return Promise.resolve('complete'); },
                 reset: () => { ps.rumble(0, 0, 0); return Promise.resolve('complete'); } } };
  // raw: el mando tal cual (lo lee ui.js). gp: lo que ve el juego, en reposo si G_.psPadHeld (una pantalla de
  // ui.js abierta): si no, un ○ en un menú también le llegaba al juego como Esc.
  const raw = { buttons: Array(18).fill(false), axes: [0, 0, 0, 0] };
  G_.psPadRaw = () => raw;
  let relT = 0;   // desde cuándo espera psPadRelease (diagnóstico; -1: ya dicho)
  // Un mando que se desconecta en partida (el del J1 o, con el núcleo en C, el de otro jugador): pausa, como en consola.
  // Las mismas condiciones que la pausa del juego al pulsar «atrás» del navegador (G.Game.togglePause, js/app.js).
  let padsOn = 0, lastPadB = 0, lastStick = false;
  function padLost(p) {
    let on = p.b !== undefined ? 1 : 0;
    for (let i = 1; i < 4; i++) if ((ps.pad(i) || {}).b !== undefined) on |= 1 << i;
    const gone = padsOn & ~on, G = G_.G;
    padsOn = on;
    if (!gone || !G || !G.Game || G.Game.state !== 'playing' || (G.Judgment && G.Judgment.cinematic) || G.UI.isOpen('scr-pause')) return;
    console.log('[entrada] mando desconectado en partida (' + gone + '): pausa');
    try { G.Game.togglePause(); } catch (e) { console.error('[entrada] pausa: ' + e.message); }
  }
  function readPad() {
    const p = ps.pad();
    for (const bit in SDL_TO_STD) raw.buttons[SDL_TO_STD[bit]] = !!(p.b & (1 << bit));
    // El teclado, como mando para ui.js (escritorio, psInput). Cooperativo local de ui.js (psKbOwn): 'a', su Enter/Espacio
    // es para entrar como otro jugador; true, ya es otro jugador (nada al J1).
    const own = ps.now() - (G_.psKbOwnT || 0) < 250 && G_.psKbOwn;   // (si la pantalla se cerró por otro lado, no se queda)
    for (const k of kbPad) if (own !== true && !(own && k === 0)) raw.buttons[k] = true;
    raw.buttons[6] = p.l2 > 0.3; raw.buttons[7] = p.r2 > 0.3;
    raw.axes[0] = p.lx || 0; raw.axes[1] = p.ly || 0; raw.axes[2] = p.rx || 0; raw.axes[3] = p.ry || 0;
    // Al cerrarse la pantalla, el juego sigue sin ver el mando hasta soltarlo todo: si no, el Options (o el ✕)
    // que la cerró le llega en el fotograma siguiente como pulsación nueva (y vuelve a pausar, o ataca).
    if (G_.psPadRelease && !raw.buttons.some(Boolean)) { G_.psPadRelease = false; relT = 0; }
    else if (G_.psPadRelease && !relT) relT = ps.now();
    else if (relT > 0 && ps.now() - relT > 3000) {   // (diagnóstico: algo sigue «pulsado» y el juego no ve ni mando ni teclado)
      console.log('[entrada] el juego no ve el mando/teclado desde hace 3 s: pulsados ' + raw.buttons.map((b, i) => (b ? i : -1)).filter(i => i >= 0).join(',') + ' · teclado ' + [...kbPad].join(','));
      relT = -1;
    }
    padLost(p);
    if (p.b === undefined) { gp.connected = false; return; }
    G_.psPadType = p.type || 'ps';   // qué iconos pinta ui.js (main.c, plat_pad_type)
    // Tocó el mando (un botón nuevo o el stick que sale del centro): ui.js vuelve a sus botones. Sólo con un cambio: un botón
    // mantenido mientras se usa el teclado no hace parpadear los iconos entre teclas y botones.
    const stick = Math.abs(p.lx) > 0.5 || Math.abs(p.ly) > 0.5;
    if ((p.b && p.b !== lastPadB) || (stick && !lastStick)) G_.psKeys = false;
    lastPadB = p.b; lastStick = stick;
    if (G_.psPadHeld || G_.psPadRelease) { p.b = 0; p.lx = p.ly = p.rx = p.ry = p.l2 = p.r2 = 0; }
    gp.axes[0] = p.lx; gp.axes[1] = p.ly; gp.axes[2] = p.rx; gp.axes[3] = p.ry;
    gp.buttons.forEach(b => { b.pressed = false; b.value = 0; });
    for (const bit in SDL_TO_STD) if (p.b & (1 << bit)) { const b = gp.buttons[SDL_TO_STD[bit]]; b.pressed = true; b.value = 1; }
    gp.buttons[6].value = p.l2; gp.buttons[6].pressed = p.l2 > 0.3;   // L2 / R2 analógicos
    gp.buttons[7].value = p.r2; gp.buttons[7].pressed = p.r2 > 0.3;
    gp.timestamp = ps.now();
    if (!gp.connected) { gp.connected = true; G_.dispatchEvent(Event('gamepadconnected', { gamepad: gp })); }
  }
  // El idioma de la consola (main.c, system_lang): el juego elige con él (js/core/locales.js), si no se ha cambiado en Ajustes.
  const LANG = ps.LANG || 'es-ES';
  G_.navigator = { userAgent: 'Mozilla/5.0 (PlayStation 5) PokeSurvivorNative', platform: 'PS5', language: LANG,
                   languages: [LANG, LANG.split('-')[0]], onLine: false, maxTouchPoints: TOUCHY ? 5 : 0, hardwareConcurrency: 8, cookieEnabled: false,
                   getGamepads: () => [gp.connected ? gp : null], vibrate: () => false, clipboard: { writeText: () => Promise.reject(new Error('no')) },
                   storage: { persist: () => Promise.resolve(false), estimate: () => Promise.resolve({}) } };

  // ---------------- el bucle (main.c llama a frame cada fotograma) ----------------
  // El recolector de ciclos de QuickJS para el juego unos cientos de ms (main.c, ps.gc): se lanza cuando no
  // molesta (fuera de la partida, en pausa o con las cartas) si ha crecido; en partida, sólo si crece mucho.
  // Cuenta también los píxeles de los lienzos (ps.cv_bytes): el JS apenas crece por cada lienzo que el juego
  // tira, pero sus píxeles siguen ahí hasta que pasa el recolector. Sin esto, en 26 min de partida sólo pasó
  // una vez y el proceso llegó a 1,7 GB (la consola se paraba 3 s).
  let gcBase = 0, cvBase = 0, gcT = 0;
  const MB = 1 << 20;
  function collect(now) {
    if (!ps.gc) return;
    const bytes = ps.jsBytes(), px = ps.cv_bytes ? ps.cv_bytes() : 0, st = G_.G && G.Game ? G.Game.state : 'ui';
    if (!gcBase) { gcBase = bytes; cvBase = px; }
    const calm = st !== 'playing' && st !== 'held', grew = bytes - gcBase + (px - cvBase);
    if ((calm && grew > 16 * MB && now - gcT > 3000) || grew > 160 * MB) {
      ps.gc((calm ? 'sin prisa (' + st + ')' : 'en partida: la memoria creció mucho') + ', lienzos ' + Math.round(px / MB) + ' MB');
      gcBase = ps.jsBytes(); cvBase = ps.cv_bytes ? ps.cv_bytes() : 0; gcT = now;
      const S = G_.G && G.Sprites;
      ps.log('[lienzos] ' + Math.round(cvBase / MB) + ' MB vivos · ' + G_.psCvSites() +
             (S ? ' · hojas ' + S.sheetCount + ' (soltadas en uso ' + S.hotDrops + ')' : ''));
    }
  }
  let beatT = 0, beatN = 0, beatFirst = 0;
  // Diagnóstico del fotograma (latido cada 5 s, [partes], [lento-js]).
  const part = { pad: 0, red: 0, timers: 0, imgs: 0, juego: 0, ui: 0, gc: 0, idle: 0 }, one = {};
  let pt = 0;
  const lap = k => { const t = ps.now(); part[k] += t - pt; one[k] = t - pt; pt = t; };
  // @step native/frame event "frame(now) en JS"
  // Pad, red (psNetPump), timers, imágenes, rAF del juego y psOverlay.
  // @next present
  G_.frame = now => {
    const t0 = ps.now();
    // Cada 5 s, una línea en el log: que se vea que el bucle sigue vivo y a cuánto va.
    beatN++;
    if (now - beatT > 5000) {
      if (beatT) ps.log('[frame] ' + Math.round(beatN * 1000 / (now - beatT)) + ' fps · estado ' + (G_.G && G.Game ? G.Game.state : '?') +
                        (ps.jsBytes ? ' · JS ' + Math.round(ps.jsBytes() / (1 << 20)) + ' MB' : '') +
                        (ps.cv_bytes ? ' · lienzos ' + Math.round(ps.cv_bytes() / (1 << 20)) + ' MB' : '') +
                        (ps.au_stats ? (a => ' · audio ' + a[0] + ' nodos, mezcla máx ' + a[1].toFixed(1) + ' de ' + a[2].toFixed(0) + ' ms')(ps.au_stats()) : ''));
      const js = beatT && G_.psJsProf ? G_.psJsProf(beatN) : (G_.psJsProf && G_.psJsProf(0), '');
      if (js) ps.log(js);
      if (beatN) ps.log('[partes] ' + Object.keys(part).map(k => k + ' ' + (part[k] / beatN).toFixed(1)).join(' · ') + ' ms por fotograma');
      for (const k in part) part[k] = 0;
      beatT = now; beatN = 0;
    }
    pt = ps.now();
    readPad(); textMode(); lap('pad');
    // @step native/frame
    if (G_.psNetPump) G_.psNetPump();   // lo que haya llegado de la red (net.js)
    lap('red');
    runTimers(now); lap('timers');
    pollImages();
    if (imgQueue.length) { const st = G_.G && G.Game ? G.Game.state : 'ui'; loadImages(st === 'playing' || st === 'held' ? 3 : 12); }
    lap('imgs');
    const due = rafs;
    rafs = [];
    for (const r of due) {
      if (beatFirst < 3) ps.log('[frame] rAF ' + beatFirst + ' …');
      try { r.f(now); } catch (e) { console.error(e); }
      if (beatFirst < 3) ps.log('[frame] rAF ' + beatFirst++ + ' hecho');
    }
    lap('juego');
    if (G_.psOverlay) G_.psOverlay(now);   // las pantallas para mando (ui.js), encima del juego
    lap('ui');
    collect(now); lap('gc');
    if (G_.psIdle) G_.psIdle(ps.now() - t0);   // lo que se adelanta si sobra tiempo (boot.js)
    lap('idle');
    // Un fotograma lento: en qué parte, en qué estado del juego (las medias de 5 s lo diluyen).
    const fns = G_.psJsFrame ? G_.psJsFrame() : [];
    if (ps.now() - t0 > 25) ps.log('[lento-js] ' + (G_.G && G.Game ? G.Game.state : '?') + ' · ' +
      Object.keys(one).filter(k => one[k] >= 1).map(k => k + ' ' + one[k].toFixed(0)).join(' · ') + ' ms' +
      (fns.length ? ' (' + fns.map(([k, v]) => k + ' ' + v.toFixed(0)).join(', ') + ')' : ''));
    if (dirty && now - lastFlush > 2000) { lastFlush = now; flush(true); }
  };
})();
