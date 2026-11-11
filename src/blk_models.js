/* =========================================================================
   MODELS — every car is one spec: body curves and hard points, axles and
   tyres, aero parts, lights and vents, powertrain, chassis, suspension
   attitude, pose stills, engine voice and style presets. The H9 is the base;
   the others state only what differs. All four share the carbon tub, the
   canopy and the butterfly doors.
   ========================================================================= */
const isPlain = (o) => o && typeof o === 'object' && !Array.isArray(o);
function mergeSpec(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = isPlain(base[k]) ? mergeSpec(base[k], {}) : base[k];
  for (const k of Object.keys(over)) out[k] = isPlain(over[k]) && isPlain(base[k]) ? mergeSpec(base[k], over[k]) : over[k];
  return out;
}
// firing events over the 720° cycle: [crank angle (deg), exhaust bank, strength]
const evenFire = (n) => Array.from({ length: n }, (_, i) => [(i + 1) * 720 / n, i & 1, 1]);
// cross-plane V8: even 90° overall, but each bank fires 180-270-180-90; a pulse that follows close behind another
// in the same manifold is weaker, one after a long gap stronger (the burble)
const crossPlaneFire = () => {
  const banks = [0, 1, 0, 1, 1, 0, 1, 0], last = [0, 0], out = [];
  // each bank's last firing of the previous cycle, for the gap before its first one
  for (let i = 0; i < 8; i++) last[banks[i]] = i * 90 - 720;
  for (let i = 0; i < 8; i++) {
    const b = banks[i], gap = i * 90 - last[b];
    last[b] = i * 90;
    out.push([(i + 1) * 90, b, gap <= 90 ? 0.6 : gap >= 270 ? 1.25 : 1]);
  }
  return out;
};
// 90° V10 on common crank pins: the banks take turns 90° and 54° apart (each bank even at 144°), which puts
// the half orders (2.5, 7.5 per revolution) beside the firing order: the howl
const oddFireV10 = () => Array.from({ length: 10 }, (_, i) => [Math.floor(i / 2) * 144 + (i & 1 ? 144 : 90), i & 1, 1]);

