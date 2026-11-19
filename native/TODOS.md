# PS5 — en qué estamos y qué falta

Actualizado 01-11-2026. Ramas: `main-classic` (el juego de JPTER78; antes `main`), `ps5` («PokéSurvivor Classic», PPSA77701, sin red ni modo dev) y
`ps5-dev` («PokéSurvivor Classic (Dev)», PPSA77702, online y con modo dev; aquí se trabaja). Último commit: `080a489b` en `ps5-dev`.
`ps5` aún no tiene los arreglos de rendimiento de `ps5-dev` (hay que mergear; ver «Ramas y ediciones» en `CLAUDE.md`).

## Núcleo en C (04-11)
La partida pasa a C para N jugadores en una sola copia: plan y fases en [CORE.md](CORE.md). Fases 1 (mundo), 2 (moverse: jugadores, caminos, enemigos), 3 (pelear: los 103 ataques, daño por dueño), 3b (habilidades, objetos, esferas, clima), 4 (recogidas, experiencia del equipo, una carta para cada uno a la vez) 5a (enemigos especiales, jefes, spawner) 5b (altares, trampas, clima, caramelos), 5c (eventos, grieta, Sentencia) y 5d (vínculos, fin) hechas e iguales al JS (`make -C native core-test`).
Desde el 05-11 toda partida de Jugar va por el núcleo (fase 7; Desarrollador → «Jugar con el núcleo» lo apaga); ✕ en otro mando = otro jugador, con el compañero de su perfil de la PS5. L1/R1 cambian de ataque, □/△ las esferas; al subir de nivel, cartas para cada uno (↑↓ y ✕ en su mando).
Probado en la consola (04-11, solo): moverse, atacar, recibir daño, subir de nivel y cambiar de ataque bien, sin tirones.
El ataque nuevo no se activa solo (como en el juego: te quedas con el que llevabas). Arreglado tras la prueba: las
cartas, con el dibujo de las de siempre (`psCoreCards` en `ui.js`, un panel por jugador en su zona), y la pantalla
partida: la dinámica del cooperativo local de antes (grupos, corte por la mediatriz, alejarse, HUD de cada uno en su
esquina), pintando el mundo una vez por cámara recortado a su zona. **Esto último, sin probar en la consola.**
Fase 3b hecha (sin probar en la consola): habilidades (`core/abil.c`, iguales al JS), objetos de combate, esferas de cada
uno (□ usar, △ siguiente) y el clima en el núcleo; elegir objeto en tu zona.
Fase 5a hecha (sin probar en la consola): enemigos especiales y jefes en el núcleo (`core/foe.c`, iguales al JS), avisos
que golpean a todos, y el spawner del juego (goteo, mareas, jefes, shinies) sacando enemigos al núcleo; reloj y biomas.
Fase 5b hecha (sin probar en la consola): altares, manantiales, cofre con candado, trampas, arena y nieve que dañan,
caramelos de Halloween (`core/map.c`, iguales al JS). Fases 5c y 5d hechas (sin probar en la consola): eventos, grieta y Sentencia del juego sobre el núcleo (lo que cambian,
de vuelta al núcleo), vínculos por jugador, fin de partida y guardado del juego, música.
Fase 6: medidas en el log (`[núcleo] … mundo / hud ms`); el dibujo pasa a C sólo si pesan. Fase 7: Desarrollador → «Jugar
con el núcleo» (las partidas normales, por el núcleo). **Probar en la consola con 2-4 mandos de principio a fin**; después,
quitar `localcoop.js` y las copias de `main.c` (CORE.md, fase 7).
Fase 7 (05-11, sin probar en la consola): el núcleo es lo de siempre; fuera `localcoop.js`, `ps.lc_*`, las copias por
jugador y su composición de pantallas (`main.c`) y el candado de dibujo de varios hilos (`canvas.c`). Los jugadores 2-4
entran con ✕ (también en el menú) con el compañero guardado en su perfil (`ps.core_user`), y su mando vibra
(`ps.rumble(…, i)`). El vínculo guardado se ofrece en cuanto se puede usar (como `Game.update`). Con el núcleo, la batería
de la UI del arnés pasa entera (`PS_CORE=1 … 88 ui`, 0 errores).
Prueba en la consola del 05-11 (solo, «Jugar con el núcleo»), arreglado sin probar: el núcleo usaba otra semilla de mapa
(la del menú no pasa por `World.reset`: ahora `psWorldSeed()`), y lo que el núcleo rompe, abre o usa (rocas, hierba, cofres,
altares, manantiales) no llegaba al mundo que se pinta (`core_props` y `EV_PROP` con la casilla). Mejoras (Maquinación…):
arcos, flechas y etiqueta en el HUD. Cartas: como mucho 6 a la vista (modo dev: se encogían). Grieta: «Has caído» al
entrar sin reproducirse en el arnés; logs `[núcleo] grieta …` y `[núcleo] J1 cae …` para la próxima prueba.

