// bench-map.cjs — ¿map.c hace lo mismo que G.Interact, el daño del clima y G.Halloween.takeCandy? Para cada objeto
// especial (altar, manantial, cofre con candado, trampa) de varias semillas: el jugador se acerca, se queda encima y se
// va, con enemigos al lado de las trampas; cada paso se comparan su vida, frenado, stats (poderes), lo curado, el botín
// en el suelo, los enemigos y el estado de los especiales. Luego arena y nieve con jugadores y enemigos de varios tipos,
// y los caramelos de Halloween a distintos minutos. El azar, fijo a 0,5 en los dos.   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G, W = G.World;
vm.runInContext('Math.random = () => 0.5', w);
G.Audio.sfx = () => {};
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => ts.reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
const PT = ['tree', 'rock', 'chest', 'pumpkin', 'grass', 'altar', 'spring', 'bigchest', 'trap'];   // = PROP_*
const POW = ['dmg', 'spd', 'mag', 'cd'], WX = ['', 'sun', 'rain', 'sand', 'snow', 'fog'];
let s = 31; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const mons = G.DEX.filter(m => G.SPRITE_META[m.dex]);
const f = v => String(v === undefined ? 0 : v);
let pl = null;
Object.defineProperty(G.Game, 'player', { get: () => pl });

const qs = [], js = [], what = [];
function state() {
  const sp = W.specialsNear(pl.x, pl.y, 720);
  return [pl.hp, pl.slowT, pl.atkMul, pl.spdMul, pl.magnet, pl.cdMul, pl.power ? POW.indexOf(pl.power.def.id) : -1, G.Pickups.all().length]
    .concat(...G.EnemyMgr.all().map(e => [e.hp, e.slow, e.poison, +e.dead]), ...sp.map(p => [PT.indexOf(p.type), p.charge, p.open, +!!p.used]))
    .map(f).join(' ');
}

function newPlayer(seed, hw) {
  W.reset(seed); W.setBiome(0, true); G.EnemyMgr.clear(); G.Pickups.clear(); G.Hazards.clear(); G.Weather.reset();
  G.Halloween.runStart(hw);
  qs.push(`mreset ${seed} 0 ${+hw}`);
  const mon = pick(mons);
  pl = new G.Player(mon, {}, false);
  pl.maxHp = Math.round(R(80, 300)); pl.hp = pl.maxHp * pick([1, 0.5, 0.2]); pl.level = 1 + Math.floor(R(0, 20));
  qs.push(`mplayer ${mon.dex} ${mask(mon.types)} 0 0 ${pl.r} ${pl.maxHp} ${pl.hp} ${pl.level}`);
  return mon;
}

// ---- objetos especiales (una semilla: uno de cada tipo, seguidos, con el mismo jugador) ----
let k = 0;
for (let seed = 1; seed <= 16; seed++) {
  W.reset(seed); W.setBiome(0, true);
  const all = W.specialsNear(0, 0, 900), targets = [];
  for (const t of ['altar', 'spring', 'bigchest', 'trap']) { const p = all.find(q => q.type === t); if (p) targets.push(p); }
  if (!targets.length) continue;
  newPlayer(seed, false);
  for (const target of targets) {
    const tx = target.x, ty = target.y;
    if (target.type === 'trap') for (let i = 0; i < 3; i++) {   // (enemigos al lado: a ellos también les pilla)
      const em = pick(mons), e = new G.Enemy({ dex: em.dex, hp: Math.round(R(30, 300)), spd: 60, dmg: 5, xp: 3, behavior: 'chase' }, tx + R(-50, 50), ty + R(-40, 40), { hp: 1, spd: 1, dmg: 1 });
      e.flying = true;   // (que no la pisen ellos antes: la pisa el jugador)
      G.EnemyMgr.add(e);
      qs.push(`fenemy 0 ${em.dex} ${e.x} ${e.y} ${e.r} ${e.spd} ${e.maxHp} ${e.dmg} ${TYPES.indexOf(e.atkType)} ${mask(e.types)} 1 0 0 0 10 0 5`);
    }
    const dt = 1 / 20;
    for (let st = 0; st < 140; st++) {
      // se acerca desde 120 px, se queda encima unos segundos y se va
      const d = st < 30 ? 120 - st * 4 : st < 110 ? 0 : (st - 110) * 5;
      pl.x = tx + d; pl.y = ty - (target.type === 'spring' || target.type === 'trap' ? 8 : 0);
      qs.push(`mpos ${pl.x} ${pl.y}`);
      G.EnemyMgr.rebuildGrid();
      const h0 = pl.hp;
      G.Interact.update(dt, pl);
      js.push(state());
      qs.push(`mstep ${dt} 0`);
      what.push(target.type + ' (semilla ' + seed + ') paso ' + st);
    }
    k++;
  }
}

