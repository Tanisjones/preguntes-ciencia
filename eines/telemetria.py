#!/usr/bin/env python3
"""Resum de la telemetria del joc (fitxer telemetria.jsonl).

Ús:
    python3 eines/telemetria.py telemetria.jsonl
    python3 eines/telemetria.py telemetria.jsonl --csv esdeveniments.csv
    python3 eines/telemetria.py telemetria.jsonl --des-de 2026-10-10

Cada línia del fitxer és un esdeveniment JSON amb, com a mínim, `ts` (UTC) i
`event`. Esdeveniments:

  servidor_engegat      el servidor s'ha (re)engegat
  pagina_carregada      s'ha obert/recarregat la pàgina (amplada, alcada, navegador)
  benvinguda_tancada    algú ha tocat «Toca per començar»
  pregunta_oberta       s'obre una pregunta (id, ordre en què es mostren les respostes)
  resposta              resposta registrada pel servidor (id, triada, correcta,
                        temps_esgotat, posicio = lletra mostrada en pantalla, ms)
  resposta_repetida     intent de respondre una pregunta ja jugada
  pregunta_tancada      es tanca la pregunta (resposta_donada, motiu: boto /
                        inactivitat / navegacio, ms oberta)
  partida_completada    s'han jugat totes les preguntes (encerts, total)
  reinici_demanat       s'obre el diàleg de reinici
  reinici_cancelat      es cancel·la
  reinici               es reinicia (partida, nova_partida, jugades, encerts)
  error_client          error de connexió al navegador

Només fa servir la biblioteca estàndard de Python.
"""
import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    LOCAL = ZoneInfo("Europe/Madrid")
except Exception:  # pragma: no cover
    LOCAL = timezone.utc


def llegeix(cami, des_de=None):
    events, errors = [], 0
    for linia in Path(cami).read_text(encoding="utf-8").splitlines():
        if not linia.strip():
            continue
        try:
            e = json.loads(linia)
            e["_ts"] = datetime.fromisoformat(e["ts"]).astimezone(LOCAL)
        except (json.JSONDecodeError, KeyError, ValueError):
            errors += 1
            continue
        if des_de and e["_ts"].date() < des_de:
            continue
        events.append(e)
    return events, errors


def segons(ms):
    return f"{ms / 1000:.1f}s" if ms is not None else "—"


def mitjana(valors):
    valors = [v for v in valors if isinstance(v, (int, float))]
    return sum(valors) / len(valors) if valors else None


def resum(events):
    if not events:
        print("No hi ha cap esdeveniment.")
        return
    tipus = Counter(e["event"] for e in events)
    print(f"Període: {events[0]['_ts']:%Y-%m-%d %H:%M} → {events[-1]['_ts']:%Y-%m-%d %H:%M} (hora local)")
    print(f"Esdeveniments: {len(events)}")
    print()
    print("Recompte per tipus")
    for nom, n in tipus.most_common():
        print(f"  {nom:<22} {n}")

    respostes = [e for e in events if e["event"] == "resposta"]
    partides = {e.get("partida") for e in respostes}
    print()
    print("General")
    print(f"  Càrregues de pàgina:   {tipus['pagina_carregada']}")
    print(f"  Partides amb jugades:  {len(partides)}")
    print(f"  Partides completades:  {tipus['partida_completada']}")
    print(f"  Reinicis:              {tipus['reinici']}  (cancel·lats: {tipus['reinici_cancelat']})")
    if respostes:
        encerts = sum(bool(e.get("correcta")) for e in respostes)
        esgotats = sum(bool(e.get("temps_esgotat")) for e in respostes)
        print(f"  Respostes:             {len(respostes)}  · encerts {encerts} ({encerts / len(respostes):.0%})"
              f"  · temps esgotat {esgotats}")
        print(f"  Temps mitjà de resposta: {segons(mitjana([e.get('ms') for e in respostes if not e.get('temps_esgotat')]))}")

    # Per pregunta
    obertes = Counter(e.get("id") for e in events if e["event"] == "pregunta_oberta")
    abandonades = Counter(e.get("id") for e in events
                          if e["event"] == "pregunta_tancada" and not e.get("resposta_donada"))
    per_preg = defaultdict(list)
    temes = {}
    for e in respostes:
        per_preg[e.get("id")].append(e)
        temes[e.get("id")] = e.get("tema", "")
    ids = sorted(set(obertes) | set(per_preg), key=lambda x: (str(type(x)), x))
    if ids:
        print()
        print("Per pregunta")
        print(f"  {'id':>3} {'tema':<34} {'obertes':>7} {'resp.':>5} {'encert':>6} {'esgot.':>6} {'aband.':>6} {'temps':>6}  triades")
        for i in ids:
            rs = per_preg.get(i, [])
            enc = sum(bool(e.get("correcta")) for e in rs)
            pct = f"{enc / len(rs):.0%}" if rs else "—"
            esg = sum(bool(e.get("temps_esgotat")) for e in rs)
            t = mitjana([e.get("ms") for e in rs if not e.get("temps_esgotat")])
            triades = Counter(e.get("triada") or "—" for e in rs)
            dist = " ".join(f"{k}:{v}" for k, v in sorted(triades.items()))
            print(f"  {i!s:>3} {temes.get(i, '')[:34]:<34} {obertes.get(i, 0):>7} {len(rs):>5} {pct:>6} {esg:>6}"
                  f" {abandonades.get(i, 0):>6} {segons(t):>6}  {dist}")

    # Posició en pantalla (per detectar biaix cap a la primera opció)
    posicions = Counter(e.get("posicio") for e in respostes if e.get("posicio"))
    if posicions:
        print()
        print("Lletra triada en pantalla: " + "  ".join(f"{k}:{v}" for k, v in sorted(posicions.items())))

    # Activitat per hora
    per_hora = Counter(e["_ts"].strftime("%Y-%m-%d %H:00") for e in respostes)
    if per_hora:
        print()
        print("Respostes per hora")
        maxim = max(per_hora.values())
        for hora, n in sorted(per_hora.items()):
            print(f"  {hora}  {n:>4}  {'█' * max(1, round(n / maxim * 40))}")


def exporta_csv(events, desti):
    camps = ["ts", "event"]
    for e in events:
        for k in e:
            if not k.startswith("_") and k not in camps:
                camps.append(k)
    # utf-8-sig + «;»: l'Excel en català/castellà l'obre directament amb els accents bé
    with open(desti, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=camps, extrasaction="ignore", delimiter=";")
        w.writeheader()
        for e in events:
            fila = {k: v for k, v in e.items() if not k.startswith("_")}
            fila["ts"] = e["_ts"].strftime("%Y-%m-%d %H:%M:%S")
            w.writerow(fila)
    print(f"\nCSV escrit a {desti} ({len(events)} files, hora local)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fitxer", help="telemetria.jsonl")
    ap.add_argument("--csv", help="exporta tots els esdeveniments a aquest CSV")
    ap.add_argument("--des-de", help="només a partir d'aquesta data (AAAA-MM-DD)")
    args = ap.parse_args()
    des_de = datetime.strptime(args.des_de, "%Y-%m-%d").date() if args.des_de else None
    events, errors = llegeix(args.fitxer, des_de)
    if errors:
        print(f"(S'han ignorat {errors} línies malmeses)", file=sys.stderr)
    resum(events)
    if args.csv:
        exporta_csv(events, args.csv)


if __name__ == "__main__":
    main()
