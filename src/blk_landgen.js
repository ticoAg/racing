/* =========================================================================
   LAND (data) — the open country for free driving: a 4 km square of terrain
   around a closed road. The road is drawn first (plan and elevation), the
   land is then raised around it: close to the road it follows the road's own
   profile, further out the relief grows into hills, a mountain range in the
   north, a lake in the east and a rim of peaks at the edge of the map.
   Everything here is plain data (no three.js): a height grid, the road's
   centreline at 1 m steps, what lies beside it (kerbs, barriers), the trees
   and rocks, and the queries the vehicle model asks every step.
   World axes: x east, z south, y up; a heading of 0 looks east and grows
   clockwise, as the car's does.
   ========================================================================= */
const LG = {
  SIZE: 4096, HALF: 2048, CELL: 4, N: 1025,
  WATER: 16,              // lake level (m)
  HW: 6,                  // half width of the asphalt
  KERB: 1.25,             // kerb width beyond the edge line
  VERGE: 8.5,             // mown verge beyond the asphalt; the road's own mesh ends there, tucked under the land
  SKIRT: 3,               // the outer strip of the verge that dives under the land
  TRENCH: 0.35,           // how far the land lies under the road's mesh
  NEAR_CELL: 8, NEAR_N: 512, NEAR_R: 88,
  ready: false, H: null, biome: null, near: null, D16: null,
  road: null, walls: [], kerbs: [], trees: null, rocks: null, obst: null, houses: [],
  spawn: { x: 0, z: 0, th: 0 },
};

