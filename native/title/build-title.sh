#!/usr/bin/env bash
# Compila el título de native/title/hello/param.json (PPSA77702 «PokéSurvivor Classic Native») con las herramientas de PS5_Vulkan (compilar, enlazar con su
# CRT, convertir a módulo y firmar FSELF). Se ejecuta DENTRO del contenedor de native/title/Dockerfile:
#   docker run --rm --platform linux/amd64 -v "$PWD/../ps5gpu":/work -v "$PWD":/src ps5title \
#     bash /src/native/title/build-title.sh            # el juego
#     bash /src/native/title/build-title.sh hello      # paso 1: sólo native/title/hello/hello.c
# Resultado: ../ps5gpu/poke-title/dist/<titleId> (súbelo con native/title/push-title.sh).
# Ver native/TITLE.md. Paso 2: el motor de native/ con SDL hecho con scePad/sceAudioOut (title/sdl) y sin red.
set -euo pipefail
V=/work/PS5_Vulkan W=/work/poke-title S=/src N=/src/native
PARAM=$N/title/hello/param.json
ID=$(grep -o '"titleId": *"[A-Z0-9]*"' "$PARAM" | grep -o 'PPSA[0-9]*')
[[ -d $V/.deps/native ]] || { echo "falta $V/.deps: compila antes PS5_Vulkan (tools/bootstrap)"; exit 2; }

