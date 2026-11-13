/* =========================================================================
   FREE DRIVING (vehicle dynamics) — the car as a body on four wheels, driven
   by a person. In the plane: forward and sideways speed and yaw rate, tyre
   forces from combined slip (so the rear steps out under power or a locked
   handbrake, and comes back), an axle speed per axle so wheels spin up and
   lock. Vertically: the sprung body on four springs and dampers with
   anti-roll bars, each wheel on the ground under it, so squat, dive and roll
   are what the loads make them, wheels work over kerbs and bumps, the car
   goes light over crests, leaves the ground and lands. Powertrain, aero and
   tyre grip are the active model's own (blk_drive.js). Barriers, trees and
   rocks push back. No three.js here: tools/sim.js drives it without a page.
   ========================================================================= */
const FREE = {
  on: false, leaving: false, auto: false,
  x: 0, z: 0, th: 0,                 // centre of gravity on the map, heading
  u: 0, w: 0, r: 0,                  // speed forward and to the right, yaw rate (clockwise from above)
  wf: 0, wr: 0,                      // axle speeds (rad/s)
  zb: 0, zbV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0,   // sprung body: height, nose-up pitch, right-side-down roll
  delta: 0, steer: 0, thr: 0, brk: 0, hb: 0, rev: false, revT: 0,
  absF: 1, absR: 1, tc: 1, upT: 0, split: 0.4,
  air: 0, airT: 0, landV: 0, ax: 0, ay: 0, hit: 0, hitSide: 0, scrape: 0, wet: 0, wetT: 0, sq: 0, loose: 0, rough: 0, esc: 0,
  s: 0, n: 0, onRoad: false, roadI: -1, surf: 0, offT: 0,
  wheels: [], assist: { tcs: true, abs: true, steer: true },
  // what the picture needs: scene origin on the map, the plane the wheels stand on, the body on its springs
  view: { x: 0, z: 0, y: 0, pitch: 0, roll: 0, e: [0, 0, 0, 0] },
  lap: { t: 0, on: false, last: 0, best: 0, n: 0, next: 0, split: [], gates: 4, valid: true },
  drift: { score: 0, total: 0, t: 0, hold: 0, angle: 0, best: 0, banked: 0 },
  trap: { v: 0, t: 0, best: 0 }, air1: { t: 0, best: 0 },
  odo: 0, top: 0,
};
const DYN = { V0: 2.5, C: 1.3, B: Math.tan(Math.PI / 2.6), kp: 0.1, ap: 0.13, DMAX: 0.6 };
DYN.BC = DYN.B * DYN.C;

// springs, dampers, bars and inertias from the model's own attitude figures (pitch and roll per g, frequencies, damping)
function dynSetup() {
  const P = CARP, S = SUSP, L = WHEELBASE, a = P.a, b = L - a, D = DYN;
  const wh2 = GRAV * P.h / (S.pitch * a * b);
  D.a = a; D.b = b; D.cgx = AX[0].x - a;
  D.kf = P.m * b / L / 2 * wh2; D.kr = P.m * a / L / 2 * wh2;
  const cz = 2 * S.zh / Math.sqrt(wh2);
  D.cf = D.kf * cz; D.cr = D.kr * cz;
  D.sag = GRAV / wh2;
  D.Iyy = (2 * D.kf * a * a + 2 * D.kr * b * b) / (S.wp * S.wp);
  const tf = AX[0].track, tr = AX[1].track;
  const kS = 2 * (D.kf * tf * tf + D.kr * tr * tr), kPhi = Math.max(kS * 1.05, P.m * GRAV * P.h / S.roll);
  // the bars carry the rest of the roll stiffness: more of it at the front, so the car pushes before it spins
  const front = P.awd ? 0.56 : 0.6;
  D.arb = [(kPhi - kS) * front, (kPhi - kS) * (1 - front)];
  D.Ixx = kPhi / (S.wr * S.wr);
  const cPhi = Math.max(0, 2 * S.zr * kPhi / S.wr - 2 * (D.cf * tf * tf + D.cr * tr * tr));
  D.crl = [cPhi * front, cPhi * (1 - front)];
  D.Izz = P.m * a * b * 0.96;
  // travel: the wheel hangs a little below where its spring goes slack; bump rubbers, then the floor on the road
  D.droop = Math.min(0.15, D.sag + 0.03);
  D.bump = Math.max(0.03, Math.min(0.06, D.sag * 0.7)); D.floor = D.bump + 0.035;
  D.kbump = 5 * (D.kf + D.kr) / 2; D.kfloor = 40 * (D.kf + D.kr) / 2; D.cfloor = 2 * Math.sqrt(D.kfloor * P.m / 4);
  D.ap = lerp(0.15, 0.1, clamp((P.mu0 - 1.3) / 0.6, 0, 1));
  D.split = P.awd ? 0.4 : 0; D.lsd = 0.25; D.tcs = 1.0; D.escA = 0.085; D.escM = 0.4 * P.m * GRAV * AX[0].track; D.escK = D.escM / 0.08;
  D.Iax = [P.Iw / 2, P.Iw / 2];
  D.F0 = [P.m * GRAV * b / L / 2, P.m * GRAV * a / L / 2];
  D.Tb = P.brkCap * P.m * GRAV * (AX[0].R + AX[1].R) / 2 * 1.04;
  const W = FREE.wheels;
  W.length = 0;
  for (const ax of AX) for (const side of [-1, 1]) W.push({
    x: ax.front ? a : -b, y: side * ax.track, R: ax.R, front: !!ax.front, F0: D.F0[ax.front ? 0 : 1],
    hint: -1, g: 0, gV: 0, d: 0, dV: 0, F: 0, wb: 0, surf: 0, kerb: 0, road: false, vl: 0, vt: 0, kx: 0, fx: 0, fy: 0, fmax: 0, sg: 0, slip: 0, spin: 0, wx: 0, wz: 0,
  });
}

