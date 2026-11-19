#!/bin/sh
# Sube el título de ejemplo de PS5_VulkanTemplate (PPSA99130, "Vulkan Template") a /data/homebrew,
# para comprobar en la consola que un título con GPU (RADV) arranca. Ver native/TITLE.md.
#   native/title/push-template.sh [IP-PS5]
# Después: ShadowMount+ lo registra y sale "Vulkan Template" en el inicio (si no, volver a cargar ShadowMount+).
set -eu
PS5=${1:-${PS5_HOST:?falta la IP de la PS5: push-template.sh <IP> (o PS5_HOST)}}
SRC=${PS5GPU:-$(cd "$(dirname "$0")/../../.." && pwd)/ps5gpu}/PS5_VulkanTemplate/dist   # (ps5gpu, al lado del repo)
FTP="ftp://$PS5:2121/data/homebrew"
cd "$SRC"
CFG=$(mktemp "${TMPDIR:-/tmp}/ppsa.XXXXXX")
trap 'rm -f "$CFG"' EXIT
find PPSA99130 -type f | while IFS= read -r f; do printf 'upload-file = "%s"\nurl = "%s/%s"\n' "$f" "$FTP" "$f"; done > "$CFG"
echo "Subiendo $(grep -c '^url' "$CFG") archivos (218 MB)..."
curl -sS --fail --ftp-create-dirs --disable-epsv --connect-timeout 5 -K "$CFG"
# Sin permisos 777 la consola dice CE-107750-0 al abrirlo (lo avisa PSXS5).
find PPSA99130 -type d | while IFS= read -r d; do printf -- '-Q "SITE CHMOD 777 /data/homebrew/%s"\n' "$d"; done > "$CFG"
find PPSA99130 -type f | while IFS= read -r f; do printf -- '-Q "SITE CHMOD 777 /data/homebrew/%s"\n' "$f"; done >> "$CFG"
curl -sS --disable-epsv -K "$CFG" "$FTP/" > /dev/null || echo "Aviso: no se pudieron poner permisos 777 por FTP; ponlos con el explorador de archivos de la consola."
echo "Hecho: /data/homebrew/PPSA99130"
