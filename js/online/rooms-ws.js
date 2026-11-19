/* ============ rooms-ws.js — salas del cooperativo por WebSocket propio (31-10-2026) ============
 * Las salas (quién está, abierta o no) y las señales WebRTC van por wss://ice.pokesurvivor.com/rooms en vez de
 * Realtime Database. Peticiones con respuesta ({ t, ... } -> { t: 'res', q, ok, error }) y avisos del servidor
 * ('room', 'closed', 'sig'). Si se corta, se vuelve a conectar y a entrar en la sala (el anfitrión la vuelve a crear).
 * localStorage ps.rooms = 'rtdb': las salas de antes (Realtime Database).
 * _env: WebSocket y el token de Firebase (para las pruebas).
 */
// @step net/sigsrv net "Servidor de salas"
// Por defecto WebSocket propio (G.RoomsWS, si G.ENV.server y no ps.rooms='rtdb'); si no, Realtime
// Database.
// @next answer
G.RoomsWS = (() => {
  const pref = G.U.ls.get('ps.rooms');
  const ON = !!G.ENV.server && pref !== 'rtdb';   // sin servidor propio: salas por Realtime Database
  let ws = null, ready = null, room = null, tries = 0, retryT = 0, bye = false;
  const subs = new Set(), waiting = new Map();
  const emit = (t, m) => subs.forEach(f => { try { f(t, m); } catch (e) { console.warn(e); } });
  const env = {
    WebSocket: typeof WebSocket !== 'undefined' ? WebSocket : null,
    token: () => G.DB.fb.auth.currentUser.getIdToken()
  };

  /** Conecta (una vez) y se identifica: resuelve con el 'hello' del servidor. */
  function connect() {
    if (ready) return ready;
    bye = false;
    ready = new Promise((resolve, reject) => {
      let done = false;
      const s = ws = new env.WebSocket(G.ENV.server.replace(/^http/, 'ws') + '/rooms');
      const fail = e => { if (!done) { done = true; reject(e); } };
      s.onopen = async () => {
        try { s.send(JSON.stringify({ t: 'auth', token: await env.token() })); }
        catch (e) { fail(e); s.close(); }
      };
      s.onmessage = ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hello') { done = true; tries = 0; resolve(); return; }
        if (m.t === 'res') {
          const w = waiting.get(m.q);
          if (w) { waiting.delete(m.q); clearTimeout(w.t); w.res(m); }
          return;
        }
        if (m.t === 'room' || m.t === 'closed' || m.t === 'sig') emit(m.t, m);
      };
      s.onclose = ev => {
        if (ws === s) { ws = null; ready = null; }
        fail(Error('closed ' + (ev && ev.code)));
        for (const [q, w] of waiting) { clearTimeout(w.t); w.res({ ok: false, error: 'down' }); waiting.delete(q); }
        // 4002: la misma cuenta ha entrado en otra pestaña o aparato.
        if (ev && ev.code === 4002) { room = null; emit('closed', { why: 'replaced' }); return; }
        if (!bye && room) reconnect();
      };
      s.onerror = () => {};
    });
    ready.catch(() => {});
    return ready;
  }

  /** Se ha cortado estando en una sala: se vuelve a entrar (1 s, 2 s, 4 s... hasta 15 s). */
  function reconnect() {
    clearTimeout(retryT);
    retryT = setTimeout(async () => {
      if (!room || bye) return;
      try {
        await connect();
        let r = await ask({ t: 'join', id: room.id, me: room.me }, room.id);
        // La sala se cerró mientras tanto: el anfitrión la vuelve a abrir.
        if (!r.ok && room && room.host && r.error === 'gone') r = await ask({ t: 'create', me: room.me }, room.id);
        if (!r.ok && room) {
          const id = room.id;
          room = null;
          emit('closed', { id, why: r.error || 'gone' });
        }
      } catch (e) { reconnect(); }
    }, Math.min(15000, 1000 * Math.pow(2, tries++)));
  }

  /** Petición con respuesta (q: la sala), como mucho 8 s. */
  function ask(msg, q) {
    return new Promise(res => {
      if (!ws || ws.readyState !== 1) { res({ ok: false, error: 'down' }); return; }
      const t = setTimeout(() => { waiting.delete(q); res({ ok: false, error: 'timeout' }); }, 8000);
      waiting.set(q, { res, t });
      ws.send(JSON.stringify(msg));
    });
  }
  const send = msg => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function close() {
    bye = true;
    clearTimeout(retryT);
    if (ws) {
      const s = ws;
      ws = null; ready = null;
      try { s.close(1000, 'bye'); } catch (e) { /* nada */ }
    }
  }

  async function create(me) {
    await connect();
    const id = G.DB.fb.uid;
    room = { id, host: true, me };
    const r = await ask({ t: 'create', me }, id);
    if (!r.ok) room = null;
    return r;
  }

  async function join(id, me) {
    try { await connect(); } catch (e) { return { ok: false, error: 'down' }; }
    room = { id, host: false, me };
    const r = await ask({ t: 'join', id, me }, id);
    if (!r.ok) { room = null; if (!subs.size) close(); }
    return r;
  }

  return {
    get on() { return ON; },
    create,
    join,
    leave: function () { room = null; send({ t: 'leave' }); close(); },
    setOpen: v => send({ t: 'open', v: !!v }),
    me: (dex, shiny) => {
      if (room) room.me = Object.assign({}, room.me, { dex, shiny: !!shiny });
      send({ t: 'me', dex, shiny: !!shiny });
    },
    drop: uid => send({ t: 'drop', uid }),
    sig: (to, d) => send({ t: 'sig', to, d }),
    listen: f => (subs.add(f), () => subs.delete(f)),
    _env: env
  };
})();

;
