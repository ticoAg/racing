/* =========================================================================
   TRACK — a floodlit circuit generated ahead of the car. Each driving
   program lays down curvature segments (straights, clothoid eases, arcs),
   a racing line, kerbs, braking boards, patches and gantries; every frame
   the centreline is integrated into the car's frame (car at the origin,
   facing +x, right-hand side +z) for the road, scenery and lights.
   ========================================================================= */
const TRACK = {
  W: 14,              // asphalt width (m)
  WALL: 14,           // barrier offset from the centreline
  LAMP_D: 45, LAMP_N: 12.6, LAMP_H: 15.5,
  P: 3600,            // period of every repeating pattern (lamps, kerb stripes, ads, patches)
  segs: [], keys: [], kerbs: [], skids: [], decos: [], end: 0, prog: 'park', unit: 0, sgn: 1, lastStraight: 0, exitSide: 0, cur: 0,
  photo: 0,
  // centreline in the car frame at 1 m steps from s0 (filled by trackFrame)
  s0: 0, n: 0, X: new Float64Array(1700), Z: new Float64Array(1700), TH: new Float64Array(1700), K: new Float32Array(1700),
  sc: 0, nc: 0, psi: 0,
};
const TR_BACK = 320, TR_AHEAD = 1360;
// transverse asphalt patches: one optional patch per 30 m cell, same table for physics, sound and the road shader
const PATCH_CELL = 30, PATCH_N = TRACK.P / PATCH_CELL;
const PATCHES = (() => {
  const a = new Float32Array(PATCH_N * 2);
  let seed = 7919;
  const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < PATCH_N; i++) {
    const has = r() < 0.2, off = 2 + r() * 18, len = 2.5 + r() * 7;
    a[i * 2] = has ? off : -1; a[i * 2 + 1] = has ? off + len : -1;
  }
  return a;
})();
const pmod = (s) => ((s % TRACK.P) + TRACK.P) % TRACK.P;

