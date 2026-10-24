import { CRICKET_TARGETS } from "./rules.js";
import { suggestCheckout } from "./checkout.js";

export const BOT_LEVELS = [30, 40, 50, 60, 70, 80, 90, 100];

const BOT_NAMES = { 30: "Lotte", 40: "Kemal", 50: "Priya", 60: "Jonas", 70: "Amara", 80: "Mateo", 90: "Mei", 100: "Noor" };

// Streuung in mm je Stufe, per Simulation so bestimmt, dass der X01-Schnitt (501, Double Out) etwa der Stufe entspricht.
const SIGMA = { 30: 24.5, 40: 18.7, 50: 15.2, 60: 12.7, 70: 10.6, 80: 9.1, 90: 7.5, 100: 6.3 };

export function botPlayer(level) {
  return { id: "bot:" + level, name: BOT_NAMES[level] + " · Bot Ø " + level, bot: level };
}

export function isBotLevel(v) {
  return BOT_LEVELS.includes(v);
}

/* ===== Scheibe ===== */

// Maße einer Turnierscheibe in mm, Segmente im Uhrzeigersinn ab der 20 oben.
const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const R = { bull: 6.35, outerBull: 15.9, trebleIn: 99, trebleOut: 107, doubleIn: 162, doubleOut: 170 };

export function dartAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return { n: 25, m: 2 };
  if (r <= R.outerBull) return { n: 25, m: 1 };
  if (r > R.doubleOut) return { n: 0, m: 0 };
  const deg = Math.atan2(y, x) * 180 / Math.PI;
  const i = ((Math.round((90 - deg) / 18) % 20) + 20) % 20;
  const m = r >= R.doubleIn ? 2 : r >= R.trebleIn && r <= R.trebleOut ? 3 : 1;
  return { n: SEGMENTS[i], m };
}

// Single zielt auf das innere Feld, dort droht beim Verfehlen kein Wurf neben die Scheibe.
export function aimPoint(d) {
  if (d.n === 25) return { x: 0, y: 0 };
  const r = d.m === 3 ? 103 : d.m === 2 ? 166 : 57;
  const a = (90 - 18 * SEGMENTS.indexOf(d.n)) * Math.PI / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

function gauss(rng) {
  const u = 1 - rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function throwAt(target, sigma, rng) {
  const p = aimPoint(target);
  return dartAt(p.x + sigma * gauss(rng), p.y + sigma * gauss(rng));
}

/* ===== Zielwahl ===== */

const LEAVE_THROWS = [{ n: 20, m: 3 }, { n: 19, m: 3 }, ...SEGMENTS.map(n => ({ n, m: 1 }))];

// Beliebte Reste für den letzten Dart: lassen sich bei einem Fehlwurf ins Single weiter halbieren.
const GOOD_LEAVES = [32, 40, 16, 24, 36, 20, 8, 12, 28, 18, 10, 14, 26, 30, 34, 38, 6, 4, 22, 2];
const leaveRank = left => { const i = GOOD_LEAVES.indexOf(left); return i < 0 ? 99 : i; };

// Kein Checkout mehr in dieser Aufnahme: so werfen, dass möglichst wenige Darts zum Finish bleiben, sonst möglichst viel.
function leaveTarget(rest, outMode) {
  const min = outMode === "single" ? 1 : 2;
  let best = null;
  let bestKey = null;
  for (const d of LEAVE_THROWS) {
    const left = rest - d.n * d.m;
    if (left < min) continue;
    const route = suggestCheckout(left, 3, outMode);
    const key = [route ? route.length : 4, leaveRank(left), -d.n * d.m];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = d;
      bestKey = key;
    }
  }
  return best || { n: 1, m: 1 };
}

export function aimX01(s) {
  const p = s.players[s.current];
  if (!p.opened) return { n: 20, m: 2 };
  const route = suggestCheckout(p.rest, 3 - s.visit.length, s.cfg.outMode);
  if (route) return route[0];
  if (p.rest > 180) return { n: 20, m: 3 };
  return leaveTarget(p.rest, s.cfg.outMode);
}

const cricketAim = t => t === 25 ? { n: 25, m: 2 } : { n: t, m: 3 };

export function aimCricket(s) {
  const me = s.players[s.current];
  const others = s.players.filter(q => q !== me);
  const cut = s.cfg.variant === "cutthroat";
  const behind = cut ? others.some(q => q.score < me.score) : others.some(q => q.score > me.score);
  const scoring = CRICKET_TARGETS.filter(t => me.marks[t] >= 3 && others.some(q => q.marks[t] < 3));
  if (behind && scoring.length) return cricketAim(scoring[0]);
  const open = CRICKET_TARGETS.find(t => me.marks[t] < 3);
  if (open !== undefined) return cricketAim(open);
  return cricketAim(scoring[0] ?? 20);
}

export function botAim(s) {
  return s.cfg.game === "cricket" ? aimCricket(s) : aimX01(s);
}

export function botDart(s, level, rng = Math.random) {
  const d = throwAt(botAim(s), SIGMA[level], rng);
  return { t: "d", n: d.n, m: d.m };
}

export function botSigma(level) {
  return SIGMA[level];
}
