#!/usr/bin/env bash
#
# telemetria.sh — descarrega la telemetria del servidor i en mostra el resum.
#
# S'executa des del portàtil, a l'arrel del projecte:
#     ./telemetria.sh                 resum
#     ./telemetria.sh --csv           resum + CSV per obrir amb Excel
#     ./telemetria.sh --des-de 2026-10-10
#
# El fitxer es desa a telemetria/telemetria-AAAAMMDD-HHMM.jsonl.

set -euo pipefail
cd "$(dirname "$0")"

# Servidor (usuari@host): variable SERVIDOR o, si no hi és, el fitxer local .servidor
SERVIDOR="${SERVIDOR:-$(cat .servidor 2>/dev/null || true)}"
if [ -z "$SERVIDOR" ]; then
    echo "Cal indicar el servidor: SERVIDOR=usuari@host $0, o desa'l a .servidor" >&2
    exit 1
fi
mkdir -p telemetria
DESTI="telemetria/telemetria-$(date +%Y%m%d-%H%M).jsonl"

echo "==> Descarregant la telemetria de $SERVIDOR ..."
ssh "$SERVIDOR" "cd ~/preguntes-ciencia && docker compose -f docker-compose.prod.yml exec -T joc cat /data/telemetria.jsonl" > "$DESTI"
echo "==> Desat a $DESTI ($(wc -l < "$DESTI" | tr -d ' ') esdeveniments)"
echo

ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --csv) ARGS+=(--csv "${DESTI%.jsonl}.csv") ;;
        *) ARGS+=("$1") ;;
    esac
    shift
done
python3 eines/telemetria.py "$DESTI" ${ARGS[@]+"${ARGS[@]}"}
