/* =========================================================================
   DRIVING — scripted programs, 7-speed gearbox, suspension, brakes, sparks
   ========================================================================= */
const POSES = { park: { name: '静止' }, cruise: { name: '巡航' }, corner: { name: '过弯' }, brake: { name: '制动' } };
const GRAV = 9.81;
const GEAR_TOP = [0, 82, 122, 162, 203, 244, 287, 335];   // km/h at 9000 rpm
const IDLE = 950, REDLINE = 9000, KVIS = 2.5, WHEELBASE = 2.72;
const DRIVE = {
  prog: 'park', t: 0, phase: '', phaseT: 0,
  v: 0, a: 0, k: 0, kVis: 0, throttle: 0, brake: 0,
  gear: 1, rpm: 0, engine: 0, start: 0, idleT: 0, shiftCut: 0, shiftFlash: 0, blip: 0, overrun: 0,
  heat: 0, airbrake: 0, abHold: 0,
  pitch: 0, pitchV: 0, roll: 0, rollV: 0, yaw: 0, lift: 0, steer: 0.17,
  latG: 0, lonG: 0, dist: 0, events: [], shake: new V3(),
};

function driveProgram(dt) {
  const d = DRIVE;
  if (d.prog !== state.pose) {
    d.prog = state.pose; d.t = 0; d.phase = ''; d.phaseT = 0;
    if (d.prog !== 'park' && d.engine === 0 && d.start <= 0) { d.start = 1.15; d.events.push('start'); }
  }
  d.t += dt; d.phaseT += dt;
  let aT = 0, k = 0, thr = 0, brk = 0;
  const v = d.v;
  if (d.start > 0) {
    // cranking, then the engine catches and flares before the car moves off
    d.start -= dt;
    const e = 1.15 - d.start;
    if (e < 0.55) { d.engine = 0.5; d.rpm = 230 + 60 * Math.sin(e * 55); }
    else { if (d.engine < 1) d.events.push('catch'); d.engine = 1; d.rpm = IDLE + 2300 * Math.exp(-(e - 0.55) * 5.5) * sstep(0.55, 0.62, e); }
    d.a = 0; d.throttle = 0; d.brake = 0;
    return;
  }
  switch (d.prog) {
    case 'park':
      if (v > 0.05) { aT = -Math.min(7, v * 1.6 + 1.5); brk = 0.5; } else d.v = 0;
      break;
    case 'cruise': {
      const dv = 150 / 3.6 - v;
      aT = clamp(dv * 0.9, -4, 6.5);
      thr = dv > 0.6 ? 0.35 + 0.65 * clamp(dv / 6, 0, 1) : 0.24;
      brk = aT < -1.5 ? 0.25 : 0;
      k = 0.00045 * Math.sin(d.t * 0.37) + 0.0002 * Math.sin(d.t * 1.13);
      break;
    }
    case 'corner': {
      // left-right chicane: curvature switches sides every 5.5 s
      const ramp = sstep(0, 1.8, d.t);
      const s = Math.tanh(2.8 * Math.sin(2 * Math.PI * (d.t + 2.2) / 11)) / Math.tanh(2.8);
      k = ramp * s / 75;
      const vt = (130 - 13 * Math.abs(s) * ramp) / 3.6, dv = vt - v;
      aT = clamp(dv * 1.3, -9, 6);
      thr = aT > 0.3 ? 0.6 + 0.35 * clamp(aT / 6, 0, 1) : 0.5;
      brk = aT < -2 ? clamp(-aT / 12, 0, 0.6) : 0;
      if (brk > 0) thr = 0;
      break;
    }
    case 'brake': {
      // flat-out run to 230 km/h, maximum braking to 80, short coast, repeat
      if (!d.phase) d.phase = v > 30 ? 'brake' : 'accel';
      if (d.phase === 'accel') {
        aT = 13.5 - 6.2 * (v / 64); thr = 1;
        if (v >= 64) { d.phase = 'brake'; d.phaseT = 0; }
      } else if (d.phase === 'brake') {
        aT = -GRAV * (1.28 + 0.62 * (v / 64) ** 2) * sstep(0, 0.14, d.phaseT); brk = 1;
        if (v <= 22.5) { d.phase = 'coast'; d.phaseT = 0; }
      } else {
        aT = -0.5; thr = 0.12;
        if (d.phaseT > 0.75) { d.phase = 'accel'; d.phaseT = 0; }
      }
      break;
    }
  }
  const sm = (cur, tgt, rate) => cur + (tgt - cur) * (1 - Math.exp(-dt * rate));
  d.a = sm(d.a, aT, 9);
  d.throttle = sm(d.throttle, thr, 14);
  d.brake = sm(d.brake, brk, 16);
  d.k = sm(d.k, k, 5);
  d.v = Math.max(0, d.v + d.a * dt);
  if (d.prog === 'park' && d.v < 0.05) { d.v = 0; d.a = 0; }
}

