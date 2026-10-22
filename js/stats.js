import { play, MODES } from "./modes.js";

const SUM_KEYS = ["points", "darts", "f9Points", "f9Darts", "marks", "ton", "ton40", "max", "checkouts", "ddarts"];

export function emptySummary() {
  const s = { matches: 0, wins: 0, legs: 0, highestOut: 0, bestLeg: 0 };
  SUM_KEYS.forEach(k => { s[k] = 0; });
  return s;
}

// Wo steckt eine Person in einem Spiel: als Einzelperson/Team (member -1) oder als Mitglied eines Teams.
export function locate(cfg, playerId) {
  const idx = cfg.players.findIndex(p => p.id === playerId);
  if (idx >= 0) return { idx, member: -1 };
  for (let i = 0; i < cfg.players.length; i++) {
    const m = (cfg.players[i].members || []).findIndex(x => x.id === playerId);
    if (m >= 0) return { idx: i, member: m };
  }
  return null;
}

export function statsOf(s, at) {
  const p = s.players[at.idx];
  return at.member >= 0 ? p.memberStats[at.member] : p.stats;
}

export function summarize(records, playerId, game) {
  const sum = emptySummary();
  for (const r of records) {
    if (r.cfg.game !== game) continue;
    const at = locate(r.cfg, playerId);
    if (!at) continue;
    const idx = at.idx;
    const s = play(r.cfg, r.actions);
    if (!s.finished) continue;
    const st = statsOf(s, at);
    sum.matches += 1;
    if (s.winner === idx) sum.wins += 1;
    sum.legs += s.legLog.filter(l => l.winner === idx).length;
    SUM_KEYS.forEach(k => { sum[k] += st[k]; });
    sum.highestOut = Math.max(sum.highestOut, st.highestOut);
    if (st.bestLeg && (!sum.bestLeg || st.bestLeg < sum.bestLeg)) sum.bestLeg = st.bestLeg;
  }
  return sum;
}

// Bestwert je Trainings-/Partyspiel; „lower“ heißt: weniger ist besser (Darts bis zum Ziel).
export const MODE_BEST = {
  atc: { lower: true, value: p => (p.pos > 20 ? p.stats.darts : null) },
  doubles: { lower: true, value: p => (p.pos > 20 ? p.stats.darts : null) },
  bobs27: { value: p => (p.out ? null : p.score) },
  shanghai: { value: p => p.score },
  halveit: { value: p => p.score },
  killer: { value: () => null },
  checkout121: { value: p => p.successes },
  randomco: { value: p => p.successes },
  golf: { lower: true, value: p => p.score },
  bowling: { value: p => p.score }
};

export function summarizeModes(records, playerId) {
  const out = {};
  for (const r of records) {
    if (!MODES.includes(r.cfg.game)) continue;
    const idx = r.cfg.players.findIndex(p => p.id === playerId);
    if (idx < 0) continue;
    const s = play(r.cfg, r.actions);
    if (!s.finished) continue;
    const p = s.players[idx];
    const e = out[r.cfg.game] || (out[r.cfg.game] = { played: 0, wins: 0, best: null, darts: 0, hits: 0, bestTarget: 0 });
    e.played += 1;
    if (s.winner === idx && r.cfg.players.length > 1) e.wins += 1;
    e.darts += p.stats.darts;
    e.hits += p.stats.hits;
    if (p.best) e.bestTarget = Math.max(e.bestTarget, p.best);
    const rule = MODE_BEST[r.cfg.game];
    const v = rule.value(p);
    if (v !== null && (e.best === null || (rule.lower ? v < e.best : v > e.best))) e.best = v;
  }
  return out;
}

