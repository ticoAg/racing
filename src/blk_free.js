/* =========================================================================
   FREE DRIVING (the driver's side) — the controls (keyboard, gamepad, touch),
   going out onto the land and coming back, a camera that follows the car,
   and what the driver is shown: the map, lap and sector times, drift scores,
   the speed trap, air time.
   ========================================================================= */
const INPUT = {
  keys: new Set(), raw: { steer: 0, thr: 0, brk: 0, hb: 0, digital: true },
  touch: { steer: 0, thr: 0, brk: 0, hb: 0, on: false }, pad: -1, padT: 0, padPrev: [], lookBack: false, idle: 0,
};
const FREE_KEYS = {
  KeyW: 'thr', ArrowUp: 'thr', KeyS: 'brk', ArrowDown: 'brk', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hb',
  KeyC: 'cam', KeyR: 'reset', KeyT: 'assist', KeyP: 'auto', KeyN: 'tod', KeyB: 'back', Escape: 'leave', KeyL: 'lights',
};

/* ---------- controls ---------- */
function freeAction(a) {
  const F = FREE;
  if (a === 'cam') { if (state.view === 'chase') { if (CHASE.far) { CHASE.far = false; goView('driver'); } else CHASE.far = true; } else goView('chase'); }
  else if (a === 'reset') freeReset();
  else if (a === 'assist') { F.assist.tcs = !F.assist.tcs; F.assist.steer = F.assist.tcs; toast(F.assist.tcs ? '辅助 开' : '辅助 关'); }
  else if (a === 'auto') { F.auto = !F.auto; toast(F.auto ? '自动驾驶' : '手动驾驶'); }
  else if (a === 'tod') { const ids = Object.keys(LAND_TOD); landSetTod(ids[(ids.indexOf(LAND.tod) + 1) % ids.length]); toast(LAND_TOD[LAND.tod].name); }
  else if (a === 'leave') { setPose('park'); syncUI(); }
  else if (a === 'lights') { setLights(!state.lights); syncUI(); }
}
function freeKeys() {
  const down = (e) => {
    if (state.pose !== 'free' || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = FREE_KEYS[e.code];
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    INPUT.keys.add(a); INPUT.padT = 0; INPUT.touch.on = false;
    if (a === 'back') INPUT.lookBack = true;
    else if (FREE.on && !['thr', 'brk', 'left', 'right', 'hb'].includes(a)) freeAction(a);
    else if (FREE.auto && FREE.on) { FREE.auto = false; toast('手动驾驶'); }
  };
  const up = (e) => { const a = FREE_KEYS[e.code]; if (!a) return; INPUT.keys.delete(a); if (a === 'back') INPUT.lookBack = false; };
  window.addEventListener('keydown', down, true);
  window.addEventListener('keyup', up, true);
  window.addEventListener('blur', () => { INPUT.keys.clear(); INPUT.lookBack = false; });
  // touch: the left half of the screen steers (drag sideways), the right carries the pedals
  const el = document.getElementById('touch');
  if (el) {
    const T = INPUT.touch;
    let steerId = null, x0 = 0;
    el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-pedal]');
      T.on = true; INPUT.keys.clear();
      if (b) { T[b.dataset.pedal] = 1; b.setPointerCapture(e.pointerId); b.classList.add('on'); }
      else if (e.target.closest('.touch-steer')) { steerId = e.pointerId; x0 = e.clientX; e.target.setPointerCapture(e.pointerId); }
      if (FREE.auto) { FREE.auto = false; toast('手动驾驶'); }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === steerId) { T.steer = clamp((e.clientX - x0) / 70, -1, 1); const k = el.querySelector('.touch-knob'); if (k) k.style.transform = `translateX(${T.steer * 44}px)`; } });
    const end = (e) => {
      const b = e.target.closest('[data-pedal]');
      if (b) { T[b.dataset.pedal] = 0; b.classList.remove('on'); }
      if (e.pointerId === steerId) { steerId = null; T.steer = 0; const k = el.querySelector('.touch-knob'); if (k) k.style.transform = ''; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    for (const b of el.querySelectorAll('[data-act]')) b.addEventListener('click', () => freeAction(b.dataset.act));
  }
  // the pointer wakes the page's own controls, which step aside while the car is driven
  const wake = () => { INPUT.idle = 0; document.body.classList.remove('drive-idle'); };
  window.addEventListener('pointermove', wake); window.addEventListener('pointerdown', wake);
}
// what the driver is asking for this frame
function freeInput(dt) {
  const I = INPUT, r = I.raw, K = I.keys;
  r.steer = (K.has('right') ? 1 : 0) - (K.has('left') ? 1 : 0); r.thr = K.has('thr') ? 1 : 0; r.brk = K.has('brk') ? 1 : 0; r.hb = K.has('hb') ? 1 : 0; r.digital = true;
  if (I.touch.on) { const T = I.touch; r.steer = Math.sign(T.steer) * Math.pow(Math.abs(T.steer), 1.5); r.thr = T.thr; r.brk = T.brk; r.hb = T.hb; r.digital = false; r.pedals = true; } else r.pedals = false;
  // a gamepad, once it has been touched, takes over: stick, triggers, A handbrake, Y camera, X reset, B look back
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p || !p.connected || p.axes.length < 2) continue;
    const dz = (v) => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9), b = (i) => (p.buttons[i] ? p.buttons[i].value : 0);
    const st = dz(p.axes[0]), th = b(7), br = b(6);
    if (Math.abs(st) + th + br + b(0) > 0.05) { I.padT = 4; I.touch.on = false; }
    if (I.padT > 0) {
      I.padT -= dt;
      r.steer = Math.sign(st) * Math.pow(Math.abs(st), 1.6); r.thr = th; r.brk = br; r.hb = b(0); r.digital = false; r.pedals = true;
      I.lookBack = b(1) > 0.5;
      [[3, 'cam'], [2, 'reset'], [9, 'leave'], [8, 'assist']].forEach(([i, a]) => { const on = b(i) > 0.5; if (on && !I.padPrev[i] && FREE.on) freeAction(a); I.padPrev[i] = on; });
      if (FREE.auto && Math.abs(st) + th + br > 0.2) { FREE.auto = false; toast('手动驾驶'); }
      if (p.axes.length >= 4) CHASE.stick = dz(p.axes[2]);
    }
    break;
  }
  return r;
}

