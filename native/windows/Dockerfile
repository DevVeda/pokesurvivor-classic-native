# Compilar PokéSurvivor para Windows x86_64 con MinGW-w64 (just windows), y probarlo con Wine sin pantalla.
# Las librerías se compilan aquí para MinGW, estáticas (SDL2 va en su DLL): OpenSSL y libcurl con WebSocket.
FROM --platform=linux/amd64 ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config ca-certificates curl xz-utils zip perl \
      gcc-mingw-w64-x86-64-posix g++-mingw-w64-x86-64-posix wine64 \
    && rm -rf /var/lib/apt/lists/*
ENV W=/opt/win HOST=x86_64-w64-mingw32
# SDL2 para MinGW (la DLL y sus cabeceras), el oficial.
RUN mkdir -p $W && curl -sSfL https://github.com/libsdl-org/SDL/releases/download/release-2.30.11/SDL2-devel-2.30.11-mingw.tar.gz \
      | tar xz -C /tmp && cp -a /tmp/SDL2-2.30.11/x86_64-w64-mingw32/* $W/ && rm -rf /tmp/SDL2-2.30.11 \
    && sed -i "s|^prefix=.*|prefix=$W|" $W/lib/pkgconfig/sdl2.pc
# OpenSSL 3 (libdatachannel y curl), estático.
RUN curl -sSfL https://github.com/openssl/openssl/releases/download/openssl-3.0.15/openssl-3.0.15.tar.gz | tar xz -C /tmp \
    && cd /tmp/openssl-3.0.15 && ./Configure mingw64 no-shared no-tests --cross-compile-prefix=$HOST- --prefix=$W --libdir=lib > /dev/null \
    && make -j"$(nproc)" > /dev/null && make install_sw > /dev/null && rm -rf /tmp/openssl-3.0.15
# libcurl 8.11 con WebSocket, estática.
RUN curl -sSfL https://curl.se/download/curl-8.11.1.tar.xz | tar xJ -C /tmp \
    && cd /tmp/curl-8.11.1 && LIBS="-lcrypt32 -lws2_32 -lbcrypt" PKG_CONFIG_LIBDIR=$W/lib/pkgconfig ./configure --host=$HOST --prefix=$W --with-openssl=$W --enable-websockets --disable-shared --enable-static \
         --without-libpsl --disable-ldap --disable-ldaps --without-brotli --without-zstd --without-nghttp2 --without-libidn2 --without-zlib > /dev/null \
    && make -j"$(nproc)" > /dev/null && make install > /dev/null && rm -rf /tmp/curl-8.11.1
ENV PKG_CONFIG_LIBDIR=/opt/win/lib/pkgconfig WINEDEBUG=-all
