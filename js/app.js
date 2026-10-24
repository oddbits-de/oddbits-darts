import { thrower, dartLabel, average, firstNine, marksPerRound, checkoutRate, isPossibleVisit, isOneDartFinish, CRICKET_TARGETS } from "./rules.js";
import { summarize, summarizeModes, historyPlayers, validRecord, validGame, locate, statsOf } from "./stats.js";
import { play, MODES, HALVE_TARGETS, raceTarget, bobsTarget } from "./modes.js";
import { putMatch, putMatches, deleteMatch, allMatches, deleteDatabase } from "./db.js";
import { suggestCheckout, isBogey } from "./checkout.js";
import { I18N } from "./i18n.js";
import { BOT_LEVELS, botPlayer, botDart, isBotLevel } from "./bot.js";

const VERSION = "0.6";
const KEY = "oddbits-darts-";
const MAX_PLAYERS = 8;

const $ = id => document.getElementById(id);

function load(name, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + name));
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function save(name, value) {
  try {
    if (value === null) localStorage.removeItem(KEY + name);
    else localStorage.setItem(KEY + name, JSON.stringify(value));
  } catch (e) {}
}

const DEFAULT_SETTINGS = {
  theme: null,
  lang: (navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en",
  inputX01: "dart",
  favDouble: 0,
  vibrate: true,
  palette: "pub"
};
const freshSetup = () => ({ game: "x01", start: 501, inMode: "single", outMode: "double", variant: "standard", legs: 1, sets: 1, jumps: false, rounds: 7, lives: 3, attempts: 10, dartsPer: 3, holes: 9, alley: 20, teams: false, teamOf: {}, folds: {}, lineup: [] });
const ID_RE = /^[A-Za-z0-9:+_.-]{1,200}$/;
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const GAME_GROUPS = [["groupMatch", ["x01", "cricket"]], ["groupTraining", ["atc", "doubles", "bobs27", "checkout121", "randomco"]], ["groupParty", ["shanghai", "killer", "halveit", "golf", "bowling"]]];

// Gespeicherte Werte können aus älteren Versionen stammen oder beschädigt sein: nur bekannte Formen übernehmen.
function cleanSettings(v) {
  const s = { ...DEFAULT_SETTINGS, ...(isObj(v) ? v : {}) };
  if (s.lang !== "de" && s.lang !== "en") s.lang = DEFAULT_SETTINGS.lang;
  if (s.theme !== "light" && s.theme !== "dark") s.theme = null;
  if (s.inputX01 !== "sum") s.inputX01 = "dart";
  if (!Number.isInteger(s.favDouble) || s.favDouble < 0 || s.favDouble > 20) s.favDouble = 0;
  s.vibrate = s.vibrate !== false;
  if (s.palette !== "classic") s.palette = "pub";
  return s;
}

function cleanRoster(v) {
  return Array.isArray(v) ? v.filter(p => isObj(p) && typeof p.id === "string" && ID_RE.test(p.id) && typeof p.name === "string" && p.name.trim()).map(p => ({ id: p.id, name: p.name.trim().slice(0, 20) })) : [];
}

function cleanSetup(v) {
  const s = { ...freshSetup(), ...(isObj(v) ? v : {}) };
  const base = freshSetup();
  Object.keys(base).forEach(k => {
    if (typeof s[k] !== typeof base[k] || Array.isArray(s[k]) !== Array.isArray(base[k])) s[k] = base[k];
  });
  s.lineup = s.lineup.filter(id => typeof id === "string").slice(0, MAX_PLAYERS);
  if (!isObj(s.teamOf)) s.teamOf = {};
  if (!isObj(s.folds)) s.folds = {};
  s.legs = Math.min(11, Math.max(1, Math.round(s.legs) || 1));
  s.sets = Math.min(9, Math.max(1, Math.round(s.sets) || 1));
  return s;
}

// Vor dem ersten Speichern prüfen, ob die App hier schon benutzt wurde: nur dann gibt es das „Was ist neu“-Fenster.
const returning = ["settings", "players", "setup", "match"].some(k => { try { return localStorage.getItem(KEY + k) !== null; } catch (e) { return false; } });
let settings = cleanSettings(load("settings", {}));
let roster = cleanRoster(load("players", []));
let setup = cleanSetup(load("setup", {}));
let match = load("match", null);
let state = null;
let mod = 1;
let sumEntry = "";
let sheetDismissable = true;

const t = k => I18N[settings.lang][k];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function randInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

function uid() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

function fmt(x) {
  return x.toLocaleString(settings.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function announce(text) {
  $("status").textContent = text;
}

function vibrate(pattern) {
  if (!settings.vibrate || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) {}
}

let toastTimer = 0;
function toast(text, kind) {
  const el = $("toast");
  el.textContent = text;
  el.className = "toast" + (kind ? " toast-" + kind : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1400);
}

/* ===== Design & Sprache ===== */

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const th = settings.theme || (darkQuery.matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", th);
  document.documentElement.setAttribute("data-palette", settings.palette === "classic" ? "classic" : "pub");
  $("themeBtn").setAttribute("aria-label", th === "dark" ? t("themeToLight") : t("themeToDark"));
}
darkQuery.addEventListener("change", () => { if (!settings.theme) applyTheme(); });

function applyTexts() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll("[data-t]").forEach(el => {
    const v = t(el.dataset.t);
    if (typeof v === "string") el.textContent = v;
  });
  $("langBtn").textContent = settings.lang.toUpperCase();
  $("langBtn").setAttribute("aria-label", t("langSwitch"));
  $("settingsBtn").setAttribute("aria-label", t("settings"));
  $("statsBtn").setAttribute("aria-label", t("stats"));
  $("statsBackBtn").setAttribute("aria-label", t("back"));
  $("gSettingsBtn").setAttribute("aria-label", t("settings"));
  $("leaveBtn").setAttribute("aria-label", t("back"));
  $("addName").placeholder = t("addPlaceholder");
  $("addName").setAttribute("aria-label", t("addPlaceholder"));
  applyTheme();
}

function saveSettings() {
  save("settings", settings);
}

/* ===== Segment-Schalter ===== */

function seg(el, opts, cur, pick) {
  el.innerHTML = opts.map(o =>
    `<button type="button" data-v="${esc(o.v)}" aria-pressed="${String(o.v) === String(cur)}"${o.disabled ? " disabled" : ""}>${esc(o.label)}</button>`
  ).join("");
  el.onclick = e => {
    const b = e.target.closest("button");
    if (b && !b.disabled) pick(b.dataset.v);
  };
}

/* ===== Start ===== */

function botFromId(id) {
  const m = /^bot:(\d+)$/.exec(id);
  return m && isBotLevel(Number(m[1])) ? botPlayer(Number(m[1])) : null;
}

function lineupPlayers() {
  return setup.lineup.map(id => roster.find(p => p.id === id) || botFromId(id)).filter(Boolean);
}

function botsAllowed() {
  return (setup.game === "x01" || setup.game === "cricket") && !teamsOn();
}

function saveSetup() {
  save("setup", setup);
}

function renderSetup() {
  $("gamePick").innerHTML = GAME_GROUPS.map(([g, games]) => {
    const grid = `<div class="game-grid">${games.map(v => `<button type="button" class="gbtn" data-v="${v}" aria-pressed="${setup.game === v}">${esc(t("g_" + v))}</button>`).join("")}</div>`;
    if (g === "groupMatch") return `<div class="game-group"><span class="kicker">${esc(t(g))}</span>${grid}</div>`;
    const inside = games.includes(setup.game);
    const open = setup.folds[g] ?? inside;
    return `<details class="game-group game-fold" data-g="${g}"${open ? " open" : ""}>
      <summary><span class="kicker">${esc(t(g))}</span>${inside ? `<span class="fold-sel">${esc(t("g_" + setup.game))}</span>` : ""}</summary>${grid}</details>`;
  }).join("");
  renderModeOpts();
  $("formatBlock").hidden = MODES.includes(setup.game);
  seg($("teamSeg"), [{ v: "off", label: t("off") }, { v: "on", label: t("on") }], setup.teams ? "on" : "off", v => {
    setup.teams = v === "on";
    saveSetup();
    renderSetup();
  });
  seg($("startSeg"), [301, 501, 701].map(v => ({ v, label: String(v) })), setup.start, v => { setup.start = Number(v); saveSetup(); renderSetup(); });
  seg($("inSeg"), ["single", "double"].map(v => ({ v, label: t(v) })), setup.inMode, v => { setup.inMode = v; saveSetup(); renderSetup(); });
  seg($("outSeg"), ["single", "double", "master"].map(v => ({ v, label: t(v) })), setup.outMode, v => { setup.outMode = v; saveSetup(); renderSetup(); });
  seg($("variantSeg"), ["standard", "cutthroat"].map(v => ({ v, label: t(v) })), setup.variant, v => { setup.variant = v; saveSetup(); renderSetup(); });
  $("x01Opts").hidden = setup.game !== "x01";
  $("cricketOpts").hidden = setup.game !== "cricket";
  $("variantNote").textContent = setup.variant === "cutthroat" ? t("noteCutthroat") : t("noteStandard");
  $("legsVal").textContent = setup.legs;
  $("setsVal").textContent = setup.sets;
  $("setsSub").textContent = setup.sets === 1 ? t("noSets") : t("setsTo");
  renderLineup();
  renderResume();
}

function renderModeOpts() {
  const g = setup.game;
  const rows = [];
  const opt = (key, label, values, fmtv) => rows.push({ key, label, values, fmtv });
  if (g === "atc") opt("jumps", t("optJumps"), [false, true], v => (v ? t("on") : t("off")));
  if (g === "shanghai") opt("rounds", t("optRounds"), [7, 20]);
  if (g === "killer") opt("lives", t("optLives"), [3, 5]);
  if (g === "checkout121" || g === "randomco") opt("attempts", t("optAttempts"), [5, 10, 20]);
  if (g === "randomco") opt("dartsPer", t("optDartsPer"), [3, 6, 9]);
  if (g === "golf") opt("holes", t("optHoles"), [9, 18]);
  const el = $("modeOpts");
  el.hidden = !MODES.includes(g);
  if (el.hidden) return;
  el.innerHTML = rows.map(r => `<div class="opt"><span class="opt-label">${esc(r.label)}</span><div class="seg" data-key="${r.key}" role="group"></div></div>`).join("")
    + (g === "bowling" ? `<div class="opt"><label class="opt-label" for="alleySel">${esc(t("optAlley"))}</label><select class="select" id="alleySel">${
      Array.from({ length: 20 }, (_, i) => 20 - i).map(n => `<option value="${n}"${setup.alley === n ? " selected" : ""}>${n}</option>`).join("")}</select></div>` : "")
    + `<p class="opt-note">${esc(t("rule_" + g))}</p>`;
  const alley = el.querySelector("#alleySel");
  if (alley) alley.addEventListener("change", e => { setup.alley = Number(e.target.value); saveSetup(); });
  rows.forEach(r => {
    seg(el.querySelector(`[data-key="${r.key}"]`), r.values.map(v => ({ v, label: r.fmtv ? r.fmtv(v) : String(v) })), setup[r.key], v => {
      setup[r.key] = v === "true" ? true : v === "false" ? false : Number(v);
      saveSetup();
      renderModeOpts();
    });
  });
}

function minPlayers() {
  return setup.game === "killer" ? 2 : 1;
}

const TEAM_LETTERS = ["A", "B", "C", "D"];

function teamsOn() {
  return setup.teams && (setup.game === "x01" || setup.game === "cricket");
}

function teamIndex(id, i) {
  const v = setup.teamOf[id];
  return Number.isInteger(v) && v >= 0 && v < 4 ? v : i % 2;
}

// Teams in der Reihenfolge ihres ersten Auftretens in der Liste; die Mitglieder in Listenreihenfolge.
function buildTeams(list) {
  const groups = new Map();
  list.forEach((p, i) => {
    const k = teamIndex(p.id, i);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ id: p.id, name: p.name });
  });
  return Array.from(groups.values()).map(members => ({
    id: "team:" + members.map(m => m.id).sort().join("+"),
    name: members.map(m => m.name).join(" & "),
    members
  }));
}