function gearbox(dt) {
  const d = DRIVE;
  if (d.start > 0) return;
  if (d.engine <= 0) { d.rpm = Math.max(0, d.rpm - dt * 2600); return; }
  // stopped in park: idle, then switch off so the studio music can come back
  if (d.prog === 'park' && d.v === 0) { d.idleT += dt; if (d.idleT > 2.4) { d.engine = 0; d.events.push('stop'); d.gear = 1; return; } }
  else d.idleT = 0;
  const kmh = d.v * 3.6;
  const wr = (g) => kmh / GEAR_TOP[g] * REDLINE;
  d.shiftCut = Math.max(0, d.shiftCut - dt);
  d.shiftFlash = Math.max(0, d.shiftFlash - dt);
  const r = wr(d.gear);
  if (d.shiftCut <= 0) {
    if (d.gear < 7 && ((d.throttle > 0.45 && r > 8550) || (d.throttle <= 0.45 && d.brake < 0.1 && r > 5300))) { d.gear++; d.shiftCut = 0.085; d.shiftFlash = 0.3; d.events.push('up'); }
    else if (d.gear > 1 && ((d.brake > 0.3 && r < 4400) || r < 2300)) { d.gear--; d.shiftCut = 0.1; d.blip = 0.16; d.events.push('down'); }
  }
  let target = Math.max(IDLE, wr(d.gear));
  if (d.v < 4 && d.throttle > 0.2) target = Math.max(target, 2600 + 2400 * d.throttle);
  if (d.blip > 0) { d.blip -= dt; target += 1100; }
  d.rpm += (target - d.rpm) * (1 - Math.exp(-dt * (d.shiftCut > 0 ? 34 : 15)));
  d.rpm = Math.min(d.rpm, 9150);
  // lift-off at high revs: the overrun window when the exhaust crackles
  if (d.throttle < 0.08 && d.rpm > 3000) d.overrun = Math.min(1.8, d.overrun + dt); else d.overrun = 0;
}

