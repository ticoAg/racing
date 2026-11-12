/* =========================================================================
   PARTS STORE — the parked car is taken apart and its parts are set out on
   the studio floor around the bare tub, sorted by system: body, doors,
   canopy, aero, cabin, wheels, tail, suspension, powertrain. Every system
   has a bay; each goes back onto the car on its own, or all of them at once.
   Every builder names its parts (part()); here each name belongs to a system
   and has a place in that system's bay. The bays are packed from the parts'
   own sizes, so they suit every model and configuration. The skin is one
   lofted mesh: the first time it is needed it is cut along the shut lines the
   paint already shows (bonnet, engine cover, the four fenders, the tub in
   between), with whatever is laid onto it (lights, vents, lettering) cut the
   same way. The powertrain and the suspension (blk_mech.js) are under the
   skin: they are only drawn while the store is open. Surfaces that are only
   ever seen from one side get an inner face while parts are off the car.
   Any part can be picked up for a closer look: it rises to eye level, the
   camera comes in, the studio dims around it, and dragging turns the part
   itself, so that every side of it can be brought into the light.
   ========================================================================= */
// the systems, in the order of their buttons. list: the parts of a bay row by row ("/" starts a new row; + and - are
// the car's right and left side, a digit is the wheel). Rows run away from the car unless they run along it; gap is the
// floor between the parts of a row where the usual is too little.
const XPL_MODS = [
  { id: 'body', name: '车身', list: 'fenderF+ bonnet fenderF- / fenderR+ deck fenderR-' },
  { id: 'doors', name: '车门', list: 'doorTrim+ doorOuter+ doorGlass+ mirror+ / doorTrim- doorOuter- doorGlass- mirror-' },
  { id: 'canopy', name: '座舱盖', list: 'pillar+ glass pillar- / quarter+ roof quarter- / scoop' },
  { id: 'aero', name: '空力', along: true, list: 'skirt+ skirt- / splitter diffuser plane flap spoiler / plate+ plate- pylon+ pylon- fin / canard+ canard- fence+ fence-' },
  { id: 'cabin', name: '内饰', list: 'pedals steer / dash / seat- console seat+ / bulkhead' },
  { id: 'wheels', name: '轮组', gap: 0.3, list: [0, 1, 2, 3].map((n) => ['upright', 'brake', 'disc', 'rim', 'tyre', 'lock'].map((p) => p + n).join(' ')).join(' / ') },
  { id: 'tail', name: '尾部', along: true, list: 'tail / taillight / exhaust' },
  { id: 'susp', name: '悬挂', along: true, list: 'lower0 lower1 lower2 lower3 / upper0 upper1 upper2 upper3 / coil0 coil1 coil2 coil3 / barF / rack / barR' },
  { id: 'power', name: '动力', along: true, list: 'head+ intake head- / manifold+ engine manifold- / pipe+ propshaft gearbox pipe- / inverterF motor0 gearF motor1 / battery / inverterR motor2 gearR motor3 / shaft0 shaft1 shaft2 shaft3 / radiator+ shaft+ shaft- radiator radiator-' },
];
// where the bays lie: in a band beside the car to its left and to its right (front to rear), and one behind the other
// off its tail and off its nose, between those bands
const XPL_BANDS = { L: ['aero', 'body', 'canopy'], R: ['wheels', 'cabin', 'doors'], B: ['tail', 'susp'], F: ['power'] };
const XPL_OF = {};
for (const m of XPL_MODS) { m.rows = m.list.split(' / ').map((r) => r.split(' ')); for (const k of m.rows.flat()) XPL_OF[k] = m.id; }
const XPL_OUT = 1.9, XPL_IN = 1.6;      // seconds for a system to be laid out and to be fitted again
const XPL_SPAN = 0.5;                   // share of that time one part is on the move
const XPL_GAP = 0.15, XPL_ROW = 0.22;   // floor between parts in a row, between rows (m)
const XPL_AISLE = 0.65, XPL_BAY = 0.5;  // floor between the car and the bays, between bays
const XPL_EDGE = 0.17;                  // a bay's outline stands this far off its parts
// live: the store is open (the car stands switched off in the studio and parts may be out). any: parts are off the car.
// mods: per system { k: 0 on the car .. 1 in its bay }. reg: what can move. items: the parts with their places.
// panels, twins and pieces only exist once parts have been off the car. hold: how far out the parts go (stills of the flight).
// held: the part picked up for a closer look; back: where the camera was before; focus: how far up the part in the air is.
const XPL = { hold: 1, held: null, back: null, focus: 0, turned: false, lamps: null, tent: null, live: false, any: false, mods: {}, reg: [], items: [], bays: {}, box: null, floor: null, fade: 0, hover: '', shadow: 1, ready: false, panels: [], twins: [], pieces: [] };
for (const m of XPL_MODS) XPL.mods[m.id] = { k: 0, wait: 0, hot: 0 };

