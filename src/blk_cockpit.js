/* =========================================================================
   COCKPIT — carbon tub, quilted buckets with harnesses, wheel, binnacle, console
   ========================================================================= */
const CAB = { stitch: { value: new THREE.Color('#c8102e') }, led: null, clusterCtx: null, clusterTex: null, wheelCtx: null, wheelTex: null, leds: null, spin: null, lastDraw: -1 };
const SEAT_Z = 0.31;
const EYE = new V3(-0.345, 0.905, -SEAT_Z);

// geometry batches: one merged mesh per material keeps the draw-call count low
function cockpitBatch() {
  const groups = new Map();
  return {
    add(mat, geo, m4) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (m4) g.applyMatrix4(m4);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (mat.vertexColors) { if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
      else if (g.attributes.color) g.deleteAttribute('color');
      g.clearGroups(); g.morphAttributes = {};
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(g);
    },
    build(parent) {
      const out = [];
      for (const [mat, list] of groups) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); parent.add(m); out.push(m); }
      groups.clear();
      return out;
    },
  };
}
const tinted = (geo, hex) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
// matrix from a basis (X across, Y up, Z facing) and an origin
const basisAt = (o, X, Y, Z) => new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o);
function roundedShape(pts, r) {
  const s = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, da * 0.45), rb = Math.min(r, db * 0.45);
    const p0 = [p[0] + (a[0] - p[0]) / da * ra, p[1] + (a[1] - p[1]) / da * ra];
    const p1 = [p[0] + (b[0] - p[0]) / db * rb, p[1] + (b[1] - p[1]) / db * rb];
    if (i === 0) s.moveTo(p0[0], p0[1]); else s.lineTo(p0[0], p0[1]);
    s.quadraticCurveTo(p[0], p[1], p1[0], p1[1]);
  }
  s.closePath();
  return s;
}

/* ---------- textures ---------- */
// R: leather shade (quilting valleys, perforations)  G: stitch thread. u spans the seat, v repeats every 0.12 m
function quiltTextures() {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const hgt = new Float32Array(W * H);
  const u0 = 0.29, u1 = 0.71, cols = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    let shade = 1, stitch = 0, h = 0.5 + (rand() - 0.5) * 0.05;
    for (const us of [u0 - 0.014, u1 + 0.014]) {
      const d = (u - us) * W;
      h -= 0.55 * Math.exp(-d * d / 5);
      shade -= 0.12 * Math.exp(-d * d / 4);
      for (const off of [-5.5, 5.5]) if (Math.abs(d - off) < 1.25 && (y % 7) < 4) stitch = 1;
    }
    if (u > u0 && u < u1) {
      const a = (u - u0) / (u1 - u0) * cols, b = v * 2;
      const p = a + b, q = a - b;
      const dp = Math.abs(p - Math.round(p)), dq = Math.abs(q - Math.round(q));
      const dE = Math.min(dp, dq);
      h += Math.min(1, dE * 4.2) * 0.9 - 0.45;
      shade *= 0.74 + 0.26 * Math.min(1, dE * 7);
      const along = dp < dq ? q : p;
      if (dE < 0.016 && ((along * 14) % 1 + 1) % 1 < 0.56) stitch = 1;
      // perforation grid inside each pillow
      const hx = (x % 7) - 3, hy = (y % 9) - 4;
      if (dE > 0.15 && hx * hx + hy * hy < 2.2) { shade *= 0.55; h -= 0.18; }
    }
    hgt[y * W + x] = h;
    const i = (y * W + x) * 4;
    img.data[i] = clamp(shade, 0, 1) * 255; img.data[i + 1] = stitch * 255; img.data[i + 2] = 0; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.NoColorSpace; map.wrapS = THREE.ClampToEdgeWrapping; map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const nrm = heightToNormal(hgt, W, H, 1.6);
  nrm.wrapS = THREE.ClampToEdgeWrapping;
  map.repeat.set(1, 1 / 0.12); nrm.repeat.set(1, 1 / 0.12);
  return { map, nrm };
}
function grainNormal() {
  const S = 128, h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = rand();
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    h[y * S + x] = (h[y * S + x] * 2 + h[y * S + ((x + 1) % S)] + h[((y + 1) % S) * S + x]) / 4;
  }
  const t = heightToNormal(h, S, S, 1.4);
  t.repeat.set(26, 26);
  return t;
}
function holesAlpha(cols, rows) {
  return canvasTex(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      ctx.beginPath(); ctx.arc((i + 0.5) / cols * w, (j + 0.5) / rows * h, Math.min(w / cols, h / rows) * 0.27, 0, Math.PI * 2); ctx.fill();
    }
  }, { srgb: false });
}
function monogramTex() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff';
    ctx.lineWidth = 9; ctx.setLineDash([14, 7]);
    ctx.beginPath(); ctx.arc(128, 128, 104, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    setFont(ctx, 800, 150, 'normal', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', 128, 136);
  }, { srgb: false });
}
function badgeTex(text, size = 120) {
  return canvasTex(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; setFont(ctx, 800, size * 0.62, 'expanded', 'italic');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, { srgb: false });
}
function centreScreenTex() {
  return canvasTex(384, 384, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#0a0e16'); g.addColorStop(1, '#04060a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7f8b99'; setFont(ctx, 600, 17, 'expanded'); ctx.textAlign = 'left'; ctx.fillText('TRACK', 22, 34);
    ctx.textAlign = 'right'; ctx.fillText('21:40', w - 22, 34);
    // top-down car outline
    ctx.save(); ctx.translate(w / 2, h / 2 + 10);
    ctx.strokeStyle = '#cfd6df'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -120); ctx.bezierCurveTo(46, -118, 52, -70, 50, -30); ctx.lineTo(54, 60); ctx.bezierCurveTo(56, 104, 40, 118, 0, 120); ctx.bezierCurveTo(-40, 118, -56, 104, -54, 60); ctx.lineTo(-50, -30); ctx.bezierCurveTo(-52, -70, -46, -118, 0, -120); ctx.stroke();
    ctx.fillStyle = 'rgba(207,214,223,0.18)'; ctx.beginPath(); ctx.ellipse(0, -10, 26, 52, 0, 0, Math.PI * 2); ctx.fill();
    const tyres = [[-1, -1, '2.1', '84°'], [1, -1, '2.1', '86°'], [-1, 1, '1.9', '91°'], [1, 1, '1.9', '93°']];
    for (const [sx, sy, p, t] of tyres) {
      ctx.fillStyle = '#2fd17a'; ctx.fillRect(sx * 62 - (sx < 0 ? 12 : 0), sy * 64 - 22, 12, 44);
      ctx.textAlign = sx < 0 ? 'right' : 'left';
      ctx.fillStyle = '#e8eef6'; setFont(ctx, 700, 22, 'normal'); ctx.fillText(p, sx * 92, sy * 64 - 2);
      ctx.fillStyle = '#7f8b99'; setFont(ctx, 600, 15, 'normal'); ctx.fillText(t, sx * 92, sy * 64 + 18);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(0, h - 64, w, 64);
    ctx.fillStyle = '#cfd6df'; setFont(ctx, 600, 18, 'normal'); ctx.textAlign = 'center';
    ['21.5°', 'AUTO', 'ESC', '21.5°'].forEach((s, i) => ctx.fillText(s, (i + 0.5) * w / 4, h - 26));
  });
}

