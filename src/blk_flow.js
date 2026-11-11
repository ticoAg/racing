/* =========================================================================
   LIVE AIRFLOW — a 3D lattice-Boltzmann wind tunnel on the GPU.
   D3Q19 lattice of 5 cm cells around half the car (the centre plane is a
   mirror): regularised collisions with a Smagorinsky eddy viscosity (LES)
   and a separate, large bulk viscosity that soaks up sound; a rolling road,
   tyres turning with the road, a wall model standing in for the thin
   turbulent boundary layer, and the wing / spoiler / airbrake voxelised as
   they move. Free stream at the inlet, roof and side (behind absorbing
   layers), zero gradient at the outlet behind a sponge. The air goes over,
   under and around the car, separates off the tail and the wing, sheds and
   recirculates by itself.
   Smoke rakes upstream and wands at the wing tips release tracers that ride
   the solved velocity (streaklines, coloured by local speed); the surface
   pressure map is the time-averaged pressure next to the skin.
   Storage: populations as f - w in half floats, five RGBA layers per
   ping-pong target, and a sixth (full floats) with the velocity and density
   averaged over the last ~16 steps; the 3D grid is tiled into a 2D atlas,
   z-slices side by side.
   ========================================================================= */
const LQ = (() => {
  const E = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
    [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]];
  const W = E.map((e, i) => (i === 0 ? 1 / 3 : i < 7 ? 1 / 18 : 1 / 36));
  const find = (x, y, z) => E.findIndex((g) => g[0] === x && g[1] === y && g[2] === z);
  return { E, W, OPP: E.map(([x, y, z]) => find(-x, -y, -z)), MZ: E.map(([x, y, z]) => find(x, y, -z)) };
})();
const FLOW = {
  ok: false, tried: false, L: null, X0: -6.4, DX: 0.05, NX: 216, NY: 54, NZ: 48,
  prt: null, pcur: 0, NP: 256, head: 0, frame: 0, emitters: [], lines: [], pMat: null,
  steps: 12, dtAvg: 1 / 60, u0: 0.075, mesh: null, fresh: true, key: '', dep: -1, ab: -1,
  body: null, sol: null, box: null, cpOn: 0,
};

