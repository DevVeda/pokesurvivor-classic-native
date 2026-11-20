#!/usr/bin/env bash
# PokéSurvivor.app para macOS (just macos): el binario de Makefile.desktop y el juego (tools/stage-game.sh) en Resources.
# Universal: Apple Silicon (macOS 11+) e Intel (macOS 10.15+), cada uno con SDL2, curl y OpenSSL estáticos compilados para
# ese mínimo (tools/mac-deps.sh); nada de Homebrew dentro (sus librerías piden el macOS de este Mac).
#   native/tools/package-macos.sh      → native/build/dist/macos/PokeSurvivor.app y PokeSurvivor-Classic-Native-<VERSION>-<BUILD>-macos.zip
# @step desktop/macdeps build "Deps estáticas Mac"
# mac-deps.sh compila SDL2/curl/OpenSSL estáticos por arquitectura.
# @next lipo
set -euo pipefail
N=$(cd "$(dirname "$0")/.." && pwd) S=$(cd "$N/.." && pwd)
APP=$N/build/dist/macos/PokeSurvivor.app C=$N/build/dist/macos/PokeSurvivor.app/Contents
MIN_X86=10.15 MIN_ARM=11.0   # (si cambian: LSMinimumSystemVersion, abajo)
for a in arm64:$MIN_ARM x86_64:$MIN_X86; do
  arch=${a%%:*} min=${a#*:}
  bash "$N/tools/mac-deps.sh" "$arch" "$min"
  MACOSX_DEPLOYMENT_TARGET=$min make -C "$N" -f Makefile.desktop B="build/mac-$arch" MAC_DEPS="build/macdeps/$arch" \
    CC="cc -arch $arch -mmacosx-version-min=$min" CXX="c++ -arch $arch -mmacosx-version-min=$min" -j"$(sysctl -n hw.ncpu)"
done
rm -rf "$APP" && mkdir -p "$C/MacOS" "$C/Resources"
# @step desktop/lipo build "lipo universal"
# Une arm64 y x86_64 y comprueba que no enlace librerías de fuera del sistema.
# @next macpkg
lipo -create "$N/build/mac-arm64/pokesurvivor" "$N/build/mac-x86_64/pokesurvivor" -output "$C/MacOS/PokeSurvivor"
# Que no se cuele nada que pida un macOS más nuevo (otool: el minos de cada arquitectura) ni una librería de fuera del sistema.
for arch in arm64 x86_64; do
  want=$([[ $arch == arm64 ]] && echo $MIN_ARM || echo $MIN_X86)
  got=$(otool -arch "$arch" -l "$C/MacOS/PokeSurvivor" | awk '/minos/{print $2; exit}')
  [[ $got == "$want" ]] || { echo "package-macos: $arch pide macOS $got (quería $want)" >&2; exit 1; }
done
# (universal: otool pone una cabecera «…(architecture x):» por arquitectura; no son librerías)
if otool -L "$C/MacOS/PokeSurvivor" | grep -v ':$' | grep -vE '^\s+(/usr/lib/|/System/Library/)'; then
  echo "package-macos: enlaza librerías de fuera del sistema (arriba)" >&2; exit 1
fi
bash "$N/tools/stage-game.sh" "$C/Resources"
VER=$(tr -d ' \r\n' < "$S/VERSION")   # (la versión del juego: el archivo VERSION de la raíz)
BUILD=$(tr -d ' \r\n' < "$S/BUILD" 2>/dev/null || true); SLUG=$VER${BUILD:+-$BUILD}   # (nombre de archivo: versión y build, tools/apply-env.mjs)
cat > "$C/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>PokéSurvivor Classic Native</string>
  <key>CFBundleDisplayName</key><string>PokéSurvivor Classic Native</string>
  <key>CFBundleIdentifier</key><string>com.pokesurvivor.game</string>
  <key>CFBundleExecutable</key><string>PokeSurvivor</string>
  <key>CFBundleIconFile</key><string>PokeSurvivor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VER:-1.0}</string>
  <key>CFBundleVersion</key><string>${VER:-1.0}</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
</dict></plist>
PLIST
# El icono, del de la web (512 px).
ICO=$N/build/dist/macos/PokeSurvivor.iconset; rm -rf "$ICO"; mkdir -p "$ICO"
for s in 16 32 128 256 512; do
  sips -z $s $s "$S/assets/icons/icon-512.png" --out "$ICO/icon_${s}x${s}.png" > /dev/null
  sips -z $((s * 2)) $((s * 2)) "$S/assets/icons/icon-512.png" --out "$ICO/icon_${s}x${s}@2x.png" > /dev/null
done
iconutil -c icns "$ICO" -o "$C/Resources/PokeSurvivor.icns" && rm -rf "$ICO"
# @step desktop/macpkg build "Info.plist, codesign, zip"
# stage-game en Resources, Info.plist con VERSION, icono, firma ad hoc y zip con ditto.
# @next dist
codesign --force --deep -s - "$APP" 2> /dev/null || echo "Aviso: sin firma ad hoc (codesign)."
# @step desktop/macpkg
(cd "$N/build/dist/macos" && rm -f PokeSurvivor-*-macos.zip && ditto -c -k --keepParent PokeSurvivor.app "PokeSurvivor-Classic-Native-${SLUG:-0.0.0}-macos.zip")
echo "Hecho: $APP ($(du -sh "$APP" | cut -f1); $(lipo -archs "$C/MacOS/PokeSurvivor"), macOS $MIN_X86+ Intel / $MIN_ARM+ Apple Silicon)"
