/* =========================================================================
   DRIVING — vehicle model from the active model's spec: torque curve and
   gearbox (dual-clutch, automatic, sequential or a single electric
   reduction), tyres with load sensitivity, aero drag/downforce, ABS brakes
   with a torque cap, traction and launch control, active low-drag trim at
   V-max; a speed planner over the road ahead; suspension on damped springs
   whose attitude (pitch, roll, squat, ride height, rake) is the model's own;
   sparks; telemetry
   ========================================================================= */
const POSES = { park: { name: '静止' }, cruise: { name: '巡航' }, corner: { name: '过弯' }, brake: { name: '制动' }, free: { name: '自由驾驶' } };
const GRAV = 9.81, RHO = 1.225;
const RPM_K = 60 / (2 * Math.PI);
// set by useModelDrive
let CARP, PWR, SUSP, STANCE, EV, IDLE, REDLINE, LIMITER, UPSHIFT, REDZONE, LAUNCH_RPM, WHEELBASE, VCAP, GEAR_TOP, RATIO, TQ, NGEAR, SKIDS;
function useModelDrive(m) {
  PWR = m.power; SUSP = m.susp; STANCE = m.stance; EV = PWR.type === 'ev';
  WHEELBASE = WBASE;
  CARP = Object.assign({ Rr: AX[1].R }, m.chassis);
  IDLE = PWR.idle; REDLINE = PWR.redline; LIMITER = PWR.limiter; UPSHIFT = PWR.upshift; REDZONE = PWR.redzone; LAUNCH_RPM = PWR.launch;
  VCAP = PWR.vcap / 3.6;
  GEAR_TOP = PWR.gearTop; NGEAR = GEAR_TOP.length - 1;
  RATIO = GEAR_TOP.map((v) => (v ? (REDLINE / RPM_K) * CARP.Rr / (v / 3.6) : 0));   // engine turns per rear-wheel turn
  TQ = PWR.torque;
  SKIDS = [[XF - 0.42, 0.064, -0.3], [XF - 0.42, 0.064, 0.3], [XF - 0.2, 0.066, 0], [0.35, 0.092, -0.22], [0.35, 0.092, 0.22]];
}
function engineTorque(rpm) {
  if (rpm <= 0) return TQ[0][1];
  for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) return lerp(TQ[i - 1][1], TQ[i][1], (rpm - TQ[i - 1][0]) / (TQ[i][0] - TQ[i - 1][0]));
  return TQ[TQ.length - 1][1];
}
// closed throttle: pumping losses, or regeneration in an electric car
const engineBrakeTq = (rpm) => (rpm > IDLE ? PWR.engineBrake[0] + PWR.engineBrake[1] * rpm : 0);
// the lowest gear that carries a speed without running into the limiter
function gearFor(v) {
  for (let g = 1; g <= NGEAR; g++) if (v / CARP.Rr * RATIO[g] * RPM_K <= UPSHIFT) return g;
  return NGEAR;
}
const gearLabel = () => (DRIVE.engine > 0 ? (DRIVE.gear < 0 ? 'R' : DRIVE.v < 0.5 && DRIVE.throttle < 0.05 ? 'N' : EV ? 'D' : String(DRIVE.gear)) : '–');

const DRIVE = {
  prog: 'park', t: 0, phase: '', phaseT: 0, simT: 0,
  s: 0, n: 0, psi: 0, v: 0, a: 0, k: 0, throttle: 0, brake: 0,
  gear: 1, rpm: 0, rpmT: 0, engine: 0, start: 0, idleT: 0, shiftCut: 0, shiftFlash: 0, blip: 0, overrun: 0, cut: 0, cutT: 0, slip: 0,
  heat: 0, airbrake: 0, abHold: 0, lowDrag: 0, abs: 0,
  pitch: 0, pitchV: 0, roll: 0, rollV: 0, heave: 0, heaveV: 0, yaw: 0, steer: 0.17,
  latG: 0, lonG: 0, kerbL: 0, kerbR: 0, events: [], shake: new V3(), sparkBurst: 0,
  gvx: 0, gvz: 0, gw: 0,   // how the ground moves under the car: its speed forward and to the right, its yaw rate
  hurry: false,
};
const ev = (type, o) => DRIVE.events.push(Object.assign({ type, t: DRIVE.simT }, o));

