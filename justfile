# PokéSurvivor: compilar y publicar en cada plataforma desde la rama dev (native/CLAUDE.md, «Plataformas»).
#   just            la lista
#   just macos      .app            just linux     binario + AppImage (Steam Deck)    just windows   .zip con el .exe (Docker)
#   just android    APK (Docker)    just android-install   compilado, instalado y abierto en el teléfono (adb)
#   just ps5        título PS5      just ps5 <IP>            compilado y subido a la consola
set shell := ["bash", "-euo", "pipefail", "-c"]

ps5_port := env_var_or_default("PS5_PORT", "2121")   # el FTP de la PS5
ps5gpu := justfile_directory() / ".." / "ps5gpu"      # PS5_Vulkan y la salida del título (native/CLAUDE.md)
# @step publish/deploy net "wrangler deploy"
# Sube dist/live al Worker de LIVE_BASE (LIVE_WORKER) como assets; reemplaza todo lo anterior.
# @next livebase
live_worker := env_var_or_default("LIVE_WORKER", "proud-base-b2c0")   # el Worker de Cloudflare que sirve LIVE_BASE
pages_project := env_var_or_default("PAGES_PROJECT", "pokesurvivor-web")   # el proyecto de Cloudflare Pages de la web

default:
    @just --list --unsorted

# ---------------- escritorio ----------------

# macOS: native/build/dist/macos/PokeSurvivor.app (con dylibbundler, las librerías van dentro)
# @step platforms/macos platform "macOS .app"
# just macos → PokeSurvivor.app universal y zip.
# @sub desktop
# @next stage
# @next publish "binario"
# @step desktop/os decision "¿Qué SO?"
# Cada receta llama a su script de empaquetado.
# @next mk
macos: _env
    bash native/tools/package-macos.sh

# Linux x86_64: carpeta y AppImage (también Steam Deck) en native/build/dist/linux, compilado en Docker
# @step platforms/linux platform "Linux / Steam Deck"
# just linux → carpeta y AppImage (Docker).
# @sub desktop
# @next stage
# @next publish "binario"
# @step desktop/os
linux: _env
    docker build --platform linux/amd64 -t pokesurvivor-linux native/linux
    docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-linux bash native/tools/package-linux.sh

# Windows x86_64: carpeta y .zip en native/build/dist/windows (un .exe estático y el juego al lado), con MinGW en Docker
# @step platforms/windows platform "Windows .exe"
# just windows → .exe estático + zip (MinGW en Docker).
# @sub desktop
# @next stage
# @next publish "binario"
# @step desktop/os
windows: _env
    docker build --platform linux/amd64 -t pokesurvivor-windows native/windows
    docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-windows bash native/tools/package-windows.sh

# El servidor por defecto del build: js/env.js desde .env (sólo valores públicos; en .gitignore). Cada build lo regenera y
# lo mete en el juego. Se queda en el disco: la web local (python3 -m http.server) lo necesita. Sin .env, el build se para.
# @step publish/env build ".env → apply-env"
# Receta _env: apply-env.mjs lee .env, exige REQUIRED (Firebase, NAME_DOMAIN, ADMIN_UIDS, SITE_HOSTS)
# y valida URLs (ICE_URL, LIVE_BASE). Sin .env se para.
# @next haskey
# @step platforms/env build "_env previo"
# Todas las recetas dependen de _env: regeneran js/env.js desde .env.
# @next macos
# @next linux
# @next windows
# @next android
# @next switch
# @next ps5
# @next run
_env:
    node tools/apply-env.mjs