/* ---------- noise ---------- */
const LN_P = new Uint8Array(514);
(() => {
  let s = 90210;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 514; i++) LN_P[i] = p[i & 255];
})();
const LN_GX = [1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071], LN_GY = [0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071];
// gradient noise, about -1..1
function gnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const h00 = LN_P[LN_P[X] + Y] & 7, h10 = LN_P[LN_P[X + 1] + Y] & 7, h01 = LN_P[LN_P[X] + Y + 1] & 7, h11 = LN_P[LN_P[X + 1] + Y + 1] & 7;
  const a = LN_GX[h00] * xf + LN_GY[h00] * yf, b = LN_GX[h10] * (xf - 1) + LN_GY[h10] * yf;
  const c = LN_GX[h01] * xf + LN_GY[h01] * (yf - 1), d = LN_GX[h11] * (xf - 1) + LN_GY[h11] * (yf - 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 1.5;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * gnoise(x, y); n += a; const t = x * 1.6 - y * 1.2 + 11.3; y = (x * 1.2 + y * 1.6 + 5.7); x = t; a *= 0.5; }
  return s / n;
}
// ridges: sharp crests, smooth valleys; 0..1
function ridged(x, y, oct) {
  let s = 0, a = 0.5, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(gnoise(x, y)); r *= r;
    s += a * r * w; n += a; w = Math.min(1, r * 1.6);
    const t = x * 1.6 - y * 1.2 + 3.1; y = (x * 1.2 + y * 1.6 + 8.9); x = t; a *= 0.5;
  }
  return s / n;
}
const lsmooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function lgRand(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/* ---------- the road: plan, elevation, what stands beside it ---------- */
// control polygon of a closed cubic B-spline: [east, north, elevation]. The lap runs anticlockwise on the map:
// east along the main straight in the south, north beside the lake, west over the pass, south through the forest
const LG_ROUTE = [
  // the main straight
  [-900, -1080, 22], [-560, -1080, 22], [-200, -1080, 22], [160, -1080, 22], [470, -1080, 22],
  // first corner, a short run north and the esses down to the lake
  [650, -1080, 22], [650, -930, 22], [650, -800, 22], [760, -690, 21.5], [760, -570, 21], [880, -470, 20.5],
  // the lake road
  [905, -340, 19.5], [990, -200, 19], [850, -40, 19], [975, 130, 19.5], [870, 300, 21],
  // the climb: three hairpins up the southern face of the range
  [900, 470, 25], [900, 610, 30], [900, 700, 34], [760, 700, 39], [620, 700, 44], [540, 700, 47], [540, 780, 50], [620, 780, 53],
  [760, 780, 58], [880, 780, 62], [950, 780, 64], [950, 860, 67], [880, 860, 70], [720, 865, 77], [540, 880, 85], [390, 950, 94],
  [300, 1080, 104], [170, 1180, 113],
  // the ridge
  [-40, 1225, 116], [-250, 1120, 112], [-460, 1215, 107], [-660, 1095, 100],
  // down through the forest
  [-790, 975, 92], [-745, 820, 83], [-945, 725, 75], [-1085, 570, 67], [-1015, 410, 60],
  // the back straight across the middle of the map and the long right-hander that turns it round
  [-1000, 285, 55], [-860, 210, 51], [-640, 225, 47], [-400, 255, 43], [-170, 215, 40],
  [30, 160, 37.5], [135, 20, 36], [60, -130, 34.5], [-120, -185, 33],
  // west again, then south to the last bend
  [-330, -165, 31], [-470, -110, 30], [-560, -250, 29.2], [-700, -205, 28.4], [-850, -270, 27], [-965, -420, 25.5], [-985, -620, 24.5],
  [-1065, -790, 23.5], [-1100, -960, 22.6], [-1020, -1080, 22.1],
];
const LG_LAKE = { x: 1345, z: 20, rx: 300, rz: 500 };

function lgBuildRoad() {
  const P = LG_ROUTE.map((p) => [p[0], -p[1], p[2]]), n = P.length;
  // dense evaluation of the closed uniform cubic B-spline
  const dense = [];
  const SUB = 48;
  for (let i = 0; i < n; i++) {
    const p0 = P[i], p1 = P[(i + 1) % n], p2 = P[(i + 2) % n], p3 = P[(i + 3) % n];
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB, t2 = t * t, t3 = t2 * t;
      const b0 = (1 - 3 * t + 3 * t2 - t3) / 6, b1 = (4 - 6 * t2 + 3 * t3) / 6, b2 = (1 + 3 * t + 3 * t2 - 3 * t3) / 6, b3 = t3 / 6;
      dense.push([b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0], b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1], b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2]]);
    }
  }
  const M = dense.length, cum = new Float64Array(M + 1);
  for (let i = 0; i < M; i++) { const a = dense[i], b = dense[(i + 1) % M]; cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const L = cum[M], N = Math.round(L), ds = L / N;
  const R = { n: N, L, ds, x: new Float32Array(N + 1), z: new Float32Array(N + 1), h: new Float32Array(N + 1), th: new Float32Array(N + 1), k: new Float32Array(N + 1),
    bank: new Float32Array(N + 1), line: new Float32Array(N + 1), kerbL: new Float32Array(N + 1), kerbR: new Float32Array(N + 1),
    wallL: new Uint8Array(N + 1), wallR: new Uint8Array(N + 1), solid: new Float32Array(N + 1), grip: new Float32Array(N + 1) };
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % M], t = (s - cum[j]) / (cum[j + 1] - cum[j]);
    R.x[i] = a[0] + (b[0] - a[0]) * t; R.z[i] = a[1] + (b[1] - a[1]) * t; R.h[i] = a[2] + (b[2] - a[2]) * t;
  }
  // start/finish: a third of the way down the main straight (control points 0..4 lie on it)
  {
    let best = 0, bd = 1e9;
    for (let i = 0; i < N; i++) { const d = Math.hypot(R.x[i] + 480, R.z[i] - 1080); if (d < bd) { bd = d; best = i; } }
    const rot = (A) => { const c = A.slice(0, N); for (let i = 0; i < N; i++) A[i] = c[(i + best) % N]; };
    rot(R.x); rot(R.z); rot(R.h);
  }
  // heading (unwrapped) and curvature
  const W = (i) => ((i % N) + N) % N;
  let prev = 0;
  for (let i = 0; i < N; i++) {
    let th = Math.atan2(R.z[W(i + 1)] - R.z[W(i - 1)], R.x[W(i + 1)] - R.x[W(i - 1)]);
    if (i > 0) { while (th - prev > Math.PI) th -= 2 * Math.PI; while (th - prev < -Math.PI) th += 2 * Math.PI; }
    R.th[i] = th; prev = th;
  }
  R.turn = R.th[N - 1] - R.th[0];   // about ∓2π over the lap
  const thAt = (i) => R.th[W(i)] + Math.floor(i / N) * (Math.round(R.turn / (2 * Math.PI)) * 2 * Math.PI);
  for (let i = 0; i < N; i++) R.k[i] = (thAt(i + 2) - thAt(i - 2)) / (4 * ds);
  // elevation: smooth the spline's profile once more, then keep the gradient gentle
  const blur = (A, r, passes) => {
    const T = new Float32Array(N);
    for (let p = 0; p < passes; p++) {
      let acc = 0;
      for (let q = -r; q <= r; q++) acc += A[W(q)];
      for (let i = 0; i < N; i++) { T[i] = acc / (2 * r + 1); acc += A[W(i + r + 1)] - A[W(i - r)]; }
      for (let i = 0; i < N; i++) A[i] = T[i];
    }
  };
  blur(R.h, 30, 2);
  // banking: the road leans into its bends (a positive bank drops the right-hand side)
  for (let i = 0; i < N; i++) R.bank[i] = Math.max(-0.055, Math.min(0.055, R.k[i] * 4.2));
  blur(R.bank, 8, 2);
  // the line cars wear into the surface: towards the inside of each bend
  for (let i = 0; i < N; i++) R.line[i] = Math.max(-3.6, Math.min(3.6, R.k[i] * 520));
  blur(R.line, 22, 2);
  // corners: runs of real curvature. Kerbs on the inside over the bend, on the outside at entry and exit of the tight ones
  const corners = [];
  {
    const TH = 1 / 240;
    let i = 0;
    while (i < N) {
      if (Math.abs(R.k[i]) > TH) {
        const i0 = i, sg = Math.sign(R.k[i]);
        let pk = 0;
        while (i < N && Math.abs(R.k[i]) > TH && Math.sign(R.k[i]) === sg) { pk = Math.max(pk, Math.abs(R.k[i])); i++; }
        if (i - i0 > 12) corners.push({ i0, i1: i, sgn: sg, peak: pk });
      } else i++;
    }
  }
  R.corners = corners;
  const kerbs = [];
  for (const c of corners) {
    const len = c.i1 - c.i0;
    kerbs.push({ i0: c.i0 - 4, i1: c.i1 + 4, side: c.sgn });
    if (c.peak > 1 / 150) { kerbs.push({ i0: c.i1 - Math.round(len * 0.3), i1: c.i1 + 42, side: -c.sgn }); kerbs.push({ i0: c.i0 - 36, i1: c.i0 + Math.round(len * 0.25), side: -c.sgn }); }
  }
  LG.kerbs = kerbs;
  for (const q of kerbs) for (let i = q.i0; i <= q.i1; i++) {
    const w = Math.min(1, (i - q.i0) / 3, (q.i1 - i) / 3), A = q.side > 0 ? R.kerbR : R.kerbL;
    A[W(i)] = Math.max(A[W(i)], Math.max(0, w));
  }
  // centre line: solid through the bends, dashed elsewhere
  for (let i = 0; i < N; i++) R.solid[i] = Math.abs(R.k[i]) > 1 / 320 ? 1 : 0;
  blur(R.solid, 10, 1);
  // close the arrays (index N repeats index 0, one lap of heading further on)
  for (const key of ['x', 'z', 'h', 'k', 'bank', 'line', 'kerbL', 'kerbR', 'solid']) R[key][N] = R[key][0];
  R.th[N] = thAt(N);
  R.W = W;
  LG.road = R;
  LG.spawn = lgRoadPose(-24, 0);
  return R;
}
// a point of the road: s along (wraps), n to the right
function lgRoadPose(s, n, out = {}) {
  const R = LG.road, f = (((s / R.ds) % R.n) + R.n) % R.n, i = Math.floor(f), t = f - i;
  const th = R.th[i] + (R.th[i + 1] - R.th[i]) * t;
  out.x = R.x[i] + (R.x[i + 1] - R.x[i]) * t - Math.sin(th) * n;
  out.z = R.z[i] + (R.z[i + 1] - R.z[i]) * t + Math.cos(th) * n;
  out.th = th; out.i = i; out.t = t;
  out.h = R.h[i] + (R.h[i + 1] - R.h[i]) * t - (R.bank[i] + (R.bank[i + 1] - R.bank[i]) * t) * n;
  return out;
}