const _piv = new V3(0, 0.45, 0), _tmp = new V3();
function updateDrive(dt, t, snap = false) {
  const d = DRIVE;
  if (snap) snapDrive(); else { driveProgram(dt); gearbox(dt); }
  d.kVis = d.k * KVIS;
  d.latG = d.v * d.v * d.k / GRAV;
  d.lonG = d.a / GRAV;
  // brake discs heat up under load and cool with airflow
  if (!snap) {
    d.heat = clamp(d.heat + dt * (d.brake * clamp(d.v / 60, 0, 1.2) * 0.95 - (0.06 + 0.12 * d.v / 64) * (1 - d.brake)), 0, 1.25);
    const abWant = d.brake > 0.5 && d.v > 27;
    if (abWant) d.abHold = 0.45; else d.abHold = Math.max(0, d.abHold - dt);
    d.airbrake += ((abWant || d.abHold > 0 ? 1 : 0) - d.airbrake) * (1 - Math.exp(-dt * 6));
  }
  // suspension: pitch and roll ride on damped springs driven by the g loads
  const pT = 0.022 * d.lonG, rT = -0.021 * d.latG;
  if (snap) { d.pitch = pT; d.roll = rT; d.pitchV = d.rollV = 0; }
  else {
    const h = Math.min(dt, 0.04), wn = 9.5, z = 0.36;
    d.pitchV += (wn * wn * (pT - d.pitch) - 2 * z * wn * d.pitchV) * h; d.pitch += d.pitchV * h;
    d.rollV += (wn * wn * (rT - d.roll) - 2 * z * wn * d.rollV) * h; d.roll += d.rollV * h;
  }
  const liftT = -0.014 * (d.v / 70) ** 2 - 0.004 * Math.abs(d.lonG);
  const yawT = -0.022 * d.latG;
  const inside = state.view === 'cabin' || state.view === 'driver';
  const steerT = d.v < 0.3 && d.prog === 'park' ? (inside ? 0 : 0.17) : -WHEELBASE * d.kVis * 1.45;
  const e = snap ? 1 : 1 - Math.exp(-dt * 5);
  d.lift += (liftT - d.lift) * e; d.yaw += (yawT - d.yaw) * e; d.steer += (steerT - d.steer) * (snap ? 1 : 1 - Math.exp(-dt * 4));
  // road texture and ABS shudder
  const kmh = d.v * 3.6, vib = clamp(kmh / 80, 0, 1.2), abs = d.brake > 0.6 && d.v > 8 ? 1 : 0;
  const roll = d.roll + vib * 0.0005 * Math.sin(t * 7.9);
  const pitch = d.pitch + vib * 0.0004 * Math.sin(t * 5.3 + 0.7);
  const lift = d.lift + vib * (0.001 * Math.sin(t * 13.1) + 0.0005 * Math.sin(t * 29.7 + 1.3)) + abs * 0.0011 * Math.sin(t * 2 * Math.PI * 17);
  car.rotation.set(roll, 0, pitch);
  car.position.copy(_piv).sub(_tmp.copy(_piv).applyEuler(car.rotation)).add(_tmp.set(0, lift, 0));
  carRoot.rotation.y = d.yaw;
  const blurK = sstep(6, 60, kmh);
  for (const w of WHEEL_OBJS) {
    w.userData.spin.rotation.z -= Math.min(d.v / w.userData.R, Math.PI * 2 * 2.4) * dt;
    w.userData.blur.visible = blurK > 0.01;
    w.userData.letters.material.opacity = 1 - 0.85 * blurK;
  }
  M.blur.opacity = 0.8 * blurK;
  for (const p of FRONT_PIVOTS) p.rotation.y = d.steer;
  if (M.discFace) {
    const g = sstep(0.18, 1.0, d.heat);
    M.discFace.emissiveIntensity = g * 2.4;
    M.discFace.emissive.setRGB(1, 0.16 + 0.26 * sstep(0.85, 1.25, d.heat), 0.03 + 0.08 * sstep(0.95, 1.25, d.heat));
  }
  if (M.tail) M.tail.emissiveIntensity = (state.lights ? 2.2 : 0.25) + d.brake * 6;
  d.dist = (d.dist + d.v * 0.42 * dt) % 20000;
  floor.material.uniforms.uFlow.value = clamp(kmh / 120, 0, 1.15);
  floor.material.uniforms.uOffset.value = d.dist;
  floor.material.uniforms.uCurv.value = d.kVis;
  // camera shake: road, braking shudder, cornering load
  const amp = 0.0011 * sstep(5, 60, kmh) + 0.0032 * d.brake * sstep(15, 60, kmh) + 0.0012 * Math.min(2, Math.abs(d.latG));
  d.shake.set(Math.sin(t * 41.3) * 0.6 + Math.sin(t * 23.1), Math.sin(t * 37.7 + 1.1) + Math.sin(t * 19.3) * 0.5, Math.sin(t * 31.1 + 2.3)).multiplyScalar(amp * 0.6);
  sparkSource(dt, snap);
  const moving = d.v > 0.01 || d.start > 0 || d.engine > 0 || Math.abs(d.pitchV) + Math.abs(d.rollV) > 1e-4 || d.heat > 0.01 || d.airbrake > 0.01;
  if (moving) shadowDirty = Math.max(shadowDirty, 2);
  return moving || SPARKS.live > 0;
}

// deterministic stills for screenshots and reduced motion
function snapDrive() {
  const d = DRIVE;
  d.prog = state.pose; d.start = 0; d.blip = 0; d.shiftCut = 0;
  const set = (o) => Object.assign(d, { a: 0, k: 0, throttle: 0, brake: 0, heat: 0, airbrake: 0 }, o);
  if (state.pose === 'park') set({ v: 0, gear: 1, rpm: 0, engine: 0 });
  else if (state.pose === 'cruise') set({ v: 150 / 3.6, gear: 6, throttle: 0.24, engine: 1 });
  else if (state.pose === 'corner') set({ v: 117 / 3.6, gear: 4, throttle: 0.42, k: 1 / 75, engine: 1 });
  else set({ v: 185 / 3.6, gear: 4, brake: 1, a: -GRAV * 1.72, heat: 1.05, airbrake: 1, engine: 1, phase: 'brake' });
  const kmh = d.v * 3.6;
  d.rpm = d.engine ? Math.max(IDLE, kmh / GEAR_TOP[d.gear] * REDLINE) : 0;
}

