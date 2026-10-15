const SUBS = {
  fw: { name: "Palabras esenciales", color: "#4C5FA8" },
  vb: { name: "Verbos comunes", color: "#D6492F" },
  nn: { name: "Sustantivos comunes", color: "#2E7D5B" },
  aj: { name: "Adjetivos y adverbios", color: "#C08A2D" },
  gr: { name: "Saludos y presentaciones", color: "#9A4A6E" },
  st: { name: "Cortesía y conversación", color: "#6F5AA8" },
  tr: { name: "Viajes y direcciones", color: "#2E6E8E" },
  fo: { name: "Comida, compras y dinero", color: "#6E7F2E" },
  wk: { name: "Trabajo, estudio y teléfono", color: "#566573" },
  dy: { name: "Vida diaria y opiniones", color: "#874F8F" }
};
const WORD_SUBS = ["fw", "vb", "nn", "aj"];
const LVL_NAMES = { 1: "A1", 2: "A2", 3: "B1", 4: "B2" };
const LS_KEY = "lexicon1000.v1";
const INTERVALS = [0, 10 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3, 21 * 24 * 3600e3];
const MILESTONES = [1, 10, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

const ITEMS = (window.RAW || []).map((r, i) => ({
  id: i + 1,
  en: r[0],
  es: r[1],
  sub: r[2],
  lvl: r[3],
  type: WORD_SUBS.includes(r[2]) ? "word" : "phrase"
}));
const BY_ID = {};
ITEMS.forEach((it) => { BY_ID[it.id] = it; });

function freshData() {
  return { v: 1, created: new Date().toISOString(), items: {}, days: {}, quizzes: [], milestone: 0, autoSpeak: false };
}

const Store = {
  data: freshData(),
  load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.v === 1 && d.items && d.days) this.data = Object.assign(freshData(), d);
      }
    } catch (e) { this.data = freshData(); }
  },
  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch (e) {}
    flagSaved();
    renderTopstat();
    if (typeof Cloud !== "undefined") Cloud.schedulePush();
  },
  rec(id) { return this.data.items[id] || null; },
  ensure(id) {
    let r = this.data.items[id];
    if (!r) { r = { b: 0, d: 0, s: 0, ok: 0, bad: 0, l: 0 }; this.data.items[id] = r; }
    return r;
  },
  status(id) {
    const r = this.rec(id);
    if (!r || r.b === 0) return "new";
    return r.b >= 5 ? "known" : "learning";
  },
  touchDay() {
    const k = dayKey(new Date());
    this.data.days[k] = (this.data.days[k] || 0) + 1;
  },
  cycle(id) {
    const st = this.status(id);
    const now = Date.now();
    this.touchDay();
    if (st === "new") {
      const r = this.ensure(id);
      r.b = 1; r.d = now + INTERVALS[1]; r.l = now;
      this.save();
      return { from: st, to: "learning" };
    }
    if (st === "learning") {
      const r = this.ensure(id);
      r.b = 5; r.d = now + INTERVALS[5]; r.l = now;
      this.save();
      checkMilestone();
      return { from: st, to: "known", stamped: true };
    }
    delete this.data.items[id];
    this.save();
    return { from: st, to: "new" };
  },
  grade(id, correct) {
    const r = this.ensure(id);
    const now = Date.now();
    const wasKnown = r.b >= 5;
    r.s++; r.l = now;
    if (correct) { r.ok++; r.b = Math.min(r.b + 1, 5); }
    else { r.bad++; r.b = 1; }
    r.d = now + INTERVALS[r.b];
    this.touchDay();
    this.save();
    if (!wasKnown && r.b >= 5) { checkMilestone(); return true; }
    return false;
  },
  counts() {
    let known = 0, learning = 0;
    Object.keys(this.data.items).forEach((id) => {
      const b = this.data.items[id].b;
      if (b >= 5) known++; else if (b > 0) learning++;
    });
    return { known, learning, fresh: ITEMS.length - known - learning };
  },
  pending(id) {
    const r = this.rec(id);
    return !!r && r.b > 0 && r.b < 5 && r.d <= Date.now();
  }
};

function dayKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}

function streak() {
  const days = Store.data.days;
  let n = 0;
  const d = new Date();
  if (!days[dayKey(d)]) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pad(n) { return String(n).padStart(4, "0"); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const SPEAK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';

function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.92;
    const vs = window.speechSynthesis.getVoices() || [];
    const v = vs.find((x) => /en[-_]US/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

let toastTimer = null;
function toast(html) {
  const t = document.getElementById("toast");
  t.innerHTML = html;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

let saveTimer = null;
function flagSaved() {
  const f = document.getElementById("saveflag");
  f.classList.add("show");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => f.classList.remove("show"), 1600);
}

const STATUS_LABEL = { new: "Nueva", learning: "Aprendiendo", known: "Dominada" };

function checkMilestone() {
  const c = Store.counts().known;
  const hit = MILESTONES.filter((m) => m <= c).pop() || 0;
  if (hit > (Store.data.milestone || 0)) {
    Store.data.milestone = hit;
    Store.save();
    if (hit >= 1000) toast("¡Increíble! <span class='stamp-word'>1000 / 1000 dominadas</span>. Léxico completo.");
    else toast("Hito: <span class='stamp-word'>" + hit + " dominadas</span>. Sigue así.");
  }
}

function ringSVG(pct, size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(Math.max(pct, 0), 1));
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true">' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="rgba(31,42,36,.15)" stroke-width="' + stroke + '"/>' +
    '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#D6492F" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + " " + size / 2 + ')"/></svg>';
}

function renderTopstat() {
  const el = document.getElementById("topstat");
  if (!el) return;
  const c = Store.counts();
  const pct = c.known / ITEMS.length;
  el.innerHTML = ringSVG(pct, 44, 5) + '<span class="ring-num">' + c.known + " / 1000</span>";
}

function setNav(route) {
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-nav") === route);
  });
}

function stateBlock(it, stamped) {
  const st = Store.status(it.id);
  return '<button class="cycle s-' + st + (stamped ? " stamp" : "") + '" data-action="cycle" data-id="' + it.id + '" title="Toca para cambiar: Nueva → Aprendiendo → Dominada">' +
    '<span class="cdot"></span>' + STATUS_LABEL[st] + "</button>";
}

function speakBlock(it) {
  return '<button class="speak" data-action="speak" data-id="' + it.id + '" title="Escuchar pronunciación" aria-label="Escuchar ' + esc(it.en) + '">' + SPEAK_ICON + "</button>";
}

