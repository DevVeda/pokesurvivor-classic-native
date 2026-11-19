#!/bin/sh
# Pasa la prueba de PS5 (y el juego ya compilado) a la consola, a la carpeta
# homebrew/PokeSurvivor que lee websrv. Ver tools/ps5/README.md.
#   tools/ps5/push.sh IP-DE-LA-PS5 [opciones]    por FTP (ftpsrv, puerto 2121) a /data/homebrew
#   tools/ps5/push.sh /Volumes/USB [opciones]    a un USB (exFAT): queda en USB/homebrew
#     (install.elf busca todo en /data/homebrew/PokeSurvivor: desde el USB hay que copiarlo allí)
# Sin opciones: diagnóstico + juego sin sprites (~120 archivos).
#   --sprites       también assets/pokemon (13 500 archivos, 95 MB: la primera vez o si cambian)
#   --solo-prueba   sólo el diagnóstico
set -eu
TO=${1:?Uso: tools/ps5/push.sh IP-DE-LA-PS5 o /Volumes/USB [--sprites] [--solo-prueba]}
shift
GAME=1 SPRITES=
for a in "$@"; do
  case $a in
    --sprites) SPRITES=1 ;;
    --solo-prueba) GAME= ;;
    *) echo "Opción desconocida: $a" >&2; exit 1 ;;
  esac
done
SKIP='assets/pokemon'; [ "$SPRITES" ] && SKIP='-'   # '-' no coincide con ninguna ruta
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MAC=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ps5push.XXXXXX"); trap 'rm -rf "$TMP"' EXIT


# Lista "origen<TAB>destino relativo" de todo lo que hay que pasar.
LIST="$TMP/list"
printf '%s\t%s\n' "$ROOT/tools/ps5/probe.html" probe.html "$ROOT/tools/ps5/homebrew.js" homebrew.js \
  "$ROOT/assets/icons/icon-512.png" sce_sys/icon0.png > "$LIST"
ELF="$ROOT/tools/ps5/install/install.elf"
if [ -f "$ELF" ]; then printf '%s\t%s\n' "$ELF" install.elf >> "$LIST"; else echo "Aviso: falta $ELF (make -C tools/ps5/install)"; fi
if [ "$GAME" ]; then
  cd "$ROOT"
  { ls index.html version.json manifest.webmanifest favicon.ico sw.js
    find css js assets -type f ! -name '.*' ! -path "$SKIP/*"; } | while IFS= read -r f; do printf '%s\t%s\n' "$ROOT/$f" "game/$f"; done >> "$LIST"
fi
N=$(wc -l < "$LIST" | tr -d ' ')

if [ -d "$TO" ]; then
  DST="$TO/homebrew/PokeSurvivor"
  echo "Copiando $N archivos a $DST ..."
  mkdir -p "$DST/sce_sys"
  cp "$ROOT/tools/ps5/probe.html" "$ROOT/tools/ps5/homebrew.js" "$DST/"
  [ -f "$ELF" ] && cp "$ELF" "$DST/"
  cp "$ROOT/assets/icons/icon-512.png" "$DST/sce_sys/icon0.png"
  if [ "$GAME" ]; then
    cd "$ROOT"
    # Sin --sprites, assets/pokemon queda excluido: rsync no lo copia ni lo borra del USB.
    rsync -a --delete --exclude='.*' --exclude="/$SKIP/" index.html version.json manifest.webmanifest favicon.ico sw.js css js assets "$DST/game/"
  fi
else
  DST="ftp://$TO:${PS5_FTP_PORT:-2121}/data/homebrew/PokeSurvivor"
  echo "Subiendo $N archivos a $DST ..."
  # Por tandas de 500: cada tanda es un curl que reutiliza la conexión, y entre tandas se ve el avance.
  awk -F'\t' -v d="$DST" '{ printf "upload-file = \"%s\"\nurl = \"%s/%s\"\n", $1, d, $2 }' "$LIST" | split -l 1000 - "$TMP/cfg."
  done_n=0
  for cfg in "$TMP"/cfg.*; do
    curl --fail --fail-early --ftp-create-dirs --disable-epsv --connect-timeout 5 --silent --show-error -K "$cfg"
    done_n=$((done_n + $(grep -c '^url' "$cfg")))
    echo "  $done_n / $N"
  done
fi
echo "Hecho. Informe al Mac: ${MAC:+http://$MAC:8787} (arranca: node tools/ps5/probe-recv.cjs)"
