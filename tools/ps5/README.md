# Prueba de PS5

Sirve para saber qué trae el WebKit de la PS5 (13.60 con jailbreak) antes de
decidir cómo portar el juego. No toca el juego ni la web.

- [websrv](https://github.com/ps5-payload-dev/websrv), un servidor web que corre en la consola, sirve los archivos desde `/data/homebrew/PokeSurvivor`.
- `install/install.elf` instala un título **PokeSurvivor** con icono propio en el inicio.
  - Es como el «Homebrew Launcher» de websrv: un `param.json` con `deeplinkUri` que la consola abre como app, sin barra de navegador.
  - Se abre en `probe.html` (el diagnóstico). Desde ahí, **Abrir juego completo** (o Options en el mando) entra en `game/index.html`.
- `homebrew.js` sólo sirve para lanzar `install.elf` desde el lanzador de websrv.
  - websrv ejecuta esos scripts en un iframe aislado que no puede abrir otras páginas.

## 1. Compilar install.elf (una vez, en el Mac)
```sh
brew install llvm@18
curl -LO https://github.com/ps5-payload-dev/sdk/releases/latest/download/ps5-payload-sdk.zip
unzip -d ~ ps5-payload-sdk.zip
export LLVM_CONFIG=/opt/homebrew/opt/llvm@18/bin/llvm-config PS5_PAYLOAD_SDK=~/ps5-payload-sdk
make -C tools/ps5/install
```
`make` mete en la URL de inicio la IP del Mac para el informe (`REPORT=http://IP:8787` para cambiarla).

## 2. Pasarlo a la consola
`tools/ps5/push.sh <IP-de-tu-PS5>` (por FTP, puerto 2121). `--solo-prueba` sube sin el juego.
También vale copiar a mano a `/data/homebrew/PokeSurvivor`:

```
probe.html  homebrew.js  install.elf  sce_sys/icon0.png  game/…
```
`install.elf` busca todo en `/data`, así que **no sirve dejarlo en el USB**.

## 3. Instalar el icono
Con websrv cargado, elige una de las dos formas:
- Lanzador de websrv → PokéSurvivor.
- Desde el Mac, con elfldr en el puerto 9021: `nc -w1 <IP-de-tu-PS5> 9021 < tools/ps5/install/install.elf`.

Sale el aviso «PokeSurvivor instalado». Volver a lanzarlo sólo reescribe la URL.
Para quitarlo, se borra desde el inicio como cualquier juego.

## 4. Probar
1. En el Mac, `node tools/ps5/probe-recv.cjs`.
2. En la PS5, abrir el icono **PokeSurvivor** (websrv tiene que estar cargado).
   - Esperar unos 15 s.
   - Pulsar todos los botones del DualSense, **Probar vibración** y **Enviar informe**.
   - El informe queda en `tools/ps5/probe-report-*.json`.
3. **Abrir juego completo**: jugar una partida corta.
   - Sin nube, porque `127.0.0.1` no está en `HOSTS` de `js/core/db.js`.

## Qué decide cada resultado
- **¿Se ve como app y no como navegador?** Si sí, el diseño 1 (app con WebKit) vale.
- **Gamepad API y mapping "standard"**: si los dos salen bien, el mando funciona sin cambiar nada.
  - Si no hay Gamepad API, ¿llegan teclas o cursor? → hace falta el puente nativo (`scePad`).
- **`?.`, campos de clase, `#privados`**: si alguno sale NO, `app.min.js` no arranca y `build.js` necesitaría una versión transpilada.
- **WebRTC STUN + DataChannel**: si los dos salen bien, el cooperativo funciona tal cual. Si no, hace falta libdatachannel nativo.
- **Firebase SDK 13 / localStorage / indexedDB**: decide si sirven la nube y las partidas guardadas.
- **Canvas 2D 1000/3000 sprites ≥ 55 fps**: el rendimiento de la partida.
