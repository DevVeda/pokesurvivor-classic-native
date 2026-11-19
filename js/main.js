/* ============ main.js — arranque ============ */
(() => {
  // Si un archivo no llega a cargarse (conexión móvil que se corta), mejor
  // avisar que arrancar a medias.
  const NEED = ['U', 'I18n', 'Settings', 'DB', 'Audio', 'Input', 'Touch', 'Sprites', 'Camera', 'Moves', 'Enemies', 'Upgrades', 'Items',
                'World', 'FX', 'Projectiles', 'EnemyMgr', 'Pickups', 'Player', 'Combat', 'Spawner', 'LevelUp', 'Gacha',
                'Rift', 'Weather', 'Progress', 'Hazards', 'Social', 'NetCodec', 'Net', 'Coop', 'Ranking', 'Icons', 'UI', 'HUD',
                'RunUI', 'Funding', 'Game', 'Flow'];
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // @step boot/broken decision "¿Faltan módulos?"
  // Comprueba que existan los módulos G.*; si falta alguno (conexión cortada), #boot muestra «No se pudo
  // cargar…» con Recargar.
  // @next flowboot "no"
  function broken() {
    // (En la versión publicada G no está en window: va encerrado, ver tools/build.js.)
    const miss = NEED.filter(k => typeof G !== 'object' || !G[k]);
    if (!miss.length) return false;
    const el = document.getElementById('boot');
    el.innerHTML = 'No se pudo cargar todo el juego (¿se cortó la conexión?).<br><button class="btn gold" style="margin-top:12px">Recargar</button>';
    el.querySelector('button').onclick = () => location.reload();
    if (typeof G === 'object' && G.I18n) G.I18n.walk(el);
    console.warn('[Arranque] faltan:', miss.join(', '));
    return true;
  }

  // Mantenimiento (mudanza a servidores nuevos): no se entra ni se inicia
  // sesión, así no se escribe nada mientras se copian las cuentas y partidas.
  // Lo dice el servidor (mantenimiento.json): sólo se juega con «firestore».
  // Para probar en local: localhost con ?dev en la dirección (LOCAL, arriba).
  // @step boot/maint net "¿Mantenimiento?"
  // mode() lee <PS_ENV.server>/mantenimiento.json (límite 4 s); sólo se juega si «modo» es «firestore».
  // Sin PS_ENV.server se juega siempre. En localhost con ?dev se salta.
  // @next maintscr "modo ≠ firestore"
  // @next broken "firestore / sin servidor"
  // @step boot/maint
  async function mode() {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4000);
    // Sin servidor propio no hay mantenimiento que mirar: se juega.
    if (!G.ENV.server) { clearTimeout(t); return 'firestore'; }
    try {
      const r = await fetch(G.ENV.server + '/mantenimiento.json', { cache: 'no-store', signal: ac.signal });
      const j = r.ok ? await r.json() : null;
      return j && typeof j.modo === 'string' ? j.modo : null;
    } catch (e) { return null; }
    finally { clearTimeout(t); }
  }
  const open = m => m === 'firestore';
  async function version() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      return (r.ok && (await r.json()).v) || null;
    } catch (e) { return null; }
  }
  // @step boot/maintscr screen "Pantalla mantenimiento"
  // Sustituye #boot por el aviso con «Volver a intentarlo». Cada 60–75 s vuelve a mirar el modo y
  // version.json, y recarga si se reabre o hay versión nueva.
  // @screen boot
  // @step updater/maint net "Recarga en mantenimiento"
  // La pantalla de mantenimiento también compara version.json cada 60–75 s.
  // @next reload
  function maintenance() {
    const en = typeof G === 'object' && G.I18n ? G.I18n.lang === 'en' : !/^es/i.test(navigator.language || '');
    const el = document.getElementById('boot');
    el.setAttribute('translate', 'no');
    el.innerHTML = '<div class="boot-in"><h1>PokéSurvivor</h1>' + (en
      ? '<p><b>We are under maintenance.</b></p><p>We are moving the game to new servers so it can stay free for everyone. ' +
        'Your account, your save and your Pokémon are safe. Please come back in a few hours!</p>'
      : '<p><b>Estamos en mantenimiento.</b></p><p>Estamos mudando el juego a servidores nuevos para que siga siendo gratis para todos. ' +
        'Tu cuenta, tu partida y tus Pokémon están a salvo. ¡Vuelve en unas horas!</p>') +
      '<button class="btn gold" style="margin-top:12px">' + (en ? 'Try again' : 'Volver a intentarlo') + '</button></div>';
    el.querySelector('button').onclick = () => location.reload();
    if (typeof G === 'object' && G.I18n && !en) { el.removeAttribute('translate'); G.I18n.walk(el); }
    // Cada minuto (y algo, para no llegar todos a la vez): se recarga al acabar o si sale una versión nueva.
    version().then(v0 => {
      const check = async () => {
        const [m, v] = await Promise.all([mode(), version()]);
        if (open(m) || (v && v0 && v !== v0)) location.reload();
        else setTimeout(check, 60e3 + 15e3 * Math.random());
      };
      setTimeout(check, 60e3 + 15e3 * Math.random());
    });
  }

  async function boot() {
    // @step boot/framed
    if (window.PS_FRAMED) return;            // dentro de otra web: ver noframe.js
    if (!((LOCAL && /[?&]dev\b/.test(location.search)) || open(await mode()))) return void maintenance();
    if (broken()) return;
    G.Hz.boot();
    G.I18n.startDom();
    // Espera a la fuente pixel para que la UI no salte al cargarla.
    // @step boot/flowboot
    const ready = document.fonts && document.fonts.load ? document.fonts.load('16px Pixelify') : Promise.resolve();
    ready.catch(() => {}).then(() => G.Flow.boot());
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot);
  else boot();

  // Instalable como app (PWA). Sólo con http(s): abierto con doble clic (file://) no hace falta.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // @step boot/sw net "Registro sw.js"
    // En load, con http(s), registra sw.js: código red-primero (caché ps-code-v1 para jugar sin red), arte
    // caché-primero (ps-art-v1).
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('[PWA]', e.message)));
  }
})();
