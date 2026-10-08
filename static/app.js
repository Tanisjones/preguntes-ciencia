/* =========================================================================
   Ciència a la URV — lògica del joc
   ========================================================================= */
"use strict";

const $ = (sel) => document.querySelector(sel);

const joc = {
  config: {},
  preguntes: [],
  respostes: {},       // id -> {resultat, triada}
  actual: null,        // pregunta oberta
  bloquejat: false,
  temporitzador: null,
  compte: null,        // interval del compte enrere
  obertaA: 0,          // performance.now() quan s'ha obert la pregunta
  motiuTancament: null,
  // Identificador d'aquesta càrrega de la pàgina (per agrupar la telemetria)
  sessio: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 12),
};

// --- Telemetria ------------------------------------------------------------
// Envia un esdeveniment al servidor (telemetria.jsonl). No espera resposta i
// mai interromp el joc si falla.
function registra(event, dades = {}) {
  try {
    fetch("api/telemetria", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, sessio: joc.sessio, ...dades }),
    }).catch(() => {});
  } catch (_) {}
}

// --- API -------------------------------------------------------------------

async function api(ruta, dades) {
  const opcions = dades === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dades),
  };
  const resp = await fetch("api/" + ruta, opcions);
  if (!resp.ok) {
    let missatge = `Error ${resp.status}`;
    try { missatge = (await resp.json()).error || missatge; } catch (_) {}
    throw new Error(missatge);
  }
  return resp.json();
}

