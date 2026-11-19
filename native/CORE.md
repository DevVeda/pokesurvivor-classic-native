# Núcleo de partida en C (couch coop)

Decidido el 04-11-2026: el repositorio de JPTER78 se borró, `js/app.js` ya es nuestro y la partida pasa a C, pensada para
**N jugadores locales en una sola copia** (adiós a una copia del juego por mando). Se hace por fases: el juego sigue
jugable en cada una. Menús, tienda, Pokédex, cuenta y red se quedan en JS (`ui.js`) mientras no molesten.

## Lo que hay hoy (mapa de `js/app.js`)
- Un solo jugador local `pl` en `G.Game` (L27590) + compañeros remotos de `G.Coop` que sólo se copian (`netUpdate`).
  `update()` (L28335) le pasa ese `pl` a `Combat.tick/resolve`, `Projectiles.update`, `Orbs`, `Interact`, `Rift`,
  `Judgment`, `Weather`. Ya aceptan la lista de jugadores: `EnemyMgr`, `Spawner`, `Path`, `Pickups`, `Events`.
- Supuestos de un solo jugador a quitar al pasar a C:
  - `Player.update` lee `G.Input.axis()` y `handAim` (`G.Pad`, `G.Touch`, ratón);
  - `Combat.resolve`: disparos y contacto enemigo sólo contra `pl`; crédito de daño a `pl` y no a `p.owner`;
  - `EnemyMgr.update`: muertes y jefes a `players[0]`; quemadura según `pl.level`;
  - `Hazards`, `Events.reward`, `Rift`, `Judgment.touch/keepMeInside`: sólo `G.Game.player`;
  - `Orbs`: `cd` y `sel` globales; el orbe luminoso cambia el zoom de la única cámara;
  - `Projectiles` se borran fuera de la cámara (`G.Camera.sees`): la simulación depende de una vista;
  - `Game.onCollect`, `maybeLevelUp` (un `pendingLevels`, cartas del DOM), `state` global (pausa para todos).
- No determinista: `Math.random` en todo (sólo el terreno usa `G.U.hash`, L43), `dt` variable, `performance.now()` en
  enfriamientos (`Banda Focus`, `m.castAt`, `Path.dirFor`).
- Con closures de JS (en C: un `enum` de ganchos, no datos): `G.ABIL`/`G.AbilityFX` (L7569/L14654), `G.Items` (L9465),
  cartas de `G.LevelUp` (L16037). Datos puros: `G.DEX`, `G.Moves` RAW (L6881), `G.Orbs.LIST`, `G.Upgrades` (L9401).

## Diseño
- **`native/core/`, C17 (lo que ya compila clang por defecto en el resto de `native/`) sin nada de la PS5** (ni QuickJS ni SDL): compila igual en el Mac (`make -C native core-test`)
  que en Docker. Estado plano: arrays de structs con tope fijo (`Player[4]`, `Enemy[]`, `Proj[]`, `Pickup[]`, `Field[]`,
  `Hazard[]`), ids estables, rejilla espacial (celda 52 como `EnemyMgr`).
- **Determinista:** paso fijo 1/60 y un RNG con semilla por partida (xorshift); nada de reloj de pared en la simulación.
- **Entrada por jugador:** `CoreInput { ax, ay, aimx, aimy, botones }` en cada paso. Nada de `G.Input` dentro.
- **Salida = eventos:** la simulación no pinta ni suena; deja una cola (`sfx`, `fx`, `kick`, `rumble`, `say`, `levelup`,
  `muerte`…) con el jugador al que va. JS/`ui.js` (y más tarde el dibujo en C) la consumen.
- **Crédito por dueño:** todo daño, muerte, XP y objeto lleva `owner`; nada de «el jugador local».
- **Datos generados:** `native/tools/export-core.cjs` carga `js/app.js` en Node y escribe `core/data.c` (DEX, ataques,
  orbes, mejoras, curvas). Lo que hoy es closure pasa a un `id` de gancho con su `switch` en C.
- **Puente:** `ps.core_*` en `main.c` (crear partida, paso, entradas, leer entidades en un `ArrayBuffer`, sacar eventos).
- Módulos: `rng`, `world` (transitable, colisión, props; terreno por `hash` igual que el JS), `player`, `enemy`
  (+ gestor y rejilla), `path` (BFS por jugador), `proj`, `combat` (ataques por tipo, campos), `pickup`, `orbs`, `spawn`,
  `hazard`, `events`, `rift`, `judgment`, `run` (tiempo, bioma, nivel por jugador, fin de partida).

