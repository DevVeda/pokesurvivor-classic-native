# Compila install.elf (instala el icono de PokéSurvivor en la PS5).
#   make -C tools/ps5/install        (necesita PS5_PAYLOAD_SDK y LLVM 18; ver tools/ps5/README.md)
# REPORT: dónde manda el diagnóstico su informe (tools/ps5/probe-recv.cjs en el Mac).

# Por defecto, el SDK con las librerías de ps5-payload-dev (native/README.md) y el LLVM 18 de Homebrew.
PS5_PAYLOAD_SDK ?= $(HOME)/ps5-payload-dev/opt/ps5-payload-sdk
LLVM_CONFIG     ?= /opt/homebrew/opt/llvm@18/bin/llvm-config
export LLVM_CONFIG

ifdef PS5_PAYLOAD_SDK
    include $(PS5_PAYLOAD_SDK)/toolchain/prospero.mk
else
    $(error PS5_PAYLOAD_SDK is undefined)
endif

MAC    ?= $(shell ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
REPORT ?= http://$(MAC):8787
URL    := http://127.0.0.1:8080/fs/data/homebrew/PokeSurvivor/probe.html?report=$(REPORT)

install.elf: main.c
	$(CC) -Wall -Werror -O2 -DSTART_URL='"$(URL)"' -o $@ $^ -lkernel_sys -lSceUserService -lSceAppInstUtil

clean:
	rm -f install.elf
