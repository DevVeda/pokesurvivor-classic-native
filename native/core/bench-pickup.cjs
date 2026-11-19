// bench-pickup.cjs — ¿pickup.c mueve y reparte lo del suelo igual que G.Pickups de js/app.js? Botín de experiencia
// (normal y de jefe), objetos sueltos, más de 420 a la vez (se juntan), y 2-4 jugadores andando con su imán. Se compara
// en cada paso quién recoge qué y dónde queda lo demás. El azar, fijo a 0,5 en los dos.   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G;
vm.runInContext('Math.random = () => 0.5', w);
// Las esferas van a la bolsa de quien las coge (G.Orbs.add): a quien ya no le caben, no las atrae.
const KIND = ['xp', 'xpBig', 'heal', 'magnet', 'bomb', 'coin', 'ticket', 'ticket10', 'item', 'sphere', 'candy'];   // = PickKind
let s = 99; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const f = v => String(v);
// Esferas y objetos: cuál es lo decide quien pinta al recogerlo (el C deja 0).
const val = p => (p.kind === 'sphere' || p.kind === 'item' ? '0' : f(p.value));
const qs = [], js = [], what = [];
for (let sc = 0; sc < 12; sc++) {
  G.Pickups.clear();
  qs.push(`ureset ${sc + 1}`);
  const np = 1 + Math.floor(R(0, 4)), pls = [];
  for (let i = 0; i < np; i++) {
    const p = { x: R(-300, 300), y: R(-300, 300), magnet: R(60, 160), dead: false, vx: R(-120, 120), vy: R(-120, 120) };
    pls.push(p); qs.push(`uplayer ${p.x} ${p.y} ${p.magnet}`);
  }
  const n = sc === 5 || sc === 6 ? 460 : 40 + Math.floor(R(0, 120));   // (dos con más de 420: se juntan)
  for (let i = 0; i < n; i++) {
    const x = R(-600, 600), y = R(-600, 600);
    if (sc === 6) { G.Pickups.dropXp(x, y, 5, false, false); qs.push(`udropxp ${x} ${y} 5 0 0`); continue; }   // (todos pequeños)
    if (rnd() < 0.7) { const v = Math.round(R(2, 40)), boss = rnd() < 0.05; G.Pickups.dropXp(x, y, v, boss, false); qs.push(`udropxp ${x} ${y} ${v} ${+boss} 0`); }
    else { const k = pick(['heal', 'magnet', 'coin', 'ticket', 'bomb']), v = Math.round(R(0, 5)); G.Pickups.drop(k, x, y, v); qs.push(`udrop ${KIND.indexOf(k)} ${x} ${y} ${v}`); }
  }
  for (let t = 0; t < 150; t++) {
    const dt = pick([1 / 60, 1 / 30]);
    pls.forEach((p, i) => { p.x += p.vx * dt; p.y += p.vy * dt; qs.push(`upos ${i} ${p.x} ${p.y}`); });
    const got = [];
    G.Pickups.update(dt, pls, (p, who) => { got.push(`${pls.indexOf(who)}:${KIND.indexOf(p.kind)}:${val(p)}`); if (p.kind === 'magnet') G.Pickups.pullAll(); if (p.kind === 'sphere') G.Orbs.add(who, p.value); });
    qs.push(`ustep ${dt}`);
    what.push(`escena ${sc} paso ${t}`);
    js.push(got.join(' ') + ' |' + G.Pickups.all().map(p => ` ${KIND.indexOf(p.kind)} ${f(p.x)} ${f(p.y)} ${val(p)}`).join(''));
  }
}
for (let l = 1; l <= 120; l++) { qs.push(`uxpfor ${l}`); js.push(f(G.Player.xpFor(l))); what.push('xpFor ' + l); }   // experiencia por nivel
const out = execFileSync(path.join(__dirname, '..', 'build', 'core-test'), { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trimEnd().split('\n');
const same = (a, b) => {
  const x = String(a).split(/[ :]/), y = String(b).split(/[ :]/);
  if (x.length !== y.length) return false;
  return x.every((t, i) => { if (t === y[i]) return true; const p = +t, q = +y[i]; return Number.isFinite(p) && Number.isFinite(q) && Math.abs(p - q) <= 1e-7 * Math.max(1, Math.abs(p)); });
};
let bad = 0;
for (let i = 0; i < js.length; i++) {
  if (same(js[i], out[i])) continue;
  { const x = js[i].split(/[ :]/), y = String(out[i]).split(/[ :]/); const k = x.findIndex((t, j) => t !== y[j] && !(Math.abs(+t - +y[j]) <= 1e-7 * Math.max(1, Math.abs(+t)))); if (bad < 3) console.log(`  primer valor distinto (${k}): js «${x.slice(k - 3, k + 2).join(" ")}» c «${y.slice(k - 3, k + 2).join(" ")}»`); }
  if (++bad <= 5) console.log(`DISTINTO «${what[i]}»\n  js: ${js[i].slice(0, 260)}\n  c:  ${String(out[i]).slice(0, 260)}`);
}
console.log(`${js.length} pasos y niveles, ${bad} distintos`);
process.exit(bad ? 1 : 0);
