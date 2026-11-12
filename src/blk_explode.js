/* =========================================================================
   EXPLODED VIEW — the parked car comes apart into its pieces and goes back
   together. Every builder names its parts (part()); here each name gets a
   place to go and a moment to leave. The skin is one lofted mesh, so the
   first time it is needed it is cut along the shut lines the paint already
   shows (bonnet, engine cover, the four fenders, the tub in between), with
   whatever is laid onto it (lights, vents, lettering) cut the same way.
   Surfaces that are only ever seen from one side get an inner face while the
   car is apart.
   ========================================================================= */
// k: 0 whole .. 1 apart; parts: [{ o: what moves, d: where to, t: when }]; panels, twins and pieces only exist once the car has been apart
const XPL = { k: 0, want: 0, parts: [], ready: false, panels: [], twins: [], pieces: [] };
const XPL_OUT = 1.9, XPL_IN = 1.5;   // seconds to come apart and to go back together
const XPL_SPAN = 0.55;               // share of that time one piece is on the move
// per view: how much further back the camera sits and how much higher it looks (m) to keep all of it in the picture
const XPL_VIEW = { front: [0.3, 0.45], rear: [0.3, 0.45], side: [0.25, 0.45], top: [0.5, 1.0], wheel: [0.6, 0.45], cabin: [0.7, 0.45], driver: [0, 0] };
const XPL_SHADOW = 1.4;              // the contact shadow covers this much more ground

// where each piece goes [x forward, y up, z outward (to its own side), start on the 0..1 timeline].
// Pieces of a piece (door glass, wing end plates, tyres) are placed relative to what carries them.
const XPL_LAY = {
  // bodywork: the panels lift off the tub, the doors come away sideways
  bonnet: [0.50, 0.66, 0, 0.03], deck: [-0.30, 0.66, 0, 0.03],
  fenderF: [0.10, 0.42, 0.22, 0.08], fenderR: [-0.10, 0.42, 0.22, 0.08],
  door: [0, 0.10, 0.85, 0], doorTrim: [0, 0, -0.30, 0.24], doorGlass: [0, 0.40, 0.06, 0.24], mirror: [0.16, 0.08, 0.22, 0.28],
  // canopy
  glass: [0.15, 1.08, 0, 0.14], pillar: [0.18, 1.00, 0.30, 0.17], roof: [-0.05, 1.42, 0, 0.20], quarter: [-0.25, 1.00, 0.38, 0.18],
  liner: 'roof', linerQ: 'quarter', scoop: [-0.08, 1.64, 0, 0.26], fin: [-0.42, 0.95, 0, 0.10],
  // aero
  splitter: [0.65, 0, 0, 0.10], fence: [0.65, 0.16, 0.12, 0.16], canard: [0.78, 0.08, 0.50, 0.14],
  skirt: [0, 0, 0.45, 0.10], diffuser: [-0.85, 0, 0, 0.12],
  wing: [-0.55, 1.20, 0, 0.02], flap: [-0.13, 0.14, 0, 0.28], plate: [0, 0, 0.22, 0.26], pylon: [0.05, -0.22, 0, 0.24],
  spoiler: [-0.45, 0.98, 0, 0.02],
  // tail
  tail: [-0.50, 0, 0, 0.06], taillight: [-0.75, 0.06, 0, 0.14], exhaust: [-0.98, 0, 0, 0.20],
  // cabin
  seat: [-0.02, 0.62, 0.06, 0.36], console: [0, 0.20, 0, 0.30], dash: [0.10, 0.42, 0, 0.34], steer: [-0.16, 0.56, 0, 0.42],
  pedals: [0.04, 0.24, 0, 0.38], bulkhead: [-0.26, 0.40, 0, 0.32],
  // wheels: the whole corner moves out, then comes apart along its axle
  wheel: [0, 0, 0.55, 0.12], tyre: [0, 0, 0.38, 0.34], lock: [0, 0, 0.58, 0.42], disc: [0, 0, -0.24, 0.32], brake: [-0.13, 0, -0.24, 0.36], upright: [0, 0, -0.40, 0.30],
};
function xplAdd(o, name, side = 0) {
  let L = XPL_LAY[name];
  if (typeof L === 'string') L = XPL_LAY[L];
  if (L) XPL.parts.push({ o, d: new V3(L[0], L[1], L[2] * (side || 1)), t: L[3] });
}
function xplReset() {
  Object.assign(XPL, { k: 0, parts: [], ready: false, panels: [], twins: [], pieces: [] });
  if (BODY.shell) BODY.shell.visible = true;
  shadowScale(1);
}