/* ---------- out onto the land and back ---------- */
function freeEnter() {
  const F = FREE, d = DRIVE;
  dynSetup();
  // a car still standing out on the land drives on from where it is; from the studio it starts on the grid
  if (WORLD.mix <= 0.02 || !F.placed) { const p = LG.spawn; freePlace(p.x, p.z, p.th); F.placed = true; Object.assign(F.lap, { on: false, t: 0, next: 0 }); }
  else freePlace(F.view.x, F.view.z, F.th);
  F.on = true; F.leaving = false; F.auto = false;
  d.prog = 'free'; d.t = 0; d.phase = 'go'; d.v = 0; d.gear = 1; d.s = 0; d.n = 0; d.psi = 0; d.k = 0;
  if (d.engine === 0 && d.start <= 0) { d.start = PWR.start.time; ev('start'); }
  if (state.view !== 'driver') goView('chase');
  // the configurator steps aside for the drive and comes back after it
  if (F.panelWas === undefined) { F.panelWas = state.panel; if (state.panel) setPanel(false); }
  document.body.classList.add('is-driving');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  INPUT.idle = 0;
  showKeys(true);
  syncUI();
}
// stopped: the car stays where it stands, parked; the studio comes back round it
function freeLeave(quiet = false) {
  const F = FREE, d = DRIVE;
  F.on = false; F.leaving = false; F.auto = false;
  F.u = F.w = F.r = 0;
  Object.assign(d, { prog: 'park', t: 0, phase: '', v: 0, a: 0, k: 0, gvx: 0, gvz: 0, gw: 0, throttle: 0, brake: 0, gear: 1, slip: 0, s: 0, n: 0, psi: 0, kerbL: 0, kerbR: 0, abs: 0, airbrake: 0, lowDrag: 0, latG: 0, lonG: 0 });
  document.body.classList.remove('is-driving', 'drive-idle');
  showKeys(false);
  if (!quiet && state.view === 'chase') goView('front');
  if (F.panelWas !== undefined) { if (F.panelWas && !quiet) setPanel(true); F.panelWas = undefined; }
  if (!quiet) syncUI();
}
const _fr = { steer: 0, thr: 0, brk: 0, hb: 0, digital: false };
function freeDrive(dt) {
  const F = FREE, d = DRIVE;
  d.t += dt;
  if (state.pose !== 'free' && !F.leaving) F.leaving = true;
  if (state.pose === 'free' && F.leaving) F.leaving = false;
  let raw = freeInput(dt);
  const ready = d.engine >= 1 && WORLD.mix > 0.9;
  if (F.leaving) { raw = Object.assign(_fr, { steer: 0, thr: 0, brk: clamp(0.25 + Math.hypot(F.u, F.w) * 0.02, 0, 0.8), hb: 0, digital: false }); if (F.rev) { _fr.thr = _fr.brk; _fr.brk = 0; } }
  else if (!ready) raw = Object.assign(_fr, { steer: 0, thr: 0, brk: 1, hb: 0, digital: false });
  else if (F.auto) raw = autoDrive(_fr);
  // (held on the brake until the land is out, the gearbox stays in a forward gear)
  if (!ready || F.leaving) { F.rev = F.rev && F.leaving; F.revT = 0; }
  freeAdvance(dt, raw);
  engineStarting(dt);
  if (F.leaving && Math.hypot(F.u, F.w) < 0.06) freeLeave();
  // back on the road after a swim
  if (F.wet > 0.95) { F.wetT += dt; if (F.wetT > 1.6) freeReset(); } else F.wetT = 0;
  // the page's controls step aside while the car is moving and nobody reaches for them
  INPUT.idle += dt;
  document.body.classList.toggle('drive-idle', INPUT.idle > 2.5 && d.v > 2);
}
// back onto the road at the nearest point, facing the way the lap runs
function freeReset() {
  const F = FREE, R = LG.road, o = {};
  let s = 0;
  if (lgRoadAt(F.x, F.z, o)) s = o.s;
  else { let bd = 1e18; for (let i = 0; i < R.n; i += 6) { const d2 = (R.x[i] - F.x) ** 2 + (R.z[i] - F.z) ** 2; if (d2 < bd) { bd = d2; s = i * R.ds; } } }
  const p = lgRoadPose(s, clamp(o.n || 0, -3, 3), o);
  freePlace(p.x, p.z, p.th);
  F.drift.score = 0; F.wetT = 0;
  CHASE.blend = 0; CHASE.init = false;
  toast('回到路面');
}
// a still for the tools: the car on the road at a place and speed, its attitude settled
function freeSnap() {
  const F = FREE, d = DRIVE, K = F.photo || (F.photo = { s: 2065, n: -1.5, kmh: 150, key: '' });
  const key = [K.s, K.n, K.kmh, SPEC.id, state.wing, state.kit].join('|');
  landBuildNow();
  WORLD.kind = 'land'; WORLD.mix = WORLD.target = 1;
  if (K.key === key && F.on) return;
  K.key = key;
  dynSetup();
  const p = lgRoadPose(K.s, K.n, {});
  freePlace(p.x, p.z, p.th);
  F.on = true; F.leaving = false; F.placed = true;
  Object.assign(d, { prog: 'free', engine: 1, start: 0, blip: 0, shiftCut: 0, cut: 0, cutT: 0, slip: 0, phase: 'go', overrun: 0, heat: 0, airbrake: 0, lowDrag: 0 });
  const v = K.kmh / 3.6;
  F.u = v; F.wf = v / AX[0].R; F.wr = v / AX[1].R; d.gear = v > 0 ? gearFor(v) : 1; d.rpm = d.rpmT = Math.max(IDLE, v / CARP.Rr * RATIO[d.gear] * RPM_K);
  // a second or so of driving on the line at that speed lets the body find its attitude
  if (v > 0) { F.auto = true; for (let i = 0; i < 80; i++) { const r = autoDrive(_fr); if (K.thr !== undefined) { r.thr = K.thr; r.brk = K.brk || 0; } else { r.thr = clamp((v - F.u) * 0.5 + 0.3, 0, 1); r.brk = 0; } if (K.steer !== undefined) r.steer = K.steer; if (K.hb) r.hb = K.hb; freeAdvance(1 / 60, r); updateSkid(); } F.auto = false; }
  else freeAdvance(1 / 60, Object.assign(_fr, { steer: 0, thr: 0, brk: 1, hb: 0, digital: false }));
  d.events.length = 0;
  CHASE.init = false; CHASE.blend = 0;
}