## Ahora mismo (ps5-dev, probado en la consola)
- El juego es `js/app.js` (04-11; antes `js/app.min.js` ofuscado): las fuentes del 28-10 + lo de la web hasta `7fdffe6c`
  (`main-classic`, la última: el repositorio de JPTER78 se borró) pasado a mano: firma del guardado y anti-trampas (`G.Hz`, apagado en la PS5),
  salas por WebSocket (`G.RoomsWS`), ranking por servidor propio (sólo con `ps.rank=vps`), banner y aviso de vídeo
  (`G.BannerUI`, `G.VideoUI`: aún sin pantalla para mando), regalos del admin (`G.Gifts`), copia apartada de la partida que
  no se entiende (`ps.stash.*`, 02-11), mantenimiento por servidor (`mantenimiento.json`: «PokéSurvivor Classic» lo da por abierto;
  en Dev con mantenimiento arranca igual por el respaldo de `boot.js`, sin pantalla para mando). Desde el 18-11 los puertos
  cargan las fuentes sueltas (`js/files.js`), no `app.js`. Harness bien en las dos ediciones; **sin probar en la consola**.
- 60 fps en el menú y en partida normal (trabajo medio ~8 ms de 16,7). Lo que lo hizo posible:
  - coma flotante con flush-to-zero y DAZ (`main.c`): un título arranca en IEEE estricto y cada denormal iba lento;
  - el terreno se genera en los 6 hilos del suelo (`psGen` en `tiles-worker.js`, `tw_gen` en `tiles_worker.c`) y el juego
    sólo recoge cada trozo (antes 35–50 ms por trozo en su hilo: ráfagas al andar y al volver al menú);
  - la viñeta del menú se pinta una vez y se copia (era un degradado de pantalla entera en cada fotograma);
  - al volver de una partida se prepara el terreno de la siguiente (`psPrepareRun` después de `toUI`).
- Pantalla de carga pixel art (`ui.js`, `bootCover`) al arrancar y al volver al menú, hasta que no queda nada cargando.
- Miniaturas de la Pokédex guardadas en disco (`/app0/thumbs.bin` + `thumbs.json`) y a escala como la web.
- Red: DNS por UDP a 8.8.8.8 / 1.1.1.1 (12–26 ms; `sceNetResolver` tardaba >12 s) y logs de C con `say()` (no bloquean).
- Modo dev: el movimiento inicial elegido vale; la partida, las marcas y el perfil no salen a la nube (`net.js`, devGuard).
- Ranking: sprites recortados y shiny, como la web.

## Para probar en la consola (hecho, sin confirmar)
- [ ] **Ficha → «Mejorar Pokémon»** (abre Mejoras de ese Pokémon; ○ vuelve a la ficha) y **Mejoras → □ «Cambiar Pokémon»**
  (abre la Pokédex en modo elegir; ✕ vuelve a Mejoras con ése, ○ sin cambiar). Harness bien en las dos ediciones.
