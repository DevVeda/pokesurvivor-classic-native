# Licencia de native/

Todo lo que hay en `native/` (el motor nativo para PS5) es **GPL-3.0-or-later** (`native/LICENSE`):
usa código derivado de [PSXS5](https://github.com/SynoPiia/PSXS5) (GPL-3.0-or-later) y se
enlaza con herramientas y plantillas GPL de la escena de PS5.

**El juego no**: `js/`, `css/`, `index.html`… siguen bajo la licencia de PokéSurvivor (`LICENSE`,
PolyForm Noncommercial), y los sprites bajo CC BY-NC 4.0 (`CREDITS.md`). El motor los carga y
ejecuta como datos, igual que un navegador; por eso el juego no va compilado dentro del
ejecutable. Mantener esa separación: nada del juego dentro de `native/*.c`.

Además, para el código de DevVeda hay un **permiso adicional de la GPL** (sección 7) que permite distribuir el
motor junto al juego sin que el juego pase a ser GPL: [`LICENSE-EXCEPTION.md`](LICENSE-EXCEPTION.md).

## De terceros, dentro del ejecutable o al lado

- **QuickJS** (MIT), **PlutoVG** (MIT, `third_party/plutovg`), **SDL2** (zlib): el motor.
- **libcurl** (licencia curl, tipo MIT) y **OpenSSL** (Apache-2.0): HTTPS y WebSocket (`net.c`), del SDK de PS5.
- **SDK de Firebase para la web 13.0.0** (Apache-2.0, Google): `vendor/firebase/`, sin cambios; es el mismo que
  carga la web desde gstatic (`js/core/db.js`). Se baja con `make -C native vendor`.
- **Certificados raíz** (`vendor/cacert.pem`, de Mozilla vía el sistema; MPL-2.0): para comprobar HTTPS.
- **libdatachannel 0.22.5** (MPL-2.0, Paul-Louis Ageneau) con **libjuice** (MPL-2.0), **usrsctp** (BSD-3-Clause)
  y **plog** (MIT): WebRTC del cooperativo (`webrtc.c`), sin cambios. Se baja con `make -C native webrtc-src`
  (`third_party/libdatachannel`, fuera del repositorio) y se compila con el Makefile (`build/libdatachannel.a`).
