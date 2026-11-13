// (runs inside tools/sim.js, in the scope of the vehicle model)
const only = ARGV.filter((a) => !a.startsWith('--')), wantLap = ARGV.includes('--lap'), wantAll = !ARGV.some((a) => a.startsWith('--')) || ARGV.includes('--all');
const useCar = (m) => { SPEC = m; AX = m.axles; XF = m.body.XF; XR = m.body.XR; WBASE = AX[0].x - AX[1].x; useModelDrive(m); dynSetup(); state.wing = m.presets[0].wing; state.kit = m.presets[0].kit; };
const fresh = (x = 0, z = 0, th = 0) => {
  Object.assign(DRIVE, { engine: 1, start: 0, gear: 1, rpm: IDLE, rpmT: IDLE, v: 0, shiftCut: 0, blip: 0, cut: 0, cutT: 0, slip: 0, overrun: 0, airbrake: 0, abHold: 0, lowDrag: 0, heat: 0, simT: 0, sparkBurst: 0 });
  DRIVE.events.length = 0;
  Object.assign(FREE.lap, { t: 0, on: false, last: 0, best: 0, n: 0, next: 0 }); FREE.auto = false;
  freePlace(x, z, th);
};
const DT = 1 / 60, raw = { steer: 0, thr: 0, brk: 0, hb: 0, digital: true };
// run for `sec`, the controls set by ctl(t) each frame; watch(t) is called after each frame
const run = (sec, ctl, watch) => { for (let t = 0; t < sec; t += DT) { ctl(t); freeAdvance(DT, raw); DRIVE.events.length = 0; if (watch && watch(t + DT) === false) return t + DT; } return sec; };
const kmh = () => Math.hypot(FREE.u, FREE.w) * 3.6;
const bad = () => !Number.isFinite(FREE.x + FREE.z + FREE.u + FREE.w + FREE.r + FREE.zb + FREE.pitch + FREE.roll + FREE.wr + FREE.wf + DRIVE.rpm);
const fx = (v, n = 2) => +v.toFixed(n);