/* ---------- placing the car ---------- */
const _dg = {};
// at rest on the ground at a map position (x, z are the scene origin's, as the road's poses give them)
function freePlace(x, z, th) {
  const F = FREE, D = DYN, cs = Math.cos(th), sn = Math.sin(th);
  Object.assign(F, { th, x: x + D.cgx * cs, z: z + D.cgx * sn, u: 0, w: 0, r: 0, wf: 0, wr: 0, zbV: 0, pitchV: 0, rollV: 0, delta: 0, steer: 0, thr: 0, brk: 0, hb: 0, rev: false, revT: 0,
    absF: 1, absR: 1, tc: 1, air: 0, airT: 0, hit: 0, scrape: 0, ax: 0, ay: 0, wet: 0, wetT: 0, offT: 0, roadI: -1 });
  const g = [];
  for (const q of F.wheels) {
    q.hint = -1;
    lgGround(F.x + q.x * cs - q.y * sn, F.z + q.x * sn + q.y * cs, _dg, -1);
    q.hint = _dg.i; q.g = _dg.h; q.gV = 0; q.F = q.F0; q.d = 0; q.dV = 0; q.wb = _dg.h; g.push(_dg.h);
  }
  // the body parallel to the ground under its wheels
  const L = WHEELBASE;
  F.pitch = ((g[0] + g[1]) - (g[2] + g[3])) / 2 / L;
  F.roll = -((g[1] - g[0]) / (2 * AX[0].track) + (g[3] - g[2]) / (2 * AX[1].track)) / 2;
  F.zb = (g[0] + g[1]) / 2 - D.a * F.pitch;
  F.zb = (F.zb + (g[2] + g[3]) / 2 + D.b * F.pitch) / 2;
  if (DRIVE.gear < 1) DRIVE.gear = 1;
  if (lgRoadAt(F.x, F.z, _dr, -1)) { F.roadI = _dr.i; F.s = _dr.s; F.n = _dr.n; F.onRoad = Math.abs(_dr.n) < LG.HW + 0.6; } else { F.roadI = -1; F.onRoad = false; F.n = 99; }
  freeView();
}

