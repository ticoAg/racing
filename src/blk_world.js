/* =========================================================================
   WORLD — the floodlit circuit around the car: the road (it is the
   reflective floor), run-off, kerbs and patches; barriers with catch fences
   and advertising; floodlight masts whose light pools sweep under the car and
   whose nearest lamps light the bodywork; braking boards; gantries; night
   sky and horizon. The studio dissolves into it from under the car and back.
   Everything is laid out in road coordinates (s along, n across) and mapped
   into the car's frame each frame; moving parts are smeared over a 1/90 s
   exposure so speed reads as motion blur.
   ========================================================================= */
const WORLD = {
  mix: 0, target: 0, reveal: -1, thAbs: 0, built: false,
  group: null, walls: [], masts: [], heads: null, halos: null, cones: null, boards: [], gantries: [], sky: null, horizon: null, farGround: null,
  lights: [], U: null,
};
const EXPO = 1 / 90;
// shared uniforms for every world shader
const WU = {
  uTime: { value: 0 }, uReveal: { value: -1 }, uMix: { value: 0 }, uFogCol: { value: new THREE.Color(0x0d1219) }, uFogD: { value: 0.0016 },
  uSOff: { value: 0 }, uV: { value: 0 }, uK: { value: 0 }, uExpo: { value: EXPO }, uBlur: { value: 0 },
  uLampD: { value: TRACK.LAMP_D }, uLampN: { value: TRACK.LAMP_N }, uLampH: { value: TRACK.LAMP_H }, uLampI: { value: 1.45 }, uHeadI: { value: 1.0 },
};
const GLSL_HASH = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y); }
`;
const GLSL_WORLD = GLSL_HASH + `
uniform float uTime, uReveal, uMix, uFogD, uSOff, uV, uK, uExpo, uBlur, uLampD, uLampN, uLampH, uLampI, uHeadI;
uniform vec3 uFogCol;
// the circuit materialises around the car out to uReveal metres
float revealVis(vec3 wp){ float d = length(wp.xz); float e = 3.0 + max(uReveal, 0.0) * 0.25; return uReveal < 0.0 ? 0.0 : 1.0 - smoothstep(uReveal - e, uReveal, d); }
float fogF(vec3 wp){ float x = uFogD * distance(wp, cameraPosition); return 1.0 - exp(-x * x); }
// velocity of a point fixed to the ground, seen from the car (yaw rate = v * k)
vec3 groundVel(vec3 p){ return vec3(-uV + uV * uK * p.z, 0.0, -uV * uK * p.x); }
// floodlight irradiance at road coordinates (s, n), height y, surface normal N (x along, y up, z across); 1.0 right under a lamp
float lampE(float s, float n, float y, vec3 N){
  float E = 0.0, j0 = floor(s / uLampD);
  for (int side = 0; side < 2; side++) {
    float nl = side == 0 ? -uLampN : uLampN;
    vec3 A = normalize(vec3(0.0, -1.0, -sign(nl) * 0.42));
    for (int k = -1; k <= 2; k++) {
      vec3 L = vec3((j0 + float(k)) * uLampD - s, uLampH - y, nl - n);
      float d2 = dot(L, L);
      vec3 Ld = L * inversesqrt(d2);
      float c = max(0.0, dot(-Ld, A));
      E += max(0.0, dot(N, Ld)) * (0.3 + 0.7 * c * c) / d2;
    }
  }
  return E * uLampH * uLampH;
}
`;

/* ---------- road + studio floor (used by the Reflector) ---------- */
const GROWS = (() => {
  const a = [];
  for (let s = -300; s < -60; s += 6) a.push(s);
  for (let s = -60; s < 60; s += 1.5) a.push(s);
  for (let s = 60; s < 300; s += 4) a.push(s);
  for (let s = 300; s <= 1340; s += 12) a.push(s);
  return Float32Array.from(a);
})();
const GCOLS = [-34, -24, -16, -14, -11, -7, -3.5, 0, 3.5, 7, 11, 14, 16, 24, 34];
function buildGroundGeometry() {
  const R = GROWS.length, C = GCOLS.length, N = R * C;
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const road = new THREE.BufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const feat = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos); g.setAttribute('aRoad', road); g.setAttribute('aFeat', feat);
  const idx = [];
  // local XY plane of the Reflector (world z = -local y); winding faces local +z (world up)
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = a + 1, c = a + C, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new V3(), 1e5);
  return g;
}
const FloorShader = {
  name: 'GroundFloor',
  uniforms: Object.assign({
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    tShadow: { value: null }, uShadowScale: { value: new THREE.Vector2(1 / SHW, 1 / SHD) },
    uNear: { value: new THREE.Color(0x2b2d33) }, uFar: { value: new THREE.Color(0x15171b) },
    uReflect: { value: 0.55 }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uBelt: { value: 0 }, uBeltOff: { value: 0 },
    uPatch: { value: Array.from({ length: PATCH_N / 2 }, (_, i) => new THREE.Vector4(PATCHES[i * 4], PATCHES[i * 4 + 1], PATCHES[i * 4 + 2], PATCHES[i * 4 + 3])) },
  }, WU),
  vertexShader: `uniform mat4 textureMatrix; attribute vec2 aRoad; attribute vec4 aFeat;
    varying vec4 vUv; varying vec3 vWorld; varying vec2 vRoad; varying vec4 vFeat;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vRoad = aRoad; vFeat = aFeat;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `uniform vec3 color; uniform sampler2D tDiffuse; uniform sampler2D tShadow; uniform vec2 uShadowScale;
    uniform vec3 uNear; uniform vec3 uFar; uniform float uReflect; uniform vec2 uTexel; uniform float uBelt; uniform float uBeltOff;
    uniform vec4 uPatch[${PATCH_N / 2}];
    varying vec4 vUv; varying vec3 vWorld; varying vec2 vRoad; varying vec4 vFeat;
    ${GLSL_WORLD}
    #include <logdepthbuf_pars_fragment>
    // box-filtered square wave of period 1 and duty d over a window w (anti-aliasing and motion blur in one)
    float sqI(float x, float d){ return floor(x) * d + min(fract(x), d); }
    float sqF(float x, float d, float w){ w = max(w, 1e-4); return (sqI(x + 0.5 * w, d) - sqI(x - 0.5 * w, d)) / w; }
    float bandF(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
    float headE(vec3 wp){
      float E = 0.0;
      for (int i = 0; i < 2; i++) {
        vec3 L = wp - vec3(2.15, 0.46, i == 0 ? -0.66 : 0.66);
        if (L.x < 0.6) continue;
        float d2 = dot(L, L), lat = (L.z - 0.08 * L.x * sign(L.z)) / L.x;
        E += exp(-lat * lat / 0.05) * smoothstep(1.0, 9.0, L.x) * 0.46 / (d2 * sqrt(d2)) * 90.0;
      }
      return E;
    }
    void main(){
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec2 suv = vWorld.xz * uShadowScale + 0.5;
      float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
      float sh = clamp(texture2D(tShadow, suv).a * inside, 0.0, 1.0);
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
      float vis = revealVis(vWorld);
      vec3 col = vec3(0.0);
      // ---------- studio floor ----------
      if (vis < 0.999) {
        vec3 r = textureLod(tDiffuse, uv, 1.0).rgb * 0.24;
        vec2 o = uTexel * 3.5;
        r += textureLod(tDiffuse, uv + vec2( o.x, 0.0), 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2(-o.x, 0.0), 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2(0.0,  o.y), 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2(0.0, -o.y), 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2( o.x,  o.y) * 0.7, 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2(-o.x,  o.y) * 0.7, 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2( o.x, -o.y) * 0.7, 1.6).rgb * 0.095;
        r += textureLod(tDiffuse, uv + vec2(-o.x, -o.y) * 0.7, 1.6).rgb * 0.095;
        float d = length(vWorld.xz * vec2(0.105, 0.15));
        vec3 base = mix(uNear, uFar, smoothstep(0.0, 1.0, d));
        // wind tunnel: a steel rolling road runs under the car at the tunnel speed
        if (uBelt > 0.001) {
          float bx = 1.0 - smoothstep(3.25, 3.3, abs(vWorld.x)), bz = 1.0 - smoothstep(1.12, 1.16, abs(vWorld.z));
          float belt = bx * bz * uBelt;
          float seam = sqF((vWorld.x + uBeltOff) / 4.6, 0.012, fwidth(vWorld.x) / 4.6 + 0.25);
          base = mix(base, vec3(0.05, 0.052, 0.057) + seam * 0.03, belt);
          float edge = (1.0 - smoothstep(0.0, 0.03, abs(abs(vWorld.z) - 1.16))) * bx * uBelt;
          base += vec3(0.05) * edge;
        }
        base *= 1.0 - 0.93 * sh;
        float k = uReflect * mix(0.32, 1.0, fres) * (1.0 - smoothstep(0.45, 1.1, d));
        vec3 sc = base + r * k;
        col = mix(sc, uFar, smoothstep(0.8, 1.6, d));
      }
      // ---------- circuit ----------
      if (vis > 0.001) {
        float s = vRoad.x + uSOff, n = vRoad.y, an = abs(n), side = n < 0.0 ? -1.0 : 1.0;
        float fs = fwidth(s), fn = fwidth(n);
        float ws = fs + uBlur;
        float onRoad = 1.0 - smoothstep(7.0 - fn, 7.0 + fn, an);
        float kerbW = side > 0.0 ? vFeat.y : vFeat.x;
        float kerb = kerbW * (1.0 - onRoad) * (1.0 - smoothstep(8.25 - fn, 8.25 + fn, an));
        float verge = (1.0 - onRoad) * (1.0 - smoothstep(13.95 - fn, 14.0 + fn, an));
        float paint = verge * (1.0 - kerb) * bandF(an, 7.0 + 1.25 * kerbW, 9.6, fn);
        float grass = smoothstep(14.0, 14.3, an);
        // asphalt: aggregate, rubbered racing line, tyre tracks, skid marks, tar seams, patches
        float blurS = 1.0 + uBlur / 0.5;
        float fineAmp = 1.0 - smoothstep(0.08, 0.4, max(fs, fn) + uBlur * 0.6);
        float grain = vnoise(vec2(s / (0.35 * blurS), n / 0.35)) * fineAmp + vnoise(vec2(s / (2.6 + uBlur), n / 2.6)) * 0.8;
        float alb = 0.072 + 0.022 * (grain - 0.9) + 0.012 * (vnoise(vec2(s / 37.0, n / 9.0)) - 0.5);
        float dl = n - vFeat.w;
        float rub = exp(-dl * dl / 2.2) * 0.22 + (exp(-(dl - 0.86) * (dl - 0.86) / 0.06) + exp(-(dl + 0.86) * (dl + 0.86) / 0.06)) * 0.1;
        float skid = vFeat.z * (exp(-(dl - 0.86) * (dl - 0.86) / 0.03) + exp(-(dl + 0.86) * (dl + 0.86) / 0.03)) * (0.55 + 0.45 * vnoise(vec2(s / (3.0 + uBlur), dl * 8.0)));
        alb *= 1.0 - rub - 0.55 * clamp(skid, 0.0, 1.0);
        float tar = (1.0 - smoothstep(0.012, 0.02 + fn, abs(vnoise(vec2(s / (14.0 + uBlur * 6.0), n / 3.0)) - 0.5))) * (1.0 - smoothstep(0.1, 0.5, uBlur)) * 0.5;
        alb *= 1.0 - tar * onRoad;
        float ci = floor(mod(s, ${TRACK.P.toFixed(1)}) / ${PATCH_CELL.toFixed(1)});
        vec4 pv = uPatch[int(ci) / 2];
        vec2 pe = (int(ci) % 2 == 0) ? pv.xy : pv.zw;
        float sl = mod(s, ${PATCH_CELL.toFixed(1)});
        float patchF = pe.x < 0.0 ? 0.0 : bandF(sl, pe.x, pe.y, ws) * onRoad;
        float seamF = pe.x < 0.0 ? 0.0 : (bandF(sl, pe.x - 0.05, pe.x + 0.05, ws) + bandF(sl, pe.y - 0.05, pe.y + 0.05, ws)) * onRoad;
        alb = mix(alb, 0.052 + 0.01 * grain, patchF);
        alb *= 1.0 - 0.5 * seamF;
        vec3 A = vec3(alb) * vec3(0.98, 1.0, 1.04);
        // white edge lines and kerbs
        float line = bandF(an, 6.72, 6.9, fn) * (1.0 - kerbW * 0.0);
        A = mix(A, vec3(0.62), line);
        float stripe = sqF(s / 2.0, 0.5, ws / 2.0);
        vec3 kerbC = mix(vec3(0.55, 0.035, 0.03), vec3(0.62), stripe) * (0.9 + 0.1 * smoothstep(7.0, 7.3, an));
        A = mix(A, kerbC, kerb);
        A = mix(A, vec3(0.03, 0.09, 0.04) * (0.85 + 0.3 * grain), paint);
        A = mix(A, vec3(0.012, 0.03, 0.01) * (0.6 + 0.6 * vnoise(vec2(s / (3.0 + uBlur), n / 3.0))), grass);
        // light: floodlights, headlights, sky
        float E = lampE(s, n, 0.0, vec3(0.0, 1.0, 0.0)) * uLampI + headE(vWorld) * uHeadI + 0.035;
        E *= 1.0 - 0.9 * sh;
        vec3 rc = A * E * vec3(1.0, 0.96, 0.9);
        // damp asphalt: lamps and car smear vertically in the reflection
        vec3 r = vec3(0.0);
        for (int i = -3; i <= 3; i++) r += textureLod(tDiffuse, uv + vec2(0.0, float(i) * uTexel.y * 7.0), 1.4).rgb;
        r /= 7.0;
        float wet = mix(0.16, 0.05, grass) * (1.0 - 0.6 * paint) * (1.0 - 0.5 * kerb);
        rc += r * wet * fres * (1.0 - 0.85 * sh);
        // beyond the strip the far ground takes over
        rc = mix(rc, vec3(0.006, 0.012, 0.005) * (0.04 + lampE(s, n, 0.0, vec3(0.0, 1.0, 0.0)) * 0.6), smoothstep(22.0, 33.0, an));
        rc = mix(rc, uFogCol, fogF(vWorld));
        col = mix(col, rc, vis);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
// rows: centre and normal from the integrated centreline; columns: lateral offsets (pulled in on the inside of tight turns)
function updateGround() {
  const g = floor.geometry, pos = g.attributes.position.array, road = g.attributes.aRoad.array, feat = g.attributes.aFeat.array;
  const T = TRACK, C = GCOLS.length;
  for (let i = 0; i < GROWS.length; i++) {
    const s = T.sc + GROWS[i];
    const p = trackPoint(s, 0) || _tp;
    const x0 = p.x, z0 = p.z, th = p.th, nx = -Math.sin(th), nz = Math.cos(th);
    const k = kAt(s), lim = Math.abs(k) > 1 / 60 ? 0.88 / Math.abs(k) : 1e9;
    const kl = kerbW(s, -1), kr = kerbW(s, 1), sk = skidW(s), nl = racingN(s);
    for (let j = 0; j < C; j++) {
      let n = GCOLS[j];
      if (n * k > 0 && Math.abs(n) > lim) n = Math.sign(n) * lim;
      const v = i * C + j;
      pos[v * 3] = x0 + nx * n; pos[v * 3 + 1] = -(z0 + nz * n); pos[v * 3 + 2] = 0;
      road[v * 2] = GROWS[i]; road[v * 2 + 1] = n;
      feat[v * 4] = kl; feat[v * 4 + 1] = kr; feat[v * 4 + 2] = sk; feat[v * 4 + 3] = nl;
    }
  }
  g.attributes.position.needsUpdate = true; g.attributes.aRoad.needsUpdate = true; g.attributes.aFeat.needsUpdate = true;
}

/* ---------- world materials: dissolve with the reveal, fog, motion smear ---------- */
function worldMat(o) {
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, WU, o.uniforms || {}),
    vertexShader: `${GLSL_WORLD}
      varying vec3 vWP; varying vec3 vN; varying vec2 vUv2; varying float vSmear;
      ${o.vertexPars || ''}
      void main(){
        vec4 wp = modelMatrix * ${o.instanced ? 'instanceMatrix * ' : ''}vec4(position, 1.0);
        vec3 nrm = normalize(mat3(modelMatrix) * ${o.instanced ? 'mat3(instanceMatrix) * ' : ''}normal);
        vSmear = 0.0;
        ${o.smear ? `vec3 ctr = (modelMatrix * ${o.instanced ? 'instanceMatrix * ' : ''}vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 vel = groundVel(ctr);
        // smear over the exposure: the trailing half of the object is drawn where it was when the shutter opened
        if (dot(vel, vel) > 0.01 && dot(wp.xyz - ctr, vel) < 0.0) { wp.xyz -= vel * uExpo; vSmear = 1.0; }` : ''}
        vWP = wp.xyz; vN = nrm; vUv2 = uv;
        ${o.vertexMain || ''}
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `${GLSL_WORLD}
      varying vec3 vWP; varying vec3 vN; varying vec2 vUv2; varying float vSmear;
      ${o.fragmentPars || ''}
      void main(){
        float vis = revealVis(vWP);
        if (vis < 0.002) discard;
        ${o.fragmentMain}
        ${o.additive ? 'outC *= vis; outC = mix(outC, vec3(0.0), fogF(vWP));' : 'if (vis < hash12(gl_FragCoord.xy)) discard; outC = mix(outC, uFogCol, fogF(vWP));'}
        gl_FragColor = vec4(outC, ${o.alpha || '1.0'});
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: o.side || THREE.FrontSide,
    transparent: !!o.additive || !!o.transparent,
    depthWrite: !o.additive,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    alphaToCoverage: !!o.a2c,
  });
  return m;
}

/* ---------- barriers: concrete wall with advertising, catch fence above ---------- */
function adsTexture() {
  return canvasTex(2048, 128, (ctx, w, h) => {
    const P = 512;
    const designs = [
      () => { ctx.fillStyle = '#0b1a3a'; ctx.fillRect(0, 0, P, h); ctx.fillStyle = '#f2f2ee'; setFont(ctx, 800, 78, 'expanded', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('HALCYON', P / 2, h / 2 + 4); },
      () => { for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? '#e8e8e4' : '#c8102e'; ctx.fillRect(i * P / 16, 0, P / 16, h); } },
      () => { ctx.fillStyle = '#121316'; ctx.fillRect(0, 0, P, h); ctx.fillStyle = '#d0102c'; ctx.fillRect(0, h - 22, P, 22); ctx.fillStyle = '#ecebe6'; setFont(ctx, 700, 54, 'expanded'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H9  ·  V12', P / 2, h / 2 - 8); },
      () => { ctx.fillStyle = '#e9e8e2'; ctx.fillRect(0, 0, P, h); ctx.fillStyle = '#0b2f86'; setFont(ctx, 800, 72, 'expanded', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('TRACKFORM', P / 2, h / 2 + 3); },
    ];
    designs.forEach((f, i) => { ctx.save(); ctx.translate(i * P, 0); ctx.beginPath(); ctx.rect(0, 0, P, h); ctx.clip(); f(); ctx.restore(); });
  });
}
const WALL_ROWS = GROWS.filter((s, i) => i % 2 === 0 || Math.abs(s) < 60);
function buildWall(side) {
  const R = WALL_ROWS.length, N = R * 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(N * 2);
  for (let i = 0; i < R; i++) for (let j = 0; j < 3; j++) { uv[(i * 3 + j) * 2] = WALL_ROWS[i]; uv[(i * 3 + j) * 2 + 1] = [0, 1.05, 4.6][j]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
    if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  const m = worldMat({
    uniforms: { tAds: { value: WORLD.ads }, uSide: { value: side } },
    fragmentPars: `uniform sampler2D tAds; uniform float uSide;
      float bandF(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
      float wires(float u, float w){ float f = abs(fract(u) - 0.5); float c = smoothstep(0.465 - w, 0.465 + 0.2 * w, f); return mix(c, 0.035, smoothstep(0.15, 0.5, w)); }`,
    fragmentMain: `
      float s = vUv2.x + uSOff, y = vUv2.y, n = uSide * ${TRACK.WALL.toFixed(2)};
      float fs = fwidth(s), fy = fwidth(y), ws = fs + uBlur;
      vec3 Nr = vec3(0.0, 0.0, -uSide);
      float E = lampE(s, n, clamp(y, 0.0, 4.0), Nr) * uLampI + 0.03;
      vec3 outC;
      float a = 1.0;
      if (y < 1.05) {
        // advertising boards (32 m repeat), smeared along the track at speed
        // anisotropic lookups stretched along the track by the exposure
        vec2 auv = vec2(s / 32.0, clamp(y / 1.05, 0.02, 0.98));
        vec2 gx = vec2(fwidth(auv.x) + uBlur / 32.0 * 0.5, 0.0), gy = vec2(0.0, fwidth(auv.y));
        vec3 ad = vec3(0.0);
        for (int i = -1; i <= 1; i++) ad += textureGrad(tAds, vec2(fract(auv.x + float(i) * uBlur / 96.0), auv.y), gx, gy).rgb;
        ad /= 3.0;
        float cap = bandF(y, 0.98, 1.05, fy);
        vec3 C = mix(ad * 0.85, vec3(0.32), cap);
        outC = C * E;
      } else {
        // catch fence: posts every 4 m, three cables, diamond mesh
        float post = bandF(fract(s / 3.0) * 3.0, 0.0, 0.07, ws) + bandF(fract(s / 3.0) * 3.0, 2.93, 3.0, ws);
        float cable = bandF(y, 1.1, 1.13, fy) + bandF(y, 2.8, 2.82, fy) + bandF(y, 4.52, 4.6, fy);
        float u1 = (s + y) / 0.06, u2 = (s - y) / 0.06;
        float wb = (fs + fy) / 0.06 + uBlur / 0.06;
        float mesh = 1.0 - (1.0 - wires(u1, wb)) * (1.0 - wires(u2, wb));
        a = clamp(max(max(post, cable * 0.8), mesh * 0.7), 0.0, 1.0);
        if (a < 0.02) discard;
        outC = mix(vec3(0.22), vec3(0.07), max(post, cable)) * (E + 0.04);
      }`,
    alpha: 'a',
    a2c: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.userData.side = side;
  return mesh;
}
function updateWall(mesh) {
  const side = mesh.userData.side, pos = mesh.geometry.attributes.position.array, nrm = mesh.geometry.attributes.normal.array;
  const T = TRACK;
  for (let i = 0; i < WALL_ROWS.length; i++) {
    const p = trackPoint(T.sc + WALL_ROWS[i], side * T.WALL) || _tp;
    const nx = Math.sin(p.th) * side, nz = -Math.cos(p.th) * side;
    for (let j = 0; j < 3; j++) {
      const v = i * 3 + j;
      pos[v * 3] = p.x; pos[v * 3 + 1] = [0, 1.05, 4.6][j]; pos[v * 3 + 2] = p.z;
      nrm[v * 3] = nx; nrm[v * 3 + 1] = 0; nrm[v * 3 + 2] = nz;
    }
  }
  mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.normal.needsUpdate = true;
}

/* ---------- floodlight masts ---------- */
const MAST_MAX = 44;
function mastGeometry() {
  // local frame: x along the road, y up, z away from the track; pole at the origin, lamp head toward -z
  const parts = [];
  parts.push(new THREE.CylinderGeometry(0.1, 0.16, TRACK.LAMP_H + 0.3, 10).translate(0, (TRACK.LAMP_H + 0.3) / 2, 0));
  const reach = 15.0 - TRACK.LAMP_N;
  parts.push(new THREE.BoxGeometry(0.12, 0.12, reach + 0.2).translate(0, TRACK.LAMP_H + 0.25, -reach / 2));
  parts.push(new THREE.BoxGeometry(1.5, 0.22, 0.7).translate(0, TRACK.LAMP_H + 0.12, -reach));
  parts.push(new THREE.BoxGeometry(0.5, 0.9, 0.3).translate(0, 1.2, 0.25));
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}
function buildMasts() {
  const mat = worldMat({
    instanced: true, smear: true,
    fragmentMain: `
      vec3 N = normalize(vN);
      float up = max(0.0, N.y), facing = max(0.0, dot(N, normalize(cameraPosition - vWP)));
      vec3 outC = vec3(0.035, 0.037, 0.04) * (0.25 + 0.75 * up) * (0.6 + 0.5 * facing) * (1.0 + 2.0 * smoothstep(${(TRACK.LAMP_H - 1).toFixed(1)}, ${TRACK.LAMP_H.toFixed(1)}, vWP.y));`,
  });
  const headMat = worldMat({
    instanced: true, smear: true, additive: false,
    fragmentMain: `
      // the smeared panel keeps its total light: dimmer as it stretches
      vec3 outC = vec3(1.0, 0.93, 0.82) * 14.0 / (1.0 + uV * uExpo / 1.36);`,
  });
  const g = mastGeometry();
  const head = new THREE.PlaneGeometry(1.36, 0.58).rotateX(Math.PI / 2).translate(0, TRACK.LAMP_H, -(15.0 - TRACK.LAMP_N));
  for (const side of [-1, 1]) {
    const m = new THREE.InstancedMesh(g, mat, MAST_MAX); m.frustumCulled = false; m.count = 0;
    const h = new THREE.InstancedMesh(head, headMat, MAST_MAX); h.frustumCulled = false; h.count = 0;
    m.userData.side = side; h.userData.side = side;
    WORLD.group.add(m, h);
    WORLD.masts.push({ side, mast: m, head: h });
  }
  // halo sprites and faint beams in the night air
  WORLD.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), haloMaterial(), MAST_MAX * 2);
  WORLD.halos.frustumCulled = false; WORLD.halos.count = 0; WORLD.halos.renderOrder = 3;
  WORLD.cones = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 8.5, TRACK.LAMP_H, 24, 1, true).translate(0, -TRACK.LAMP_H / 2, 0), coneMaterial(), MAST_MAX * 2);
  WORLD.cones.frustumCulled = false; WORLD.cones.count = 0; WORLD.cones.renderOrder = 2;
  WORLD.group.add(WORLD.halos, WORLD.cones);
}
function haloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `${GLSL_WORLD}
      varying vec2 vQ; varying float vI; varying vec3 vC;
      void main(){
        vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 c0 = c - groundVel(c) * uExpo;
        vec4 p1 = viewMatrix * vec4(c, 1.0), p0 = viewMatrix * vec4(c0, 1.0);
        vec2 dir = p1.xy - p0.xy; float L = length(dir); dir = L > 1e-4 ? dir / L : vec2(1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        float r = 2.6;
        vec3 mid = (p1.xyz + p0.xyz) * 0.5;
        vec3 vp = mid + vec3(dir * position.x * (0.5 * L + r) + perp * position.y * r, 0.0);
        vQ = vec2(position.x * (0.5 * L + r), position.y * r); vC = vec3(L * 0.5, r, 0.0);
        vI = r / (r + L * 0.5);
        gl_Position = projectionMatrix * vec4(vp, 1.0);
        vec4 wp = vec4(c, 1.0);
        vI *= revealVis(c) * (1.0 - fogF(c));
      }`,
    fragmentShader: `${GLSL_HASH}
      varying vec2 vQ; varying float vI; varying vec3 vC;
      void main(){
        float dx = max(0.0, abs(vQ.x) - vC.x);
        float d = length(vec2(dx, vQ.y)) / vC.y;
        float g = exp(-d * d * 5.0) * 0.32 + exp(-d * d * 40.0) * 1.1;
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.76) * g * vI, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function coneMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `${GLSL_WORLD}
      varying vec3 vWP; varying vec3 vN; varying float vH;
      void main(){
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vH = clamp(-position.y / ${TRACK.LAMP_H.toFixed(1)}, 0.0, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `${GLSL_WORLD}
      varying vec3 vWP; varying vec3 vN; varying float vH;
      void main(){
        vec3 V = normalize(cameraPosition - vWP);
        float f = pow(abs(dot(normalize(vN), V)), 2.0);
        float a = f * (1.0 - vH) * (1.0 - vH) * 0.05 * revealVis(vWP) * (1.0 - fogF(vWP));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.78) * a, 1.0);
      }`,
  });
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new V3(1, 1, 1), _pv = new V3();
function updateMasts() {
  const T = TRACK, D = T.LAMP_D;
  const j0 = Math.ceil((T.sc + GROWS[0]) / D), j1 = Math.floor((T.sc + GROWS[GROWS.length - 1]) / D);
  let hc = 0;
  for (const M of WORLD.masts) {
    let c = 0;
    for (let j = j0; j <= j1 && c < MAST_MAX; j++) {
      const p = trackPoint(j * D, M.side * 15.0);
      if (!p) continue;
      _e.set(0, -p.th + (M.side < 0 ? Math.PI : 0), 0, 'XYZ');
      _m4.compose(_pv.set(p.x, 0, p.z), _q.setFromEuler(_e), _one);
      M.mast.setMatrixAt(c, _m4); M.head.setMatrixAt(c, _m4);
      // halo and beam at the lamp head
      const hp = trackPoint(j * D, M.side * T.LAMP_N);
      if (hp && hc < MAST_MAX * 2) {
        _m4.compose(_pv.set(hp.x, T.LAMP_H - 0.05, hp.z), _q.identity(), _one);
        WORLD.halos.setMatrixAt(hc, _m4);
        _m4.compose(_pv.set(hp.x, T.LAMP_H - 0.1, hp.z), _q.setFromEuler(_e.set(M.side * 0.36, -hp.th, 0, 'YXZ')), _one);
        WORLD.cones.setMatrixAt(hc, _m4);
        hc++;
      }
      c++;
    }
    M.mast.count = c; M.head.count = c;
    M.mast.instanceMatrix.needsUpdate = true; M.head.instanceMatrix.needsUpdate = true;
  }
  WORLD.halos.count = hc; WORLD.cones.count = hc;
  WORLD.halos.instanceMatrix.needsUpdate = true; WORLD.cones.instanceMatrix.needsUpdate = true;
}

/* ---------- the nearest floodlights light the car: two per side, cross-faded as they pass ---------- */
function buildLampLights() {
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffe7cc, 0, 0, 2);
    scene.add(l);
    WORLD.lights.push(l);
  }
}
function updateLampLights() {
  const T = TRACK, D = T.LAMP_D, j = Math.floor(T.sc / D);
  let i = 0;
  for (const side of [-1, 1]) for (const jj of [j, j + 1]) {
    const l = WORLD.lights[i++];
    const p = trackPoint(jj * D, side * T.LAMP_N);
    const ds = jj * D - T.sc;
    const w = 1 - sstep(0, D, Math.abs(ds));
    if (!p) { l.intensity = 0; continue; }
    l.position.set(p.x, T.LAMP_H - 0.3, p.z);
    l.intensity = 1500 * w * WORLD.mix;
  }
}

/* ---------- braking boards and gantries ---------- */
function boardTexture(label) {
  return canvasTex(256, 320, (ctx, w, h) => {
    ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0b2f86'; ctx.fillRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#f2f2ee'; setFont(ctx, 800, 150, 'normal', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 8);
  });
}
function buildBoards() {
  const mk = (label) => {
    const grp = new THREE.Group();
    const tex = boardTexture(label);
    const face = worldMat({
      smear: true, uniforms: { tMap: { value: tex } },
      fragmentPars: 'uniform sampler2D tMap;',
      fragmentMain: `vec3 c = texture2D(tMap, vUv2).rgb;
        float E = 0.55 + 0.6 * max(0.0, dot(normalize(vN), normalize(vec3(-1.0, 0.6, 0.0))));
        vec3 outC = c * E * uLampI * 0.45;`,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.56).rotateY(-Math.PI / 2).translate(0, 1.85, 0), face);
    const legs = worldMat({ smear: true, fragmentMain: 'vec3 outC = vec3(0.05);' });
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.55, -0.45), legs);
    const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.55, 0.45), legs);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.56, 1.25).translate(0.03, 1.85, 0), legs);
    grp.add(panel, l1, l2, back);
    grp.visible = false;
    WORLD.group.add(grp);
    return grp;
  };
  for (const label of ['300', '200', '100']) for (let k = 0; k < 2; k++) WORLD.boards.push({ label, obj: mk(label) });
}
function gantryBanner() {
  return canvasTex(2048, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0c0d10'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d0102c'; ctx.fillRect(0, h - 34, w, 34); ctx.fillRect(0, 0, w, 10);
    ctx.fillStyle = '#f2f2ee'; setFont(ctx, 800, 150, 'expanded', 'italic'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('HALCYON', w / 2, h / 2 - 8);
  });
}
function buildGantries() {
  const banner = gantryBanner();
  for (let k = 0; k < 2; k++) {
    const grp = new THREE.Group();
    const dark = worldMat({ smear: true, fragmentMain: `vec3 N = normalize(vN); vec3 outC = vec3(0.05, 0.052, 0.058) * (0.5 + 0.8 * max(0.0, -N.y)) * (0.4 + uLampI);` });
    const face = worldMat({ smear: true, uniforms: { tMap: { value: banner } }, fragmentPars: 'uniform sampler2D tMap;',
      fragmentMain: 'vec3 outC = texture2D(tMap, vUv2).rgb * 0.9 * (0.3 + 0.6 * uLampI);', side: THREE.DoubleSide });
    const lit = worldMat({ smear: true, fragmentMain: 'vec3 outC = vec3(1.0, 0.95, 0.88) * 9.0;' });
    const span = TRACK.W + 7;
    for (const s of [-1, 1]) {
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.6, 0.7).translate(0, 3.8, s * span / 2), dark));
    }
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, span + 0.7).translate(0, 7.2, 0), dark));
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(span - 1.5, 1.05).rotateY(Math.PI / 2).translate(0.56, 7.2, 0), face));
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(span - 1.5, 1.05).rotateY(-Math.PI / 2).translate(-0.56, 7.2, 0), face));
    for (let i = 0; i < 9; i++) grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.9).translate(0, 6.52, (i - 4) * (TRACK.W / 9)), lit));
    grp.visible = false;
    WORLD.group.add(grp);
    WORLD.gantries.push(grp);
  }
}
function updateDecos() {
  const T = TRACK, lo = T.sc + GROWS[0], hi = T.sc + GROWS[GROWS.length - 1];
  for (const b of WORLD.boards) b.obj.visible = false;
  for (const g of WORLD.gantries) g.visible = false;
  let gi = 0;
  const used = { '300': 0, '200': 0, '100': 0 };
  for (const d of T.decos) {
    if (d.s < lo || d.s > hi) continue;
    if (d.kind === 'board') {
      const pool = WORLD.boards.filter((b) => b.label === d.label);
      const b = pool[used[d.label]++];
      if (!b) continue;
      const p = trackPoint(d.s, d.side * (T.W / 2 + 4.2));
      if (!p) continue;
      b.obj.position.set(p.x, 0, p.z); b.obj.rotation.set(0, -p.th, 0); b.obj.visible = true;
    } else if (d.kind === 'gantry' && gi < WORLD.gantries.length) {
      const p = trackPoint(d.s, 0);
      if (!p) continue;
      const g = WORLD.gantries[gi++];
      g.position.set(p.x, 0, p.z); g.rotation.set(0, -p.th, 0); g.visible = true;
    }
  }
}

/* ---------- night sky, horizon, far ground ---------- */
function buildHorizon() {
  // distant tree line and hills with a few lights, far enough to move only with the heading
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1000, 1000, 120, 256, 1, true).translate(0, 40, 0), new THREE.ShaderMaterial({
    uniforms: WU, side: THREE.BackSide, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_HASH}
      uniform float uMix; uniform vec3 uFogCol; varying vec3 vP;
      void main(){
        float a = atan(vP.z, vP.x);
        float hills = 14.0 + 22.0 * vnoise(vec2(a * 3.0, 1.7)) + 9.0 * vnoise(vec2(a * 11.0, 4.2));
        float trees = 4.0 + 6.0 * vnoise(vec2(a * 180.0, 0.5)) + 3.0 * vnoise(vec2(a * 900.0, 2.5));
        float top = hills * smoothstep(-0.2, 0.6, vnoise(vec2(a * 1.3, 9.1))) + trees;
        float y = vP.y;
        if (y > top) discard;
        vec3 c = mix(vec3(0.004, 0.006, 0.008), uFogCol * 0.55, smoothstep(top - 18.0, top, y) * 0.5);
        // scattered lights and red beacons on far masts
        vec2 cell = vec2(floor(a * 420.0), floor(y / 1.6));
        float h = hash12(cell);
        float lights = step(0.985, h) * step(y, top - 2.0) * smoothstep(0.0, 6.0, y);
        c += vec3(1.0, 0.75, 0.45) * lights * 0.9;
        float beacon = step(0.9965, hash12(vec2(floor(a * 90.0), 7.0))) * (1.0 - smoothstep(0.0, 1.2, abs(y - top + 0.6)));
        c += vec3(1.6, 0.05, 0.03) * beacon;
        gl_FragColor = vec4(c, uMix);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  m.renderOrder = -9;
  return m;
}
function buildFarGround() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1100, 96).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: WU, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `${GLSL_WORLD}
      varying vec3 vW;
      void main(){
        vec3 c = vec3(0.005, 0.01, 0.004) * (0.6 + 0.8 * vnoise(vW.xz / 23.0));
        c = mix(c, uFogCol, fogF(vW));
        gl_FragColor = vec4(c, uMix);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  m.position.y = -0.04;
  m.renderOrder = -8;
  return m;
}

/* ---------- environment map for the circuit (night sky, floodlight rows, lit ground) ---------- */
function buildTrackEnv() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
      vec3 sky = mix(vec3(0.05, 0.065, 0.09), vec3(0.008, 0.011, 0.02), smoothstep(0.0, 0.7, h));
      vec3 gnd = mix(vec3(0.05, 0.048, 0.045), vec3(0.03, 0.03, 0.03), smoothstep(0.0, -0.6, h));
      gl_FragColor = vec4(h > 0.0 ? sky : gnd, 1.0); }`,
  })));
  const panel = (w, h, I, pos, look, color = 0xffe9cf) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(I), side: THREE.DoubleSide }));
    m.position.copy(pos); m.lookAt(look); env.add(m);
  };
  // two rows of floodlights along the track, receding both ways
  for (const z of [-1, 1]) for (let x = -36; x <= 36; x += 6) {
    const d = Math.hypot(x, 12);
    panel(1.4, 0.55, 30 / (1 + 0.012 * d * d), new V3(x, 13, z * 12), new V3(x, 0, 0));
  }
  // the lit asphalt below and the glow over the circuit
  panel(60, 14, 0.18, new V3(0, -0.5, 0), new V3(0, 5, 0), 0xffe2c4);
  panel(30, 6, 0.06, new V3(0, 24, 0), new V3(0, 0, 0), 0x9fb2d6);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 1.2, 96, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7d8aa6).multiplyScalar(0.22), side: THREE.BackSide }));
  ring.position.y = 0.8;
  env.add(ring);
  return env;
}

/* ---------- assembly and per-frame update ---------- */
function buildWorld() {
  WORLD.group = new THREE.Group();
  WORLD.group.userData.noShadow = true;
  scene.add(WORLD.group);
  WORLD.ads = adsTexture();
  WORLD.walls = [buildWall(-1), buildWall(1)];
  WORLD.group.add(...WORLD.walls);
  buildMasts();
  buildBoards();
  buildGantries();
  WORLD.horizon = buildHorizon();
  WORLD.farGround = buildFarGround();
  WORLD.group.add(WORLD.horizon, WORLD.farGround);
  buildLampLights();
  WORLD.built = true;
}
function updateWorld(dt, snap = false) {
  const d = DRIVE;
  // the circuit is out while the car is driving or still running on it; it goes back to the studio once it is parked and off
  WORLD.target = d.prog !== 'park' || d.v > 0.05 || d.engine > 0 || d.start > 0 ? 1 : 0;
  if (snap) WORLD.mix = WORLD.hold !== undefined ? WORLD.hold : WORLD.target;
  else {
    const rate = WORLD.target > WORLD.mix ? 1 / 1.5 : 1 / 1.7;
    WORLD.mix = WORLD.target > WORLD.mix ? Math.min(WORLD.target, WORLD.mix + dt * rate) : Math.max(WORLD.target, WORLD.mix - dt * rate);
  }
  const m = WORLD.mix;
  WU.uMix.value = m;
  // the circuit spreads out from under the car: metres at first, past the horizon at the end
  WU.uReveal.value = m <= 0 ? -1 : m >= 1 ? 1e5 : 2 * Math.pow(900, m);
  WU.uTime.value = clock.elapsedTime;
  envBlend(m);
  backdrop.material.uniforms.uNight.value = m;
  floor.material.uniforms.uReflect.value = 0.55;
  floor.material.uniforms.uBelt.value += ((AERO.on && d.prog === 'park' && d.v < 0.5 ? 1 : 0) * (1 - m) - floor.material.uniforms.uBelt.value) * (snap ? 1 : 1 - Math.exp(-dt * 4));
  floor.material.uniforms.uBeltOff.value = (floor.material.uniforms.uBeltOff.value + airspeed() * dt * 0.08) % 4.6;
  const active = m > 0 || WORLD.lights.some((l) => l.intensity > 0);
  if (!active) {
    WORLD.group.visible = false;
    for (const l of WORLD.lights) l.intensity = 0;
    // the floor still needs a valid ground under the parked car
    const key = d.s.toFixed(2) + '|' + d.n.toFixed(3);
    if (WORLD.groundKey !== key) { WORLD.groundKey = key; trackFrame(d.s, d.n, d.psi); updateGround(); }
    return snap ? false : m !== WORLD.target;
  }
  WORLD.groundKey = '';
  WORLD.group.visible = true;
  WORLD.thAbs += d.v * d.k * dt;
  trackFrame(d.s, d.n, d.psi);
  WU.uSOff.value = pmod(d.s);
  WU.uV.value = d.v; WU.uK.value = d.k; WU.uBlur.value = d.v * EXPO;
  WU.uHeadI.value = state.lights ? 1 : 0;
  updateGround();
  for (const w of WORLD.walls) updateWall(w);
  updateMasts();
  updateDecos();
  updateLampLights();
  const yaw = WORLD.thAbs + d.psi;
  WORLD.horizon.rotation.y = yaw;
  backdrop.rotation.y = yaw;
  return true;
}

/* ---------- blending the two prefiltered environment maps (prefiltering is linear, so the mix is exact) ---------- */
const ENV = { studio: null, track: null, blend: null, scene: null, cam: null, mat: null, last: -1 };
function setupEnvBlend(studio, track) {
  ENV.studio = studio; ENV.track = track;
  const w = studio.width, h = studio.height;
  ENV.blend = new THREE.WebGLRenderTarget(w, h, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false });
  ENV.blend.texture.mapping = THREE.CubeUVReflectionMapping;
  ENV.mat = new THREE.ShaderMaterial({
    uniforms: { tA: { value: studio.texture }, tB: { value: track.texture }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tA; uniform sampler2D tB; uniform float uT; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tA, vUv), texture2D(tB, vUv), uT); }',
    depthTest: false, depthWrite: false,
  });
  ENV.scene = new THREE.Scene();
  ENV.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ENV.mat));
  ENV.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}
function envBlend(t) {
  if (!ENV.blend) return;
  const q = Math.round(t * 60) / 60;
  if (q === ENV.last) return;
  ENV.last = q;
  if (q <= 0) { scene.environment = ENV.studio.texture; return; }
  if (q >= 1) { scene.environment = ENV.track.texture; return; }
  ENV.mat.uniforms.uT.value = q;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(ENV.blend);
  renderer.render(ENV.scene, ENV.cam);
  renderer.setRenderTarget(prev);
  scene.environment = ENV.blend.texture;
}