/* ---------- materials ---------- */
function cockpitMaterials() {
  const quilt = quiltTextures();
  const grain = grainNormal();
  M.seat = new THREE.MeshPhysicalMaterial({
    color: 0x141416, roughness: 0.6, metalness: 0, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x4a4a52),
    clearcoat: 0.12, clearcoatRoughness: 0.42, map: quilt.map, normalMap: quilt.nrm, normalScale: new THREE.Vector2(0.9, 0.9), side: THREE.DoubleSide,
  });
  M.seat.onBeforeCompile = (sh) => {
    sh.uniforms.uStitch = CAB.stitch;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uStitch;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  vec4 qtx = texture2D( map, vMapUv );\n  diffuseColor.rgb = mix( diffuseColor.rgb * qtx.r, uStitch, qtx.g );\n#endif');
  };
  M.seat.envMapIntensity = 0.7;
  CAB.leather = new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.7, color: 0x141416, roughness: 0.55, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x4a4a52), clearcoat: 0.1, clearcoatRoughness: 0.4, normalMap: grain, normalScale: new THREE.Vector2(0.35, 0.35), side: THREE.DoubleSide });
  CAB.suede = new THREE.MeshPhysicalMaterial({ envMapIntensity: 0.55, color: 0x1b1b1e, roughness: 1.0, metalness: 0, sheen: 1.0, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x3d3d44), side: THREE.DoubleSide });
  CAB.carbon = M.carbon.clone(); CAB.carbon.side = THREE.DoubleSide; CAB.carbon.envMapIntensity = 0.6;
  CAB.alu = new THREE.MeshStandardMaterial({ color: 0xc9cbcf, metalness: 1.0, roughness: 0.24, side: THREE.DoubleSide, envMapIntensity: 0.65 });
  CAB.aluHoles = new THREE.MeshStandardMaterial({ color: 0x45474c, metalness: 0.9, roughness: 0.45, envMapIntensity: 0.25, alphaMap: holesAlpha(3, 4), alphaTest: 0.5, side: THREE.DoubleSide });
  CAB.dark = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.3, roughness: 0.45, side: THREE.DoubleSide });
  CAB.parts = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 0.7 });
  CAB.led = new THREE.MeshBasicMaterial({ color: 0xff2238, toneMapped: false });
  CAB.mono = new THREE.MeshStandardMaterial({ color: 0xc8102e, alphaMap: monogramTex(), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  CAB.badge = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.25, alphaMap: badgeTex('HALCYON'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  M.seatAccent = new THREE.MeshStandardMaterial({ color: 0xa8101f, roughness: 0.62, side: THREE.DoubleSide, normalMap: grain, normalScale: new THREE.Vector2(0.4, 0.4) });
  const web = grainNormal(); web.repeat.set(4, 90);
  M.harnessMat = new THREE.MeshStandardMaterial({ color: 0xa8101f, roughness: 0.78, side: THREE.DoubleSide, normalMap: web, normalScale: new THREE.Vector2(0.8, 0.8) });
}

/* ---------- seats ---------- */
const SEAT = (() => {
  const pts = [[0.116, 0.302], [0.128, 0.342], [0.112, 0.374], [0.06, 0.386], [-0.06, 0.372], [-0.18, 0.354], [-0.262, 0.354], [-0.322, 0.39], [-0.362, 0.478], [-0.402, 0.598], [-0.44, 0.706], [-0.474, 0.795], [-0.505, 0.85], [-0.537, 0.882], [-0.574, 0.898], [-0.61, 0.884]];
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new V3(x, y, 0)), false, 'centripetal');
  const f = (keys) => designCurve(keys, 0, -0.02, 1.02, 0.0025);
  const w = f([[0, 0.19], [0.06, 0.218], [0.3, 0.224], [0.38, 0.212], [0.5, 0.224], [0.66, 0.228], [0.77, 0.21], [0.83, 0.152], [0.875, 0.116], [0.94, 0.118], [1, 0.08]]);
  const b = f([[0, 0.004], [0.07, 0.03], [0.18, 0.06], [0.3, 0.052], [0.37, 0.028], [0.46, 0.074], [0.62, 0.104], [0.75, 0.078], [0.82, 0.03], [0.87, 0.02], [0.94, 0.046], [1, 0.02]]);
  const pad = f([[0, 0.008], [0.1, 0.02], [0.9, 0.018], [1, 0.01]]);
  const th = f([[0, 0.022], [0.08, 0.046], [0.35, 0.054], [0.5, 0.046], [0.9, 0.04], [1, 0.026]]);
  const sc = (t) => Math.sqrt(sstep(0, 0.05, t) * sstep(1, 0.95, t));
  const RR = 0.016, NR = 6, NF = 40, NB = 18;
  const bol = (a) => Math.pow(sstep(0.42, 0.98, a), 1.15);
  const L = curve.getLength();
  function frame(t) {
    const tt = clamp(t, 0, 1);
    const S = curve.getPointAt(tt), T = curve.getTangentAt(tt);
    return { S, N: new V3(T.y, -T.x, 0) };
  }
  function params(t) {
    const k = sc(t);
    return { W: w(t) * k + 0.004, B: b(t) * k, P: pad(t) * k, TH: th(t) * k, r: RR * Math.max(0.3, k) };
  }
  const front = (u, q) => [u * q.W, q.P * (1 - u * u) * (1 - u * u) + q.B * bol(Math.abs(u))];
  // leather strip: left outer rim -> left top -> front -> right top -> right outer rim
  function leatherProfile(q) {
    const out = [];
    for (let k = 0; k <= NR; k++) { const ph = Math.PI / 2 * (1 - k / NR); out.push([-(q.W + q.r * Math.sin(ph)), q.B - q.r + q.r * Math.cos(ph), -0.02 * Math.sin(ph)]); }
    for (let k = 1; k < NF; k++) { const u = -1 + 2 * k / NF; const p = front(u, q); out.push([p[0], p[1], (u + 1) / 2]); }
    for (let k = 0; k <= NR; k++) { const ph = Math.PI / 2 * (k / NR); out.push([q.W + q.r * Math.sin(ph), q.B - q.r + q.r * Math.cos(ph), 1 + 0.02 * Math.sin(ph)]); }
    return out;
  }
  // carbon shell: right outer rim -> right bottom -> back arc -> left bottom -> left outer rim
  function shellProfile(q) {
    const out = [];
    for (let k = 0; k <= NR; k++) { const ph = Math.PI / 2 + Math.PI / 2 * (k / NR); out.push([q.W + q.r * Math.sin(ph), q.B - q.r + q.r * Math.cos(ph)]); }
    for (let k = 1; k < NB; k++) { const ps = Math.PI * k / NB; const s = Math.sin(ps); out.push([q.W * Math.cos(ps), (q.B - 2 * q.r) * (1 - s) - q.TH * s]); }
    for (let k = 0; k <= NR; k++) { const ph = Math.PI - Math.PI / 2 * (k / NR); out.push([-(q.W + q.r * Math.sin(ph)), q.B - q.r + q.r * Math.cos(ph)]); }
    return out;
  }
  const toCar = (fr, l, n) => [fr.S.x + fr.N.x * n, fr.S.y + fr.N.y * n, l];
  function surface(t, u) {
    const fr = frame(t), q = params(t), p = front(u, q);
    return new V3(...toCar(fr, p[0], p[1]));
  }
  function surfaceNormal(t, u) {
    const e = 0.004;
    const a = surface(t + e, u).sub(surface(t - e, u));
    const c = surface(t, Math.min(1, u + e)).sub(surface(t, Math.max(-1, u - e)));
    return new V3().crossVectors(a, c).normalize();
  }
  function build(batch, zc) {
    const NS = 120;
    const lea = [], shell = [], arc = [];
    const m4 = new THREE.Matrix4().makeTranslation(0, 0, zc);
    for (let i = 0; i < NS; i++) {
      const t = i / (NS - 1), fr = frame(t), q = params(t);
      lea.push(leatherProfile(q).map(([l, n]) => toCar(fr, l, n)));
      shell.push(shellProfile(q).map(([l, n]) => toCar(fr, l, n)));
      arc.push(t * L);
    }
    const leaU = leatherProfile(params(0.5)).map((p) => p[2]);
    batch.add(M.seat, gridGeometry(lea, { uFn: (i, j) => leaU[j], vFn: (i) => arc[i] }), m4);
    batch.add(CAB.carbon, gridGeometry(shell, { uFn: (i, j, p, acc) => acc, vFn: (i) => arc[i] }), m4);
    // piping along the outer rim on both sides
    for (const j of [0, NR * 2 + NF - 2]) {
      const pts2 = [];
      for (let i = 2; i < NS - 2; i += 2) pts2.push(new V3(...lea[i][j]));
      batch.add(M.seatAccent, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts2), 160, 0.0042, 8, false), m4);
    }
    // harness: shoulder straps, lap belts and crotch strap lying on the cushion, cam-lock buckle
    const strap = (path, wdt) => {
      const P = [], Nn = [];
      for (const [t, u] of path) { P.push(surface(t, u)); Nn.push(surfaceNormal(t, u)); }
      const pos = [], uv = [], idx = [];
      let acc = 0;
      for (let k = 0; k < P.length; k++) {
        const a = P[Math.max(0, k - 1)], c = P[Math.min(P.length - 1, k + 1)];
        const tg = c.clone().sub(a).normalize();
        let side = new V3().crossVectors(Nn[k], tg).normalize();
        if (k) acc += P[k].distanceTo(P[k - 1]);
        const o = P[k].clone().addScaledVector(Nn[k], 0.0045);
        pos.push(...o.clone().addScaledVector(side, -wdt / 2).toArray(), ...o.clone().addScaledVector(side, wdt / 2).toArray());
        uv.push(0, acc, 1, acc);
        if (k) { const s = (k - 1) * 2; idx.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const lerpPath = (a, b, n, bend = 0) => { const out = []; for (let k = 0; k <= n; k++) { const s = k / n; out.push([lerp(a[0], b[0], s), lerp(a[1], b[1], s) + bend * Math.sin(Math.PI * s)]); } return out; };
    for (const s of [-1, 1]) {
      batch.add(M.harnessMat, strap(lerpPath([0.805, 0.36 * s], [0.29, 0.085 * s], 60, 0.05 * s), 0.048), m4);
      batch.add(M.harnessMat, strap(lerpPath([0.345, 1.0 * s], [0.272, 0.10 * s], 40), 0.048), m4);
      // slot in the backrest the shoulder strap passes through
      batch.add(CAB.dark, strap(lerpPath([0.797, 0.36 * s], [0.813, 0.362 * s], 3), 0.064), m4);
      // adjuster
      const pa = surface(0.62, 0.30 * s), na = surfaceNormal(0.62, 0.30 * s);
      const adj = new RoundedBoxGeometry(0.058, 0.03, 0.008, 2, 0.003);
      const ta = surface(0.6, 0.29 * s).sub(surface(0.64, 0.31 * s)).normalize();
      const xa = new V3().crossVectors(ta, na).normalize();
      batch.add(CAB.alu, adj, basisAt(pa.clone().addScaledVector(na, 0.009), xa, ta, na).premultiply(m4));
    }
    batch.add(M.harnessMat, strap(lerpPath([0.07, 0], [0.25, 0], 30), 0.048), m4);
    const pb = surface(0.268, 0), nb = surfaceNormal(0.268, 0);
    const tb = surface(0.3, 0).sub(surface(0.24, 0)).normalize(), xb = new V3().crossVectors(tb, nb).normalize();
    const mb = basisAt(pb.clone().addScaledVector(nb, 0.011), xb, tb, nb).premultiply(m4);
    batch.add(CAB.alu, new THREE.CylinderGeometry(0.036, 0.038, 0.014, 40).rotateX(Math.PI / 2), mb);
    batch.add(CAB.parts, tinted(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 28).rotateX(Math.PI / 2).translate(0, 0, 0.009), '#b3121f'), mb);
    // embroidered monogram on the headrest
    const ph = surface(0.935, 0), nh = surfaceNormal(0.935, 0);
    const th2 = surface(0.95, 0).sub(surface(0.92, 0)).normalize(), xh = new V3().crossVectors(th2, nh).normalize();
    batch.add(CAB.mono, new THREE.PlaneGeometry(0.085, 0.085), basisAt(ph.clone().addScaledVector(nh, 0.0025), xh, th2, nh).premultiply(m4));
  }
  return { build, surface, surfaceNormal };
})();

