# Compilar PokéSurvivor para Switch (homebrew, libnx): just switch. devkitPro y, además:
# - mbedTLS 3.6 (/opt/mbed3): libdatachannel (cooperativo online) pide la 3; la de devkitPro (switch-mbedtls) es la 2.28.
#   Entropía «por hardware» y reloj: mbedtls_hardware_poll y mbedtls_ms_time, en platform/switch.c (libnx).
# - curl 8 con WebSocket sobre esa mbedTLS (/opt/curl8): el de devkitPro (switch-curl) es el 7.69, sin WebSocket
#   (Firebase y las salas; net.c). Las dos van en el mismo binario: una sola mbedTLS.
FROM devkitpro/devkita64
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl xz-utils bzip2 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -sSfL https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.2/mbedtls-3.6.2.tar.bz2 | tar xj -C /tmp \
    && cd /tmp/mbedtls-3.6.2 && . /opt/devkitpro/switchvars.sh \
    && C=include/mbedtls/mbedtls_config.h \
    && sed -i 's|^//#define MBEDTLS_NO_PLATFORM_ENTROPY|#define MBEDTLS_NO_PLATFORM_ENTROPY|; s|^//#define MBEDTLS_ENTROPY_HARDWARE_ALT|#define MBEDTLS_ENTROPY_HARDWARE_ALT|; s|^//#define MBEDTLS_PLATFORM_MS_TIME_ALT|#define MBEDTLS_PLATFORM_MS_TIME_ALT|; s|^//#define MBEDTLS_SSL_DTLS_SRTP|#define MBEDTLS_SSL_DTLS_SRTP|; s|^#define MBEDTLS_NET_C|//#define MBEDTLS_NET_C|; s|^#define MBEDTLS_TIMING_C|//#define MBEDTLS_TIMING_C|; s|^#define MBEDTLS_PSA_ITS_FILE_C|//#define MBEDTLS_PSA_ITS_FILE_C|; s|^#define MBEDTLS_PSA_CRYPTO_STORAGE_C|//#define MBEDTLS_PSA_CRYPTO_STORAGE_C|' $C \
    && make -C library -j"$(nproc)" CC="$DEVKITPRO/devkitA64/bin/aarch64-none-elf-gcc" AR="$DEVKITPRO/devkitA64/bin/aarch64-none-elf-ar" \
         CFLAGS="$CFLAGS -D__SWITCH__ -isystem $DEVKITPRO/libnx/include -I../include" static > /dev/null \
    && mkdir -p /opt/mbed3/lib && cp library/*.a /opt/mbed3/lib/ && cp -r include /opt/mbed3/ \
    && rm -rf /tmp/mbedtls-3.6.2
# (libhwpoll: sólo para las pruebas de configure; las de verdad, en platform/switch.c)
RUN curl -sSfL https://curl.se/download/curl-8.11.1.tar.xz | tar xJ -C /tmp \
    && cd /tmp/curl-8.11.1 && . /opt/devkitpro/switchvars.sh \
    && export CPPFLAGS="-I/opt/mbed3/include $CPPFLAGS" LDFLAGS="-L/opt/mbed3/lib $LDFLAGS -specs=$DEVKITPRO/libnx/switch.specs" \
    && printf 'int mbedtls_hardware_poll(void *d, unsigned char *o, unsigned long n, unsigned long *l) { (void)d; (void)o; *l = n; return 0; }\nlong long mbedtls_ms_time(void) { return 0; }\n' > /tmp/hwpoll.c \
    && $DEVKITPRO/devkitA64/bin/aarch64-none-elf-gcc $CFLAGS -c /tmp/hwpoll.c -o /tmp/hwpoll.o \
    && $DEVKITPRO/devkitA64/bin/aarch64-none-elf-ar rcs /tmp/libhwpoll.a /tmp/hwpoll.o \
    && ./configure --host=aarch64-none-elf --prefix=/opt/curl8 --disable-shared --enable-static \
         --with-mbedtls=/opt/mbed3 --with-zlib="$PORTLIBS_PREFIX" --enable-websockets \
         --without-libpsl --without-brotli --without-zstd --without-nghttp2 --without-libidn2 --without-libssh2 \
         --disable-ldap --disable-ldaps --disable-rtsp --disable-dict --disable-telnet --disable-tftp --disable-pop3 \
         --disable-imap --disable-smtp --disable-gopher --disable-mqtt --disable-smb --disable-ftp --disable-file \
         --disable-threaded-resolver --disable-ipv6 --disable-unix-sockets --disable-socketpair --disable-manual --disable-docs \
         LIBS="-L/tmp -lhwpoll -lnx" curl_disallow_socketpair=yes > /tmp/curl-configure.log \
         || { grep -B3 -A20 "error:" config.log | tail -40; exit 1; } \
    && make -C lib -j"$(nproc)" > /dev/null && make -C lib install > /dev/null && make -C include install > /dev/null \
    && rm -rf /tmp/curl-8.11.1 /tmp/hwpoll.* /tmp/libhwpoll.a
# hacBrewPack v3.05 (el de The-4n ya no está en GitHub: copia de rlaphoenix, fijada al commit) (NSP: just switch-nsp, tools/package-switch.sh). Pide las keys de la consola de cada uno al empaquetar (-k).
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc make libc6-dev \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSfL https://github.com/rlaphoenix/hacBrewPack/archive/745b16ecfc9ce055743067d200572204cb2aac6c.tar.gz | tar xz -C /tmp \
    && cd /tmp/hacBrewPack-745b16ecfc9ce055743067d200572204cb2aac6c && cp config.mk.template config.mk && make -j"$(nproc)" > /dev/null \
    && cp hacbrewpack /usr/local/bin/ && rm -rf /tmp/hacBrewPack-745b16ecfc9ce055743067d200572204cb2aac6c
