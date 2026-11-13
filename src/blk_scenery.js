/* =========================================================================
   SCENERY — what stands on the land: woods of three kinds of tree (drawn
   per 256 m square, in full near the car and as simple shapes further off),
   rocks, steel guardrails and the stadium's concrete walls with catch
   fences, the start gantry, a grandstand and pit building on the main
   straight, marker posts and chevron boards, wind turbines on the hills,
   balloons over the lake; and the tyre marks the car leaves on the road.
   ========================================================================= */
const SCN = { trees: [], rocks: null, blades: [], skid: null };

/* ---------- geometry with colour ---------- */
function tint(g, r, gr, b, grad = null) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3), p = g.attributes.position.array;
  for (let i = 0; i < n; i++) {
    const k = grad ? clamp((p[i * 3 + 1] - grad[0]) / (grad[1] - grad[0]), 0, 1) * grad[2] + (1 - grad[2]) : 1;
    c[i * 3] = r * k; c[i * 3 + 1] = gr * k; c[i * 3 + 2] = b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
// normals pointing away from a centre: a crown of leaves is lit as one soft mass
function puff(g, cx, cy, cz, k = 0.75) {
  const p = g.attributes.position.array, nr = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] - cx, y = p[i + 1] - cy, z = p[i + 2] - cz, l = Math.hypot(x, y, z) || 1;
    nr[i] = lerp(nr[i], x / l, k); nr[i + 1] = lerp(nr[i + 1], y / l, k); nr[i + 2] = lerp(nr[i + 2], z / l, k);
  }
  return g;
}
function treeGeometries() {
  const rnd = lgRand(977), bark = [0.11, 0.075, 0.05];
  const G = [];
  // conifer: tiers of drooping boughs
  {
    const parts = [tint(new THREE.CylinderGeometry(0.1, 0.2, 2.4, 5).translate(0, 1.2, 0), ...bark)];
    for (let i = 0; i < 5; i++) parts.push(tint(new THREE.ConeGeometry(2.25 - 0.4 * i, 3.1 - 0.2 * i, 8, 1, false).translate(0, 2.9 + i * 1.75, 0), 0.03, 0.062, 0.03, [1.3 + i * 1.75, 4.4 + i * 1.75, 0.55]));
    const far = [tint(new THREE.ConeGeometry(2.1, 9.6, 6, 1, false).translate(0, 6.2, 0), 0.027, 0.056, 0.027, [1.4, 11, 0.45]), tint(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 3).translate(0, 0.8, 0), ...bark)];
    G.push([mergeGeometries(parts), mergeGeometries(far)]);
  }
  // broadleaf: a crown of several masses on a short trunk
  {
    const parts = [tint(new THREE.CylinderGeometry(0.17, 0.3, 3.4, 5).translate(0, 1.7, 0), ...bark)];
    for (const [x, y, z, r] of [[0, 6.2, 0, 2.5], [1.5, 5.2, 0.5, 1.9], [-1.3, 5.4, -0.9, 2.0], [0.2, 5.0, 1.6, 1.7], [-0.4, 7.4, -0.3, 1.7]]) {
      const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed(), p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { const k = 1 + 0.16 * (gnoise(p[i] * 0.9 + x, p[i + 1] * 0.9 + z * 3) ); p[i] *= k; p[i + 1] *= k * 0.86; p[i + 2] *= k; }
      g.computeVertexNormals();
      parts.push(puff(tint(g.translate(x, y, z), 0.062, 0.1, 0.03, [3.4, 9, 0.5]), 0, 5.6, 0));
    }
    const fg = new THREE.IcosahedronGeometry(3.3, 0).toNonIndexed().scale(1, 0.84, 1).translate(0, 5.9, 0);
    fg.computeVertexNormals();
    G.push([mergeGeometries(parts), mergeGeometries([puff(tint(fg, 0.058, 0.094, 0.028, [3.2, 8.6, 0.5]), 0, 5.6, 0, 0.9), tint(new THREE.CylinderGeometry(0.2, 0.3, 3.2, 3).translate(0, 1.6, 0), ...bark)])]);
  }
  // poplar: a tall narrow flame
  {
    const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed().scale(1.45, 6.6, 1.45).translate(0, 8.4, 0);
    g.computeVertexNormals();
    const fg = new THREE.IcosahedronGeometry(1, 0).toNonIndexed().scale(1.5, 6.6, 1.5).translate(0, 8.4, 0);
    fg.computeVertexNormals();
    G.push([mergeGeometries([puff(tint(g, 0.07, 0.115, 0.03, [2, 15, 0.45]), 0, 8.4, 0, 0.5), tint(new THREE.CylinderGeometry(0.14, 0.24, 2.6, 5).translate(0, 1.3, 0), ...bark)]),
      mergeGeometries([puff(tint(fg, 0.066, 0.108, 0.028, [2, 15, 0.45]), 0, 8.4, 0, 0.6), tint(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 3).translate(0, 1.2, 0), ...bark)])]);
  }
  void rnd;
  return G;
}
function sceneryMat(o = {}) {
  const m = landMat(Object.assign({
    instanced: true,
    vertexPars: 'varying vec3 vBase; varying float vHt;' + (o.vertexPars2 || ''),
    vertexMain: `
      vCol = color;
      #ifdef USE_INSTANCING_COLOR
      vCol *= instanceColor;
      #endif
      vBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vHt = clamp(position.y / 10.0, 0.0, 1.0);
      ${o.sway ? 'float ph = uLTime * 1.25 + vBase.x * 0.21 + vBase.z * 0.17; lp.xz += vec2(sin(ph), cos(ph * 0.83 + 1.7)) * 0.09 * vHt * vHt * (position.y / 5.0);' : ''}
      ${o.vertexMain2 || ''}`,
    fragmentPars: 'varying vec3 vBase; varying float vHt;' + (o.fragmentPars2 || ''),
    fragmentMain: o.fragmentMain2 || `
      vec3 N = normalize(vN);
      float wrap = max(0.0, dot(N, uSunDir) * 0.62 + 0.38);
      float sh = cloudShade(vLP.xz) * (1.0 - 0.7 * texture2D(tShade, vBase.xz / L_SIZE + 0.5).r * (1.0 - vHt));
      vec3 amb = mix(uGndCol, uSkyCol, 0.5 + 0.5 * N.y) * (0.55 + 0.45 * vHt);
      outC = vCol * (uSunCol * wrap * wrap * sh + amb);
      vec3 V = normalize(uToLand * (cameraPosition - vWP));
      outC += vCol * uSunCol * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.3 * sh * vHt;`,
  }, o.over || {}));
  m.vertexColors = true;
  return m;
}
function buildTrees() {
  const T = LG.trees, G = treeGeometries(), mat = sceneryMat({ sway: true }), nC = LG.SIZE / LAND_CHUNK;
  const bins = new Map();
  for (let i = 0; i < T.n; i++) {
    const key = (Math.floor((T.z[i] + LG.HALF) / LAND_CHUNK) * nC + Math.floor((T.x[i] + LG.HALF) / LAND_CHUNK)) * 3 + T.kind[i];
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3(), c = new THREE.Color();
  for (const [key, list] of bins) {
    const kind = key % 3, chunk = Math.floor(key / 3), near = new THREE.InstancedMesh(G[kind][0], mat, list.length), far = new THREE.InstancedMesh(G[kind][1], mat, list.length);
    list.forEach((i, j) => {
      const k = T.s[i], t = T.tint[i];
      m4.compose(p.set(T.x[i], T.y[i], T.z[i]), q.setFromEuler(e.set(0, T.rot[i], 0)), s.set(k * (0.9 + 0.25 * t), k, k * (0.9 + 0.25 * (1 - t))));
      near.setMatrixAt(j, m4);
      // every tree its own green: lighter, yellower, or towards blue
      near.setColorAt(j, c.setRGB(0.8 + 0.5 * t, 0.85 + 0.3 * ((t * 7.3) % 1), 0.75 + 0.6 * ((t * 3.7) % 1)));
    });
    far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor;
    near.computeBoundingSphere(); far.boundingSphere = near.boundingSphere.clone(); far.boundingSphere.radius += 2;
    near.visible = far.visible = false;
    LAND.group.add(near, far);
    SCN.trees.push({ near, far, x: -LG.HALF + (chunk % nC + 0.5) * LAND_CHUNK, z: -LG.HALF + (Math.floor(chunk / nC) + 0.5) * LAND_CHUNK });
  }
}
function buildRocks() {
  const K = LG.rocks, g0 = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), p = g0.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) { const k = 0.82 + 0.32 * gnoise(p[i] * 1.7 + 3, p[i + 1] * 1.7 + p[i + 2] * 2.3); p[i] *= k; p[i + 1] *= k * 0.72; p[i + 2] *= k; }
  g0.computeVertexNormals();
  const g = tint(g0, 0.2, 0.19, 0.175, [-0.7, 0.7, 0.4]);
  const mesh = new THREE.InstancedMesh(g, sceneryMat({ fragmentMain2: `
      vec3 N = normalize(vN);
      outC = landLit(vCol * (0.8 + 0.4 * vnoise(vLP.xz * 1.3 + vLP.y)), N, vLP, vWP, 0.8);` }), K.n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new V3(), s = new V3();
  for (let i = 0; i < K.n; i++) {
    m4.compose(v.set(K.x[i], K.y[i] + K.s[i] * 0.18, K.z[i]), q.setFromEuler(e.set(K.rot[i] * 0.3, K.rot[i], 0)), s.set(K.s[i] * 1.2, K.s[i], K.s[i]));
    mesh.setMatrixAt(i, m4);
  }
  mesh.frustumCulled = false;
  LAND.group.add(mesh); SCN.rocks = mesh;
}

