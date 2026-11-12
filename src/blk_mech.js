/* =========================================================================
   MECHANICALS — what is under the skin: the powertrain each model's spec
   describes (a V engine with its heads, intake, manifolds, gearbox, shafts,
   exhaust and radiators; or motors, reduction gears, inverters and the
   battery under the floor) and the suspension (wishbones, coil-over dampers,
   steering rack, anti-roll bars).
   None of it can be seen while the car is whole, so it is only drawn while
   the parts store is open; there every part of it has its place like any
   other. Everything is built from the model's hard points (axles, engine
   position, exhaust tips) and kept inside the bodywork, which was drawn
   first: tools/explode.js measures that with skinTop.
   ========================================================================= */
// the height of the skin over a point of the plan (the cabin floor inside the cabin), -1 outside the body's outline
function skinTop(X, zq) {
  const S = BODY.sections;
  if (!S || X < S[0].X || X > S[S.length - 1].X) return -1;
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].X > X) hi = mid; else lo = mid; }
  const over = (L) => {
    let best = -1;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1];
      if ((a[0] - zq) * (b[0] - zq) <= 0 && a[0] !== b[0]) best = Math.max(best, a[1] + (b[1] - a[1]) * (zq - a[0]) / (b[0] - a[0]));
    }
    return best;
  };
  const t0 = over(S[lo].s.lipSkin), t1 = over(S[hi].s.lipSkin);
  return t0 < 0 || t1 < 0 ? -1 : lerp(t0, t1, (X - S[lo].X) / Math.max(1e-6, S[hi].X - S[lo].X));
}

function mechMaterials() {
  if (M.cast) return;
  const grain = grainNormal();
  const fins = canvasTex(64, 8, (ctx, w, h) => { ctx.fillStyle = '#2a2c30'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#8d9096'; for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1.4, h); }, { repeat: true });
  fins.repeat.set(26, 1);
  const two = { side: THREE.DoubleSide };
  // sand-cast aluminium, dark magnesium, turned steel, wrinkle paint on the cam covers, high-voltage orange, radiator core
  M.cast = new THREE.MeshStandardMaterial({ color: 0x9a9da3, metalness: 0.9, roughness: 0.52, normalMap: grain, normalScale: new THREE.Vector2(0.7, 0.7), ...two });
  M.mag = new THREE.MeshStandardMaterial({ color: 0x3b3d42, metalness: 0.75, roughness: 0.5, normalMap: grain, normalScale: new THREE.Vector2(0.35, 0.35), ...two });
  M.steel = new THREE.MeshStandardMaterial({ color: 0xc8cbcf, metalness: 1, roughness: 0.2, ...two });
  M.crackle = new THREE.MeshStandardMaterial({ color: 0x8e0c14, metalness: 0.1, roughness: 0.7, normalMap: grain, normalScale: new THREE.Vector2(1.2, 1.2), ...two });
  M.hv = new THREE.MeshStandardMaterial({ color: 0xff6a00, metalness: 0, roughness: 0.55, ...two });
  M.core = new THREE.MeshStandardMaterial({ map: fins, metalness: 0.7, roughness: 0.55, ...two });
  M.bore = new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.8, roughness: 0.38, ...two });
  M.pipe = M.ti.clone(); M.pipe.side = THREE.DoubleSide;
  M.arm = M.carbon.clone(); M.arm.side = THREE.DoubleSide;
  M.spring = M.caliper.clone(); M.spring.side = THREE.DoubleSide;
}