/* ---------- GLSL generation ---------- */
const glf = (v) => { const s = (+v).toPrecision(9); return /[.e]/.test(s) ? s : s + '.0'; };
const eDot = (e, v) => { const t = []; ['x', 'y', 'z'].forEach((c, k) => { if (e[k]) t.push((e[k] > 0 ? '+' : '-') + v + '.' + c); }); return t.length ? '(' + t.join('') + ')' : '0.0'; };
const popTex = (i) => `tF${i >> 2}`, popCh = (i) => 'xyzw'[i & 3];
const LBM_VERT = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
function lbmHead(L, outs) {
  const { E, W } = LQ, R = [...Array(19).keys()];
  const sum = (k) => R.filter((i) => E[i][k]).map((i) => (E[i][k] > 0 ? '+' : '-') + `f[${i}]`).join('');
  return `precision highp float; precision highp int; precision highp sampler2D;
#define NX ${L.NX}
#define NY ${L.NY}
#define NZ ${L.NZ}
#define TX ${L.TX}
uniform sampler2D tF0, tF1, tF2, tF3, tF4, tF5, tS;
${outs}
ivec2 at(ivec3 c) { return ivec2(c.x + (c.z % TX) * NX, c.y + (c.z / TX) * NY); }
ivec3 cellOf(ivec2 p) { int tx = p.x / NX, ty = p.y / NY; return ivec3(p.x - tx * NX, p.y - ty * NY, ty * TX + tx); }
void readAll(ivec2 p, out float f[19]) {
  vec4 a0 = texelFetch(tF0, p, 0), a1 = texelFetch(tF1, p, 0), a2 = texelFetch(tF2, p, 0), a3 = texelFetch(tF3, p, 0), a4 = texelFetch(tF4, p, 0);
  ${R.map((i) => `f[${i}] = a${i >> 2}.${popCh(i)} + ${glf(W[i])};`).join(' ')}
}
void feq(float rho, vec3 u, out float f[19]) {
  float uu = 1.5 * dot(u, u), eu;
  f[0] = ${glf(W[0])} * rho * (1.0 - uu);
  ${R.slice(1).map((i) => `eu = ${eDot(E[i], 'u')}; f[${i}] = ${glf(W[i])} * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - uu);`).join('\n  ')}
}
vec4 moments(float f[19]) {
  float rho = 0.0;
  for (int i = 0; i < 19; i++) rho += f[i];
  return vec4(vec3(${sum(0)}, ${sum(1)}, ${sum(2)}) / rho, rho);
}`;
}
// five layers of populations, and a sixth with the velocity and density averaged over the last ~16 steps
const LBM_OUT6 = 'layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2; layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4; layout(location = 5) out vec4 o5;';
function lbmPut() {
  const W = LQ.W, g = (i) => (i < 19 ? `f[${i}] - ${glf(W[i])}` : '0.0');
  return `void put(float f[19]) {
  ${[0, 1, 2, 3, 4].map((t) => `o${t} = vec4(${g(4 * t)}, ${g(4 * t + 1)}, ${g(4 * t + 2)}, ${g(4 * t + 3)});`).join('\n  ')}
}`;
}
function lbmStepFrag(L) {
  const { E, W, OPP, MZ } = LQ;
  let stream = '';
  for (let i = 1; i < 19; i++) {
    const [ex, ey, ez] = E[i], o = OPP[i], w = glf(W[i]), w6 = glf(6 * W[i]);
    const ev = `vec3(${glf(ex)}, ${glf(ey)}, ${glf(ez)})`;
    // equilibrium of the free stream (rho 1, u = -u0 x)
    const fin = `${w} * (1.0 ${ex ? (ex > 0 ? '-' : '+') + ' 3.0 * uU0' : ''} + ${ex ? '3.0' : '-1.5'} * uU0 * uU0)`;
    const get = (k, q) => `texelFetch(${popTex(k)}, at(${q}), 0).${popCh(k)} + ${w}`;
    let s = `  if ((bits & ${1 << (i - 1)}) != 0) f[${i}] = own[${o}] + ${w6} * dot(${ev}, wheel && inWheel(c - EI[${i}]) ? uwW : uwB);\n  else {\n    ivec3 q = c - ivec3(${ex}, ${ey}, ${ez});\n    `;
    if (ey > 0) s += `if (q.y < 0) f[${i}] = own[${o}]${ex ? ` ${ex > 0 ? '-' : '+'} ${w6} * uRoad` : ''};\n    else `;
    if (ex < 0) s += `if (q.x >= NX) f[${i}] = ${fin};\n    else `;
    if (ey < 0) s += `if (q.y >= NY) f[${i}] = ${fin};\n    else `;
    if (ez < 0) s += `if (q.z >= NZ) f[${i}] = ${fin};\n    else `;
    s += '{ ';
    if (ex > 0) s += 'q.x = max(q.x, 0); ';
    if (ez > 0) s += `if (q.z < 0) f[${i}] = ${get(MZ[i], 'ivec3(q.x, q.y, 0)')}; else `;
    s += `f[${i}] = ${get(i, 'q')}; }\n  }\n`;
    stream += s;
  }
  // links whose source lies on one side of the cell (axis k, sign s)
  const side = (k, sgn) => E.reduce((m, e, i) => (i && e[k] === sgn ? m | (1 << (i - 1)) : m), 0);
  const nonEq = (fn) => [...Array(19).keys()].filter((i) => fn(E[i])).map((i) => `${fn(E[i]) > 0 ? '+' : '-'}d[${i}]`).join('') || '0.0';
  // shear part relaxes with tau, the trace (bulk) part with tauB: Q_i:Pi_dev = Q_i:Pi - tr/3 (|e|^2 - 1)
  const coll = [...Array(19).keys()].map((i) => {
    const [x, y, z] = E[i], c = (v) => glf(v * v - 1 / 3), e2 = x * x + y * y + z * z - 1;
    let t = `${c(x)} * Pxx + ${c(y)} * Pyy + ${c(z)} * Pzz`;
    if (x * y) t += ` ${x * y > 0 ? '+' : '-'} 2.0 * Pxy`;
    if (x * z) t += ` ${x * z > 0 ? '+' : '-'} 2.0 * Pxz`;
    if (y * z) t += ` ${y * z > 0 ? '+' : '-'} 2.0 * Pyz`;
    return `f[${i}] = fe[${i}] + ${glf(4.5 * W[i])} * (k * (${t})${e2 ? ` ${e2 > 0 ? '+' : '-'} kb` : ''});`;
  }).join('\n  ');
  return `${lbmHead(L, LBM_OUT6)}
${lbmPut()}
uniform float uU0, uRoad, uTau0, uTauB, uTauW, uCs2, uCf, uSpO, uSpT, uSpA, uAvg;
uniform vec4 uWhF, uWhR;   // axle centre (cells), radius (cells), x split between the axles
uniform vec4 uWhZ;         // tyre z range (cells), front then rear
const ivec3 EI[19] = ivec3[19](${E.map((e) => `ivec3(${e.join(', ')})`).join(', ')});
const float WI[19] = float[19](${W.map(glf).join(', ')});
bool front(ivec3 c) { return float(c.x) + 0.5 > uWhF.w; }
// the same test the voxeliser uses: cell centre inside the tyre's cylinder
bool inWheel(ivec3 s) {
  bool fr = front(s);
  vec4 wh = fr ? uWhF : uWhR;
  vec2 zr = fr ? uWhZ.xy : uWhZ.zw, r = vec2(s.xy) + 0.5 - wh.xy;
  float z = float(s.z < 0 ? -1 - s.z : s.z) + 0.5;
  return dot(r, r) <= wh.z * wh.z && z >= zr.x && z <= zr.y;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec3 c = cellOf(p);
  float f[19];
  if (c.z >= NZ) { o0 = o1 = o2 = o3 = o4 = o5 = vec4(0.0); return; }
  uvec4 s = uvec4(texelFetch(tS, p, 0) * 255.0 + 0.5);
  vec3 uIn = vec3(-uU0, 0.0, 0.0);
  if (s.a > 127u) { feq(1.0, vec3(0.0), f); put(f); o5 = vec4(0.0, 0.0, 0.0, -2.0); return; }
  int bits = int(s.r) | (int(s.g) << 8) | (int(s.b & 3u) << 16);
  bool wheel = (s.b & 4u) != 0u;
  float own[19];
  vec3 uwB = vec3(0.0), uwW = vec3(0.0);
  if (bits != 0 || c.y == 0) {
    readAll(p, own);
    // wall velocities are kept tangential to the staircase surface (normal weighted like the links), so no
    // wall puts mass into the air or takes it out.
    // body (wall model): the boundary layer at these Reynolds numbers is millimetres thick, far below a cell, so
    // the wall slides with the air next to it and holds back only the skin friction of a turbulent boundary layer,
    // tau_w = Cf/2 rho u^2. A bounce-back wall moving at u_w takes (u - u_w)/3 per cell and step.
    // A cell that touches the body only across a diagonal sits off a convex edge: there the wall holds the air, so
    // the flow leaves sharp edges (tail, wing trailing edges) instead of sliding round them as round a chamfer.
    // tyres: the tread turns with the road, forward at the top, still at the contact patch.
    vec3 nB = vec3(0.0), nW = vec3(0.0);
    bool face = false;
    for (int i = 1; i < 19; i++) if ((bits & (1 << (i - 1))) != 0) {
      vec3 e = WI[i] * vec3(EI[i]);
      if (wheel && inWheel(c - EI[i])) nW -= e; else { nB -= e; face = face || i < 7; }
    }
    if (face) { nB = normalize(nB); vec3 m = moments(own).xyz, t = m - dot(m, nB) * nB; uwB = t * max(0.0, 1.0 - 1.5 * uCf * length(t)); }
    if (dot(nW, nW) > 0.0) {
      nW = normalize(nW);
      vec4 wh = front(c) ? uWhF : uWhR;
      vec2 r = vec2(c.xy) + 0.5 - wh.xy;
      vec3 v = vec3(r.y, -r.x, 0.0) * (uRoad / wh.z);
      uwW = v - dot(v, nW) * nW;
    }
  }
  // streaming (pull) with half-way bounce-back off the body, the tyres and the rolling road;
  // free stream at the inlet, the roof and the side; zero gradient at the outlet; mirror at the centre plane
  f[0] = texelFetch(tF0, p, 0).x + ${glf(W[0])};
${stream}
  vec4 mo = moments(f);
  float rho = mo.w;
  vec3 u = mo.xyz;
  if (!(rho > 0.5 && rho < 2.0) || dot(u, u) > 0.25) { feq(1.0, uIn, f); put(f); o5 = vec4(uIn, 0.0); return; }
  float fe[19], d[19];
  feq(rho, u, fe);
  for (int i = 0; i < 19; i++) d[i] = f[i] - fe[i];
  float Pxx = ${nonEq((e) => e[0] * e[0])}, Pyy = ${nonEq((e) => e[1] * e[1])}, Pzz = ${nonEq((e) => e[2] * e[2])};
  float Pxy = ${nonEq((e) => e[0] * e[1])}, Pxz = ${nonEq((e) => e[0] * e[2])}, Pyz = ${nonEq((e) => e[1] * e[2])};
  // regularised BGK; Smagorinsky eddy viscosity from the local strain; sponges at the outlet, roof and side
  float Q = sqrt(Pxx * Pxx + Pyy * Pyy + Pzz * Pzz + 2.0 * (Pxy * Pxy + Pxz * Pxz + Pyz * Pyz));
  float t0 = uTau0 + uSpO * (1.0 - smoothstep(0.0, ${glf(L.spO)}, float(c.x)))
    + uSpT * (smoothstep(${glf(L.NY - L.spT)}, ${glf(L.NY)}, float(c.y)) + smoothstep(${glf(L.NZ - L.spT)}, ${glf(L.NZ)}, float(c.z)) + smoothstep(${glf(L.NX - 4)}, ${glf(L.NX)}, float(c.x)));
  // cells squeezed between walls on opposite sides (the road under the floor, tyre against arch) keep a floor on tau:
  // over-relaxation between two bounce-back walls a cell or two apart is unstable
  bool below = (bits & ${side(1, 1)}) != 0 || c.y == 0;
  if ((below && (bits & ${side(1, -1)}) != 0) || ((bits & ${side(0, 1)}) != 0 && (bits & ${side(0, -1)}) != 0) || ((bits & ${side(2, 1)}) != 0 && (bits & ${side(2, -1)}) != 0)) t0 = max(t0, uTauW);
  float tau = 0.5 * (t0 + sqrt(t0 * t0 + 25.4558441 * uCs2 * Q / rho));
  float k = 1.0 - 1.0 / tau, kb = (1.0 - 1.0 / max(uTauB, tau) - k) * (Pxx + Pyy + Pzz) / 3.0;
  ${coll}
  // absorbing layers at the inlet, the roof and the side: relax towards the free stream so sound leaves the tunnel
  float sa = uSpA * (smoothstep(${glf(L.NY - L.spT)}, ${glf(L.NY)}, float(c.y)) + smoothstep(${glf(L.NZ - L.spT)}, ${glf(L.NZ)}, float(c.z)) + smoothstep(${glf(L.NX - L.spT)}, ${glf(L.NX)}, float(c.x)));
  if (sa > 0.0) { feq(1.0, uIn, fe); for (int i = 0; i < 19; i++) f[i] = mix(f[i], fe[i], min(sa, 1.0)); }
  put(f);
  // the smoke rides this short running average (about the time the air takes to cross two cells, the smallest
  // eddy the grid resolves), so sound and grid-scale flicker cannot jitter it
  vec4 a = texelFetch(tF5, p, 0), v = vec4(u, rho - 1.0);
  o5 = a.w < -1.0 ? v : mix(a, v, uAvg);
}`;
}
function lbmInitFrag(L) {
  return `${lbmHead(L, LBM_OUT6)}
${lbmPut()}
uniform float uU0;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (cellOf(p).z >= NZ) { o0 = o1 = o2 = o3 = o4 = o5 = vec4(0.0); return; }
  float f[19];
  bool solid = texelFetch(tS, p, 0).a > 0.5;
  vec3 u = solid ? vec3(0.0) : vec3(-uU0, 0.0, 0.0);
  feq(1.0, u, f);
  put(f);
  o5 = vec4(u, solid ? -2.0 : 0.0);
}`;
}
// running mean of velocity and density over ~1200 steps (for the pressure map), once per frame
function lbmMacroFrag(L) {
  return `${lbmHead(L, 'layout(location = 0) out vec4 oM;')}
uniform sampler2D tM; uniform float uA;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 v = texelFetch(tF5, p, 0), o = texelFetch(tM, p, 0);
  oM = v.w < -1.0 || uA >= 1.0 || o.w < -1.0 ? v : mix(o, v, uA);
}`;
}