const xplKey = (name, side = 0) => name + (side > 0 ? '+' : side < 0 ? '-' : '');
function xplAdd(o, key, panel = false) {
  if (XPL_OF[key]) XPL.reg.push({ o, key, mod: XPL_OF[key], panel });
}
function xplFloorOff() {
  if (!XPL.floor) return;
  XPL.floor.traverse((o) => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
  scene.remove(XPL.floor);
  XPL.floor = null;
}
function xplReset() {
  for (const m of XPL_MODS) Object.assign(XPL.mods[m.id], { k: 0, wait: 0, hot: 0 });
  Object.assign(XPL, { held: null, back: null, focus: 0, live: false, any: false, reg: [], items: [], bays: {}, box: null, fade: 0, shadow: 1, ready: false, panels: [], twins: [], pieces: [] });
  heldPass.enabled = false; controls.enableRotate = true; canvas.style.cursor = '';
  if (XPL.lamps) xplLamps(null, 0);
  xplFloorOff();
  if (BODY.shell) BODY.shell.visible = true;
  shadowScale(1);
}

// what can come off the car just built
function buildExplode() {
  xplReset();
  // named children of the body: one carrier per name and side
  const carriers = new Map();
  for (const o of [...car.children]) {
    if (!o.userData.part) continue;
    const key = xplKey(o.userData.part, o.userData.side);
    let h = carriers.get(key);
    if (!h) { h = new THREE.Group(); carriers.set(key, h); car.add(h); xplAdd(h, key); }
    h.add(o);
  }
  for (const s of [-1, 1]) {
    const D = DOORS[s];
    if (D) { xplAdd(D.outer, xplKey('doorOuter', s)); xplAdd(D.inner, xplKey('doorTrim', s)); xplAdd(D.pane, xplKey('doorGlass', s)); if (D.mirror) xplAdd(D.mirror, xplKey('mirror', s)); }
    xplAdd(BODY.wingSub.plates[s], xplKey('plate', s)); xplAdd(BODY.wingSub.pylons[s], xplKey('pylon', s));
  }
  xplAdd(BODY.wingSub.plane, 'plane'); xplAdd(BODY.wingSub.flap, 'flap');
  const C = BODY.cabin;
  xplAdd(C.seatL, 'seat-'); xplAdd(C.seatR, 'seat+'); xplAdd(C.console, 'console'); xplAdd(C.dash, 'dash'); xplAdd(C.wheel, 'steer');
  xplAdd(C.pedals, 'pedals'); xplAdd(C.bulkhead, 'bulkhead');
  // the headlining goes with the roof and the rear quarters it lines
  xplAdd(C.liner, 'roof'); xplAdd(C.linerL, 'quarter-'); xplAdd(C.linerR, 'quarter+');
  for (const [key, g] of Object.entries(BODY.mechParts)) xplAdd(g, key);
  WHEEL_OBJS.forEach((w, n) => { for (const k of ['tyre', 'rim', 'lock', 'disc', 'brake', 'upright']) xplAdd(w.userData.sub[k], k + n); });
}

/* ---------- cutting the skin into panels ---------- */
// panels: 0 tub (stays on the floor pan), 1 bonnet, 2/3 front fenders (right, left), 4 engine cover, 5/6 rear fenders
const XPL_PANELS = ['tub', 'bonnet', 'fenderF+', 'fenderF-', 'deck', 'fenderR+', 'fenderR-'];
function xplCutter() {
  const [hx, hz] = SPEC.body.seams.hood, [dx, dz] = SPEC.body.seams.deck;
  // an engine behind the cabin lies ahead of the engine cover's shut line, under the tail of the canopy: there the
  // cover comes off from the bulkhead back
  const E = SPEC.mech.engine, bx = E && E.x0 < 0 ? WX0 - 0.02 : dx;
  const region = (x, z) => (x >= hx ? (z >= hz ? 2 : z <= -hz ? 3 : 1) : x <= dx ? (z >= dz ? 5 : z <= -dz ? 6 : 4) : x <= bx && Math.abs(z) < dz ? 4 : 0);
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
    const ff = (p) => p[0] - hx, fd = (p) => dx - p[0], fb = (p) => bx - p[0];
    const rest = clipBy(poly, ff, -1);
    across(clipBy(poly, ff, 1), hz, 1, 2, 3, out);
    across(clipBy(rest, fd, 1), dz, 4, 5, 6, out);
    const mid = clipBy(rest, fd, -1), tub = bx > dx ? clipBy(mid, fb, -1) : mid;
    if (bx > dx) across(clipBy(mid, fb, 1), dz, 4, 0, 0, out);
    if (tub.length >= 3) out.push([0, tub]);
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
  const gen = new THREE.PMREMGenerator(renderer);
  XPL.tent = gen.fromScene(xplTent(), 0.02).texture;
  gen.dispose();
}
// the light a held part is looked at in: a tent of soft boxes on every side (the camera stands at +z), so that a glossy
// surface has something to reflect whichever way it is turned, over a room that is not quite dark
function xplTent() {
  const tent = new THREE.Scene();
  // (lighter overhead than underfoot, so that form still reads on what reflects only the room)
  tent.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(vec3(1.0, 1.01, 1.04) * mix(mix(0.03, 0.085, smoothstep(-1.0, 0.0, h)), 0.2, smoothstep(0.0, 1.0, h)), 1.0); }',
  })));
  // [width, height, light, where it hangs]: overhead, key over the left shoulder, fill to the right, two strips behind
  // for the edges, a wall behind the camera for what faces it, the floor
  for (const [w, h, light, at] of [[6.5, 6.5, 3.0, [0, 5.5, 0]], [4.5, 3.5, 5.0, [-4.5, 3.2, 4.5]], [3.5, 4.5, 1.8, [5.5, 1.2, 3]], [1, 6, 5, [-4.5, 2.5, -6]], [1, 6, 5, [4.5, 2.5, -6]], [9, 5, 2.0, [0, 0.5, 8]], [14, 14, 0.18, [0, -3.5, 0]]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(light), side: THREE.DoubleSide }));
    m.position.fromArray(at); m.lookAt(0, 0, 0);
    tent.add(m);
  }
  return tent;
}