/* ---------- shapes ---------- */
const _mq = new THREE.Quaternion(), _mUp = new V3(0, 1, 0);
const mv = (p) => (p.isVector3 ? p : new V3(p[0], p[1], p[2]));
// a round bar from a to b (r2: its radius at b)
function bar(a, b, r, r2 = r, seg = 14) {
  const A = mv(a), d = mv(b).clone().sub(A), g = new THREE.CylinderGeometry(r2, r, d.length(), seg);
  g.applyQuaternion(_mq.setFromUnitVectors(_mUp, d.clone().normalize()));
  return g.translate(A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
}
// a pipe through points
const pipe = (pts, r, seg = 28, round = 10, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(mv), closed, 'centripetal'), seg, r, round, closed);
const block = (w, h, d, x, y, z, r = 0) => (r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
// turned about the x axis, or about z: profile [radius, along]
const turnX = (prof, seg = 32) => new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), seg).rotateZ(-Math.PI / 2);
const turnZ = (prof, seg = 32) => new THREE.LatheGeometry(prof.map(([r, a]) => new THREE.Vector2(r, a)), seg).rotateX(Math.PI / 2);
const ball = (r, x, y, z) => new THREE.SphereGeometry(r, 16, 12).translate(x, y, z);
// a disc and a flat ring, facing up
const disc = (r, x, y, z, seg = 24) => new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2).translate(x, y, z);
const ring = (r0, r1, x, y, z, seg = 24) => new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2).translate(x, y, z);
// a coil spring from a to b
function coil(a, b, r, wire, turns) {
  const A = mv(a), d = mv(b).clone().sub(A), len = d.length(), q = new THREE.Quaternion().setFromUnitVectors(_mUp, d.clone().normalize()), pts = [];
  for (let i = 0; i <= turns * 12; i++) { const t = i / (turns * 12), th = t * turns * Math.PI * 2; pts.push(new V3(r * Math.cos(th), t * len, r * Math.sin(th)).applyQuaternion(q).add(A)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 14, wire, 7, false);
}

/* ---------- the build ---------- */
function buildMech() {
  mechMaterials();
  const root = new THREE.Group(), parts = {}, open = {};
  // a part by its name in the parts store: one mesh per material
  const P = (key) => {
    if (!open[key]) { parts[key] = new THREE.Group(); root.add(parts[key]); open[key] = cockpitBatch(); }
    return open[key];
  };
  const K = SPEC.mech;
  if (K.engine) mechEngine(P, K.engine, K.gearbox);
  if (K.ev) mechElectric(P, K.ev);
  mechRadiators(P, K.radiator);
  mechSuspension(P, K.susp, !!K.ev);
  for (const key of Object.keys(open)) open[key].build(parts[key]);
  // (under the skin: not drawn until the parts store is opened)
  root.visible = false;
  car.add(root);
  BODY.mech = root; BODY.mechParts = parts;
}
const sideKey = (s) => (s > 0 ? '+' : '-');

/* ---------- engine, gearbox, shafts, exhaust ---------- */
function mechEngine(P, E, G) {
  const rear = AX[1], n = E.n / 2, L = n * E.step + 0.06, half = RAD(E.v / 2), sn = Math.sin(half), cs = Math.cos(half), xe = E.x0 - L;
  // the engine's frame: the front face of the block on the crank's axis; cylinders are counted from the front
  const T = new THREE.Matrix4().makeTranslation(E.x0, E.yc, 0);
  const at = (x, y, z) => new V3(x, y, z).applyMatrix4(T);
  const cyl = (i) => -0.03 - E.step * (i + 0.5);
  M.crackle.color.set(E.cover);
  // block: crankcase, sump, the two banks; the belt drive on its front face, the flywheel housing behind
  const B = P('engine');
  B.add(M.cast, block(L, 0.15, 0.27, -L / 2, -0.005, 0, 0.03), T);
  B.add(M.mag, block(L - 0.04, 0.07, 0.19, -L / 2, -0.105, 0, 0.02), T);
  B.add(M.mag, block(0.02, 0.2, 0.26, 0.004, 0.03, 0, 0.008), T);
  B.add(M.steel, bar(at(0.014, 0, 0), at(0.044, 0, 0), 0.066), null);
  for (const [y, z, r] of [[-0.05, 0.2, 0.032], [-0.05, -0.2, 0.036], [0.17, 0, 0.026]]) {
    B.add(M.steel, bar(at(0.014, y, z), at(0.04, y, z), r), null);
    if (z) B.add(z > 0 ? M.cast : M.mag, bar(at(0.012, y, z), at(-0.1, y, z), 0.052), null);
  }
  B.add(M.rubber, pipe([[0.03, 0.068, 0], [0.03, 0.02, 0.13], [0.03, -0.05, 0.234], [0.03, -0.086, 0.2], [0.03, -0.07, 0], [0.03, -0.088, -0.2], [0.03, -0.05, -0.238], [0.03, 0.03, -0.12], [0.03, 0.17, -0.027], [0.03, 0.196, 0], [0.03, 0.17, 0.027]].map((p) => at(...p)), 0.005, 80, 6, true), null);
  B.add(M.steel, bar(at(-L * 0.6, -0.04, 0.16), at(-L * 0.6, -0.04, 0.235), 0.034), null);            // oil filter
  B.add(M.mag, turnX([[0.132, 0], [0.14, 0.012], [0.14, 0.03], [0.1, 0.03]]).translate(-L - 0.03, 0, 0), T);
  B.add(M.steel, bar(at(-L - 0.004, 0, 0), at(-L - 0.022, 0, 0), 0.118, 0.118, 40), null);
  B.add(M.bore, bar(at(-L - 0.022, 0, 0), at(-L - 0.027, 0, 0), 0.07, 0.07, 24), null);
  // webs of the main bearings down the crankcase, fins under the sump, the mounts, the starter by the flywheel
  for (let i = 0; i <= n; i++) for (const s of [-1, 1]) B.add(M.cast, block(0.014, 0.12, 0.014, -0.03 - E.step * i, -0.01, s * 0.134, 0.004), T);
  for (let k = -2; k <= 2; k++) B.add(M.mag, block(L - 0.1, 0.01, 0.007, -L / 2, -0.142, k * 0.032), T);
  for (const s of [-1, 1]) {
    B.add(M.mag, block(0.08, 0.035, 0.07, -L * 0.3, -0.03, s * 0.165, 0.008), T);
    B.add(M.rubber, bar(at(-L * 0.3, -0.05, s * 0.18), at(-L * 0.3, -0.075, s * 0.18), 0.028), null);
  }
  B.add(M.mag, bar(at(-L + 0.01, -0.035, -0.175), at(-L + 0.13, -0.035, -0.175), 0.034), null);
  B.add(M.steel, bar(at(-L + 0.03, 0.005, -0.185), at(-L + 0.1, 0.005, -0.185), 0.017), null);
  const tips = SPEC.parts.exhaust, mid = G.x0 === undefined;
  // where a primary has left its port (engine frame), and the collector the primaries of a bank run back to
  const oy = 0.285 * cs - 0.135 * sn, oz = 0.285 * sn + 0.135 * cs;
  const dx = rear.x - (G.back || 0), yd = rear.yc - 0.02;       // the differential
  for (const s of [-1, 1]) {
    const R = T.clone().multiply(new THREE.Matrix4().makeRotationX(s * half)), bank = (x, y, z) => new V3(x, y, z).applyMatrix4(R);
    B.add(M.cast, block(L - 0.02, 0.19, 0.125, -L / 2, 0.165, 0, 0.012), R);
    // the bores, seen with the head off; under the head its chambers, in its faces the ports
    const rb = Math.min(0.047, E.step * 0.43);
    for (let i = 0; i < n; i++) { B.add(M.steel, ring(rb, rb + 0.004, cyl(i), 0.2605, 0), R); B.add(M.bore, disc(rb, cyl(i), 0.2603, 0), R); }
    // head with its cam cover, coils and fuel rail
    const H = P('head' + sideKey(s));
    H.add(M.cast, block(L, 0.075, 0.15, -L / 2, 0.295, 0, 0.012), R);
    H.add(M.crackle, block(L - 0.012, 0.05, 0.132, -L / 2, 0.356, 0, 0.02), R);
    H.add(M.steel, bar(bank(-0.03, 0.34, -s * 0.082), bank(-L + 0.03, 0.34, -s * 0.082), 0.007), null);
    for (const z of [-0.036, 0.036]) H.add(M.cast, bar(bank(-0.002, 0.305, z), bank(0.02, 0.305, z), 0.03), null);
    H.add(M.bore, bar(bank(-0.027, 0.381, 0), bank(-0.027, 0.39, 0), 0.014), null);
    for (let i = 1; i < n; i++) H.add(M.crackle, block(0.006, 0.008, 0.124, -0.03 - E.step * i, 0.381, 0, 0.002), R);
    for (let i = 0; i < n; i++) {
      const x = cyl(i);
      H.add(M.mag, bar(bank(x, 0.376, 0), bank(x, 0.408, 0), 0.017, 0.014), null);
      H.add(M.hv, block(0.02, 0.006, 0.014, x, 0.411, 0), R);
      H.add(M.steel, bar(bank(x, 0.335, -s * 0.082), bank(x, 0.3, -s * 0.07), 0.006), null);
      H.add(M.bore, disc(rb, x, 0.2572, 0), R);
      for (const e of [-1, 1]) H.add(M.bore, new THREE.CircleGeometry(0.016, 16).translate(x, 0.292, e * 0.0755), R);
    }
    // manifold: a primary from every port, back along the block to a collector behind it
    const X = P('manifold' + sideKey(s)), zc = s * (oz + 0.04), col = at(-L - 0.13, 0.19, zc);
    X.add(M.mag, block(L - 0.03, 0.05, 0.008, -L / 2, 0.292, s * 0.08), R);
    for (let i = 0; i < n; i++) {
      const x = cyl(i), fan = (i - (n - 1) / 2) * 0.012, wob = s * 0.014 * (i % 2 ? 1 : -1);
      X.add(M.pipe, pipe([bank(x, 0.292, s * 0.082), bank(x - 0.012, 0.285, s * 0.135), at(lerp(x, -L, 0.5) - 0.02, lerp(oy, 0.19, 0.7) + fan, zc - s * 0.005 + wob), at(-L, 0.19 + fan * 0.7, zc + wob * 0.6), at(-L - 0.035, 0.19 + fan * 0.3, zc)], 0.0155, 26, 8), null);
    }
    X.add(M.pipe, turnX([[0.04, 0], [0.046, -0.05], [0.034, -0.1]], 20).translate(-L - 0.03, 0.19, zc), T);
    // the pipe on from the collector: up over the gearbox to a silencer and the tail pipes, or down under the cabin
    // and the rear axle to a silencer in the tail
    const Q = P('pipe' + sideKey(s));
    const mine = tips.z.filter((z) => z * s > 0).sort((a, b) => Math.abs(a) - Math.abs(b));
    const can = (x0, x1, y, z, r) => Q.add(M.pipe, new THREE.CapsuleGeometry(r, x0 - x1 - 2 * r, 6, 20).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z), null);
    if (mid) {
      const zs = s * Math.max(0.1, Math.abs(mine[0]) * 0.8), ys = yd + 0.235, x1 = XR + 0.3, x0 = x1 + 0.34;
      Q.add(M.pipe, pipe([col.clone().setX(col.x + 0.006), [col.x - 0.05, col.y + 0.02, col.z - s * 0.01], [lerp(col.x, x0, 0.6), ys - 0.03, lerp(col.z, zs, 0.6)], [x0 + 0.03, ys, zs], [x0 - 0.02, ys, zs]], 0.03, 30, 10), null);
      can(x0, x1, ys, zs, 0.066);
      for (const z of mine) Q.add(M.pipe, pipe([[x1 + 0.03, ys, zs], [x1 - 0.07, lerp(ys, tips.y, 0.45), lerp(zs, z, 0.5)], [XR + 0.11, tips.y, z], [XR + 0.03, tips.y, z]], 0.034 * tips.r, 20, 10), null);
    } else {
      const zu = s * 0.36, zs = (mine[0] + mine[mine.length - 1]) / 2, x1 = XR + 0.16, x0 = x1 + 0.34;
      Q.add(M.pipe, pipe([col.clone().setX(col.x + 0.006), [col.x - 0.07, col.y - 0.05, lerp(col.z, zu, 0.4)], [col.x - 0.19, 0.24, zu], [col.x - 0.32, 0.19, zu], [0.2, 0.19, zu], [-0.6, 0.19, zu], [rear.x + 0.1, 0.185, zu], [rear.x - 0.19, 0.195, zu], [x0 + 0.1, tips.y - 0.06, lerp(zu, zs, 0.7)], [x0 + 0.02, tips.y, zs], [x0 - 0.02, tips.y, zs]], 0.03, 90, 10), null);
      can(x0, x1, tips.y, zs, 0.062);
      for (const z of mine) Q.add(M.pipe, pipe([[x1 + 0.03, tips.y, zs], [XR + 0.1, tips.y, z], [XR + 0.03, tips.y, z]], 0.036 * tips.r, 14, 10), null);
    }
    // half shaft
    mechShaft(P('shaft' + sideKey(s)), [dx, yd, s * 0.185], rear, s);
  }
  // intake: twin plenums with a runner to every cylinder, a row of trumpets on a tray, or a supercharger in the V
  const I = P('intake'), yv = 0.3 * cs + 0.12, zr = 0.3 * sn - 0.075 * cs;
  if (E.intake === 'plenum') {
    for (const s of [-1, 1]) {
      I.add(M.carbon, new THREE.CapsuleGeometry(0.05, L - 0.16, 8, 20).rotateZ(Math.PI / 2).translate(-L / 2, yv + 0.09, s * 0.062), T);
      I.add(M.cast, bar(at(-0.03, yv + 0.09, s * 0.062), at(0.012, yv + 0.09, s * 0.062), 0.04), null);
      // out to an air filter beside the head
      I.add(M.rubber, pipe([at(0.008, yv + 0.09, s * 0.062), at(0.034, yv + 0.088, s * 0.12), at(0.012, yv + 0.06, s * 0.22), at(-0.06, yv + 0.035, s * 0.3)], 0.038, 22, 12), null);
      I.add(M.mag, bar(at(-0.055, yv + 0.037, s * 0.298), at(-0.2, yv + 0.025, s * 0.335), 0.047, 0.06, 24), null);
      I.add(M.steel, bar(at(-0.2, yv + 0.025, s * 0.335), at(-0.212, yv + 0.024, s * 0.338), 0.062, 0.062, 24), null);
      for (let i = 0; i < n; i++) I.add(M.cast, bar(at(cyl(i), yv + 0.06, s * 0.085), at(cyl(i), yv - 0.05, s * zr), 0.019, 0.017), null);
    }
  } else if (E.intake === 'trumpets') {
    I.add(M.carbon, block(L - 0.02, 0.01, 2 * zr + 0.1, -L / 2, yv - 0.045, 0, 0.004), T);
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      I.add(M.steel, new THREE.LatheGeometry([[0.021, 0], [0.021, 0.07], [0.026, 0.1], [0.038, 0.118], [0.042, 0.12]].map(([r, y]) => new THREE.Vector2(r, y)), 20).translate(cyl(i), yv - 0.04, s * zr), T);
      I.add(M.cast, bar(at(cyl(i), yv - 0.04, s * zr), at(cyl(i), yv - 0.09, s * zr), 0.024), null);
    }
  } else {
    I.add(M.cast, block(L * 0.78, 0.13, 0.2, -L * 0.52, yv + 0.03, 0, 0.03), T);
    for (let k = -3; k <= 3; k++) I.add(M.mag, block(L * 0.7, 0.012, 0.01, -L * 0.52, yv + 0.098, k * 0.026), T);
    I.add(M.mag, bar(at(-L * 0.13, yv + 0.03, 0), at(0.02, yv + 0.03, 0), 0.045, 0.036), null);
    I.add(M.steel, bar(at(0.014, yv + 0.03, 0), at(0.044, yv + 0.03, 0), 0.05), null);
    I.add(M.rubber, pipe([[0.03, yv + 0.082, 0], [0.03, yv + 0.03, 0.052], [0.03, 0.03, 0.068], [0.03, -0.066, 0], [0.03, 0.03, -0.068], [0.03, yv + 0.03, -0.052]].map((p) => at(...p)), 0.006, 60, 6, true), null);
    for (const s of [-1, 1]) I.add(M.mag, block(L * 0.74, 0.05, 0.075, -L * 0.52, yv - 0.045, s * (zr + 0.01), 0.015), T);
    I.add(M.cast, bar(at(-L * 0.91, yv + 0.03, 0), at(-L * 1.02, yv + 0.03, 0), 0.05), null);
  }
  // gearbox: a bell on its input, the differential across it, the gear case behind. Bolted to the engine, with the
  // differential just behind the axle line; or a transaxle at the rear, on a torque tube from the engine
  const X = P('gearbox'), xg = mid ? xe - 0.03 : G.x0, yi = mid ? E.yc : G.y, yk = (yi + yd) / 2, xt = xg - G.len;
  const x0 = xg - 0.1, x1 = Math.min(dx - 0.2, lerp(x0, xt, 0.6));
  X.add(M.mag, turnX(mid ? [[0.14, 0], [0.14, -0.02], [0.112, -0.1], [0.1, -0.13]] : [[0.078, 0], [0.082, -0.02], [0.085, -0.1], [0.08, -0.13]]).translate(xg, yi, 0), null);
  X.add(M.cast, turnZ([[0.045, -0.185], [0.06, -0.16], [0.105, -0.12], [0.112, 0], [0.105, 0.12], [0.06, 0.16], [0.045, 0.185]]).translate(dx, yd, 0), null);
  X.add(M.cast, block(x0 - x1, 0.23, 0.22, (x0 + x1) / 2, yk, 0, 0.04), null);
  X.add(M.cast, block(x1 - xt + 0.04, 0.17, 0.18, (x1 + xt) / 2 + 0.02, yk + 0.02, 0, 0.035), null);
  for (let i = 1; i <= 4; i++) X.add(M.mag, block(0.012, 0.25, 0.24, lerp(x0, x1, i / 5), yk, 0, 0.02), null);
  for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 + 0.3, r = mid ? 0.128 : 0.068; X.add(M.steel, bar([xg - 0.003, yi + r * Math.cos(a), r * Math.sin(a)], [xg - 0.03, yi + r * Math.cos(a), r * Math.sin(a)], 0.007, 0.007, 6), null); }
  X.add(M.mag, turnX([[0.075, 0], [0.075, -0.012], [0.055, -0.035], [0, -0.04]]).translate(xt, yk + 0.02, 0), null);
  if (G.kind === 'dct') {
    X.add(M.mag, block(0.2, 0.04, 0.15, (x0 + x1) / 2, yk + 0.133, 0, 0.012), null);
    X.add(M.steel, bar([x1 + 0.05, yk + 0.02, 0.11], [x1 + 0.05, yk + 0.02, 0.175], 0.03), null);
  }
  if (G.kind === 'seq') {
    X.add(M.steel, bar([x1 + 0.02, yk + 0.07, 0.125], [x1 + 0.2, yk + 0.07, 0.125], 0.026), null);
    X.add(M.mag, block(0.07, 0.06, 0.05, x1 + 0.23, yk + 0.07, 0.125, 0.01), null);
  }
  if (G.kind === 'auto') X.add(M.mag, block((x0 - x1) * 0.8, 0.03, 0.2, (x0 + x1) / 2, yk - 0.125, 0, 0.01), null);
  if (!mid) {
    const U = P('propshaft'), a = new V3(xe - 0.03, E.yc, 0), b = new V3(xg, yi, 0), d = b.clone().sub(a).normalize(), on = (t) => a.clone().addScaledVector(d, t), len = a.distanceTo(b);
    U.add(M.cast, bar(a, on(0.03), 0.14), null);
    U.add(M.cast, bar(on(0.03), on(0.17), 0.14, 0.055, 28), null);
    U.add(M.mag, bar(on(0.17), on(len - 0.03), 0.04, 0.04, 20), null);
    for (const t of [0.45, 0.7]) U.add(M.cast, bar(on(len * t - 0.012), on(len * t + 0.012), 0.047, 0.047, 20), null);
    U.add(M.cast, bar(on(len - 0.03), b, 0.05, 0.078, 28), null);
  }
}
// a half shaft with its joints: from the differential or a motor out to the hub
function mechShaft(B, a, ax, s) {
  const A = mv(a), b = new V3(ax.x, ax.yc, s * (ax.track - 0.14)), d = b.clone().sub(A).normalize();
  B.add(M.steel, bar(A, b, 0.014), null);
  B.add(M.rubber, bar(A, A.clone().addScaledVector(d, 0.085), 0.046, 0.02), null);
  B.add(M.rubber, bar(b, b.clone().addScaledVector(d, -0.08), 0.042, 0.02), null);
  B.add(M.steel, bar(A.clone().addScaledVector(d, -0.012), A, 0.05), null);
  B.add(M.steel, bar(b, b.clone().addScaledVector(d, 0.03), 0.045, 0.03), null);
}