function rowHTML(it, stamped) {
  const sub = SUBS[it.sub];
  return '<div class="row st-' + Store.status(it.id) + '" style="--c:' + sub.color + '">' +
    '<span class="row-num">N.º ' + pad(it.id) + "</span>" +
    '<span class="row-en"><span lang="en">' + esc(it.en) + "</span>" + speakBlock(it) + "</span>" +
    '<span class="row-leader" aria-hidden="true"></span>' +
    '<span class="row-es">' + esc(it.es) + "</span>" +
    '<span class="row-meta"><span class="cattag" style="--c:' + sub.color + '">' + esc(sub.name) + '</span><span class="lvl">' + LVL_NAMES[it.lvl] + "</span></span>" +
    stateBlock(it, stamped) +
    "</div>";
}

const explore = { q: "", cat: "all", lvl: "all", st: "all", shown: 60 };

function filteredItems() {
  const q = explore.q.trim().toLowerCase();
  return ITEMS.filter((it) => {
    if (explore.cat !== "all" && it.sub !== explore.cat) return false;
    if (explore.lvl !== "all" && String(it.lvl) !== explore.lvl) return false;
    if (explore.st !== "all" && Store.status(it.id) !== explore.st) return false;
    if (q && !(it.en.toLowerCase().includes(q) || it.es.toLowerCase().includes(q))) return false;
    return true;
  });
}

function catChip(sub, on) {
  const s = SUBS[sub];
  return '<button class="chip' + (on ? " on" : "") + '" style="--c:' + s.color + '" data-action="filter-cat" data-v="' + sub + '"><span class="cdot"></span>' + esc(s.name) + "</button>";
}

function viewInicio() {
  const c = Store.counts();
  const pct = Math.round((c.known / ITEMS.length) * 100);
  const today = new Date();
  const wotd = ITEMS[(today.getFullYear() * 372 + (today.getMonth() + 1) * 31 + today.getDate()) % ITEMS.length];
  const pendingCount = ITEMS.filter((it) => Store.pending(it.id) || Store.status(it.id) === "new").length;
  view.innerHTML =
    '<section class="hero">' +
    '<p class="eyebrow">Inglés esencial · A1 – B2</p>' +
    '<div class="hero-layout"><div>' +
    '<h1 class="title">Las <em>1000</em> palabras y frases que de verdad se usan.</h1>' +
    '<p class="sub">500 palabras + 500 frases organizadas por temas y niveles. Explora el léxico, repasa con tarjetas, ponte a prueba y guarda tu avance <strong>automáticamente</strong> en este navegador.</p>' +
    '<div class="hero-ctas">' +
    '<a class="btn btn-primary" href="#/tarjetas">Sesión de tarjetas' + (pendingCount ? " (" + pendingCount + " pendientes)" : "") + "</a>" +
    '<a class="btn btn-dark" href="#/quiz">Ponerme a prueba</a>' +
    '<a class="btn btn-ghost" href="#/explorar">Explorar el léxico</a>' +
    "</div></div>" +
    '<div class="bignum-card"><div class="bignum" data-count="' + c.known + '">0</div>' +
    '<div class="bignum-cap">dominadas de 1000 · ' + pct + "%</div>" +
    '<div class="mini-stats">' +
    '<div class="mini-stat"><b>' + c.learning + "</b><span>Aprendiendo</span></div>" +
    '<div class="mini-stat"><b>' + c.fresh + "</b><span>Nuevas</span></div>" +
    '<div class="mini-stat"><b>' + streak() + (streak() === 1 ? " día" : " días") + "</b><span>Racha</span></div>" +
    "</div></div></div>" +
    '<div class="wof"><div class="wof-label">Palabra del día</div>' +
    '<div class="wof-en" lang="en">' + esc(wotd.en) + '</div><div class="wof-es">' + esc(wotd.es) + "</div>" +
    '<div class="wof-actions"><button class="btn btn-mini" data-action="speak" data-id="' + wotd.id + '">Escuchar</button>' +
    '<button class="btn btn-mini" data-action="cycle" data-id="' + wotd.id + '">Marcar estado: ' + STATUS_LABEL[Store.status(wotd.id)] + "</button></div></div>" +
    '<div class="steps">' +
    '<div class="step"><div class="step-no">01</div><h3>Explora</h3><p>Recorre las 1000 entradas por tema, nivel o estado. Toca el altavoz para escuchar cada una.</p></div>' +
    '<div class="step"><div class="step-no">02</div><h3>Repasa</h3><p>Las tarjetas repiten lo que falla tu memoria justo antes de que lo olvides. Califica con 1 y 2.</p></div>' +
    '<div class="step"><div class="step-no">03</div><h3>Mide</h3><p>El quiz te examina con opciones y el panel de progreso guarda cada avance al instante.</p></div>' +
    "</div></section>";
  animateCount();
}