/* ---------- a lattice: render targets, materials, passes ---------- */
function lbmCreate(o) {
  const L = Object.assign({ cur: 0, mcur: 0, age: 0, type: THREE.HalfFloatType, spO: 24, spT: 8 }, o);
  let best = 1e9;
  for (let tx = 1; tx <= L.NZ; tx++) { const m = Math.max(tx * L.NX, Math.ceil(L.NZ / tx) * L.NY); if (m < best) { best = m; L.TX = tx; } }
  L.TY = Math.ceil(L.NZ / L.TX); L.W = L.TX * L.NX; L.H = L.TY * L.NY;
  const ro = (count, type) => ({ count, type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  L.rt = [0, 1].map(() => new THREE.WebGLRenderTarget(L.W, L.H, ro(6, L.type)));
  // the slow running averages need full floats: in half floats a small blend step rounds away and the average sticks
  for (const t of L.rt) t.textures[5].type = THREE.FloatType;
  L.mrt = [0, 1].map(() => new THREE.WebGLRenderTarget(L.W, L.H, ro(1, THREE.FloatType)));
  L.statData = new Uint8Array(L.W * L.H * 4);
  L.stat = new THREE.DataTexture(L.statData, L.W, L.H, THREE.RGBAFormat, THREE.UnsignedByteType);
  L.stat.minFilter = L.stat.magFilter = THREE.NearestFilter;
  L.stat.needsUpdate = true;
  const v = (x) => ({ value: x });
  L.uni = {
    tF0: v(null), tF1: v(null), tF2: v(null), tF3: v(null), tF4: v(null), tF5: v(null), tS: v(L.stat), tM: v(null), uA: v(1),
    uU0: v(0.075), uRoad: v(0.075), uTau0: v(0.504), uTauB: v(2), uTauW: v(0.56), uCs2: v(0.0256), uCf: v(0.003),
    uSpO: v(0.35), uSpT: v(0.08), uSpA: v(0.06), uAvg: v(1 / 16),
    uWhF: v(new THREE.Vector4(0, 0, 1, 0)), uWhR: v(new THREE.Vector4(0, 0, 1, 0)), uWhZ: v(new THREE.Vector4(-9, -9, -9, -9)),
  };
  const mat = (frag) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: L.uni, vertexShader: LBM_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  L.stepMat = mat(lbmStepFrag(L)); L.initMat = mat(lbmInitFrag(L)); L.macroMat = mat(lbmMacroFrag(L));
  L.scene = new THREE.Scene();
  L.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), L.stepMat);
  L.quad.frustumCulled = false;
  L.scene.add(L.quad);
  L.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return L;
}
function lbmDispose(L) {
  for (const t of [...L.rt, ...L.mrt]) t.dispose();
  L.stat.dispose(); L.stepMat.dispose(); L.initMat.dispose(); L.macroMat.dispose(); L.quad.geometry.dispose();
}
function lbmPass(L, mat, target) { L.quad.material = mat; renderer.setRenderTarget(target); renderer.render(L.scene, L.cam); }
function lbmBind(L) { const t = L.rt[L.cur].textures; for (let k = 0; k < 6; k++) L.uni['tF' + k].value = t[k]; }
function lbmReset(L) { for (const t of L.rt) lbmPass(L, L.initMat, t); L.cur = 0; L.age = 0; }
function lbmStep(L, n) {
  for (let i = 0; i < n; i++) { lbmBind(L); lbmPass(L, L.stepMat, L.rt[1 - L.cur]); L.cur = 1 - L.cur; }
  L.age += n;
}
function lbmMacro(L, a) {
  lbmBind(L);
  L.uni.tM.value = L.mrt[L.mcur].texture; L.uni.uA.value = a;
  lbmPass(L, L.macroMat, L.mrt[1 - L.mcur]);
  L.mcur = 1 - L.mcur;
}
// float readback of one colour attachment (tests and the self-test only)
function rtRead(rt, att, x, y, w, h) {
  const gl = renderer.getContext(), out = new Float32Array(w * h * 4), prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  gl.readBuffer(gl.COLOR_ATTACHMENT0 + att);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  renderer.setRenderTarget(prev);
  return out;
}
const lbmIdx = (L, i, j, k) => (k * L.NY + j) * L.NX + i;
const lbmTexel = (L, i, j, k) => ((j + Math.floor(k / L.TX) * L.NY) * L.W + i + (k % L.TX) * L.NX) * 4;
// per fluid cell: which of the 18 links come from a solid cell (mirror image across z = 0), and whether one is a tyre
function lbmLinks(L, sol, b = [0, L.NX - 1, 0, L.NY - 1, 0, L.NZ - 1]) {
  const { NX, NY, NZ } = L, E = LQ.E, out = L.statData;
  for (let k = b[4]; k <= b[5]; k++) for (let j = b[2]; j <= b[3]; j++) for (let i = b[0]; i <= b[1]; i++) {
    const o = lbmTexel(L, i, j, k);
    if (sol[lbmIdx(L, i, j, k)]) { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 255; continue; }
    let bits = 0, wheel = 0;
    for (let d = 1; d < 19; d++) {
      const a = i - E[d][0], c = j - E[d][1];
      let z = k - E[d][2];
      if (z < 0) z = -1 - z;
      if (a < 0 || c < 0 || a >= NX || c >= NY || z >= NZ) continue;
      const t = sol[lbmIdx(L, a, c, z)];
      if (t) { bits |= 1 << (d - 1); if (t === 2) wheel = 4; }
    }
    out[o] = bits & 255; out[o + 1] = (bits >> 8) & 255; out[o + 2] = ((bits >> 16) & 3) | wheel; out[o + 3] = 0;
  }
  L.stat.needsUpdate = true;
}