/* ---------- aero and tyre capability ---------- */
const _cf = { clF: 0, clR: 0, cd: 0 };
function aeroCoeffs(dep, ab) {
  const C = SPEC.aero, track = state.kit === 'track';
  let clF = C.clF + (track ? C.clFKit : 0), clR = C.clR, cd = C.cd + (track ? C.cdKit : 0);
  const W = state.wing === 'gt' ? C.gt : state.wing === 'active' ? C.active : null;
  if (W) { clR += W.cl[0] + W.cl[1] * dep + W.cl[2] * ab; cd += W.cd[0] + W.cd[1] * dep + W.cd[2] * ab; }
  _cf.clF = clF; _cf.clR = clR; _cf.cd = cd;
  return _cf;
}
const _af = { f: 0, r: 0, drag: 0 };
function aeroForces(v, dep, ab, out = _af) {
  const q = 0.5 * RHO * v * v, c = aeroCoeffs(dep, ab);
  out.f = q * CARP.A * c.clF; out.r = q * CARP.A * c.clR; out.drag = q * CARP.A * c.cd;
  return out;
}
const tyreMu = (Fz) => CARP.mu0 * Math.pow(Math.max(0.3, Fz / (CARP.m * GRAV)), -CARP.muLoad);
function latCap(v, dep) { const A = aeroForces(v, dep, 0), Fz = CARP.m * GRAV + A.f + A.r; return tyreMu(Fz) * Fz / CARP.m; }
const brakeForceMax = (Fz) => Math.min(0.97 * tyreMu(Fz) * Fz, CARP.brkCap * CARP.m * GRAV);
function brakeCap(v, dep) { const A = aeroForces(v, dep, 1), Fz = CARP.m * GRAV + A.f + A.r; return (brakeForceMax(Fz) + A.drag + CARP.crr * Fz) / CARP.m; }
function cornerSpeed(k, dep) {
  if (k < 2e-5) return 1e3;
  let v = 60;
  for (let i = 0; i < 6; i++) v = Math.sqrt(latCap(v, dep) * 0.95 / k);
  return v;
}
const planDep = () => (state.wingUp && state.wing !== 'none' ? 1 : 0);

/* ---------- speed planner: corner limits, then a braking pass backwards ---------- */
const PLAN = { N: 240, ds: 4, v: new Float32Array(240), k: new Float32Array(240), s0: 0 };
function planSpeed(sc, vcap) {
  const P = PLAN, dep = planDep();
  for (let i = 0; i < P.N; i++) {
    const s = sc + i * P.ds;
    const k = Math.max(Math.abs(kAt(s)), Math.abs(kAt(s + P.ds * 0.5)));
    P.k[i] = k; P.v[i] = Math.min(vcap, cornerSpeed(k, dep));
  }
  for (let i = P.N - 2; i >= 0; i--) {
    const vn = P.v[i + 1], use = Math.min(0.97, vn * vn * P.k[i + 1] / latCap(vn, dep));
    const a = brakeCap(vn, dep) * 0.96 * Math.sqrt(Math.max(0.12, 1 - use * use));
    P.v[i] = Math.min(P.v[i], Math.sqrt(vn * vn + 2 * a * P.ds));
  }
  P.s0 = sc;
}
function planAt(s) { const P = PLAN, f = clamp((s - P.s0) / P.ds, 0, P.N - 1.001), i = Math.floor(f); return P.v[i] + (P.v[i + 1] - P.v[i]) * (f - i); }

/* ---------- the driver ---------- */
function driverCommand() {
  const d = DRIVE, P = CARP, W = P.m * GRAV;
  planSpeed(d.s, d.prog === 'cruise' ? VCAP : Math.min(VCAP, 330 / 3.6));
  const look = Math.max(5, d.v * 0.3);
  const vRef = planAt(d.s + look), vNow = planAt(d.s);
  let aNeed = (vRef * vRef - d.v * d.v) / (2 * look);
  const dep = clamp(wingDeploy, 0, 1);
  if (d.v > vNow + 0.3) aNeed = Math.min(aNeed, -brakeCap(d.v, dep));
  const A = aeroForces(d.v, dep, d.airbrake), Fz = W + A.f + A.r;
  const r = RATIO[d.gear];
  const mEff = P.m + P.Iw / (P.Rr * P.Rr) + P.Ie * (r / P.Rr) ** 2;
  const Fdmax = Math.max(1, engineTorque(Math.max(d.rpmT, 2500)) * r * P.eta / P.Rr);
  const Feb = engineBrakeTq(d.rpmT) * r * P.eta / P.Rr;
  const Fneed = mEff * aNeed + A.drag + P.crr * Fz;
  let thr = clamp((Fneed + Feb) / (Fdmax + Feb), 0, 1), brk = 0;
  if (vRef - d.v > 1.2 && aNeed > 0) thr = 1;
  if (Fneed < -Feb) { thr = 0; brk = clamp((-Fneed - Feb) / brakeForceMax(Fz), 0, 1); }
  return [thr, brk];
}

