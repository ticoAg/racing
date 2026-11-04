/* =========================================================================
   LIVE AIRFLOW — a lattice-Boltzmann wind tunnel on the GPU. Each
   longitudinal slice of the car is a 2D D2Q9 lattice (3 cm cells) with
   regularised collisions and a Smagorinsky eddy viscosity, a rolling road
   under the car, wheels that drag the air round with them, and the wing,
   spoiler and airbrake masked in as they move. The flow separates, sheds
   and recirculates by itself. Smoke rakes upstream release tracers that are
   carried by the solved velocity field and drawn as streaklines, coloured by
   local speed; the free stream follows the car's speed.
   ========================================================================= */
const FLOW = {
  ok: false, tried: false, NX: 440, NY: 160, NS: 4, DX: 0.03, X0: -8.2,
  rt: null, cur: 0, stepMat: null, initMat: null, pMat: null, quad: null, cam: null, scene: null,
  mask: null, maskData: null, bodyMasks: null, key: '', dep: -1, ab: -1,
  prt: null, pcur: 0, NP: 256, head: 0, frame: 0, emitters: [], lines: [],
  steps: 14, dtAvg: 1 / 60, u0: 0.075, mesh: null, fresh: true,
};
FLOW.NT = FLOW.NS * FLOW.NY;
const FLOW_SLICES = [0, 0.3, 0.6, 0.86];
const GLSL_D2Q9 = `
const ivec2 E[9] = ivec2[9](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(-1, 0), ivec2(0, -1), ivec2(1, 1), ivec2(-1, 1), ivec2(-1, -1), ivec2(1, -1));
const float W[9] = float[9](4.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 9.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0, 1.0 / 36.0);
const int OPP[9] = int[9](0, 3, 4, 1, 2, 7, 8, 5, 6);
`;
function flowSupported() {
  try { return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float'); } catch (e) { return false; }
}

/* ---------- solver ---------- */
function flowInit() {
  FLOW.tried = true;
  if (!flowSupported()) return false;
  const F = FLOW;
  const opts = { count: 3, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  F.rt = [new THREE.WebGLRenderTarget(F.NX, F.NT, opts), new THREE.WebGLRenderTarget(F.NX, F.NT, opts)];
  const popts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  F.maskData = new Uint8Array(F.NX * F.NT * 4);
  F.mask = new THREE.DataTexture(F.maskData, F.NX, F.NT, THREE.RGBAFormat, THREE.UnsignedByteType);
  F.mask.minFilter = F.mask.magFilter = THREE.NearestFilter; F.mask.needsUpdate = true;
  const common = { uMask: { value: F.mask }, uU0: { value: F.u0 }, uNX: { value: F.NX }, uNY: { value: F.NY } };
  const head = `precision highp float; precision highp int; precision highp sampler2D;
    uniform sampler2D tMask; uniform float uU0; uniform int uNX; uniform int uNY;
    layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
    ${GLSL_D2Q9}
    void feq(float rho, vec2 u, out float f[9]){ float uu = dot(u, u); for (int i = 0; i < 9; i++) { float eu = dot(vec2(E[i]), u); f[i] = W[i] * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * uu); } }
    void put(float f[9], vec2 u, float rho){ o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], u, rho); }`;
  const vert = 'in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
  F.initMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { tMask: common.uMask, uU0: common.uU0, uNX: common.uNX, uNY: common.uNY }, vertexShader: vert,
    fragmentShader: `${head}
      void main(){ ivec2 p = ivec2(gl_FragCoord.xy); float f[9];
        vec2 u = texelFetch(tMask, p, 0).r > 0.5 ? vec2(0.0) : vec2(-uU0, 0.0);
        feq(1.0, u, f); put(f, u, 1.0); }`,
    depthTest: false, depthWrite: false,
  });
  F.stepMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tF0: { value: null }, tF1: { value: null }, tF2: { value: null }, tMask: common.uMask, uU0: common.uU0, uNX: common.uNX, uNY: common.uNY, uTau0: { value: 0.5045 }, uCs2: { value: 0.0256 } },
    vertexShader: vert,
    fragmentShader: `${head}
      uniform sampler2D tF0, tF1, tF2; uniform float uTau0, uCs2;
      float comp(ivec2 q, int i){ if (i < 4) return texelFetch(tF0, q, 0)[i]; if (i < 8) return texelFetch(tF1, q, 0)[i - 4]; return texelFetch(tF2, q, 0).x; }
      void main(){
        ivec2 p = ivec2(gl_FragCoord.xy);
        int sl = p.y / uNY, j = p.y - sl * uNY;
        vec2 uIn = vec2(-uU0, 0.0);
        float f[9];
        if (texelFetch(tMask, p, 0).r > 0.5) { feq(1.0, vec2(0.0), f); put(f, vec2(0.0), 1.0); return; }
        // inflow face and the lid hold the free stream
        if (p.x >= uNX - 1 || j >= uNY - 1) { feq(1.0, uIn, f); put(f, uIn, 1.0); return; }
        vec4 a0 = texelFetch(tF0, p, 0), a1 = texelFetch(tF1, p, 0), a2 = texelFetch(tF2, p, 0);
        float own[9] = float[9](a0.x, a0.y, a0.z, a0.w, a1.x, a1.y, a1.z, a1.w, a2.x);
        f[0] = own[0];
        // streaming (pull), with half-way bounce-back off moving and fixed walls
        for (int i = 1; i < 9; i++) {
          ivec2 e = E[i];
          ivec2 q = p - e;
          if (q.x < 0) q.x = 0;
          if (j - e.y < 0) { f[i] = own[OPP[i]] + 6.0 * W[i] * dot(vec2(e), uIn); continue; }   // rolling road
          vec4 mq = texelFetch(tMask, q, 0);
          if (mq.r > 0.5) {
            vec2 uw = mq.a > 0.5 ? (mq.gb * 2.0 - 1.0) * 1.5 * uU0 : vec2(0.0);                     // tyre tread drags the air
            f[i] = own[OPP[i]] + 6.0 * W[i] * dot(vec2(e), uw);
          } else f[i] = comp(q, i);
        }
        float rho = 0.0; vec2 u = vec2(0.0);
        for (int i = 0; i < 9; i++) { rho += f[i]; u += f[i] * vec2(E[i]); }
        u /= rho;
        if (!(rho > 0.3 && rho < 3.0) || dot(u, u) > 0.2) { feq(1.0, uIn, f); put(f, uIn, 1.0); return; }
        // regularised BGK with a Smagorinsky eddy viscosity; a sponge near the outflow and the lid
        float uu = dot(u, u), pxx = 0.0, pxy = 0.0, pyy = 0.0;
        float fe[9];
        for (int i = 0; i < 9; i++) {
          vec2 e = vec2(E[i]); float eu = dot(e, u);
          fe[i] = W[i] * rho * (1.0 + 3.0 * eu + 4.5 * eu * eu - 1.5 * uu);
          float fn = f[i] - fe[i];
          pxx += e.x * e.x * fn; pxy += e.x * e.y * fn; pyy += e.y * e.y * fn;
        }
        float Q = sqrt(2.0 * (pxx * pxx + 2.0 * pxy * pxy + pyy * pyy));
        float t0 = uTau0 + 0.3 * smoothstep(36.0, 0.0, float(p.x)) + 0.12 * smoothstep(float(uNY - 26), float(uNY), float(j));
        float tau = 0.5 * (t0 + sqrt(t0 * t0 + 18.0 * uCs2 * Q / rho));
        float k = 1.0 - 1.0 / tau;
        for (int i = 0; i < 9; i++) {
          vec2 e = vec2(E[i]);
          f[i] = fe[i] + k * 4.5 * W[i] * ((e.x * e.x - 1.0 / 3.0) * pxx + 2.0 * e.x * e.y * pxy + (e.y * e.y - 1.0 / 3.0) * pyy);
        }
        put(f, u, rho);
      }`,
    depthTest: false, depthWrite: false,
  });
  F.scene = new THREE.Scene();
  F.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), F.stepMat);
  F.quad.frustumCulled = false;
  F.scene.add(F.quad);
  F.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // tracers: one row per smoke nozzle, one column per release (a ring buffer)
  F.prt = [new THREE.WebGLRenderTarget(F.NP, 64, popts), new THREE.WebGLRenderTarget(F.NP, 64, popts)];
  buildEmitters();
  F.pMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { tP: { value: null }, tF2: { value: null }, tMask: common.uMask, uU0: common.uU0, uNX: common.uNX, uNY: common.uNY, uEm: { value: F.emitters.map((e) => new THREE.Vector4(e.x, e.y, e.slice, 0)) }, uHead: { value: 0 }, uX0: { value: F.X0 }, uDX: { value: F.DX }, uSteps: { value: 1 }, uReset: { value: 0 } },
    vertexShader: vert,
    fragmentShader: `precision highp float; precision highp int; precision highp sampler2D;
      uniform sampler2D tP, tF2, tMask; uniform float uU0, uX0, uDX, uSteps, uReset; uniform int uNX, uNY, uHead;
      uniform vec4 uEm[${F.emitters.length}];
      layout(location = 0) out vec4 oP;
      vec2 fu(ivec2 c, int sl){ c = clamp(c, ivec2(0), ivec2(uNX - 1, uNY - 1)); return texelFetch(tF2, c + ivec2(0, sl * uNY), 0).yz; }
      vec2 vel(vec2 xy, int sl){
        vec2 g = vec2((xy.x - uX0) / uDX - 0.5, xy.y / uDX - 0.5);
        ivec2 i0 = ivec2(floor(g)); vec2 fr = g - vec2(i0);
        return mix(mix(fu(i0, sl), fu(i0 + ivec2(1, 0), sl), fr.x), mix(fu(i0 + ivec2(0, 1), sl), fu(i0 + ivec2(1, 1), sl), fr.x), fr.y);
      }
      bool solid(vec2 xy, int sl){ ivec2 c = ivec2(floor((xy.x - uX0) / uDX), floor(xy.y / uDX)); c = clamp(c, ivec2(0), ivec2(uNX - 1, uNY - 1)); return texelFetch(tMask, c + ivec2(0, sl * uNY), 0).r > 0.5; }
      void main(){
        ivec2 p = ivec2(gl_FragCoord.xy);
        if (p.y >= ${F.emitters.length}) { oP = vec4(0.0, 0.0, 0.0, -1.0); return; }
        vec4 em = uEm[p.y];
        if (p.x == uHead) { oP = vec4(em.xy, 1.0, 0.0); return; }
        vec4 P = texelFetch(tP, p, 0);
        if (uReset > 0.5 || P.w < 0.0) { oP = vec4(em.xy, 1.0, -1.0); return; }
        int sl = int(em.z + 0.5);
        float h = uSteps * uDX;
        vec2 v1 = vel(P.xy, sl);
        vec2 v2 = vel(P.xy + v1 * h * 0.5, sl);
        vec2 np = P.xy + v2 * h;
        float dead = (np.x < uX0 + 0.15 || np.y < 0.005 || np.y > float(uNY) * uDX - 0.1 || solid(np, sl)) ? -1.0 : P.w + 1.0;
        oP = vec4(np, length(v2) / max(uU0, 1e-4), dead);
      }`,
    depthTest: false, depthWrite: false,
  });
  F.ok = true;
  return true;
}
function buildEmitters() {
  const F = FLOW;
  F.emitters = []; F.lines = [];
  FLOW_SLICES.forEach((z, sl) => {
    const wheels = z > 0.62 && z < 1.02;
    const levels = wheels ? [0.1, 0.2, 0.32, 0.46, 0.62, 0.82, 1.08, 1.4] : [0.04, 0.085, 0.16, 0.25, 0.36, 0.5, 0.68, 0.9, 1.18, 1.5];
    for (const y of levels) {
      const e = F.emitters.length;
      F.emitters.push({ x: 3.7, y, slice: sl });
      for (const zz of z === 0 ? [0] : [-z, z]) F.lines.push(new THREE.Vector4(e, zz, y > 1.3 ? 0.55 : 1, 0));
    }
  });
}