// the registry for one car: called when it has been built
function buildExplode() {
  xplReset();
  // named children of the body: one carrier per name and side
  const carriers = new Map();
  for (const o of [...car.children]) {
    const name = o.userData.part;
    if (!name) continue;
    const key = name + '|' + o.userData.side;
    let h = carriers.get(key);
    if (!h) { h = new THREE.Group(); carriers.set(key, h); car.add(h); xplAdd(h, name, o.userData.side); }
    h.add(o);
  }
  for (const s of [-1, 1]) {
    const D = DOORS[s];
    if (D) { xplAdd(D.inner, 'doorTrim', s); xplAdd(D.pane, 'doorGlass', s); if (D.mirror) xplAdd(D.mirror, 'mirror', s); }
    xplAdd(BODY.wingSub.plates[s], 'plate', s); xplAdd(BODY.wingSub.pylons[s], 'pylon', s);
  }
  xplAdd(BODY.wingSub.flap, 'flap');
  const C = BODY.cabin;
  xplAdd(C.seatL, 'seat', -1); xplAdd(C.seatR, 'seat', 1); xplAdd(C.console, 'console'); xplAdd(C.dash, 'dash'); xplAdd(C.wheel, 'steer');
  xplAdd(C.pedals, 'pedals'); xplAdd(C.bulkhead, 'bulkhead');
  // the headlining goes with the roof and the rear quarters it lines
  xplAdd(C.liner, 'liner'); xplAdd(C.linerL, 'linerQ', -1); xplAdd(C.linerR, 'linerQ', 1);
  for (const w of WHEEL_OBJS) {
    const S = w.userData.sub;
    xplAdd(w, 'wheel', w.userData.side);
    for (const k of ['tyre', 'lock', 'disc', 'brake', 'upright']) xplAdd(S[k], k);
  }
}

