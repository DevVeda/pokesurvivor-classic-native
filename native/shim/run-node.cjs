// Prueba en el Mac: carga el juego con los shims como en la PS5, pero en Node y sin dibujar.
// Uso: node native/shim/run-node.cjs [segundos]   (sale con código 1 si hubo errores de JS)
// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const secs = +process.argv[2] || 5;
// Siempre como la primera vez (PS_KEEP=1: con las miniaturas guardadas de la vez anterior, como al volver a abrir).
for (const f of (() => { try { return fs.readdirSync(path.join(REPO, 'native/.node-root')); } catch (e) { return []; } })())
  if (!(process.env.PS_KEEP && /^thumbs\./.test(f))) fs.rmSync(path.join(REPO, 'native/.node-root', f), { recursive: true, force: true });
const errors = [];
let t0 = Date.now(), surfaces = [[960, 540]];

// ROOT de la PS5 -> este repositorio (shim/ en native/shim, game/ en la raíz).
const real = p => p.replace('/ROOT/shim/', path.join(REPO, 'native/shim') + '/').replace('/ROOT/game/', REPO + '/')
  .replace('/ROOT/vendor/', path.join(REPO, 'native/vendor') + '/')
  .replace('/ROOT/', path.join(REPO, 'native/.node-root/'));
const out = console.log.bind(console);   // los shims reemplazan console
const notify = s => { out('[notify] ' + s); };
const log = s => { if (/\[error\]/.test(s)) errors.push(s); out(s); };   // los avisos (warn) no cuentan