// everything that is only needed while parts are off the car, made the first time they are
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
    xplAdd(h, XPL_PANELS[r], true);
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
// the cut panels stand in for the shell while anything is off the car; their lettering shows what the shell's would
function xplSync() {
  if (!XPL.ready) return;
  BODY.shell.visible = !XPL.any;
  BODY.mech.visible = XPL.live || XPL.any;
  for (const h of XPL.panels) h.visible = XPL.any;
  for (const t of XPL.twins) t.visible = XPL.any;
  for (const [m, d] of XPL.pieces) m.visible = d.visible;
}

/* ---------- the floor plan ---------- */
// is anything of it there to be seen (the wing not fitted, the track kit off)
function xplShown(o) {
  for (let q = o; q && q !== carRoot; q = q.parent) if (!q.visible) return false;
  let any = false;
  const walk = (q) => { if (any || !q.visible) return; if (q.isMesh) { any = true; return; } q.children.forEach(walk); };
  walk(o);
  return any;
}
// the rows of a bay, packed: u along the row, v across the rows; each row centred
function xplPack(rows, size, gap) {
  const len = (r) => r.reduce((s, k) => s + size.get(k)[0], 0) + gap * (r.length - 1);
  const U = Math.max(...rows.map(len)), slots = new Map();
  let V = 0;
  for (const r of rows) {
    const deep = Math.max(...r.map((k) => size.get(k)[1]));
    let u = (U - len(r)) / 2;
    for (const k of r) { slots.set(k, [u + size.get(k)[0] / 2, V + deep / 2]); u += size.get(k)[0] + gap; }
    V += deep + XPL_ROW;
  }
  return { U, V: V - XPL_ROW, slots };
}
const _xb = new THREE.Box3(), _xm = new THREE.Matrix3(), UP = new V3(0, 1, 0);
// every part's place on the floor, from the sizes of the parts as they are now
function xplLayout() {
  // measured on the car: nothing held or moved, doors shut, wheels and steering wheel straight
  xplDrop();
  for (const it of XPL.items) if (it.s > 0) xplDown(it);
  for (const r of XPL.reg) { r.o.position.set(0, 0, 0); r.o.quaternion.identity(); }
  const keep = [];
  for (const o of [DOORS[1] && DOORS[1].pivot, DOORS[-1] && DOORS[-1].pivot, CAB.spin, ...FRONT_PIVOTS]) if (o) { keep.push([o, o.quaternion.clone()]); o.quaternion.identity(); }
  carRoot.updateMatrixWorld(true);
  const items = new Map();
  for (const r of XPL.reg) {
    let it = items.get(r.key);
    // box, c, r: its box, middle and reach on the car. at, t, h: its place in the bay, when it leaves, how high it flies.
    // pos, base: where it is now and where it lies (from its place on the car). s, q, lift: how far it is held up, how
    // it has been turned, how high its middle floats.
    if (!it) items.set(r.key, it = { key: r.key, mod: r.mod, objs: [], box: new THREE.Box3(), c: new V3(), r: 0, at: null, t: 0, h: 0, pos: new V3(), base: new V3(), s: 0, q: new THREE.Quaternion(), lift: 0 });
    if (!r.panel && !xplShown(r.o)) continue;
    _xb.setFromObject(r.o, true);
    if (_xb.isEmpty()) continue;
    it.box.union(_xb);
    // (pw: what carries it, in the studio; to set it down and to turn it there)
    const pw = r.o.parent.matrixWorld.clone();
    it.objs.push({ o: r.o, d: new V3(), up: new V3(), pw, pwi: pw.clone().invert() });
  }
  XPL.items = [...items.values()];
  for (const it of XPL.items) if (it.objs.length) { it.box.getCenter(it.c); it.r = it.box.getSize(_xp).length() / 2; }
  // each bay packed on its own: a along its band, b away from the car
  const packed = {};
  for (const m of XPL_MODS) {
    const beside = XPL_BANDS.L.includes(m.id) || XPL_BANDS.R.includes(m.id), size = new Map();
    for (const it of XPL.items) {
      if (it.mod !== m.id || it.box.isEmpty()) continue;
      const dx = it.box.max.x - it.box.min.x, dz = it.box.max.z - it.box.min.z, a = beside ? dx : dz, b = beside ? dz : dx;
      size.set(it.key, m.along ? [a, b] : [b, a]);
    }
    const rows = m.rows.map((r) => r.filter((k) => size.has(k))).filter((r) => r.length);
    if (!rows.length) continue;
    const P = xplPack(rows, size, m.gap || XPL_GAP);
    packed[m.id] = { A: m.along ? P.U : P.V, B: m.along ? P.V : P.U, slots: P.slots, along: m.along, order: rows.flat() };
  }
  // the bands: beside the car front to rear, centred on it; off its tail and off its nose one bay behind the other,
  // each centred on the car's middle
  const cx = (XF + XR) / 2, zin = Math.max(BC.a(0.9), BC.a(-1.3)) + 0.12 + XPL_AISLE, xin = XR - XPL_AISLE, xout = XF + XPL_AISLE;
  XPL.bays = {};
  XPL.box = new THREE.Box3(new V3(XR - 0.1, 0, -1.15), new V3(XF + 0.15, 0.55, 1.15));
  for (const [band, ids] of Object.entries(XPL_BANDS)) {
    const list = ids.filter((id) => packed[id]), sgn = band === 'L' ? -1 : 1, end = band === 'B' || band === 'F';
    let a0 = -(list.reduce((s, id) => s + packed[id].A, 0) + XPL_BAY * (list.length - 1)) / 2, b0 = 0;
    for (const id of list) {
      const Z = packed[id], a00 = end ? -Z.A / 2 : a0, b00 = b0;
      // bay coordinates to the floor
      const at = band === 'B' ? (a, b) => [xin - b00 - b, a00 + a] : band === 'F' ? (a, b) => [xout + b00 + b, a00 + a] : (a, b) => [cx - (a00 + a), sgn * (zin + b)];
      const p = at(0, 0), q = at(Z.A, Z.B), e = XPL_EDGE;
      const bay = XPL.bays[id] = { x0: Math.min(p[0], q[0]) - e, x1: Math.max(p[0], q[0]) + e, z0: Math.min(p[1], q[1]) - e, z1: Math.max(p[1], q[1]) + e, band, line: null };
      XPL.box.expandByPoint(_xp.set(bay.x0, 0, bay.z0)).expandByPoint(_xp.set(bay.x1, 0, bay.z1));
      Z.order.forEach((k, i) => {
        const it = items.get(k), s = Z.slots.get(k), w = Z.along ? at(s[0], s[1]) : at(s[1], s[0]);
        it.at = new V3(w[0] - (it.box.min.x + it.box.max.x) / 2, 0.015 - it.box.min.y, w[1] - (it.box.min.z + it.box.max.z) / 2);
        it.t = Z.order.length > 1 ? (1 - XPL_SPAN) * i / (Z.order.length - 1) : 0;
        // it flies in an arc, higher the further it goes
        it.h = clamp(0.16 * Math.hypot(it.at.x, it.at.z), 0.25, 0.9);
        for (const j of it.objs) {
          _xm.setFromMatrix4(j.pwi);
          j.d.copy(it.at).applyMatrix3(_xm); j.up.copy(UP).applyMatrix3(_xm);
        }
      });
      if (end) b0 += Z.B + XPL_BAY; else a0 += Z.A + XPL_BAY;
    }
  }
  for (const [o, q] of keep) o.quaternion.copy(q);
  // the contact shadow reaches as far as the bays do
  const B = XPL.box;
  XPL.shadow = Math.max(1, (2 * Math.max(-B.min.x, B.max.x) + 0.6) / SHW, (2 * Math.max(-B.min.z, B.max.z) + 0.6) / SHD);
  xplFloor();
  xplPose();
}
// the outline of each bay on the floor
function xplFloor() {
  xplFloorOff();
  const g = XPL.floor = new THREE.Group();
  g.userData.noShadow = true;
  const rr = (s, x0, z0, x1, z1, r) => {
    s.moveTo(x0 + r, z0); s.lineTo(x1 - r, z0); s.quadraticCurveTo(x1, z0, x1, z0 + r); s.lineTo(x1, z1 - r); s.quadraticCurveTo(x1, z1, x1 - r, z1);
    s.lineTo(x0 + r, z1); s.quadraticCurveTo(x0, z1, x0, z1 - r); s.lineTo(x0, z0 + r); s.quadraticCurveTo(x0, z0, x0 + r, z0);
  };
  for (const b of Object.values(XPL.bays)) {
    const w = 0.022, shape = new THREE.Shape(), hole = new THREE.Path();
    rr(shape, b.x0, b.z0, b.x1, b.z1, 0.14); rr(hole, b.x0 + w, b.z0 + w, b.x1 - w, b.z1 - w, 0.14 - w);
    shape.holes.push(hole);
    // (the shape's y is the floor's z: turned down onto it)
    b.line = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xecebe6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    b.line.position.y = 0.004;
    b.line.renderOrder = 1;
    g.add(b.line);
  }
  g.visible = false;
  scene.add(g);
}