/* ---------- which stretch of road is nearest ---------- */
function lgBuildNear() {
  const R = LG.road, NC = LG.NEAR_N, C = LG.NEAR_CELL, rad = LG.NEAR_R;
  const near = new Int32Array(NC * NC).fill(-1), dist = new Float32Array(NC * NC).fill(1e9);
  const rc = Math.ceil(rad / C);
  for (let i = 0; i < R.n; i++) {
    const cx = Math.floor((R.x[i] + LG.HALF) / C), cz = Math.floor((R.z[i] + LG.HALF) / C);
    for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
      const x = cx + a, z = cz + b;
      if (x < 0 || z < 0 || x >= NC || z >= NC) continue;
      const dx = (x + 0.5) * C - LG.HALF - R.x[i], dz = (z + 0.5) * C - LG.HALF - R.z[i], d = dx * dx + dz * dz;
      if (d < dist[z * NC + x]) { dist[z * NC + x] = d; near[z * NC + x] = i; }
    }
  }
  for (let q = 0; q < NC * NC; q++) if (dist[q] > rad * rad) near[q] = -1;
  LG.near = near;
}
// road coordinates of a point: out.s along, out.n to the right, out.i / out.t the sample and the fraction after it.
// `hint` is the sample found last time for a point that moves continuously. Returns null away from the road.
function lgRoadAt(x, z, out, hint = -1) {
  if (LG.flat) return null;
  const R = LG.road, N = R.n;
  let i0 = hint, span = 6;
  if (i0 >= 0) { const dx = x - R.x[i0], dz = z - R.z[i0]; if (dx * dx + dz * dz > 900) i0 = -1; }
  if (i0 < 0) {
    const cx = Math.floor((x + LG.HALF) / LG.NEAR_CELL), cz = Math.floor((z + LG.HALF) / LG.NEAR_CELL);
    if (cx < 0 || cz < 0 || cx >= LG.NEAR_N || cz >= LG.NEAR_N) return null;
    i0 = LG.near[cz * LG.NEAR_N + cx];
    if (i0 < 0) return null;
    span = 14;
  }
  let best = i0, bd = 1e12;
  for (let j = -span; j <= span; j++) {
    let i = i0 + j; if (i < 0) i += N; else if (i >= N) i -= N;
    const dx = x - R.x[i], dz = z - R.z[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  // the nearer of the two segments that meet at the best sample
  let i = best, t = 0;
  {
    const ax = R.x[best], az = R.z[best], bx = R.x[best + 1] - ax, bz = R.z[best + 1] - az;
    const tf = ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz);
    if (tf >= 0) t = Math.min(1, tf);
    else {
      i = best === 0 ? N - 1 : best - 1;
      const cx = R.x[i], cz = R.z[i], ex = R.x[i + 1] - cx, ez = R.z[i + 1] - cz;
      t = Math.max(0, Math.min(1, ((x - cx) * ex + (z - cz) * ez) / (ex * ex + ez * ez)));
    }
  }
  const sx = R.x[i + 1] - R.x[i], sz = R.z[i + 1] - R.z[i], sl = Math.hypot(sx, sz);
  const px = R.x[i] + sx * t, pz = R.z[i] + sz * t;
  out.i = i; out.t = t; out.s = (i + t) * R.ds;
  out.n = ((x - px) * -sz + (z - pz) * sx) / sl;
  return out;
}
// height of the road's own surface (asphalt, kerb, verge) at a road point; the verge's last metres dive under the land
function lgRibbonY(i, t, n) {
  const R = LG.road, an = Math.abs(n), lim = LG.HW + LG.VERGE;
  let y = R.h[i] + (R.h[i + 1] - R.h[i]) * t - (R.bank[i] + (R.bank[i + 1] - R.bank[i]) * t) * Math.max(-lim, Math.min(lim, n));
  if (an > LG.HW && an < LG.HW + LG.KERB) {
    const A = n > 0 ? R.kerbR : R.kerbL, kw = A[i] + (A[i + 1] - A[i]) * t;
    if (kw > 0) { const p = (an - LG.HW) / LG.KERB; y += kw * 0.05 * (p < 0.45 ? p / 0.45 : (1 - p) / 0.55); }
  }
  const e0 = lim - LG.SKIRT;
  if (an > e0) { const q = Math.min(1, (an - e0) / LG.SKIRT); y -= q * q * (3 - 2 * q); }
  return y;
}

/* ---------- the land ---------- */
// bilinear lookup in a coarse field of `n` samples a side covering the map
function lgField(F, n, x, z) {
  const fx = Math.max(0, Math.min(n - 1.001, (x + LG.HALF) / LG.SIZE * (n - 1))), fz = Math.max(0, Math.min(n - 1.001, (z + LG.HALF) / LG.SIZE * (n - 1)));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, q = j * n + i;
  return (F[q] * (1 - u) + F[q + 1] * u) * (1 - v) + (F[q + n] * (1 - u) + F[q + n + 1] * u) * v;
}
function lgLakeD(x, z) {
  const K = LG_LAKE, w = 0.16 * gnoise(x / 260 + 3.3, z / 260 - 1.7) + 0.06 * gnoise(x / 70, z / 70);
  return Math.hypot((x - K.x) / K.rx, (z - K.z) / K.rz) + w;
}
// the land before the road is cut into it: a guide surface through the road's own elevations, plus relief that
// grows with the distance from the road
function lgNatural(x, z, D, G) {
  const north = -z;
  const ramp = Math.pow(lsmooth(10, 300, D), 1.15);
  // rolling relief, biased upwards so that the road tends to run along the low ground
  let relief = 30 * (fbm(x / 620 + 4.1, z / 620 - 2.3, 4) + 0.42) + 9 * fbm(x / 210 - 7.7, z / 210 + 1.9, 3);
  // the northern range and the western hills
  const mN = lsmooth(250, 1250, north + 190 * gnoise(x / 800 + 9.1, 0.37));
  const mW = lsmooth(-350, -1300, x + 160 * gnoise(0.71, z / 700 - 4.4)) * (1 - mN);
  relief += mN * (40 + 170 * ridged(x / 760 + 1.3, z / 760 + 6.1, 4)) + mW * 38 * (0.5 + ridged(x / 520 - 3.9, z / 520 + 0.8, 3));
  let h = G + relief * ramp;
  // fine undulation everywhere but on the road's own corridor
  h += (1.3 * fbm(x / 58 + 2.2, z / 58 - 9.4, 3) + 0.35 * gnoise(x / 17, z / 17)) * lsmooth(12, 60, D);
  // the rim of the map: peaks nobody drives over
  const r = Math.hypot(x, z), rim = lsmooth(1560, 2040, r + 120 * gnoise(x / 500 + 5.5, z / 500 - 8.8));
  h += rim * rim * (150 + 240 * ridged(x / 640 - 6.6, z / 640 + 2.7, 4));
  // the lake: a basin with a shelving shore
  const ld = lgLakeD(x, z);
  if (ld < 1.5) {
    const bowl = LG.WATER - 9 * lsmooth(1.0, 0.25, ld) + 2.2 * lsmooth(0.9, 1.5, ld);
    h = h + (bowl - h) * lsmooth(1.5, 1.02, ld);
  }
  return h;
}
// 1 along the stadium on the main straight, easing to 0 over 60 m at its ends
const LG_STADIUM = [-330, 610];
function lgStadium(i) {
  const R = LG.road, s = i > R.n / 2 ? i - R.n : i;
  return lsmooth(LG_STADIUM[0] - 60, LG_STADIUM[0], s) * (1 - lsmooth(LG_STADIUM[1], LG_STADIUM[1] + 60, s));
}
function lgBuildLand(onStep) {
  const R = LG.road, N = LG.N, C = LG.CELL, HALF = LG.HALF;
  // coarse fields (16 m): distance to the road, and the guide surface through the road's elevations
  const n16 = 257, D16 = new Float32Array(n16 * n16), G16 = new Float32Array(n16 * n16);
  const step = 12, pts = [];
  for (let i = 0; i < R.n; i += step) pts.push(R.x[i], R.z[i], R.h[i]);
  for (let j = 0; j < n16; j++) for (let i = 0; i < n16; i++) {
    const x = -HALF + i * 16, z = -HALF + j * 16;
    let dmin = 1e12, sw = 0, sh = 0;
    for (let p = 0; p < pts.length; p += 3) {
      const dx = x - pts[p], dz = z - pts[p + 1], d2 = dx * dx + dz * dz;
      if (d2 < dmin) dmin = d2;
      const w = 1 / ((d2 + 2500) * (d2 + 2500));
      sw += w; sh += w * pts[p + 2];
    }
    D16[j * n16 + i] = Math.sqrt(dmin); G16[j * n16 + i] = sh / sw;
  }
  LG.D16 = D16;
  if (onStep) onStep();
  const H = new Float32Array(N * N), o = {};
  const FLAT = LG.HW + LG.VERGE - LG.SKIRT - 0.5, lim = LG.HW + LG.VERGE;
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * C;
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * C;
      const D = lgField(D16, n16, x, z);
      let h = lgNatural(x, z, D, lgField(G16, n16, x, z));
      // the road's corridor: the land lies just under the road's mesh, then cuts or fills back to the natural ground
      if (D < LG.NEAR_R - 12 && lgRoadAt(x, z, o)) {
        const an = Math.abs(o.n);
        const T = R.h[o.i] + (R.h[o.i + 1] - R.h[o.i]) * o.t - (R.bank[o.i] + (R.bank[o.i + 1] - R.bank[o.i]) * o.t) * Math.max(-lim, Math.min(lim, o.n)) - LG.TRENCH;
        const blend = Math.max(14, Math.min(60, 12 + 2.2 * Math.abs(h - T)));
        // (level ground for the stadium's buildings beside the main straight)
        const flat = FLAT + 26 * lgStadium(o.i);
        const w = an <= flat ? 1 : 1 - lsmooth(0, 1, (an - flat) / blend);
        h += (T - h) * w;
      }
      H[j * N + i] = h;
    }
  }
  LG.H = H;
}
// land height: the two triangles of each cell, as the terrain mesh draws them
function lgLandH(x, z) {
  const N = LG.N, fx = Math.max(0, Math.min(N - 1.001, (x + LG.HALF) / LG.CELL)), fz = Math.max(0, Math.min(N - 1.001, (z + LG.HALF) / LG.CELL));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, q = j * N + i, H = LG.H;
  if (u + v <= 1) return H[q] + (H[q + 1] - H[q]) * u + (H[q + N] - H[q]) * v;
  return H[q + N + 1] + (H[q + N] - H[q + N + 1]) * (1 - u) + (H[q + 1] - H[q + N + 1]) * (1 - v);
}

