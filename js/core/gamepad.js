/* ============ gamepad.js — jugar con mando (Xbox, PlayStation, Switch...) ============
 * Gamepad API con la distribución "standard" (la de casi todos los mandos).
 * Se activa o quita en Ajustes > Controles ('gamepad'; vibración: 'padRumble').
 *
 *   En la partida:  stick izquierdo o cruceta   moverse
 *                   LB / RB (o LT / RT)         ataque anterior / siguiente
 *                   Start                       pausa
 *                   A                           saltar la animación de Arceus
 *                   X / Y                       usar la esfera elegida / cambiar de esfera
 *                   stick derecho               apuntar (con "Apuntar a mano" en Accesibilidad)
 *   Menús, cartas y pausa: los de native/shim/ui.js, que leen el mando ellos mismos (psPadRaw) y mientras están
 *   abiertos el juego no lo ve (web.js / browser.js). (Recorrer los menús HTML con el mando: rama main-web.)
 *
 * Los botones se traducen a las teclas que ya entiende el juego (G.Input.virtual).
 */
G.Pad = (() => {
  const DEAD = 0.25;
  const BT = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  let prev = [], vec = [0, 0], aimVec = [0, 0], aimAt = 0, name = '';

  const enabled = () => G.Settings.get('gamepad') !== false;
  function pad() {
    if (!navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  addEventListener('gamepadconnected', e => {
    name = e.gamepad.id || '';
    if (enabled() && G.UI && G.UI.toast) G.UI.toast('Mando conectado', 2200);
  });
  // @step pause/pad event "Mando desconectado"
  // gamepaddisconnected solo quita el foco del mando; en la web NO pausa la partida (la norma del
  // proyecto dice que sí).
  addEventListener('gamepaddisconnected', () => { if (!pad()) name = ''; });

  // Pasos del mapa de flujos de los menús con mando (ahora, native/shim/ui.js: cada pantalla trata ✕ / ○ y «atrás»).
  // @step controls/back decision "¿Botón cerrar?"
  // ○ / B en una pantalla de ui.js: su «Volver» / «Cerrar»; en partida, Esc (pausa).
  // @next databack "sí: click"
  // @next trap "no: Escape"
  // @step boot/ctl event "Confirmar / atrás"
  // Mecanismo común de mando, atrás del móvil y clic en todas las pantallas (ui.js).
  // @sub controls

  // ---------------- cada fotograma ----------------

  /** Lo llama el bucle del juego antes de mirar las teclas. */
  function poll(dt) {
    const p = enabled() ? pad() : null;
    if (!p) { vec = [0, 0]; aimVec = [0, 0]; prev = []; return; }
    if (!name) name = p.id || '';
    const now = p.buttons.map(b => !!(b && (b.pressed || b.value > 0.5)));
    const was = prev;
    const hit = i => now[i] && !was[i];
    prev = now;

    let x = p.axes[0] || 0, y = p.axes[1] || 0;
    const m = Math.hypot(x, y);
    if (m < DEAD) x = y = 0;
    else { const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; x *= k; y *= k; }
    if (now[BT.LEFT]) x = -1; else if (now[BT.RIGHT]) x = 1;
    if (now[BT.UP]) y = -1; else if (now[BT.DOWN]) y = 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }

    if (G.Game.state !== 'playing') {   // (fuera de la partida, los menús de ui.js leen el mando ellos mismos)
      vec = [0, 0];
      // @step pause/input
      if (hit(BT.START)) G.Input.virtual('escape');
    } else {
      vec = [x, y];
      const ax = p.axes[2] || 0, ay = p.axes[3] || 0;
      if (Math.hypot(ax, ay) > 0.35) { aimVec = [ax, ay]; aimAt = performance.now(); } else aimVec = [0, 0];
      if (hit(BT.LB) || hit(BT.LT)) G.Input.virtual('keyq');
      if (hit(BT.RB) || hit(BT.RT)) G.Input.virtual('keye');
      if (hit(BT.START) || hit(BT.BACK)) G.Input.virtual('escape');
      if (hit(BT.A)) G.Input.virtual('space');
      if (hit(BT.X)) G.Input.virtual('padx');
      if (hit(BT.Y)) G.Input.virtual('pady');
    }
  }

  /** Vibración (0..1, en ms), si el mando y el ajuste lo permiten. */
  function rumble(k, ms = 120) {
    if (!enabled() || G.Settings.get('padRumble') === false) return;
    const p = pad();
    const a = p && p.vibrationActuator;
    if (!a || !a.playEffect) return;
    k = Math.max(0, Math.min(1, k));
    a.playEffect('dual-rumble', { duration: ms, strongMagnitude: k, weakMagnitude: Math.min(1, k * 1.3) }).catch(() => {});
  }

  return {
    poll, rumble,
    /** Vector de movimiento del stick (sólo en la partida). */
    vector() { return vec; },
    /** Stick derecho, si se está empujando: [x, y] o null; y cuándo se usó por última vez. */
    aim() { return aimVec[0] || aimVec[1] ? aimVec : null; },
    get aimAt() { return aimAt; },
    /** Nombre del mando conectado ('' si no hay). */
    get name() { return pad() ? name || 'Mando' : ''; }
  };
})();

;
