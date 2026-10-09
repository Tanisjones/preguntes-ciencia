# Ciència a la URV

Joc de preguntes per a l'estand de la URV. La pantalla inicial és una ciutat animada amb una graella de «locals» (una pregunta cadascun). En respondre, es mostra si és correcta i l'explicació, i el local abaixa la persiana:

- **groga amb ✓** si s'ha encertat;
- **gris fosc amb ✗** si s'ha fallat.

L'estat es desa al servidor, a `data/estat.json`, i es manté encara que es reiniciï el servidor o el navegador.

## Engegar en local (portàtil)

```bash
./engega.sh
```

Obre <http://localhost:8000> i toca la pantalla per entrar a pantalla completa. Ctrl+C atura el servidor.

Per obrir directament Chrome en mode quiosc (pantalla completa sense barres):

```bash
./engega.sh --quiosc
```

Per sortir del mode quiosc: Cmd+Q.

**Tauleta a la mateixa wifi:** obre `http://<IP-del-portàtil>:8000`. A l'iPad, si fas «Compartir → Afegir a la pantalla d'inici», el joc s'obre a pantalla completa com una app.

## Raspberry Pi amb monitor (quiosc)

```bash
./empaqueta-raspberry.sh
```

Genera `dist/ciencia-urv-raspberry.zip`, el paquet per a la persona que munta la Raspberry Pi. Conté el joc, els paquets de Python (la instal·lació no necessita internet) i les instruccions (`LLEGEIX-ME.txt`). A la Raspberry Pi n'hi ha prou de descomprimir-lo i executar `bash instala.sh`. Això:
- crea el servei `ciencia-urv` (gunicorn a `127.0.0.1:8000`);
- obre Chromium en mode quiosc en entrar a l'escriptori;
- activa l'inici de sessió automàtic i desactiva l'apagat de pantalla.

El joc queda a `~/ciencia-urv`. Els scripts d'origen són a `raspberry/`.

## Desplegar amb Docker (servidor)

```bash
docker compose up -d --build
```

- El joc queda al port 8000. Per canviar-lo: `PORT=8080 docker compose up -d`.
- L'estat es desa al volum `estat`, i es manté entre reinicis i actualitzacions.
- `config.json` i `data/preguntes.json` es munten des de la carpeta. Si els edites, n'hi ha prou de recarregar la pàgina: no cal reconstruir la imatge.
- Aturar: `docker compose down`. L'estat es conserva; per esborrar-lo també: `docker compose down -v`.

**Seguretat:** el joc no té cap autenticació. Qualsevol persona que arribi a la URL pot jugar o reiniciar. Si el servidor és públic, posa'l darrere d'un proxy amb contrasenya o restringeix-ne l'accés per IP.

## Producció: preguntes.ddns.net

Al servidor de producció el joc funciona igual que els altres projectes:
- el codi és a `~/preguntes-ciencia`, un clon d'aquest repositori de GitHub;
- `docker-compose.prod.yml` el publica només a `127.0.0.1:8092`;
- el nginx del host fa el TLS de `preguntes.ddns.net` i hi fa de proxy.