/* ---------- ground under a wheel ---------- */
// surfaces: 0 asphalt, 1 kerb, 2 verge, 3 grass, 4 dirt, 5 sand, 6 water, 7 rock
const LG_SURF = [
  { name: 'asphalt', mu: 1, drag: 0, rough: 0 }, { name: 'kerb', mu: 0.94, drag: 0, rough: 0 }, { name: 'verge', mu: 0.62, drag: 0.035, rough: 0.012 },
  { name: 'grass', mu: 0.56, drag: 0.06, rough: 0.03 }, { name: 'dirt', mu: 0.68, drag: 0.04, rough: 0.022 }, { name: 'sand', mu: 0.5, drag: 0.16, rough: 0.02 },
  { name: 'water', mu: 0.4, drag: 0.5, rough: 0 }, { name: 'rock', mu: 0.7, drag: 0.03, rough: 0.04 },
];
const _lgR = {};
// out.h height, out.surf surface, out.s / out.n road coordinates when out.road (hint: out.i of the last call for the same wheel)
function lgGround(x, z, out, hint = -1) {
  // (a flat test ground of one surface, for tools/sim.js)
  if (LG.flat) { out.h = 50; out.surf = LG.flat - 1; out.road = false; out.i = -1; out.kerb = 0; return out; }
  let h = lgLandH(x, z), surf = 3;
  out.road = false; out.i = -1; out.kerb = 0;
  const r = lgRoadAt(x, z, _lgR, hint);
  if (r) {
    const an = Math.abs(r.n);
    out.i = r.i; out.s = r.s; out.n = r.n;
    if (an < LG.HW + LG.VERGE) {
      const y = lgRibbonY(r.i, r.t, r.n);
      if (y >= h - 0.02) {
        h = y; out.road = true;
        if (an <= LG.HW) surf = 0;
        else if (an < LG.HW + LG.KERB) {
          const A = r.n > 0 ? LG.road.kerbR : LG.road.kerbL, kw = A[r.i] + (A[r.i + 1] - A[r.i]) * r.t;
          if (kw > 0.5) { surf = 1; out.kerb = 1; h += 0.008 * Math.abs(((r.s / 0.5) % 2) - 1); } else surf = 2;
        } else surf = 2;
      }
    }
  }
  if (surf === 3) {
    if (h < LG.WATER - 0.05) surf = 6;
    else if (h < LG.WATER + 0.7 && lgLakeD(x, z) < 1.25) surf = 5;
    else if (LG.biome) {
      const B = LG.biome, bn = 1024, bx = Math.max(0, Math.min(bn - 1, Math.floor((x + LG.HALF) / LG.SIZE * bn))), bz = Math.max(0, Math.min(bn - 1, Math.floor((z + LG.HALF) / LG.SIZE * bn)));
      const q = (bz * bn + bx) * 4;
      if (B[q] > 120) surf = 4; else if (B[q + 2] > 150) surf = 7;
    }
  }
  out.h = h; out.surf = surf;
  return out;
}