function programChange() {
  const d = DRIVE, prev = d.prog;
  d.prog = state.pose; d.t = 0; d.phaseT = 0;
  if (d.prog === 'park') { d.phase = ''; return; }
  // from the studio the car is placed on a fresh grid; while driving the new program takes over the road ahead
  if (WORLD.mix < 0.02 && d.v < 0.5) { trackReset(d.prog); d.s = 0; d.n = racingN(0); d.v = 0; d.gear = 1; }
  else trackSwitch(d.prog, d.s, d.v);
  d.phase = d.v > 0.5 ? 'go' : 'wait';
  if (d.engine === 0 && d.start <= 0) { d.start = PWR.start.time; ev('start'); }
}

// cranking, then the engine catches and flares; an electric car closes its contactors and is ready. True while it lasts
function engineStarting(dt) {
  const d = DRIVE;
  if (d.start <= 0) return false;
  d.start -= dt; d.simT += dt;
  const e = PWR.start.time - d.start;
  if (EV) { if (e < PWR.start.time * 0.6) d.engine = 0.5; else { if (d.engine < 1) ev('catch'); d.engine = 1; } d.rpm = 0; }
  else if (e < 0.55) { d.engine = 0.5; d.rpm = 230 + 60 * Math.sin(e * 55); }
  else { if (d.engine < 1) ev('catch'); d.engine = 1; d.rpm = IDLE + PWR.start.flare * Math.exp(-(e - 0.55) * 5.5) * sstep(0.55, 0.62, e); }
  d.rpmT = d.rpm; d.a = 0; d.throttle = 0; d.brake = 1;
  return true;
}
function driveProgram(dt) {
  const d = DRIVE;
  // out in the open country the car is driven, not run through a program (blk_free.js)
  if (FREE.on) { freeDrive(dt); return; }
  // (a car with parts off is put together before it starts)
  if (d.prog !== state.pose && !XPL.any) {
    const want = state.pose, kind = want === 'free' ? 'land' : 'track';
    // the other world is still out: the car is parked and switched off first, and the studio comes back in between
    if (want !== 'park' && WORLD.mix > 0.02 && WORLD.kind !== kind) { if (d.prog !== 'park') { d.prog = 'park'; d.t = 0; d.phase = ''; } d.hurry = true; }
    else if (want === 'free') { if (landBuildStep()) { WORLD.kind = 'land'; d.hurry = false; freeEnter(); return; } }
    else { if (want !== 'park') { WORLD.kind = 'track'; d.hurry = false; } programChange(); }
  }
  d.t += dt; d.phaseT += dt;
  if (engineStarting(dt)) return;
  let thr = 0, brk = 0;
  if (d.prog === 'park') {
    if (d.v > 0.05) brk = clamp(0.2 + d.v * 0.012, 0, 0.55); else { d.v = 0; brk = 0.4; }
  } else if (d.engine < 1 || WORLD.mix < 0.97) {
    brk = 1; d.phase = 'wait';
  } else {
    if (d.phase === 'wait') { d.phase = d.v > 0.5 || EV ? 'go' : 'launch'; d.phaseT = 0; if (EV && d.v <= 0.5) ev('launch'); }
    if (d.phase === 'launch') {
      // launch control: brake held, revs held at the launch limiter, then release
      thr = 1; brk = 1;
      if (d.phaseT > 0.85) { d.phase = 'go'; ev('launch'); }
    } else [thr, brk] = driverCommand();
  }
  const sm = (cur, tgt, rate) => cur + (tgt - cur) * (1 - Math.exp(-dt * rate));
  d.throttle = d.phase === 'launch' ? sm(d.throttle, thr, 20) : sm(d.throttle, thr, 13);
  d.brake = d.phase === 'launch' ? 1 : sm(d.brake, brk, brk > d.brake ? 16 : 22);
  // active aero: trim the wing for top speed on the straight, stand it up as an airbrake under hard braking
  const ldWant = d.prog === 'cruise' && d.v > SPEC.aero.lowDrag / 3.6 && d.brake < 0.05 && Math.abs(d.k) < 1 / 1500 ? 1 : 0;
  d.lowDrag += (ldWant - d.lowDrag) * (1 - Math.exp(-dt * 1.6));
  const abWant = d.brake > 0.5 && d.v > 27;
  if (abWant) d.abHold = 0.45; else d.abHold = Math.max(0, d.abHold - dt);
  d.airbrake += ((abWant || d.abHold > 0 ? 1 : 0) - d.airbrake) * (1 - Math.exp(-dt * 6));
  const n = Math.max(1, Math.ceil(dt * 240));
  for (let i = 0; i < n; i++) physStep(dt / n);
  // stopped in park: idle, then switch off so the studio can come back
  if (d.prog === 'park' && d.v === 0 && d.engine >= 1) { d.idleT += dt; if (d.idleT > (d.hurry ? 0.5 : 2.4)) { d.engine = 0; ev('stop'); d.gear = 1; } }
  else d.idleT = 0;
}

