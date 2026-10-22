export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];

export function dartValue(d) {
  return d.n * d.m;
}

export function dartLabel(d) {
  if (d.n === 0 || d.m === 0) return "–";
  if (d.n === 25) return d.m === 2 ? "Bull" : "25";
  return (d.m === 3 ? "T" : d.m === 2 ? "D" : "") + d.n;
}

export function isValidDart(d) {
  if (d.n === 0) return d.m === 0;
  if (d.n === 25) return d.m === 1 || d.m === 2;
  return Number.isInteger(d.n) && d.n >= 1 && d.n <= 20 && d.m >= 1 && d.m <= 3;
}

export function isFinishDart(d, outMode) {
  if (outMode === "single") return d.m >= 1;
  if (outMode === "master") return d.m >= 2;
  return d.m === 2;
}

// Rest, der mit einem einzigen Dart auscheckbar ist. Jeder Dart bei so einem Rest zählt als „Dart aufs Doppel“ (Checkout-Quote).
export function isOneDartFinish(rest, outMode) {
  if (rest === 50) return true;
  if (outMode === "single") return (rest >= 1 && rest <= 20) || rest === 25 || (rest <= 40 && rest % 2 === 0) || (rest <= 60 && rest % 3 === 0);
  if (rest >= 2 && rest <= 40 && rest % 2 === 0) return true;
  return outMode === "master" && rest >= 3 && rest <= 60 && rest % 3 === 0;
}

// Aufnahmen über 180 und diese Summen sind mit drei Darts nicht erreichbar.
const IMPOSSIBLE_VISITS = new Set([163, 166, 169, 172, 173, 175, 176, 178, 179]);

export function isPossibleVisit(score) {
  return Number.isInteger(score) && score >= 0 && score <= 180 && !IMPOSSIBLE_VISITS.has(score);
}

function newStats() {
  return {
    points: 0, darts: 0, f9Points: 0, f9Darts: 0,
    marks: 0, ton: 0, ton40: 0, max: 0, highestOut: 0, bestLeg: 0,
    checkouts: 0, ddarts: 0
  };
}

function matchFrame(cfg) {
  return {
    cfg,
    players: cfg.players.map(p => ({
      id: p.id, name: p.name, members: p.members, memberStats: p.members ? p.members.map(newStats) : null,
      turns: 0, legs: 0, sets: 0, stats: newStats(), lastVisit: null
    })),
    legNo: 0,
    setNo: 0,
    visitNo: 0,
    current: 0,
    visit: [],
    finished: false,
    winner: -1,
    legWinner: -1,
    event: null,
    legLog: []
  };
}

function legStarter(s) {
  return s.legNo % s.players.length;
}

function nextTurn(s) {
  s.players[s.current].turns += 1;
  s.visitNo += 1;
  s.current = (legStarter(s) + s.visitNo) % s.players.length;
  s.visit = [];
}

function winLeg(s, idx, legDarts, checkout, outDarts) {
  s.players[s.current].turns += 1;
  const p = s.players[idx];
  p.legs += 1;
  s.legWinner = idx;
  s.legLog.push({ winner: idx, darts: legDarts, checkout: checkout || 0, outDarts: outDarts || s.visit.length, visit: s.visit.slice() });
  let evt = "leg";
  if (p.legs >= s.cfg.legs) {
    if (s.cfg.sets > 1) {
      p.sets += 1;
      s.players.forEach(q => { q.legs = 0; });
      s.setNo += 1;
      evt = "set";
      if (p.sets >= s.cfg.sets) evt = "match";
    } else {
      evt = "match";
    }
  }
  s.event = evt;
  if (evt === "match") {
    s.finished = true;
    s.winner = idx;
    return;
  }
  s.legNo += 1;
  s.visitNo = 0;
  s.current = legStarter(s);
  s.visit = [];
}

/* ===== X01 ===== */

function startX01Leg(s) {
  s.players.forEach(p => {
    p.rest = s.cfg.start;
    p.opened = s.cfg.inMode !== "double";
    p.legDarts = 0;
    p.legVisits = 0;
    p.lastVisit = null;
  });
}

