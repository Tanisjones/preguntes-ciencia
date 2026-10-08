#!/usr/bin/env bash
#
# empaqueta-raspberry.sh — prepara el zip per instal·lar el joc en una
# Raspberry Pi en mode quiosc (vegeu raspberry/LLEGEIX-ME.txt).
#
# S'executa des del portàtil, a l'arrel del projecte:
#     ./empaqueta-raspberry.sh
#
# Genera dist/ciencia-urv-raspberry.zip. Inclou els paquets de Python per a
# Raspberry Pi OS (32 i 64 bits, Python 3.11 i 3.13), així la instal·lació no
# necessita internet.

set -euo pipefail
cd "$(dirname "$0")"

NOM="ciencia-urv-raspberry"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PAQUET="$TMP/$NOM"

echo "==> Validant les preguntes i la configuració ..."
python3 -c "import json; json.load(open('data/preguntes.json')); json.load(open('config.json'))"

echo "==> Copiant fitxers ..."
mkdir -p "$PAQUET/app/data" "$PAQUET/app/eines"
cp app.py config.json requirements.txt "$PAQUET/app/"
cp data/preguntes.json "$PAQUET/app/data/"
cp eines/telemetria.py "$PAQUET/app/eines/"
rsync -a --exclude '.DS_Store' static/ "$PAQUET/app/static/"
cp raspberry/*.sh raspberry/LLEGEIX-ME.txt "$PAQUET/"
chmod +x "$PAQUET"/*.sh

echo "==> Descarregant els paquets de Python per a la Raspberry Pi ..."
for py in 311 313; do
    for plataforma in "manylinux_2_17_aarch64" "manylinux_2_17_armv7l"; do
        pip3 download -q -d "$PAQUET/wheels" --only-binary=:all: \
            --platform "$plataforma" --python-version "$py" --implementation cp \
            -r requirements.txt
    done
done

echo "==> Comprimint ..."
mkdir -p dist
rm -f "dist/$NOM.zip"
(cd "$TMP" && zip -qrX - "$NOM") > "dist/$NOM.zip"

echo "==> Fet: dist/$NOM.zip ($(du -h "dist/$NOM.zip" | cut -f1))"
