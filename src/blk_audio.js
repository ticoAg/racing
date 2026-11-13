/* =========================================================================
   SOUND — the engine is synthesised from the crank angle in an AudioWorklet.
   A voice is a firing table over the 720° cycle (angle, exhaust bank,
   strength): twelve even pulses for the V12, ten for the V10, the uneven
   bank sequence of a cross-plane V8; each combustion is a pressure pulse
   whose strength follows the load, with cylinder-to-cylinder spread, ignition
   cuts (shifts, limiter, launch control) and afterfire, all driven by the
   physics rpm. An electric car has no firing table: its motors sing in
   orders of the shaft speed, louder under torque and under regeneration.
   Each model tunes the exhaust tract, the intake, a supercharger or a
   straight-cut gear whine. Exhaust and intake are placed on the car and
   heard from the camera; the cockpit hears the engine through the bulkhead.
   Wind grows with airspeed, tyres scrub at the limit, kerbs rumble and
   patches thump as the wheels cross them, the barriers throw the exhaust
   back and masts whoosh past on the circuit. Showroom music plays in the
   studio.
   ========================================================================= */
const SND = { ctx: null, on: false, eng: null, loading: null };
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

// the engine voice, run on the audio thread
const ENGINE_WORKLET = `
const CYCLE = 4 * Math.PI, TWO_PI = 2 * Math.PI;
class Engine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 30000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    this.ph = 0; this.idx = 0; this.off = 0; this.rpm = 0; this.load = 0; this.s = 918273;
    this.b = [0, 1].map(() => ({ x: 0, y1: 0, y2: 0, hx: 0, hy: 0, burst: 0, bd: 0.997 }));
    this.ia = { x: 0, y1: 0, y2: 0, hx: 0, hy: 0 };
    this.mp = new Float64Array(12); this.mn = 0;
    this.voice(options.processorOptions.voice);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'voice') this.voice(m.voice);
      else if (m.type === 'pop') { const B = this.b[this.rnd() < 0.5 ? 0 : 1]; B.x += m.big ? 7 : 3; B.burst = Math.max(B.burst, m.big ? 0.75 : 0.32); B.bd = m.big ? 0.9988 : 0.9975; }
      else if (m.type === 'crack') { for (const B of this.b) { B.x += 2.6; B.burst = Math.max(B.burst, 0.3); B.bd = 0.9965; } }
    };
  }
  voice(v) {
    this.v = v;
    const f = v.fire || [], n = f.length;
    this.fa = new Float64Array(n); this.fb = new Uint8Array(n); this.fw = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.fa[i] = f[i][0] * Math.PI / 180; this.fb[i] = f[i][1]; this.fw[i] = f[i][2]; }
    // fixed cylinder-to-cylinder spread: the growl under the scream
    this.s = 918273;
    this.spread = new Float32Array(n);
    for (let i = 0; i < n; i++) this.spread[i] = (this.rnd() - 0.5) * v.spread;
    // pick the firing order up where the crank is now
    this.ph %= CYCLE; this.off = 0; this.idx = 0;
    while (this.idx < n && this.fa[this.idx] < this.ph) this.idx++;
    if (this.idx >= n) { this.idx = 0; this.off = CYCLE; }
  }
  rnd() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  process(inputs, outputs, P) {
    const oA = outputs[0][0], oB = outputs[1][0], oI = outputs[2][0], oM = outputs[3] ? outputs[3][0] : null;
    if (!oA) return true;
    const n = oA.length, sr = sampleRate, v = this.v, nf = this.fa.length, ref = v.ref, M = v.motor;
    const r0 = this.rpm, r1 = P.rpm[0], l0 = this.load, l1 = P.load[0], cut = P.cut[0];
    this.rpm = r1; this.load = l1;
    // pulse width in degrees of crank: dull at idle, sharp and bright at the top
    const rm = Math.max(60, 0.5 * (r0 + r1));
    const tau = Math.min(v.tau[1], Math.max(v.tau[0], (v.pulse / 360) / (rm / 60)));
    const a = Math.exp(-1 / (tau * sr)), a2 = a * a, gk = (1 - a) * Math.E;
    const ai = Math.exp(-1 / (tau * 3.2 * sr)), ai2 = ai * ai, gi = (1 - ai) * Math.E;
    // electric motors: each order fades out before it reaches the top of the band
    let mg = null;
    if (M && oM) {
      mg = this.mg || (this.mg = new Float32Array(12));
      const fs = 0.5 * (r0 + r1) / 60, top = Math.min(11000, sr * 0.42), spin = Math.min(1, 0.5 * (r0 + r1) / M.fade);
      for (let j = 0; j < M.tones.length; j++) {
        const T = M.tones[j], f = T[0] * fs;
        mg[j] = T[1] * (T[2] * l1 + T[3] * cut + T[4]) * spin * Math.max(0, Math.min(1, (top - f) / (0.3 * top)));
      }
    }
    for (let i = 0; i < n; i++) {
      const f = (i + 1) / n, rpm = r0 + (r1 - r0) * f, load = l0 + (l1 - l0) * f;
      const dph = rpm / 60 * TWO_PI / sr;
      this.ph += dph;
      while (nf && this.ph >= this.fa[this.idx] + this.off) {
        const c = this.idx;
        if (++this.idx >= nf) { this.idx = 0; this.off += CYCLE; }
        if (rpm > 50) {
          // idle still burns fuel; above it a closed throttle cuts it (overrun)
          const burn = load < 0.04 ? (rpm < v.idleHi ? 0.34 : 0.16) : 0.24 + 0.76 * Math.pow(load, 0.8);
          let amp = burn * this.fw[c] * (0.35 + 0.65 * Math.min(1.15, rpm / ref)) * (1 + this.spread[c] + (this.rnd() - 0.5) * (0.06 + 0.3 * (1 - load)));
          if (this.rnd() < cut) amp *= 0.06;
          this.b[this.fb[c]].x += amp;
          this.ia.x += amp * (0.25 + 0.75 * load);
        }
      }
      if (this.ph > CYCLE) { this.ph -= CYCLE; if (nf) this.off -= CYCLE; }
      const rough = v.rough[0] + v.rough[1] * load;
      for (let k = 0; k < 2; k++) {
        const B = this.b[k];
        const y = 2 * a * B.y1 - a2 * B.y2 + gk * B.x;
        B.x = 0; B.y2 = B.y1; B.y1 = y;
        let s = y * (1 + rough * (this.rnd() * 2 - 1));
        if (B.burst > 1e-4) { s += B.burst * (this.rnd() * 2 - 1); B.burst *= B.bd; }
        const z = s - B.hx + 0.996 * B.hy; B.hx = s; B.hy = z;
        (k ? oB : oA)[i] = z * 0.5;
      }
      const I = this.ia;
      const yi = 2 * ai * I.y1 - ai2 * I.y2 + gi * I.x;
      I.x = 0; I.y2 = I.y1; I.y1 = yi;
      const si = yi + 0.05 * load * Math.min(1.2, rpm / ref) * (this.rnd() * 2 - 1);
      const zi = si - I.hx + 0.995 * I.hy; I.hx = si; I.hy = zi;
      oI[i] = zi * 0.5;
      if (oM) {
        let s = 0;
        if (mg) {
          for (let j = 0; j < M.tones.length; j++) {
            let p = this.mp[j] + M.tones[j][0] * dph;
            if (p > TWO_PI) p -= TWO_PI * Math.floor(p / TWO_PI);
            this.mp[j] = p;
            s += mg[j] * Math.sin(p);
          }
          // air and bearings: a breath that follows the torque
          const w = this.rnd() * 2 - 1;
          this.mn += 0.25 * (w - this.mn);
          s += M.hiss * load * Math.min(1, rpm / M.fade) * (w - this.mn);
        }
        oM[i] = s;
      }
    }
    return true;
  }
}
registerProcessor('engine', Engine);
`;
// what the worklet needs from a model's voice
const workletVoice = (v) => ({ fire: v.fire, ref: v.ref, pulse: v.pulse, tau: v.tau, spread: v.spread, rough: v.rough, idleHi: v.idleHi, motor: v.motor });