const _edges = [];
function physStep(h) {
  const d = DRIVE, P = CARP, W = P.m * GRAV;
  d.simT += h;
  const running = d.engine >= 1;
  const dep = clamp(wingDeploy, 0, 1);
  const A = aeroForces(d.v, dep, d.airbrake);
  const Fz = W + A.f + A.r, mu = tyreMu(Fz);
  const r = RATIO[d.gear];
  const wheelRpm = d.v / P.Rr * r * RPM_K;
  // engine speed: the clutch slips while pulling away in first, otherwise it follows the rear wheels (plus any wheelspin)
  const slipping = !EV && d.gear === 1 && d.v < 9 && (d.throttle > 0.05 || d.phase === 'launch');
  let rpmT;
  if (!running) rpmT = 0;
  else if (EV) rpmT = wheelRpm * (1 + 0.1 * d.slip);   // motors are geared straight to the wheels
  else if (d.phase === 'launch' && d.v < 0.2) rpmT = LAUNCH_RPM;
  else if (slipping) rpmT = Math.max(wheelRpm, lerp(LAUNCH_RPM, wheelRpm, d.v / 9));
  else rpmT = Math.max(IDLE, wheelRpm * (1 + 0.1 * d.slip));
  // ignition cuts: rev limiter, launch control, gear shifts
  d.cutT = Math.max(0, d.cutT - h);
  if (running && !EV && (rpmT >= LIMITER || (d.phase === 'launch' && d.rpm > LAUNCH_RPM + 150))) d.cutT = 0.03;
  d.cut = d.cutT > 0 ? 1 : 0;
  d.shiftCut = Math.max(0, d.shiftCut - h); d.blip = Math.max(0, d.blip - h); d.shiftFlash = Math.max(0, d.shiftFlash - h);
  let Te = 0;
  if (running) Te = d.throttle * engineTorque(rpmT) * (d.cut || d.shiftCut > 0 ? 0.12 : 1) - (1 - d.throttle) * engineBrakeTq(rpmT);
  let Fd = Te * r * P.eta / P.Rr;
  if (d.v < 0.3 && Fd < 0) Fd = 0;
  // traction: load on the driven wheels (the rear axle with longitudinal transfer and rear downforce, or all four),
  // shared with the cornering force
  const Fzr = W * (P.a / WHEELBASE) + P.m * d.a * P.h / WHEELBASE + A.r;
  const lat = Math.min(0.95, Math.abs(d.v * d.v * d.k) / (mu * Fz / P.m));
  const FxMax = mu * (P.awd ? Fz : Fzr) * Math.sqrt(1 - lat * lat);
  let slip = 0;
  if (Fd > FxMax) { slip = Math.min(1, (Fd - FxMax) / FxMax * 2.5); Fd = FxMax * 1.02; }
  d.slip += (slip - d.slip) * (1 - Math.exp(-h * 18));
  const moving = d.v > 0.05;
  const Fb = d.brake * brakeForceMax(Fz) * (moving ? 1 : 0);
  d.abs = d.brake > 0.85 && d.v > 8 ? 1 : 0;
  const Fres = moving ? A.drag + P.crr * Fz : 0;
  const mEff = P.m + P.Iw / (P.Rr * P.Rr) + (slipping ? 0 : P.Ie * (r / P.Rr) ** 2);
  let acc = (Fd - Fb - Fres) / mEff;
  // at rest the brakes hold the car until the drive force beats them
  if (!moving && (acc < 0 || Fd <= d.brake * brakeForceMax(Fz))) acc = 0;
  d.a = acc;
  d.v = Math.max(0, d.v + acc * h);
  const s0 = d.s;
  d.s += d.v * h;
  // engine speed as heard and shown: follows the target, flares on downshift blips
  if (running) d.rpm += (rpmT + (d.blip > 0 ? PWR.shift.flare : 0) - d.rpm) * (1 - Math.exp(-h * (d.shiftCut > 0 ? 42 : 26)));
  else d.rpm = Math.max(0, d.rpm - h * 2600);
  d.rpmT = rpmT;
  // gearbox: upshift just under the limiter, downshift as soon as the lower gear fits under braking
  if (running && d.shiftCut <= 0 && d.phase !== 'launch') {
    const S = PWR.shift;
    if (d.gear < NGEAR && rpmT > UPSHIFT) { d.gear++; d.shiftCut = S.up; d.shiftFlash = 0.3; ev('up', { rpm: d.rpm }); }
    else if (d.gear > 1) {
      const lower = d.v / P.Rr * RATIO[d.gear - 1] * RPM_K;
      if ((d.brake > 0.15 && lower < S.downBrake) || (d.throttle > 0.6 && lower < S.kickTo && rpmT < S.kickBelow)) { d.gear--; d.shiftCut = S.down; d.blip = S.blip; ev('down', { rpm: lower }); }
    }
  }
  // overrun: unburnt fuel crackles in the hot exhaust right after a lift
  const PP = PWR.pops;
  if (running && PP && d.throttle < 0.08 && d.rpm > PP.rpm && d.v > 5) {
    d.overrun += h;
    const rate = PP.rate * Math.exp(-d.overrun * 1.3) + PP.tail;
    if (rand() < rate * h) ev('pop', { big: rand() < PP.big });
  } else d.overrun = 0;
  // where the car is on the road
  d.k = kAt(d.s);
  d.n = racingN(d.s);
  d.psi = Math.atan2(racingN(d.s + 2) - racingN(d.s - 2), 4);
  // wheels on kerbs
  const half = TRACK.W / 2;
  const onK = (sw, nw) => Math.abs(nw) > half - 0.1 && inRanges(TRACK.kerbs, sw, Math.sign(nw));
  const fa = AX[0], ra = AX[1];
  d.kerbL = onK(d.s + fa.x, d.n - fa.track) || onK(d.s + ra.x, d.n - ra.track) ? 1 : 0;
  d.kerbR = onK(d.s + fa.x, d.n + fa.track) || onK(d.s + ra.x, d.n + ra.track) ? 1 : 0;
  // patch edges under each axle: a jolt for the springs, a thump for the sound
  if (moving) for (const [off, ax] of [[fa.x, 'f'], [ra.x, 'r']]) {
    _edges.length = 0;
    patchEdges(s0 + off, d.s + off, _edges);
    for (let i = 0; i < _edges.length; i++) {
      const k = Math.min(1.6, Math.sqrt(d.v / 30));
      d.heaveV -= 0.07 * k * SUSP.bump; d.pitchV += (ax === 'f' ? -0.09 : 0.09) * k * SUSP.bump;
      ev('bump', { axle: ax, k });
      if (d.v > 60 && d.heave < -0.02) d.sparkBurst += 26 * SPEC.sparks.rate;
    }
  }
}