/* ---------- per frame ---------- */
// the store is only open while the car stands switched off in the studio; anything else puts the car together first
function xplWanted() {
  const d = DRIVE;
  return state.explode && state.pose === 'park' && d.prog === 'park' && d.v === 0 && d.engine === 0 && d.start <= 0 && !AERO.on;
}
function xplPose() {
  let kmax = 0;
  for (const it of XPL.items) {
    const k = XPL.mods[it.mod].k, e = it.at ? ease(clamp((k - it.t) / XPL_SPAN, 0, 1)) : 0, arc = it.h * Math.sin(Math.PI * e);
    if (it.at) it.base.copy(it.at).multiplyScalar(e); else it.base.set(0, 0, 0);
    it.base.y += arc;
    it.pos.copy(it.base);
    if (it.s > 0) xplHeld(it);
    else for (const j of it.objs) j.o.position.copy(j.d).multiplyScalar(e).addScaledVector(j.up, arc);
    kmax = Math.max(kmax, k);
  }
  shadowScale(1 + (XPL.shadow - 1) * sstep(0, 0.12, kmax));
}
// a part held up: raised above where it lies and turned about its own middle
const _xq = new THREE.Quaternion(), _xa = new THREE.Quaternion(), _xM = new THREE.Matrix4(), _xT = new THREE.Matrix4(), _xs = new V3();
function xplHeld(it) {
  const e = ease(it.s);
  it.pos.y += (it.lift - it.c.y - it.pos.y) * e;
  // in the studio: to its middle on the car, turned, out to where it floats; then into the frame of what carries it
  _xM.makeRotationFromQuaternion(_xq.identity().slerp(it.q, e)).setPosition(_xp.copy(it.c).add(it.pos));
  _xM.multiply(_xT.makeTranslation(-it.c.x, -it.c.y, -it.c.z));
  for (const j of it.objs) _xT.multiplyMatrices(j.pwi, _xM).multiply(j.pw).decompose(j.o.position, j.o.quaternion, _xs);
}
// the lamps a held part stands in besides the tent: a key and a fill over the camera's shoulders, shining on the picture
// of the part alone (layer 1), so that turning the part runs a hard light across its grain
function xplLamps(it, k) {
  if (!XPL.lamps) XPL.lamps = [[0xfff3e4, 1.3, -0.9, 1.0], [0xcbd9ff, 0.4, 1.1, -0.15]].map(([colour, power, x, y]) => {
    const l = new THREE.DirectionalLight(colour, 0);
    l.layers.set(1);
    l.userData = { power, x, y };
    scene.add(l, l.target);
    return l;
  });
  camera.updateMatrixWorld();
  _xr.setFromMatrixColumn(camera.matrixWorld, 0); _xu.setFromMatrixColumn(camera.matrixWorld, 1); _xc.setFromMatrixColumn(camera.matrixWorld, 2);
  for (const l of XPL.lamps) {
    l.visible = k > 0; l.intensity = l.userData.power * k;
    if (it) { l.target.position.copy(it.c).add(it.pos); l.position.copy(l.target.position).addScaledVector(_xr, l.userData.x).addScaledVector(_xu, l.userData.y).add(_xc); }
  }
}
// set down again: as it was
function xplDown(it) {
  it.s = 0; it.q.identity();
  for (const j of it.objs) { j.o.quaternion.identity(); j.o.traverse((o) => o.layers.disable(1)); }
}
// the store opens or closes: the camera goes up to look over the floor, or back down to the car
function xplOpen(live) {
  XPL.live = live;
  const n = XPL_MODS.length;
  XPL_MODS.forEach((m, i) => { XPL.mods[m.id].wait = (live ? i : n - 1 - i) * 0.1; });
  if (live) {
    xplPrepare();
    xplSync();
    xplLayout();
    if (state.doors && state.apart.doors) setDoors(false);
  } else { xplSync(); canvas.style.cursor = ''; }
  if (state.view !== 'driver') goView(state.view, window.__TEST__ ? 0 : 1.7);
}
// a change of kit or wing while the store is open: the bays are packed again
function xplRefit() {
  if (XPL.live) { xplLayout(); needsRender = true; }
}
function updateExplode(dt, snap = false) {
  const live = xplWanted(), still = snap || reduceMotion;
  if (live !== XPL.live) xplOpen(live);
  let active = false, moved = false;
  for (const m of XPL_MODS) {
    const S = XPL.mods[m.id], want = live && state.apart[m.id] ? XPL.hold : 0;
    if (S.k === want) { S.wait = 0; continue; }
    active = true;
    if (!still && S.wait > 0) { S.wait -= dt; continue; }
    S.k = still ? want : want > S.k ? Math.min(want, S.k + dt / XPL_OUT) : Math.max(want, S.k - dt / XPL_IN);
    moved = true;
  }
  // the part held up rises (and turns slowly on the turntable); one let go comes back down, turning back as it does
  let focus = 0;
  for (const it of XPL.items) {
    const up = it === XPL.held ? 1 : 0;
    if (!up && it.s === 0) continue;
    if (it.s !== up) { it.s = still ? up : up ? Math.min(1, it.s + dt / 0.8) : Math.max(0, it.s - dt / 0.6); active = moved = true; }
    if (up && state.turntable && !XPL_PTR.ids.size && !still) { it.q.premultiply(_xa.setFromAxisAngle(UP, dt * 0.5)); active = moved = true; }
    if (it.s === 0) xplDown(it);
    focus = Math.max(focus, it.s);
  }
  if (XPL.turned) { XPL.turned = false; moved = true; }
  // the studio dims around it and the part itself stands in the light (heldPass)
  if (focus > 0 || XPL.focus > 0) xplLamps(XPL.held || XPL.items.find((it) => it.s > 0), ease(focus));
  if (focus !== XPL.focus) { XPL.focus = focus; heldPass.enabled = focus > 0; }
  if (moved) {
    const any = XPL_MODS.some((m) => XPL.mods[m.id].k > 0);
    if (any !== XPL.any) { XPL.any = any; xplSync(); }
    xplPose();
    shadowDirty = Math.max(shadowDirty, 2);
  }
  // the bay outlines: there while the store is open, brighter for the system that is moving or pointed at
  if (XPL.floor) {
    const f = live ? 1 : 0, r = still ? 1 : 1 - Math.exp(-dt * 5);
    if (XPL.fade !== f) { XPL.fade += (f - XPL.fade) * r; if (Math.abs(XPL.fade - f) < 0.004) XPL.fade = f; active = true; }
    for (const m of XPL_MODS) {
      const S = XPL.mods[m.id], b = XPL.bays[m.id], hot = XPL.hover === m.id || (S.k > 0 && S.k < 1) ? 1 : 0;
      if (S.hot !== hot) { S.hot += (hot - S.hot) * r; if (Math.abs(S.hot - hot) < 0.004) S.hot = hot; active = true; }
      if (b) b.line.material.opacity = XPL.fade * (0.14 + 0.4 * S.hot);
    }
    XPL.floor.visible = XPL.fade > 0;
  }
  return active;
}

