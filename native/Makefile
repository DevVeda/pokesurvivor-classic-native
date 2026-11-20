# PokéSurvivor nativo para PS5 (ver native/README.md).
#   make -C native            compila eboot.elf
#   make -C native push       sube eboot.elf, los shims y el código del juego (PS5_HOST=<IP de tu PS5>)
#   make -C native sprites    sube también assets/pokemon (13 500 archivos: la primera vez o si cambian)
#   make -C native log        baja native/log.txt (lo que escribieron el programa y el juego)

# Por defecto, el SDK con las librerías de ps5-payload-dev (native/README.md) y el LLVM 18 de Homebrew.
PS5_PAYLOAD_SDK ?= $(HOME)/ps5-payload-dev/opt/ps5-payload-sdk
LLVM_CONFIG     ?= /opt/homebrew/opt/llvm@18/bin/llvm-config
export LLVM_CONFIG

# (core-test, vendor y webrtc-src no necesitan el SDK de la PS5: se compila con el cc del sistema; así corre también en la CI)
ifeq ($(filter-out core-test build/core-test vendor webrtc-src,$(or $(MAKECMDGOALS),eboot.elf)),)
else ifdef PS5_PAYLOAD_SDK
    include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
else
    $(error PS5_PAYLOAD_SDK is undefined)
endif

# La IP de tu PS5 (sin valor por defecto: make push PS5_HOST=<IP>). Sólo la piden push, log y sprites.
PS5_HOST ?= $(error falta PS5_HOST: la IP de tu PS5, p. ej. make -C native push PS5_HOST=<IP>)
PS5_PORT ?= 2121
.DEFAULT_GOAL := eboot.elf
FTP       = ftp://$(PS5_HOST):$(PS5_PORT)/data/homebrew/PokeSurvivorNative
HB       := $(PS5_PAYLOAD_SDK)/target/user/homebrew
PVG      := third_party/plutovg

