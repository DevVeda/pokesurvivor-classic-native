# PokéSurvivor como título de PS5 con GPU

Investigación del 25-10-2026, sin probar todavía en la consola. Consola: FW 13.60 (Relapse), ShadowMount+.

## Por qué un título y no un payload
`eboot.elf` (lanzado desde websrv) es un **payload**, y `libSceAgc` no le da la GPU:

```
[Agc] FS Table offset has shifted. This is not survivable.
radv/ps5: sceAgcInit(8) failed: 0x8a6c002f
```

RUFFLE5 se encontró lo mismo con *todos* los lanzadores de payloads. La GPU sólo se consigue en un **título**:
- una carpeta `PPSAxxxxx` en `/data/homebrew` con un `eboot.bin` firmado (FSELF), que ShadowMount+ monta como juego;
- el driver de Vulkan (RADV) **enlazado dentro del ejecutable**.

## Quién lo hace ya (y en qué firmware)
| Proyecto | Qué | Relevancia |
|---|---|---|
| [PSXS5](https://github.com/SynoPiia/PSXS5) | Emulador de PS1 en C, Vulkan sobre RADV | **Se desarrolla en 13.60.** Es la referencia más cercana: C, boilerplate, RADV publicado ya compilado |
| [PS5_Vulkan](https://github.com/mihawk-99/PS5_Vulkan) | RADV para PS5 (Mesa 26.2 + winsys PS5) | El driver que usan todos; pasa el CTS de Vulkan 1.4 en consola |
| [PS5_VulkanTemplate](https://github.com/mihawk-99/PS5_VulkanTemplate) | Plantilla de títulos: arranque, mando (vibración, barra de luz), sonido, pantalla, salida | La base que el autor recomienda para títulos nuevos |
| PS5_RetroArch, PS5_vkQuake (mihawk-99) | Juegos y emuladores en RADV | vkQuake a 119,88 fps |
| [RUFFLE5](https://github.com/TheUnwelcomed/RUFFLE5) | Ruffle (Flash) como título | Documenta el muro de los payloads y las restricciones de título |
| ps5-native-app-boilerplate (BlackBearReloaded) | Compilación, enlazado, conversión a módulo, firma FSELF, carpeta PPSA | En lo que se basan PSXS5 y Jelly5 |

## Lo que necesita la consola (13.60)
- **kstuff-lite 1.11** cargado después del jailbreak. Es lo que permite ejecutar FSELF; la 1.11 dice soportar 1.00–13.60.
- **ShadowMount+** en cada arranque.
  - La guía comunitaria de 13.60 ([ps5-fw1360](https://github.com/cliffjohnson860/ps5-fw1360)) usa la 1.7beta3.
  - ps5link-sdk avisa de que la 1.7alpha13fix1 no lee bien `param.json`.
- La carpeta del título en `/data/homebrew/PPSAxxxxx/`, con **permisos 777**. Sin ellos sale CE-107750-0 (lo dice PSXS5).
- Para que el título escriba fuera de su carpeta (`/data`) hace falta un servicio de jailbreak: LegacyJB 1.2.1 o el puerto 9028 de etaHEN. Sin él, el título queda en su sandbox. Para guardar partidas en su propia carpeta no hace falta.
- La guía de 13.60 desaconseja etaHEN 2.5B salvo que se verifique en ese firmware. Hay que mirar qué cadena usas ahora.

## Lo que necesita el Mac
Todas estas herramientas son **Linux x86-64**: PSXS5 usa Ubuntu 24.04 o WSL; PS5_Vulkan, Arch/CachyOS. El conversor y firmador viene como binario estático de Linux. En el Mac M4 la forma práctica es Docker con `--platform linux/amd64`, que corre emulado y es más lento pero funciona:

```sh
docker run --rm -it --platform linux/amd64 -v "$PWD":/src -w /src ubuntu:24.04 bash
apt-get update && apt-get install -y clang-18 lld-18 llvm-18 make ninja-build python3 zstd git curl
```

RADV no hace falta compilarlo, porque PSXS5 publica el archivo compilado:
- release [`deps-radv-7b59ef27`](https://github.com/SynoPiia/PSXS5/releases/tag/deps-radv-7b59ef27) (06-10-2026);
- `radv-release.tar.zst` (53 MB) y `ps5-payload-sdk.tar.zst` (6 MB, la capa `libps5platform.a` que RADV necesita).

La alternativa es compilarlo con `PS5_Vulkan/tools/build-radv.sh release`, que tarda bastante (es Mesa).

## Restricciones de un título y qué choca con `native/main.c`
De RUFFLE5 y PSXS5:

| Regla del título | En nuestro ejecutable actual | Qué hacer |
|---|---|---|
| Sin instrucciones `syscall` directas: la consola mata el proceso | El SDK de payloads y su `libc.a` las usan en algunas funciones | El boilerplate tiene su propio enlazado y CRT |
| Sin `dlopen` del SDK de payloads | El SDL2 de pacbrew carga Mesa con `dlopen` | **Quitar SDL2.** Pantalla con Vulkan; mando y sonido con `scePad` / `sceAudioOut` directos, o con la base de PS5_VulkanTemplate |
| Las importaciones sólo se resuelven contra librerías cargadas; una desconocida pasa a NULL **en silencio** | — | Comprobar la tabla de importaciones al arrancar (lo hacen RUFFLE5 y PSXS5) |
| Sin TLS (`__thread`) | QuickJS no usa: **comprobado** en `libquickjs.a` (sin `.tbss` / `.tdata`) | Nada. `quickjs-libc.o` sí usa `dlopen`/`opendir`/`pthread_create`, pero no lo usamos |
| `opendir` denegado (usar `getdents`); `getcwd` y `realpath` raros | No los usamos | — |
| `sceNetInit()` antes del primer socket; sockets no bloqueantes con `setsockopt(SOL_SOCKET, 0x1200)` | Más adelante (Firebase, cooperativo) | Tenerlo en cuenta al hacer la red |
| `--no-dynamic-linker` al enlazar RADV | — | Usar la línea de enlazado del boilerplate o `radv-link.sh` |
| Cargar imágenes sin SDL2_image | Usamos `IMG_Load` | `stb_image.h` (lo usa PSXS5) |

Lo que se conserva tal cual: **QuickJS**, la API `ps.*` para el JS y todo el JS del juego. Cambia lo que hay debajo: el dibujo pasa a Vulkan y el mando y el sonido a llamadas directas.

## Licencia: decidirlo antes de copiar nada
**El boilerplate, PSXS5, PS5_Vulkan y PS5_VulkanTemplate son GPL-3.0.**
- Si el título copia o enlaza su código (la CRT, el conversor, la plantilla), el `eboot.bin` queda bajo GPL-3.0 y hay que publicar el código del título con esa licencia.
- Usar sus herramientas **como programas** (convertir, firmar) no contagia la licencia.
- RADV y Mesa son MIT, así que enlazarlos no impone nada.

PokéSurvivor tiene su propia licencia (`LICENSE`, `LICENSE-NONCOMMERCIAL.md`), así que esto lo decide el dueño:
- **(a)** aceptar GPL-3.0 sólo para la parte nativa de PS5 (`native/`);
- **(b)** usar las herramientas sólo como programas y escribir nuestra propia CRT y base. Es más trabajo.

## Plan mínimo: «hola GPU»
1. Contenedor Ubuntu 24.04 amd64 con clang-18 y lld-18. Con el `tools/setup-native-dependencies.sh` del boilerplate: SDK v0.42 + `libps5platform.a`.
2. Descargar el RADV ya compilado de PSXS5.
3. Un `main.c` de título, unas 150 líneas:
   - instancia de Vulkan, dispositivo RADV, superficie `VK_KHR_display`, swapchain a 1920×1080;
   - limpiar la pantalla a un color que cambia con el tiempo;
   - salir al pulsar ✕, leyendo el mando con `scePad`.
4. Enlazar con la receta del boilerplate y `--no-dynamic-linker`, convertir a módulo y firmar FSELF → `eboot.bin`.
5. Carpeta `PPSA9xxxx/`:
   - `eboot.bin`, `sce_sys/param.json` (con `applicationCategoryType` 0 y `contentBadgeType` 1 sale en la fila de juegos) y `sce_sys/icon0.png`;
   - subir por FTP a `/data/homebrew/` y dar permisos 777.
6. Si se ve el color y ✕ sale del título, la ruta funciona. Después: un lote de sprites en Vulkan detrás de `ps.draw` / `ps.fillRect`, y QuickJS dentro.

**Coste estimado:** el paso 6 es lo difícil (días). Lo demás es montar las herramientas, que ya funcionan en otros proyectos en 13.60.

## Mientras tanto, en el payload
La misma investigación explica por qué presentar nos cuesta ~26 ms con SDL. PSXS5 (`src/platform/ps5_video.c`) dice:
- el SDL de pacbrew escribe en la memoria de vídeo (en mosaico y con escritura combinada) **en orden disperso**, y eso cuesta unos 14 ms por fotograma a 1080p;
- recorrer la memoria en orden y leer de nuestro búfer con una tabla inversa lo hace mucho más barato.

En el payload podemos abrir `sceVideoOut` nosotros mismos, con tres búferes, y escalar ×2 en esa misma pasada. Es independiente del título, se puede hacer ya, y cuando haya título se sigue usando como alternativa sin GPU. Hay que escribirlo de nuevo, sin copiar el de PSXS5, porque es GPL-3.0.
