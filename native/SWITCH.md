# PokéSurvivor en Switch (`native/`, homebrew con libnx)

## Objetivo
- **60 fps en la base (1080p) y 30 fps en portátil (720p)**, con render por **GPU**.
- **Exclusivo de Switch:** Joy-Con sueltos (uno por jugador, de lado) o en pareja, mando Pro; applet de mandos del sistema;
  vibración HD; pantalla táctil en portátil; teclado del sistema (swkbd) para escribir.
- Mismo código que el resto (`dev`): `platform/switch.c` detrás de `platform.h`, `ps.PLATFORM === 'switch'` en el JS.

## Cómo se compila
- `just switch` → `native/build/switch/PokeSurvivor.nro` (Docker: imagen `pokesurvivor-switch`, `native/switch/Dockerfile`,
  que se crea la primera vez; `Makefile.switch`).
- Probar: copiar el `.nro` a `sdmc:/switch/` y abrirlo desde hbmenu **como título** (mantener R al abrir un juego): en
  modo applet (álbum) sólo hay ~440 MB de RAM.
- Rutas: el juego en el romfs del `.nro` (`plat_root()` = `romfs:`); lo que se escribe en `sdmc:/switch/pokesurvivor`
  (log, partida, miniaturas).
- NSP (fase 6): `just switch-nsp` (o `just switch-nsp keys=<ruta>`; por defecto `native/switch/prod.keys`, las de
  tu consola, sacadas con Lockpick_RCM: `*.keys` en `.gitignore` y `switch/.dockerignore`, **nunca en git**; sólo hace falta `prod.keys`; entran en Docker como archivo de sólo lectura) →
  `native/build/switch/nsp/PokeSurvivor-<versión>.nsp`. Se instala con DBI/Tinfoil y sale en el menú HOME como un juego:
  modo título siempre (toda la RAM), sin hbmenu ni R. `tools/package-switch.sh`: `elf2nso` + `npdmtool`
  (`switch/pokesurvivor.json`) + `nacptool` + icono → `hacbrewpack` (en la imagen: el de The-4n ya no está en GitHub, va
  la copia de rlaphoenix fijada a su commit v3.05). Title ID `01005053b0b00000` (en el script y en el JSON). Sin logo
  propio (`--nologo`): al abrir, pantalla negra.

## Fases
| # | Qué | Meta | Estado |
|---|---|---|---|
| 0 | devkitPro en Docker, `Makefile.switch`, `just switch`, icono | compila un `.nro` | hecho (08-11): `PokeSurvivor.nro`, 88 MB |
| 1 | `platform/switch.c` (SDL2 de devkitPro, romfs, sdmc, idioma, applet de mandos) | llega a una partida; medir fps con PlutoVG | en curso |
| 2 | Canvas por GPU: `canvas_gl.c` (GLES con switch-mesa): lotes de sprites (`drawImage`, un draw call por textura) + NanoVG para caminos y texto; PlutoVG de reserva | 60 fps en solitario a 1080p en la base | primer paso hecho (08-11), sin probar en la consola |
| 3 | CPU: quickjs-ng; perfilar (`bench-*.cjs`) y pasar lo caliente a `core/`; reparto en 3 núcleos | ningún fotograma > 16 ms (base) / 33 ms (portátil) con 2 jugadores | — |
| 4 | Mandos de Switch: Joy-Con sueltos/pareja (`ps.pad_setup`), iconos de Joy-Con suelto en `ui.js`, vibración HD, táctil, swkbd | 4 jugadores con Joy-Con sueltos | Joy-Con, táctil y swkbd hechos (08-11), sin probar en la consola; falta vibración HD |
| 5 | Red: `net.c` con curl 8 + mbedTLS 3 propios (WebSocket), `webrtc.c` (libdatachannel sobre los sockets de libnx) | cuenta online y cooperativo con la web | compila (09-11), sin probar en la consola |
| 6 | NSP (`hacbrewpack`), `tools/package-switch.sh`, `news.json` | se instala con DBI | hecho (09-11) hasta `hacbrewpack`; sin probar con keys ni en la consola |

## Pantalla por GPU (fase 2, `gpu.c`)
- Sólo la **pantalla** va por OpenGL 3.3 (o ES 3.0): un framebuffer propio que se queda entre fotogramas, como un `<canvas>`.
  Los lienzos fuera de pantalla siguen en PlutoVG y se suben como textura cuando cambian (`dirty`, marcado en `dispatch`).
