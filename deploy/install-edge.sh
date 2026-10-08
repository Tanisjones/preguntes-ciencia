#!/usr/bin/env bash
# Instal·la el vhost de preguntes.ddns.net al nginx d'entrada i en demana el
# certificat HTTPS. S'executa UNA vegada al servidor, amb sudo:
#
#     sudo bash ~/preguntes-ciencia/deploy/install-edge.sh
#
# Segur: si `nginx -t` falla, treu el fitxer i no recarrega nginx.
set -euo pipefail

DOMINI="preguntes.ddns.net"
SRC="/home/jduch/preguntes-ciencia/deploy/$DOMINI.conf"
DST="/etc/nginx/conf.d/$DOMINI.conf"

if [ "$(id -u)" -ne 0 ]; then
    echo "Cal executar-ho amb sudo." >&2
    exit 1
fi

if [ -f "$DST" ]; then
    echo "==> $DST ja existeix: no el toco (certbot ja l'haurà modificat)."
else
    echo "==> Instal·lant $DST"
    cp "$SRC" "$DST"
fi

echo "==> Comprovant la configuració de nginx"
if ! nginx -t; then
    echo "!! nginx -t ha fallat — trec el vhost i deixo nginx com estava." >&2
    rm -f "$DST"
    exit 1
fi

echo "==> Recarregant nginx"
systemctl reload nginx

echo "==> Demanant el certificat HTTPS (Let's Encrypt)"
certbot --nginx -d "$DOMINI" --redirect

echo "==> Fet. Comprovació:"
curl -sS -o /dev/null -w "https://$DOMINI/api/salut -> HTTP %{http_code}\n" "https://$DOMINI/api/salut" || true