## Comprobar contra el JS
Para que salga lo mismo bit a bit: todo en `double`, mismo orden de operaciones, `#pragma STDC FP_CONTRACT OFF` (sin FMA)
y `sqrt(x*x+y*y)` en vez de `Math.hypot` (con enteros da lo mismo). El banco: `core/test.c` (el C responde por stdin) y
`core/bench-*.cjs` (el JS, cargado con `tools/core-js.cjs` como en el hilo del suelo).

El JS no es determinista, así que no se compara partida a partida, sino **función a función**: un banco en Node llama a
la función del JS (`G.U.hash`, `World.walkable`, `Player.xpFor`, daño de `Combat`, `Moves.levelUp`…) y al binario de
prueba del núcleo con las mismas entradas, y compara. Lo del azar se compara en distribución (media, máximo).

## Fases
1. **Base** (hecha 04-11): `core/core.h` (hash, RNG xorshift, tipos), `core/world.c` (terreno, props, arena, consultas,
   choques, romper objetos; sin botín ni dibujo), `core/data.c` generado (biomas → líquido, temas de arena).
   `make -C native core-test`: `core/bench-world.cjs` hace ~13 800 preguntas a los dos (7 semillas, biomas, Halloween,
   3 arenas) y salen iguales bit a bit; con mutantes del C salen cientos de diferencias. Sin cambios en la consola.
2. **Moverse** (hecha 04-11, sin probar en la consola): `core/sim.c` con jugadores (`Player.update`: stick, velocidad,
   charcos y hielo, choques, apuntar), caminos (`G.Path`: BFS por jugador, vista despejada) y enemigos (`Enemy.update`:
   perseguir, embestida, los que guardan distancia, corredor, ladrón; atasco y rodeo; rejilla y separación de
   `EnemyMgr`; rezagados que vuelven a salir por delante). `core/bench-sim.cjs`: ~9 500 respuestas iguales al JS (los 3
   casos en que el enemigo elige lado al azar no se comparan); los mutantes salen. Puente `core_js.c` (`ps.core_*`) y
   prueba `shim/core.js`: Ajustes → Desarrollador → «Núcleo en C (prueba)»; ✕ en otro mando = otro jugador en la misma
   copia (`ps.core_pads`, `ps.pad(i)` en `main.c`). En Node: `PS_CORE=1 node native/shim/run-node.cjs …` (`core-test`
   por FIFO). Aún no: jefes, saltos, escudos, bombas, disparos, daño (fase 3); una sola cámara en el centro del grupo.
3. **Pelear** (hecha 04-11, sin probar en la consola): `core/combat.c`: los 23 tipos de ataque (proyectil, cuerpo a
   cuerpo, rayo, nova, aura, potenciador, bumerán, cadena, minas, meteoros, torreta, embestida, rastro, cono,
   teledirigido, rebote, carga, giro, terremoto, remolino, empujón, aturdir, órbita), proyectiles (barridos, perforación,
   rebote, vuelta del bumerán), campos, tabla de tipos y defensas, crítico, quemadura / veneno / frenazo / aturdido,
   lava a los enemigos, daño y muerte **por dueño** (cada golpe y cada muerte, del jugador que la hizo), daño al jugador
   (contacto y disparos enemigos, cuerpo a cuerpo −25 %), caer y que un compañero te levante (3 s a su lado).
   Enemigos: disparo, abanico y curandero. `data.c` lleva la Pokédex, la tabla de tipos y cada ataque ya calculado por
   nivel y evolucionado. `core/bench-combat.cjs`: los 103 ataques a 4 niveles (412 combates) salen iguales que el JS con
   el azar fijo; los mutantes salen. La prueba (`shim/core.js`): ataques de cada uno, L1/R1 para cambiar, números de
   daño, efectos, proyectiles y campos; caen todos → resumen. Aún no: habilidades y objetos (3b), botín de los objetos
   rotos y experiencia (fase 4), rayos y zonas con aviso de los enemigos, invocaciones, escudos, saltos, bombas (fase 5).
   Diferencias a propósito con el JS: los meteoros barajan con Fisher-Yates (el JS, `sort(() => random - 0.5)`); los
   proyectiles se descartan lejos de todos los jugadores (el JS, fuera de su cámara).