function startProblem() {
  const list = lineupPlayers();
  if (list.length < minPlayers()) return list.length ? t("killerMin") : "";
  if (teamsOn() && buildTeams(list).length < 2) return t("teamsMin");
  if (list.some(p => p.bot)) {
    if (setup.game !== "x01" && setup.game !== "cricket") return t("botGameOnly");
    if (teamsOn()) return t("botNoTeams");
    if (list.every(p => p.bot)) return t("botNeedsHuman");
  }
  return "";
}

function randomTargets(n) {
  const pool = [];
  for (let v = 40; v <= 170; v++) if (!isBogey(v, "double")) pool.push(v);
  return Array.from({ length: n }, () => pool[randInt(pool.length)]);
}

function randomNumbers(n) {
  const all = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = all.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

// Zufallsteile (Killer-Zahlen, Checkout-Ziele) stehen in der Konfiguration, damit Rückgängig und Verlauf exakt dasselbe Spiel nachrechnen.
function buildCfg(base, players) {
  const g = base.game;
  if (g === "x01" || g === "cricket") {
    const { start, inMode, outMode, variant, legs, sets } = base;
    return { game: g, start, inMode, outMode, variant, legs, sets, players };
  }
  const cfg = { game: g, legs: 1, sets: 1, players };
  if (g === "atc") cfg.jumps = !!base.jumps;
  if (g === "golf") cfg.holes = base.holes === 18 ? 18 : 9;
  if (g === "bowling") cfg.alley = Number.isInteger(base.alley) && base.alley >= 1 && base.alley <= 20 ? base.alley : 20;
  if (g === "shanghai") cfg.rounds = base.rounds === 20 ? 20 : 7;
  if (g === "killer") {
    cfg.lives = base.lives === 5 ? 5 : 3;
    cfg.numbers = randomNumbers(players.length);
  }
  if (g === "checkout121" || g === "randomco") cfg.attempts = [5, 10, 20].includes(base.attempts) ? base.attempts : 10;
  if (g === "checkout121") cfg.dartsPer = 9;
  if (g === "randomco") {
    cfg.dartsPer = [3, 6, 9].includes(base.dartsPer) ? base.dartsPer : 3;
    cfg.targets = randomTargets(cfg.attempts);
  }
  return cfg;
}

function renderResume() {
  const running = match && state && !state.finished;
  $("resumeCard").hidden = !running;
  if (running) $("resumeTitle").textContent = gameTitle(match.cfg) + " · " + match.cfg.players.map(p => p.name).join(", ");
}

function renderLineup() {
  setup.lineup = setup.lineup.filter(id => roster.some(p => p.id === id) || botFromId(id));
  const list = lineupPlayers();
  $("lineup").innerHTML = list.map((p, i) => `
    <li class="lu-row" data-id="${esc(p.id)}">
      <button type="button" class="lu-grip" aria-label="${esc(p.name)}: ${esc(t("moveHint"))}"><svg class="ico" aria-hidden="true"><use href="#i-grip"/></svg></button>
      <span class="lu-no">${i + 1}</span>
      <span class="lu-name">${esc(p.name)}</span>
      ${teamsOn() ? `<button type="button" class="lu-team team-${teamIndex(p.id, i)}" data-id="${esc(p.id)}" aria-label="${esc(t("teamOf"))} ${TEAM_LETTERS[teamIndex(p.id, i)]}: ${esc(p.name)}">${TEAM_LETTERS[teamIndex(p.id, i)]}</button>` : ""}
      <button type="button" class="lu-x" aria-label="${esc(t("remove"))}: ${esc(p.name)}"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>
    </li>`).join("");
  $("lineupHint").textContent = list.length === 0 ? t("lineupEmpty") : list.length >= MAX_PLAYERS ? t("lineupFull") : list.length > 1 ? t("lineupHint") : "";
  const rest = roster.filter(p => !setup.lineup.includes(p.id));
  $("known").innerHTML = rest.map(p => `
    <span class="chip">
      <button type="button" class="chip-add" data-id="${esc(p.id)}"${list.length >= MAX_PLAYERS ? " disabled" : ""}>+ ${esc(p.name)}</button>
      <button type="button" class="chip-x" data-id="${esc(p.id)}" aria-label="${esc(t("forget"))}: ${esc(p.name)}"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>
    </span>`).join("")
    + `<span class="chip chip-bot"><button type="button" class="chip-add" data-bot${list.length >= MAX_PLAYERS || !botsAllowed() || BOT_LEVELS.every(l => setup.lineup.includes("bot:" + l)) ? " disabled" : ""}>+ ${esc(t("addBot"))}</button></span>`;
  if (teamsOn() && list.length > 1) $("lineupHint").textContent = t("teamsHint");
  const problem = startProblem();
  $("startBtn").disabled = list.length === 0 || !!problem;
  if (problem) $("lineupHint").textContent = problem;
  $("shuffleBtn").disabled = list.length < 2;
}

function addPlayer(name) {
  name = name.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!name) return;
  let p = roster.find(q => q.name.toLowerCase() === name.toLowerCase());
  if (!p) {
    p = { id: uid(), name };
    roster.push(p);
    save("players", roster);
  }
  if (!setup.lineup.includes(p.id) && setup.lineup.length < MAX_PLAYERS) setup.lineup.push(p.id);
  saveSetup();
  renderLineup();
}

function moveInLineup(id, delta) {
  const i = setup.lineup.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= setup.lineup.length) return;
  [setup.lineup[i], setup.lineup[j]] = [setup.lineup[j], setup.lineup[i]];
  saveSetup();
  renderLineup();
  $("lineup").querySelector(`[data-id="${CSS.escape(id)}"] .lu-grip`).focus();
}

