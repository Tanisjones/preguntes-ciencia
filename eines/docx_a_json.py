#!/usr/bin/env python3
"""Converteix el document .docx de preguntes a data/preguntes.json.

Ús:
    python3 eines/docx_a_json.py "aperitius_ciencia_preguntes (1).docx" [data/preguntes.json]

Format esperat del document (un paràgraf per línia):
    1. Títol del tema
    Pregunta: Enunciat...
    A. Resposta
    B. Resposta
    C. Resposta            (fins a D)
    Resposta correcta: B. ...
    Resposta final: Explicació...

Només fa servir la biblioteca estàndard de Python.
"""
import html
import json
import re
import sys
import zipfile
from pathlib import Path

RE_TITOL = re.compile(r"^(\d+)\.\s+(.+)$")
RE_RESPOSTA = re.compile(r"^([A-D])\.\s+(.+)$")
RE_CORRECTA = re.compile(r"^Resposta correcta:\s*([A-D])\b", re.I)


def paragrafs(cami_docx):
    xml = zipfile.ZipFile(cami_docx).read("word/document.xml").decode("utf-8")
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p))
        text = html.unescape(text).strip()
        if text:
            yield text


def converteix(cami_docx):
    preguntes = []
    actual = None
    for text in paragrafs(cami_docx):
        if text.startswith("Pregunta:") and actual:
            actual["enunciat"] = text.split(":", 1)[1].strip()
        elif RE_CORRECTA.match(text) and actual:
            actual["correcta"] = RE_CORRECTA.match(text).group(1).upper()
        elif text.startswith("Resposta final:") and actual:
            actual["explicacio"] = text.split(":", 1)[1].strip()
        elif RE_RESPOSTA.match(text) and actual and "enunciat" in actual:
            lletra, resposta = RE_RESPOSTA.match(text).groups()
            actual["respostes"].append({"lletra": lletra, "text": resposta.strip()})
        elif RE_TITOL.match(text):
            num, tema = RE_TITOL.match(text).groups()
            actual = {"id": int(num), "tema": tema.strip(), "respostes": []}
            preguntes.append(actual)
    # Ordre de camps estable i llegible
    claus = ["id", "tema", "enunciat", "respostes", "correcta", "explicacio"]
    return [{k: p.get(k) for k in claus} for p in preguntes]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    origen = Path(sys.argv[1])
    desti = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "data" / "preguntes.json"
    preguntes = converteix(origen)
    incompletes = [p["id"] for p in preguntes if not all(p.values()) or len(p["respostes"]) < 2]
    if incompletes:
        print(f"Atenció: preguntes incompletes: {incompletes}", file=sys.stderr)
        sys.exit(2)
    desti.write_text(json.dumps(preguntes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(preguntes)} preguntes escrites a {desti}")


if __name__ == "__main__":
    main()
