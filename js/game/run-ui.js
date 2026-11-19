/* ============ run-ui.js — las ventanas de la partida ============
 * Cartas, objeto, vínculo, pausa y resumen: las de native/shim/ui.js (en todas las plataformas, la web incluida), que pone
 * aquí sus funciones (Object.assign(G.RunUI, …): showLevelUp, setWaiting, showItemChoice, showPause, wirePause, showOver,
 * showBond, pickBond, bondBack, closeLevelUp). Las de la web vieja, en HTML: rama main-web.
 */
  // @step levelup/show screen "Pantalla de cartas"
  // showLevelUp; guardia de 0,6 s para no elegir sin querer; teclas 1-3 y R.
  // @screen scr-levelup
  // @next reroll "R"
  // @next pick "1-3 / toque"

  // @step levelup/reroll decision "Cambiar cartas"
  // 1 gratis + rerollBonus de Mejoras; vuelve a llamar offer.
  // @next show

  // @step levelup/pick event "Elegir carta"
  // pick(i) → card.apply(pl).
  // @next coopq

  // @step run/over screen "Resumen de run"
  // Stats, monedas con desglose, tickets, movimientos, resumen por jugador, shinies; btn-again →
  // G.Flow.afterRun().
  // @screen scr-over
  // @next after "btn-again"

  // @step runend/over screen "Resumen"
  // showOver con desglose, resumen por jugador y aviso de Ko-fi (askSupport).
  // @screen scr-over
  // @next back

  // @step meta/over screen "Resumen de run"
  // showOver: tiempo, nivel, monedas con desglose, tickets, shinies y movimientos; al cerrar,
  // G.Flow.afterRun.
  // @screen scr-over
  // @next after

  // @step choice/item screen "Elegir objeto"
  // Quedarme con / Cambiar a; state='choice' y en coop G.Coop.holdStart para todos.
  // @screen scr-item
  // @next hold "coop"
  // @next equip "elegido"

  // @step choice/bond screen "Fusión de movimientos"
  // Modo 'add' (1 paso) o 'pair' (2 pasos con Atrás); teclas 1-4.
  // @screen scr-bond
  // @next hold "coop"
  // @next fuse "elegido"

  // @step pause/screen screen "Pantalla de pausa"
  // Resumen de ataques, stats, objeto, cartas y esferas; controles de sonido.
  // @screen scr-pause
  // @next resume "Continuar"
  // @next quit "Abandonar/Salir"

  // @step pause/resume event "Continuar"
  // btn-resume → state='playing'.
  // En la web el juego arranca (Game.init → wirePause) antes de que cargue ui.js: se guarda lo que pide y ui.js lo recoge.
G.RunUI = { wirePause(resume, quit) { G.RunUI.pause = { resume, quit }; } };
