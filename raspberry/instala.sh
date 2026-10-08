#!/usr/bin/env bash
#
# instala.sh — instal·la «Ciència a la URV» en una Raspberry Pi en mode quiosc.
#
# S'executa a la Raspberry Pi, des de la carpeta descomprimida, com a usuari
# normal (no amb sudo; ja demanarà la contrasenya quan calgui):
#     bash instala.sh
#
# Què fa:
#   1. Instal·la el que falti del sistema (Chromium, python3-venv).
#   2. Copia el joc a ~/ciencia-urv.
#   3. Crea el servei «ciencia-urv», que engega el servidor en arrencar.
#   4. Fa que, en entrar a l'escriptori, s'obri Chromium a pantalla completa.
#   5. Activa l'inici de sessió automàtic i desactiva l'apagat de pantalla.
#
# Es pot tornar a executar per actualitzar: es conserven la partida en curs i
# la telemetria (~/ciencia-urv/data/estat.json i telemetria.jsonl).

set -euo pipefail

ORIGEN="$(cd "$(dirname "$0")" && pwd)"
DESTI="$HOME/ciencia-urv"
PORT="${PORT:-8000}"
USUARI="$(id -un)"
SERVEI="ciencia-urv"

pas()   { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
avis()  { printf '\033[1;33mAvís: %s\033[0m\n' "$*"; }
error() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# --- Comprovacions -----------------------------------------------------------

[ "$(id -u)" -ne 0 ] || error "No l'executis amb sudo. Executa'l com l'usuari normal: bash instala.sh"
[ "$(uname -s)" = Linux ] || error "Aquest script és per a la Raspberry Pi (Linux)."
[ -f "$ORIGEN/app/app.py" ] || error "No trobo app/app.py. Executa l'script des de la carpeta descomprimida."
grep -qai raspberry /proc/device-tree/model 2>/dev/null || avis "No sembla una Raspberry Pi; continuo igualment."
if [ ! -d /usr/share/wayland-sessions ] && [ ! -d /usr/share/xsessions ]; then
    error "No hi ha escriptori gràfic. Cal «Raspberry Pi OS with desktop» (no la versió Lite)."
fi
case "$DESTI" in *" "*) error "El nom de la carpeta personal ($HOME) té espais; no és compatible." ;; esac

echo "Instal·lant «Ciència a la URV» per a l'usuari $USUARI a $DESTI"
echo "(Si et demana la contrasenya, és la de l'usuari de la Raspberry Pi.)"
sudo -v

# --- 1. Paquets del sistema --------------------------------------------------

pas "Comprovant els paquets del sistema"
PAQUETS=()
python3 -c 'import venv, ensurepip' 2>/dev/null || PAQUETS+=(python3-venv)
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
    # Bookworm: chromium-browser; Trixie i posteriors: chromium
    if apt-cache policy chromium-browser 2>/dev/null | grep -q 'Candidate: [0-9]'; then
        PAQUETS+=(chromium-browser)
    else
        PAQUETS+=(chromium)
    fi
