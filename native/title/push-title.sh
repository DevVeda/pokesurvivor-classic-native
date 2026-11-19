#!/bin/sh
# Sube el título compilado (native/title/build-title.sh) a /data/homebrew/<titleId de native/title/hello/param.json> y le pone permisos 777
# (sin ellos, CE-107750-0). Después ShadowMount+ lo registra y sale "PokéSurvivor Classic Native" en el inicio.
#   native/title/push-title.sh [IP-PS5]            todo (la primera vez: ~13 600 archivos, como make sprites)
#   FAST=1 native/title/push-title.sh [IP-PS5]     sin los sprites (game/assets/pokemon), como make push
#   PS5_PORT: el del FTP (2121). (justfile: just ps5 IP)
# @step ps5/push net "push-title.sh FTP"
# curl FTP (puerto 2121) a /data/homebrew/<ID>; FAST omite sprites. 550 = juego abierto.
# @next chmod
set -eu
PS5=${1:-${PS5_HOST:?falta la IP de la PS5: push-title.sh <IP> (o PS5_HOST)}}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SRC=${PS5GPU:-$REPO/../ps5gpu}/poke-title/dist   # (ps5gpu, al lado del repo)
FTP="ftp://$PS5:${PS5_PORT:-2121}/data/homebrew"
PARAM=$REPO/native/title/hello/param.json
ID=$(grep -o '"titleId": *"[A-Z0-9]*"' "$PARAM" | grep -o 'PPSA[0-9]*')
[ -d "$SRC/$ID" ] || { echo "Falta $SRC/$ID: compílalo antes con Docker (native/CLAUDE.md)."; exit 1; }
cd "$SRC"
# Los shims y el JS del juego, siempre los del repo: un cambio sólo de JS no necesita volver a compilar en Docker.
cp "$REPO"/native/shim/*.js "$ID/shim/"
# El juego: index.html, js/env.js y las fuentes de js/ sueltas (boot.js; js/app.js es de la web, no se sube); fuera el dev.html.
rm -rf "$ID/game/dev.html" "$ID/game/js"
(cd "$REPO" && cp index.html version.json VERSION news.json "$SRC/$ID/game/" && find js -name '*.js' ! -path js/app.js | while IFS= read -r f; do mkdir -p "$SRC/$ID/game/${f%/*}"; cp "$f" "$SRC/$ID/game/$f"; done)
CFG=$(mktemp "${TMPDIR:-/tmp}/ppsa.XXXXXX")
trap 'rm -f "$CFG" "$CFG".part.*' EXIT
files() { if [ -n "${PERMS:-}" ]; then :; elif [ -n "${FAST:-}" ]; then find "$ID" -type f ! -path "$ID/game/assets/pokemon/*"; else find "$ID" -type f; fi; }
files | while IFS= read -r f; do printf 'upload-file = "%s"\nurl = "%s/%s"\n' "$f" "$FTP" "$f"; done > "$CFG"
n=$(grep -c '^url' "$CFG" || true)
echo "Subiendo $n archivos..."
# Por tandas (cada una, un curl que reutiliza la conexión), como make push.
split -l 1000 "$CFG" "$CFG.part."
done=0
[ "$n" -gt 0 ] && for p in "$CFG".part.*; do
  # @step ps5/push
  curl -sS --fail --fail-early --ftp-create-dirs --disable-epsv --connect-timeout 5 -K "$p" ||
    { echo "La subida falló. Si dice 550, cierra PokéSurvivor Classic en la PS5 (no deja cambiar eboot.bin abierto) y repite."; exit 1; }
  done=$((done + $(grep -c '^url' "$p"))); echo "  $done / $n"
done
# Permisos: las carpetas y lo de primer nivel (eboot, sce_sys, sce_module); lo de dentro lo lee el propio título.
# (Sin las carpetas vacías: el FTP no las crea, su CHMOD da 550 y curl ya no hace los demás.)
# PERMS=1 native/title/push-title.sh: sólo los permisos, sin subir nada.
# @step ps5/chmod net "SITE CHMOD 777"
# Permisos y ShadowMount+ registra el título.
{ find "$ID" -type d ! -empty; find "$ID" -maxdepth 2 -type f; } | while IFS= read -r f; do printf -- '-Q "SITE CHMOD 777 /data/homebrew/%s"\n' "$f"; done > "$CFG"
curl -sS --disable-epsv -K "$CFG" "$FTP/" > /dev/null || echo "Aviso: no se pudieron poner permisos 777 por FTP; ponlos con el explorador de archivos de la consola."
echo "Hecho: /data/homebrew/$ID · el log del título: curl -sS $FTP/$ID/log.txt"