async function createSound(ctx, spec = SPEC) {
  const S = {};
  let V = spec.voice, model = spec;
  const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const filt = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; if (to) b.connect(to); return b; };
  const peak = (f, q, db, to) => { const b = filt('peaking', f, q, to); b.gain.value = db; return b; };
  const panner = (x, y, z, to) => {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3.5; p.rolloffFactor = 0.7; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    if (to) p.connect(to);
    return p;
  };
  const out = gain(0);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.25;
  out.connect(comp); comp.connect(ctx.destination);
  const verb = ctx.createConvolver(); verb.buffer = impulseResponse(ctx, 2.6, 3.2);
  verb.connect(gain(0.45, out));
  const carBus = gain(0.62, out);
  const verbSend = gain(0.08, verb); carBus.connect(verbSend);
  const musicBus = gain(0, out); musicBus.connect(gain(0.32, verb));
  const noise = noiseBuffer(ctx, 3);
  const loopNoise = (to) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.connect(to); s.start(0, Math.random() * 2.5); return s; };

  // ---- engine: exhaust banks and intake, placed on the car ----
  const place = (p, x, y, z) => { if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z); };
  const exhPan = panner(XR - 0.1, 0.45, 0, carBus);
  const intPan = panner(V.engineX, 1.08, 0, carBus);
  const exhGain = gain(0, exhPan), intGain = gain(0, intPan);
  const exhCabin = filt('lowpass', 16000, 0.5, exhGain);
  const exhLP = filt('lowpass', 6000, 0.6, exhCabin);
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(V.clip); shaper.oversample = '2x'; shaper.connect(exhLP);
  const drive = gain(1, shaper);
  const exhEq = peak(V.eq[0], 1.4, V.eq[1], drive);
  const exhMid = peak(V.mid[0], 1.1, V.mid[1], exhEq);
  const exhHp = filt('highpass', 34, 0.7, exhMid);
  const intLP = filt('lowpass', 3000, 0.7, intGain);
  const intBox = filt('bandpass', V.intake[0], 0.9, intLP), intSnork = filt('bandpass', V.intake[1], 2.2, intLP);
  // structure-borne boom heard through the bulkhead in the cockpit
  const rumble = gain(0, carBus);
  const rumbleLP = filt('lowpass', 170, 0.8, rumble);
  // two exhaust tracts of slightly different length
  const tractA = peak(V.tract[0], 1.3, 5, exhHp), tractB = peak(V.tract[1], 1.3, 5, exhHp);
  // electric motors: clean, from the middle of the car
  const motPan = panner(0, 0.4, 0, carBus);
  const motGain = gain(0, motPan), motCabin = filt('lowpass', 9000, 0.5, motGain);
  let node = null, fallback = null;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      const url = URL.createObjectURL(new Blob([ENGINE_WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 4, outputChannelCount: [1, 1, 1, 1], processorOptions: { voice: workletVoice(V) } });
      node.connect(tractA, 0);
      node.connect(tractB, 1);
      node.connect(intBox, 2); node.connect(intSnork, 2);
      node.connect(motCabin, 3);
      exhHp.connect(rumbleLP);
    } catch (e) { node = null; }
  }
  if (!node) {
    // older engines: additive voice at the firing frequency
    const parts = [];
    for (const [type, g, mult, det] of [['sawtooth', 0.3, 1, 0], ['sawtooth', 0.18, 1, 9], ['square', 0.09, 0.5, 0], ['triangle', 0.15, 2, -4], ['sine', 0.32, 0.25, 0], ['sine', 0.16, 1 / 6, 0]]) {
      const o = ctx.createOscillator(); o.type = type; o.detune.value = det; o.frequency.value = 100 * mult;
      o.connect(gain(g, exhHp)); o.start(); parts.push({ o, mult });
    }
    const roarBp = filt('bandpass', 900, 0.8, gain(0.3, exhHp)); loopNoise(roarBp);
    fallback = { parts, roarBp };
    exhHp.connect(rumbleLP);
  }
  const mechG = gain(0, intPan); loopNoise(filt('highpass', 4200, 0.8, mechG));
  // supercharger: the rotors' lobes pass the port at a fixed multiple of the crank speed
  const blowG = gain(0, intPan), blowBp = filt('bandpass', 1200, 1.6, blowG);
  const blowO = [1, 2].map((h) => { const o = ctx.createOscillator(); o.type = h === 1 ? 'triangle' : 'sine'; o.connect(gain(h === 1 ? 1 : 0.45, blowBp)); o.start(); return o; });
  loopNoise(gain(0.25, blowBp));
  // straight-cut gears: one mesh turns with the engine, the final drive with the wheels
  const gearG = gain(0, carBus), gearBp = filt('bandpass', 2000, 0.9, gearG);
  const gearO = [0, 1].map((k) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.connect(gain(k ? 0.7 : 1, gearBp)); o.start(); return o; });

  // ---- tyres: rolling roar, scrub at the limit, kerb ridges ----
  const rollG = gain(0, carBus), rollLp = filt('lowpass', 300, 0.6, rollG); loopNoise(rollLp);
  const sq = gain(0, carBus), sqBp = filt('bandpass', 1100, 5, sq);
  const jit = ctx.createOscillator(); jit.frequency.value = 7.3; const jitG = gain(55); jit.connect(jitG); jit.start();
  const jit2 = ctx.createOscillator(); jit2.frequency.value = 2.9; const jitG2 = gain(35); jit2.connect(jitG2); jit2.start();
  for (const [f, g] of [[880, 0.5], [1270, 0.3], [1730, 0.2]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    jitG.connect(o.frequency); jitG2.connect(o.frequency); o.connect(gain(g, sqBp)); o.start();
  }
  loopNoise(filt('bandpass', 2300, 2.5, gain(0.4, sq)));
  const kerbG = gain(0, carBus), kerbLp = filt('lowpass', 420, 0.9, kerbG);
  const kerbO = ctx.createOscillator(); kerbO.type = 'square'; kerbO.frequency.value = 40; kerbO.connect(kerbLp); kerbO.start();
  loopNoise(filt('bandpass', 260, 1.2, gain(0.6, kerbLp)));
  // ---- wind, buffeting, tunnel fan, brakes, transmission ----
  const windG = gain(0, carBus), windBp = filt('bandpass', 500, 0.5, windG), windCab = filt('lowpass', 18000, 0.5, windBp); loopNoise(windCab);
  const hissG = gain(0, carBus); loopNoise(filt('highpass', 3200, 0.7, hissG));
  const buffG = gain(0, carBus); loopNoise(filt('lowpass', 140, 0.9, buffG));
  const buffL = ctx.createOscillator(); buffL.frequency.value = 9; const buffLG = gain(0, buffG.gain); buffL.connect(buffLG); buffL.start();
  const fanG = gain(0, carBus);
  for (const f of [47, 94.5]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(fanG); o.start(); }
  const brkG = gain(0, carBus); loopNoise(filt('bandpass', 3800, 1.2, brkG));
  const abs = ctx.createOscillator(); abs.type = 'square'; abs.frequency.value = 16; const absG = gain(0, brkG.gain); abs.connect(absG); abs.start();
  const whine = ctx.createOscillator(); const whineG = gain(0, carBus); whine.connect(whineG); whine.start();
  // ---- the circuit: barriers throw the exhaust back, one echo per side ----
  const walls = [-1, 1].map((side) => {
    const dl = ctx.createDelay(0.4); dl.delayTime.value = 0.06;
    const g = gain(0); const lp = filt('lowpass', 2600, 0.6);
    const sp = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    exhCabin.connect(dl); motCabin.connect(dl); dl.connect(lp); lp.connect(g);
    if (sp) { sp.pan.value = side * 0.85; g.connect(sp); sp.connect(carBus); } else g.connect(carBus);
    return { side, dl, g };
  });

  // ---- one-shots ----
  const pop = (t, big) => {
    if (!V.fire.length) return;
    if (node) { node.port.postMessage({ type: 'pop', big }); }
    const s = ctx.createBufferSource(); s.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime((big ? 0.5 : 0.2) * V.pop, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + (big ? 0.1 : 0.045));
    s.connect(filt('bandpass', 700 + Math.random() * 1700, 1.1, g)); g.connect(exhCabin);
    s.start(t, Math.random() * 2.5, 0.15);
    if (big) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.13);
      o.connect(og); og.connect(exhCabin); o.start(t); o.stop(t + 0.15);
    }
  };
  const starter = (t) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(130, t); o.frequency.linearRampToValueAtTime(185, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.05); g.gain.setValueAtTime(0.14, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 0.6);
    const trem = ctx.createOscillator(); trem.frequency.value = 9; const tg = ctx.createGain(); tg.gain.value = 0.09; trem.connect(tg); tg.connect(g.gain);
    o.connect(filt('lowpass', 1600, 0.7, g)); g.connect(intPan);
    o.start(t); o.stop(t + 0.65); trem.start(t); trem.stop(t + 0.65);
  };
  // an electric car wakes up: contactors, then two rising notes
  const chime = (t) => {
    for (const [dt, n] of [[0.05, 76], [0.23, 83]]) {
      const o = ctx.createOscillator(); o.frequency.value = mtof(n);
      const o2 = ctx.createOscillator(); o2.frequency.value = mtof(n) * 2.01;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.09, t + dt + 0.012); g.gain.exponentialRampToValueAtTime(0.0004, t + dt + 0.7);
      o.connect(g); o2.connect(gain(0.2, g)); g.connect(motPan); g.connect(gain(0.5, verb));
      o.start(t + dt); o2.start(t + dt); o.stop(t + dt + 0.75); o2.stop(t + dt + 0.75);
    }
  };
  const thunk = (t, f0 = 75, lvl = 0.3, to = carBus) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
    o.connect(g); g.connect(to); o.start(t); o.stop(t + 0.4);
  };
  // a wheel crossing a patch edge: a short thud with a slap of rubber
  const bump = (t, k) => {
    thunk(t, 62, 0.12 * k);
    const s = ctx.createBufferSource(); s.buffer = noise;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * k, t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    s.connect(filt('bandpass', 900, 0.9, g)); g.connect(carBus); s.start(t, Math.random() * 2.5, 0.06);
  };
  // a mast or gantry going past: the exhaust bounced back off it, sweeping down as it passes
  const whoosh = (t, side, k, dur, low) => {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const bp = filt('bandpass', low ? 900 : 1700, 0.9);
    bp.frequency.setValueAtTime(low ? 1100 : 2300, t); bp.frequency.exponentialRampToValueAtTime(low ? 260 : 480, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(k, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0002, t + dur);
    s.connect(bp); bp.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = side * 0.7; g.connect(p); p.connect(carBus); } else g.connect(carBus);
    s.start(t, Math.random() * 2.5, dur + 0.05);
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

  // ---- listener follows the camera ----
  const L = ctx.listener;
  const setListener = (t, cam) => {
    const p = cam.pos, f = cam.fwd, u = cam.up;
    if (L.positionX) {
      const T = (prm, v) => prm.setTargetAtTime(v, t, 0.02);
      T(L.positionX, p.x); T(L.positionY, p.y); T(L.positionZ, p.z);
      T(L.forwardX, f.x); T(L.forwardY, f.y); T(L.forwardZ, f.z);
      T(L.upX, u.x); T(L.upY, u.y); T(L.upZ, u.z);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  };
  const pass = { s: null, gant: null };

  // another model: retune the tracts and filters, hand the worklet its firing table, move the sources
  S.setVoice = (m) => {
    model = m; V = m.voice;
    const t = ctx.currentTime, to = (p, v) => p.setTargetAtTime(v, t, 0.05);
    if (node) node.port.postMessage({ type: 'voice', voice: workletVoice(V) });
    to(tractA.frequency, V.tract[0]); to(tractB.frequency, V.tract[1]);
    to(exhMid.frequency, V.mid[0]); to(exhMid.gain, V.mid[1]); to(exhEq.frequency, V.eq[0]); to(exhEq.gain, V.eq[1]);
    to(intBox.frequency, V.intake[0]); to(intSnork.frequency, V.intake[1]);
    shaper.curve = softClip(V.clip);
    place(exhPan, m.body.XR - 0.1, 0.45, 0); place(intPan, V.engineX, 1.08, 0);
  };
  S.out = out;
  S.worklet = !!node;
  S.update = (t, dt, d, air, aeroOn, cam) => {
    const T = (p, v, tc = 0.03) => p.setTargetAtTime(v, t, tc);
    const on = d.engine >= 1 ? 1 : 0, cranking = d.engine > 0 && d.engine < 1;
    const rpm = Math.max(0, d.rpm), thr = d.throttle;
    const inside = cam && cam.inside ? 1 : 0;
    if (cam) setListener(t, cam);
    // engine: rpm and load go straight to the cylinders; ignition cuts thin the firing
    const cutting = d.cut || d.shiftCut > 0;
    const load = (on ? thr : 0) * (d.shiftCut > 0 ? 0.15 : 1);
    const motor = V.motor;
    // an electric car regenerates off the throttle and under the brakes
    const regen = motor && on ? clamp(Math.max(0, -d.a / GRAV) * 1.2, 0, 1) * sstep(1, 8, d.v) * (thr < 0.05 ? 1 : 0) : 0;
    if (node) {
      T(node.parameters.get('rpm'), on || cranking ? rpm : 0, 0.006);
      T(node.parameters.get('load'), cranking ? (motor ? 0 : 0.35) : load, 0.012);
      T(node.parameters.get('cut'), motor ? regen : cutting ? (d.cut ? 0.7 : 0.92) : 0, motor ? 0.03 : 0.004);
    } else {
      const f = Math.max(60, rpm) / 60 * V.order;
      for (const p of fallback.parts) T(p.o.frequency, f * p.mult, 0.012);
      T(fallback.roarBp.frequency, Math.min(9000, f * 3.2), 0.03);
    }
    const rk = Math.min(1.15, rpm / V.ref);
    T(drive.gain, 1.0 + 1.2 * load, 0.03);
    T(exhLP.frequency, Math.min(16000, V.lp[0] + V.lp[1] * Math.pow(load, 1.2) + rpm * V.lp[2]), 0.04);
    T(exhGain.gain, (on || cranking ? 1 : 0) * (V.exh[0] + V.exh[1] * load + V.exh[2] * rk) * (inside ? 0.62 : 1), 0.03);
    T(intGain.gain, (on || cranking ? 1 : 0) * (V.int[0] + V.int[1] * load) * (0.4 + 0.6 * rk) * (inside ? 2.2 : 1), 0.03);
    T(intLP.frequency, 1600 + 4000 * load, 0.05);
    T(mechG.gain, on * V.mech * rk * rk * (inside ? 1.8 : 1), 0.08);
    // motors, supercharger, gear whine
    T(motGain.gain, motor ? on * motor.gain * (inside ? 0.8 : 1) : 0, 0.05);
    T(motCabin.frequency, inside ? 2600 : 9000, 0.08);
    const BL = V.blower;
    if (BL) {
      const fb = Math.max(20, rpm / 60 * BL.order);
      T(blowO[0].frequency, fb, 0.02); T(blowO[1].frequency, fb * 2.02, 0.02);
      T(blowBp.frequency, clamp(fb * 1.3, 300, 5200), 0.05);
    }
    T(blowG.gain, BL ? on * BL.gain * (0.12 + 0.88 * Math.pow(load, 1.3)) * Math.pow(rk, 1.4) * (inside ? 1.5 : 1) : 0, 0.06);
    const GW = V.whine;
    if (GW) {
      const fe = Math.max(20, rpm / 60 * GW.engine), fw = Math.max(20, d.v / (2 * Math.PI * model.axles[1].R) * GW.wheel);
      T(gearO[0].frequency, fe, 0.02); T(gearO[1].frequency, fw, 0.03);
      T(gearBp.frequency, clamp(0.5 * (fe + fw), 500, 6000), 0.05);
    }
    T(gearG.gain, GW ? on * GW.gain * sstep(2, 20, d.v) * (0.35 + 0.65 * load) * (inside ? 1.7 : 1) : 0, 0.06);
    // the cockpit hears the exhaust through the carbon tub: dulled, with a boom
    T(exhCabin.frequency, inside ? 1500 + 900 * load : 16000, 0.08);
    T(rumble.gain, inside * on * (0.5 + 0.6 * load), 0.06);
    // tyres
    const v = d.v, kmh = v * 3.6, va = Math.max(v, air);
    // off the road the tyres rumble over grass and stones
    const loose = FREE.on ? FREE.loose * sstep(1, 22, v) : 0;
    T(rollLp.frequency, (160 + 8 * kmh) * (1 - 0.45 * loose), 0.1);
    T(rollG.gain, (0.05 * sstep(1, 40, kmh) + 0.07 * clamp(kmh / 300, 0, 1.4)) * (inside ? 0.8 : 1) * (1 + 3.2 * loose), 0.1);
    const lat = Math.abs(d.latG) * GRAV / Math.max(1, latCap(v, planDep()));
    const slip = FREE.on ? clamp(FREE.sq * 1.5, 0, 1.2) : sstep(0.82, 1.0, lat) * 0.85 + sstep(0.8, 1, d.brake) * sstep(10, 30, v) * 0.45 + sstep(0.4, 1, d.slip) * 0.9;
    T(sq.gain, 0.08 * slip, 0.06);
    T(sqBp.frequency, 980 + 260 * slip, 0.1);
    const kerb = Math.max(d.kerbL, d.kerbR);
    T(kerbO.frequency, Math.max(20, v / 0.75), 0.03);
    T(kerbG.gain, 0.16 * kerb * sstep(3, 20, v), 0.02);
    // wind: aerodynamic noise climbs steeply with speed; dull and boomy in the cockpit
    const w2 = Math.pow(va / 70, 2.4);
    T(windBp.frequency, 260 + 7.5 * va, 0.15);
    T(windCab.frequency, inside ? 700 : 18000, 0.1);
    T(windG.gain, 0.1 * w2 * (inside ? 0.75 : 1), 0.15);
    T(hissG.gain, 0.024 * Math.pow(va / 70, 3) * (inside ? 0.25 : 1), 0.15);
    T(buffG.gain, 0.09 * d.airbrake * sstep(20, 60, v), 0.08);
    T(buffLG.gain, 0.05 * d.airbrake * sstep(20, 60, v), 0.08);
    T(fanG.gain, aeroOn && d.engine === 0 && d.start <= 0 ? 0.03 : 0, 0.5);
    T(brkG.gain, 0.035 * d.brake * sstep(5, 40, v) + (FREE.on ? 0.14 * FREE.scrape : 0), 0.05);
    T(absG.gain, d.abs ? 0.02 : 0, 0.05);
    T(whine.frequency, 40 + v * 42, 0.05);
    T(whineG.gain, on * (motor ? 0 : 0.012) * sstep(2, 25, v) * (0.4 + thr) * (inside ? 1.6 : 1), 0.08);
    // the circuit: wall echoes (delay = there and back at the speed of sound), less room reverb outdoors
    // (the open country has no walls to throw the sound back, and no masts to pass)
    const wm = WORLD.mix, wc = WORLD.kind === 'land' ? 0 : wm;
    for (const W of walls) {
      const dist = Math.max(2, TRACK.WALL - W.side * d.n);
      T(W.dl.delayTime, Math.min(0.38, 2 * dist / 343), 0.05);
      T(W.g.gain, wc * on * 0.3 * clamp(7 / dist, 0.2, 1.2) * (inside ? 0.5 : 1), 0.1);
    }
    T(verbSend.gain, lerp(0.08, 0.025, wm), 0.3);
    // masts and gantries passing the camera
    if (wc > 0.5 && v > 8 && cam) {
      const sCam = d.s + cam.pos.x;
      if (pass.s !== null && sCam > pass.s) {
        const D = TRACK.LAMP_D, j0 = Math.floor(pass.s / D), j1 = Math.floor(sCam / D);
        if (j1 > j0 && j1 - j0 < 4) for (const side of [-1, 1]) {
          const lat = Math.abs(side * 15 - d.n - cam.pos.z);
          const k = Math.min(0.09, 0.05 * Math.pow(v / 60, 1.6) * clamp(9 / lat, 0.15, 1));
          if (k > 0.004) whoosh(t + 0.005, side, k, clamp(1.6 / v * 8, 0.1, 0.4), false);
        }
        for (const dc of TRACK.decos) if (dc.kind === 'gantry' && dc.s > pass.s && dc.s <= sCam) whoosh(t + 0.005, 0, Math.min(0.22, 0.12 * Math.pow(v / 60, 1.5)), clamp(3 / v * 6, 0.18, 0.5), true);
      }
      pass.s = sCam;
    } else pass.s = null;
    // events from the drive model, in the order they happened
    for (const e of d.events) {
      const type = e.type || e;
      if (type === 'start') { if (V.starter === 'crank') starter(t); else chime(t); }
      else if (type === 'catch') { if (V.motor) thunk(t, 130, 0.14); else pop(t, true); }
      else if (type === 'up') { if (node && V.fire.length) node.port.postMessage({ type: 'crack' }); else pop(t + 0.01, false); }
      else if (type === 'down') pop(t + 0.03, false);
      else if (type === 'pop') pop(t + Math.random() * 0.01, e.big);
      else if (type === 'stop') thunk(t);
      else if (type === 'bump') bump(t + (e.axle === 'r' ? 0.002 : 0), e.k || 1);
    }
    // music belongs to the static display: it fades out while the engine runs
    const lvl = (d.engine === 0 && d.start <= 0 ? 1 : 0) * (aeroOn ? 0.55 : 1) * 0.95 * (1 - wm);
    T(musicBus.gain, lvl, lvl > 0 ? 0.8 : 0.35);
    if (lvl > 0.02) { mus.quiet = 0; if (!mus.playing) { mus.playing = true; mus.step = 0; mus.next = t + 0.08; } }
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
    const made = SPEC;
    SND.loading = createSound(SND.ctx).then((eng) => {
      SND.eng = eng; SND.loading = null;
      if (SPEC !== made) eng.setVoice(SPEC);   // the model changed while the sound was being set up
      eng.out.gain.setTargetAtTime(SND.on ? 0.9 : 0, SND.ctx.currentTime, 0.08);
    });
  }
  if (SND.ctx) {
    if (on) SND.ctx.resume();
    if (SND.eng) SND.eng.out.gain.setTargetAtTime(on ? 0.9 : 0, SND.ctx.currentTime, 0.08);
    if (!on) setTimeout(() => { if (!SND.on && SND.ctx) SND.ctx.suspend(); }, 450);
  }
  syncUI();
}
const _cam = { pos: new V3(), fwd: new V3(), up: new V3(), inside: false };
function audioFrame(dt) {
  if (SND.on && SND.eng && SND.ctx && SND.ctx.state === 'running') {
    // (the camera as the picture was last taken: the one following the car, or riding in it)
    _cam.pos.copy(CAMRIG.ap); _cam.fwd.set(0, 0, -1).applyQuaternion(CAMRIG.aq); _cam.up.set(0, 1, 0).applyQuaternion(CAMRIG.aq);
    _cam.inside = state.view === 'driver' || (state.view === 'cabin' && camera.position.distanceTo(_cockpitC) < 1.2);
    SND.eng.update(SND.ctx.currentTime, dt, DRIVE, airspeed(), AERO.on, _cam);
  }
  DRIVE.events.length = 0;
}
document.addEventListener('visibilitychange', () => {
  if (!SND.ctx) return;
  if (document.hidden) SND.ctx.suspend(); else if (SND.on) SND.ctx.resume();
});
