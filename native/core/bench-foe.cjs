// bench-foe.cjs — ¿foe.c hace lo mismo que G.Enemy (personalidades y jefes) y G.Hazards? Escenas con enemigos de cada
// personalidad (rayo, zonas, abanico, curandero, escudero, saltador, kamikaze) y jefes de distintos tipos y distancias
// alrededor de un jugador que se mueve en círculo; cada paso se comparan la vida del jugador, los disparos, los avisos
// (sitio, tamaño, espera, daño) y el sitio, vida, escudo, fase y salto de cada enemigo. Todos vuelan (los caminos ya los
// mira bench-sim). El azar, fijo a 0,5 en los dos.   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G, W = G.World;
vm.runInContext('Math.random = () => 0.5', w);
G.Audio.sfx = () => {};
G.Camera.sees = () => false;
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => ts.reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
const BEH = ['chase', 'tank', 'charger', 'runner', 'thief', 'ranged', 'fan', 'beamer', 'zoner', 'healer', 'summoner',
             'shielder', 'jumper', 'bomber', 'remote'];
const PH = { walk: 0, aim: 1, dash: 2, fuse: 3 };
let s = 99; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const mons = G.DEX.filter(m => G.SPRITE_META[m.dex]);
const f = v => String(v === undefined ? 0 : v);
let pl = null;
Object.defineProperty(G.Game, 'player', { get: () => pl });
G.Game.everyone = () => [pl];

const qs = [], js = [], what = [];
for (let sc = 0; sc < 40; sc++) {
  const seed = 500 + sc;
  W.reset(seed); W.setBiome(0, true); G.EnemyMgr.clear(); G.Projectiles.clear(); G.Hazards.clear();
  qs.push(`freset ${seed} 0`);
  pl = new G.Player(G.DEX_BY[25], {}, false);
  pl.maxHp = pl.hp = 1e6; pl.x = 0; pl.y = 0;
  const bossScene = sc % 4 === 3, nb = bossScene ? 1 + (sc % 3) : 0, n = bossScene ? nb + 2 : 4 + (sc % 5);
  for (let i = 0; i < n; i++) {
    const boss = i < nb;   // (en las escenas de jefe, también un escudero y un curandero: sus escudos y curas a los jefes)
    const mon = pick(mons), beh = boss ? pick(['chase', 'ranged']) : bossScene ? (i === nb ? 'shielder' : 'healer')
      : pick(['beamer', 'zoner', 'fan', 'healer', 'shielder', 'jumper', 'bomber', 'ranged']);
    const a = R(0, 6.2832), d = R(60, 380);
    const def = { dex: mon.dex, hp: Math.round(R(40, 400)), spd: Math.round(R(40, 90)), dmg: Math.round(R(4, 14)), xp: 3, behavior: beh,
                  range: Math.round(R(180, 280)), shotCd: R(1.2, 3), shotDmg: Math.round(R(6, 16)), zones: 1 + Math.floor(R(0, 3)), fanN: pick([3, 5]) };
    const b0 = bossScene && !boss && G.EnemyMgr.all()[0];   // (los de apoyo, pegados al primer jefe)
    const e = new G.Enemy(def, b0 ? b0.x + 30 + 20 * (i - nb) : Math.cos(a) * d, b0 ? b0.y + 10 : Math.sin(a) * d, { hp: 1, spd: 1, dmg: 1 }, boss);
    e.flying = true;
    G.EnemyMgr.add(e);
    qs.push(`fenemy ${BEH.indexOf(beh)} ${mon.dex} ${e.x} ${e.y} ${e.r} ${e.spd} ${e.maxHp} ${e.dmg} ${TYPES.indexOf(e.atkType)} ${mask(e.types)} 1 ${+boss} ` +
            `${def.range} ${def.shotCd} ${e.shotDmg()} ${def.zones} ${def.fanN}`);
    if (boss && rnd() < 0.5) { e.hp = e.maxHp * 0.4; qs.push(`fhp ${i} ${e.hp}`); }   // (para la furia)
    if (boss) { e.rd = 300; qs.push(`frd ${i} 300`); }   // (daño reciente: el tope de escudos y curas a un jefe)
  }
  const dt = 1 / 30;
  for (let st = 0; st < 200; st++) {
    const t = st * dt, ang = t * 0.9, rad = 140 + 60 * Math.sin(t * 0.7);
    pl.x = Math.cos(ang) * rad; pl.y = Math.sin(ang) * rad;
    qs.push(`fplayer ${pl.x} ${pl.y} ${pl.r}`);
    G.EnemyMgr.rebuildGrid();
    for (const e of G.EnemyMgr.all()) e.update(dt, pl);
    G.Hazards.update(dt);
    const shots = G.Projectiles.all().filter(p => !p.friendly).length;
    const hz = G.Hazards.all;
    js.push([pl.hp, shots, hz.length].concat(...G.EnemyMgr.all().map(e => [e.x, e.y, e.hp, +e.dead, e.shield, PH[e.phase] || 0, +!!e.jump]),
              ...hz.map(h => [h.kind === 'zone' ? 0 : 1, h.x, h.y, h.r, h.angle, h.len, h.w, h.delay, h.dmg])).map(f).join(' '));
    qs.push(`fstep ${dt}`);
    what.push('escena ' + sc + (bossScene ? ' (jefe)' : '') + ' paso ' + st);
  }
}

const bin = path.join(__dirname, '../build/core-test');
const out = execFileSync(bin, { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trim().split('\n').map(l => l.trim());
let bad = 0, firstScene = new Set();
const num = l => l.split(' ').map(Number);
for (let i = 0; i < js.length; i++) {
  const a = num(js[i]), b = num(out[i] || '');
  // (los ángulos de los rayos salen de atan2: la de la libm y la de V8 pueden diferir en el último bit, y eso pasa a la embestida del jefe)
  if (a.length === b.length && a.every((v, k) => v === b[k] || Math.abs(v - b[k]) <= 1e-9 * Math.max(1, Math.abs(v)))) continue;
  bad++;
  const sc = what[i].split(' paso')[0];
  if (firstScene.has(sc)) continue;
  firstScene.add(sc);
  if (firstScene.size <= 6) {
    const k = a.findIndex((v, j) => v !== b[j]);
    console.log('DISTINTO «' + what[i] + '» desde el valor ' + k + '\n  js: ' + a.slice(Math.max(0, k - 3), k + 6).join(' ') + '\n  c:  ' + b.slice(Math.max(0, k - 3), k + 6).join(' '));
  }
}
console.log(js.length + ' pasos de ' + (qs.filter(q => q.startsWith('freset')).length) + ' escenas, ' + bad + ' distintos (' + firstScene.size + ' escenas)');
if (process.env.FOE_DBG) { const i = what.indexOf(process.env.FOE_DBG); console.log('js: ' + js[i] + '\nc:  ' + out[i]); }
process.exit(bad ? 1 : 0);