/* ---------- per frame: physics, suspension, wheels, lights, camera shake ---------- */
const _piv = new V3(0, 0.45, 0), _tmp = new V3(), _sa = { f: 0, r: 0, drag: 0 };
function updateDrive(dt, t, snap = false) {
  const d = DRIVE;
  if (snap) snapDrive(); else driveProgram(dt);
  const free = FREE.on, S = SUSP;
  if (!free) { d.latG = d.v * d.v * d.k / GRAV; d.lonG = d.a / GRAV; d.gvx = d.v; d.gvz = 0; d.gw = d.v * d.k; }
  // brake discs heat up under load and cool with airflow
  if (!snap) d.heat = clamp(d.heat + dt * (d.brake * clamp(d.v / 60, 0, 1.4) * 0.95 - (0.06 + 0.12 * d.v / 64) * (1 - d.brake)), 0, 1.25);
  const inside = state.view === 'cabin' || state.view === 'driver';
  if (!free) {
    // suspension: load transfer and aero compression drive pitch, roll and heave springs
    const A = aeroForces(d.v, clamp(wingDeploy, 0, 1), d.airbrake, _sa);
    const cF = A.f / CARP.KF, cR = A.r / CARP.KR;
    const pT = S.pitch * d.lonG + (cR - cF) / WHEELBASE, rT = -S.roll * d.latG;
    const hT = -(cF * -AX[1].x + cR * AX[0].x) / WHEELBASE - S.heave * Math.abs(d.lonG);
    if (snap) { d.pitch = pT; d.roll = rT; d.heave = hT; d.pitchV = d.rollV = d.heaveV = 0; }
    else {
      const n = Math.max(1, Math.ceil(dt / 0.01)), h = dt / n;
      for (let i = 0; i < n; i++) {
        d.pitchV += (S.wp * S.wp * (pT - d.pitch) - 2 * S.zp * S.wp * d.pitchV) * h; d.pitch += d.pitchV * h;
        d.rollV += (S.wr * S.wr * (rT - d.roll) - 2 * S.zr * S.wr * d.rollV) * h; d.roll += d.rollV * h;
        d.heaveV += (S.wh * S.wh * (hT - d.heave) - 2 * S.zh * S.wh * d.heaveV) * h; d.heave += d.heaveV * h;
      }
    }
    const yawT = -S.yaw * d.latG;
    // steering: geometry plus a little understeer, steering column ratio 13:1 in the cockpit
    const steerT = d.v < 0.3 && d.prog === 'park' && WORLD.mix < 0.5 ? (inside || XPL.live ? 0 : 0.17) : WORLD.kind === 'land' ? 0 : -(WHEELBASE * d.k + S.understeer * d.latG) * 1.35;
    const e = snap ? 1 : 1 - Math.exp(-dt * 5);
    d.yaw += (yawT - d.yaw) * e; d.steer += (steerT - d.steer) * (snap ? 1 : 1 - Math.exp(-dt * 6));
  } else { d.yaw = 0; d.pitchV = d.rollV = d.heaveV = 0; }
  // road texture, kerb ridges and ABS shudder
  const kmh = d.v * 3.6, vib = clamp(kmh / 80, 0, 1.8), abs = d.abs;
  const kf = d.v / 0.75, kerb = d.kerbL - d.kerbR;
  const roll = d.roll + vib * 0.0004 * Math.sin(t * 7.9) + 0.0035 * kerb * Math.sin(t * 2 * Math.PI * Math.min(kf, 45));
  const pitch = d.pitch + vib * 0.0003 * Math.sin(t * 5.3 + 0.7);
  const lift = d.heave + vib * (0.0008 * Math.sin(t * 13.1) + 0.0004 * Math.sin(t * 29.7 + 1.3)) + abs * 0.001 * Math.sin(t * 2 * Math.PI * 17)
    + 0.0022 * (d.kerbL + d.kerbR) * Math.abs(Math.sin(t * Math.PI * Math.min(kf, 45)));
  // the model's static stance (ride height, rake) under the moving attitude
  car.rotation.set(roll, 0, pitch + STANCE.rake);
  car.position.copy(_piv).sub(_tmp.copy(_piv).applyEuler(car.rotation)).add(_tmp.set(0, lift - STANCE.drop, 0));
  carRoot.rotation.y = d.yaw;
  // out on the land the wheels stand on the ground under each of them and the body rides over them; as the studio
  // comes back the car is set level again
  const onLand = WORLD.kind === 'land' && (free || WORLD.mix > 0) ? (free ? 1 : sstep(0, 0.6, WORLD.mix)) : 0, fv = FREE.view;
  carRoot.rotation.x = Math.atan(fv.roll) * onLand; carRoot.rotation.z = Math.atan(fv.pitch) * onLand;
  MODEL_PIVOTS.forEach((p, i) => { p.position.y = AX[i < 2 ? 0 : 1].yc + fv.e[i] * onLand; });
  // the wheels turn at their own speed: spinning up under power, locked under the handbrake
  const cap = Math.PI * 2 * 2.4;
  let blurK = sstep(6, 60, kmh);
  WHEEL_OBJS.forEach((w, i) => {
    const om = free ? (i < 2 ? FREE.wf : FREE.wr) : d.v / w.userData.R;
    w.userData.spin.rotation.z -= clamp(om, -cap, cap) * dt;
    if (free) blurK = Math.max(i < 2 ? 0 : blurK, sstep(6, 60, Math.abs(om) * w.userData.R * 3.6));
    w.userData.blur.visible = blurK > 0.01;
  });
  for (const w of WHEEL_OBJS) w.userData.letters.material.opacity = 1 - 0.85 * blurK;
  M.blur.opacity = 0.8 * blurK;
  for (const p of FRONT_PIVOTS) p.rotation.y = d.steer;
  if (M.discFace) {
    const g = sstep(0.18, 1.0, d.heat);
    M.discFace.emissiveIntensity = g * 2.4;
    M.discFace.emissive.setRGB(1, 0.16 + 0.26 * sstep(0.85, 1.25, d.heat), 0.03 + 0.08 * sstep(0.95, 1.25, d.heat));
  }
  if (M.tail) M.tail.emissiveIntensity = (state.lights ? 2.2 : 0.25) + d.brake * 6;
  // camera shake: road, braking shudder, cornering load, buffeting at very high speed
  const amp = 0.001 * sstep(5, 60, kmh) + 0.0011 * sstep(220, 400, kmh) + 0.003 * d.brake * sstep(15, 60, kmh) + 0.0011 * Math.min(2, Math.abs(d.latG)) + 0.0016 * (d.kerbL + d.kerbR) + (free ? 0.02 * FREE.hit + 0.0016 * FREE.rough * sstep(3, 30, kmh) : 0);
  d.shake.set(Math.sin(t * 41.3) * 0.6 + Math.sin(t * 23.1), Math.sin(t * 37.7 + 1.1) + Math.sin(t * 19.3) * 0.5, Math.sin(t * 31.1 + 2.3)).multiplyScalar(amp * 0.6);
  sparkSource(dt, snap);
  const moving = d.v > 0.01 || d.start > 0 || d.engine > 0 || Math.abs(d.pitchV) + Math.abs(d.rollV) + Math.abs(d.heaveV) > 1e-4 || d.heat > 0.01 || d.airbrake > 0.01;
  if (moving) shadowDirty = Math.max(shadowDirty, 2);
  return moving || SPARKS.live > 0;
}