// Statistik zählt fürs Team und, bei Teams, zusätzlich für das Mitglied, das gerade wirft.
function eachStats(p, fn) {
  fn(p.stats);
  if (p.memberStats) fn(p.memberStats[p.turns % p.memberStats.length]);
}

function closeX01Visit(s, p, points, darts) {
  const firstNine = p.legVisits < 3;
  eachStats(p, st => {
    st.points += points;
    st.darts += darts;
    if (firstNine) {
      st.f9Points += points;
      st.f9Darts += darts;
    }
    if (points >= 100) st.ton += 1;
    if (points >= 140) st.ton40 += 1;
    if (points === 180) st.max += 1;
  });
  p.legVisits += 1;
  p.legDarts += darts;
}

function applyX01Dart(s, d) {
  const p = s.players[s.current];
  if (s.visit.length === 0) p.visitStart = p.rest;
  if (p.opened && isOneDartFinish(p.rest, s.cfg.outMode)) eachStats(p, st => { st.ddarts += 1; });
  const opensNow = !p.opened && d.m === 2;
  const scores = p.opened || opensNow;
  if (opensNow) p.opened = true;
  const value = scores ? dartValue(d) : 0;
  const rest = p.rest - value;
  s.visit.push({ n: d.n, m: d.m });

  const out = s.cfg.outMode;
  const bust = rest < 0 || (rest === 0 && !isFinishDart(d, out)) || (rest === 1 && out !== "single");
  if (bust) {
    p.rest = p.visitStart;
    p.lastVisit = { darts: s.visit.slice(), points: 0, bust: true };
    closeX01Visit(s, p, 0, 3);
    s.event = "bust";
    nextTurn(s);
    return;
  }
  p.rest = rest;
  if (rest === 0) {
    const points = p.visitStart;
    p.lastVisit = { darts: s.visit.slice(), points, bust: false };
    closeX01Visit(s, p, points, s.visit.length);
    eachStats(p, st => {
      st.checkouts += 1;
      st.highestOut = Math.max(st.highestOut, points);
    });
    if (!p.stats.bestLeg || p.legDarts < p.stats.bestLeg) p.stats.bestLeg = p.legDarts;
    winLeg(s, s.current, p.legDarts, points);
    if (!s.finished) startX01Leg(s);
    return;
  }
  if (s.visit.length === 3) {
    const points = p.visitStart - rest;
    p.lastVisit = { darts: s.visit.slice(), points, bust: false };
    closeX01Visit(s, p, points, 3);
    s.event = points === 180 ? "180" : null;
    nextTurn(s);
  }
}

function applyX01Visit(s, score, darts, dd) {
  const p = s.players[s.current];
  eachStats(p, st => { st.ddarts += dd || 0; });
  p.visitStart = p.rest;
  if (score > 0) p.opened = true;
  const rest = p.rest - score;
  const bust = rest < 0 || (rest === 1 && s.cfg.outMode !== "single");
  if (bust) {
    p.lastVisit = { darts: null, points: 0, bust: true };
    closeX01Visit(s, p, 0, 3);
    s.event = "bust";
    nextTurn(s);
    return;
  }
  p.rest = rest;
  if (rest === 0) {
    const used = darts || 3;
    p.lastVisit = { darts: null, points: score, bust: false };
    closeX01Visit(s, p, score, used);
    eachStats(p, st => {
      st.checkouts += 1;
      st.highestOut = Math.max(st.highestOut, score);
    });
    if (!p.stats.bestLeg || p.legDarts < p.stats.bestLeg) p.stats.bestLeg = p.legDarts;
    winLeg(s, s.current, p.legDarts, score, used);
    if (!s.finished) startX01Leg(s);
    return;
  }
  p.lastVisit = { darts: null, points: score, bust: false };
  closeX01Visit(s, p, score, 3);
  s.event = score === 180 ? "180" : null;
  nextTurn(s);
}

/* ===== Cricket ===== */