/* ---------- electric: the battery under the floor, two motors on each axle ---------- */
function mechElectric(P, V) {
  const B = P('battery'), [x0, x1] = V.pack, len = x0 - x1, cx = (x0 + x1) / 2;
  B.add(M.mag, block(len, 0.13, V.width, cx, 0.185, 0, 0.012), null);
  B.add(M.cast, block(len - 0.03, 0.006, V.width - 0.03, cx, 0.254, 0), null);
  for (let i = 1; i < 8; i++) B.add(M.cast, block(0.012, 0.012, V.width - 0.06, lerp(x1, x0, i / 8), 0.258, 0), null);
  for (const s of [-1, 1]) B.add(M.cast, block(len + 0.02, 0.05, 0.025, cx, 0.16, s * (V.width / 2 + 0.008), 0.006), null);
  for (const x of [x0 - 0.1, x1 + 0.1]) B.add(M.hv, block(0.16, 0.022, 0.26, x, 0.268, 0, 0.006), null);
  AX.forEach((ax, i) => {
    const e = i ? 'R' : 'F', Gc = P('gear' + e);
    // reduction gears between the two motors
    Gc.add(M.cast, turnZ([[0.07, -0.07], [0.135, -0.062], [0.14, 0], [0.135, 0.062], [0.07, 0.07]]).translate(ax.x, ax.yc, 0), null);
    Gc.add(M.mag, block(0.1, 0.05, 0.11, ax.x, ax.yc - 0.13, 0, 0.012), null);
    for (const s of [-1, 1]) {
      const k = 2 * i + (s > 0 ? 1 : 0), Mo = P('motor' + k);
      Mo.add(M.cast, turnZ([[0.03, 0.07], [0.112, 0.07], [0.118, 0.085], [0.118, 0.25], [0.1, 0.275], [0.048, 0.285], [0.048, 0.23], [0.03, 0.21], [0.03, 0.07]].map(([r, a]) => [r, s * a])).translate(ax.x, ax.yc, 0), null);
      for (let f = 0; f < 9; f++) Mo.add(M.mag, turnZ([[0.118, 0], [0.127, 0.002], [0.127, 0.006], [0.118, 0.008]].map(([r, a]) => [r, s * (0.095 + f * 0.017 + a)])).translate(ax.x, ax.yc, 0), null);
      Mo.add(M.hv, block(0.07, 0.03, 0.05, ax.x, ax.yc + 0.128, s * 0.2, 0.006), null);
      mechShaft(P('shaft' + k), [ax.x, ax.yc, s * 0.297], ax, s);
    }
    // inverter over the unit, its cables down to the motors and along to the battery
    const Iv = P('inverter' + e), yi = ax.yc + 0.2, to = i ? x1 + 0.1 : x0 - 0.1, dir = i ? 1 : -1;
    Iv.add(M.cast, block(0.3, 0.06, 0.34, ax.x, yi, 0, 0.012), null);
    for (let f = -5; f <= 5; f++) Iv.add(M.mag, block(0.27, 0.014, 0.008, ax.x, yi + 0.036, f * 0.028), null);
    for (const s of [-1, 1]) Iv.add(M.hv, pipe([[ax.x, yi - 0.02, s * 0.15], [ax.x, yi - 0.04, s * 0.2], [ax.x, ax.yc + 0.14, s * 0.2]], 0.011, 10, 8), null);
    Iv.add(M.hv, pipe([[ax.x + dir * 0.14, yi - 0.01, 0.06], [ax.x + dir * 0.24, yi - 0.06, 0.06], [lerp(ax.x, to, 0.75), 0.3, 0.06], [to, 0.275, 0.06]], 0.012, 24, 8), null);
  });
}