/* ---------- one step of the model ---------- */
const _dA = { f: 0, r: 0, drag: 0 }, _dT = [0, 0], _dB = [0, 0];
function dynStep(h) {
  const F = FREE, D = DYN, P = CARP, d = DRIVE, W = F.wheels;
  const cs = Math.cos(F.th), sn = Math.sin(F.th);
  const V = Math.hypot(F.u, F.w);
  d.simT += h;
  // ---- the ground under each wheel ----
  for (let i = 0; i < 4; i++) {
    const q = W[i];
    q.wx = F.x + q.x * cs - q.y * sn; q.wz = F.z + q.x * sn + q.y * cs;
    lgGround(q.wx, q.wz, _dg, q.hint);
    q.hint = _dg.i; q.surf = _dg.surf; q.kerb = _dg.kerb; q.road = _dg.road;
    let g = _dg.h;
    const rough = LG_SURF[_dg.surf].rough;
    if (rough) g += rough * (gnoise(q.wx * 0.8, q.wz * 0.8) + 0.5 * gnoise(q.wx * 2.9 + 9, q.wz * 2.9));
    q.gV = clamp((g - q.g) / h, -3.5, 3.5);
    q.g = g;
    q.d = g - (F.zb + q.x * F.pitch - q.y * F.roll);
    q.dV = q.gV - (F.zbV + q.x * F.pitchV - q.y * F.rollV);
  }
  // ---- springs, dampers, bars, bump rubbers ----
  let sumF = 0, mP = 0, mR = 0, air = 0;
  for (let ax = 0; ax < 2; ax++) {
    const l = W[ax * 2], r = W[ax * 2 + 1], k = ax ? D.kr : D.kf, c = ax ? D.cr : D.cf, t2 = 2 * AX[ax].track;
    const bar = (D.arb[ax] * (r.d - l.d) / t2 + D.crl[ax] * (r.dV - l.dV) / t2) / t2;
    for (let j = 0; j < 2; j++) {
      const q = j ? r : l;
      let f = q.F0 + k * q.d + c * q.dV + (j ? bar : -bar);
      if (q.d > D.bump) f += D.kbump * (q.d - D.bump);
      if (q.d > D.floor) f += D.kfloor * (q.d - D.floor) + D.cfloor * Math.max(0, q.dV);
      if (f <= 0 || q.d < -D.droop) { f = 0; air++; }
      q.F = f;
      sumF += f; mP += f * q.x; mR += f * q.y;
    }
  }
  F.air = air;
  // ---- powertrain ----
  const running = d.engine >= 1, gear = d.gear;
  const ratio = gear < 0 ? -RATIO[1] : RATIO[gear];
  // four motors share the torque as the axles share the load; a mechanical drive keeps its split
  let split = D.split;
  if (EV && split > 0) { const ff = W[0].F + W[1].F, fr = W[2].F + W[3].F; split = F.split += (clamp(ff / Math.max(1, ff + fr), 0.15, 0.6) - F.split) * Math.min(1, h * 20); }
  const omD = split * F.wf + (1 - split) * F.wr;
  const wheelRpm = omD * ratio * RPM_K;
  const vAbs = Math.abs(F.u);
  d.cutT = Math.max(0, d.cutT - h); d.shiftCut = Math.max(0, d.shiftCut - h); d.blip = Math.max(0, d.blip - h); d.shiftFlash = Math.max(0, d.shiftFlash - h);
  F.upT = Math.max(0, F.upT - h);
  let rpmT = 0, Te = 0, locked = true;
  if (running) {
    if (EV) {
      rpmT = Math.abs(wheelRpm);
      Te = F.thr * engineTorque(rpmT) * F.tc - (1 - F.thr) * engineBrakeTq(rpmT) * sstep(0.5, 3, vAbs) * Math.sign(F.u * ratio || 1);
    } else {
      // the clutch slips while the wheels are slower than the engine wants to turn pulling away
      const bite = lerp(IDLE * 1.12, LAUNCH_RPM, F.thr);
      locked = wheelRpm >= bite || Math.abs(gear) > 1 && wheelRpm > IDLE;
      rpmT = locked ? Math.max(IDLE, wheelRpm) : Math.max(IDLE, bite, wheelRpm);
      if (rpmT >= LIMITER) d.cutT = 0.03;
      d.cut = d.cutT > 0 ? 1 : 0;
      const cutK = d.cut || d.shiftCut > 0 ? 0.12 : 1;
      Te = F.thr * engineTorque(rpmT) * cutK * F.tc;
      if (locked && wheelRpm > IDLE * 1.05) Te -= (1 - F.thr) * engineBrakeTq(rpmT);
      else if (!locked && F.thr < 0.02) Te = 0;
    }
    // top speed is held electronically
    if (V > VCAP) Te *= clamp(1 - (V - VCAP) / 2, 0, 1);
    if (gear < 0) Te *= 0.6 * clamp(1 - (vAbs - 13) / 3, 0, 1);
  }
  const Td = Te * ratio * P.eta;
  _dT[0] = Td * split; _dT[1] = Td * (1 - split);
  _dB[0] = F.brk * 0.7 * D.Tb * F.absF;
  _dB[1] = F.brk * 0.3 * D.Tb * F.absR + F.hb * 1.4 * P.mu0 * (W[2].F + W[3].F + 800) * AX[1].R;
  if (!running && !F.auto && d.start <= 0 && V < 0.5) _dB[0] = _dB[1] = D.Tb;
  // ---- tyres ----
  const cd = Math.cos(F.delta), sd = Math.sin(F.delta);
  let FX = 0, FY = 0, MZ = 0, slipD = 0, sgD = 0;
  for (let ax = 0; ax < 2; ax++) {
    let ks = 0, kv = 0;
    const om0 = ax ? F.wr : F.wf, Rw = AX[ax].R, l = W[ax * 2], r = W[ax * 2 + 1];
    for (let j = 0; j < 2; j++) {
      const q = j ? r : l, vx = F.u - F.r * q.y, vy = F.w + F.r * q.x;
      q.vl = ax ? vx : vx * cd + vy * sd; q.vt = ax ? vy : -vx * sd + vy * cd;
    }
    // a differential lets each wheel turn at the speed of its own path, so both see the axle's mean slip; the
    // driven rear axle's is a limited-slip one and holds the two a little together
    const vlA = (l.vl + r.vl) / 2, lock = ax && D.split < 0.5 ? D.lsd : 0;
    for (let j = 0; j < 2; j++) {
      const q = j ? r : l;
      const SF = LG_SURF[q.surf], loose = q.surf >= 2 ? 1.7 : 1;
      const fmax = q.F > 0 ? P.mu0 * Math.pow(Math.max(0.3, q.F / q.F0), -P.muLoad) * SF.mu * q.F : 0;
      const vden = Math.max(Math.abs(q.vl), D.V0), vdl = Math.max(Math.abs(vlA), D.V0);
      q.vm = vlA + (q.vl - vlA) * lock;
      // (a tyre under more load grips best at a larger slip angle: its cornering stiffness grows more slowly than its load)
      const apq = D.ap * loose * Math.pow(clamp(q.F / q.F0, 0.35, 3), 0.35);
      const sgx = (om0 * Rw - q.vm) / (vdl * D.kp * loose), sgy = -q.vt / (vden * apq), sg = Math.hypot(sgx, sgy);
      const gs = sg < 1e-4 ? D.BC : Math.sin(D.C * Math.atan(D.B * sg)) / sg;
      q.kx = fmax * gs / (vdl * D.kp * loose);
      q.fy = fmax * gs * sgy;
      q.fmax = fmax; q.sg = sg;
      ks += q.kx; kv += q.kx * q.vm;
    }
    // axle speed, implicit in the tyres' own stiffness; the brakes slow the wheel and can lock it but never turn it back
    const share = ax ? 1 - split : split;
    const I = D.Iax[ax] + (running && locked && share > 0 ? P.Ie * ratio * ratio * share : 0);
    const den = I + h * Rw * Rw * ks;
    let om = (om0 * I + h * (_dT[ax] + Rw * kv)) / den;
    const db = h * _dB[ax] / den;
    om = om > 0 ? Math.max(0, om - db) : Math.min(0, om + db);
    if (ax) F.wr = om; else F.wf = om;
    for (let j = 0; j < 2; j++) {
      const q = j ? r : l;
      let fx = q.kx * (om * Rw - q.vm), fy = q.fy;
      const tot = Math.hypot(fx, fy);
      if (tot > q.fmax && tot > 0) { fx *= q.fmax / tot; fy *= q.fmax / tot; }
      q.fx = fx; q.fy = fy;
      const bx = ax ? fx : fx * cd - fy * sd, by = ax ? fy : fx * sd + fy * cd;
      FX += bx; FY += by; MZ += q.x * by - q.y * bx;
      // how hard the tyre is sliding, 0..1, for smoke, marks and sound
      q.slip += (clamp((q.sg - 1.1) / 2.2, 0, 1) * (q.F > 0 ? 1 : 0) - q.slip) * Math.min(1, h * 25);
      if (share > 0 && q.F > 0) sgD = Math.max(sgD, (q.sg - D.tcs) * clamp((om * Rw - q.vm) * Math.sign(ratio) / (Math.max(Math.abs(vlA), D.V0) * D.kp * 0.35), 0, 1));
    }
    const kap = (om * Rw - vlA) / Math.max(Math.abs(vlA), D.V0);
    if (share > 0) slipD = Math.max(slipD, kap * Math.sign(ratio));
    // anti-lock: let the brake go while the axle is locking, bring it back as the wheel spins up. The rear axle is
    // kept short of its tyres' limit, along and across together, so that it still holds the car straight
    const sgA = Math.max(l.F > 0 ? l.sg : 0, r.F > 0 ? r.sg : 0);
    if (F.assist.abs && F.brk > 0.05 && V > 2.5 && kap * Math.sign(vlA) < -D.kp * 0.12 && (ax ? sgA > 0.7 : kap * Math.sign(vlA) < -D.kp * 1.4)) { if (ax) F.absR = Math.max(0.04, F.absR - h * 30); else F.absF = Math.max(0.04, F.absF - h * 30); }
    else if (ax) F.absR = Math.min(1, F.absR + h * 9); else F.absF = Math.min(1, F.absF + h * 9);
  }
  const tyreX = FX, tyreY = FY;
  // traction control: trims the engine while the driven tyres are past their best slip, along or across
  const tcWant = F.assist.tcs && F.hb < 0.2 && F.thr > 0.02 ? clamp(1 - sgD / 0.3, 0.04, 1) : 1;
  F.tc += (tcWant - F.tc) * Math.min(1, h * (tcWant < F.tc ? 90 : 14));
  d.slip += (clamp((slipD - 0.12) * 2.2, 0, 1) - d.slip) * Math.min(1, h * 18);
  // ---- air, rolling resistance, the slope of the ground ----
  const A = aeroForces(V, clamp(wingDeploy, 0, 1), d.airbrake, _dA);
  let res = 0;
  for (let i = 0; i < 4; i++) res += (P.crr + LG_SURF[W[i].surf].drag) * W[i].F;
  if (F.wet > 0) res += F.wet * (900 + 420 * V * V);
  if (V > 1e-3) { const k = (A.drag + res * Math.min(1, V / 0.6)) / V; FX -= k * F.u; FY -= k * F.w; }
  FY -= 0.5 * RHO * 2.6 * F.w * Math.abs(F.w);
  const tf2 = 2 * AX[0].track, tr2 = 2 * AX[1].track;
  const gx = ((W[0].wb + W[1].wb) - (W[2].wb + W[3].wb)) / 2 / WHEELBASE, gy = ((W[1].wb - W[0].wb) / tf2 + (W[3].wb - W[2].wb) / tr2) / 2;
  FX -= sumF * gx; FY -= sumF * gy;
  // stability control: when the rear slides out further than a driver would hold it, the brakes pull the car straight
  F.esc = 0;
  if (F.assist.tcs && F.hb < 0.2 && V > 7 && F.u > 0 && air < 3) {
    const ar = Math.atan2(F.w - D.b * F.r, F.u), over = Math.abs(ar) - D.escA;
    if (over > 0) {
      const M = Math.sign(ar) * Math.min(D.escM, over * D.escK + Math.max(0, -Math.sign(ar) * F.r) * D.escM * 0.5);
      MZ += M; FX -= Math.abs(M) / AX[0].track * 0.5; F.esc = Math.abs(M) / D.escM;
    }
  }
  // ---- the body in the plane ----
  const aX = FX / P.m, aY = FY / P.m, u0 = F.u;
  F.u += (aX + F.r * F.w) * h; F.w += (aY - F.r * u0) * h; F.r += MZ / D.Izz * h;
  F.ax += (aX - F.ax) * Math.min(1, h * 30); F.ay += (aY - F.ay) * Math.min(1, h * 30);
  // standing still: held by the brakes, or by the gearbox once the driver is off the pedals
  if (V < 0.35 && Math.abs(F.r) < 0.4 && (F.thr < 0.02 || !running) && air < 4) {
    const k = Math.exp(-h * 14); F.u *= k; F.w *= k; F.r *= k;
    if (V < 0.04) { F.u = 0; F.w = 0; F.r = 0; }
  }
  F.x += (F.u * cs - F.w * sn) * h; F.z += (F.u * sn + F.w * cs) * h; F.th += F.r * h;
  // ---- the body on its springs ----
  F.zbV += ((sumF - A.f - A.r) / P.m - GRAV) * h;
  F.pitchV += (mP + P.h * tyreX - A.f * D.a + A.r * D.b) / D.Iyy * h;
  F.rollV += (-mR - P.h * tyreY) / D.Ixx * h;
  if (air === 4) {
    // in the air the car flies nose-first along its path
    const path = Math.atan2(F.zbV, Math.max(4, V));
    F.pitchV += ((path * 0.6 - F.pitch) * 5 - F.pitchV * 2.2) * h;
    F.rollV += (-F.roll * 5 - F.rollV * 2.5) * h;
  }
  F.zb += F.zbV * h; F.pitch = clamp(F.pitch + F.pitchV * h, -0.75, 0.75); F.roll = clamp(F.roll + F.rollV * h, -0.65, 0.65);
  // where each wheel is: on the ground, or hanging at full droop
  for (let i = 0; i < 4; i++) { const q = W[i]; q.wb = q.d > -D.droop ? q.g : F.zb + q.x * F.pitch - q.y * F.roll - D.droop; }
  // ---- engine speed as heard and shown; the gearbox ----
  if (running) d.rpm += (rpmT + (d.blip > 0 ? PWR.shift.flare : 0) - d.rpm) * (1 - Math.exp(-h * (d.shiftCut > 0 ? 42 : 26)));
  else d.rpm = Math.max(0, d.rpm - h * 2600);
  d.rpmT = rpmT;
  if (running && !EV && d.shiftCut <= 0 && gear >= 1 && Math.abs(F.w) < 0.3 * vAbs + 1) {
    const S = PWR.shift, road = V / P.Rr * RPM_K;
    if (gear < NGEAR && rpmT > UPSHIFT && locked) { d.gear++; d.shiftCut = S.up; d.shiftFlash = 0.3; F.upT = 0.7; ev('up', { rpm: d.rpm }); }
    else if (gear > 1 && F.upT <= 0) {
      const lower = road * RATIO[gear - 1], cur = road * RATIO[gear];
      if ((F.brk > 0.15 && lower < S.downBrake) || (F.thr > 0.6 && lower < S.kickTo && cur < S.kickBelow) || (lower < UPSHIFT * 0.45 && cur < IDLE * 1.9)) { d.gear--; d.shiftCut = S.down; d.blip = S.blip; ev('down', { rpm: lower }); }
    }
  }
  const PP = PWR.pops;
  if (running && PP && F.thr < 0.08 && d.rpm > PP.rpm && V > 5) {
    d.overrun += h;
    if (rand() < (PP.rate * Math.exp(-d.overrun * 1.3) + PP.tail) * h) ev('pop', { big: rand() < PP.big });
  } else d.overrun = 0;
}