function startCricketLeg(s) {
  s.players.forEach(p => {
    p.marks = Object.fromEntries(CRICKET_TARGETS.map(t => [t, 0]));
    p.score = 0;
    p.legDarts = 0;
    p.lastVisit = null;
  });
}

function closedByAll(s, t) {
  return s.players.every(p => p.marks[t] >= 3);
}

function cricketWinner(s) {
  const cut = s.cfg.variant === "cutthroat";
  const better = (a, b) => cut ? a <= b : a >= b;
  const allDone = CRICKET_TARGETS.every(t => closedByAll(s, t));
  for (let i = 0; i < s.players.length; i++) {
    const idx = (s.current + i) % s.players.length;
    const p = s.players[idx];
    if (!CRICKET_TARGETS.every(t => p.marks[t] >= 3)) continue;
    if (s.players.every(q => q === p || better(p.score, q.score))) return idx;
  }
  if (allDone) {
    let best = s.current;
    s.players.forEach((p, i) => {
      if (cut ? p.score < s.players[best].score : p.score > s.players[best].score) best = i;
    });
    return best;
  }
  return -1;
}

function applyCricketDart(s, d) {
  const p = s.players[s.current];
  s.visit.push({ n: d.n, m: d.m });
  p.legDarts += 1;
  eachStats(p, st => { st.darts += 1; });

  if (CRICKET_TARGETS.includes(d.n) && d.m > 0) {
    const t = d.n;
    const need = Math.max(0, 3 - p.marks[t]);
    const closing = Math.min(need, d.m);
    const extra = d.m - closing;
    p.marks[t] += closing;
    let counted = closing;
    if (extra > 0 && !closedByAll(s, t)) {
      const points = extra * (t === 25 ? 25 : t);
      if (s.cfg.variant === "cutthroat") {
        s.players.forEach(q => { if (q !== p && q.marks[t] < 3) q.score += points; });
      } else {
        p.score += points;
      }
      p.marks[t] += extra;
      counted += extra;
    }
    eachStats(p, st => { st.marks += counted; });
  }

  const winner = cricketWinner(s);
  if (winner >= 0) {
    p.lastVisit = { darts: s.visit.slice() };
    const legDarts = s.players[winner].legDarts;
    const st = s.players[winner].stats;
    if (!st.bestLeg || legDarts < st.bestLeg) st.bestLeg = legDarts;
    winLeg(s, winner, legDarts);
    if (!s.finished) startCricketLeg(s);
    return;
  }
  if (s.visit.length === 3) {
    p.lastVisit = { darts: s.visit.slice() };
    nextTurn(s);
  }
}

/* ===== Replay ===== */

// Der Spielstand wird immer komplett aus der Aktionsliste neu berechnet.
// Dadurch ist Rückgängig nur „letzte Aktion entfernen“ und kann nie einen inkonsistenten Stand hinterlassen.
export function replay(cfg, actions) {
  const s = matchFrame(cfg);
  const x01 = cfg.game === "x01";
  if (x01) startX01Leg(s); else startCricketLeg(s);
  for (const a of actions) {
    if (s.finished) break;
    s.event = null;
    s.legWinner = -1;
    if (a.t === "d") {
      if (x01) applyX01Dart(s, a); else applyCricketDart(s, a);
    } else if (a.t === "v" && x01) {
      applyX01Visit(s, a.score, a.darts, a.dd);
    }
  }
  return s;
}

// Bei Teams werfen die Mitglieder reihum, gezählt über alle Aufnahmen des Teams im Match.
export function thrower(p) {
  return p.members && p.members.length ? p.members[p.turns % p.members.length] : p;
}

export function average(st) {
  return st.darts ? st.points / st.darts * 3 : 0;
}

export function firstNine(st) {
  return st.f9Darts ? st.f9Points / st.f9Darts * 3 : 0;
}

export function checkoutRate(st) {
  return st.ddarts ? st.checkouts / st.ddarts * 100 : 0;
}

export function marksPerRound(st) {
  return st.darts ? st.marks / st.darts * 3 : 0;
}