/* ---------- a camera that follows ---------- */
const CHASE = { yaw: 0, y: 0, dist: 1, far: false, orbit: 0, tilt: 0, stick: 0, dragT: 9, fov: 56, init: false, blend: 0, from: null,
  pos: new V3(-6.4, 1.9, 0), tgt: new V3(0.4, 1, 0), q: new THREE.Quaternion(), m: new THREE.Matrix4(), up: new V3(0, 1, 0), fq: new THREE.Quaternion(), fp: new V3(), ffov: 30 };
const _cg = {};
function chaseUpdate(dt, snap) {
  const C = CHASE, F = FREE, land = WORLD.kind === 'land' && LAND.built;
  const V = land ? Math.hypot(F.u, F.w) : 0, th = land ? F.th : 0;
  // behind the car along the way it is going rather than the way it points, so a slide is seen from outside it
  const beta = V > 2 && F.u > 0 ? clamp(Math.atan2(F.w, F.u), -0.9, 0.9) : 0;
  let want = th + beta * 0.55;
  if (!C.init || snap) { C.yaw = want; C.y = (land ? F.view.y : 0) + (C.far ? 3.3 : 2.15); C.init = true; }
  let dy = want - C.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
  C.yaw = want - dy * Math.exp(-dt * (3.2 + V * 0.03));
  // looking round: a drag (or the right stick) swings the camera; it comes back by itself once the car is moving
  C.dragT += dt;
  if (Math.abs(C.stick) > 0.05) { C.orbit = C.stick * 2.4; C.dragT = 0.9; }
  else if (C.dragT > 1 && V > 3) { C.orbit *= Math.exp(-dt * 3); C.tilt *= Math.exp(-dt * 3); }
  const a = C.yaw - th + C.orbit + (INPUT.lookBack ? Math.PI : 0);
  const D = (C.far ? 10.5 : 7.1) * C.dist + 1.1 * sstep(0, 95, V) + clamp(-DRIVE.lonG * 0.22, -0.35, 0.45);
  const h = (C.far ? 3.3 : 2.15) + C.tilt * D;
  const cx = VIEW_DX - 0.2, px = cx - D * Math.cos(a), pz = -D * Math.sin(a);
  // height is carried in the land's frame and eased, so that bumps under the car do not shake the picture
  const y0 = land ? F.view.y : 0, yT = y0 + h;
  C.y += (yT - C.y) * (snap ? 1 : 1 - Math.exp(-dt * 7));
  let py = C.y;
  if (land) {
    const cs = Math.cos(th), sn = Math.sin(th);
    lgGround(F.view.x + px * cs - pz * sn, F.view.z + px * sn + pz * cs, _cg, -1);
    py = Math.max(py, Math.max(_cg.h, LG.WATER) + 0.75); C.y = Math.max(C.y, py);
  }
  C.pos.set(px, py - y0, pz);
  C.tgt.set(cx + 1.2, 1.3, 0);
  C.fov = (C.far ? 52 : 56) + 14 * sstep(15, 105, V);
  C.q.setFromRotationMatrix(C.m.lookAt(C.pos, C.tgt, C.up));
  if (C.blend > 0) C.blend = snap ? 0 : Math.max(0, C.blend - dt / 1.5);
}
// from wherever the camera is, in behind the car
function chaseFrom() {
  const C = CHASE;
  C.fp.copy(camera.position); C.fq.copy(camera.quaternion); C.ffov = camera.fov;
  C.blend = reduceMotion || window.__TEST__ ? 0 : 1; C.orbit = 0; C.tilt = 0; C.init = false;
}
function chasePointer() {
  let id = null, x0 = 0, y0 = 0, o0 = 0, t0 = 0;
  canvas.addEventListener('pointerdown', (e) => { if (state.view !== 'chase') return; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; o0 = CHASE.orbit; t0 = CHASE.tilt; });
  window.addEventListener('pointermove', (e) => { if (e.pointerId !== id || state.view !== 'chase') return; CHASE.orbit = o0 - (e.clientX - x0) * 0.008; CHASE.tilt = clamp(t0 + (e.clientY - y0) * 0.003, -0.2, 0.7); CHASE.dragT = 0; needsRender = true; });
  window.addEventListener('pointerup', (e) => { if (e.pointerId === id) id = null; });
  canvas.addEventListener('wheel', (e) => { if (state.view !== 'chase') return; CHASE.dist = clamp(CHASE.dist * Math.exp(e.deltaY * 0.001), 0.7, 2.2); needsRender = true; e.preventDefault(); }, { passive: false });
}