lgSteps().forEach((f) => f());
const rows = [], laps = [];
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  useCar(m);
  const D = DYN, row = { car: m.name };
  if (wantAll) {
    LG.flat = 1;
    // at rest: nothing moves, the wheels carry the car's weight
    fresh(); Object.assign(raw, { steer: 0, thr: 0, brk: 0, hb: 0, digital: true });
    run(3, () => {});
    const sumF = FREE.wheels.reduce((a, q) => a + q.F, 0);
    row.rest = Math.abs(FREE.u) + Math.abs(FREE.zbV) < 1e-3 && Math.abs(sumF / (CARP.m * GRAV) - 1) < 0.01 ? 'ok' : 'MOVES ' + fx(FREE.u, 3) + ' ' + fx(sumF / (CARP.m * GRAV), 3);
    // standing start, flat out
    fresh();
    let t100 = 0, t200 = 0, t300 = 0, squat = 0, vmax = 0, spin = 0, gmax = 0;
    run(55, () => { raw.thr = 1; raw.brk = 0; raw.steer = 0; }, (t) => {
      const v = kmh(); if (!t100 && v >= 100) t100 = t; if (!t200 && v >= 200) t200 = t; if (!t300 && v >= 300) t300 = t;
      squat = Math.max(squat, DRIVE.pitch); vmax = Math.max(vmax, v); spin = Math.max(spin, DRIVE.slip); gmax = Math.max(gmax, DRIVE.lonG);
    });
    Object.assign(row, { '0-100': fx(t100, 1), '0-200': fx(t200, 1), '0-300': fx(t300, 1) || '–', vmax: fx(vmax, 0), gear: DRIVE.gear, 'acc g': fx(gmax), 'squat°': fx(squat * 57.3) });
    // stop from 200 km/h
    fresh(); FREE.u = 200 / 3.6; FREE.wf = FREE.u / AX[0].R; FREE.wr = FREE.u / AX[1].R; DRIVE.gear = gearFor(FREE.u);
    let x0 = FREE.x, dive = 0, bg = 0, yawB = 0;
    const tb = run(12, () => { raw.thr = 0; raw.brk = 1; }, () => { dive = Math.min(dive, DRIVE.pitch); bg = Math.min(bg, DRIVE.lonG); yawB = Math.max(yawB, Math.abs(FREE.th)); return kmh() > 1; });
    Object.assign(row, { 'stop m': fx(FREE.x - x0, 0), 'brake g': fx(bg), 'dive°': fx(dive * 57.3), 'yaw°': fx(yawB * 57.3, 1) });
    // steady cornering: full lock held at 100 and at 200 km/h
    for (const v0 of [100, 200]) {
      fresh(); FREE.u = v0 / 3.6; FREE.wf = FREE.u / AX[0].R; FREE.wr = FREE.u / AX[1].R; DRIVE.gear = gearFor(FREE.u);
      let lat = 0, beta = 0, rollM = 0, n = 0;
      run(7, (t) => { raw.steer = t > 0.5 ? 1 : 0; raw.brk = 0; raw.thr = clamp((v0 / 3.6 - FREE.u) * 0.4 + 0.25, 0, 1); raw.digital = true; }, (t) => {
        if (t > 4) { lat += DRIVE.latG; beta = Math.max(beta, Math.abs(Math.atan2(FREE.w, FREE.u))); rollM += DRIVE.roll; n++; }
      });
      row['lat g@' + v0] = fx(lat / n); row['slip°@' + v0] = fx(beta * 57.3, 1); if (v0 === 100) row['roll°'] = fx(rollM / n * 57.3);
    }
    // a sudden swerve at 160 km/h: full lock for 0.6 s, the other way for 0.6 s, then hands off
    fresh(); FREE.u = 160 / 3.6; FREE.wf = FREE.u / AX[0].R; FREE.wr = FREE.u / AX[1].R; DRIVE.gear = gearFor(FREE.u);
    let bSw = 0, bEnd = 0;
    run(6, (t) => { raw.steer = t < 0.5 ? 0 : t < 1.1 ? 1 : t < 1.7 ? -1 : 0; raw.thr = 0.3; raw.brk = 0; }, (t) => { const b = Math.abs(Math.atan2(FREE.w, Math.abs(FREE.u))); bSw = Math.max(bSw, b); if (t > 5) bEnd = Math.max(bEnd, b, Math.abs(FREE.r)); });
    row['swerve°'] = fx(bSw * 57.3, 1); row['settles'] = bEnd < 0.03 ? 'yes' : 'NO ' + fx(bEnd, 2);
    // flat out from a slow corner (60 km/h, half lock): with traction control, and without
    for (const tcs of [true, false]) {
      fresh(); FREE.assist.tcs = tcs; FREE.u = 60 / 3.6; FREE.wf = FREE.u / AX[0].R; FREE.wr = FREE.u / AX[1].R; DRIVE.gear = gearFor(FREE.u);
      let b = 0;
      run(5, (t) => { raw.steer = 0.55; raw.thr = t > 1 ? 1 : 0.3; raw.brk = 0; }, () => { b = Math.max(b, Math.abs(Math.atan2(FREE.w, Math.abs(FREE.u)))); });
      row[tcs ? 'exit°' : 'exit° no tc'] = fx(b * 57.3, 0);
    }
    FREE.assist.tcs = true;
    // handbrake turn at 80 km/h: how far the car comes round in 1.2 s, and whether it drives on afterwards
    fresh(); FREE.u = 80 / 3.6; FREE.wf = FREE.u / AX[0].R; FREE.wr = FREE.u / AX[1].R; DRIVE.gear = gearFor(FREE.u);
    let thH = 0;
    run(6, (t) => { raw.steer = t < 1.4 ? 1 : 0; raw.hb = t > 0.2 && t < 1.4 ? 1 : 0; raw.thr = t > 1.4 ? 0.5 : 0; raw.brk = 0; }, (t) => { if (t < 1.5) thH = FREE.th; });
    row['hb turn°'] = fx(thH * 57.3, 0); row['after'] = fx(kmh(), 0) + (Math.abs(FREE.r) < 0.15 ? '' : ' spinning');
    // reverse: brake held from rest
    fresh();
    run(4, () => { raw.steer = 0; raw.thr = 0; raw.brk = 1; raw.hb = 0; });
    row.rev = fx(FREE.u * 3.6, 0);
    if (bad()) row.rest = 'NaN';
    LG.flat = 0;
  }
  rows.push(row);
  if (wantLap || wantAll) {
    // a lap of the map by the built-in driver, from the grid
    const sp = LG.spawn;
    fresh(sp.x, sp.z, sp.th);
    FREE.auto = true;
    let off = 0, maxN = 0, hits = 0, vtop = 0, air = 0, latMax = 0, tEnd = 0, minV = 999, bMax = 0, stuck = 0;
    const R = LG.road, trace = [];
    run(420, () => { autoDrive(raw); }, (t) => {
      const v = kmh();
      if (t > 8) { maxN = Math.max(maxN, Math.abs(FREE.n)); if (!FREE.onRoad) off += DT; minV = Math.min(minV, v); if (v < 5) stuck += DT; }
      if (FREE.hit > 0.4) hits++;
      vtop = Math.max(vtop, v); if (FREE.air === 4) air += DT; latMax = Math.max(latMax, Math.abs(DRIVE.latG));
      bMax = Math.max(bMax, Math.abs(Math.atan2(FREE.w, Math.max(5, FREE.u))));
      if (ARGV.includes('--trace') && Math.round(t * 60) % 30 === 0) trace.push([fx(t, 1), fx(FREE.s, 0), fx(FREE.n, 1), fx(v, 0), DRIVE.gear, fx(DRIVE.latG, 2), fx(DRIVE.lonG, 2), fx(Math.atan2(FREE.w, Math.max(5, FREE.u)) * 57.3, 1), fx(R.k[R.W(Math.round(FREE.s))] ? 1 / R.k[R.W(Math.round(FREE.s))] : 0, 0)].join('\t'));
      tEnd = t;
      return !(FREE.lap.n >= 1) && !bad();
    });
    laps.push({ car: m.name, lap: FREE.lap.n ? fx(FREE.lap.last, 1) : 'DNF at s=' + fx(FREE.s, 0) + (bad() ? ' NaN' : ''), 'avg km/h': FREE.lap.n ? fx(R.L / FREE.lap.last * 3.6, 0) : '–', top: fx(vtop, 0), slowest: fx(minV, 0), 'lat g': fx(latMax), 'max |n|': fx(maxN, 1), 'off road s': fx(off, 1), hits, 'air s': fx(air, 1), 'slip°': fx(bMax * 57.3, 0) });
    if (trace.length) console.log('t\ts\tn\tkm/h\tgear\tlatG\tlonG\tbeta\tR\n' + trace.join('\n'));
  }
}
if (wantAll) {
  console.table(MODELS.filter((m) => !only.length || only.includes(m.id)).map((m) => { useCar(m); const D = DYN; return { car: m.name, 'kf N/mm': fx(D.kf / 1000, 0), 'kr N/mm': fx(D.kr / 1000, 0), 'sag mm': fx(D.sag * 1000, 0), 'bar f/r kNm': fx(D.arb[0] / 1000, 0) + '/' + fx(D.arb[1] / 1000, 0), Iyy: fx(D.Iyy, 0), Ixx: fx(D.Ixx, 0), Izz: fx(D.Izz, 0), 'slip peak°': fx(D.ap * 57.3, 1) }; }));
  console.table(rows);
}
if (laps.length) console.table(laps);
