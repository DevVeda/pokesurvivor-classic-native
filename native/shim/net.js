/* net.js — fetch, Headers, Response, XMLHttpRequest y WebSocket del navegador, sobre ps.net_* (native/net.c).
 * Lo justo para el SDK de Firebase (auth: fetch; Firestore: XHR en long-polling; base de datos: WebSocket)
 * y para el juego (version.json). Las respuestas llegan en ps.net_poll(), una vez por fotograma (psNetPump).
 * Como el navegador en la web del servidor (PS_ENV.hosts[0], de .env o del servidor elegido en Cuenta): cada
 * petición lleva Origin y Referer de esa web (la clave de la API de Firebase puede estar restringida a ella).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  if (!ps.net_request) return;   // sin red (net_init falló): se quedan los de browser.js, que fallan siempre
  const G_ = globalThis, HOST = ((G_.PS_ENV || {}).hosts || [])[0] || 'pokesurvivor.com', ORIGIN = 'https://' + HOST;
  const evt = G_.psEventTarget, Ev = G_.Event;
  let nextId = 1;
  const http = new Map(), sockets = new Map();   // id -> quien espera sus eventos
  // Peticiones sin terminar que alguien espera (el círculo de carga de ui.js): no cuentan las conexiones largas de
  // Firestore y Realtime Database (…/channel), que siempre hay una abierta en modo nube.
  const longPoll = new Set();
  // Y lo que se espera de Firebase aunque vaya por esas conexiones largas (leer un perfil, entrar en una sala…): ver
  // busySdk. Cada cosa cuenta como mucho 20 s (una escritura sin conexión no acaba hasta que vuelve).
  let busyN = 0;
  const busy = p => {
    let on = true; busyN++;
    const off = () => { if (on) { on = false; busyN--; } };
    setTimeout(off, 20000);
    Promise.resolve(p).then(off, off);
    return p;
  };
  G_.psNetPending = () => { let n = busyN; for (const id of http.keys()) if (!longPoll.has(id)) n++; return n; };   // (nunca negativo)
  // ponytail: diagnóstico del título: cada 5 s, las peticiones que siguen abiertas (qué, cuánto llevan, en qué fase).
  const open = new Map();   // id -> { what, t0, head, bytes }
  if (ps.ROOT === '/app0') setInterval(() => {
    if (!open.size) return;
    const now = ps.now();
    console.log('[abiertas] ' + (ps.net_debug ? ps.net_debug() + ' · ' : '') + [...open.values()].map(o => o.what + ' · ' + Math.round((now - o.t0) / 1000) + ' s · ' +
      (o.head ? 'cabeceras ' + o.head : 'sin cabeceras') + ' · ' + o.bytes + ' B' + (o.long ? ' (larga)' : '')).join(' | '));
  }, 5000);

  G_.psNetPump = () => {
    const evs = ps.net_poll();
    for (const e of evs) {
      const [kind, id] = e, h = http.get(id) || sockets.get(id);
      if (!h) continue;
      try { h(kind, e); } catch (err) { console.error('[red] ' + (err && err.stack || err)); }
    }
  };

  // Una línea por petición en el log (sin la clave de la API ni el resto de la dirección): para saber en la
  // consola por dónde va la red. Son pocas fuera de la partida.
  const short = u => String(u).replace(/[?#].*$/, '').slice(0, 90);
  const netLog = (dir, method, url, extra) => ps.log('[red] ' + dir + ' ' + method + ' ' + short(url) + (extra ? ' · ' + extra : ''));
  const parseHeaders = raw => {
    const m = new Map();
    for (const line of String(raw).split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim(); m.set(k, m.has(k) ? m.get(k) + ', ' + v : v); }
    }
    return m;
  };
  // Como el navegador: una dirección relativa ('version.json') es de la web en la que se está (con la nube,
  // la web del servidor; ver el final). Sin la nube no hay web y sigue fallando.
  const abs = u => /^[a-z][a-z0-9+.-]*:/i.test(u) || !/^https?:$/.test(G_.location.protocol) ? u : G_.location.origin + '/' + u.replace(/^\.?\//, '');
  const toBody = b => {
    if (b == null) return null;
    if (typeof b === 'string') return b;
    if (b instanceof ArrayBuffer) return b;
    if (ArrayBuffer.isView(b)) return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    return String(b);   // URLSearchParams y demás: su texto
  };
  // Lo que pone el navegador en cada petición desde la web.
  const browserHeaders = h => {
    if (!h.has('origin')) h.set('origin', ORIGIN);
    if (!h.has('referer')) h.set('referer', ORIGIN + '/');
    if (!h.has('accept')) h.set('accept', '*/*');
    return [...h].map(([k, v]) => k + ': ' + v).join('\n');
  };

  // ---------------- Headers / Response / fetch ----------------
  class Headers {
    constructor(init) {
      this._m = new Map();
      if (init instanceof Headers) init.forEach((v, k) => this.append(k, v));
      else if (Array.isArray(init)) init.forEach(([k, v]) => this.append(k, v));
      else if (init) Object.keys(init).forEach(k => this.append(k, init[k]));
    }
    append(k, v) { k = String(k).toLowerCase(); this._m.set(k, this._m.has(k) ? this._m.get(k) + ', ' + v : String(v)); }
    set(k, v) { this._m.set(String(k).toLowerCase(), String(v)); }
    get(k) { const v = this._m.get(String(k).toLowerCase()); return v === undefined ? null : v; }
    has(k) { return this._m.has(String(k).toLowerCase()); }
    delete(k) { this._m.delete(String(k).toLowerCase()); }
    forEach(f) { this._m.forEach((v, k) => f(v, k, this)); }
    entries() { return this._m.entries(); }
    keys() { return this._m.keys(); }
    values() { return this._m.values(); }
    [Symbol.iterator]() { return this._m.entries(); }
  }
  class Response {
    constructor(body, init = {}) {
      this._body = body == null ? '' : String(body);
      this.status = init.status === undefined ? 200 : init.status;
      this.statusText = init.statusText || '';
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
      this.url = init.url || '';
      this.type = 'cors'; this.redirected = false; this.bodyUsed = false;
    }
    text() { this.bodyUsed = true; return Promise.resolve(this._body); }
    json() { return this.text().then(t => JSON.parse(t)); }
    arrayBuffer() { return this.text().then(t => new TextEncoder().encode(t).buffer); }
    clone() { return new Response(this._body, this); }
  }
  const abortError = () => { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; };

  G_.Headers = Headers;
  G_.Response = Response;
  G_.Request = function Request(url, init = {}) { return Object.assign({ url: String(url && url.url || url), method: 'GET', headers: new Headers(init.headers) }, init); };
  G_.fetch = (input, init = {}) => new Promise((resolve, reject) => {
    const url = abs(String(input && input.url || input)), method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const h = new Headers(init.headers || (input && input.headers)), body = toBody(init.body);
    if (body != null && typeof body === 'string' && !h.has('content-type')) h.set('content-type', 'text/plain;charset=UTF-8');
    const signal = init.signal, id = nextId++;
    if (signal && signal.aborted) return reject(abortError());
    let status = 0, headers = null, final = url, chunks = [];
    const t0 = ps.now();
    netLog('→', method, url);
    const done = () => { http.delete(id); open.delete(id); if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => { ps.net_abort(id); done(); reject(abortError()); };
    if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
    open.set(id, { what: method + ' ' + String(url).slice(0, 90), t0, head: 0, bytes: 0 });
    http.set(id, (kind, e) => {
      const o = open.get(id);
      if (o) { if (kind === 'head') o.head = e[2]; else if (kind === 'data') o.bytes += e[2].length; else open.delete(id); }
      if (kind === 'head') { status = e[2]; headers = parseHeaders(e[3]); final = e[4] || url; }
      else if (kind === 'data') chunks.push(e[2]);
      else if (kind === 'done') { const body = chunks.join(''); netLog('←', method, url, status + ', ' + body.length + ' B, ' + Math.round(ps.now() - t0) + ' ms'); done(); resolve(new Response(body, { status, headers: new Headers([...headers]), url: final })); }
      else if (kind === 'err') { netLog('✗', method, url, e[2]); done(); reject(new TypeError('Failed to fetch (' + e[2] + ')')); }
    });
    if (!ps.net_request(id, method, url, browserHeaders(h), body, 0)) { done(); reject(new TypeError('Failed to fetch')); }
  });

  // ---------------- XMLHttpRequest ----------------
  // Como el del navegador, con readyState 3 en cada trozo (Firestore lee la respuesta a medias).
  function XMLHttpRequest() {
    const x = evt({ readyState: 0, status: 0, statusText: '', responseText: '', responseType: '', responseURL: '',
                    timeout: 0, withCredentials: false, upload: evt({}) });
    let method = 'GET', url = '', h = new Headers(), id = 0, rh = new Map(), timer = 0;
    const set = (rs, type) => { x.readyState = rs; x.dispatchEvent(Ev('readystatechange')); if (type) x.dispatchEvent(Ev(type)); };
    const end = type => { http.delete(id); longPoll.delete(id); open.delete(id); clearTimeout(timer); set(4, type); x.dispatchEvent(Ev('loadend')); };
    Object.defineProperty(x, 'response', { get() {
      if (x.responseType === 'json') { try { return JSON.parse(x.responseText); } catch (e) { return null; } }
      if (x.responseType === 'arraybuffer') return new TextEncoder().encode(x.responseText).buffer;
      return x.responseText;
    } });
    x.open = (m, u) => { method = String(m).toUpperCase(); url = abs(String(u)); h = new Headers(); x.responseText = ''; x.status = 0; set(1); };
    x.setRequestHeader = (k, v) => h.append(k, v);
    x.getResponseHeader = k => { const v = rh.get(String(k).toLowerCase()); return v === undefined ? null : v; };
    x.getAllResponseHeaders = () => [...rh].map(([k, v]) => k + ': ' + v).join('\r\n') + (rh.size ? '\r\n' : '');
    x.overrideMimeType = () => {};
    x.abort = () => { if (!id || !http.has(id)) return; ps.net_abort(id); x.status = 0; end('abort'); };
    x.send = data => {
      id = nextId++;
      const t0 = ps.now();
      netLog('→ XHR', method, url);
      const body = toBody(data);
      if (body != null && typeof body === 'string' && !h.has('content-type')) h.set('content-type', 'text/plain;charset=UTF-8');
      if (/\/channel\b/.test(url) && method.toUpperCase() === 'GET') longPoll.add(id);
      open.set(id, { what: 'XHR ' + method + ' ' + String(url).slice(0, 90), t0, head: 0, bytes: 0, long: longPoll.has(id) });
      http.set(id, (kind, e) => {
        const o = open.get(id);
        if (o) { if (kind === 'head') o.head = e[2]; else if (kind === 'data') o.bytes += e[2].length; else open.delete(id); }
        if (kind === 'head') { x.status = e[2]; rh = parseHeaders(e[3]); x.responseURL = e[4]; set(2); }
        else if (kind === 'data') {
          x.responseText += e[2];
          set(3, 'progress');
        }
        else if (kind === 'done') { netLog('← XHR', method, url, x.status + ', ' + x.responseText.length + ' B, ' + Math.round(ps.now() - t0) + ' ms'); end('load'); }
        else if (kind === 'err') { netLog('✗ XHR', method, url, e[2]); x.status = 0; end(/timed? ?out/i.test(e[2]) ? 'timeout' : 'error'); }
      });
      if (x.timeout > 0) timer = setTimeout(() => { if (http.has(id)) { ps.net_abort(id); x.status = 0; end('timeout'); } }, x.timeout);
      if (!ps.net_request(id, method, url, browserHeaders(h), body, 0)) setTimeout(() => end('error'), 0);
    };
    return x;
  }
  XMLHttpRequest.UNSENT = 0; XMLHttpRequest.OPENED = 1; XMLHttpRequest.HEADERS_RECEIVED = 2; XMLHttpRequest.LOADING = 3; XMLHttpRequest.DONE = 4;
  G_.XMLHttpRequest = XMLHttpRequest;

  // ---------------- WebSocket ----------------
  function WebSocket(url, protocols) {
    const id = nextId++;
    const w = evt({ url: String(url), readyState: 0, protocol: '', extensions: '', binaryType: 'blob', bufferedAmount: 0 });
    // ponytail: diagnóstico del título (el WebSocket de las salas tarda): a qué servidor, cuánto tarda en abrir y por qué se cierra.
    const t0 = ps.now(), host = short(url).replace(/^wss?:\/\//, '').replace(/\/.*/, '');
    ps.log('[ws] ' + id + ' abriendo ' + host);
    sockets.set(id, (kind, e) => {
      if (kind === 'ws_open') ps.log('[ws] ' + id + ' abierto en ' + Math.round(ps.now() - t0) + ' ms');
      // ponytail: diagnóstico (unirse a una sala decía «Esa sala ya no existe»): los primeros mensajes que llegan, recortados.
      else if (kind === 'ws_msg' && (w._in = (w._in || 0) + 1) <= 8) ps.log('[ws] ' + id + ' ← ' + String(e[2]).slice(0, 160));
      else if (kind === 'ws_close') ps.log('[ws] ' + id + ' cerrado a los ' + Math.round(ps.now() - t0) + ' ms · ' + e[2] + (e[3] ? ' · ' + e[3] : '') + (w.readyState === 2 ? ' (lo cerró el juego)' : ''));
      if (kind === 'ws_open') { w.readyState = 1; w.protocol = e[2] || ''; w.dispatchEvent(Ev('open')); }
      else if (kind === 'ws_msg') w.dispatchEvent(Ev('message', { data: e[2], origin: w.url }));
      else if (kind === 'ws_close') {
        sockets.delete(id);
        const wasOpen = w.readyState === 1 || w.readyState === 2;
        w.readyState = 3;
        if (!wasOpen || e[2] === 1006) w.dispatchEvent(Ev('error'));
        w.dispatchEvent(Ev('close', { code: e[2], reason: '', wasClean: e[2] === 1000 }));
      }
    });
    w.send = data => {
      if (w.readyState !== 1) throw new Error('InvalidStateError: el WebSocket no está abierto');
      if ((w._out = (w._out || 0) + 1) <= 8) ps.log('[ws] ' + id + ' → ' + String(data).replace(/"(cred|token|auth)":"[^"]{12}[^"]*"/g, '"$1":"…"').slice(0, 160));   // (sin el token)
      ps.net_ws_send(id, data instanceof ArrayBuffer ? data : ArrayBuffer.isView(data) ? toBody(data) : String(data));
    };
    w.close = code => { if (w.readyState >= 2) return; w.readyState = 2; ps.net_ws_close(id, code || 1000); };
    const prot = protocols == null ? '' : Array.isArray(protocols) ? protocols.join(', ') : String(protocols);
    if (!ps.net_ws_open(id, w.url, prot, ORIGIN)) setTimeout(() => sockets.get(id) && sockets.get(id)('ws_close', ['ws_close', id, 1006, '']), 0);
    return w;
  }
  WebSocket.CONNECTING = 0; WebSocket.OPEN = 1; WebSocket.CLOSING = 2; WebSocket.CLOSED = 3;
  G_.WebSocket = WebSocket;

  // ---------------- RTCPeerConnection ----------------
  // Lo que usa el cooperativo (js/net/net.js) sobre ps.rtc_* (native/webrtc.c): un canal de datos, oferta y
  // respuesta, candidatos ICE uno a uno y el estado de la conexión. Sin vídeo ni audio, sólo STUN (no hay TURN).
  if (ps.rtc_pc) {
    const rtc = new Map();   // id de conexión o de canal -> quien espera sus eventos
    const pumpNet = G_.psNetPump;
    G_.psNetPump = () => {
      pumpNet();
      for (const e of ps.rtc_poll()) {
        const h = rtc.get(e[1]);
        if (h) try { h(e); } catch (err) { console.error('[rtc] ' + (err && err.stack || err)); }
      }
    };

    const channel = (id, label) => {
      const dc = evt({ label, ordered: true, protocol: '', readyState: 'connecting', binaryType: 'arraybuffer' });
      // Lo que queda por salir (coop.js no manda más si pasa de 64 KB). Con un ELF viejo sin rtc_buffered, 0.
      Object.defineProperty(dc, 'bufferedAmount', { get: () => (ps.rtc_buffered && dc.readyState === 'open' ? ps.rtc_buffered(id) : 0) });
      const closed = () => {
        if (dc.readyState === 'closed') return;
        dc.readyState = 'closed'; rtc.delete(id);
        dc.dispatchEvent(Ev('close'));
      };
      rtc.set(id, e => {
        if (e[0] === 'open') { if (dc.readyState === 'connecting') { dc.readyState = 'open'; dc.dispatchEvent(Ev('open')); } }
        else if (e[0] === 'msg') { if (dc.readyState === 'open') dc.dispatchEvent(Ev('message', { data: e[2] })); }
        else if (e[0] === 'err') dc.dispatchEvent(Ev('error', { error: new Error(e[2]) }));
        else if (e[0] === 'close') closed();
      });
      dc.send = d => {
        if (dc.readyState !== 'open') throw new Error('InvalidStateError: el canal no está abierto');
        if (!ps.rtc_send(id, d instanceof ArrayBuffer ? d : ArrayBuffer.isView(d) ? toBody(d) : String(d))) throw new Error('OperationError: no se pudo mandar');
      };
      dc.close = () => { if (dc.readyState === 'connecting' || dc.readyState === 'open') { dc.readyState = 'closing'; ps.rtc_close_dc(id); } };
      dc._closed = closed;
      return dc;
    };

    const desc = (type, sdp) => ({ type, sdp, toJSON: () => ({ type, sdp }) });
    function RTCPeerConnection(cfg) {
      const urls = ((cfg && cfg.iceServers) || []).flatMap(s => [].concat(s && s.urls || [])).filter(u => /^stun:/.test(u));
      const id = ps.rtc_pc(urls.join('\n'));
      ps.log('[rtc] conexión ' + id + ' nueva · STUN: ' + (urls.join(', ') || 'ninguno'));
      if (id < 0) throw new Error('NotSupportedError: no se pudo crear la conexión');
      const pc = evt({ connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable',
        localDescription: null, remoteDescription: null });
      const chans = new Set();
      let waiting = null;   // createOffer / createAnswer: la descripción llega en un evento
      rtc.set(id, e => {
        const k = e[0];
        if (k === 'desc') {
          pc.localDescription = desc(e[3], e[2]);
          pc.signalingState = e[3] === 'offer' ? 'have-local-offer' : 'stable';
          if (waiting) { const w = waiting; waiting = null; w.res(pc.localDescription); }
        } else if (k === 'cand') {
          ps.log('[rtc] conexión ' + id + ': dirección propia ' + String(e[2]).replace(/^candidate:/, '').slice(0, 90));
          const c = { candidate: e[2], sdpMid: e[3], sdpMLineIndex: 0, usernameFragment: null };
          c.toJSON = () => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: 0 });
          pc.iceGatheringState = 'gathering';
          pc.dispatchEvent(Ev('icecandidate', { candidate: c }));
        } else if (k === 'gather') {
          ps.log('[rtc] conexión ' + id + ': direcciones propias completas');
          pc.iceGatheringState = 'complete';
          pc.dispatchEvent(Ev('icecandidate', { candidate: null }));
        } else if (k === 'state') {
          ps.log('[rtc] conexión ' + id + ': ' + e[2]);
          pc.connectionState = pc.iceConnectionState = e[2];
          pc.dispatchEvent(Ev('iceconnectionstatechange'));
          pc.dispatchEvent(Ev('connectionstatechange'));
        } else if (k === 'dc') {
          const dc = channel(e[2], e[3]);
          chans.add(dc);
          pc.dispatchEvent(Ev('datachannel', { channel: dc }));
        }
      });
      const isClosed = () => pc.connectionState === 'closed';
      const make = type => new Promise((res, rej) => {
        if (isClosed() || waiting) return rej(new Error('InvalidStateError: ' + type));
        waiting = { res };
        if (!ps.rtc_local(id, type)) { waiting = null; rej(new Error('OperationError: ' + type)); }
      });
      pc.createOffer = () => make('offer');
      pc.createAnswer = () => make('answer');
      // libdatachannel ya la pone al crearla (createOffer / createAnswer).
      pc.setLocalDescription = () => isClosed() ? Promise.reject(new Error('InvalidStateError')) : Promise.resolve();
      pc.setRemoteDescription = d => {
        if (isClosed() || !d || !ps.rtc_remote(id, String(d.sdp), String(d.type))) return Promise.reject(new Error('OperationError: descripción no válida'));
        pc.remoteDescription = desc(d.type, d.sdp);
        pc.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
        return Promise.resolve();
      };
      pc.addIceCandidate = c => {
        if (c && c.candidate) ps.log('[rtc] conexión ' + id + ': dirección del otro ' + String(c.candidate).replace(/^candidate:/, '').slice(0, 90));
        if (!c || !c.candidate) return Promise.resolve();   // fin de los candidatos
        return !isClosed() && ps.rtc_cand(id, String(c.candidate), c.sdpMid == null ? null : String(c.sdpMid))
          ? Promise.resolve() : Promise.reject(new Error('OperationError: candidato no válido'));
      };
      pc.createDataChannel = label => {
        const dcId = isClosed() ? -1 : ps.rtc_dc(id, String(label));
        if (dcId < 0) throw new Error('OperationError: no se pudo crear el canal');
        const dc = channel(dcId, String(label));
        chans.add(dc);
        return dc;
      };
      // Al cerrar, libdatachannel ya no avisa de nada: los canales se dan por cerrados aquí.
      pc.close = () => {
        if (isClosed()) return;
        ps.rtc_close_pc(id); rtc.delete(id);
        pc.connectionState = pc.iceConnectionState = pc.signalingState = 'closed';
        chans.forEach(dc => dc._closed());
      };
      return pc;
    }
    G_.RTCPeerConnection = RTCPeerConnection;
  }

  if (G_.navigator) G_.navigator.onLine = true;

  // ---------------- <script src> ----------------
  // db.js carga el SDK de Firebase con <script src="https://www.gstatic.com/firebasejs/…">: aquí, la copia que
  // va con el juego (native/vendor/firebase, make -C native vendor). Lo de la carpeta del juego, de su sitio.
  const SDK = /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z-]+\.js)$/;
  const loadScriptEl = el => {
    const src = String(el.src || '');
    setTimeout(() => {
      const m = SDK.exec(src), file = m ? ps.ROOT + '/vendor/firebase/' + m[1] : !/^[a-z]+:/i.test(src) ? ps.ROOT + '/game/' + src.replace(/^\.?\//, '') : null;
      try {
        if (!file) throw new Error('de internet: ' + src);
        ps.load(file);
        busySdk();
        if (el.onload) el.onload(Ev('load'));
      } catch (e) {
        console.warn('[red] no se pudo cargar ' + src + ': ' + e.message);
        if (el.onerror) el.onerror(Ev('error'));
      }
    }, 0);
  };
  // Las lecturas y escrituras de Firestore y de la base de datos de las salas cuentan para el círculo de carga.
  const busySdk = () => {
    const fb = G_.firebase, fs = fb && fb.firestore, db = fb && fb.database;
    const wrap = (C, names) => C && C.prototype && names.forEach(k => {
      const f = C.prototype[k];
      if (typeof f !== 'function' || f._psBusy) return;
      C.prototype[k] = function () { const r = f.apply(this, arguments); return r && typeof r.then === 'function' ? busy(r) : r; };
      C.prototype[k]._psBusy = true;
    });
    if (fs) { wrap(fs.DocumentReference, ['get', 'set', 'update', 'delete']); wrap(fs.Query, ['get']); wrap(fs.Firestore, ['runTransaction']); }
    if (db) { wrap(db.Reference, ['set', 'update', 'remove']); wrap(db.Query, ['get', 'once']); }
    // ponytail: diagnóstico: las lecturas de la base de datos de las salas que fallan (el juego se traga el error).
    if (db && db.Query && !db.Query.prototype.get._psLog) {
      const g = db.Query.prototype.get;
      db.Query.prototype.get = function (...a) { const p = g.apply(this, a); p.then(s => { if (!s.exists()) ps.log('[rtdb] ' + this.toString().replace(/^https:\/\/[^/]+/, '') + ': vacío'); },
        e => ps.log('[rtdb] ' + this.toString().replace(/^https:\/\/[^/]+/, '') + ': ' + (e && (e.code || e.message)))); return p; };
      db.Query.prototype.get._psLog = true;
    }
    if (fs) devGuard(fs);
  };
  // Modo dev (ui.js, psDevOn): la partida, las marcas del ranking y el perfil no salen a la nube (en la consola sí se guardan,
  // para probar). Se corta en la escritura misma, por la ruta: así vale también lo que el juego guarda desde dentro de DB.
  const DEV_OUT = /^(saves|runs|lb|lbs|profiles)(\/|$)/;
  const devBlocks = ref => !!(G_.psDevOn && G_.psDevOn() && ref && DEV_OUT.test(String(ref.path || '')));
  const told = new Set();
  const devSkip = ref => { const p = String(ref.path).split('/')[0]; if (!told.has(p)) { told.add(p); ps.log('[dev] no sale a la nube: ' + p); } };
  const devGuard = fs => {
    const guard = (C, names, refOf, skipped) => C && C.prototype && names.forEach(k => {
      const f = C.prototype[k];
      if (typeof f !== 'function' || f._psDev) return;
      C.prototype[k] = function (...a) { const ref = refOf(this, a); if (!devBlocks(ref)) return f.apply(this, a); devSkip(ref); return skipped(this); };
      C.prototype[k]._psDev = true;
    });
    guard(fs.DocumentReference, ['set', 'update', 'delete'], self => self, () => Promise.resolve());
    guard(fs.CollectionReference, ['add'], self => self, self => Promise.resolve(self.doc()));
    guard(fs.Transaction, ['set', 'update', 'delete'], (self, a) => a[0], self => self);
    guard(fs.WriteBatch, ['set', 'update', 'delete'], (self, a) => a[0], self => self);
  };
  for (const parent of [document.head, document.body]) {
    const add = parent.appendChild.bind(parent);
    parent.appendChild = c => { const r = add(c); if (c && c.tagName === 'SCRIPT' && c.src) loadScriptEl(c); return r; };
  }

  // La base de datos de las salas marca «el WebSocket falló» (firebase:previous_websocket_failure) al abrir cada
  // uno y lo quita cuando va bien; si el juego se cierra antes, la marca se queda en el localStorage (aquí, un
  // archivo) y la próxima vez se va a long-polling, que necesita <iframe> en la página: nunca conecta. Sin marca.
  const WS_FAIL = 'firebase:previous_websocket_failure';
  try {
    const ls = G_.localStorage, set = ls.setItem.bind(ls);
    ls.removeItem(WS_FAIL);
    ls.setItem = (k, v) => { if (k !== WS_FAIL) set(k, v); };
  } catch (e) { /* sin localStorage */ }

  // ---------------- la nube ----------------
  // db.js sólo usa Firebase desde un dominio de PS_ENV.hosts. Mientras no se haya elegido (ps5.cloud, de la pantalla de
  // cuenta de ui.js), todas las plataformas empiezan en esa pantalla: entrar, crear cuenta o «Jugar como invitado» (la
  // cuenta local de este aparato, ps5.cloud = 0; una partida local de antes sigue ahí).
  let cloud = false;
  try {
    const v = localStorage.getItem('ps5.cloud');
    cloud = v === '1' || v === null;
  } catch (e) { /* local */ }
  G_.psCloudOn = cloud;
  if (cloud) Object.assign(G_.location, { href: ORIGIN + '/', origin: ORIGIN, protocol: 'https:', host: HOST, hostname: HOST });
})();