4. **Progreso** (hecha 04-11, sin probar en la consola): `core/pickup.c`: lo del suelo (`G.Pickups`: imán, el jugador
   vivo más cercano lo recoge, se juntan los de experiencia al pasar de 420), el botín de enemigos (normales, jefes,
   ladrón, legendario) y de los objetos rotos (hierba, roca, calabaza, cofre, cofre con candado), y lo que hace cada
   cosa al cogerla (experiencia, monedas, tickets, cura, imán, bomba). **La experiencia y el nivel son del equipo**
   (como el cooperativo online: `G.Coop.xpFactor`), y cada subida abre una carta **para cada jugador vivo a la vez**,
   cada uno con su mando en su zona de la pantalla (entera, mitades, cuartos); la partida espera a todos.
   Las cartas son las del juego (`G.LevelUp.offer` y su `apply` sobre el `G.Player` de pintar) y lo que cambian
   (vida, ataque, recarga, velocidad, regeneración, imán, ataques nuevos o mejorados) pasa al núcleo
   (`core_stats`, `core_learn`, `core_movelvl`): las decisiones de nivel no se pasan a C, sólo la partida.
   `core/bench-pickup.cjs`: 1920 pasos y niveles iguales que el JS. Lo recogido por todos va al 1 al acabar.
   Las cartas se dibujan con el `cardList` de `ui.js` (`psCoreCards`): un panel por jugador, escalado a su zona.
   Pantalla partida (adelanto de la fase 6, en JS): la dinámica del cooperativo local de antes, portada a una sola copia.
   El reparto es el `splitN` de `localcoop.js` (grupos a menos de R en pantalla comparten cámara, sitio de cada grupo,
   alejarse hasta ×1,6 / ×1,8, cada grupo en el centro de su zona sin salto) y la línea, la mediatriz entre cámaras
   distintas (como `main.c`). En vez de componer varias pantallas, `G.Game.render` (`js/game/game.js`, `psCore.views`) pinta el mundo **una vez por cámara,
   recortado a su zona** (polígono) y con la cámara del tamaño de la caja de la zona: juntos, una vez; separados, más o
   menos una pantalla en total (las cajas de zonas inclinadas se pisan un poco). La simulación, una vez (el núcleo).
   El HUD de cada uno, en su esquina (barra y vida a la mitad, borde de su color: 1 y 2 abajo, 3 y 4 arriba), como
   `ps.lc_hud`; lo de todos (experiencia, tiempo), del HUD del 1. ponytail: el HUD se pinta una vez por jugador cada
   fotograma (si pesa con 4, los de 2-4 cada dos); sin la cámara de la grieta / Arceus ni las flechas en su zona.
   Aún no: el caramelo de las calabazas.
3b. **Habilidades, objetos y esferas** (hecha 04-11, sin probar en la consola): `core/abil.c`. Las ~165 habilidades de
   `G.AbilityFX` como una tabla (nombre → plantilla y cuánto) y sus ganchos: daño hecho (con la pasiva genérica de su tipo
   y la de las «plus»), daño recibido, absorber un tipo, esquivar, velocidad, ×cura, potenciadores antes, crítico ×2,
   Robustez, Potencia Bruta / Dicha en los estados, lo que pasa cada paso (climas que curan, Impulso, Cambio Táctico,
   Irascible, Detonación, Veleta…), al recibir un golpe, al tocarle un enemigo, al golpear y al derrotar. Objetos de
   combate: Banda Focus, Cascabel Concha, Vidasfera, Casco Dentado (los de stats, como Restos o Cinta Elección, los pone el
   JS con `equip` y llegan por `core_stats`). Esferas: bolsa de 4 huecos (hasta 3 de cada), una esfera sólo va a quien le
   cabe, usar (dormir, frenar, empujar a los que ve; Foco, Luminosa y Rápida a él y a los que tiene a media pantalla), 1 s
   entre una y otra, **cada jugador con las suyas**. El clima (`G.Weather`, en JS) pasa al núcleo (`core_weather`):
   ×daño por tipo, nieve que frena, habilidades de clima. Y de paso: lava al jugador (no la llevaba), Levitación.
   Lo que fija la habilidad al empezar (crítico, imán, vida, ×recarga, monedas) lo pone el JS en su `G.Player`
   (`setAbility`) y llega por `core_stats`. `core/bench-abil.cjs`: cada habilidad en 14 estados al azar (vida, frenado,
   clima, objeto, humor…), 30 576 respuestas iguales que el JS; los mutantes salen.
   La prueba: □ usa la esfera elegida, △ pasa a la siguiente (el 1, con las teclas del juego); un objeto nuevo, si ya
   llevas otro, se elige en tu zona con las cartas; ¡Esquiva!, Banda Focus, Robustez… como en el juego.
   Arreglos: `core_step` sin paso (dt 0 tras una pausa) dejaba los eventos del anterior y se repetían (un objeto se ofrecía
   una y otra vez); el 1 entraba con la velocidad ×spdMul y la sincronización lo volvía a multiplicar.
   ponytail: Impostor no cambia los stats del núcleo; sin el daño de la arena y la nieve (fase 5).
