// bench-sim.cjs — ¿sim.c mueve igual que js/app.js? Jugadores (Player.update), caminos (G.Path), enemigos (Enemy.update)
// y la separación y la rejilla de G.EnemyMgr, con las mismas entradas. Con tolerancia 1e-7: sin, cos, atan2, exp y pow del
// C y de V8 pueden diferir en el último bit.   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G, W = G.World;
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => ts.reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
const BEH = ['chase', 'tank', 'charger', 'runner', 'thief', 'ranged', 'fan', 'beamer', 'zoner', 'healer', 'summoner', 'shielder', 'jumper', 'bomber'];
const PH = ['walk', 'aim', 'dash'];
let s = 777; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const f = v => String(v);
const mons = G.DEX.filter(m => G.SPRITE_META[m.dex]);
let axis = [0, 0];
// Lo que el JS echa a suertes (lado al atascarse) no puede salir igual que el RNG del C: esas respuestas no se comparan.
const AZAR = '(azar)';
G.Input.axis = () => axis;

const qs = [], js = [];
const ask = (q, a) => { qs.push(q); if (a !== undefined) js.push(a); };
const freeAt = (cx, cy, r, span) => { for (let t = 0; t < 200; t++) { const x = cx + R(-span, span), y = cy + R(-span, span); if (W.isFree(x, y, r)) return [x, y]; } return [cx, cy]; };

for (const [seed, bi] of [[1, 0], [4242, 1], [99, 2], [2024, 8], [31337, 6]]) {
  W.reset(seed); W.setBiome(bi, true); G.Path.clear(); G.EnemyMgr.clear();
  ask(`sreset ${seed} ${bi}`);
  // --- jugadores ---
  const mon = pick(mons), p = new G.Player(mon, {}, false);
  ask(`padd 0 0 ${p.r} ${p.baseSpd} ${mask(mon.types)}`);
  for (let k = 0; k < 40; k++) {
    const [x, y] = freeAt(R(-3000, 3000), R(-3000, 3000), p.r, 10);
    p.x = x; p.y = y; p.svx = p.svy = 0; p.inLiquid = false; ask(`ppos 0 ${x} ${y}`);
    const C = `pmove 0 `;
    // reinicia el estado del C igual que el del JS
    for (let st = 0; st < 3; st++) {
      const a = R(0, 6.2832), m = rnd() < 0.2 ? 0 : R(0.3, 1);
      axis = [Math.cos(a) * m, Math.sin(a) * m];
      const dt = pick([1 / 60, 1 / 30, 0.02]), n = 1 + Math.floor(R(0, 40));
      for (let i = 0; i < n; i++) p.update(dt);
      ask(`${C}${axis[0]} ${axis[1]} ${dt} ${n}`, `${f(p.x)} ${f(p.y)} ${f(p.svx)} ${f(p.svy)} ${+p.inLiquid}`);
    }
  }
  // --- caminos ---
  const pl = { x: 0, y: 0, r: 16, level: 1, dead: false };
  for (let k = 0; k < 12; k++) {
    [pl.x, pl.y] = freeAt(R(-2500, 2500), R(-2500, 2500), 16, 200);
    ask(`ppos 0 ${pl.x} ${pl.y}`); G.Path.clear(); G.Path.update(1, [pl]); ask('pbuild 0');
    for (let i = 0; i < 120; i++) {
      const e = { x: pl.x + R(-850, 850), y: pl.y + R(-850, 850), r: R(8, 26) };
      const d = G.Path.dirFor(e, pl);
      ask(`pdir 0 ${e.x} ${e.y} ${e.r}`, d ? `${f(d[0])} ${f(d[1])}` : '-');
    }
    // --- enemigos sueltos, hacia este jugador ---
    for (let i = 0; i < 25; i++) {
      const mon2 = pick(mons), beh = pick(['chase', 'tank', 'charger', 'runner', 'thief', 'ranged', 'fan', 'healer']);
      const def = { dex: mon2.dex, hp: 20, spd: Math.round(R(40, 90)), dmg: 5, xp: 3, behavior: beh, range: rnd() < 0.5 ? 0 : R(150, 260), shotCd: R(1, 3) };
      const [x, y] = freeAt(pl.x + R(-500, 500), pl.y + R(-500, 500), 14, 40);
      const e = new G.Enemy(def, x, y, { hp: 1, spd: 1, dmg: 1 });
      e.shotCd = def.shotCd;
      const ph = pick(PH), pt = R(-0.2, 0.6), vx = R(-150, 150), vy = R(-150, 150);
      e.phase = ph; e.pt = pt; e.dx = 0; e.dy = 0; pl._vx = vx; pl._vy = vy;
      const idx = qs.filter(q => q.startsWith('eadd ')).length - qs.filter(q => q.startsWith('sreset ')).length * 0;
      ask(`eadd ${BEH.indexOf(beh)} ${x} ${y} ${e.r} ${e.spd} ${+e.flying} ${def.range || 0} ${def.shotCd} ${mask(e.types)}`);
      const ci = js.cnt = (js.cnt || 0) + 1;
      ask(`estate ${ci - 1} ${PH.indexOf(ph)} ${pt} ${vx} ${vy}`);
      const dt = pick([1 / 60, 1 / 30]), n = 1 + Math.floor(R(0, 25));
      let picked = false;   // ¿eligió lado al atascarse? (sideT salta a 0,7)
      for (let t = 0; t < n; t++) { const s0 = e.sideT; e.update(dt, pl); if (e.sideT > s0) picked = true; }
      ask(`estep ${ci - 1} ${dt} ${n}`, picked ? AZAR : `${f(e.x)} ${f(e.y)} ${PH.indexOf(e.phase)} ${f(e.pt)} ${f(e.sideT)} ${f(e.stuckT)} ${f(e.zig || 0)}`);
    }
  }
  js.cnt = 0;
  // --- separación y rejilla: un montón, aturdidos (no andan), con un paso de EnemyMgr.update ---
  W.reset(seed); G.Path.clear(); G.EnemyMgr.clear();
  ask(`sreset ${seed} ${bi}`); ask('padd 0 0 16 100 1');
  const pl2 = { x: 0, y: 0, r: 16, level: 1, dead: false };
  for (let i = 0; i < 90; i++) {
    const mon2 = pick(mons), def = { dex: mon2.dex, hp: 20, spd: 60, dmg: 5, xp: 3, behavior: 'chase' };
    const e = new G.Enemy(def, R(-110, 110), R(-110, 110), { hp: 1, spd: 1, dmg: 1 });
    e.stunT = 99; G.EnemyMgr.add(e);
    ask(`eadd 0 ${e.x} ${e.y} ${e.r} 60 ${+e.flying} 0 0 ${mask(e.types)}`);
  }
  for (let k = 0; k < 4; k++) {
    G.EnemyMgr.update(1 / 60, [pl2]);
    ask('sep 0.016666666666666666', G.EnemyMgr.all().map(e => `${f(e.x)} ${f(e.y)}`).join(' '));
  }
  G.EnemyMgr.rebuildGrid();
  const L = G.EnemyMgr.all();
  for (let i = 0; i < 40; i++) {
    const x = R(-300, 300), y = R(-300, 300), r = R(5, 120), got = G.EnemyMgr.queryCircle(x, y, r).map(e => L.indexOf(e));
    ask(`query ${x} ${y} ${r}`, `${got.length}${got.map(i => ' ' + i).join('')}`);
  }
}