/* ---------- barriers, trees, rocks ---------- */
const _dr = {};
// a blow at a point of the car (body frame, from the centre of gravity) along a unit normal on the map: the speed
// into the obstacle is taken out (a little is given back), the car is pushed clear and turned by the blow
function dynImpact(px, py, nx, nz, depth, e, mu) {
  const F = FREE, D = DYN, cs = Math.cos(F.th), sn = Math.sin(F.th);
  F.x += nx * depth; F.z += nz * depth;
  // normal in the body frame, speed of the struck point along it
  const bx = nx * cs + nz * sn, by = -nx * sn + nz * cs;
  const vx = F.u - F.r * py, vy = F.w + F.r * px, vn = vx * bx + vy * by;
  if (vn >= 0) return 0;
  const lever = px * by - py * bx, k = 1 / CARP.m + lever * lever / D.Izz, J = -(1 + e) * vn / k;
  F.u += J * bx / CARP.m; F.w += J * by / CARP.m; F.r += clamp(J * lever / D.Izz, -2.5, 2.5);
  // scrubbing along the obstacle
  const tx = -by, ty = bx, vt = vx * tx + vy * ty, jt = clamp(-vt / k, -mu * J, mu * J);
  F.u += jt * tx / CARP.m; F.w += jt * ty / CARP.m;
  return -vn;
}
function dynCollide(dt) {
  const F = FREE, D = DYN, R = LG.road;
  const cs = Math.cos(F.th), sn = Math.sin(F.th);
  let worst = 0, scrape = 0, side = 0;
  // the four corners of the body against the barriers beside the road
  if (lgRoadAt(F.x, F.z, _dr, F.roadI)) {
    F.roadI = _dr.i; F.s = _dr.s; F.n = _dr.n; F.onRoad = Math.abs(_dr.n) < LG.HW + 0.6;
    const nC = _dr.n;
    if (Math.abs(nC) < LG.HW + 14) for (let c = 0; c < 4; c++) {
      const px = (c < 2 ? XF - 0.25 : XR + 0.25) - D.cgx, py = (c & 1 ? 1 : -1) * 0.93;
      const x = F.x + px * cs - py * sn, z = F.z + px * sn + py * cs;
      if (!lgRoadAt(x, z, _dr, F.roadI)) continue;
      for (const sd of [-1, 1]) {
        const kind = (sd > 0 ? R.wallR : R.wallL)[_dr.i];
        if (!kind) continue;
        const nW = sd * LG_WALL_N[kind], inside = (nC - nW) * sd < 0;
        // through the barrier's line from the side the car is on
        const pen = inside ? (_dr.n - nW) * sd : (nW - _dr.n) * sd;
        if (pen <= 0 || pen > 2.2) continue;
        const th = R.th[_dr.i], k = inside ? -sd : sd;
        const v = dynImpact(px, py, -Math.sin(th) * k, Math.cos(th) * k, pen, 0.12, 0.22);
        worst = Math.max(worst, v); side = sd;
        scrape = Math.max(scrape, Math.min(1, Math.hypot(F.u, F.w) / 30));
      }
    }
  } else { F.roadI = -1; F.onRoad = false; F.n = 99; }
  // three circles along the body against trees and rocks
  const O = LG.obst;
  if (O && !LG.flat) for (let c = 0; c < 3; c++) {
    const px = lerp(XR + 0.95, XF - 0.95, c / 2) - D.cgx, x = F.x + px * cs, z = F.z + px * sn;
    const cx = Math.floor((x + LG.HALF) / O.C), cz = Math.floor((z + LG.HALF) / O.C);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const ix = cx + a, iz = cz + b;
      if (ix < 0 || iz < 0 || ix >= O.n || iz >= O.n) continue;
      const cell = iz * O.n + ix;
      for (let q = O.start[cell]; q < O.start[cell + 1]; q++) {
        const o = O.idx[q] * 3, dx = x - O.list[o], dz = z - O.list[o + 1], rr = O.list[o + 2] + 0.95, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const dd = Math.sqrt(d2);
        worst = Math.max(worst, dynImpact(px, 0, dx / dd, dz / dd, rr - dd, 0.2, 0.3));
      }
    }
  }
  // the edge of the map
  const lim = LG.flat ? 1e9 : LG.HALF - 70;
  if (Math.abs(F.x) > lim) worst = Math.max(worst, dynImpact(0, 0, -Math.sign(F.x), 0, Math.abs(F.x) - lim, 0.1, 0.2));
  if (Math.abs(F.z) > lim) worst = Math.max(worst, dynImpact(0, 0, 0, -Math.sign(F.z), Math.abs(F.z) - lim, 0.1, 0.2));
  F.scrape += (scrape - F.scrape) * Math.min(1, dt * 12);
  if (worst > 0.8) { F.hit = Math.min(1.5, worst / 12); F.hitSide = side; ev('bump', { axle: 'f', k: Math.min(2.2, 0.6 + worst / 6) }); if (worst > 2) DRIVE.sparkBurst += Math.min(60, worst * 5) * (scrape > 0 ? 1 : 0.3); }
}