5. **Mundo vivo**, por partes:
   - **5a. Enemigos y jefes** (hecha 04-11, sin probar en la consola): `core/foe.c`. Rayo y zonas con aviso, abanico,
     curandero, escudero (escudos a los 6 más cercanos; a un jefe, lo que le quitas en 1,2 s), saltador, kamikaze (mecha y
     explosión que Humedad no nota) y los **jefes** con su IA (`bossInit`: 2 ataques de cerca y 2 de lejos según su tipo,
     alternar cerca / lejos, rodearte, pisotón, embestida, salto, lluvia de zonas, rayos en abanico, abanico y anillo de
     disparos, furia a media vida). Los avisos (`G.Hazards`) en el núcleo: **golpean a todos los jugadores** que pillen;
     `core_hazard` deja poner otros desde el JS (la Sentencia, los eventos). Jefe perdido lejos: vuelve a salir cerca a los 4 s.
     `core/bench-foe.cjs`: 40 escenas × 200 pasos (personalidades y jefes, con escuderos y curanderos al lado), iguales al JS
     (los ángulos de `atan2`, con tolerancia: la libm y V8 difieren en el último bit); los mutantes salen.
     **El spawner es el del juego** (`G.Spawner`: goteo, mareas, jefes a su hora, shinies, élites, tope de apoyos): en la
     prueba, `G.EnemyMgr.add/all/get/count/bossAlive` van al núcleo mientras está en marcha, y lo mismo invocar
     (`Enemy.summon` del G.Enemy de pintar, con los datos de la run). El reloj de la partida (`debugTime`) y el bioma cada
     4 min también. Las decisiones (qué sale y cuándo) son del JS, pocas veces por segundo; lo de cada fotograma, del C.
   - **5b. Lo que pasa en el mapa** (hecha 04-11, sin probar en la consola): `core/map.c`. Altares (cada jugador coge su
     poder 25 s: daño ×2, +45 % velocidad, imán ×4, −40 % recarga; el núcleo lo vuelve a poner encima de lo que llega por
     `core_stats`), manantiales (curan a quien esté encima; se secan y se recargan), cofre con candado (lo abre
     cualquiera que se quede al lado 3,5 s), trampas (veneno, pegajosa, explosiva: la pisa un jugador o un enemigo que no
     vuela; daña a los enemigos y **a todos los jugadores** de alrededor, salvo Levitación / Muro Mágico, y la pegajosa no
     frena a los de Flexibilidad y parecidas), arena y nieve que quitan vida a jugadores y enemigos (cada 2 s; a los
     jugadores nunca les dejan KO), caramelos de Halloween (calabazas y enemigos, 1,25 por minuto como mucho), monedas de
     la hora dorada, Gholdengo con su ticket ×10 y el aviso del ladrón que se escapa. `core/bench-map.cjs`: 30 especiales
     de 16 semillas (acercarse, quedarse, irse; enemigos junto a las trampas), arena y nieve, y caramelos: 5940 pasos
     iguales al JS; los mutantes salen. ponytail: tras romper un especial, el resto se mira al paso siguiente.
   - **5c. Eventos, grieta y Sentencia** (hecha 04-11, sin probar en la consola). Los tres son del juego y deciden en JS
     (`G.Events`: horda, hora dorada, ladrón, Pokémon perdido; `G.Rift`: abrir, viaje, legendario, ganar / perder, volver;
     `G.Judgment`: animación, viaje, Arceus, sus pilares, rayos y ondas, legendarios cada 5 s, romper objetos). Sobre los
     G.Player / G.Enemy de pintar; lo que tocan del resto va al núcleo: `G.EnemyMgr.stash/restore/queryCircle`,
     `G.Projectiles.clear`, `G.Combat.clearFields`, `G.Hazards.add/clear`, `G.Pickups.drop/clear/pullAll`,
     `G.World.setArena/setBiome`, `G.Game.everyone` (todos los mandos). Y **lo que cambian en jugadores y enemigos**
     (llevarlos a la arena, encerrarlos, curar, revivir, el toque de Arceus, hacer dorados, romper el objeto) se devuelve
     al núcleo comparando con lo que dijo en el paso anterior (`core_ppos`, `core_php`, `core_eset`, `core_stats`). El 1
     llama a esos sistemas con el paso; los demás, con 0 (también entran en la grieta, tocan a Arceus y no salen de su
     arena, sin que el reloj corra dos veces). En C: Arceus no cae (suma a su cuenta en el JS), recibe `dmgK`, sin estados,
     no se le apunta con legendarios vivos; tope suave de velocidad en la Sentencia; sin rezagados en las arenas.
   - **5d. Vínculos, fin de partida y música** (hecha 04-11, sin probar en la consola). Al ganar la grieta, un vínculo para
     cada uno, y cada uno elige en su zona (con las cartas) qué ataques se unen; los huecos con varios ataques llegan al
     núcleo con `core_slots`. El fin de partida es el del juego (`endRun`, desde `G.Game.update` junto con el reloj): guarda
     monedas, tickets, caramelos, estadísticas y ranking como siempre, con lo de todos en el 1 (también jefes y caramelos).
     En la grieta, caer todos sólo os echa. La música, según lo que pase (jefe, grieta, Sentencia, bioma).
     Arreglos: `psCore.on` tenía una `L` que tapaba la de la cámara (fallaba al acabar la partida); `sync` sólo miraba el
     primer ataque de cada hueco.
     ponytail: la prueba («Núcleo en C» en Desarrollador) sigue marcando la partida (`debugTime(0)`: no va al ranking)
     hasta la fase 7.
