/* ============ updater.js — actualizaciones automáticas ============
 * Al publicar una versión nueva (node tools/build.js escribe version.json con
 * la huella de js/app.min.js), todos los jugadores la reciben sin perder nada:
 *
 *   - Cada 5 min (y al volver a la pestaña) se mira version.json (lo sirve
 *     GitHub Pages: no cuesta nada).
 *   - Si NO está en partida: aviso "actualizando en 5 s…" y se recarga.
 *     Si está en el gacha, la tienda de mejoras, los ajustes o escribiendo en
 *     un campo, espera a que termine. En una sala de cooperativo, se recarga
 *     igual (decisión del 12-10-2026).
 *   - Si está EN PARTIDA: no se toca. Al acabar, la run se guarda como
 *     siempre (récords, monedas, tickets, ranking) y, al volver al menú, se
 *     recarga.
 *   - Antes de recargar se espera a que la partida guardada suba a la nube
 *     (como mucho unos segundos; si no, queda en este navegador y se sube al
 *     entrar).
 *   - Versión OBLIGATORIA (node tools/build.js --forzar escribe force:true en
 *     version.json): quien esté en partida ve un aviso de 10 s y la partida
 *     se termina como al abandonarla (se guardan monedas, tickets, récords y
 *     ranking), sube a la nube y se recarga. Sólo la entienden los jugadores
 *     que ya tengan este updater.js (desde el 15-10-2026).
 * Sólo funciona en la web publicada (con app.min.js); en dev.html o con
 * doble clic (file://) no hace nada.
 */
