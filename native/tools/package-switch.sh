#!/usr/bin/env bash
# NSP de Switch (instalable con DBI/Tinfoil en una consola con CFW): just switch-nsp. Ver SWITCH.md, fase 6.
# Corre en la imagen pokesurvivor-switch, con el .elf y el romfs que deja Makefile.switch (just switch):
#   exefs  = main (elf2nso) + main.npdm (npdmtool, switch/pokesurvivor.json)
#   romfs  = build/switch/romfs (el mismo del .nro)
#   control= control.nacp (nacptool) + icon_AmericanEnglish.dat (switch/icon.jpg)
# Las keys (prod.keys) son de la consola de cada uno: entran como archivo de sólo lectura y nunca se copian.
#   native/tools/package-switch.sh <prod.keys> [carpeta de salida]
set -euo pipefail
KEYS=${1:?ruta de prod.keys}
N=$(cd "$(dirname "$0")/.." && pwd)
B=$N/build/switch
OUT=${2:-$B/nsp}
TID=01005053b0b00000   # (el mismo que switch/pokesurvivor.json)
VER=$(cat "$N/../VERSION" 2>/dev/null || echo 0.0.0)
BUILD=$(tr -d ' \r\n' < "$N/../BUILD" 2>/dev/null || true); SLUG=$VER${BUILD:+-$BUILD}   # (nombre de archivo: versión y build, tools/apply-env.mjs)
T=$DEVKITPRO/tools/bin
[[ -f $B/pokesurvivor.elf && -f $B/romfs/shim/boot.js ]] || { echo "Falta el build: just switch" >&2; exit 1; }
[[ -r $KEYS ]] || { echo "No se puede leer $KEYS" >&2; exit 1; }

W=$B/nsp-work
rm -rf "$W"; mkdir -p "$W/exefs" "$W/control" "$OUT"
"$T/elf2nso" "$B/pokesurvivor.elf" "$W/exefs/main"
"$T/npdmtool" "$N/switch/pokesurvivor.json" "$W/exefs/main.npdm" 2> /dev/null   # (avisa de cada campo opcional que falta)
"$T/nacptool" --create "PokéSurvivor" "PokéSurvivor" "$VER" "$W/control/control.nacp" --titleid=$TID
cp "$N/switch/icon.jpg" "$W/control/icon_AmericanEnglish.dat"

# ponytail: sin logo propio (--nologo: pantalla negra al abrir); con uno, --logodir con NintendoLogo.png y StartupMovie.gif.
# hacBrewPack (2019) se para con las keys nuevas de Lockpick (p. ej. de 17 bytes): sólo las que usa, en el /tmp del
# contenedor (no se monta: desaparece con él).
K=/tmp/hbp.keys
trap 'rm -rf "$W" "$K"' EXIT
grep -iE '^[[:space:]]*(header_key|key_area_key_application_[0-9a-f]{2})[[:space:]]*=' "$KEYS" | tr -d '\r' > "$K" || true
[[ -s $K ]] || { echo "$KEYS no tiene header_key ni key_area_key_application_xx" >&2; exit 1; }
# @step switch/nsp build "hacbrewpack → NSP"
# elf2nso + npdm + nacp → PokeSurvivor-Classic-Native-<VER>-<BUILD>.nsp.
(cd "$W" && hacbrewpack -k "$K" --titleid $TID --exefsdir exefs --romfsdir "$B/romfs" --controldir control --nologo \
    --nspdir "$OUT" --ncadir nca --tempdir tmp --backupdir backup) | grep -v "^Writing "   # (una línea por archivo del romfs)
rm -f "$OUT"/PokeSurvivor-*.nsp   # (los de otros builds)
mv "$OUT/$TID.nsp" "$OUT/PokeSurvivor-Classic-Native-$SLUG.nsp"
echo "NSP: $OUT/PokeSurvivor-Classic-Native-$SLUG.nsp ($(du -h "$OUT/PokeSurvivor-Classic-Native-$SLUG.nsp" | cut -f1))"
