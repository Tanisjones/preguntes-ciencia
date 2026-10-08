#!/usr/bin/env bash
#
# deploy.sh — puja el projecte al servidor i (re)desplega el contenidor.
#
# S'executa des del portàtil, a l'arrel del projecte:
#     ./deploy.sh
#
# Sincronitza els fitxers a $SERVIDOR:~/preguntes-ciencia, reconstrueix
# la imatge i reinicia el contenidor. L'estat de la partida (volum Docker) es
# conserva. Es pot tornar a executar sense problemes; s'atura al primer error.

set -euo pipefail
cd "$(dirname "$0")"

# Servidor (usuari@host): variable SERVIDOR o, si no hi és, el fitxer local .servidor
SERVIDOR="${SERVIDOR:-$(cat .servidor 2>/dev/null || true)}"
if [ -z "$SERVIDOR" ]; then
    echo "Cal indicar el servidor: SERVIDOR=usuari@host $0, o desa'l a .servidor" >&2
    exit 1
fi
DESTI="preguntes-ciencia"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Validant les preguntes en local ..."
python3 -c "import json; json.load(open('data/preguntes.json')); json.load(open('config.json'))"

echo "==> Sincronitzant fitxers amb $SERVIDOR:~/$DESTI ..."
rsync -az --delete \
    --exclude '.venv/' --exclude '.chrome-quiosc/' --exclude '__pycache__/' \
    --exclude '.DS_Store' --exclude 'data/estat.json' --exclude 'data/.estat-*' --exclude 'data/telemetria.jsonl' --exclude 'telemetria/' \
    --exclude '*.docx' --exclude 'urv-bandera-color.png' --exclude '.git/' --exclude 'dist/' --exclude '.servidor' \
    ./ "$SERVIDOR:$DESTI/"

echo "==> Construint i (re)engegant el contenidor ..."
ssh "$SERVIDOR" "set -e
    cd ~/$DESTI
    $COMPOSE up -d --build
    # Només les imatges penjants d'AQUEST projecte (no tocar les altres piles)
    docker image prune -f --filter label=com.docker.compose.project=preguntes-ciencia >/dev/null 2>&1 || true
    for i in \$(seq 1 20); do
        curl -fsS http://127.0.0.1:8092/api/salut >/dev/null 2>&1 && break
        sleep 1
    done
    echo '==> Estat:'
    $COMPOSE ps
    curl -fsS -o /dev/null -w 'http://127.0.0.1:8092/api/salut -> HTTP %{http_code}\n' http://127.0.0.1:8092/api/salut"

echo
echo "==> Desplegat. En línia a https://preguntes.ddns.net"
