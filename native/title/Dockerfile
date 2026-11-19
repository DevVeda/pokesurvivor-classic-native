# Entorno Linux x86-64 para compilar el título de PS5 (ver native/TITLE.md).
# Las herramientas de la escena (PS5_Vulkan, PS5_VulkanTemplate, el conversor/firmador)
# son de Linux x86-64; en el Mac M4 corre emulado.
#   docker build --platform linux/amd64 -t ps5title native/title
#   docker run --rm -it --platform linux/amd64 -v "$PWD/../ps5gpu":/work ps5title
FROM --platform=linux/amd64 archlinux:latest
# El sandbox de pacman 7 no funciona bajo la emulación x86-64 de Docker en Apple Silicon.
RUN sed -i '/^\[options\]/a DisableSandbox' /etc/pacman.conf
RUN pacman -Syu --noconfirm --needed base-devel clang llvm lld make python git curl wget unzip \
      tar pkgconf cmake glslang rsync zstd ninja meson python-numpy python-pillow python-mako \
      python-markupsafe python-pyelftools python-yaml \
      spirv-llvm-translator libclc spirv-tools spirv-headers python-packaging \
      clang18 llvm18 lld18 && pacman -Scc --noconfirm
RUN git config --global --add safe.directory '*'
# La plantilla compila con clang 18: el glm de sus ejemplos no compila con clang 23.
ENV PS5_CLANG=/usr/lib/llvm18/bin/clang
WORKDIR /work