- [ ] **UI (02-11, visto en el navegador):** ficha más compacta (panel derecho a su medida, botones con aire), Mejoras sin
  cortar la 3ª columna, el menú recuerda la opción al volver, Filtros por secciones con «Limpiar filtros» (△), barra de
  arriba pegada a la derecha, ~30 textos que salían a medias en español (p. ej. «Entrando in the room») y nombres de los
  Pokémon paradoja en en/it/pt-BR (shim; quitar cuando la web lo traiga en app.min.js).
- [ ] **Imágenes en otros hilos** (`cv_load_async` / `cv_load_poll` en `canvas.c`, `Image` en `browser.js`): los `imgs`
  12–13 ms al volver al menú y 3–5 ms con enemigos nuevos deberían bajar a ~0. Build compilado (Docker del 01-11, 14:01),
  falta subirlo y mirar `[lento-js]`.

## Fallos abiertos
- [x] **Cooperativo** (02-11, confirmado en la consola: partida juntos PS5 ↔ web, en las dos direcciones). Hacía falta:
  la versión nueva de la web (salas por `RoomsWS`), el DNS por UDP, leer el WebSocket aunque el socket no avise (`net.c`)
  y envolver `ioctl(FIONBIO)` para el socket UDP de libjuice (`compat.c`).
  - Aviso que queda: `juice: Failed to interrupt poll by writing to pipe, errno=38` (pipe no existe en un título). Conecta
    igual; si hay lag o cortes en partida, mirarlo.
- [ ] **«Ver perfil»**: falta volver a probarlo.
- [ ] **Modo estrés**: fotogramas de 25–36 ms. `Path.update` 8–9 ms y `EnemyMgr.update` 5–11 ms: lógica del juego (JS).
  Es una prueba artificial (enemigos al máximo, reloj ×8); en partida normal sobra margen.
- [ ] Picos de una vez al volver al menú: `World.update` 130–230 ms, `timers` ~95 ms (tapados por la pantalla de carga).
- Salir de la sala desde la web: la PS5 tarda ~8–12 s en cerrarla. Es del juego (reintenta 3 veces cada 4 s), igual en la web.
- La pantalla de cartas va más lenta: no importa, el juego está parado esperando la elección.

## Cooperativo local (couch, hasta 4) — el de copias por jugador (02-11), sustituido por el núcleo en C el 05-11
Lo de abajo es historia: `localcoop.js`, el canal `ps.lc_*` y las copias de `main.c` se quitaron (fase 7 de CORE.md);
copia en `native/old-localcoop/` (sin git) hasta que el núcleo esté probado con 2-4 mandos.
Decidido con el dueño:
- **Una copia del juego por jugador** (su hilo y su QuickJS, como los hilos del suelo), unidas por el protocolo de
  `G.Coop` con un canal en memoria (sin red: vale también en «PokéSurvivor Classic»).
- **Perfiles:** la partida por usuario de la PS5 (`/app0/user/<id>/localStorage.json`, como gb5: `sceUserServiceGetInitialUser`;
  lo de ahora pasa al primer perfil que abra el juego). P2–P4: `sceUserServiceGetLoginUserIdList` + `scePadOpen(usuario)`.
- **Invitado sin partida:** usa los Pokémon del anfitrión y se le guarda una cuenta local con el nombre de su perfil; al
  entrar con una cuenta online se juntan, y manda el apodo online.
- **Menú:** Amigos → «Multijugador»; «Crear sala» al lado de «Añadir amigo». Cada mando nuevo llena una plaza; en ella,
  △ y ←→ cambian de Pokémon (favoritos / más nivel) sin bloquear a los demás.
- **Cámara «esquina»:** todos juntos, una sola vista con zoom (hasta ~1,4×); quien se aleja pasa a su cuarto de pantalla
  (su esquina, del tamaño de un cuadrante) hasta que vuelve con los demás. Separar/unir con margen (sin parpadeo).