/* ---------- the car in the tunnel: voxels ---------- */
// fill air pockets narrower than a cell (tyre against arch, slots between parts): a cell with solid faces on both
// sides along two axes, or walled in on more than twelve of its links, is solid. The real gaps there are smaller
// than the cells. (The road counts as a face below the first layer, so the gap under the floor stays open.)
function voxPockets(L, sol, b = [0, L.NX - 1, 0, L.NY - 1, 0, L.NZ - 1]) {
  const { NX, NY, NZ } = L, E = LQ.E;
  const at = (i, j, k) => { if (k < 0) k = -1 - k; if (i < 0 || j < 0 || i >= NX || j >= NY || k >= NZ) return 0; return sol[lbmIdx(L, i, j, k)]; };
  for (let pass = 0; pass < 24; pass++) {
    let changed = 0;
    for (let k = b[4]; k <= b[5]; k++) for (let j = b[2]; j <= b[3]; j++) for (let i = b[0]; i <= b[1]; i++) {
      if (sol[lbmIdx(L, i, j, k)]) continue;
      let n = 0;
      for (let d = 1; d < 19; d++) if (at(i - E[d][0], j - E[d][1], k - E[d][2])) n++;
      const ax = (at(i - 1, j, k) && at(i + 1, j, k) ? 1 : 0) + ((j === 0 || at(i, j - 1, k)) && at(i, j + 1, k) ? 1 : 0) + (at(i, j, k - 1) && at(i, j, k + 1) ? 1 : 0);
      if (n > 12 || ax >= 2) { sol[lbmIdx(L, i, j, k)] = 1; changed++; }
    }
    if (!changed) break;
  }
}
function voxPoly(L, poly) {
  const { DX, X0, NX, NY } = L, cells = [];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const i0 = Math.max(0, Math.floor((x0 - X0) / DX)), i1 = Math.min(NX - 1, Math.floor((x1 - X0) / DX));
  const j0 = Math.max(0, Math.floor(y0 / DX)), j1 = Math.min(NY - 1, Math.floor(y1 / DX));
  for (let i = i0; i <= i1; i++) {
    let best = 0, bj = -1, any = false;
    for (let j = j0; j <= j1; j++) {
      let n = 0;
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (polyInside(poly, X0 + (i + (a + 0.5) / 4) * DX, (j + (b + 0.5) / 4) * DX)) n++;
      if (n >= 6) { cells.push(i, j); any = true; }
      if (n > best) { best = n; bj = j; }
    }
    if (!any && best >= 2) cells.push(i, bj);
  }
  return cells;
}
function voxSet(L, sol, cells, k, val) { for (let q = 0; q < cells.length; q += 2) sol[lbmIdx(L, cells[q], cells[q + 1], k)] = val; }
function flowBody(L) {
  const { NX, NY, NZ, DX, X0 } = L, sol = new Uint8Array(NX * NY * NZ);
  const xs = Float64Array.from({ length: NX }, (_, i) => X0 + (i + 0.5) * DX);
  const noseX = XF + SPEC.parts.splitter.nose;
  const lip = xs.map((x) => (x > SPL_X0 && x < noseX ? lipZ(Math.min(x, XF - 0.001)) : 0));
  for (let k = 0; k < NZ; k++) {
    const z = (k + 0.5) * DX;
    if (z > 1.2) break;
    const prof = sliceProfile(z, xs);
    for (let i = 0; i < NX; i++) {
      const x = xs[i];
      let top = prof.T[i], bot = prof.B[i];
      // splitter under the nose: a 12 mm plate is far thinner than a cell, so its top face stands for it and the
      // slot under the nose stays as deep as the one under the floor
      if (x > SPL_X0 && x < noseX && z < lip[i] + 0.028) { bot = 0.08; if (top < 0) top = 0.08 + 0.5 * DX; }
      if (top > 0) for (let j = 0; j < NY; j++) { const y = (j + 0.5) * DX; if (y >= bot && y <= top + 0.15 * DX) sol[lbmIdx(L, i, j, k)] = 1; }
      for (const w of AX) {
        const dx = x - w.x;
        if (Math.abs(z - w.track) > w.w / 2 || Math.abs(dx) > w.R) continue;
        for (let j = 0; j < NY; j++) { const dy = (j + 0.5) * DX - w.yc; if (dx * dx + dy * dy <= w.R * w.R) sol[lbmIdx(L, i, j, k)] = 2; }
      }
      // door mirrors
      const mx = (x - 0.60) / 0.10, mz = (z - 0.995) / 0.112;
      if (mx * mx + mz * mz < 1) for (let j = 0; j < NY; j++) { const my = ((j + 0.5) * DX - 0.905) / 0.042; if (mx * mx + my * my + mz * mz <= 1) sol[lbmIdx(L, i, j, k)] = 1; }
    }
  }
  return sol;
}
// the moving aero parts, re-voxelised inside their box whenever the wing deploys, trims or flips into an airbrake
function flowWing(L, dep, ab) {
  const F = FLOW, B = F.box, sol = F.sol;
  for (let k = B[4]; k <= B[5]; k++) for (let j = B[2]; j <= B[3]; j++) for (let i = B[0]; i <= B[1]; i++) { const q = lbmIdx(L, i, j, k); sol[q] = F.body[q]; }
  const layer = (z) => clamp(Math.floor(z / L.DX), 0, L.NZ - 1);
  if (state.wing === 'gt') {
    const dy = lerp(-WING.drop, 0, Math.max(dep, ab));
    // the same section all along the span: rasterise once, stack it in every layer up to the tip
    const sec = wingShapes(0, ab, dep, true).map((p) => voxPoly(L, p));
    for (let k = 0; (k + 0.5) * L.DX <= WING.span / 2; k++) for (const c of sec) voxSet(L, sol, c, k, 1);
    const up = (P) => P.map(([x, y]) => [x, y + dy]);
    voxSet(L, sol, voxPoly(L, up(BODY.wingPlate)), layer(WING.span / 2 + 0.0045), 1);
    voxSet(L, sol, voxPoly(L, up(BODY.wingPylon)), layer(WING.pylonZ), 1);
  } else if (state.wing === 'active') {
    for (let k = 0; (k + 0.5) * L.DX <= SPOIL.span / 2; k++) for (const p of wingShapes((k + 0.5) * L.DX, ab, dep, true)) voxSet(L, sol, voxPoly(L, p), k, 1);
  }
  const bb = [Math.max(0, B[0] - 1), Math.min(L.NX - 1, B[1] + 1), Math.max(0, B[2] - 1), Math.min(L.NY - 1, B[3] + 1), B[4], Math.min(L.NZ - 1, B[5] + 1)];
  voxPockets(L, sol, bb);
  lbmLinks(L, sol, bb);
}
function flowUpdateMask(force) {
  const F = FLOW, dep = clamp(wingDeploy, 0, 1), ab = DRIVE.airbrake, key = state.wing + '|' + state.kit;
  if (force || key !== F.key || Math.abs(dep - F.dep) > 0.03 || Math.abs(ab - F.ab) > 0.03) {
    F.key = key; F.dep = dep; F.ab = ab;
    flowWing(F.L, dep, ab);
  }
}

