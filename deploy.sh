#!/usr/bin/env bash
#
# deploy.sh — desplega al servidor la versió publicada a GitHub.
#
# S'executa des del portàtil, a l'arrel del projecte:
#     ./deploy.sh
#
# Comprova que no hi hagi canvis sense fer commit, puja els commits pendents a
# GitHub i, al servidor, posa ~/preguntes-ciencia exactament en aquest commit
# (git fetch + reset), reconstrueix la imatge i reinicia el contenidor. L'estat
# de la partida (volum Docker) es conserva. Es pot tornar a executar sense
# problemes; s'atura al primer error.

set -euo pipefail
cd "$(dirname "$0")"

# Servidor (usuari@host): variable SERVIDOR o, si no hi és, el fitxer local .servidor
SERVIDOR="${SERVIDOR:-$(cat .servidor 2>/dev/null || true)}"
if [ -z "$SERVIDOR" ]; then
    echo "Cal indicar el servidor: SERVIDOR=usuari@host $0, o desa'l a .servidor" >&2
    exit 1
fi
REPO="https://github.com/Tanisjones/preguntes-ciencia.git"
BRANCA="main"
DESTI="preguntes-ciencia"
COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> Validant les preguntes en local ..."
python3 -c "import json; json.load(open('data/preguntes.json')); json.load(open('config.json'))"

echo "==> Comprovant el repositori local ..."
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCA" ]; then
    echo "Cal ser a la branca $BRANCA per desplegar." >&2
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "Hi ha canvis sense commit. Fes primer:" >&2
    echo "    git add -A && git commit -m \"...\"" >&2
    git status --short >&2
    exit 1
fi
git push -q origin "$BRANCA"
COMMIT="$(git rev-parse HEAD)"
echo "    Commit a desplegar: $(git log -1 --format='%h %s')"

echo "==> Actualitzant el codi al servidor des de GitHub ..."
ssh "$SERVIDOR" "set -e
    mkdir -p ~/$DESTI
    cd ~/$DESTI
    if [ ! -d .git ]; then
        echo '    (primera vegada: convertint la carpeta en un clon del repositori)'
        git init -q -b $BRANCA
        git remote add origin $REPO
    fi
    git remote set-url origin $REPO
    git fetch -q origin $BRANCA
    git reset -q --hard $COMMIT
    git log -1 --format='    Servidor a: %h %s'"

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