/* ---------- solids: body slice profiles, wheels, wing elements ---------- */
function flowBodyMasks() {
  const F = FLOW, xs = new Float64Array(F.NX);
  for (let i = 0; i < F.NX; i++) xs[i] = F.X0 + (i + 0.5) * F.DX;
  F.bodyMasks = FLOW_SLICES.map((zq) => {
    const m = new Uint8Array(F.NX * F.NY * 4);
    const prof = sliceProfile(zq, xs);
    const wheels = zq > 0.62 && zq < 1.02;
    for (let i = 0; i < F.NX; i++) {
      const x = xs[i];
      let top = prof.T[i], bot = prof.B[i];
      if (x > 1.84 && x < XF + 0.055 && zq < lipZ(Math.min(x, XF - 0.001)) + 0.028) { bot = 0.068; if (top < 0) top = 0.08; }
      for (let j = 0; j < F.NY; j++) {
        const y = (j + 0.5) * F.DX, k = (j * F.NX + i) * 4;
        if (top > 0 && y >= bot - 0.5 * F.DX && y <= top + 0.25 * F.DX) { m[k] = 255; continue; }
        if (wheels) for (const w of AX) {
          const rx = x - w.x, ry = y - w.yc;
          if (rx * rx + ry * ry <= w.R * w.R) {
            // tread speed relative to the free stream: forward at the top, matching the road at the bottom
            m[k] = 255; m[k + 1] = Math.round((clamp(ry / w.R / 1.5, -1, 1) * 0.5 + 0.5) * 255); m[k + 2] = Math.round((clamp(-rx / w.R / 1.5, -1, 1) * 0.5 + 0.5) * 255); m[k + 3] = 255;
            break;
          }
        }
      }
    }
    return m;
  });
}
function flowMasks(dep, ab) {
  const F = FLOW;
  if (!F.bodyMasks) flowBodyMasks();
  const out = F.maskData, rowB = F.NX * F.NY * 4;
  FLOW_SLICES.forEach((zq, sl) => {
    out.set(F.bodyMasks[sl], sl * rowB);
    for (const poly of wingShapes(zq, ab, dep, true)) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const i0 = Math.max(0, Math.floor((x0 - F.X0) / F.DX) - 1), i1 = Math.min(F.NX - 1, Math.ceil((x1 - F.X0) / F.DX) + 1);
      const j0 = Math.max(0, Math.floor(y0 / F.DX) - 1), j1 = Math.min(F.NY - 1, Math.ceil(y1 / F.DX) + 1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = F.X0 + (i + 0.5) * F.DX, y = (j + 0.5) * F.DX;
        if (polyInside(poly, x, y) || polyDist(poly, x, y) < F.DX * 0.55) out[sl * rowB + (j * F.NX + i) * 4] = 255;
      }
    }
  });
  F.mask.needsUpdate = true;
}