/* ---------- barriers ---------- */
// per metre of road and per side: 0 nothing, 1 steel guardrail, 2 concrete wall with a catch fence
const LG_WALL_N = [0, LG.HW + 2.7, LG.HW + 4.4];
function lgBuildWalls() {
  const R = LG.road, N = R.n, W = R.W;
  const mark = (A, i0, i1, v) => { for (let i = i0; i <= i1; i++) if (A[W(i)] < v) A[W(i)] = v; };
  // the main straight runs through the stadium: walls on both sides
  mark(R.wallL, LG_STADIUM[0], LG_STADIUM[1], 2); mark(R.wallR, LG_STADIUM[0], LG_STADIUM[1], 2);
  // guardrails round the outside of every bend, where the ground falls away beside the road, and along the lake
  for (const c of R.corners) if (c.peak > 1 / 420) mark(c.sgn > 0 ? R.wallL : R.wallR, c.i0 - 26, c.i1 + 26, 1);
  const p = {};
  for (let i = 0; i < N; i += 2) for (const side of [-1, 1]) {
    lgRoadPose(i * R.ds, side * 30, p);
    const drop = p.h - lgLandH(p.x, p.z), lake = lgLakeD(p.x, p.z) < 1.12;
    if (drop > 3.2 || lake) mark(side > 0 ? R.wallR : R.wallL, i - 3, i + 4, 1);
  }
  // close short gaps, drop short stubs, then list the runs
  LG.walls = [];
  for (const [A, side] of [[R.wallL, -1], [R.wallR, 1]]) {
    for (const kind of [1, 2]) {
      let gap = 0;
      for (let i = 0; i < 2 * N; i++) { const q = W(i); if (A[q] >= kind) { if (gap > 0 && gap < 24) for (let b = 1; b <= gap; b++) if (A[W(i - b)] < kind) A[W(i - b)] = kind; gap = 0; } else gap++; }
    }
    A[N] = A[0];
    // start scanning at a gap so that no run is split at the lap's seam
    let start = 0;
    while (start < N && A[start] !== 0) start++;
    if (start === N) { LG.walls.push({ side, kind: A[0], i0: 0, i1: N }); continue; }
    let i = start;
    while (i < start + N) {
      const v = A[W(i)];
      if (!v) { i++; continue; }
      const i0 = i;
      while (i < start + N && A[W(i)] === v) i++;
      if (i - i0 < 18 && v === 1) { for (let b = i0; b < i; b++) A[W(b)] = 0; continue; }
      LG.walls.push({ side, kind: v, i0, i1: i });
    }
    A[N] = A[0];
  }
}

