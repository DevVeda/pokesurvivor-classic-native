/* preview.js — ver las pantallas de mando (ui.js) en el navegador, sobre el juego web, para diseñarlas.
 * Abre dev.html?dev servido en local y, en la consola:  import('/native/shim/preview.js')
 * Teclado = mando: flechas · Enter/z ✕ · Esc/x ○ · a □ · s △ · q L1 · e R1 · p Options.
 * Lienzo de 960x540 encima de todo, como en la PS5. No va en la PS5 (no está en boot.js).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
await new Promise(r => (G.DB && G.DB.save ? r() : setTimeout(r, 2500)));
if (!G.DB.save) G.DB.playAsGuest();
const s = G.DB.save;
if (!s.partner) { s.partner = 813; s.owned[813] = 1; }
G.UI.hideAll();

const cv = document.createElement('canvas');
cv.width = 960; cv.height = 540;
Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 99, pointerEvents: 'none' });
document.body.appendChild(cv);
window.ps = { W: 960, H: 540, now: () => performance.now(), log: console.log, rumble() {}, notify() {} };

const keys = {};
addEventListener('keydown', e => { keys[e.key] = true; e.preventDefault(); e.stopPropagation(); }, true);
addEventListener('keyup', e => { keys[e.key] = false; }, true);
const KM = { Enter: 0, z: 0, Escape: 1, x: 1, a: 2, s: 3, q: 4, e: 5, p: 9, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
window.psPadRaw = () => {
  const b = Array(18).fill(false);
  for (const k in KM) if (keys[k]) b[KM[k]] = true;
  return { buttons: b, axes: [0, 0, 0, 0] };
};
// Para probar desde la consola: await press('ArrowDown')
window.press = async k => { keys[k] = true; await new Promise(r => setTimeout(r, 60)); keys[k] = false; await new Promise(r => setTimeout(r, 120)); };

const byId = document.getElementById.bind(document);
document.getElementById = id => (id === 'game' ? cv : byId(id));
await new Promise((res, rej) => {
  const sc = document.createElement('script');
  sc.src = '/native/shim/ui.js?' + Date.now(); sc.onload = res; sc.onerror = rej;
  document.body.appendChild(sc);
});
document.getElementById = byId;

const c2 = cv.getContext('2d');
(function loop(t) {
  c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, 960, 540);
  try { psOverlay(t); } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
})(0);
G.Flow.goMenu();