fi
if [ ${#PAQUETS[@]} -gt 0 ]; then
    echo "Cal instal·lar: ${PAQUETS[*]} (necessita internet)"
    sudo apt-get update
    sudo apt-get install -y "${PAQUETS[@]}"
else
    echo "Tot el necessari ja hi és."
fi

# --- 2. Fitxers del joc ------------------------------------------------------

pas "Copiant el joc a $DESTI"
mkdir -p "$DESTI/data"
rm -rf "$DESTI/static" "$DESTI/eines"
cp -R "$ORIGEN/app/." "$DESTI/"
cp "$ORIGEN/quiosc.sh" "$ORIGEN/exporta-telemetria.sh" "$ORIGEN/desinstala.sh" "$DESTI/"
sed -i "s/^PORT=.*/PORT=$PORT/" "$DESTI/quiosc.sh"
chmod +x "$DESTI"/*.sh
[ -f "$DESTI/data/estat.json" ] && echo "Es conserva la partida en curs (data/estat.json)."

# --- 3. Python i servei ------------------------------------------------------

pas "Preparant l'entorn de Python"
[ -x "$DESTI/.venv/bin/python" ] || python3 -m venv "$DESTI/.venv"
# Primer, amb els paquets inclosos al zip (no cal internet)
if ! "$DESTI/.venv/bin/pip" install -q --no-index --find-links "$ORIGEN/wheels" -r "$DESTI/requirements.txt" 2>/dev/null; then
    avis "Els paquets inclosos no serveixen per a aquest sistema; els descarrego d'internet."
    "$DESTI/.venv/bin/pip" install -q -r "$DESTI/requirements.txt"
fi

pas "Creant el servei $SERVEI (s'engega sol en arrencar)"
sudo tee "/etc/systemd/system/$SERVEI.service" >/dev/null <<EOF
[Unit]
Description=Ciència a la URV (joc de preguntes)
After=network.target

[Service]
User=$USUARI
WorkingDirectory=$DESTI
Environment=PYTHONUNBUFFERED=1
# Un sol worker: l'estat és un fitxer i el lock és per procés
ExecStart=$DESTI/.venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:$PORT app:app
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVEI" >/dev/null 2>&1
sudo systemctl restart "$SERVEI"

echo -n "Esperant que el servidor respongui "
for i in $(seq 1 30); do
    if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/api/salut', timeout=2)" 2>/dev/null; then
        echo " OK"
        break
    fi
    echo -n "."
    sleep 1
    if [ "$i" -eq 30 ]; then
        echo
        sudo journalctl -u "$SERVEI" -n 30 --no-pager || true
        error "El servidor no respon. Mira els missatges de dalt."
    fi
done

# --- 4. Quiosc ---------------------------------------------------------------

pas "Configurant l'obertura automàtica a pantalla completa"
mkdir -p "$HOME/.config/autostart" "$HOME/.local/share/applications"
cat > "$HOME/.config/autostart/ciencia-urv-quiosc.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Ciència a la URV (quiosc)
Exec=$DESTI/quiosc.sh
X-GNOME-Autostart-enabled=true
EOF
# Entrada al menú d'aplicacions (Jocs) per tornar-lo a obrir a mà
cat > "$HOME/.local/share/applications/ciencia-urv.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Ciència a la URV
Comment=Obre el joc a pantalla completa
Exec=$DESTI/quiosc.sh
Icon=$DESTI/static/img/icona.svg
Categories=Game;
EOF

# --- 5. Inici automàtic i pantalla -------------------------------------------

pas "Activant l'inici de sessió automàtic i desactivant l'apagat de pantalla"
if command -v raspi-config >/dev/null; then
    sudo raspi-config nonint do_boot_behaviour B4 && echo "Inici automàtic a l'escriptori: activat."
    sudo raspi-config nonint do_blanking 1 && echo "Apagat de pantalla: desactivat."
else
    avis "No hi ha raspi-config: activa a mà l'inici de sessió automàtic i desactiva l'apagat de pantalla."
fi

# --- Fet ---------------------------------------------------------------------

pas "Instal·lació completada"
cat <<EOF
El joc s'obrirà sol a pantalla completa cada vegada que s'engegui la Raspberry Pi.

  - Sortir del quiosc:   Alt+F4 dues vegades seguides (amb una, es torna a obrir sol)
  - Tornar-lo a obrir:   menú → Jocs → Ciència a la URV  (o reiniciar)
  - Telemetria a USB:    ~/ciencia-urv/exporta-telemetria.sh
EOF
echo
if [ -t 0 ]; then
    read -r -p "Cal reiniciar per acabar. Reinicio ara? [S/n] " resp
    case "${resp:-s}" in
        [sSyY]*) sudo reboot ;;
        *) echo "D'acord. Reinicia quan vulguis amb: sudo reboot" ;;
    esac
else
    echo "Reinicia per acabar: sudo reboot"
fi
