#!/usr/bin/env bash
# Engega el joc en local.  Ús:  ./engega.sh            (només servidor)
#                               ./engega.sh --quiosc   (i obre Chrome a pantalla completa)
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

if [ ! -d .venv ]; then
  echo "Creant l'entorn virtual..."
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt

if [ "$1" = "--quiosc" ]; then
  URL="http://localhost:$PORT"
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ( sleep 2
    if [ -x "$CHROME" ]; then
      "$CHROME" --kiosk --app="$URL" --user-data-dir="$PWD/.chrome-quiosc" --no-first-run >/dev/null 2>&1
    elif command -v google-chrome >/dev/null; then
      google-chrome --kiosk --app="$URL" --user-data-dir="$PWD/.chrome-quiosc" --no-first-run >/dev/null 2>&1
    else
      echo "No s'ha trobat Chrome: obre $URL manualment."
    fi ) &
fi

PORT="$PORT" exec .venv/bin/python app.py