/* ---------- per frame ---------- */
function flowReset() {
  const F = FLOW;
  F.dep = -1; F.ab = -1; F.key = '';
  flowUpdateMask(true);
  F.quad.material = F.initMat;
  for (const rt of F.rt) { renderer.setRenderTarget(rt); renderer.render(F.scene, F.cam); }
  renderer.setRenderTarget(null);
  F.cur = 0; F.fresh = true;
  F.pMat.uniforms.uReset.value = 1;
}
// a few steps, then one free-stream cell must hold the equilibrium of the inflow: rest population ~4/9,
// and the backward-moving population exceeding the forward one by ~2/3 u0 (otherwise fall back)
function flowSelfTest() {
  const F = FLOW, buf = new Float32Array(4);
  try {
    flowStep(6);
    renderer.readRenderTargetPixels(F.rt[F.cur], F.NX - 30, Math.floor(F.NY * 0.7), 1, 1, buf);
  } catch (e) { return false; }
  finally { renderer.setRenderTarget(null); }
  const d = buf[3] - buf[1];
  return Number.isFinite(buf[0]) && buf[0] > 0.3 && buf[0] < 0.6 && d > 0.3 * F.u0 && d < 1.2 * F.u0;
}
function flowUpdateMask(force) {
  const F = FLOW, dep = clamp(wingDeploy, 0, 1), ab = DRIVE.airbrake, key = state.wing + '|' + state.kit;
  if (force || key !== F.key || Math.abs(dep - F.dep) > 0.03 || Math.abs(ab - F.ab) > 0.03) {
    F.key = key; F.dep = dep; F.ab = ab;
    flowMasks(dep, ab);
  }
}
function flowStep(n) {
  const F = FLOW, S = F.stepMat.uniforms;
  F.quad.material = F.stepMat;
  for (let i = 0; i < n; i++) {
    const src = F.rt[F.cur], dst = F.rt[1 - F.cur];
    S.tF0.value = src.textures[0]; S.tF1.value = src.textures[1]; S.tF2.value = src.textures[2];
    renderer.setRenderTarget(dst);
    renderer.render(F.scene, F.cam);
    F.cur = 1 - F.cur;
  }
}
function flowParticles(stepsSince) {
  const F = FLOW, U = F.pMat.uniforms;
  F.head = (F.head + 1) % F.NP;
  U.uHead.value = F.head;
  U.tP.value = F.prt[F.pcur].texture;
  U.tF2.value = F.rt[F.cur].textures[2];
  U.uSteps.value = stepsSince;
  F.quad.material = F.pMat;
  renderer.setRenderTarget(F.prt[1 - F.pcur]);
  renderer.render(F.scene, F.cam);
  F.pcur = 1 - F.pcur;
  U.uReset.value = 0;
  F.frame++;
}
function updateFlow(dt, snap) {
  const F = FLOW;
  if (!F.ok) return;
  const prev = renderer.getRenderTarget();
  // free stream follows the car (or the tunnel fan), kept well below the lattice speed of sound
  const va = airspeed();
  F.u0 = clamp(0.075 * va / TUNNEL_V, 0.025, 0.1);
  F.stepMat.uniforms.uU0.value = F.u0;
  flowUpdateMask(false);
  if (snap) {
    // stills: develop the flow, then let the smoke run through it
    // stills: develop the flow, then trace the frozen field (instantaneous streamlines)
    if (F.fresh) { flowStep(window.__TEST__ ? 700 : 1600); F.fresh = false; F.u0Dev = F.u0; }
    else if (Math.abs(F.u0 - F.u0Dev) > 0.004) { flowStep(window.__TEST__ ? 300 : 800); F.u0Dev = F.u0; }
    for (let k = 0; k < F.NP; k++) flowParticles(16);
  } else {
    // adapt the work to the frame budget
    F.dtAvg += (dt - F.dtAvg) * 0.05;
    if (F.dtAvg > 1 / 42) F.steps = Math.max(6, F.steps - 1); else if (F.dtAvg < 1 / 57) F.steps = Math.min(30, F.steps + 1);
    // beyond the lattice's speed range the visual pace comes from extra steps instead
    const n = Math.max(1, Math.round(F.steps * clamp(0.075 * va / TUNNEL_V / F.u0, 0.4, 1.6)));
    flowStep(n);
    flowParticles(n);
    F.fresh = false;
  }
  renderer.setRenderTarget(prev);
}