/* ---------- steering wheel ---------- */
function buildSteeringWheel(parent) {
  const C = new V3(0.268, 0.668, -SEAT_Z);
  const Z = EYE.clone().sub(C).setZ(0).normalize();           // faces the driver
  const Y = new V3(-Z.y, Z.x, 0).multiplyScalar(Z.x < 0 ? -1 : 1).normalize();
  if (Y.y < 0) Y.negate();
  const X = new V3().crossVectors(Y, Z).normalize();
  const mount = new THREE.Group();
  mount.matrixAutoUpdate = false;
  mount.matrix.copy(basisAt(C, X, Y, Z));
  parent.add(mount);
  const spin = new THREE.Group();
  mount.add(spin);
  const fixed = cockpitBatch(), rot = cockpitBatch();
  // D-shaped rim with thicker grips; carbon sleeves top and bottom, accent band at twelve o'clock
  const key = [[0.168, 0], [0.146, 0.084], [0.085, 0.146], [0, 0.168], [-0.085, 0.146], [-0.146, 0.084], [-0.168, 0], [-0.158, -0.066], [-0.12, -0.112], [-0.055, -0.128], [0.055, -0.128], [0.12, -0.112], [0.158, -0.066]];
  const rimCurve = new THREE.CatmullRomCurve3(key.map(([x, y]) => new V3(x, y, 0)), true, 'centripetal');
  const SEG = 220;
  const rimTube = (from, to, rad) => {
    const pts = [];
    for (let k = 0; k <= 48; k++) pts.push(rimCurve.getPointAt(((from + (to - from) * k / 48) % 1 + 1) % 1));
    const curve = new THREE.CatmullRomCurve3(pts, false);
    const nseg = Math.max(8, Math.round(SEG * (to - from)));
    const g = new THREE.TubeGeometry(curve, nseg, 1, 14, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const ring = Math.floor(i / 15), s = ring / nseg;
      const c = curve.getPointAt(clamp(s, 0, 1));
      const ang = Math.atan2(c.y, c.x);
      const r = typeof rad === 'function' ? rad(ang) : rad;
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * r, c.y + (p.getY(i) - c.y) * r, c.z + (p.getZ(i) - c.z) * r);
    }
    g.computeVertexNormals();
    return g;
  };
  const gripR = (a) => 0.0158 + 0.0042 * Math.max(cosWin((a - 0.05) / 0.75), cosWin((Math.abs(a) - Math.PI + 0.05) / 0.75));
  rot.add(CAB.suede, rimTube(0, 1, gripR));
  rot.add(CAB.carbon, rimTube(0.085, 0.415, 0.0166));
  rot.add(CAB.carbon, rimTube(0.6, 0.9, 0.0166));
  rot.add(M.seatAccent, rimTube(0.243, 0.257, 0.0172));
  // centre plate
  const plate = roundedShape([[-0.152, 0.012], [-0.118, 0.056], [0.118, 0.056], [0.152, 0.012], [0.12, -0.046], [0.05, -0.066], [-0.05, -0.066], [-0.12, -0.046]], 0.014);
  const pg = new THREE.ExtrudeGeometry(plate, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 6 });
  pg.translate(0, 0, -0.012);
  rot.add(CAB.carbon, pg);
  rot.add(CAB.carbon, new RoundedBoxGeometry(0.042, 0.075, 0.018, 2, 0.006).translate(0, -0.098, -0.002));
  rot.add(CAB.dark, new THREE.CylinderGeometry(0.04, 0.046, 0.05, 32).rotateX(Math.PI / 2).translate(0, -0.004, -0.04));
  // display bezel + screen
  rot.add(CAB.dark, new RoundedBoxGeometry(0.084, 0.042, 0.004, 2, 0.002).translate(0, 0.027, 0.0105));
  // rotary dials, buttons, thumb rockers
  for (const [x, col] of [[-0.088, '#c8102e'], [0.088, '#e0a400']]) {
    rot.add(CAB.parts, tinted(new THREE.CylinderGeometry(0.0145, 0.0155, 0.012, 32).rotateX(Math.PI / 2).translate(x, -0.03, 0.012), col));
    rot.add(CAB.parts, tinted(new THREE.BoxGeometry(0.0025, 0.011, 0.002).translate(x, -0.024, 0.0185), '#f2f2f2'));
  }
  for (const [x, y, col] of [[-0.05, -0.006, '#1f6fe0'], [0.05, -0.006, '#2fbf5a'], [-0.05, -0.044, '#e8e8e8'], [0.05, -0.044, '#1a1a1c']]) {
    rot.add(CAB.parts, tinted(new THREE.CylinderGeometry(0.0078, 0.0078, 0.005, 24).rotateX(Math.PI / 2).translate(x, y, 0.0115), col));
  }
  for (const s of [-1, 1]) rot.add(CAB.parts, tinted(new RoundedBoxGeometry(0.016, 0.026, 0.008, 2, 0.003).translate(s * 0.128, 0.03, 0.01), '#141416'));
  rot.add(CAB.badge, new THREE.PlaneGeometry(0.06, 0.015).translate(0, -0.054, 0.0122));
  rot.build(spin);
  // live display on the wheel
  CAB.wheelCtx = document.createElement('canvas').getContext('2d');
  CAB.wheelCtx.canvas.width = 256; CAB.wheelCtx.canvas.height = 128;
  CAB.wheelTex = new THREE.CanvasTexture(CAB.wheelCtx.canvas); CAB.wheelTex.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.074, 0.034), new THREE.MeshBasicMaterial({ map: CAB.wheelTex }));
  scr.position.set(0, 0.027, 0.0128);
  spin.add(scr);
  // shift lights: brightness follows rpm through a uniform
  const ledG = [], cols = ['#2fe36a', '#2fe36a', '#2fe36a', '#2fe36a', '#ffd21f', '#ffd21f', '#ffd21f', '#ff2a3c', '#ff2a3c', '#ff2a3c', '#3a7bff'];
  cols.forEach((c, k) => {
    const g = tinted(new THREE.BoxGeometry(0.0078, 0.0046, 0.003).translate(-0.055 + k * 0.011, 0.0505, 0.0112), c);
    const n = g.attributes.position.count;
    g.setAttribute('aLed', new THREE.Float32BufferAttribute(new Float32Array(n).fill((k + 0.5) / cols.length), 1));
    ledG.push(g);
  });
  const ledMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  CAB.ledLit = { value: 0 };
  ledMat.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = CAB.ledLit;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLed;\nvarying float vLed;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLed = aLed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vLed;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vLed < uLit ? 2.2 : 0.07;');
  };
  spin.add(new THREE.Mesh(mergeGeometries(ledG), ledMat));
  // column, shroud and column-mounted paddles (they do not turn with the wheel)
  fixed.add(CAB.dark, new THREE.CylinderGeometry(0.026, 0.03, 0.29, 24).rotateX(Math.PI / 2).translate(0, -0.006, -0.19));
  fixed.add(CAB.carbon, new RoundedBoxGeometry(0.11, 0.075, 0.13, 3, 0.025).translate(0, -0.012, -0.2));
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape([[0.098, 0.006], [0.196, 0.036], [0.214, 0.066], [0.206, 0.09], [0.188, 0.094], [0.11, 0.058], [0.094, 0.03]].map(([x, y]) => new THREE.Vector2(x * s, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 1 });
    fixed.add(CAB.alu, g.translate(0, 0, -0.046));
    fixed.add(CAB.dark, new THREE.BoxGeometry(0.06, 0.012, 0.012).translate(s * 0.07, 0.02, -0.05));
  }
  fixed.build(mount);
  CAB.spin = spin;
}

