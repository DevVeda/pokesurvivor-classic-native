# PokéSurvivor nativo (PS5)

El juego de la web, **el mismo código JS sin cambios**, corriendo nativo en una PS5 con jailbreak.
La vía del navegador de la PS5 se descartó con `tools/ps5`:
- no hay Gamepad API, Web Audio ni WebRTC;
- el canvas va lento;
- es fácil salirse del juego sin querer.

## Cómo está hecho
| Pieza | Qué hace |
|---|---|
| `main.c` | QuickJS (el motor de JS), el DualSense (SDL2), la salida de vídeo propia (VideoOut: escala ×2 y pasa al formato de mosaico en una pasada) y el bucle |
| `canvas.c` | El `CanvasRenderingContext2D` en C sobre [PlutoVG](third_party/plutovg): trazados, texto, degradados, transformaciones y recortes. Los sprites van por un blit propio |
| `shim/browser.js` | El navegador mínimo: `window`/`document`, elementos falsos, `<canvas>`, `Image`, `localStorage` en archivo, temporizadores y el DualSense como mando «standard» (así `js/core/gamepad.js` funciona tal cual) |
| `shim/canvas.js` | El objeto `ctx` que ve el juego, sobre `ps.cv_*` |
| `shim/boot.js` | Carga los scripts en el orden de `dev.html` y, mientras no hay menús para mando, entra directo a una partida de invitado |
| `net.c`, `webrtc.c` | HTTPS y WebSocket (libcurl) y WebRTC del cooperativo (libdatachannel); `shim/net.js` pone encima `fetch`, `XMLHttpRequest`, `WebSocket` y `RTCPeerConnection` |
| `shim/run-node.cjs` | Prueba en el Mac: el juego con los shims en Node, sin dibujar. Sale con error si hay errores de JS |

Se dibuja a 960×540 (el juego cree que la pantalla es de 1920×1080 con `devicePixelRatio` 0,5) y se escala ×2 al presentar.
Medido con el banco de pruebas: 60 fps con 1000 sprites y 57 con 4000.

**Sin GPU:** en un payload, `libSceAgc` no da la GPU. Para tenerla habría que hacer un título, ver [TITLE.md](TITLE.md).

## Plan
1. ✅ La base: QuickJS, DualSense, salida de vídeo y medidas.
2. ✅ El canvas del juego (PlutoVG) y el navegador mínimo. La partida corre en Node sin errores.
3. **Ahora**: la partida en la consola. Probar, mirar el `log.txt` y corregir lo que se vea mal.
4. Menús para mando: la interfaz es HTML y en la PS5 no se ve. Hay que dibujarla.
5. Sonido (Web Audio → SDL o `sceAudioOut`), partidas guardadas con cuenta local.
6. Red: Firebase por REST y el cooperativo (WebRTC nativo con el mismo protocolo que `js/net`).
7. Título con icono propio (ShadowMount+), RADV si hace falta, y actualización con `version.json`.

## Compilar y probar
Hace falta el SDK con las librerías de ps5-payload-dev ya compiladas (los Makefiles lo buscan en `~/ps5-payload-dev/opt/ps5-payload-sdk`):

```sh
brew install llvm@18
curl -LO https://github.com/ps5-payload-dev/pacbrew-repo/releases/download/v0.41.1/ps5-payload-dev.tar.gz
mkdir -p ~/ps5-payload-dev && tar xzf ps5-payload-dev.tar.gz -C ~/ps5-payload-dev

make -C native vendor webrtc-src      # una vez: SDK de Firebase, certificados y código de libdatachannel (cooperativo)
node native/shim/run-node.cjs 10      # antes de subir: ¿corre sin errores?
make -C native sprites                # la primera vez: todo, sprites incluidos (13 500 archivos)
make -C native push                   # después: el ejecutable, los shims y el JS (sin sprites)
```

En la PS5: lanzador de websrv → **PokeSurvivorNative**. Mantener **Create 2 s** para salir (Options es la pausa del juego).
Si algo falla: `make -C native log`.

## Licencia
`native/` es GPL-3.0-or-later ([NOTICE.md](NOTICE.md)). El juego (`js/`…) mantiene su licencia: el motor lo carga como datos.