function initLineupEvents() {
  const ul = $("lineup");
  ul.addEventListener("click", e => {
    const tm = e.target.closest(".lu-team");
    if (tm) {
      const list = lineupPlayers();
      const i = list.findIndex(p => p.id === tm.dataset.id);
      setup.teamOf[tm.dataset.id] = (teamIndex(tm.dataset.id, i) + 1) % Math.min(4, Math.max(2, list.length));
      saveSetup();
      renderLineup();
      return;
    }
    const x = e.target.closest(".lu-x");
    if (!x) return;
    const id = x.closest("li").dataset.id;
    setup.lineup = setup.lineup.filter(v => v !== id);
    saveSetup();
    renderLineup();
  });
  ul.addEventListener("keydown", e => {
    const g = e.target.closest(".lu-grip");
    if (!g || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    moveInLineup(g.closest("li").dataset.id, e.key === "ArrowUp" ? -1 : 1);
  });
  // Beim Ziehen wandern nur die Nachbarzeilen; würde die gezogene Zeile selbst umgehängt, ginge der Pointer-Capture verloren.
  ul.addEventListener("pointerdown", e => {
    const row = e.target.closest(".lu-row");
    if (!row || e.target.closest(".lu-x, .lu-team") || e.button > 0) return;
    e.preventDefault();
    const g = row;
    g.setPointerCapture(e.pointerId);
    row.classList.add("is-drag");
    const above = (el, y) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; };
    const move = ev => {
      let prev, next;
      while ((prev = row.previousElementSibling) && above(prev, ev.clientY)) ul.insertBefore(prev, row.nextElementSibling);
      while ((next = row.nextElementSibling) && !above(next, ev.clientY)) ul.insertBefore(next, row);
    };
    const end = () => {
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", end);
      g.removeEventListener("pointercancel", end);
      g.removeEventListener("lostpointercapture", end);
      row.classList.remove("is-drag");
      setup.lineup = Array.from(ul.children, li => li.dataset.id);
      saveSetup();
      renderLineup();
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", end);
    g.addEventListener("pointercancel", end);
    g.addEventListener("lostpointercapture", end);
  });

  $("known").addEventListener("click", e => {
    const add = e.target.closest(".chip-add");
    const x = e.target.closest(".chip-x");
    if (add && add.dataset.bot !== undefined) {
      openBotPicker();
    } else if (add && setup.lineup.length < MAX_PLAYERS) {
      setup.lineup.push(add.dataset.id);
      saveSetup();
      renderLineup();
    } else if (x) {
      roster = roster.filter(p => p.id !== x.dataset.id);
      save("players", roster);
      renderLineup();
    }
  });

  $("addForm").addEventListener("submit", e => {
    e.preventDefault();
    addPlayer($("addName").value);
    $("addName").value = "";
  });

  $("shuffleBtn").addEventListener("click", () => {
    const a = setup.lineup.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    setup.lineup = a;
    saveSetup();
    renderLineup();
  });

  document.querySelectorAll(".stepper").forEach(st => {
    st.addEventListener("click", e => {
      const b = e.target.closest(".step-btn");
      if (!b) return;
      const key = st.dataset.step;
      const max = key === "legs" ? 11 : 9;
      setup[key] = Math.min(max, Math.max(1, setup[key] + Number(b.dataset.d)));
      saveSetup();
      renderSetup();
    });
  });
}

function openBotPicker() {
  const free = BOT_LEVELS.filter(l => !setup.lineup.includes("bot:" + l));
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(t("botPick"))}</h2>
    <p class="sheet-sub">${esc(t("botPickSub"))}</p>
    <div class="bot-pick">${free.map(l => `<button type="button" class="btn-bot" data-level="${l}">${esc(botPlayer(l).name)}</button>`).join("")}</div>
    <button type="button" class="link-btn" data-close>${esc(t("cancel"))}</button>`, el => {
    el.querySelectorAll("[data-level]").forEach(b => b.addEventListener("click", () => {
      if (setup.lineup.length < MAX_PLAYERS) setup.lineup.push("bot:" + b.dataset.level);
      saveSetup();
      closeSheet();
      renderLineup();
    }));
  });
}

function gameTitle(cfg) {
  if (cfg.game === "x01") return String(cfg.start);
  if (cfg.game === "cricket") return cfg.variant === "cutthroat" ? "Cut-Throat Cricket" : "Cricket";
  return t("g_" + cfg.game);
}

function gameMeta(cfg) {
  const parts = [];
  if (MODES.includes(cfg.game)) {
    if (cfg.game === "atc" && cfg.jumps) parts.push(t("optJumps"));
    if (cfg.game === "shanghai") parts.push(cfg.rounds + " " + t("optRounds"));
    if (cfg.game === "golf") parts.push(cfg.holes + " " + t("optHoles"));
    if (cfg.game === "bowling") parts.push(t("optAlley") + " " + cfg.alley);
    if (cfg.game === "killer") parts.push(cfg.lives + " " + t("optLives"));
    if (cfg.attempts) parts.push(cfg.attempts + " " + t("optAttempts") + " · " + cfg.dartsPer + " " + t("darts"));
    if (cfg.game === "halveit") parts.push(HALVE_TARGETS.map(halveLabel).join(" · "));
    if (!parts.length) parts.push(t("g_" + cfg.game));
    return parts.join(" · ");
  }
  if (cfg.game === "x01") {
    if (cfg.inMode === "double") parts.push(t("doubleIn"));
    parts.push(t("outShort")[cfg.outMode]);
  }
  parts.push(t("firstToLegs")(cfg.legs));
  if (cfg.sets > 1) parts.push(t("firstToSets")(cfg.sets));
  return parts.join(" · ");
}

function startMatch(cfg) {
  match = { id: uid(), cfg, actions: [], startedAt: new Date().toISOString() };
  save("match", match);
  recompute();
  showGame();
}

/* ===== Spiel ===== */

function recompute() {
  state = match ? play(match.cfg, match.actions) : null;
}

function isX01() {
  return match.cfg.game === "x01";
}

function isMode() {
  return MODES.includes(match.cfg.game);
}

function isCheckoutTraining() {
  return match.cfg.game === "checkout121" || match.cfg.game === "randomco";
}

function halveLabel(tg) {
  return tg === "D" ? t("anyDouble") : tg === "T" ? t("anyTriple") : tg === "B" ? "Bull" : String(tg);
}

function targetLabel(n, m) {
  if (n === 25) return m === 2 ? "Bull" : "25";
  return (m === 2 ? "D" : m === 3 ? "T" : "") + n;
}

function inputMode() {
  return isX01() ? settings.inputX01 : "dart";
}

const HOLD_MS = 1200;
let hold = null;
let holdTimer = 0;

function clearHold() {
  clearTimeout(holdTimer);
  holdTimer = 0;
  hold = null;
}

// Nach dem letzten Dart einer Aufnahme bleibt sie kurz im Feld stehen, sonst wäre der dritte Dart dort nie zu sehen.
function act(a) {
  if (!state || state.finished) return;
  const prev = state.current;
  const name = isMode() ? "" : thrower(state.players[prev]).name;
  clearHold();
  match.actions.push(a);
  save("match", match);
  recompute();
  mod = 1;
  sumEntry = "";
  if (!isMode() && a.t === "d" && !state.finished && state.current !== prev && !["leg", "set", "match"].includes(state.event)) {
    hold = { idx: prev, name };
    holdTimer = setTimeout(() => {
      clearHold();
      renderGame();
    }, HOLD_MS);
  }
  renderGame();
  afterAction(a);
}

const BOT_DELAY = 700;
let botTimer = 0;

function botLevel(s = state) {
  return match.cfg.players[s.current].bot;
}

function isBotTurn() {
  return !!state && !state.finished && botLevel() !== undefined;
}

function botMayThrow() {
  return isBotTurn() && !hold && !$("gameScreen").hidden && $("sheet").hidden;
}

function stopBot() {
  clearTimeout(botTimer);
  botTimer = 0;
}

function scheduleBot() {
  stopBot();
  if (botMayThrow()) botTimer = setTimeout(() => {
    botTimer = 0;
    if (!botMayThrow()) return;
    const d = botDart(state, botLevel());
    act(d);
    flyDart(dartLabel(d));
  }, BOT_DELAY);
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

// Bot-Dart erscheint groß in der Mitte der Tafel und fliegt in sein Kästchen.
function flyDart(label) {
  if (reduceMotion.matches || !$("sheet").hidden || !document.body.animate) return;
  const set = $("active").querySelectorAll(".slot.is-set");
  const slot = set[set.length - 1];
  if (!slot) return;
  const a = $("active").getBoundingClientRect();
  const r = slot.getBoundingClientRect();
  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  const el = document.createElement("div");
  el.className = "fly";
  el.setAttribute("aria-hidden", "true");
  el.textContent = label;
  el.style.left = cx + "px";
  el.style.top = cy + "px";
  document.body.appendChild(el);
  slot.classList.add("is-landing");
  const k = parseFloat(getComputedStyle(slot).fontSize) / parseFloat(getComputedStyle(el).fontSize);
  const at = (x, y, sc) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${sc})`;
  const anim = el.animate([
    { transform: at(0, 0, .4), opacity: 0 },
    { transform: at(0, 0, 1), opacity: 1, offset: .25 },
    { transform: at(0, 0, 1), opacity: 1, offset: .55 },
    { transform: at(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy, k), opacity: 1 }
  ], { duration: 600, easing: "ease-in-out" });
  const done = () => {
    el.remove();
    slot.classList.remove("is-landing");
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

function skipBot() {
  stopBot();
  clearHold();
  const who = state.current;
  const legs = state.legLog.length;
  while (botMayThrow() && state.current === who && state.legLog.length === legs) act(botDart(state, botLevel()));
}

// Index der letzten Aktion einer Person (kein Bot); Rückgängig nimmt sie samt den Bot-Darts danach zurück.
function lastHumanAction() {
  for (let i = match.actions.length - 1; i >= 0; i--) {
    const before = play(match.cfg, match.actions.slice(0, i));
    if (botLevel(before) === undefined) return i;
  }
  return -1;
}

function undo() {
  if (!match || !match.actions.length) return;
  const keep = lastHumanAction();
  if (keep < 0) return;
  stopBot();
  clearHold();
  if (state && state.finished) deleteMatch(match.id).catch(() => {});
  match.actions.length = keep;
  save("match", match);
  recompute();
  mod = 1;
  sumEntry = "";
  closeSheet();
  renderGame();
  announce(t("undo"));
}

function afterAction(a) {
  const ev = state.event;
  if (ev === "match") {
    putMatch({ id: match.id, cfg: match.cfg, actions: match.actions.slice(), startedAt: match.startedAt, finishedAt: new Date().toISOString() }).catch(() => {});
  }
  if (ev === "leg" || ev === "set" || ev === "match") {
    vibrate([120, 60, 120]);
    showResult(ev);
    return;
  }
  if (ev === "bust") {
    vibrate([60, 40, 60]);
    toast(t("bust"), "bust");
  } else if (ev === "180") {
    vibrate(250);
    toast(t("max"), "max");
  }
  const p = state.players[state.current];
  const said = a.t === "d" ? dartLabel(a) : a.t === "s" ? t("keep") : String(a.score);
  announce(said + ". " + p.name + (isX01() || isCheckoutTraining() ? ": " + p.rest : ""));
}

function markSvg(n) {
  if (n <= 0) return "";
  const slash = '<path d="M5 19 19 5"/>';
  const back = '<path d="M5 5l14 14"/>';
  const ring = '<circle cx="12" cy="12" r="9.5"/>';
  const inner = n >= 3 ? ring + slash + back : n === 2 ? slash + back : slash;
  return `<svg class="mark mark-${Math.min(n, 3)}" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

function slotsHtml(darts = state.visit) {
  const slots = [0, 1, 2].map(i => {
    const d = darts[i];
    return `<span class="slot${d ? " is-set" : ""}">${d ? esc(d.label || dartLabel(d)) : ""}</span>`;
  }).join("");
  return `<div class="slots" aria-hidden="true">${slots}</div>`;
}

// Laufende Aufnahme der Person am Wurf, sonst ihre letzte Aufnahme – zur Kontrolle neben dem Namen.
function visitHtml(p, i) {
  const live = i === state.current && state.visit.length;
  const v = live ? { darts: state.visit } : p.lastVisit;
  if (!v) return "";
  const darts = (v.darts || []).map(d => `<span class="vd">${esc(d.label || dartLabel(d))}</span>`).join("");
  let tail = "";
  if (!live && isX01()) {
    if (v.bust) tail = `<span class="vt vt-bust">Bust</span>`;
    else tail = `<span class="vt">${darts ? "= " : ""}${v.points}</span>`;
  } else if (!live && isMode() && v.note) {
    tail = `<span class="vt${v.note === "Bust" || v.note.startsWith("−") || v.note === "½" || v.note.startsWith("✗") || v.note === "X" ? " vt-bust" : ""}">${esc(v.note)}</span>`;
  }
  return darts + tail;
}

function legsText(p) {
  return (match.cfg.sets > 1 ? p.sets + " · " : "") + p.legs;
}

function renderScoresX01() {
  const head = `<div class="srow srow-head"><span>${esc(t("players"))}</span><span>${esc(match.cfg.sets > 1 ? t("sets") + " · " + t("legs") : t("legs"))}</span><span>${esc(t("avg"))}</span><span>${esc(t("rest"))}</span></div>`;
  const rows = state.players.map((p, i) => {
    const last = visitHtml(p, i);
    return `<div class="srow${i === state.current ? " is-on" : ""}">
      <span class="s-name"><span class="s-n">${esc(p.name)}</span>${last ? `<span class="s-last">${last}</span>` : ""}</span>
      <span class="s-legs">${legsText(p)}</span>
      <span class="s-avg">${p.stats.darts ? fmt(average(p.stats)) : "–"}</span>
      <span class="s-rest">${p.rest}</span>
    </div>`;
  }).join("");
  $("scores").innerHTML = head + rows;
}

function modeRow(p) {
  const g = match.cfg.game;
  if (g === "atc" || g === "doubles") return { info: p.stats.darts, big: p.pos > 20 ? "✓" : targetLabel(raceTarget(p.pos), g === "doubles" ? 2 : 1) };
  if (g === "bobs27") return { info: p.out ? t("outLabel") : "", big: p.score };
  if (g === "killer") return { info: "D" + p.num + (p.killer ? " · K" : ""), big: p.out ? "–" : p.lives };
  if (isCheckoutTraining()) return { info: p.done ? t("done") : p.target, big: p.successes };
  if (g === "golf") return { info: p.aces ? p.aces + "× 1" : "", big: p.score };
  if (g === "bowling") return { info: p.strikes ? p.strikes + "× X" : "", big: p.score };
  return { info: "", big: p.score };
}

function modeHeads() {
  const g = match.cfg.game;
  if (g === "atc" || g === "doubles") return [t("darts"), t("target")];
  if (g === "killer") return [t("number"), t("optLives")];
  if (isCheckoutTraining()) return [t("target"), "Checkouts"];
  if (g === "golf") return ["", t("strokes")];
  return ["", t("points")];
}

function renderScoresMode() {
  const [h1, h2] = modeHeads();
  const head = `<div class="srow srow-3 srow-head"><span>${esc(t("players"))}</span><span>${esc(h1)}</span><span>${esc(h2)}</span></div>`;
  const rows = state.players.map((p, i) => {
    const last = visitHtml(p, i);
    const r = modeRow(p);
    return `<div class="srow srow-3${i === state.current ? " is-on" : ""}${p.out ? " is-out" : ""}">
      <span class="s-name"><span class="s-n">${esc(p.name)}</span>${last ? `<span class="s-last">${last}</span>` : ""}</span>
      <span class="s-legs">${esc(r.info)}</span>
      <span class="s-rest">${esc(r.big)}</span>
    </div>`;
  }).join("");
  $("scores").innerHTML = head + rows;
}

function renderScoresCricket() {
  const ps = state.players;
  const showLegs = match.cfg.legs > 1 || match.cfg.sets > 1;
  const head = `<tr><th scope="col"></th>${ps.map((p, i) => `<th scope="col" class="${i === state.current ? "is-on" : ""}"><span class="c-name">${esc(p.name)}</span><span class="c-last">${visitHtml(p, i)}</span><span class="c-pts">${p.score}</span>${showLegs ? `<span class="c-legs">${legsText(p)}</span>` : ""}</th>`).join("")}</tr>`;
  const body = CRICKET_TARGETS.map(tg => {
    const dead = ps.every(p => p.marks[tg] >= 3);
    return `<tr class="${dead ? "is-dead" : ""}"><th scope="row">${tg === 25 ? esc(t("bull")) : tg}</th>${ps.map((p, i) => `<td class="${i === state.current ? "is-on" : ""}">${markSvg(p.marks[tg])}</td>`).join("")}</tr>`;
  }).join("");
  $("scores").innerHTML = `<table class="ctab ctab-${Math.min(ps.length, 8)}"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function checkoutHtml(p) {
  if (p.opened === false) return `<span class="co-note">${esc(t("notOpened"))}</span>`;
  let left = inputMode() === "sum" ? 3 : 3 - state.visit.length;
  if (isCheckoutTraining()) left = Math.min(left, match.cfg.dartsPer - p.attemptDarts);
  if (p.rest > 180) return "";
  const out = match.cfg.outMode || "double";
  const route = suggestCheckout(p.rest, left, out, settings.favDouble);
  if (route) return `<span class="co-label">${esc(t("checkoutHint"))}</span>${route.map((d, k) => `<span class="co-dart${k === route.length - 1 ? " co-fin" : ""}">${esc(dartLabel(d))}</span>`).join("")}`;
  if (state.visit.length === 0 && isBogey(p.rest, out)) return `<span class="co-note">${esc(t("noFinish"))}</span>`;
  return "";
}

function modeActive(p) {
  const g = match.cfg.game;
  const chip = (txt, fin) => `<span class="co-dart${fin ? " co-fin" : ""}">${esc(txt)}</span>`;
  const label = txt => `<span class="co-label">${esc(txt)}</span>`;
  const hitRate = p.stats.darts ? Math.round(p.stats.hits / p.stats.darts * 100) + " %" : "–";
  if (g === "atc" || g === "doubles") {
    const tg = raceTarget(p.pos);
    return { sub: `${t("hits")} ${p.stats.hits}/${p.stats.darts} · ${hitRate}`, big: targetLabel(tg, g === "doubles" ? 2 : 1), line: label(t("target")) + chip(targetLabel(tg, g === "doubles" ? 2 : 1), true) + (tg < 20 ? label(t("after")) + chip(targetLabel(tg + 1, g === "doubles" ? 2 : 1)) : "") };
  }
  if (g === "bobs27") {
    const tg = bobsTarget(state.round);
    return { sub: `${t("round")} ${Math.min(state.round + 1, 21)}/21 · ${t("hits")} ${p.stats.hits}`, big: p.score, line: label(t("target")) + chip(targetLabel(tg.n, 2), true) + `<span class="co-note">± ${tg.value}</span>` };
  }
  if (g === "shanghai") {
    const r = state.round + 1;
    return { sub: `${t("round")} ${r}/${match.cfg.rounds}`, big: p.score, line: label(t("target")) + chip(String(r), true) + chip("D" + r) + chip("T" + r) };
  }
  if (g === "halveit") {
    const tg = HALVE_TARGETS[state.round];
    return { sub: `${t("round")} ${state.round + 1}/${HALVE_TARGETS.length}`, big: p.score, line: label(t("target")) + chip(halveLabel(tg), true) + (state.round + 1 < HALVE_TARGETS.length ? label(t("after")) + chip(halveLabel(HALVE_TARGETS[state.round + 1])) : "") };
  }
  if (g === "golf") {
    const hole = state.round + 1;
    const last = state.visit[state.visit.length - 1];
    return { sub: `${t("hole")} ${hole}/${match.cfg.holes}`, big: p.score, line: label(t("target")) + chip(String(hole), true) + (last ? `<span class="co-note">${esc(t("keepHint"))}</span>` : `<span class="co-note">D 1 · T 2 · S 3</span>`) };
  }
  if (g === "bowling") {
    return { sub: `${t("frame")} ${Math.min(state.round + 1, 10)}/10 · ${t("pinsStanding")} ${state.visit.length ? p.rack : 10}`, big: p.score, line: label(t("optAlley")) + chip(String(match.cfg.alley), true) + `<span class="co-note">T 10 · D 9 · ${esc(t("innerShort"))} 7 · ${esc(t("outerShort"))} 3</span>` };
  }
  if (g === "killer") {
    return { sub: `${t("optLives")} ${p.lives}`, big: "D" + p.num, line: p.killer ? label(t("isKiller")) + chip("K", true) : `<span class="co-note">${esc(t("becomeKiller")(p.num))}</span>` };
  }
  return { sub: `${t("attempt")} ${Math.min(p.attempt + 1, match.cfg.attempts)}/${match.cfg.attempts} · ${t("darts")} ${p.attemptDarts}/${match.cfg.dartsPer}`, big: p.rest, line: checkoutHtml(p) };
}

function holdHtml(p) {
  const v = p.lastVisit;
  if (!isX01() || !v) return "";
  return v.bust ? `<span class="hold-sum is-bust">Bust</span>` : `<span class="hold-sum">= ${v.points}</span>`;
}

function renderActive() {
  const p = state.players[hold ? hold.idx : state.current];
  if (isMode()) {
    const m = modeActive(p);
    $("active").innerHTML = `
      <div class="act-top"><span class="act-name">${esc(p.name)}</span><span class="act-sub">${esc(m.sub)}</span></div>
      <div class="act-mid"><span class="act-rest">${esc(m.big)}</span>${slotsHtml()}</div>
      <div class="act-co">${m.line}</div>`;
    return;
  }
  const x01 = isX01();
  const sub = x01
    ? `${t("avg")} ${p.stats.darts ? fmt(average(p.stats)) : "–"} · ${p.stats.darts} ${t("darts")}`
    : `${t("mpr")} ${p.stats.darts ? fmt(marksPerRound(p.stats)) : "–"} · ${p.score} ${t("points")}`;
  const sumMode = inputMode() === "sum" && !hold && !isBotTurn();
  const big = x01
    ? `<span class="act-rest">${p.rest}</span>`
    : `<span class="act-rest act-rest-c">${p.score}</span>`;
  const who = hold ? { name: hold.name } : thrower(p);
  $("active").innerHTML = `
    <div class="act-top">
      <span class="act-name">${esc(who.name)}</span>
      <span class="act-sub">${esc(p.members ? p.name + " · " + sub : sub)}</span>
    </div>
    <div class="act-mid">
      ${big}
      ${sumMode ? `<div class="sum-disp" aria-live="off"><span class="sum-val">${esc(sumEntry || "0")}</span></div>` : slotsHtml(hold ? p.lastVisit.darts : state.visit)}
    </div>
    ${x01 ? `<div class="act-co">${hold ? holdHtml(p) : checkoutHtml(p)}</div>` : ""}`;
}

function renderPad() {
  const pad = $("pad");
  const lastAct = match.actions[match.actions.length - 1];
  const undoLabel = lastAct && lastAct.t === "v" ? t("undoVisit") : t("undoLast");
  const canUndo = match.actions.length && (!match.cfg.players.some(p => p.bot !== undefined) || lastHumanAction() >= 0);
  const undoBtn = `<button type="button" class="k k-undo" data-k="undo" aria-label="${esc(undoLabel)}"${canUndo ? "" : " disabled"}><svg class="ico" aria-hidden="true"><use href="#i-undo"/></svg><span>${esc(t("undo"))}</span></button>`;
  if (isMode() && !isCheckoutTraining()) {
    pad.className = "pad pad-mode";
    pad.innerHTML = modePadHtml() + `<div class="pad-row"><button type="button" class="k k-miss" data-n="0">${esc(t("miss"))}</button>${undoBtn}</div>`;
    return;
  }
  if (match.cfg.game === "cricket") {
    const cols = CRICKET_TARGETS.map(tg => {
      const label = tg === 25 ? t("bull") : String(tg);
      return [1, 2, 3].map(m => {
        const off = tg === 25 && m === 3;
        const txt = m === 1 ? label : (m === 2 ? "D" : "T") + (tg === 25 ? "" : tg);
        const aria = tg === 25 ? (m === 2 ? "Bull" : "25") : (m === 3 ? "T" : m === 2 ? "D" : "") + tg;
        return off
          ? `<span class="k k-void" aria-hidden="true"></span>`
          : `<button type="button" class="k k-c k-m${m}" data-n="${tg}" data-m="${m}" aria-label="${aria}">${esc(tg === 25 && m === 2 ? "Bull" : tg === 25 ? "25" : txt)}</button>`;
      }).join("");
    });
    pad.className = "pad pad-cricket";
    pad.innerHTML = `<div class="c-grid">${cols.map(c => `<div class="c-col">${c}</div>`).join("")}</div>
      <div class="pad-row"><button type="button" class="k k-miss" data-n="0">${esc(t("miss"))}</button>${undoBtn}</div>`;
    return;
  }
  if (inputMode() === "sum") {
    const d = n => `<button type="button" class="k k-num" data-digit="${n}">${n}</button>`;
    pad.className = "pad pad-sum";
    pad.innerHTML = `<div class="sum-grid">
      ${d(1)}${d(2)}${d(3)}${undoBtn}
      ${d(4)}${d(5)}${d(6)}<button type="button" class="k k-del" data-k="del" aria-label="${esc(t("del"))}">⌫</button>
      ${d(7)}${d(8)}${d(9)}<button type="button" class="k k-ok" data-k="ok">${esc(t("ok"))}</button>
      <span class="k-zero">${d(0)}</span>
    </div>`;
    return;
  }
  const nums = Array.from({ length: 20 }, (_, i) => `<button type="button" class="k k-num" data-n="${i + 1}">${i + 1}</button>`).join("");
  pad.className = "pad pad-x01 mod-" + mod;
  pad.innerHTML = `
    <div class="mods">
      <button type="button" class="k k-mod" data-mod="2" aria-pressed="${mod === 2}">${esc(t("double"))}</button>
      <button type="button" class="k k-mod" data-mod="3" aria-pressed="${mod === 3}">Triple</button>
    </div>
    <div class="nums">${nums}</div>
    <div class="pad-row pad-row-4">
      <button type="button" class="k k-miss" data-n="0">${esc(t("miss"))}</button>
      <button type="button" class="k" data-n="25"${mod === 3 ? " disabled" : ""}>25</button>
      <button type="button" class="k k-bull" data-n="25" data-m="2"${mod === 3 ? " disabled" : ""}>Bull</button>
      ${undoBtn}
    </div>`;
}

function targetKeys(n) {
  const ms = n === 25 ? [1, 2] : [1, 2, 3];
  return `<div class="tkeys tkeys-${ms.length}">${ms.map(m => `<button type="button" class="k k-t k-m${m}" data-n="${n}" data-m="${m}">${esc(targetLabel(n, m))}</button>`).join("")}</div>`;
}

function modePadHtml() {
  const g = match.cfg.game;
  const p = state.players[state.current];
  if (g === "atc") return targetKeys(raceTarget(p.pos));
  if (g === "shanghai") return targetKeys(state.round + 1);
  if (g === "doubles" || g === "bobs27") {
    const n = g === "doubles" ? raceTarget(p.pos) : bobsTarget(state.round).n;
    return `<div class="tkeys tkeys-1"><button type="button" class="k k-t k-hit" data-n="${n}" data-m="2">${esc(t("hit"))} ${esc(targetLabel(n, 2))}</button></div>`;
  }
  if (g === "halveit") {
    const tg = HALVE_TARGETS[state.round];
    if (typeof tg === "number") return targetKeys(tg);
    if (tg === "B") return targetKeys(25);
    const m = tg === "D" ? 2 : 3;
    const nums = Array.from({ length: 20 }, (_, i) => `<button type="button" class="k k-num" data-n="${i + 1}" data-m="${m}">${(m === 2 ? "D" : "T") + (i + 1)}</button>`).join("");
    return `<div class="nums nums-fixed">${nums}${m === 2 ? `<button type="button" class="k k-num" data-n="25" data-m="2">Bull</button>` : ""}</div>`;
  }
  if (g === "golf") {
    const hole = state.round + 1;
    return targetKeys(hole) + `<div class="pad-row pad-row-2"><button type="button" class="k k-other" data-n="0" data-m="1">${esc(t("otherField"))}</button><button type="button" class="k k-keep" data-k="keep"${state.visit.length ? "" : " disabled"}>${esc(t("keep"))}</button></div>`;
  }
  if (g === "bowling") {
    const a = match.cfg.alley;
    return `<div class="tkeys tkeys-2 bkeys">
      <button type="button" class="k k-t k-m3" data-n="${a}" data-m="3">T${a}<small>10</small></button>
      <button type="button" class="k k-t k-m2" data-n="${a}" data-m="2">D${a}<small>9</small></button>
      <button type="button" class="k k-t" data-n="${a}" data-m="1" data-z="i">${a} ${esc(t("innerShort"))}<small>7</small></button>
      <button type="button" class="k k-t" data-n="${a}" data-m="1" data-z="o">${a} ${esc(t("outerShort"))}<small>3</small></button>
    </div>`;
  }
  if (g === "killer") {
    return `<div class="kgrid">${state.players.map((q, i) => q.out ? "" : `<button type="button" class="k k-kill${i === state.current ? " is-self" : ""}" data-n="${q.num}" data-m="2"><span>D${q.num}</span><small>${esc(q.name)}</small></button>`).join("")}</div>`;
  }
  return "";
}

function renderInputSeg() {
  const el = $("inputSeg");
  el.hidden = !isX01();
  if (!isX01()) return;
  el.setAttribute("aria-label", t("inputLabel"));
  const busy = state.visit.length > 0;
  seg(el, [
    { v: "dart", label: t("inputDart"), disabled: busy && settings.inputX01 !== "dart" },
    { v: "sum", label: t("inputSum"), disabled: busy && settings.inputX01 !== "sum" }
  ], settings.inputX01, v => {
    settings.inputX01 = v;
    saveSettings();
    sumEntry = "";
    renderGame();
  });
}

function renderGame() {
  if (!state) return;
  $("gTitle").textContent = gameTitle(match.cfg);
  $("gMeta").textContent = gameMeta(match.cfg);
  $("gameScreen").classList.toggle("is-cricket", match.cfg.game === "cricket");
  $("gameScreen").classList.toggle("is-mode", isMode());
  $("gameScreen").dataset.players = String(state.players.length);
  if (isX01()) renderScoresX01();
  else if (match.cfg.game === "cricket") renderScoresCricket();
  else renderScoresMode();
  renderActive();
  renderPad();
  renderInputSeg();
  const on = $("scores").querySelector(".is-on");
  if (on && match.cfg.game !== "cricket") on.scrollIntoView({ block: "nearest" });
  renderBotCover();
  scheduleBot();
}

function renderBotCover() {
  const pad = $("pad");
  const bot = isBotTurn();
  pad.classList.toggle("is-bot", bot);
  if (!bot) return;
  pad.querySelectorAll("button").forEach(b => { b.tabIndex = -1; });
  const cover = document.createElement("div");
  cover.className = "bot-cover";
  pad.appendChild(cover);
  const p = state.players[state.current];
  cover.innerHTML = `<button type="button" class="bot-skip" data-skip><span class="bot-who">${esc(t("botThrows")(p.name))}</span><span class="bot-hint">${esc(t("botSkip"))}</span></button>
    <button type="button" class="k k-undo bot-undo" data-undo${lastHumanAction() >= 0 ? "" : " disabled"}><svg class="ico" aria-hidden="true"><use href="#i-undo"/></svg><span>${esc(t("undo"))}</span></button>`;
  cover.querySelector("[data-skip]").onclick = skipBot;
  cover.querySelector("[data-undo]").onclick = undo;
}

function submitSum() {
  const v = Number(sumEntry || "0");
  const p = state.players[state.current];
  if (!isPossibleVisit(v)) {
    toast(t("impossible"), "warn");
    return;
  }
  const out = match.cfg.outMode;
  if (v === p.rest) {
    const options = [1, 2, 3].filter(n => suggestCheckout(v, n, out));
    if (!options.length) {
      toast(t("noCheckoutThere"), "warn");
      return;
    }
    const withDarts = darts => {
      if (darts === 1) return act({ t: "v", score: v, darts, dd: 1 });
      askChoice(t("howManyDoubles"), Array.from({ length: darts }, (_, k) => k + 1), dd => act({ t: "v", score: v, darts, dd }));
    };
    if (options.length === 1) return withDarts(options[0]);
    askChoice(t("howManyDarts"), options, withDarts);
    return;
  }
  // Ohne Einzel-Darts ist unbekannt, ob aufs Doppel geworfen wurde – deshalb nachfragen, sobald ein Ein-Dart-Finish auf dem Spiel stand.
  if (p.opened && isOneDartFinish(p.rest, out)) {
    askChoice(t("howManyDoubles"), [0, 1, 2, 3], dd => act({ t: "v", score: v, dd }));
    return;
  }
  act({ t: "v", score: v });
}

function askChoice(title, options, pick) {
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(title)}</h2>
    <div class="sheet-choice sheet-choice-${options.length}">${options.map(n => `<button type="button" class="btn-choice" data-v="${n}">${n}</button>`).join("")}</div>
    <button type="button" class="link-btn" data-close>${esc(t("cancel"))}</button>`, el => {
    el.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => {
      closeSheet();
      pick(Number(b.dataset.v));
    }));
  });
}

function initPadEvents() {
  $("pad").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled || !state || state.finished || isBotTurn()) return;
    if (b.dataset.k === "undo") return undo();
    if (b.dataset.k === "keep") return act({ t: "s" });
    if (b.dataset.mod) {
      const m = Number(b.dataset.mod);
      mod = mod === m ? 1 : m;
      renderPad();
      return;
    }
    if (b.dataset.digit !== undefined) {
      if (sumEntry.length < 3) sumEntry = (sumEntry + b.dataset.digit).replace(/^0+(?=\d)/, "");
      renderActive();
      return;
    }
    if (b.dataset.k === "del") {
      sumEntry = sumEntry.slice(0, -1);
      renderActive();
      return;
    }
    if (b.dataset.k === "ok") return submitSum();
    if (b.dataset.n !== undefined) {
      const n = Number(b.dataset.n);
      if (n === 0) return act({ t: "d", n: 0, m: 0 });
      let m = b.dataset.m ? Number(b.dataset.m) : mod;
      if (n === 25) m = Math.min(m, 2);
      act(b.dataset.z ? { t: "d", n, m, z: b.dataset.z } : { t: "d", n, m });
    }
  });

  document.addEventListener("keydown", e => {
    if ($("gameScreen").hidden || !$("sheet").hidden || !state || state.finished) return;
    if (e.target.closest("input, select, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (inputMode() !== "sum" || isBotTurn()) return;
    if (/^\d$/.test(e.key)) {
      if (sumEntry.length < 3) sumEntry = (sumEntry + e.key).replace(/^0+(?=\d)/, "");
      renderActive();
    } else if (e.key === "Backspace") {
      sumEntry = sumEntry.slice(0, -1);
      renderActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submitSum();
    }
  });
}

/* ===== Ergebnis ===== */

function scoreline() {
  return `<div class="scoreline">${state.players.map(p => `<span class="sl-p"><span class="sl-name">${esc(p.name)}</span><span class="sl-val">${legsText(p)}</span></span>`).join("")}</div>`;
}

function pct(st) {
  return st.ddarts ? `${fmt(checkoutRate(st))} % (${st.checkouts}/${st.ddarts})` : "–";
}

function resultText(cfg, p, won) {
  const g = cfg.game;
  if (g === "atc" || g === "doubles") return p.pos > 20 ? p.stats.darts + " " + t("darts") : t("notDone");
  if (g === "bobs27") return p.out ? t("outLabel") + " (" + p.score + ")" : String(p.score);
  if (g === "killer") return won ? t("won") : t("outLabel");
  if (g === "golf") return p.score + " " + t("strokes");
  if (g === "checkout121" || g === "randomco") return p.successes + "/" + cfg.attempts + (g === "checkout121" && p.best ? " · " + t("upTo") + " " + p.best : "");
  return String(p.score);
}

function statsTable(s = state, cfg = match.cfg) {
  const ps = s.players;
  const x01 = cfg.game === "x01";
  if (MODES.includes(cfg.game)) {
    const rows = [
      [t("statResult"), (p, i) => resultText(cfg, p, i === s.winner)],
      [t("statHitRate"), p => p.stats.darts ? Math.round(p.stats.hits / p.stats.darts * 100) + " %" : "–"],
      [t("statDarts"), p => p.stats.darts]
    ];
    if (cfg.attempts) rows.splice(1, 0, [t("statCheckout"), p => pct(p.stats)]);
    return `<div class="stats-wrap"><table class="stats">
      <thead><tr><th></th>${ps.map((p, i) => `<th scope="col" class="${i === s.winner && ps.length > 1 ? "is-win" : ""}">${esc(p.name)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${esc(label)}</th>${ps.map((p, i) => `<td>${esc(fn(p, i))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }
  const rows = x01
    ? [
        [t("statAvg"), p => p.stats.darts ? fmt(average(p.stats)) : "–"],
        [t("statF9"), p => p.stats.f9Darts ? fmt(firstNine(p.stats)) : "–"],
        [t("statCheckout"), p => pct(p.stats)],
        [t("statTon"), p => p.stats.ton],
        [t("statTon40"), p => p.stats.ton40],
        [t("statMax"), p => p.stats.max],
        [t("statHighOut"), p => p.stats.highestOut || "–"],
        [t("statBestLeg"), p => p.stats.bestLeg || "–"],
        [t("statDarts"), p => p.stats.darts]
      ]
    : [
        [t("statMpr"), p => p.stats.darts ? fmt(marksPerRound(p.stats)) : "–"],
        [t("statMarks"), p => p.stats.marks],
        [t("statBestLeg"), p => p.stats.bestLeg || "–"],
        [t("statDarts"), p => p.stats.darts]
      ];
  if (cfg.sets > 1) rows.unshift([t("statSets"), p => p.sets]);
  if (cfg.teams) {
    // Spalten je Mitglied plus Teamsumme; Kopfzeile 1 fasst sie pro Team zusammen.
    const cols = [];
    ps.forEach((p, i) => {
      p.members.forEach((m, j) => cols.push({ name: m.name, stats: p.memberStats[j], sets: p.sets, team: i, total: false }));
      if (p.members.length > 1) cols.push({ name: t("teamTotal"), stats: p.stats, sets: p.sets, team: i, total: true });
    });
    const span = i => cols.filter(c => c.team === i).length;
    return `<div class="stats-wrap"><table class="stats stats-teams">
      <thead>
        <tr><th></th>${ps.map((p, i) => `<th scope="colgroup" colspan="${span(i)}" class="team-head${i === s.winner ? " is-win" : ""}">${esc(p.name)}</th>`).join("")}</tr>
        <tr><th></th>${cols.map(c => `<th scope="col" class="${c.total ? "is-total" : ""}">${esc(c.name)}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${esc(label)}</th>${cols.map(c => `<td class="${c.total ? "is-total" : ""}">${esc(fn(c))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }
  return `<div class="stats-wrap"><table class="stats">
    <thead><tr><th></th>${ps.map((p, i) => `<th scope="col" class="${i === s.winner ? "is-win" : ""}">${esc(p.name)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><th scope="row">${esc(label)}</th>${ps.map(p => `<td>${esc(fn(p))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function wonText(p) {
  return p.members && p.members.length > 1 ? t("matchWonTeam")(p.name) : t("matchWon")(p.name);
}

function showResult(ev) {
  const log = state.legLog[state.legLog.length - 1];
  const winner = state.players[log.winner];
  if (ev === "match") {
    const solo = state.players.length === 1;
    const title = solo ? t("gameOver") + ": " + resultText(match.cfg, winner, true) : wonText(winner);
    openSheet(`
      <svg class="sheet-crest" aria-hidden="true"><use href="#mosquito"/></svg>
      <h2 class="sheet-title" id="sheetTitle">${esc(title)}</h2>
      ${state.shanghai ? `<p class="sheet-sub">${esc(t("shanghaiWin"))}</p>` : ""}
      ${log.checkout ? `<p class="sheet-sub">${esc(t("checkoutWith")(log.checkout, log.outDarts))}</p>` : ""}
      ${statsTable()}
      <div class="sheet-actions">
        <button type="button" class="link-btn" data-undo>${esc(t("undoLast"))}</button>
        <button type="button" class="btn-small" data-new>${esc(t("newGame"))}</button>
        <button type="button" class="btn-primary" data-rematch>${esc(t("rematch"))}</button>
      </div>`, el => {
      el.querySelector("[data-undo]").addEventListener("click", undo);
      el.querySelector("[data-new]").addEventListener("click", () => {
        closeSheet();
        match = null;
        save("match", null);
        recompute();
        showSetup();
      });
      el.querySelector("[data-rematch]").addEventListener("click", () => {
        closeSheet();
        const players = match.cfg.players.slice(1).concat(match.cfg.players.slice(0, 1));
        startMatch(match.cfg.teams ? { ...buildCfg(match.cfg, players), teams: true } : buildCfg(match.cfg, players));
      });
    }, false);
    announce(title);
    return;
  }
  const title = ev === "set" ? t("setWon")(winner.name) : t("legWon")(winner.name);
  const sub = log.checkout
    ? t("checkoutWith")(log.checkout, log.outDarts) + " · " + t("legInDarts")(log.darts)
    : t("legInDarts")(log.darts);
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(title)}</h2>
    <p class="sheet-sub">${esc(sub)}</p>
    ${scoreline()}
    <div class="sheet-actions">
      <button type="button" class="link-btn" data-undo>${esc(t("undoLast"))}</button>
      <button type="button" class="btn-primary" data-close>${esc(t("next"))}</button>
    </div>`, el => {
    el.querySelector("[data-undo]").addEventListener("click", undo);
  });
  announce(title);
}

/* ===== Sheet ===== */

let sheetReturnFocus = null;

// Solange ein Fenster offen ist, bleibt der Hintergrund für Tastatur und Screenreader gesperrt.
function setInert(on) {
  ["setupScreen", "gameScreen", "statsScreen"].forEach(id => { $(id).inert = on; });
}

function openSheet(html, bind, dismissable = true) {
  const sheet = $("sheet");
  sheetReturnFocus = document.activeElement;
  sheetDismissable = dismissable;
  sheet.innerHTML = `<div class="grab" aria-hidden="true"></div>` + html;
  sheet.hidden = false;
  $("scrim").hidden = false;
  document.documentElement.classList.add("sheet-open");
  setInert(true);
  sheet.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  if (bind) bind(sheet);
  const first = sheet.querySelector(".btn-primary, button, select");
  if (first) first.focus();
}

function closeSheet() {
  const sheet = $("sheet");
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.innerHTML = "";
  $("scrim").hidden = true;
  document.documentElement.classList.remove("sheet-open");
  setInert(false);
  if (sheetReturnFocus && document.contains(sheetReturnFocus)) sheetReturnFocus.focus();
  if (!$("gameScreen").hidden && state) renderGame();
}

$("scrim").addEventListener("click", () => { if (sheetDismissable) closeSheet(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("sheet").hidden && sheetDismissable) closeSheet();
});

/* ===== Einstellungen ===== */

function openSettings() {
  const favOpts = [`<option value="0">${esc(t("none"))}</option>`]
    .concat(Array.from({ length: 20 }, (_, i) => `<option value="${20 - i}"${settings.favDouble === 20 - i ? " selected" : ""}>D${20 - i}</option>`))
    .join("");
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(t("settings"))}</h2>
    <div class="set-row"><span class="set-label">${esc(t("theme"))}</span><div class="seg" id="sTheme"></div></div>
    <div class="set-row"><span class="set-label">${esc(t("palette"))}<span class="set-note">${esc(t("paletteNote"))}</span></span><div class="seg" id="sPalette"></div></div>
    <div class="set-row"><span class="set-label">${esc(t("language"))}</span><div class="seg" id="sLang"></div></div>
    <div class="set-row"><span class="set-label">${esc(t("x01Input"))}<span class="set-note">${esc(t("x01InputNote"))}</span></span><div class="seg" id="sInput"></div></div>
    <div class="set-row"><label class="set-label" for="sFav">${esc(t("favDouble"))}<span class="set-note">${esc(t("favDoubleNote"))}</span></label><select id="sFav" class="select">${favOpts}</select></div>
    <div class="set-row"><span class="set-label">${esc(t("vibration"))}<span class="set-note">${esc(t("vibrationNote"))}</span></span><div class="seg" id="sVib"></div></div>
    <div class="set-row"><span class="set-label">${esc(t("data"))}<span class="set-note">${esc(t("dataNote"))}</span></span>
      <div class="set-btns"><button type="button" class="btn-small" id="sExport">${esc(t("exportBtn"))}</button><button type="button" class="btn-small" id="sImport">${esc(t("importBtn"))}</button></div></div>
    <div class="set-danger">
      <p class="set-note">${esc(t("deleteAllNote"))}</p>
      <button type="button" class="link-btn link-danger" id="sDelete">${esc(t("deleteAll"))}</button>
    </div>
    ${t("news")[VERSION] ? `<button type="button" class="link-btn" id="sNews">${esc(t("newLink")(VERSION))}</button>` : ""}
    <button type="button" class="btn-small sheet-close" data-close>${esc(t("close"))}</button>
    ${footerHtml()}`, el => {
    const news = el.querySelector("#sNews");
    if (news) news.addEventListener("click", () => {
      closeSheet();
      openNews();
    });
    const bindSegs = () => {
      seg(el.querySelector("#sTheme"), [
        { v: "system", label: t("themeSystem") }, { v: "light", label: t("themeLight") }, { v: "dark", label: t("themeDark") }
      ], settings.theme || "system", v => {
        settings.theme = v === "system" ? null : v;
        saveSettings();
        applyTheme();
        bindSegs();
      });
      seg(el.querySelector("#sPalette"), [{ v: "pub", label: t("palettePub") }, { v: "classic", label: t("paletteClassic") }], settings.palette, v => {
        settings.palette = v;
        saveSettings();
        applyTheme();
        bindSegs();
      });
      seg(el.querySelector("#sLang"), [{ v: "de", label: "Deutsch" }, { v: "en", label: "English" }], settings.lang, v => {
        settings.lang = v;
        saveSettings();
        refreshAll();
        openSettings();
      });
      const busy = state && !$("gameScreen").hidden && state.visit.length > 0;
      seg(el.querySelector("#sInput"), [
        { v: "dart", label: t("inputDart"), disabled: busy }, { v: "sum", label: t("inputSum"), disabled: busy }
      ], settings.inputX01, v => {
        settings.inputX01 = v;
        sumEntry = "";
        saveSettings();
        if (state) renderGame();
        bindSegs();
      });
      seg(el.querySelector("#sVib"), [{ v: "on", label: t("on") }, { v: "off", label: t("off") }], settings.vibrate ? "on" : "off", v => {
        settings.vibrate = v === "on";
        saveSettings();
        bindSegs();
      });
    };
    bindSegs();
    el.querySelector("#sFav").addEventListener("change", e => {
      settings.favDouble = Number(e.target.value);
      saveSettings();
      if (state && !$("gameScreen").hidden) renderActive();
    });
    el.querySelector("#sDelete").addEventListener("click", confirmDelete);
    el.querySelector("#sExport").addEventListener("click", () => exportData().catch(() => toast(t("exportFailed"), "warn")));
    el.querySelector("#sImport").addEventListener("click", () => $("importFile").click());
  });
}

function openNews() {
  const items = t("news")[VERSION];
  if (!items) return;
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(t("newTitle"))} <span class="vnum">v${VERSION}</span></h2>
    <ul class="news">${items.map(([head, text]) => `<li>${head ? `<strong>${esc(head)}:</strong> ` : ""}${esc(text)}</li>`).join("")}</ul>
    <div class="sheet-actions"><button type="button" class="btn-primary" data-close>${esc(t("newOk"))}</button></div>`);
}

function showUpdateBar() {
  if ($("updateBar")) return;
  const bar = document.createElement("div");
  bar.id = "updateBar";
  bar.className = "update-bar";
  bar.setAttribute("role", "status");
  bar.innerHTML = `<span>${esc(t("updateReady"))}</span><button type="button" class="btn-small" data-reload>${esc(t("updateReload"))}</button><button type="button" class="update-x" aria-label="${esc(t("close"))}"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button>`;
  bar.querySelector("[data-reload]").addEventListener("click", () => location.reload());
  bar.querySelector(".update-x").addEventListener("click", () => bar.remove());
  document.body.appendChild(bar);
}

// Neue Version erst melden, wenn der neue Service Worker übernommen hat und zu einer anderen Version gehört als die laufende Seite.
function watchUpdates() {
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener("message", e => {
    if (e.data && typeof e.data.version === "string" && e.data.version !== "oddbits-darts-v" + VERSION) showUpdateBar();
  });
  sw.addEventListener("controllerchange", () => {
    if (hadController && sw.controller) sw.controller.postMessage("version");
  });
  sw.register("sw.js").then(reg => {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}

function footerHtml() {
  return `<footer class="site-footer">
    <p class="disclaimer">${esc(t("disclaimer"))}</p>
    <p class="crest"><span>${esc(t("crest"))}</span> <svg class="crest-icon" aria-hidden="true" focusable="false"><use href="#mosquito"/></svg></p>
    <p class="legal"><a href="https://oddbits.de/impressum/" hreflang="de">${esc(t("imprint"))}</a> · <a href="https://oddbits.de/datenschutzerklaerung/" hreflang="de">${esc(t("privacy"))}</a></p>
    <p class="version">© <a href="https://oddBits.de">oddBits.de</a> <span>v${VERSION}</span></p>
  </footer>`;
}

function confirmDelete() {
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(t("deleteConfirm"))}</h2>
    <p class="sheet-sub">${esc(t("deleteAllNote"))}</p>
    <div class="sheet-actions">
      <button type="button" class="btn-small" data-close>${esc(t("cancel"))}</button>
      <button type="button" class="btn-primary btn-danger" id="sDeleteYes">${esc(t("deleteYes"))}</button>
    </div>`, el => {
    el.querySelector("#sDeleteYes").addEventListener("click", async () => {
      try {
        Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      await deleteDatabase();
      history = [];
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith(KEY)).map(k => caches.delete(k)));
      }
      settings = cleanSettings({});
      roster = [];
      setup = freshSetup();
      match = null;
      recompute();
      closeSheet();
      refreshAll();
      showSetup();
      announce(t("deleted"));
    });
  });
}

/* ===== Bildschirme ===== */

let wakeLock = null;

async function keepAwake(on) {
  if (!on) {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) {
    wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("gameScreen").hidden) keepAwake(true);
});

function showGame() {
  $("setupScreen").hidden = true;
  $("statsScreen").hidden = true;
  $("gameScreen").hidden = false;
  document.documentElement.classList.add("in-game");
  mod = 1;
  sumEntry = "";
  renderGame();
  keepAwake(true);
}

function showSetup() {
  stopBot();
  clearHold();
  $("gameScreen").hidden = true;
  $("statsScreen").hidden = true;
  $("setupScreen").hidden = false;
  document.documentElement.classList.remove("in-game");
  keepAwake(false);
  renderSetup();
}

function openLeave() {
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(t("leaveTitle"))}</h2>
    <p class="sheet-sub">${esc(t("leaveText"))}</p>
    <div class="sheet-actions">
      <button type="button" class="link-btn link-danger" id="lEnd">${esc(t("leaveEnd"))}</button>
      <button type="button" class="btn-small" data-close>${esc(t("cancel"))}</button>
      <button type="button" class="btn-primary" id="lKeep">${esc(t("leaveKeep"))}</button>
    </div>`, el => {
    el.querySelector("#lKeep").addEventListener("click", () => { closeSheet(); showSetup(); });
    el.querySelector("#lEnd").addEventListener("click", () => {
      closeSheet();
      match = null;
      save("match", null);
      recompute();
      showSetup();
    });
  });
}

function refreshAll() {
  applyTexts();
  if (!$("gameScreen").hidden && state) renderGame();
  else if (!$("statsScreen").hidden) renderStats();
  else renderSetup();
}

/* ===== Statistik ===== */

let history = [];
let statsGame = "x01";
let statsPlayer = null;

async function showStats() {
  try { history = await allMatches(); } catch (e) { history = []; }
  $("setupScreen").hidden = true;
  $("gameScreen").hidden = true;
  $("statsScreen").hidden = false;
  document.documentElement.classList.remove("in-game");
  renderStats();
  window.scrollTo(0, 0);
}

function shortDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(settings.lang, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function kpi(label, value, sub) {
  return `<div class="kpi"><span class="kpi-label">${esc(label)}</span><span class="kpi-val">${esc(value)}</span>${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ""}</div>`;
}

function renderStats() {
  seg($("statsGameSeg"), [{ v: "x01", label: "X01" }, { v: "cricket", label: "Cricket" }, { v: "modes", label: t("statsModes") }], statsGame, v => { statsGame = v; renderStats(); });
  const inGroup = r => statsGame === "modes" ? MODES.includes(r.cfg.game) : r.cfg.game === statsGame;
  const recs = history.filter(inGroup);
  const people = historyPlayers(recs);
  if (!people.some(p => p.id === statsPlayer)) statsPlayer = people.length ? people[0].id : null;
  $("statsWho").innerHTML = people.map(p => `<button type="button" class="pick" data-id="${esc(p.id)}" aria-pressed="${p.id === statsPlayer}">${esc(p.name)}</button>`).join("");
  $("recentBlock").hidden = !statsPlayer;
  if (!statsPlayer) {
    $("kpis").innerHTML = `<p class="hint">${esc(t("statsEmpty"))}</p>`;
    $("histList").innerHTML = "";
    return;
  }
  if (statsGame === "modes") {
    renderModeStats(recs);
    return;
  }
  const s = summarize(history, statsPlayer, statsGame);
  const winRate = s.matches ? Math.round(s.wins / s.matches * 100) + " %" : "";
  const tiles = statsGame === "x01"
    ? [
        kpi(t("statAvg"), s.darts ? fmt(average(s)) : "–"),
        kpi(t("statF9"), s.f9Darts ? fmt(firstNine(s)) : "–"),
        kpi(t("statCheckout"), s.ddarts ? fmt(checkoutRate(s)) + " %" : "–", s.ddarts ? s.checkouts + "/" + s.ddarts : ""),
        kpi(t("statsWins"), s.wins + "/" + s.matches, winRate),
        kpi(t("statHighOut"), s.highestOut || "–"),
        kpi(t("statBestLeg"), s.bestLeg || "–", s.bestLeg ? t("darts") : ""),
        kpi(t("statMax"), s.max),
        kpi(t("statTon40"), s.ton40),
        kpi(t("statTon"), s.ton),
        kpi(t("statsLegs"), s.legs)
      ]
    : [
        kpi(t("statMpr"), s.darts ? fmt(marksPerRound(s)) : "–"),
        kpi(t("statsWins"), s.wins + "/" + s.matches, winRate),
        kpi(t("statBestLeg"), s.bestLeg || "–", s.bestLeg ? t("darts") : ""),
        kpi(t("statsLegs"), s.legs),
        kpi(t("statMarks"), s.marks),
        kpi(t("statDarts"), s.darts)
      ];
  $("kpis").innerHTML = tiles.join("");
  const mine = recs
    .filter(r => locate(r.cfg, statsPlayer))
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
    .slice(0, 50);
  $("histList").innerHTML = mine.map(r => {
    const st = play(r.cfg, r.actions);
    const at = locate(r.cfg, statsPlayer);
    const own = statsOf(st, at);
    const val = statsGame === "x01" ? fmt(average(own)) : fmt(marksPerRound(own));
    return histItem(r, st, at.idx, val);
  }).join("");
}

function histItem(r, st, idx, val) {
  const won = st.winner === idx;
  const solo = r.cfg.players.length === 1;
  const mates = (r.cfg.players[idx].members || []).filter(m => m.id !== statsPlayer).map(m => m.name).join(", ");
  const rivals = r.cfg.players.filter((p, i) => i !== idx).map(p => p.name).join(", ");
  const others = (mates ? t("with") + " " + mates + " " : "") + (rivals ? t("versus") + " " + rivals : "");
  return `<li><button type="button" class="hist-item" data-id="${esc(r.id)}">
    <span class="hi-date">${esc(shortDate(r.finishedAt))}</span>
    <span class="hi-title"><span class="hi-game">${esc(gameTitle(r.cfg))}</span><span class="hi-vs">${esc(others || t("solo"))}</span></span>
    <span class="hi-val">${esc(val)}</span>
    <span class="hi-res${won && !solo ? " is-win" : ""}">${esc(solo ? "" : won ? t("won") : t("lost"))}</span>
  </button></li>`;
}

function renderModeStats(recs) {
  const sums = summarizeModes(history, statsPlayer);
  const tiles = MODES.filter(g => sums[g]).map(g => {
    const e = sums[g];
    let val = e.best === null ? "–" : String(e.best);
    if ((g === "atc" || g === "doubles") && e.best !== null) val = e.best + " " + t("darts");
    if (g === "killer") val = e.wins + "/" + e.played;
    if ((g === "checkout121" || g === "randomco") && e.best !== null) val = e.best + " Checkouts";
    if (g === "golf" && e.best !== null) val = e.best + " " + t("strokes");
    const parts = [e.played + "×"];
    if (e.darts) parts.push(t("statHitRate") + " " + Math.round(e.hits / e.darts * 100) + " %");
    if (g === "checkout121" && e.bestTarget) parts.push(t("upTo") + " " + e.bestTarget);
    if (g !== "killer" && e.wins) parts.push(t("statsWins") + " " + e.wins);
    return kpi(t("g_" + g), val, parts.join(" · "));
  });
  $("kpis").innerHTML = tiles.join("");
  $("histList").innerHTML = recs
    .filter(r => r.cfg.players.some(p => p.id === statsPlayer))
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
    .slice(0, 50)
    .map(r => {
      const st = play(r.cfg, r.actions);
      const idx = r.cfg.players.findIndex(p => p.id === statsPlayer);
      return histItem(r, st, idx, r.cfg.game === "killer" ? "" : resultText(r.cfg, st.players[idx], st.winner === idx));
    }).join("");
}

function openRecord(id) {
  const r = history.find(x => x.id === id);
  if (!r) return;
  const s = play(r.cfg, r.actions);
  const winner = s.players[s.winner];
  const res = r.cfg.players.length === 1 ? resultText(r.cfg, winner, true) : wonText(winner);
  openSheet(`
    <h2 class="sheet-title" id="sheetTitle">${esc(gameTitle(r.cfg))}</h2>
    <p class="sheet-sub">${esc(shortDate(r.finishedAt) + " · " + gameMeta(r.cfg) + " · " + res)}</p>
    ${statsTable(s, r.cfg)}
    <div class="sheet-actions">
      <button type="button" class="link-btn link-danger" id="rDelete">${esc(t("deleteMatch"))}</button>
      <button type="button" class="btn-small" data-close>${esc(t("close"))}</button>
    </div>`, el => {
    el.querySelector("#rDelete").addEventListener("click", () => {
      openSheet(`
        <h2 class="sheet-title" id="sheetTitle">${esc(t("deleteMatchConfirm"))}</h2>
        <div class="sheet-actions">
          <button type="button" class="btn-small" data-close>${esc(t("cancel"))}</button>
          <button type="button" class="btn-primary" id="rDeleteYes">${esc(t("deleteYes"))}</button>
        </div>`, el2 => {
        el2.querySelector("#rDeleteYes").addEventListener("click", async () => {
          await deleteMatch(id).catch(() => {});
          history = history.filter(x => x.id !== id);
          closeSheet();
          renderStats();
        });
      });
    });
  });
}

/* ===== Sichern & Wiederherstellen ===== */

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportData() {
  const records = await allMatches();
  const d = new Date();
  const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  const payload = { app: "oddbits-darts", version: 1, exportedAt: d.toISOString(), players: roster, history: records };
  download(`oddbits_darts_${stamp}.json`, JSON.stringify(payload));
}

const cleanCfg = c => {
  const out = { game: c.game, legs: c.legs, sets: c.sets, players: c.players.map(p => p.members ? { id: p.id, name: p.name, members: p.members.map(m => ({ id: m.id, name: m.name })) } : p.bot !== undefined ? { id: p.id, name: p.name, bot: p.bot } : { id: p.id, name: p.name }) };
  if (c.teams === true) out.teams = true;
  ["start", "inMode", "outMode", "variant", "jumps", "rounds", "lives", "attempts", "dartsPer", "holes", "alley"].forEach(k => { if (c[k] !== undefined) out[k] = c[k]; });
  if (Array.isArray(c.numbers)) out.numbers = c.numbers.slice();
  if (Array.isArray(c.targets)) out.targets = c.targets.slice();
  return out;
};
const cleanAction = a => a.t === "s" ? { t: "s" } : a.t === "d" ? (a.z ? { t: "d", n: a.n, m: a.m, z: a.z } : { t: "d", n: a.n, m: a.m }) : { t: "v", score: a.score, darts: a.darts, dd: a.dd };

const MAX_IMPORT = 20 * 1024 * 1024;

async function importData(file) {
  if (file.size > MAX_IMPORT) {
    toast(t("importFailed"), "warn");
    return;
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    data = null;
  }
  if (!data || data.app !== "oddbits-darts" || !Array.isArray(data.history)) {
    toast(t("importFailed"), "warn");
    return;
  }
  const existing = new Set((await allMatches()).map(r => r.id));
  const fresh = data.history.filter(r => validRecord(r) && !existing.has(r.id)).map(r => ({
    id: r.id,
    cfg: cleanCfg(r.cfg),
    actions: r.actions.map(cleanAction),
    startedAt: String(r.startedAt || ""),
    finishedAt: String(r.finishedAt || r.startedAt || "")
  }));
  await putMatches(fresh);
  if (Array.isArray(data.players)) {
    data.players.forEach(p => {
      if (isObj(p) && typeof p.id === "string" && ID_RE.test(p.id) && typeof p.name === "string" && p.name.trim() && !roster.some(q => q.id === p.id)) {
        roster.push({ id: p.id, name: p.name.trim().slice(0, 20) });
      }
    });
    save("players", roster);
  }
  history = await allMatches();
  closeSheet();
  refreshAll();
  toast(t("imported")(fresh.length));
}

/* ===== Start ===== */

function init() {
  applyTexts();
  initLineupEvents();
  initPadEvents();

  $("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    settings.theme = cur === "dark" ? "light" : "dark";
    saveSettings();
    applyTheme();
  });
  $("langBtn").addEventListener("click", () => {
    settings.lang = settings.lang === "de" ? "en" : "de";
    saveSettings();
    refreshAll();
  });
  $("settingsBtn").addEventListener("click", openSettings);
  $("gSettingsBtn").addEventListener("click", openSettings);
  $("leaveBtn").addEventListener("click", openLeave);
  $("resumeBtn").addEventListener("click", showGame);
  $("statsBtn").addEventListener("click", showStats);
  // „toggle“ steigt nicht auf, deshalb in der Capture-Phase am Container abfangen.
  $("gamePick").addEventListener("toggle", e => {
    const d = e.target.closest && e.target.closest("details[data-g]");
    if (!d) return;
    setup.folds[d.dataset.g] = d.open;
    saveSetup();
  }, true);
  $("gamePick").addEventListener("click", e => {
    const b = e.target.closest(".gbtn");
    if (!b) return;
    setup.game = b.dataset.v;
    saveSetup();
    renderSetup();
  });
  $("statsBackBtn").addEventListener("click", showSetup);
  $("statsWho").addEventListener("click", e => {
    const b = e.target.closest(".pick");
    if (!b) return;
    statsPlayer = b.dataset.id;
    renderStats();
  });
  $("histList").addEventListener("click", e => {
    const b = e.target.closest(".hist-item");
    if (b) openRecord(b.dataset.id);
  });
  $("importFile").addEventListener("change", e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (f) importData(f).catch(() => toast(t("importFailed"), "warn"));
  });
  $("startBtn").addEventListener("click", () => {
    const list = lineupPlayers();
    if (!list.length || startProblem()) return;
    if (teamsOn()) {
      startMatch({ ...buildCfg(setup, buildTeams(list)), teams: true });
      return;
    }
    startMatch(buildCfg(setup, list.map(p => p.bot ? { id: p.id, name: p.name, bot: p.bot } : { id: p.id, name: p.name })));
  });

  if (match && (!isObj(match) || !validGame(match))) {
    match = null;
    save("match", null);
  }
  if (match && !match.id) {
    match.id = uid();
    save("match", match);
  }
  try {
    recompute();
  } catch (e) {
    match = null;
    save("match", null);
    recompute();
  }
  if (match && state && !state.finished) showGame();
  else showSetup();

  if (load("seen", null) !== VERSION) {
    if (returning) openNews();
    save("seen", VERSION);
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") watchUpdates();
}

init();