const bin = path.join(__dirname, '..', 'build', 'core-test');
const out = execFileSync(bin, { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trimEnd().split('\n');
const asked = qs.filter(q => /^(pmove|pdir|estep|sep|query) /.test(q));
const c = out.filter((l, i) => true);
// pbuild también responde (sin gemelo en el JS): fuera
const cOut = []; { let k = 0; for (const q of qs) { if (/^(pmove|pdir|estep|sep|query|pbuild) /.test(q)) { const l = out[k++]; if (!q.startsWith('pbuild')) cOut.push(l); } } }
const same = (a, b) => {
  const x = String(a).split(' '), y = String(b).split(' ');
  if (x.length !== y.length) return false;
  return x.every((t, i) => { if (t === y[i]) return true; const p = +t, q = +y[i]; return Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) <= 1e-7 * Math.max(1, Math.abs(p)); });
};
let bad = 0, azar = 0;
for (let i = 0; i < Math.max(js.length, cOut.length); i++) {
  if (js[i] === AZAR) { azar++; continue; }
  if (same(js[i], cOut[i])) continue;
  if (++bad <= 8) console.log(`DISTINTO «${asked[i]}»\n  js: ${String(js[i]).slice(0, 240)}\n  c:  ${String(cOut[i]).slice(0, 240)}`);
}
console.log(`${js.length} respuestas, ${bad} distintas (${azar} sin comparar: azar)`);
process.exit(bad ? 1 : 0);