function animateCount() {
  const el = document.querySelector("[data-count]");
  if (!el) return;
  const target = parseInt(el.getAttribute("data-count"), 10) || 0;
  const t0 = performance.now();
  (function tick(t) {
    const p = Math.min((t - t0) / 900, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

function viewExplorar() {
  view.innerHTML =
    '<p class="eyebrow">El léxico completo</p>' +
    '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Explora las <em>1000</em> entradas</h1>' +
    '<p class="sub">Filtra por tema, nivel o estado. Toca el estado de cada fila para avanzar: Nueva → Aprendiendo → Dominada. Todo se guarda al momento.</p>' +
    '<div class="toolbar"><div class="toolbar-row">' +
    '<label class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="Buscar en inglés o español…" value="' + esc(explore.q) + '" aria-label="Buscar"></label>' +
    '<select class="select" id="f-lvl" aria-label="Nivel">' +
    '<option value="all">Nivel: todos</option>' +
    [1, 2, 3, 4].map((l) => '<option value="' + l + '"' + (explore.lvl === String(l) ? " selected" : "") + ">Nivel " + LVL_NAMES[l] + "</option>").join("") +
    "</select>" +
    '<select class="select" id="f-st" aria-label="Estado">' +
    '<option value="all">Estado: todas</option>' +
    '<option value="new"' + (explore.st === "new" ? " selected" : "") + ">Nuevas</option>" +
    '<option value="learning"' + (explore.st === "learning" ? " selected" : "") + ">Aprendiendo</option>" +
    '<option value="known"' + (explore.st === "known" ? " selected" : "") + ">Dominadas</option>" +
    "</select>" +
    "</div><div class='chiprow' id='catchips'>" +
    '<button class="chip' + (explore.cat === "all" ? " on" : "") + '" data-action="filter-cat" data-v="all"><span class="cdot" style="--c:var(--ink)"></span>Todas</button>' +
    Object.keys(SUBS).map((s) => catChip(s, explore.cat === s)).join("") +
    "</div></div>" +
    '<div class="meta-count" id="meta"></div><div class="rows" id="rows"></div>' +
    '<div class="loadmore-wrap"><button class="btn btn-ghost" id="more">Cargar más</button></div>';
  const q = document.getElementById("q");
  q.addEventListener("input", () => { explore.q = q.value; explore.shown = 60; paintRows(); });
  document.getElementById("f-lvl").addEventListener("change", (e) => { explore.lvl = e.target.value; explore.shown = 60; paintRows(); });
  document.getElementById("f-st").addEventListener("change", (e) => { explore.st = e.target.value; explore.shown = 60; paintRows(); });
  document.getElementById("more").addEventListener("click", () => { explore.shown += 120; paintRows(); });
  paintRows();
}

function paintRows() {
  const list = filteredItems();
  const slice = list.slice(0, explore.shown);
  document.getElementById("meta").textContent = "Mostrando " + slice.length + " de " + list.length + " · 1000 en total";
  const rows = document.getElementById("rows");
  rows.innerHTML = slice.length ? slice.map((it) => rowHTML(it)).join("") : '<div class="empty">Sin resultados. Prueba con otra búsqueda o filtro.</div>';
  document.getElementById("more").style.display = list.length > slice.length ? "" : "none";
}

let flash = null;

function viewTarjetas() {
  if (flash && flash.active) { renderFlash(); return; }
  view.innerHTML =
    '<p class="eyebrow">Repetición espaciada</p>' +
    '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Sesión de <em>tarjetas</em></h1>' +
    '<p class="sub">Primero salen las que toca repasar, luego las nuevas. Gíralas con clic o espacio y califícate: la memoria decide cuándo vuelven.</p>' +
    '<div class="panel"><h2>Prepara tu sesión</h2><p class="hint">Las tarjetas solo muestran las entradas que cumplen el filtro. Su estado se actualiza y guarda con cada calificación.</p>' +
    '<div class="formgrid">' +
    '<div class="field"><label>Tema</label><select class="select" id="fl-cat"><option value="all">Todos los temas</option>' +
    Object.keys(SUBS).map((s) => '<option value="' + s + '">' + esc(SUBS[s].name) + "</option>").join("") + "</select></div>" +
    '<div class="field"><label>Nivel</label><select class="select" id="fl-lvl"><option value="all">Todos</option><option value="1">A1</option><option value="2">A2</option><option value="3">B1</option><option value="4">B2</option></select></div>' +
    '<div class="field"><label>¿De inglés a español?</label><div class="seg" id="fl-dir"><button data-v="en-es" class="on">EN → ES</button><button data-v="es-en">ES → EN</button><button data-v="mix">Mixto</button></div></div>' +
    '<div class="field"><label>Tarjetas por sesión</label><div class="seg" id="fl-len"><button data-v="10">10</button><button data-v="20" class="on">20</button><button data-v="40">40</button></div></div>' +
    "</div>" +
    '<label class="switchrow"><input type="checkbox" id="fl-speak"' + (Store.data.autoSpeak ? " checked" : "") + ">Pronunciar cada tarjeta en inglés</label>" +
    '<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" id="fl-start">Empezar sesión</button><a class="btn btn-ghost" href="#/quiz">Ir al quiz</a></div></div>';
  wireSeg("fl-dir");
  wireSeg("fl-len");
  document.getElementById("fl-start").addEventListener("click", () => {
    const dir = document.querySelector("#fl-dir .on").getAttribute("data-v");
    const len = parseInt(document.querySelector("#fl-len .on").getAttribute("data-v"), 10);
    Store.data.autoSpeak = document.getElementById("fl-speak").checked;
    Store.save();
    startFlash(document.getElementById("fl-cat").value, document.getElementById("fl-lvl").value, dir, len);
  });
}

function wireSeg(id) {
  document.getElementById(id).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.getElementById(id).querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
  });
}

function flashPool(cat, lvl) {
  return ITEMS.filter((it) => {
    if (cat !== "all" && it.sub !== cat) return false;
    if (lvl !== "all" && String(it.lvl) !== lvl) return false;
    return Store.status(it.id) !== "known";
  });
}

function startFlash(cat, lvl, dir, len) {
  const pool = flashPool(cat, lvl);
  if (!pool.length) { toast("Ya dominas todo ese filtro. Elige otro tema o nivel."); return; }
  const due = pool.filter((it) => Store.pending(it.id) || !Store.rec(it.id));
  const rest = shuffle(pool.filter((it) => due.indexOf(it) < 0));
  shuffle(due);
  const deck = due.concat(rest).slice(0, len).map((it) => it.id);
  flash = { active: true, deck, i: 0, ok: [], bad: [], flipped: false, dir: dir === "en-es" ? "en-es" : dir === "es-en" ? "es-en" : null, scopeLabel: scopeLabel(cat, lvl) };
  renderFlash();
}

function scopeLabel(cat, lvl) {
  const c = cat === "all" ? "todos los temas" : SUBS[cat].name.toLowerCase();
  const l = lvl === "all" ? "" : ", nivel " + LVL_NAMES[lvl];
  return c + l;
}

function flashDir() {
  if (flash.dir) return flash.dir;
  return Math.random() < 0.5 ? "en-es" : "es-en";
}

function renderFlash() {
  if (flash.i >= flash.deck.length) { renderFlashEnd(); return; }
  if (!flash._dir) flash._dir = flash.dir || (Math.random() < 0.5 ? "en-es" : "es-en");
  const it = BY_ID[flash.deck[flash.i]];
  const dir = flash.dir || flash._dir;
  const front = dir === "en-es"
    ? { label: "¿Qué significa?", big: esc(it.en), lang: ' lang="en"', small: "" }
    : { label: "¿Cómo se dice en inglés?", big: esc(it.es), lang: "", small: "" };
  view.innerHTML =
    '<div class="session-head"><span class="session-count">Carta ' + (flash.i + 1) + " / " + flash.deck.length + ' · <span style="color:var(--ink-3)">' + esc(flash.scopeLabel) + '</span></span>' +
    '<div class="progress-line"><i style="width:' + Math.round((flash.i / flash.deck.length) * 100) + '%"></i></div>' +
    '<button class="btn btn-mini btn-ghost" data-action="flash-quit">Terminar</button></div>' +
    '<div class="flipcard' + (flash.flipped ? " flipped" : "") + '" id="flip" role="button" tabindex="0" aria-label="Tarjeta: toca para girar">' +
    '<div class="flip-inner"><div class="face front"><div class="face-no">N.º ' + pad(it.id) + "</div>" +
    '<div class="face-prompt">' + front.label + '</div><div class="face-big"' + front.lang + ">" + front.big + "</div>" + front.small +
    (dir === "en-es" ? '<button class="speak" data-action="speak" data-id="' + it.id + '" title="Escuchar">' + SPEAK_ICON + "</button>" : "") +
    "</div>" +
    '<div class="face back"><div class="face-no">N.º ' + pad(it.id) + '</div><div class="face-prompt">Respuesta</div>' +
    '<div class="face-big" lang="en">' + esc(it.en) + '</div><div class="face-small">' + esc(it.es) + "</div>" +
    '<button class="speak" data-action="speak" data-id="' + it.id + '" title="Escuchar">' + SPEAK_ICON + "</button>" +
    '<div class="face-tags"><span class="cattag" style="--c:' + SUBS[it.sub].color + '">' + esc(SUBS[it.sub].name) + '</span><span class="lvl">' + LVL_NAMES[it.lvl] + "</span></div>" +
    "</div></div></div>" +
    '<p class="face-hint">Toca la tarjeta o pulsa <span class="kbd">Espacio</span> para girar</p>' +
    '<div class="grade-bar">' +
    '<button class="btn btn-ghost" data-action="flash-bad">No la sabía <span class="kbd">1</span></button>' +
    '<button class="btn btn-ok" data-action="flash-ok">La sabía <span class="kbd">2</span></button>' +
    "</div>";
  const flip = document.getElementById("flip");
  flip.addEventListener("click", (e) => { if (e.target.closest(".speak")) return; flipFlash(); });
  flip.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipFlash(); } });
  if (Store.data.autoSpeak) speak(it.en);
}

