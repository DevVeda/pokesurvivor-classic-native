/* boot.js — arranque del juego en la PS5 (lo ejecuta main.c).
 * Carga el navegador mínimo, después los scripts del juego en el orden de index.html (js/env.js y js/app.js: aquí, sus
 * fuentes sueltas en el orden de js/files.js)
 * (como hace el navegador con sus <script>) y, mientras no hay menús para mando,
 * entra directo a una partida de invitado.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// @step native/boot
ps.load(ps.ROOT + '/shim/browser.js');
// Servidor (CLAUDE.md de la raíz, «Perfil de servidor»): el del build (game/js/env.js, de .env con tools/apply-env.mjs) o
// el que eligió el jugador en Ajustes → Cuenta (localStorage ps.server, ui.js). Antes de net.js: el origen sale de aquí.
// @step server/boot
if (ps.readFile(ps.ROOT + '/game/js/env.js') == null) console.log('[boot] sin js/env.js: sin servidor, modo local (just lo genera desde .env)');
else try { ps.load(ps.ROOT + '/game/js/env.js'); } catch (e) { console.error('[boot] env.js: ' + e.message); }
// @step server/boot data "Mezcla ps.server"
// native/shim/boot.js carga game/js/env.js como PS_ENV_DEFAULT; si ps.server trae firebase.apiKey y
// projectId, PS_ENV = default + perfil (admins vacío). La web no hace esta mezcla.
// @next acc
// @step native/boot
globalThis.PS_ENV_DEFAULT = globalThis.PS_ENV || {};
try {
  const p = JSON.parse(localStorage.getItem('ps.server') || 'null');
  // admins son del dueño de cada servidor (sus reglas): de un servidor ajeno, ninguno.
  if (p && p.firebase && p.firebase.apiKey && p.firebase.projectId) globalThis.PS_ENV = Object.assign({}, PS_ENV_DEFAULT, p, { admins: [] });
} catch (e) { console.error('[boot] ps.server: ' + e.message); }
ps.load(ps.ROOT + '/shim/net.js');   // fetch/XHR/WebSocket/RTCPeerConnection
ps.load(ps.ROOT + '/shim/canvas.js');
ps.load(ps.ROOT + '/shim/audio.js');

(() => {
  const GAME = ps.ROOT + '/game/';
  // El juego es index.html con js/env.js y js/app.js (en la consola puede quedar el dev.html de antes: manda index.html).
  const html = ps.readFile(GAME + 'index.html') || ps.readFile(GAME + 'dev.html') || '';
  // updater.js mira version.json de la web y recarga la página: en la PS5 actualiza el lanzador.
  // js/boot.js sólo pone el texto de "Cargando" en el HTML.
  // js/app.js es la web: sus fuentes (js/<área>/), tal cual y sueltas, en el orden de js/files.js. Lo que necesitan los
  // puertos ya está en ellas (psChunks y la caché del suelo en world.js, los ganchos del núcleo en game.js). Sueltas, un
  // error dice su archivo y su línea. Una que falla no para las demás, como un <script>.
  const game = () => {
    // Mantenimiento (web 7fdffe6c, main.js): sólo arranca si <servidor>/mantenimiento.json dice «firestore».
    // ponytail: con mantenimiento arranca igual (el respaldo de 500 ms, abajo); pantalla para mando si hace falta.
    ps.load(GAME + 'js/files.js');
    for (const f of PS_FILES) try { ps.load(GAME + f); } catch (e) { console.error('[boot] ' + f + ': ' + e.message + '\n' + e.stack); }
    // G.Hz (anti-trampas, 30-10-2026) busca extensiones del navegador; aquí no hay, y el querySelector del shim
    // (siempre devuelve un elemento) le hacía creer que sí: tapaba el juego y no subía la partida a la nube.
    G.Hz = { boot: () => false, v: 0 };
    // @step native/scripts
  };
  // @step native/scripts data "Scripts de index.html"
  // Lee los <script> de game/index.html; SKIP env.js; js/app.js, por sus fuentes (G.Updater, el de la web: update.js le avisa).
  // @next ui
  const SKIP = { 'js/env.js': () => {}, 'js/boot.js': () => { window.PS_PAGES = false; },
    // js/app.js por game(): sus fuentes y G.Hz. Sin ese stub, el antitrampas (G.Hz) salta y no sube
    // la partida ni el ranking.
    'js/app.js': game };
  const scripts = [...html.matchAll(/<script[^>]*src="(js\/[^"?]+\.js)/g)].map(m => m[1]);
  // Los elementos con id nacen con las clases que tienen en el HTML: lo que en la web empieza oculto
  // (class="hidden": ajustes, avisos, ventanas...) también aquí. Si no, el juego los creía abiertos
  // (p. ej. la primera Start se gastaba en "cerrar los ajustes" y no pausaba).
  for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*\bid="[^"]+"[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(tag)[1], cls = /\bclass="([^"]*)"/.exec(tag);
    if (cls) { const el = document.getElementById(id); el.className = cls[1]; cls[1].split(/\s+/).filter(Boolean).forEach(c => el.classList.add(c)); }
  }
  // Un script que falla no para los demás: igual que en el navegador.
  for (const s of scripts) {
    try { if (SKIP[s]) SKIP[s](); else ps.load(GAME + s); } catch (e) { console.error('[boot] ' + s + ': ' + e.message + '\n' + e.stack); }
  }
  // Las pantallas para mando sustituyen a las de G.RunUI antes de que el juego arranque (Flow.boot va
  // en una promesa, después de esto). Y todas las pantallas HTML, cerradas, como en la web al cargar.
  // En la web el sonido arranca con el primer clic o tecla (lo exige el navegador); aquí, ya.
  try { ps.load(ps.ROOT + '/shim/qr.js'); } catch (e) { console.error('[boot] qr.js: ' + e.message); }
  // @step native/ui build "ui.js, update.js, core.js"
  // Pantallas para mando en canvas (sustituyen G.RunUI), cliente de actualizaciones y núcleo en C.
  // @next dom
  // @next events "bucle"
  try { ps.load(ps.ROOT + '/shim/ui.js'); G.UI.hideAll(); G.Audio.unlock(); } catch (e) { console.error('[boot] ui.js: ' + e.message + '\n' + e.stack); }
  // @step native/ui
  try { ps.load(ps.ROOT + '/shim/update.js'); } catch (e) { console.error('[boot] update.js: ' + e.message); }   // actualizaciones firmadas (update.c)
  // @step native/ui
  try { ps.load(ps.ROOT + '/shim/core.js'); } catch (e) { console.error('[boot] core.js: ' + e.message); }   // núcleo en C (CORE.md)
  // PS_EVAL_AT=archivo.js (escritorio, main.c): pruebas con el juego en marcha, como en el arnés de Node; ps.shot(ruta) guarda la pantalla.
  if (ps.EVAL_AT) setTimeout(() => { try { ps.load(ps.EVAL_AT); } catch (e) { console.error('[eval] ' + e.message + '\n' + e.stack); } }, 2000);
  // El suelo del mapa se pinta en otro hilo (native/tiles_worker.c): paintChunk costaba 150-230 ms por trozo.
  // Aquí se devuelve al momento un lienzo del color del suelo, y el hilo lo rellena con el de verdad.
  // Tiene que saber la semilla y la arena del mundo: se le pasan cuando cambian.
  if (ps.tw_paint) {
    const T = G.Tiles, W = G.World;
    let seed = 1, nextSeed = 0, useNext = false;
    globalThis.psWorldSeed = () => seed;   // (el adelanto del terreno, abajo: los trozos son de este mundo)
    // Semilla de la próxima run ya cargada en el mundo desde el menú (su fondo): el terreno se va generando ahí
    // (psIdle) y al empezar no se borra. Antes, Path.update lo generaba todo de golpe al empezar: ~200 ms.
    let preData = 0;
    globalThis.psPreData = () => (preData && preData === seed ? preData : 0);
    const ready = new Map();   // "semilla|cx|cy|bioma" -> lienzo ya encargado (la run siguiente)
    const blank = (n, bi) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = n * T.T;
      const c = cv.getContext('2d');
      c.fillStyle = T.BIOMES[bi].floor[0];
      c.fillRect(0, 0, cv.width, cv.height);
      return cv;
    };
    T.paintChunk = (cx, cy, n, at, dirtField, bi) => {
      // (Se quedan: el fondo del menú ya dibuja ese mundo, y la run los vuelve a pedir al empezar.)
      const k = seed + '|' + cx + '|' + cy + '|' + bi, pre = ready.get(k);
      if (pre) { startHits++; return pre; }
      startMiss.push(cx + ',' + cy + '/' + bi);
      const cv = blank(n, bi);
      // Mientras llega el de verdad, los muros y el agua en liso (si el terreno ya está): antes salía todo suelo y con
      // turbo se chocaba contra muros que no se veían. (Sin el terreno no: generarlo aquí es el tirón que se evita.)
      if (globalThis.psChunks && psChunks.map.has(cx + ',' + cy)) {
        const B = T.BIOMES[bi], c = cv.getContext('2d'), col = { wall: B.wallTop[0], liquid: B.liq };
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const f = col[at(cx * n + i, cy * n + j)];
          if (f) { c.fillStyle = f; c.fillRect(i * T.T, j * T.T, T.T, T.T); }
        }
      }
      ps.tw_paint(cv._sid, cx, cy, bi, seed);
      return cv;
    };
    // La run en solitario usa la semilla que ya se estaba pintando en el menú (psPrepareRun); en grupo, la del anfitrión.
    const startRun = G.Game.startRun, reset = W.reset, setArena = W.setArena;
    // (Dev) los trozos de suelo de los 2 primeros segundos de la partida: ya pintados en el menú, o a pintar entonces.
    let startHits = 0, startMiss = [];
    G.Game.startRun = (coop, opts) => {
      useNext = !coop; startHits = 0; startMiss = [];
      setTimeout(() => console.log('[suelo] al empezar: ' + startHits + ' ya pintados, ' + startMiss.length + ' a pintar' + (startMiss.length ? ' (' + startMiss.slice(0, 8).join(' ') + ')' : '') + ' · bioma ' + W.biome), 2000);
      return startRun(coop, opts);   // (opts: { endless })
    };
    W.reset = s => {
      if (useNext && nextSeed) { s = nextSeed; nextSeed = 0; }
      else if (s && s === nextSeed) nextSeed = 0;   // (el anfitrión online empezó con la preparada: la próxima, otra)
      useNext = false;
      s = (s | 0) || 1;
      // Ya es el mundo del menú (sin arenas ni nada roto: sólo lo ha mirado): se queda con su terreno hecho.
      if (s === preData && s === seed) { preData = 0; return; }
      preData = 0;
      reset(s);
      seed = s;
      for (const k of [...ready.keys()]) if (!k.startsWith(seed + '|')) ready.delete(k);
    };
    W.setArena = a => {
      ps.tw_arena(seed, a ? JSON.stringify({ tx: a.tx, ty: a.ty, r: a.r, type: a.type }) : null);
      setArena(a);
    };
    // En el menú: la semilla de la próxima run y sus 5x5 trozos alrededor de la salida, ya pintándose.
    // El elenco de enemigos de la próxima run, sorteado ya en el menú para precargar sus sprites (los primeros
    // segundos de partida iban a 26-30 ms decodificando hojas). La run usa ese sorteo en vez de hacer otro.
    const E = G.Enemies, rollRun = E.rollRun;
    let prerolled = false;
    E.rollRun = (...a) => { if (prerolled) { prerolled = false; return; } return rollRun.apply(E, a); };
    // Cooperativo local: el 1 empieza con la semilla que ya tiene preparada y se la pasa a los demás en la sala, que preparan
    // la misma (si no, al empezar se generaba todo el mundo de golpe: 600 ms de parón en cada copia).
    globalThis.psNextSeed = () => nextSeed;
    globalThis.psSetNextSeed = s => { if (!s || s === nextSeed) return; nextSeed = s; if (G.Game.state === 'ui') psPrepareRun(); };
    globalThis.psPrepareRun = () => {
      if (!prerolled) {
        rollRun.call(E); prerolled = true;
        // (En el arnés de Node no: allí decodificar es mucho más lento y descuadra los tiempos de las pulsaciones.)
        // (De fondo: la pantalla de carga del menú no la espera; ver psImgBg en browser.js.)
        if (ps.PAD !== 'node') { globalThis.psImgBg = true; try { G.Sprites.preload([...new Set(E.upcomingDex(0, 90))]); } catch (e) { console.warn('[boot] precarga: ' + e.message); } finally { globalThis.psImgBg = false; } }
      }
      if (!nextSeed) nextSeed = Math.floor(Math.random() * 1e6) || 1;
      else if (seed === nextSeed) return;
      // El fondo del menú pasa a ser el mundo de la próxima run (antes, la semilla fija 4242). Con los hilos del suelo, cuando
      // ya han llegado sus trozos de alrededor (psChunkPrefetch, abajo): si no, el primer World.update los generaba aquí (~150 ms).
      // El bioma con el que empezará (runBiome(0): con Halloween, su mapa, el 22): el suelo y el terreno se preparan con él.
      const rb = G.Tiles.runBiome ? G.Tiles.runBiome(0) : 0;
      const s = nextSeed, toMenuWorld = () => { if (G.Game.state !== 'ui' || nextSeed !== s) return; reset(s); seed = s; preData = s; W.setBiome(rb, true); };
      // El suelo de la próxima run, a pintar antes que nada (los hilos van por orden): primero los 4 trozos que se ven al
      // empezar (alrededor de la salida) y luego, del centro hacia fuera, el resto del 5x5. Si no, al pulsar Jugar aún se
      // estaban pintando, detrás del terreno del menú.
      // Orden en los hilos: los 4 trozos que se ven (menú y al empezar), el terreno del mundo del menú, y luego el resto del 5x5
      // (de fondo). La pantalla de carga espera a los dos primeros (psStartPainted, psPreBusy), no al resto.
      const n = W.CW / W.TS, order = [], fresh = !ready.has(s + '|0|0|' + rb);
      for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) order.push([cx, cy, Math.max(Math.abs(cx + 0.5), Math.abs(cy + 0.5))]);
      order.sort((a, b) => a[2] - b[2]);
      const paint = list => { for (const [cx, cy] of list) { const cv = blank(n, rb); ps.tw_paint(cv._sid, cx, cy, rb, s); ready.set(s + '|' + cx + '|' + cy + '|' + rb, cv); } };
      if (fresh) paint(order.slice(0, 4));
      startCvs = order.slice(0, 4).map(([cx, cy]) => ready.get(s + '|' + cx + '|' + cy + '|' + rb)).filter(Boolean);
      if (G.Game.state === 'ui') { if (globalThis.psChunkPrefetch) psChunkPrefetch(s, toMenuWorld, rb); else toMenuWorld(); }
      if (fresh) paint(order.slice(4));
    };
    // ¿Ya está pintado el suelo que se ve al empezar? (con un eboot sin cv_painted, o en el arnés, sí)
    let startCvs = [];
    globalThis.psStartPainted = () => !ps.cv_painted || startCvs.every(cv => ps.cv_painted(cv._sid));
  }

  // Adelantar el terreno: los datos de un trozo de mapa (rocas, agua, paredes) cuestan ~15 ms en QuickJS
  // y el juego los genera al pedirlos (Path.update pedía 4-6 de golpe: tirones de 60-100 ms). Si sobra
  // tiempo en el fotograma, se genera uno de los 7x7 de alrededor antes de que haga falta; en pausa, en
  // las cartas o fuera de la partida, todos los que quepan en 25 ms. Un trozo ya hecho cuesta casi nada.
  {
    const RING = [];
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) RING.push([dx, dy]);
    let at = '', i = 0, tick = 0;
    let preI = 0, preFor = 0;
    // Con los hilos del suelo (psChunks de world.js, ps.tw_gen): los trozos de terreno se generan allí, en paralelo, y aquí
    // sólo se recogen (~1 ms cada uno en vez de 35-50 ms). Un trozo ya pedido en este mundo no se vuelve a pedir: si el juego
    // lo tiró de su mapa (tope de 400), lo rehace él (sabe qué props rompiste). Sin psChunks o sin tw_gen: como antes.
    const CH = globalThis.psChunks, par = !!(CH && ps.tw_gen && globalThis.psWorldSeed);
    let asked = new Set(), askedSeed = 0, propId = 1e9;
    const keyOf = (cx, cy) => cx + ',' + cy;
    const importChunk = json => {
      const o = JSON.parse(json), c = {};
      for (const k in o) { const v = o[k]; c[k] = v && v.__u8 ? Uint8Array.from(v.__u8) : v; }
      for (const p of c.props || []) p.id = propId++;   // (ids propios: los del hilo del suelo chocarían con los del juego)
      for (const k in o) if (o[k] && o[k].__map) c[k] = new Map(o[k].__map.map(([a, b]) => [a, b && b.__p != null ? c.props[b.__p] : b]));
      return c;
    };
    const put = (k, json) => {   // un trozo al mapa del juego (si sigue haciendo falta)
      if (CH.map.has(k)) return;
      try { CH.map.set(k, importChunk(json)); } catch (e) { console.warn('[suelo] trozo ' + k + ': ' + e.message); return; }
      if (CH.map.size > 400) CH.map.delete(CH.map.keys().next().value);   // el tope del juego
    };
    // El mundo del menú de la próxima run: sus trozos de alrededor se piden antes de cambiar a él y se guardan aparte; cuando
    // están todos, cb() cambia el mundo (psPrepareRun) y entran en su mapa. Si entretanto empieza una partida, se descarta.
    let pf = null;   // { seed, buf: Map clave -> json, cb }
    // Mientras tanto (tapado por la pantalla de carga), el mundo del menú no se actualiza: al volver de una partida el juego
    // pone el suyo (4242) y su World.update generaba sus trozos aquí (~300 ms) para nada, porque enseguida se cambia.
    const wUpdate = G.World.update;
    G.World.update = function (...a) { if (pf && G.Game.state === 'ui') return; return wUpdate.apply(this, a); };
    globalThis.psChunkPrefetch = (s, cb, biome = 0) => {
      if (!par) return cb();
      if (pf && pf.seed === s) return;
      pf = { seed: s, buf: new Map(), cb, t: ps.now() };
      const bi = biome + (G.Halloween && G.Halloween.inRun ? 100 : 0);   // (inRun, como placeProps y el núcleo: en el menú es lo mismo que on)
      for (const [dx, dy] of RING) ps.tw_gen(dx, dy, bi, s);
    };
    const fetchChunks = () => {   // los que han llegado
      for (const [s, cx, cy, json] of ps.tw_gen_poll()) {
        if (pf && s === pf.seed) pf.buf.set(keyOf(cx, cy), json);
        else if (s === psWorldSeed()) put(keyOf(cx, cy), json);
      }
      if (pf && G.Game.state !== 'ui') pf = null;
      // Todos, o 5 s (un hilo que no contesta): se cambia igual y lo que falte lo genera el juego, como antes.
      if (pf && (pf.buf.size >= RING.length || ps.now() - pf.t > 5000)) {
        const p = pf; pf = null;
        p.cb();
        if (psWorldSeed() !== p.seed) return;
        askedSeed = p.seed; asked = new Set(p.buf.keys());
        for (const [k, json] of p.buf) put(k, json);
      }
    };
    const askAround = (pcx, pcy, ring) => {   // pide a los hilos los trozos que faltan alrededor
      const seed = psWorldSeed();
      if (askedSeed !== seed) { askedSeed = seed; asked = new Set(); }
      const hw = G.Halloween && G.Halloween.inRun ? 100 : 0, bi = (G.World.biome | 0) + hw;
      for (const [dx, dy] of ring) {
        const k = keyOf(pcx + dx, pcy + dy);
        if (asked.has(k) || CH.map.has(k)) continue;
        asked.add(k);
        ps.tw_gen(pcx + dx, pcy + dy, bi, seed);
      }
    };
    const RING4 = [];
    for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) RING4.push([dx, dy]);
    // ¿Falta terreno del menú por generar? (el círculo de carga de ui.js: los primeros segundos van más lentos)
    // (psPreWhy: el motivo, para el log de la pantalla de carga de ui.js)
    globalThis.psPreBusy = () => {
      if (pf) { globalThis.psPreWhy = 'trozos del mundo del menú'; return true; }
      if (globalThis.psStartPainted && !psStartPainted()) { globalThis.psPreWhy = 'el suelo que se ve'; return true; }
      const pre = globalThis.psPreData && psPreData();
      if (!pre) return false;
      const busy = par ? RING.some(([dx, dy]) => !CH.map.has(keyOf(dx, dy))) : pre !== preFor || preI < RING.length;
      if (busy) globalThis.psPreWhy = par ? 'terreno de la próxima partida (' + RING.filter(([dx, dy]) => !CH.map.has(keyOf(dx, dy))).length + ' trozos)' : 'terreno de la próxima partida';
      return busy;
    };
    // El suelo de alrededor, encargado antes de que se vea: el juego lo pide al dibujarlo (drawGround → chunkImage) y el hilo
    // tarda en pintarlo, así que se veía llegar (al entrar al menú, y con turbo al correr). drawGround con un lienzo que no
    // dibuja y la cámara un trozo más grande por cada lado (dos con turbo): los que faltan se encargan ya.
    // ponytail: cuadrado alrededor de la cámara, sin mirar hacia dónde vas; con la caché del juego (48) caben 7x6 trozos.
    const noCtx = { drawImage() {}, set globalAlpha(v) {}, set imageSmoothingEnabled(v) {} };
    // Además se adelanta hacia donde va la cámara (lo que recorre en ~1 s, hasta 2 trozos): con turbo ×4 el de delante
    // no llegaba a tiempo. La caché del suelo (world.js, psMaxImages) se agranda para que quepa todo esto y lo que se ve.
    let ppT = 0, ppL = null, ppTp = null;
    const prepaint = () => {
      const cam = G.Camera, W = G.World;
      if (++ppT % 10 || !cam || !cam.left || !W.drawGround) return;
      const pad = W.CW * (globalThis.psTurbo && psTurbo() > 1 ? 2 : 1), cl = cam.left(), ct = cam.top();
      const lead = d => Math.max(-2 * W.CW, Math.min(2 * W.CW, d * 6));   // (cada 10 fotogramas: ×6 ≈ 1 s)
      const jump = ppL == null || Math.abs(cl - ppL) > 4 * W.CW || Math.abs(ct - ppTp) > 4 * W.CW;   // (teletransporte, otra run)
      const l = cl - pad + (jump ? 0 : lead(cl - ppL)), tp = ct - pad + (jump ? 0 : lead(ct - ppTp));
      ppL = cl; ppTp = ct;
      const span = s => Math.ceil(s / W.CW) + 1;
      globalThis.psMaxImages = span(cam.w + pad * 2 + 4 * W.CW) * span(cam.h + pad * 2 + 4 * W.CW);
      try { W.drawGround(noCtx, { left: () => l, top: () => tp, w: cam.w + pad * 2, h: cam.h + pad * 2 }); } catch (e) { /* nada */ }
    };
    globalThis.psIdle = used => {
      const pl = G.Game && G.Game.player, W = G.World;
      if (!W.CW) return;
      if (ps.tw_paint) prepaint();
      if (par) {
        fetchChunks();
        const pre = globalThis.psPreData && psPreData();
        if (!pl || G.Game.state === 'ui') { if (pre) askAround(0, 0, RING); return; }   // en el menú: la salida de la próxima run
        askAround(Math.floor(pl.x / W.CW), Math.floor(pl.y / W.CW), RING4);
        return;
      }
      // En el menú: el terreno de alrededor de la salida de la próxima run (psPrepareRun), 25 ms por fotograma.
      const pre = globalThis.psPreData && psPreData();
      if (!pl || G.Game.state === 'ui') {
        if (!pre) return;
        if (pre !== preFor) { preFor = pre; preI = 0; }
        const t0 = ps.now(), N = W.CW / W.TS;
        const budget = globalThis.psCovered && psCovered() ? 120 : 25;   // con la pantalla de carga delante no se nota
        while (preI < RING.length && ps.now() - t0 < budget) { W.walkable(RING[preI][0] * N, RING[preI][1] * N); preI++; }
        return;
      }
      const st = G.Game.state, calm = st !== 'playing' && st !== 'held';
      let budget = calm ? 25 : 16.7 - 4 - used;   // 4 ms de margen para presentar
      // Sin tiempo libre (final de partida, muchos enemigos) también se adelanta, un trozo cada 3 fotogramas:
      // si no, Path.update generaba de golpe los 4-5 trozos nuevos al cruzar un borde (80-100 ms de tirón).
      if (budget < 2) { if (++tick % 3) return; budget = 0.5; }
      const pcx = Math.floor(pl.x / W.CW), pcy = Math.floor(pl.y / W.CW), here = pcx + ',' + pcy;
      if (here !== at) { at = here; i = 0; }
      const t0 = ps.now(), N = W.CW / W.TS;
      while (i < RING.length && ps.now() - t0 < budget) {
        const s0 = ps.now();
        W.walkable((pcx + RING[i][0]) * N, (pcy + RING[i][1]) * N);
        i++;
        if (!calm && ps.now() - s0 > 1) break;   // jugando: como mucho un trozo nuevo por fotograma
      }
    };
  }

  // Medición: las funciones grandes de cada fotograma, y la que pinta los trozos de suelo. Las llamadas de más
  // de 12 ms van al log ([caro]), para saber qué causa los tirones. Cuesta dos lecturas de reloj por llamada.
  const jsProf = {}, jsFrame = {};
  // Las de este fotograma (browser.js las pide en cada uno y, si fue lento, las escribe en [lento-js]).
  globalThis.psJsFrame = () => { const r = Object.entries(jsFrame).filter(e => e[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 4); for (const k in jsFrame) jsFrame[k] = 0; return r; };
  const PROFILE = { Tiles: ['paintChunk'], World: ['update'], Path: ['update'], Spawner: ['update'], EnemyMgr: ['update', 'draw'],
                    Combat: ['tick', 'updateFields'], FX: ['update', 'draw'], HUD: ['draw'], Pickups: ['update', 'draw'],
                    Projectiles: ['update', 'draw'], Weather: ['update', 'draw'], Events: ['update'], Rift: ['update'] };
  const prof = (o, fn, name) => {
    const f = o && o[fn];
    if (typeof f !== 'function') return;
    o[fn] = function (...a) {
      const t0 = ps.now(), r = f.apply(this, a), dt = ps.now() - t0;
      jsProf[name] = (jsProf[name] || 0) + dt; jsFrame[name] = (jsFrame[name] || 0) + dt;
      if (dt > 12) console.log('[caro] ' + name + ': ' + dt.toFixed(0) + ' ms');
      return r;
    };
  };
  for (const mod in PROFILE) for (const fn of PROFILE[mod]) prof(G[mod], fn, mod + '.' + fn);
  // Para el latido del log (browser.js, cada 5 s): las funciones del juego que más tiempo se llevan.
  globalThis.psJsProf = frames => {
    const top = Object.entries(jsProf).sort((a, b) => b[1] - a[1]).slice(0, 5).filter(e => e[1] > 0);
    for (const k in jsProf) jsProf[k] = 0;
    return frames && top.length ? '[js] ' + top.map(([k, v]) => k + ' ' + (v / frames).toFixed(1) + ' ms').join(' · ') : '';
  };
  console.log('[boot] ' + scripts.length + ' scripts cargados; G: ' + (typeof G === 'object' ? Object.keys(G).length + ' módulos' : 'NO'));

  // El flujo de la web (Flow.boot, en main.js) abre la cuenta y el menú, que en la PS5 son las pantallas
  // para mando (ui.js). Si la interfaz HTML lo cortó antes de llegar, se arranca aquí.
  setTimeout(() => {
    try {
      if (!globalThis.psRafs) { console.warn('[boot] Flow.boot no llegó a G.Game.init: se llama aquí'); G.Game.init(); }
      if (!G.DB.save) psStartFlow();
    } catch (e) { console.error('[boot] arranque: ' + e.message + '\n' + e.stack); }
  }, 500);

  // Prueba de la red al arrancar (sólo deja líneas [red] en el log): HTTPS con la web y un WebSocket seguro con
  // la base de datos de Firebase, que saluda al conectar y se cierra (no lee ni escribe nada).
  // ponytail: quitar cuando la cuenta en la nube ya esté probada en la consola.
  setTimeout(() => {
    if (!ps.net_request) return;
    const t0 = ps.now();
    fetch('https://pokesurvivor.com/version.json', { cache: 'no-store' }).then(r => r.text().then(t => console.log('[red] https://pokesurvivor.com/version.json: ' + r.status + ' en ' + Math.round(ps.now() - t0) + ' ms · ' + t.trim().slice(0, 80))))
      .catch(e => console.warn('[red] HTTPS falló: ' + e.message));
    try {
      const db = G.FIREBASE_CONFIG && G.FIREBASE_CONFIG.databaseURL;
      if (!db) return;
      const ns = db.replace(/^https:\/\/([^.]+)\..*$/, '$1'), w = new WebSocket(db.replace(/^https:/, 'wss:') + '/.ws?v=5&ns=' + ns), t1 = ps.now();
      w.onmessage = e => { console.log('[red] WebSocket con Firebase: saludo en ' + Math.round(ps.now() - t1) + ' ms · ' + String(e.data).slice(0, 80)); w.close(); };
      w.onerror = () => console.warn('[red] WebSocket con Firebase falló');
    } catch (e) { console.warn('[red] WebSocket: ' + e.message); }
  }, 2000);
})();