/* ---------- setup ---------- */
function flowSupported() {
  try {
    const gl = renderer.getContext();
    return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float') && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 6 && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048;
  } catch (e) { return false; }
}
// the car in the lattice: wheels, voxels, the box the moving aero parts sweep, the smoke rakes (again after a model change)
function flowCar() {
  const F = FLOW, L = F.L;
  const wh = (w) => new THREE.Vector4((w.x - F.X0) / F.DX, w.yc / F.DX, w.R / F.DX, (0.5 * (AX[0].x + AX[1].x) - F.X0) / F.DX);
  L.uni.uWhF.value.copy(wh(AX[0])); L.uni.uWhR.value.copy(wh(AX[1]));
  L.uni.uWhZ.value.set((AX[0].track - AX[0].w / 2) / F.DX, (AX[0].track + AX[0].w / 2) / F.DX, (AX[1].track - AX[1].w / 2) / F.DX, (AX[1].track + AX[1].w / 2) / F.DX);
  const cell = (x, y, z) => [clamp(Math.floor((x - F.X0) / F.DX), 0, F.NX - 1), clamp(Math.floor(y / F.DX), 0, F.NY - 1), clamp(Math.floor(z / F.DX), 0, F.NZ - 1)];
  const box = (lo, hi) => { const a = cell(...lo), b = cell(...hi); return [a[0], b[0], a[1], b[1], a[2], b[2]]; };
  F.body = flowBody(L);
  voxPockets(L, F.body, box([XR - 0.4, 0, 0], [XF + 0.2, 1.6, 1.25]));
  F.sol = F.body.slice();
  // everything the wing, its flap as an airbrake and the spoiler can reach
  const w0 = BODY.wingRel([-2.55, 0.55]), w1 = BODY.wingRel([-1.45, 1.7]);
  F.box = box([Math.min(w0[0], SPOIL.xLE - SPOIL.chord - 0.4), Math.min(w0[1], 0.55), 0], [Math.max(w1[0], SPOIL.xLE + 0.4), Math.max(w1[1], 1.7), Math.max(1.0, WING.span / 2 + 0.08)]);
  lbmLinks(L, F.sol);
  flowEmitters();
  if (F.pMat) F.emitters.forEach((e, i) => F.pMat.uniforms.uEm.value[i].set(e.x, e.y, e.z, 0));
}
async function flowInit() {
  const F = FLOW;
  F.tried = true;
  if (!flowSupported()) return false;
  // touch screens get 7 cm cells (about a third of the work)
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) Object.assign(F, { DX: 0.07, NX: 154, NY: 39, NZ: 34 });
  if (window.__TEST__ && window.__FLOW_GRID) Object.assign(F, window.__FLOW_GRID);
  F.pending = true;
  try {
    const L = F.L = lbmCreate({ NX: F.NX, NY: F.NY, NZ: F.NZ, DX: F.DX, X0: F.X0, spO: Math.round(1.2 / F.DX), spT: Math.round(0.4 / F.DX) });
    flowCar();
    flowParticleSetup();
    // compile the long shaders off the main thread where the browser can (KHR_parallel_shader_compile)
    const sc = new THREE.Scene();
    for (const m of [L.stepMat, L.initMat, L.macroMat, F.pMat]) { const q = new THREE.Mesh(L.quad.geometry, m); q.frustumCulled = false; sc.add(q); }
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(sc, L.cam);
    else renderer.compile(sc, L.cam);
  } catch (e) { console.warn('airflow solver unavailable', e); F.L = null; return false; }
  finally { F.pending = false; }
  F.ok = true;
  return true;
}
function flowReset() {
  const F = FLOW;
  F.dep = -1; F.ab = -1; F.key = '';
  flowUpdateMask(true);
  F.L.uni.uU0.value = F.u0;
  lbmReset(F.L);
  renderer.setRenderTarget(null);
  F.fresh = true;
  F.pMat.uniforms.uReset.value = 1;
}
// a few steps, then a free-stream cell must hold the equilibrium of the inflow: rest population at its weight,
// the backward-moving population exceeding the forward one by ~u0/3 (otherwise fall back to potential flow)
function flowSelfTest() {
  const F = FLOW, L = F.L;
  let buf;
  try {
    lbmStep(L, 6);
    const k = L.NZ - 6;
    buf = rtRead(L.rt[L.cur], 0, L.NX - 12 + (k % L.TX) * L.NX, Math.floor(L.NY * 0.7) + Math.floor(k / L.TX) * L.NY, 1, 1);
  } catch (e) { return false; }
  finally { renderer.setRenderTarget(null); }
  const d = buf[2] - buf[1], u = L.uni.uU0.value;
  return Number.isFinite(buf[0]) && Math.abs(buf[0]) < 0.02 && d > 0.6 * u / 3 && d < 1.4 * u / 3;
}

