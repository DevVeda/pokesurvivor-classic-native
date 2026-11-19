/* localcoop.js — cooperativo local (native/TODOS.md): hasta 4 copias del juego en la misma PS5 (main.c, «jugadores 2-4»)
 * juegan la misma partida de G.Coop por un canal en memoria (ps.lc_*), con un G.Net falso: sin servidor, cuenta ni red.
 * Los jugadores 2-4 anuncian su Pokémon desde su menú; «Jugar» del 1 (ui.js) arranca la partida de todos.
 * Pantalla partida dinámica (como los LEGO): los que están juntos comparten una cámara (la del centro del grupo); quien se
 * aleja tiene la suya y la pantalla se parte (Voronoi en main.c), sin salto: las cámaras coinciden justo al partirse. El 1
 * calcula el reparto, mueve su cámara, le manda a cada uno cuánto mover la suya (lc-cam) y le dice a main.c cómo componer
 * (ps.lc_layout); sólo pintan las copias cuya vista se ve. Si alguno está en las cartas o en su pausa (cada uno avisa de su
 * estado: lc-st), una celda cada uno. En los menús, sólo la pantalla del 1: los demás eligen en su plaza de la sala.
 * Mensajes: {f: remitente, m: mensaje}, por ps.lc_send(texto, a quién: 0-3).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  if (!ps.lc_send) return;   // (sin cooperativo local: la edición normal, el payload, el arnés de Node)
  // Un eboot más viejo que este archivo (sin lc_players / el lc_layout de 4): mejor sin cooperativo local que un error
  // en cada fotograma (pasó el 02-11 al subir los shims sin recompilar).
  if (!ps.lc_players) { console.error('[local] el eboot no trae el cooperativo de 4: hay que recompilarlo (Docker)'); return; }
  const IDX = ps.PLAYER || 0, ME = 'p' + (IDX + 1), HOST = 'p1', idx = uid => +uid.slice(1) - 1;
  const netL = new Set(), peerL = new Set();
  const raw = (to, m) => ps.lc_send(JSON.stringify({ f: ME, m }), idx(to));

  // G.Coop se apunta a G.Net.on/onPeer al montarse y los guarda donde no se ven: aquí se ven al apuntarse (appmin.js
  // llama a esto en cuanto existe G).
  globalThis.psHookG = G => {
    let net;
    Object.defineProperty(G, 'Net', { configurable: true, enumerable: true, get: () => net, set(v) {
      net = v;
      const on = v.on, off = v.off, onPeer = v.onPeer;
      v.on = f => { netL.add(f); return on.call(v, f); };
      v.off = f => { netL.delete(f); return off.call(v, f); };
      v.onPeer = f => { peerL.add(f); return onPeer.call(v, f); };
    } });
  };

  // G.Net falso mientras dura la partida local; al acabar, el de verdad.
  const FNS = ['send', 'toHost', 'broadcast', 'busy', 'slow', 'mode', 'peers'], PROPS = ['uid', 'isHost', 'hostUid'];
  let saved = null, members = [], nIn = 0, nOut = 0, retry = null;
  function fake() {
    if (saved) return;
    const N = G.Net, send = (to, m) => { if (to !== ME && members.includes(to)) { nOut++; raw(to, m); } };
    saved = { f: FNS.map(k => N[k]), p: PROPS.map(k => Object.getOwnPropertyDescriptor(N, k)) };
    Object.assign(N, { send, toHost: m => send(HOST, m), broadcast: m => members.forEach(u => send(u, m)), busy: () => false,
                       slow: () => false, mode: () => 'direct', peers: () => members.filter(u => u !== ME) });
    Object.defineProperty(N, 'uid', { get: () => ME, configurable: true });
    Object.defineProperty(N, 'isHost', { get: () => ME === HOST, configurable: true });
    Object.defineProperty(N, 'hostUid', { get: () => HOST, configurable: true });
  }
  function restore() {
    if (!saved) return;
    const N = G.Net;
    FNS.forEach((k, i) => { N[k] = saved.f[i]; });
    PROPS.forEach((k, i) => { if (saved.p[i]) Object.defineProperty(N, k, saved.p[i]); else delete N[k]; });
    saved = null;
    members = [];
    if (borrowed) {   // devolver el prestado
      const s = G.DB.save;
      if (s.partner === borrowed) s.partner = null;
      if (borrowedAdded) delete s.owned[borrowed];
      G.DB.commit();
      console.log('[local] devuelto el prestado (' + borrowed + ')');
      borrowed = 0;
    }
    console.log('[local] fin de la partida juntos');
  }
  const myName = uid => ps.USER_NAME || G.DB.user || uid.toUpperCase();   // (el de su perfil de la PS5, main.c)
  const meCard = uid => {
    const s = G.DB.save, dex = myDex();
    const card = { uid, name: myName(uid), dex, shiny: dex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(dex) };
    // (lo que pinta la sala del 1: dónde va en su carrusel, los de al lado y, si la tiene abierta, su Pokédex)
    const list = carousel(), i = Math.max(0, list.indexOf(dex)), at = k => list[(i + k + list.length) % list.length];
    Object.assign(card, { i, n: list.length, f: ownSave() ? filter : '', near: list.length > 2 ? [at(-1), at(1)] : [], dexOk: ownSave(), dx: dexState() });
    return card;
  };
  // Sin partida (un usuario nuevo de la PS5, jugadores 2-4): lleva un Pokémon del 1 (lc-roster), prestado sólo para la
  // partida; lo que gane se queda en su cuenta local. ponytail: al juntarla con una cuenta online, la del juego (merge).
  let roster = [], borrowed = 0, borrowedAdded = false;
  const myDex = () => (G.DB.save && G.DB.save.partner && !borrowed) ? G.DB.save.partner : borrowed || roster[0] || 0;
  function begin(cfg) {
    const s = G.DB.save, mine = cfg.members.find(m => m.uid === ME);
    if (IDX && mine && !s.partner) {   // prestado: que el juego lo vea como suyo mientras dura
      borrowed = mine.dex; borrowedAdded = !s.owned[mine.dex];
      if (borrowedAdded) s.owned[mine.dex] = { at: Date.now() };
      s.partner = mine.dex;
    }
    members = cfg.members.map(m => m.uid);
    fake();
    if (globalThis.psUiClose) psUiClose();
    G.UI.hideAll();
    G.Game.startRun(cfg);
    console.log('[local] partida juntos: ' + cfg.members.map(m => m.uid + ' ' + m.dex).join(', ') + ' (semilla ' + cfg.seed + ')');
  }

  // Cada copia sigue a su jugador más este desplazamiento (unidades del mundo, el de la pantalla partida) y, al separarse,
  // se aleja como con el orbe luminoso (zoomTo 1,35; la cámara llega sola, suave): camZoom, el mismo para todos. Sólo
  // mientras sigue (follow): lo demás del juego ve su zoomTo de siempre; el del orbe se suma.
  let camOff = [0, 0], camZoom = 1, camHooked = false, camBox = null;   // camBox: su zona, partida (píxeles de dibujo)
  function hookCam() {
    if (camHooked || !G.Camera) return;
    camHooked = true;
    const follow = G.Camera.follow;
    G.Camera.follow = function (x, y, dt) {
      const z = this.zoomTo;
      this.zoomTo = z + camZoom - 1;   // (se suman: con la pantalla alejada, el orbe luminoso aún aleja más)
      try { return follow.call(this, x + camOff[0], y + camOff[1], dt); } finally { this.zoomTo = z; }
    };
  }

  // Los avisos de la partida (G.Spawner.say: «¡X se ha enfurecido!», los de los compañeros…): cada copia los pintaba en
  // su pantalla y, partida, sólo se veía el trozo de su zona. En la partida juntos nadie los pinta en la suya; el 1 los
  // pinta en una capa (un lienzo de 960x110) que main.c pone encima de todo (ps.lc_overlay), con el estilo del HUD.
  let bannerHooked = false, ovCv = null, ovKey = '', ovLines = {}, ovT = {};
  const realBanner = () => (G.Spawner && G.Spawner._psBanner ? G.Spawner._psBanner() : null);
  function hookBanner() {
    if (bannerHooked || !G.Spawner || !G.Spawner.banner) return;
    bannerHooked = true;
    const orig = G.Spawner.banner;
    G.Spawner._psBanner = orig;
    G.Spawner.banner = function () { return saved ? null : orig.apply(this, arguments); };
  }
  const OVY = Math.round(ps.H * 0.3) - 55, OV_MAX = 3;
  function drawOverlay() {
    // El tiempo que le queda va por el reloj de aquí: el del juego (Spawner.tickBanner) se para si el 1 está en pausa o
    // eligiendo, y el aviso se quedaba pegado en la pantalla de todos.
    const r = saved && realBanner(), now = ps.now();
    if (r && (r.text !== ovT.text || r.t > ovT.last + 0.05)) ovT = { text: r.text, dur: r.t, at: now };   // (uno nuevo)
    if (r) ovT.last = r.t;
    const left = r ? Math.min(r.t, ovT.dur - (now - ovT.at) / 1000, OV_MAX - (now - ovT.at) / 1000) : 0;   // (3 s como mucho)
    const b = r && left > 0 ? { text: r.text, t: left } : null;
    if (!b) { if (ovKey) { ovKey = ''; ps.lc_overlay(-1, 0); } return; }
    // (al desvanecerse, en pasos de 0,2: antes se volvía a componer el texto cada fotograma, un tirón en cada aviso)
    const a = Math.ceil(Math.min(1, 1.6 * b.t) * 5) / 5, key = b.text + '|' + a;
    if (!ovCv) { ovCv = document.createElement('canvas'); ovCv.width = ps.W; ovCv.height = 110; }
    if (key !== ovKey) {
      ovKey = key;
      const c = ovCv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, ovCv.width, ovCv.height);
      let px = 16, lines = ovLines.text === b.text ? ovLines.lines : null;
      if (lines) px = ovLines.px;
      else for (;;) {   // como el HUD: la letra baja hasta que cabe en 3 líneas
        c.font = 'bold ' + px + 'px Pixelify';
        lines = [];
        let line = '';
        for (const w of String(b.text).split(' ')) {
          const t = line ? line + ' ' + w : w;
          if (line && c.measureText(t).width > ps.W - 40) { lines.push(line); line = w; } else line = t;
        }
        if (line) lines.push(line);
        if (lines.length <= 3 || px <= 11) { ovLines = { text: b.text, lines, px }; break; }
        px -= 1.5;
      }
      c.font = 'bold ' + px + 'px Pixelify';
      c.globalAlpha = a; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ffcb3d'; c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3;
      lines.forEach((l, i) => { const y = 55 + (i - (lines.length - 1) / 2) * px * 1.25; c.strokeText(l, ps.W / 2, y); c.fillText(l, ps.W / 2, y); });
    }
    ps.lc_overlay(ovCv._sid, OVY);
  }

  // El HUD de cada uno: en la partida juntos, su barra de ataques y su objeto (la franja de abajo) no van en su pantalla
  // (partida, se cortaban por la zona) sino en un lienzo aparte, que main.c pone en su esquina con su color (ps.lc_hud).
  // Lo demás del HUD (vida, nivel, tiempo) sigue en su pantalla: el HUD se pinta una vez en ese lienzo y a la pantalla se
  // copia sólo la parte de arriba (pintarlo dos veces con recorte costaba 4-5 ms por fotograma en PlutoVG).
  let hudHooked = false, hudCv = null, hudOn = false;
  // Alto de la franja de la barra, en píxeles del juego (1280x720): casillas de 54 a 18 del borde, sus rótulos, encima la
  // fila de esferas (40, a 30 de las casillas) y, con mando, el nombre de la elegida encima (20, a 8). Como HY0/HH de main.c
  // (406..540 en píxeles de dibujo).
  const BAR = 178;
  function hookHUD() {
    if (hudHooked || !G.HUD || !G.HUD.draw || !ps.lc_hud) return;
    hudHooked = true;
    const orig = G.HUD.draw;
    G.HUD.draw = function (ctx, w, h, ...rest) {
      if (!saved) return orig.call(this, ctx, w, h, ...rest);
      if (!hudCv) { hudCv = document.createElement('canvas'); hudCv.width = ps.W; hudCv.height = ps.H; }
      const c = hudCv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, ps.W, ps.H);
      c.setTransform(ps.W / w, 0, 0, ps.H / h, 0, 0);
      // Sin compañeros para el HUD (G.Coop.mates es un get): su lista de vida (bajo la propia, que acababa en la esquina
      // de cada uno) y las flechas hacia los que no se ven; partida, cada uno tiene su vida en su esquina y su zona.
      const mates = Object.getOwnPropertyDescriptor(G.Coop, 'mates');
      // (Y sin «Ver a un compañero» al caer, que mira por puppets: aquí se ven todos.)
      const puppets = G.Coop.puppets;
      Object.defineProperty(G.Coop, 'mates', { get: () => [], configurable: true });
      G.Coop.puppets = () => [];
      // Partida: las flechas hacia lo que no se ve (shinies, Meowth, la grieta, jefes…) van al borde de su pantalla, que es
      // la zona de otro. Todas se colocan con U.clamp(x, m, w - m) y U.clamp(y, a, h - 10 - a): mientras se pinta el HUD,
      // esas dos se encajan además en su zona (camBox). ponytail: por la forma de la llamada; si el juego cambia, se ven cortadas.
      const clamp = G.U.clamp, bx = camBox && camBox.map((v, i) => v * (i % 2 ? h / ps.H : w / ps.W));
      if (bx) G.U.clamp = (v, lo, hi) => {
        if (lo > 0 && lo + hi === w) return clamp(v, Math.max(lo, bx[0] + lo), Math.min(hi, bx[2] - lo));
        if (lo > 0 && lo + hi === h - 10) return clamp(v, Math.max(lo, bx[1] + lo), Math.min(hi, bx[3] - (h - hi)));
        return clamp(v, lo, hi);
      };
      try { orig.call(this, c, w, h, ...rest); } finally {
        c.setTransform(1, 0, 0, 1, 0, 0); Object.defineProperty(G.Coop, 'mates', mates); G.Coop.puppets = puppets; G.U.clamp = clamp;
      }
      // A la pantalla, todo menos la barra (abajo) y el bloque de vida (arriba a la izquierda, 8..184 x 10..56 en píxeles de
      // dibujo, como LX0/LY0/LW/LH de main.c): eso va en su esquina. La experiencia (del equipo) y el tiempo se quedan.
      const top = Math.round(ps.H * (h - BAR) / h), kx = w / ps.W, ky = h / ps.H, LIST = 56;   // (en píxeles de dibujo)
      ctx.drawImage(hudCv, 0, 0, ps.W, 10, 0, 0, w, 10 * ky);
      ctx.drawImage(hudCv, 184, 10, ps.W - 184, LIST - 10, 184 * kx, 10 * ky, (ps.W - 184) * kx, (LIST - 10) * ky);
      // Caído: el aviso y la barra de levantarse (en el centro, 0,62 del alto) no van en el centro, que partida es de otro,
      // sino bajo su Pokémon, en su zona.
      const pl = G.Game.player, Cam = G.Camera, dead = pl && pl.dead && Cam;
      const s0 = Math.round(ps.H * (0.62 * h - 26) / h), s1 = Math.round(ps.H * (0.62 * h + 24) / h);
      (dead ? [[LIST, s0], [s1, top]] : [[LIST, top]]).forEach(([a, b]) => ctx.drawImage(hudCv, 0, a, ps.W, b - a, 0, a * ky, w, (b - a) * ky));
      if (dead) {
        const x = (pl.x - Cam.left()) * Cam.scale, y = (pl.y - Cam.top()) * Cam.scale + 24;
        ctx.drawImage(hudCv, 0, s0, ps.W, s1 - s0, x - w / 2, y, w, (s1 - s0) * ky);
      }
      if (!hudOn && G.Game.state !== 'over') { hudOn = true; ps.lc_hud(hudCv._sid, parseInt(String((G.Coop.COLORS || [])[IDX] || '#f4f8ff').replace('#', ''), 16) || 0xf4f8ff); }
    };
  }

  // El reparto (jugador 1). Primero, grupos: los que están cerca entre sí (menos de R en pantalla) comparten cámara. Cada
  // grupo va en su sitio de la pantalla (píxeles de dibujo, 960x540): el de su centro respecto al de todos, como mucho a R
  // del medio; los grupos que no llegan a R comparten la cámara del centro de todos (la pinta el primero de ellos) y, si
  // ninguno llega, no se parte. De cada grupo pinta su primer jugador; cada uno mueve su cámara lo que diga su grupo.
  const R = 170, CX = ps.W / 2, CY = ps.H / 2, ZMAX = 1.6, ZROOM = 1.8, ZARENA = 3;
  // La zona de un sitio en la pantalla (Voronoi: el rectángulo recortado por las mediatrices con los demás) y su centro.
  function cellPoly(s, others) {
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
  function cellCenter(s, others) {
    const poly = cellPoly(s, others);
    if (poly.length < 3) return s;
    let A = 0, x = 0, y = 0;   // (centroide del polígono)
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], cr = p[0] * q[1] - q[0] * p[1];
      A += cr; x += (p[0] + q[0]) * cr; y += (p[1] + q[1]) * cr;
    }
    return Math.abs(A) < 1 ? s : [x / (3 * A), y / (3 * A)];
  }
  function splitN() {
    const pts = members.map(u => ({ u, i: idx(u), p: u === ME ? G.Game.player : G.Coop.puppets().find(q => q.uid === u) })).filter(e => e.p);
    if (pts.length < 2) return null;
    // En la grieta y ante Arceus: todos con la misma cámara, en el medio de todos y alejada lo que haga falta para que se
    // vean todos (hasta ZARENA); al salir, vuelve el reparto de siempre.
    if ((G.Rift && G.Rift.inArena) || (G.Judgment && G.Judgment.active)) {
      // Quieta en el medio del recinto (psArena, boot.js) y con todo su borde a la vista; sin recinto, en el medio de todos.
      const k1 = G.Camera.scale * G.Camera.zoom * G.Camera.dpr, A = globalThis.psArena, TS = G.World.TS || 32;
      let cx, cy, ex = 0, ey = 0;
      if (A) { cx = (A.tx + 0.5) * TS; cy = (A.ty + 0.5) * TS; ex = ey = (A.r + 1.5) * TS * k1; }
      else {
        cx = pts.reduce((a, e) => a + e.p.x, 0) / pts.length; cy = pts.reduce((a, e) => a + e.p.y, 0) / pts.length;
        for (const e of pts) { ex = Math.max(ex, Math.abs(e.p.x - cx) * k1 / 0.8); ey = Math.max(ey, Math.abs(e.p.y - cy) * k1 / 0.72); }
      }
      const z = Math.min(ZARENA, Math.max(1, ex / (0.5 * ps.W), ey / (0.5 * ps.H)));
      for (const e of pts) { e.off = [cx - e.p.x, cy - e.p.y]; e.s = [CX, CY]; e.src = 0; e.box = null; }
      return { mode: 0, mask: 1, pts, z };
    }
    // k: píxeles por unidad sin el zoom (el reparto no depende de él: si no, al alejarse se juntarían y se volvería a
    // acercar); A: elipse, la pantalla es más ancha que alta.
    const k = G.Camera.scale * G.Camera.zoom * G.Camera.dpr, A = ps.W / ps.H, zoom = G.Camera.zoom || 1;
    const dist = (ax, ay, bx, by) => Math.hypot((ax - bx) * k, (ay - by) * k * A);
    pts.forEach(e => { e.g = e; });   // grupos: unión de los que están a menos de R (en cadena)
    const root = e => (e.g === e ? e : (e.g = root(e.g)));
    for (const a of pts) for (const b of pts) if (a !== b && dist(a.p.x, a.p.y, b.p.x, b.p.y) < R) root(a).g = root(b);
    const groups = new Map();
    for (const e of pts) { const r = root(e); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e); }
    const cx = pts.reduce((a, e) => a + e.p.x, 0) / pts.length, cy = pts.reduce((a, e) => a + e.p.y, 0) / pts.length;
    let mask = 1, far = false, spread = 0;
    for (const e of pts) spread = Math.max(spread, dist(e.p.x, e.p.y, cx, cy));
    let z = 1 + (ZMAX - 1) * Math.min(1, Math.max(0, (spread - 0.7 * R) / (0.6 * R)));   // (empieza antes de partirse)
    const inner = [], sites = [], grp = [];
    for (const g of groups.values()) {
      const gx = g.reduce((a, e) => a + e.p.x, 0) / g.length, gy = g.reduce((a, e) => a + e.p.y, 0) / g.length;
      let dx = (gx - cx) * k, dy = (gy - cy) * k;
      const d = Math.hypot(dx, dy * A), lead = Math.min(...g.map(e => e.i));
      if (d > R) { far = true; dx *= R / d; dy *= R / d; } else inner.push(...g);
      sites.push([dx, dy]);
      if (d > 0.85 * R) mask |= 1 << lead;   // (empieza a pintar un poco antes de que se le vea)
      // (en pantalla, con el zoom de ahora, el grupo sale en su sitio acercado al medio: ahí va su zona; la cámara, abajo)
      const site = [CX + dx / zoom, CY + dy / zoom];
      grp.push({ g, gx, gy, d, site });
      for (const e of g) { e.s = site; e.src = d > R ? lead : -1; }
    }
    // Partida, cada zona tiene el espacio que hay de su jugador a la línea (la mitad de la distancia entre sitios): de lado,
    // R; de arriba abajo, mucho menos (la pantalla es más ancha que alta). Con menos espacio, más lejos: hasta ZROOM, y
    // entrando poco a poco según se parte (sin salto).
    if (far && sites.length > 1) {
      let room = Infinity;
      for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) room = Math.min(room, Math.hypot(sites[a][0] - sites[b][0], sites[a][1] - sites[b][1]) / 2);
      const t = Math.min(1, Math.max(0, (spread - R) / (0.5 * R)));
      z = Math.max(z, 1 + (Math.min(ZROOM, R / Math.max(room, 1)) - 1) * t);
    }
    // Cada cámara: el grupo en el centro de su zona (si no, quedaba en un vértice y no se veía hacia el medio), entrando
    // poco a poco según se separa (justo al partirse, en su sitio: sin salto). Las líneas no cambian (van por los sitios).
    for (const G2 of grp) {
      const t = Math.min(1, Math.max(0, (G2.d - R) / (0.5 * R)));
      const c = t > 0 ? cellCenter(G2.site, grp.filter(o => o !== G2).map(o => o.site)) : G2.site;
      const qx = G2.site[0] + (c[0] - G2.site[0]) * t, qy = G2.site[1] + (c[1] - G2.site[1]) * t;
      const kz = k / zoom, camX = G2.gx - (qx - CX) / kz, camY = G2.gy - (qy - CY) / kz;   // (kz: píxeles por unidad con el zoom)
      // Su zona en la pantalla (el rectángulo que la contiene): ahí van sus flechas (hookHUD).
      const poly = far ? cellPoly(G2.site, grp.filter(o => o !== G2).map(o => o.site)) : [];
      const box = poly.length > 2 ? [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))] : null;
      for (const e of G2.g) { e.off = [camX - e.p.x, camY - e.p.y]; e.box = box; }
    }
    const center = inner.length ? Math.min(...inner.map(e => e.i)) : 0;   // quién pinta la cámara del centro
    for (const e of pts) { if (e.src < 0) e.src = center; mask |= 1 << e.src; }
    return { mode: far ? 2 : 0, mask, pts, z };
  }

  let lastRoute = -1;
  let lastFromHost = 0, quietLogged = false, lastLogSt = '', lastPump = 0, snapHeld = false;
  function snapshot(why) {
    try {
      const open = ['scr-pause', 'scr-levelup', 'scr-item', 'scr-bond', 'scr-over'].filter(id => G.UI.isOpen(id));
      const pl = G.Game.player;
      console.log('[foto] ' + why + ' · t ' + (ps.now() / 1000).toFixed(1) + ' s · estado ' + G.Game.state + ' · ui ' + (globalThis.psTopInfo ? psTopInfo() : '?') +
        ' · abiertas ' + (open.join(' ') || 'ninguna') + ' · juntos ' + (saved ? members.join(' ') : 'no') + ' · coop ' + !!(G.Coop && G.Coop.active) +
        ' · jugador ' + (pl ? Math.round(pl.x) + ',' + Math.round(pl.y) + (pl.dead ? ' caído' : '') : '—') + ' · cámara +' + camOff.map(Math.round).join(',') + ' ×' + camZoom.toFixed(2) +
        (IDX ? ' · del 1 hace ' + Math.round(ps.now() - lastFromHost) + ' ms' : ' · estados ' + JSON.stringify(states)) + ' · grieta ' + !!(G.Rift && G.Rift.inArena));
    } catch (e) { console.log('[foto] ' + e.message); }
  }
  let hellos = {}, noSave = {}, lastHello = 0, lastStat = 0, lastSeed = 0, lastSt = '', states = {}, joined = true;
  const fresh = () => Object.values(hellos).filter(h => ps.now() - h.at < 3000).sort((a, b) => idx(a.uid) - idx(b.uid));
  console.log('[local] cargado (jugador ' + (IDX + 1) + ')');
  globalThis.psLocalRun = () => !!saved;
  globalThis.psHudCv = () => (saved && hudOn ? hudCv : null);   // (ui.js: las teclas de la barra, en su esquina)
  // Los Pokémon que puede llevar cada uno (jugadores 2-4, desde su plaza de la sala): favoritos y luego los de más mejoras.
  // Su carrusel en la sala, por número de Pokédex (el 100: a los lados el 99 y el 101 si los tiene): 'all' (todos los
  // suyos) o 'fav' (sólo favoritos). Sin partida, los que le pasa el 1 (roster), sin filtro ni Pokédex.
  let filter = 'all';
  const ownSave = () => !!(G.DB.save && G.DB.save.partner && !borrowed);
  const owned = () => Object.keys((G.DB.save && G.DB.save.owned) || {}).map(Number).filter(d => G.DEX_BY[d] && G.SPRITE_META[d]);
  // Lo que el 1 presta a los que no tienen partida: favoritos y luego los de más mejoras (40).
  function candidates() {
    const s = G.DB.save, lv = d => Object.values((s.pupg && s.pupg[d]) || {}).reduce((a, b) => a + b, 0);
    return owned().sort((a, b) => G.DB.isFav(b) - G.DB.isFav(a) || lv(b) - lv(a) || a - b).slice(0, 40);
  }
  function carousel() {   // (todos, el 1 incluido)
    if (!ownSave()) return roster;
    const own = owned(), fav = own.filter(d => G.DB.isFav(d));
    return (filter === 'fav' && fav.length ? fav : own).sort((a, b) => a - b);
  }
  // Su Pokédex, dentro de su carta de la sala (□): 3 x 5 por página, de los suyos por número, con un tipo (△) o todos.
  const DCOLS = 3, DPAGE = 15;
  let dex = null;   // { list, c, type }
  const dexBuild = () => { const t = dex.type; dex.list = owned().filter(d => !t || (G.DEX_BY[d].types || []).includes(t)).sort((a, b) => a - b); };
  function dexState() {
    if (!dex) return null;
    const p = Math.floor(dex.c / DPAGE);
    return { cells: dex.list.slice(p * DPAGE, p * DPAGE + DPAGE), sel: dex.c - p * DPAGE, page: p + 1, pages: Math.max(1, Math.ceil(dex.list.length / DPAGE)), type: dex.type || '', n: dex.list.length };
  }
  function choose(dex, shiny) {   // (jugadores 2-4) su Pokémon para la partida; se anuncia en seguida
    const s = G.DB.save;
    console.log('[sala] p' + (IDX + 1) + ' elige ' + dex + (shiny ? ' shiny' : ''));
    // (se guarda al parar de pasar: guardar en cada pulsación era todo el JSON de la cuenta cada vez)
    if (ownSave()) { s.partner = dex; s.partnerShiny = !!shiny && G.DB.ownsShiny(dex); clearTimeout(choose.t); choose.t = setTimeout(() => G.DB.commit(), 1500); }
    else roster = [dex].concat(roster.filter(d => d !== dex));   // (sin partida: el elegido va primero)
    lastHello = 0;
  }
  globalThis.psLocal = {
    // ¿Puede el 1 empezar con los demás? (alguno está, con su Pokémon elegido, en su menú, y lo ha dicho hace poco)
    ready: () => !IDX && ps.lc_peer() && fresh().length > 0,
    // La sala (jugador 1): él y los que están listos, en su plaza (idx 0-3).
    players: () => [Object.assign(meCard('p1'), { idx: 0 })].concat(fresh().map(h => ({ uid: h.uid, idx: idx(h.uid), name: h.name, dex: h.dex, shiny: h.shiny, i: h.i, n: h.n, f: h.f, near: h.near || [], dexOk: h.dexOk, dx: h.dx || null }))),
    // Su Pokédex en la carta: abrir, mover (←→ ±1, ↑↓ ±3, L1/R1 ±15), △ tipo, ✕ elegir, ○ cerrar.
    dexOn: () => !!dex,
    dexOpen() { if (!ownSave()) return false; dex = { c: 0, type: null }; dexBuild(); dex.c = Math.max(0, dex.list.indexOf(myDex())); lastHello = 0; return true; },
    dexClose() { dex = null; lastHello = 0; },
    dexMove(k) { if (!dex || !dex.list.length) return false; dex.c = Math.max(0, Math.min(dex.list.length - 1, dex.c + k)); lastHello = 0; return true; },
    dexType() {
      if (!dex) return false;
      const types = [null, ...new Set(owned().flatMap(d => G.DEX_BY[d].types || []))];
      dex.type = types[(types.indexOf(dex.type) + 1) % types.length];
      dexBuild(); dex.c = 0; lastHello = 0;
      return true;
    },
    dexPick() { const d = dex && dex.list[dex.c]; if (!d) return false; choose(d, false); dex = null; return true; },
    // Jugadores 2-4: cambiar de Pokémon (△ / ←→ en su plaza); se anuncia en seguida.
    // (dir: ±1 de uno en uno, ±10 de diez en diez)
    cycle(dir) {
      const list = carousel();
      if (!G.DB.save || list.length < 2) return false;
      const i = list.indexOf(myDex()), n = list.length;
      choose(list[(((i < 0 ? 0 : i) + dir) % n + n) % n], false);
      return true;
    },
    // ↑↓: favoritos ↔ todos (se queda con el que lleva si está en la otra lista)
    filter() {
      if (!ownSave()) return false;
      filter = filter === 'fav' ? 'all' : 'fav';
      if (!carousel().includes(myDex())) choose(carousel()[0], false);
      lastHello = 0;
      return true;
    },
    shiny() {
      const s = G.DB.save, d = myDex();
      if (!ownSave() || !G.DB.ownsShiny(d)) return false;
      choose(d, !s.partnerShiny);
      return true;
    },
    canDex: ownSave,
    pick: d => { if (d && ownSave()) choose(d, false); },
    myDex,
    // Jugadores 2-4, en su plaza: ○ la deja (sigue su copia, sin plaza), ✕ vuelve a entrar.
    joined: () => joined,
    leave() { if (!joined) return false; joined = false; raw(HOST, { k: 'lc-bye' }); return true; },
    join() { if (joined) return false; joined = true; lastHello = 0; return true; },
    // Jugador 1, al acabar la partida juntos: todos a la sala; again: otra partida en cuanto estén los mismos.
    toRoom(again) {
      members.filter(u => u !== ME).forEach(u => raw(u, { k: 'lc-room' }));
      retry = again ? { who: members.filter(u => u !== ME), at: ps.now() } : null;
    },
    start() {
      const others = fresh().map(h => ({ uid: h.uid, name: h.name, dex: h.dex, shiny: h.shiny }));
      console.log('[local] Jugar: con ' + others.map(h => h.uid + ' (' + h.name + ', ' + h.dex + ')').join(', '));
      const cfg = { k: 'start', seed: (globalThis.psNextSeed && psNextSeed()) || Math.floor(Math.random() * 1e6) || 1, host: HOST, hw: !!G.Halloween.on, members: [meCard('p1')].concat(others) };
      others.forEach(h => raw(h.uid, cfg));
      begin(cfg);
    },
  };

  setInterval(() => {
    let t;
    if (IDX && saved && lastFromHost && ps.now() - lastFromHost > 500 && !quietLogged) { quietLogged = true; console.log('[local] sin noticias del 1 desde hace ' + Math.round(ps.now() - lastFromHost) + ' ms (' + G.Game.state + ')'); }
    while ((t = ps.lc_recv()) != null) {
      let e;
      try { e = JSON.parse(t); } catch (err) { continue; }
      const f = e.f, m = e.m || {};
      nIn++;
      if (f === HOST && IDX) { if (quietLogged) console.log('[local] noticias del 1 otra vez, tras ' + Math.round(ps.now() - lastFromHost) + ' ms'); lastFromHost = ps.now(); quietLogged = false; }
      if (m.k === 'lc-hello') {
        if (!m.dex) { if (!noSave[f]) { noSave[f] = 1; console.log('[local] ' + f + ' está en su menú, sin partida: le paso los Pokémon del 1'); }
                      raw(f, { k: 'lc-roster', list: candidates() }); continue; }   // sin partida: que elija de los del 1
        if (!hellos[f]) console.log('[local] ' + f + ' está en su menú (' + m.name + ', ' + m.dex + ')');
        else if (hellos[f].dex !== m.dex) console.log('[sala] ' + f + ' → ' + m.dex + ' (' + (m.i + 1) + '/' + m.n + ')');
        hellos[f] = Object.assign(m, { uid: f, at: ps.now() });
        continue;
      }
      if (m.k === 'lc-bye') { if (hellos[f]) console.log('[local] ' + f + ' deja su plaza'); delete hellos[f]; continue; }
      if (m.k === 'lc-snap') { snapshot('pedido por ' + f); continue; }
      if (m.k === 'lc-seed') { if (IDX && globalThis.psSetNextSeed) psSetNextSeed(m.s); continue; }
      if (m.k === 'lc-roster') { if (!roster.length) { roster = m.list || []; lastHello = 0; } continue; }
      if (m.k === 'start') { if (IDX && G.Game.state === 'ui') begin(m); continue; }
      if (m.k === 'lc-cam') { if (saved) { camOff = [m.x, m.y]; camZoom = m.z || 1; camBox = m.b || null; } continue; }
      if (m.k === 'lc-st') { states[f] = m.st; continue; }
      if (m.k === 'lc-room') { if (IDX && globalThis.psBackToRoom) psBackToRoom(); continue; }
      if (saved) netL.forEach(fn => { try { fn(f, m); } catch (err) { console.error('[local] ' + err.message); } });
    }
    const st = G.Game.state, tnow = ps.now();
    // (Diagnóstico) cada cambio de estado, con la hora; y L3 + R3 en cualquier mando: lo que hace cada copia en ese momento.
    if (st !== lastLogSt) { console.log('[estado] ' + (lastLogSt || '—') + ' → ' + st + ' a los ' + (tnow / 1000).toFixed(1) + ' s'); lastLogSt = st; }
    const pumpGap = lastPump ? tnow - lastPump : 0;
    if (pumpGap > 300 && saved) console.log('[local] este bucle no corrió en ' + Math.round(pumpGap) + ' ms (' + st + ')');
    lastPump = tnow;
    const pb = globalThis.psPadRaw ? psPadRaw().buttons : [];
    if (pb[10] && pb[11] && !snapHeld) {
      snapHeld = true;
      snapshot('mando');
      members.filter(u => u !== ME).forEach(u => raw(u, { k: 'lc-snap' }));
    } else if (!(pb[10] && pb[11])) snapHeld = false;
    hookCam();
    hookBanner();
    hookHUD();
    if ((!saved || st === 'over') && hudOn) { hudOn = false; ps.lc_hud(-1); }
    if (!IDX && ps.lc_overlay) drawOverlay();
    const myState = () => (G.UI.isOpen('scr-pause') ? 'paused' : st);   // (la pausa no cambia G.Game.state)
    if (saved && st === 'ui' && !G.Coop.active) restore();
    if (!saved) { camOff = [0, 0]; camZoom = 1; camBox = null; states = {}; lastSt = ''; }
    if (IDX) {   // jugadores 2-4: «aquí estoy» cada segundo desde el menú; en la partida, su estado (pausa, cartas…)
      if (joined && st === 'ui' && G.DB.save && ps.now() - lastHello > 1000) { lastHello = ps.now(); raw(HOST, Object.assign(meCard(ME), { k: 'lc-hello' })); }
      if (saved && myState() !== lastSt) { lastSt = myState(); raw(HOST, { k: 'lc-st', st: lastSt }); }
    } else {   // jugador 1: cómo se ve (main.c) y por dónde suena (audio.c)
      // Con otro en la sala o en la partida: cada uno por su mando (Ajustes → Sonido: «Mandos»), o sólo el 1 por la tele.
      const many = ps.lc_peer() && (saved ? members.length > 1 : fresh().length > 0);
      let pref = 'pads'; try { pref = localStorage.getItem('ps5.mpAudio') || 'pads'; } catch (e) { /* nada */ }
      const route = many && pref !== 'tv' ? 1 : 0;
      if (route !== lastRoute && ps.au_route) { lastRoute = route; ps.au_route(route); console.log('[sonido] ' + (route ? 'cada uno por su mando' : 'por la tele')); }
      if (st === 'ui' && globalThis.psNextSeed && psNextSeed() && ps.now() - lastSeed > 2000) {   // (su semilla, a los de la sala)
        lastSeed = ps.now();
        fresh().forEach(h => raw(h.uid, { k: 'lc-seed', s: psNextSeed() }));
      }
      if (retry && !saved) {   // Reintentar: cuando los de antes vuelven a estar en la sala (o, a los 10 s, se queda en ella)
        const here = fresh().map(h => h.uid);
        if (retry.who.every(u => here.includes(u))) { retry = null; psLocal.start(); }
        else if (ps.now() - retry.at > 10000) { console.log('[local] Reintentar: no han vuelto todos, se queda en la sala'); retry = null; }
      }
      const all = ps.lc_players();
      if (!ps.lc_peer()) ps.lc_layout(0, 1, 0);
      else if (!saved || st === 'over') ps.lc_layout(0, 1, 0);   // menús y el resumen del final: sólo la del 1
      else {   // (pausa, cartas: la pantalla no cambia; cada ventana va en el cuarto de su jugador, ui.js → ps.lc_win)
        const L = splitN();
        if (L) {
          const mine = L.pts.find(e => e.u === ME);
          if (mine) { camOff = mine.off; camBox = mine.box; }
          camZoom = L.z;
          L.pts.forEach(e => { if (e.u !== ME) raw(e.u, { k: 'lc-cam', x: e.off[0], y: e.off[1], z: L.z, b: e.box }); });
          ps.lc_layout(L.mode, L.mask, L.pts.length, ...L.pts.flatMap(e => [e.s[0], e.s[1], e.src]));
        }
      }
    }
    if (ps.now() - lastStat > 5000) {   // diagnóstico: cuánto va y viene
      lastStat = ps.now();
      console.log('[local] ' + st + (saved ? ', juntos (' + members.join(' ') + ')' : '') + ' · recibidos ' + nIn + ' · enviados ' + nOut + (IDX ? '' : ' · listos: ' + fresh().map(h => h.uid).join(' ')));
      nIn = nOut = 0;
    }
  }, 16);
})();