- **Subir de nivel:** pantalla en 2×2, cada uno elige sus cartas; se sigue cuando eligen todos.
- **Audio como gb5:** música a la tele; los sonidos de cada jugador, al altavoz de su mando (`sceAudioOutOpen(usuario, 4 /*PADSPK*/)`).
- Salas mixtas (locales + online): después, cuando el local funcione.
Pausa: la de cada jugador no para a los demás (como el online); en ella, silenciar el sonido de su mando.
Fases: 1) perfiles (hecho 02-11; en la consola la partida pasó a `user/12fe188f`) · 2) prueba: 2 copias en la consola con pantalla partida fija (fps y memoria; decide si sigue). Hecho en código (02-11,
   sólo Dev, `main.c` «jugador 2»): al encender otro mando con otro usuario arranca otra copia (su hilo, su QuickJS, su
   `fb2`, sin audio/red/suelo en hilos), cada pantalla en un cuadrante de arriba; candado global del dibujo (`canvas.c`).
   Medido 02-11: ~800 MB el proceso, ~25 MB de JS por copia; 30–34 fps por el candado del dibujo (8,8 ms) y el suelo del 2
   pintado en su hilo (`paintChunk` 300–600 ms). El dueño quiere los dos en la misma pantalla → se pasó a la fase 3 ·
   3a) misma partida: `shim/localcoop.js` (G.Net falso por el canal en memoria `ps.lc_*` de `main.c`; el 2 anuncia su
   Pokémon y «Jugar» del 1 arranca la de los dos); el 1 a toda la pantalla y el 2 en su cuadrante sólo si sale de la
   cámara o no está jugando. Probado en la consola (02-11): partida juntos y mandos de cada uno bien ·
   3b) pantalla partida dinámica (como los LEGO; el dueño la eligió con un mock): juntos una cámara en el centro del grupo;
   al separarse, cada copia con su cámara desplazada (`G.Camera.follow` + `lc-cam`) y `main.c` compone por la mediatriz con
   una línea; el 2 no pinta su pantalla cuando no se ve (`canvas_skip`). Cartas/pausa: media pantalla cada uno. 2 jugadores
   (ponytail: con 3–4, Voronoi). 02-11: el 1 ya no espera al 2 (cada copia a su ritmo; el 2 pinta en `fb2` y lo copia a
   `fb2v` al terminar), candados sólo para textos y degradados, y la pausa de cualquiera también en media pantalla.
   Ya: hasta 4 (`MAXP`), grupos que comparten cámara (Voronoi por grupos, en `main.c`), los invitados con los hilos del
   suelo, la sala local («Jugar» con más mandos, o Multijugador → Crear sala; cada uno cambia su Pokémon con △/←→ en su
   mando), los invitados dormidos en su plaza (`psDormant`), sin partida → Pokémon prestados del 1 (`lc-roster`), el nombre
   del perfil (`ps.USER_NAME`), pausa de cualquiera → cuadrícula con cada pantalla entera a 1:1, aviso `[pN] atascado`.
   Banco de pruebas: varias copias del arnés unidas por archivos (`PS_LC=1|2… PS_LC_DIR=carpeta PS_LC_N=n`).
   Visto en la consola (02-11): 4 copias en marcha, ~1,05 GB. Pendiente: probar la sala y la pausa con 4; el congelamiento
   de P2 tras «pausa del 1 + subir de nivel» (su log se perdió; en el banco no se reproduce) ·
   02-11 noche: plazas con «Pulsa ✕ para entrar» (sólo arranca la copia de quien pulsa ✕; un usuario sin mando no ocupa
   plaza), ○ para salir de la sala, iconos del mando; cartas/pausa en celdas para N (se pasaba n=0); cierre al salir las
   cartas = el trazado `static` de `rect_path` compartido entre hilos (ahora uno por lienzo); zoom al separarse (como el
   orbe luminoso, hasta 1,6; hasta 1,8 si la zona queda baja); avisos del juego en una capa encima de todo
   (`ps.lc_overlay`); cada cámara con su grupo en el centro de su zona; logs `[carga]` y `[menu] salir` para la vuelta
   lenta al menú. Pendiente: medir la vuelta al menú, `Path.update` 46 ms cada ~21 fotogramas con 3, componer 4,6 ms ·
   03-11: el HUD de cada jugador (barra de ataques y objeto) en su esquina fija con su color (`ps.lc_hud`: en la partida
   juntos, `G.HUD.draw` dos veces, la franja de abajo a un lienzo aparte); `Path.update` con caché de `World.walkable`
   (1 s, sólo durante Path.update; en el arnés con 3: 11 → 4,7 ms). Sin probar en la consola. Pendiente: la vuelta lenta
   al menú (logs `[carga]`), componer la pantalla partida (4,6 ms) ·
   03-11 (2): la esquina lleva también el bloque de vida (nombre, nivel, vida, mejoras); las ventanas (pausa, cartas,
   objeto) van a 1:1 en el cuarto de pantalla de su jugador (`ps.lc_win`, `ui.js` `winTarget`), sin cuadrícula: la
   partida sigue a la vista; con su ventana abierta, su esquina de HUD no sale. `Path.update`: la caché ya no se vacía
   por tiempo (sólo al cambiar de mundo; al romperse un objeto, su casilla). HUD pintado una vez (antes dos, 4-5 ms) ·
   03-11 (3): ventanas sin fondo oscuro y pistas sólo en la del 1; la lista de vida de los compañeros fuera (cada uno
   tiene la suya en su esquina). «Has caído» del 1: ✕ Reintentar (todos a la sala y empieza en cuanto están, 10 s
   máx.) · Cambiar Pokémon (a la sala) · Volver al menú (←→ botones, L1/R1 jugador); las de los demás se cierran solas
   (`lc-room` → `psBackToRoom`). HUD sin `G.Coop.mates` ni `puppets` (ni lista de vida ni «Ver a un compañero»); caído,
   su aviso bajo su Pokémon. Ventanas: con 2, a media altura en su mitad; 3 lienzos por turnos (antes parpadeaban).
   03-11 (4): esferas y sus teclas en la esquina (HY0 426, HH 114); Path.update un jugador por vuelta (13 ms → ~6);
   grieta/Arceus: una cámara en el medio, alejada (ZARENA 2,2); flechas (shinies, Meowth, grieta…) encajadas en su zona
   (U.clamp durante HUD.draw, camBox); avisos: texto compuesto una vez, desvanecido en 5 pasos. Pendiente: vínculo a la
   vez (holdStart del juego congela a todos), 734 ms al acabar la partida (guardado), tirones al coger objetos (medir).
   03-11 (5): vínculo/objeto sin congelar a nadie (holdStart/holdEnd, nada en la partida juntos); DB.commit('run') agrupado
   (5 s); avisos con reloj propio; Reintentar quita la carga; semilla del 1 a la sala (lc-seed). Ventanas ampliadas: su
   caja (box() → ps.lc_win(id, x, y, w, h)) a ×2 en su mitad con dos, ×1,5 en su cuarto con más, lo que quepa.
   03-11 (6): sala, opción D: carrusel por plaza (←→, L1/R1 ±10, ↑↓ favoritos/todos, △ shiny, □ su Pokédex en su
   cuarto: ps.lc_win también en la sala para los jugadores 2-4); hello con i/n/f/near. «Has caído» a pantalla completa
   (sólo el del 1). Avisos 3 s máx. Orbe luminoso: su zoom se suma. Diagnóstico: L3+R3 → [foto] de cada copia; [estado].
   03-11 (7): audio por mando (fase 6), como gb5: un destino por jugador (nodos 0-3) en el mismo grafo; 2-4 a su PADSPK
   (mono, anillo + hilo); el 1 también al suyo en cuanto hay otro (la tele en silencio). Sala: carrusel por número,
   'all'/'fav'; elegir guarda a los 1,5 s. «Multijugador» bajo «Mejoras». Tarjetas de la sala más altas.
   Pendiente: la música suena en cada mando (cada copia la suya): opción en la pausa para quitarla del propio mando.
   03-11 (8): sala a pantalla completa (lobbyCard/lobbyKeys): cartas grandes, el 1 cambia como los demás (✕ empieza,
   ○ vuelve); Pokédex dentro de la carta (3 x 5, de los suyos por número; △ tipo, L1/R1 página; la copia de cada uno
   manda su página en el hello: dx). Ajustes → Sonido con varios jugadores (Mandos/Tele, ps.au_route). Nombre de la
   esfera elegida en la esquina (HY0 406, BAR 178). Vínculo/objeto: vuelve la espera de todos (sin hookHold).
