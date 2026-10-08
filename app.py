"""Servidor del joc de preguntes «Ciència a la URV».

Serveix el frontend (static/) i una API petita per llegir les preguntes,
respondre-les i reiniciar la partida. L'estat es desa a un fitxer JSON.

Variables d'entorn (opcionals):
    PORT            port d'escolta (per defecte 8000)
    ESTAT_DIR       carpeta on es desen estat.json i telemetria.jsonl (per defecte ./data)
    PREGUNTES_PATH  fitxer de preguntes (per defecte ./data/preguntes.json)
    CONFIG_PATH     fitxer de configuració (per defecte ./config.json)
"""
import json
import mimetypes
import os
import sys
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
PREGUNTES_PATH = Path(os.environ.get("PREGUNTES_PATH", BASE / "data" / "preguntes.json"))
CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", BASE / "config.json"))
ESTAT_PATH = Path(os.environ.get("ESTAT_DIR", BASE / "data")) / "estat.json"
TELEMETRIA_PATH = ESTAT_PATH.parent / "telemetria.jsonl"

# Esdeveniments que pot enviar el navegador (la resta els registra el servidor)
EVENTS_CLIENT = {
    "pagina_carregada", "benvinguda_tancada", "pregunta_oberta", "pregunta_tancada",
    "reinici_demanat", "reinici_cancelat", "error_client",
}

CONFIG_PER_DEFECTE = {
    "titol": "Ciència a la URV",
    "subtitol": "",
    "mode_targetes": "colors",
    "barrejar_respostes": True,
    "segons_inactivitat": 60,
    "segons_resposta": 20,
    "introduccio": [],
}

mimetypes.add_type("font/woff2", ".woff2")  # la imatge slim no el coneix

app = Flask(__name__, static_folder=None)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
lock = threading.Lock()
lock_telemetria = threading.Lock()


# --- Dades -------------------------------------------------------------------

class ErrorPreguntes(Exception):
    pass


