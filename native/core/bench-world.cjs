// bench-world.cjs — ¿world.c hace lo mismo que G.World de js/app.js? Las mismas preguntas a los dos y se comparan.
//   make -C native core-test && node native/core/bench-world.cjs      (sale con 1 si algo difiere)
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G, W = G.World, CH = w.psChunks;
const TYPES = ['tree', 'rock', 'chest', 'pumpkin', 'grass', 'altar', 'spring', 'bigchest', 'trap'];   // = PROP_* de core.h
const KIND = { floor: 0, wall: 1, liquid: 2 };
const TS = W.TS, N = 16;
let hw = [false, false];
for (const [i, k] of ['on', 'inRun'].entries()) Object.defineProperty(G.Halloween, k, { get: () => hw[i], configurable: true });

// Azar del banco (con semilla: siempre las mismas preguntas).
let s = 12345; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a);
const g17 = v => (v === Infinity ? 'inf' : String(v));
const prop = p => ` ${TYPES.indexOf(p.type)},${p.tx},${p.ty},${p.kind}`;

const qs = [];
for (const [seed, bi, hwOn, hwRun, ar] of [
  [1, 0, 0, 0, null], [987654, 2, 0, 0, null], [4242, 1, 1, 0, null], [31337, 22, 1, 1, null],
  [55, 4, 0, 0, [320, -410, 11, 1]], [777, 7, 0, 0, [-500, 260, 24, 18]], [2024, 10, 0, 0, [150, 150, 11, 7]],
]) {
  qs.push(`reset ${seed}`, `hw ${hwOn} ${hwRun}`, `biome ${bi}`);
  const [ox, oy] = ar ? [ar[0], ar[1]] : [0, 0];
  if (ar) qs.push(`arena ${ar.join(' ')}`);
  const cx0 = Math.floor(ox / N) - 4, cy0 = Math.floor(oy / N) - 4;
  for (let cy = cy0; cy < cy0 + 8; cy++) for (let cx = cx0; cx < cx0 + 8; cx++) qs.push(`props ${cx} ${cy}`);
  qs.push(`terr ${ox - 60} ${oy - 60} 120 120`, `walk ${ox - 60} ${oy - 60} 120 120`);
  const X = () => R(ox - 55, ox + 55) * TS, Y = () => R(oy - 55, oy + 55) * TS;
  for (let i = 0; i < 400; i++) qs.push(`free ${X()} ${Y()} ${R(4, 30)} ${rnd() < 0.3 ? 1 : 0}`);
  for (let i = 0; i < 600; i++) qs.push(`coll ${X()} ${Y()} ${R(6, 28)}`);
  for (let i = 0; i < 300; i++) qs.push(`pblk ${X()} ${Y()} ${R(3, 16)}`);
  for (let i = 0; i < 100; i++) qs.push(`circ ${X()} ${Y()} ${R(20, 400)}`, `spec ${X()} ${Y()} ${R(50, 900)}`, `near ${X()} ${Y()} ${R(50, 600)}`);
  for (let i = 0; i < 150; i++) { const x = X(), y = Y(); qs.push(`dmg ${x} ${y} 300 ${R(5, 40)}`, `circ ${x} ${y} 300`); }
  for (const t of [0, 1 << 1, 1 << 2, 1 << 7, 1 << 16 | 1 << 3]) qs.push(`liq ${t}`);
}

const js = qs.map(q => {
  const [c, ...v] = q.split(' '), n = v.map(Number);
  switch (c) {
    case 'reset': W.reset(n[0]); return null;
    case 'hw': hw = [!!n[0], !!n[1]]; return null;
    case 'biome': W.setBiome(n[0], true); return null;
    case 'arena': W.setArena({ tx: n[0], ty: n[1], r: n[2], type: G.Tiles.ARENA_TYPES[n[3]] }); return null;
    case 'terr': case 'walk': {
      let o = '';
      for (let y = n[1]; y < n[1] + n[3]; y++) for (let x = n[0]; x < n[0] + n[2]; x++)
        o += c === 'walk' ? +W.walkable(x, y) : KIND[W.kindAt(x * TS + 1, y * TS + 1)];
      return o;
    }
    case 'props': { const ps = CH.gen(n[0], n[1]).props; return ps.length + ps.map(prop).join(''); }
    case 'free': return String(+W.isFree(n[0], n[1], n[2], !!n[3]));
    case 'coll': { const e = { x: n[0], y: n[1], r: n[2] }; const h = W.collide(e); return `${+h} ${g17(e.x)} ${g17(e.y)}`; }
    case 'pblk': { const b = W.projectileBlock(n[0], n[1], n[2]); return b === 'wall' ? '1' : b ? '2' + prop(b) : '0'; }
    case 'circ': { const ps = W.propsInCircle(n[0], n[1], n[2]); return ps.length + ps.map(prop).join(''); }
    case 'spec': { const ps = W.specialsNear(n[0], n[1], n[2]); return ps.length + ps.map(prop).join(''); }
    case 'near': { const p = W.nearestBreakable(n[0], n[1], n[2]); return p ? '1' + prop(p) : '0'; }
    case 'dmg': {
      const p = W.nearestBreakable(n[0], n[1], n[2]);
      if (!p) return '-';
      const t = W.damageProp(p, n[3]);
      return `${+t}${prop(p)} ${g17(p.hp)}`;
    }
    case 'liq': {
      const names = Object.keys(G.U.TYPE_COLOR), types = names.filter((_, i) => n[0] & 1 << i);
      const e = W.liquidEffect(types), L = ['water', 'swamp', 'lava', 'poison', 'spark', 'ice'];
      return `${L.indexOf(W.liquidKind())} ${g17(e.slow || 0)} ${g17(e.dmg || 0)} ${g17(e.flat || 0)} ${g17(e.every || 0)} ${+!!e.slide}`;
    }
  }
  throw new Error('pregunta: ' + q);
}).filter(r => r !== null);

const bin = path.join(__dirname, '..', 'build', 'core-test');
const c = execFileSync(bin, { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trimEnd().split('\n')
  .map(l => l.replace(/-?\d+\.\d+(e[-+]?\d+)?|-?\d+e[-+]?\d+/g, t => String(Number(t))));   // %.17g -> como String() del JS
const asked = qs.filter(q => !/^(reset|hw|biome|arena) /.test(q));
let bad = 0;
for (let i = 0; i < Math.max(js.length, c.length); i++) {
  if (js[i] === c[i]) continue;
  if (++bad <= 8) console.log(`DISTINTO «${asked[i]}»\n  js: ${String(js[i]).slice(0, 300)}\n  c:  ${String(c[i]).slice(0, 300)}`);
}
console.log(`${js.length} respuestas, ${bad} distintas`);
process.exit(bad ? 1 : 0);