3) sala local · 4) cartas en 2×2 · 5) cámara esquina · 6) audio por mando.

## Antes de publicar
- [ ] Mergear `ps5-dev` → `ps5` y compilar «PokéSurvivor Classic» (el `param.json` lo protege `merge=ours`).
- [ ] Quitar los diagnósticos temporales:
  - `[partes]` y `[lento-js]` (`browser.js`), `psJsFrame` (`boot.js`);
  - `[abiertas]`, `[ws]` (pasos de curl), `[pila]`/SIGUSR2 y `ws_phase` (`net.c`, `net.js`);
  - `[social]` (`ui.js`), los `[rtc]` sobrantes;
  - los logs de fcntl «no bloqueante», `title_wait_test` y el bucle de `__wrap_poll` (`compat.c`).
  - Dejar los de red hasta que el cooperativo esté confirmado.
- [ ] Probar en el payload (`make -C native push`) que los arreglos compartidos de los shims no lo rompen.

## Después del núcleo en C (pedido el 05-11)
- [x] Quitar el botón de YouTube por completo (y el banner del menú, con el último vídeo). Sin probar en la consola.
- [x] Quitar el de Discord (era una diapositiva del banner).
- [x] Novedades (`NEWS` en `ui.js`, ya no `G.CHANGELOG`): quitar todas las del juego web y poner que es el juego clásico, versión hasta el día del último commit
  del original (`main-classic`, `7fdffe6c`, 04-11-2026), y que desde ahí el original pasó a ser de código cerrado.