def carrega_preguntes():
    """Llegeix i valida el fitxer de preguntes (es rellegeix a cada petició,
    així els canvis s'apliquen sense reiniciar el servidor)."""
    try:
        preguntes = json.loads(PREGUNTES_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ErrorPreguntes(f"No es troba el fitxer de preguntes: {PREGUNTES_PATH}")
    except json.JSONDecodeError as e:
        raise ErrorPreguntes(f"{PREGUNTES_PATH} no és un JSON vàlid: {e}")

    if not isinstance(preguntes, list) or not preguntes:
        raise ErrorPreguntes("El fitxer de preguntes ha de ser una llista no buida")
    ids = set()
    for i, p in enumerate(preguntes, 1):
        on = f"pregunta #{i} (id={p.get('id')!r})"
        for camp in ("id", "tema", "enunciat", "respostes", "correcta", "explicacio"):
            if not p.get(camp):
                raise ErrorPreguntes(f"A la {on} hi falta el camp «{camp}»")
        if p["id"] in ids:
            raise ErrorPreguntes(f"L'id {p['id']} està repetit")
        ids.add(p["id"])
        lletres = [r.get("lletra") for r in p["respostes"]]
        if not 2 <= len(lletres) <= 4 or not all(r.get("text") for r in p["respostes"]):
            raise ErrorPreguntes(f"La {on} ha de tenir entre 2 i 4 respostes amb text")
        if len(set(lletres)) != len(lletres):
            raise ErrorPreguntes(f"La {on} té lletres de resposta repetides")
        if p["correcta"] not in lletres:
            raise ErrorPreguntes(f"A la {on} la resposta correcta «{p['correcta']}» no existeix")
    return preguntes


def carrega_config():
    config = dict(CONFIG_PER_DEFECTE)
    if CONFIG_PATH.exists():
        config.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    return config


def ara():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def estat_buit():
    # Cada partida (entre reinicis) té un identificador per a la telemetria
    return {"versio": 1, "partida": uuid.uuid4().hex[:12], "inici": ara(), "respostes": {}}


def llegeix_estat():
    """Cal cridar-la amb `lock`. Si l'estat no té identificador de partida
    (fitxers antics), n'hi assigna un i el desa."""
    try:
        estat = json.loads(ESTAT_PATH.read_text(encoding="utf-8"))
        if not isinstance(estat.get("respostes"), dict):
            raise ValueError
    except (FileNotFoundError, json.JSONDecodeError, AttributeError, ValueError):
        estat = estat_buit()
        desa_estat(estat)
    if "partida" not in estat:
        estat.update(partida=uuid.uuid4().hex[:12], inici=ara())
        desa_estat(estat)
    return estat


def desa_estat(estat):
    """Escriptura atòmica: fitxer temporal + rename."""
    ESTAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=ESTAT_PATH.parent, prefix=".estat-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(estat, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, ESTAT_PATH)


# --- Telemetria --------------------------------------------------------------

def registra(event, **camps):
    """Afegeix una línia JSON a telemetria.jsonl. Mai fa fallar el joc."""
    linia = {"ts": ara(), "event": event, **camps}
    try:
        with lock_telemetria:
            TELEMETRIA_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(TELEMETRIA_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(linia, ensure_ascii=False) + "\n")
    except OSError as e:
        print(f"Telemetria: no s'ha pogut escriure: {e}", file=sys.stderr)


def neteja(dades, max_camps=15):
    """Accepta només camps simples i curts del navegador."""
    net = {}
    for clau, valor in list(dades.items())[:max_camps]:
        clau = str(clau)[:30]
        if clau in ("ts", "event", "partida"):
            continue
        if isinstance(valor, str):
            net[clau] = valor[:300]
        elif isinstance(valor, (bool, int, float)) or valor is None:
            net[clau] = valor
    return net


# --- API ---------------------------------------------------------------------

@app.errorhandler(ErrorPreguntes)
def error_preguntes(e):
    return jsonify(error=str(e)), 500


@app.get("/api/salut")
def salut():
    return jsonify(ok=True)


@app.get("/api/config")
def api_config():
    return jsonify(carrega_config())


@app.get("/api/preguntes")
def api_preguntes():
    # S'envien sense la resposta correcta ni l'explicació
    return jsonify([
        {"id": p["id"], "tema": p["tema"], "enunciat": p["enunciat"], "respostes": p["respostes"]}
        for p in carrega_preguntes()
    ])


@app.get("/api/estat")
def api_estat():
    with lock:
        return jsonify(llegeix_estat())


@app.post("/api/respondre")
def api_respondre():
    dades = request.get_json(silent=True) or {}
    preguntes = carrega_preguntes()
    pregunta = next((p for p in preguntes if str(p["id"]) == str(dades.get("id"))), None)
    if pregunta is None:
        abort(404)
    clau = str(pregunta["id"])
    client = neteja({k: dades.get(k) for k in ("sessio", "posicio", "ms")})
    with lock:
        estat = llegeix_estat()
        previa = estat["respostes"].get(clau)
        if previa:
            # Ja jugada: no es pot repetir fins a reiniciar
            triada, ja_jugada = previa["triada"], True
            registra("resposta_repetida", partida=estat["partida"], id=pregunta["id"], **client)
        else:
            triada, ja_jugada = dades.get("lletra"), False
            temps_esgotat = triada is None and dades.get("temps_esgotat") is True
            if not temps_esgotat and triada not in [r["lletra"] for r in pregunta["respostes"]]:
                abort(400)
            estat["respostes"][clau] = {
                "resultat": "encertada" if triada == pregunta["correcta"] else "fallada",
                "triada": triada,  # None si s'ha esgotat el temps
                "hora": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            desa_estat(estat)
            registra(
                "resposta", partida=estat["partida"], id=pregunta["id"], tema=pregunta["tema"],
                triada=triada, correcta=triada == pregunta["correcta"],
                temps_esgotat=temps_esgotat, **client,
            )
            if len(estat["respostes"]) >= len(preguntes):
                encerts = sum(r["resultat"] == "encertada" for r in estat["respostes"].values())
                registra("partida_completada", partida=estat["partida"], encerts=encerts,
                         total=len(preguntes), sessio=client.get("sessio"))
    return jsonify(
        correcta=triada == pregunta["correcta"],
        triada=triada,
        lletra_correcta=pregunta["correcta"],
        explicacio=pregunta["explicacio"],
        ja_jugada=ja_jugada,
    )


@app.post("/api/reiniciar")
def api_reiniciar():
    sessio = neteja(request.get_json(silent=True) or {}).get("sessio")
    with lock:
        anterior = llegeix_estat()
        nou = estat_buit()
        desa_estat(nou)
    respostes = anterior["respostes"].values()
    registra("reinici", partida=anterior["partida"], nova_partida=nou["partida"], sessio=sessio,
             jugades=len(respostes), encerts=sum(r["resultat"] == "encertada" for r in respostes))
    return jsonify(nou)


@app.post("/api/telemetria")
def api_telemetria():
    dades = request.get_json(silent=True) or {}
    event = dades.get("event")
    if event not in EVENTS_CLIENT:
        abort(400)
    with lock:
        partida = llegeix_estat()["partida"]
    registra(event, partida=partida, **neteja(dades))
    return "", 204


# --- Frontend ----------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/<path:fitxer>")
def estatics(fitxer):
    return send_from_directory(STATIC, fitxer)


carrega_preguntes()  # Falla en arrencar si el fitxer de preguntes té errors
registra("servidor_engegat")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"Ciència a la URV → http://localhost:{port}  (Ctrl+C per aturar)")
    app.run(host="0.0.0.0", port=port, threaded=True)
