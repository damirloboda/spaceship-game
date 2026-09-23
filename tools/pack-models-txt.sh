#!/bin/sh
# Writes base64 copies of assets/models/*.glb as <name>.glb.txt into $1, for
# hosts that refuse to serve .glb files (the loader falls back to them).
set -e
out="${1:?usage: tools/pack-models-txt.sh <outDir>}"
mkdir -p "$out"
for f in assets/models/*.glb; do base64 -w0 "$f" > "$out/$(basename "$f").txt"; done