/* ---------- live instrument textures ---------- */
function drawCluster() {
  const ctx = CAB.clusterCtx, W = 1024, H = 320;
  const d = DRIVE, kmh = Math.round(d.v * 3.6), rpm = d.rpm;
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#070a10'); g.addColorStop(1, '#020305');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const red = '#ff2a3c', amber = '#ffb020', ink = '#eef2f7', dim = 'rgba(238,242,247,0.1)';
  const segs = 46;
  for (let i = 0; i < segs; i++) {
    const f = i / (segs - 1), r = f * 9000, lit = d.engine > 0 && r <= rpm;
    const x = 132 + f * 760, y = 66 - Math.sin(f * Math.PI) * 24;
    ctx.fillStyle = lit ? (r >= 8200 ? red : r >= 7000 ? amber : ink) : (r >= 8200 ? 'rgba(255,42,60,0.22)' : dim);
    ctx.fillRect(x - 6, y - 15, 11, 30);
  }
  ctx.fillStyle = '#7f8b99'; setFont(ctx, 600, 18, 'normal'); ctx.textAlign = 'center';
  for (let k = 1; k <= 9; k++) { const f = k / 9; ctx.fillText(String(k), 132 + f * 760, 118 - Math.sin(f * Math.PI) * 24); }
  ctx.fillStyle = ink; setFont(ctx, 800, 150, 'normal', 'italic'); ctx.fillText(String(kmh), 512, 262);
  ctx.fillStyle = '#7f8b99'; setFont(ctx, 600, 22, 'expanded'); ctx.fillText('KM/H', 512, 298);
  // gear
  ctx.strokeStyle = 'rgba(238,242,247,0.35)'; ctx.lineWidth = 3;
  roundRectPath(800, 150, 120, 130, 20)(ctx); ctx.stroke();
  ctx.fillStyle = d.shiftFlash > 0 ? amber : ink; setFont(ctx, 800, 104, 'normal');
  ctx.fillText(d.engine > 0 ? (d.v < 0.5 && d.throttle < 0.05 ? 'N' : String(d.gear)) : '–', 860, 252);
  // g-ball
  ctx.strokeStyle = 'rgba(238,242,247,0.22)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(160, 215, 62, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(160, 215, 31, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(98, 215); ctx.lineTo(222, 215); ctx.moveTo(160, 153); ctx.lineTo(160, 277); ctx.stroke();
  const gx = clamp(d.latG / 2, -1, 1) * 62, gy = clamp(-d.lonG / 2, -1, 1) * 62;
  ctx.fillStyle = red; ctx.beginPath(); ctx.arc(160 + gx, 215 + gy, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7f8b99'; setFont(ctx, 600, 18, 'normal'); ctx.textAlign = 'left';
  ctx.fillText(Math.hypot(d.latG, d.lonG).toFixed(2) + ' G', 236, 285);
  ctx.textAlign = 'right'; ctx.fillText('OIL 98°  H2O 91°', 990, 118);
  CAB.clusterTex.needsUpdate = true;
  // wheel display
  const w = CAB.wheelCtx;
  w.fillStyle = '#020305'; w.fillRect(0, 0, 256, 128);
  w.fillStyle = ink; setFont(w, 800, 82, 'normal'); w.textAlign = 'center';
  w.fillText(d.engine > 0 ? (d.v < 0.5 && d.throttle < 0.05 ? 'N' : String(d.gear)) : '–', 128, 96);
  w.fillStyle = '#7f8b99'; setFont(w, 600, 22, 'normal');
  w.textAlign = 'left'; w.fillText(String(kmh), 14, 30);
  w.textAlign = 'right'; w.fillText(String(Math.round(rpm / 100) * 100), 242, 30);
  CAB.wheelTex.needsUpdate = true;
}

/* ---------- the whole cockpit ---------- */
function buildInterior() {
  cockpitMaterials();
  const interior = new THREE.Group();
  const B = cockpitBatch();
  // seats
  for (const z of [-SEAT_Z, SEAT_Z]) SEAT.build(B, z);
  // floor and tunnel
  B.add(M.jamb, new THREE.BoxGeometry(1.28, 0.006, 1.04).translate(-0.01, 0.303, 0));
  for (const z of [-SEAT_Z, SEAT_Z]) B.add(CAB.suede, new RoundedBoxGeometry(0.34, 0.006, 0.3, 2, 0.003).translate(0.43, 0.308, z));
  B.add(CAB.carbon, new RoundedBoxGeometry(0.78, 0.112, 0.108, 4, 0.03).translate(-0.17, 0.356, 0));
  B.add(CAB.leather, new RoundedBoxGeometry(0.28, 0.046, 0.118, 3, 0.02).translate(-0.4, 0.425, 0));
  B.add(CAB.alu, new RoundedBoxGeometry(0.12, 0.006, 0.07, 2, 0.002).translate(0.13, 0.414, 0));
  for (const dz of [-0.018, 0, 0.018]) B.add(CAB.dark, new THREE.BoxGeometry(0.06, 0.004, 0.006).translate(0.13, 0.4175, dz));
  {
    const a = new V3(0.13, 0.416, 0), b = new V3(0.105, 0.5, 0);
    const lever = new THREE.CylinderGeometry(0.0055, 0.007, a.distanceTo(b), 16);
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
    B.add(CAB.alu, lever, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new V3(1, 1, 1)));
    B.add(CAB.leather, new THREE.SphereGeometry(0.022, 24, 16).scale(1, 0.85, 1), new THREE.Matrix4().makeTranslation(b.x, b.y + 0.012, b.z));
  }
  B.add(CAB.alu, new THREE.CylinderGeometry(0.022, 0.022, 0.016, 48).translate(0.0, 0.42, 0));
  B.add(CAB.led, new THREE.TorusGeometry(0.0235, 0.0016, 6, 48).rotateX(Math.PI / 2).translate(0.0, 0.413, 0));
  for (const s of [-1, 1]) B.add(CAB.led, new THREE.BoxGeometry(0.58, 0.0025, 0.0025).translate(-0.08, 0.402, s * 0.055));
  // dashboard: suede top, carbon blade, lower carbon fascia
  const bow = (z) => 0.012 * (1 - (z / 0.556) ** 2);
  {
    const prof = [[0.99, 0.612], [0.82, 0.652], [0.64, 0.664], [0.552, 0.656], [0.522, 0.632], [0.516, 0.596], [0.524, 0.566], [0.56, 0.548], [0.66, 0.524], [0.8, 0.502], [0.99, 0.5]];
    const rings = [];
    for (let k = 0; k <= 40; k++) {
      const z = lerp(-0.556, 0.556, k / 40);
      rings.push(prof.map(([x, y], i) => [x - (i >= 2 && i <= 7 ? bow(z) : 0), y, z]));
    }
    B.add(CAB.suede, loftClosed(rings));
    const blade = [], led = [];
    for (let k = 0; k <= 40; k++) {
      const z = lerp(-0.55, 0.55, k / 40), b = bow(z);
      blade.push([[0.5185 - b, 0.589, z], [0.5125 - b, 0.588, z], [0.517 - b, 0.567, z], [0.5235 - b, 0.567, z]]);
      led.push(new V3(0.5265 - b, 0.5615, z));
    }
    B.add(CAB.carbon, loftClosed(blade));
    B.add(CAB.led, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(led), 80, 0.0016, 6, false));
  }
  // round turbine vents
  const vent = (c, n, R) => {
    const Zv = n.clone().normalize(), Xv = new V3(0, 1, 0).cross(Zv).normalize(), Yv = new V3().crossVectors(Zv, Xv);
    const m = basisAt(c, Xv, Yv, Zv);
    B.add(CAB.alu, new THREE.TorusGeometry(R, 0.0048, 10, 48), m);
    B.add(CAB.dark, new THREE.CylinderGeometry(R, R, 0.035, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.018), m);
    B.add(CAB.dark, new THREE.CircleGeometry(R, 32).translate(0, 0, -0.034), m);
    B.add(CAB.alu, new THREE.SphereGeometry(R * 0.24, 20, 12).scale(1, 1, 0.6), m);
    for (let k = 0; k < 9; k++) {
      const vg = new THREE.BoxGeometry(R * 0.82, 0.0022, 0.012).translate(R * 0.5, 0, -0.004).rotateX(0.55).rotateZ(k / 9 * Math.PI * 2);
      B.add(CAB.alu, vg, m);
    }
  };
  for (const z of [-0.47, 0.47]) vent(new V3(0.516 - bow(z), 0.619, z), new V3(-1, 0.06, -Math.sign(z) * 0.18), 0.024);
  for (const z of [-0.15, 0.15]) vent(new V3(0.516 - bow(z), 0.619, z), new V3(-1, 0.06, 0), 0.024);
  // binnacle pod and curved cluster screen
  {
    const C0 = new V3(0.548, 0.738, -SEAT_Z);
    const Dn = EYE.clone().sub(C0).normalize(), Xs = new V3(0, 0, 1), Ys = new V3().crossVectors(Dn, Xs).normalize();
    const SW = 0.29, SH = 0.088;
    const sp = (u, v, grow = 0, push = 0) => {
      const x = (u - 0.5) * (SW + grow), y = (v - 0.5) * (SH + grow);
      return C0.clone().addScaledVector(Xs, x).addScaledVector(Ys, y).addScaledVector(Dn, 1.1 * x * x - push);
    };
    const patch = (nu, nv, fn) => { const rows = []; for (let i = 0; i <= nu; i++) { const row = []; for (let j = 0; j <= nv; j++) row.push(fn(i / nu, j / nv).toArray()); rows.push(row); } return rows; };
    const scrGeo = gridGeometry(patch(40, 4, (u, v) => sp(u, v)), { uFn: (i) => i / 40, vFn: (i, j) => j / 4 });
    CAB.clusterCtx = document.createElement('canvas').getContext('2d');
    CAB.clusterCtx.canvas.width = 1024; CAB.clusterCtx.canvas.height = 320;
    CAB.clusterTex = new THREE.CanvasTexture(CAB.clusterCtx.canvas);
    CAB.clusterTex.colorSpace = THREE.SRGBColorSpace; CAB.clusterTex.anisotropy = 8;
    const scr = new THREE.Mesh(scrGeo, new THREE.MeshBasicMaterial({ map: CAB.clusterTex, side: THREE.DoubleSide }));
    interior.add(scr);
    B.add(CAB.dark, gridGeometry(patch(40, 4, (u, v) => sp(u, v, 0.016, 0.003))));
    // visor
    B.add(CAB.carbon, gridGeometry(patch(40, 6, (u, w) => sp(u, 1, 0.03, 0).addScaledVector(Ys, 0.005 + 0.004 * Math.sin(w * Math.PI * 0.5)).addScaledVector(Dn, -0.1 * w))));
    // pod behind the screen down to the dash
    const pc = C0.clone().addScaledVector(Dn, -0.045).add(new V3(0, -0.04, 0));
    B.add(CAB.carbon, new RoundedBoxGeometry(0.075, 0.1, 0.305, 3, 0.02).translate(pc.x, pc.y, pc.z));
  }
  // centre stack with portrait screen, toggle bank and guarded start switch
  {
    const prof = [[0.64, 0.618], [0.548, 0.607], [0.505, 0.575], [0.43, 0.49], [0.335, 0.428], [0.205, 0.412], [0.205, 0.31], [0.64, 0.31]];
    B.add(CAB.carbon, extrudeXY(prof, 0.13, 0, { bevel: 0.008 }));
    const A = new V3(0.528, 0.59, 0), Bq = new V3(0.447, 0.503, 0);
    const t = Bq.clone().sub(A).normalize(), n = new V3(t.y, -t.x, 0);
    const mid = A.clone().add(Bq).multiplyScalar(0.5);
    const m = basisAt(mid.clone().addScaledVector(n, 0.0115), new V3(0, 0, 1), t.clone().negate(), n);
    B.add(CAB.dark, new RoundedBoxGeometry(0.124, 0.104, 0.004, 2, 0.003), m);
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(0.114, 0.094), new THREE.MeshBasicMaterial({ map: centreScreenTex() }));
    cs.matrixAutoUpdate = false;
    cs.matrix.copy(basisAt(mid.clone().addScaledVector(n, 0.0139), new V3(0, 0, 1), t.clone().negate(), n));
    interior.add(cs);
    const A2 = new V3(0.43, 0.49, 0), B2 = new V3(0.335, 0.428, 0);
    const t2 = B2.clone().sub(A2).normalize(), n2 = new V3(t2.y, -t2.x, 0);
    const mid2 = A2.clone().add(B2).multiplyScalar(0.5).addScaledVector(n2, 0.009);
    const m2 = basisAt(mid2, new V3(0, 0, 1), t2.clone().negate(), n2);
    B.add(CAB.dark, new RoundedBoxGeometry(0.118, 0.06, 0.004, 2, 0.002), m2);
    for (let k = 0; k < 5; k++) {
      const z = -0.048 + k * 0.024;
      B.add(CAB.alu, new THREE.CylinderGeometry(0.0062, 0.0062, 0.006, 20).rotateX(Math.PI / 2).translate(z, 0.004, 0.004), m2);
      if (k === 2) {
        B.add(CAB.parts, tinted(new THREE.CylinderGeometry(0.0075, 0.0075, 0.004, 24).rotateX(Math.PI / 2).translate(z, 0.004, 0.006), '#d0122c'), m2);
        B.add(CAB.parts, tinted(new RoundedBoxGeometry(0.02, 0.026, 0.012, 2, 0.003).rotateX(-0.35).translate(z, 0.009, 0.013), '#c0101c'), m2);
      } else {
        const lev = new THREE.CylinderGeometry(0.0018, 0.0024, 0.022, 10).translate(0, 0.011, 0)
          .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), new V3(0, 0.45, 0.9).normalize())).translate(z, 0.004, 0.006);
        B.add(CAB.alu, lev, m2);
      }
    }
  }
  // pedal box
  for (const [z, w, h, rest] of [[-0.44, 0.07, 0.12, true], [-0.315, 0.08, 0.095, false], [-0.225, 0.05, 0.125, false]]) {
    const mm = new THREE.Matrix4().makeRotationZ(rest ? -0.95 : -0.42).setPosition(rest ? 0.61 : 0.655, rest ? 0.338 : 0.405, z);
    B.add(CAB.aluHoles, new THREE.BoxGeometry(0.008, h, w), mm);
    if (!rest) B.add(CAB.dark, new THREE.BoxGeometry(0.012, 0.2, 0.014).translate(0.02, 0.12, 0), mm);
  }
  // rear bulkhead in quilted leather
  {
    const pts = [[-0.52, 0.31], [0.52, 0.31], [0.5, 0.6], [0.36, 0.64], [-0.36, 0.64], [-0.5, 0.6]];
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))), 8);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.52) / 1.04, p.getY(i));
    g.rotateY(Math.PI / 2);
    B.add(M.seat, g.translate(-0.70, 0, 0));
  }
  // headliner under the roof and the rear quarters
  {
    const roofP = (u, v) => { const psi = v * 2 - 1, side = psi < 0 ? -1 : 1; return canopyPoint(lerp(CX0, XH(psi), u), Math.PI / 2 - Math.abs(psi) * (Math.PI / 2 - PHI_RAIL), side); };
    B.add(CAB.suede, patchGeometry(70, 40, roofP, () => -0.012));
    for (const side of [-1, 1]) {
      const qP = (u, v) => { const phi = u * PHI_RAIL; return canopyPoint(lerp(CX0, XB(phi), v), phi, side); };
      B.add(CAB.suede, patchGeometry(30, 40, qP, () => -0.012 * side, { flip: side < 0 }));
    }
  }
  // interior mirror on the header
  B.add(CAB.dark, new RoundedBoxGeometry(0.024, 0.056, 0.2, 2, 0.01).translate(0.118, 1.0, 0));
  B.add(M.chrome, new THREE.PlaneGeometry(0.188, 0.046).rotateY(-Math.PI / 2).translate(0.105, 1.0, 0));
  B.add(CAB.dark, new THREE.CylinderGeometry(0.006, 0.008, 0.06, 12).translate(0.122, 1.05, 0));
  B.build(interior);
  buildSteeringWheel(interior);
  // door cards: ambient line, pull strap, release lever
  for (const side of [-1, 1]) {
    const D = DOORS[side];
    if (!D || !D.card) continue;
    D.card.updateMatrixWorld(true);
    const hitCard = (x, y) => {
      raycaster.set(new V3(x, y, 0), new V3(0, 0, side));
      raycaster.far = 2;
      const h = raycaster.intersectObject(D.card, false);
      return h.length ? h[0] : null;
    };
    const pts = [];
    for (let x = 0.0; x <= 0.84; x += 0.04) { const h = hitCard(x, 0.47); if (h) pts.push(h.point.clone().add(new V3(0, 0, -side * 0.004))); }
    const DB = cockpitBatch();
    if (pts.length > 3) DB.add(CAB.led, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0022, 6, false));
    const h1 = hitCard(0.36, 0.56);
    if (h1) {
      const n = h1.face.normal.clone().transformDirection(D.card.matrixWorld);
      if (n.z * side > 0) n.negate();
      const xx = new V3(1, 0, 0).addScaledVector(n, -n.x).normalize(), yy = new V3().crossVectors(n, xx).normalize();
      DB.add(M.seatAccent, new RoundedBoxGeometry(0.19, 0.024, 0.012, 2, 0.005), basisAt(h1.point.clone().addScaledVector(n, 0.018), xx, yy, n));
      DB.add(CAB.dark, new RoundedBoxGeometry(0.012, 0.02, 0.026, 2, 0.004).translate(-0.088, 0, -0.008), basisAt(h1.point.clone().addScaledVector(n, 0.018), xx, yy, n));
      DB.add(CAB.dark, new RoundedBoxGeometry(0.012, 0.02, 0.026, 2, 0.004).translate(0.088, 0, -0.008), basisAt(h1.point.clone().addScaledVector(n, 0.018), xx, yy, n));
    }
    const h2 = hitCard(0.62, 0.6);
    if (h2) {
      const n = h2.face.normal.clone().transformDirection(D.card.matrixWorld);
      if (n.z * side > 0) n.negate();
      const xx = new V3(1, 0, 0).addScaledVector(n, -n.x).normalize(), yy = new V3().crossVectors(n, xx).normalize();
      DB.add(CAB.alu, new RoundedBoxGeometry(0.07, 0.016, 0.008, 2, 0.003), basisAt(h2.point.clone().addScaledVector(n, 0.006), xx, yy, n));
    }
    DB.build(D.content);
  }
  car.add(interior);
  REFL_HIDE.push(interior);
  BODY.interior = interior;
  drawCluster();
}

// called every frame: wheel angle, shift lights, live screens (throttled, only when the cabin can be seen)
function updateCockpit(t) {
  if (!CAB.spin) return false;
  CAB.spin.rotation.z = DRIVE.steer * 9.5;
  const lit = DRIVE.engine > 0 ? clamp((DRIVE.rpm - 4500) / 4300, 0, 1.0001) : 0;
  CAB.ledLit.value = lit > 0.98 ? ((t * 8) % 1 < 0.5 ? 1.01 : 0) : lit;
  const near = state.view === 'cabin' || state.view === 'driver' || camera.position.distanceTo(_cockpitC) < 4.2;
  if (!near || t - CAB.lastDraw < 0.12) return false;
  const d = DRIVE, sig = [Math.round(d.v * 3.6), Math.round(d.rpm / 60), d.gear, d.engine, d.shiftFlash > 0, d.latG.toFixed(2), d.lonG.toFixed(2)].join('|');
  if (sig === CAB.sig) return false;
  CAB.sig = sig; CAB.lastDraw = t; drawCluster();
  return true;
}
const _cockpitC = new V3(0.1, 0.7, 0);