/* ---------- radiators: a core between its tanks, a fan in its shroud behind ---------- */
function mechRadiators(P, R) {
  for (const s of R.z ? [-1, 1] : [0]) {
    const B = P('radiator' + (s ? sideKey(s) : '')), w = R.w, h = R.h, fr = Math.min(w, h) / 2 - 0.02;
    const Tm = new THREE.Matrix4().makeTranslation(R.x, R.y, s * R.z).multiply(new THREE.Matrix4().makeRotationY(s * R.yaw)).multiply(new THREE.Matrix4().makeRotationZ(R.lean));
    B.add(M.core, block(0.034, h, w, 0, 0, 0), Tm);
    for (const e of [-1, 1]) {
      B.add(M.cast, block(0.044, h + 0.012, 0.03, 0, 0, e * (w / 2 + 0.014), 0.008), Tm);
      B.add(M.rubber, bar([-0.02, e * h * 0.34, e * (w / 2 + 0.014)], [-0.09, e * h * 0.34, e * (w / 2 + 0.014)], 0.018), Tm);
    }
    B.add(M.mag, block(0.004, h + 0.02, w + 0.07, -0.02, 0, 0), Tm);
    for (const z of w > 2.4 * h ? [-w / 4, w / 4] : [0]) {
      B.add(M.mag, turnX([[fr, -0.02], [fr, -0.052], [fr - 0.008, -0.052]], 36).translate(0, 0, z), Tm);
      B.add(M.mag, bar([-0.02, 0, z], [-0.06, 0, z], 0.032), Tm);
      const hub = Tm.clone().multiply(new THREE.Matrix4().makeTranslation(-0.042, 0, z));
      for (let k = 0; k < 7; k++) B.add(M.rubber, block(0.003, fr - 0.03, 0.045, 0, (fr + 0.024) / 2, 0), hub.clone().multiply(new THREE.Matrix4().makeRotationX(k * Math.PI * 2 / 7)).multiply(new THREE.Matrix4().makeRotationY(0.5)));
    }
  }
}