const H9 = {
  id: 'h9', name: 'H9', mark: ['H', '9'], tag: 'V12', number: '9',
  body: {
    XF: 2.40, XR: -2.22,
    nose: { LC: 0.36, NFC: 2.3, rake: 0.06 },
    tail: { LR: 0.16, CEND: 0.86, face: 'grille' },
    // side sculpting depths (m): door channel, intake scoop (between scoopX front and rear wall), shoulder ledge, rocker crease
    side: { channel: 0.032, scoop: 0.135, scoopX: [-0.20, -0.80], ledge: 0.016, rocker: 0.02 },
    // shut lines on top: bonnet [x of the rear edge, half width, x of the front end], engine cover likewise
    seams: { hood: [0.985, 0.60, 2.16], deck: [-1.30, 0.66, -2.10] },
    // design curves along X, [keys, blur]: half width, belt line, crown, centre line, valley half width, section exponent, tuck, sill, floor
    curves: {
      a: [[[2.5, 0.86], [2.25, 0.905], [2.0, 0.955], [1.75, 0.99], [1.45, 1.005], [1.15, 0.995], [0.85, 0.962], [0.45, 0.948], [0.0, 0.948], [-0.4, 0.958], [-0.75, 0.99], [-1.05, 1.03], [-1.32, 1.042], [-1.6, 1.03], [-1.9, 1.0], [-2.3, 0.965]], 0.06],
      yb: [[[2.5, 0.28], [2.25, 0.33], [2.0, 0.44], [1.75, 0.57], [1.45, 0.645], [1.2, 0.63], [0.95, 0.575], [0.6, 0.535], [0.0, 0.525], [-0.45, 0.55], [-0.8, 0.64], [-1.05, 0.735], [-1.32, 0.775], [-1.6, 0.745], [-1.9, 0.69], [-2.3, 0.625]], 0.05],
      crown: [[[2.5, 0.40], [2.3, 0.46], [2.05, 0.57], [1.8, 0.69], [1.5, 0.775], [1.25, 0.792], [1.0, 0.785], [0.7, 0.778], [0.3, 0.778], [-0.2, 0.785], [-0.6, 0.81], [-0.95, 0.865], [-1.2, 0.912], [-1.4, 0.92], [-1.7, 0.895], [-2.0, 0.862], [-2.3, 0.842]], 0.05],
      cy: [[[2.5, 0.36], [2.3, 0.41], [2.05, 0.49], [1.8, 0.555], [1.5, 0.605], [1.2, 0.64], [0.95, 0.672], [0.75, 0.71], [0.5, 0.765], [0.0, 0.782], [-0.6, 0.81], [-0.95, 0.845], [-1.2, 0.86], [-1.6, 0.852], [-1.95, 0.83], [-2.12, 0.832], [-2.3, 0.85]], 0.04],
      zv: [[[2.5, 0.50], [2.0, 0.58], [1.4, 0.64], [0.9, 0.64], [0.5, 0.62], [-0.6, 0.62], [-1.0, 0.68], [-1.5, 0.72], [-2.3, 0.74]], 0.05],
      n: [[[2.5, 2.4], [2.1, 2.8], [1.5, 3.3], [0.5, 3.2], [-0.5, 3.3], [-1.3, 3.8], [-2.3, 4.2]], 0.06],
      tuck: [[[2.5, 0.11], [2.1, 0.085], [1.6, 0.05], [1.1, 0.05], [0.6, 0.07], [-0.5, 0.07], [-0.95, 0.05], [-1.45, 0.05], [-1.8, 0.09], [-2.3, 0.125]], 0.05],
      ys: [[[2.5, 0.115], [2.2, 0.105], [1.9, 0.10], [1.5, 0.095], [-1.5, 0.095], [-1.9, 0.105], [-2.3, 0.13]], 0.04],
      yf: [[[2.5, 0.115], [2.2, 0.10], [1.9, 0.095], [-1.5, 0.095], [-1.75, 0.13], [-2.0, 0.20], [-2.3, 0.275]], 0.04],
    },
  },
  axles: [
    { x: 1.40, yc: 0.335, Ra: 0.372, track: 0.862, R: 0.335, w: 0.265, rim: 0.254, rimW: 0.24, disc: 0.205, concave: 0.05, front: true },
    { x: -1.32, yc: 0.364, Ra: 0.402, track: 0.842, R: 0.364, w: 0.325, rim: 0.2667, rimW: 0.30, disc: 0.205, concave: 0.07, front: false },
  ],
  tyre: ['TRACKFORM', 'CORSA R  ·  265/30 ZR20 92Y'],
  parts: {
    splitter: { x0: 1.84, lip: 0.05, nose: 0.055 },
    fences: true,
    canards: [[0.215, 2.06, 0.17, 0.075], [0.29, 2.02, 0.13, 0.06]],   // height, x, length, width (track kit)
    strakes: [0, -0.21, 0.21, -0.42, 0.42],
    wing: { chord: 0.33, span: 1.84, xLE: -1.83, yLE: 1.115, aoa: 0.13, flap: 0.13, drop: 0.165, pylonZ: 0.34 },
    spoiler: { span: 1.50, chord: 0.24, xLE: -1.905 },
    scoop: null, fin: null,
    exhaust: { y: 0.43, z: [-0.155, 0.155], r: 1 },
  },
  lights: { head: { y: 0.455, z: 0.66, w: 0.46, h: 0.115 }, bar: null, tail: { inset: 0.94, drop: 0.05, gap: 0 }, rain: 0.215, letter: 0.635 },
  vents: {
    centre: { y: 0.215, w: 1.0, h: 0.27 }, corner: { y: 0.255, z: 0.72, w: 0.47, h: 0.29 },
    hood: { x: 1.93, w: 0.62, l: 0.30 }, fender: { x: 1.18, z: 0.80 }, engine: { x: -1.55, z: 0.30 }, scoop: true, flank: null,
  },
  livery: { bars: [1.0, 0.55] },
  // 6.5 l V12: peak 1045 Nm at 7000, ~890 kW at 8800-9000 rpm; 7-speed dual-clutch (km/h at the red line per gear)
  power: {
    type: 'ice', idle: 950, redline: 9000, limiter: 9250, upshift: 8880, redzone: 8200, launch: 4600, cluster: 9000,
    torque: [[0, 300], [800, 380], [1000, 520], [2000, 720], [3000, 860], [4000, 950], [5000, 1010], [6000, 1040], [7000, 1045], [8000, 1020], [8600, 985], [9000, 945], [9400, 870]],
    gearTop: [0, 96, 142, 190, 240, 292, 350, 412],
    shift: { up: 0.055, down: 0.07, blip: 0.13, flare: 1100, downBrake: 8300, kickTo: 7600, kickBelow: 3200 },
    engineBrake: [38, 0.012],
    pops: { rpm: 3800, rate: 16, tail: 1.2, big: 0.22 },
    start: { time: 1.15, flare: 2300 },
    vcap: 400, temps: 'OIL 98°  H2O 91°',
  },
  // 1390 kg with driver, 42/58 weight split (a: centre of gravity behind the front axle), 0.40 m high, semi-slick tyres, carbon-ceramic brakes
  chassis: { m: 1390, a: 1.578, h: 0.40, mu0: 1.55, muLoad: 0.07, crr: 0.013, eta: 0.92, Ie: 0.12, Iw: 5.6, A: 2.05, brkCap: 2.4, KF: 230000, KR: 300000, awd: false },
  aero: {
    clF: 0.40, clFKit: 0.14, clR: 0.26, cd: 0.32, cdKit: 0.03,
    gt: { cl: [0.40, 0.30, 0.05], cd: [0.06, 0.04, 0.30] },        // base, deployed, airbrake
    active: { cl: [0.05, 0.33, 0.10], cd: [0.005, 0.03, 0.40] },
    lowDrag: 250,                                                   // km/h above which the wing trims flat on a straight
  },
  // body attitude: pitch and roll per g (rad), squat under load, natural frequencies (rad/s) and damping ratios
  susp: { pitch: 0.016, roll: 0.016, heave: 0.0025, wp: 11, zp: 0.38, wr: 10, zr: 0.36, wh: 14, zh: 0.42, yaw: 0.02, understeer: 0.004, bump: 1 },
  stance: { drop: 0, rake: 0, camber: [0, 0] },
  sparks: { pitch: -0.03, rate: 1 },
  stills: { cruise: 398, brake: 250, cruiseThrottle: 0.93 },
  voice: {
    fire: evenFire(12), ref: 9000, pulse: 14, tau: [0.00012, 0.0011], spread: 0.16, rough: [0.22, 0.5], idleHi: 1700,
    tract: [150, 176], mid: [640, 4], eq: [2400, 3], clip: 2.2, lp: [2200, 9500, 0.45], exh: [0.44, 0.16, 0.1],
    intake: [480, 1450], int: [0.1, 0.32], mech: 0.012, pop: 1,
    whine: null, blower: null, motor: null, starter: 'crank', order: 6, engineX: -0.75,
  },
  paintDefault: 'abyss',
  presets: [
    { name: '勒芒传奇', paint: 'abyss', finish: 'metallic', livery: 'twin', wheel: 'yspoke', rim: 'graphite', caliper: 'red', wing: 'gt', kit: 'track', cabin: 'black' },
    { name: '暗夜碳纤', paint: 'obsidian', finish: 'carbon', livery: 'none', wheel: 'turbine', rim: 'black', caliper: 'red', wing: 'active', kit: 'road', cabin: 'red' },
    { name: '香槟珠光', paint: 'champagne', finish: 'pearl', livery: 'none', wheel: 'mesh', rim: 'bronze', caliper: 'black', wing: 'active', kit: 'road', cabin: 'tan' },
    { name: '霓虹赛道', paint: 'neon', finish: 'solid', livery: 'twotone', wheel: 'ten', rim: 'black', caliper: 'blue', wing: 'gt', kit: 'track', cabin: 'black' },
    { name: '极光幻彩', paint: 'violet', finish: 'chameleon', livery: 'hoop', wheel: 'ten', rim: 'silver', caliper: 'yellow', wing: 'gt', kit: 'track', cabin: 'ivory' },
    { name: '液态银河', paint: 'glacier', finish: 'chrome', livery: 'none', wheel: 'turbine', rim: 'black', caliper: 'blue', wing: 'active', kit: 'road', cabin: 'black' },
  ],
};


