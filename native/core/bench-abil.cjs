// bench-abil.cjs — ¿abil.c hace lo mismo que G.AbilityFX? Cada habilidad (y la genérica), en estados al azar (vida,
// frenado, clima, objeto, cargas de Autoestima, humor…): × al daño que hace con ataques y enemigos al azar, × al que
// recibe, esquiva, absorber, velocidad, ×cura, recarga de potenciadores, crítico, marcas; unos pasos de su tick; lo que
// hace al recibir un golpe y al tocarle un enemigo. El azar, fijo a 0,5 en los dos.   make -C native core-test
// SPDX-License-Identifier: GPL-3.0-or-later
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const w = require('../tools/core-js.cjs')(), G = w.G;
vm.runInContext('Math.random = () => 0.5', w);
G.Audio.sfx = () => {};
const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => ts.reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
const WX = ['', 'sun', 'rain', 'sand', 'snow', 'fog'], MOODS = [undefined, 'atk', 'spa', 'spd', 'def'];
let wx = '';
Object.defineProperty(G.Weather, 'current', { get: () => (wx ? { kind: wx } : null) });
let s = 777; const rnd = () => ((s = Math.imul(s, 1103515245) + 12345 >>> 0) / 4294967296);
const R = (a, b) => a + rnd() * (b - a), pick = a => a[Math.floor(rnd() * a.length)];
const mons = G.DEX.filter(m => G.SPRITE_META[m.dex]), moves = Object.keys(G.Moves.BY_ID);
const f = v => String(v);
const CLS = { p: 112, s: 115, '': 0 };

