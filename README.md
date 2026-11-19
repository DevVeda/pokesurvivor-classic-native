# PokéSurvivor Classic Native

Fork de [PokéSurvivor](https://pokesurvivor.com), el bullet-heaven con Pokémon de **Jonathan Piera Torregrosa
(JPTER78)**, llevado a más plataformas con un solo código: **web, Windows, macOS, Linux (y Steam Deck),
Android, Nintendo Switch y PS5**. Proyecto de fan, gratis y sin ánimo de lucro.

*A fan-made fork of PokéSurvivor by JPTER78, ported to web, desktop, Android, Switch and PS5 from a single
codebase. Free and non-commercial. Licenses below.*

> **Autoría del juego / Game authorship**
>
> El juego original (su código y su música) lo escribió y es de **Jonathan Piera Torregrosa (JPTER78)**,
> dueño de pokesurvivor.com. Este fork **no es la web oficial** ni está hecho por él.
> The original game (code and music) is written and owned by **Jonathan Piera Torregrosa (JPTER78)**.
> This fork is **not** the official site and is not made by him.

> **Sin criptomonedas / No crypto**: ni este fork ni el juego tienen criptomoneda, token ni NFT. Cualquiera
> que use el nombre es de terceros. *Neither this fork nor the game has any coin, token or NFT.*

## Qué añade este fork

- **Las mismas pantallas en todas las plataformas** (`native/shim/ui.js`), pensadas para mando, teclado,
  ratón y dedo; la web también las usa.
- **La partida simulada en C** (`native/core/`), también en la web (WebAssembly), con **cooperativo local**
  de hasta 4 jugadores en la misma pantalla.
- **Versiones nativas** con QuickJS, PlutoVG y SDL2 (`native/`): GPU (OpenGL / Vulkan en PS5), audio propio,
  red (Firebase por HTTPS y WebSocket) y cooperativo online por WebRTC.
- **Actualizaciones firmadas** (Ed25519) para las versiones nativas.
- **Servidor propio**: cualquiera puede montar el suyo (Firebase en plan gratuito) y el jugador puede cambiar
  de servidor y llevarse su partida.

## Compilar

Hace falta [just](https://github.com/casey/just), Node.js y Docker (para Linux, Windows, Android y Switch).
Copia `env.example` a `.env` y rellénalo con los datos de tu servidor (nunca subas `.env`).

| Comando | Qué hace |
|---|---|
| `just web-local` | La web, en `http://localhost:8124` |
| `just run` | El juego de escritorio con los archivos del repositorio |
| `just macos` · `just linux` · `just windows` | Paquetes de escritorio |
| `just android` · `just switch` · `just ps5 <IP>` | Paquetes de móvil y consolas |
| `just test` | El arnés de las pantallas y las pruebas de los shims |
| `just check` | Compila todas las plataformas y pasa las pruebas |

Las versiones de consola son homebrew: necesitan una consola preparada para ello. Este repositorio **no
incluye** claves, firmware ni nada de Sony o Nintendo: cada uno pone lo suyo (abajo) y nada de eso se sube a git.

### Qué necesita cada plataforma

Para todas: `.env` (desde `env.example`) y, una vez, `just deps` (baja el SDK de Firebase, QuickJS y libdatachannel).

| Plataforma | Qué hace falta | Dónde va |
|---|---|---|
| Web | Nada más | — |
| macOS | `brew install sdl2 openssl@3 curl` | — |
| Linux, Windows | Docker (se compilan en contenedores) | — |
| Android | Docker. Una clave de firma: la primera vez se crea sola | `native/android/pokesurvivor.keystore`, con la contraseña de `ANDROID_KS_PASS` (sin ella, `pokesurvivor`). **Guárdala**: con otra clave, el APK no se instala encima del anterior |
| Switch (`.nro`) | Docker (devkitPro va en la imagen) | — |
| Switch (`.nsp`, `just switch-nsp`) | Las `prod.keys` **de tu consola** (se sacan con Lockpick_RCM) | `native/switch/prod.keys` (o `just switch-nsp keys=<ruta>`) |
| PS5 (título, `just ps5`) | [PS5_Vulkan](https://github.com/mihawk-99/PS5_Vulkan) clonado y compilado (su `tools/bootstrap`), y Docker | `../ps5gpu/PS5_Vulkan`, al lado de este repositorio (o la ruta en `PS5GPU`). El título sale en `../ps5gpu/poke-title/dist` y empaquetado en `native/build/dist/ps5/PokeSurvivor-<versión>-ps5.zip` (se descomprime en `/data/homebrew/`); `just ps5 <IP>` lo sube por FTP (puerto 2121) con el juego cerrado en la consola |
| PS5 (payload, `just payload <IP>`) | El SDK de [ps5-payload-dev](https://github.com/ps5-payload-dev) y LLVM 18 (`brew install llvm@18`) | `~/ps5-payload-dev/opt/ps5-payload-sdk` (o `PS5_PAYLOAD_SDK`) |

Lo que es tuyo y privado (`.env`, `*.keys`, `*.keystore`) ya está en `.gitignore`.

## Controles

| Teclado | Mando | Acción |
|---|---|---|
| `W` `A` `S` `D` / flechas | Stick / cruceta | Moverse |
| `1`–`4`, `Q` / `E` | L / R | Elegir o cambiar de movimiento |
| `Esc` / `P` | Start / Options | Pausa |
| `Enter` / `Esc` | ✕ / ○ (A / B) | Confirmar / volver |

Con el dedo: arrastra en cualquier sitio para moverte y toca los ataques o la pausa.

## Licencias

- **El juego** (`js/`, `css/`, `index.html`, `tools/` y la música): © JPTER78, bajo
  [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md) (las versiones hasta el commit `b297089`, MIT).
  Se puede usar, estudiar, modificar y compartir **sin fines comerciales**. Ver [LICENSE](LICENSE).
  `Required Notice: Copyright 2026 JPTER78 (https://github.com/JPTER78/pokesurvivor)`
- **El motor nativo** (`native/`): GPL-3.0-or-later ([native/LICENSE](native/LICENSE),
  [native/NOTICE.md](native/NOTICE.md)), con un permiso adicional para distribuirlo junto al juego sin que el juego
  pase a ser GPL ([native/LICENSE-EXCEPTION.md](native/LICENSE-EXCEPTION.md)). Carga el juego como datos, igual que un navegador.
- **Sprites**: [SpriteCollab](https://github.com/PMDCollab/SpriteCollab), CC BY-NC 4.0; artistas en
  [CREDITS.md](CREDITS.md). Fuente Pixelify Sans (OFL).
- **Pokémon** es propiedad de Nintendo, Creatures Inc. y GAME FREAK. Este proyecto no está afiliado,
  patrocinado ni aprobado por ellos.

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) y, para fallos de
seguridad, [SECURITY.md](SECURITY.md).