/* ---------- streaklines ---------- */
function flowMesh() {
  const F = FLOW;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.instanceCount = F.lines.length * (F.NP - 1);
  const U = { tP: { value: null }, uLines: { value: F.lines }, uHead: { value: 0 }, uNP: { value: F.NP }, uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.6 }, uOpacity: { value: 0 }, uFrame: { value: 0 } };
  F.meshU = U;
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform sampler2D tP; uniform vec4 uLines[${F.lines.length}]; uniform int uHead; uniform int uNP; uniform vec2 uRes; uniform float uWidth;
      varying float vSpeed; varying float vS; varying float vLen; varying float vLum; varying float vSide;
      void main(){
        int line = gl_InstanceID / (uNP - 1), s = gl_InstanceID - line * (uNP - 1);
        vec4 L = uLines[line];
        int e = int(L.x + 0.5);
        int ka = (uHead - s + uNP * 4) % uNP, kb = (ka - 1 + uNP) % uNP;
        vec4 A = texelFetch(tP, ivec2(ka, e), 0), B = texelFetch(tP, ivec2(kb, e), 0);
        vec3 pa = vec3(A.xy, L.y), pb = vec3(B.xy, L.y);
        bool bad = A.w < 0.0 || B.w < 0.0;
        vec3 p = position.x < 0.5 ? pa : pb, q = position.x < 0.5 ? pb : pa;
        vec4 cp = projectionMatrix * modelViewMatrix * vec4(p, 1.0), cq = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        vec2 d = (cq.xy / cq.w - cp.xy / cp.w) * uRes * (position.x < 0.5 ? 1.0 : -1.0);
        float Ld = length(d); d = Ld > 1e-6 ? d / Ld : vec2(1.0, 0.0);
        cp.xy += vec2(-d.y, d.x) * position.y * uWidth / uRes * cp.w;
        gl_Position = bad ? vec4(2.0, 2.0, 2.0, 1.0) : cp;
        vSpeed = position.x < 0.5 ? A.z : B.z; vS = float(s) + position.x; vLen = distance(pa, pb); vLum = L.z; vSide = position.y;
      }`,
    fragmentShader: `uniform float uOpacity; uniform float uFrame; uniform int uNP;
      varying float vSpeed; varying float vS; varying float vLen; varying float vLum; varying float vSide;
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
        float a = smoothstep(0.0, 3.0, vS) * (1.0 - smoothstep(n * 0.55, n, vS));
        a *= 1.0 - smoothstep(0.08, 0.32, vLen);
        a *= (1.0 - smoothstep(0.4, 1.0, abs(vSide))) * vLum;
        gl_FragColor = vec4(ramp(vSpeed) * (0.55 + 1.3 * puff), a * uOpacity * (0.35 + 0.65 * puff));
      }`,
  });
  F.mesh = new THREE.Mesh(g, m);
  F.mesh.frustumCulled = false;
  F.mesh.renderOrder = 4;
  F.mesh.userData.noShadow = true;
  scene.add(F.mesh);
}
function updateFlowMesh(opacity) {
  const F = FLOW;
  if (!F.mesh) flowMesh();
  const U = F.meshU, [w, h] = size0();
  U.tP.value = F.prt[F.pcur].texture;
  U.uHead.value = F.head; U.uFrame.value = F.frame;
  U.uRes.value.set(w * DPR, h * DPR); U.uWidth.value = 1.5 * DPR;
  U.uOpacity.value = opacity;
  F.mesh.visible = opacity > 0.001;
}