/* ---------- smoke ---------- */
function flowEmitters() {
  const F = FLOW, xr = F.X0 + F.NX * F.DX - 0.3;
  F.emitters = []; F.lines = [];
  const add = (x, y, z, lum = 1, probe = 0) => {
    const e = F.emitters.length;
    F.emitters.push({ x, y, z, probe });
    for (const s of z < 0.01 ? [1] : [1, -1]) F.lines.push(new THREE.Vector4(e, s, lum, 0));
  };
  // rakes: centre line, over the bonnet, over the front wheels, just outside the body
  for (const y of [0.05, 0.12, 0.2, 0.3, 0.42, 0.55, 0.68, 0.81, 0.94, 1.08, 1.24, 1.42]) add(xr, y, 0, y > 1.3 ? 0.6 : 1);
  for (const y of [0.06, 0.16, 0.3, 0.45, 0.6, 0.75, 0.9, 1.06, 1.24]) add(xr, y, 0.4);
  for (const y of [0.08, 0.2, 0.34, 0.5, 0.66, 0.82, 1.0, 1.2]) add(xr, y, 0.75);
  for (const y of [0.12, 0.3, 0.5, 0.72, 0.96, 1.2]) add(xr, y, 1.1, 0.8);
  // smoke wands just ahead of the wing tips, above and below the main plane: they feed the tip vortex
  const wa = BODY.wingRel([-1.74, 1.21]), wb = BODY.wingRel([-1.74, 1.06]), wz = WING.span / 2 - 0.06;
  add(wa[0], wa[1], wz, 1, 1); add(wb[0], wb[1], wz, 1, 2);
}
function flowParticleSetup() {
  const F = FLOW, L = F.L, NE = F.emitters.length;
  const po = { count: 2, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  F.prt = [new THREE.WebGLRenderTarget(F.NP, NE, po), new THREE.WebGLRenderTarget(F.NP, NE, po)];
  F.pMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tP: { value: null }, tU: { value: null }, tS: { value: L.stat }, uEm: { value: F.emitters.map((e) => new THREE.Vector4(e.x, e.y, e.z, 0)) },
      uHead: { value: 0 }, uX0: { value: F.X0 }, uDX: { value: F.DX }, uU0: { value: F.u0 }, uSteps: { value: 1 }, uReset: { value: 1 },
    },
    vertexShader: LBM_VERT,
    fragmentShader: `precision highp float; precision highp int; precision highp sampler2D;
#define NX ${L.NX}
#define NY ${L.NY}
#define NZ ${L.NZ}
#define TX ${L.TX}
#define NE ${NE}
      uniform sampler2D tP, tU, tS; uniform vec4 uEm[NE]; uniform int uHead; uniform float uX0, uDX, uU0, uSteps, uReset;
      layout(location = 0) out vec4 oP; layout(location = 1) out vec4 oQ;
      ivec2 at(ivec3 c) { return ivec2(c.x + (c.z % TX) * NX, c.y + (c.z / TX) * NY); }
      vec3 uAt(ivec3 c) {
        float m = 1.0;
        if (c.z < 0) { c.z = -1 - c.z; m = -1.0; }
        c = clamp(c, ivec3(0), ivec3(NX - 1, NY - 1, NZ - 1));
        vec3 u = texelFetch(tU, at(c), 0).xyz;
        return vec3(u.xy, u.z * m);
      }
      vec3 vel(vec3 P) {
        vec3 g = vec3((P.x - uX0) / uDX, P.y / uDX, P.z / uDX) - 0.5;
        ivec3 i = ivec3(floor(g)); vec3 t = g - vec3(i);
        vec3 a = mix(mix(uAt(i), uAt(i + ivec3(1, 0, 0)), t.x), mix(uAt(i + ivec3(0, 1, 0)), uAt(i + ivec3(1, 1, 0)), t.x), t.y);
        vec3 b = mix(mix(uAt(i + ivec3(0, 0, 1)), uAt(i + ivec3(1, 0, 1)), t.x), mix(uAt(i + ivec3(0, 1, 1)), uAt(i + ivec3(1, 1, 1)), t.x), t.y);
        return mix(a, b, t.z);
      }
      bool solid(vec3 P) {
        ivec3 c = ivec3(floor(vec3((P.x - uX0) / uDX, P.y / uDX, abs(P.z) / uDX)));
        if (c.x < 0 || c.y < 0 || c.x >= NX || c.y >= NY || c.z >= NZ) return false;
        return texelFetch(tS, at(c), 0).a > 0.5;
      }
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec4 em = uEm[p.y];
        if (p.x == uHead) { oP = vec4(em.xyz, 0.0); oQ = vec4(length(vel(em.xyz)) / max(uU0, 1e-4)); return; }
        vec4 P = texelFetch(tP, p, 0);
        if (uReset > 0.5 || P.w < 0.0) { oP = vec4(em.xyz, -1.0); oQ = vec4(0.0); return; }
        // midpoint step through the field the solver just advanced by uSteps lattice steps
        float h = uSteps * uDX;
        vec3 v1 = vel(P.xyz);
        vec3 v2 = vel(P.xyz + v1 * h * 0.5);
        vec3 np = P.xyz + v2 * h;
        np.z = max(np.z, 0.0);
        bool dead = np.x < uX0 + 0.1 || np.y < 0.004 || np.y > float(NY) * uDX - 0.05 || np.z > float(NZ) * uDX - 0.05 || solid(np);
        oP = vec4(np, dead ? -1.0 : P.w + 1.0);
        oQ = vec4(length(v2) / max(uU0, 1e-4));
      }`,
    depthTest: false, depthWrite: false,
  });
  F.pScene = new THREE.Scene();
  F.pQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), F.pMat);
  F.pQuad.frustumCulled = false;
  F.pScene.add(F.pQuad);
}
function flowParticles(stepsSince) {
  const F = FLOW, U = F.pMat.uniforms;
  // the wands follow the wing
  const dy = state.wing === 'gt' ? lerp(-WING.drop, 0, Math.max(clamp(wingDeploy, 0, 1), DRIVE.airbrake)) : 0;
  F.emitters.forEach((e, i) => { if (e.probe) U.uEm.value[i].y = e.y + dy; });
  F.head = (F.head + 1) % F.NP;
  U.uHead.value = F.head;
  U.tP.value = F.prt[F.pcur].textures[0];
  U.tU.value = F.L.rt[F.L.cur].textures[5];
  U.uSteps.value = stepsSince;
  U.uU0.value = F.u0;
  renderer.setRenderTarget(F.prt[1 - F.pcur]);
  renderer.render(F.pScene, F.L.cam);
  F.pcur = 1 - F.pcur;
  U.uReset.value = 0;
  F.frame++;
}

/* ---------- per frame ---------- */
function flowAdvance(n) {
  const F = FLOW, L = F.L;
  lbmStep(L, n);
  // running mean over ~1200 lattice steps (two shedding periods of the tail wake)
  lbmMacro(L, L.age <= n ? 1 : 1 - Math.exp(-n / Math.min(1200, Math.max(40, L.age))));
}
function updateFlow(dt, snap) {
  const F = FLOW, L = F.L;
  if (!F.ok) return;
  const prev = renderer.getRenderTarget();
  // free stream follows the car (or the tunnel fan), kept well below the lattice speed of sound. Above ~200 km/h
  // the flow pattern no longer changes with speed (it is Reynolds-number independent), and lattice Mach numbers
  // much past 0.13 start a coherent flutter over the roof, so faster air means more steps rather than a faster lattice
  const va = airspeed();
  F.u0 = clamp(0.075 * va / TUNNEL_V, 0.025, 0.075);
  L.uni.uU0.value = F.u0; L.uni.uRoad.value = F.u0;
  flowUpdateMask(false);
  if (snap) {
    // stills: develop the flow, then let the smoke run through the last stretch of it
    if (F.fresh || Math.abs(F.u0 - F.u0Dev) > 0.004) {
      const dev = F.fresh ? (window.__FLOW_DEV || 2400) : 800;
      for (let i = 0; i < dev; i += 100) flowAdvance(Math.min(100, dev - i));
      F.fresh = false; F.u0Dev = F.u0;
      F.pMat.uniforms.uReset.value = 1;
      // enough steps per release for the oldest smoke to have crossed about ten metres
      const m = clamp(Math.round(10 / (F.NP * F.u0 * F.DX)), 4, 16);
      for (let k = 0; k < F.NP; k++) { flowAdvance(m); flowParticles(m); }
    }
  } else {
    // adapt the work to the frame budget
    F.dtAvg += (dt - F.dtAvg) * 0.05;
    if (F.dtAvg > 1 / 42) F.steps = Math.max(3, F.steps - 1); else if (F.dtAvg < 1 / 57) F.steps = Math.min(24, F.steps + 1);
    // beyond the lattice's speed range the visual pace comes from extra steps instead
    const n = Math.max(1, Math.round(F.steps * clamp(0.075 * va / TUNNEL_V / F.u0, 0.4, 1.6)));
    flowAdvance(n);
    flowParticles(n);
    F.fresh = false;
  }
  // the pressure map takes over from the estimate once the mean has settled
  F.cpOn = sstep(300, 1500, L.age);
  renderer.setRenderTarget(prev);
}

