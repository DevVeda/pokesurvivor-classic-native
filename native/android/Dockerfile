# Compilar PokéSurvivor para Android (arm64-v8a, Android 7+): just android. Sin Gradle: el APK lo montan javac, d8, aapt2,
# zipalign y apksigner (tools/package-android.sh). Aquí, el SDK/NDK y las librerías para el NDK, estáticas salvo SDL2
# (libSDL2.so, que SDLActivity carga): OpenSSL 3 y libcurl con WebSocket. Las clases Java de SDL, en /opt/sdl-java.
# ponytail: sólo arm64-v8a (todos los móviles de 2017 en adelante y los emuladores de un Mac M); x86_64 si hiciera falta.
FROM --platform=linux/amd64 ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config ca-certificates curl xz-utils zip unzip perl cmake openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
ENV SDK=/opt/android-sdk NDKV=27.2.12479018 API=24 P=/opt/droid
ENV NDK=$SDK/ndk/$NDKV
ENV TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
RUN mkdir -p $SDK/cmdline-tools && curl -sSfL -o /tmp/ct.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && unzip -q /tmp/ct.zip -d $SDK/cmdline-tools && mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest && rm /tmp/ct.zip \
    && yes | $SDK/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null \
    && $SDK/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0" "ndk;$NDKV" > /dev/null
# OpenSSL 3 (curl y libdatachannel).
RUN curl -sSfL https://github.com/openssl/openssl/releases/download/openssl-3.0.15/openssl-3.0.15.tar.gz | tar xz -C /tmp \
    && cd /tmp/openssl-3.0.15 && export ANDROID_NDK_ROOT=$NDK PATH=$TC/bin:$PATH \
    && ./Configure android-arm64 -D__ANDROID_API__=$API no-shared no-tests --prefix=$P --libdir=lib > /dev/null \
    && make -j"$(nproc)" > /dev/null && make install_sw > /dev/null && rm -rf /tmp/openssl-3.0.15
# libcurl 8.11 con WebSocket (Firebase y las salas; net.c), estática. zlib: la del sistema (NDK).
RUN curl -sSfL https://curl.se/download/curl-8.11.1.tar.xz | tar xJ -C /tmp \
    && cd /tmp/curl-8.11.1 && export PATH=$TC/bin:$PATH \
    && CC=aarch64-linux-android$API-clang AR=llvm-ar RANLIB=llvm-ranlib PKG_CONFIG_LIBDIR=$P/lib/pkgconfig ./configure \
         --host=aarch64-linux-android --prefix=$P --with-openssl=$P --with-zlib --enable-websockets --disable-shared --enable-static \
         --without-libpsl --disable-ldap --disable-ldaps --without-brotli --without-zstd --without-nghttp2 --without-libidn2 \
         --disable-manual --disable-docs > /dev/null \
    && make -j"$(nproc)" > /dev/null && make install > /dev/null && rm -rf /tmp/curl-8.11.1
# SDL2 (la misma versión que Windows): libSDL2.so y las clases Java de su android-project.
RUN curl -sSfL https://github.com/libsdl-org/SDL/releases/download/release-2.30.11/SDL2-2.30.11.tar.gz | tar xz -C /tmp \
    && cmake -S /tmp/SDL2-2.30.11 -B /tmp/sdl-build -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
         -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=$API -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=$P \
         -DSDL_SHARED=ON -DSDL_STATIC=OFF -DSDL_TEST=OFF > /dev/null \
    && cmake --build /tmp/sdl-build -j"$(nproc)" > /dev/null && cmake --install /tmp/sdl-build > /dev/null \
    && mkdir -p /opt/sdl-java && cp -a /tmp/SDL2-2.30.11/android-project/app/src/main/java/org /opt/sdl-java/ \
    && rm -rf /tmp/SDL2-2.30.11 /tmp/sdl-build
# (libcurl.pc pide zlib, que es la del NDK: sin su .pc, pkg-config no daba nada de curl)
RUN printf 'Name: zlib\nDescription: zlib del NDK\nVersion: 1.3\nLibs: -lz\nCflags:\n' > $P/lib/pkgconfig/zlib.pc
ENV PKG_CONFIG_LIBDIR=$P/lib/pkgconfig PATH=$TC/bin:$SDK/build-tools/34.0.0:$PATH