/* ---------- cutting the skin into panels ---------- */
// panels: 0 tub, 1 bonnet, 2/3 front fenders (right, left), 4 engine cover, 5/6 rear fenders
const XPL_PANELS = [['tub', 0], ['bonnet', 0], ['fenderF', 1], ['fenderF', -1], ['deck', 0], ['fenderR', 1], ['fenderR', -1]];
function xplCutter() {
  const [hx, hz] = SPEC.body.seams.hood, [dx, dz] = SPEC.body.seams.deck;
  const region = (x, z) => (x >= hx ? (z >= hz ? 2 : z <= -hz ? 3 : 1) : x <= dx ? (z >= dz ? 5 : z <= -dz ? 6 : 4) : 0);
  const across = (poly, w, mid, right, left, out) => {
    if (poly.length < 3) return;
    const fr = (p) => p[2] - w, fl = (p) => -p[2] - w;
    const r = clipBy(poly, fr, 1), rest = clipBy(poly, fr, -1), l = clipBy(rest, fl, 1), m = clipBy(rest, fl, -1);
    if (r.length >= 3) out.push([right, r]);
    if (l.length >= 3) out.push([left, l]);
    if (m.length >= 3) out.push([mid, m]);
  };
  // a triangle that crosses a shut line: the piece on each side of it
  const pieces = (poly, out) => {
    const ff = (p) => p[0] - hx, fd = (p) => dx - p[0];
    const rest = clipBy(poly, ff, -1);
    across(clipBy(poly, ff, 1), hz, 1, 2, 3, out);
    across(clipBy(rest, fd, 1), dz, 4, 5, 6, out);
    const mid = clipBy(rest, fd, -1);
    if (mid.length >= 3) out.push([0, mid]);
  };
  return { region, pieces };
}
// one geometry per panel (null where a panel gets nothing), keeping up to nGroups material groups
function xplCut(geo, cut, nGroups = 1) {
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, uv = geo.attributes.uv.array;
  const idx = geo.index ? geo.index.array : null, nV = pos.length / 3, nI = idx ? idx.length : nV, NP = XPL_PANELS.length;
  const out = Array.from({ length: NP }, () => ({ P: [], N: [], U: [], I: Array.from({ length: nGroups }, () => []) }));
  const code = new Uint8Array(nV), map = new Int32Array(nV * NP).fill(-1);
  for (let i = 0; i < nV; i++) code[i] = cut.region(pos[i * 3], pos[i * 3 + 2]);
  // a vertex of the mesh, once per panel that uses it
  const put = (r, i) => {
    let k = map[i * NP + r];
    if (k < 0) {
      const o = out[r];
      k = map[i * NP + r] = o.P.length / 3;
      o.P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); o.N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); o.U.push(uv[i * 2], uv[i * 2 + 1]);
    }
    return k;
  };
  // or one made on a shut line
  const add = (r, v) => {
    if (v.i >= 0) return put(r, v.i);
    const o = out[r], l = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
    o.P.push(v.p[0], v.p[1], v.p[2]); o.N.push(v.n[0] / l, v.n[1] / l, v.n[2] / l); o.U.push(v.u[0], v.u[1]);
    return o.P.length / 3 - 1;
  };
  const V = (i) => ({ p: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n: [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], u: [uv[i * 2], uv[i * 2 + 1]], i });
  const cutUp = [];
  for (const g of geo.groups.length ? geo.groups : [{ start: 0, count: nI, materialIndex: 0 }]) {
    const gi = Math.min(nGroups - 1, g.materialIndex || 0);
    for (let t = g.start; t < g.start + g.count; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2, r = code[a];
      if (r === code[b] && r === code[c]) { out[r].I[gi].push(put(r, a), put(r, b), put(r, c)); continue; }
      cutUp.length = 0;
      cut.pieces([V(a), V(b), V(c)], cutUp);
      for (const [q, poly] of cutUp) {
        const ids = poly.map((v) => add(q, v)), I = out[q].I[gi];
        for (let k = 1; k < ids.length - 1; k++) I.push(ids[0], ids[k], ids[k + 1]);
      }
    }
  }
  return out.map((o) => {
    if (!o.I.some((I) => I.length)) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(o.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(o.U, 2));
    g.setIndex([].concat(...o.I));
    let start = 0;
    if (nGroups > 1) o.I.forEach((I, k) => { if (I.length) g.addGroup(start, I.length, k); start += I.length; });
    return g;
  });
}

/* ---------- inner faces ---------- */
// the far side of a surface that is modelled from one side only; a child of that mesh, so it comes and goes with it
function xplTwin(mesh, mat) {
  if (!mesh) return;
  const t = new THREE.Mesh(mesh.geometry, mat);
  t.visible = false;
  t.renderOrder = mesh.renderOrder - 0.1;
  mesh.add(t);
  XPL.twins.push(t);
}
function xplMaterials() {
  if (M.shellBack) return;
  // bare carbon inside the panels, the glass seen from within, the inside of a tyre, the outside of a wheel barrel
  M.shellBack = M.jamb.clone(); M.shellBack.side = THREE.BackSide; M.shellBack.color.setScalar(1.5); M.shellBack.envMapIntensity = 1;
  M.glassBack = M.glass.clone(); M.glassBack.side = THREE.BackSide; M.glassBack.onBeforeCompile = M.glass.onBeforeCompile;
  M.rubberBack = M.rubber.clone(); M.rubberBack.side = THREE.BackSide;
  M.barrelOut = M.rimBarrel.clone(); M.barrelOut.side = THREE.FrontSide;
}