const qs = [], js = [], what = [];
const ids = Object.keys(G.AbilityFX.FX).concat(['--', 'run-away', 'cacophony']);   // (las dos últimas: la genérica con nombre)
for (const id of ids) {
  const mon = pick(mons), ab = G.AbilityFX.of(id === '--' ? null : id, mon);
  const pl = new G.Player(mon, {}, false);
  pl.abil = ab; G.Pickups.clear();
  qs.push(`aplayer ${mon.dex} ${TYPES.indexOf(mon.types[0])} ${id}`);
  for (let st = 0; st < 14; st++) {
    pl.maxHp = Math.round(R(60, 400)); pl.hp = pl.maxHp * pick([1, 0.96, 0.6, 0.45, 0.3, 0.15]);
    pl.slowT = pick([0, 0, 1.5]); const wi = pick([0, 0, 1, 2, 3, 4, 5]); wx = WX[wi];
    pl.item = pick([null, 'leftovers']); pl.moxie = pick([0, 0.035]); pl.ssT = pick([0, 30, 70]);
    pl.shieldForm = pick([false, true]); pl.angry = pick([false, true]); const mood = Math.floor(R(0, 5)); pl.mood = MOODS[mood];
    pl.level = 1 + Math.floor(R(0, 30));
    qs.push(`aset ${pl.hp} ${pl.maxHp} ${pl.slowT} ${wi} ${wi ? 1 : 0} ${pl.item ? 0 : -1} ${pl.moxie} ${pl.ssT} ${+pl.shieldForm} ${+pl.angry} ${mood} ${pl.level}`);
    const tag = id + ' estado ' + st;
    for (let k = 0; k < 6; k++) {
      const own = moves.filter(x => G.Moves.BY_ID[x].type === mon.types[0]), mid = own.length && k % 2 ? pick(own) : pick(moves), def = G.Moves.BY_ID[mid], lv = 1 + Math.floor(R(0, def.maxLvl));
      const m = G.Moves.instance(mid, lv), em = pick(mons);
      const e = k === 5 ? null : { types: em.types, boss: rnd() < 0.3, hp: R(1, 300), maxHp: 300 };
      js.push(f(ab.out ? ab.out(pl, m, e) : 1));
      qs.push(`aout ${mid} ${lv} ${e ? mask(e.types) : 0} ${e ? +e.boss : 0} ${e ? e.hp : 0} ${e ? e.maxHp : 0}`);
      what.push(tag + ' out ' + mid);
    }
    for (let k = 0; k < 4; k++) {
      const type = k ? pick(TYPES) : null, cls = pick(['p', 's', '']);
      js.push([ab.inMul ? ab.inMul(pl, type, cls) : 1, ab.dodge ? ab.dodge(pl, type, cls) : -1, ab.absorb ? TYPES.indexOf(ab.absorb) : -1,
               ab.speed ? ab.speed(pl) : 1, ab.healMul || 1, ab.statusCd || 1, ab.critMul || 1.5,
               (ab.steady ? 1 : 0) | (ab.levitate ? 2 : 0) | (ab.lavaProof ? 4 : 0) | (ab.sturdy ? 8 : 0) | (ab.sheer ? 16 : 0) |
               (ab.serene ? 32 : 0) | (ab.damp ? 64 : 0) | (ab.touchPoison ? 128 : 0) | (ab.trapProof ? 256 : 0)].map(f).join(' '));
      qs.push(`aq ${type ? TYPES.indexOf(type) : -1} ${CLS[cls]}`);
      what.push(tag + ' recibe ' + type + ' ' + cls);
    }
    {
      const dt = pick([1 / 60, 0.25, 2]), n = 1 + Math.floor(R(0, 8));
      for (let i = 0; i < n; i++) if (ab.tick) ab.tick(pl, dt);
      js.push([pl.hp, pl.slowT, pl.abSpd || 0, pl.ssT || 0, +!!pl.shieldForm, +!!pl.angry, +!!pl.boomed, MOODS.indexOf(pl.mood) < 0 ? 0 : MOODS.indexOf(pl.mood)].map(f).join(' '));
      qs.push(`atick ${dt} ${n}`);
      what.push(tag + ' tick');
    }
    {
      const type = pick(TYPES), cls = pick(['p', 's', '']);
      if (ab.hurt) ab.hurt(pl, type, cls);
      const b = pl.buffs;
      js.push([b.spd.n, b.spd.amount, b.spd.t, b.def.n, b.def.amount, b.def.t, G.Pickups.all().length].map(f).join(' '));
      qs.push(`ahurt ${TYPES.indexOf(type)} ${CLS[cls]}`);
      what.push(tag + ' golpe ' + type + ' ' + cls);
    }
    {
      const em = pick(mons), hp = Math.round(R(20, 200));
      const e = new G.Enemy({ dex: em.dex, hp, spd: 60, dmg: 5, xp: 3, behavior: 'chase' }, 20, 0, { hp: 1, spd: 1, dmg: 1 });
      if (ab.contact) ab.contact(pl, e);
      if (!e.dead) { if (ab.hit) ab.hit(pl, e, undefined); }
      js.push([e.hp, e.slow, e.slowT, e.burn, e.poison, e.sleepT || 0].map(f).join(' '));
      qs.push(`acontact ${mask(e.types)} ${e.maxHp}`);
      what.push(tag + ' contacto');
    }
  }
}
wx = '';

const bin = path.join(__dirname, '../build/core-test');
const out = execFileSync(bin, { input: qs.join('\n') + '\n', maxBuffer: 1 << 28 }).toString().trim().split('\n').map(l => l.trim());
let bad = 0;
const num = l => l.split(' ').map(Number);
for (let i = 0; i < js.length; i++) {
  const a = num(js[i]), b = num(out[i] || '');
  if (a.length === b.length && a.every((v, k) => v === b[k] || (Number.isNaN(v) && Number.isNaN(b[k])))) continue;
  if (++bad <= 12) console.log('DISTINTO «' + what[i] + '»\n  js: ' + js[i] + '\n  c:  ' + out[i]);
}
console.log(js.length + ' respuestas de ' + ids.length + ' habilidades, ' + bad + ' distintas');
process.exit(bad ? 1 : 0);
