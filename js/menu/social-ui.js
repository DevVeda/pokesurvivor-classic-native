/* ============ social-ui.js — la red de la sala del cooperativo online ============
 * La pantalla de la sala, invitar y «Empezar» son de native/shim/ui.js (lobbyScreen), que pone aquí open, close y render
 * (Object.assign(G.LobbyUI, …)). Aquí sólo lo que no es pantalla: al entrar o salir de una sala se abre o se cierra la red.
 * (La web vieja, con su sala en HTML: rama main-web.)
 */
(() => {
  // @step lobby/screen screen "Pantalla sala"
  // Tarjetas de miembros con estado de conexión, invitar amigos (native/shim/ui.js, lobbyScreen).
  // @screen scr-lobby
  // @next ready
  // @next leave "Salir"
  // @step net/failed event "No se pudo"
  // La sala muestra 'No se pudo conectar (reintentando…)' y bloquea Empezar.
  // @next turn
  // @step lobby/start event "Empezar partida"
  // cfg {k:'start', seed, host, members}; setOpen(false), Net.broadcast y G.Flow.startCoop; los
  // invitados lo reciben en G.Net.on (native/shim/ui.js, start de lobbyScreen).
  // @sub coop
  // @step coop/start event "startCoop"
  // Cierra lobby y startRun(cfg): misma seed, Coop.begin coloca a cada uno y crea marionetas;
  // Social.setPlaying(true). Sin Endless.
  // @next host
  G.LobbyUI = (() => {
    function init() {
      // Conecta / desconecta la red al entrar o salir de una sala.
      G.Social.on(what => {
        const room = G.Social.room;
        if (room) {
          G.Net.open(room.id, room.isHost, room.host);
          // En partida la lista de la sala no echa a nadie (puede faltar alguien un
          // momento por un corte con la base de datos): manda el canal directo.
          if (!G.Coop.active && !room.lost) G.Net.syncMembers(room.members.map(m => m.uid));
        } else if (G.Net.open_) G.Net.close();
        if (what === 'room-closed') G.UI.toast('La sala se ha cerrado', 2600);   // (ui.js vuelve al menú)
        G.LobbyUI.render();
      });
      G.Net.onPeer(() => G.LobbyUI.render());
    }
    return { init, open() {}, close() {}, render() {} };   // (open, close y render: los de native/shim/ui.js)
  })();

  // @step lobby/invite
  G.SocialUI = { init() { G.LobbyUI.init(); } };
})();