/* ---------- barriers ---------- */
const _sp1 = {}, _sg = {};
function buildBarriers() {
  const R = LG.road, pos = [], col = [], uv = [], idx = [];
  // a strip along the road: rows of points (offset towards the road, height, colour, u-scale), joined along the run
  const strip = (w, sec, step, uvOf) => {
    let base = -1;
    for (let i = w.i0; i <= w.i1; i += step) {
      const ii = Math.min(i, w.i1), s = ii * R.ds, P = lgRoadPose(s, w.side * LG_WALL_N[w.kind], _sp1), y0 = lgRibbonY(P.i, P.t, w.side * LG_WALL_N[w.kind]);
      const nx = -Math.sin(P.th) * -w.side, nz = Math.cos(P.th) * -w.side, b = pos.length / 3;
      for (const [e, y, c] of sec) { pos.push(P.x + nx * e, y0 + y, P.z + nz * e); col.push(c[0], c[1], c[2]); uv.push(...uvOf(s, y, c)); }
      if (base >= 0) for (let k = 0; k < sec.length - 1; k++) { const a = base + k, d = b + k; if (w.side > 0) idx.push(a, d, a + 1, a + 1, d, d + 1); else idx.push(a, a + 1, d, a + 1, d + 1, d); }
      base = b;
    }
  };
  const steel = [0.2, 0.205, 0.21], dark = [0.12, 0.125, 0.13], conc = [0.27, 0.265, 0.25];
  for (const w of LG.walls) {
    if (w.kind === 1) {
      strip(w, [[0.0, 0.4, dark], [0.07, 0.47, steel], [0.02, 0.56, dark], [0.07, 0.65, steel], [0.0, 0.72, steel]], 2, () => [0, 0]);
      strip(w, [[0.0, 0.72, dark], [-0.01, 0.56, dark], [0.0, 0.4, dark]], 2, () => [0, 0]);
    } else {
      // (the face towards the road carries the advertising: marked by a u coordinate, v from the foot to the cap)
      strip(w, [[0.0, 0.0, conc], [0.0, 1.0, conc]], 2, (s, y) => [1 + s / 32, y]);
      strip(w, [[0.0, 1.0, conc], [-0.28, 1.0, conc], [-0.28, 0.0, dark]], 2, () => [0, 0]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = landMat({
    uniforms: { tAds: { value: WORLD.ads } }, side: THREE.DoubleSide,
    vertexPars: '', vertexMain: 'vCol = color;',
    fragmentPars: 'uniform sampler2D tAds;',
    fragmentMain: `
      vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
      vec3 alb = vCol;
      if (vUv2.x > 0.5) { vec3 ad = texture2D(tAds, vec2(fract(vUv2.x), clamp(vUv2.y, 0.03, 0.97))).rgb; alb = mix(ad * 0.6, vec3(0.3), step(0.94, vUv2.y)); }
      else alb *= 0.85 + 0.3 * vnoise(vLP.xz * 0.7);
      outC = landLit(alb, N, vLP, vWP, 0.7);
      vec3 V = normalize(uToLand * (cameraPosition - vWP));
      outC += uSunCol * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 24.0) * 0.12 * step(vUv2.x, 0.5) * step(0.18, vCol.r);`,
  });
  mat.vertexColors = true;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  LAND.group.add(mesh);
  // posts of the guardrails and of the fences
  const posts = [];
  for (const w of LG.walls) for (let i = w.i0; i <= w.i1; i += 4) {
    const P = lgRoadPose(i * R.ds, w.side * (LG_WALL_N[w.kind] + (w.kind === 1 ? 0.06 : 0.14)), _sp1);
    posts.push([P.x, lgRibbonY(P.i, P.t, w.side * LG_WALL_N[w.kind]), P.z, P.th, w.kind]);
  }
  const pg = tint(new THREE.BoxGeometry(0.09, 1, 0.09).translate(0, 0.5, 0), 0.25, 0.255, 0.26);
  const pm = new THREE.InstancedMesh(pg, sceneryMat({ fragmentMain2: 'outC = landLit(vCol, normalize(vN), vLP, vWP, 0.7);' }), posts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new V3(), s = new V3();
  posts.forEach((p, i) => { m4.compose(v.set(p[0], p[1], p[2]), q.setFromEuler(e.set(0, -p[3], 0)), s.set(1, p[4] === 1 ? 0.74 : 3.4, 1)); pm.setMatrixAt(i, m4); });
  pm.frustumCulled = false;
  LAND.group.add(pm);
  // catch fences over the stadium's walls: mesh and cables drawn by the shader
  const fp = [], fu = [], fi = [];
  for (const w of LG.walls) if (w.kind === 2) {
    let base = -1;
    for (let i = w.i0; i <= w.i1; i += 2) {
      const ii = Math.min(i, w.i1), s = ii * R.ds, P = lgRoadPose(s, w.side * (LG_WALL_N[2] + 0.14), _sp1), y0 = lgRibbonY(P.i, P.t, w.side * LG_WALL_N[2]), b = fp.length / 3;
      fp.push(P.x, y0 + 1.0, P.z, P.x, y0 + 3.4, P.z); fu.push(s, 1.0, s, 3.4);
      if (base >= 0) fi.push(base, b, base + 1, base + 1, b, b + 1);
      base = b;
    }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi); fg.computeVertexNormals();
  const fence = new THREE.Mesh(fg, landMat({
    side: THREE.DoubleSide, a2c: true,
    fragmentPars: `float bandF(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
      float wires(float u, float w){ float f = abs(fract(u) - 0.5); float c = smoothstep(0.465 - w, 0.465 + 0.2 * w, f); return mix(c, 0.035, smoothstep(0.15, 0.5, w)); }`,
    fragmentMain: `
      float s = vUv2.x, y = vUv2.y, fs = fwidth(s), fy = fwidth(y), ws = fs + uBlur;
      float cable = bandF(y, 1.02, 1.05, fy) + bandF(y, 2.2, 2.22, fy) + bandF(y, 3.34, 3.4, fy);
      float u1 = (s + y) / 0.06, u2 = (s - y) / 0.06, wb = (fs + fy) / 0.06 + uBlur / 0.06;
      float mesh = 1.0 - (1.0 - wires(u1, wb)) * (1.0 - wires(u2, wb));
      alpha = clamp(max(cable * 0.8, mesh * 0.7), 0.0, 1.0);
      if (alpha < 0.02) discard;
      outC = mix(vec3(0.2), vec3(0.07), cable) * (uSunCol * 0.35 * cloudShade(vLP.xz) + uSkyCol);`,
  }));
  fence.frustumCulled = false;
  LAND.group.add(fence);
}

/* ---------- the stadium, signs, turbines, balloons ---------- */
function buildProps() {
  const R = LG.road, parts = [], casters = [], solid = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new V3(), one = new V3(1, 1, 1);
  // a box in road coordinates: from s0 to s1 along, n0 to n1 across, y0 to y1 above the road there
  const box = (s0, s1, n0, n1, y0, y1, c, grad) => {
    const P = lgRoadPose((s0 + s1) / 2, (n0 + n1) / 2, _sp1), g = tint(new THREE.BoxGeometry(Math.abs(s1 - s0), y1 - y0, Math.abs(n1 - n0)), c[0], c[1], c[2], grad);
    // (footings reach half a metre into the ground)
    const lo = y0 === 0 ? -0.5 : y0, g2 = lo === y0 ? g : tint(new THREE.BoxGeometry(Math.abs(s1 - s0), y1 - lo, Math.abs(n1 - n0)), c[0], c[1], c[2], grad);
    m4.compose(v.set(P.x, R.h[P.i] + (lo + y1) / 2, P.z), q.setFromEuler(e.set(0, -P.th, 0)), one);
    parts.push(g2.applyMatrix4(m4));
  };
  const span = (s0, s1, n, r, h) => { for (let s = s0; s <= s1; s += r * 1.4) { const P = lgRoadPose(s, n, _sp1); casters.push([P.x, P.z, r, h]); solid.push([P.x, P.z, r * 0.9]); } };
  const HW = LG.HW;
  // grandstand on the outside of the main straight: tiers under a roof
  for (const [a, b] of [[40, 150], [165, 275]]) {
    for (let t = 0; t < 9; t++) box(a, b, HW + 9 + t * 0.95, HW + 9.95 + t * 0.95, 0, 0.9 + t * 0.62, t % 2 ? [0.3, 0.3, 0.32] : [0.14, 0.2, 0.42]);
    box(a, b, HW + 17.6, HW + 18.2, 0, 9.6, [0.2, 0.2, 0.22]);
    box(a - 1, b + 1, HW + 8, HW + 18.6, 9.6, 9.95, [0.42, 0.42, 0.44]);
    for (let s = a + 2; s < b; s += 13.4) box(s, s + 0.4, HW + 8.6, HW + 9, 0, 9.6, [0.18, 0.18, 0.2]);
    span(a, b, HW + 13.5, 6, 10);
  }
  // pit building on the inside: garages below, a glazed floor above, a flat roof
  box(-160, 240, -(HW + 13), -(HW + 23), 0, 3.6, [0.3, 0.3, 0.31]);
  box(-160, 240, -(HW + 12.9), -(HW + 13.1), 3.6, 6.4, [0.06, 0.1, 0.16]);
  box(-160, 240, -(HW + 13.1), -(HW + 23), 3.6, 6.4, [0.34, 0.34, 0.35]);
  box(-162, 242, -(HW + 12), -(HW + 23.5), 6.4, 6.75, [0.45, 0.45, 0.46]);
  for (let s = -156; s < 238; s += 10) box(s, s + 7.4, -(HW + 12.94), -(HW + 13.2), 0.05, 3.1, [0.035, 0.037, 0.04]);
  box(-30, 30, -(HW + 14), -(HW + 20), 6.75, 10.5, [0.3, 0.3, 0.32]);
  box(-30, 30, -(HW + 13.9), -(HW + 14.1), 7.4, 9.9, [0.05, 0.09, 0.15]);
  span(-160, 240, -(HW + 18), 6, 7);
  // start gantry: two legs, a beam with lamps
  const gs = HW + 5.2;
  box(-0.4, 0.4, -gs - 0.4, -gs + 0.4, 0, 8, [0.09, 0.09, 0.1]); box(-0.4, 0.4, gs - 0.4, gs + 0.4, 0, 8, [0.09, 0.09, 0.1]);
  box(-0.55, 0.55, -gs - 0.4, gs + 0.4, 7.0, 8.4, [0.07, 0.07, 0.08]);
  // marshals' posts at every bend: a small hut on a base
  for (const c of R.corners) if (c.peak > 1 / 130) { const s = (c.i0 - 30) * R.ds, n = -c.sgn * (HW + 7.5); box(s - 1.6, s + 1.6, n - 1.2, n + 1.2, 0, 0.5, [0.3, 0.3, 0.3]); box(s - 1.4, s + 1.4, n - 1, n + 1, 0.5, 2.7, [0.6, 0.32, 0.08]); box(s - 1.6, s + 1.6, n - 1.2, n + 1.2, 2.7, 2.85, [0.2, 0.2, 0.2]); const P = lgRoadPose(s, n, _sp1); casters.push([P.x, P.z, 1.6, 2.8]); solid.push([P.x, P.z, 1.5]); }
  // the village and the barns (blk_landgen.js places them): walls on footings, gabled roofs, windows that light up at night
  const wbox = (x, y, z, th, w, h, d, c, grad) => { m4.compose(v.set(x, y + h / 2, z), q.setFromEuler(e.set(0, -th, 0)), one); parts.push(tint(new THREE.BoxGeometry(w, h, d), c[0], c[1], c[2], grad).applyMatrix4(m4)); };
  const gable = (x, y, z, th, w, d, rh, c) => {
    const a = w / 2 + 0.4, b = d / 2 + 0.5, P = [[-a, 0, -b], [-a, 0, b], [-a, rh, 0], [a, 0, -b], [a, 0, b], [a, rh, 0]], pos = [];
    for (const f of [[0, 2, 5], [0, 5, 3], [1, 4, 5], [1, 5, 2], [0, 1, 2], [3, 5, 4]]) for (const i of f) pos.push(...P[i]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, -th, 0)), one); parts.push(tint(g, c[0], c[1], c[2]).applyMatrix4(m4));
  };
  const rh = lgRand(1618), glassC = [0.05, 0.08, 0.13];
  for (const b of LG.houses) {
    const cs = Math.cos(b.th), sn = Math.sin(b.th), y0 = b.y - 0.8, hgt = b.top - y0 + b.e, t = rh();
    const at = (lx, lz) => [b.x + lx * cs - lz * sn, b.z + lx * sn + lz * cs];
    if (b.kind === 2) {
      wbox(b.x, y0, b.z, b.th, b.w, hgt, b.d, [0.27, 0.085, 0.06], [-hgt / 2, hgt / 2, 0.25]);
      gable(b.x, y0 + hgt, b.z, b.th, b.w, b.d, 3.4, [0.19, 0.19, 0.2]);
      const [dx, dz] = at(b.w / 2 + 0.03, 0); wbox(dx, y0 + 0.8, dz, b.th, 0.08, 3.6, 4.4, [0.07, 0.05, 0.04]);
    } else if (b.kind === 1) {
      const stone = [0.44, 0.42, 0.38], slate = [0.12, 0.13, 0.15];
      wbox(b.x, y0, b.z, b.th, b.w, hgt, b.d, stone, [-hgt / 2, hgt / 2, 0.2]);
      gable(b.x, y0 + hgt, b.z, b.th + Math.PI / 2, b.d, b.w, 5.5, slate);
      const [tx, tz] = at(0, -b.d / 2 - 2.6);
      wbox(tx, y0, tz, b.th, 6, hgt + 14, 6, stone, [-(hgt + 14) / 2, (hgt + 14) / 2, 0.2]);
      m4.compose(v.set(tx, y0 + hgt + 14 + 5.5, tz), q.setFromEuler(e.set(0, -b.th + Math.PI / 4, 0)), one);
      parts.push(tint(new THREE.ConeGeometry(4.6, 11, 4), ...slate).applyMatrix4(m4));
      for (const sd of [-1, 1]) for (let k = -1; k <= 1; k++) { const [wx, wz] = at(sd * (b.w / 2 + 0.03), k * 5.5); wbox(wx, y0 + hgt - 5.6, wz, b.th, 0.08, 4.2, 1.3, glassC); }
      casters.push([tx, tz, 3.4, hgt + 22]);
    } else {
      const wall = t < 0.4 ? [0.5, 0.47, 0.4] : t < 0.75 ? [0.46, 0.4, 0.31] : [0.4, 0.4, 0.38], tile = t * 7 % 1 < 0.7 ? [0.33, 0.13, 0.075] : [0.15, 0.16, 0.18];
      wbox(b.x, y0, b.z, b.th, b.w, hgt, b.d, wall, [-hgt / 2, hgt / 2, 0.18]);
      gable(b.x, y0 + hgt, b.z, b.th, b.w, b.d, 2.2 + 1.2 * rh(), tile);
      const nW = Math.max(2, Math.round(b.w / 3.4));
      for (const sd of [-1, 1]) for (let k = 0; k < nW; k++) { const [wx, wz] = at((k + 0.5) / nW * b.w - b.w / 2, sd * (b.d / 2 + 0.03)); wbox(wx, b.top + b.e - 2.3, wz, b.th, 1.0, 1.25, 0.08, glassC); }
      // a chimney
      const [cx, cz] = at(b.w * 0.28, 0); wbox(cx, y0 + hgt + 0.6, cz, b.th, 0.7, 2.6, 0.7, [0.3, 0.2, 0.16]);
    }
    casters.push([b.x, b.z, Math.max(b.w, b.d) * 0.5, hgt + 2.5]);
  }
  const stat = new THREE.Mesh(mergeGeometries(parts), sceneryStatic());
  stat.frustumCulled = false;
  LAND.group.add(stat);
  // banner on the gantry, both faces
  {
    const P = lgRoadPose(0, 0, _sp1), tex = texOnce('gantry-banner', gantryBanner);
    for (const dx of [-0.57, 0.57]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2 * gs - 1.2, 1.15), landMat({ uniforms: { tMap: { value: tex } }, fragmentPars: 'uniform sampler2D tMap;', side: THREE.DoubleSide,
        fragmentMain: 'outC = texture2D(tMap, vUv2).rgb * (uSunCol * 0.2 + uSkyCol * 1.4 + 0.25 * uNightK + 0.12);' }));
      b.position.set(P.x + Math.cos(P.th) * dx, R.h[P.i] + 7.7, P.z + Math.sin(P.th) * dx); b.rotation.y = -P.th + (dx > 0 ? Math.PI / 2 : -Math.PI / 2);
      LAND.group.add(b);
    }
  }
  // marker posts every 50 m, chevron boards round the outside of the tight bends, distance boards before them
  const posts = [], chev = [], boards = [];
  for (let s = 25; s < R.L; s += 50) for (const side of [-1, 1]) { const P = lgRoadPose(s, side * (HW + 1.9), _sp1); if (!(side > 0 ? R.wallR : R.wallL)[P.i]) posts.push([P.x, lgRibbonY(P.i, P.t, side * (HW + 1.9)), P.z, P.th, side]); }
  for (const c of R.corners) if (c.peak > 1 / 95) {
    for (let i = c.i0 + 4; i < c.i1 - 2; i += 11) { const P = lgRoadPose(i * R.ds, -c.sgn * (HW + 3.7), _sp1); chev.push([P.x, lgRibbonY(P.i, P.t, -c.sgn * (HW + 3.7)), P.z, P.th, c.sgn]); }
    for (const [d, k] of [[150, 0], [100, 1], [50, 2]]) { const P = lgRoadPose((c.i0 - d) * R.ds, -c.sgn * (HW + 3.4), _sp1); boards.push([P.x, lgRibbonY(P.i, P.t, -c.sgn * (HW + 3.4)), P.z, P.th, k]); }
  }
  const inst = (geo, list, mat, yaw = () => 0, sc = () => 1) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { const k = sc(p); m4.compose(v.set(p[0], p[1], p[2]), q.setFromEuler(e.set(0, -p[3] + yaw(p), 0)), new V3(k, k, k)); m.setMatrixAt(i, m4); });
    m.frustumCulled = false; LAND.group.add(m); return m;
  };
  const flat = 'outC = landLit(vCol, normalize(vN), vLP, vWP, 0.7);';
  inst(mergeGeometries([tint(new THREE.BoxGeometry(0.1, 0.95, 0.12).translate(0, 0.475, 0), 0.5, 0.5, 0.5), tint(new THREE.BoxGeometry(0.105, 0.14, 0.125).translate(0, 0.78, 0), 0.03, 0.03, 0.03)]), posts, sceneryMat({ fragmentMain2: flat + ' outC += vec3(1.0, 0.25, 0.05) * step(vCol.r, 0.05) * headBeam(vWP) * uHeadI * 3.0;' }));
  const signTex = texOnce('land-signs', () => canvasTex(512, 128, (ctx, w, h) => {
    // chevron, then the three distance boards
    ctx.fillStyle = '#e8e8e2'; ctx.fillRect(0, 0, 128, h); ctx.fillStyle = '#c8102e';
    for (const x of [18, 62]) { ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x + 26, 14); ctx.lineTo(x + 52, 64); ctx.lineTo(x + 26, 114); ctx.lineTo(x, 114); ctx.lineTo(x + 26, 64); ctx.closePath(); ctx.fill(); }
    ['150', '100', '50'].forEach((t, i) => { const x = 128 * (i + 1); ctx.fillStyle = '#f2f2ee'; ctx.fillRect(x, 0, 128, h); ctx.fillStyle = '#0b2f86'; ctx.fillRect(x + 8, 8, 112, h - 16); ctx.fillStyle = '#f2f2ee'; setFont(ctx, 800, 70, 'normal', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + 64, h / 2 + 4); });
  }));
  const signMat = () => sceneryMat({ over: { uniforms: { tMap: { value: signTex } }, side: THREE.DoubleSide }, fragmentPars2: 'uniform sampler2D tMap;',
    fragmentMain2: `vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
      vec3 alb = vUv2.x > 1.5 ? vec3(0.08) : texture2D(tMap, vec2((vCol.r * 3.0 + (vCol.g > 0.5 ? 1.0 - vUv2.x : vUv2.x)) * 0.25, vUv2.y)).rgb * 0.75;
      outC = landLit(alb, N, vLP, vWP, 0.7) + alb * headBeam(vWP) * uHeadI * 2.0;` });
  const plate = (w, h, y) => { const g = new THREE.PlaneGeometry(w, h).rotateY(-Math.PI / 2).translate(0, y, 0); return g; };
  const leg = (z, hgt) => { const g = new THREE.BoxGeometry(0.06, hgt, 0.06).translate(0, hgt / 2, z); const u = g.attributes.uv.array; for (let i = 0; i < u.length; i += 2) u[i] = 2; return g; };
  // chevrons face the traffic coming round the bend; the vertex colour picks the picture and mirrors it for left-handers
  const chevGeo = (mir) => tint(mergeGeometries([plate(1.5, 1.5, 1.45), leg(-0.5, 0.75), leg(0.5, 0.75)]), 0, mir, 0);
  for (const sgn of [-1, 1]) inst(chevGeo(sgn > 0 ? 1 : 0), chev.filter((p) => p[4] === sgn), signMat(), (p) => p[4] * -0.5);
  for (let k = 0; k < 3; k++) inst(tint(mergeGeometries([plate(1.2, 1.2, 1.55), leg(-0.4, 1), leg(0.4, 1)]), (k + 1) / 3, 0, 0), boards.filter((p) => p[4] === k), signMat());
  // wind turbines along the high ground
  const tw = [];
  for (const [x, z] of [[-1330, -310], [-1390, 60], [-1300, 420], [-430, -1420], [-60, -1460], [330, -1430], [1250, 1050]]) tw.push([x, lgLandH(x, z) - 1, z, 0.4 + 0.2 * gnoise(x * 0.01, z * 0.01)]);
  const white = [0.62, 0.63, 0.64];
  inst(mergeGeometries([tint(new THREE.CylinderGeometry(1.1, 2.1, 80, 12).translate(0, 40, 0), ...white), tint(new THREE.BoxGeometry(7, 2.8, 2.8).translate(-0.8, 81, 0), ...white)]), tw, sceneryMat({ fragmentMain2: flat }), (p) => p[3] * 6);
  for (const t of tw) {
    const bl = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.BoxGeometry(0.5, 36, 2.2); const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) { const f = (p[i + 1] + 18) / 36; p[i + 2] *= 1 - 0.72 * f; p[i] *= 1 - 0.6 * f; }
      bl.push(tint(g.translate(0, 19.5, 0).rotateX(k * 2 * Math.PI / 3), ...white));
    }
    bl.push(tint(new THREE.SphereGeometry(1.7, 10, 8).scale(1.5, 1, 1), ...white));
    const m = new THREE.Mesh(mergeGeometries(bl), SCN.flatMat || (SCN.flatMat = (() => { const mm = landMat({ vertexMain: 'vCol = color; ln = normalize(mat3(modelMatrix) * normal);', fragmentMain: 'outC = vCol * (uSunCol * max(dot(normalize(uToLand * vN), uSunDir), 0.0) * cloudShade(vLP.xz) + mix(uGndCol, uSkyCol, 0.7));' }); mm.vertexColors = true; return mm; })()));
    m.position.set(t[0] + Math.cos(-t[3] * 6) * 3.6, t[1] + 81, t[2] - Math.sin(-t[3] * 6) * 3.6); m.rotation.y = t[3] * 6; m.userData.w = 0.9 + t[3];
    m.frustumCulled = false;
    // (the blades turn in the mesh's own frame, so their positions reach the shader through the model matrix)
    m.material = SCN.bladeMat || (SCN.bladeMat = bladeMat());
    LAND.group.add(m); SCN.blades.push(m); casters.push([t[0], t[2], 2.2, 60]); solid.push([t[0], t[2], 2.4]);
  }
  // hot-air balloons drifting over the lake and the plain
  const bal = [];
  for (const [x, z, y, hue] of [[1150, 120, 150, 0.02], [1420, -260, 230, 0.58], [520, -380, 190, 0.12], [-250, 520, 260, 0.75], [240, 900, 170, 0.33]]) bal.push([x, y, z, 0, hue]);
  {
    const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14, a = t * Math.PI; pts.push(new THREE.Vector2(Math.max(0.05, Math.sin(a) * (9 + 2.5 * Math.sin(a * 0.5))), 16 - Math.cos(a) * -1 * 0 - 14 * Math.cos(a) * 0.5 - 7 + 14 * t * 0 + 7)); }
    const env = new THREE.LatheGeometry(pts, 16).toNonIndexed(); env.computeVertexNormals();
    const p = env.attributes.position.array, n = env.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const gore = Math.floor((Math.atan2(p[i * 3 + 2], p[i * 3]) / (2 * Math.PI) + 0.5) * 8 - 1e-4) % 2; c[i * 3] = gore ? 1 : 0.5; c[i * 3 + 1] = gore ? 1 : 0.5; c[i * 3 + 2] = gore ? 1 : 0.5; }
    env.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const g = mergeGeometries([env, tint(new THREE.BoxGeometry(1.6, 1.3, 1.6).translate(0, 2.2, 0), 0.25, 0.25, 0.25)]);
    const m = inst(g, bal, sceneryMat({ vertexMain2: 'lp.y += sin(uLTime * 0.21 + vBase.x * 0.01) * 5.0; lp.x += uLTime * 0.6; vHt = 1.0;', fragmentMain2: `
      vec3 N = normalize(vN);
      outC = vCol * (uSunCol * (0.25 + 0.75 * max(dot(N, uSunDir), 0.0)) + mix(uGndCol, uSkyCol, 0.5 + 0.5 * N.y) * 1.6);` }));
    bal.forEach((b, i) => { const k = new THREE.Color().setHSL(b[4], 0.75, 0.5); m.setColorAt(i, k.multiplyScalar(0.9)); });
  }
  LAND.casters = casters;
  lgBuildObstacles(solid);
}
function sceneryStatic() {
  const m = landMat({ vertexMain: 'vCol = color;', fragmentMain: `
      vec3 N = normalize(vN);
      vec3 alb = vCol * (0.9 + 0.2 * vnoise(vLP.xz * 0.5 + vLP.y));
      outC = landLit(alb, N, vLP, vWP, 0.0);
      // glass and paint catch the sun; windows are lit at night
      vec3 V = normalize(uToLand * (cameraPosition - vWP));
      float glass = step(vCol.b, 0.17) * step(0.045, vCol.b) * step(vCol.r, 0.07);
      outC += uSunCol * pow(max(dot(reflect(-V, N), uSunDir), 0.0), 60.0) * 0.6 * glass + skyCol(reflect(-V, N) * vec3(1.0, 1.0, 1.0) + vec3(0.0, 0.2, 0.0), uLTime) * 0.25 * glass;
      outC += vec3(1.0, 0.8, 0.5) * glass * uNightK * 0.5 * step(0.5, hash12(floor(vLP.xz / 3.0)));` });
  m.vertexColors = true;
  return m;
}
function bladeMat() {
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, WU, LU),
    vertexShader: `${GLSL_LAND}
      varying vec3 vWP; varying vec3 vNl; varying vec3 vCol;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vNl = uToLand * normalize(mat3(modelMatrix) * normal); vCol = color; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `${GLSL_LAND}
      varying vec3 vWP; varying vec3 vNl; varying vec3 vCol;
      void main(){
        float vis = revealVis(vWP); if (vis < 0.002 || vis < hash12(gl_FragCoord.xy)) discard;
        vec3 N = normalize(vNl);
        vec3 c = vCol * (uSunCol * max(dot(N, uSunDir), 0.0) + mix(uGndCol, uSkyCol, 0.5 + 0.5 * N.y));
        gl_FragColor = vec4(landFog(c, vWP), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  m.vertexColors = true;
  return m;
}

/* ---------- tyre marks ---------- */
const SKID_N = 3000;
function buildSkid() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKID_N * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(SKID_N * 4), 1).setUsage(THREE.DynamicDrawUsage));
  const idx = []; for (let i = 0; i < SKID_N; i++) { const a = i * 4; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx); g.boundingSphere = new THREE.Sphere(new V3(), 1e6);
  const mat = landMat({ transparent: true, depthWrite: false, offset: -12, side: THREE.DoubleSide,
    vertexPars: 'attribute float aA; varying float vA;', vertexMain: 'vA = aA;', fragmentPars: 'varying float vA;',
    fragmentMain: 'outC = landLit(vec3(0.012), vec3(0.0, 1.0, 0.0), vLP, vWP, 0.8); alpha = vA * (0.75 + 0.25 * vnoise(vLP.xz * 9.0));' });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = 2;
  LAND.group.add(m);
  SCN.skid = { mesh: m, n: 0, last: [null, null, null, null] };
}
// each sliding tyre lays a strip from where it was to where it is
function updateSkid() {
  const K = SCN.skid, W = FREE.wheels, P = K.mesh.geometry.attributes.position, A = K.mesh.geometry.attributes.aA;
  const cs = Math.cos(FREE.th), sn = Math.sin(FREE.th);
  let dirty = false;
  for (let i = 0; i < 4; i++) {
    const q = W[i], k = q.road && q.surf < 2 && q.F > 0 ? clamp(q.slip * 1.6, 0, 1) : 0, L = K.last[i];
    if (k < 0.08) { K.last[i] = null; continue; }
    const hw = AX[i < 2 ? 0 : 1].w * 0.42, y = q.g + 0.012;
    // across the direction the tyre's patch is moving in
    const cur = [q.wx - sn * hw, y, q.wz + cs * hw, q.wx + sn * hw, y, q.wz - cs * hw, k];
    const far = L ? Math.hypot(cur[0] - L[0], cur[2] - L[2]) : 0;
    if (L && far < 0.35) continue;
    // (a car put somewhere else starts a new mark)
    if (far > 4) { K.last[i] = cur; continue; }
    if (L) {
      const o = K.n * 12, a = K.n * 4; K.n = (K.n + 1) % SKID_N;
      P.array.set([L[0], L[1], L[2], L[3], L[4], L[5], cur[0], cur[1], cur[2], cur[3], cur[4], cur[5]], o);
      A.array[a] = A.array[a + 1] = L[6] * 0.8; A.array[a + 2] = A.array[a + 3] = k * 0.8;
      dirty = true;
    }
    K.last[i] = cur;
  }
  if (dirty) { P.needsUpdate = true; A.needsUpdate = true; }
}

/* ---------- assembly, per frame ---------- */
function buildScenery() {
  buildProps();
  buildTrees(); buildRocks(); buildBarriers(); buildSkid();
}
function updateScenery(dt, snap) {
  const x = FREE.view.x, z = FREE.view.z;
  for (const t of SCN.trees) {
    const d = Math.hypot(clamp(x, t.x - 128, t.x + 128) - x, clamp(z, t.z - 128, t.z + 128) - z);
    t.near.visible = d < 230; t.far.visible = d >= 230 && d < 1900;
  }
  for (const b of SCN.blades) b.rotation.x = LU.uLTime.value * b.userData.w;
  if (!snap && FREE.on) updateSkid();
}