/* ---------- the controls ---------- */
// steering input (-1..1) to front wheel angle. Up to about half way the input asks for a share of the cornering force
// the car has at this speed, whatever the speed (so a touch of the key is a touch at 60 and at 300 km/h); towards full
// input the wheels turn further, into the slip angle at which the front tyres grip best
function dynSteerLock(v) { return Math.min(DYN.DMAX, WHEELBASE * latCap(v, planDep()) / Math.max(v * v, 9)); }
function dynSteerMap(x, v) {
  const ax = Math.abs(x);
  return Math.sign(x) * Math.min(DYN.DMAX, dynSteerLock(v) * ax + DYN.ap * 0.95 * ax * ax * ax * ax);
}
// the input that turns the front wheels to an angle
function dynSteerInv(delta, v) {
  const lock = dynSteerLock(v), d = Math.min(Math.abs(delta), DYN.DMAX);
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) { const x = (lo + hi) / 2; if (lock * x + DYN.ap * 0.95 * x * x * x * x < d) lo = x; else hi = x; }
  return Math.sign(delta) * (lo + hi) / 2;
}
// raw: steer -1..1 (right positive), thr, brk, hb 0..1; digital: the keys of a keyboard, which need ramping
function dynControls(dt, raw) {
  const F = FREE, d = DRIVE, V = Math.hypot(F.u, F.w);
  // the gearbox goes into reverse when the brake is held at a standstill, and back when the throttle is
  if (!F.rev) { if (F.u < 0.8 && raw.brk > 0.3 && raw.thr < 0.1) { F.revT += dt; if (F.revT > 0.22) F.rev = true; } else F.revT = 0; }
  else if (raw.thr > 0.3 && raw.brk < 0.1 && F.u > -1.2) { F.rev = false; F.revT = 0; }
  d.gear = F.rev ? -1 : Math.max(1, d.gear);
  const thr = F.rev ? raw.brk : raw.thr, brk = F.rev ? raw.thr : raw.brk;
  const to = (cur, tgt, up, down) => (tgt > cur ? Math.min(tgt, cur + up * dt) : Math.max(tgt, cur - down * dt));
  if (raw.digital) {
    F.thr = to(F.thr, thr, 5.5, 9); F.brk = to(F.brk, brk, 6.5, 10);
    // steering: quick at parking speeds, calmer as the speed rises; faster back to centre than away from it
    const away = Math.sign(raw.steer) === Math.sign(F.steer) && Math.abs(raw.steer) > Math.abs(F.steer) || F.steer === 0;
    const rate = away ? lerp(3.4, 1.5, sstep(15, 70, V)) : 5.5;
    F.steer = to(F.steer, raw.steer, rate, rate);
  } else {
    const k = 1 - Math.exp(-dt * 22);
    F.thr += (thr - F.thr) * k; F.brk += (brk - F.brk) * k;
    F.steer += (raw.steer - F.steer) * (1 - Math.exp(-dt * 14));
  }
  F.hb = to(F.hb, raw.hb, 12, 14);
  // front wheel angle. With the rear sliding the wheels are also turned towards where the car is going, as a
  // driver catching a slide would
  let delta = dynSteerMap(F.steer, V);
  if (F.assist.steer && F.u > 3) {
    const rear = Math.atan2(F.w - DYN.b * F.r, F.u), front = Math.atan2(F.w + DYN.a * F.r, F.u);
    const k = sstep(0.05, 0.16, Math.abs(rear));
    delta = lerp(delta, clamp(front * 0.85 + F.steer * DYN.ap * 1.4, -DYN.DMAX, DYN.DMAX), k);
  }
  F.delta += (clamp(delta, -DYN.DMAX, DYN.DMAX) - F.delta) * (1 - Math.exp(-dt * 30));
  d.throttle = F.thr; d.brake = F.brk;
}

