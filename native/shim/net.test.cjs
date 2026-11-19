// net.test.cjs — prueba de native/shim/net.js sin red: un ps.net_* de mentira que responde por trozos.
//   node native/shim/net.test.cjs
// SPDX-License-Identifier: GPL-3.0-or-later
// @step platforms/test
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const sent = [], evq = [], wsOut = [], rtcq = [], rtcCalls = [];
let rtcNext = 10;
const g = {
  ps: {
    net_request: (id, method, url, headers, body) => { sent.push({ id, method, url, headers, body }); return true; },
    net_abort: id => sent.push({ abort: id }),
    net_ws_open: (id, url, prot) => { sent.push({ ws: id, url, prot }); return true; },
    net_ws_send: (id, data) => wsOut.push([id, data]),
    net_ws_close: (id, code) => sent.push({ wsClose: id, code }),
    net_poll: () => evq.splice(0),
    // WebRTC de mentira (native/webrtc.c): ids 10, 11, ... y lo que se le pide, en rtcCalls.
    rtc_pc: urls => { rtcCalls.push(['pc', urls]); return rtcNext++; },
    rtc_dc: (pc, label) => { rtcCalls.push(['dc', pc, label]); return rtcNext++; },
    rtc_local: (pc, type) => { rtcCalls.push(['local', pc, type]); rtcq.push(['desc', pc, 'v=0 ' + type, type]); return true; },
    rtc_remote: (pc, sdp, type) => { rtcCalls.push(['remote', pc, sdp, type]); return sdp !== 'malo'; },
    rtc_cand: (pc, c, mid) => { rtcCalls.push(['cand', pc, c, mid]); return true; },
    rtc_send: (dc, d) => { rtcCalls.push(['send', dc, d]); return true; },
    rtc_buffered: dc => (dc === 11 ? 70000 : 0),
    rtc_close_dc: dc => rtcCalls.push(['close_dc', dc]),
    rtc_close_pc: pc => rtcCalls.push(['close_pc', pc]),
    rtc_poll: () => rtcq.splice(0),
    log: () => {}, now: () => Date.now(),
  },
  console, TextEncoder, ArrayBuffer, Map, Promise, Symbol, JSON, String, Error, TypeError, Object, Array,
  setTimeout, clearTimeout,
};
// Lo que pone browser.js: eventos y navigator.
g.psEventTarget = o => {
  const ls = {};
  o.addEventListener = (t, f) => (ls[t] = ls[t] || []).push(f);
  o.removeEventListener = (t, f) => { ls[t] = (ls[t] || []).filter(x => x !== f); };
  o.dispatchEvent = ev => { (ls[ev.type] || []).forEach(f => f.call(o, ev)); if (typeof o['on' + ev.type] === 'function') o['on' + ev.type](ev); return true; };
  return o;
};
g.Event = (type, init) => Object.assign({ type }, init);
g.navigator = { onLine: false };
g.document = { head: { appendChild: c => c }, body: { appendChild: c => c } };
g.localStorage = { getItem: k => (k === 'ps5.cloud' ? '0' : null) };   // (jugando sin la nube: sin elegir, net.js la enciende)
g.location = { hostname: 'ps5' };
const loadedFiles = [];
g.ps.ROOT = '/R';
g.ps.load = f => { if (/missing/.test(f)) throw new Error('no existe'); loadedFiles.push(f); };
g.globalThis = g;
vm.createContext(g);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'net.js'), 'utf8'), g);
const pump = () => g.psNetPump();
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // fetch: cabeceras de la web, respuesta en trozos (uno con una ñ entera), estado y JSON.
  const p = g.fetch('https://example.test/a', { method: 'POST', headers: { 'X-A': '1' }, body: '{"x":1}' });
  const r0 = sent[0];
  assert.equal(r0.method, 'POST');
  assert.match(r0.headers, /^x-a: 1$/m);
  assert.match(r0.headers, /^origin: https:\/\/pokesurvivor\.com$/m);
  assert.match(r0.headers, /^referer: https:\/\/pokesurvivor\.com\/$/m);
  assert.match(r0.headers, /^content-type: text\/plain/m);
  evq.push(['head', r0.id, 200, 'Content-Type: application/json\r\nX-B: 2\r\n', 'https://example.test/a'], ['data', r0.id, '{"n":"Ño'], ['data', r0.id, 'ño"}'], ['done', r0.id]);
  pump();
  const res = await p;
  assert.equal(res.status, 200); assert.ok(res.ok);
  assert.equal(res.headers.get('x-b'), '2');
  assert.deepEqual(await res.json(), { n: 'Ñoño' });

  // fetch que falla, y fetch cancelado con AbortController.
  const pe = g.fetch('https://example.test/b');
  evq.push(['err', sent[sent.length - 1].id, 'Could not resolve host']); pump();
  await assert.rejects(pe, TypeError);
  const ctl = { aborted: false, ls: [], addEventListener(t, f) { this.ls.push(f); }, removeEventListener() {} };
  const pa = g.fetch('https://example.test/c', { signal: ctl });
  const idc = sent[sent.length - 1].id;
  ctl.aborted = true; ctl.ls.forEach(f => f());
  await assert.rejects(pa, e => e.name === 'AbortError');
  assert.ok(sent.some(s => s.abort === idc));

  // XHR: readyState 1, 2, 3 (por cada trozo, con el texto a medias) y 4; cabeceras de la respuesta.
  const x = new g.XMLHttpRequest(), states = [], partial = [];
  x.onreadystatechange = () => { states.push(x.readyState); if (x.readyState === 3) partial.push(x.responseText); };
  let loaded = false;
  x.onload = () => { loaded = true; };
  x.open('GET', 'https://example.test/x');
  x.setRequestHeader('X-Goog', 'y');
  x.send();
  const rx = sent[sent.length - 1];
  assert.match(rx.headers, /^x-goog: y$/m);
  evq.push(['head', rx.id, 200, 'A: 1\r\n', rx.url], ['data', rx.id, 'ab']); pump();
  evq.push(['data', rx.id, 'cd'], ['done', rx.id]); pump();
  assert.deepEqual(states, [1, 2, 3, 3, 4]);
  assert.deepEqual(partial, ['ab', 'abcd']);
  assert.equal(x.status, 200); assert.equal(x.responseText, 'abcd'); assert.ok(loaded);
  assert.equal(x.getResponseHeader('a'), '1');

  // WebSocket: abrir, mensaje de texto y binario, mandar, cerrar.
  const w = new g.WebSocket('wss://example.test/ws', ['p1']), got = [];
  const ws = sent[sent.length - 1];
  assert.equal(ws.prot, 'p1');
  let opened = false, closed = null;
  w.onopen = () => { opened = true; };
  w.onmessage = e => got.push(e.data);
  w.onclose = e => { closed = e.code; };
  evq.push(['ws_open', ws.ws, 'p1'], ['ws_msg', ws.ws, 'hola'], ['ws_msg', ws.ws, new ArrayBuffer(3)]); pump();
  assert.ok(opened); assert.equal(w.readyState, 1); assert.equal(got[0], 'hola'); assert.equal(got[1].byteLength, 3);
  w.send('dato');
  assert.deepEqual(wsOut[0], [ws.ws, 'dato']);
  w.close();
  assert.ok(sent.some(s => s.wsClose === ws.ws && s.code === 1000));
  evq.push(['ws_close', ws.ws, 1000, '']); pump();
  assert.equal(closed, 1000); assert.equal(w.readyState, 3);
  assert.equal(g.navigator.onLine, true);

  // <script src> del SDK: de la copia local; uno que no está, onerror. Y la nube sigue apagada (ps5.cloud).
  const ok = await new Promise(res => { const el = { tagName: 'SCRIPT', src: 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js', onload: () => res(true), onerror: () => res(false) }; g.document.head.appendChild(el); });
  assert.ok(ok); assert.equal(loadedFiles[0], '/R/vendor/firebase/firebase-app-compat.js');
  const bad = await new Promise(res => { const el = { tagName: 'SCRIPT', src: 'https://www.gstatic.com/firebasejs/13.0.0/firebase-missing-compat.js', onload: () => res(true), onerror: () => res(false) }; g.document.head.appendChild(el); });
  assert.equal(bad, false);
  assert.equal(g.location.hostname, 'ps5');
  // RTCPeerConnection, como lo usa js/net/net.js: el anfitrión ofrece, el invitado responde y abre el canal.
  const host = new g.RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'turn:x.test:3478'] }] });
  assert.deepEqual(rtcCalls[0], ['pc', 'stun:stun.l.google.com:19302']);   // sin TURN
  const cands = [], pcStates = [];
  host.onicecandidate = e => cands.push(e.candidate && e.candidate.toJSON());
  host.onconnectionstatechange = () => pcStates.push(host.connectionState);
  const ch = host.createDataChannel('g', { ordered: true });
  assert.equal(ch.readyState, 'connecting');
  const offerP = host.createOffer();
  pump();
  const offer = await offerP;
  assert.deepEqual(offer, { type: 'offer', sdp: 'v=0 offer', toJSON: offer.toJSON });
  await host.setLocalDescription(offer);
  assert.deepEqual(host.localDescription.toJSON(), { type: 'offer', sdp: 'v=0 offer' });
  rtcq.push(['cand', 10, 'candidate:1 1 UDP 1 1.2.3.4 5 typ srflx', '0'], ['gather', 10, 'complete'], ['state', 10, 'connected']);
  pump();
  assert.deepEqual(cands, [{ candidate: 'candidate:1 1 UDP 1 1.2.3.4 5 typ srflx', sdpMid: '0', sdpMLineIndex: 0 }, null]);
  assert.deepEqual(pcStates, ['connected']);
  await assert.rejects(host.setRemoteDescription({ type: 'answer', sdp: 'malo' }));
  await host.setRemoteDescription({ type: 'answer', sdp: 'v=0 a' });
  await host.addIceCandidate({ candidate: 'candidate:2', sdpMid: '0' });
  assert.deepEqual(rtcCalls.find(c => c[0] === 'cand'), ['cand', 10, 'candidate:2', '0']);
  const gotRtc = [];
  let open = 0, shut = 0;
  ch.onopen = () => open++;
  ch.onmessage = e => gotRtc.push(e.data);
  ch.onclose = () => shut++;
  rtcq.push(['open', 11], ['msg', 11, 'hola'], ['msg', 11, new ArrayBuffer(4)]); pump();
  assert.equal(open, 1); assert.equal(ch.readyState, 'open');
  assert.equal(gotRtc[0], 'hola'); assert.equal(gotRtc[1].byteLength, 4);
  ch.send('{"k":1}'); ch.send(new Uint8Array([1, 2]));
  const sends = rtcCalls.filter(c => c[0] === 'send');
  assert.equal(sends[0][2], '{"k":1}'); assert.equal(sends[1][2].byteLength, 2);
  assert.equal(ch.bufferedAmount, 70000);   // (lo que mira coop.js para no amontonar)
  // Invitado: el canal llega con la oferta (antes que su "abierto").
  const guest = new g.RTCPeerConnection({ iceServers: [] });
  let inCh = null;
  guest.ondatachannel = e => { inCh = e.channel; inCh.onopen = () => { inCh.opened = true; }; };
  await guest.setRemoteDescription({ type: 'offer', sdp: 'v=0 o' });
  const ansP = guest.createAnswer(); pump();
  assert.equal((await ansP).type, 'answer');
  rtcq.push(['dc', 12, 13, 'g'], ['open', 13]); pump();
  assert.equal(inCh.label, 'g'); assert.ok(inCh.opened);
  // Cerrar la conexión cierra sus canales, y lo que llegue después se ignora.
  host.close();
  assert.equal(shut, 1); assert.equal(ch.readyState, 'closed'); assert.equal(host.connectionState, 'closed');
  assert.ok(rtcCalls.some(c => c[0] === 'close_pc' && c[1] === 10));
  rtcq.push(['msg', 11, 'tarde'], ['state', 10, 'failed']); pump();
  assert.equal(gotRtc.length, 2); assert.equal(host.connectionState, 'closed');
  assert.throws(() => ch.send('x'));
  await assert.rejects(host.createOffer());

  await tick();
  // Sin haber elegido (instalación nueva, en todas las plataformas): la nube encendida y la pantalla de cuenta primero.
  const d = { ps: { net_request: () => true, net_poll: () => [], log: () => {}, now: () => Date.now(), PLATFORM: 'ps5' },
              console, Map, Promise, Object, Array, JSON, String, Error, setTimeout, clearTimeout,
              psEventTarget: g.psEventTarget, Event: g.Event, navigator: {}, document: g.document,
              localStorage: { getItem: () => null }, location: { hostname: 'ps5' } };
  d.globalThis = d; vm.createContext(d);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'net.js'), 'utf8'), d);
  assert.equal(d.psCloudOn, true); assert.equal(d.location.hostname, 'pokesurvivor.com');
  console.log('net.js: todo bien');
})().catch(e => { console.error(e); process.exit(1); });
