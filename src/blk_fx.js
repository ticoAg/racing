/* =========================================================================
   SPEED EFFECTS — afterfire flames from the tailpipes (the same events the
   sound plays), tyre smoke when the rears break traction at launch, vapour
   trails condensing in the wing-tip vortices at high speed and load, specks
   in the floodlit air streaking past, and a cockpit camera that rides the
   body and leans with the g-forces
   ========================================================================= */
const FX = { flames: [], specks: null, smoke: null, vortex: null, built: false };
const PIPES = [[XR - 0.03, 0.43, -0.155], [XR - 0.03, 0.43, 0.155]];

/* ---------- afterfire ---------- */
function flameMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uAge: { value: 1 }, uLen: { value: 0.3 }, uI: { value: 0 }, uSeed: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uLen;
      varying vec2 vQ;
      void main(){
        // quad along the pipe axis (-x), turned about it to face the camera
        vec4 b = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0), t = modelViewMatrix * vec4(-uLen, 0.0, 0.0, 1.0);
        vec2 dir = t.xy - b.xy; float L = length(dir); dir = L > 1e-5 ? dir / L : vec2(1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        float w = 0.05 + 0.08 * uLen;
        vec3 p = mix(b.xyz, t.xyz, position.x) + vec3(perp * position.y * w, 0.0);
        vQ = vec2(position.x, position.y);
        gl_Position = projectionMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float uAge, uI, uSeed;
      varying vec2 vQ;
      float h(float x){ return fract(sin(x * 91.7 + uSeed * 13.1) * 43758.5); }
      void main(){
        float u = vQ.x, v = vQ.y;
        float wob = 0.18 * sin(u * 17.0 + uSeed * 6.0) * u;
        float r = abs(v + wob) / (0.25 + 0.75 * (1.0 - u) * (1.0 - u) + 0.35 * u);
        float body = exp(-r * r * 3.2) * pow(1.0 - u, 0.6) * smoothstep(0.0, 0.08, u + 0.04);
        float core = exp(-r * r * 14.0) * pow(1.0 - u, 2.4);
        vec3 c = vec3(1.0, 0.42, 0.09) * body * 2.2 + vec3(0.55, 0.7, 1.6) * core * 2.6 * smoothstep(0.35, 0.0, u) + vec3(1.0, 0.85, 0.5) * core * 2.0;
        gl_FragColor = vec4(c * uI, 1.0);
      }`,
  });
}
function buildFlames() {
  const g = new THREE.PlaneGeometry(1, 2, 1, 1).translate(0.5, 0, 0);
  for (const p of PIPES) {
    const m = new THREE.Mesh(g, flameMaterial());
    m.position.set(p[0], p[1], p[2]);
    m.frustumCulled = false; m.renderOrder = 6; m.visible = false;
    m.userData = { age: 1, dur: 0.08, len: 0.3, big: false };
    car.add(m);
    FX.flames.push(m);
  }
}
function fireFlames(big, strength = 1) {
  for (const m of FX.flames) {
    const u = m.userData;
    u.age = 0; u.big = big; u.dur = big ? 0.075 + 0.06 * rand() : 0.035 + 0.03 * rand();
    u.len = (big ? 0.42 + 0.3 * rand() : 0.16 + 0.14 * rand()) * strength;
    m.material.uniforms.uSeed.value = rand() * 10;
  }
}
function updateFlames(dt) {
  let glow = 0;
  for (const m of FX.flames) {
    const u = m.userData;
    u.age += dt;
    const f = u.age / u.dur;
    const on = f < 1;
    m.visible = on;
    if (!on) continue;
    const env = Math.sin(Math.PI * Math.min(1, f * 1.25)) ** 0.7;
    m.material.uniforms.uI.value = env * (u.big ? 1.25 : 0.8);
    m.material.uniforms.uLen.value = u.len * (0.55 + 0.45 * Math.min(1, f * 3));
    m.material.uniforms.uAge.value = f;
    glow = Math.max(glow, env * (u.big ? 1 : 0.45));
  }
  return glow > 0;
}

/* ---------- specks in the floodlit air ---------- */
const SPECK_N = 700, SPECK_BOX = [-90, 140, 0.3, 9, -16, 16];
function buildSpecks() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SPECK_N * 2 * 3), lum = new Float32Array(SPECK_N * 2);
  FX.speckP = new Float32Array(SPECK_N * 3);
  for (let i = 0; i < SPECK_N; i++) {
    respawnSpeck(i, lerp(SPECK_BOX[0], SPECK_BOX[1], rand()));
    lum[i * 2] = lum[i * 2 + 1] = 0.25 + 0.75 * rand() * rand();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
  FX.specks = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${GLSL_WORLD}
      attribute float aLum; varying float vL;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float d = distance(wp.xyz, cameraPosition);
        // brighter in the headlight beams, faded out close to the lens and into the haze
        float beam = step(2.4, wp.x) * (1.0 - smoothstep(0.0, 0.3, abs(wp.z) / max(wp.x, 1.0))) * (1.0 - smoothstep(0.6, 1.6, wp.y));
        vL = aLum * (0.045 + 0.4 * beam) * smoothstep(2.0, 9.0, d) * (1.0 - fogF(wp.xyz)) * uMix;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: 'varying float vL; void main(){ gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * vL, 1.0); }',
  }));
  FX.specks.frustumCulled = false;
  FX.specks.userData.noShadow = true;
  scene.add(FX.specks);
}
function respawnSpeck(i, x) {
  const P = FX.speckP;
  P[i * 3] = x; P[i * 3 + 1] = lerp(SPECK_BOX[2], SPECK_BOX[3], Math.pow(rand(), 1.6)); P[i * 3 + 2] = lerp(SPECK_BOX[4], SPECK_BOX[5], rand());
}
function updateSpecks(dt) {
  const vis = WORLD.mix > 0.01;
  FX.specks.visible = vis;
  if (!vis) return;
  const P = FX.speckP, pa = FX.specks.geometry.attributes.position.array, v = DRIVE.v, k = DRIVE.k, T = EXPO;
  for (let i = 0; i < SPECK_N; i++) {
    let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    // fixed to the ground, seen from the turning car, plus a little drift of their own
    const vx = -v + v * k * z, vz = -v * k * x;
    x += vx * dt; z += vz * dt; y += Math.sin(i * 1.7 + x * 0.3) * 0.05 * dt;
    if (x < SPECK_BOX[0] || x > SPECK_BOX[1] + 5 || z < SPECK_BOX[4] - 4 || z > SPECK_BOX[5] + 4) { respawnSpeck(i, x < SPECK_BOX[0] ? SPECK_BOX[1] : SPECK_BOX[0] + rand() * 5); x = P[i * 3]; y = P[i * 3 + 1]; z = P[i * 3 + 2]; }
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    // the streak a 1/90 s exposure would record (a dot when the car stands still)
    const sx = Math.abs(vx) * T < 0.02 ? 0.02 : vx * T;
    pa[i * 6] = x; pa[i * 6 + 1] = y; pa[i * 6 + 2] = z;
    pa[i * 6 + 3] = x - sx; pa[i * 6 + 4] = y; pa[i * 6 + 5] = z - vz * T;
  }
  FX.specks.geometry.attributes.position.needsUpdate = true;
}

/* ---------- tyre smoke ---------- */
const SMOKE_N = 90;
function buildSmoke() {
  const g = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  g.instanceCount = SMOKE_N;
  const a = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const b = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_N * 2), 2).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aP', a); g.setAttribute('aA', b);
  FX.smokeS = { p: new Float32Array(SMOKE_N * 3), v: new Float32Array(SMOKE_N * 3), age: new Float32Array(SMOKE_N).fill(9), life: new Float32Array(SMOKE_N).fill(1), n: 0, acc: 0 };
  FX.smoke = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false,
    vertexShader: `${GLSL_WORLD}
      attribute vec4 aP; attribute vec2 aA; varying vec2 vQ; varying float vA; varying float vE;
      void main(){
        vec4 c = viewMatrix * vec4(aP.xyz, 1.0);
        c.xy += position.xy * aP.w;
        vQ = position.xy * 2.0; vA = aA.x; vE = aA.y;
        gl_Position = projectionMatrix * c;
      }`,
    fragmentShader: `${GLSL_HASH}
      varying vec2 vQ; varying float vA; varying float vE;
      void main(){
        float r = length(vQ);
        float n = vnoise(vQ * 2.2 + vE * 7.0);
        float a = (1.0 - smoothstep(0.35, 1.0, r + 0.25 * n)) * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(0.34, 0.34, 0.36) * (0.7 + 0.3 * n), a);
      }`,
  }));
  FX.smoke.frustumCulled = false;
  FX.smoke.userData.noShadow = true;
  scene.add(FX.smoke);
}
function updateSmoke(dt) {
  const S = FX.smokeS, d = DRIVE;
  const rate = d.v < 18 ? 46 * sstep(0.55, 0.95, d.slip) : 0;
  S.acc += rate * dt;
  carRoot.updateMatrixWorld(true);
  while (S.acc >= 1) {
    S.acc -= 1;
    const i = S.n; S.n = (S.n + 1) % SMOKE_N;
    const side = rand() < 0.5 ? -1 : 1;
    S.p[i * 3] = -1.32 + (rand() - 0.5) * 0.4; S.p[i * 3 + 1] = 0.12; S.p[i * 3 + 2] = side * (0.84 + 0.1 * rand());
    S.v[i * 3] = -d.v * (0.6 + 0.3 * rand()) - 2; S.v[i * 3 + 1] = 0.6 + 0.8 * rand(); S.v[i * 3 + 2] = side * (0.6 + rand());
    S.age[i] = 0; S.life[i] = 1.4 + 1.4 * rand();
  }
  const A = FX.smoke.geometry.attributes.aP.array, B = FX.smoke.geometry.attributes.aA.array;
  let live = 0;
  const drag = 1 - Math.exp(-dt * 1.6);
  for (let i = 0; i < SMOKE_N; i++) {
    S.age[i] += dt;
    const f = S.age[i] / S.life[i];
    if (f >= 1) { A[i * 4 + 3] = 0; B[i * 2] = 0; continue; }
    live++;
    // carried back with the air, spreading and rising as it cools
    S.v[i * 3] += (-d.v - S.v[i * 3]) * drag; S.v[i * 3 + 1] *= 1 - drag * 0.5; S.v[i * 3 + 2] *= 1 - drag;
    for (let k = 0; k < 3; k++) S.p[i * 3 + k] += S.v[i * 3 + k] * dt;
    A[i * 4] = S.p[i * 3]; A[i * 4 + 1] = S.p[i * 3 + 1]; A[i * 4 + 2] = S.p[i * 3 + 2];
    A[i * 4 + 3] = 0.5 + 2.6 * Math.sqrt(f);
    B[i * 2] = 0.42 * Math.sin(Math.PI * Math.min(1, f * 4)) * (1 - f) * (0.4 + 0.6 * WORLD.mix); B[i * 2 + 1] = i * 0.37;
  }
  FX.smoke.visible = live > 0;
  FX.smoke.geometry.attributes.aP.needsUpdate = true; FX.smoke.geometry.attributes.aA.needsUpdate = true;
  return live > 0;
}

/* ---------- vapour in the tip vortices ---------- */
function buildVortexTrails() {
  // one ribbon per tip: the core of the vortex trails back, sinking and drifting inboard as it ages
  const N = 120, tips = [];
  for (const side of [-1, 1]) {
    tips.push({ o: [-2.24, 1.12, side * 0.93], side, kind: 'wing' });
  }
  const pos = [], aux = [], idx = [];
  let v = 0;
  tips.forEach((tp, ti) => {
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      for (const w of [-1, 1]) { pos.push(tp.o[0], tp.o[1], tp.o[2]); aux.push(u, w, ti, tp.side); v++; }
      if (i) { const s = v - 4; idx.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
  g.setIndex(idx);
  FX.vortexU = { uI: { value: 0 }, uIc: { value: 0 }, uLen: { value: 8 }, uFlow: { value: 0 }, uWingY: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
  FX.vortex = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: FX.vortexU, transparent: true, depthWrite: false,
    vertexShader: `uniform float uLen, uWingY, uTime, uFlow; uniform vec2 uRes;
      attribute vec4 aAux; varying vec3 vA; varying float vT;
      vec3 core(vec3 o, float u, float side, float kind){
        float s = u * uLen;
        float sink = kind < 1.5 ? 0.04 : 0.015;
        return o + vec3(-s, -0.035 * s + uWingY, -side * 0.01 * s) + 0.0025 * vec3(0.0, sin(s * 3.1 - uFlow * 0.4), cos(s * 2.7 - uFlow * 0.37)) * s;
      }
      void main(){
        float u = aAux.x, w = aAux.y, kind = mod(aAux.z, 2.0) + 1.0, side = aAux.w;
        vec3 p = core(position, u, side, kind), q = core(position, min(1.0, u + 0.01), side, kind) + vec3(-0.001, 0.0, 0.0);
        vec4 cp = projectionMatrix * modelViewMatrix * vec4(p, 1.0), cq = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        vec2 d = (cq.xy / cq.w - cp.xy / cp.w) * uRes; float L = length(d); d = L > 1e-6 ? d / L : vec2(1.0, 0.0);
        float rad = 0.008 + 0.03 * u;
        vec4 ce = projectionMatrix * modelViewMatrix * vec4(p + vec3(0.0, rad, 0.0), 1.0);
        float px = max(1.2, length((ce.xy / ce.w - cp.xy / cp.w) * uRes));
        cp.xy += vec2(-d.y, d.x) * w * px / uRes * cp.w;
        gl_Position = cp;
        vA = vec3(u, w, smoothstep(1.2, 3.5, length((modelViewMatrix * vec4(p, 1.0)).xyz))); vT = u * uLen;
      }`,
    fragmentShader: `uniform float uI, uIc, uFlow;
      varying vec3 vA; varying float vT;
      float h(float x){ return fract(sin(x) * 43758.5453); }
      float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){
        float u = vA.x, across = 1.0 - vA.y * vA.y;
        // vapour streams back at the flow speed, patchy and fading as the core decays
        float s = vT * 2.2 - uFlow;
        float patchy = 0.35 + 0.65 * n1(s) * n1(s * 0.37 + 4.0);
        float a = across * patchy * smoothstep(0.0, 0.03, u) * pow(1.0 - u, 2.6) * uI * vA.z;
        gl_FragColor = vec4(vec3(0.82, 0.86, 0.92), a * 0.3);
      }`,
    side: THREE.DoubleSide,
  }));
  FX.vortex.frustumCulled = false;
  FX.vortex.renderOrder = 5;
  FX.vortex.userData.noShadow = true;
  car.add(FX.vortex);
}
function updateVortexTrails(dt, t) {
  const d = DRIVE, kmh = Math.max(d.v, airspeed()) * 3.6;
  const A = aeroForces(Math.max(d.v, airspeed()), clamp(wingDeploy, 0, 1), d.airbrake, {});
  // condensation needs a deep pressure drop in the core: high speed and a heavily loaded wing (damp night air)
  const load = clamp(A.r / 9000, 0, 1.4);
  const humid = 0.55 + 0.45 * WORLD.mix;
  const wingI = state.wing === 'gt' ? sstep(170, 300, kmh) * load * humid : 0;
  const U = FX.vortexU;
  U.uI.value += (wingI - U.uI.value) * (1 - Math.exp(-dt * 3));
  U.uFlow.value += Math.max(d.v, airspeed()) * dt * 0.9;
  U.uLen.value = 3 + 4 * sstep(150, 400, kmh);
  U.uWingY.value = BODY.wing ? BODY.wing.position.y : 0;
  const [w, h] = size0();
  U.uRes.value.set(w * DPR, h * DPR);
  FX.vortex.visible = U.uI.value > 0.01;
  return FX.vortex.visible;
}

/* ---------- assembly ---------- */
function buildFX() {
  buildFlames(); buildSpecks(); buildSmoke(); buildVortexTrails();
  FX.built = true;
}
function updateFX(dt, t, snap = false) {
  if (!FX.built) return false;
  const d = DRIVE;
  // events from the drive model: afterfire on overrun, ignition cut on upshifts, blips on downshifts
  if (!snap) for (const e of d.events) {
    if (e.type === 'pop') fireFlames(e.big, e.big ? 1 : 0.8);
    else if (e.type === 'up' && d.rpm > 6500) fireFlames(false, 0.7);
    else if (e.type === 'down') fireFlames(rand() < 0.5, 1);
    else if (e.type === 'catch') fireFlames(true, 0.9);
  }
  let active = updateFlames(snap ? 1 : dt);
  updateSpecks(snap ? 0 : dt);
  active = updateSmoke(snap ? 0 : dt) || active;
  active = updateVortexTrails(snap ? 5 : dt, t) || active;
  return active || WORLD.mix > 0;
}

/* ---------- cockpit camera: rides the body, the head leans with the loads ---------- */
const CAMRIG = { on: false, p: new V3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), off: new V3(), hq: new THREE.Quaternion(), tq: new THREE.Quaternion(), e: new THREE.Euler(), headX: 0, headZ: 0 };
function cameraRigApply() {
  const R = CAMRIG, d = DRIVE;
  R.p.copy(camera.position); R.q.copy(camera.quaternion);
  if (state.view === 'driver' && !camAnim) {
    // head: thrown forward under braking, outward in corners, buzzing with the road
    R.headX += (-d.lonG * 0.012 - R.headX) * 0.25; R.headZ += (-d.latG * 0.014 - R.headZ) * 0.25;
    car.updateMatrixWorld(true);
    R.m.multiplyMatrices(carRoot.matrixWorld, car.matrix);
    R.off.set(R.headX, 0, R.headZ).add(d.shake).multiplyScalar(1);
    camera.position.add(R.off).applyMatrix4(R.m);
    R.hq.setFromRotationMatrix(R.m);
    R.e.set(-d.latG * 0.012, 0, -d.lonG * 0.006);
    camera.quaternion.premultiply(R.hq).multiply(R.tq.setFromEuler(R.e));
  } else camera.position.add(d.shake);
  R.on = true;
}
function cameraRigRestore() {
  if (!CAMRIG.on) return;
  camera.position.copy(CAMRIG.p); camera.quaternion.copy(CAMRIG.q);
  CAMRIG.on = false;
}