// deterministic stills for screenshots
function snapDrive() {
  const d = DRIVE;
  if (state.pose === 'free') { freeSnap(); return; }
  if (FREE.on) freeLeave(true);
  WORLD.kind = 'track';
  d.prog = state.pose; d.start = 0; d.blip = 0; d.shiftCut = 0; d.cut = 0; d.cutT = 0; d.slip = 0; d.phase = 'go'; d.overrun = 0;
  const set = (o) => Object.assign(d, { a: 0, throttle: 0, brake: 0, heat: 0, airbrake: 0, lowDrag: 0, kerbL: 0, kerbR: 0 }, o);
  if (state.pose === 'park') { set({ v: 0, gear: 1, rpm: 0, engine: 0, k: 0 }); WORLD.mix = WORLD.target = 0; return; }
  trackReset(state.pose);
  d.s = TRACK.photo; d.n = racingN(d.s); d.psi = Math.atan2(racingN(d.s + 2) - racingN(d.s - 2), 4); d.k = kAt(d.s);
  WORLD.mix = WORLD.target = 1;
  const ST = SPEC.stills;
  if (state.pose === 'cruise') set({ v: ST.cruise / 3.6, gear: gearFor(ST.cruise / 3.6), throttle: ST.cruiseThrottle, engine: 1, lowDrag: ST.cruise > SPEC.aero.lowDrag ? 1 : 0 });
  else if (state.pose === 'corner') { const v = cornerSpeed(Math.abs(d.k), planDep()); set({ v, gear: gearFor(v), throttle: 0.5, engine: 1 }); }
  else { set({ v: ST.brake / 3.6, gear: gearFor(ST.brake / 3.6), brake: 1, heat: 1.05, airbrake: 1, engine: 1 }); d.a = -brakeCap(d.v, planDep()); }
  d.rpm = d.rpmT = Math.max(IDLE, d.v / CARP.Rr * RATIO[d.gear] * RPM_K);
}