function flipFlash() {
  flash.flipped = !flash.flipped;
  const f = document.getElementById("flip");
  if (f) f.classList.toggle("flipped", flash.flipped);
}

function gradeFlash(correct) {
  const id = flash.deck[flash.i];
  const stamped = Store.grade(id, correct);
  if (correct) flash.ok.push(id); else flash.bad.push(id);
  flash.i++;
  flash.flipped = false;
  flash._dir = flash.dir || (Math.random() < 0.5 ? "en-es" : "es-en");
  renderFlash();
  if (stamped) toast("¡<span class='stamp-word'>Dominada</span>! " + esc(BY_ID[id].en));
}

function renderFlashEnd() {
  const ok = flash.ok.length, bad = flash.bad.length;
  const msg = bad === 0 ? "Sesión perfecta. Tu memoria está en forma." : ok === 0 ? "Cuesta arrancar, pero cada repaso cuenta. ¡Otra ronda?" : "Bien. Las falladas volverán antes: así funciona la memoria.";
  view.innerHTML =
    '<div class="summary"><p class="eyebrow">Sesión terminada</p>' +
    '<div class="summary-score">' + ok + " / " + (ok + bad) + '</div><p class="summary-msg">' + msg + "</p>" +
    '<div class="summary-actions"><button class="btn btn-primary" data-action="flash-again">Nueva sesión</button>' +
    (bad ? '<button class="btn btn-dark" data-action="flash-retry">Repasar las ' + bad + " falladas</button>" : "") +
    '<a class="btn btn-ghost" href="#/quiz">Ir al quiz</a></div>' +
    (bad ? '<div class="wronglist">' + flash.bad.map((id) => rowHTML(BY_ID[id])).join("") + "</div>" : "") +
    "</div>";
  const b = flash.bad.slice();
  flash = { active: false, retry: b };
}

let quiz = null;

function viewQuiz() {
  if (quiz && quiz.active) { renderQuiz(); return; }
  view.innerHTML =
    '<p class="eyebrow">Examen rápido</p>' +
    '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Ponte a <em>prueba</em></h1>' +
    '<p class="sub">Preguntas de opción múltiple en ambas direcciones. Cada respuesta se guarda y alimenta tu progreso.</p>' +
    '<div class="panel"><h2>Configura tu quiz</h2><p class="hint">Los distractores salen del mismo tema para que el examen sea exigente de verdad.</p>' +
    '<div class="formgrid">' +
    '<div class="field"><label>Tema</label><select class="select" id="qz-cat"><option value="all">Todos los temas</option>' +
    Object.keys(SUBS).map((s) => '<option value="' + s + '">' + esc(SUBS[s].name) + "</option>").join("") + "</select></div>" +
    '<div class="field"><label>Nivel</label><select class="select" id="qz-lvl"><option value="all">Todos</option><option value="1">A1</option><option value="2">A2</option><option value="3">B1</option><option value="4">B2</option></select></div>' +
    '<div class="field"><label>Preguntas</label><div class="seg" id="qz-len"><button data-v="10" class="on">10</button><button data-v="20">20</button></div></div>' +
    "</div>" +
    '<button class="btn btn-primary" id="qz-start">Empezar quiz</button></div>';
  wireSeg("qz-len");
  document.getElementById("qz-start").addEventListener("click", () => {
    startQuiz(document.getElementById("qz-cat").value, document.getElementById("qz-lvl").value, parseInt(document.querySelector("#qz-len .on").getAttribute("data-v"), 10));
  });
}

function startQuiz(cat, lvl, len, onlyIds) {
  let pool = onlyIds ? onlyIds.map((id) => BY_ID[id]).filter(Boolean) : ITEMS.filter((it) => {
    if (cat !== "all" && it.sub !== cat) return false;
    if (lvl !== "all" && String(it.lvl) !== lvl) return false;
    return true;
  });
  if (pool.length < 4) { toast("No hay suficientes entradas en ese filtro (mínimo 4)."); return; }
  const qs = shuffle(pool.slice()).slice(0, Math.min(len, pool.length)).map((it) => {
    const dir = Math.random() < 0.5 ? "en-es" : "es-en";
    const sameSub = shuffle(ITEMS.filter((x) => x.id !== it.id && x.sub === it.sub && x.type === it.type));
    const others = shuffle(ITEMS.filter((x) => x.id !== it.id && x.sub !== it.sub && x.type === it.type));
    const distract = sameSub.concat(others).slice(0, 3);
    const opts = shuffle([it].concat(distract).map((x) => x.id));
    return { id: it.id, dir, opts, picked: null };
  });
  quiz = { active: true, qs, i: 0, correct: 0, scopeLabel: onlyIds ? "repaso de errores" : scopeLabel(cat, lvl) };
  renderQuiz();
}