global.ps = {
  ROOT: '/ROOT', W: 960, H: 540, SCREEN: 0, PAD: 'node', LANG: process.env.PS_LANG || 'es-ES',
  PLATFORM: process.env.PS_PLATFORM,   // (PS_PLATFORM=android: el táctil; sin él, como la PS5)
  now: () => Date.now() - t0, log, notify,
  load: p => vm.runInThisContext(fs.readFileSync(real(p), 'utf8'), { filename: real(p) }),
  // PS_LS='{"clave":"valor"}': el localStorage con el que arranca (sin red no se guarda en ningún archivo).
  readFile: (p, bin) => { if (p === '/ROOT/localStorage.json' && process.env.PS_LS) return process.env.PS_LS;
    try { if (!bin) return fs.readFileSync(real(p), 'utf8'); const b = fs.readFileSync(real(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } catch (e) { return null; } },
  writeFile: (p, s) => { fs.mkdirSync(path.dirname(real(p)), { recursive: true }); fs.writeFileSync(real(p), s instanceof ArrayBuffer ? Buffer.from(s) : s); return true; },
  pad: () => ({ b: global.padB || 0, lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 }), rumble() {}, presentMs: () => [0, 0],
  cv_new: (w, h) => surfaces.push([w, h]) - 1,
  cv_resize: (id, w, h) => { surfaces[id] = [w, h]; },
  cv_load: p => { if (!fs.existsSync(real(p))) throw new Error('no existe ' + p); return surfaces.push([32, 32]) - 1; },
  cv_size: id => surfaces[id] || [0, 0],
  cv_color: () => true, cv_measure: (id, t) => t.length * 6,
  cv_getImageData: (id, x, y, w, h) => new ArrayBuffer(w * h * 4),
};
// Audio: nodos de mentira (un objeto por asa) y el reloj que avanza.
let auN = 0;
Object.assign(ps, { gc: () => {}, jsBytes: () => process.memoryUsage().heapUsed, AUDIO_RATE: 48000, au_node: () => ({ n: auN++ }), au_time: () => ps.now() / 1000, au_value: () => 0, au_stats: () => [auN, 0, 21] });
ps.cv_hold = id => ({ id });
for (const f of ['tw_paint', 'tw_arena', 'au_connect', 'au_disconnect', 'au_param', 'au_set', 'au_buffer']) ps[f] = () => {};
// Las imágenes cargadas «en otro hilo» (cv_load_async): aquí, al pedirlas, y se entregan en el siguiente fotograma.
// PS_SYNC_IMG=1: sin él (cv_load en el hilo del juego, como un eboot viejo).
if (!process.env.PS_SYNC_IMG) {
  let next = 1, ready = [];
  ps.cv_load_async = p => { const req = next++; let id = -1; try { id = ps.cv_load(p); } catch (e) { /* no está */ } ready.push([req, id]); return req; };
  ps.cv_load_poll = () => { const r = ready; ready = []; return r; };
}
// Los trozos de terreno generados en el hilo del suelo (tw_gen): aquí, tiles-worker.js en otro contexto de vm con su propio
// juego (como en la consola), unos pocos por fotograma. PS_NO_GEN=1: sin él (el terreno, en el hilo del juego).
if (!process.env.PS_NO_GEN) {
  let wk = null, wSeed = 0; const jobs = [];
  ps.tw_gen = (cx, cy, bi, seed) => { jobs.push([cx, cy, bi, seed]); };
  ps.tw_gen_poll = () => {
    if (!jobs.length) return [];
    if (!wk) {
      wk = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
      wk.ps = { ROOT: '/ROOT', log() {}, readFile: p => { try { return fs.readFileSync(real(p), 'utf8'); } catch (e) { return null; } },
                load: p => vm.runInContext(fs.readFileSync(real(p), 'utf8'), wk, { filename: real(p) }) };
      vm.runInContext("ps.load('/ROOT/shim/tiles-worker.js')", wk);
    }
    const out = [];
    for (const [cx, cy, bi, seed] of jobs.splice(0, 1)) {   // (uno por fotograma: aquí corre en el hilo del juego)
      if (seed !== wSeed) { wSeed = seed; wk.psState(JSON.stringify({ seed, arena: null })); }
      out.push([seed, cx, cy, wk.psGen(cx, cy, bi)]);
    }
    return out;
  };
}
for (const f of ['cv_save', 'cv_restore', 'cv_setTransform', 'cv_transform', 'cv_translate', 'cv_scale', 'cv_rotate', 'cv_set',
                 'cv_gradient', 'cv_dash', 'cv_path', 'cv_paint', 'cv_font', 'cv_text', 'cv_draw', 'cv_putImageData'])
  ps[f] = () => {};

// PS_NET=1: red de verdad (HTTPS con Node) detrás de ps.net_*, como net.c en la PS5, y la nube encendida
// (ps5.cloud): para probar el login y Firebase en el Mac. Sin WebSocket (el login no lo usa).
if (process.env.PS_NET) {
  const https = require('https'), evq = [], reqs = new Map();
  Object.assign(ps, {
    net_request(id, method, url, headers, body) {
      const h = {};
      for (const line of String(headers).split('\n')) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i)] = line.slice(i + 1).trim(); }
      out('[net] ' + method + ' ' + url.slice(0, 110));
      const rq = https.request(url, { method, headers: h }, res => {
        evq.push(['head', id, res.statusCode, Object.entries(res.headers).map(([k, v]) => k + ': ' + v).join('\r\n'), url]);
        res.setEncoding('utf8');
        res.on('data', d => evq.push(['data', id, d]));
        res.on('end', () => { out('[net] ' + res.statusCode + ' ' + url.slice(0, 80)); evq.push(['done', id]); });
      });
      rq.on('error', e => { out('[net] error ' + e.message); evq.push(['err', id, e.message]); });
      if (body != null) rq.write(typeof body === 'string' ? body : Buffer.from(body));
      rq.end(); reqs.set(id, rq);
      return true;
    },
    net_abort: id => { const r = reqs.get(id); if (r) r.destroy(); },
    net_ws_open: () => false, net_ws_send: () => false, net_ws_close() {},
    net_poll: () => evq.splice(0),
  });
  fs.mkdirSync(path.join(REPO, 'native/.node-root'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'native/.node-root/localStorage.json'), JSON.stringify({ 'ps5.cloud': '1' }));
  // Node tiene `process`: el SDK de Firebase se creería en Node (sin sesión guardada). En la PS5 no lo hay.
  globalThis.__FIREBASE_DEFAULTS__ = { forceEnvironment: 'browser' };
}
process.on('unhandledRejection', e => { errors.push(String(e && e.stack || e)); out('[promesa] ' + (e && e.stack || e)); });
// Lo que QuickJS no trae se quita, para que los shims lo tengan que poner (si no, en la PS5 falla y aquí no).
const tick_ = setImmediate, setTimeout_ = setTimeout;
const realIntl = Intl;
for (const k of ['TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'crypto', 'Intl',
                 'structuredClone', 'atob', 'btoa', 'Blob', 'fetch', 'Headers', 'Request', 'Response', 'MessageChannel',
                 'BroadcastChannel', 'EventTarget', 'Event', 'queueMicrotask', 'navigator', 'WebSocket', 'File', 'FormData'])
  try { delete globalThis[k]; } catch (e) {}