- A la GPU directo, sin pasar por la CPU: `blit` (sprites, suelo), `drawImage` girado o con otro modo, `solid_rect`
  (partículas) y `blit_plain` (textos y degradados ya pintados: `gpu_image`).
- Lo demás (caminos, texto nuevo, recortes, `putImageData`) lo pinta PlutoVG en el búfer de la pantalla, que queda de
  **borrador**: cada llamada marca su recuadro (`touch`), `dispatch` lo sube (`gpu_scratch`, atlas por estantes) y lo
  vuelve a poner a cero. Leer la pantalla (`getImageData`, `drawImage` desde ella, `ps.shot`) la trae con `gpu_read`.
- Escritorio: siempre, salvo sin OpenGL o con `POKESURVIVOR_GPU=0` (PlutoVG, para comparar). Switch: siempre, salvo con
  `sdmc:/switch/pokesurvivor/cpu.txt`. En la base, 1920x1080; en portátil, 1280x720 (la del arranque).
- `clearRect` sin recorte: un cuadrilátero con «clear» (antes subía la pantalla entera cada fotograma).
- Rellenos y trazos sin guiones ni recorte (sombras, barras, aros): `path_cached` guarda la huella del trazado (`hpt`, cada
  punto relativo al primero) y, la primera vez, lo pintado en el borrador; luego es una textura al píxel más cercano.
  No se guarda si el borde de la pantalla lo cortaba (`tcut`).
- `[dibujo] … · borrador N (kpx)`: las subidas del borrador por fotograma. `PS_GPU_TRACE=n`: una línea por cada una.
- Medido en un Mac (08-11, partida a 1080p): dibujar, de 5,2-6,3 ms (PlutoVG) a 0,6 ms; 1 subida del borrador por
  fotograma (la barra de vida, con recorte: 5 kpx).
- Aproximado: los modos que en el navegador borran fuera de la figura (source-in, destination-in…) sólo actúan en su recuadro.

## Mandos (fase 4)
Lo que hace el SDL2 de devkitPro (rama `switch-sdl-2.28`, `src/joystick/switch/SDL_sysjoystick.c`, leído el 08-11):
siempre 8 mandos, uno por npad (No1..No8; el 0 también es el modo portátil), abiertos al arrancar y sin avisos al
conectar; `main.c` (`p_added`) toma el 0 como J1 y los demás esperan su confirmar. Con un Joy-Con suelto, los botones ya
vienen girados para jugar de lado, el stick llega como cruceta (sin ejes), SL/SR como ZL/ZR y la pausa es pulsar el stick.
Cuando un mando cambia de tipo, SDL abre solo el applet de mandos.

- **Por posición:** `pad_mapping` (switch.c) registra un mapeo para «Switch Controller»: `BUTTON_A` = el de abajo (la B),
  como en escritorio. Así `ui.js` (Nintendo: abajo = B) y el confirmar del cooperativo (`p_poll`) van igual que allí.
- **Joy-Con suelto** (`plat_pad_adjust`, nueva en `platform.h`; en las demás, nada): SL/SR → L1/R1 (cambiar de ataque) y
  la cruceta también como stick (core.js mueve a los jugadores 2-4 sólo con el stick). `ps.pad().type = "joycon"`:
  `ui.js` pinta sus botones como 4 puntos con el que toca lleno, y SL/SR, STICK (pausa), +/−.
- **Applet de mandos:** Ajustes → Controles (sólo Switch): «Conectar mandos» (`ps.pad_setup(4, false)`) y «Joy-Con
  sueltos» (`ps.pad_setup(4, true)`: uno por jugador). El que abre SDL pasa por `--wrap=hidLaShowControllerSupportForSystem`:
  usa el modo elegido (no 8 jugadores sin sueltos) y no se abre en los 2 s después del nuestro (SDL vería el cambio que
  acaba de hacer y lo pediría otra vez). El log: `[switch] mandos: …`.
- **Por probar en la consola:** que el mapeo por posición se aplique (si no, A/B cambiados), el stick del Joy-Con suelto
  (digital; analógico con `padGetStickPos` si hace falta) y el applet en los dos modos.
