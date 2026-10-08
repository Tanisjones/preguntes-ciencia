#!/usr/bin/env bash
#
# quiosc.sh — obre el joc a pantalla completa (Chromium en mode quiosc).
#
# S'executa sol en entrar a l'escriptori. Si es tanca el navegador, es torna a
# obrir. Per sortir del tot: Alt+F4 dues vegades seguides (la segona, abans de
# 20 segons des que s'ha tornat a obrir).

PORT=8000
URL="http://127.0.0.1:$PORT"
PERFIL="$HOME/.config/ciencia-urv-chromium"
CHROMIUM="$(command -v chromium || command -v chromium-browser)"

# Espera que el servidor respongui (fins a 60 s)
for _ in $(seq 1 60); do
    python3 -c "import urllib.request; urllib.request.urlopen('$URL/api/salut', timeout=2)" 2>/dev/null && break
    sleep 1
done

# Escriptori X11 (sistemes antics): que no s'apagui la pantalla
command -v xset >/dev/null && xset s off -dpms s noblank 2>/dev/null

while true; do
    # Evita l'avís «Restaurar pàgines?» si el navegador es va tancar malament
    sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
        "$PERFIL/Default/Preferences" 2>/dev/null
    inici=$(date +%s)
    "$CHROMIUM" --kiosk "$URL" \
        --user-data-dir="$PERFIL" \
        --no-first-run --no-default-browser-check --noerrdialogs --disable-infobars \
        --disable-session-crashed-bubble --disable-features=Translate \
        --overscroll-history-navigation=0 --disable-pinch \
        --password-store=basic --check-for-update-interval=31536000 \
        >/dev/null 2>&1
    # Si s'ha tancat poc després d'obrir-se, és que es vol sortir
    [ $(( $(date +%s) - inici )) -ge 20 ] || break
    sleep 2
done