/* ---------- sparks from the skid blocks: heavy braking and bottoming out ---------- */
const SPARKS = { max: 520, n: 0, live: 0, pos: null, vel: null, age: null, life: null, mesh: null, acc: 0 };
function buildSparks() {
  const N = SPARKS.max;
  SPARKS.pos = new Float32Array(N * 3); SPARKS.vel = new Float32Array(N * 3);
  SPARKS.age = new Float32Array(N).fill(1); SPARKS.life = new Float32Array(N).fill(1);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(new Float32Array(N * 6), 3); pa.setUsage(THREE.DynamicDrawUsage);
  const ca = new THREE.BufferAttribute(new Float32Array(N * 6), 3); ca.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', ca);
  g.setDrawRange(0, 0);
  SPARKS.mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  SPARKS.mesh.frustumCulled = false;
  SPARKS.mesh.userData.noShadow = true;
  scene.add(SPARKS.mesh);
}
const _sp = new V3();
function emitSpark(world, v) {
  const i = SPARKS.n; SPARKS.n = (SPARKS.n + 1) % SPARKS.max;
  SPARKS.pos[i * 3] = world.x; SPARKS.pos[i * 3 + 1] = Math.max(0.004, world.y); SPARKS.pos[i * 3 + 2] = world.z;
  // scraped off the plank they keep some of the car's speed, then the air drags them back to road speed
  SPARKS.vel[i * 3] = -v * (0.25 + 0.5 * rand());
  SPARKS.vel[i * 3 + 1] = 0.4 + 2.4 * rand() * rand();
  SPARKS.vel[i * 3 + 2] = (rand() - 0.5) * 3.2;
  SPARKS.age[i] = 0; SPARKS.life[i] = 0.18 + 0.4 * rand();
}
function sparkSource(dt, snap) {
  if (!SPARKS.mesh) return;
  const d = DRIVE;
  const hard = SPEC.sparks.rate > 0 && d.brake > 0.6 && d.v > 30 && d.pitch < SPEC.sparks.pitch;
  if (snap) {
    SPARKS.age.fill(1); SPARKS.n = 0;
    if (hard) for (let k = 0; k < 40; k++) stepSparks(1 / 120, d, true);
    stepSparks(0, d, false);
    return;
  }
  stepSparks(dt, d, hard);
}
function stepSparks(dt, d, emit) {
  let want = emit ? dt * 300 * SPEC.sparks.rate * clamp((d.v - 28) / 30, 0, 1.4) : 0;
  if (d.sparkBurst > 0) { want += d.sparkBurst; d.sparkBurst = 0; }
  if (want > 0) {
    SPARKS.acc += want;
    car.updateMatrixWorld(true);
    while (SPARKS.acc >= 1) {
      SPARKS.acc -= 1;
      const s = SKIDS[Math.floor(rand() * (d.pitch < SPEC.sparks.pitch * 0.667 ? 3 : 5)) % SKIDS.length];
      _sp.set(s[0] + (rand() - 0.5) * 0.12, s[1], s[2] + (rand() - 0.5) * 0.08).applyMatrix4(car.matrixWorld);
      _sp.y = 0.004;
      emitSpark(_sp, d.v);
    }
  }
  const N = SPARKS.max, P = SPARKS.pos, V = SPARKS.vel, A = SPARKS.age, L = SPARKS.life;
  const pa = SPARKS.mesh.geometry.attributes.position.array, ca = SPARKS.mesh.geometry.attributes.color.array;
  const drag = 1 - Math.exp(-dt * 3.5);
  let w = 0;
  for (let i = 0; i < N; i++) {
    if (A[i] >= L[i]) continue;
    A[i] += dt;
    V[i * 3 + 1] -= GRAV * dt;
    V[i * 3] += (-d.gvx + d.gw * P[i * 3 + 2] - V[i * 3]) * drag; V[i * 3 + 2] += (-d.gvz - d.gw * P[i * 3] - V[i * 3 + 2]) * drag;
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    if (P[i * 3 + 1] < 0.002) { P[i * 3 + 1] = 0.002; V[i * 3 + 1] = Math.abs(V[i * 3 + 1]) * 0.35; }
    const f = A[i] / L[i];
    if (f >= 1) continue;
    // streak = distance travelled during a 1/120 s exposure
    const st = 1 / 120;
    pa[w * 6] = P[i * 3]; pa[w * 6 + 1] = P[i * 3 + 1]; pa[w * 6 + 2] = P[i * 3 + 2];
    pa[w * 6 + 3] = P[i * 3] - V[i * 3] * st; pa[w * 6 + 4] = P[i * 3 + 1] - V[i * 3 + 1] * st; pa[w * 6 + 5] = P[i * 3 + 2] - V[i * 3 + 2] * st;
    const hot = 1 - f, b = 2.4 * hot * hot + 0.3 * hot;
    const r = b * 1.0, g = b * (0.35 + 0.55 * hot * hot), bl = b * 0.12 * hot * hot * hot;
    ca[w * 6] = r; ca[w * 6 + 1] = g; ca[w * 6 + 2] = bl;
    ca[w * 6 + 3] = r * 0.15; ca[w * 6 + 4] = g * 0.08; ca[w * 6 + 5] = 0;
    w++;
  }
  SPARKS.live = w;
  const g = SPARKS.mesh.geometry;
  g.setDrawRange(0, w * 2);
  g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
}

