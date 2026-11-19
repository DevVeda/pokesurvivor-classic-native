// bench-combat.cjs — ¿combat.c pega igual que js/app.js? Un jugador con un ataque (cada uno de los 103, a varios niveles
// y evolucionado), enemigos quietos alrededor, y unos pasos de Combat.tick + Projectiles.update + Combat.resolve +
// updateFields. Se comparan la vida del jugador, su daño hecho, cuántos proyectiles y campos quedan, y la vida, caída y
// sitio de cada enemigo. El azar, fijo a 0,5 en los dos (Math.random del JS y S.rng.fix del C).   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G, W = G.World;
vm.runInContext('Math.random = () => 0.5', w);
G.Camera.sees = () => true;
// Meteoros: el JS baraja con sort(() => Math.random() - 0.5) si no hay G.U.shuffle (sesgado y según el motor); el C usa
// Fisher-Yates. Se le da al JS el mismo (combat.js ya lo usa si existe).
vm.runInContext('G.U.shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }', w);   // (con el Math del juego: 0,5)                      // (en el C, la vista de los jugadores es enorme: nada se descarta por lejos)
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => ts.reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
let s = 4242; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const mons = G.DEX.filter(m => G.SPRITE_META[m.dex]);
const f = v => String(v);
G.Input.axis = () => [0, 0];

const qs = [], js = [], what = [];
const ids = Object.keys(G.Moves.BY_ID);
let k = 0;
for (const id of ids) for (const lv of [1, 3, 'max', 'evo']) {
  const def = G.Moves.BY_ID[id], seed = 100 + k++, bi = pick([0, 1, 2, 6]);
  W.reset(seed); W.setBiome(bi, true); G.EnemyMgr.clear(); G.Projectiles.clear(); G.Combat.clearFields(); G.Path.clear();
  qs.push(`kreset ${seed} ${bi}`);
  const mon = pick(mons), p = new G.Player(mon, {}, false);
  [p.x, p.y] = (() => { for (let t = 0; t < 300; t++) { const x = R(-2000, 2000), y = R(-2000, 2000); if (W.isFree(x, y, 40)) return [x, y]; } return [0, 0]; })();
  qs.push(`kplayer ${mon.dex} ${p.x} ${p.y} ${p.r} ${p.baseSpd}`);
  p.addMove(id);
  const m = p.moves[0], L = lv === 1 ? 1 : lv === 3 ? Math.min(3, def.maxLvl) : def.maxLvl;
  while (m.lvl < L) G.Moves.levelUp(m);
  const evo = lv === 'evo' && G.Moves.evolve(m);
  qs.push(`klearn 0 ${id} ${L} ${+!!evo}`);
  const n = 4 + Math.floor(R(0, 14));
  for (let i = 0; i < n; i++) {
    const em = pick(mons), d = R(30, 260), a = R(0, 6.2832);
    const ed = { dex: em.dex, hp: Math.round(R(20, 400)), spd: 60, dmg: Math.round(R(3, 15)), xp: 3, behavior: 'chase' };
    const e = new G.Enemy(ed, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, { hp: 1, spd: 1, dmg: 1 });
    G.EnemyMgr.add(e);
    qs.push(`kenemy ${em.dex} ${e.x} ${e.y} ${e.r} ${e.maxHp} ${e.dmg} ${TYPES.indexOf(e.atkType)} ${mask(e.types)}`);
  }
  const dt = pick([1 / 60, 1 / 30]), steps = 20 + Math.floor(R(0, 100));
  let t = 0;
  for (let i = 0; i < steps; i++) {
    t += dt;
    p.update(dt);
    G.EnemyMgr.rebuildGrid();
    G.Combat.tick(dt, p, t);
    G.Projectiles.update(dt, p, G.EnemyMgr.all());
    G.Combat.resolve(dt, p, t);
    G.Combat.updateFields(dt);
  }
  qs.push(`kstep ${dt} ${steps}`);
  what.push(`${id} nv ${lv}`);
  js.push(`${f(p.hp)} ${f(p.dmgDealt)} ${f(p.x)} ${f(p.y)} ${G.Projectiles.count ?? G.Projectiles.all().length} ${G.Combat.fieldCount} ` +
          G.EnemyMgr.all().map(e => `${f(e.hp)} ${+e.dead} ${f(e.x)} ${f(e.y)}`).join(' '));
}

const out = execFileSync(path.join(__dirname, '..', 'build', 'core-test'), { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trimEnd().split('\n');
const same = (a, b) => {
  const x = String(a).split(' '), y = String(b).split(' ');
  if (x.length !== y.length) return false;
  return x.every((t, i) => { if (t === y[i]) return true; const p = +t, q = +y[i]; return Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) <= 1e-6 * Math.max(1, Math.abs(p)); });
};
let bad = 0;
const badIds = new Set();
for (let i = 0; i < js.length; i++) {
  if (same(js[i], out[i])) continue;
  bad++; badIds.add(what[i].split(' ')[0]);
  if (bad <= 6) console.log(`DISTINTO «${what[i]}»\n  js: ${js[i].slice(0, 260)}\n  c:  ${String(out[i]).slice(0, 260)}`);
}
if (bad) console.log('ataques con diferencias: ' + [...badIds].join(', '));
console.log(`${js.length} combates, ${bad} distintos`);
process.exit(bad ? 1 : 0);