/* ---------- G8: front-mid supercharged cross-plane V8 grand tourer ---------- */
// long bonnet, cabin over the rear axle, short tail; road tyres and soft springs: it squats, dives and leans
const G8 = mergeSpec(H9, {
  id: 'g8', name: 'G8', mark: ['G', '8'], tag: 'V8', number: '8',
  body: {
    XF: 2.68, XR: -1.90,
    nose: { LC: 0.34, NFC: 2.5, rake: 0, fine: true },
    tail: { LR: 0.16, CEND: 0.88, face: 'paint', valance: { y: 0.385, w: 1.62, h: 0.21 } },
    side: { channel: 0.022, scoop: 0, scoopX: [-0.20, -0.62], ledge: 0.016, rocker: 0.02 },
    seams: { hood: [0.985, 0.64, 2.46], deck: [-1.30, 0.60, -1.80] },
    curves: {
      a: [[[2.8, 0.78], [2.55, 0.86], [2.3, 0.915], [2.05, 0.96], [1.8, 0.985], [1.5, 0.985], [1.2, 0.97], [0.85, 0.955], [0.45, 0.948], [0.0, 0.948], [-0.35, 0.965], [-0.7, 1.0], [-1.02, 1.02], [-1.3, 1.01], [-1.6, 0.985], [-2.0, 0.945]], 0.06],
      yb: [[[2.8, 0.31], [2.55, 0.37], [2.3, 0.47], [2.05, 0.58], [1.8, 0.655], [1.5, 0.665], [1.2, 0.635], [0.95, 0.585], [0.6, 0.54], [0.0, 0.525], [-0.3, 0.56], [-0.6, 0.66], [-0.85, 0.745], [-1.02, 0.775], [-1.3, 0.755], [-1.6, 0.70], [-2.0, 0.64]], 0.05],
      crown: [[[2.8, 0.45], [2.55, 0.555], [2.3, 0.665], [2.05, 0.76], [1.8, 0.82], [1.5, 0.83], [1.2, 0.815], [0.95, 0.795], [0.7, 0.782], [0.3, 0.778], [-0.2, 0.785], [-0.5, 0.82], [-0.8, 0.875], [-1.02, 0.905], [-1.3, 0.90], [-1.6, 0.875], [-2.0, 0.85]], 0.05],
      cy: [[[2.8, 0.42], [2.55, 0.535], [2.3, 0.64], [2.0, 0.725], [1.7, 0.77], [1.4, 0.785], [1.1, 0.785], [0.9, 0.775], [0.75, 0.77], [0.5, 0.772], [0.0, 0.782], [-0.6, 0.81], [-0.95, 0.845], [-1.2, 0.86], [-1.5, 0.855], [-1.75, 0.845], [-2.0, 0.85]], 0.04],
      zv: [[[2.8, 0.46], [2.3, 0.54], [1.8, 0.60], [0.9, 0.62], [0.5, 0.62], [-0.6, 0.62], [-1.0, 0.68], [-1.5, 0.70], [-2.0, 0.70]], 0.05],
      n: [[[2.8, 2.3], [2.3, 2.7], [1.8, 3.0], [0.5, 3.2], [-0.5, 3.3], [-1.02, 3.7], [-2.0, 4.0]], 0.06],
      tuck: [[[2.8, 0.11], [2.4, 0.085], [1.95, 0.05], [1.5, 0.05], [1.0, 0.07], [-0.3, 0.07], [-0.7, 0.05], [-1.2, 0.05], [-1.55, 0.09], [-2.0, 0.125]], 0.05],
      ys: [[[2.8, 0.135], [2.45, 0.125], [2.1, 0.115], [1.8, 0.11], [-1.2, 0.11], [-1.6, 0.12], [-2.0, 0.145]], 0.04],
      yf: [[[2.8, 0.135], [2.45, 0.12], [2.1, 0.11], [-1.25, 0.11], [-1.45, 0.14], [-1.7, 0.20], [-2.0, 0.27]], 0.04],
    },
  },
  axles: [
    { x: 1.80, yc: 0.345, Ra: 0.382, track: 0.835, R: 0.345, w: 0.275, rim: 0.254, rimW: 0.25, disc: 0.200, concave: 0.045, front: true },
    { x: -1.02, yc: 0.362, Ra: 0.400, track: 0.830, R: 0.362, w: 0.315, rim: 0.2667, rimW: 0.29, disc: 0.195, concave: 0.065, front: false },
  ],
  tyre: ['TRACKFORM', 'STRADA GT  ·  275/35 ZR20 102Y'],
  parts: {
    splitter: { x0: 2.14, lip: 0.035, nose: 0.035 },
    canards: [[0.23, 2.34, 0.16, 0.07]],
    strakes: [0, -0.24, 0.24],
    wing: { chord: 0.30, span: 1.70, xLE: -1.50, yLE: 1.10, aoa: 0.11, flap: 0.12, drop: 0.14, pylonZ: 0.32 },
    spoiler: { span: 1.46, chord: 0.24, xLE: -1.61 },
    exhaust: { y: 0.385, z: [-0.58, -0.45, 0.45, 0.58], r: 0.8 },
  },
  lights: { head: { y: 0.60, z: 0.66, w: 0.40, h: 0.12 }, tail: { inset: 0.94, drop: 0.06, gap: 0.20 }, rain: null, letter: 0.60 },
  vents: {
    centre: { y: 0.235, w: 0.92, h: 0.20 }, corner: { y: 0.235, z: 0.72, w: 0.30, h: 0.18 },
    hood: { x: 1.45, z: [-0.34, 0.34], w: 0.24, l: 0.34 }, fender: null, engine: null, scoop: false,
    flank: { x: 1.27, y: 0.50, w: 0.11, h: 0.30 },
  },
  livery: { bars: [0.98, 0.33] },
  // 5.0 l supercharged V8: 880 Nm at 4200, ~566 kW at 6800 rpm; 8-speed automatic
  power: {
    idle: 750, redline: 7200, limiter: 7400, upshift: 7080, redzone: 6700, launch: 3200, cluster: 8000,
    torque: [[0, 420], [700, 480], [1000, 600], [2000, 780], [3000, 860], [4200, 880], [5000, 870], [6000, 840], [6800, 795], [7200, 740], [7500, 660]],
    gearTop: [0, 72, 108, 148, 192, 240, 294, 356, 430],
    shift: { up: 0.11, down: 0.14, blip: 0.2, flare: 700, downBrake: 6350, kickTo: 5900, kickBelow: 2600 },
    engineBrake: [45, 0.016],
    pops: { rpm: 2600, rate: 22, tail: 2.5, big: 0.08 },
    start: { time: 1.15, flare: 1500 },
    vcap: 335,
  },
  // 1720 kg, 48/52, road tyres, steel brakes
  chassis: { m: 1720, a: 1.466, h: 0.46, mu0: 1.35, muLoad: 0.08, crr: 0.012, eta: 0.90, Ie: 0.20, Iw: 6.5, A: 2.15, brkCap: 1.7, KF: 150000, KR: 170000 },
  aero: {
    clF: 0.10, clFKit: 0.14, clR: 0.12, cd: 0.33, cdKit: 0.03,
    gt: { cl: [0.30, 0.25, 0.05], cd: [0.05, 0.035, 0.28] },
    active: { cl: [0.04, 0.24, 0.10], cd: [0.004, 0.025, 0.36] },
    lowDrag: 260,
  },
  susp: { pitch: 0.026, roll: 0.036, heave: 0.004, wp: 8.5, zp: 0.32, wr: 8, zr: 0.30, wh: 10, zh: 0.34, yaw: 0.03, understeer: 0.007, bump: 1.3 },
  stance: { drop: 0, rake: 0, camber: [0.012, 0.016] },
  sparks: { pitch: -1, rate: 0 },
  stills: { cruise: 333, brake: 230, cruiseThrottle: 0.9 },
  voice: {
    fire: crossPlaneFire(), ref: 7200, pulse: 22, tau: [0.00022, 0.0022], spread: 0.26, rough: [0.30, 0.55], idleHi: 1400,
    tract: [92, 118], mid: [380, 6], eq: [1500, 2], clip: 2.8, lp: [1500, 6200, 0.42], exh: [0.50, 0.18, 0.08],
    intake: [300, 900], int: [0.05, 0.16], mech: 0.008, pop: 0.8,
    blower: { order: 9.6, gain: 0.05 }, order: 4, engineX: 1.35,
  },
  presets: [
    { name: '熔岩公路', paint: 'lava', finish: 'metallic', livery: 'none', wheel: 'ten', rim: 'silver', caliper: 'yellow', wing: 'active', kit: 'road', cabin: 'tan' },
    { name: '石墨绅士', paint: 'graphite', finish: 'metallic', livery: 'none', wheel: 'turbine', rim: 'black', caliper: 'red', wing: 'active', kit: 'road', cabin: 'black' },
    { name: '旷野绿', paint: 'verdant', finish: 'metallic', livery: 'none', wheel: 'mesh', rim: 'bronze', caliper: 'black', wing: 'active', kit: 'road', cabin: 'tan' },
    { name: '赛道日', paint: 'neon', finish: 'solid', livery: 'twin', wheel: 'yspoke', rim: 'graphite', caliper: 'blue', wing: 'gt', kit: 'track', cabin: 'black' },
    { name: '香槟旅行', paint: 'champagne', finish: 'pearl', livery: 'twotone', wheel: 'turbine', rim: 'bronze', caliper: 'black', wing: 'none', kit: 'road', cabin: 'ivory' },
  ],
});