function renderQuiz() {
  if (quiz.i >= quiz.qs.length) { renderQuizEnd(); return; }
  const q = quiz.qs[quiz.i];
  const it = BY_ID[q.id];
  const askEN = q.dir === "en-es";
  const letters = ["A", "B", "C", "D"];
  view.innerHTML =
    '<div class="quiz-q"><div class="session-head"><span class="session-count">Pregunta ' + (quiz.i + 1) + " / " + quiz.qs.length + " · aciertos " + quiz.correct + "</span>" +
    '<div class="progress-line"><i style="width:' + Math.round((quiz.i / quiz.qs.length) * 100) + '%"></i></div>' +
    '<button class="btn btn-mini btn-ghost" data-action="quiz-quit">Salir</button></div>' +
    '<div class="q-prompt-label">' + (askEN ? "¿Qué significa?" : "¿Cómo se dice en inglés?") + ' <span style="color:var(--ink-3)">· ' + esc(quiz.scopeLabel) + "</span></div>" +
    '<div class="q-prompt"' + (askEN ? ' lang="en"' : "") + ">" + esc(askEN ? it.en : it.es) + "</div>" +
    (askEN ? '<div style="margin:-14px 0 20px"><button class="speak" data-action="speak" data-id="' + it.id + '">' + SPEAK_ICON + "</button></div>" : "") +
    '<div class="options">' + q.opts.map((oid, n) => {
      const o = BY_ID[oid];
      const txt = askEN ? o.es : o.en;
      let cls = "option";
      if (q.picked !== null) {
        if (oid === q.id) cls += " ok";
        else if (n === q.picked) cls += " bad";
        else cls += " dim";
      }
      return '<button class="' + cls + '" data-action="quiz-pick" data-n="' + n + '"' + (q.picked !== null ? " disabled" : "") + '><span class="oletter">' + letters[n] + '</span><span' + (!askEN ? ' lang="en"' : "") + ">" + esc(txt) + "</span></button>";
    }).join("") + "</div>" +
    '<div class="q-foot"><span>Pulsa <span class="kbd">1</span>–<span class="kbd">4</span> para responder</span><span>N.º ' + pad(it.id) + "</span></div></div>";
}

function pickQuiz(n) {
  const q = quiz.qs[quiz.i];
  if (q.picked !== null) return;
  q.picked = n;
  const good = q.opts[n] === q.id;
  if (good) quiz.correct++;
  Store.grade(q.id, good);
  renderQuiz();
  setTimeout(() => { if (quiz && quiz.active) { quiz.i++; renderQuiz(); } }, 1050);
}

function renderQuizEnd() {
  const total = quiz.qs.length, ok = quiz.correct;
  const pct = Math.round((ok / total) * 100);
  const msg = pct === 100 ? "Perfección absoluta. Este tema es tuyo." : pct >= 80 ? "Excelente nivel. Casi no fallas nada." : pct >= 60 ? "Buen avance. Repasa los errores y vuelve." : "Cada error es una tarjeta ganada. Repásalos ahora.";
  const wrongIds = quiz.qs.filter((q) => q.opts[q.picked] !== q.id).map((q) => q.id);
  Store.data.quizzes.unshift({ t: Date.now(), total, ok, scope: quiz.scopeLabel });
  if (Store.data.quizzes.length > 50) Store.data.quizzes.length = 50;
  Store.save();
  view.innerHTML =
    '<div class="summary"><p class="eyebrow">Resultado del quiz</p>' +
    '<div class="summary-score">' + ok + " / " + total + '</div><p class="summary-msg">' + msg + ' <strong>' + pct + '%</strong>. Quedó registrado en tu progreso.</p>' +
    '<div class="summary-actions"><button class="btn btn-primary" data-action="quiz-again">Otro quiz</button>' +
    (wrongIds.length ? '<button class="btn btn-dark" data-action="quiz-retry">Repetir los ' + wrongIds.length + " errores</button>" : "") +
    '<a class="btn btn-ghost" href="#/tarjetas">Ir a tarjetas</a></div>' +
    (wrongIds.length ? '<div class="wronglist">' + wrongIds.map((id) => rowHTML(BY_ID[id])).join("") + "</div>" : "") +
    "</div>";
  const w = wrongIds.slice();
  quiz = { active: false, retry: w };
}

