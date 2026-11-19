// node native/shim/updater.test.cjs — G.Updater (js/core/updater.js) en una versión nativa: offer() y cuándo aplicar (partida, pantalla encima, menú subiendo antes a la nube, PS5/Switch sin reabrir). Relojes falsos.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
let now = 0, timers = [];
const at = (f, ms, rep) => { timers.push({ f, t: now + ms, ms, rep }); return timers.length; };
const advance = ms => { const end = now + ms; for (;;) { timers.sort((a, b) => a.t - b.t); const x = timers[0]; if (!x || x.t > end) break; now = x.t; if (x.rep) x.t += x.ms; else timers.shift(); x.f(); } now = end; };
let applied = 0, toasts = [], menu = true, sync = 'ok';
const ctx = { console, Date: { now: () => now }, setTimeout: (f, ms) => at(f, ms, false), setInterval: (f, ms) => at(f, ms, true), clearInterval() {},
  Promise, sessionStorage: { setItem() {} }, ps: { CAN: { page: false } }, psAtMenu: () => menu, document: {},
  G: { Game: { state: 'ui' }, UI: { toast: m => toasts.push(m) }, DB: { get syncState() { return sync; }, flush: async () => { sync = 'ok'; } } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../../js/core/updater.js'), 'utf8'), ctx);
const U = ctx.G.Updater;
(async () => {
  // En partida: no se toca.
  ctx.G.Game.state = 'playing'; U.offer({ apply: () => applied++ }); advance(20000); await null; assert.equal(applied, 0);
  // Gacha encima del menú: tampoco.
  ctx.G.Game.state = 'ui'; menu = false; advance(20000); await null; assert.equal(applied, 0);
  // En el menú, con algo por subir: sube y reabre.
  menu = true; sync = 'pending'; advance(20000); for (let i = 0; i < 5; i++) await null; assert.equal(applied, 1); assert.equal(sync, 'ok');
  // PS5/Switch (sin apply): sólo el aviso, una vez.
  toasts = []; U.offer({ apply: null }); advance(20000); assert.equal(toasts.filter(t => /volver a abrir/.test(t)).length, 1);
  console.log('updater: bien');
})().catch(e => { console.error(e); process.exit(1); });