6. **Dibujo en C** (04-11: medir primero). La norma es pasar a C lo que la medida pida, y en la consola la partida va a
   60 fps; falta medir la pantalla partida. Hecho: el log del núcleo (`[núcleo] … mundo X ms (N vistas), hud Y ms`) da lo
   que cuesta pintar el mundo (todas las vistas) y los HUD de cada jugador por fotograma; con 3 o 4 jugadores, el HUD de
   los jugadores 2-4 se repinta un fotograma sí y otro no. Lo siguiente, según esas medidas: si `mundo` pesa, pintar el
   suelo y los sprites de los enemigos desde C (`canvas.c` ya los dibuja; el JS sólo recorre listas); si `hud`, el HUD
   de las esquinas en C.
7. **Fuera lo viejo** (hecha 05-11, sin probar en la consola con 2-4 mandos). Toda partida de Jugar (no las del
   cooperativo online) va por el núcleo; Desarrollador → «Jugar con el núcleo» (encendido de serie) lo apaga. Fuera la
   prueba de Desarrollador, `shim/localcoop.js`, el canal `ps.lc_*`, las copias por jugador de `main.c` (hilos, pantallas
   y su composición), la sala local de `ui.js` y el candado de dibujo de `canvas.c` (copia en `native/old-localcoop/`).
   Los jugadores 2-4: ✕ en su mando (también en el menú), con el compañero de su perfil de la PS5 (`ps.core_user` + su
   `user/<usuario>/localStorage.json`; si no tiene, uno al azar), y vibración en su mando (`ps.rumble(…, i)`). Lo que se
   gana va a la partida del 1, como antes. ponytail: el sonido por el altavoz de cada mando (`audio_pad`) queda en
   `audio.c` sin usar. Pendiente: decidir el cooperativo online con la web (hoy en JS: el núcleo no hace de anfitrión).
   Antes (04-11): Desarrollador → «Jugar con el núcleo» hacía que las
   partidas normales (no las del cooperativo online) vayan por el núcleo, sin marcarlas (cuentan para el ranking como
   siempre); ✕ en otro mando, otro jugador en la misma copia. **Pendiente, cuando se haya probado en la consola** (con 2-4
   mandos, de principio a fin: jefes, grieta, Sentencia, fin de partida):
   - que «Jugar con el núcleo» sea lo de siempre (y la prueba de Desarrollador, fuera);
   - quitar `shim/localcoop.js` (ojo: no está en git todavía; antes, añadirlo o guardarlo aparte), lo de las copias por
     jugador de `main.c` (componer pantallas, `ps.lc_*`) y lo que las arranca;
   - decidir el cooperativo online con la web: el núcleo como anfitrión (manda el estado como `G.Coop`) o dejarlo en JS.
## Pendiente de decidir
- Cooperativo online con la web: hasta la fase 7 sigue por la partida en JS de siempre.
- `ps5` (sin red): recibe el núcleo cuando la fase 4 esté probada en la consola.