function viewProgreso() {
  const c = Store.counts();
  const pct = Math.round((c.known / ITEMS.length) * 100);
  const cells = [];
  for (let d = 13; d >= 0; d--) {
    const dt = new Date(); dt.setDate(dt.getDate() - d);
    const k = dayKey(dt), n = Store.data.days[k] || 0;
    const lvl = n === 0 ? "" : n < 5 ? "lvl1" : n < 15 ? "lvl2" : "lvl3";
    cells.push('<div class="heat-cell ' + lvl + '" title="' + k + ": " + n + ' acciones"><b>' + (n || "·") + "</b><span>" + dt.getDate() + "/" + (dt.getMonth() + 1) + "</span></div>");
  }
  const catRows = Object.keys(SUBS).map((s) => {
    const items = ITEMS.filter((it) => it.sub === s);
    const known = items.filter((it) => Store.status(it.id) === "known").length;
    const p = Math.round((known / items.length) * 100);
    return '<div class="cat-row"><span class="cname"><span class="cdot" style="--c:' + SUBS[s].color + '"></span>' + esc(SUBS[s].name) + '</span><span class="cat-track"><i style="--c:' + SUBS[s].color + ";width:" + p + '%"></i></span><span class="cnum">' + known + "/" + items.length + "</span></div>";
  }).join("");
  const wordsKnown = ITEMS.filter((it) => it.type === "word" && Store.status(it.id) === "known").length;
  const phrasesKnown = ITEMS.filter((it) => it.type === "phrase" && Store.status(it.id) === "known").length;
  view.innerHTML =
    '<p class="eyebrow">Tu avance, guardado al instante</p>' +
    '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Progreso <em>' + pct + "%</em></h1>" +
    '<p class="sub">Cada tarjeta calificada, cada respuesta del quiz y cada cambio de estado se guarda automáticamente en este navegador. Sin cuentas, sin nube: tu cuaderno es tuyo.</p>' +
    '<div class="two-col"><div class="panel" style="display:flex;gap:20px;align-items:center">' + ringSVG(c.known / ITEMS.length, 120, 12) +
    '<div><h2>' + c.known + " / 1000 dominadas</h2><p class='hint' style='margin:0'>" + c.learning + " aprendiendo · " + c.fresh + " nuevas<br>Palabras: " + wordsKnown + "/500 · Frases: " + phrasesKnown + "/500<br>Racha: <strong>" + streak() + (streak() === 1 ? " día" : " días") + "</strong></p></div></div>" +
    '<div class="panel"><h2>Actividad · últimos 14 días</h2><p class="hint">Cada día que practicas suma. La constancia gana al atracón.</p><div class="heat">' + cells.join("") + "</div></div></div>" +
    '<div class="panel" style="margin-top:22px"><h2>Por tema</h2><p class="hint">Dominadas por categoría.</p><div class="cat-bars">' + catRows + "</div></div>" +
    '<div class="two-col" style="margin-top:22px"><div class="panel"><h2>Historial de quizzes</h2><p class="hint">Tus últimos exámenes.</p>' +
    (Store.data.quizzes.length ? '<div class="qhist">' + Store.data.quizzes.slice(0, 10).map((h) => {
      const d = new Date(h.t);
      return '<div class="qhist-row"><span>' + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + " · " + esc(h.scope) + '</span><span class="score">' + h.ok + "/" + h.total + "</span></div>";
    }).join("") + "</div>" : '<p class="note">Aún no hiciste ningún quiz. <a href="#/quiz">Empieza con uno de 10</a>.</p>') +
    '</div><div class="panel"><h2>Tus datos</h2><p class="hint">Respaldo y control total.</p>' +
    '<div class="data-actions"><button class="btn btn-mini btn-dark" data-action="export">Exportar respaldo</button>' +
    '<label class="btn btn-mini btn-ghost" style="cursor:pointer">Importar respaldo<input type="file" id="import-file" accept="application/json" hidden></label>' +
    '<button class="btn btn-mini btn-ghost" data-action="reset" style="color:var(--bad);border-color:var(--bad)">Reiniciar progreso</button></div>' +
    '<p class="note">El archivo de respaldo contiene tu avance completo: estados, racha e historial. Guárdalo donde quieras y recupéralo en cualquier navegador con Importar.</p></div></div>';
  document.getElementById("import-file").addEventListener("change", importFile);
}

function download(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportData() {
  const d = new Date();
  const name = "lexicon1000-respaldo-" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + ".json";
  download(name, JSON.stringify(Store.data, null, 2));
  toast("Respaldo descargado.");
}

function importFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || d.v !== 1 || !d.items || !d.days) throw new Error("bad");
      Store.data = Object.assign(freshData(), d);
      Store.save();
      toast("Respaldo importado. Progreso restaurado.");
      route();
    } catch (err) { toast("Ese archivo no es un respaldo válido."); }
  };
  r.readAsText(f);
  e.target.value = "";
}

function resetData() {
  if (!confirm("¿Reiniciar todo tu progreso? Esta acción no se puede deshacer. Exporta un respaldo primero si dudas.")) return;
  Store.data = freshData();
  Store.save();
  toast("Progreso reiniciado. A empezar de cero.");
  route();
}

const API_BASE = "https://lexicon1000-api.juanjosegalvizrozo2.workers.dev";
const SES_KEY = "lexicon1000.session";

function mergeProgress(local, cloud) {
  const m = freshData();
  m.created = (local.created && cloud.created) ? (local.created < cloud.created ? local.created : cloud.created) : (local.created || cloud.created || new Date().toISOString());
  m.items = {};
  const ids = {};
  Object.keys(local.items || {}).forEach((k) => { ids[k] = 1; });
  Object.keys(cloud.items || {}).forEach((k) => { ids[k] = 1; });
  Object.keys(ids).forEach((id) => {
    const a = (local.items || {})[id], b = (cloud.items || {})[id];
    m.items[id] = (a && b) ? (((b.l || 0) >= (a.l || 0)) ? b : a) : (a || b);
  });
  m.days = {};
  [(local.days || {}), (cloud.days || {})].forEach((dd) => {
    Object.keys(dd).forEach((k) => { m.days[k] = Math.max(m.days[k] || 0, dd[k] || 0); });
  });
  const seen = {}, qz = [];
  (local.quizzes || []).concat(cloud.quizzes || []).forEach((q) => {
    const k = (q.t || 0) + "-" + (q.ok || 0) + "/" + (q.total || 0) + "-" + String(q.scope || "");
    if (!seen[k]) { seen[k] = 1; qz.push(q); }
  });
  qz.sort((x, y) => (y.t || 0) - (x.t || 0));
  m.quizzes = qz.slice(0, 50);
  m.milestone = Math.max(local.milestone || 0, cloud.milestone || 0);
  m.autoSpeak = !!local.autoSpeak;
  return m;
}