- [x] Novedades propias de la PS5: cooperativo local (pantalla compartida), núcleo en C, lo exclusivo de la consola.
- [ ] En partida, subir o bajar el volumen de música / efectos o «silenciar todo» baja a 10 fps. Sospecha: el guardado de `localStorage` (todo el archivo, cada 2 s si cambió); medido con `[guardar]` en el log (`browser.js`) y `[lento-js]`.

## Pedido el 06-11
- [x] Animación al usar una esfera. Causa: `sim_step` vaciaba los eventos al empezar y `orb_use` (llamado antes del paso)
  perdía el suyo (también el «aún en espera»). Ahora los vacía quien los lee (`core_events`). Además, `orbPop` en
  `core.js`: el icono sale de su hueco del HUD. Probado en el arnés; sin probar en escritorio ni consola.
- [x] Números: `intl.js` da `toLocaleString` y `Intl.NumberFormat` (con `compact`) de verdad en QuickJS, con el idioma del
  sistema (`ps.LANG`); `ui.js` ya no fija `'es-ES'`. Monedas y tickets de la barra en corto desde 100.000 (`shortN`, 9,8 M).
- [x] Recogidas cortadas por la hierba: la hierba alta se pinta como suelo, antes de las recogidas (`core.js`). ponytail:
  ya no tapa los pies de quien pasa detrás.