/* ---------- E4: four-motor electric hypercar ---------- */
// closed nose with a light blade, long tapering tail, no pipes; all-wheel drive, one gear, a low heavy battery
const E4 = mergeSpec(H9, {
  id: 'e4', name: 'E4', mark: ['E', '4'], tag: '电动', number: '4',
  body: {
    XF: 2.38, XR: -2.42,
    nose: { LC: 0.42, NFC: 2.2, rake: 0, fine: true },
    tail: { LR: 0.22, CEND: 0.80, face: 'gloss' },
    side: { channel: 0.026, scoop: 0.075, scoopX: [-0.24, -0.84], ledge: 0.014, rocker: 0.02 },
    seams: { hood: [0.985, 0.58, 2.12], deck: [-1.32, 0.60, -2.30] },
    curves: {
      a: [[[2.5, 0.84], [2.25, 0.895], [2.0, 0.945], [1.75, 0.98], [1.48, 0.995], [1.15, 0.985], [0.85, 0.96], [0.45, 0.948], [0.0, 0.948], [-0.4, 0.958], [-0.75, 0.99], [-1.05, 1.025], [-1.36, 1.035], [-1.65, 1.01], [-1.95, 0.955], [-2.2, 0.895], [-2.5, 0.81]], 0.06],
      yb: [[[2.5, 0.265], [2.25, 0.31], [2.0, 0.4], [1.75, 0.53], [1.48, 0.62], [1.2, 0.615], [0.95, 0.57], [0.6, 0.535], [0.0, 0.525], [-0.45, 0.55], [-0.8, 0.64], [-1.05, 0.73], [-1.36, 0.765], [-1.65, 0.725], [-1.95, 0.645], [-2.2, 0.565], [-2.5, 0.48]], 0.05],
      crown: [[[2.5, 0.37], [2.3, 0.43], [2.05, 0.535], [1.8, 0.655], [1.5, 0.74], [1.25, 0.77], [1.0, 0.778], [0.7, 0.778], [0.3, 0.778], [-0.2, 0.785], [-0.6, 0.81], [-0.95, 0.865], [-1.2, 0.905], [-1.4, 0.905], [-1.7, 0.86], [-2.0, 0.785], [-2.25, 0.71], [-2.5, 0.63]], 0.05],
      cy: [[[2.5, 0.35], [2.3, 0.405], [2.05, 0.5], [1.8, 0.6], [1.5, 0.675], [1.2, 0.705], [0.95, 0.715], [0.75, 0.73], [0.5, 0.765], [0.0, 0.782], [-0.6, 0.81], [-0.95, 0.845], [-1.2, 0.86], [-1.5, 0.83], [-1.8, 0.775], [-2.1, 0.705], [-2.3, 0.655], [-2.5, 0.61]], 0.04],
      zv: [[[2.5, 0.50], [2.0, 0.58], [1.4, 0.64], [0.9, 0.64], [0.5, 0.62], [-0.6, 0.62], [-1.0, 0.68], [-1.5, 0.70], [-2.5, 0.62]], 0.05],
      n: [[[2.5, 2.3], [2.1, 2.6], [1.5, 3.0], [0.5, 3.1], [-0.5, 3.2], [-1.36, 3.4], [-2.5, 2.9]], 0.06],
      tuck: [[[2.5, 0.11], [2.1, 0.085], [1.65, 0.05], [1.15, 0.05], [0.6, 0.07], [-0.5, 0.07], [-0.98, 0.05], [-1.5, 0.05], [-1.9, 0.09], [-2.5, 0.13]], 0.05],
      ys: [[[2.5, 0.115], [2.2, 0.105], [1.9, 0.10], [1.5, 0.095], [-1.55, 0.095], [-2.0, 0.11], [-2.5, 0.15]], 0.04],
      yf: [[[2.5, 0.115], [2.2, 0.1], [1.9, 0.095], [-1.3, 0.095], [-1.6, 0.13], [-2.0, 0.21], [-2.5, 0.31]], 0.04],
    },
  },
  axles: [
    { x: 1.48, yc: 0.338, Ra: 0.375, track: 0.858, R: 0.338, w: 0.265, rim: 0.254, rimW: 0.24, disc: 0.200, concave: 0.04, front: true },
    { x: -1.36, yc: 0.362, Ra: 0.400, track: 0.840, R: 0.362, w: 0.325, rim: 0.2667, rimW: 0.30, disc: 0.200, concave: 0.055, front: false },
  ],
  tyre: ['TRACKFORM', 'VOLTA E  ·  265/35 ZR20 99Y'],
  parts: {
    splitter: { x0: 1.84, lip: 0.04, nose: 0.045 },
    canards: [[0.215, 2.04, 0.15, 0.065]],
    strakes: [0, -0.16, 0.16, -0.32, 0.32, -0.48, 0.48],
    wing: { chord: 0.30, span: 1.72, xLE: -2.04, yLE: 0.95, aoa: 0.11, flap: 0.12, drop: 0.14, pylonZ: 0.30 },
    spoiler: { span: 1.30, chord: 0.26, xLE: -2.11 },
    exhaust: null,
  },
  lights: { head: { y: 0.44, z: 0.68, w: 0.36, h: 0.075 }, bar: { y: 0.315, w: 1.02, h: 0.05 }, tail: { inset: 0.96, drop: 0.04, gap: 0 }, rain: null, letter: 0.47 },
  vents: { centre: null, corner: { y: 0.215, z: 0.66, w: 0.44, h: 0.17 }, hood: null, fender: null, engine: null, scoop: true, flank: null },
  // four motors, 1400 kW together; one fixed reduction (motor speed on the gauge)
  power: {
    type: 'ev', idle: 0, redline: 20000, limiter: 20500, upshift: 1e9, redzone: 19200, launch: 0, cluster: 20000,
    torque: [[0, 2057], [6500, 2057], [8000, 1671], [10000, 1337], [12000, 1114], [14000, 955], [16000, 836], [17000, 786], [19000, 640], [20000, 560], [20500, 300]],
    gearTop: [0, 400],
    shift: { up: 0.05, down: 0.05, blip: 0, flare: 0, downBrake: 0, kickTo: 0, kickBelow: 0 },
    engineBrake: [300, 0],
    pops: null,
    start: { time: 0.7, flare: 0 },
    vcap: 380, temps: 'BAT 34°  INV 52°',
  },
  // 1980 kg, 47/53, the battery under the floor, torque vectoring on all four wheels
  chassis: { m: 1980, a: 1.505, h: 0.34, mu0: 1.50, muLoad: 0.07, crr: 0.011, eta: 0.95, Ie: 0.06, Iw: 6.0, A: 2.10, brkCap: 2.2, KF: 260000, KR: 300000, awd: true },
  aero: {
    clF: 0.30, clFKit: 0.14, clR: 0.30, cd: 0.28, cdKit: 0.03,
    gt: { cl: [0.36, 0.28, 0.05], cd: [0.055, 0.035, 0.30] },
    active: { cl: [0.05, 0.33, 0.10], cd: [0.005, 0.03, 0.40] },
    lowDrag: 240,
  },
  susp: { pitch: 0.010, roll: 0.009, heave: 0.002, wp: 12, zp: 0.5, wr: 12, zr: 0.5, wh: 13, zh: 0.5, yaw: 0.012, understeer: 0.002, bump: 0.8 },
  stance: { drop: 0, rake: 0, camber: [0.01, 0.012] },
  sparks: { pitch: -0.02, rate: 0.4 },
  stills: { cruise: 378, brake: 260, cruiseThrottle: 0.6 },
  voice: {
    fire: [], ref: 20000, spread: 0, rough: [0, 0], idleHi: 0, exh: [0, 0, 0], int: [0, 0], mech: 0, pop: 0,
    // orders of the motor shaft: [order, level, share with torque, with regeneration, always]
    motor: { gain: 1.7, fade: 500, hiss: 0.03, tones: [[2, 0.10, 0.6, 0.25, 0.15], [8, 0.16, 0.8, 0.35, 0.10], [8.07, 0.10, 0.8, 0.35, 0.10], [16, 0.06, 1.0, 0.2, 0.03], [23, 0.05, 0.5, 0.7, 0.08], [48, 0.02, 1, 0.3, 0.02]] },
    starter: 'chime', order: 8, engineX: 0,
  },
  presets: [
    { name: '冰川电光', paint: 'glacier', finish: 'pearl', livery: 'none', wheel: 'turbine', rim: 'black', caliper: 'blue', wing: 'active', kit: 'road', cabin: 'ivory' },
    { name: '极夜', paint: 'obsidian', finish: 'matte', livery: 'none', wheel: 'turbine', rim: 'carbon', caliper: 'green', wing: 'active', kit: 'road', cabin: 'black' },
    { name: '电光紫', paint: 'violet', finish: 'chameleon', livery: 'hoop', wheel: 'ten', rim: 'silver', caliper: 'yellow', wing: 'active', kit: 'road', cabin: 'black' },
    { name: '霓虹脉冲', paint: 'neon', finish: 'solid', livery: 'offset', wheel: 'mesh', rim: 'black', caliper: 'black', wing: 'gt', kit: 'track', cabin: 'black' },
  ],
});