/* ---------- ground cover and what grows on it ---------- */
// biome map, 1024 a side: R bare earth (tracks), G woodland, B rock, A shore sand
function lgBuildBiome() {
  const n = 1024, B = new Uint8Array(n * n * 4), N = LG.N, H = LG.H;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -LG.HALF + (i + 0.5) * LG.SIZE / n, z = -LG.HALF + (j + 0.5) * LG.SIZE / n, q = (j * n + i) * 4;
    const gi = Math.min(N - 2, Math.floor((x + LG.HALF) / LG.CELL)), gj = Math.min(N - 2, Math.floor((z + LG.HALF) / LG.CELL)), g = gj * N + gi;
    const h = H[g], sx = (H[g + 1] - h) / LG.CELL, sz = (H[g + N] - h) / LG.CELL, slope = Math.hypot(sx, sz);
    const D = lgField(LG.D16, 257, x, z);
    const wood = lgWood(x, z, h, slope, D);
    const rock = lsmooth(0.62, 0.95, slope + 0.12 * gnoise(x / 40, z / 40)) + lsmooth(230, 300, h + 30 * gnoise(x / 150, z / 150));
    const ld = lgLakeD(x, z), sand = h < LG.WATER + 1.4 ? lsmooth(1.3, 1.05, ld) * lsmooth(LG.WATER + 1.4, LG.WATER + 0.3, h) : 0;
    // worn earth: patches in the woods and on the open hillsides
    const bare = lsmooth(0.5, 0.7, fbm(x / 95 + 31, z / 95 - 17, 3) * 0.5 + 0.5) * lsmooth(20, 70, D) * (1 - sand);
    B[q] = Math.round(255 * Math.min(1, bare * 0.75)); B[q + 1] = Math.round(255 * wood); B[q + 2] = Math.round(255 * Math.min(1, rock)); B[q + 3] = Math.round(255 * sand);
  }
  LG.biome = B;
}
// woodland density 0..1
function lgWood(x, z, h, slope, D) {
  if (h < LG.WATER + 0.9 || h > 235 || slope > 0.75) return 0;
  const north = -z;
  let w = fbm(x / 430 + 17.2, z / 430 + 3.4, 3) * 1.25 + 0.05;
  w += 0.42 * lsmooth(-250, -1100, x) + 0.3 * lsmooth(350, 1000, north) - 0.5 * lsmooth(-500, -1000, north) * lsmooth(-900, -500, x);
  w = lsmooth(0.02, 0.3, w);
  // clear of the road, thinner towards the tree line
  return w * lsmooth(LG.HW + 9, LG.HW + 30, D) * (1 - lsmooth(170, 235, h));
}
// (nothing grows where the stadium stands)
function lgInStadium(x, z) {
  const o = {};
  return lgRoadAt(x, z, o) && Math.abs(o.n) < 44 && lgStadium(o.i) > 0.01;
}
// buildings out in the country: a village by the lake road (houses round a church) and barns among the fields.
// Each: x, z, turn, width, depth, height to the eaves, kind (0 house, 1 church, 2 barn), the ground under it
const LG_VILLAGE = { x: 610, z: 260, r: 105 };
function lgBuildHouses() {
  const rnd = lgRand(2718), H = [], V = LG_VILLAGE;
  const ground = (x, z, w, d, th) => { let lo = 1e9, hi = -1e9; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) { const px = x + a * w / 2 * Math.cos(th) - b * d / 2 * Math.sin(th), pz = z + a * w / 2 * Math.sin(th) + b * d / 2 * Math.cos(th), g = lgLandH(px, pz); lo = Math.min(lo, g); hi = Math.max(hi, g); } return [lo, hi]; };
  const free = (x, z, r) => H.every((h) => Math.hypot(h.x - x, h.z - z) > r + Math.max(h.w, h.d) * 0.75);
  const add = (x, z, th, w, d, e, kind) => { const [lo, hi] = ground(x, z, w, d, th); if (hi - lo > 2.2 || lo < LG.WATER + 1) return false; H.push({ x, z, th, w, d, e, kind, y: lo, top: hi }); return true; };
  // the church stands in the middle, the houses along two lanes that cross there
  add(V.x, V.z, 0.35, 9, 22, 9, 1);
  for (let q = 0; q < 400 && H.length < 19; q++) {
    const lane = rnd() < 0.5 ? 0.35 : 0.35 + Math.PI / 2, t = (rnd() - 0.5) * 2 * V.r, side = (rnd() < 0.5 ? -1 : 1) * (9 + 5 * rnd());
    const x = V.x + Math.cos(lane) * t - Math.sin(lane) * side, z = V.z + Math.sin(lane) * t + Math.cos(lane) * side;
    if (Math.hypot(x - V.x, z - V.z) < 20 || !free(x, z, 9)) continue;
    add(x, z, lane + (rnd() - 0.5) * 0.2 + (rnd() < 0.3 ? Math.PI / 2 : 0), 8 + 5 * rnd(), 6.5 + 2.5 * rnd(), 3.2 + 2.4 * rnd(), 0);
  }
  // barns on the level low ground away from the road
  for (let q = 0; q < 3000 && H.length < 27; q++) {
    const x = (rnd() - 0.5) * 2600, z = (rnd() - 0.5) * 2600, D = lgField(LG.D16, 257, x, z), h = lgLandH(x, z);
    if (D < 70 || h > 50 || h < LG.WATER + 2 || Math.hypot(x - V.x, z - V.z) < V.r + 120 || !free(x, z, 160) || lgInStadium(x, z)) continue;
    add(x, z, rnd() * 3.14, 20, 10, 4.6, 2);
  }
  LG.houses = H;
}
const lgNearHouse = (x, z, pad) => { if (Math.hypot(x - LG_VILLAGE.x, z - LG_VILLAGE.z) < LG_VILLAGE.r + pad) return true; for (const h of LG.houses) if (Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.75 + pad) return true; return false; };
// trees: x, z, ground height, size, kind (0 conifer, 1 broadleaf, 2 poplar), turn, shade of green
function lgBuildTrees() {
  const rnd = lgRand(4711), T = { n: 0, x: [], z: [], y: [], s: [], kind: [], rot: [], tint: [] }, N = LG.N, H = LG.H;
  const add = (x, z, kind, s) => {
    const y = lgLandH(x, z);
    T.x.push(x); T.z.push(z); T.y.push(y - 0.15); T.s.push(s); T.kind.push(kind); T.rot.push(rnd() * 6.283); T.tint.push(rnd()); T.n++;
  };
  const CELL = 11, n = Math.floor((LG.SIZE - 240) / CELL);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -LG.HALF + 120 + (i + rnd()) * CELL, z = -LG.HALF + 120 + (j + rnd()) * CELL, u = rnd(), v = rnd();
    const gi = Math.floor((x + LG.HALF) / LG.CELL), gj = Math.floor((z + LG.HALF) / LG.CELL), g = gj * N + gi;
    const h = H[g], slope = Math.hypot(H[g + 1] - h, H[g + N] - h) / LG.CELL;
    const D = lgField(LG.D16, 257, x, z);
    const w = lgWood(x, z, h, slope, D);
    // a few lone trees stand in the open country
    const lone = D > LG.HW + 16 && h > LG.WATER + 1.5 && h < 150 && slope < 0.45 ? 0.012 : 0;
    if (u > w * 0.8 + lone || lgInStadium(x, z)) continue;
    // the village keeps a few trees between its houses, none through their walls
    if (lgNearHouse(x, z, 4) && (v > 0.25 || LG.houses.some((b) => Math.hypot(b.x - x, b.z - z) < Math.max(b.w, b.d) * 0.75 + 3))) continue;
    const high = lsmooth(60, 130, h + 25 * gnoise(x / 200, z / 200));
    add(x, z, v < 0.12 + 0.82 * high ? 0 : 1, 0.75 + 0.6 * rnd());
  }
  // an avenue of poplars along the back of the main straight's run-off and beside the lake road
  const R = LG.road, p = {};
  for (const [s0, s1, side, off] of [[700, 1010, -1, 16], [1700, 2250, 1, 15.5], [1700, 2250, -1, 15.5]]) for (let s = s0; s < s1; s += 13) {
    lgRoadPose(s, side * off, p);
    if (lgLandH(p.x, p.z) > LG.WATER + 0.8) add(p.x, p.z, 2, 0.9 + 0.3 * rnd());
  }
  for (const k of ['x', 'z', 'y', 's', 'rot', 'tint']) T[k] = Float32Array.from(T[k]);
  T.kind = Uint8Array.from(T.kind);
  LG.trees = T;
  // rocks on the steep and high ground
  const K = { n: 0, x: [], z: [], y: [], s: [], rot: [] };
  for (let q = 0; q < 5200; q++) {
    const x = (rnd() - 0.5) * (LG.SIZE - 300), z = (rnd() - 0.5) * (LG.SIZE - 300);
    const gi = Math.floor((x + LG.HALF) / LG.CELL), gj = Math.floor((z + LG.HALF) / LG.CELL), g = gj * N + gi;
    const h = H[g], slope = Math.hypot(H[g + 1] - h, H[g + N] - h) / LG.CELL, D = lgField(LG.D16, 257, x, z);
    if (D < LG.HW + 14 || h < LG.WATER + 0.3) continue;
    if (rnd() > lsmooth(0.3, 0.7, slope) + lsmooth(120, 260, h) * 0.5 + 0.03) continue;
    K.x.push(x); K.z.push(z); K.y.push(lgLandH(x, z)); K.s.push(0.5 + 2.2 * rnd() * rnd()); K.rot.push(rnd() * 6.283); K.n++;
  }
  for (const k of ['x', 'z', 'y', 's', 'rot']) K[k] = Float32Array.from(K[k]);
  LG.rocks = K;
}
// things a car can hit, in 16 m cells: [x, z, radius] per obstacle
function lgBuildObstacles(extra = []) {
  const T = LG.trees, K = LG.rocks, list = [];
  for (let i = 0; i < T.n; i++) list.push(T.x[i], T.z[i], (T.kind[i] === 0 ? 0.3 : 0.38) * T.s[i]);
  for (let i = 0; i < K.n; i++) if (K.s[i] > 0.75) list.push(K.x[i], K.z[i], K.s[i] * 0.62);
  for (const e of extra) list.push(e[0], e[1], e[2]);
  for (const b of LG.houses) { const long = Math.max(b.w, b.d), short = Math.min(b.w, b.d), a = b.w >= b.d ? b.th : b.th + Math.PI / 2, n = Math.max(1, Math.round(long / short)); for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short); list.push(b.x + Math.cos(a) * t, b.z + Math.sin(a) * t, short * 0.56); } }
  const C = 16, n = LG.SIZE / C, cnt = new Uint32Array(n * n + 1), m = list.length / 3;
  const cell = (q) => Math.max(0, Math.min(n - 1, Math.floor((list[q * 3 + 1] + LG.HALF) / C))) * n + Math.max(0, Math.min(n - 1, Math.floor((list[q * 3] + LG.HALF) / C)));
  for (let q = 0; q < m; q++) cnt[cell(q) + 1]++;
  for (let c = 0; c < n * n; c++) cnt[c + 1] += cnt[c];
  const idx = new Uint32Array(m), fill = cnt.slice(0, n * n);
  for (let q = 0; q < m; q++) idx[fill[cell(q)]++] = q;
  LG.obst = { list: Float32Array.from(list), start: cnt, idx, n, C };
}

/* ---------- assembly ---------- */
// the steps of building the map, so that a page can spread them over several frames
function lgSteps() {
  return [
    () => { lgBuildRoad(); lgBuildNear(); },
    () => lgBuildLand(),
    () => lgBuildWalls(),
    () => lgBuildBiome(),
    () => { lgBuildHouses(); lgBuildTrees(); lgBuildObstacles(); LG.ready = true; },
  ];
}