/* ---------- curvature segments ---------- */
function addSeg(len, k0, k1, kind = 'straight') {
  const T = TRACK;
  T.segs.push({ s0: T.end, s1: T.end + len, k0, k1, kind });
  T.end += len;
}
function kAt(s) {
  const S = TRACK.segs;
  if (!S.length) return 0;
  let i = clamp(TRACK.cur, 0, S.length - 1);
  while (i > 0 && S[i].s0 > s) i--;
  while (i < S.length - 1 && S[i].s1 <= s) i++;
  TRACK.cur = i;
  const g = S[i];
  if (s < g.s0 || s > g.s1) return 0;
  return g.k0 + (g.k1 - g.k0) * (s - g.s0) / (g.s1 - g.s0);
}
function addKey(s, n) {
  const K = TRACK.keys;
  while (K.length && K[K.length - 1].s >= s - 1) K.pop();
  K.push({ s, n });
}
function straight(len, o = {}) {
  const T = TRACK, s = T.end;
  if (T.exitSide && len >= 90) addKey(s + 35, T.exitSide * (o.A || 5.4));
  if (o.gantry !== undefined) T.decos.push({ kind: 'gantry', s: s + o.gantry });
  addSeg(len, 0, 0);
  T.lastStraight = len;
}
// a corner of radius R turning by `ang` radians, entered and left on clothoid eases
function turn(sgn, R, ang, ease, o = {}) {
  const T = TRACK, k = sgn / R, arc = Math.max(4, ang * R - ease);
  const sIn = T.end, sApex = sIn + ease + arc / 2, sOut = sIn + 2 * ease + arc;
  const A = o.A || 5.4;
  if (T.lastStraight >= 90) addKey(sIn - 4, -sgn * A);
  addKey(sApex, sgn * (o.apex || A));
  addSeg(ease, 0, k, 'ease'); addSeg(arc, k, k, 'arc'); addSeg(ease, k, 0, 'ease');
  if (o.kerbs) {
    T.kerbs.push({ s0: sIn + ease * 0.35, s1: sOut - ease * 0.35, side: sgn });
    T.kerbs.push({ s0: sOut - ease * 0.6, s1: sOut + 38, side: -sgn });
    T.kerbs.push({ s0: sIn - 34, s1: sIn + ease * 0.3, side: -sgn });
  }
  if (o.boards) for (const d of [100, 200, 300]) T.decos.push({ kind: 'board', s: sIn - d, side: -sgn, label: String(d) });
  if (o.skid) T.skids.push({ s0: sIn - o.skid, s1: sIn + ease });
  T.exitSide = -sgn; T.lastStraight = 0;
  return { sIn, sApex, sOut };
}
// one repeating unit of road for the active program
function genUnit() {
  const T = TRACK, p = T.prog, u = T.unit++;
  if (p === 'cruise') {
    // V-max run: kilometres of straight with very long, gentle bends
    straight(2300 + 700 * ((u * 0.618) % 1), { gantry: 420, A: 1.2 });
    turn(T.sgn, 2600, 0.12, 230, { A: 1.2, apex: 1.6 });
    T.sgn = -T.sgn;
  } else if (p === 'corner') {
    // fast esses: right-left pairs at the limit of grip
    straight(u % 3 === 0 ? 240 : 150, { gantry: u % 3 === 0 ? 60 : undefined });
    turn(1, 105, 1.06, 30, { kerbs: true, A: 5.5, apex: 6.45 });
    straight(46);
    turn(-1, 105, 1.06, 30, { kerbs: true, A: 5.5, apex: 6.45 });
  } else if (p === 'brake') {
    // long straight into a hairpin: full throttle, braking boards, maximum braking
    straight(660, { gantry: 90 });
    turn(T.sgn, 34, 2.95, 16, { kerbs: true, boards: true, skid: 150, A: 5.6, apex: 6.5 });
    T.sgn = -T.sgn;
  } else {
    straight(800);
  }
}
function trackEnsure(sc) {
  const T = TRACK;
  let guard = 0;
  while (T.end < sc + TR_AHEAD + 900 && guard++ < 50) genUnit();
  // forget what is far behind
  const cut = sc - TR_BACK - 600;
  let i = 0;
  while (i < T.segs.length - 1 && T.segs[i].s1 < cut) i++;
  if (i > 0) { T.segs.splice(0, i); T.cur = Math.max(0, T.cur - i); }
  for (const key of ['kerbs', 'skids']) { const L = T[key]; let j = 0; while (j < L.length && L[j].s1 < cut) j++; if (j) L.splice(0, j); }
  { const L = T.decos; let j = 0; while (j < L.length && L[j].s < cut) j++; if (j) L.splice(0, j); }
  { const L = T.keys; let j = 0; while (j < L.length - 2 && L[j + 1].s < cut) j++; if (j) L.splice(0, j); }
}
function trackReset(prog) {
  const T = TRACK;
  Object.assign(T, { segs: [], keys: [], kerbs: [], skids: [], decos: [], end: -900, unit: 0, sgn: 1, lastStraight: 0, exitSide: 0, cur: 0, prog });
  addSeg(900, 0, 0);
  addKey(-900, 0);
  T.lastStraight = 900;
  trackEnsure(0);
  // a characteristic spot for stills: in the braking zone, on the first apex, or on the straight
  if (prog === 'brake') { const b = T.decos.find((d) => d.kind === 'board' && d.label === '100'); T.photo = b ? b.s + 30 : 0; }
  else if (prog === 'corner') { const g = T.segs.find((g) => g.kind === 'arc'); T.photo = g ? (g.s0 + g.s1) / 2 - 8 : 0; }
  else T.photo = 260;
}
// a new program takes over the road beyond what the car is about to drive on
function trackSwitch(prog, sc, v) {
  const T = TRACK;
  if (prog === T.prog) return;
  const keep = sc + 40 + v * 1.6;
  const kk = kAt(keep), nk = racingN(keep);
  const S = T.segs;
  let i = S.findIndex((g) => g.s1 > keep);
  if (i >= 0) {
    const g = S[i];
    if (g.s0 < keep) { g.k1 = g.k0 + (g.k1 - g.k0) * (keep - g.s0) / (g.s1 - g.s0); g.s1 = keep; i++; }
    S.length = i;
  }
  T.end = keep;
  T.kerbs = T.kerbs.filter((q) => q.s0 < keep).map((q) => ({ ...q, s1: Math.min(q.s1, keep) }));
  T.skids = T.skids.filter((q) => q.s1 < keep);
  T.decos = T.decos.filter((q) => q.s < keep);
  T.keys = T.keys.filter((q) => q.s < keep);
  addKey(keep, nk);
  if (Math.abs(kk) > 1e-6) addSeg(50, kk, 0, 'ease');
  T.prog = prog; T.unit = 0; T.exitSide = 0; T.lastStraight = 0;
  straight(70);
  trackEnsure(sc);
}