let errorTimer;
function mostraError(text) {
  const el = $("#error");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// --- Graella ---------------------------------------------------------------

function estatVisual(id) {
  const r = joc.respostes[String(id)];
  if (!r) return "disponible";
  return joc.config.mode_targetes === "jugada" ? "jugada" : r.resultat;
}

function creaTargeta(p, i) {
  const b = document.createElement("button");
  b.className = "local";
  b.dataset.id = p.id;
  b.style.setProperty("--i", i);
  b.innerHTML = `
    <div class="local-cos">
      <div class="tendal"></div>
      <div class="facana">
        <div class="aparador"><span class="tema"></span></div>
        <div class="persiana"><span class="marca"></span><span class="tema-persiana"></span></div>
      </div>
      <span class="numero"></span>
    </div>`;
  b.querySelector(".tema").textContent = p.tema;
  b.querySelector(".tema-persiana").textContent = p.tema;
  b.querySelector(".numero").textContent = i + 1;
  b.addEventListener("click", () => {
    if (b.dataset.estat === "disponible") location.hash = `#/pregunta/${p.id}`;
  });
  return b;
}

function pintaGraella() {
  const graella = $("#graella");
  graella.replaceChildren(...joc.preguntes.map(creaTargeta), $("#cel-reiniciar"));
  actualitzaTargetes();
}

function actualitzaTargetes() {
  for (const b of document.querySelectorAll(".local")) {
    const estat = estatVisual(b.dataset.id);
    b.dataset.estat = estat;
    b.disabled = estat !== "disponible";
    b.querySelector(".marca").textContent = { encertada: "✓", fallada: "✗", jugada: "✓" }[estat] || "";
    const nom = b.querySelector(".tema").textContent;
    b.setAttribute("aria-label", estat === "disponible" ? nom : `${nom} (ja jugada)`);
  }
  actualitzaMarcador();
}

function actualitzaMarcador() {
  const total = joc.preguntes.length;
  const valors = Object.values(joc.respostes);
  const jugades = valors.length;
  const encerts = valors.filter((r) => r.resultat === "encertada").length;
  const marcador = $("#marcador");
  if (joc.config.mode_targetes === "jugada") {
    marcador.innerHTML = `Jugades <b>${jugades}</b> / ${total}`;
  } else {
    marcador.innerHTML = `<b>✓ ${encerts}</b> · <span class="ko">✗ ${jugades - encerts}</span> · ${jugades}/${total}`;
  }
}

// --- Vista de pregunta -----------------------------------------------------

function barreja(llista) {
  const a = [...llista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function obrePregunta(id) {
  const index = joc.preguntes.findIndex((p) => String(p.id) === String(id));
  if (index < 0 || joc.respostes[String(id)]) {
    history.replaceState(null, "", "#/");
    tancaPregunta(true);
    return;
  }
  const p = joc.preguntes[index];
  joc.actual = p;
  joc.bloquejat = false;

  $("#p-numero").textContent = index + 1;
  $("#p-tema").textContent = p.tema;
  $("#p-enunciat").textContent = p.enunciat;
  $("#p-explicacio").hidden = true;
  $("#panell").classList.remove("resolta");

  const ordre = joc.config.barrejar_respostes ? barreja(p.respostes) : p.respostes;
  const contenidor = $("#p-respostes");
  contenidor.replaceChildren(...ordre.map((r, i) => {
    const b = document.createElement("button");
    b.className = "resposta";
    b.dataset.lletra = r.lletra;
    b.style.setProperty("--i", i);
    b.innerHTML = `<span class="lletra"></span><span class="text-resposta"></span><span class="icona-resultat"></span>`;
    b.querySelector(".lletra").textContent = "ABCD"[i];
    b.querySelector(".text-resposta").textContent = r.text;
    b.addEventListener("click", () => respon(b));
    return b;
  }));

  const vista = $("#vista-pregunta");
  vista.classList.remove("tancant");
  vista.hidden = false;
  origenAnimacio(id);
  $("#panell").scrollTop = 0;
  joc.obertaA = performance.now();
  joc.motiuTancament = null;
  registra("pregunta_oberta", { id: p.id, ordre: ordre.map((r) => r.lletra).join("") });
  iniciaCompteEnrere(p);
}

// --- Compte enrere ---------------------------------------------------------

const RETARD_COMPTE = 600; // ms: deixa entrar les respostes abans de començar

function iniciaCompteEnrere(p) {
  aturaCompteEnrere();
  const segons = Number(joc.config.segons_resposta) || 0;
  const caixa = $("#p-temps");
  caixa.hidden = segons <= 0;
  if (segons <= 0) { reiniciaInactivitat(); return; }
  clearTimeout(joc.temporitzador); // mentre compta, no cal la inactivitat

  const barra = $("#p-temps-barra");
  const num = $("#p-temps-num");
  caixa.classList.remove("urgent", "aturat");
  barra.style.animation = "none";
  void barra.offsetWidth; // reinicia l'animació CSS
  barra.style.animation = "";
  caixa.style.setProperty("--durada", `${segons}s`);
  caixa.style.setProperty("--retard", `${RETARD_COMPTE}ms`);
  num.textContent = segons;

  const final = performance.now() + RETARD_COMPTE + segons * 1000;
  joc.compte = setInterval(() => {
    if (joc.actual !== p || joc.bloquejat) { aturaCompteEnrere(); return; }
    const queden = Math.max(0, Math.ceil((final - performance.now()) / 1000));
    num.textContent = queden;
    caixa.classList.toggle("urgent", queden <= 5);
    if (queden === 0) { aturaCompteEnrere(); respon(null); }
  }, 100);
}

function aturaCompteEnrere() {
  clearInterval(joc.compte);
  joc.compte = null;
  $("#p-temps").classList.add("aturat");
}

// L'animació del panell surt de la targeta que s'ha tocat
function origenAnimacio(id) {
  const targeta = document.querySelector(`.local[data-id="${CSS.escape(String(id))}"]`);
  const panell = $("#panell");
  if (!targeta) { panell.style.removeProperty("--ox"); panell.style.removeProperty("--oy"); return; }
  const t = targeta.getBoundingClientRect();
  const r = panell.getBoundingClientRect();
  panell.style.setProperty("--ox", `${t.left + t.width / 2 - r.left}px`);
  panell.style.setProperty("--oy", `${t.top + t.height / 2 - r.top}px`);
}

// boto = null quan s'ha esgotat el temps
async function respon(boto) {
  if (joc.bloquejat || !joc.actual) return;
  joc.bloquejat = true;
  aturaCompteEnrere();
  const p = joc.actual;
  const botons = [...document.querySelectorAll(".resposta")];
  botons.forEach((b) => { b.disabled = true; });

  let res;
  try {
    const telemetria = {
      sessio: joc.sessio,
      ms: Math.round(performance.now() - joc.obertaA),
      posicio: boto ? boto.querySelector(".lletra").textContent : null, // lletra mostrada en pantalla
    };
    res = await api("respondre", boto
      ? { id: p.id, lletra: boto.dataset.lletra, ...telemetria }
      : { id: p.id, lletra: null, temps_esgotat: true, ...telemetria });
  } catch (e) {
    registra("error_client", { on: "respondre", id: p.id, missatge: String(e.message || e) });
    mostraError("No s'ha pogut connectar amb el servidor. Torna-ho a provar.");
    botons.forEach((b) => { b.disabled = false; });
    joc.bloquejat = false;
    reiniciaInactivitat();
    return;
  }
  if (joc.actual !== p) return;
  const senseTemps = !res.triada;

  joc.respostes[String(p.id)] = { resultat: res.correcta ? "encertada" : "fallada", triada: res.triada };

  for (const b of botons) {
    const icona = b.querySelector(".icona-resultat");
    if (b.dataset.lletra === res.lletra_correcta) {
      b.classList.add("correcta");
      icona.textContent = "✓";
      if (!res.correcta) b.classList.add("revela");
    } else if (b.dataset.lletra === res.triada) {
      b.classList.add("erronia");
      icona.textContent = "✗";
    } else {
      b.classList.add("apagada");
    }
  }
  if (res.correcta) confeti();

  setTimeout(() => {
    if (joc.actual !== p) return;
    const exp = $("#p-explicacio");
    exp.className = "explicacio " + (res.correcta ? "ok" : "ko");
    $("#p-veredicte").textContent = res.correcta ? "Correcte! 🎉"
      : senseTemps ? "S'ha acabat el temps! ⏰" : "Ui! No era aquesta…";
    $("#p-text-explicacio").textContent = res.explicacio;
    exp.hidden = false;
    $("#panell").classList.add("resolta");
    setTimeout(() => exp.scrollIntoView({ behavior: "smooth", block: "nearest" }), 450);
  }, 1100);
  reiniciaInactivitat();
}

function tancaPregunta(immediat = false) {
  clearTimeout(joc.temporitzador);
  aturaCompteEnrere();
  const vista = $("#vista-pregunta");
  const tancava = joc.actual;
  joc.actual = null;
  if (tancava) {
    registra("pregunta_tancada", {
      id: tancava.id,
      resposta_donada: !!joc.respostes[String(tancava.id)],
      motiu: joc.motiuTancament || "navegacio",
      ms: Math.round(performance.now() - joc.obertaA),
    });
    joc.motiuTancament = null;
  }
  const acaba = () => {
    vista.hidden = true;
    vista.classList.remove("tancant");
    // La persiana baixa un cop la targeta torna a ser visible
    setTimeout(() => {
      actualitzaTargetes();
      if (tancava) comprovaFinal();
    }, 120);
  };
  if (vista.hidden || immediat) { acaba(); return; }
  vista.classList.add("tancant");
  setTimeout(acaba, 300);
}

function comprovaFinal() {
  const total = joc.preguntes.length;
  const valors = Object.values(joc.respostes);
  if (!total || valors.length < total) return;
  const encerts = valors.filter((r) => r.resultat === "encertada").length;
  $("#mf-text").textContent = `Has encertat ${encerts} de ${total} preguntes.`;
  setTimeout(() => { $("#modal-final").hidden = false; confeti(); }, 900);
}

function reiniciaInactivitat() {
  clearTimeout(joc.temporitzador);
  if (joc.compte) return; // mentre corre el compte enrere, mana ell
  const segons = Number(joc.config.segons_inactivitat) || 0;
  if (segons > 0) joc.temporitzador = setTimeout(() => { joc.motiuTancament = "inactivitat"; location.hash = "#/"; }, segons * 1000);
}

// --- Rutes -----------------------------------------------------------------

function encamina() {
  const m = location.hash.match(/^#\/pregunta\/(.+)$/);
  if (m) obrePregunta(decodeURIComponent(m[1]));
  else if (joc.actual || !$("#vista-pregunta").hidden) tancaPregunta();
}

// --- Reinici ---------------------------------------------------------------

async function reinicia() {
  $("#modal-reiniciar").hidden = true;
  try {
    const estat = await api("reiniciar", { sessio: joc.sessio });
    joc.respostes = estat.respostes;
    $("#modal-final").hidden = true;
    actualitzaTargetes();
    mostraInici();
  } catch (e) {
    mostraError("No s'ha pogut reiniciar: " + e.message);
  }
}

async function sincronitza() {
  try {
    joc.respostes = (await api("estat")).respostes;
    if (!joc.actual) actualitzaTargetes();
  } catch (_) { /* es tornarà a provar */ }
}

// --- Pantalla completa -----------------------------------------------------


function entraPantallaCompleta() {
  const el = document.documentElement;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen();
    if (r && r.catch) r.catch(() => {});
  } catch (_) {}
}


// --- Confeti ---------------------------------------------------------------

function confeti() {
  const capa = $("#confeti");
  const colors = ["#eb0029", "#ac162c", "#ffce00", "#f7a800", "#dbd9d6", "#ffffff"];
  const peces = [];
  for (let i = 0; i < 70; i++) {
    const el = document.createElement("i");
    el.className = "peca";
    el.style.setProperty("--x", `${Math.random() * 100}vw`);
    el.style.setProperty("--dx", `${(Math.random() - .5) * 30}vw`);
    el.style.setProperty("--r", `${(Math.random() - .5) * 1440}deg`);
    el.style.setProperty("--t", `${1.6 + Math.random() * 1.4}s`);
    el.style.setProperty("--d", `${Math.random() * .4}s`);
    el.style.setProperty("--c", colors[i % colors.length]);
    peces.push(el);
  }
  capa.append(...peces);
  setTimeout(() => peces.forEach((p) => p.remove()), 3500);
}

// =========================================================================
//   Ciutat
// =========================================================================

function aleatori(llavor) {
  return () => {
    llavor |= 0; llavor = (llavor + 0x6d2b79f5) | 0;
    let t = Math.imul(llavor ^ (llavor >>> 15), 1 | llavor);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SVGNS = "http://www.w3.org/2000/svg";

function dibuixaSkyline() {
  const W = window.innerWidth;

  // Capa llunyana: siluetes, amb alguna torre i cúpula
  const llunya = $(".skyline.llunya");
  const H1 = llunya.getBoundingClientRect().height || window.innerHeight * .48;
  let rnd = aleatori(7);
  let s = "";
  let x = -20;
  let n = 0;
  while (x < W + 20) {
    const w = 40 + rnd() * 80;
    const h = H1 * (.3 + rnd() * .5);
    const color = rnd() < .5 ? "#a9c4e6" : "#9bb6dc";
    s += `<rect x="${x}" y="${H1 - h}" width="${w + 1}" height="${h}" fill="${color}"/>`;
    if (n % 7 === 3) {        // campanar
      const cx = x + w / 2, tw = Math.min(26, w * .4), th = H1 * .22;
      s += `<rect x="${cx - tw / 2}" y="${H1 - h - th}" width="${tw}" height="${th}" fill="${color}"/>`;
      s += `<polygon points="${cx - tw / 2 - 3},${H1 - h - th} ${cx + tw / 2 + 3},${H1 - h - th} ${cx},${H1 - h - th - tw * 1.6}" fill="${color}"/>`;
    } else if (n % 7 === 6) { // cúpula
      s += `<ellipse cx="${x + w / 2}" cy="${H1 - h}" rx="${w * .32}" ry="${w * .3}" fill="${color}"/>`;
    } else if (rnd() < .3) {  // antena
      s += `<rect x="${x + w * .7}" y="${H1 - h - 18}" width="2" height="18" fill="${color}"/>`;
    }
    x += w - 2;
    n++;
  }
  llunya.setAttribute("viewBox", `0 0 ${W} ${H1}`);
  llunya.innerHTML = s;

  // Capa propera: façanes mediterrànies amb finestres i persianes verdes
  const aprop = $(".skyline.a-prop");
  const H2 = aprop.getBoundingClientRect().height || window.innerHeight * .34;
  rnd = aleatori(42);
  // Tons neutres (pedra, gris clar, blau grisós) perquè el vermell i el groc
  // de les targetes destaquin sobre la ciutat
  const facanes = ["#ebe7e1", "#dbd9d6", "#cfd5da", "#e3ddd3", "#bcc6cf", "#f2efea", "#d3cec6", "#c4ccd3", "#e6e2dc"];
  const persianes = ["#6f8196", "#55697f", "#8a97a3", "#6f8196"];
  s = "";
  x = -10;
  while (x < W + 10) {
    const w = 70 + rnd() * 90;
    const h = H2 * (.5 + rnd() * .5);
    const y = H2 - h;
    const color = facanes[Math.floor(rnd() * facanes.length)];
    const pers = persianes[Math.floor(rnd() * persianes.length)];
    s += `<rect x="${x}" y="${y}" width="${w + 1}" height="${h}" fill="${color}"/>`;
    s += `<rect x="${x - 3}" y="${y - 6}" width="${w + 6}" height="8" fill="rgba(0,0,0,.18)"/>`;
    if (rnd() < .35) s += `<rect x="${x + w * .2}" y="${y - 16}" width="${w * .18}" height="10" fill="#8a9bb0"/>`;

    const cols = Math.max(2, Math.floor(w / 30));
    const fw = Math.min(14, w / cols * .45);
    const fh = fw * 1.5;
    const pas = w / cols;
    for (let fy = y + 18; fy < H2 - fh - 14; fy += fh + 16) {
      for (let c = 0; c < cols; c++) {
        const fx = x + pas * c + (pas - fw) / 2;
        const encesa = rnd() < .22;
        s += `<rect class="finestra${encesa ? " encesa" : ""}" x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="1"/>`;
        // persianes obertes a banda i banda
        s += `<rect x="${fx - fw * .38}" y="${fy}" width="${fw * .32}" height="${fh}" fill="${pers}"/>`;
        s += `<rect x="${fx + fw * 1.06}" y="${fy}" width="${fw * .32}" height="${fh}" fill="${pers}"/>`;
        if (rnd() < .25) s += `<rect x="${fx - fw * .45}" y="${fy + fh}" width="${fw * 1.9}" height="3" fill="rgba(0,0,0,.35)"/>`;
      }
    }
    x += w;
  }
  aprop.setAttribute("viewBox", `0 0 ${W} ${H2}`);
  aprop.innerHTML = s;
}

// De tant en tant algú encén o apaga el llum d'una finestra visible
// (no tapada per cap targeta). Alterna encendre/apagar perquè la proporció
// de finestres enceses es mantingui estable.
let encenLlum = Math.random() < .5;
function canviaUnaLlum() {
  const finestres = document.querySelectorAll(".skyline.a-prop .finestra");
  if (finestres.length) {
    const targetes = [...document.querySelectorAll(".local")].map((t) => t.getBoundingClientRect());
    const tapada = (r) => targetes.some((t) => r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom);
    for (let intent = 0; intent < 40; intent++) {
      const f = finestres[Math.floor(Math.random() * finestres.length)];
      if (f.classList.contains("encesa") === encenLlum) continue;
      const r = f.getBoundingClientRect();
      if (r.right < 0 || r.left > window.innerWidth || tapada(r)) continue;
      f.classList.toggle("encesa", encenLlum);
      encenLlum = !encenLlum;
      break;
    }
  }
  setTimeout(canviaUnaLlum, 3000 + Math.random() * 3000);
}

const DIBUIXOS = {
  tramvia: `<svg viewBox="0 0 320 90"><line x1="150" y1="2" x2="175" y2="16" stroke="#333" stroke-width="3"/><line x1="200" y1="2" x2="175" y2="16" stroke="#333" stroke-width="3"/><line x1="140" y1="2" x2="210" y2="2" stroke="#333" stroke-width="2"/>
    <rect x="4" y="16" width="312" height="62" rx="16" fill="#ffce00"/><rect x="4" y="54" width="312" height="10" fill="#ac162c"/>
    <g fill="#bfe6ff" stroke="#2c3e57" stroke-width="2"><rect x="20" y="26" width="40" height="22" rx="4"/><rect x="72" y="26" width="40" height="22" rx="4"/><rect x="150" y="26" width="40" height="22" rx="4"/><rect x="208" y="26" width="40" height="22" rx="4"/><rect x="262" y="26" width="40" height="22" rx="6"/></g>
    <rect x="120" y="26" width="22" height="46" rx="3" fill="#2c3e57"/><g class="roda"><circle cx="50" cy="80" r="9" fill="#333"/><rect x="48" y="72" width="4" height="16" fill="#777"/></g><g class="roda"><circle cx="270" cy="80" r="9" fill="#333"/><rect x="268" y="72" width="4" height="16" fill="#777"/></g></svg>`,
  autobus: `<svg viewBox="0 0 230 90"><rect x="4" y="8" width="222" height="68" rx="12" fill="#eb0029"/><rect x="4" y="58" width="222" height="8" fill="#ac162c"/>
    <rect x="186" y="14" width="34" height="14" rx="3" fill="#1f2a44"/><text class="contra" x="203" y="25" font-size="9" font-family="Arial" font-weight="bold" fill="#ffce00" text-anchor="middle">URV</text>
    <g fill="#d6f5ff" stroke="#7a0f1f" stroke-width="2"><rect x="16" y="20" width="34" height="24" rx="4"/><rect x="58" y="20" width="34" height="24" rx="4"/><rect x="100" y="20" width="34" height="24" rx="4"/><rect x="142" y="20" width="34" height="24" rx="4"/><rect x="186" y="32" width="34" height="24" rx="4"/></g>
    <g class="roda"><circle cx="48" cy="78" r="12" fill="#2b2b2b"/><rect x="46" y="68" width="4" height="20" fill="#888"/></g><g class="roda"><circle cx="186" cy="78" r="12" fill="#2b2b2b"/><rect x="184" y="68" width="4" height="20" fill="#888"/></g></svg>`,
  cotxe: `<svg viewBox="0 0 120 56"><path d="M8 38 Q10 24 28 22 L40 8 Q44 4 52 4 L82 4 Q90 4 94 10 L104 22 Q116 24 116 38 L116 44 L8 44 Z" fill="#f7a800"/>
    <g fill="#d6f5ff"><path d="M44 10 L56 10 L56 22 L34 22 Z"/><path d="M62 10 L82 10 Q86 10 88 14 L94 22 L62 22 Z"/></g>
    <g class="roda"><circle cx="32" cy="44" r="10" fill="#2b2b2b"/><rect x="30" y="36" width="4" height="16" fill="#999"/></g><g class="roda"><circle cx="94" cy="44" r="10" fill="#2b2b2b"/><rect x="92" y="36" width="4" height="16" fill="#999"/></g></svg>`,
  bici: `<svg viewBox="0 0 64 64"><g class="roda"><circle cx="14" cy="50" r="11" fill="none" stroke="#2b2b2b" stroke-width="3"/><line x1="14" y1="39" x2="14" y2="61" stroke="#999" stroke-width="1.5"/></g>
    <g class="roda"><circle cx="50" cy="50" r="11" fill="none" stroke="#2b2b2b" stroke-width="3"/><line x1="50" y1="39" x2="50" y2="61" stroke="#999" stroke-width="1.5"/></g>
    <path d="M14 50 L26 34 L44 34 L50 50 M26 34 L32 50 L44 34" fill="none" stroke="#8e2a2c" stroke-width="3" stroke-linejoin="round"/>
    <path d="M28 32 L34 16" stroke="#3d8bfd" stroke-width="7" stroke-linecap="round"/><circle cx="36" cy="9" r="6" fill="#f2c39b"/><path d="M30 6 Q36 0 42 6 Z" fill="#ffc83d"/>
    <path d="M34 18 L44 30" stroke="#3d8bfd" stroke-width="4" stroke-linecap="round"/><path d="M30 34 L34 46" stroke="#1f2a44" stroke-width="4" stroke-linecap="round"/></svg>`,
  vianant: (cos, cames, pell, cabell) => `<svg viewBox="0 0 24 56"><g class="cos-vianant">
    <line class="cama a" x1="10" y1="34" x2="10" y2="54" stroke="${cames}" stroke-width="4.5" stroke-linecap="round"/>
    <line class="cama b" x1="14" y1="34" x2="14" y2="54" stroke="${cames}" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="5" y="14" width="14" height="22" rx="6" fill="${cos}"/><circle cx="12" cy="8" r="6" fill="${pell}"/><path d="M6 7 Q12 -1 18 7 Q16 3 12 3 Q8 3 6 7Z" fill="${cabell}"/></g></svg>`,
  cambrer: `<svg viewBox="0 0 36 56"><g class="cos-vianant">
    <line class="cama a" x1="10" y1="34" x2="10" y2="54" stroke="#1f2a44" stroke-width="4.5" stroke-linecap="round"/>
    <line class="cama b" x1="14" y1="34" x2="14" y2="54" stroke="#1f2a44" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="5" y="14" width="14" height="22" rx="6" fill="#fff"/><rect x="6" y="22" width="12" height="14" rx="3" fill="#1f2a44"/>
    <path d="M17 18 L26 12" stroke="#fff" stroke-width="4" stroke-linecap="round"/><rect x="20" y="9" width="14" height="2.5" rx="1" fill="#9aa3ad"/>
    <path d="M23 9 L22 3 L26 3 L25 9Z" fill="#c0392b" opacity=".85"/><path d="M29 9 L28 4 L32 4 L31 9Z" fill="#ffc83d" opacity=".9"/>
    <circle cx="12" cy="8" r="6" fill="#e8b48a"/><path d="M6 7 Q12 -1 18 7 Q16 3 12 3 Q8 3 6 7Z" fill="#3b2a20"/></g></svg>`,
  terrassa: (c1, c2) => `<svg viewBox="0 0 70 60"><g class="para-sol"><rect x="34" y="12" width="2.5" height="36" fill="#7b838d"/>
    <path d="M4 18 Q35 -6 66 18 Z" fill="${c1}"/><path d="M24 17 Q35 -4 46 17 Z" fill="${c2}"/><path d="M4 18 Q9 22 14 18 Q19 22 24 18 Q29 22 35 18 Q41 22 46 18 Q51 22 56 18 Q61 22 66 18" fill="${c1}"/></g>
    <rect x="22" y="40" width="26" height="3" rx="1" fill="#5d4a3a"/><rect x="33" y="43" width="4" height="15" fill="#5d4a3a"/>
    <path d="M8 36 L8 58 M8 46 L18 46 L18 58 M8 36 L4 36" stroke="#3a8f5c" stroke-width="2.5" fill="none"/><path d="M62 36 L62 58 M62 46 L52 46 L52 58 M62 36 L66 36" stroke="#3a8f5c" stroke-width="2.5" fill="none"/>
    <rect x="26" y="35" width="3" height="5" fill="#c0392b" opacity=".8"/><rect x="40" y="34" width="3" height="6" fill="#ffc83d"/></svg>`,
  ocells: `<svg viewBox="0 0 60 30"><path class="ala" d="M0 10 Q5 4 10 10 Q15 4 20 10" fill="none" stroke="#2c3e57" stroke-width="2"/>
    <path class="ala" d="M24 18 Q29 12 34 18 Q39 12 44 18" fill="none" stroke="#2c3e57" stroke-width="2"/><path class="ala" d="M40 4 Q44 0 48 4 Q52 0 56 4" fill="none" stroke="#2c3e57" stroke-width="2"/></svg>`,
  globus: `<svg viewBox="0 0 60 90"><path d="M30 2 C8 2 2 22 6 34 C10 46 22 54 26 62 L34 62 C38 54 50 46 54 34 C58 22 52 2 30 2Z" fill="#e5484d"/>
    <path d="M30 2 C20 4 16 24 20 38 C23 48 26 56 28 62 L32 62 C34 56 37 48 40 38 C44 24 40 4 30 2Z" fill="#ffc83d"/><path d="M30 2 C27 10 26 30 28 62 L32 62 C34 30 33 10 30 2Z" fill="#e5484d"/>
    <line x1="26" y1="62" x2="25" y2="74" stroke="#5d4a3a"/><line x1="34" y1="62" x2="35" y2="74" stroke="#5d4a3a"/><rect x="23" y="74" width="14" height="10" rx="2" fill="#8a5a35"/></svg>`,
};

function colocaElements() {
  // Núvols
  const nuvols = $(".capa-nuvols");
  nuvols.innerHTML = "";
  [[16, 5, 95, 0], [10, 18, 130, -40], [22, 30, 160, -90], [13, 11, 110, -70], [9, 38, 145, -20]].forEach(([w, top, t, d]) => {
    const n = document.createElement("div");
    n.className = "nuvol";
    n.style.cssText = `--w:${w}vmin;--t:${t}s;--d:${d}s;top:${top}vh`;
    nuvols.append(n);
  });

  // Ocells
  const ocells = $(".capa-ocells");
  ocells.innerHTML = "";
  [[22, 34, -5], [40, 48, -30]].forEach(([top, t, d]) => {
    const o = document.createElement("div");
    o.className = "ocells";
    o.style.cssText = `top:${top}vh;--t:${t}s;--d:${d}s`;
    o.innerHTML = DIBUIXOS.ocells;
    ocells.append(o);
  });

  $(".globus").innerHTML = DIBUIXOS.globus;

  // Terrasses
  const terrasses = $(".capa-terrasses");
  terrasses.innerHTML = "";
  const paraSols = [["#eb0029", "#fff"], ["#ac162c", "#fff"], ["#f7a800", "#fff"], ["#ffce00", "#eb0029"]];
  [6, 30, 58, 84].forEach((left, i) => {
    const t = document.createElement("div");
    t.className = "terrassa";
    t.style.left = `${left}vw`;
    t.innerHTML = DIBUIXOS.terrassa(...paraSols[i % paraSols.length]);
    t.querySelector(".para-sol").style.animationDelay = `${-i * 1.3}s`;
    terrasses.append(t);
  });

  // Vehicles i vianants (b = alçada des de baix del carrer, h = mida)
  const mobils = $(".capa-mobils");
  mobils.innerHTML = "";
  const vianant = (a, b, c, d) => DIBUIXOS.vianant(a, b, c, d);
  const llista = [
    { svg: DIBUIXOS.tramvia, dir: "cap-dreta", b: "26%", h: "8.5vmin", t: 26, d: -4 },
    { svg: DIBUIXOS.autobus, dir: "cap-esquerra", b: "4%", h: "8vmin", t: 22, d: -15 },
    { svg: DIBUIXOS.cotxe, dir: "cap-esquerra", b: "1%", h: "4.4vmin", t: 14, d: -3 },
    { svg: DIBUIXOS.bici, dir: "cap-dreta", b: "44%", h: "5.4vmin", t: 18, d: -11 },
    { svg: vianant("#8b5cf6", "#1f2a44", "#f2c39b", "#3b2a20"), dir: "cap-dreta", b: "56%", h: "5.6vh", t: 42, d: -8 },
    { svg: vianant("#ff8a3d", "#2c3e57", "#c68a5e", "#1b1b1b"), dir: "cap-esquerra", b: "58%", h: "5.4vh", t: 48, d: -30 },
    { svg: DIBUIXOS.cambrer, dir: "cap-dreta", b: "57%", h: "5.8vh", t: 36, d: -22 },
    { svg: vianant("#14b8a6", "#5d4a3a", "#f5d0b0", "#d9a21a"), dir: "cap-esquerra", b: "55%", h: "5.2vh", t: 52, d: -6 },
  ];
  for (const m of llista) {
    const el = document.createElement("div");
    el.className = `mobil ${m.dir}`;
    el.style.cssText = `--anim:${m.dir};--b:${m.b};--h:${m.h};--t:${m.t}s;--d:${m.d}s;z-index:${100 - Math.round(parseFloat(m.b))}`; // més avall = més a prop
    el.innerHTML = m.svg;
    if (m.dir === "cap-esquerra") {
      // El vehicle es dibuixa mirallat: els textos es tornen a girar sobre el
      // seu centre (text-anchor middle) perquè es llegeixin bé.
      for (const t of el.querySelectorAll("text.contra")) {
        const cx = parseFloat(t.getAttribute("x"));
        t.setAttribute("transform", `translate(${2 * cx} 0) scale(-1 1)`);
      }
    }
    mobils.append(el);
  }
}

// =========================================================================
//   Inici
// =========================================================================

function aplicaTitols() {
  const { titol, subtitol } = joc.config;
  document.title = titol;
  $("#titol").textContent = titol;
  $("#inici-titol").textContent = titol;
  $("#subtitol").textContent = subtitol || "";
  $("#inici-sub").textContent = subtitol || "";
  const intro = [].concat(joc.config.introduccio || []);
  $("#inici-text").replaceChildren(...intro.map((text) => {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }));
}

// Pantalla de benvinguda: surt en carregar i després de cada reinici
function mostraInici() {
  const inici = $("#inici");
  inici.classList.remove("amaga");
  inici.hidden = false;
}

function activaEsdeveniments() {
  window.addEventListener("hashchange", encamina);

  $("#inici").addEventListener("click", () => {
    entraPantallaCompleta();
    registra("benvinguda_tancada");
    $("#inici").classList.add("amaga");
    setTimeout(() => { $("#inici").hidden = true; }, 400);
  });


  $("#boto-tornar").addEventListener("click", () => { joc.motiuTancament = "boto"; location.hash = "#/"; });
  $("#vista-pregunta").addEventListener("pointerdown", reiniciaInactivitat);

  $("#boto-reiniciar").addEventListener("click", () => {
    registra("reinici_demanat");
    $("#modal-reiniciar").hidden = false;
  });
  $("#mr-no").addEventListener("click", () => {
    registra("reinici_cancelat");
    $("#modal-reiniciar").hidden = true;
  });
  $("#mr-si").addEventListener("click", reinicia);
  $("#mf-ok").addEventListener("click", () => { $("#modal-final").hidden = true; });
  for (const m of document.querySelectorAll(".modal")) {
    m.addEventListener("click", (e) => {
      if (e.target !== m) return;
      if (m.id === "modal-reiniciar") registra("reinici_cancelat");
      m.hidden = true;
    });
  }

  // Ús públic: sense menú contextual ni zoom per gestos
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  // Amaga el cursor quan no es mou
  let cursorTimer;
  document.addEventListener("pointermove", () => {
    document.body.classList.remove("sense-cursor");
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add("sense-cursor"), 4000);
  });

  document.addEventListener("visibilitychange", () => { if (!document.hidden) sincronitza(); });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(dibuixaSkyline, 250);
  });
}

async function inicia() {
  dibuixaSkyline();
  colocaElements();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setTimeout(canviaUnaLlum, 3000);
  activaEsdeveniments();
  try {
    const [config, preguntes, estat] = await Promise.all([api("config"), api("preguntes"), api("estat")]);
    joc.config = config;
    joc.preguntes = preguntes;
    joc.respostes = estat.respostes;
  } catch (e) {
    mostraError("No s'han pogut carregar les preguntes: " + e.message);
    return;
  }
  aplicaTitols();
  pintaGraella();
  registra("pagina_carregada", {
    amplada: window.innerWidth,
    alcada: window.innerHeight,
    navegador: navigator.userAgent,
  });
  // Si es recarrega la pàgina a mitja pregunta, es torna a la graella
  history.replaceState(null, "", "#/");
}

inicia();