# Reemplaza TODO lo que había en el Worker (lo de live/*.json también va). La 1.ª vez: npx wrangler login.
# Publicar: firmar la actualización (tools/sign-update.mjs → dist/live/) y subirla al Worker de LIVE_BASE, con news.json
#   just web            sube a PAGES_PROJECT (por defecto pokesurvivor-web; la 1.ª vez: npx wrangler login)
#   just web --force    versión obligatoria (corta las partidas en curso)
# Web en Cloudflare Pages: huellas + version.json (los jugadores se actualizan solos) + dist/web, y subida
# @step publish/webhost build "just web → Pages"
# tools/build-web.mjs pone las huellas ?v= en index.html, escribe version.json (--force = obligatoria)
# y monta dist/web (sólo lo público, js/env.js incluido); wrangler pages deploy lo sube al proyecto
# PAGES_PROJECT.
# @next webupd "version.json"
web *args: (web-build args)
    npx wrangler pages deploy dist/web --project-name {{pages_project}} --branch main --commit-dirty=true

# Sólo prepara dist/web (probar: python3 -m http.server 8124 -d dist/web)
web-build *args: _env
    node tools/build-web.mjs {{args}}

# El núcleo de la partida en C (native/core/) para la web: native/shim/core.wasm (emscripten en Docker; core_wasm.c hace de
# core_js.c). Después de cambiar native/core/ o core_wasm.c: tools/build-web.mjs no publica con un core.wasm desfasado.
core-wasm:
    docker run --rm -v "$PWD/native":/src -v pokesurvivor-emcache:/emsdk/upstream/emscripten/cache -w /src emscripten/emsdk:3.1.74 \
      emcc -O2 -Icore core_wasm.c core/sim.c core/world.c core/combat.c core/pickup.c core/abil.c core/foe.c core/map.c core/data.c \
      --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=33554432 -sEXPORTED_FUNCTIONS=_malloc,_free -o shim/core.wasm
    node tools/build-web.mjs --wasm-stamp

# Probar la web en local con los cambios (sin subir nada ni tocar index.html/version.json): http://localhost:8124
# (js/app.js no está en git: se genera aquí y en just web)
web-local port="8124": _env
    node tools/app-js.mjs
    python3 -m http.server {{port}}

# ¿Algún secreto de .env en git, dist/live o los paquetes? (sólo imprime nombres; antes de cada release)
# @step publish/leak build "leak-check (manual)"
# Receta aparte, no encadenada a publish: busca secretos de .env en git, dist/live, native/build y el
# título PS5; sólo imprime nombres.
leak-check:
    node tools/leak-check.mjs

# Con los binarios de escritorio (después de just macos / windows / linux): just publish --native
# @step publish/sign build "Firmar manifiesto Ed25519"
# just publish → sign-update.mjs: copia shim/*.js y game/{index.html,VERSION,news.json,js/**}, assets
# en packs de ~2 MB, version.json con seq=segundos firmado en version.json.sig.
# @next natopt
publish *args: _env
    node tools/sign-update.mjs {{args}}
    npx wrangler deploy --config tools/wrangler.live.jsonc --name {{live_worker}}

# Probar en este ordenador con los archivos del repo, sin empaquetar (log: native/build/desktop/data/log.txt)
# @step platforms/run build "just run local"
# Escritorio con los archivos del repo, sin empaquetar: sin update.seq, sin actualizaciones.
run: _env
    make -C native -f Makefile.desktop run

# ---------------- Android ----------------

# Android (arm64-v8a, Android 7+): native/build/dist/android/PokeSurvivor-<VERSION>.apk, con el NDK en Docker
# @step platforms/android platform "Android APK"
# just android → APK arm64 (NDK en Docker).
# @sub android
# @next stage
# @step android/img build "Imagen Docker NDK"
# Construye pokesurvivor-android sólo si no existe.
# @next so
android: _env
    docker image inspect pokesurvivor-android > /dev/null 2>&1 || docker build --platform linux/amd64 -t pokesurvivor-android native/android
    docker run --rm --platform linux/amd64 -e ANDROID_KS_PASS -v "$PWD":/src -w /src pokesurvivor-android bash native/tools/package-android.sh

