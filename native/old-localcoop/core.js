/* core.js — prueba del núcleo en C (native/CORE.md, fases 2 y 3): en una sola copia del juego, el núcleo (ps.core_*)
 * mueve y hace pelear a los jugadores (uno por mando) y a los enemigos, y el JS sólo pinta y pone los efectos.
 * Recogidas y experiencia del equipo: al subir de nivel, cada uno elige su carta con su mando en su parte de la pantalla
 * (la partida espera a todos). Varios: la pantalla partida dinámica del cooperativo local de antes (grupos, corte por la
 * mediatriz, alejarse) y el HUD de cada uno en su esquina.
 * Habilidad, objeto y esferas de cada uno (núcleo: abil.c): □ usa la esfera elegida, △ pasa a la siguiente; un objeto
 * nuevo, si ya llevas otro, se elige en su zona como una carta. El clima, el del juego (G.Weather), pasa al núcleo.
 * Los enemigos los saca el G.Spawner del juego (goteo, mareas, jefes, shinies): G.EnemyMgr.add/all/get/count van al núcleo
 * mientras está en marcha. Rayos y zonas con aviso, escudos, saltos, kamikazes y jefes, en el núcleo (foe.c); sus avisos
 * se pintan con los de G.Hazards. Invocar, aquí (Enemy.summon del que se pinta).
 * Ajustes → Desarrollador → «Núcleo en C». Entra otro jugador pulsando ✕ en su mando (sin abrir otra copia: main.c,
 * ps.core_pads). L1 / R1: cambiar de ataque. Se sale con la pausa (Abandonar).
 * El juego llama aquí desde G.Game (appmin.js: psCore.update en lugar de su update, y psCore.drawList al pintar).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  if (!ps.core_step) return;
  const BEH = ['chase', 'tank', 'charger', 'runner', 'thief', 'ranged', 'fan', 'beamer', 'zoner', 'healer', 'summoner',
               'shielder', 'jumper', 'bomber', 'remote'];   // = enum Beh de core.h
  const KINDS = ['projectile', 'melee', 'beam', 'nova', 'aura', 'buff', 'boomerang', 'chain', 'mine', 'meteor', 'turret', 'dash',
                 'trail', 'cone', 'homing', 'bounce', 'charge', 'spin', 'quake', 'vortex', 'shove', 'stun', 'orbit'];   // = enum MoveKind
  const EV = { CAST: 0, HIT: 1, KILL: 2, PHURT: 3, PDEAD: 4, PREVIVE: 5, PROP: 6, SLASH: 7, BEAM: 8, RING: 9, DASH: 10, BLAST: 11,
               HEAL: 12, SHOT: 13, PICK: 14, LEVEL: 15, ORB: 16, FX: 17, HAZARD: 18, EANIM: 19, SUMMON: 20, ENRAGE: 21, TRAP: 22, POWER: 23, GONE: 24 };   // = enum EvKind
  const TRAP_COL = ['#c86bdc', '#8bd94a', '#ff7b3d'], TRAP_PAL = ['poison', 'grass', 'fire'];
  const PHASE = ['walk', 'aim', 'dash', 'fuse'], EANIM = ['Charge', 'Attack', 'Shoot'];
  const WXK = ['', 'sun', 'rain', 'sand', 'snow', 'fog'];   // = enum Wx
  const MOOD_COL = [0, '#ff6b4d', '#ff8ad8', '#7fe0ff', '#b0b8c8'];
  const PK = ['xp', 'xpBig', 'heal', 'magnet', 'bomb', 'coin', 'ticket', 'ticket10', 'item', 'sphere', 'candy'];   // = PickKind
  const PICK_SFX = { xp: 'xp', xpBig: 'xp', coin: 'coin', heal: 'heal', bomb: 'break', magnet: 'confirm', ticket: 'shiny', ticket10: 'legend', item: 'legend', sphere: 'confirm' };
  const FK = ['mine', 'meteor', 'turret', 'patch', 'charge', 'spin', 'quake', 'vortex', 'stunzone'];   // = enum FieldKind
  const TYPES = Object.keys(G.U.TYPE_COLOR), mask = ts => (ts || []).reduce((m, t) => m | 1 << TYPES.indexOf(t), 0);
  const COLORS = ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8'];
  const MOVES = Object.keys(G.Moves.BY_ID);   // (el orden de core/data.c: export-core.cjs)
  const BT_A = 0, BT_X = 2, BT_Y = 3, BT_L1 = 9, BT_R1 = 10, BT_UP = 11, BT_DOWN = 12;   // botones de SDL (ps.pad().b)
  let biome = 0, bosses = 0, starting = false, frameNo = 0, drawMs = 0, hudMs = 0, drawT = 0;
  const hzs = new Map();         // id -> aviso en la lista de G.Hazards (sólo se pinta)
  let on = false, seed = 1, t = 0, spawnT = 0, logT = 0, stepMs = 0, frames = 0, kills = 0, downT = 0;
  const players = [];            // G.Player que sólo se pintan (el 0 es el de la partida)
  const held = [], sent = [];   // botones del paso anterior de cada mando; hueco activo que tiene el núcleo
  const enemies = new Map();     // id del núcleo -> G.Enemy que sólo se pinta (los caídos, hasta desvanecerse)
  const shots = new Map();       // id -> proyectil de G.Projectiles (sólo se pinta)
  const fields = new Map();      // id -> campo (se pinta aquí)
  const drops = new Map();       // id -> objeto del suelo en la lista de G.Pickups (sólo se pinta)
  let cards = null, cardsAt = 0; // subida de nivel: [{ i, offer, sel, done, zone }] por jugador (null: no hay)
  // Pantalla partida dinámica, la del cooperativo local de antes (localcoop.js + main.c), en una sola copia: ver layout().
  let L = null;                  // el reparto de este fotograma (null: una cámara)
  const camAt = new Map();       // cámara (suavizada) de cada vista: «c» (la del centro) o el jugador que la lleva
  const hudCv = [];              // lienzo del HUD de cada jugador (para su esquina)
  const orbSel = [], seenOrb = new Set(), later = [];   // esfera elegida de cada uno; las ya explicadas; ventanas en cola
  let hudI = 0;                  // de quién es el HUD que se pinta (G.Orbs.sel / cd)

  // La semilla del mundo de esta partida (para que el núcleo tenga el mismo mapa).
  const reset0 = G.World.reset;
  G.World.reset = function (s) { seed = (s | 0) || 1; return reset0.apply(this, arguments); };

  const stick = (x, y) => {   // zona muerta 0,18 y largo hasta 1
    const m = Math.hypot(x, y);
    if (m < 0.18) return [0, 0];
    const k = Math.min(1, (m - 0.18) / 0.82) / m;
    return [x * k, y * k];
  };
  const moveDef = i => G.Moves.BY_ID[MOVES[i]];
  const col = i => (i >= 0 && moveDef(i) ? G.U.TYPE_COLOR[moveDef(i).type] : '#ff7a9e');
  const vis = i => (i >= 0 && moveDef(i) ? G.VFX.forMove(moveDef(i)) : G.VFX.forType('normal'));

  // Lo que lleva el G.Player de pintar (cartas, habilidad al empezar, objeto), al núcleo.
  const statsOf = p => [p.maxHp, p.atkMul, p.cdMul, p.dmgReduce + (p.itemReduce || 0), p.critChance || 0, p.spdMul, p.regenFlat || 0,
                        p.magnet, p.xpMul, p.hp];
  const itemIdx = id => G.Items.LIST.findIndex(it => it.id === id);
  function addPlayer(i, p) {
    p.tag = 'J' + (i + 1); p.tagColor = COLORS[i];
    const k = ps.core_player(p.dex, mask(p.mon.types), p.x, p.y, p.r, p.baseSpd);
    if (k !== i) { console.error('[núcleo] el jugador ' + (i + 1) + ' no entra (' + k + ')'); return; }
    ps.core_stats(i, ...statsOf(p));
    ps.core_ability(i, p.abilId || '', TYPES.indexOf(p.mon.types[0]));
    ps.core_item(i, itemIdx(p.item));
    orbSel[i] = 0;
    // Sus ataques: los huecos que trae (el 1, los de la partida) o el inicial de su Pokémon.
    const groups = p.slots && p.slots.length ? p.slots : [[G.Moves.instance(G.Moves.startFor(p.mon), 1)]];
    if (!p.slots || !p.slots.length) { p.moves = groups.flat(); p.slots = groups; p.active = 0; }
    for (const g of groups) { const m = g[0]; ps.core_learn(i, m.id, m.lvl, !!m.evolved); }
    players[i] = p; sent[i] = p.active || 0;
    G.Sprites.preload([p.dex], 8000, p.shiny);
    ps.log('[núcleo] entra el jugador ' + (i + 1) + ': ' + p.mon.name + ' (' + groups.map(g => g[0].id).join(', ') + '), habilidad ' + (p.abilId || '-'));
  }

  // Los enemigos del juego (G.Spawner, Enemy.summon…) entran en el núcleo; el G.Enemy se queda para pintarlo.
  function coreAdd(e) {
    const def = e.def || {};
    const id = ps.core_enemy(Math.max(0, BEH.indexOf(e.behavior)), e.dex, e.x, e.y, e.r, e.spd, e.maxHp, e.flying ? 1 : 0,
                             def.range || 0, def.shotCd || 0, mask(e.types), e.dmg, TYPES.indexOf(e.atkType), e.shotDmg(),
                             def.fanN || 5, e.xp, (e.boss ? 1 : 0) | (e.legend ? 2 : 0) | (e.judge ? 4 : 0) | (e.shiny ? 8 : 0) |
                             (e.golden ? 16 : 0) | (def.loot === 'ticket10' ? 32 : 0) | (e.arceus ? 64 : 0), def.zones || 0, e.life || 0);
    if (!id) return e;
    e.coreId = id;
    enemies.set(id, e);
    G.Sprites.preload([e.dex], 8000, e.shiny);
    return e;
  }
  const live = () => [...enemies.values()].filter(e => !e.dead);
  const mgr0 = { add: G.EnemyMgr.add, all: G.EnemyMgr.all, get: G.EnemyMgr.get, bossAlive: G.EnemyMgr.bossAlive, shinies: G.EnemyMgr.shinies,
                 count: Object.getOwnPropertyDescriptor(G.EnemyMgr, 'count') };
  G.EnemyMgr.add = e => (on ? coreAdd(e) : mgr0.add(e));
  G.EnemyMgr.all = () => (on ? live() : mgr0.all());
  G.EnemyMgr.get = id => (on ? live().find(e => e.id === id) : mgr0.get(id));
  G.EnemyMgr.bossAlive = () => (on ? live().some(e => e.boss) : mgr0.bossAlive());
  G.EnemyMgr.shinies = () => (on ? live().filter(e => e.shiny) : mgr0.shinies());
  Object.defineProperty(G.EnemyMgr, 'count', { configurable: true, get: () => (on ? live().length : mgr0.count.get.call(G.EnemyMgr)) });

  // Lo que hacen la grieta, la Sentencia y los eventos del juego (G.Rift, G.Judgment, G.Events: deciden en JS) sobre
  // enemigos, disparos, avisos, lo del suelo y el mapa, también en el núcleo mientras está en marcha.
  const wrap = (obj, k, fn) => { const f0 = obj[k]; obj[k] = function (...a) { return on ? fn.call(this, f0.bind(this), ...a) : f0.apply(this, a); }; };
  let stashed = null;            // los G.Enemy del mapa mientras dura una arena
  const hzColor = new Map();     // id del aviso -> su color (los de Arceus, dorados)
  wrap(G.EnemyMgr, 'stash', () => { ps.core_stash(); stashed = new Map([...enemies].filter(([, e]) => !e.dead)); enemies.clear(); });
  wrap(G.EnemyMgr, 'restore', () => { ps.core_restore(); enemies.clear(); for (const [k, e] of stashed || []) enemies.set(k, e); stashed = null; });
  wrap(G.EnemyMgr, 'clearRemote', () => {});
  wrap(G.EnemyMgr, 'queryCircle', (f0, x, y, r) => live().filter(e => G.U.dist2(e.x, e.y, x, y) <= (r + e.r) * (r + e.r)));
  wrap(G.Projectiles, 'clear', f0 => { f0(); shots.clear(); ps.core_clear(1); });
  wrap(G.Combat, 'clearFields', f0 => { f0(); ps.core_clear(2); });
  wrap(G.Hazards, 'clear', f0 => { f0(); hzs.clear(); ps.core_clear(4); });
  wrap(G.Hazards, 'add', (f0, h) => {
    const cat = h.cat === 'special' ? 2 : h.cat === 'physical' ? 1 : 0;
    const id = ps.core_hazard(h.kind === 'zone' ? 0 : 1, h.x, h.y, h.r || 0, h.angle || 0, h.len || 0, h.w || 0, h.delay, h.dmg || 0,
                              h.type ? TYPES.indexOf(h.type) : -1, cat, h.pct || 0, (h.pure ? 1 : 0) | (h.boom ? 2 : 0) | (h.vis === 'pillar' ? 4 : 0));
    if (id && h.color) hzColor.set(id, h.color);
    return h;
  });
  wrap(G.Pickups, 'clear', f0 => { f0(); drops.clear(); ps.core_clear(8); });
  wrap(G.Pickups, 'drop', (f0, kind, x, y, v) => ps.core_drop(PK.indexOf(kind), x, y, typeof v === 'number' ? v : 0));
  wrap(G.Pickups, 'pullAll', () => ps.core_pullall());
  wrap(G.World, 'setArena', (f0, a) => { f0(a); ps.core_arena(a.tx, a.ty, a.r, Math.max(0, G.Tiles.ARENA_TYPES.indexOf(a.type))); });
  wrap(G.World, 'setBiome', (f0, i, inst) => { f0(i, inst); ps.core_biome(G.World.biome); });
  wrap(G.Game, 'everyone', () => players.filter(Boolean));
  { const sr0 = G.Game.startRun;   // «Jugar con el núcleo»: la partida normal (sin cooperativo online) también al núcleo
    G.Game.startRun = function (coop) { const r = sr0.apply(this, arguments); if (!coop && !starting && psCore.always) psCore.begin(); return r; }; }
  wrap(G.Game, 'offerBond', () => { if (!G.Rift.inArena) openBonds(); });

  // Lo que esos sistemas cambian en los que se pintan (llevarlos a la arena, curar, revivir, encerrar, hacer dorado,
  // romper el objeto…), de vuelta al núcleo: se compara con lo que dijo el núcleo en el paso anterior.
  function snapshot() {
    for (const p of players) if (p) p._w = { x: p.x, y: p.y, hp: p.hp, dead: p.dead, item: p.item, st: statsOf(p).join() };
    for (const e of enemies.values()) e._w = { x: e.x, y: e.y, hp: e.hp, xp: e.xp, g: !!e.golden };
  }
  function writeBack() {
    players.forEach((p, i) => {
      const w = p && p._w;
      if (!w) return;
      if (p.x !== w.x || p.y !== w.y) ps.core_ppos(i, p.x, p.y);
      if (p.hp !== w.hp || p.dead !== w.dead) ps.core_php(i, p.hp, p.dead ? 1 : 0);
      if (p.item !== w.item || statsOf(p).join() !== w.st || p.slots.map(g => g.map(m => m.id).join(',')).join(';') !== p._lay) sync(i);
    });
    for (const e of enemies.values()) {
      const w = e._w;
      if (!w || e.dead) continue;
      if (e.x !== w.x || e.y !== w.y || e.hp !== w.hp || e.xp !== w.xp || !!e.golden !== w.g) ps.core_eset(e.coreId, e.x, e.y, e.hp, e.xp, e.golden ? 1 : 0);
    }
  }

  // Los avisos del núcleo, en la lista de G.Hazards (los pinta drawScene); al cumplirse, lo que pinta Hazards.detonate.
  function detonate(h) {
    const near = G.Camera.sees(h.x, h.y, 120);
    if (h.vis === 'pillar') {
      G.FX.beam(h.x, h.y, -Math.PI / 2, 420, h.r * 1.1, h.color, G.VFX.forType('electric'));
      G.FX.ring(h.x, h.y, 4, h.r * 1.3, '#fff3c8', 0.4, 5); G.FX.burst(h.x, h.y - 6, h.color, 10, 180);
      if (near) { G.Audio.sfx('judge'); G.Camera.kick(0.2); }
    } else if (h.kind === 'zone') {
      G.FX.ring(h.x, h.y, 4, h.r, h.color, 0.35, 5); G.FX.burst(h.x, h.y - 6, h.color, Math.round(h.r / 3), 160);
      if (near) { G.Audio.sfx('break'); if (h.r > 60) G.Camera.kick(0.35); }
    } else {
      G.FX.beam(h.x, h.y - G.LIFT, h.angle, h.len, h.w, h.color, G.VFX.forType(h.type || 'normal'));
      if (near) G.Audio.sfx('shot', { kind: 'beam', type: h.type });
    }
  }

  function face(anim, a, walking, spd) {
    if (anim.busy()) return;
    anim.dir = G.Sprites.dirFromAngle(a);
    anim.loop(walking ? 'Walk' : 'Idle', walking ? Math.max(0.6, spd / 110) : 1);
  }

  const CAST_ANIM = { melee: 'Attack', beam: 'Shoot', projectile: 'Shoot', nova: 'Attack', aura: 'Charge', buff: 'Charge',
                      orbit: 'Charge', boomerang: 'Shoot', chain: 'Shoot', mine: 'Charge', meteor: 'Charge', turret: 'Charge',
                      dash: 'Attack', cone: 'Shoot' };
  // Lo que pasó en el paso: números, efectos, animaciones (el JS no decide nada).
  function events() {
    const b = new Float64Array(ps.core_events()), LIFT = G.LIFT || 12;
    for (let o = 0; o < b.length; o += 8) {
      const k = b[o], who = b[o + 1], id = b[o + 2], x = b[o + 3], y = b[o + 4], a = b[o + 5], bb = b[o + 6], c = b[o + 7];
      const p = who >= 0 ? players[who] : null;
      if (k === EV.CAST) {
        const kind = KINDS[a];
        if (p && kind !== 'trail' && !(p.anim.busy() && p.anim.progress() < 0.65)) {
          p.anim.dir = G.Sprites.dirFromAngle(p.aim);
          p.anim.play(CAST_ANIM[kind] || 'Attack', { speed: Math.max(1, 0.5 / Math.max(0.1, bb)) });
          p.attackFace = 0.35;
        }
        if (kind !== 'trail' && kind !== 'orbit') G.Audio.sfx('shot', { kind, type: moveDef(id) && moveDef(id).type });
      } else if (k === EV.HIT) {
        const e = enemies.get(id);
        if (!e) continue;
        e.flash = 0.09;
        if (bb === 2) G.Judgment.hitArceus(a); else G.Judgment.noteDmg(a, e);   // (Arceus: su cuenta; los demás: la vida del 1.er legendario)
        G.FX.dmgText(x, y - e.bodyH - 4, Math.round(a), bb === 1 ? '#9fd8ff' : bb === 2 ? '#ffd25e' : '#ffffff', false);
        if (!e.anim.busy()) e.anim.play('Hurt');
      } else if (k === EV.KILL) {
        const e = enemies.get(id);
        kills++;
        if (!e) continue;
        e.dead = true; e.fade = 0.9; e.anim.play('Faint', { hold: true });
        G.Progress.kill(e);   // (misiones y logros; en la Sentencia, también su cuenta de jefes: Judgment.bossDown)
        if (e.boss && !e.judge) bosses++;
        G.FX.burst(x, y - e.bodyH * 0.5, bb ? '#ffd95e' : '#ffffff', bb ? 34 : 9, bb ? 260 : 120);
        G.Audio.sfx(bb ? 'bossDown' : 'faint');
        if (bb) G.Camera.kick(0.9);
        if (e.shiny) { G.FX.burst(x, y - e.bodyH * 0.5, '#ffe9a0', 30, 220); G.FX.ring(x, y, e.r, e.r * 7, '#9ae6ff', 0.7, 5); }
      } else if (k === EV.PHURT && p) {
        p.flash = 0.14;
        G.FX.dmgText(x, y - p.bodyH - 4, '-' + Math.round(a), '#ff6b7a', false);
        G.FX.burst(x, y - p.bodyH * 0.5, '#ff5f6d', 6, 90);
        G.Audio.sfx('hurt');
        if (who === 0) { G.Camera.kick(0.28); G.Pad.rumble(0.25 + Math.min(0.75, a / p.maxHp * 3), 140); }
      } else if (k === EV.PDEAD && p) { ps.log('[núcleo] J' + (who + 1) + ' cae' + (G.Rift.inArena ? ' en la grieta' : '') + ' en ' + Math.round(x) + ',' + Math.round(y) + (p.inLiquid ? ' (en el charco)' : '')); p.dead = true; p.anim.play('Faint', { hold: true }); G.Audio.sfx('faint'); }
      else if (k === EV.PREVIVE && p) { p.dead = false; p.anim._start('Idle', false); G.FX.ring(x, y, 6, 70, '#5fe08a', 0.5, 4); G.Audio.sfx('heal'); }
      else if (k === EV.HEAL && p) { G.FX.dmgText(x, y - p.bodyH - 6, '+' + Math.round(a), '#5fe08a'); if (id === 1) G.Audio.sfx('xp'); }   // (1: manantial)
      else if (k === EV.TRAP) {   // (Interact.trapEffect: lo que se ve)
        const col = TRAP_COL[a], pal = TRAP_PAL[a];
        G.FX.ring(x, y, 6, 74, col, 0.5, a === 2 ? 7 : 4); G.FX.burst(x, y - 6, col, a === 2 ? 40 : 22, a === 2 ? 260 : 140);
        for (let i = 0; i < (a === 2 ? 10 : 7); i++) {
          const an = Math.random() * 6.2832, r = G.U.rand(8, 74 * 0.8);
          G.FX.sp(a === 2 ? 'impact' : 'blob', pal, x + Math.cos(an) * r, y + Math.sin(an) * r * 0.7 - 6, { vy: a === 2 ? -30 : -45, life: G.U.rand(0.4, 0.8) });
        }
        G.Audio.sfx(a === 2 ? 'boss' : 'surge');
        if (a === 2 && G.Camera.sees(x, y, 200)) G.Camera.kick(0.7);
      } else if (k === EV.POWER && p) {
        const pw = G.Interact.POWERS[a];
        G.FX.ring(x, y, 8, 90, pw.color, 0.6, 5); G.FX.burst(p.x, p.y - p.bodyH * 0.5, pw.color, 24, 200); G.Audio.sfx('legend');
        G.Spawner.say('J' + (who + 1) + ': ¡Poder ' + pw.name + '! ' + pw.desc + ' durante ' + bb + ' s', 3, true);
      } else if (k === EV.GONE) {
        const e = enemies.get(id);
        if (e) { G.FX.burst(x, y - 10, '#ffd23f', 16, 140); G.Spawner.say('¡' + e.name + ' se ha escapado!', 2.4); enemies.delete(id); }
      }
      else if (k === EV.SLASH) G.FX.slash(x, y - LIFT * 0.5, a, bb, c, col(id), vis(id));
      else if (k === EV.BEAM) G.FX.beam(x, y - LIFT, a, bb, c < 0 ? -c : c, col(id), vis(id));
      else if (k === EV.DASH) G.FX.slash(x + Math.cos(a) * bb, y + Math.sin(a) * bb - LIFT * 0.5, a, 34, 2.2, col(id), vis(id));
      else if (k === EV.RING) {
        if (c === 3 && p) {   // (mejora: las flechas que suben, como Combat.buff)
          const v = vis(id);
          for (let i = 0; i < 3; i++) G.FX.sp(v.buff || 'arrow', v.pal, p.x + G.U.rand(-p.r * 1.4, p.r * 1.4), p.y - G.U.rand(0, p.bodyH * 0.8), { vy: -70, life: 0.6 });
        }
        const e = who < 0 && enemies.get(id);   // (de un enemigo: curar, escudos, aviso de disparos del jefe)
        G.FX.ring(x, y, a, bb, c === 4 ? '#5fe08a' : c === 5 ? '#7fc8ff' : e ? G.U.TYPE_COLOR[e.atkType] || '#ff7a9e' : col(id), c === 6 ? 0.6 : 0.3, 3);
      }
      else if (k === EV.HAZARD) { const h = hzs.get(id); if (h) detonate(h); }
      else if (k === EV.EANIM) { const e = enemies.get(id); if (e) e.anim.play(EANIM[a] || 'Attack', { speed: bb || 1 }); }
      else if (k === EV.SUMMON) { const e = enemies.get(id); if (e) e.summon(); }
      else if (k === EV.ENRAGE) {
        const e = enemies.get(id);
        if (e) {
          (e.ai = e.ai || {}).fury = true;
          if (!e.judge) G.Spawner.say('¡' + e.name + ' se ha enfurecido!', 2.4);
          G.FX.ring(x, y, a, a * 5, '#ff4a4a', 0.6, 5); G.Camera.kick(0.5); G.Audio.sfx('boss');
        }
      }
      else if (k === EV.BLAST) { G.FX.ring(x, y, 4, a, col(id), 0.3, 4); G.FX.burst(x, y - 6, col(id), 10, 150); }
      else if (k === EV.PROP) {   // roto o abierto en el núcleo: fuera también del mundo que se pinta (sus efectos y sonido; el botín ya lo soltó el núcleo)
        const P = G.Pickups, H = G.Halloween, I = G.Interact, d0 = P.drop, x0 = P.dropXp, c0 = H.takeCandy, t0 = I.trapEffect;
        P.drop = P.dropXp = () => {}; H.takeCandy = () => false; I.trapEffect = () => {};   // (lo hace el núcleo: EV_TRAP)
        try { G.World.breakAt(bb, c); } finally { P.drop = d0; P.dropXp = x0; H.takeCandy = c0; I.trapEffect = t0; }
      }
      else if (k === EV.SHOT) { const e = enemies.get(id); if (e && !e.anim.busy()) e.anim.play('Shoot'); }
      else if (k === EV.PICK && p) {
        const kind = PK[id];
        G.Audio.sfx(PICK_SFX[kind] || 'confirm');
        if (kind === 'coin') G.FX.dmgText(x, y - p.bodyH - 6, '+' + a, '#ffd23f');
        else if (kind === 'ticket' || kind === 'ticket10') G.FX.dmgText(x, y - p.bodyH - 8, kind === 'ticket' ? '+1 ticket' : '¡Ticket ×10!', '#ffd23f', true);
        else if (kind === 'heal') G.FX.ring(x, y, 6, 60, '#5fe08a', 0.4, 3);
        else if (kind === 'magnet') G.FX.ring(x, y, 10, 420, '#ff9ed8', 0.6, 4);
        else if (kind === 'bomb') { G.FX.ring(x, y, 20, G.Camera.outerRadius(), '#ff7b3d', 0.5, 6); G.Camera.kick(0.8); }
        else if (kind === 'candy') {
          G.FX.dmgText(x, y - p.bodyH - 8, '+' + (a || 1) + (a > 1 ? ' caramelos' : ' caramelo'), '#ff9a3d', true);
          G.FX.ring(x, y, 6, 44, '#ff8a2a', 0.4, 3);
        }
        else if (kind === 'item') offerItem(who, G.Items.LIST[a] && G.Items.LIST[a].id);
        else if (kind === 'sphere' && G.Orbs.LIST[a]) {
          const o = G.Orbs.LIST[a];
          G.FX.dmgText(x, y - p.bodyH - 8, G.T(o.name), o.col, true); G.FX.ring(x, y, 6, 50, o.col, 0.4, 3);
          p._orbNew = o.id;
          if (!seenOrb.has(o.id)) { seenOrb.add(o.id); G.Spawner.say(G.T(o.name) + ' (' + G.T('X para usarla') + '): ' + G.T(o.desc), 5); }
        }
      } else if (k === EV.LEVEL) { if (cards) later.push(() => openCards(a)); else openCards(a); }
      else if (k === EV.ORB && G.Orbs.LIST[id]) {
        const o = G.Orbs.LIST[id];
        G.Audio.sfx('confirm'); G.FX.ring(x, y, 10, a, o.col, 0.6, 5);
        if (o.kind === 'buff' && p) G.FX.dmgText(x, y - p.bodyH - 8, G.T(o.name), o.col, true);
      } else if (k === EV.FX && p) {
        const top = y - p.bodyH - 16;
        if (id === 0) G.FX.dmgText(x, y - p.bodyH - 4, '¡Esquiva!', '#bfe8ff');
        else if (id === 1 || id === 2) {
          const [t, c] = id === 1 ? ['¡Banda Focus!', '#ff9a3d'] : ['¡Robustez!', '#c9b48a'];
          G.FX.dmgText(x, top, t, c, true); G.FX.ring(x, y, 6, 70, c, 0.5, 4);
        } else if (id === 3) G.FX.dmgText(x, top, '¡Irascible!', '#ff6b4d', true);
        else if (id === 4) G.FX.ring(x, y, p.r * 2.4, p.r * 1.1, MOOD_COL[a] || '#fff', 0.35, 2.5);
        else if (id === 5) { G.FX.ring(x, y, 10, a, '#ff7b3d', 0.5, 6); G.Camera.kick(0.6); G.Audio.sfx('break'); }
        else if (id === 6) G.Audio.sfx('error');   // (esfera: aún en espera)
        else if (id === 7) G.FX.dmgText(x, y - p.bodyH - 6, '¡Pegajoso!', '#8bd94a');
        else if (id === 8) G.Spawner.say('El manantial se ha secado (se recarga solo)', 2.2, true);
        else if (id === 9) G.FX.dmgText(x, y - p.bodyH - 4, '-' + Math.round(a), (G.Weather.KINDS[WXK[bb]] || {}).color || '#fff');
      }
    }
  }

  // Los objetos del mapa cerca de cada uno (vida de rocas y cofres, candado, manantial, altar usado), del núcleo al mundo
  // que se pinta. Los que el mundo pinta y el núcleo no tiene (no debería haber: mismo mapa), al log.
  let propMiss = 0, wasArena = false, arenaLog = 0, nextBeat = 60;
  function syncProps() {
    const r = G.Camera.outerRadius(), W = G.World;
    for (const p of players) {
      if (!p || p.dead) continue;
      const js = new Map();
      for (const q of W.propsInCircle(p.x, p.y, r)) js.set(q.tx + ',' + q.ty, q);
      for (const q of W.specialsNear(p.x, p.y, r)) js.set(q.tx + ',' + q.ty, q);
      const b = new Float64Array(ps.core_props(p.x, p.y, r));
      for (let o = 0; o < b.length; o += 6) {
        const k = b[o] + ',' + b[o + 1], q = js.get(k);
        if (!q) continue;
        js.delete(k);
        if (b[o + 2] >= 0 && q.hp !== b[o + 2]) { if (b[o + 2] < q.hp) q.flash = 0.08; q.hp = b[o + 2]; }
        if (q.type === 'bigchest' && !q.open && b[o + 3] > 0) G.Audio.sfx('select');
        q.open = b[o + 3]; q.charge = b[o + 4]; q.used = !!b[o + 5];
      }
      for (const q of js.values()) if (q.type !== 'grass' && propMiss++ < 5) ps.log('[núcleo] objeto que el núcleo no tiene: ' + q.type + ' en ' + q.tx + ',' + q.ty);
    }
  }

  // Campos en el suelo (minas, charcos, remolinos, aturdir, sombra de los meteoros) y torretas.
  function fieldDrawable(f) {
    return {
      get y() { return f.y - 4000; },
      draw(ctx) {
        const c = col(f.move), v = vis(f.move), now = t;
        ctx.save();
        if (f.kind === 'turret') { G.VFX.draw(ctx, v.proj, v.pal, f.x, f.y - 16 + Math.sin(now * 4 + f.x) * 2, { scale: 1.5, frame: Math.floor(now * 8) }); }
        else if (f.kind === 'meteor') {
          const k = G.U.clamp(f.t / f.p, 0, 1);
          ctx.globalAlpha = 0.2 + k * 0.3; ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * (0.3 + k * 0.7), f.r * 0.6 * (0.3 + k * 0.7), 0, 0, 6.2832); ctx.fill();
          if (f.t > 0) G.VFX.draw(ctx, v.proj, v.pal, f.x + (1 - k) * 40, f.y - (1 - k) * 170 - 6, { scale: 1.5, frame: Math.floor(now * 12) });
        } else if (f.kind === 'mine') {
          ctx.globalAlpha = 0.18; ctx.fillStyle = c;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * 0.45, f.r * 0.28, 0, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1; G.VFX.draw(ctx, v.proj, v.pal, f.x, f.y - 4, { scale: 1, frame: 0 });
        } else if (f.kind !== 'spin' && f.kind !== 'quake' && f.kind !== 'charge') {
          ctx.globalAlpha = 0.25; ctx.fillStyle = c;
          const r = f.kind === 'stunzone' ? f.r * G.U.clamp(f.t / f.p, 0, 1) : f.r;
          ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.6, 0, 0, 6.2832); ctx.fill();
        }
        ctx.restore();
      },
    };
  }

  // ---- subida de nivel: una carta por jugador, cada uno con su mando; la partida espera a todos ----
  function openCards(level) {
    const W = ps.W, H = ps.H;
    cards = players.map((p, i) => {
      const z = zoneOf(i, W, H);
      return { i, offer: p && !p.dead ? G.LevelUp.offer(p) : [], sel: 0, done: !p || p.dead, held: ps.pad(i) ? ps.pad(i).b | 0 : 0, zone: z, color: COLORS[i] };
    });
    for (const c of cards) if (!c.offer.length) c.done = true;
    cardsAt = ps.now();
    if (globalThis.psCoreCards) psCoreCards(level, cards);
    G.Audio.sfx('levelup');
    ps.log('[núcleo] nivel ' + level + ': cartas para ' + cards.filter(c => !c.done).length);
  }
  // Lo que cambió en el G.Player de pintar al aplicar la carta, al núcleo.
  function sync(i) {
    const p = players[i];
    ps.core_stats(i, ...statsOf(p));
    ps.core_item(i, itemIdx(p.item));
    for (const g of p.slots) for (const m of g) if (!ps.core_movelvl(i, m.id, m.lvl, !!m.evolved)) ps.core_learn(i, m.id, m.lvl, !!m.evolved);
    // La forma de los huecos (con los vínculos, varios ataques en uno) y el activo.
    const lay = p.slots.map(g => g.map(m => m.id).join(',')).join(';');
    if (lay !== p._lay) { p._lay = lay; ps.core_slots(i, lay, p.active); sent[i] = p.active; }
    if (p.active !== sent[i]) { sent[i] = p.active; ps.core_active(i, p.active); }
  }

  // ---- vínculos (al ganar en la grieta, uno para cada uno): qué ataques se unen, en su zona como una carta ----
  function openBonds() {
    if (cards) { later.push(openBonds); return; }
    const sets = players.map((p, i) => {
      const opt = p && !p.dead && p.bonds > 0 ? p.bondOptions() : null;
      const combos = !opt ? [] : opt.mode === 'add' ? opt.loose.map(m => [m]) : opt.loose.flatMap((a, k) => opt.loose.slice(k + 1).map(b => [a, b]));
      const name = ms => ms.map(m => G.T(m.name)).join(' + ');
      const offer = combos.map(ms => ({
        icon: 'move:' + ms[0].id, title: name(ms), color: G.U.TYPE_COLOR[ms[0].type], bond: true, tag: 'Vínculo',
        desc: opt.mode === 'add' ? G.I18n.f('Se lanzará a la vez que {x}.', name(opt.group)) : 'Se lanzarán a la vez. Queda un hueco libre.',
        apply: () => {
          const g = p.fuse(ms, opt.group);
          sync(i);
          G.Audio.sfx('legend'); G.FX.ring(p.x, p.y, 8, 130, '#ff8ad8', 0.8, 6); G.FX.burst(p.x, p.y - p.bodyH * 0.5, '#ffb3e6', 40, 240);
          G.Spawner.say('J' + (i + 1) + ': ¡Vínculo! ' + g.length + ' movimientos a la vez', 2.6, true);
        },
      }));
      if (p && p.bonds > 0 && !opt) G.Spawner.say('J' + (i + 1) + ': guardas el vínculo (aprende otro movimiento para usarlo)', 3, true);
      return { i, offer, sel: 0, done: !offer.length, held: ps.pad(i) ? ps.pad(i).b | 0 : 0, zone: zoneOf(i, ps.W, ps.H), color: COLORS[i],
               title: G.T('¡Vínculo!'), sub: G.T('Los movimientos unidos se lanzan a la vez y ocupan un solo hueco') };
    });
    if (sets.every(c => c.done)) return;
    cards = sets; cardsAt = ps.now();
    if (globalThis.psCoreCards) psCoreCards(0, cards);
    G.Audio.sfx('levelup');
  }
  function cardsInput() {
    const ready = ps.now() - cardsAt >= 600;   // como en el juego: 0,6 s antes de poder elegir
    for (const c of cards) {
      if (c.done) continue;
      const pad = ps.pad(c.i) || {}, b = pad.b | 0, tap = bit => (b & 1 << bit) && !(c.held & 1 << bit);
      const sy = pad.ly || 0, stickTap = Math.abs(sy) > 0.6 && !c.stick;
      c.stick = Math.abs(sy) > 0.6;
      if (tap(BT_UP) || (stickTap && sy < 0)) { c.sel = (c.sel + c.offer.length - 1) % c.offer.length; G.Audio.sfx('select'); }
      if (tap(BT_DOWN) || (stickTap && sy > 0)) { c.sel = (c.sel + 1) % c.offer.length; G.Audio.sfx('select'); }
      if (ready && tap(BT_A)) {
        ps.log('[núcleo] J' + (c.i + 1) + ' elige: ' + c.offer[c.sel].title);
        c.offer[c.sel].apply(players[c.i]);
        sync(c.i);
        c.done = true;
        G.Audio.sfx('confirm');
      }
      c.held = b;
    }
    if (cards.every(c => c.done)) { cards = null; if (globalThis.psCoreCards) psCoreCards(null); if (later.length) later.shift()(); }
  }

  // ---- objeto: si no llevas ninguno, te lo pones; si llevas otro, eliges en tu zona (como una carta; la partida espera) ----
  function equip(i, id) {
    const p = players[i];
    p.equip(id); sync(i);
    if (!i) G.Progress.event('item', { id });   // (la cuenta es la del 1)
    G.Spawner.say('J' + (i + 1) + ': ¡' + G.T('Llevas') + ' ' + G.T(G.Items.BY[id].name) + '!', 2.6, true);
    ps.log('[núcleo] J' + (i + 1) + ' lleva ' + id);
  }
  function offerItem(i, id) {
    const p = players[i];
    if (!p || !G.Items.BY[id]) return;
    if (!p.item) { equip(i, id); return; }
    if (p.item === id) { G.Spawner.say('Ya llevas ' + G.T(G.Items.BY[id].name), 2, true); return; }
    if (cards) { later.push(() => offerItem(i, id)); return; }
    ps.log('[núcleo] J' + (i + 1) + ' coge ' + id + ' (lleva ' + p.item + ')');
    const card = (k, swap) => ({ icon: k, title: G.T(swap ? 'Cambiar a' : 'Quedarme con') + ' ' + G.T(G.Items.BY[k].name), tag: G.T(G.Items.BY[k].name),
                                 desc: G.T(G.Items.BY[k].desc), color: '#ffd23f', apply: () => { if (swap) equip(i, k); } });
    cards = players.map((q, k) => ({ i: k, offer: k === i ? [card(p.item, false), card(id, true)] : [], sel: 0, done: k !== i,
                                     held: ps.pad(k) ? ps.pad(k).b | 0 : 0, zone: zoneOf(k, ps.W, ps.H), color: COLORS[k],
                                     title: G.T('¡Un objeto!'), sub: G.T('Sólo puedes llevar uno ·').replace(/\s*·$/, '') }));
    cardsAt = ps.now();
    if (globalThis.psCoreCards) psCoreCards(0, cards);
    G.Audio.sfx('legend');
  }

  // ---- esferas: cada uno la suya (G.Orbs, en el núcleo); el 1 llega por las teclas del juego (handleKeys) ----
  function nextOrb(i) {
    const inv = (players[i] && players[i].orbs) || [];
    for (let k = 1; k <= 4; k++) if (inv[(orbSel[i] + k) % 4]) { orbSel[i] = (orbSel[i] + k) % 4; G.Audio.sfx('click'); return; }
  }
  function useOrb(i, slot) {
    const p = players[i];
    if (!p || p.dead) return;
    if (slot == null) { if (!(p.orbs || [])[orbSel[i]]) nextOrb(i); slot = orbSel[i]; }
    if (!(p.orbs || [])[slot]) return;
    const C = G.Camera, z = C.zoom || 1;
    ps.core_orb(i, slot, C.VIEW_W / 2 * z + 60, C.MIN_VIEW_H * 0.75 * z + 60);
  }
  const orbs0 = { use: G.Orbs.use, useSelected: G.Orbs.useSelected, next: G.Orbs.next };
  G.Orbs.use = (pl, i) => (on ? useOrb(players.indexOf(pl), i) : orbs0.use(pl, i));
  G.Orbs.useSelected = pl => (on ? useOrb(players.indexOf(pl)) : orbs0.useSelected(pl));
  G.Orbs.next = pl => (on ? nextOrb(players.indexOf(pl)) : orbs0.next(pl));
  for (const k of ['sel', 'cd']) {
    const d = Object.getOwnPropertyDescriptor(G.Orbs, k);
    Object.defineProperty(G.Orbs, k, { configurable: true, get() {
      if (!on) return d.get.call(G.Orbs);
      return k === 'sel' ? orbSel[hudI] || 0 : (players[hudI] && players[hudI].orbCd) || 0;
    } });
  }
  // La ventana de cada uno (cartas): con dos, su mitad; con más, su cuarto (como QX/QY de main.c: el 1 y el 2 abajo).
  function zoneOf(i, w, h) {
    const n = players.length;
    if (n <= 1) return [0, 0, w, h];
    if (n === 2) return [i * w / 2, 0, w / 2, h];
    return [(i % 2) * w / 2, i < 2 ? h / 2 : 0, w / 2, h / 2];
  }

  // ---- el reparto de la pantalla (splitN de localcoop.js, en píxeles de dibujo, ps.W × ps.H) ----
  // Los que están cerca entre sí (menos de R en pantalla) forman un grupo y comparten cámara. Cada grupo va en su sitio de
  // la pantalla: el de su centro respecto al de todos, como mucho a R del medio. Los que no llegan a R comparten la cámara
  // del centro de todos; si ninguno llega, no se parte. Al separarse se aleja (hasta ZMAX; partida, hasta ZROOM según el
  // sitio que le queda), y cada cámara pone su grupo en el centro de su zona poco a poco (sin salto al partirse).
  // ponytail: sin la cámara de la grieta y de Arceus (fase 5).
  const R = 170, CX = ps.W / 2, CY = ps.H / 2, ZMAX = 1.6, ZROOM = 1.8;
  function cellPoly(s, others) {   // la zona de un sitio: el rectángulo recortado por las mediatrices con los demás
    let poly = [[0, 0], [ps.W, 0], [ps.W, ps.H], [0, ps.H]];
    for (const o of others) {
      const a = o[0] - s[0], b = o[1] - s[1];
      if (!a && !b) continue;
      const c = a * (s[0] + o[0]) / 2 + b * (s[1] + o[1]) / 2, out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
        if (dp <= 0) out.push(p);
        if (dp * dq < 0) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
    }
    return poly;
  }
  function cellCenter(poly, s) {
    if (poly.length < 3) return s;
    let A = 0, x = 0, y = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], cr = p[0] * q[1] - q[0] * p[1];
      A += cr; x += (p[0] + q[0]) * cr; y += (p[1] + q[1]) * cr;
    }
    return Math.abs(A) < 1 ? s : [x / (3 * A), y / (3 * A)];
  }
  function layout() {
    const pts = players.map((p, i) => (p ? { i, p } : null)).filter(Boolean);
    if (pts.length < 2) return null;
    const C = G.Camera, k = C.scale * C.zoom * C.dpr, A = ps.W / ps.H, zoom = C.zoom || 1;
    const dist = (ax, ay, bx, by) => Math.hypot((ax - bx) * k, (ay - by) * k * A);
    pts.forEach(e => { e.g = e; });
    const root = e => (e.g === e ? e : (e.g = root(e.g)));
    for (const a of pts) for (const b of pts) if (a !== b && dist(a.p.x, a.p.y, b.p.x, b.p.y) < R) root(a).g = root(b);
    const groups = new Map();
    for (const e of pts) { const r = root(e); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); }
    const cx = pts.reduce((a, e) => a + e.p.x, 0) / pts.length, cy = pts.reduce((a, e) => a + e.p.y, 0) / pts.length;
    let far = false, spread = 0;
    for (const e of pts) spread = Math.max(spread, dist(e.p.x, e.p.y, cx, cy));
    let z = 1 + (ZMAX - 1) * Math.min(1, Math.max(0, (spread - 0.7 * R) / (0.6 * R)));
    const grp = [];
    for (const g of groups.values()) {
      const gx = g.reduce((a, e) => a + e.p.x, 0) / g.length, gy = g.reduce((a, e) => a + e.p.y, 0) / g.length;
      let dx = (gx - cx) * k, dy = (gy - cy) * k;
      const d = Math.hypot(dx, dy * A), lead = Math.min(...g.map(e => e.i));
      if (d > R) { far = true; dx *= R / d; dy *= R / d; }
      grp.push({ g, gx, gy, d, lead, site: [CX + dx / zoom, CY + dy / zoom], src: d > R ? lead : 'c' });
    }
    if (far) {
      let room = Infinity;
      for (let a = 0; a < grp.length; a++) for (let b = a + 1; b < grp.length; b++) room = Math.min(room, Math.hypot(grp[a].site[0] - grp[b].site[0], grp[a].site[1] - grp[b].site[1]) / 2);
      const t = Math.min(1, Math.max(0, (spread - R) / (0.5 * R)));
      z = Math.max(z, 1 + (Math.min(ZROOM, R / Math.max(room, 1)) - 1) * t);
    }
    // Cada cámara: el centro de todos para los del medio; la de su grupo para los que están lejos.
    const kz = k / zoom, views = new Map();
    for (const G2 of grp) {
      G2.poly = far ? cellPoly(G2.site, grp.filter(o => o !== G2).map(o => o.site)) : [];
      let camX = cx, camY = cy;
      if (G2.src !== 'c') {
        const t = Math.min(1, Math.max(0, (G2.d - R) / (0.5 * R))), c = cellCenter(G2.poly, G2.site);
        const qx = G2.site[0] + (c[0] - G2.site[0]) * t, qy = G2.site[1] + (c[1] - G2.site[1]) * t;
        camX = G2.gx - (qx - CX) / kz; camY = G2.gy - (qy - CY) / kz;
      }
      const v = views.get(G2.src) || { src: G2.src, x: camX, y: camY, polys: [] };
      v.polys.push(G2.poly);
      views.set(G2.src, v);
    }
    return { far, z, cx, cy, grp, views: [...views.values()] };
  }

  function cameras(dt, cx, cy) {
    const C = G.Camera;
    L = layout();
    const lum = players.some(p => p && !p.dead && p.orbBuff && p.orbBuff.luminous > 0);   // Luminosfera: se ve más campo
    C.zoomTo = Math.max(L ? L.z : 1, lum ? 1.35 : 1);
    if (!L || !L.far) { C.follow(L ? L.cx : cx, L ? L.cy : cy, dt); camAt.clear(); return; }
    C.follow(L.cx, L.cy, dt);   // (la de siempre: avisos, temblores, lo que mira «la cámara»)
    for (const v of L.views) {   // cada vista con su cámara suavizada (como el follow de cada copia)
      const c = camAt.get(v.src) || [C.x - CX / C.scale + (v.x - L.cx) + CX / C.scale, C.y + (v.y - L.cy)];
      c[0] = G.U.damp(c[0], v.x, 9, dt); c[1] = G.U.damp(c[1], v.y, 9, dt);
      camAt.set(v.src, c);
      v.x = c[0]; v.y = c[1];
    }
    for (const k of [...camAt.keys()]) if (!L.views.some(v => v.src === k)) camAt.delete(k);
  }

  // ---- el HUD de cada uno en su esquina (main.c, ps.lc_hud): su barra (abajo) y su vida (encima) a la mitad ----
  const HX0 = 180, HY0 = 406, HW = 600, HH = 134, LX0 = 8, LY0 = 10, LW = 176, LH = 46, HS = 0.5;   // (píxeles de dibujo)
  const hudDraw0 = G.HUD.draw;
  G.HUD.draw = function (ctx, w, h, pl, st, ...rest) {
    if (!(on && players.length > 1)) return hudDraw0.call(this, ctx, w, h, pl, st, ...rest);
    // Sin la lista de compañeros (cada uno tiene la suya en su esquina) ni «Ver a un compañero».
    const mates = Object.getOwnPropertyDescriptor(G.Coop, 'mates'), puppets = G.Coop.puppets;
    Object.defineProperty(G.Coop, 'mates', { get: () => [], configurable: true });
    G.Coop.puppets = () => [];
    const h0 = ps.now();
    frameNo++;
    try {
      players.forEach((p, i) => {
        if (!p) return;
        // ponytail: con 3 o 4, el HUD de los jugadores 2-4 se repinta un fotograma sí y otro no (el de antes vale);
        // si la medida ([núcleo] … hud) dice que sobra, se quita.
        if (i && players.length >= 3 && hudCv[i] && (frameNo + i) % 2) return;
        const cv = hudCv[i] || (hudCv[i] = Object.assign(document.createElement('canvas'), { width: ps.W, height: ps.H }));
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ps.W, ps.H);
        c.setTransform(ps.W / w, 0, 0, ps.H / h, 0, 0);
        hudI = i;
        hudDraw0.call(this, c, w, h, p, st, ...rest);
        c.setTransform(1, 0, 0, 1, 0, 0);
      });
    } finally { Object.defineProperty(G.Coop, 'mates', mates); G.Coop.puppets = puppets; hudI = 0; hudMs += ps.now() - h0; }
    // A la pantalla, del HUD del 1, lo que es de todos (experiencia del equipo, tiempo, jefes, flechas): todo menos su
    // barra y su vida. Luego la esquina de cada uno, con un borde de su color.
    const kx = w / ps.W, ky = h / ps.H, cv0 = hudCv[0];
    ctx.drawImage(cv0, 0, 0, ps.W, LY0, 0, 0, w, LY0 * ky);
    ctx.drawImage(cv0, LX0 + LW, LY0, ps.W - LX0 - LW, LH, (LX0 + LW) * kx, LY0 * ky, (ps.W - LX0 - LW) * kx, LH * ky);
    ctx.drawImage(cv0, 0, LY0 + LH, ps.W, HY0 - LY0 - LH, 0, (LY0 + LH) * ky, w, (HY0 - LY0 - LH) * ky);
    const W2 = ps.W, H2 = ps.H, bw = HW * HS, bh = HH * HS, lw = LW * HS, lh = LH * HS, M = 8;
    players.forEach((p, i) => {
      if (!p || (cards && cards[i] && !cards[i].done)) return;   // (con su carta abierta, su esquina no sale)
      const right = i % 2 === 1, bottom = i < 2;
      const bx = right ? W2 - bw - M : M, by = bottom ? H2 - bh - M : M + lh + 3, ly = bottom ? by - lh - 3 : M;
      for (const [sx, sy, sw, sh, dx, dy] of [[HX0, HY0, HW, HH, bx, by], [LX0, LY0, LW, LH, bx, ly]]) {
        const dw = sw * HS, dh = sh * HS;
        ctx.fillStyle = 'rgba(10,20,48,0.5)'; ctx.fillRect(dx * kx, dy * ky, dw * kx, dh * ky);
        ctx.strokeStyle = COLORS[i]; ctx.lineWidth = 2; ctx.strokeRect(dx * kx - 1, dy * ky - 1, dw * kx + 2, dh * ky + 2);
        ctx.drawImage(hudCv[i], sx, sy, sw, sh, dx * kx, dy * ky, dw * kx, dh * ky);
      }
    });
  };

  globalThis.psCore = {
    // Fuera de la partida (resumen, menús): se apaga solo.
    get on() {
      if (on && (G.Game.state === 'ui' || G.Game.state === 'over')) {
        on = false; ps.core_pads && ps.core_pads(0);
        for (const p of shots.values()) G.Projectiles.remove(p);
        shots.clear(); fields.clear(); drops.clear(); cards = null; L = null; camAt.clear(); G.Camera.zoomTo = 1;
        hzs.clear(); G.Hazards.clear(); enemies.clear();
        if (globalThis.psCoreCards) psCoreCards(null);
        const PU = G.Pickups.all(); for (let i = PU.length - 1; i >= 0; i--) if (PU[i].core) PU.splice(i, 1);
        ps.log('[núcleo] fuera: ' + kills + ' derrotados');
      }
      return on;
    },
    // «Jugar con el núcleo» (Desarrollador): las partidas normales (no las del cooperativo online) van por aquí.
    get always() { try { return localStorage.getItem('ps5.core') === '1'; } catch (e) { return false; } },
    setAlways(v) { try { if (v) localStorage.setItem('ps5.core', '1'); else localStorage.removeItem('ps5.core'); } catch (e) { /* nada */ } },
    // La prueba (Desarrollador → «Núcleo en C»): marca la partida (no va al ranking).
    start() {
      if (!G.DB.save || !G.DB.save.partner) { G.UI.toast('Elige antes tu Pokémon'); return; }
      G.UI.hideAll();
      if (globalThis.psUiClose) psUiClose();
      starting = true;
      try { G.Game.startRun(); } finally { starting = false; }
      G.Game.debugTime(0);   // (marca la partida: no cuenta para el ranking)
      psCore.begin();
    },
    // Tras G.Game.startRun: la partida, al núcleo.
    begin() {
      players.length = 0; enemies.clear(); shots.clear(); fields.clear(); drops.clear(); cards = null; L = null; camAt.clear();
      t = 0; spawnT = 0; kills = 0; bosses = 0; later.length = 0; seenOrb.clear(); orbSel.length = 0; biome = 0; hzs.clear(); G.Hazards.clear();
      stashed = null; hzColor.clear(); propMiss = 0; wasArena = false; nextBeat = 60;
      if (globalThis.psWorldSeed) seed = psWorldSeed();   // (boot.js: el mundo del menú se queda sin pasar por World.reset)
      ps.core_reset(seed, G.World.biome, G.Halloween && G.Halloween.on ? 1 : 0, G.Halloween && G.Halloween.inRun ? 1 : 0);
      addPlayer(0, G.Game.player);
      if (ps.core_pads) ps.core_pads(1);
      on = true;
      ps.log('[núcleo] en marcha: semilla ' + seed + ', bioma ' + G.World.biome);
    },
    update(dt, game) {
      if (cards) { cardsInput(); for (const p of players) p && p.anim.update(dt); G.FX.update(dt); return; }   // (la partida espera)
      if (G.Judgment.cinematic) {   // la animación de la Sentencia: todo lo demás, parado
        G.Judgment.cineTick(dt);
        for (const p of players) p && p.anim.update(dt);
        G.World.update(dt, G.Camera); G.FX.update(dt); G.Audio.music(G.Judgment.music);
        return;
      }
      t += dt;
      // Mandos nuevos (✕ en otro mando: main.c lo apunta en pads[]).
      const bits = ps.core_pads ? ps.core_pads(1) : 1;
      for (let i = 1; i < 4; i++) {
        if (!(bits & 1 << i) || players[i]) continue;
        const mon = G.U.pick(G.DEX.filter(m => G.SPRITE_META[m.dex]));
        const p = new G.Player(mon, {}, false), p0 = players[0];
        p.x = p0.x + 30 * i; p.y = p0.y;
        p.setAbility(G.Mons.abilityOf(mon.dex).id);   // (lo que fija al empezar, en su G.Player; addPlayer lo pasa)
        addPlayer(i, p);
      }
      for (let i = 0; i < players.length; i++) {
        const p = players[i], pad = ps.pad(i) || {}, [ax, ay] = stick(pad.lx || 0, pad.ly || 0), [rx, ry] = stick(pad.rx || 0, pad.ry || 0);
        ps.core_input(i, ax, ay, rx, ry);
        ps.core_view(i, G.Camera.outerRadius());
        // Cambiar de ataque: al 1 ya se lo cambia el juego (handleKeys: L1/R1, Q/E, números); a los demás, aquí.
        const b = pad.b | 0, tap = bit => (b & 1 << bit) && !(held[i] & 1 << bit);
        if (i && p.slots.length > 1 && (tap(BT_L1) || tap(BT_R1))) p.cycle(tap(BT_R1) ? 1 : -1);   // (la Cinta Elección no deja)
        if (i && tap(BT_X)) useOrb(i);
        if (i && tap(BT_Y)) nextOrb(i);
        if (p.active !== sent[i]) { sent[i] = p.active; ps.core_active(i, p.active); }
        held[i] = b;
      }
      // El reloj de la partida (el HUD, el spawner), el bioma cada 4 min y los enemigos que tocan (G.Spawner).
      if (game) game.setTime(t); else G.Game.debugTime(t);
      if (t >= nextBeat && players[0]) {   // (el latido del ranking, cada minuto, como Game.update)
        nextBeat += 60;
        const j = G.Judgment.summary();
        G.Ranking.beat({ t: Math.floor(t), lv: players[0].level, kills: players[0].kills, dmg: j ? j.dmg : 0 });
      }
      const b4 = Math.floor(t / 240);
      if (b4 !== biome && !G.Rift.inArena && !G.Judgment.active) {
        biome = b4;
        G.World.setBiome(G.Tiles.runBiome(b4)); ps.core_biome(G.World.biome);
        G.Audio.sfx('biome'); G.Spawner.say('— ' + G.World.biomeName() + ' —', 3);
        if (players[0]) G.FX.ring(players[0].x, players[0].y, 10, G.Camera.outerRadius(), '#ffffff', 0.7, 6);
      }
      const all = players.filter(Boolean), p0 = players[0];
      if (all.length) G.Spawner.update(dt, all, t);
      // Grieta, Sentencia y eventos (del juego): el 1 con el paso entero; los demás, con 0 (que también entren en la
      // grieta, toquen a Arceus o no salgan de su arena, sin que el reloj corra dos veces).
      if (p0) {
        const bonds0 = p0.bonds;
        G.Rift.update(dt, p0, t);
        if (p0.bonds > bonds0) for (const p of all) if (p !== p0) p.bonds += p0.bonds - bonds0;   // (la grieta: un vínculo para cada uno)
        G.Judgment.update(dt, p0, t);
        for (const p of all) if (p !== p0) { G.Rift.update(0, p, t); G.Judgment.update(0, p, t); }
        G.Events.update(dt, all, t);
      }
      if (G.Rift.inArena !== wasArena || (G.Rift.inArena && (arenaLog += dt) >= 1)) {   // (diagnóstico de la grieta)
        const A = G.Rift.arena, boss = A && G.EnemyMgr.get(A.bossId);
        ps.log('[núcleo] grieta' + (G.Rift.inArena !== wasArena ? (G.Rift.inArena ? ': dentro' : ': fuera') : '') + ' · ' + all.map(p => Math.round(p.x) + ',' + Math.round(p.y) + ' ' + Math.round(p.hp) + (p.dead ? ' caído' : '') + (p.inLiquid ? ' charco' : '')).join(' / ') +
               (A ? ' · arena ' + A.type + ' (' + A.phase + ', ' + Math.round(A.t) + ' s) en ' + Math.round(A.x) + ',' + Math.round(A.y) + ', legendario ' + (boss ? Math.round(boss.hp) + ' en ' + Math.round(boss.x) + ',' + Math.round(boss.y) : 'no está') : '') + ' · bioma ' + G.World.biome);
        wasArena = G.Rift.inArena; arenaLog = 0;
      }
      for (const e of enemies.values()) if (e.arceus) e.update(dt);   // (el blanco de Arceus va donde está él)
      ps.core_mode(G.Rift.inArena || G.Judgment.active ? 1 : 0, G.Judgment.active ? 1 : 0, G.Judgment.dmgK(), G.Judgment.shielded ? 1 : 0);
      // El clima del juego (y Sequía, Llovizna…: el suyo al empezar y cada 3 min, si no hay otro), al núcleo.
      // ponytail: sin el daño de la arena y la nieve (fase 5).
      { const all0 = G.EnemyMgr.all; G.EnemyMgr.all = () => []; G.Weather.update(dt, t, null); G.EnemyMgr.all = all0; }   // (lo que daña lo hace el núcleo)
      for (const p of players) if (p && !p.dead && p.abil && p.abil.summon && (p.sumT = (p.sumT || 0) - dt) <= 0) {
        p.sumT = 180;
        if (!G.Weather.current) G.Weather.debugStart(p.abil.summon, 60);
      }
      { const cur = G.Weather.current, mt = cur && Object.entries(G.Weather.KINDS[cur.kind].mult)[0];
        ps.core_weather(cur ? WXK.indexOf(cur.kind) : 0, cur ? (G.Weather.mult(mt[0]) - 1) / (mt[1] - 1) : 0); }
      writeBack();
      const t0 = ps.now();
      ps.core_step(dt);
      stepMs += ps.now() - t0; frames++;
      events();
      syncProps();

      // Lo que dice el núcleo, a los que se pintan.
      const b = new Float64Array(ps.core_state()), np = b[0], ne = b[1], npr = b[2], nfi = b[3], npu = b[4];
      const PL = ps.CORE_PL, EN = ps.CORE_EN, PR = ps.CORE_PR, FI = ps.CORE_FI, PU = ps.CORE_PU;
      let o = 9, cx = 0, cy = 0, live = 0, coins = 0, t1 = 0, t10 = 0, kos = 0, candy = 0;
      // La experiencia y el nivel son del equipo: en el HUD (el del 1).
      if (players[0]) { const p0 = players[0]; p0.level = b[5]; p0.xp = b[6]; p0.xpNext = b[7]; for (const p of players) if (p) p.level = b[5]; }
      for (let i = 0; i < np; i++, o += PL) {
        const p = players[i];
        if (!p) continue;
        p.x = b[o]; p.y = b[o + 1]; p.aim = b[o + 2]; p.moveAngle = b[o + 3]; p.walking = !!b[o + 4]; p.inLiquid = !!b[o + 5];
        p.dead = !b[o + 6]; p.hp = b[o + 7]; p.maxHp = b[o + 8]; p.invuln = b[o + 9];
        coins += b[o + 11]; t1 += b[o + 12]; t10 += b[o + 13]; kos += b[o + 14];
        p.orbs = [0, 1, 2, 3].map(k => (b[o + 16 + 2 * k] >= 0 ? { id: G.Orbs.LIST[b[o + 16 + 2 * k]].id, n: b[o + 17 + 2 * k] } : null));
        p.orbCd = b[o + 24]; p.orbBuff = { focus: b[o + 25], luminous: b[o + 26], quick: b[o + 27] };
        // Poder de altar (el anillo de su color), y caramelos (al acabar, en la partida del 1: fase 5d).
        p.power = b[o + 28] >= 0 ? { def: G.Interact.POWERS[b[o + 28]], t: b[o + 29], dur: 25 } : null;
        candy += b[o + 30];
        { let k = 31; for (const bf in p.buffs) p.buffs[bf].n = b[o + k++]; }   // (mejoras: sus arcos a los pies y su etiqueta en el HUD)
        if (p._orbNew) { p.orbNew = { i: p.orbs.findIndex(s => s && s.id === p._orbNew), at: performance.now() }; p._orbNew = null; }
        if (p.flash > 0) p.flash -= dt;
        if (p.attackFace > 0) p.attackFace -= dt;
        p.anim.update(dt);
        if (!p.dead) face(p.anim, p.attackFace > 0 || !p.walking ? p.aim : p.moveAngle, p.walking, p.baseSpd);
        if (!p.dead) { cx += p.x; cy += p.y; live++; }
      }
      if (live) { cx /= live; cy /= live; } else if (players[0]) { cx = players[0].x; cy = players[0].y; }
      const seen = new Set();
      for (let i = 0; i < ne; i++, o += EN) {
        const e = enemies.get(b[o]);
        if (!e) continue;
        seen.add(b[o]);
        e.x = b[o + 2]; e.y = b[o + 3]; e.hp = b[o + 8]; e.maxHp = b[o + 9];
        e.phase = PHASE[b[o + 6]] || 'walk'; e.shield = b[o + 10]; e.jumpLift = b[o + 11]; e.sleepT = b[o + 13]; e.stunT = b[o + 14];
        e.burn = b[o + 15]; e.poison = b[o + 16];
        if (b[o + 12]) (e.ai = e.ai || {}).fury = true;
        if (e.phase === 'fuse') e.flash = Math.floor(t * 10) % 2 ? 0.05 : 0;   // (la mecha del kamikaze parpadea)
        const vx = b[o + 4], vy = b[o + 5], moving = Math.abs(vx) + Math.abs(vy) > 2;
        if (e.flash > 0) e.flash -= dt;
        e.anim.update(dt);
        face(e.anim, moving ? Math.atan2(vy, vx) : Math.atan2(cy - e.y, cx - e.x), moving, e.spd);
      }
      for (const [id, e] of enemies) {   // caídos: se desvanecen; los que ya no están (el ladrón que se escapa), fuera
        if (seen.has(id)) continue;
        if (e.dead && (e.fade -= dt) > 0) { e.anim.update(dt); continue; }
        enemies.delete(id);
      }
      const now = new Set();
      for (let i = 0; i < npr; i++, o += PR) {
        const id = b[o];
        now.add(id);
        let p = shots.get(id);
        if (!p) {
          const mv = b[o + 2];
          p = G.Projectiles.spawn({ x: b[o + 3], y: b[o + 4], r: b[o + 7], friendly: !!b[o + 8], orb: !!b[o + 9], life: Infinity,
                                    color: col(mv), vis: mv >= 0 ? vis(mv) : G.VFX.forType('normal') });
          shots.set(id, p);
        }
        p.x = b[o + 3]; p.y = b[o + 4]; p.vx = b[o + 5]; p.vy = b[o + 6]; p.r = b[o + 7]; p.t += dt;
        if (p.orb) p.oa = Math.atan2(p.y - (players[b[o + 1]] || p).y, p.x - (players[b[o + 1]] || p).x);
      }
      for (const [id, p] of shots) if (!now.has(id)) { G.Projectiles.remove(p); shots.delete(id); }
      fields.clear();
      for (let i = 0; i < nfi; i++, o += FI) {
        fields.set(b[o], { kind: FK[b[o + 1]], move: b[o + 3], x: b[o + 4], y: b[o + 5], r: b[o + 6], t: b[o + 7], p: b[o + 8] });
      }
      // Lo del suelo: en la lista de G.Pickups (la pinta drawScene).
      const L = G.Pickups.all(), here = new Set();
      for (let i = 0; i < npu; i++, o += PU) {
        const id = b[o];
        here.add(id);
        let d = drops.get(id);
        if (!d) {
          const kind = PK[b[o + 1]], v = b[o + 5];   // (objeto y esfera: su id, para el icono y el color)
          d = { kind, value: kind === 'item' ? (G.Items.LIST[v] || {}).id : kind === 'sphere' ? (G.Orbs.LIST[v] || {}).id : v, vx: 0, vy: 0, pulled: false, core: true };
          drops.set(id, d); L.push(d);
        }
        d.kind = PK[b[o + 1]]; d.x = b[o + 2]; d.y = b[o + 3]; d.t = b[o + 4];
      }
      if (drops.size !== here.size) {   // recogidos: fuera de los dos sitios
        for (const [id, d] of drops) if (!here.has(id)) { d.gone = true; drops.delete(id); }
        for (let i = L.length - 1; i >= 0; i--) if (L[i].gone) L.splice(i, 1);
      }
      // Los avisos (rayos y zonas): en la lista de G.Hazards, que los pinta.
      const nhz = b[o++], HL = G.Hazards.all, hereH = new Set();
      for (let i = 0; i < nhz; i++, o += ps.CORE_HZ) {
        const id = b[o];
        hereH.add(id);
        let h = hzs.get(id);
        if (!h) {
          const type = TYPES[b[o + 11]], fl = b[o + 12];
          h = { kind: b[o + 1] ? 'beam' : 'zone', x: b[o + 2], y: b[o + 3], r: b[o + 4], angle: b[o + 5], len: b[o + 6], w: b[o + 7],
                delay: b[o + 9], type, boom: !!(fl & 1), vis: fl & 2 ? 'pillar' : null, end: 0.3, core: true,
                color: hzColor.get(id) || (fl & 1 ? '#ff7b3d' : fl & 2 ? '#ffe9a0' : G.U.TYPE_COLOR[type] || '#ff7a9e') };
          hzColor.delete(id);
          hzs.set(id, h); HL.push(h);
        }
        h.t = b[o + 8]; h.hit = !!b[o + 10];
      }
      if (hzs.size !== hereH.size) {
        for (const [id, h] of hzs) if (!hereH.has(id)) { h.gone = true; hzs.delete(id); }
        for (let i = HL.length - 1; i >= 0; i--) if (HL[i].gone) HL.splice(i, 1);
      }
      // Lo recogido por todos, en el 1 (al acabar se guarda en su partida).
      if (players[0]) { const p0 = players[0]; p0.coins = coins; p0.t1 = t1; p0.t10 = t10; p0.kills = kos; p0.candy = candy; p0.bosses = bosses; }

      snapshot();
      G.Audio.music(G.Judgment.active ? G.Judgment.music : G.Rift.inArena ? 'rift' : G.EnemyMgr.bossAlive() ? 'boss' : G.BIOME_MUSIC[biome % G.BIOME_MUSIC.length]);
      // Todos caídos: tras ver caer al último, se acaba (el resumen de siempre). En la grieta, sólo os echa (G.Rift).
      if (players.length && !live && !G.Rift.inArena) { if ((downT += dt) > 1.6) { downT = 0; ps.log('[núcleo] caen todos'); if (game) game.endRun(true); else G.Game.quit(); return; } } else downT = 0;
      cameras(dt, cx, cy);
      G.World.update(dt, G.Camera);
      G.FX.update(dt);
      if ((logT += dt) >= 5) {
        ps.log('[núcleo] nivel ' + b[5] + ', ' + np + ' jugadores (' + players.map(p => Math.round(p.hp) + '/' + Math.round(p.maxHp)).join(' ') + '), ' + ne +
               ' enemigos, ' + npr + ' proyectiles, ' + nfi + ' campos, ' + npu + ' en el suelo, ' + kills + ' derrotados, ' + coins + ' monedas, paso ' + (stepMs / frames).toFixed(2) +
               ' ms, mundo ' + (drawMs / frames).toFixed(2) + ' ms (' + (L && L.far ? L.views.length : 1) + ' vistas), hud ' + (hudMs / frames).toFixed(2) + ' ms');
        logT = 0; stepMs = 0; frames = 0; drawMs = 0; hudMs = 0;
      }
    },
    skip(sec) { t += sec; },   // (pruebas: adelanta el reloj de la partida)
    drawList() {
      return [...players, ...[...enemies.values()].filter(e => !e.arceus), ...[...fields.values()].map(fieldDrawable),
              G.Rift.drawable(), G.Judgment.drawable(), ...G.Events.drawables()].filter(Boolean);
    },
    // Lo que se pinta del mundo: una vez por cámara (la del centro y la de cada grupo lejano), recortado a su zona
    // (los polígonos de sus sitios), con la cámara del tamaño de la caja de la zona (sólo se pinta lo que se ve).
    views(w, h) {
      if (!L || !L.far) return [{ full: true }];
      const kx = w / ps.W, ky = h / ps.H;
      return L.views.map(v => {
        const polys = v.polys.filter(p => p.length > 2).map(p => p.map(([x, y]) => [x * kx, y * ky]));
        const xs = polys.flat().map(q => q[0]), ys = polys.flat().map(q => q[1]);
        return { polys, x: v.x, y: v.y, box: [Math.max(0, Math.floor(Math.min(...xs))), Math.max(0, Math.floor(Math.min(...ys))), Math.min(w, Math.ceil(Math.max(...xs))), Math.min(h, Math.ceil(Math.max(...ys)))], w, h };
      }).filter(v => v.polys.length);
    },
    viewBegin(ctx, v) {
      drawT = ps.now();
      if (v.full) return;
      const C = G.Camera, [bx0, by0, bx1, by1] = v.box;
      v.saved = [C.x, C.y, C.w, C.h];
      ctx.save();
      ctx.beginPath();
      for (const p of v.polys) { ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); }
      ctx.clip();
      ctx.translate(bx0, by0);
      const left = v.x - v.w / C.scale / 2, top = v.y - v.h / C.scale / 2;
      C.w = (bx1 - bx0) / C.scale; C.h = (by1 - by0) / C.scale;
      C.x = left + bx0 / C.scale + C.w / 2; C.y = top + by0 / C.scale + C.h / 2;
    },
    viewEnd(ctx, v) {
      drawMs += ps.now() - drawT;
      if (v.full) return;
      const C = G.Camera;
      [C.x, C.y, C.w, C.h] = v.saved;
      ctx.restore();
    },
    // Encima de todo: la línea entre cámaras distintas (la mediatriz entre sus sitios, como main.c).
    overlay(ctx, w, h) {
      if (!L || !L.far) return;
      const kx = w / ps.W, ky = h / ps.H, border = (a, b) => (Math.abs(a - b) < 0.5);
      ctx.save();
      ctx.strokeStyle = '#f4f8ff'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (const g of L.grp) {
        const p = g.poly;
        for (let i = 0; i < p.length; i++) {
          const a = p[i], b = p[(i + 1) % p.length];
          if ((border(a[0], b[0]) && (border(a[0], 0) || border(a[0], ps.W))) || (border(a[1], b[1]) && (border(a[1], 0) || border(a[1], ps.H)))) continue;
          // ¿al otro lado hay otra cámara? (el sitio más cercano al punto medio, sin contar el suyo)
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          let o = null, od = Infinity;
          for (const q of L.grp) { if (q === g) continue; const d = Math.hypot(q.site[0] - mx, q.site[1] - my); if (d < od) { od = d; o = q; } }
          if (!o || o.src === g.src) continue;
          ctx.moveTo(a[0] * kx, a[1] * ky); ctx.lineTo(b[0] * kx, b[1] * ky);
        }
      }
      ctx.stroke();
      ctx.restore();
    },
  };
})();