// Node trae sus propios setTimeout/performance: los shims los reemplazan, como en QuickJS.
// PS_CORE=1: el núcleo en C (shim/core.js) de verdad: native/build/core-test (make -C native build/core-test) responde a
// ps.core_* por dos FIFO, línea a línea (como core_js.c en la PS5).
// PS_CORE=wasm: el mismo núcleo, compilado para la web (shim/core.wasm, core-web.js).
if (process.env.PS_CORE === 'wasm') {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'core-web.js'), 'utf8'), { filename: 'core-web.js' });
  const m = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname, 'core.wasm'))),
                                     { env: { emscripten_notify_memory_growth: () => {} } });
  m.exports._initialize();
  psCoreWasm(m.exports, ps);
} else if (process.env.PS_CORE) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'core-')), fin = path.join(dir, 'in'), fout = path.join(dir, 'out');
  require('child_process').execFileSync('mkfifo', [fin, fout]);
  const ch = require('child_process').spawn('sh', ['-c', 'exec "$0" < "$1" > "$2"', path.join(REPO, 'native/build/core-test'), fin, fout], { stdio: 'inherit' });
  ch.unref();
  const wfd = fs.openSync(fin, 'w'), rfd = fs.openSync(fout, 'r'), rb = Buffer.alloc(1 << 20);
  let acc = '';
  const call = line => {
    fs.writeSync(wfd, line + '\n');
    while (!acc.includes('\n')) { const n = fs.readSync(rfd, rb, 0, rb.length, null); if (!n) throw new Error('core-test se cerró'); acc += rb.toString('utf8', 0, n); }
    const i = acc.indexOf('\n'), r = acc.slice(0, i); acc = acc.slice(i + 1); return r;
  };
  const cmd = name => (...a) => call(name + ' ' + a.map(Number).join(' '));
  Object.assign(ps, { core_reset: cmd('creset'), core_input: cmd('cinput'), core_view: cmd('cview'), core_step: cmd('cstep'),
    core_player: (...a) => +cmd('cplayer')(...a), core_enemy: (...a) => { while (a.length < 19) a.push(0); return +cmd('cenemy')(...a); },
    core_biome: cmd('cbiome'), core_ppos: cmd('cppos'), core_php: cmd('cphp'), core_god: cmd('cgod'), core_eset: cmd('ceset'),
    core_stash: () => call('cstash'), core_restore: () => call('crestore'), core_clear: cmd('cclear'), core_pullall: () => call('cpullall'), core_props: (...a) => { const l = call('cprops ' + a.join(' ')); return new Float64Array(l ? l.split(' ').map(Number) : []).buffer; },
    core_free: (x, y, r) => call(`free ${x} ${y} ${r} 1`) === '1', core_arena: cmd('carena'), core_mode: cmd('cmode'), core_slots: (i, lay, a) => call(`cslots ${i} ${lay} ${a}`) === '1', core_hazard: (...a) => { while (a.length < 13) a.push(0); return +cmd('chazard')(...a); },
    core_active: cmd('cactive'), core_learn: (i, id, lv, ev) => call(`clearn ${i} ${id} ${lv} ${+!!ev}`) === '1',
    core_movelvl: (i, id, lv, ev) => call(`cmovelvl ${i} ${id} ${lv} ${+!!ev}`) === '1',
    core_stats: (...a) => { while (a.length < 11) a.push(0); return cmd('cstats')(...a); },
    core_state: () => new Float64Array(call('cstate').split(' ').map(Number)).buffer,
    core_events: () => { const l = call('cevents'); return new Float64Array(l ? l.split(' ').map(Number) : []).buffer; },
    core_ability: (i, id, t) => call(`cability ${i} ${id || '-'} ${t}`), core_item: cmd('citem'),
    core_orb: (...a) => call('corb ' + a.join(' ')) === '1', core_weather: cmd('cweather'), core_drop: cmd('cdrop'),
    CORE_PL: 38, CORE_EN: 17, CORE_HZ: 13, CORE_PR: 10, CORE_FI: 9, CORE_PU: 6 });
}
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'boot.js'), 'utf8'), { filename: 'boot.js' });
// El URL de browser.js (QuickJS no trae): lo que usa el SDK de Firebase.
{
  const assert = require('assert'), u = new URL('https://Firestore.googleapis.com:443/v1/a:commit?x=1#h');
  assert.deepEqual([u.protocol, u.host, u.hostname, u.port, u.pathname, u.search, u.hash, u.origin],
    ['https:', 'firestore.googleapis.com:443', 'firestore.googleapis.com', '443', '/v1/a:commit', '?x=1', '#h', 'https://firestore.googleapis.com:443']);
  assert.equal(new URL('b/c', 'https://x.test/a/z').href, 'https://x.test/a/b/c');
  assert.equal(new URL('/v', 'https://x.test/a').href, 'https://x.test/v');
  assert.equal(new URL('chrome-extension://abc').hostname, 'abc');
  assert.throws(() => new URL('sin-esquema'));
  // El Intl de browser.js (QuickJS no trae) con las opciones de halloween.js, shop.js y ranking.js: igual que el de verdad.
  for (const o of [{ month: '2-digit', day: '2-digit' }, { year: 'numeric' }, { year: 'numeric', month: '2-digit', day: '2-digit' },
                   { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }]) {
    const o2 = Object.assign({ timeZone: 'Europe/Madrid' }, o), mine = new Intl.DateTimeFormat('en-CA', o2), ref = new realIntl.DateTimeFormat('en-CA', o2);
    for (const t of [Date.UTC(2026, 9, 24, 23, 30), Date.UTC(2026, 9, 25, 0, 59), Date.UTC(2026, 9, 25, 1, 0), Date.UTC(2026, 9, 29, 23, 0),
                     Date.UTC(2026, 10, 1, 22, 59), Date.UTC(2026, 10, 1, 23, 0), Date.UTC(2027, 2, 28, 0, 59), Date.UTC(2027, 2, 28, 1, 0)]) {
      const parts = f => f.formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => x.type + '=' + x.value).join(' ');
      assert.equal(parts(mine), parts(ref), JSON.stringify(o) + ' ' + new Date(t).toISOString());
    }
    assert.equal(+mine.format(Date.UTC(2026, 5, 1)) || mine.format(Date.UTC(2026, 5, 1)), +ref.format(Date.UTC(2026, 5, 1)) || ref.format(Date.UTC(2026, 5, 1)));
  }
  // El QR (shim/qr.js; leído con el lector de QR del navegador al escribirlo): versión según lo largo, o null si no cabe.
  assert.equal(psQR('ko-fi.com/jpter78').size, 21);
  assert.equal(psQR('https://www.youtube.com/@example').size, 25);
  assert.equal(psQR('x'.repeat(107)), null);
}

