// node native/shim/web.test.cjs — prueba de la entrada del cooperativo local de web.js (mandos falsos): J1, espera, confirmar, Nintendo, teclado, desconexión.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const L = {}, on = (t, f) => { (L[t] = L[t] || []).push(f); };
const el = () => ({ style: {}, classList: { add() {} }, getContext: () => ({ setTransform() {}, clearRect() {} }), appendChild() {}, addEventListener() {}, remove() {} });
let pads = [];
const mk = (index, id = 'Xbox Controller') => ({ index, id, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
let frame, paused = 0;
const ctx = { console: { log() {}, error: console.error }, performance, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  navigator: { getGamepads: () => pads.slice(), language: 'es' }, matchMedia: () => ({ matches: false }), addEventListener: on,
  removeEventListener() {}, requestAnimationFrame: f => { frame = f; }, requestIdleCallback: () => 0, localStorage: { getItem: () => null }, setInterval: () => 0,
  document: { createElement: el, body: el(), head: el() }, XMLHttpRequest: function () {} };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, 'web.js'), 'utf8'), ctx);
ctx.G = { UI: { hideAll() {}, isOpen: () => false }, Audio: { unlock() {} }, Game: { state: 'playing', togglePause() { paused++; } }, Judgment: {} };
ctx.psOverlay = () => {}; ctx.psResize = () => {};
L.DOMContentLoaded.forEach(f => f());
const ps = ctx.ps, tick = () => frame(0), key = (t, code) => L[t].forEach(f => f({ code, key: code, repeat: false, preventDefault() {}, stopImmediatePropagation() {} }));
const a = mk(0), b = mk(1), n = mk(2, 'Nintendo Switch Pro Controller');
// Sin mando: el teclado es el J1, Enter no lo separa.
tick(); assert.equal(ps.core_pads(), 1); assert.equal(ps.core_kb(1), 0);
// El primero es el J1 sin más; el segundo espera su ✕.
pads = [a, b]; tick(); assert.equal(ps.core_pads(), 1); assert.equal(ps.pad(1).b, undefined);
b.buttons[0].pressed = true; tick(); assert.equal(ps.core_pads(), 0b11); assert.equal(ps.pad(1).b, 1); b.buttons[0].pressed = false;
// El juego (G.Pad) sólo ve el del J1.
assert.deepEqual(ctx.navigator.getGamepads().map(g => g.index), [0]);
// Nintendo: confirmar es la A (derecha, botón 1); el de abajo no entra.
pads = [a, b, n]; n.buttons[0].pressed = true; tick(); assert.equal(ps.core_pads(), 0b11);
n.buttons[0].pressed = false; n.buttons[1].pressed = true; tick(); assert.equal(ps.core_pads(), 0b111); assert.equal(ps.pad(2).b, 1);   // (al JS: bit 0 = confirmar)
n.buttons[1].pressed = false;
// Teclado como J4 (con mando en el J1), sus teclas como bits de SDL; y vuelve al J1 con -1.
assert.equal(ps.core_kb(1), 3); assert.equal(ps.core_pads(), 0b1111);
key('keydown', 'Enter'); key('keydown', 'ArrowLeft'); assert.equal(ctx.psKbBits(), 1 | 1 << 13); key('keyup', 'Enter'); key('keyup', 'ArrowLeft');
assert.equal(ps.core_kb(-1), 0);
// Desconectar uno en partida: suelta su plaza y pausa; el del J1: el teclado vuelve al J1.
ps.core_kb(1); pads = [a, n]; tick(); assert.equal(paused, 1); assert.equal(ps.core_pads() & 0b10, 0);
pads = [n]; tick(); assert.equal(ps.core_kb(0), 0);
// Un Nintendo de J1: la A (derecha) es el botón 0 para todos (ui.js: psPadRaw; el juego: getGamepads; ps.pad).
pads = []; tick(); const n1 = mk(5, 'Pro Controller (057e)'); pads = [n1]; tick();
n1.buttons[1].pressed = true; tick();
assert.equal(ctx.navigator.getGamepads()[0].buttons[0].pressed, true); assert.equal(ctx.psPadRaw().buttons[0], true); assert.equal(ps.pad(0).b, 1);
n1.buttons[1].pressed = false;
console.log('web.js: entrada del cooperativo local bien');