/* ---------- suspension: double wishbones, coil-over dampers, steering rack, anti-roll bars ---------- */
function mechSuspension(P, Su, awd) {
  const arm = Su.arms === 'alloy' ? M.cast : M.arm;
  AX.forEach((ax, i) => {
    const zi = Su.inner[i], zt = Su.top[i], zo = ax.track - 0.105, driven = awd || i === 1;
    for (const s of [-1, 1]) {
      const n = 2 * i + (s > 0 ? 1 : 0);
      const lb = new V3(ax.x, ax.yc - 0.115, s * zo), ub = new V3(ax.x - 0.015, ax.yc + 0.115, s * (zo - 0.01));
      // wishbones: two legs from the tub to the ball joint at the upright
      for (const [key, tip, y, z, legs] of [['lower', lb, ax.yc - 0.1, zi, [0.17, -0.17]], ['upper', ub, ax.yc + 0.135, zi + 0.06, [0.15, -0.15]]]) {
        const A = P(key + n);
        for (const dx of legs) {
          const in0 = new V3(ax.x + dx, y, s * z);
          A.add(arm, bar(in0, tip, 0.0155, 0.0125), null);
          A.add(M.steel, bar(in0.clone().setX(in0.x - 0.024), in0.clone().setX(in0.x + 0.024), 0.021), null);
          A.add(M.rubber, bar(in0.clone().setX(in0.x - 0.016), in0.clone().setX(in0.x + 0.016), 0.025), null);
        }
        A.add(M.steel, ball(0.021, tip.x, tip.y, tip.z), null);
        // (the lower one carries the damper and the anti-roll bar's link on a cross tube)
        if (key === 'lower') A.add(arm, bar([ax.x + 0.07, y - 0.006, s * lerp(z, zo, 0.6)], [ax.x - 0.07, y - 0.006, s * lerp(z, zo, 0.6)], 0.011), null);
      }
      // coil-over: from the lower wishbone up to the tub; on a driven axle its foot is a fork round the half shaft
      const C = P('coil' + n), low = new V3(ax.x, ax.yc - 0.092, s * lerp(zi, zo, 0.66)), top = new V3(ax.x, ax.yc + 0.3, s * zt), d = top.clone().sub(low);
      const on = (t, dx = 0) => low.clone().addScaledVector(d, t).setX(low.x + d.x * t + dx);
      const s0 = driven ? 0.42 : 0.11;
      if (driven) {
        for (const e of [-1, 1]) { C.add(M.steel, bar(on(0, e * 0.05), on(0.36, e * 0.05), 0.009), null); C.add(M.steel, ball(0.015, low.x + e * 0.05, low.y, low.z), null); }
        C.add(M.steel, bar(on(0.36, -0.06), on(0.36, 0.06), 0.012), null);
        C.add(M.steel, bar(on(0.36), on(0.55), 0.0085), null);
      } else {
        C.add(M.steel, bar(on(0), on(0.5), 0.0085), null);
        C.add(M.steel, ball(0.017, low.x, low.y, low.z), null);
      }
      C.add(M.mag, bar(on(driven ? 0.52 : 0.42), on(0.96), 0.024), null);
      C.add(M.steel, bar(on(0.94), on(1), 0.03, 0.02), null);
      C.add(M.steel, bar(on(s0 - 0.03), on(s0), 0.043), null);
      C.add(M.steel, bar(on(0.78), on(0.81), 0.043), null);
      C.add(M.spring, coil(on(s0), on(0.78), 0.036, 0.0065, driven ? 5 : 7), null);
      C.add(M.pipe, bar(on(0.7, 0.064), on(0.94, 0.064), 0.017), null);
    }
    // anti-roll bar: across the car, an arm at each end, a drop link to the lower wishbone
    const A = P(i ? 'barR' : 'barF'), dir = i ? -1 : 1, xb = ax.x + dir * 0.22, xl = ax.x + dir * 0.078, yb = Su.bar[i], ze = lerp(zi, zo, 0.6);
    A.add(M.steel, pipe([[xl, yb, -ze], [xb - dir * 0.05, yb, -ze], [xb, yb, -ze + 0.05], [xb, yb, 0], [xb, yb, ze - 0.05], [xb - dir * 0.05, yb, ze], [xl, yb, ze]], 0.011, 60, 8), null);
    for (const s of [-1, 1]) {
      A.add(M.mag, block(0.04, 0.036, 0.03, xb, yb, s * (zi - 0.06), 0.006), null);
      A.add(M.steel, bar([xl, yb, s * ze], [xl, ax.yc - 0.106, s * ze], 0.006), null);
      A.add(M.steel, ball(0.011, xl, yb, s * ze), null);
    }
  });
  // rack ahead of the front axle, its pinion on the driver's side, a tie rod to each upright
  const ax = AX[0], R = P('rack'), xr = ax.x + Su.rack, yr = ax.yc - 0.02;
  R.add(M.cast, bar([xr, yr, -0.2], [xr, yr, 0.2], 0.025), null);
  R.add(M.mag, bar([xr, yr, -0.14], [xr - 0.035, yr + 0.075, -0.17], 0.024, 0.02), null);
  R.add(M.steel, bar([xr - 0.035, yr + 0.075, -0.17], [xr - 0.06, yr + 0.13, -0.19], 0.009), null);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) R.add(M.rubber, turnZ([[0.014, 0], [0.026 - k * 0.0015, 0.008], [0.014, 0.016]].map(([r, a]) => [r, s * (0.2 + k * 0.016 + a)])).translate(xr, yr, 0), null);
    R.add(M.steel, bar([xr, yr, s * 0.29], [ax.x + 0.1, ax.yc - 0.03, s * (ax.track - 0.11)], 0.0085), null);
    R.add(M.steel, ball(0.016, ax.x + 0.1, ax.yc - 0.03, s * (ax.track - 0.11)), null);
  }
}