**Desplegar o actualitzar** (des del portàtil, a l'arrel del projecte):

```bash
echo 'usuari@servidor' > .servidor   # només la primera vegada (no es puja a git)
./deploy.sh
```

`deploy.sh` i `telemetria.sh` llegeixen el servidor de la variable `SERVIDOR` o, si no hi és, del fitxer local `.servidor`.

El servidor agafa el codi de GitHub, no del portàtil:
1. Si hi ha canvis sense commit, s'atura i demana que en facis el commit primer.
2. Puja a GitHub els commits pendents (`git push`).
3. Al servidor, posa `~/preguntes-ciencia` exactament en aquest commit (`git fetch` + `git reset --hard`), reconstrueix la imatge i reinicia el contenidor.

La partida en curs es conserva. `config.json` i `data/preguntes.json` són els del repositori, i qualsevol canvi fet a mà al servidor es perd en el desplegament següent.

**Primera vegada: vhost i HTTPS** (al servidor, demana la contrasenya de sudo):

```bash
ssh "$(cat .servidor)" 'sudo bash ~/preguntes-ciencia/deploy/install-edge.sh'
```

**Protegir-lo amb contrasenya (opcional):** el joc no té autenticació, i qualsevol persona que trobi la URL pot reiniciar la partida. Per protegir-lo:
1. Crea l'usuari: `sudo htpasswd -c /etc/nginx/preguntes.htpasswd estand` (és del paquet `apache2-utils`).
2. Descomenta les dues línies `auth_basic` a `/etc/nginx/conf.d/preguntes.ddns.net.conf`, al bloc `443`.
3. Executa `sudo nginx -t && sudo systemctl reload nginx`.

La tauleta demanarà l'usuari i la contrasenya una sola vegada.

**Ordres útils al servidor** (`cd ~/preguntes-ciencia`):

| Acció | Ordre |
|---|---|
| Estat | `docker compose -f docker-compose.prod.yml ps` |
| Registres | `docker compose -f docker-compose.prod.yml logs -f` |
| Aturar | `docker compose -f docker-compose.prod.yml down` |
| Reiniciar la partida | `docker compose -f docker-compose.prod.yml exec joc rm -f /data/estat.json` |

## Telemetria

El servidor registra totes les accions del joc a `telemetria.jsonl`, una línia JSON per esdeveniment amb l'hora (UTC):
- **Local:** el fitxer és a `data/`.
- **Docker:** és al volum, a `/data`.

No es desa cap dada personal: ni IP ni noms. Cada línia porta `partida` (l'identificador de la partida, que canvia a cada reinici) i `sessio` (cada càrrega de la pàgina).

| Esdeveniment | Quan | Dades |
|---|---|---|
| `pagina_carregada` | s'obre o es recarrega la pàgina | mida de pantalla, navegador |
| `benvinguda_tancada` | es toca «Toca per començar» | |
| `pregunta_oberta` | s'obre una pregunta | `id`, `ordre` en què es mostren les respostes |
| `resposta` | es respon (ho registra el servidor) | `id`, `tema`, `triada`, `correcta`, `temps_esgotat`, `posicio` (lletra en pantalla), `ms` |
| `pregunta_tancada` | es tanca la pregunta | `resposta_donada`, `motiu` (`boto` / `inactivitat` / `navegacio`), `ms` |
| `partida_completada` | s'han jugat totes | `encerts`, `total` |
| `reinici_demanat` / `reinici_cancelat` | s'obre o es cancel·la el diàleg de reinici | |
| `reinici` | es confirma el reinici | `jugades`, `encerts`, `nova_partida` |
| `resposta_repetida`, `error_client`, `servidor_engegat` | casos poc freqüents | |

**Descarregar-la del servidor i veure'n el resum** (des del portàtil):

```bash
./telemetria.sh
```

Amb `--csv` també genera un CSV per obrir amb Excel. Amb `--des-de 2026-10-10` filtra per data. El resum inclou:
- partides, reinicis i respostes;
- per a cada pregunta: quantes vegades s'ha obert i respost, percentatge d'encerts, temps esgotats, abandonaments, temps mitjà i opcions triades;
- respostes per hora.

**Analitzar un fitxer local:**

```bash
python3 eines/telemetria.py data/telemetria.jsonl
```

## Configuració (`config.json`)

| Camp | Valor | Funció |
|---|---|---|
| `titol` | `"Ciència a la URV"` | Títol del joc |
| `subtitol` | `"Aperitius de ciència"` | Text sota el títol (buit per amagar-lo) |
| `mode_targetes` | `"colors"` o `"jugada"` | `colors`: groc ✓ / gris fosc ✗. `jugada`: totes gris clar |
| `barrejar_respostes` | `true` | Barreja l'ordre de les respostes cada vegada |
| `segons_inactivitat` | `60` | Torna a la graella si ningú toca res (0 = mai) |
| `segons_resposta` | `20` | Temps per respondre; si s'esgota, compta com a error (0 = sense límit) |
| `introduccio` | llista de paràgrafs | Text de la pantalla de benvinguda (l'últim paràgraf surt destacat). Surt en obrir el joc i després de cada reinici |

## Preguntes

Les preguntes són a `data/preguntes.json`. Cada pregunta té:
- `id`, `tema` (el text de la targeta) i `enunciat`;
- `respostes`: de 2 a 4, cadascuna amb `lletra` i `text`;
- `correcta`: la lletra de la resposta bona;
- `explicacio`.

Per regenerar-les a partir del document Word (si se n'actualitza el text):

```bash
python3 eines/docx_a_json.py "aperitius_ciencia_preguntes (1).docx"
```

El servidor valida el fitxer en arrencar. Si hi ha un error (un camp que falta, una lletra correcta inexistent…), explica quin és i no arrenca.

## Reiniciar la partida

- **Des del joc:** botó «↺ Reiniciar» → «Sí, reinicia».
- **A mà, en local:** esborra `data/estat.json`.
- **A mà, amb Docker:** `docker compose exec joc rm /data/estat.json`.