- [x] Atascado sin obstáculos (escritorio): tras ⌘+Tab macOS no manda el keyup del Tab; quedaba en `kbPad`, `psPadRelease`
  no se quitaba nunca y el juego dejaba de ver el teclado. Reproducido en el arnés. Ahora: perder el foco (`main.c`,
  `blur`) o soltar ⌘ suelta todo. Log `[entrada] el juego no ve el mando/teclado desde hace 3 s` si vuelve a pasar.

## Pedido el 08-11
- [ ] Paredes invisibles (jugador de Windows, atascado). Descartado: el terreno y los objetos de `world.c` = los del JS (banco,
  también a 40 000 casillas); el JS no rompe objetos sin el núcleo. Arreglado de paso: los hilos del suelo generaban con
  `Halloween.on` y no `inRun` (calabazas sólo en el núcleo si la run cruzaba el fin del evento). Puesto el log
  `[núcleo] pared invisible: …` (`wallCheck` en `core.js`, `ps.core_free`): falta su `log.txt` (%APPDATA%\PokeSurvivor).

## Después
- [ ] Actualización automática del título: paquete propio y `version.json`. Hoy se actualiza subiendo con `push-title.sh`.
- [ ] ¿El merge online-first debe dejar de sumar monedas y tickets? Pendiente de decidir.
- [x] Banner del menú (Discord y último vídeo del canal, `G.BannerUI`) arriba a la izquierda, con YouTube y Apoyar (dos Ko-fi:
  el del autor y el del port) debajo. La imagen `assets/banner/discord.png` sólo llega con un build de Docker
  (`build-title.sh` la copia). ponytail: el vídeo sin miniatura (el fetch del shim no es binario). `G.Gifts` es de admin:
  sin pantalla en `index.html`, no se porta.
- [x] Linux, Mac y Windows (05-11, `platform/sdl.c`, ver «Multiplataforma»); Switch, pendiente (fase 8 de [CORE.md](CORE.md)).
- [ ] Crossplay entre todas (y la web) cuando haya servidor propio.
- [ ] **Sello del ranking (05-11):** hoy, sin servidor (`ICE_URL` vacío), las marcas van a Firestore sin sello (`NEED_SEAL` en
  `js/app.js`); sólo las filtran las reglas (`validEntry`) y el admin. Para que no se puedan inventar tiempos: montar el
  Worker (`/v1/seal`, gratis en Cloudflare) y comprobar el sello en `firestore.rules` o en el servidor (`TODO(sello)`).
- Dibujo en la GPU (PS5_Vulkan): sólo si el dibujo en C llega a ser el cuello de botella (hoy ~3–5 ms en partida).

## Multiplataforma (rama `dev`, 05-11-2026)
- [x] **Windows** (05-11): `just windows`, MinGW en Docker, probado con Wine sin pantalla. Falta: icono del `.exe` (windres) y probarlo en un Windows de verdad.
- [ ] **Linux / Steam Deck**: compila y pasa las pruebas sin pantalla en Docker (05-11); falta probar la AppImage en la Deck y sus iconos.
- [ ] macOS: `brew install dylibbundler` para que el `.app` lleve SDL2/curl/OpenSSL dentro y abra en otros Mac; firmar/notarizar para repartir.
- [ ] Pantalla de nombre y contraseña en escritorio: escribir con el teclado de verdad con `psTextSink` (ya lo usa el buscador de la Pokédex).
- [ ] Ratón en la tienda y la sala del cooperativo (`hot()` en `ui.js`); la barra de arriba y «Volver», hechos.
- [ ] Switch (homebrew, devkitPro + SDL2): `platform/switch.c` y `PLAT_NAME "switch"`.
- [ ] Textos de PS5 en escritorio (Ajustes → Cuenta: «Cuenta de la consola… sólo en esta PS5», Novedades de PS5…): según `ps.PLATFORM`.
- [ ] Ajustes → Servidor en `ui.js` (escritorio y PS5): cambiar de servidor por URL, volver al de por defecto, exportar/importar la partida. Espera a `G.Server.*` (sesión de servidores; formato en `docs/server-profile.md`).