const end = Date.now() + secs * 1000;
// PS_FSREAD=colección/doc (con PS_NET=1): a los 4 s, una lectura de Firestore (lo que fallaba en la PS5 sin atob).
if (process.env.PS_FSREAD) setTimeout_(async () => {
  const t = Date.now();
  try {
    const snap = await G.DB.fb.fs.doc(process.env.PS_FSREAD).get();
    out('[fs] ' + process.env.PS_FSREAD + ' en ' + (Date.now() - t) + ' ms: ' + (snap.exists ? 'existe, ' + JSON.stringify(snap.data()).slice(0, 120) : 'no existe'));
  } catch (e) { out('[fs] error: ' + (e.code || '') + ' ' + e.message); }
}, 4000);
// PS_EVAL_AT=archivo.js: se ejecuta con el juego ya en marcha (a los 2 s), no al final como PS_EVAL.
if (process.env.PS_EVAL_AT) setTimeout_(() => { global.out = out; global.later = setTimeout_; try { vm.runInThisContext(fs.readFileSync(process.env.PS_EVAL_AT, 'utf8')); } catch (e) { out('[eval] ' + e.stack); } }, 2000);
// PS_LOGIN=nombre:contraseña (con PS_NET=1): a los 4 s, G.DB.login como la pantalla de entrar, y qué devuelve.
if (process.env.PS_LOGIN) setTimeout_(async () => {
  const [n, p] = process.env.PS_LOGIN.split(':');
  out('[login] modo ' + G.DB.mode + (G.DB.localReason ? ' (' + G.DB.localReason + ')' : '') + ': entrando como ' + n + '…');
  const t = Date.now();
  try { const r = await G.DB.login(n, p); out('[login] en ' + (Date.now() - t) + ' ms: ' + JSON.stringify(r)); }
  catch (e) { out('[login] excepción: ' + (e && e.stack || e)); }
}, 4000);
// node run-node.cjs N ui: recorre las pantallas para mando (ui.js) con pulsaciones simuladas del mando,
// como un jugador: menú -> Jugar -> cartas -> objeto -> pausa -> abandonar -> resumen -> menú -> Jugar.
if (process.argv[3] === 'ui') {
  const B = { x: 1 << 0, o: 1 << 1, s: 1 << 2, right: 1 << 14, left: 1 << 13, r1: 1 << 10, down: 1 << 12, up: 1 << 11, opt: 1 << 6 };   // bits de SDL: ✕, ○, cruceta abajo, Options
  global.psMenuRemember = false;   // los pasos cuentan las bajadas desde Jugar
  const tap = bit => { global.padB = bit; setTimeout_(() => { global.padB = 0; }, 80); };
  const expect = (what, ok) => { out('[ui] ' + what + ': ' + (ok ? 'bien' : 'MAL (estado ' + G.Game.state + ')')); if (!ok) errors.push(what); };
  const steps = [
    [3500, () => expect('la primera vez, el test de personalidad (sin compañero)', G.Game.state === 'ui' && !G.DB.save.partner)],
    // Las 8 preguntas (la primera respuesta) y "¡Vamos juntos!" con el que sale.
    [200, () => { for (let i = 0; i < 9; i++) setTimeout_(() => tap(B.x), i * 200); }],
    [2000, () => expect('con el inicial elegido, al menú', !!G.DB.save.partner && G.DB.owns(G.DB.save.partner))],
    // Mejoras: bajar tres (Jugar, Endless, Pokémon, Mejoras), entrar, comprar la primera (Vitalidad) y volver.
    [200, () => tap(B.down)], [200, () => tap(B.down)], [200, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => { global.coins0 = G.DB.save.coins; tap(B.x); }],
    [300, () => expect('Mejoras: comprar Vitalidad', (G.DB.upgradesOf(G.DB.save.partner).hp || 0) === 1 && G.DB.save.coins === coins0 - G.Upgrades.cost('hp', 0))],
    [200, () => tap(B.o)],
    // Gacha: 10 tickets, bajar siete (Jugar, Endless, Pokémon, Mejoras, Multijugador, Tienda, Mochila, Gacha), tirar ×10, saltar, terminar y volver.
    [300, () => { G.DB.save.tickets.t1 = 10; global.owned0 = Object.keys(G.DB.save.owned).length; for (let i = 0; i < 7; i++) setTimeout_(() => tap(B.down), i * 150); }],
    [1100, () => tap(B.x)],
    [300, () => tap(B.x)],
    [300, () => expect('Gacha ×10: gasta los tickets y da Pokémon', G.DB.save.tickets.t1 < 10 && Object.keys(G.DB.save.owned).length > owned0)],
    [200, () => tap(B.x)], [1500, () => tap(B.x)], [300, () => tap(B.x)],
    [300, () => tap(B.o)],
    [300, () => expect('del gacha al menú', G.Game.state === 'ui')],
    // Colección: bajar dos (Endless, Pokémon), la ficha del compañero, marcarlo favorito (compañero, Mejorar, favorito), volver dos veces.
    [200, () => tap(B.down)], [200, () => tap(B.down)],
    [700, () => tap(B.x)], [300, () => tap(B.x)],
    [300, () => tap(B.down)], [200, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => expect('Colección → ficha → favorito', G.DB.isFav(G.DB.save.partner))],
    // □ abre los filtros: Favoritos (fila «Sólo», el 2º: ↓ →) y ○ a la rejilla, que dice cuántos salen.
    [200, () => tap(B.o)], [300, () => tap(B.s)],
    [300, () => tap(B.down)], [200, () => tap(B.right)], [200, () => tap(B.x)],
    [300, () => { const ft = CanvasRenderingContext2D.prototype.fillText; global.dexN = '';
                  CanvasRenderingContext2D.prototype.fillText = function (t) { if (/^\d+ Pokémon$/.test(t)) dexN = t; return ft.apply(this, arguments); };
                  global.unspy = () => { CanvasRenderingContext2D.prototype.fillText = ft; }; tap(B.o); }],
    [400, () => { unspy(); expect('Colección: filtro Favoritos', dexN === G.DEX.filter(p => G.DB.isFav(p.dex) && G.SPRITE_META[p.dex]).length + ' Pokémon'); }],
    // Y se quita: □, Favoritos otra vez, ○.
    [200, () => tap(B.s)], [300, () => tap(B.down)], [200, () => tap(B.right)], [200, () => tap(B.x)], [200, () => tap(B.o)],
    [300, () => tap(B.o)],
    // Tienda: bajar cinco, comprar una Menta, ver la Bolsa y volver.
    [300, () => { G.DB.save.coins += 5000; global.mint0 = G.Shop.count('mint'); for (let i = 0; i < 5; i++) setTimeout_(() => tap(B.down), i * 150); }],
    [900, () => tap(B.x)], [300, () => tap(B.x)],
    [300, () => expect('Tienda: comprar Menta', G.Shop.count('mint') === mint0 + 1)],
    [200, () => tap(B.s)], [300, () => tap(B.o)], [300, () => tap(B.o)],
    // Ficha → Mejorar Pokémon: abre Mejoras de ese Pokémon; □ abre la Pokédex para cambiarlo, ✕ vuelve con el elegido
    // (aquí el mismo); ○ vuelve a la ficha.
    [300, () => { global.nat0 = G.Mons.natureOf(G.DB.save.partner).id; global.coins3 = G.DB.save.coins; tap(B.down); setTimeout_(() => tap(B.down), 200); }],
    [900, () => tap(B.x)], [300, () => tap(B.x)],
    [300, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => { tap(B.x); }],   // en Mejoras, comprar la primera: se gasta en el Pokémon de la ficha
    [300, () => expect('Ficha → Mejorar Pokémon → Mejoras', (G.DB.upgradesOf(G.DB.save.partner).hp || 0) === 2 && G.DB.save.coins < coins3)],
    [200, () => tap(B.s)], [700, () => tap(B.x)],   // □ Pokédex en modo elegir, ✕ el que tiene el cursor
    [300, () => { global.coins3 = G.DB.save.coins; tap(B.x); }],
    [300, () => expect('Mejoras → □ Pokédex → ✕ vuelve a Mejoras', G.DB.save.coins < coins3)],
    [200, () => tap(B.o)],   // ○ a la ficha
    // Usar la Menta desde la ficha: bajar tres (compañero, Mejorar, favorito), Menta, otra naturaleza.
    [300, () => tap(B.down)], [200, () => tap(B.down)], [200, () => tap(B.down)], [200, () => tap(B.x)],
    // En la rejilla de naturalezas (2 columnas): ↓ es la 3ª, o la 5ª si la 3ª ya es la suya (si no, no cambia nada).
    [300, () => { tap(B.down); if (G.NATURES[2].id === nat0) setTimeout_(() => tap(B.down), 200); }], [450, () => tap(B.x)],
    [300, () => expect('Menta: cambia la naturaleza y se gasta', G.Mons.natureOf(G.DB.save.partner).id !== nat0 && G.Shop.count('mint') === mint0)],
    [200, () => tap(B.o)], [300, () => tap(B.o)], [300, () => tap(B.o)],
    [300, () => expect('de la colección al menú', G.Game.state === 'ui')],
    // Ajustes → Trucos: el primero avisa (no se guarda nada); cada uno lo suyo; al apagarlos todos, la partida de antes.
    [300, () => { global.own0 = Object.keys(G.DB.save.owned).length; global.coins1 = G.DB.save.coins; for (let i = 0; i < 10; i++) setTimeout_(() => tap(B.down), i * 150); }],
    [1500, () => tap(B.x)],
    [300, () => { for (let i = 0; i < 5; i++) setTimeout_(() => tap(B.r1), i * 150); }],   // Sonido … Cuenta, Trucos
    [950, () => tap(B.x)],
    [300, () => expect('Trucos: primero el aviso (sin encender)', Object.keys(G.DB.save.owned).length === own0)],
    [100, () => tap(B.left)], [200, () => tap(B.x)],   // «Activar»
    [300, () => expect('Trucos: todos los Pokémon (sin mejoras)', Object.keys(G.DB.save.owned).length > 900 && (G.DB.upgradesOf(1).hp || 0) < G.Upgrades.BY.hp.max)],
    [100, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => expect('Trucos: todos los shiny', Object.keys(G.DB.save.shiny).length > 500)],
    [100, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => expect('Trucos: mejoras al máximo', G.DB.upgradesOf(1).hp === G.Upgrades.BY.hp.max && G.DB.save.coins === coins1)],
    [100, () => tap(B.x)], [200, () => tap(B.up)], [200, () => tap(B.x)], [200, () => tap(B.up)], [200, () => tap(B.x)],
    [300, () => expect('Trucos apagados: vuelve la partida de antes', Object.keys(G.DB.save.owned).length === own0 && G.DB.save.coins === coins1 && (G.DB.upgradesOf(1).hp || 0) < G.Upgrades.BY.hp.max && !psDevOn())],
    [200, () => tap(B.o)],
    [300, () => expect('de ajustes al menú', G.Game.state === 'ui')],
    // Misiones: una diaria cumplida, bajar ocho (… Gacha, Misiones), recoger el premio y volver.
    [300, () => { G.Progress.ensure(G.DB.save); const m = G.DB.save.missions.daily[0]; m.prog = m.goal; global.coins2 = G.DB.save.coins; global.t2 = G.DB.save.tickets.t1;
                  for (let i = 0; i < 8; i++) setTimeout_(() => tap(B.down), i * 150); }],
    [1300, () => tap(B.x)], [400, () => tap(B.x)],
    [300, () => expect('Misiones: recoger el premio', G.DB.save.missions.daily[0].claimed && (G.DB.save.coins > coins2 || G.DB.save.tickets.t1 > t2))],
    [200, () => tap(B.o)],
    [300, () => expect('de misiones al menú', G.Game.state === 'ui')],
    // Ajustes → Acerca de → Aviso legal: el texto sale de dev.html (se mira lo que llega a fillText).
    [300, () => {
      global.drawn = [];
      const P = Object.getPrototypeOf(document.getElementById('game').getContext('2d')), ft = P.fillText;
      if (!P._spy) { P._spy = true; P.fillText = function (t, ...r) { if (global.drawn) global.drawn.push(String(t)); return ft.call(this, t, ...r); }; }
      for (let i = 0; i < 10; i++) setTimeout_(() => tap(B.down), i * 150);   // Ajustes
    }],
    [1500, () => tap(B.x)],
    // Ajustes recuerda la pestaña: venimos de Desarrollador y la siguiente es Acerca de.
    [300, () => tap(B.r1)],
    [900, () => { for (let i = 0; i < 8; i++) setTimeout_(() => tap(B.down), i * 150); }],   // (Acerca de: 8 filas antes del botón, Versión y Build incluidas)
    [1000, () => { global.drawn = []; tap(B.x); }],
    [400, () => { const t = drawn.join(' | '); out('[legal] ' + t.slice(0, 160)); expect('aviso legal: el texto de index.html', /Nintendo/.test(t) && drawn.length > 12); global.drawn = null; }],
    [200, () => tap(B.o)], [300, () => tap(B.o)],
    [300, () => expect('del aviso legal al menú', G.Game.state === 'ui')],
    // Cooperativo (sala, amigos y red de mentira): en una sala, Jugar abre la sala; invitar a Leo; empezar
    // manda 'start' a todos y arranca la partida en grupo. Luego una invitación encima del menú: Unirme.
    [300, () => {
      const S = G.Social, descs = [];
      const def = (o, k, v) => { descs.push([o, k, Object.getOwnPropertyDescriptor(o, k)]); Object.defineProperty(o, k, { get: () => v(), configurable: true }); };
      global.co = { descs, invited: null, sent: null, started: null, accepted: null, saved: { inv: S.invite, acc: S.acceptInvite, ref: S.refreshMember,
        ens: S.ensureFriends, open: S.setOpen, start: S.start, mode: G.Net.mode, bc: G.Net.broadcast, run: G.Game.startRun } };
      co.room = { id: 'r1', host: 'yo', isHost: true, members: [{ uid: 'yo', name: 'Yo', dex: G.DB.save.partner }, { uid: 'ana', name: 'Ana', dex: 4 }] };
      def(S, 'room', () => co.room); def(S, 'uid', () => 'yo'); def(S, 'started', () => true);
      def(S, 'friends', () => [{ uid: 'leo', name: 'Leo', status: 'ok' }]); def(S, 'invites', () => co.invites || []);
      def(G.DB, 'online', () => true);
      Object.assign(S, { invite: async u => { co.invited = u; return { ok: true, msg: 'Invitación enviada a Leo' }; }, refreshMember() {}, ensureFriends: async () => {},
        setOpen() {}, start: async () => 'ok', acceptInvite: async f => { co.accepted = f; co.invites = []; return { ok: true }; } });
      G.Net.mode = () => 'direct'; G.Net.broadcast = m => { co.sent = m; };
      G.Game.startRun = cfg => { co.started = cfg; };
      tap(B.x);
    }],
    [400, () => tap(B.x)],
    [300, () => expect('sala: invitar a un amigo', co.invited === 'leo')],
    [200, () => tap(B.down)], [200, () => tap(B.x)],
    [300, () => expect('sala: empezar manda la partida a todos', co.sent && co.sent.k === 'start' && co.started === co.sent && co.started.members.length === 2)],
    [10, () => expect('sala: con Halloween y el turbo del anfitrión', 'hw' in co.sent && co.sent.turbo === psTurbo())],
    // Otra partida (G.Again): con alguien aún en el resumen, cuenta atrás para todos; pulsar otra vez empieza ya.
    [10, () => {
      let n = 0; G.Again.ended(['yo', 'ana']); G.Again.start(() => n++);
      expect('otra partida: alguien en el resumen → cuenta atrás', n === 0 && G.Again.left === 10 && co.sent.k === 'cd' && G.Again.isAway('ana'));
      G.Again.start(() => n++);
      expect('otra partida: pulsar otra vez empieza ya', n === 1 && !G.Again.left);
    }],
    [200, () => { co.invites = [{ from: 'eva', name: 'Eva', room: 'r2', at: Date.now() }]; G.Flow.goMenu(); }],
    [400, () => tap(B.x)],
    [400, () => expect('invitación encima del menú: Unirme', co.accepted === 'eva')],
    [200, () => tap(B.o)],
    [300, () => {
      const S = G.Social, k = co.saved;
      for (const [o, p, d] of co.descs) Object.defineProperty(o, p, d);
      Object.assign(S, { invite: k.inv, acceptInvite: k.acc, refreshMember: k.ref, ensureFriends: k.ens, setOpen: k.open, start: k.start });
      G.Net.mode = k.mode; G.Net.broadcast = k.bc; G.Game.startRun = k.run;
      expect('de la sala al menú', G.Game.state === 'ui' && !G.Social.room);
    }],
    // Menú: con el shiny del compañero, → lo pone shiny y ← normal.
    [300, () => { G.DB.save.shiny = G.DB.save.shiny || {}; G.DB.save.shiny[G.DB.save.partner] = { at: 1 }; G.DB.save.partnerShiny = false; tap(B.right); }],
    [300, () => { expect('menú: → compañero shiny', G.DB.save.partnerShiny === true); tap(B.left); }],
    [300, () => { expect('menú: ← compañero normal', G.DB.save.partnerShiny === false); delete G.DB.save.shiny[G.DB.save.partner]; }],
    // Barra de arriba: ↑ a Novedades, → sonido (YouTube y Apoyar están a la izquierda); ✕ silencia y otra vez lo devuelve; ↓ al menú.
    [300, () => { global.mute0 = G.Audio.settings.muted; tap(B.up); }],
    [200, () => tap(B.right)],
    [200, () => tap(B.x)],
    [300, () => expect('barra: el botón de sonido silencia', G.Audio.settings.muted !== mute0)],
    [200, () => tap(B.x)], [200, () => tap(B.down)],
    [300, () => expect('barra: y vuelve el sonido', G.Audio.settings.muted === mute0)],
    [300, () => tap(B.x)],
    [400, () => expect('Jugar empieza la partida', G.Game.state === 'playing' && !!G.Game.player)],
    [10, () => expect('la vida extra de Vitalidad se nota en la partida', G.Game.player.maxHp >= G.Upgrades.perks({ hp: 1 }).hp)],
    [300, () => G.RunUI.showLevelUp(5, G.LevelUp.offer(G.Game.player), c => out('[ui] carta: ' + c.title))],
    [800, () => tap(B.x)],
    // En grupo: tras elegir, la carta se queda con «Esperando a…» hasta que eligen todos (closeLevelUp).
    [300, () => { G.RunUI.showLevelUp(6, G.LevelUp.offer(G.Game.player), c => out('[ui] carta (grupo): ' + c.title), true); G.RunUI.setWaiting(['Ana']); }],
    [800, () => tap(B.x)],
    [300, () => { expect('grupo: tras elegir, espera a los demás', G.UI.isOpen('scr-levelup')); G.RunUI.closeLevelUp(); }],
    [200, () => expect('grupo: y se cierra cuando eligen todos', !G.UI.isOpen('scr-levelup'))],
    // El objeto: las mismas cartas en fila que offline (→ al segundo, ✕ lo coge).
    [300, () => G.RunUI.showItemChoice(Object.keys(G.Items.BY)[0], Object.keys(G.Items.BY)[1], id => { global.itemGot = id; out('[ui] objeto: ' + id); })],
    [800, () => tap(B.right)],
    [200, () => tap(B.x)],
    [300, () => expect('objeto: → y ✕ cambia al nuevo', global.itemGot === Object.keys(G.Items.BY)[1] && !G.UI.isOpen('scr-item'))],
    // Vínculo: con dos movimientos sueltos y un vínculo, el juego se para a elegir; ✕ ✕ los junta.
    [300, () => {
      const pl = G.Game.player, pool = G.Moves.poolFor(G.DEX_BY[pl.mon.dex]).filter(id => !pl.moves.some(m => m.id === id));
      if (pl.slots.filter(sl => sl.length === 1).length < 2 && pool[0]) pl.addMove(pool[0]);
      global.slots0 = pl.slots.length; pl.bonds = 1;
    }],
    [400, () => expect('vínculo: el juego espera la elección', G.Game.state === 'choice' || !!(globalThis.psCore && psCore.on && psCore.cards))],   // (núcleo: su carta)
    [500, () => tap(B.x)], [700, () => tap(B.x)],
    [300, () => expect('vínculo: se juntan dos movimientos', G.Game.player.slots.length === slots0 - 1 && G.Game.state === 'playing')],
    [300, () => tap(B.opt)],
    [300, () => expect('Options pausa', G.Game.state === 'paused')],
    [200, () => tap(B.right)], [200, () => tap(B.right)],
    [200, () => tap(B.x)],
    // Confirmación: empieza en "No"; ✕ ahí sólo cierra la pregunta. ← a "Sí" y ✕ abandona.
    [200, () => tap(B.x)],
    [300, () => expect('confirmar: "No" sigue en pausa', G.Game.state === 'paused')],
    [200, () => tap(B.x)], [200, () => tap(B.left)],
    [200, () => tap(B.x)],
    [300, () => expect('abandonar acaba la run', G.Game.state === 'over')],
    [1300, () => tap(B.x)],
    [400, () => expect('del resumen al menú', G.Game.state === 'ui')],
    [300, () => tap(B.x)],
    [400, () => expect('otra partida desde el menú', G.Game.state === 'playing')],
    // Un truco encendido en partida: la partida se acaba (con sus monedas) y al menú; luego se aplica. Y se apaga.
    [300, () => { global.coins0 = G.DB.save.coins; global.runs0 = G.DB.save.stats.runs; psCheat('god', true); }],
    [400, () => expect('truco en partida: se acaba, al menú y con sus recompensas', G.Game.state === 'ui' && G.DB.save.stats.runs === global.runs0 + 1 && psDevOn())],
    [200, () => { psCheat('god', false); expect('truco apagado', !psDevOn()); }],
  ];
  let t = 0;
  for (const [d, f] of steps) { t += d * (+process.env.PS_SLOW || 1); setTimeout_(() => { try { f(); } catch (e) { errors.push(e.stack); out(e.stack); } }, t); }
}
(function tick() {
  try { frame(ps.now()); } catch (e) { errors.push(e.stack); out('[frame] ' + e.stack); }
  if (Date.now() < end) return tick_(tick);
  const g = global.G || {};
  if (process.env.PS_EVAL) { try { vm.runInThisContext(fs.readFileSync(process.env.PS_EVAL, 'utf8')); } catch (e) { out('[eval] ' + e.stack); } }   // medir cosas a mano
  if (process.env.PS_I18N_CHECK) {   // qué textos de ui.js no tienen traducción en este idioma
    const miss = JSON.parse(fs.readFileSync(process.env.PS_I18N_CHECK, 'utf8')).filter(t => g.T(t) === t && /[a-záéíóúñ]/i.test(t));
    out('[i18n] sin traducir (' + miss.length + '): ' + JSON.stringify(miss));
  }
  out(`\nidioma: ${g.I18n && g.I18n.lang} (Jugar = ${g.T && g.T('Jugar')})`);
  out(`\nestado: ${g.Game && g.Game.state} · jugador: ${g.Game && g.Game.player ? 'sí' : 'no'} · nodos de audio: ${ps.au_stats()[0]} · errores: ${errors.length}`);
  process.exit(errors.length ? 1 : 0);
})();
