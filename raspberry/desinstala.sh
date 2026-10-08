#!/usr/bin/env bash
#
# desinstala.sh — treu el servei i l'obertura automàtica del quiosc.
#     ~/ciencia-urv/desinstala.sh
#
# No esborra ~/ciencia-urv (hi ha la partida i la telemetria) ni torna a
# activar l'apagat de pantalla o a desactivar l'inici automàtic (es pot fer
# amb «sudo raspi-config» → System Options / Display Options).

set -euo pipefail
SERVEI="ciencia-urv"

sudo systemctl disable --now "$SERVEI" 2>/dev/null || true
sudo rm -f "/etc/systemd/system/$SERVEI.service"
sudo systemctl daemon-reload
rm -f "$HOME/.config/autostart/ciencia-urv-quiosc.desktop" \
      "$HOME/.local/share/applications/ciencia-urv.desktop"

echo "Desinstal·lat. Les dades són a ~/ciencia-urv; esborra la carpeta a mà si ja no les vols."