// Alle Personen aus dem Verlauf, mit dem zuletzt verwendeten Namen, die aktivsten zuerst.
export function historyPlayers(records) {
  const map = new Map();
  const sorted = records.slice().sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  for (const r of sorted) {
    for (const p of r.cfg.players) {
      const solo = p.members && p.members.length === 1;
      for (const q of [...(solo ? [] : [p]), ...(p.members || [])]) {
        const e = map.get(q.id) || { id: q.id, name: q.name, matches: 0 };
        e.name = q.name;
        e.matches += 1;
        map.set(q.id, e);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
}

const GAMES = ["x01", "cricket", ...MODES];
const isStr = v => typeof v === "string" && v.length > 0 && v.length <= 100;
const isId = v => typeof v === "string" && /^[A-Za-z0-9:+_.-]{1,200}$/.test(v);
const okDart = (n, m) => (n === 0 && (m === 0 || m === 1)) || (n >= 1 && n <= 20 && m >= 1 && m <= 3) || (n === 25 && (m === 1 || m === 2));
const isInt = v => Number.isInteger(v);

// Prüft einen Verlaufseintrag aus einer Sicherungsdatei (fremde Eingabe).
// Verlaufseintrag (z. B. aus einer Sicherung): gültige Form und zu Ende gespielt.
export function validRecord(r) {
  return !!r && typeof r === "object" && isId(r.id) && validGame(r, true);
}

// Prüft Konfiguration und Aktionen; mit mustFinish nur, wenn das Spiel beendet ist.
export function validGame(r, mustFinish = false) {
  if (!r || typeof r !== "object") return false;
  const c = r.cfg;
  if (!c || !GAMES.includes(c.game) || !isInt(c.legs) || !isInt(c.sets) || c.legs < 1 || c.sets < 1 || c.legs > 99 || c.sets > 99) return false;
  if (c.game === "x01" && (![301, 501, 701].includes(c.start) || !["single", "double"].includes(c.inMode) || !["single", "double", "master"].includes(c.outMode))) return false;
  if (c.game === "cricket" && !["standard", "cutthroat"].includes(c.variant)) return false;
  if (c.game === "shanghai" && ![7, 20].includes(c.rounds)) return false;
  if (c.game === "golf" && ![9, 18].includes(c.holes)) return false;
  if (c.game === "bowling" && !(isInt(c.alley) && c.alley >= 1 && c.alley <= 20)) return false;
  if (c.game === "atc" && c.jumps !== undefined && typeof c.jumps !== "boolean") return false;
  if ((c.game === "checkout121" || c.game === "randomco") && (![5, 10, 20].includes(c.attempts) || ![3, 6, 9].includes(c.dartsPer))) return false;
  if (c.game === "randomco" && !(Array.isArray(c.targets) && c.targets.length === c.attempts && c.targets.every(v => isInt(v) && v >= 2 && v <= 170))) return false;
  if (!Array.isArray(c.players) || c.players.length < 1 || c.players.length > 8) return false;
  if (c.teams !== undefined && (c.teams !== true || !["x01", "cricket"].includes(c.game))) return false;
  const okMember = m => m && isId(m.id) && isStr(m.name) && m.name.length <= 20;
  const okPlayer = p => p && isId(p.id) && isStr(p.name) && (c.teams
    ? Array.isArray(p.members) && p.members.length >= 1 && p.members.length <= 4 && p.members.every(okMember)
    : p.name.length <= 20 && p.members === undefined);
  if (!c.players.every(okPlayer)) return false;
  if (c.game === "killer" && (![3, 5].includes(c.lives) || c.players.length < 2 || !Array.isArray(c.numbers) || c.numbers.length !== c.players.length
    || !c.numbers.every(v => isInt(v) && v >= 1 && v <= 20) || new Set(c.numbers).size !== c.numbers.length)) return false;
  if (!Array.isArray(r.actions) || r.actions.length > 20000) return false;
  const inRange = (v, lo, hi) => v === undefined || (isInt(v) && v >= lo && v <= hi);
  const okAction = a => a && ((a.t === "d" && isInt(a.n) && isInt(a.m) && okDart(a.n, a.m) && (a.z === undefined || a.z === "i" || a.z === "o"))
    || (a.t === "v" && c.game === "x01" && isInt(a.score) && a.score >= 0 && a.score <= 180 && inRange(a.darts, 1, 3) && inRange(a.dd, 0, 3))
    || (a.t === "s" && c.game === "golf"));
  if (!r.actions.every(okAction)) return false;
  try {
    const s = play(c, r.actions);
    return mustFinish ? s.finished : true;
  } catch (e) {
    return false;
  }
}