SRCS   := main.c platform/ps5.c canvas.c gpu_vk.c audio.c tiles_worker.c net.c webrtc.c core_js.c update.c third_party/monocypher/monocypher.c third_party/monocypher/monocypher-ed25519.c core/world.c core/sim.c core/combat.c core/pickup.c core/abil.c core/foe.c core/map.c core/data.c $(wildcard $(PVG)/source/*.c)

# WebRTC para el cooperativo: libdatachannel con libjuice (ICE) y usrsctp (SCTP), sin vídeo/audio ni WebSocket
# (make webrtc-src baja el código). Sin CMake: se compila aquí con las mismas opciones que pone su CMakeLists.
DC     := third_party/libdatachannel
SCTP   := $(DC)/deps/usrsctp/usrsctplib
JUICE  := $(DC)/deps/libjuice
RTC_C_SCTP  := $(wildcard $(SCTP)/netinet/*.c $(SCTP)/netinet6/*.c $(SCTP)/user_*.c)
RTC_C_JUICE := $(filter-out %/server.c,$(wildcard $(JUICE)/src/*.c))
RTC_CXX     := $(wildcard $(DC)/src/*.cpp $(DC)/src/impl/*.cpp)
RTC_OBJS    := $(patsubst %,build/%.o,$(RTC_C_SCTP) $(RTC_C_JUICE) $(RTC_CXX))
SCTP_FLAGS  := -D__Userspace__ -DSCTP_SIMPLE_ALLOCATOR -DSCTP_PROCESS_LEVEL_LOCKS '-DSCTP_STDINT_INCLUDE=<stdint.h>' \
               -DHAVE_SYS_QUEUE_H -DHAVE_SA_LEN -DHAVE_SIN_LEN -DHAVE_SIN6_LEN -DHAVE_SCONN_LEN \
               -DHAVE_NETINET_IP_ICMP_H -DHAVE_NET_ROUTE_H -DHAVE_STDATOMIC_H -I$(SCTP)
JUICE_FLAGS := -DJUICE_STATIC -DJUICE_EXPORTS -DUSE_NETTLE=0 -DNO_SERVER -DRELEASE=1 -I$(JUICE)/include/juice -I$(JUICE)/include
DC_FLAGS    := -std=c++17 -DRTC_STATIC -DRTC_EXPORTS -DRTC_ENABLE_MEDIA=0 -DRTC_ENABLE_WEBSOCKET=0 -DUSE_GNUTLS=0 \
               -DUSE_MBEDTLS=0 -DUSE_NICE=0 -DRTC_SYSTEM_SRTP=0 -DJUICE_STATIC -I$(DC)/include -I$(DC)/include/rtc \
               -I$(DC)/src -I$(DC)/deps/plog/include -I$(JUICE)/include -I$(SCTP) `$(PKG_CONFIG) --cflags openssl`
# Código de otros: sin sus avisos.
build/$(SCTP)/%.c.o: $(SCTP)/%.c
	@mkdir -p $(@D); $(CC) -O2 -w $(SCTP_FLAGS) -c -o $@ $<
build/$(JUICE)/%.c.o: $(JUICE)/%.c
	@mkdir -p $(@D); $(CC) -O2 -w $(JUICE_FLAGS) -c -o $@ $<
build/$(DC)/src/%.cpp.o: $(DC)/src/%.cpp
	@mkdir -p $(@D); $(CXX) -O2 -w $(DC_FLAGS) -c -o $@ $<
build/libdatachannel.a: $(RTC_OBJS)
	@[ -n "$(RTC_CXX)" ] || { echo "Falta $(DC): make -C native webrtc-src"; exit 1; }
	rm -f $@; $(AR) rcs $@ $^
# pkg-config y no sdl2-config: éste trae /opt/ps5-payload-sdk escrito a fuego.
CFLAGS := -Wall -Wno-unused-function -O2 -DPS5_DEV -I. -Icore -Ithird_party/monocypher -I$(HB)/include/quickjs -I$(PVG)/include -I$(DC)/include -DPLUTOVG_BUILD -DPLUTOVG_BUILD_STATIC \
          `$(PKG_CONFIG) --cflags sdl2 libcurl`
LDADD  := build/libdatachannel.a `$(PKG_CONFIG) --libs --static sdl2 libcurl openssl` -L$(HB)/lib/quickjs -lquickjs -lm -lkernel_sys -lSceSystemService -Wl,--wrap=getaddrinfo -Wl,--wrap=freeaddrinfo

# Con clang++ para enlazar: libdatachannel es C++ (libc++).
eboot.elf: $(SRCS) platform.h canvas.h gpu.h audio.h tiles_worker.h net.h webrtc.h update.h core/core.h build/libdatachannel.a
	$(CXX) -x c $(CFLAGS) $(SRCS) -x none -o $@ $(LDADD)

# El juego: index.html y las fuentes de js/ sueltas (boot.js; js/app.js es de la web, no se sube).
# Por tandas de 500 (cada una, un curl que reutiliza la conexión), y entre tandas se ve el avance.
push: eboot.elf
	cd .. && { \
	  up() { printf 'upload-file = "%s"\nurl = "$(FTP)/%s"\n' "$$1" "$$2"; }; \
	  up native/eboot.elf eboot.elf; up assets/icons/icon-512.png sce_sys/icon0.png; \
	  for f in native/shim/*.js; do up $$f shim/$${f##*/}; done; \
	  for f in native/vendor/firebase/*.js; do up $$f vendor/firebase/$${f##*/}; done; \
	  [ -f native/vendor/cacert.pem ] && up native/vendor/cacert.pem cacert.pem; \
	  for f in index.html version.json assets/fonts/*.ttf $$(find js -name '*.js' ! -path js/app.js); do up $$f game/$$f; done; \
	  if [ -n "$(SPRITES)" ]; then find $(SPRITE_DIRS) -type f ! -name '.*' | while read -r f; do up "$$f" "game/$$f"; done; fi; \
	} > native/.push.curlrc && n=$$(grep -c '^url' native/.push.curlrc) && echo "Subiendo $$n archivos..." && \
	split -l 1000 native/.push.curlrc native/.push.part. && done=0 && \
	for p in native/.push.part.*; do \
	  curl -sS --fail --ftp-create-dirs --disable-epsv --connect-timeout 5 -K $$p || { rm -f native/.push.*; exit 1; }; \
	  done=$$((done + $$(grep -c '^url' $$p))); echo "  $$done / $$n"; \
	done; rm -f native/.push.*

# Sólo unas carpetas (rutas desde la raíz del repo), p. ej. las skins nuevas:
#   make -C native push SPRITES=1 SPRITE_DIRS="assets/pokemon/94/k-bruja-gengar assets/pokemon/25/k-bruja-pikachu"
SPRITE_DIRS ?= assets/pokemon assets/icons
sprites:
	$(MAKE) push SPRITES=1

# Lo que se incluye para jugar online (una vez): el SDK de Firebase que carga la web (js/core/db.js, misma
# versión, de gstatic) y los certificados raíz para comprobar HTTPS (los del Mac, /etc/ssl/cert.pem).
FIREBASE_SDK := https://www.gstatic.com/firebasejs/13.0.0
vendor:
	mkdir -p vendor/firebase
	for f in app auth firestore database; do curl -sSf -o vendor/firebase/firebase-$$f-compat.js $(FIREBASE_SDK)/firebase-$$f-compat.js || exit 1; done
	cp /etc/ssl/cert.pem vendor/cacert.pem 2>/dev/null || cp /etc/ssl/certs/ca-certificates.crt vendor/cacert.pem   # (macOS / Ubuntu)
	ls -la vendor vendor/firebase

# El código de libdatachannel (WebRTC: el cooperativo, js/net/net.js) y sus dependencias, en las versiones
# que fija su v0.22.5 (los submódulos: el commit de cada uno, de la API de GitHub). Paquetes .tar.gz, sin git.
LIBDC_VER := v0.22.5
LIBDC     := third_party/libdatachannel
webrtc-src:
	rm -rf $(LIBDC) && mkdir -p $(LIBDC)
	curl -sSfL https://codeload.github.com/paullouisageneau/libdatachannel/tar.gz/refs/tags/$(LIBDC_VER) | tar xz --strip-components=1 -C $(LIBDC)
	for d in libjuice usrsctp plog; do \
	  info=$$(curl -sSf --retry 3 $${GITHUB_TOKEN:+-H "Authorization: Bearer $$GITHUB_TOKEN"} "https://api.github.com/repos/paullouisageneau/libdatachannel/contents/deps/$$d?ref=$(LIBDC_VER)") || exit 1; \
	  sha=$$(printf '%s' "$$info" | python3 -c "import json,sys; print(json.load(sys.stdin)['sha'])"); \
	  repo=$$(printf '%s' "$$info" | python3 -c "import json,sys,re; print(re.sub(r'^https://github.com/|\\.git$$','',json.load(sys.stdin)['submodule_git_url']))"); \
	  echo "$$d: $$repo @ $$sha"; \
	  mkdir -p $(LIBDC)/deps/$$d && curl -sSfL https://codeload.github.com/$$repo/tar.gz/$$sha | tar xz --strip-components=1 -C $(LIBDC)/deps/$$d || exit 1; \
	done
	# Nuestros arreglos a libdatachannel y sus dependencias (patches/*.patch, p. ej. libjuice-unreachable.patch).
	for p in patches/*.patch; do patch -p1 -d $(LIBDC) < $$p || exit 1; done
	du -sh $(LIBDC)

# SDL las abre al arrancar (dlopen); el cargador del SDK las busca en /user/homebrew/lib.
# En un payload no sirven (la GPU no se deja, ver native/TITLE.md); se quedan por si se vuelve a probar.
MESA := libEGL.so.1 libGL.so.1 libGLESv2.so.2 libgallium-26.2.0.so libvulkan.so.1
mesa:
	for f in $(MESA); do curl -sS --ftp-create-dirs -T $(HB)/lib/$$f ftp://$(PS5_HOST):2121/user/homebrew/lib/$$f || exit 1; echo $$f; done

log:
	curl -sS $(FTP)/log.txt -o log.txt && cat log.txt

clean:
	rm -f eboot.elf log.txt

# Núcleo de la partida en C (CORE.md): se compila en el Mac y se compara con el JS (sale con 1 si algo difiere).
# core/data.c sale de las fuentes de js/:node tools/export-core.cjs
CORE := core/world.c core/sim.c core/combat.c core/pickup.c core/abil.c core/foe.c core/map.c core/data.c
core-test: build/core-test
	node core/bench-world.cjs && node core/bench-sim.cjs && node core/bench-combat.cjs && node core/bench-pickup.cjs && node core/bench-abil.cjs && node core/bench-foe.cjs && node core/bench-map.cjs
build/core-test: core/test.c $(CORE) core/core.h
	mkdir -p build && cc -std=c17 -O2 -ffp-contract=off -Wall -Wextra -o $@ core/test.c $(CORE) -lm

.PHONY: push sprites mesa log clean core-test
