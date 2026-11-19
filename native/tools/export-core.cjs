// export-core.cjs — saca de las fuentes del juego (js/<área>/) los datos que usa el núcleo en C y escribe native/core/data.c.
//   node native/tools/export-core.cjs        (volver a correrlo si cambian los datos del juego)
// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('fs'), path = require('path');
const { G } = require('./core-js.cjs')();
const LIQ = ['water', 'swamp', 'lava', 'poison', 'spark', 'ice'];   // = enum Liq de core.h
const num = v => (v === undefined || v === null ? '0' : String(+v));
const liq = k => { const i = LIQ.indexOf(k); if (i < 0) throw new Error('líquido desconocido: ' + k); return 'LIQ_' + k.toUpperCase(); };

const T = G.Tiles, o = [];
o.push('/* data.c — GENERADO por native/tools/export-core.cjs a partir de las fuentes de js/: no editar a mano. */',
  '/* SPDX-License-Identifier: GPL-3.0-or-later */', '#include "core.h"', '');
o.push(`const int core_n_biomes = ${T.BIOMES.length}, core_arena0 = ${T.ARENA}, core_hw0 = ${T.HW};`);
o.push('const unsigned char core_biome_liquid[] = { ' + T.BIOMES.map(b => liq(b.liquid)).join(', ') + ' };', '');
o.push(`const int core_n_arenas = ${T.ARENA_TYPES.length};`);
o.push('const ArenaTheme core_arena_themes[] = {');
for (const k of T.ARENA_TYPES) {
  const th = T.ARENA_THEMES[k], p = th.props || {};
  o.push(`  { "${k}", ${liq(th.liquid)}, ${num(th.pools)}, ${num(th.pillars)}, ${num(th.clear)}, ${num(p.tree)}, ${num(p.rock)}, ${num(p.grass)} },`);
}
o.push('};', '');
// ---- Pokédex: tipos y stats (G.Stats: pa/sa ataque físico/especial, df/sd defensas; -1 = sin dato) ----
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => (ts || []).reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
const n1 = v => (v == null ? '-1' : String(+v));
const maxDex = Math.max(...G.DEX.map(m => m.dex));
o.push(`const int core_max_dex = ${maxDex};`, 'const DexStat core_dex[] = {');
const byDex = new Map(G.DEX.map(m => [m.dex, m]));
for (let d = 0; d <= maxDex; d++) {
  const m = byDex.get(d);
  o.push(m ? `  { 1, ${mask(m.types)}u, ${m.hp}, ${m.atk}, ${m.spd}, ${n1(m.pa)}, ${n1(m.sa)}, ${n1(m.df)}, ${n1(m.sd)} },` : '  { 0 },');
}
o.push('};', '');

// ---- tabla de tipos (G.Types.CHART: 2, 0,5, 0; lo que no está, 1) ----
o.push('const double core_type_chart[TY_N][TY_N] = {');
for (const a of TYPES) o.push('  { ' + TYPES.map(d => { const v = (G.Types.CHART[a] || {})[d]; return v == null ? '1' : String(v); }).join(', ') + ' },');
o.push('};', '');

// ---- ataques: cada nivel ya calculado (G.Moves.instance) y, al final, el evolucionado (G.Moves.evolve del máximo) ----
const KINDS = ['projectile', 'melee', 'beam', 'nova', 'aura', 'buff', 'boomerang', 'chain', 'mine', 'meteor', 'turret', 'dash',
               'trail', 'cone', 'homing', 'bounce', 'charge', 'spin', 'quake', 'vortex', 'shove', 'stun', 'orbit'];   // = enum MoveKind
const STATS = ['atk', 'patk', 'satk', 'spd', 'def', 'regen'];   // = enum Buff
const F = ['cd', 'dmg', 'radius', 'arc', 'width', 'knock', 'slow', 'burn', 'poison', 'speed', 'count', 'spread', 'pierce', 'life',
           'size', 'homing', 'amount', 'dur', 'stacks', 'hex', 'drain', 'rate', 'range', 'charge', 'pull', 'stun', 'bounce'];   // = MoveStat
const SKIP = new Set(['id', 'name', 'type', 'kind', 'desc', 'cat', 'maxLvl', 'def', 'lvl', 't', 'baseName', 'evolved', 'stat']);
const stat = m => {
  for (const k in m) if (!SKIP.has(k) && !F.includes(k)) throw new Error('campo de ataque desconocido: ' + k + ' (' + m.id + ')');
  if (!KINDS.includes(m.kind)) throw new Error('tipo de ataque desconocido: ' + m.kind);
  return '{ ' + F.map(k => (m[k] == null ? '0' : String(+m[k]))).join(', ') + ', ' + Math.max(0, STATS.indexOf(m.stat)) + ' }';
};
const ids = Object.keys(G.Moves.BY_ID);
o.push(`const int core_n_moves = ${ids.length};`, 'const MoveDef core_moves[] = {');
for (const id of ids) {
  const d = G.Moves.BY_ID[id], lv = [];
  for (let l = 1; l <= d.maxLvl; l++) lv.push(stat(G.Moves.instance(id, l)));
  const ev = G.Moves.instance(id, d.maxLvl), can = G.Moves.evolve(ev);
  lv.push(stat(ev));
  const cat = d.cat === 'physical' ? 1 : d.cat === 'special' ? 2 : 0;
  o.push(`  { "${id}", ${KINDS.indexOf(d.kind)}, ${TYPES.indexOf(d.type)}, ${cat}, ${d.maxLvl}, ${+can}, {\n    ${lv.join(',\n    ')} } },`);
}
o.push('};', '');
fs.writeFileSync(path.join(__dirname, '..', 'core', 'data.c'), o.join('\n'));
console.log('core/data.c: ' + T.BIOMES.length + ' biomas, ' + T.ARENA_TYPES.length + ' arenas, ' + G.DEX.length + ' Pokémon, ' + ids.length + ' ataques');
