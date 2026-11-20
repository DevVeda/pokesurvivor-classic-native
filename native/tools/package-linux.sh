#!/usr/bin/env bash
# Linux x86_64 y la AppImage (Steam Deck), DENTRO del contenedor de native/linux/Dockerfile (just linux):
#   docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-linux bash native/tools/package-linux.sh
# → native/build/dist/linux/pokesurvivor/ (carpeta: bin/ y share/pokesurvivor/) y native/build/dist/linux/PokeSurvivor-<VERSION>-x86_64.AppImage
set -euo pipefail
N=$(cd "$(dirname "$0")/.." && pwd) S=$(cd "$N/.." && pwd)
VER=$(tr -d ' \r\n' < "$S/VERSION")   # (la versión: el archivo VERSION de la raíz)
BUILD=$(tr -d ' \r\n' < "$S/BUILD" 2>/dev/null || true); SLUG=$VER${BUILD:+-$BUILD}   # (nombre de archivo: versión y build, tools/apply-env.mjs)
OUT=$N/build/dist/linux D=$N/build/dist/linux/AppDir
make -C "$N" -f Makefile.desktop B=build/linux CC=gcc CXX=g++ -j"$(nproc)"
rm -rf "$OUT" && mkdir -p "$D/usr/bin" "$D/usr/share/pokesurvivor"
cp "$N/build/linux/pokesurvivor" "$D/usr/bin/pokesurvivor"
bash "$N/tools/stage-game.sh" "$D/usr/share/pokesurvivor"   # (plat_root: ../share/pokesurvivor desde bin/)
cat > "$OUT/pokesurvivor.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=PokéSurvivor
Exec=pokesurvivor
Icon=pokesurvivor
Categories=Game;
DESK
cp "$S/assets/icons/icon-512.png" "$OUT/pokesurvivor.png"
cp -a "$D" "$OUT/pokesurvivor"   # (la carpeta tal cual, sin AppImage)
# @step desktop/lnx build "Docker gcc Linux"
# make con gcc, stage-game en AppDir.
# @next appimg
# @step desktop/appimg build "AppImage"
# linuxdeploy mete las librerías y genera PokeSurvivor-<VER>-<BUILD>-x86_64.AppImage.
# @next dist
cd "$OUT" && linuxdeploy --appdir "$D" -d pokesurvivor.desktop -i pokesurvivor.png --output appimage
rm -f "$OUT"/PokeSurvivor-*-x86_64.AppImage   # (los de otros builds)
mv "$OUT"/PokéSurvivor*.AppImage "$OUT/PokeSurvivor-$SLUG-x86_64.AppImage" 2> /dev/null || true
ls -la "$OUT"