/* ---------- queries ---------- */
function racingN(s) {
  const K = TRACK.keys;
  if (!K.length) return 0;
  if (s <= K[0].s) return K[0].n;
  let lo = 0, hi = K.length - 1;
  if (s >= K[hi].s) return K[hi].n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m].s > s) hi = m; else lo = m; }
  const a = K[lo], b = K[hi], t = (s - a.s) / (b.s - a.s);
  return a.n + (b.n - a.n) * t * t * (3 - 2 * t);
}
function inRanges(list, s, side) {
  for (const q of list) if (s >= q.s0 && s <= q.s1 && (side === undefined || q.side === side)) return true;
  return false;
}
// smooth 0..1 weight of a kerb on one side near s (for the road shader)
function kerbW(s, side) {
  let w = 0;
  for (const q of TRACK.kerbs) if (q.side === side) w = Math.max(w, sstep(q.s0 - 1, q.s0 + 1, s) * (1 - sstep(q.s1 - 1, q.s1 + 1, s)));
  return w;
}
function skidW(s) {
  let w = 0;
  for (const q of TRACK.skids) w = Math.max(w, sstep(q.s0, q.s0 + 60, s) * (1 - sstep(q.s1 - 6, q.s1, s)));
  return w;
}
// patch edges crossed between s0 and s1 (for bumps and thumps)
function patchEdges(s0, s1, out) {
  if (s1 <= s0) return out;
  const c0 = Math.floor(s0 / PATCH_CELL), c1 = Math.floor(s1 / PATCH_CELL);
  for (let c = c0; c <= c1; c++) {
    const i = ((c % PATCH_N) + PATCH_N) % PATCH_N;
    if (PATCHES[i * 2] < 0) continue;
    for (const e of [PATCHES[i * 2], PATCHES[i * 2 + 1]]) { const se = c * PATCH_CELL + e; if (se > s0 && se <= s1) out.push(se); }
  }
  return out;
}

/* ---------- centreline in the car frame ---------- */
// car at track position sc, lateral offset nc, heading psi relative to the road
function trackFrame(sc, nc, psi) {
  const T = TRACK;
  trackEnsure(sc);
  const s0 = Math.floor(sc) - TR_BACK, n = TR_BACK + TR_AHEAD + 1;
  T.s0 = s0; T.n = n; T.sc = sc; T.nc = nc; T.psi = psi;
  for (let i = 0; i < n; i++) T.K[i] = kAt(s0 + i);
  // start at the car: road heading -psi, centre one offset away along the normal
  const i0 = Math.floor(sc - s0), f0 = sc - s0 - i0;
  let th = -psi, x = nc * Math.sin(-psi), z = -nc * Math.cos(-psi);
  // step back to the integer sample before the car, then integrate both ways
  const kc = T.K[i0];
  th -= kc * f0; x -= Math.cos(th) * f0; z -= Math.sin(th) * f0;
  T.X[i0] = x; T.Z[i0] = z; T.TH[i0] = th;
  for (let i = i0; i < n - 1; i++) {
    const k = 0.5 * (T.K[i] + T.K[i + 1]), tm = T.TH[i] + 0.5 * k;
    T.TH[i + 1] = T.TH[i] + k; T.X[i + 1] = T.X[i] + Math.cos(tm); T.Z[i + 1] = T.Z[i] + Math.sin(tm);
  }
  for (let i = i0; i > 0; i--) {
    const k = 0.5 * (T.K[i] + T.K[i - 1]), tm = T.TH[i] - 0.5 * k;
    T.TH[i - 1] = T.TH[i] - k; T.X[i - 1] = T.X[i] - Math.cos(tm); T.Z[i - 1] = T.Z[i] - Math.sin(tm);
  }
}
// road coordinates -> car frame. returns false outside the integrated window
const _tp = { x: 0, z: 0, th: 0 };
function trackPoint(s, n, out = _tp) {
  const T = TRACK, f = s - T.s0;
  if (f < 0 || f > T.n - 1.001) return null;
  const i = Math.floor(f), t = f - i;
  const th = T.TH[i] + (T.TH[i + 1] - T.TH[i]) * t;
  out.th = th;
  out.x = T.X[i] + (T.X[i + 1] - T.X[i]) * t - Math.sin(th) * n;
  out.z = T.Z[i] + (T.Z[i + 1] - T.Z[i]) * t + Math.cos(th) * n;
  return out;
}