/* ---------- camera ---------- */
// from where the floor is looked over: [azimuth from straight ahead, elevation] (deg). On an upright screen the front
// and rear views look along the car, so that its length runs up the screen.
const XPL_LOOK = { front: [62, 34], rear: [118, 34], side: [90, 46], top: [90, 84] };
const _xc = new V3(), _xr = new V3(), _xu = new V3(), _xp = new V3();
// the view of the whole floor, or of the wheel and cabin bays for their views; null where the usual view serves
function xplView(name) {
  if (!XPL.live || !XPL.box) return null;
  let box = XPL.box, look = XPL_LOOK[name];
  if (name === 'wheel' || name === 'cabin') {
    const id = name === 'wheel' ? 'wheels' : 'cabin', b = XPL.bays[id];
    if (!b || !state.apart[id]) return null;
    box = new THREE.Box3(new V3(b.x0, 0, b.z0), new V3(b.x1, 0.75, b.z1));
    look = [b.band === 'L' ? -64 : 64, 34];
  }
  if (!look) return null;
  let [az, el] = look;
  const a = camera.aspect;
  if (a < 1 && (name === 'front' || name === 'rear')) az = name === 'front' ? 12 : 168;
  const dir = new V3(Math.cos(RAD(el)) * Math.cos(RAD(az)), Math.sin(RAD(el)), Math.cos(RAD(el)) * Math.sin(RAD(az)));
  // far enough for every corner of the box to be in the picture, in the part of it the header and the rail leave free
  const [free, off] = xplFree(), tv = Math.tan(RAD(viewFov(name, a)) / 2), th = tv * a;
  box.getCenter(_xc);
  _xr.crossVectors(UP, dir).normalize(); _xu.crossVectors(dir, _xr);
  let d = 0;
  for (let i = 0; i < 8; i++) {
    _xp.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(_xc);
    const near = _xp.dot(dir);
    d = Math.max(d, near + Math.abs(_xp.dot(_xr)) / (th * 0.92), near + Math.abs(_xp.dot(_xu)) / (tv * free * 0.94));
  }
  d *= pull;
  // looking a little below the middle of the floor puts it in the middle of that free part
  const t = _xc.clone().addScaledVector(_xu, -d * tv * off);
  return { p: dir.multiplyScalar(d).add(t), t };
}
// the share of the picture's height the header and the rail leave free, and how far above the picture's middle the
// middle of that part lies (the rail is out of the way while the phone sheet is open: the picture is shifted above it)
function xplFree() {
  const [, h] = size0(), rail = document.querySelector('.rail');
  const top = 58, bot = rail && !(state.panel && sheetLayout()) ? Math.max(0, h - rail.getBoundingClientRect().top) : 0;
  return [clamp((h - top - bot) / h, 0.45, 1), (bot - top) / h];
}