/* ---------- a driver for the car when nobody else is driving: round the lap on the road ---------- */
const AUTO = { v: null, key: '', look: {}, here: {} };
function autoPlan() {
  const R = LG.road, N = R.n, key = SPEC.id + '|' + state.wing + '|' + state.kit;
  if (AUTO.key === key && AUTO.v) return;
  AUTO.key = key;
  const v = AUTO.v = new Float32Array(N), dep = planDep(), top = Math.min(VCAP, 300 / 3.6);
  for (let i = 0; i < N; i++) {
    let k = 0; for (let j = -3; j <= 3; j++) k = Math.max(k, Math.abs(R.k[R.W(i + j)]));
    v[i] = Math.min(top, cornerSpeed(k * 1.08, dep) * 0.9);
  }
  for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) {
    const j = (i + 1) % N, vn = v[j], use = Math.min(0.95, vn * vn * Math.abs(R.k[j]) / latCap(vn, dep));
    const a = brakeCap(vn, dep) * 0.72 * Math.sqrt(Math.max(0.15, 1 - use * use));
    v[i] = Math.min(v[i], Math.sqrt(vn * vn + 2 * a * R.ds));
  }
}
function autoDrive(raw) {
  const F = FREE, R = LG.road, V = Math.hypot(F.u, F.w);
  autoPlan();
  raw.digital = false; raw.hb = 0;
  if (F.roadI < 0) { raw.steer = 0; raw.thr = 0; raw.brk = 1; return raw; }
  // steering: the curve of the road ahead, corrected by how far off the worn line and its direction the car is,
  // asked of the car as a share of its cornering force (which is what the steering input means)
  const P = lgRoadPose(F.s + 2 + V * 0.3, 0, AUTO.look), i0 = P.i;
  let kf = 0; for (let j = 0; j < 4; j++) kf += R.k[R.W(i0 + Math.round(j * V * 0.12))] / 4;
  const here = lgRoadPose(F.s, 0, AUTO.here), e = F.n - R.line[here.i] * 0.75;
  // (the direction the car is travelling in, not the one it points in: a slide is not chased with the wheel)
  let he = here.th - (F.th + (V > 5 ? Math.atan2(F.w, F.u) * 0.7 : 0)); he -= Math.round(he / (2 * Math.PI)) * 2 * Math.PI;
  const Vc = Math.max(V, 6), kap = kf + clamp((2.5 * Vc * he - 1.8 * e) / (Vc * Vc), -0.12, 0.12);
  // the lock that curve takes: its geometry, and near the limit the slip the front tyres need over the rear ones;
  // then the input that gives that lock
  const use = Math.min(1.1, V * V * Math.abs(kap) / (0.88 * latCap(V, planDep())));
  raw.steer = dynSteerInv(WHEELBASE * kap + Math.sign(kap) * DYN.ap * 0.55 * Math.pow(use, 6), V);
  const iNow = R.W(Math.round(F.s / R.ds)), iAhead = R.W(Math.round((F.s + Math.max(4, V * 0.25)) / R.ds));
  const vt = AUTO.v[iAhead], vn = AUTO.v[iNow];
  if (V > vn + 0.4 || V > vt + 1.5) { raw.thr = 0; raw.brk = clamp((V - Math.min(vn, vt)) * 0.35 + 0.15, 0, 1); }
  else { raw.brk = 0; raw.thr = clamp((vt - V) * 0.45, 0, 1); }
  // the tyres cannot both corner and drive at full: feed the power in as the bend opens; ease off in a slide
  raw.thr *= clamp(1.45 - 1.25 * Math.max(use, Math.abs(F.ay) / (0.88 * latCap(V, planDep()))), 0.15, 1);
  const beta = Math.abs(Math.atan2(F.w, Math.max(3, F.u)));
  if (beta > 0.1) raw.thr *= 0.4;
  return raw;
}