/* ---------- R10: naturally aspirated V10 track car ---------- */
// prototype stance: flat low nose between tall fenders, roof scoop and fin, a big fixed wing; slicks, no compromise
const R10 = mergeSpec(H9, {
  id: 'r10', name: 'R10', mark: ['R', '10'], tag: 'V10', number: '10',
  body: {
    XF: 2.46, XR: -2.26,
    nose: { LC: 0.36, NFC: 2.4, rake: 0, fine: true },
    tail: { LR: 0.14, CEND: 0.90, face: 'grille' },
    side: { channel: 0.036, scoop: 0.15, scoopX: [-0.20, -0.80], ledge: 0.016, rocker: 0.022 },
    seams: { hood: [0.985, 0.56, 2.10], deck: [-1.30, 0.62, -2.14] },
    curves: {
      a: [[[2.6, 0.90], [2.3, 0.945], [2.0, 0.99], [1.75, 1.02], [1.45, 1.03], [1.15, 1.01], [0.85, 0.97], [0.45, 0.948], [0.0, 0.948], [-0.4, 0.96], [-0.75, 1.0], [-1.05, 1.05], [-1.32, 1.07], [-1.6, 1.065], [-1.9, 1.045], [-2.35, 1.02]], 0.06],
      yb: [[[2.6, 0.25], [2.3, 0.30], [2.0, 0.43], [1.75, 0.585], [1.45, 0.665], [1.2, 0.64], [0.95, 0.575], [0.6, 0.535], [0.0, 0.525], [-0.45, 0.55], [-0.8, 0.645], [-1.05, 0.75], [-1.32, 0.795], [-1.6, 0.775], [-1.9, 0.735], [-2.35, 0.69]], 0.05],
      crown: [[[2.6, 0.36], [2.35, 0.42], [2.05, 0.565], [1.8, 0.71], [1.5, 0.795], [1.25, 0.805], [1.0, 0.79], [0.7, 0.778], [0.3, 0.778], [-0.2, 0.785], [-0.6, 0.815], [-0.95, 0.88], [-1.2, 0.93], [-1.4, 0.94], [-1.7, 0.92], [-2.0, 0.895], [-2.35, 0.875]], 0.05],
      cy: [[[2.6, 0.32], [2.35, 0.365], [2.05, 0.43], [1.8, 0.49], [1.5, 0.545], [1.2, 0.60], [0.95, 0.655], [0.75, 0.705], [0.5, 0.765], [0.0, 0.782], [-0.6, 0.81], [-0.95, 0.84], [-1.2, 0.845], [-1.6, 0.825], [-1.95, 0.80], [-2.15, 0.80], [-2.35, 0.815]], 0.04],
      zv: [[[2.6, 0.54], [2.0, 0.62], [1.4, 0.66], [0.9, 0.64], [0.5, 0.62], [-0.6, 0.62], [-1.0, 0.70], [-1.5, 0.76], [-2.35, 0.80]], 0.05],
      n: [[[2.6, 2.6], [2.1, 3.0], [1.5, 3.5], [0.5, 3.2], [-0.5, 3.3], [-1.3, 4.0], [-2.35, 4.6]], 0.06],
      tuck: [[[2.6, 0.11], [2.15, 0.085], [1.6, 0.05], [1.1, 0.05], [0.6, 0.07], [-0.5, 0.07], [-0.95, 0.05], [-1.45, 0.05], [-1.8, 0.08], [-2.35, 0.11]], 0.05],
      ys: [[[2.6, 0.105], [2.2, 0.095], [1.9, 0.09], [1.5, 0.088], [-1.5, 0.088], [-1.9, 0.10], [-2.35, 0.125]], 0.04],
      yf: [[[2.6, 0.105], [2.2, 0.09], [1.9, 0.088], [-1.4, 0.088], [-1.7, 0.14], [-2.0, 0.23], [-2.35, 0.32]], 0.04],
    },
  },
  axles: [
    { x: 1.40, yc: 0.33, Ra: 0.368, track: 0.885, R: 0.33, w: 0.29, rim: 0.2286, rimW: 0.27, disc: 0.19, concave: 0.035, front: true },
    { x: -1.32, yc: 0.355, Ra: 0.395, track: 0.870, R: 0.355, w: 0.34, rim: 0.2286, rimW: 0.32, disc: 0.19, concave: 0.06, front: false },
  ],
  tyre: ['TRACKFORM', 'SLICK S2  ·  310/680 R18'],
  parts: {
    splitter: { x0: 1.86, lip: 0.085, nose: 0.10 },
    canards: [[0.20, 2.10, 0.20, 0.10], [0.285, 2.05, 0.17, 0.085], [0.37, 1.99, 0.13, 0.065]],
    strakes: [0, -0.15, 0.15, -0.30, 0.30, -0.45, 0.45, -0.60, 0.60],
    wing: { chord: 0.40, span: 1.94, xLE: -1.93, yLE: 1.27, aoa: 0.15, flap: 0.16, drop: 0, pylonZ: 0.30 },
    spoiler: { span: 1.56, chord: 0.24, xLE: -1.945 },
    scoop: { x0: 0.02, x1: -1.20, w: 0.17, h: 0.13 },
    fin: { x0: -0.95, x1: -2.2, y: 1.20 },
    exhaust: { y: 0.57, z: [-0.09, 0.09], r: 1.12 },
  },
  lights: { head: { y: 0.43, z: 0.70, w: 0.40, h: 0.10 }, tail: { inset: 0.95, drop: 0.05, gap: 0 }, rain: 0.26, letter: 0.70 },
  vents: {
    centre: { y: 0.19, w: 1.0, h: 0.22 }, corner: { y: 0.24, z: 0.76, w: 0.44, h: 0.26 },
    hood: { x: 1.90, w: 0.72, l: 0.34 }, fender: { x: 1.30, z: 0.84 }, engine: { x: -1.62, z: 0.34 }, scoop: true, flank: null,
  },
  // 5.2 l V10: 640 Nm at 8000, ~625 kW at 10000 rpm; 6-speed sequential with straight-cut gears
  power: {
    idle: 1400, redline: 10500, limiter: 10750, upshift: 10380, redzone: 9600, launch: 6500, cluster: 11000,
    torque: [[0, 220], [1000, 300], [2000, 400], [3000, 470], [4000, 520], [5000, 560], [6000, 595], [7000, 625], [8000, 640], [9000, 630], [10000, 600], [10500, 570], [11000, 500]],
    gearTop: [0, 110, 152, 196, 242, 290, 340],
    shift: { up: 0.035, down: 0.05, blip: 0.09, flare: 1500, downBrake: 9700, kickTo: 8800, kickBelow: 4200 },
    engineBrake: [30, 0.010],
    pops: { rpm: 5000, rate: 20, tail: 1.5, big: 0.35 },
    start: { time: 1.0, flare: 3200 },
    vcap: 325,
  },
  // 1180 kg, 44/56, slicks, a centre of gravity at hub height
  chassis: { m: 1180, a: 1.523, h: 0.33, mu0: 1.85, muLoad: 0.06, crr: 0.014, eta: 0.93, Ie: 0.07, Iw: 4.6, A: 2.0, brkCap: 3.4, KF: 420000, KR: 520000 },
  aero: {
    clF: 0.80, clFKit: 0.20, clR: 0.60, cd: 0.40, cdKit: 0.04,
    gt: { cl: [0.70, 0.45, 0.05], cd: [0.10, 0.07, 0.22] },
    active: { cl: [0.05, 0.33, 0.10], cd: [0.005, 0.03, 0.40] },
    lowDrag: 240,
  },
  susp: { pitch: 0.006, roll: 0.005, heave: 0.0012, wp: 17, zp: 0.55, wr: 18, zr: 0.55, wh: 22, zh: 0.6, yaw: 0.012, understeer: 0.002, bump: 0.55 },
  stance: { drop: 0.012, rake: -0.004, camber: [0.055, 0.035] },
  sparks: { pitch: -0.012, rate: 1.6 },
  stills: { cruise: 322, brake: 255, cruiseThrottle: 0.95 },
  voice: {
    fire: oddFireV10(), ref: 10500, pulse: 12, tau: [0.0001, 0.0009], spread: 0.14, rough: [0.2, 0.45], idleHi: 2400,
    tract: [205, 238], mid: [900, 5], eq: [3100, 5], clip: 2.4, lp: [2600, 10500, 0.5], exh: [0.46, 0.18, 0.12],
    intake: [620, 1900], int: [0.14, 0.40], mech: 0.02, pop: 1.3,
    whine: { engine: 17, wheel: 43, gain: 0.05 }, order: 5,
  },
  presets: [
    { name: '厂队涂装', paint: 'amber', finish: 'solid', livery: 'twin', wheel: 'ten', rim: 'black', caliper: 'red', wing: 'gt', kit: 'track', cabin: 'black' },
    { name: '熔岩赛车', paint: 'lava', finish: 'solid', livery: 'offset', wheel: 'yspoke', rim: 'black', caliper: 'yellow', wing: 'gt', kit: 'track', cabin: 'red' },
    { name: '裸碳测试', paint: 'obsidian', finish: 'carbon', livery: 'none', wheel: 'mesh', rim: 'bronze', caliper: 'orange', wing: 'gt', kit: 'track', cabin: 'black' },
    { name: '冰川耐力', paint: 'glacier', finish: 'solid', livery: 'hoop', wheel: 'turbine', rim: 'graphite', caliper: 'blue', wing: 'gt', kit: 'track', cabin: 'black' },
  ],
});

const MODELS = [H9, G8, E4, R10];
const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
