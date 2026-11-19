#!/usr/bin/env bash
# Copia lo que el juego necesita para correr (lo que lee plat_root()) a una carpeta:
#   shim/  vendor/firebase/  cacert.pem  update.seq  game/{index.html,version.json,VERSION,news.json,js/**.js,assets/{fonts,icons,pokemon,banner}}
# La usan el título de PS5 (title/build-title.sh), el .app de macOS y la AppImage de Linux (justfile).
#   native/tools/stage-game.sh <carpeta>
# @step platforms/stage build "stage-game.sh"
# Copia shim/, vendor/firebase, cacert.pem,
# game/{index.html,version.json,VERSION,news.json,js/**,assets} y licencias; escribe update.seq.
# @next runtime
# @step android/stage build "Juego en assets/ps"
# stage-game.sh dentro del APK, con update.seq.
# @next dex
set -euo pipefail
A=${1:?carpeta de destino}
N=$(cd "$(dirname "$0")/.." && pwd) S=$(cd "$N/.." && pwd)
mkdir -p "$A/shim" "$A/vendor" "$A/game/assets"
A=$(cd "$A" && pwd)   # (absoluta: la copia de js/ hace cd a la raíz; con una relativa, iba a <repo>/build/…)
cp "$N"/shim/*.js "$A/shim/"
cp -a "$N/vendor/firebase" "$A/vendor/"
[[ -f $N/vendor/cacert.pem ]] && cp "$N/vendor/cacert.pem" "$A/"
rm -rf "$A/game/dev.html" "$A/game/js"
cp "$S/index.html" "$S/version.json" "$S/VERSION" "$S/news.json" "$A/game/"   # (VERSION: la versión; news.json: Novedades)
(cd "$S" && find js -name '*.js' ! -path js/app.js | while IFS= read -r f; do mkdir -p "$A/game/${f%/*}"; cp "$f" "$A/game/$f"; done)
cp -a "$S/assets/fonts" "$S/assets/icons" "$S/assets/pokemon" "$S/assets/banner" "$A/game/assets/"
# Licencias y avisos con cada copia (PolyForm pide sus términos y el «Required Notice»; la GPL, su texto):
# las del juego en licenses/, la del motor (native/) como LICENSE-native y su NOTICE.
mkdir -p "$A/licenses"
cp "$S/LICENSE" "$S/LICENSE-NONCOMMERCIAL.md" "$S/CREDITS.md" "$A/licenses/"
cp "$N/LICENSE" "$A/licenses/LICENSE-native"; cp "$N/NOTICE.md" "$A/licenses/NOTICE-native.md"; cp "$N/LICENSE-EXCEPTION.md" "$A/licenses/LICENSE-EXCEPTION-native.md"
[[ -f $A/game/js/files.js &&-f $A/game/js/noframe.js ]] || { echo "stage-game: falta game/js en $A" >&2; exit 1; }
# El sello de este paquete para las actualizaciones (update.c): sólo se instala una publicada después (seq mayor).
# Sin él (just run, con los archivos del repo) no hay actualizaciones.
date +%s > "$A/update.seq"
echo "Juego: $(find "$A" -type f | wc -l | tr -d ' ') archivos, $(du -sh "$A" | cut -f1)"
