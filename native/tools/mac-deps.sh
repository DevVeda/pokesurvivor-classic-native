#!/usr/bin/env bash
# SDL2, OpenSSL y curl (con WebSocket) estáticos para macOS, de su código, para una arquitectura y un macOS mínimo: así el
# .app no depende de Homebrew (que compila para el macOS de este Mac y sólo para su arquitectura). Lo usa package-macos.sh.
#   native/tools/mac-deps.sh arm64 11.0     → native/build/macdeps/arm64/{include,lib,lib/pkgconfig}
#   native/tools/mac-deps.sh x86_64 10.15   → native/build/macdeps/x86_64/…
# La primera vez tarda unos minutos; luego no hace nada (native/build/macdeps/<arch>/.ok). Para rehacerlo: bórralo.
set -euo pipefail
ARCH=${1:?arquitectura: arm64 o x86_64} MIN=${2:?macOS mínimo, p. ej. 11.0}
N=$(cd "$(dirname "$0")/.." && pwd)
SRC=$N/build/macdeps/src P=$N/build/macdeps/$ARCH W=$N/build/macdeps/work-$ARCH
STAMP="$ARCH $MIN openssl-3.5.4 curl-8.11.1 SDL2-2.32.10"
# zlib es la del sistema (-lz), sin .pc: libcurl.pc lo pide (Requires: zlib) y sin él `pkg-config --libs libcurl` sale vacío.
zpc() { mkdir -p "$P/lib/pkgconfig"; printf 'Name: zlib\nDescription: zlib del sistema\nVersion: 1.2.12\nLibs: -lz\nCflags:\n' > "$P/lib/pkgconfig/zlib.pc"; }
[[ -f $P/.ok && $(cat "$P/.ok") == "$STAMP" ]] && { zpc; exit 0; }

# Las fuentes, con su SHA-256 (el de OpenSSL, el que publica; curl y SDL2, comprobados al fijar la versión).
get() {   # url sha256
  local f=$SRC/${1##*/}
  mkdir -p "$SRC"
  [[ -f $f ]] || curl -sSfL -o "$f.part" "$1" && { [[ -f $f ]] || mv "$f.part" "$f"; }
  echo "$2  $f" | shasum -a 256 -c --quiet || { rm -f "$f"; echo "mac-deps: $f no es el que debería (hash)" >&2; exit 1; }
}
get https://github.com/openssl/openssl/releases/download/openssl-3.5.4/openssl-3.5.4.tar.gz 967311f84955316969bdb1d8d4b983718ef42338639c621ec4c34fddef355e99
get https://curl.se/download/curl-8.11.1.tar.xz c7ca7db48b0909743eaef34250da02c19bc61d4f1dcedd6603f109409536ab56
get https://github.com/libsdl-org/SDL/releases/download/release-2.32.10/SDL2-2.32.10.tar.gz 5f5993c530f084535c65a6879e9b26ad441169b3e25d789d83287040a9ca5165

rm -rf "$P" "$W" && mkdir -p "$P" "$W" && zpc
export MACOSX_DEPLOYMENT_TARGET=$MIN
CC="cc -arch $ARCH -mmacosx-version-min=$MIN"
HOST=$([[ $ARCH == arm64 ]] && echo aarch64-apple-darwin || echo x86_64-apple-darwin)
J=$(sysctl -n hw.ncpu)
echo "mac-deps: $ARCH, macOS $MIN (unos minutos)"

tar xzf "$SRC/openssl-3.5.4.tar.gz" -C "$W"
(cd "$W/openssl-3.5.4" && ./Configure "darwin64-$ARCH-cc" no-shared no-tests no-docs no-apps no-module \
   --prefix="$P" --libdir=lib "-mmacosx-version-min=$MIN" > /dev/null && make -j"$J" > /dev/null && make install_sw > /dev/null)

# curl: lo mismo que el de Linux (native/linux/Dockerfile): HTTPS y WebSocket con OpenSSL, nada más.
tar xJf "$SRC/curl-8.11.1.tar.xz" -C "$W"
(cd "$W/curl-8.11.1" && CC="$CC" PKG_CONFIG_LIBDIR=$P/lib/pkgconfig ./configure --host="$HOST" --prefix="$P" \
   --disable-shared --enable-static --with-openssl="$P" --enable-websockets --without-libpsl --disable-ldap --disable-ldaps \
   --without-brotli --without-zstd --without-nghttp2 --without-libidn2 --without-librtmp --disable-docs --disable-manual \
   > /dev/null && make -j"$J" > /dev/null && make install > /dev/null)

tar xzf "$SRC/SDL2-2.32.10.tar.gz" -C "$W"
(cd "$W/SDL2-2.32.10" && CC="$CC" ./configure --host="$HOST" --prefix="$P" --disable-shared --enable-static \
   > /dev/null && make -j"$J" > /dev/null && make install > /dev/null)

rm -rf "$W"
echo "$STAMP" > "$P/.ok"
echo "mac-deps: hecho ($P)"
