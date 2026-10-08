#!/usr/bin/env bash
#
# exporta-telemetria.sh — copia la telemetria i l'estat de la partida a un
# llapis USB (si n'hi ha un de connectat) o, si no, a la carpeta personal.
#     ~/ciencia-urv/exporta-telemetria.sh
#
# Hi deixa telemetria.jsonl, estat.json, un resum (resum.txt) i un CSV per a Excel.

set -euo pipefail
cd "$(dirname "$0")"

[ -f data/telemetria.jsonl ] || { echo "Encara no hi ha telemetria (data/telemetria.jsonl)."; exit 1; }

USB="$(find "/media/$(id -un)" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1 || true)"
DESTI="${USB:-$HOME}/ciencia-urv-telemetria-$(date +%Y%m%d-%H%M)"
mkdir -p "$DESTI"

cp data/telemetria.jsonl "$DESTI/"
[ -f data/estat.json ] && cp data/estat.json "$DESTI/"
python3 eines/telemetria.py data/telemetria.jsonl --csv "$DESTI/telemetria.csv" > "$DESTI/resum.txt" \
    || echo "Avís: no s'ha pogut generar el resum (les dades sí que s'han copiat)."
sync

echo "Copiat a: $DESTI"
[ -n "$USB" ] && echo "Ja pots treure el llapis USB." || echo "(No s'ha trobat cap llapis USB; s'ha desat a la carpeta personal.)"
