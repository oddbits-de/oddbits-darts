import { replay, isOneDartFinish } from "./rules.js";

export const MODES = ["atc", "doubles", "bobs27", "checkout121", "randomco", "shanghai", "killer", "halveit", "golf", "bowling"];
export const HALVE_TARGETS = [15, 16, "D", 17, 18, "T", 19, 20, "B"];

export function play(cfg, actions) {
  return MODES.includes(cfg.game) ? replayMode(cfg, actions) : replay(cfg, actions);
}

function frame(cfg, init) {
  return {
    cfg,
    players: cfg.players.map((p, i) => ({
      id: p.id, name: p.name, out: false, done: false, lastVisit: null,
      stats: { darts: 0, hits: 0, checkouts: 0, ddarts: 0 },
      ...init(i)
    })),
    current: 0,
    round: 0,
    visit: [],
    finished: false,
    winner: -1,
    event: null,
    shanghai: false,
    legWinner: -1,
    legLog: []
  };
}

function waiting(p) {
  return !p.out && !p.done;
}

// Nächste Person, die noch spielt; beim Umlauf auf Platz 1 beginnt eine neue Runde.
function advance(s) {
  const n = s.players.length;
  let i = s.current;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (i === 0) s.round += 1;
    if (waiting(s.players[i])) break;
  }
  s.current = i;
}

function endVisit(s, note) {
  s.players[s.current].lastVisit = { darts: s.visit.slice(), note: note || "" };
  s.visit = [];
  advance(s);
}

function finish(s, winner, note) {
  if (s.visit.length || note) s.players[s.current].lastVisit = { darts: s.visit.slice(), note: note || "" };
  s.visit = [];
  s.finished = true;
  s.winner = winner;
  s.event = "match";
  s.legLog.push({ winner, darts: winner >= 0 ? s.players[winner].stats.darts : 0, checkout: 0, outDarts: 0, visit: [] });
}

function best(s, key) {
  let b = 0;
  s.players.forEach((p, i) => { if (key(p) > key(s.players[b])) b = i; });
  return b;
}

/* ===== Around the Clock & Doubles-Runde ===== */

export function raceTarget(pos) {
  return pos < 20 ? pos + 1 : 25;
}

function raceDart(s, d) {
  const p = s.players[s.current];
  const doubles = s.cfg.game === "doubles";
  const tgt = raceTarget(p.pos);
  s.visit.push(d);
  p.stats.darts += 1;
  const hit = d.n === tgt && (doubles ? d.m === 2 : d.m > 0);
  if (hit) {
    p.stats.hits += 1;
    const step = !doubles && s.cfg.jumps ? d.m : 1;
    p.pos = p.pos === 20 ? 21 : Math.min(20, p.pos + step);
  }
  if (p.pos > 20) return finish(s, s.current);
  if (s.visit.length === 3) endVisit(s);
}

/* ===== Bob's 27 ===== */

export function bobsTarget(round) {
  return round < 20 ? { n: round + 1, value: (round + 1) * 2 } : { n: 25, value: 50 };
}

function bobsDart(s, d) {
  const p = s.players[s.current];
  const tgt = bobsTarget(s.round);
  s.visit.push(d);
  p.stats.darts += 1;
  if (d.n === tgt.n && d.m === 2) {
    p.score += tgt.value;
    p.stats.hits += 1;
  }
  if (s.visit.length < 3) return;
  const scored = s.visit.some(v => v.n === tgt.n && v.m === 2);
  if (!scored) p.score -= tgt.value;
  let note = scored ? "+" + s.visit.filter(v => v.n === tgt.n && v.m === 2).length * tgt.value : "−" + tgt.value;
  if (p.score < 0) {
    p.out = true;
    p.outRound = s.round;
  }
  endVisit(s, note);
  const alive = s.players.filter(waiting);
  if (!alive.length || s.round >= 21) {
    finish(s, best(s, q => (q.out ? q.outRound : 100) * 100000 + q.score));
  }
}

/* ===== Shanghai ===== */

function shanghaiDart(s, d) {
  const p = s.players[s.current];
  const r = s.round + 1;
  s.visit.push(d);
  p.stats.darts += 1;
  if (d.n === r && d.m > 0) {
    p.score += r * d.m;
    p.stats.hits += 1;
  }
  if (s.visit.length < 3) return;
  const ms = s.visit.filter(v => v.n === r).map(v => v.m);
  if (ms.includes(1) && ms.includes(2) && ms.includes(3)) {
    s.shanghai = true;
    return finish(s, s.current, "Shanghai");
  }
  const pts = s.visit.reduce((a, v) => a + (v.n === r ? r * v.m : 0), 0);
  endVisit(s, "+" + pts);
  if (s.round >= s.cfg.rounds) finish(s, best(s, q => q.score));
}

/* ===== Halve-It ===== */