/* ---------- streaklines ---------- */
function flowMesh() {
  const F = FLOW;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.instanceCount = F.lines.length * (F.NP - 1);
  const U = { tP: { value: null }, tQ: { value: null }, uLines: { value: F.lines }, uHead: { value: 0 }, uNP: { value: F.NP }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.6 }, uOpacity: { value: 0 }, uFrame: { value: 0 } };
  F.meshU = U;
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform sampler2D tP, tQ; uniform vec4 uLines[${F.lines.length}]; uniform int uHead; uniform int uNP; uniform vec2 uRes; uniform float uWidth;
      varying float vSpeed; varying float vS; varying float vLen; varying float vLum; varying float vSide;
      void main(){
        int line = gl_InstanceID / (uNP - 1), s = gl_InstanceID - line * (uNP - 1);
        vec4 L = uLines[line];
        int e = int(L.x + 0.5);
        int ka = (uHead - s + uNP * 4) % uNP, kb = (ka - 1 + uNP) % uNP;
        vec4 A = texelFetch(tP, ivec2(ka, e), 0), B = texelFetch(tP, ivec2(kb, e), 0);
        vec3 m = vec3(1.0, 1.0, L.y), pa = A.xyz * m, pb = B.xyz * m;
        bool bad = A.w < 0.0 || B.w < 0.0;
        bool first = position.x < 0.5;
        vec3 p = first ? pa : pb, q = first ? pb : pa;
        vec4 cp = projectionMatrix * modelViewMatrix * vec4(p, 1.0), cq = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        vec2 d = (cq.xy / cq.w - cp.xy / cp.w) * uRes * (first ? 1.0 : -1.0);
        float Ld = length(d); d = Ld > 1e-6 ? d / Ld : vec2(1.0, 0.0);
        cp.xy += vec2(-d.y, d.x) * position.y * uWidth / uRes * cp.w;
        gl_Position = bad ? vec4(2.0, 2.0, 2.0, 1.0) : cp;
        vSpeed = texelFetch(tQ, ivec2(first ? ka : kb, e), 0).x; vS = float(s) + position.x; vLen = distance(pa, pb); vLum = L.z; vSide = position.y;
      }`,
    fragmentShader: `uniform float uOpacity; uniform float uFrame; uniform int uNP;
      varying float vSpeed; varying float vS; varying float vLen; varying float vLum; varying float vSide;
      // speed relative to the free stream: slow violet, free stream cyan, fast amber to red
      vec3 ramp(float s) {
        vec3 c = mix(vec3(0.30, 0.18, 1.0), vec3(0.08, 0.42, 1.0), smoothstep(0.4, 0.75, s));
        c = mix(c, vec3(0.16, 0.82, 1.0), smoothstep(0.75, 1.0, s));
        c = mix(c, vec3(0.82, 0.97, 0.95), smoothstep(1.02, 1.16, s));
        c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(1.16, 1.36, s));
        return mix(c, vec3(1.0, 0.22, 0.1), smoothstep(1.36, 1.62, s));
      }
      void main(){
        float n = float(uNP - 1);
        // smoke released in puffs: each puff rides the flow at the local speed
        float ph = mod(uFrame - vS, 26.0);
        float puff = exp(-ph * 0.45);
        float a = smoothstep(0.0, 3.0, vS) * (1.0 - smoothstep(n * 0.6, n, vS));
        a *= 1.0 - smoothstep(0.1, 0.35, vLen);
        a *= (1.0 - smoothstep(0.4, 1.0, abs(vSide))) * vLum;
        gl_FragColor = vec4(ramp(vSpeed) * (0.55 + 1.3 * puff), a * uOpacity * (0.35 + 0.65 * puff));
      }`,
  });
  F.mesh = new THREE.Mesh(g, m);
  F.mesh.frustumCulled = false;
  F.mesh.renderOrder = 4;
  F.mesh.userData.noShadow = true;
  // the tunnel rides with the car through the corners
  carRoot.add(F.mesh);
}
function updateFlowMesh(opacity) {
  const F = FLOW;
  if (!F.mesh) flowMesh();
  const U = F.meshU, [w, h] = size0();
  U.tP.value = F.prt[F.pcur].textures[0]; U.tQ.value = F.prt[F.pcur].textures[1];
  U.uHead.value = F.head; U.uFrame.value = F.frame;
  U.uRes.value.set(w * DPR, h * DPR); U.uWidth.value = 1.5 * DPR;
  U.uOpacity.value = opacity;
  F.mesh.visible = opacity > 0.001;
}

/* ---------- checks (tools/flow_check.js) ---------- */
// drag of a body in the tunnel from the momentum exchange at its surface, averaged over the last half of the run,
// with the car's own solver settings (LES, wall model): a square plate normal to the flow (a tenth as thick as it
// is wide) or a face-on cube, against Cd 1.17 / 1.05 at high Reynolds numbers (Hoerner, Fluid-Dynamic Drag)
async function flowCheckBody({ shape = 'plate', D = 10, u0 = 0.075, steps = 6000, every = 100, type = THREE.HalfFloatType, ly = 6, cf = null, cs2 = null, tau0 = null } = {}) {
  const NX = Math.round(12 * D), NY = Math.round(ly * D), NZ = Math.round(ly / 2 * D);
  const L = lbmCreate({ NX, NY, NZ, DX: 1, X0: 0, type, spO: Math.round(2 * D), spT: Math.round(0.4 * D) });
  const cx = NX - 4 * D, cy = Math.round(NY / 2), R = D / 2;
  const sol = new Uint8Array(NX * NY * NZ);
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const x = i + 0.5 - cx, y = j + 0.5 - cy, z = k + 0.5;
    if (Math.max(Math.abs(y), z) < R && (shape === 'plate' ? x === -0.5 : Math.abs(x) < R)) sol[lbmIdx(L, i, j, k)] = 1;
  }
  lbmLinks(L, sol);
  const U = L.uni;
  U.uU0.value = u0; U.uRoad.value = u0;
  if (cf !== null) U.uCf.value = cf;
  if (cs2 !== null) U.uCs2.value = cs2;
  if (tau0 !== null) U.uTau0.value = tau0;
  lbmReset(L);
  const area = D * D, hist = [];
  for (let s = 0; s < steps; s += every) {
    lbmStep(L, every);
    if (s + every > steps / 2) hist.push(2 * -lbmForce(L, sol)[0] / (0.5 * u0 * u0 * area));
    if (hist.length % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  renderer.setRenderTarget(null);
  lbmDispose(L);
  const ref = shape === 'plate' ? 1.17 : 1.05;
  const cd = hist.reduce((a, b) => a + b, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((a, b) => a + (b - cd) ** 2, 0) / hist.length);
  return { shape, D, cells: NX * NY * NZ, steps, cd: +cd.toFixed(4), sd: +sd.toFixed(4), ref: +ref.toFixed(4), err: +((cd - ref) / ref).toFixed(4) };
}
// force on the solids (half domain): each population that bounced off a wall gave it twice its momentum, less what
// a sliding wall handed back (the same wall velocity the step shader used; tyres are not counted)
function lbmForce(L, sol) {
  const P = [0, 1, 2, 3, 4].map((t) => rtRead(L.rt[L.cur], t, 0, 0, L.W, L.H));
  const { E, W, OPP } = LQ, Fv = [0, 0, 0], S = L.statData, cf = L.uni.uCf.value, f = new Float64Array(19);
  for (let k = 0; k < L.NZ; k++) for (let j = 0; j < L.NY; j++) for (let i = 0; i < L.NX; i++) {
    const o = lbmTexel(L, i, j, k);
    if (S[o + 3]) continue;
    const bits = S[o] | (S[o + 1] << 8) | ((S[o + 2] & 3) << 16);
    if (!bits) continue;
    let rho = 0;
    const m = [0, 0, 0], n = [0, 0, 0];
    for (let d = 0; d < 19; d++) { f[d] = P[d >> 2][o + (d & 3)] + W[d]; rho += f[d]; for (let c = 0; c < 3; c++) m[c] += f[d] * E[d][c]; }
    for (let d = 1; d < 19; d++) if (bits & (1 << (d - 1))) for (let c = 0; c < 3; c++) n[c] -= W[d] * E[d][c];
    const ln = Math.hypot(...n), un = (m[0] * n[0] + m[1] * n[1] + m[2] * n[2]) / (rho * ln * ln);
    const t = [0, 1, 2].map((c) => m[c] / rho - un * n[c]), g = bits & 63 ? Math.max(0, 1 - 1.5 * cf * Math.hypot(...t)) : 0;
    for (let d = 1; d < 19; d++) {
      if (!(bits & (1 << (d - 1)))) continue;
      const q = OPP[d], eu = g * (E[q][0] * t[0] + E[q][1] * t[1] + E[q][2] * t[2]);
      for (let c = 0; c < 3; c++) Fv[c] += E[q][c] * (2 * f[q] - 6 * W[q] * eu);
    }
  }
  return Fv;
}
// the car at the current speed, read from the mean field: stagnation at the nose, speed over the roof and under the
// floor, the two sides of the wing, reverse flow behind the tail (speeds relative to the free stream)
function flowProbe() {
  const F = FLOW, L = F.L;
  const M = rtRead(L.mrt[L.mcur], 0, 0, 0, L.W, L.H), I = rtRead(L.rt[L.cur], 5, 0, 0, L.W, L.H);
  const u0 = F.u0, cp = (w) => 2 * w / (3 * u0 * u0);
  const cell = (x, y, z) => [clamp(Math.floor((x - F.X0) / F.DX), 0, L.NX - 1), clamp(Math.floor(y / F.DX), 0, L.NY - 1), clamp(Math.floor(z / F.DX), 0, L.NZ - 1)];
  const at = (x, y, z) => lbmTexel(L, ...cell(x, y, z));
  const solid = (x, y, z) => L.statData[at(x, y, z) + 3] > 0;
  const sp = (o) => Math.hypot(M[o], M[o + 1], M[o + 2]) / u0;
  let nan = 0, cpMax = -9, cpMin = 9, back = 0, uMax = 0;
  for (let k = 0; k < L.NZ; k++) for (let j = 0; j < L.NY; j++) for (let i = 0; i < L.NX; i++) {
    const o = lbmTexel(L, i, j, k);
    if (!Number.isFinite(I[o]) || !Number.isFinite(I[o + 3]) || !Number.isFinite(M[o + 3])) { nan++; continue; }
    if (M[o + 3] < -1) continue;
    const c = cp(M[o + 3]);
    cpMax = Math.max(cpMax, c); cpMin = Math.min(cpMin, c); uMax = Math.max(uMax, sp(o));
    const x = F.X0 + (i + 0.5) * F.DX;
    if (x < XR && x > XR - 2 && M[o] > 0) back++;   // air moving forward, i.e. recirculating behind the tail
  }
  // stagnation: the last air cell ahead of the nose on the centre line at bumper height
  let xs = XF + 0.4;
  while (xs > 1.5 && !solid(xs - F.DX, 0.3, 0.02)) xs -= F.DX;
  // roof: fastest air within 0.3 m above the top of the canopy on the centre line
  let yr = 0.3;
  while (yr < 2 && solid(0, yr, 0.02)) yr += F.DX;
  let roof = 0;
  for (let y = yr; y < yr + 0.3; y += F.DX) roof = Math.max(roof, sp(at(0, y, 0.02)));
  // wing at mid span: first air cells above and below the main plane at mid chord
  const wing = {};
  if (state.wing === 'gt') {
    // down from above: the wing's upper face, then through it to the air underneath; sample two cells off each face
    let y = 1.75;
    const xw = BODY.wingRel([-2.0, 0])[0];
    while (y > 0.6 && !solid(xw, y, 0.5)) y -= F.DX;
    const top = y;
    while (y > 0.6 && solid(xw, y, 0.5)) y -= F.DX;
    const lo = at(xw, y - F.DX, 0.5), hi = at(xw, top + 2 * F.DX, 0.5);
    // (trimmed flat at V-max the wing sits close to the deck: no air cell under it to read)
    if (M[lo + 3] > -1 && M[hi + 3] > -1) Object.assign(wing, { below: +sp(lo).toFixed(3), above: +sp(hi).toFixed(3), cpBelow: +cp(M[lo + 3]).toFixed(3), cpAbove: +cp(M[hi + 3]).toFixed(3) });
  }
  const r3 = (v) => +v.toFixed(3);
  return {
    u0, age: L.age, nan, cpMax: r3(cpMax), cpMin: r3(cpMin), speedMax: r3(uMax),
    cpNose: r3(cp(M[at(xs, 0.3, 0.02) + 3])), roof: r3(roof), under: r3(sp(at(0, 0.03, 0.02))), wing, wakeReverse: back,
    upstream: r3(sp(at(F.X0 + F.NX * F.DX - 0.5, 1.4, 0.5))),
  };
}
FLOW.checkBody = flowCheckBody;
FLOW.probe = flowProbe;
FLOW.advance = flowAdvance;
