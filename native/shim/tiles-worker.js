/* tiles-worker.js — el JS del hilo del suelo (native/tiles_worker.c).
 * Carga las fuentes del suelo (no todo el juego) con un navegador de mentira que no lo deja arrancar, y
 * usa sólo lo que pinta el suelo (G.U, G.Tiles, G.World), con un canvas mínimo (tiles.js sólo usa createImageData /
 * putImageData). Con la misma semilla y la misma arena que el juego, el mismo suelo.
 *   psPaint(cx, cy, bioma) -> { width, height, data }     psState(json): { seed, arena }
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
globalThis.window = globalThis;
const canvas = () => {
  const cv = { width: 0, height: 0, _img: null };
  cv.getContext = () => ({ canvas: cv, createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
                           putImageData(img) { cv._img = img; } });
  return cv;
};
// Lo que el juego toca al cargarse; readyState 'loading' + addEventListener que no hace nada = nunca arranca (main.js).
const nop = () => {}, el = () => ({ style: {}, classList: { add: nop, remove: nop, toggle: nop, contains: () => false }, appendChild: nop, addEventListener: nop, querySelector: () => null, querySelectorAll: () => [], setAttribute: nop, getContext: () => null });
globalThis.document = { readyState: 'loading', createElement: t => (t === 'canvas' ? canvas() : el()), getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [], addEventListener: nop, documentElement: el(), body: el(), head: el() };
globalThis.addEventListener = globalThis.removeEventListener = nop;
globalThis.location = { hostname: 'localhost', protocol: 'file:', href: '', search: '', hash: '', origin: '' };
globalThis.navigator = { userAgent: '', language: 'es', languages: ['es'] };
globalThis.localStorage = globalThis.sessionStorage = { getItem: () => null, setItem: nop, removeItem: nop };
globalThis.matchMedia = () => ({ matches: false, addEventListener: nop });
globalThis.setTimeout = globalThis.setInterval = () => 0; globalThis.clearTimeout = globalThis.clearInterval = nop;
globalThis.requestAnimationFrame = () => 0; globalThis.performance = { now: () => 0 };
ps.load(ps.ROOT + '/shim/intl.js');   // la fecha (Halloween…) como en el hilo del juego
globalThis.TextEncoder = globalThis.TextDecoder = globalThis.URL = globalThis.URLSearchParams = globalThis.EventTarget = globalThis.Event = class {};
globalThis.Image = globalThis.Audio = function () { return el(); };
globalThis.CanvasRenderingContext2D = globalThis.HTMLCanvasElement = globalThis.HTMLElement = function () {};
globalThis.console = { log: s => ps.log(String(s)), warn: s => ps.log(String(s)), error: s => ps.log(String(s)), info: nop, debug: nop };

// Las fuentes del juego, sueltas (orden: js/files.js). Aquí sólo las del suelo (ONLY), no los 2 MB del juego en cada hilo;
// core-js.cjs (PS_ALL) las carga todas.
ps.load(ps.ROOT + '/game/js/files.js');
// (comparado con el juego entero: el mismo psGen y psPaint en 300 trozos, con biomas, Halloween y arena; carga 8× más rápido)
const ONLY = ['core/util', 'core/sprites', 'systems/halloween', 'game/tiles', 'game/world'].map(f => `js/${f}.js`);
if (globalThis.PS_ALL) ps.load(ps.ROOT + '/game/js/core/locales.js');   // (window.PS_LOCALES, que el juego lee al cargarse)
for (const f of PS_FILES) if (globalThis.PS_ALL || ONLY.includes(f)) ps.load(ps.ROOT + '/game/' + f);

// El trozo (cx, cy) tal como lo pide drawGround: con una cámara de 1 px en su centro, se pide sólo ése.
globalThis.psPaint = (cx, cy, bi) => {
  G.World.setBiome(bi, true);
  let got = null;
  const ctx = { set imageSmoothingEnabled(v) {}, globalAlpha: 1, drawImage(img) { got = got || img; } };
  const CW = G.World.CW, x = cx * CW + CW / 2, y = cy * CW + CW / 2;
  G.World.drawGround(ctx, { w: 1, h: 1, left: () => x, top: () => y });
  return got._img;
};

// Halloween, el que diga el hilo del juego (bioma + 100: boot.js). Aquí no hay red para la hora del servidor, y del
// Halloween depende el terreno (calabazas).
let hw = false;
for (const k of ['on', 'inRun']) Object.defineProperty(G.Halloween, k, { get: () => hw, configurable: true });

// Generar un trozo de terreno (tw_gen) y devolverlo en JSON (los Uint8Array y Map, a mano; en los Map, las props por su
// índice en props, para que sigan siendo las mismas): el juego lo recoge (boot.js) en vez de generarlo él.
globalThis.psGen = (cx, cy, bi) => {
  if (!globalThis.psChunks) return null;
  hw = bi >= 100; if (hw) bi -= 100;
  G.World.setBiome(bi, true);
  const c = psChunks.gen(cx, cy), idx = new Map((c.props || []).map((p, i) => [p, i])), o = {};
  for (const k of Object.keys(c)) {
    const v = c[k];
    o[k] = v instanceof Uint8Array ? { __u8: Array.from(v) } : v instanceof Map ? { __map: [...v].map(([a, b]) => [a, idx.has(b) ? { __p: idx.get(b) } : b]) } : v;
  }
  return JSON.stringify(o);
};

globalThis.psState = json => {
  const s = JSON.parse(json);
  G.World.reset(s.seed);
  if (s.arena) G.World.setArena(s.arena);
};
