/* =========================================================================
   SOUND — synthesised V12 with gearbox events, tyres, wind, brakes, and
   showroom music for the static display (Web Audio, created on first tap)
   ========================================================================= */
const SND = { ctx: null, on: false, eng: null };
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
function noiseBuffer(ctx, sec) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function impulseResponse(ctx, sec, decay) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate), ramp = 0.004 * ctx.sampleRate;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * Math.min(1, i / ramp); }
  return b;
}
function softClip(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }

function createSound(ctx) {
  const S = {};
  const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const filt = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; if (to) b.connect(to); return b; };
  const out = gain(0);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.25;
  out.connect(comp); comp.connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulseResponse(ctx, 2.6, 3.2);
  verb.connect(gain(0.45, out));
  const carBus = gain(0.62, out); carBus.connect(gain(0.08, verb));
  const musicBus = gain(0, out); musicBus.connect(gain(0.32, verb));
  const noise = noiseBuffer(ctx, 3);
  const loopNoise = (to) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.connect(to); s.start(0, Math.random() * 2.5); return s; };

  // ---- engine: a V12 fires six times per crank revolution ----
  const eng = gain(0, carBus);
  const hp = filt('highpass', 32, 0.7, eng);
  const form = filt('peaking', 600, 1.3, hp); form.gain.value = 5;
  const low = filt('lowshelf', 170, undefined, form); low.gain.value = 5;
  const lp = filt('lowpass', 900, 0.75, low);
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(2.4); shaper.oversample = '2x'; shaper.connect(lp);
  const drive = gain(0.6, shaper);
  const parts = [];
  for (const [type, g, mult, det] of [['sawtooth', 0.3, 1, 0], ['sawtooth', 0.18, 1, 9], ['square', 0.09, 0.5, 0], ['triangle', 0.15, 2, -4], ['sine', 0.32, 0.25, 0], ['sine', 0.16, 1 / 6, 0]]) {
    const o = ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 100 * mult;
    o.connect(gain(g, drive)); o.start(); parts.push({ o, mult });
  }
  const roarG = gain(0, drive), roarBp = filt('bandpass', 900, 0.8, roarG); loopNoise(roarBp);
  const lope = ctx.createOscillator(); lope.frequency.value = 20; const lopeG = gain(0, eng.gain); lope.connect(lopeG); lope.start();
  // ---- tyres ----
  const rollG = gain(0, carBus), rollLp = filt('lowpass', 300, 0.6, rollG); loopNoise(rollLp);
  const sq = gain(0, carBus), sqBp = filt('bandpass', 1100, 5, sq);
  const jit = ctx.createOscillator(); jit.frequency.value = 7.3; const jitG = gain(55); jit.connect(jitG); jit.start();
  const jit2 = ctx.createOscillator(); jit2.frequency.value = 2.9; const jitG2 = gain(35); jit2.connect(jitG2); jit2.start();
  for (const [f, g] of [[880, 0.5], [1270, 0.3], [1730, 0.2]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    jitG.connect(o.frequency); jitG2.connect(o.frequency); o.connect(gain(g, sqBp)); o.start();
  }
  loopNoise(filt('bandpass', 2300, 2.5, gain(0.4, sq)));
  // ---- wind, tunnel fan, brakes, transmission whine ----
  const windG = gain(0, carBus), windBp = filt('bandpass', 500, 0.5, windG); loopNoise(windBp);
  const hissG = gain(0, carBus); loopNoise(filt('highpass', 3200, 0.7, hissG));
  const fanG = gain(0, carBus);
  for (const f of [47, 94.5]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(fanG); o.start(); }
  const brkG = gain(0, carBus); loopNoise(filt('bandpass', 3800, 1.2, brkG));
  const abs = ctx.createOscillator(); abs.type = 'square'; abs.frequency.value = 16; const absG = gain(0, brkG.gain); abs.connect(absG); abs.start();
  const whine = ctx.createOscillator(); const whineG = gain(0, carBus); whine.connect(whineG); whine.start();

  // ---- one-shots ----
  const pop = (t, big) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(big ? 0.75 : 0.35, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + (big ? 0.11 : 0.05));
    s.connect(filt('bandpass', 800 + Math.random() * 1900, 1.1, g)); g.connect(carBus);
    s.start(t, Math.random() * 2.5, 0.15);
    if (big) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.55, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
      o.connect(og); og.connect(carBus); o.start(t); o.stop(t + 0.16);
    }
  };
  const starter = (t) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(130, t); o.frequency.linearRampToValueAtTime(185, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.05); g.gain.setValueAtTime(0.14, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 0.6);
    const trem = ctx.createOscillator(); trem.frequency.value = 9; const tg = ctx.createGain(); tg.gain.value = 0.09; trem.connect(tg); tg.connect(g.gain);
    o.connect(filt('lowpass', 1600, 0.7, g)); g.connect(carBus);
    o.start(t); o.stop(t + 0.65); trem.start(t); trem.stop(t + 0.65);
  };
  const thunk = (t) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
    o.connect(g); g.connect(carBus); o.start(t); o.stop(t + 0.4);
  };

  // ---- showroom music: Dmaj9 – Bm11 – Gmaj9 – A6/9sus at 96 bpm ----
  const STEP = 60 / 96 / 4;
  const CHORDS = [
    { root: 38, pad: [57, 61, 64, 66], arp: [69, 73, 76, 78] },
    { root: 35, pad: [54, 57, 62, 64], arp: [66, 69, 74, 76] },
    { root: 31, pad: [54, 59, 62, 69], arp: [67, 71, 74, 78] },
    { root: 33, pad: [52, 59, 62, 66], arp: [69, 71, 74, 76] },
  ];
  const ARP = [0, 2, 1, 3, 2, 0, 3, 1, 0, 2, 1, 3, 2, 3, 1, 2];
  const padLP = filt('lowpass', 1300, 0.4, musicBus);
  const plfo = ctx.createOscillator(); plfo.frequency.value = 0.07; plfo.connect(gain(450, padLP.frequency)); plfo.start();
  const dly = ctx.createDelay(1.0); dly.delayTime.value = STEP * 3;
  const dlyLp = filt('lowpass', 2400, 0.5); dly.connect(dlyLp); dlyLp.connect(gain(0.32, dly)); dlyLp.connect(gain(0.55, musicBus));
  const arpBus = gain(1, musicBus); arpBus.connect(dly);
  const pad = (t, notes, dur) => {
    for (const n of notes) for (const det of [-8, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.021, t + 1.4); g.gain.setValueAtTime(0.021, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur + 1.4);
      o.connect(g); g.connect(padLP); o.start(t); o.stop(t + dur + 1.5);
    }
  };
  const pluck = (t, n, vel) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator(); o2.frequency.value = mtof(n + 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.065 * vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.38);
    o.connect(g); o2.connect(gain(0.35, g)); g.connect(arpBus);
    o.start(t); o2.start(t); o.stop(t + 0.4); o2.stop(t + 0.4);
  };
  const kick = (t) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
    o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.36);
  };
  const hat = (t, v) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.05);
    s.connect(filt('highpass', 7500, 0.7, g)); g.connect(musicBus); s.start(t, Math.random() * 2.5, 0.06);
  };
  const clap = (t) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    for (const k of [0, 0.011, 0.022]) { g.gain.setValueAtTime(0.1, t + k); g.gain.exponentialRampToValueAtTime(0.01, t + k + 0.009); }
    g.gain.setValueAtTime(0.08, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.18);
    s.connect(filt('bandpass', 1400, 0.9, g)); g.connect(musicBus); s.start(t, Math.random() * 2.5, 0.2);
  };
  const bass = (t, n, dur) => {
    const o = ctx.createOscillator(); o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(n + 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.24, t + 0.012); g.gain.exponentialRampToValueAtTime(0.1, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0003, t + dur);
    o.connect(g); o2.connect(gain(0.28, g)); g.connect(musicBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  };
  const mus = { playing: false, step: 0, next: 0, quiet: 0 };
  const playStep = (n, t) => {
    const bar = Math.floor(n / 16), s = n % 16, ch = CHORDS[Math.floor(bar / 2) % 4], intro = bar < 4;
    if (s === 0 && bar % 2 === 0) pad(t, ch.pad, STEP * 32);
    if (!intro || s % 2 === 0) pluck(t, ch.arp[ARP[s]], s % 4 === 0 ? 1 : 0.6);
    if (!intro) {
      if (s % 4 === 0) kick(t);
      if (s % 4 === 2) { hat(t, 0.055); bass(t, ch.root, STEP * 1.8); }
      if (s === 4 || s === 12) clap(t);
      if (s % 2 === 1) hat(t, 0.016);
    }
  };

  S.out = out;
  S.update = (t, dt, d, air, aeroOn) => {
    const T = (p, v, tc = 0.03) => p.setTargetAtTime(v, t, tc);
    const on = d.engine >= 1 ? 1 : 0;
    const rpm = Math.max(60, d.rpm), f = rpm / 60 * 6;
    for (const p of parts) T(p.o.frequency, f * p.mult, 0.012);
    const thr = d.throttle, cut = d.shiftCut > 0 ? 0.25 : 1;
    T(eng.gain, on * (0.075 + 0.17 * thr + 0.045 * rpm / 9000) * cut, 0.02);
    T(drive.gain, 0.45 + 1.5 * thr, 0.03);
    T(lp.frequency, Math.min(14000, 380 + f * 4.5 + 3800 * thr), 0.03);
    T(form.frequency, Math.min(8000, f * 2.1), 0.03);
    T(roarBp.frequency, Math.min(9000, f * 3.2), 0.03);
    T(roarG.gain, 0.04 + 0.22 * thr, 0.04);
    T(lope.frequency, rpm / 60 * 1.5, 0.05);
    T(lopeG.gain, on * (rpm < 1500 ? 0.03 : 0.012), 0.1);
    const v = d.v, kmh = v * 3.6, va = Math.max(v, air);
    T(rollLp.frequency, 160 + 9 * kmh, 0.1);
    T(rollG.gain, 0.06 * sstep(1, 40, kmh) + 0.05 * clamp(kmh / 250, 0, 1), 0.1);
    const slip = sstep(1.12, 1.75, Math.abs(d.latG)) * 0.9 + sstep(1.45, 1.95, -d.lonG) * 0.55 * d.brake;
    T(sq.gain, 0.085 * slip, 0.06);
    T(sqBp.frequency, 980 + 260 * slip, 0.1);
    T(windBp.frequency, 280 + 9 * va, 0.15);
    T(windG.gain, 0.13 * (va / 70) ** 2, 0.15);
    T(hissG.gain, 0.03 * (va / 70) ** 2, 0.15);
    T(fanG.gain, aeroOn && d.engine === 0 && d.start <= 0 ? 0.03 : 0, 0.5);
    T(brkG.gain, 0.035 * d.brake * sstep(5, 40, v), 0.05);
    T(absG.gain, d.brake > 0.6 && v > 8 ? 0.02 : 0, 0.05);
    T(whine.frequency, 40 + v * 42, 0.05);
    T(whineG.gain, on * 0.012 * sstep(2, 25, v) * (0.4 + thr), 0.08);
    if (on && d.overrun > 0 && d.overrun < 1.6 && Math.random() < dt * 11) pop(t + Math.random() * 0.02, Math.random() < 0.3);
    for (const e of d.events) {
      if (e === 'start') starter(t);
      else if (e === 'catch') pop(t, true);
      else if (e === 'up') pop(t + 0.01, false);
      else if (e === 'down') { pop(t + 0.03, true); pop(t + 0.08, false); }
      else if (e === 'stop') thunk(t);
    }
    // music belongs to the static display: it fades out while the engine runs
    const lvl = (d.engine === 0 && d.start <= 0 ? 1 : 0) * (aeroOn ? 0.55 : 1) * 0.95;
    T(musicBus.gain, lvl, lvl > 0 ? 0.8 : 0.35);
    if (lvl > 0) { mus.quiet = 0; if (!mus.playing) { mus.playing = true; mus.step = 0; mus.next = t + 0.08; } }
    else if (mus.playing && (mus.quiet += dt) > 3) mus.playing = false;
    if (mus.playing) {
      if (mus.next < t - 0.25) mus.next = t + 0.05;
      while (mus.next < t + 0.22) { playStep(mus.step, mus.next); mus.step++; mus.next += STEP; }
    }
  };
  return S;
}

function setSound(on) {
  SND.on = on;
  if (on && !SND.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { SND.on = false; syncUI(); return; }
    SND.ctx = new AC({ latencyHint: 'interactive' });
    SND.eng = createSound(SND.ctx);
  }
  if (SND.ctx) {
    if (on) SND.ctx.resume();
    SND.eng.out.gain.setTargetAtTime(on ? 0.9 : 0, SND.ctx.currentTime, 0.08);
    if (!on) setTimeout(() => { if (!SND.on && SND.ctx) SND.ctx.suspend(); }, 450);
  }
  syncUI();
}
function audioFrame(dt) {
  if (SND.on && SND.ctx && SND.ctx.state === 'running') SND.eng.update(SND.ctx.currentTime, dt, DRIVE, airspeed(), AERO.on);
  DRIVE.events.length = 0;
}
document.addEventListener('visibilitychange', () => {
  if (!SND.ctx) return;
  if (document.hidden) SND.ctx.suspend(); else if (SND.on) SND.ctx.resume();
});