# Instalarlo en el móvil (USB con depuración, o el emulador) y abrirlo
# @step android/run platform "adb install/run"
# just android-run instala y abre la Activity.
# @next prep
android-run:
    adb install -r "native/build/dist/android/PokeSurvivor-$(tr -d ' \r\n' < VERSION).apk"
    adb shell am start -n com.devveda.pokesurvivor/.PokeSurvivorActivity

# Compilar el APK e instalarlo y abrirlo en el teléfono conectado (depuración USB activada)
android-install: android android-run

# Mandos virtuales en el emulador (cooperativo local sin mandos de verdad; native/android/vpad.c). Se manejan con
#   adb shell "echo '2 a 1' > /data/local/tmp/vpad.in"   (mando 2, A pulsado; '2 a 0' lo suelta, '2 lx 1' stick, '2 off')
android-pads n="2":
    docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-android bash -c 'aarch64-linux-android$API-clang -O2 -o native/build/android/vpad native/android/vpad.c'
    adb root && sleep 2 && adb wait-for-device
    adb push native/build/android/vpad /data/local/tmp/vpad
    adb shell 'chmod 755 /data/local/tmp/vpad; rm -f /data/local/tmp/vpad.in; mkfifo /data/local/tmp/vpad.in'
    adb shell /data/local/tmp/vpad {{n}} /data/local/tmp/vpad.in

# El log del juego en el móvil
android-log:
    adb shell cat /sdcard/Android/data/com.devveda.pokesurvivor/files/log.txt

# ---------------- Switch ----------------

# Switch (homebrew, libnx): native/build/switch/PokeSurvivor.nro, con devkitPro en Docker (native/SWITCH.md)
# @step platforms/switch platform "Switch .nro/.nsp"
# just switch → .nro (devkitPro); just switch-nsp → NSP.
# @sub switch
# @next stage
# @step switch/img build "Imagen devkitPro"
# Construye pokesurvivor-switch si no existe.
# @next elf
switch: _env
    docker image inspect pokesurvivor-switch > /dev/null 2>&1 || docker build --platform linux/amd64 -t pokesurvivor-switch native/switch
    docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src/native pokesurvivor-switch make -f Makefile.switch -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

# NSP instalable (DBI/Tinfoil) con las keys de tu consola (*.keys: en .gitignore, nunca en git) → native/build/switch/nsp
# @step platforms/switch
# @step switch/nspq decision "¿Hace falta NSP?"
# just switch-nsp necesita las prod.keys de la consola.
# @next nsp "sí"
switch-nsp keys="native/switch/prod.keys": switch
    docker build -q --platform linux/amd64 -t pokesurvivor-switch native/switch > /dev/null
    docker run --rm --platform linux/amd64 -v "$PWD":/src -v "$(realpath "$(eval echo {{keys}})")":/keys/prod.keys:ro -w /src/native pokesurvivor-switch bash tools/package-switch.sh /keys/prod.keys

# ---------------- PS5 ----------------

# Título «PokéSurvivor Classic Native» (PPSA77702) → ../ps5gpu/poke-title/dist, con todo el juego dentro (sprites
# incluidos: stage-game.sh); con IP, además se sube entero a la consola (el juego CERRADO en ella; ~13 600 archivos)
# @step platforms/ps5 platform "PS5 título + FTP"
# just ps5 [ip] → título y, con IP, subida por FTP.
# @sub ps5
# @next stage
# @step ps5/ipq decision "¿Se pasó IP?"
# Sin IP sólo compila; con IP push-title.sh (todo).
# @next push "sí"
ps5 ip="": _ps5-title
    {{ if ip == "" { "true" } else { "PS5_PORT=" + ps5_port + " PS5GPU='" + ps5gpu + "' native/title/push-title.sh " + ip } }}