/* ---------- what the driver is shown ---------- */
const FHUD = { last: 0, map: null, path: null, toastT: 0, shown: false, keysT: 0, lapN: 0, trapT: 0, driftShow: 0, airT: 0 };
const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
function toast(text, hold = 2.2) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = text; el.hidden = false; el.classList.add('on');
  FHUD.toastT = hold;
}
function landProgress(f) { toast('生成地形 ' + Math.round(f * 100) + '%', f >= 1 ? 0.4 : 30); needsRender = true; }
function showKeys(on) {
  const el = document.getElementById('keys'); if (!el) return;
  FHUD.keysT = on ? 9 : 0;
  el.classList.toggle('on', on && !INPUT.touch.on);
}
function drawMap() {
  const cv = FHUD.map || (FHUD.map = document.getElementById('minimap'));
  if (!cv) return;
  const ctx = cv.getContext('2d'), S = cv.width, R = LG.road, F = FREE;
  if (!FHUD.path) {
    // the lap fitted to the square, north up
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < R.n; i += 8) { x0 = Math.min(x0, R.x[i]); x1 = Math.max(x1, R.x[i]); z0 = Math.min(z0, R.z[i]); z1 = Math.max(z1, R.z[i]); }
    const k = (S - 22) / Math.max(x1 - x0, z1 - z0), ox = S / 2 - (x0 + x1) / 2 * k, oz = S / 2 - (z0 + z1) / 2 * k;
    const p = new Path2D();
    for (let i = 0; i <= R.n; i += 8) { const j = i % R.n; if (i) p.lineTo(R.x[j] * k + ox, R.z[j] * k + oz); else p.moveTo(R.x[j] * k + ox, R.z[j] * k + oz); }
    p.closePath();
    FHUD.path = { p, k, ox, oz, sx: R.x[0] * k + ox, sz: R.z[0] * k + oz, sth: R.th[0] };
  }
  const P = FHUD.path;
  ctx.clearRect(0, 0, S, S);
  ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(12,13,16,0.55)'; ctx.stroke(P.p);
  ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(236,235,230,0.86)'; ctx.stroke(P.p);
  // the line, then the car: a wedge pointing the way it faces
  ctx.save(); ctx.translate(P.sx, P.sz); ctx.rotate(P.sth); ctx.fillStyle = '#ecebe6'; ctx.fillRect(-1.2, -5, 2.4, 10); ctx.restore();
  ctx.save(); ctx.translate(F.view.x * P.k + P.ox, F.view.z * P.k + P.oz); ctx.rotate(F.th);
  ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, -5); ctx.closePath();
  ctx.fillStyle = '#d0102c'; ctx.strokeStyle = '#0c0d10'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fill(); ctx.restore();
}
function updateFreeHUD(dt, t) {
  const F = FREE, H = FHUD, on = WORLD.kind === 'land' && (F.on || WORLD.mix > 0.5);
  if (on !== H.shown) { H.shown = on; document.body.classList.toggle('land-on', on); }
  const te = document.getElementById('toast');
  if (te && H.toastT > 0) { H.toastT -= dt; if (H.toastT <= 0) te.classList.remove('on'); }
  if (H.keysT > 0) { H.keysT -= dt; if (H.keysT <= 0 || DRIVE.v > 25) showKeys(false); }
  document.body.classList.toggle('touch-on', F.on && INPUT.touch.on);
  if (!on || t - H.last < 0.1) return;
  H.last = t;
  drawMap();
  const L = F.lap;
  setText('hudLap', L.on ? fmtTime(L.t) : '–:––.–');
  setText('hudBest', L.best ? fmtTime(L.best) : '');
  // things worth a word: a lap, the speed trap, a drift banked, a jump landed
  if (L.n !== H.lapN) { H.lapN = L.n; if (L.n) toast((L.last <= L.best ? '最快圈 ' : '圈速 ') + fmtTime(L.last), 4); }
  if (F.trap.t > 0 && H.trapT <= 0) toast('测速 ' + Math.round(F.trap.v) + ' km/h', 3);
  H.trapT = F.trap.t;
  const D = F.drift;
  if (D.score > 60) { toast('漂移 ' + Math.round(D.score), 0.5); H.driftShow = 1; }
  else if (D.show > 0 && H.driftShow) { H.driftShow = 0; toast('漂移 +' + D.banked, 2.4); }
  if (F.air1.t > 0.55 && F.air1.t !== H.airT) { H.airT = F.air1.t; toast('腾空 ' + F.air1.t.toFixed(1) + ' s', 2); }
}