export function halveValue(target, d) {
  if (target === "D") return d.m === 2 ? d.n * 2 : 0;
  if (target === "T") return d.m === 3 ? d.n * 3 : 0;
  if (target === "B") return d.n === 25 ? 25 * d.m : 0;
  return d.n === target ? d.n * d.m : 0;
}

function halveDart(s, d) {
  const p = s.players[s.current];
  const tgt = HALVE_TARGETS[s.round];
  s.visit.push(d);
  p.stats.darts += 1;
  const v = halveValue(tgt, d);
  if (v > 0) {
    p.score += v;
    p.stats.hits += 1;
  }
  if (s.visit.length < 3) return;
  const pts = s.visit.reduce((a, x) => a + halveValue(tgt, x), 0);
  let note = "+" + pts;
  if (pts === 0) {
    p.score = Math.floor(p.score / 2);
    note = "½";
  }
  endVisit(s, note);
  if (s.round >= HALVE_TARGETS.length) finish(s, best(s, q => q.score));
}

/* ===== Killer ===== */

function killerDart(s, d) {
  const p = s.players[s.current];
  s.visit.push(d);
  p.stats.darts += 1;
  if (d.m === 2 && d.n >= 1 && d.n <= 20) {
    const qi = s.players.findIndex(x => x.num === d.n && !x.out);
    if (qi === s.current) {
      if (!p.killer) {
        p.killer = true;
        p.stats.hits += 1;
      } else {
        p.lives -= 1;
        if (p.lives <= 0) p.out = true;
      }
    } else if (qi >= 0 && p.killer) {
      const q = s.players[qi];
      q.lives -= 1;
      p.stats.hits += 1;
      if (q.lives <= 0) q.out = true;
    }
  }
  const alive = s.players.map((q, i) => i).filter(i => !s.players[i].out);
  if (alive.length <= 1) return finish(s, alive.length ? alive[0] : s.current);
  if (p.out || s.visit.length === 3) endVisit(s);
}

/* ===== 121 & Random Checkout ===== */

function coFirstTarget(s) {
  return s.cfg.game === "checkout121" ? 121 : s.cfg.targets[0];
}

function endAttempt(s, success) {
  const p = s.players[s.current];
  p.lastVisit = { darts: s.visit.slice(), note: (success ? "✓ " : "✗ ") + p.target };
  s.visit = [];
  if (success) {
    p.successes += 1;
    p.stats.hits += 1;
    p.stats.checkouts += 1;
    p.best = Math.max(p.best, p.target);
  }
  p.attempt += 1;
  if (p.attempt >= s.cfg.attempts) {
    p.done = true;
  } else {
    p.target = s.cfg.game === "checkout121" ? p.target + (success ? 1 : 0) : s.cfg.targets[p.attempt];
  }
  p.rest = p.target;
  p.attemptDarts = 0;
  if (s.players.every(q => q.done)) {
    s.finished = true;
    s.winner = best(s, q => q.successes * 1e6 + q.best * 1000 - q.stats.darts);
    s.event = "match";
    s.legLog.push({ winner: s.winner, darts: s.players[s.winner].stats.darts, checkout: 0, outDarts: 0, visit: [] });
    return;
  }
  advance(s);
}

function coDart(s, d) {
  const p = s.players[s.current];
  if (s.visit.length === 0) p.visitStart = p.rest;
  if (isOneDartFinish(p.rest, "double")) p.stats.ddarts += 1;
  s.visit.push(d);
  p.stats.darts += 1;
  p.attemptDarts += 1;
  const rest = p.rest - d.n * d.m;
  if (rest < 0 || rest === 1 || (rest === 0 && d.m !== 2)) {
    p.rest = p.visitStart;
    p.attemptDarts += 3 - s.visit.length;
    s.event = "bust";
    if (p.attemptDarts >= s.cfg.dartsPer) return endAttempt(s, false);
    p.lastVisit = { darts: s.visit.slice(), note: "Bust" };
    s.visit = [];
    return;
  }
  p.rest = rest;
  if (rest === 0) return endAttempt(s, true);
  if (p.attemptDarts >= s.cfg.dartsPer) return endAttempt(s, false);
  if (s.visit.length === 3) {
    p.lastVisit = { darts: s.visit.slice(), note: "" };
    s.visit = [];
  }
}

/* ===== Golf ===== */

// Dart {n: 0, m: 1} heißt „Scheibe getroffen, aber anderes Feld“ (4 Schläge), {n: 0, m: 0} „Scheibe verfehlt“ (5).
export function golfStrokes(hole, d) {
  if (d.n === hole) return d.m === 2 ? 1 : d.m === 3 ? 2 : 3;
  return d.n === 0 && d.m === 0 ? 5 : 4;
}

function golfLabel(hole, d) {
  if (d.n === 0) return d.m === 0 ? "–" : "≠";
  if (d.n !== hole) return "≠";
  return (d.m === 2 ? "D" : d.m === 3 ? "T" : "") + d.n;
}

