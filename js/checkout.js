import { isFinishDart } from "./rules.js";

const THROWS = [];
for (let n = 1; n <= 20; n++) for (let m = 1; m <= 3; m++) THROWS.push({ n, m });
THROWS.push({ n: 25, m: 1 }, { n: 25, m: 2 });

// Kosten statt fester Tabelle: wenige Darts zuerst, dann gängige Felder (T20/T19, D20/D16) bevorzugt.
const DOUBLE_COST = { 20: 0, 16: 0, 18: 0.3, 12: 0.3, 10: 0.4, 8: 0.4, 14: 0.6, 6: 0.9, 4: 1, 2: 1.5, 1: 2 };
const TREBLE_COST = { 20: 0, 19: 0.3, 18: 0.6, 17: 0.8, 16: 1, 15: 1.1, 14: 1.3, 13: 1.4, 12: 1.5, 11: 1.6, 10: 1.6 };

function setupCost(d) {
  if (d.n === 25) return d.m === 2 ? 2 : 1.5;
  if (d.m === 1) return 0.2 + (20 - d.n) * 0.005;
  if (d.m === 3) return TREBLE_COST[d.n] ?? 2;
  return 2.5;
}

function finishCost(d, outMode, fav) {
  let c;
  if (d.n === 25) c = d.m === 2 ? 1.6 : 1.5;
  else if (d.m === 2) c = DOUBLE_COST[d.n] ?? (d.n % 2 ? 1.2 : 1);
  else if (d.m === 3) c = (TREBLE_COST[d.n] ?? 2) + 0.5;
  else c = setupCost(d);
  if (outMode !== "single" && fav && d.m === 2 && d.n === fav) c -= 1;
  return c;
}

const cache = new Map();

export function suggestCheckout(rest, dartsLeft, outMode = "double", fav = 0) {
  if (rest < 1 || rest > 180 || dartsLeft < 1) return null;
  const key = rest + "|" + dartsLeft + "|" + outMode + "|" + fav;
  if (cache.has(key)) return cache.get(key);

  const finishers = THROWS.filter(d => isFinishDart(d, outMode));
  let best = null;
  let bestCost = Infinity;
  const consider = (route, cost) => {
    if (cost < bestCost) { bestCost = cost; best = route; }
  };

  for (const f of finishers) {
    const fv = f.n * f.m;
    const fc = finishCost(f, outMode, fav);
    if (fv === rest) consider([f], 3 + fc);
    if (dartsLeft < 2) continue;
    for (const a of THROWS) {
      const av = a.n * a.m;
      if (av + fv === rest) consider([a, f], 6 + setupCost(a) + fc);
      if (dartsLeft < 3) continue;
      for (const b of THROWS) {
        if (av < b.n * b.m) continue;
        if (av + b.n * b.m + fv === rest) consider([a, b, f], 9 + setupCost(a) + setupCost(b) + fc);
      }
    }
  }

  cache.set(key, best);
  return best;
}

export function isBogey(rest, outMode = "double") {
  return rest > 1 && rest <= 170 && !suggestCheckout(rest, 3, outMode);
}