- **Pantalla táctil** (portátil): SDL la registra como dispositivo directo y la convierte en ratón; `plat_mouse` (nueva en
  `platform.h`) pasa el punto de la ventana a la pantalla del juego (también hacía falta en escritorio con la GPU: sin
  `SDL_Renderer` nadie lo escalaba). Tocar elige y pulsa como un clic; en Switch no cambia los iconos del mando por teclas
  (`browser.js`, `psKeys`).
- **Teclado del sistema** (swkbd): `ps.text_input(título, texto, máx., oculto)` → `plat_text_input`. `keyboard()` de
  `ui.js` (apodo, servidor, nombre y contraseña, amigo) lo usa si lo hay; si no (`undefined`), el suyo. Cancelar = `null`.
- Pendiente: vibración HD propia (hoy, la de SDL); el buscador de la Pokédex de escritorio no sale en Switch (va la de mando).

## Lo que pide libnx/newlib (Makefile.switch)
- `-ffp-contract=off`: GCC ignora `#pragma STDC FP_CONTRACT OFF` y en ARM fundiría a*b+c (FMA): el núcleo dejaría de dar lo
  mismo que el JS.
- `PLUTOVG_DISABLE_FONT_FACE_CACHE_LOAD` (no hay `sys/mman.h`; el juego carga sus fuentes con `load_from_file`).
- QuickJS: `malloc_usable_size(p)=0` y `tm_gmtoff=tm_isdst` (la hora local va en UTC por ahora).
- Pilas (08-11, el juego no arrancaba): `--wrap=main` lanza el juego en un hilo de 64 MB y `--wrap=pthread_create` da 4 MB a
  cada hilo sin tamaño pedido (QuickJS cree tener 4 MB / 2 MB). `-DWORKERS=2` hilos del suelo (cada uno carga el juego).
- El log empieza con `[switch] modo título|applet, memoria … MB`: en applet (desde el álbum) no cabe; abrirlo con R sobre un juego.
- Un cierre de verdad no llega al log: Atmosphère lo deja en `sdmc:/atmosphere/crash_reports/`.

## Red (fase 5)
- devkitPro trae curl 7.69 (sin WebSocket: llegó en el 7.86) y mbedTLS 2.28; libdatachannel pide mbedTLS 3. La imagen
  `pokesurvivor-switch` (`native/switch/Dockerfile`) compila **mbedTLS 3.6** (`/opt/mbed3`: entropía y reloj de la
  plataforma, sin `NET_C`/`TIMING_C`, con `SSL_DTLS_SRTP`) y **curl 8.11** encima (`/opt/curl8`: WebSocket; sin
  socketpair). Una sola mbedTLS en el binario.
- `platform/switch.c` da lo que piden: `mbedtls_hardware_poll` (`randomGet`), `mbedtls_ms_time`, `getifaddrs` (la IPv4 de
  la consola, `gethostid`: candidatos «host» de ICE) y `pipe` (dos UDP en 127.0.0.1: libjuice despierta su `poll`).
- `native/switch/include`: lo de BSD que libnx no trae para usrsctp/libjuice (`sys/uio.h`, `netinet/ip.h`,
  `netinet/in_systm.h`, `ifaddrs.h`, `endian.h`, `openssl/rand.h` → `randomGet`) y `usrsctp_switch.h` (`-include`:
  `ntohl`, `CMSG_ALIGN`, `UIO_MAXIOV`, `ERESTART`). La parte C++ con `-std=gnu++17` (newlib esconde lo de BSD con `c++17`).
- Actualizaciones: como en PS5 y escritorio, el `updater.js` de la web no corre (`boot.js`); el juego va en el `.nro`.
  Pendiente (si se quiere): avisar en el menú de que hay versión nueva.
- **Por probar en la consola:** entrar con la cuenta online (TLS con `cacert.pem` del romfs y la hora del sistema),
  ranking/amigos (WebSocket) y el cooperativo con la web (ICE: STUN de Google; NAT de la consola).

## Riesgos
- GLES de switch-mesa demasiado lento → deko3d (+1-2 semanas).
- libdatachannel no compila con libnx → sólo cooperativo local.
- QuickJS sin JIT en un A57 a 1 GHz: el JS de la partida ya va en C (`core/`); lo que quede caliente, también.
