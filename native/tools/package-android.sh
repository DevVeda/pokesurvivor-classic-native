#!/usr/bin/env bash
# Android (arm64-v8a, Android 7+), DENTRO del contenedor de native/android/Dockerfile (just android):
#   docker run --rm --platform linux/amd64 -v "$PWD":/src -w /src pokesurvivor-android bash native/tools/package-android.sh
# → native/build/dist/android/PokeSurvivor-Classic-Native-<VERSION>-<BUILD>.apk. Sin Gradle: javac + d8 (clases), aapt2 (manifiesto e icono),
# zip (libmain.so, libSDL2.so y el juego en assets/ps/), zipalign y apksigner.
# Firma: ANDROID_KEYSTORE (y ANDROID_KS_PASS) o native/android/pokesurvivor.keystore, que se crea la primera vez y NUNCA va
# a git (.gitignore): con otra clave, Android no deja instalar el APK nuevo encima del viejo (hay que desinstalar).
# @step android/sign build "zipalign + apksigner"
# Firma con ANDROID_KEYSTORE o el keystore local (fuera de git).
# @next run
set -euo pipefail
N=$(cd "$(dirname "$0")/.." && pwd) S=$(cd "$N/.." && pwd)
VER=$(tr -d ' \r\n' < "$S/VERSION")
BUILD=$(tr -d ' \r\n' < "$S/BUILD" 2>/dev/null || true); SLUG=$VER${BUILD:+-$BUILD}   # (nombre de archivo: versión y build, tools/apply-env.mjs)
B=$N/build/android A=$N/build/android/apk OUT=$N/build/dist/android
JAR=$SDK/platforms/android-34/android.jar
# (-fPIC en el compilador: también para QuickJS y libdatachannel, que van dentro de libmain.so)
# @step android/so build "libmain.so"
# Makefile.desktop con TARGET_OS=Android, clang aarch64; junto a libSDL2.so.
# @next stage
make -C "$N" -f Makefile.desktop B=build/android TARGET_OS=Android CC="aarch64-linux-android$API-clang -fPIC" \
     CXX="aarch64-linux-android$API-clang++ -fPIC" AR=llvm-ar -j"$(nproc)"
rm -rf "$A" && mkdir -p "$A/lib/arm64-v8a" "$A/assets/ps" "$A/res/mipmap" "$A/classes" "$OUT"
llvm-strip --strip-unneeded -o "$A/lib/arm64-v8a/libmain.so" "$B/pokesurvivor.so"
cp "$P/lib/libSDL2.so" "$A/lib/arm64-v8a/"
bash "$N/tools/stage-game.sh" "$A/assets/ps"   # (PokeSurvivorActivity.prepareGame lo copia a files/game: plat_root)
# Icono: el de «CLASSIC» (title/icon0.png). ic_launcher.png para Android 7; desde el 8, el adaptativo de android/res.
cp -r "$N/android/res/." "$A/res/"
cp "$N/title/icon0.png" "$A/res/mipmap/ic_launcher.png"
cp "$N/title/icon0.png" "$A/res/mipmap/ic_art.png"
# (android.jar en el classpath, no de bootclasspath: las lambdas piden LambdaMetafactory del JDK; d8 las convierte)
javac -source 8 -target 8 -classpath "$JAR" -nowarn -Xlint:-options -encoding UTF-8 -d "$A/classes" \
      $(find /opt/sdl-java "$N/android/src" -name '*.java')
d8 --release --min-api "$API" --lib "$JAR" --output "$A" $(find "$A/classes" -name '*.class')
aapt2 compile --dir "$A/res" -o "$A/res.zip"
# versionCode: el sello del paquete (update.seq, la hora del build): cada APK, mayor que el anterior.
# @step android/dex build "javac + d8 + aapt2"
# Java de SDL y de la Activity; aapt2 link con versionCode = update.seq.
# @next sign
aapt2 link -o "$A/base.apk" -I "$JAR" --manifest "$N/android/AndroidManifest.xml" "$A/res.zip" \
      --min-sdk-version "$API" --target-sdk-version 34 --version-code "$(cat "$A/assets/ps/update.seq")" --version-name "$VER"
(cd "$A" && zip -qr base.apk classes.dex lib assets)
zipalign -f 4 "$A/base.apk" "$A/aligned.apk"
KS=${ANDROID_KEYSTORE:-$N/android/pokesurvivor.keystore} PASS=${ANDROID_KS_PASS:-pokesurvivor}
[[ -f $KS ]] || keytool -genkeypair -keystore "$KS" -alias pokesurvivor -keyalg RSA -keysize 2048 -validity 10000 \
                        -storepass "$PASS" -keypass "$PASS" -dname "CN=PokeSurvivor" > /dev/null
# @step android/sign
rm -f "$OUT"/PokeSurvivor-*.apk   # (los de otros builds)
apksigner sign --v4-signing-enabled false --ks "$KS" --ks-pass "pass:$PASS" --out "$OUT/PokeSurvivor-Classic-Native-$SLUG.apk" "$A/aligned.apk"
rm -f "$A"/*.apk   # (base y aligned: intermedios sin firmar; el que se instala es el de $OUT)
ls -la "$OUT"