function golfEndHole(s) {
  const p = s.players[s.current];
  const hole = s.round + 1;
  const last = s.visit[s.visit.length - 1];
  const strokes = golfStrokes(hole, last);
  p.score += strokes;
  p.holes.push(strokes);
  if (strokes === 1) p.aces += 1;
  endVisit(s, "= " + strokes);
  if (s.round >= s.cfg.holes) finish(s, best(s, q => -q.score * 100 + q.aces));
}

function golfDart(s, d) {
  const p = s.players[s.current];
  const hole = s.round + 1;
  s.visit.push({ n: d.n, m: d.m, label: golfLabel(hole, d) });
  p.stats.darts += 1;
  if (d.n === hole && d.m > 0) p.stats.hits += 1;
  if (s.visit.length === 3) golfEndHole(s);
}

function golfStand(s) {
  if (s.visit.length) golfEndHole(s);
}

/* ===== Bowling ===== */

export function bowlingPins(alley, d) {
  if (d.n !== alley) return 0;
  if (d.m === 3) return 10;
  if (d.m === 2) return 9;
  return d.z === "i" ? 7 : 3;
}

// Standardwertung: Strike = 10 + die nächsten zwei Würfe, Spare = 10 + der nächste. Gibt die Summe der schon bestimmbaren Frames zurück.
export function bowlingScore(frames) {
  const rolls = frames.flat();
  let total = 0;
  let r = 0;
  for (let f = 0; f < frames.length && f < 10; f++) {
    const fr = frames[f];
    if (f === 9) {
      total += fr.reduce((a, b) => a + b, 0);
      break;
    }
    if (fr[0] === 10) {
      if (rolls.length < r + 3) break;
      total += 10 + rolls[r + 1] + rolls[r + 2];
    } else if (fr[0] + fr[1] === 10) {
      if (rolls.length < r + 3) break;
      total += 10 + rolls[r + 2];
    } else {
      total += fr[0] + fr[1];
    }
    r += fr.length;
  }
  return total;
}

function bowlingDart(s, d) {
  const p = s.players[s.current];
  const tenth = s.round === 9;
  if (s.visit.length === 0) p.rack = 10;
  const repeat = d.m === 1 && d.n === s.cfg.alley && s.visit.some(v => v.m === 1 && v.n === d.n && (v.z || "o") === (d.z || "o") && v.pins > 0);
  const raw = repeat ? 0 : bowlingPins(s.cfg.alley, d);
  const fullRack = p.rack === 10;
  const pins = Math.min(raw, p.rack);
  p.rack -= pins;
  const label = pins === 10 && fullRack ? "X" : p.rack === 0 && pins > 0 ? "/" : pins === 0 ? "–" : String(pins);
  s.visit.push({ n: d.n, m: d.m, z: d.z, pins, label });
  p.stats.darts += 1;
  if (pins > 0) p.stats.hits += 1;
  if (pins === 10 && fullRack) p.strikes += 1;
  if (tenth && p.rack === 0) p.rack = 10;
  const n = s.visit.length;
  const two = n >= 2 ? s.visit[0].pins + s.visit[1].pins : 0;
  const done = tenth
    ? n === 3 || (n === 2 && s.visit[0].pins < 10 && two < 10)
    : n === 2 || s.visit[0].pins === 10;
  if (!done) return;
  p.frames.push(s.visit.map(v => v.pins));
  p.score = bowlingScore(p.frames);
  const f = p.frames[p.frames.length - 1];
  const open = tenth || (f[0] < 10 && f[0] + f[1] < 10);
  endVisit(s, open ? "= " + f.reduce((x, y) => x + y, 0) : "");
  if (s.round >= 10) finish(s, best(s, q => q.score));
}

/* ===== Replay ===== */

export function replayMode(cfg, actions) {
  const g = cfg.game;
  const s = frame(cfg, i => {
    if (g === "atc" || g === "doubles") return { pos: 0 };
    if (g === "golf") return { score: 0, holes: [], aces: 0 };
    if (g === "bowling") return { score: 0, frames: [], rack: 10, strikes: 0 };
    if (g === "bobs27") return { score: 27, outRound: 0 };
    if (g === "shanghai" || g === "halveit") return { score: 0 };
    if (g === "killer") return { num: cfg.numbers[i], lives: cfg.lives, killer: false };
    const target = coFirstTarget({ cfg });
    return { attempt: 0, target, rest: target, visitStart: target, attemptDarts: 0, successes: 0, best: 0 };
  });
  const step = { atc: raceDart, doubles: raceDart, bobs27: bobsDart, shanghai: shanghaiDart, halveit: halveDart, killer: killerDart, checkout121: coDart, randomco: coDart, golf: golfDart, bowling: bowlingDart }[g];
  for (const a of actions) {
    if (s.finished) break;
    s.event = null;
    if (a.t === "d") step(s, { n: a.n, m: a.m, z: a.z });
    else if (a.t === "s" && g === "golf") golfStand(s);
  }
  return s;
}