/* ---------- sparks from the splitter skid blocks under heavy braking ---------- */
const SPARKS = { max: 480, n: 0, live: 0, pos: null, vel: null, age: null, life: null, mesh: null, acc: 0 };
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
const SKIDS = [[1.98, 0.064, -0.3], [1.98, 0.064, 0.3], [2.2, 0.066, 0], [0.35, 0.092, -0.22], [0.35, 0.092, 0.22]];
function emitSpark(world, v) {
  const i = SPARKS.n; SPARKS.n = (SPARKS.n + 1) % SPARKS.max;
  SPARKS.pos[i * 3] = world.x; SPARKS.pos[i * 3 + 1] = Math.max(0.004, world.y); SPARKS.pos[i * 3 + 2] = world.z;
  const s = 0.42;
  SPARKS.vel[i * 3] = -v * s * (0.55 + 0.6 * rand());
  SPARKS.vel[i * 3 + 1] = 0.25 + 1.9 * rand() * rand();
  SPARKS.vel[i * 3 + 2] = (rand() - 0.5) * 2.2;
  SPARKS.age[i] = 0; SPARKS.life[i] = 0.3 + 0.55 * rand();
}
function sparkSource(dt, snap) {
  if (!SPARKS.mesh) return;
  const d = DRIVE;
  const hard = d.prog === 'brake' && d.brake > 0.6 && d.v > 30 && d.pitch < -0.014;
  if (snap) {
    SPARKS.age.fill(1); SPARKS.n = 0;
    if (hard) for (let k = 0; k < 60; k++) { stepSparks(1 / 60, d, true); }
    stepSparks(0, d, false);
    return;
  }
  stepSparks(dt, d, hard);
}
function stepSparks(dt, d, emit) {
  if (emit) {
    SPARKS.acc += dt * 260 * clamp((d.v - 28) / 30, 0, 1.4);
    car.updateMatrixWorld(true);
    while (SPARKS.acc >= 1) {
      SPARKS.acc -= 1;
      const s = SKIDS[Math.floor(rand() * (d.pitch < -0.02 ? 3 : 5)) % SKIDS.length];
      _sp.set(s[0] + (rand() - 0.5) * 0.12, s[1], s[2] + (rand() - 0.5) * 0.08).applyMatrix4(car.matrixWorld);
      _sp.y = 0.004;
      emitSpark(_sp, d.v);
    }
  }
  const N = SPARKS.max, P = SPARKS.pos, V = SPARKS.vel, A = SPARKS.age, L = SPARKS.life;
  const pa = SPARKS.mesh.geometry.attributes.position.array, ca = SPARKS.mesh.geometry.attributes.color.array;
  const gs = 9.81 * 0.42 * 0.42;
  let w = 0;
  for (let i = 0; i < N; i++) {
    if (A[i] >= L[i]) continue;
    A[i] += dt;
    V[i * 3 + 1] -= gs * dt * 6;
    const drag = Math.exp(-dt * 2.2);
    V[i * 3] *= drag; V[i * 3 + 2] *= drag;
    P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
    if (P[i * 3 + 1] < 0.002) { P[i * 3 + 1] = 0.002; V[i * 3 + 1] = Math.abs(V[i * 3 + 1]) * 0.35; }
    const f = A[i] / L[i];
    if (f >= 1) continue;
    const st = 0.045;
    pa[w * 6] = P[i * 3]; pa[w * 6 + 1] = P[i * 3 + 1]; pa[w * 6 + 2] = P[i * 3 + 2];
    pa[w * 6 + 3] = P[i * 3] - V[i * 3] * st; pa[w * 6 + 4] = P[i * 3 + 1] - V[i * 3 + 1] * st; pa[w * 6 + 5] = P[i * 3 + 2] - V[i * 3 + 2] * st;
    const hot = 1 - f, b = 2.2 * hot * hot + 0.3 * hot;
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
  setText('hudGear', d.engine > 0 ? (d.v < 0.5 && d.throttle < 0.05 ? 'N' : String(d.gear)) : '–');
  const rpmEl = document.getElementById('hudRpm');
  if (rpmEl) { rpmEl.style.transform = `scaleX(${clamp(d.rpm / REDLINE, 0, 1).toFixed(3)})`; rpmEl.classList.toggle('red', d.rpm > 8200); }
  setText('hudG', Math.hypot(d.latG, d.lonG).toFixed(2));
  const dot = document.getElementById('hudGDot');
  if (dot) { dot.setAttribute('cx', (32 + clamp(d.latG / 2, -1, 1) * 27).toFixed(1)); dot.setAttribute('cy', (32 + clamp(-d.lonG / 2, -1, 1) * 27).toFixed(1)); }
  const L = aeroLoads(air);
  setText('hudDown', String(Math.round(L.front + L.rear)));
  setText('hudDrag', String(Math.round(L.drag)));
  setText('hudBal', String(Math.round(100 * L.front / Math.max(1, L.front + L.rear))));
}
const setText = (id, s) => { const el = document.getElementById(id); if (el && el.textContent !== s) el.textContent = s; };