/* ---------- telemetry readout ---------- */
const HUD = { el: null, last: -1, shown: false };
function updateHUD(t, force = false) {
  if (!HUD.el) HUD.el = document.getElementById('hud');
  if (!HUD.el) return;
  const d = DRIVE;
  const show = d.engine > 0 || d.start > 0 || AERO.on;
  if (show !== HUD.shown) { HUD.shown = show; document.body.classList.toggle('hud-on', show); }
  if (!show || (!force && t - HUD.last < 0.08)) return;
  HUD.last = t;
  const air = airspeed();
  const kmh = Math.round(Math.max(d.v, air) * 3.6);
  setText('hudSpeed', String(kmh));
  setText('hudGear', gearLabel());
  const rpmEl = document.getElementById('hudRpm');
  if (rpmEl) { rpmEl.style.transform = `scaleX(${clamp(d.rpm / REDLINE, 0, 1).toFixed(3)})`; rpmEl.classList.toggle('red', d.rpm > REDZONE); }
  setText('hudG', Math.hypot(d.latG, d.lonG).toFixed(2));
  const dot = document.getElementById('hudGDot');
  if (dot) { dot.setAttribute('cx', (32 + clamp(d.latG / 3, -1, 1) * 27).toFixed(1)); dot.setAttribute('cy', (32 + clamp(-d.lonG / 3, -1, 1) * 27).toFixed(1)); }
  const L = aeroLoads(air);
  setText('hudDown', String(Math.round(L.front + L.rear)));
  setText('hudDrag', String(Math.round(L.drag)));
  setText('hudBal', String(Math.round(100 * L.front / Math.max(1, L.front + L.rear))));
}
const setText = (id, s) => { const el = document.getElementById(id); if (el && el.textContent !== s) el.textContent = s; };
