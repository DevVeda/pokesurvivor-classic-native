/* ============ game.js — flujo del juego y bucle principal ============
 *
 *   login ──> test de personalidad ──> menú ──> run ──> resumen ──> menú
 *                (sólo la 1ª vez)          │
 *                                          ├─ Pokémon (colección)
 *                                          ├─ Mejoras
 *                                          └─ Gacha
 *
 * Estados del bucle: 'ui' (menús, con el mundo de fondo), 'playing',
 * 'levelup', 'paused', 'over'.
 *
 * Cooperativo (G.Coop.active): el anfitrión lleva enemigos, objetos y
 * experiencia; cada uno su Pokémon. La pausa no para el juego, las cartas de
 * nivel esperan a que elijan todos y un compañero caído se levanta si otro
 * se queda a su lado. Ver net/coop.js.
 */
G.Game = (() => {
  let cv, ctx, dpr = 1, w = 0, h = 0;
  let state = 'ui';
  let time = 0, last = 0, pendingLevels = 0;
  let nextBeat = 60;        // (ranking por servidor propio: cómo va la partida, cada minuto)
  let pl = null;
  let caught = [];          // shinies conseguidos en esta run
  let biome = -1;

  const st = { get time() { return time; } };
  // Modo Endless (11-11-2026): sin Sentencia de Arceus; desde el 30:00 todo escala sin tope. Sólo en solitario.
  let endless = false;

  // ---------------- arranque ----------------

  function init() {
    cv = document.getElementById('game');
    ctx = cv.getContext('2d');
    resize();
    addEventListener('resize', resizeSoon);
    // iPhone: al girarlo o al abrirlo desde la pantalla de inicio avisa del
    // cambio ANTES de recolocar la página, y con esas medidas viejas el juego
    // se quedaba estirado. Se vuelve a medir cuando el lienzo cambia de verdad
    // (ResizeObserver) y, por si acaso, un poco después de cada aviso.
    addEventListener('orientationchange', resizeSoon);
    if (window.visualViewport) visualViewport.addEventListener('resize', resizeSoon);
    if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(cv);
    G.Touch.init(cv);
    // En móvil: al cambiar de app o girarlo en vertical, la partida se pausa.
    document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
    // En el móvil, bajar la cortina de avisos o abrir otra app por encima a veces
    // sólo quita el foco a la página (sin ocultarla): también se pausa.
    addEventListener('blur', () => { if (G.Touch.active) autoPause(); });
    G.RunUI.wirePause(() => { state = 'playing'; G.UI.hideAll(); }, quitRun);
    Backdrop.init();
    // Halloween empieza o acaba con el juego abierto (o llega la hora de la web, al
    // abrir): en los menús, el mundo de fondo y la música cambian al momento. (Una
    // partida sigue como empezó: systems/halloween.js, runStart.)
    G.Halloween.onChange(() => {
      if (state !== 'ui') return;
      Backdrop.restore();
      const t = G.Audio.track;
      if (t) { G.Audio.music(null); G.Audio.music(t); }
      // (con la tienda, el gacha u otra pantalla encima, no: se cerraría; el menú
      // se rehace al volver a él)
    });
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function resize() {
    // Resolución interna como mucho ×1,5: en pantallas ×2 dibujar el doble de
    // píxeles era de lo que más costaba, y con el pixel art no se nota.
    const d = Math.min(1.5, window.devicePixelRatio || 1);
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) return;
    G.Touch.resetSafe();
    if (cw === w && ch === h && d === dpr && cv.width === Math.round(cw * d) && cv.height === Math.round(ch * d)) { checkOrientation(); return; }
    dpr = d; w = cw; h = ch;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    G.Camera.resize(w, h, dpr);
    checkOrientation();
  }
  let resizeTs = [];
  function resizeSoon() {
    resize();
    resizeTs.forEach(clearTimeout);
    resizeTs = [100, 350, 800].map(ms => setTimeout(resize, ms));
  }

  /*
   * Botón «atrás» del móvil (o el gesto de volver, también en el iPhone). Antes
   * te sacaba de la web: en plena partida se perdían sus monedas y no contaba
   * para el ranking. Mientras juegas o estás en una pantalla del menú hay una
   * entrada de más en el historial (needsTrap); «atrás» la gasta y aquí se
   * decide: en partida, pausa; en una pantalla del menú, vuelve al menú (o
   * cierra la ventana de encima). En el menú principal no hay entrada de más:
   * «atrás» sale de la web, como siempre.
   */
  let trapped = false;
  // @step controls/trap decision "Atrás del móvil"
  // needsTrap añade entrada al historial en partida; en popstate: pausa. (En los menús, «atrás» es de native/shim/ui.js.)
  // @next databack "pantalla secundaria"
  function needsTrap() { return state !== 'ui'; }
  function ensureTrap() {
    if (trapped || !needsTrap() || !window.history || !history.pushState) return;
    try { history.pushState({ ps: 1 }, ''); trapped = true; } catch (e) { /* nada */ }
  }
  // @step controls/trap
  // @step pause/back event "Botón atrás"
  // popstate en partida pausa (trampa de historial).
  // @next coopq
  addEventListener('popstate', () => {
    trapped = false;                          // (en cuanto haga falta, el bucle vuelve a poner otra)
    if (state !== 'ui') {
      // En partida: pausa (en grupo abre la pausa sin parar a los demás). Con las
      // cartas, la pausa o el resumen abiertos, no pasa nada: te quedas donde estás.
      if (state === 'playing' && !G.Judgment.cinematic && !G.UI.isOpen('scr-pause')) togglePause();
      return;
    }
    // (en los menús, «atrás» lo lleva native/shim/ui.js)
  });

  /** Móvil en vertical: aviso de girarlo (y pausa). */
  // @step pause/auto
  function checkOrientation() {
    const portrait = G.Touch.active && innerHeight > innerWidth;
    const el = document.getElementById('rotate');
    if (!el) return;
    if (portrait && !document.getElementById('rotate-ico').innerHTML) document.getElementById('rotate-ico').innerHTML = G.Icons.html('phone', 48);
    el.classList.toggle('hidden', !portrait);
    if (portrait) autoPause();
  }

  /** Pausa sola (sólo en solitario: en grupo los demás siguen). */
  // @step pause/auto event "Autopausa"
  // visibilitychange oculto, blur en táctil o móvil en vertical; solo en solitario.
  // @next screen "solo"
  function autoPause() {
    G.Touch.reset();
    if (state === 'playing' && !G.Coop.active) { state = 'paused'; G.RunUI.showPause(); }
  }

  // Grupo: quién está eligiendo fusión u objeto (todo parado), y el anfitrión
  // que se ha ido de la pestaña o no responde (coopApi.hold / away).
  let holdBy = [];
  let awayBy = null;
  const awayText = () => 'Pausa: esperando a ' + awayBy + ' (anfitrión)…';

  /** Pausa/continúa (tecla Esc o P, o el botón de pausa del móvil). */
  // @step run/pause screen "Pausa"
  // Esc/P/Start del mando/botón táctil/atrás del móvil; autopausa al ocultar la pestaña o girar a
  // vertical.
  // @screen scr-pause
  // @sub pause
  // @next loop "Continuar"
  // @next dead "Abandonar"
  // @step pause/input event "Esc / P / Start"
  // handleKeys: Esc o P; el mando mapea Start/Back a 'escape'; botón táctil de pausa.
  // @next coopq
  // @step pause/coopq decision "¿Cooperativo?"
  // En grupo la pausa no para el juego (tu Pokémon queda frozen) y muestra pause-coop.
  // @next screen
  function togglePause() {
    // En grupo la pausa no para el juego (los demás siguen jugando).
    if (G.Coop.active) {
      if (state !== 'playing') return;
      if (G.UI.isOpen('scr-pause')) G.UI.hide('scr-pause');
      else { G.RunUI.showPause(true); G.Audio.sfx('pause'); }
      return;
    }
    if (state === 'playing') { state = 'paused'; G.RunUI.showPause(); G.Audio.sfx('pause'); }
    else if (state === 'paused') { state = 'playing'; G.UI.hideAll(); }
  }

  // ---------------- run ----------------

  /** @param coop  { seed, host, members } para una partida en grupo */
  // @step run/start event "startRun"
  // Fija endless=!coop&&opts.endless; resetea FX/enemigos/Spawner/Rift/Judgment/Weather/World (seed
  // aleatoria o de la sala), crea G.Player con perks de mejoras, movimientos iniciales, pide sello de
  // ranking (newSeal/runStarted) y state='playing'.
  // @next loop
  // @step judge/mode decision "¿Endless?"
  // endless solo en solitario (startRun con opts.endless).
  // @next at30 "normal"
  // @next endless "Endless"
  function startRun(coop = null, opts = {}) {
    holdBy = []; awayBy = null;
    endless = !coop && !!opts.endless;
    // Halloween (systems/halloween.js): lo que sea al empezar vale toda la partida (en grupo, lo dice el anfitrión).
    G.Halloween.runStart(coop ? coop.hw : undefined);
    const save = G.DB.save;
    // Con su naturaleza aplicada (una copia: ver systems/mons.js).
    const mon = G.Mons.monFor(save.partner);
    const perks = G.Upgrades.perks(G.DB.upgradesOf(mon.dex));

    G.UI.hideAll();
    G.FX.clear();
    G.Projectiles.clear();
    G.Combat.clearFields();
    G.EnemyMgr.clear();
    G.Pickups.clear();
    G.Spawner.reset();
    G.Rift.reset();
    G.Judgment.reset();
    G.Events.reset();
    G.Weather.reset();
    G.Path.clear();
    G.Hazards.clear();
    G.World.reset(coop ? coop.seed : Math.floor(Math.random() * 1e6));
    G.World.setBiome(G.Tiles.runBiome(0), true);
    biome = 0;
    time = 0; pendingLevels = 0; nextBeat = 60;
    runReal = performance.now(); tampered = false;
    // En grupo, la velocidad la pone el anfitrión para todos (cfg.turbo: el turbo de los trucos de la app nativa); si no,
    // cada uno corría a la suya. Sola, la de debugSpeed.
    speedK = coop ? G.U.clamp(+coop.turbo || 1, 1, 4) : soloK;
    if (speedK > 1) tampered = true;

    pl = new G.Player(mon, perks, !!save.partnerShiny && G.DB.ownsShiny(mon.dex));
    G.Orbs.reset();
    pl.setAbility(G.Mons.abilityOf(mon.dex).id);
    pl.anim.skin = G.Skins.worn(save, mon.dex) || null;      // su disfraz (core/skins.js)
    pl.candy = 0;
    banked = { t1: 0, t10: 0, cn: 0 };
    caught = [];
    // Atajos: movimientos con hueco fijo (save.pbind[dex] = [id del 1, id del 2, ...]),
    // antes de aprender nada: addMove ya los coloca.
    (save.pbind && save.pbind[mon.dex] || []).forEach((id, i) => { if (id) pl.bind[id] = i; });
    pl.addMove(G.startMoveOf(mon.dex));
    // Mejora "Veto": movimientos que no quieres que te salgan.
    pl.banned = new Set((save.pban && save.pban[mon.dex] || []).slice(0, perks.bans));
    // Mejora "Repertorio": un segundo movimiento de ataque, el elegido con
    // "Segundo movimiento inicial" o, si no, al azar.
    if (perks.startMoves >= 2) {
      const pick2 = G.startMove2Of(mon.dex);
      const pool = G.Moves.poolFor(mon).filter(id => !pl.hasMove(id) && !pl.banned.has(id) && G.Moves.BY_ID[id].kind !== 'buff');
      if (pick2 && !pl.hasMove(pick2)) pl.addMove(pick2);
      else if (pool.length) pl.addMove(G.U.pick(pool));
      pl.setActive(0);
    }

    if (coop) {
      G.Coop.begin(coop, pl, coopApi);
      G.Social.setPlaying(true);
    }
    G.Camera.x = pl.x; G.Camera.y = pl.y; G.Camera.shake = 0;
    // Hojas de sprites locales: el compañero y los primeros enemigos.
    G.Sprites.preload([mon.dex], 8000, pl.shiny, pl.anim.skin || '');
    G.Audio.music(G.BIOME_MUSIC[0]);
    // Ranking: sube las marcas del histórico que estaban esperando (ver DEFER en ranking.js).
    // @step run/start
    G.Ranking.newSeal();          // el sello del ranking de esta partida (también el invitado)
    // @step run/start
    if (!coop || G.Coop.isHost) G.Ranking.runStarted();
    deathT = 0;

    state = 'playing';
  }

  // @step run/dead
  // @step pause/quit event "Abandonar"
  // btn-quit → quitRun: en coop G.Coop.leave; endRun(false).
  // @sub runend
  function quitRun() {
    if (G.Coop.active) G.Coop.leave();
    endRun(false);
  }

  /** Todos los jugadores de la partida (tú primero). */
  function everyone() { return G.Coop.active ? G.Coop.players() : [pl]; }

  /** Experiencia que hace falta para el siguiente nivel (cofres con candado). */
  function levelXp() {
    if (!pl) return 20;
    const k = (G.Coop.active ? G.Coop.xpFactor() : 1) * (pl.xpMul || 1);
    return Math.ceil((pl.xpNext - pl.xp + 1) / k);
  }

  // Destello de pantalla completa (viaje a la grieta).
  let flashT = 0, flashDur = 1, flashCol = '#fff';
  function flash(col, dur) { flashCol = col; flashDur = dur; flashT = dur; }

  function teamState() {
    return { time, level: pl.level, xp: pl.xp, xpNext: pl.xpNext, kills: pl.kills, bosses: pl.bosses, coins: pl.coins, t1: pl.t1, t10: pl.t10, cn: pl.candy || 0 };
  }
  function summary() { return { t: time, ki: pl.kills, bo: pl.bosses, co: pl.coins, lv: pl.level, t1: pl.t1, t10: pl.t10, cn: pl.candy || 0 }; }
  /** Tu resumen para el final de la partida (y para los compañeros, ver coop.js): ataques con su daño, objeto... */
  function mySum() {
    if (!pl) return null;
    return { dex: pl.dex, sh: !!pl.shiny, lv: pl.level, t: Math.floor(time), it: pl.item || null, sk: pl.anim.skin || '',
             mv: pl.moves.slice(0, 8).map(m => [m.id, m.lvl, Math.round(m.dealt || 0), Math.round(m.since || 0), m.evolved ? 1 : 0]) };
  }

  /**
   * Los tickets recogidos se guardan en cuanto los coges (como los shinies):
   * antes sólo al acabar, y si la pestaña se cerraba de golpe se perdían.
   * `banked` = los de esta partida que ya están en la partida guardada
   * (también los caramelos de Halloween, cn).
   */
  let banked = { t1: 0, t10: 0, cn: 0 };
  // @step loop/collect
  // @step meta/bank event "Tickets al recogerlos"
  // Tickets t1/t10 y caramelos pasan a la partida en cuanto se cogen (bankTickets + commit). Shiny
  // salvaje y rescate dan el Pokémon al momento.
  // @next run_end
  function bankTickets(save_ = true) {
    const sv = G.DB.save;
    if (!sv || !pl) return;
    sv.tickets = sv.tickets || { t1: 0, t10: 0 };
    const d1 = Math.max(0, pl.t1 - banked.t1), d10 = Math.max(0, pl.t10 - banked.t10), dc = Math.max(0, (pl.candy || 0) - banked.cn);
    if (!d1 && !d10 && !dc) return;
    sv.tickets.t1 += d1; sv.tickets.t10 += d10;
    // Caramelos de Halloween: a la Mochila (bag.candy), como los tickets, en cuanto se cogen.
    if (dc) { sv.bag = sv.bag || {}; sv.bag.candy = (sv.bag.candy || 0) + dc; }
    banked = { t1: pl.t1, t10: pl.t10, cn: pl.candy || 0 };
    // Guardar es escribir todo el guardado (un tirón al coger cada ticket): como mucho uno cada 5 s. Lo cogido ya está en
    // sv, así que el guardado del final de la partida (endRun) lo incluye aunque este no haya llegado.
    if (save_ && !bankT) bankT = setTimeout(() => { bankT = 0; G.DB.commit('run'); }, 5000);
  }
  let bankT = 0;

  /** Lo que el cooperativo necesita del juego (ver net/coop.js). */
  const coopApi = {
    team: teamState,
    summary,
    mySum,
    // Invitado: el anfitrión manda el reloj y lo del equipo.
    // @step coop/guest
    syncTeam(t) {
      if (Math.abs(t.time - time) > 0.4) time = t.time;
      if (t.level > pl.level) G.Audio.sfx('xp');
      pl.level = t.level; pl.xp = t.xp; pl.xpNext = t.xpNext;
      pl.kills = t.kills; pl.bosses = t.bosses; pl.coins = t.coins;
      if (t.t1 > pl.t1 || t.t10 > pl.t10) G.Audio.sfx('shiny');
      pl.t1 = t.t1 || 0; pl.t10 = t.t10 || 0;
      if (t.cn > (pl.candy || 0)) pl.candy = t.cn;
      bankTickets();
    },
    levelStart(level) {
      // (Si tenías abierta la elección de objeto, vuelve al terminar: afterLevelUp.)
      if (state === 'choice' && openItem && G.Coop.active) G.Coop.holdEnd();
      state = 'levelup';
      G.UI.hide('scr-pause');
      G.Audio.sfx('levelup');
      G.RunUI.showLevelUp(level, G.LevelUp.offer(pl), card => {
        G.Audio.sfx('confirm');
        card.apply(pl);
        G.Coop.localPicked();
      }, true);
    },
    waiting(names) { G.RunUI.setWaiting(names); },
    resume() {
      G.RunUI.closeLevelUp();
      if (state === 'levelup') { state = holdBy.length ? 'held' : 'playing'; afterLevelUp(); }
    },
    /** ¿Estás eligiendo algo que para la partida (objeto o vínculo)? */
    choosing() { return state === 'choice'; },
    /** A quién miras mientras estás caído (uid, o '' si a ti). */
    watching() { const w = watched(); return w ? w.uid : ''; },
    inLevelUp() { return state === 'levelup'; },
    shiny(dex) { G.onShinyCaught({ dex, name: (G.DEX_BY[dex] || {}).name || '' }); },
    over(d) {
      if (d) Object.assign(pl, { kills: d.ki, bosses: d.bo, coins: d.co, level: Math.max(pl.level, d.lv || 1), t1: d.t1 || pl.t1, t10: d.t10 || pl.t10,
                                  candy: Math.max(pl.candy || 0, +d.cn || 0) });
      if (d && d.t) time = d.t;
      if (d && d.why === 'host') G.UI.toast('El anfitrión ha terminado la partida', 3200);
      endRun(!(d && d.why === 'host'));
    },
    // @step coop/lost event "Pierdes al anfitrión"
    // Invitado: toast 'Se ha perdido la conexión con el anfitrión' y endRun(false).
    // @sub runend
    lost(msg) { G.UI.toast(msg, 3600); endRun(false); },
    item(id) { offerItem(id); },
    /** El anfitrión te da una esfera que has cogido. */
    orb(id) { if (pl && state !== 'over') G.Orbs.got(pl, id); },
    /** Grupo: quién está eligiendo fusión. Mientras haya alguien, todo parado. */
    hold(names) {
      holdBy = names || [];
      const mine = G.UI.isOpen('scr-bond');
      if (holdBy.length) {
        if (state === 'playing') state = 'held';
        if (pl && pl.bonds > 0) offerBond(true);      // si tú también tienes vínculo, eliges a la vez
        const others = holdBy.filter(n => n !== (G.Social.me && G.Social.me.name) && n !== 'Tú');
        if (!mine && others.length) G.Spawner.say('Pausa: ' + others.join(', ') + ' ' + (others.length > 1 ? 'están eligiendo…' : 'está eligiendo…'), 999, true);
        else if (!others.length) G.Spawner.say(awayBy ? awayText() : '', awayBy ? 999 : 0, true);   // sólo tú: sin aviso viejo
      } else {
        if (state === 'held' && !awayBy) state = 'playing';
        G.Spawner.say(awayBy ? awayText() : '', awayBy ? 999 : 0, true);
      }
    },
    /** Grupo (invitado): el anfitrión se ha ido de la pestaña o no responde: todo parado. */
    away(name) {
      awayBy = name || null;
      if (awayBy) {
        if (state === 'playing') state = 'held';
        G.Spawner.say(awayText(), 999, true);
      } else if (!holdBy.length) {
        if (state === 'held') state = 'playing';
        G.Spawner.say('', 0, true);
      }
    }
  };

  /** Has llevado a casa a un Pokémon perdido y se une a ti (events.js). */
  // @step meta/bank
  G.onRescue = (dex, name) => {
    if (!G.DB.save || !pl) return;
    const isNew = !G.DB.owns(dex);
    if (isNew) { G.DB.grant(dex, 'rescue'); G.DB.commit(true); }
    else pl.coins += 150;
    G.Spawner.say(isNew ? '¡' + name + ' se une a tu equipo!' : '¡' + name + ' te da las gracias! (+150 monedas, ya lo tenías)', 4);
    G.Audio.sfx('shinyGet');
    if (isNew) irisSay(dex);
  };

  /** Si `dex` (recién conseguido) era el último que faltaba de su generación: su Amuleto Iris. */
  function irisSay(dex) {
    const gen = G.DEX_BY[dex].gen;
    if (!G.Gacha.hasIris(G.DB.save, gen)) return;
    setTimeout(() => G.Spawner.say(G.I18n.f('¡Amuleto Iris de {x}! Shiny al 2 % en su banner', G.T(G.Gacha.BANNERS[gen - 1].name)), 5), 4000);
  }

  /** Un shiny salvaje cae: te lo quedas (y la versión normal si no la tenías). */
  // @step meta/bank
  // @step dex/sources data "Origen de shinies"
  // owned/shiny guardan {at, from}: gacha, wild (+300 si repetido), rescue o gift (admin). from
  // 'extension' se borra en sanitize.
  // @next grid
  G.onShinyCaught = e => {
    if (!G.DB.save || !pl) return;
    if (G.Coop.isHost) G.Coop.shinyCaught(e);
    const wasOwned = G.DB.owns(e.dex);
    const isNew = G.DB.grantShiny(e.dex, 'wild');
    G.DB.save.stats.shinies++;
    G.DB.commit(true);
    caught.push({ dex: e.dex, isNew });
    G.Spawner.say(isNew ? '¡Has conseguido a ' + e.name + ' shiny!' : '¡Otro ' + e.name + ' shiny! (+300 monedas)', 4);
    if (!isNew) pl.coins += 300;
    G.Audio.sfx('shinyGet');
    if (!wasOwned) irisSay(e.dex);
  };

  // @step run/runend event "Fin de run"
  // endRun: calcula monedas, guarda estadísticas, logros, ranking y muestra scr-over.
  // @sub runend
  // @next over
  // @step judge/death event "Muerte"
  // No hay victoria: la run acaba al caer; endRun guarda Judgment.summary (tiempo, legendarios, daño).
  // @step runend/why decision "Causa"
  // dead=true (caído/todos caídos/fin coop 'ov') o false (abandono, desconexión del anfitrión, fallo del
  // bucle, actualización obligatoria).
  // @next coopend "coop"
  // @next coins "solo"
  // @step runend/coopend net "Cerrar coop"
  // Recoge team con sellos y resúmenes, G.Coop.end, Social.setPlaying(false).
  // @next coins
  // @step meta/run_end event "Fin de run"
  // endRun calcula monedas: (tiempo/5 + derrotados×0,25 + jefes×80 + recogidas) × coinMul × penalización
  // Endless tras 30:00. Suma a save.coins, banca tickets/caramelos, stats, Progress.event('runEnd'),
  // checkAch y commit('run').
  // @sub runend
  // @next save "coins, stats, tickets"
  // @next rank_submit "clean() y t≥120 s"
  // @next over
  function endRun(dead = true) {
    if (state === 'over' || !pl) return;
    const coop = !!pl.uid;                    // sólo las partidas en grupo le ponen uid
    const wasHost = !!pl.coopHost;
    // (Con el sello del ranking que mandó cada invitado, antes de cerrar la partida en grupo.)
    const team = coop ? G.Coop.members.map(m => Object.assign({}, m, { seal: G.Coop.sealOf(m.uid) })) : [];
    // Resumen de cada uno (en grupo, también el de los compañeros; ver coop.js).
    const sums = coop ? G.Coop.sums() : {};
    const meUid = coop ? pl.uid : '';
    if (!coop) sums[meUid] = mySum();
    if (G.Coop.active) G.Coop.end();
    if (coop) G.Social.setPlaying(false);
    if (wasHost) G.Again.ended(team.map(m => m.uid));   // los demás, en el resumen hasta que vuelvan
    state = 'over';
    G.Orbs.reset();
    G.Audio.music(null);
    G.Audio.sfx(dead ? 'gameover' : 'back');
    const save = G.DB.save;
    const mul = pl.coinMul;
    const parts = {
      tiempo: Math.floor(time / 5),
      derrotados: Math.floor(pl.kills * 0.25),
      jefes: pl.bosses * 80,
      recogidas: pl.coins
    };
    // Endless: lo ganado después del 30:00 cuenta un 40 % (en proporción al tiempo).
    // @step judge/endless
    // @step runend/coins data "Calcular monedas"
    // tiempo/5 + kills×0,25 + jefes×80 + recogidas, ×Fortuna, ×late en Endless.
    // @next save
    // @step meta/run_end
    const late = endless && time > 1800 ? (1800 + (time - 1800) * 0.4) / time : 1;
    const coins = Math.round((parts.tiempo + parts.derrotados + parts.jefes + parts.recogidas) * mul * late);
    const record = time > save.stats.bestTime;

    save.coins += coins;
    bankTickets(false);
    G.Halloween.runEnd();
    save.stats.runs++;
    save.pused = save.pused || {};
    save.pused[pl.dex] = (+save.pused[pl.dex] || 0) + 1;     // para "más usados" en la colección
    save.stats.totalKills += pl.kills;
    save.stats.bestTime = Math.max(save.stats.bestTime, Math.floor(time));
    if (coop) save.stats.bestGroupTime = Math.max(save.stats.bestGroupTime || 0, Math.floor(time));
    save.stats.bestLevel = Math.max(save.stats.bestLevel, pl.level);
    save.stats.coinsEarned += coins;
    const judge = G.Judgment.summary();
    if (judge) G.Progress.event('judgeEnd', judge);
    G.Judgment.reset();
    // @step runend/progress event "Logros y perfil"
    // Progress 'judgeEnd'/'runEnd', checkAch, publishProfile.
    // @next clean
    // @step goals/events
    G.Progress.event('runEnd', { time, level: pl.level, coins: pl.coins, types: pl.mon.types, group: coop });
    G.Progress.checkAch();
    // Se guarda en este aparato y sube a la nube (la única subida sola; el resto, al pulsar Guardar: ver db.js).
    G.DB.commit('run');
    G.DB.saveNow().catch(() => {});
    // @step runend/progress
    if (G.Social.me) G.Social.publishProfile();

    // Ranking: en solitario cada uno lo suyo; en grupo lo sube el anfitrión.
    const mark = { t: Math.floor(time), lv: pl.level, kills: pl.kills, dmg: judge ? judge.dmg : 0 };   // dmg: a Arceus
    // Si la partida se ha tocado (ver clean()), no sube al ranking (sin avisar); lo demás, sí.
    const ok = clean();
    // @step meta/rank_submit net "Subir marca ranking"
    // Si clean() da la partida por limpia: submitSolo (s/e) o submitGroup (anfitrión). Marcas de menos de
    // 120 s no se suben.
    // @sub rank
    const sent = ok && !coop ? G.Ranking.submitSolo(Object.assign(mark, { dex: pl.dex, shiny: pl.shiny, mode: endless ? 'e' : 's' }))
               : ok && wasHost ? G.Ranking.submitGroup(Object.assign(mark, { members: team })) : null;
    if (sent) sent.catch(() => {});

    // @step meta/over
    G.RunUI.showOver({
      dead, time, level: pl.level, kills: pl.kills, bosses: pl.bosses, coins, record, t1: pl.t1, t10: pl.t10, candy: pl.candy || 0, judge,
      team: (coop ? team : [{ uid: meUid }]).filter(m => sums[m.uid]).map(m => ({ name: m.name, me: m.uid === meUid, sum: sums[m.uid] }))
        .sort((a, b) => b.me - a.me),
      moves: pl.moves, caught,
      breakdown: Object.entries(parts).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') +
                 (mul > 1 ? ` · ×${mul.toFixed(2)} Fortuna` : '') + (late < 1 ? ` · ×${late.toFixed(2)} Endless` : '')
    // @step run/after decision "afterRun"
    // Si sigues en sala → lobby (el anfitrión la reabre); si no → goMenu (Backdrop.restore, música,
    // avisos, actualización pendiente).
    // @sub backmenu
    // @next menu "sin sala"
    // @step runend/back
    // @step backmenu/after decision "afterRun"
    // ¿Sigues en G.Social.room?
    // @next lobby "en sala"
    // @next menu "sin sala"
    // @step backmenu/lobby screen "Volver a sala"
    // toUI, el anfitrión reabre la sala (setOpen(true)) y LobbyUI.open.
    // @screen scr-lobby
    // @sub lobby
    }, () => { pl = null; G.Flow.afterRun(); });
  }

  /*
   * ¿Partida limpia? Sólo cosas que ningún jugador legal puede hacer, con
   * márgenes enormes (el sistema del 10-10 daba falsos positivos):
   *   - el reloj de la partida va más deprisa que el real (trucos de velocidad)
   *   - funciones de tu Pokémon sustituidas (así se hace uno invencible)
   *   - vida, ataque, velocidad o recarga muy por encima de lo posible
   *   - se han usado las funciones de pruebas (saltar el reloj...)
   * Si algo salta, esa partida no sube al ranking (sin avisar) y nada más.
   */
  let runReal = 0, tampered = false;
  // @step runend/clean decision "¿Partida limpia?"
  // clean(): reloj vs tiempo real, funciones sustituidas, stats imposibles, debug; si falla no sube (sin
  // avisar).
  // @next rank "limpia"
  // @next over "manipulada"
  // @step meta/rank_submit
  function clean() {
    if (tampered) return false;
    if (time > (performance.now() - runReal) / 1000 + 10) return false;
    for (const k of ['hurt', 'update', 'heal', 'gainXp']) if (Object.prototype.hasOwnProperty.call(pl, k)) return false;
    if (!isFinite(pl.hp) || !isFinite(pl.maxHp) || pl.hp > pl.maxHp + 1 || pl.maxHp > 50000) return false;
    if (pl.atkMul > 2000 || pl.spdMul > 25 || pl.cdMul < 0.03 || pl.level > 20 + time / 3) return false;
    return true;
  }

  // ---------------- subida de nivel ----------------

  // @step run/levelup screen "Subida de nivel"
  // Con pendingLevels>0 se pausa y se ofrecen 3 cartas.
  // @screen scr-levelup
  // @sub levelup
  // @next loop "carta elegida"
  // @step loop/xp decision "¿Sube nivel?"
  // maybeLevelUp si pendingLevels>0 y vivo (en coop solo el anfitrión, vía G.Coop.levelStart).
  // @sub levelup
  // @next frame "no"
  // @step levelup/trigger event "pendingLevels > 0"
  // Solo: state='levelup'. Coop: anfitrión llama G.Coop.levelStart y emite 'lu' a todos.
  // @next offer
  // @step levelup/back event "Vuelta al juego"
  // state='playing' (o 'held' si alguien elige fusión).
  function maybeLevelUp() {
    if (pendingLevels <= 0 || state !== 'playing') return;
    if (G.Coop.active) {
      // En grupo, las cartas salen a la vez para todos y se espera a que elijan.
      if (G.Coop.players().every(p => p.dead)) return;
      pendingLevels--;
      G.Coop.levelStart(pl.level);
      return;
    }
    // Nunca abras cartas con el Pokémon caído (morir y recoger XP en el mismo frame).
    if (pl.dead) return;
    pendingLevels--;
    state = 'levelup';
    G.Audio.sfx('levelup');
    G.RunUI.showLevelUp(pl.level, G.LevelUp.offer(pl), card => {
      G.Audio.sfx('confirm');
      card.apply(pl);
      state = 'playing';
    });
  }

  // ---------------- vínculos ----------------

  /**
   * Vínculo de un legendario: eliges qué movimientos se fusionan.
   * Si ahora no se puede (no hay dos sueltos), se guarda hasta que aprendas
   * otro movimiento. Se mira en cada fotograma: si otra pantalla la tapa (cartas
   * de nivel en grupo, pausa), vuelve a salir al cerrarla.
   * @param quiet  no avisar si todavía no se puede
   */
  // @step run/choice
  // @step loop/bond decision "Vínculo pendiente"
  // Si pl.bonds>0 cada frame se intenta offerBond (si no hay dos movimientos sueltos, se guarda).
  // @sub choice
  // @step choice/bondq decision "Vínculo disponible"
  // pl.bonds>0 y bondOptions(); si no hay dos sueltos: 'Guardas el vínculo'. No en grieta ni con otra
  // pantalla abierta.
  // @next bond "sí"
  function offerBond(quiet = false) {
    if (!pl || pl.bonds <= 0 || pl.dead || (state !== 'playing' && state !== 'held') || G.Rift.inArena) return;
    if (['scr-bond', 'scr-pause', 'scr-item', 'scr-levelup'].some(G.UI.isOpen)) return;
    const opt = pl.bondOptions();
    if (!opt) {
      if (!quiet) G.Spawner.say('Guardas el vínculo: aprende otro movimiento para usarlo', 3, true);
      return;
    }
    // Se para el juego; en grupo, para todos hasta que cada uno elige (G.Coop.holdStart).
    state = 'choice';
    if (G.Coop.active) G.Coop.holdStart();
    G.Audio.sfx('levelup');
    G.RunUI.showBond(opt, picked => {
      // @step choice/fuse event "Fusionar"
      // pl.fuse → movimientos a la vez; vuelve a 'playing'/'held' y holdEnd.
      const group = pl.fuse(picked, opt.group);
      G.Audio.sfx('legend');
      G.FX.ring(pl.x, pl.y, 8, 130, '#ff8ad8', 0.8, 6);
      G.FX.burst(pl.x, pl.y - pl.bodyH * 0.5, '#ffb3e6', 40, 240);
      G.Spawner.say('¡Vínculo! ' + group.length + ' movimientos a la vez', 2.6, true);
      if (state === 'choice') state = holdBy.length ? 'held' : 'playing';
      if (G.Coop.active) G.Coop.holdEnd();
    });
  }

  // ---------------- recogida ----------------

  const PICK_SFX = { xp: 'xp', xpBig: 'xp', coin: 'coin', heal: 'heal', bomb: 'break', magnet: 'confirm', ticket: 'shiny', ticket10: 'legend', item: 'legend', sphere: 'confirm' };

  /*
   * Cooperativo: la elección de objeto y las cartas de nivel no pueden taparse.
   * Si llega un objeto con las cartas abiertas, espera a que elijas carta; y si
   * las cartas llegan con la elección de objeto abierta, ésta vuelve a salir al
   * terminar. (Antes una cerraba la otra, nadie podía terminar de elegir y la
   * partida se quedaba parada para todos.)
   */
  let openItem = null;           // { cur, next, take } elección de objeto sin terminar
  // @step levelup/after
  // @step choice/lvlopen decision "¿Cartas abiertas?"
  // Si scr-levelup está abierto se encola en laterItems.
  // @next has "no"
  const laterItems = [];         // objetos recogidos con las cartas de nivel abiertas
  // @step levelup/after event "afterLevelUp"
  // Reabre elección de objeto pendiente o los objetos recogidos durante las cartas (laterItems).
  // @next back
  function afterLevelUp() {
    if (state !== 'playing' && state !== 'held') return;
    if (openItem && !G.UI.isOpen('scr-item')) {
      const o = openItem;
      if (o.mine) { state = 'choice'; if (G.Coop.active) G.Coop.holdStart(); }
      G.RunUI.showItemChoice(o.cur, o.next, o.take);
      return;
    }
    if (laterItems.length) offerItem(laterItems.shift());
  }

  /** Has cogido un objeto: si no llevas ninguno te lo pones; si no, eliges. */
  // @step run/choice screen "Objeto / Vínculo"
  // Elección de objeto al recoger uno llevando otro, o fusión de movimientos de un vínculo legendario
  // (scr-bond); state='choice'.
  // @screen scr-item
  // @sub choice
  // @next loop "elegido"
  // @step loop/item decision "Objeto recogido"
  // Sin objeto se equipa; si ya llevas otro abre scr-item.
  // @sub choice
  // @step choice/has decision "¿Llevas objeto?"
  // Sin objeto: se equipa directo; mismo objeto: aviso.
  // @next equip "sin objeto"
  // @next item "con otro"
  // @step choice/equip data "Equipar"
  // pl.equip, Progress.event('item'); holdEnd y afterLevelUp.
  function offerItem(id) {
    if (!pl || !G.Items.BY[id]) return;
    if (state === 'levelup' || G.UI.isOpen('scr-levelup')) { laterItems.push(id); return; }
    let mine = false;            // esta elección es la que ha parado el juego
    const take = got => {
      openItem = null;
      if (got !== pl.item) {
        pl.equip(got);
        G.Spawner.say('¡Llevas ' + G.Items.BY[got].name + '!', 2.6, true);
        G.Progress.event('item', { id: got });
      }
      if (!mine) { afterLevelUp(); return; }
      if (state === 'choice') state = holdBy.length ? 'held' : 'playing';
      if (G.Coop.active) G.Coop.holdEnd();
      afterLevelUp();
    };
    if (!pl.item) { take(id); return; }
    if (pl.item === id) { G.Spawner.say('Ya llevas ' + G.Items.BY[id].name, 2, true); return; }
    // Se para el juego mientras eliges; en grupo, para todos (como con las
    // fusiones). Antes en grupo seguía y te pegaban mientras elegías.
    if (state === 'playing' || state === 'held') {
      mine = true;
      state = 'choice';
      if (G.Coop.active) G.Coop.holdStart();
    }
    openItem = { cur: pl.item, next: id, take, get mine() { return mine; } };
    G.RunUI.showItemChoice(pl.item, id, take);
  }

  /** @param who  quien lo ha cogido (en cooperativo puede ser un compañero) */
  // @step loop/collect event "Recogidas"
  // onCollect: XP (pendingLevels += gainXp), monedas, objeto, esferas, caramelos, tickets (bankTickets
  // guarda al momento), cura, imán, bomba.
  // @next xp "XP"
  // @next item "objeto"
  // @step choice/got event "Objeto recogido"
  // onCollect kind 'item' (en coop el anfitrión manda 'item').
  // @next lvlopen
  function onCollect(p, who = pl) {
    const mine = who === pl;
    if (G.Coop.active && !G.Coop.isHost) {
      // Copia de un objeto del anfitrión: el efecto lo decide él.
      if (mine) G.Audio.sfx(PICK_SFX[p.kind]);
      return;
    }
    if (G.Coop.active) G.Coop.collected(p, who);
    if (mine || p.kind === 'bomb') G.Audio.sfx(PICK_SFX[p.kind]);
    if (p.kind === 'xp' || p.kind === 'xpBig') {
      pendingLevels += pl.gainXp(p.value * (G.Coop.active ? G.Coop.xpFactor() : 1));
      return;
    }
    if (p.kind === 'coin') {
      pl.coins += p.value;
      G.FX.dmgText(who.x, who.y - who.bodyH - 6, '+' + p.value, '#ffd23f');
      return;
    }
    if (p.kind === 'item') {
      if (mine) offerItem(p.value);
      return;
    }
    if (p.kind === 'sphere') {
      // La de un invitado: el anfitrión lleva la cuenta de lo que tiene (para saber si le cabe otra).
      if (mine) G.Orbs.got(pl, p.value); else G.Orbs.add(who, p.value);
      return;
    }
    if (p.kind === 'candy') {
      pl.candy = (pl.candy || 0) + (p.value || 1);
      bankTickets();
      G.FX.dmgText(who.x, who.y - who.bodyH - 8, '+' + (p.value || 1) + (p.value > 1 ? ' caramelos' : ' caramelo'), '#ff9a3d', true);
      G.FX.ring(who.x, who.y, 6, 44, '#ff8a2a', 0.4, 3);
      return;
    }
    if (p.kind === 'ticket' || p.kind === 'ticket10') {
      if (p.kind === 'ticket') pl.t1++; else pl.t10++;
      bankTickets();
      G.FX.dmgText(who.x, who.y - who.bodyH - 8, p.kind === 'ticket' ? '+1 ticket' : '¡Ticket ×10!', p.kind === 'ticket' ? '#ffd23f' : '#d9a6ff', true);
      G.FX.ring(who.x, who.y, 6, 50, p.kind === 'ticket' ? '#ffd23f' : '#c47bff', 0.4, 3);
      return;
    }
    if (p.kind === 'heal') {
      if (mine) pl.heal(pl.maxHp * 0.3);
      G.FX.ring(who.x, who.y, 6, 60, '#5fe08a', 0.4, 3);
      return;
    }
    if (p.kind === 'magnet') {
      G.Pickups.pullAll();
      G.FX.ring(who.x, who.y, 10, 420, '#ff9ed8', 0.6, 4);
      return;
    }
    if (p.kind === 'bomb') {
      if (G.U.dist2(who.x, who.y, pl.x, pl.y) < 500 * 500) G.Camera.kick(0.8);
      const R = G.Camera.outerRadius();
      G.FX.ring(who.x, who.y, 20, R, '#ff7b3d', 0.5, 6);
      for (const e of G.EnemyMgr.all()) {
        if (mine ? !G.Camera.sees(e.x, e.y, 0) : G.U.dist2(e.x, e.y, who.x, who.y) > R * R) continue;
        e.hurt(60 + pl.level * 14, '#ff7b3d', e.x - who.x, e.y - who.y, 160);
      }
    }
  }

  // ---------------- teclado ----------------

  function handleKeys() {
    // La Sentencia de Arceus: Espacio, Intro o Esc saltan la animación (si se puede).
    if (G.Judgment.cinematic && state === 'playing') {
      if (['space', 'enter', 'escape'].some(k => G.Input.tap(k))) G.Judgment.skip();
      return;
    }
    if (state === 'levelup') return;   // (cartas, objeto y vínculo: sus teclas las lee native/shim/ui.js)
    if (state === 'ui') return;   // (los menús: native/shim/ui.js)
    if (G.Input.tap('escape') || G.Input.tap('keyp')) { togglePause(); return; }
    if (state !== 'playing' || !pl) return;
    for (let i = 0; i < 4; i++) {
      if (G.Input.tap('digit' + (i + 1)) || G.Input.tap('numpad' + (i + 1))) pl.setActive(i);
    }
    // Caído en grupo: Q / E cambian a quién miras.
    if (pl.dead) { if (G.Input.tap('keyq')) cycleWatch(-1); if (G.Input.tap('keye') || G.Input.tap('tab')) cycleWatch(1); return; }
    if (G.Input.tap('keyq')) pl.cycle(-1);
    if (G.Input.tap('keye') || G.Input.tap('tab')) pl.cycle(1);
    // Esferas: 5-8 (o el teclado numérico); en el mando, X la usa e Y cambia de esfera.
    for (let i = 0; i < 4; i++) {
      if (G.Input.tap('digit' + (i + 5)) || G.Input.tap('numpad' + (i + 5))) G.Orbs.use(pl, i);
    }
    if (G.Input.tap('padx')) G.Orbs.useSelected(pl);
    if (G.Input.tap('pady')) G.Orbs.next(pl);
  }

  // ---------------- bucle ----------------

  let deathT = 0;

  // Caído en grupo: puedes mirar a un compañero vivo. Sólo cambia a quién
  // sigue la cámara (y el anfitrión te manda los enemigos de allí).
  let watch = null;
  /** El compañero al que miras, o null si miras tu cuerpo. */
  function watched() {
    if (!pl || !pl.dead || !G.Coop.active) return (watch = null);
    if (watch && (watch.dead || !G.Coop.puppets().includes(watch))) watch = G.Coop.puppets().find(p => !p.dead) || null;
    return watch;
  }
  /** Cambia a quién miras: tú → cada compañero vivo → tú. */
  // @step coop/down
  function cycleWatch(dir) {
    const list = [null, ...G.Coop.puppets().filter(p => !p.dead)];
    if (list.length < 2) return;
    watch = list[(list.indexOf(watched()) + dir + list.length) % list.length];
    G.Audio.sfx('click');
  }

  let frameDt = 0, speedK = 1, soloK = 1, trapT = 0;
  let fpsShown = 60, fpsAcc = 0, fpsN = 0;
  // El siguiente fotograma se pide ANTES de nada: si algo falla a mitad, el
  // juego sigue (antes se quedaba congelado para siempre y había que recargar;
  // así se perdió una partida enorme al abrirse una grieta).
  // Si falla fotograma tras fotograma (el juego ya no avanza ni se ve), la
  // partida se da por terminada a los ~3 s y se guarda: tiempo, derrotados,
  // récords y ranking. Mejor eso que una pantalla negra y perderlo todo.
  let loopErrs = 0, errRun = 0;
  // @step loop/frame event "frame / loop"
  // rAF siempre pedido primero; lee mando y teclas, update si state='playing', tick de red en coop,
  // render.
  // @next clock
  function loop(ts) {
    requestAnimationFrame(loop);
    try { frame(ts); errRun = 0; }
    catch (e) {
      if (loopErrs++ < 5) console.error('[Game] fallo en un fotograma:', e);
      G.Input.endFrame();
      // @step run/dead
      if (++errRun === 180 && pl && state !== 'ui' && state !== 'over') {
        try {
          G.UI.hideAll();
          quitRun();
          G.UI.toast('El juego ha fallado: tu partida se ha guardado hasta aquí', 5000);
        } catch (e2) { console.error('[Game] no se pudo cerrar la partida:', e2); }
      }
    }
  }

  // @step loop/frame
  function frame(ts) {
    const real = (ts - last) / 1000 || 0;
    const dt = Math.min(1 / 30, real) * speedK;
    last = ts;
    if (state === 'playing') G.Settings.sample(real);
    fpsAcc += real; fpsN++;
    if (fpsAcc >= 0.5) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    frameDt = state === 'playing' ? dt : 0;

    G.Pad.poll(real);
    handleKeys();
    if ((trapT -= real) <= 0) { trapT = 0.5; ensureTrap(); }

    if (state === 'playing') update(dt);
    else if (pl && state !== 'ui') {
      G.FX.update(dt * 0.25); pl.anim.update(dt * 0.25);
      if (state === 'held') G.Rift.endTick(dt);   // vuelves de la grieta y eliges fusión a la vez que los demás
    }
    // La red se atiende siempre (también con las cartas de nivel abiertas).
    if (G.Coop.active && pl && state !== 'ui' && state !== 'over') G.Coop.tick(dt);

    if (pl && state !== 'ui') render(); else Backdrop.render(ctx, w, h, dpr, dt);
    G.UI.tick(dt);

    G.Input.endFrame();
  }

  function update(dt) {
    // Núcleo en C (native/shim/core.js, todas las versiones; la web con core-web.js): con psCore.on la partida la mueve
    // el núcleo y aquí sólo se pinta. Le pasa el reloj y endRun (guarda y acaba como siempre) y apaga el destello.
    if (globalThis.psCore && psCore.on) { if (flashT > 0) flashT -= dt; return psCore.update(dt, { setTime: v => { time = v; }, endRun }); }
    const coop = G.Coop.active;
    if (flashT > 0) flashT -= dt;
    // La Sentencia de Arceus: mientras dura la animación, todo lo demás se para.
    if (G.Judgment.cinematic) {
      G.Judgment.cineTick(dt);
      pl.anim.update(dt);
      if (coop) for (const p of G.Coop.puppets()) p.netUpdate(dt);
      G.World.update(dt, G.Camera);
      G.FX.update(dt);
      G.Audio.music(G.Judgment.music);
      return;
    }
    // Tras caer, deja que se vea la animación de Faint antes del resumen.
    // (En la arena de la grieta no: allí caer sólo te echa de vuelta.)
    if (pl.dead && !coop && !G.Rift.inArena) {
      deathT += dt;
      pl.update(dt);
      G.EnemyMgr.update(dt * 0.3, pl);
      G.FX.update(dt);
      G.Camera.follow(pl.x, pl.y, dt);
      // @step run/dead decision "¿Caído o abandono?"
      // Solo: al morir, 1,3 s de animación y endRun(true). Abandonar (pausa) o fallo continuo del bucle (180
      // fotogramas) → quitRun → endRun(false).
      // @next runend
      // @step loop/death decision "Muerte"
      // Solo: tras 1,3 s endRun(true). Coop: anfitrión checkAllDown (todos caídos 1,6 s) o te reviven.
      // @sub runend
      if (deathT > 1.3) { deathT = 0; endRun(true); }
      return;
    }
    time += dt;
    if (time >= nextBeat) {
      nextBeat += 60;
      const j = G.Judgment.summary();
      G.Ranking.beat({ t: Math.floor(time), lv: pl.level, kills: pl.kills, dmg: j ? j.dmg : 0 });
    }

    // @step loop/clock event "Reloj y bioma"
    // time+=dt; cada 60 s G.Ranking.beat; cada 240 s cambia bioma (salvo grieta/Sentencia).
    // @next spawn
    // @next rift
    // @next judge "t ≥ 30:00 (no Endless)"
    const b = Math.floor(time / 240);
    if (b !== biome && !G.Rift.inArena && !G.Judgment.active) {
      biome = b;
      G.World.setBiome(G.Tiles.runBiome(b));
      G.Audio.sfx('biome');
      G.Spawner.say('— ' + G.World.biomeName() + ' —', 3);
      G.FX.ring(pl.x, pl.y, 10, G.Camera.outerRadius(), '#ffffff', 0.7, 6);
    }

    pl.frozen = coop && (G.UI.isOpen('scr-pause') || G.UI.isOpen('scr-item'));
    pl.update(dt);
    G.Orbs.update(dt, pl);
    if (coop) {
      for (const p of G.Coop.puppets()) { p.netUpdate(dt); G.Combat.ghostOrbit(p, dt, time); }
      if (pl.dead) reviveTick(dt);
    }
    const view = watched() || pl;
    G.Camera.follow(view.x, view.y, dt);
    G.World.update(dt, G.Camera);

    const all = everyone();
    if (!coop || G.Coop.isHost) { G.Path.update(dt, all); G.Spawner.update(dt, all, time); }
    else G.Spawner.tickBanner(dt);
    G.EnemyMgr.update(dt, all);
    G.EnemyMgr.rebuildGrid();
    G.Combat.tick(dt, pl, time);
    G.Projectiles.update(dt, pl, G.EnemyMgr.all());
    G.Combat.resolve(dt, pl, time);
    G.Combat.updateFields(dt);
    G.Pickups.update(dt, all, onCollect);
    G.Hazards.update(dt);
    G.Interact.update(dt, pl);
    G.Rift.update(dt, pl, time);
    G.Judgment.update(dt, pl, time);
    G.Events.update(dt, all, time);
    G.Weather.update(dt, time, pl);
    G.FX.update(dt);

    G.Audio.music(G.Judgment.active ? G.Judgment.music : G.Rift.inArena ? 'rift' : G.EnemyMgr.bossAlive() ? 'boss' : G.BIOME_MUSIC[biome % G.BIOME_MUSIC.length]);
    if (!coop || G.Coop.isHost) maybeLevelUp();
    if (pl.bonds > 0) offerBond(true);
    if (G.Coop.isHost) checkAllDown(dt);
  }

  /** Caído en grupo: un compañero a tu lado te va levantando. */
  // @step coop/down event "Caído en grupo"
  // Un compañero al lado te revive; puedes mirar a otro (Q/E).
  function reviveTick(dt) {
    const helper = G.Coop.puppets().some(p => !p.dead && G.U.dist2(p.x, p.y, pl.x, pl.y) < 56 * 56);
    const was = pl.reviveT || 0;
    pl.reviveT = helper ? (pl.reviveT || 0) + dt : Math.max(0, (pl.reviveT || 0) - dt * 0.5);
    // ponytail: diagnóstico (18-11-2026: cierre al levantar a un compañero); quitar al saberlo.
    if ((was > 0) !== (pl.reviveT > 0) || (was | 0) !== (pl.reviveT | 0)) console.log('[revivir] yo: ' + (helper ? 'me levantan ' : 'sin ayuda ') + pl.reviveT.toFixed(1) + ' s');
    if (pl.reviveT >= G.Player.REVIVE_TIME) pl.revive(0.5);
  }

  /** Anfitrión: si caéis todos, se acaba (tras ver caer al último). */
  // @step loop/death
  function checkAllDown(dt) {
    if (G.Rift.inArena || !G.Coop.players().every(p => p.dead)) { deathT = 0; return; }
    deathT += dt;
    if (deathT > 1.6) {
      deathT = 0;
      G.Coop.over(summary());
      endRun(true);
    }
  }

  // ---------------- dibujo ----------------

  function drawScene(cam, extra) {
    const t = performance.now() / 1000;
    G.World.drawGround(ctx, cam);
    G.World.drawLiquid(ctx, cam, t);
    G.Hazards.draw(ctx);
    G.Combat.drawGroundFields(ctx);
    // Los planos (manantiales, trampas), pegados al suelo: debajo de todo, también de bayas y monedas.
    const props = G.World.visibleProps(cam);
    for (const p of props) if (p.flat) G.World.drawProp(ctx, p, t);
    G.Pickups.draw(ctx);

    // Todo lo que tiene "pies" se ordena por Y: objetos, enemigos, jugador.
    const items = [];
    for (const p of props) if (!p.flat) items.push({ y: p.y, prop: p });
    for (const e of G.EnemyMgr.drawables(cam)) items.push({ y: e.y, ent: e });
    for (const e of extra) items.push({ y: e.y, ent: e });
    const rift = G.Rift.drawable();
    if (rift) items.push({ y: rift.y, ent: rift });
    const arceus = pl && state !== 'ui' ? G.Judgment.drawable() : null;
    if (arceus) items.push({ y: arceus.y, ent: arceus });
    if (pl && state !== 'ui') for (const d of G.Events.drawables()) items.push({ y: d.y, ent: d });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.prop) G.World.drawProp(ctx, it.prop, t);
      else it.ent.draw(ctx);
    }
  }

  /*
   * Apuntar a mano: una mira donde está el ratón (y el cursor en cruz), o
   * delante de tu Pokémon si apuntas con el stick derecho.
   */
  function drawAimMark() {
    const on = state === 'playing' && pl && pl.manualAim && !G.Judgment.cinematic;
    const cur = on && !G.Pad.aim() ? 'crosshair' : '';
    if (cv.style.cursor !== cur) cv.style.cursor = cur;
    if (!on) return;
    let x, y;
    if (G.Pad.aim()) {
      const k = G.Camera.scale;
      x = (pl.x - G.Camera.left() + Math.cos(pl.aim) * 90) * k;
      y = (pl.y - G.LIFT * 0.5 - G.Camera.top() + Math.sin(pl.aim) * 90) * k;
    } else ({ x, y } = G.Input.mouse());
    ctx.save();
    ctx.lineCap = 'round';
    for (const [col, lw] of [['rgba(0,0,0,.65)', 4], ['#ffe9a8', 1.6]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.2832); ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 5, y + dy * 5); ctx.lineTo(x + dx * 14, y + dy * 14); }
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    // (con psCore, una vez por vista: pantalla partida del cooperativo local)
    for (const view of (globalThis.psCore && psCore.on ? psCore.views(w, h) : [null])) {
    if (view) psCore.viewBegin(ctx, view);
    ctx.save();
    ctx.scale(G.Camera.scale, G.Camera.scale);
    G.Camera.apply(ctx);
    drawScene(G.Camera, view ? psCore.drawList() : G.Coop.active ? [pl, ...G.Coop.puppets()] : [pl]);
    G.Projectiles.draw(ctx);
    G.Combat.drawAirFields(ctx);
    G.FX.draw(ctx);
    G.Judgment.drawAir(ctx);
    ctx.restore();
    if (view) psCore.viewEnd(ctx, view);
    }

    G.Weather.draw(ctx, w, h, frameDt);
    G.World.drawVignette(ctx, w, h);
    // Niebla: la viñeta se cierra un poco (sin tapar el centro).
    const fog = G.Weather.vignette;
    if (fog > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.62);
      g.addColorStop(0, 'rgba(200,205,220,0)');
      g.addColorStop(1, `rgba(200,205,220,${0.45 * fog})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (!G.Judgment.cinematic) G.HUD.draw(ctx, w, h, pl, st);
    G.Judgment.drawOverlay(ctx, w, h);
    if (globalThis.psCore && psCore.on) psCore.overlay(ctx, w, h);
    G.Touch.draw(ctx);
    drawAimMark();
    if (G.Settings.get('fps')) {
      ctx.save();
      ctx.font = '700 11px Pixelify, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = fpsShown >= 50 ? '#5fe08a' : fpsShown >= 30 ? '#ffd23f' : '#ff5f6d';
      ctx.fillText(fpsShown + ' FPS', w - 10, h - 8);
      ctx.restore();
    }
    if (flashT > 0) {
      ctx.save();
      // "Menos destellos": el fogonazo de pantalla se queda en un tercio.
      ctx.globalAlpha = Math.min(1, flashT / flashDur * 1.4) * (G.Settings.get('calm') ? 0.3 : 1);
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ---------------- fondo de los menús ----------------

  /**
   * El mundo de verdad, con Pokémon salvajes paseando y la cámara a la deriva.
   * Así el menú enseña desde el primer segundo cómo se ve el juego.
   */
  const Backdrop = (() => {
    let wanderers = [], t = 0, ready = false, biomeT = 0, bi = 0;
    const CAST = [1, 4, 7, 25, 133, 52, 39, 35, 16, 43, 60, 69, 74, 92, 129, 147, 113, 143, 54, 79];
    // Halloween: paseando por la noche, sobre todo Fantasma.
    const CAST_HW = [92, 93, 94, 200, 355, 353, 425, 429, 442, 479, 562, 592, 607, 708, 710, 778, 25, 197, 302, 351];
    const cast = () => (G.Halloween.on ? CAST_HW : CAST).filter(d => G.SPRITE_META[d]);

    function init() {
      G.World.reset(G.World.MENU_SEED);
      G.World.setBiome(G.Tiles.runBiome(0), true);
      G.Camera.x = 0; G.Camera.y = 0;
      wanderers = cast().map(dex => spawn(dex, true));
      ready = true;
    }

    function spawn(dex, anywhere) {
      const a = new G.Sprites.Animator(dex, 1);
      const r = G.Sprites.bodyRadius(dex);
      let x = 0, y = 0;
      for (let i = 0; i < 20; i++) {
        x = G.Camera.x + G.U.rand(-1, 1) * (anywhere ? G.Camera.w * 0.6 : G.Camera.w * 0.7);
        y = G.Camera.y + G.U.rand(-1, 1) * (anywhere ? G.Camera.h * 0.6 : G.Camera.h * 0.7);
        if (G.World.isFree(x, y, r)) break;
      }
      return { dex, anim: a, x, y, r, vx: 0, vy: 0, t: 0, draw(ctx) {
        G.Sprites.drawShadow(ctx, this.dex, this.x, this.y);
        this.anim.draw(ctx, this.x, this.y);
      } };
    }

    function step(dt) {
      t += dt;
      G.World.update(dt, G.Camera);
      // Deriva lenta de la cámara.
      G.Camera.x += Math.cos(t * 0.05) * 14 * dt;
      G.Camera.y += Math.sin(t * 0.037) * 10 * dt;
      G.Camera.follow(G.Camera.x, G.Camera.y, dt);

      biomeT += dt;
      if (biomeT > 30) { biomeT = 0; bi = (bi + 1) % 3; G.World.setBiome(G.Tiles.runBiome(bi)); }

      for (const wd of wanderers) {
        wd.t -= dt;
        if (wd.t <= 0) {
          // Pasea, se para o "ataca" al aire de vez en cuando.
          wd.t = G.U.rand(1, 3.5);
          const r = Math.random();
          if (r < 0.55) {
            const a = Math.random() * 6.2832, s = G.U.rand(25, 55);
            wd.vx = Math.cos(a) * s; wd.vy = Math.sin(a) * s;
          } else {
            wd.vx = wd.vy = 0;
            if (r > 0.85) wd.anim.play(G.U.pick(['Attack', 'Shoot', 'Charge']));
          }
        }
        wd.x += wd.vx * dt; wd.y += wd.vy * dt;
        G.World.collide(wd);
        const moving = Math.abs(wd.vx) + Math.abs(wd.vy) > 1;
        if (moving) wd.anim.dir = G.Sprites.dirFromAngle(Math.atan2(wd.vy, wd.vx));
        wd.anim.loop(moving ? 'Walk' : 'Idle');
        wd.anim.update(dt);
        // Si se queda fuera de cámara, reaparece dentro.
        if (!G.Camera.sees(wd.x, wd.y, 120)) Object.assign(wd, spawn(wd.dex, false));
      }
    }

    function render(ctx, w, h, dpr, dt) {
      if (!ready) return;
      step(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.save();
      ctx.scale(G.Camera.scale, G.Camera.scale);
      G.Camera.apply(ctx);
      drawScene(G.Camera, wanderers);
      ctx.restore();
      if (G.Halloween.on) G.World.drawNight(ctx, w, h, G.Camera, t);
      G.World.drawVignette(ctx, w, h);
    }

    /** Al volver de una run, recupera el mundo del menú. */
    function restore() {
      G.World.reset(G.World.MENU_SEED);
      G.World.setBiome(G.Tiles.runBiome(bi), true);
      G.FX.clear(); G.Projectiles.clear(); G.Combat.clearFields(); G.EnemyMgr.clear(); G.Pickups.clear();
      wanderers = cast().map(dex => spawn(dex, true));
    }

    return { init, render, restore };
  })();

  return {
    init, startRun, everyone, levelXp, flash, offerBond,
    /** Para pruebas: salta el reloj de la run. */
    debugTime(t) { tampered = true; time = t; },
    /** Halloween: caramelos de golpe (al llegar al gran Gengar; en grupo, los da el anfitrión a todos). */
    addCandy(n) {
      if (!pl || !(n > 0)) return;
      pl.candy = (pl.candy || 0) + n;
      bankTickets();
      G.FX.dmgText(pl.x, pl.y - pl.bodyH - 14, '+' + n + ' caramelos', '#ff9a3d', true);
    },
    /** Para grabar vídeos: cámara lenta (0,5 = mitad de velocidad). */
    debugSpeed(k) { if (k > 1) tampered = true; speedK = soloK = k; },
    togglePause, cycleWatch,
    /** El compañero al que miras estando caído (o null). */
    get watching() { return watched(); },
    /** Abandona la partida en curso (p. ej. al cerrar sesión desde Ajustes). */
    quit() { if (state !== 'ui' && state !== 'over') quitRun(); },
    /** Para grabar vídeos: abre las cartas de subir de nivel. */
    debugLevelUp() { tampered = true; pl.level++; pendingLevels++; },
    toUI() { state = 'ui'; if (cv) cv.style.cursor = ''; Backdrop.restore(); },
    get state() { return state; }, get player() { return pl; }, get endless() { return endless; }, st
  };
})();

/* ============ Flow — transiciones entre pantallas ============ */
// @step boot/flowboot event "G.Flow.boot"
// Espera a la fuente Pixelify e inicia todas las UIs (Login, Test, Menu, Gacha, Social, Ranking, Mod,
// Goals, Settings, Support, News, Live, Video, Banner), Updater.init y Game.init.
// @next dbready
// @next upd
G.Flow = {
  boot() {
    // @step boot/flowboot
    // (las pantallas son las de native/shim/ui.js, que pone tapToStart, toLogin, afterLogin y goMenu de aquí abajo)
    G.SocialUI.init(); G.Updater.init();
    G.Audio.music('village');     // suena tras el primer clic (lo exige el navegador)
    G.Game.init();
    // La base de datos (nube o local) recupera la sesión anterior.
    // @step boot/dbready data "G.DB.ready"
    // Decide nube o local y recupera la sesión anterior; al terminar se oculta #boot.
    // @sub account
    // @next tap
    G.DB.ready().then(restored => {
      document.getElementById('boot').classList.add('hidden');
      // En otra tarea: crear el sonido para comprobarlo cuesta ~60 ms y no debe bloquear la carga.
      // @step boot/tap screen "Pulsa para empezar"
      // Sólo si el navegador aún no deja sonar audio; un clic o tecla lo desbloquea.
      // @screen tap-start
      // @next restored
      setTimeout(() => this.tapToStart(() => { if (restored) this.afterLogin(); else this.toLogin(); }), 0);
    });
  },
  // tapToStart, toLogin, afterLogin y goMenu: native/shim/ui.js (Object.assign(G.Flow, …)).
    // @step boot/test screen "Test y starters"
    // @screen scr-test
    // @sub onboarding
    // @next menu
  // @step meta/after
  /** Al cerrar el resumen: a la sala si sigues en una, si no al menú. */
  // @step meta/after decision "¿Sigue en sala?"
  // afterRun: en sala → lobby; si no → goMenu (avisos u oferta de Gmail).
  // @sub backmenu
  // @next menu "sin sala"
  afterRun() {
    if (G.Social.room) {
      if (G.Game.state !== 'ui') G.Game.toUI();
      G.Audio.music('village');
      if (G.Social.room.isHost) G.Social.setOpen(true);
      else G.Again.back();   // (al anfitrión: «ya estoy en la sala»)
      G.LobbyUI.open();
    } else this.goMenu();
  },
  play(endless = false) { G.Game.startRun(null, { endless }); },
  /** Empieza la partida en grupo (el anfitrión la manda a todos). */
  // @step coop/again decision "¿Sigue en el resumen?"
  // Si el anfitrión empieza otra y aquí sigue abierto el resumen (state 'over'), se cierra y se entra: el
  // anfitrión ya cuenta con todos los de la sala.
  // @next start "cerrar resumen"
  startCoop(cfg) {
    if (G.Game.state === 'over' && G.Social.room) {
      const b = document.getElementById('btn-again');
      if (b && b.onclick) b.onclick();
    }
    if (G.Game.state !== 'ui' || !G.Social.room) return;
    G.LobbyUI.close();
    G.Game.startRun(cfg);
  }
};

;