# Desarrollo: subir el título ya compilado sin los sprites (FAST=1, sin Docker), cuando la consola ya los tiene y sólo
# cambian JS o shims
# @step ps5/jsonly build "ps5-push"
# Cambio sólo de JS/shims: sube el título ya compilado, sin Docker ni sprites.
# @next push
ps5-push ip:
    FAST=1 PS5_PORT={{ps5_port}} PS5GPU="{{ps5gpu}}" native/title/push-title.sh {{ip}}

# El log del título en la consola
ps5-log ip:
    curl -sS "ftp://{{ip}}:{{ps5_port}}/data/homebrew/PPSA77702/log.txt"

# Payload (eboot.elf, se lanza desde websrv): compilar y subir
payload ip:
    make -C native push PS5_HOST={{ip}} PS5_PORT={{ps5_port}}

# El log del payload
payload-log ip:
    make -C native log PS5_HOST={{ip}} PS5_PORT={{ps5_port}}

# @step ps5/img build "Imagen Docker"
# _ps5-title construye la imagen y monta ../ps5gpu y el repo.
# @next bt
_ps5-title: _env
    docker image inspect ps5title > /dev/null 2>&1 || docker build --platform linux/amd64 -t ps5title native/title
    docker run --rm --platform linux/amd64 -v "{{ps5gpu}}":/work -v "$PWD":/src ps5title bash /src/native/title/build-title.sh
    @just _ps5-zip

# El título, también en native/build/dist/ps5/PokeSurvivor-<VERSION>-ps5.zip (la carpeta <titleId>, con todo el juego
# dentro), como los paquetes de las demás plataformas: se descomprime en /data/homebrew/ de la consola.
_ps5-zip:
    #!/usr/bin/env bash
    set -euo pipefail
    id=$(grep -o '"titleId": *"[A-Z0-9]*"' native/title/hello/param.json | grep -o 'PPSA[0-9]*')
    out="$PWD/native/build/dist/ps5" zip="PokeSurvivor-$(cat VERSION)-ps5.zip"
    mkdir -p "$out" && rm -f "$out/$zip"
    (cd "{{ps5gpu}}/poke-title/dist" && zip -qr "$out/$zip" "$id")
    ls -lh "$out/$zip"

# ---------------- pruebas y herramientas ----------------

# Un cambio en el C común (main.c, canvas.c, net.c…) o en los shims no está hecho hasta que esto pase: lo de una
# plataforma puede romper otra (native/CLAUDE.md, «Normas»). Escritorio aquí; Linux, Windows, Switch y PS5 en Docker.
# Compilar TODAS las plataformas y el arnés (no sube nada; para en el primer fallo)
# @step platforms/check build "just check"
# _env + test y compila todas las plataformas; para en el primer fallo, no sube nada.
# @next test
# @next macos
# @next linux
# @next windows
# @next switch
# @next android
# @next ps5 "sin subir"
check: _env test
    make -C native -f Makefile.desktop -j8
    just linux
    just windows
    just switch
    just android
    just _ps5-title
    @echo "check: todas las plataformas compilan"

# Arnés de Node: las pantallas de mando (errores: 0) y el shim de red
# @step platforms/test build "just test"
# Arnés de Node: pantallas de mando (run-node.cjs) y prueba del shim de red.
test:
    node native/shim/run-node.cjs 88 ui | tail -3
    node native/shim/net.test.cjs
    node native/shim/web.test.cjs
    node native/shim/updater.test.cjs

# Núcleo en C: compilarlo en este ordenador y compararlo con el JS
core-test:
    make -C native core-test

# Regenerar core/data.c desde las fuentes de js/
export-core:
    node native/tools/export-core.cjs

# Bajar el SDK de Firebase y los certificados (una vez), y las fuentes de QuickJS y libdatachannel
deps:
    make -C native vendor
    make -C native webrtc-src
    make -C native -f Makefile.desktop quickjs-src

# Borrar lo compilado (native/build)
clean:
    rm -rf native/build