/* ---------- per frame ---------- */
const _dAir = { f: 0, r: 0, drag: 0 };
function freeAdvance(dt, raw) {
  const F = FREE, d = DRIVE, W = F.wheels;
  dynControls(dt, raw);
  const V0 = Math.hypot(F.u, F.w);
  // active aero: flat for top speed on a straight, stood up as an airbrake under hard braking
  const ldWant = V0 > SPEC.aero.lowDrag / 3.6 && F.brk < 0.05 && Math.abs(F.delta) < 0.012 && F.thr > 0.6 ? 1 : 0;
  d.lowDrag += (ldWant - d.lowDrag) * (1 - Math.exp(-dt * 1.6));
  const abWant = F.brk > 0.5 && V0 > 27 && !F.rev;
  if (abWant) d.abHold = 0.45; else d.abHold = Math.max(0, d.abHold - dt);
  d.airbrake += ((abWant || d.abHold > 0 ? 1 : 0) - d.airbrake) * (1 - Math.exp(-dt * 6));
  const wasAir = F.air === 4, zv0 = F.zbV;
  const n = Math.max(1, Math.ceil(dt * 480)), h = dt / n;
  let dmax = 0;
  for (let i = 0; i < n; i++) { dynStep(h); for (let j = 0; j < 4; j++) dmax = Math.max(dmax, W[j].d); }
  dynCollide(dt);
  // deep water stops the car
  const depth = LG.WATER - Math.min(W[0].g, W[1].g, W[2].g, W[3].g);
  F.wet = clamp(depth / 0.7, 0, 1);
  // jumps and landings
  if (F.air === 4) { F.airT += dt; F.landV = Math.max(F.landV, -F.zbV); }
  else {
    if (wasAir && F.airT > 0.18) { const k = clamp(F.landV / 3, 0.3, 2.2); ev('bump', { axle: 'f', k }); ev('bump', { axle: 'r', k }); F.hit = Math.max(F.hit, k * 0.5); if (F.airT > F.air1.best) F.air1.best = F.airT; F.air1.t = F.airT; }
    F.airT = 0; F.landV = 0;
  }
  // the floor on the road throws sparks
  if (dmax > DYN.floor && V0 > 12 && W[0].surf < 2) d.sparkBurst += 18 * SPEC.sparks.rate * Math.min(2, V0 / 40) * dt * 60 / 4;
  F.hit = Math.max(0, F.hit - dt * 3);
  // ---- what the rest of the car reads ----
  const V = Math.hypot(F.u, F.w);
  d.v = V; d.a = F.ax; d.k = V > 1.5 ? F.r / V : 0;
  d.gvx = F.u; d.gvz = F.w; d.gw = F.r;
  d.latG = F.ay / GRAV; d.lonG = F.ax / GRAV;
  d.steer = -F.delta;
  d.abs = F.brk > 0.3 && V > 4 && (F.absF < 0.85 || F.absR < 0.85) ? 1 : 0;
  d.kerbL = W[0].kerb || W[2].kerb ? 1 : 0; d.kerbR = W[1].kerb || W[3].kerb ? 1 : 0;
  d.s = F.s; d.n = F.n;
  F.surf = W[2].surf;
  // tyres crying on the road, wheels on loose ground, how rough it is
  let sq = 0, loose = 0, rough = 0;
  for (let i = 0; i < 4; i++) { const q = W[i]; if (q.F > 0) { if (q.surf < 2) sq = Math.max(sq, q.slip); else if (q.surf < 6) loose += 0.25; rough += LG_SURF[q.surf].rough / 0.03 / 4; } }
  F.sq += (sq - F.sq) * Math.min(1, dt * 14); F.loose += (loose - F.loose) * Math.min(1, dt * 8); F.rough = rough;
  F.odo += V * dt; if (V > F.top) F.top = V;
  freeView();
  freeScore(dt);
}
// the plane the wheels stand on and the body's attitude over it
function freeView() {
  const F = FREE, D = DYN, W = F.wheels, v = F.view, d = DRIVE;
  const tf2 = 2 * AX[0].track, tr2 = 2 * AX[1].track;
  const mean = (W[0].wb + W[1].wb + W[2].wb + W[3].wb) / 4;
  const px = ((W[0].wb + W[1].wb) - (W[2].wb + W[3].wb)) / 2 / WHEELBASE, py = ((W[1].wb - W[0].wb) / tf2 + (W[3].wb - W[2].wb) / tr2) / 2;
  const xo = -D.cgx, xc = (D.a - D.b) / 2;
  v.y = mean + px * (xo - xc); v.pitch = px; v.roll = -py;
  for (let i = 0; i < 4; i++) v.e[i] = W[i].wb - (mean + px * (W[i].x - xc) + py * W[i].y);
  const cs = Math.cos(F.th), sn = Math.sin(F.th);
  v.x = F.x + xo * cs; v.z = F.z + xo * sn;
  d.pitch = clamp(F.pitch - px, -0.14, 0.14); d.roll = clamp(F.roll + py, -0.16, 0.16);
  d.heave = clamp(F.zb + xo * F.pitch - v.y, -0.1, 0.22);
}