// @step boot/upd event "Actualizador"
// G.Updater.init se arranca dentro de Flow.boot.
// @sub updater
// @step updater/poll net "Sondeo version.json"
// Primera a los 30 s, luego cada 5 min y al volver a la pestaña (>1 min). v ≠ mine → pending;
// force:true → forced.
// @next forced "versión nueva"
// @step backmenu/upd event "Updater"
// Mira version.json cada 5 min. Pendiente normal: espera a un menú seguro y cuenta 5 s.
// @sub updater
// @next forced
// @step publish/webupd
G.Updater = (() => {
  const EVERY = 5 * 60 * 1000, COUNTDOWN = 5, FORCED = 10;
  // @step updater/init decision "¿Build con huella?"
  // Se activa si index.html carga js/app.js?v=<huella> (o el antiguo app.min.js?v=) y es http(s). La
  // huella la pone tools/build-web.mjs.
  // @next poll "sí"
  // Las versiones nativas (native/) no miran version.json: native/shim/update.js baja e instala la versión firmada y avisa
  // con offer(); el cuándo (menú, partida, subir a la nube antes) es el mismo para todas: este archivo.
  const page = !globalThis.ps || !ps.CAN || ps.CAN.page;
  const tag = page && document.querySelector('script[src*="js/app.js?v="]');   // la huella la pone tools/build-web.mjs
  const mine = tag ? (tag.getAttribute('src').match(/v=([0-9a-f]+)/) || [])[1] : null;
  let pending = false, forced = false, lastCheck = 0, timer = 0, counting = false, told = false;
  let apply = () => location.reload();   // (native: ps.relaunch, o null si sólo se aplica al volver a abrir el juego)

  // @step updater/poll
  async function check() {
    if (!mine || pending) return;
    lastCheck = Date.now();
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.v && j.v !== mine) { pending = true; forced = !!j.force; console.log('[Actualizar] versión nueva', j.v, '(esta es', mine + ')', forced ? 'OBLIGATORIA' : ''); }
    } catch (e) { /* sin red: se mira la próxima vez */ }
  }

  /** ¿Se puede recargar ahora sin cortar nada? */
  // @step updater/safe decision "¿Momento seguro?"
  // Estado 'ui', sin scr-gacha/scr-upgrades/scr-settings abiertos, sin tirada (pull-fx) y sin foco en un
  // campo. Si no, espera (en run, al volver al menú).
  // @next countdown "sí"
  // @step backmenu/upd
  function safe() {
    if (!G.Game || G.Game.state !== 'ui') return false;                   // en partida o en el resumen
    // Las pantallas de native/shim/ui.js (web y nativas): sólo en el menú principal, sin otra encima y sin escribir.
    if (globalThis.psAtMenu) return psAtMenu() && !globalThis.psTextSink;
    if (['scr-gacha', 'scr-upgrades', 'scr-settings'].some(id => document.getElementById(id) && G.UI.isOpen(id))) return false;
    const fx = document.getElementById('pull-fx');
    if (fx && !fx.classList.contains('hidden')) return false;             // tirada del gacha en marcha
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;   // escribiendo (contraseña, apodo...)
    return true;
  }

  // @step updater/flush net "Subir nube primero"
  // Si syncState no es ok/local, espera G.DB.flush() hasta 6 s; si queda subido escribe ps.updok en
  // sessionStorage.
  // @next reload
  // @step backmenu/reload event "Recargar"
  // Sube a la nube lo pendiente (máx 6 s) y location.reload().
  // @step cloud/other event "Otras subidas"
  // Recarga por actualización (flush ≤6 s, ps.updok), ocultar pestaña con subida programada, cerrar
  // sesión.
  // @next push
  async function reload() {
    // Que lo guardado suba a la nube antes de recargar (como mucho 6 s).
    const dirty = G.DB.syncState && G.DB.syncState !== 'ok' && G.DB.syncState !== 'local';
    // @step updater/flush
    if (dirty) { try { await Promise.race([G.DB.flush(), new Promise(r => setTimeout(r, 6000))]); } catch (e) { /* queda en este navegador */ } }
    // Todo subido: al volver, db.js usa la copia de aquí sin leer la nube otra vez (openCloud).
    try { if (G.DB.syncState === 'ok') sessionStorage.setItem('ps.updok', String(Date.now())); } catch (e) { /* nada */ }
    apply();
  }

  // @step updater/countdown event "Aviso 5 s"
  // Toast «actualizando en N s…»; si deja de ser seguro, cancela.
  // @next flush "0 s"
  // @next safe "deja de ser seguro"
  function countdown() {
    counting = true;
    let n = COUNTDOWN;
    const tick = () => {
      if (!safe()) { counting = false; G.UI.toast('', 1); return; }     // ha empezado una partida: se espera
      if (n <= 0) { reload(); return; }
      G.UI.toast('Hay una versión nueva del juego: actualizando en ' + n + ' s…', 1500);
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  /** ¿Está jugando una partida (que una versión obligatoria debe cerrar)? */
  // @step updater/forced decision "¿Obligatoria?"
  // Según el flag force de version.json.
  // @next inrun "sí"
  // @next safe "no"
  // @step updater/inrun decision "¿En partida?"
  // inRun: G.Game.state no es 'ui' ni 'over'.
  // @next forceend "sí"
  // @next flush "no / en resumen"
  function inRun() { return G.Game && G.Game.state !== 'ui' && G.Game.state !== 'over'; }

  /** Versión obligatoria en partida: aviso, se termina la partida (se guarda todo) y se recarga. */
  // @step updater/forceend event "Aviso 10 s"
  // Toast «Actualización obligatoria…» 10 s; G.Game.quit() (guarda lo ganado) y recarga a los 4 s.
  // @next flush
  // @step backmenu/forced decision "¿Obligatoria?"
  // force en partida: aviso 10 s, G.Game.quit() (guarda) y recarga a los 4 s; en el resumen recarga
  // directo.
  // @next reload "sí / no y menú seguro"
  function forceEnd() {
    counting = true;
    let n = FORCED;
    const tick = () => {
      if (!inRun()) { reload(); return; }                                 // la ha acabado él mismo
      if (n <= 0) {
        G.Game.quit();                                                    // como abandonar: se guarda lo ganado
        setTimeout(reload, 4000);                                         // deja salir récord y ranking
        return;
      }
      G.UI.toast('Actualización obligatoria: tu partida se guarda y el juego se recarga en ' + n + ' s…', 1500);
      n--;
      setTimeout(tick, 1000);
    };
    tick();
  }

  function loop() {
    if (pending && !apply) {   // (PS5, Switch: no se pueden reabrir solas)
      if (!told && safe()) { told = true; G.UI.toast('Actualización instalada: se aplicará al volver a abrir el juego'); }
      return;
    }
    if (pending && forced && !counting && inRun()) { forceEnd(); return; }
    if (pending && forced && !counting && G.Game && G.Game.state === 'over') { reload(); return; }   // resumen: ya está guardado
    if (pending && !counting && safe()) countdown();
    if (!pending && Date.now() - lastCheck > EVERY) check();
  }

  function init() {
    if (page && (!mine || !location.protocol.startsWith('http'))) return;
    clearInterval(timer);
    timer = setInterval(loop, 2000);
    if (!page) return;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) check(); });
    setTimeout(check, 30000);
  }

  /** Versión nativa ya instalada (native/shim/update.js): { forced, apply } (apply: reabrir, o null = al volver a abrirlo). */
  function offer(o) { pending = true; forced = !!(o.forced && o.apply); apply = o.apply || null; if (!timer) init(); }

  return { init, check, offer, get pending() { return pending; }, get version() { return mine; } };
})();

;
