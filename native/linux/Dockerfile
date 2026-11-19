# Compilar PokéSurvivor para Linux x86_64 (y la AppImage para Steam Deck): just linux.
# Ubuntu 22.04 (glibc 2.35): la AppImage abre en SteamOS 3 y en las distribuciones de 2022 en adelante.
FROM --platform=linux/amd64 ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config ca-certificates curl file xz-utils \
      libsdl2-dev libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
# libcurl con WebSocket (Firebase y las salas del cooperativo; net.c): la de Ubuntu 22.04 (7.81) es anterior.
RUN curl -sSfL https://curl.se/download/curl-8.11.1.tar.xz | tar xJ -C /tmp \
    && cd /tmp/curl-8.11.1 && ./configure --prefix=/usr/local --with-openssl --enable-websockets --without-libpsl \
         --disable-ldap --disable-ldaps --without-brotli --without-zstd --without-nghttp2 --without-libidn2 > /dev/null \
    && make -j"$(nproc)" > /dev/null && make install > /dev/null && ldconfig && rm -rf /tmp/curl-8.11.1
# linuxdeploy: mete en la AppImage las librerías que no trae SteamOS (SDL2, curl, OpenSSL…).
# Extraída: una AppImage lleva «AI\x02» en la cabecera ELF (bytes 8-10) y la emulación amd64 de Docker en un Mac ARM no la
# ejecuta (Exec format error). Con esos bytes a cero se puede abrir para sacar su contenido (sin FUSE).
RUN curl -sSfL -o /tmp/linuxdeploy.AppImage \
      https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage \
    && chmod +x /tmp/linuxdeploy.AppImage \
    && dd if=/dev/zero of=/tmp/linuxdeploy.AppImage bs=1 seek=8 count=3 conv=notrunc 2> /dev/null \
    && cd /opt && /tmp/linuxdeploy.AppImage --appimage-extract > /dev/null && mv squashfs-root linuxdeploy \
    && ln -s /opt/linuxdeploy/AppRun /usr/local/bin/linuxdeploy && rm /tmp/linuxdeploy.AppImage
ENV APPIMAGE_EXTRACT_AND_RUN=1