// ---- arena y nieve ----
for (let sc = 0; sc < 24; sc++) {
  const wi = sc % 2 ? 4 : 3;
  newPlayer(900 + sc, false);
  G.Weather.force(WX[wi], 60);
  for (let i = 0; i < 6; i++) {
    const em = pick(mons), boss = i === 5;
    const e = new G.Enemy({ dex: em.dex, hp: Math.round(R(5, 80)), spd: 60, dmg: 5, xp: 3, behavior: 'chase' }, R(-200, 200), R(-200, 200), { hp: 1, spd: 1, dmg: 1 }, boss);
    G.EnemyMgr.add(e);
    qs.push(`fenemy 0 ${em.dex} ${e.x} ${e.y} ${e.r} ${e.spd} ${e.maxHp} ${e.dmg} ${TYPES.indexOf(e.atkType)} ${mask(e.types)} 1 ${+boss} 0 0 10 0 5`);
  }
  const dt = 0.25, K = G.Weather.KINDS[WX[wi]], [mt, mk] = Object.entries(K.mult)[0];
  for (let st = 0; st < 60; st++) {
    G.Weather.update(dt, 0, pl);
    const lv = (G.Weather.mult(mt) - 1) / (mk - 1);
    qs.push(`mwx ${G.Weather.current ? wi : 0} ${lv}`);
    js.push(state());
    qs.push(`mstep ${dt} 1`);
    what.push(WX[wi] + ' escena ' + sc + ' paso ' + st);
  }
}
// (el C mira el clima al empezar el paso; el JS, después de avanzarlo: se le da al C la intensidad ya avanzada)

// ---- caramelos de Halloween ----
G.Halloween.runStart(true);
qs.push('mreset 1 0 1');
for (let i = 0; i < 300; i++) {
  const t = i * 7.3, need = pick([1, 1, 3]);
  qs.push(`mtime ${t}`, `mcandy ${need}`);
  js.push(f(+G.Halloween.takeCandy(t, need)));
  what.push('caramelo ' + i);
}

const bin = path.join(__dirname, '../build/core-test');
const out = execFileSync(bin, { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trim().split('\n').map(l => l.trim());
let bad = 0; const seen = new Set();
const num = l => l.split(' ').map(Number);
for (let i = 0; i < js.length; i++) {
  const a = num(js[i]), b = num(out[i] || '');
  if (a.length === b.length && a.every((v, j) => v === b[j])) continue;
  bad++;
  const sc = what[i].split(' paso')[0];
  if (seen.has(sc)) continue;
  seen.add(sc);
  if (seen.size <= 6) {
    const j = a.findIndex((v, n) => v !== b[n]);
    console.log('DISTINTO «' + what[i] + '» desde el valor ' + j + '\n  js: ' + a.slice(Math.max(0, j - 3), j + 6).join(' ') + '\n  c:  ' + b.slice(Math.max(0, j - 3), j + 6).join(' '));
  }
}
console.log(js.length + ' pasos (' + k + ' objetos especiales, arena y nieve, caramelos), ' + bad + ' distintos');
process.exit(bad ? 1 : 0);