// everything that is only needed while the car is apart, made the first time it is
function xplPrepare() {
  if (XPL.ready) return;
  XPL.ready = true;
  xplMaterials();
  const cut = xplCutter(), carriers = [];
  xplCut(BODY.skin.geometry, cut, 2).forEach((g, r) => {
    if (!g) return;
    const h = new THREE.Group(), m = new THREE.Mesh(g, g.groups.length ? [M.paint, M.interior] : M.paint);
    h.visible = false;
    h.add(m);
    xplTwin(m, M.shellBack);
    car.add(h);
    carriers[r] = h; XPL.panels.push(h);
    xplAdd(h, XPL_PANELS[r][0], XPL_PANELS[r][1]);
  });
  for (const d of BODY.shell.children) {
    if (d === BODY.skin || !d.isMesh) continue;
    xplCut(d.geometry, cut).forEach((g, r) => {
      if (!g || !carriers[r]) return;
      const m = new THREE.Mesh(g, d.material);
      m.renderOrder = d.renderOrder;
      carriers[r].add(m);
      XPL.pieces.push([m, d]);
    });
  }
  xplTwin(BODY.under, M.shellBack); xplTwin(BODY.cap, M.shellBack); xplTwin(BODY.glass, M.glassBack);
  for (const s of [-1, 1]) {
    const D = DOORS[s];
    if (D) { xplTwin(D.skin, M.shellBack); xplTwin(D.card, M.shellBack); }
    if (BODY.doorGlass) xplTwin(BODY.doorGlass[s], M.glassBack);
  }
  for (const w of WHEEL_OBJS) { xplTwin(w.userData.sub.carcass, M.rubberBack); xplTwin(w.userData.sub.barrel, M.barrelOut); }
}
// the cut panels stand in for the shell while the car is apart; their lettering shows what the shell's would
function xplSync() {
  if (!XPL.ready) return;
  const apart = XPL.k > 0;
  BODY.shell.visible = !apart;
  for (const h of XPL.panels) h.visible = apart;
  for (const t of XPL.twins) t.visible = apart;
  for (const [m, d] of XPL.pieces) m.visible = d.visible;
}

/* ---------- per frame ---------- */
// apart only while the car stands switched off in the studio; anything else puts it back together first
function xplWanted() {
  const d = DRIVE;
  return state.explode && state.pose === 'park' && d.prog === 'park' && d.v === 0 && d.engine === 0 && d.start <= 0 && !AERO.on;
}
function xplPose() {
  const k = XPL.k;
  for (const p of XPL.parts) p.o.position.copy(p.d).multiplyScalar(ease(clamp((k - p.t) / XPL_SPAN, 0, 1)));
  shadowScale(1 + (XPL_SHADOW - 1) * sstep(0, 0.4, k));
}
function updateExplode(dt, snap = false) {
  const want = XPL.want = xplWanted() ? 1 : 0;
  if (XPL.k === want) return false;
  if (want) xplPrepare();
  const was = XPL.k;
  XPL.k = snap || reduceMotion ? want : want > was ? Math.min(want, was + dt / XPL_OUT) : Math.max(want, was - dt / XPL_IN);
  if ((was > 0) !== (XPL.k > 0)) xplSync();
  xplPose();
  shadowDirty = Math.max(shadowDirty, 2);
  return true;
}
// the camera backs away and looks higher at once when the car comes apart, and closes in as the pieces come home
const xplView = () => Math.max(XPL.want, ease(XPL.k));
const xplPull = () => 1 + XPL_VIEW[state.view][0] * xplView();
const xplLift = () => XPL_VIEW[state.view][1] * xplView();
function setExplode(on) {
  state.explode = on;
  if (on) {
    if (AERO.on) setAero(false);
    if (state.pose !== 'park') setPose('park');
    if (state.view === 'driver') goView('front');
  }
  needsRender = true;
  syncUI();
}