const Cloud = {
  session: null, state: "out", lastSync: 0, timer: null, busy: false, quiet: 0,
  load() {
    try { this.session = JSON.parse(localStorage.getItem(SES_KEY)); } catch (e) { this.session = null; }
    if (!this.session || !this.session.token || !this.session.email) { this.session = null; this.state = "out"; }
    else this.state = "in";
  },
  saveSession() {
    try {
      if (this.session) localStorage.setItem(SES_KEY, JSON.stringify(this.session));
      else localStorage.removeItem(SES_KEY);
    } catch (e) {}
  },
  async call(path, opts) {
    const r = await fetch(API_BASE + path, opts);
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  },
  authHeaders() { return { "Content-Type": "application/json", "Authorization": "Bearer " + this.session.token }; },
  errText(code) {
    return { exists: "Esa cuenta ya existe. Entra con tu contraseña.", credentials: "Correo o contraseña incorrectos.", password: "La contraseña necesita al menos 6 caracteres.", email: "Escribe un correo válido.", data: "No se pudo sincronizar.", auth: "Tu sesión caducó. Entra de nuevo.", net: "Sin conexión. Comprueba tu internet." }[code] || "Algo falló. Inténtalo de nuevo.";
  },
  async start(email, token) {
    this.session = { email: email, token: token };
    this.saveSession();
    this.state = "in";
    await this.firstSync();
    route();
  },
  async signup(email, pw) {
    let r;
    try { r = await this.call("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, password: pw }) }); }
    catch (e) { return "net"; }
    if (!r.body || !r.body.ok) return (r.body && r.body.error) || "net";
    await this.start(r.body.email, r.body.token);
    return null;
  },
  async login(email, pw) {
    let r;
    try { r = await this.call("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email, password: pw }) }); }
    catch (e) { return "net"; }
    if (!r.body || !r.body.ok) return (r.body && r.body.error) || "net";
    await this.start(r.body.email, r.body.token);
    return null;
  },
  async firstSync() {
    let r;
    try { r = await this.call("/api/pull", { headers: this.authHeaders() }); }
    catch (e) { toast("Sin conexión con la nube. Tu avance sigue guardado en este dispositivo."); return; }
    if (r.status === 401) { this.dropSession(); toast("Tu sesión caducó. Entra de nuevo."); return; }
    const cloud = r.body && r.body.data;
    if (cloud) {
      const merged = mergeProgress(Store.data, cloud);
      this.quiet++;
      Store.data = merged;
      Store.save();
      this.quiet--;
      this.lastSync = Date.now();
      this.state = "ok";
      this.paint();
      await this.pushNow();
      toast("Progreso combinado con tu nube.");
    } else {
      await this.pushNow();
      toast("Perfil listo. Tu avance ya está en la nube.");
    }
  },
  schedulePush() {
    if (!this.session || this.quiet) return;
    this.state = "pending";
    this.paint();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.pushNow(), 2500);
  },
  async pushNow() {
    if (!this.session || this.busy) return;
    this.busy = true;
    this.state = "syncing";
    this.paint();
    try {
      const r = await this.call("/api/push", { method: "POST", headers: this.authHeaders(), body: JSON.stringify({ data: Store.data }) });
      if (r.status === 401) { this.busy = false; this.dropSession(); toast("Tu sesión caducó. Entra de nuevo."); route(); return; }
      if (r.body && r.body.ok) { this.lastSync = r.body.updatedAt || Date.now(); this.state = "ok"; }
      else this.state = "error";
    } catch (e) { this.state = "error"; }
    this.busy = false;
    this.paint();
  },
  async pullNow(silent) {
    if (!this.session || this.busy) return;
    this.busy = true;
    this.state = "syncing";
    this.paint();
    try {
      const r = await this.call("/api/pull", { headers: this.authHeaders() });
      if (r.status === 401) { this.busy = false; this.dropSession(); if (!silent) toast("Tu sesión caducó. Entra de nuevo."); route(); return; }
      if (r.body && r.body.ok) {
        if (r.body.data) {
          const merged = mergeProgress(Store.data, r.body.data);
          this.quiet++;
          Store.data = merged;
          Store.save();
          this.quiet--;
          this.lastSync = Date.now();
          if (!silent) toast("Progreso actualizado desde la nube.");
          await this.pushNow();
        } else {
          await this.pushNow();
          if (!silent) toast("Aún no hay nada en la nube. Se subió tu avance actual.");
        }
        this.state = "ok";
      } else this.state = "error";
    } catch (e) { this.state = "error"; }
    this.busy = false;
    this.paint();
    if (!silent && (location.hash || "").indexOf("perfil") >= 0) viewPerfil();
  },
  dropSession() { this.session = null; this.state = "out"; this.lastSync = 0; this.saveSession(); },
  async logout() {
    if (this.session) {
      try { await this.call("/api/logout", { method: "POST", headers: this.authHeaders() }); } catch (e) {}
    }
    this.dropSession();
    toast("Sesión cerrada. Tu avance sigue en este dispositivo.");
    route();
  },
  async deleteAccount() {
    if (!this.session) return;
    try { await this.call("/api/account", { method: "DELETE", headers: this.authHeaders() }); } catch (e) {}
    this.dropSession();
    toast("Cuenta y datos de la nube borrados. Tu avance local no se tocó.");
    route();
  },
  ago() {
    if (!this.lastSync) return "nunca";
    const s = Math.round((Date.now() - this.lastSync) / 1000);
    if (s < 10) return "ahora mismo";
    if (s < 60) return "hace " + s + " s";
    const m = Math.round(s / 60);
    if (m < 60) return "hace " + m + " min";
    return "hace " + Math.round(m / 60) + " h";
  },
  paint() {
    const el = document.getElementById("syncstate");
    if (!el) return;
    const map = { out: ["", "Sin sesión"], pending: ["busy", "Subiendo…"], syncing: ["busy", "Sincronizando…"], ok: ["ok", "Sincronizado"], error: ["err", "Falló el envío"] };
    const st = map[this.state] || map.out;
    el.className = "sync-pill " + st[0];
    el.innerHTML = '<span class="sdot"></span>' + st[1] + (this.state === "ok" && this.lastSync ? " · " + this.ago() : "");
  }
};

function viewPerfil() {
  if (!Cloud.session) {
    view.innerHTML =
      '<p class="eyebrow">Tu cuaderno en la nube</p>' +
      '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Tu <em>perfil</em></h1>' +
      '<p class="sub">Crea tu cuenta una vez y tu progreso viajará contigo: entra desde el móvil, otro navegador u otro ordenador y todo seguirá ahí. Tu contraseña viaja cifrada y se guarda como huella irreversible.</p>' +
      '<div class="two-col"><div class="panel"><h2>Entrar</h2><p class="hint">Si ya tienes cuenta, recupera tu avance aquí.</p>' +
      '<div class="auth-form"><input id="li-email" type="email" placeholder="tu@correo.com" autocomplete="email" aria-label="Correo">' +
      '<input id="li-pass" type="password" placeholder="Contraseña" autocomplete="current-password" aria-label="Contraseña">' +
      '<div class="auth-err" id="li-err"></div>' +
      '<div><button class="btn btn-primary" id="li-go">Entrar y sincronizar</button></div></div></div>' +
      '<div class="panel"><h2>Crear cuenta</h2><p class="hint">Un correo y una contraseña de 6 letras o más. Sin verificación ni spam.</p>' +
      '<div class="auth-form"><input id="su-email" type="email" placeholder="tu@correo.com" autocomplete="email" aria-label="Correo">' +
      '<input id="su-pass" type="password" placeholder="Contraseña (mín. 6)" autocomplete="new-password" aria-label="Contraseña">' +
      '<div class="auth-err" id="su-err"></div>' +
      '<div><button class="btn btn-dark" id="su-go">Crear mi perfil</button></div></div></div></div>';
    const li = () => {
      const em = document.getElementById("li-email").value, pw = document.getElementById("li-pass").value;
      document.getElementById("li-err").textContent = "";
      Cloud.login(em, pw).then((err) => {
        const e = document.getElementById("li-err");
        if (err && e) e.textContent = Cloud.errText(err);
      });
    };
    const su = () => {
      const em = document.getElementById("su-email").value, pw = document.getElementById("su-pass").value;
      document.getElementById("su-err").textContent = "";
      Cloud.signup(em, pw).then((err) => {
        const e = document.getElementById("su-err");
        if (err && e) e.textContent = Cloud.errText(err);
      });
    };
    document.getElementById("li-go").addEventListener("click", li);
    document.getElementById("su-go").addEventListener("click", su);
    return;
  }
  const c = Store.counts();
  view.innerHTML =
    '<p class="eyebrow">Tu cuaderno en la nube</p>' +
    '<h1 class="title" style="font-size:clamp(28px,4.5vw,44px)">Hola de nuevo</h1>' +
    '<div class="two-col"><div class="panel"><div class="profile-email">' + esc(Cloud.session.email) + '</div>' +
    '<p class="hint">Este dispositivo guarda ' + c.known + ' dominadas, ' + c.learning + ' aprendiendo y ' + Store.data.quizzes.length + ' quizzes. Todo viaja a tu nube.</p>' +
    '<div style="margin:6px 0 16px"><span class="sync-pill" id="syncstate"></span></div>' +
    '<div class="data-actions"><button class="btn btn-mini btn-dark" id="pf-sync">Sincronizar ahora</button>' +
    '<button class="btn btn-mini btn-ghost" id="pf-out">Cerrar sesión</button>' +
    '<button class="btn btn-mini btn-ghost" id="pf-del" style="color:var(--bad);border-color:var(--bad)">Borrar cuenta y nube</button></div></div>' +
    '<div class="panel"><h2>¿Cómo funciona?</h2><p class="hint">Cada cambio se sube solo a tu nube unos segundos después.</p>' +
    '<p class="note">· Entra con este mismo correo en otro navegador o en el móvil y pulsa <strong>Sincronizar ahora</strong>: tu avance aparece allí.<br>· Si practicaste sin conexión en dos sitios, al sincronizar se <strong>combinan</strong> sin perder nada.<br>· Cerrar sesión no borra lo de este dispositivo. Borrar la cuenta elimina tu nube, no tu avance local.</p></div></div>';
  Cloud.paint();
  document.getElementById("pf-sync").addEventListener("click", () => Cloud.pullNow());
  document.getElementById("pf-out").addEventListener("click", () => Cloud.logout());
  document.getElementById("pf-del").addEventListener("click", () => {
    if (confirm("¿Borrar tu cuenta y todos los datos guardados en la nube? Tu avance en este dispositivo no se toca.")) Cloud.deleteAccount();
  });
}

const view = document.getElementById("view");

function route() {
  const h = location.hash || "#/inicio";
  const name = h.replace("#/", "").split("?")[0] || "inicio";
  flash = flash && flash.active && name === "tarjetas" ? flash : (name === "tarjetas" && flash && flash.retry ? flash : null);
  quiz = quiz && quiz.active && name === "quiz" ? quiz : (name === "quiz" && quiz && quiz.retry ? quiz : null);
  setNav(name);
  window.scrollTo(0, 0);
  if (name === "inicio") viewInicio();
  else if (name === "explorar") viewExplorar();
  else if (name === "tarjetas") viewTarjetas();
  else if (name === "quiz") viewQuiz();
  else if (name === "progreso") viewProgreso();
  else if (name === "perfil") viewPerfil();
  else viewInicio();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.getAttribute("data-action");
  const id = parseInt(t.getAttribute("data-id"), 10);
  if (a === "speak" && id) { speak(BY_ID[id].en); }
  else if (a === "cycle" && id) {
    const r = Store.cycle(id);
    document.querySelectorAll('[data-action="cycle"][data-id="' + id + '"]').forEach((b) => {
      const nb = document.createElement("template");
      nb.innerHTML = stateBlock(BY_ID[id], r.stamped).trim();
      const fresh = nb.content.firstChild;
      b.replaceWith(fresh);
    });
    document.querySelectorAll(".row").forEach((row) => {
      const btn = row.querySelector('[data-id="' + id + '"]');
      if (btn) row.className = "row st-" + Store.status(id);
    });
    if (r.stamped) toast("¡<span class='stamp-word'>Dominada</span>! " + esc(BY_ID[id].en));
    renderTopstat();
  }
  else if (a === "filter-cat") { explore.cat = t.getAttribute("data-v"); explore.shown = 60; viewExplorar(); }
  else if (a === "flash-ok") gradeFlash(true);
  else if (a === "flash-bad") gradeFlash(false);
  else if (a === "flash-quit") { flash = null; viewTarjetas(); }
  else if (a === "flash-again") { flash = null; viewTarjetas(); }
  else if (a === "flash-retry") {
    const ids = (flash && flash.retry) || [];
    flash = null;
    if (!ids.length) { viewTarjetas(); return; }
    flash = { active: true, deck: ids.slice(0, 40), i: 0, ok: [], bad: [], flipped: false, dir: null, _dir: null, scopeLabel: "repaso de errores" };
    renderFlash();
  }
  else if (a === "quiz-pick") pickQuiz(parseInt(t.getAttribute("data-n"), 10));
  else if (a === "quiz-quit") { quiz = null; viewQuiz(); }
  else if (a === "quiz-again") { quiz = null; viewQuiz(); }
  else if (a === "quiz-retry") {
    const ids = (quiz && quiz.retry) || [];
    quiz = null;
    if (ids.length < 4) { toast("Necesitas al menos 4 errores para repetir. Haz otro quiz."); viewQuiz(); return; }
    startQuiz("all", "all", ids.length, ids);
  }
  else if (a === "export") exportData();
  else if (a === "reset") resetData();
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (flash && flash.active && flash.i < flash.deck.length && document.getElementById("flip")) {
    if (e.key === " ") { e.preventDefault(); flipFlash(); }
    else if (e.key === "1") gradeFlash(false);
    else if (e.key === "2") gradeFlash(true);
  } else if (quiz && quiz.active && quiz.i < quiz.qs.length && quiz.qs[quiz.i].picked === null) {
    if (["1", "2", "3", "4"].includes(e.key)) pickQuiz(parseInt(e.key, 10) - 1);
  }
});

window.addEventListener("hashchange", route);

Store.load();
Cloud.load();
renderTopstat();
route();
if (Cloud.session) Cloud.pullNow(true);
