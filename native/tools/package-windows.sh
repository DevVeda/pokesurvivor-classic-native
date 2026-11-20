#!/usr/bin/env bash
# Windows x86_64 (just windows), DENTRO del contenedor de native/windows/Dockerfile (MinGW-w64):
#   docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-windows bash native/tools/package-windows.sh
# → native/build/dist/windows/PokeSurvivor/ (PokeSurvivor.exe, un solo ejecutable estático, y el juego al lado: plat_root)
#   y native/build/dist/windows/PokeSurvivor-<VERSION>-<BUILD>-windows-x64.zip (la versión: el archivo VERSION de la raíz)
set -euo pipefail
N=$(cd "$(dirname "$0")/.." && pwd)
VER=$(tr -d ' \r\n' < "$N/../VERSION")
BUILD=$(tr -d ' \r\n' < "$N/../BUILD" 2>/dev/null || true); SLUG=$VER${BUILD:+-$BUILD}   # (nombre de archivo: versión y build, tools/apply-env.mjs)
OUT=$N/build/dist/windows D=$N/build/dist/windows/PokeSurvivor
make -C "$N" -f Makefile.desktop B=build/windows TARGET_OS=Windows \
     CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix AR=x86_64-w64-mingw32-ar -j"$(nproc)"
rm -rf "$OUT" && mkdir -p "$D"
cp "$N/build/windows/pokesurvivor.exe" "$D/PokeSurvivor.exe"
x86_64-w64-mingw32-strip "$D/PokeSurvivor.exe"
bash "$N/tools/stage-game.sh" "$D"
# @step desktop/win build "MinGW .exe"
# PokeSurvivor.exe estático, stage-game al lado y zip.
# @next dist
(cd "$OUT" && rm -f PokeSurvivor-*-windows-x64.zip && zip -qr "PokeSurvivor-$SLUG-windows-x64.zip" PokeSurvivor)
ls -la "$OUT"