mkdir -p "$W"
# Las herramientas de PS5_Vulkan (GPL-3.0), tal cual; sus dependencias ya bajadas, enlazadas.
rsync -a --delete "$V/tools" "$V/tooling" "$V/vendor" "$V/runtime" "$W/"
ln -sfn "$V/.deps" "$W/.deps"
# build.sh no deja añadir opciones al enlazador: en esta copia, las de APP_LINK_FLAGS van detrás de --eh-frame-hdr.
# @step ps5/bt
sed -i 's/--eh-frame-hdr "${driver_link_flags\[@\]}"/--eh-frame-hdr ${APP_LINK_FLAGS:-} "${driver_link_flags[@]}"/' "$W/tools/build.sh"
grep -q 'APP_LINK_FLAGS' "$W/tools/build.sh" || { echo "build.sh de PS5_Vulkan cambió: revisa el enlace"; exit 2; }
# Sin libScePosixForWebKit: un título no la carga (sus funciones serían NULL), y con ella enlazada el título
# exportaría las que la sustituyen (getaddrinfo…), que el conversor no admite.
sed -i 's|--as-needed "$sdk_root"/target/lib/\*\.so|--as-needed $(ls "$sdk_root"/target/lib/*.so \| grep -v PosixForWebKit)|' "$W/tools/build.sh"
grep -q 'grep -v PosixForWebKit' "$W/tools/build.sh" || { echo "build.sh de PS5_Vulkan cambió: revisa las librerías del enlace"; exit 2; }
# Si falla la compilación, build.sh enseña el primer log que no esté vacío (a menudo sólo avisos de otro archivo): que
# enseñe el que tiene el error.
sed -i 's/\[\[ -s ${compile_logs\[index\]} \]\] || continue/grep -q " error:" "${compile_logs[index]}" || continue/' "$W/tools/build.sh"
rm -rf "$W/src" "$W/sce_sys" "$W/assets"
mkdir -p "$W/src/plutovg" "$W/sce_sys" "$W/assets"
cp -a "$N/third_party/plutovg/source" "$N/third_party/plutovg/include" "$W/src/plutovg/"
# La versión del título (contentVersion, XX.YYY.ZZZ) sale del archivo VERSION de la raíz: 0.1.0 → 00.001.000.
# @step ps5/param build "param.json"
# contentVersion desde VERSION e icono en sce_sys.
# @next stage
IFS=. read -r V1 V2 V3 < <(tr -d ' \r\n' < "$N/../VERSION"; echo)   # (echo: sin salto de línea, read da 1 y set -e corta sin avisar)
sed "s/\"contentVersion\": *\"[^\"]*\"/\"contentVersion\": \"$(printf '%02d.%03d.%03d' "$((10#${V1:-0}))" "$((10#${V2:-0}))" "$((10#${V3:-0}))")\"/" "$PARAM" > "$W/sce_sys/param.json"
cp "$N/title/icon0.png" "$W/sce_sys/icon0.png"   # el de la web con «CLASSIC» abajo

# Sin assert (__assert) ni variables por hilo en stb_image (__emutls): un título no tiene la libc.a de los
# payloads, que los trae. ps5_fp_ieee (la llama el arranque del título) está en libps5platform.a.
DEFS="PLUTOVG_BUILD PLUTOVG_BUILD_STATIC NDEBUG STBI_NO_THREAD_LOCALS PS5_DEV"   # PS5_DEV: diagnóstico (main.c)
export APP_STATIC_ARCHIVES=".deps/native/ps5-payload-sdk/target/lib/libps5platform.a"
# Toda la memoria (malloc y su familia) al montón de libps5platform en memoria directa (~12 GB): el de la libc
# de un título se acaba enseguida (al cargar el JS: "out of memory"). Como la receta de RADV (tools/radv-link.sh).
APP_LINK_FLAGS=""
for f in malloc calloc realloc free posix_memalign aligned_alloc memalign malloc_usable_size reallocf reallocarray getline getdelim; do
  APP_LINK_FLAGS+=" --wrap=$f"
done
export APP_LINK_FLAGS
if [[ ${1:-} == hello ]]; then
  cp "$N/title/hello/hello.c" "$W/src/"
  cp "$S/assets/fonts/PixelifyPS-700.ttf" "$W/assets/"
  export APP_INCLUDE_PATHS="src/plutovg/include" APP_DEFINITIONS="$DEFS"
else
  cp "$N"/{main,audio,canvas,gpu_vk,tiles_worker,net,webrtc}.c "$N"/{canvas,audio,tiles_worker,net,webrtc,gpu}.h "$N/title/compat.c" "$W/src/"
  # La pantalla por Vulkan (gpu_vk.c): sus sombreadores, a SPIR-V en cabeceras (gpu_vk_vert[], gpu_vk_frag[]).
  for st in vert frag; do
    glslangValidator -V --target-env vulkan1.3 --vn "gpu_vk_$st" "$N/title/shaders/quad.$st" -o "$W/src/gpu_vk_$st.h" > /dev/null
  done
  # @step ps5/bt build "build-title.sh"
  # Copia main.c, platform/ps5.c, core, update.c y monocypher al árbol de PS5_Vulkan y parchea su
  # build.sh.
  # @next param
  cp "$N/platform.h" "$W/src/" && cp "$N/platform/ps5.c" "$W/src/platform_ps5.c"   # la plataforma (platform.h)
  cp "$N/core_js.c" "$N"/core/{core.h,world.c,sim.c,combat.c,pickup.c,abil.c,foe.c,map.c,data.c} "$W/src/"   # el núcleo de la partida en C (CORE.md)
  cp "$N"/update.{c,h} "$N"/third_party/monocypher/monocypher{,-ed25519}.{c,h} "$W/src/"   # actualizaciones firmadas (update.c)
  cp -a "$N/title/sdl" "$W/src/"
  mkdir -p "$W/src/rtcinc" && cp -a "$N/third_party/libdatachannel/include/rtc" "$W/src/rtcinc/"   # rtc/rtc.h para webrtc.c
  # QuickJS, libcurl y OpenSSL del repositorio de PacBrew (el mismo que usa el SDK de los payloads). Los .a a
  # mano: su pkg-config pide -pthread, que el enlazador del título no entiende.
  # AGC_LINKED_CANARY: build.sh enlaza los stubs de libSceAgc/libSceAgcDriver con todo lo que importa RADV.
  export APP_INCLUDE_PATHS="src src/plutovg/include src/sdl/include src/rtcinc .deps/native/radv-release/include" \
         APP_DEFINITIONS="$DEFS PS5_TITLE AGC_LINKED_CANARY=1" \
         PACBREW_INCLUDE_PATHS="include include/quickjs" \
         PACBREW_STATIC_ARCHIVES="lib/quickjs/libquickjs.a lib/libcurl.a lib/libpsl.a lib/libssl.a lib/libcrypto.a lib/libzstd.a lib/libz.a"
  # libdatachannel es C++: su .a, el libc++/libc++abi/libunwind del SDK y los builtins de clang (__emutls_get_address,
  # por su thread_local), como tools/radv-link.sh. Con excepciones, el guion de enlace que da a libunwind sus tablas.
  # Y getaddrinfo envuelto como en el payload (la PS5 no acepta el puerto "0": webrtc.c).
  SDKL="$W/.deps/native/ps5-payload-sdk/target/lib"
  # (-L: libc++ pide "pthread" por nombre; el libpthread.a del SDK está vacío a propósito, lo da la libc.)
  # RADV (Vulkan, gpu_vk.c) entero, como tools/radv-link.sh: sus tablas nombran cada función con referencias débiles,
  # que no traen el objeto del archivo (sin --whole-archive, alguna sería NULL).
  RADV="$W/.deps/native/radv-release/lib/libvulkan_radeon.ps5.a"
  [[ -f $RADV ]] || { echo "falta $RADV (PS5_Vulkan: tools/build-radv.sh release)"; exit 2; }
  APP_LINK_FLAGS+=" --whole-archive $RADV --no-whole-archive"
  APP_LINK_FLAGS+=" -L $SDKL $W/build/libdatachannel.a --start-group $SDKL/libc++.a $SDKL/libc++abi.a $SDKL/libunwind.a"
  APP_LINK_FLAGS+=" $(${PS5_CLANG:-clang} --print-resource-dir)/lib/linux/libclang_rt.builtins-x86_64.a --end-group"
  APP_LINK_FLAGS+=" --wrap=getaddrinfo --wrap=freeaddrinfo"
  # open_memstream de la plataforma publica su búfer al cerrar o vaciar: fclose y fflush envueltos (tools/radv-link.sh).
  APP_LINK_FLAGS+=" --wrap=fprintf --wrap=vfprintf --wrap=fclose --wrap=fflush --wrap=fcntl --wrap=poll --wrap=ioctl"   # (fcntl, poll e ioctl: title/compat.c)
  APP_LINK_FLAGS+=" --wrap=recv --wrap=send --wrap=recvfrom --wrap=sendto --wrap=read --wrap=write --wrap=close"   # (MSG_DONTWAIT: title/compat.c)
  # Hilos: en un título, uno creado sin atributos tiene 64 KiB de pila (los de red, WebSocket, cooperativo, suelo y
  # copia); los de la plataforma dan 2 MiB y el estado de coma flotante de quien los crea (tools/radv-link.sh).
  APP_LINK_FLAGS+=" --wrap=pthread_create --wrap=pthread_join --wrap=pthread_detach"
  # Los huecos de la libc de un título, a las ps5_* de libps5platform (la lista de tools/radv-link.sh, más
  # gmtime_r y getpwuid_r que piden curl y OpenSSL). Lo que ni ésas tienen, en title/compat.c.
  for f in qsort_r mkstemps openlog popen pclose open_memstream __xuname __assert __memset_chk regcomp regexec \
           regfree regerror localtime_r gmtime_r getpwuid_r newlocale freelocale strtod_l strtof_l dladdr utimensat \
           localeconv_l strtoll_l strtoull_l strtold_l snprintf_l sscanf_l asprintf_l strcoll_l strxfrm_l strftime_l \
           wcscoll_l wcsxfrm_l btowc_l wctob_l iswctype_l mbrlen_l mbrtowc_l mbsrtowcs_l mbsnrtowcs_l wcrtomb_l \
           wcsnrtombs_l mbtowc_l ___mb_cur_max_l ___runetype_l ___tolower_l ___toupper_l __runes_for_locale catopen \
           catgets catclose backtrace backtrace_symbols_fd __cxa_thread_atexit_impl \
           arc4random arc4random_buf; do   # (opendir… ya están en libSceLibcInternal)
    APP_LINK_FLAGS+=" --defsym=$f=ps5_$f"
  done
  # Y lo que añade tools/radv-link.sh para RADV (la libc de un título no lo tiene, lo niega o falla).
  PLATSYMS=$("$SDKL/../../bin/llvm-nm" --defined-only "$SDKL/libps5platform.a" 2>/dev/null || true)
  for f in arc4random_uniform statvfs fstatvfs futimens clock_nanosleep if_nameindex if_freenameindex opendir fdopendir \
           readdir rewinddir dirfd closedir nl_langinfo nl_langinfo_l posix_fallocate access openat unlinkat fchmodat \
           fstatat mkdirat renameat memfd_create localeconv strcasestr mkstemp readlink link symlink; do
    grep -q " T ps5_$f$" <<<"$PLATSYMS" && APP_LINK_FLAGS+=" --defsym=$f=ps5_$f"
  done
  for f in getaddrinfo freeaddrinfo getnameinfo gai_strerror gethostbyname isatty fnmatch; do APP_LINK_FLAGS+=" --defsym=$f=title_$f"; done   # (title/compat.c)
  grep -q " T ps5_mkstemp$" <<<"$PLATSYMS" || APP_LINK_FLAGS+=" --defsym=mkstemp=title_mkstemp"
  # Todo lo sustituido, local: si no, el título lo exportaría (los stubs del SDK también lo definen) y el conversor no
  # admite exportar (tools/radv-link.sh).
  mkdir -p "$W/build"
  { echo "{ local:"; grep -o -- '--defsym=[A-Za-z0-9_]*' <<<"$APP_LINK_FLAGS" | sed 's/--defsym=/  /; s/$/;/'; echo "};"; } > "$W/build/defsym-local.map"
  APP_LINK_FLAGS+=" --version-script $W/build/defsym-local.map"
  sed -i 's|linker_script=(-T "$native/ps5-pie.ld")|linker_script=(-T "$root/tooling/psbc/ps5-pie-unwind.ld" -L "$native")|' "$W/tools/build.sh"
  grep -q 'ps5-pie-unwind.ld' "$W/tools/build.sh" || { echo "build.sh de PS5_Vulkan cambió: revisa el guion de enlace"; exit 2; }
fi

cd "$W"
if [[ ${1:-} != hello ]]; then
  # libdatachannel (WebRTC: el cooperativo) con libjuice y usrsctp, con las opciones del Makefile del payload, pero
  # con el compilador del título y CON excepciones (build.sh compila los .cpp sin ellas). Se compila una vez:
  # bórralo ($W/build/libdatachannel.a) para rehacerlo.
  DCA="$W/build/libdatachannel.a"
  if [[ ! -f $DCA ]]; then
    export PS5_PAYLOAD_SDK="$W/.deps/native/ps5-payload-sdk"
    CC="sh $W/tooling/prospero-clang18" DC="$N/third_party/libdatachannel" O="$W/build/dc"
    SCTP="$DC/deps/usrsctp/usrsctplib" JUICE="$DC/deps/libjuice" PB="$W/.deps/pacbrew/v0.40.2/sysroot/user/homebrew"
    SCTP_FLAGS="-D__Userspace__ -DSCTP_SIMPLE_ALLOCATOR -DSCTP_PROCESS_LEVEL_LOCKS -DSCTP_STDINT_INCLUDE=<stdint.h> -DHAVE_SYS_QUEUE_H -DHAVE_SA_LEN -DHAVE_SIN_LEN -DHAVE_SIN6_LEN -DHAVE_SCONN_LEN -DHAVE_NETINET_IP_ICMP_H -DHAVE_NET_ROUTE_H -DHAVE_STDATOMIC_H -I$SCTP"
    JUICE_FLAGS="-DJUICE_STATIC -DJUICE_EXPORTS -DUSE_NETTLE=0 -DNO_SERVER -DRELEASE=1 -I$JUICE/include/juice -I$JUICE/include"
    DC_FLAGS="-std=c++17 -fexceptions -fcxx-exceptions -frtti -DRTC_STATIC -DRTC_EXPORTS -DRTC_ENABLE_MEDIA=0 -DRTC_ENABLE_WEBSOCKET=0 -DUSE_GNUTLS=0 -DUSE_MBEDTLS=0 -DUSE_NICE=0 -DRTC_SYSTEM_SRTP=0 -DJUICE_STATIC -I$DC/include -I$DC/include/rtc -I$DC/src -I$DC/deps/plog/include -I$JUICE/include -I$SCTP -I$PB/include"
    rm -rf "$O"; mkdir -p "$O"
    export CC O SCTP_FLAGS JUICE_FLAGS DC_FLAGS
    if ! { ls "$SCTP"/netinet/*.c "$SCTP"/netinet6/*.c "$SCTP"/user_*.c | sed 's/^/S /'
      ls "$JUICE"/src/*.c | grep -v '/server\.c$' | sed 's/^/J /'
      ls "$DC"/src/*.cpp "$DC"/src/impl/*.cpp | sed 's/^/D /'; } |
    xargs -P "$(nproc)" -L 1 bash -c 'o="$O/$(echo "$1" | md5sum | cut -c1-12).o"
      case $0 in S) $CC -O2 -w $SCTP_FLAGS -c "$1" -o "$o";; J) $CC -O2 -w $JUICE_FLAGS -c "$1" -o "$o";; D) $CC -O2 -w $DC_FLAGS -c "$1" -o "$o";; esac' \
      2>&1 | { grep -m 40 -B2 -A6 "error:" || true; }; then echo "libdatachannel no compila"; exit 1; fi
    "$PS5_PAYLOAD_SDK/bin/llvm-ar" rcs "$DCA" "$O"/*.o 2>/dev/null || ar rcs "$DCA" "$O"/*.o
    echo "libdatachannel.a: $(ls "$O" | wc -l) objetos"
  fi
fi
bash tools/build.sh Folder
# Un título no carga libScePosixForWebKit: lo que se enlace de ahí sería NULL (cierre con rip 0). Que no quede nada.
if /usr/lib/llvm18/bin/llvm-readelf -d "$W/build/llvm-pie.elf" | grep -q 'libScePosixForWebKit'; then
  echo "El título importa de libScePosixForWebKit (en la consola sería NULL):"
  comm -12 <(/usr/lib/llvm18/bin/llvm-readelf --dyn-syms "$W/build/llvm-pie.elf" | awk '$7=="UND"{print $8}' | sed 's/@.*//' | sort -u) \
           <(/usr/lib/llvm18/bin/llvm-nm -D --defined-only "$W/.deps/native/ps5-payload-sdk/target/lib/libScePosixForWebKit.so" | awk '{print $NF}' | sort -u)
  exit 1
fi

if [[ ${1:-} != hello ]]; then
  # Lo que make push sube al payload, dentro del título: shims, SDK de Firebase, certificados y el juego
  # (index.html y las fuentes de js/, con js/env.js), con fuentes, iconos y sprites.
  # @step ps5/stage build "stage-game en dist"
  # ../ps5gpu/poke-title/dist/<ID> con el juego y update.seq.
  # @next ipq
  bash "$N/tools/stage-game.sh" "$W/dist/$ID"
fi
ls -la "$W/dist/$ID"