/* ---------- lap times, drifts, the speed trap, air time ---------- */
function freeScore(dt) {
  const F = FREE, R = LG.road, L = F.lap, V = Math.hypot(F.u, F.w);
  // the lap: over the line forwards, past every gate in turn
  if (F.roadI >= 0 && Math.abs(F.n) < LG.HW + 6) {
    const sec = R.L / L.gates, g = Math.floor(F.s / sec);
    if (L.on) {
      if (g === L.next % L.gates && (L.next > 0 || F.s < sec * 0.5)) {
        if (L.next === L.gates) {
          L.last = L.t; L.n++; if (!L.best || L.t < L.best) L.best = L.t;
          L.t = 0; L.next = 1; L.split.length = 0; L.flash = 4;
        } else { L.split[L.next - 1] = L.t; L.next++; }
      }
    } else if (F.s < 40 && F.u > 1 && L.prevS > R.L - 60) { L.on = true; L.t = 0; L.next = 1; L.split.length = 0; }
    L.prevS = F.s;
  }
  if (L.on) L.t += dt;
  L.flash = Math.max(0, (L.flash || 0) - dt);
  // drifting: the body at an angle to where it is going, on the road, at speed
  const D = F.drift, beta = Math.atan2(F.w, Math.max(1, Math.abs(F.u)));
  const sliding = Math.abs(beta) > 0.16 && V > 11 && F.air < 2 && F.u > 0 && F.surf < 2;
  if (sliding) { D.score += Math.abs(beta) * V * dt * 6; D.hold = 1.6; D.angle = beta; D.t += dt; }
  else if (D.hold > 0) { D.hold -= dt; if (D.hold <= 0) { if (D.score > 40) { D.banked = Math.round(D.score); D.total += D.banked; D.best = Math.max(D.best, D.banked); D.show = 3; } D.score = 0; D.t = 0; } }
  if (F.hit > 0.3 && D.score > 0) { D.score = 0; D.hold = 0; D.t = 0; }
  D.show = Math.max(0, (D.show || 0) - dt);
  // the speed trap two thirds of the way down the main straight
  const T = F.trap, sT = 420;
  if (F.roadI >= 0 && T.prevS !== undefined && T.prevS < sT && F.s >= sT && F.s - T.prevS < 30) { T.v = V * 3.6; T.best = Math.max(T.best, T.v); T.t = 4; }
  T.prevS = F.s; T.t = Math.max(0, T.t - dt);
}