/* ---------- a part picked up ---------- */
const xplMeshes = (o, out) => { if (!o.visible) return; if (o.isMesh) out.push(o); for (const c of o.children) xplMeshes(c, out); };
const _xray = new THREE.Raycaster(), _xn = new THREE.Vector2(), _xball = new THREE.Sphere();
// the part under a point of the picture (client px): the nearest box for the pointer, the nearest surface for a click
function xplUnder(x, y, exact) {
  const r = canvas.getBoundingClientRect();
  _xray.setFromCamera(_xn.set((x - r.left) / r.width * 2 - 1, 1 - (y - r.top) / r.height * 2), camera);
  const ray = _xray.ray, near = [];
  for (const it of XPL.items) {
    if (!it.objs.length) continue;
    const p = it.s > 0 ? ray.intersectSphere(_xball.set(_xp.copy(it.c).add(it.pos), it.r), _xc) : ray.intersectBox(_xb.copy(it.box).translate(it.pos), _xc);
    if (p) near.push([p.distanceTo(ray.origin), it]);
  }
  near.sort((a, b) => a[0] - b[0]);
  if (!exact) return near.length ? near[0][1] : null;
  let best = null, at = Infinity;
  for (const [d, it] of near) {
    if (d > at) break;
    const meshes = [];
    for (const j of it.objs) xplMeshes(j.o, meshes);
    const hit = _xray.intersectObjects(meshes, false)[0];
    if (hit && hit.distance < at) { at = hit.distance; best = it; }
  }
  return best;
}
// picked up: it rises above where it lies and the camera comes in a little above it, from the side it was looking from
function xplPick(it) {
  if (!XPL.live || !it || !it.objs.length || it === XPL.held) return;
  if (!XPL.held) XPL.back = { p: camera.position.clone(), t: controls.target.clone() };
  XPL.held = it;
  it.lift = Math.max(1.35, it.r + 0.8);
  for (const j of it.objs) j.o.traverse((o) => o.layers.enable(1));
  controls.enableRotate = false;
  canvas.style.cursor = '';
  const c = new V3(it.c.x + it.base.x, it.lift, it.c.z + it.base.z), dir = camera.position.clone().sub(c).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 1);
  dir.normalize().multiplyScalar(Math.cos(RAD(16))).setY(Math.sin(RAD(16)));
  // as far as all of it needs, whichever way it is turned, in the free part of the picture
  const fov = viewFov(state.view, camera.aspect), tv = Math.tan(RAD(fov) / 2), [free, off] = xplFree();
  const d = it.r / Math.sin(Math.atan(Math.min(tv * free, tv * camera.aspect))) * pull;
  _xr.crossVectors(UP, dir).normalize(); _xu.crossVectors(dir, _xr);
  const t = c.addScaledVector(_xu, -d * tv * off);
  flyCamera(dir.multiplyScalar(d).add(t), t, fov, window.__TEST__ ? 0 : 1.0, state.view);
  needsRender = true;
}
// let go: it sinks back to where it lay; the camera goes back to where it was unless it is going elsewhere anyway
function xplDrop(fly = true) {
  if (!XPL.held) return;
  XPL.held = null;
  controls.enableRotate = true;
  if (fly && XPL.back) flyCamera(XPL.back.p, XPL.back.t, viewFov(state.view, camera.aspect), window.__TEST__ ? 0 : 1.0, state.view);
  XPL.back = null;
  needsRender = true;
}
// the pointer: a click picks a part up (or, beside it, lets it go); a drag turns the part that is held
const XPL_PTR = { ids: new Set(), x: 0, y: 0, x0: 0, y0: 0, t0: 0, far: false };
canvas.addEventListener('pointerdown', (e) => {
  const P = XPL_PTR;
  P.ids.add(e.pointerId);
  P.x = P.x0 = e.clientX; P.y = P.y0 = e.clientY; P.t0 = performance.now(); P.far = P.ids.size > 1;
});
canvas.addEventListener('pointermove', (e) => {
  const P = XPL_PTR;
  if (!P.ids.has(e.pointerId)) {
    // (a hand over what can be picked up)
    if (XPL.live && !P.ids.size && e.pointerType === 'mouse') canvas.style.cursor = !XPL.held && xplUnder(e.clientX, e.clientY, false) ? 'pointer' : '';
    return;
  }
  if (Math.hypot(e.clientX - P.x0, e.clientY - P.y0) > 5) P.far = true;
  if (XPL.held && P.ids.size === 1 && P.far) {
    // about the upright for a drag sideways, about the camera's level for a drag up or down
    const k = 0.008, q = XPL.held.q;
    q.premultiply(_xa.setFromAxisAngle(UP, (e.clientX - P.x) * k));
    q.premultiply(_xa.setFromAxisAngle(_xr.setFromMatrixColumn(camera.matrixWorld, 0), (e.clientY - P.y) * k));
    XPL.turned = true; needsRender = true;
    if (state.turntable) setTurntable(false);
  }
  P.x = e.clientX; P.y = e.clientY;
});
for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (e) => {
  const P = XPL_PTR;
  if (!P.ids.delete(e.pointerId) || P.ids.size || P.far || type !== 'pointerup' || performance.now() - P.t0 > 600) return;
  if (!XPL.live || switching) return;
  const it = xplUnder(e.clientX, e.clientY, true);
  if (it) xplPick(it); else xplDrop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') xplDrop(); });

/* ---------- switches ---------- */
// everything off the car and into the bays, or everything back onto it
function setExplode(on) {
  state.explode = on;
  if (on) {
    for (const m of XPL_MODS) state.apart[m.id] = true;
    if (AERO.on) setAero(false);
    if (state.pose !== 'park') setPose('park');
    if (state.view === 'driver') goView('front');
  }
  needsRender = true;
  syncUI();
}
// one system into its bay, or back onto the car
function setModule(id, apart) {
  if (!state.explode || !(id in state.apart)) return;
  state.apart[id] = apart;
  if (XPL.held && XPL.held.mod === id) xplDrop();
  if (apart && id === 'doors' && state.doors) setDoors(false);
  needsRender = true;
  syncUI();
}
