/* =========================================================================
   LAND — the open country drawn round the car: terrain in chunks at three
   levels of detail (heights read from a texture, so every level and the
   vehicle model agree), the road as its own mesh with its markings, kerbs
   and verges, a lake, the sky with sun, clouds and far mountains, and the
   light all of it stands in: a low sun, sky light, the shade of trees, cloud
   shadows drifting over, the car's own shadow. Like the circuit, the land is
   drawn in the car's frame: the car stays at the origin, the group that
   holds the land is moved and turned under it.
   ========================================================================= */
const LAND = {
  built: false, building: null, group: null, tod: 'dusk',
  terrain: [], road: null, sky: null, water: null, sun: null, env: null, envScene: null,
  shadeCPU: null, carSh: null, shCam: null, shMat: null, hide: [],
  chunks: [], lastLod: [1e9, 1e9], trees: [], props: {},
};
// times of day: where the sun stands (elevation, azimuth clockwise from east, in degrees) and what it lights with
const LAND_TOD = {
  dusk: { name: '黄昏', el: 19, az: 205, sun: [4.4, 3.1, 1.8], sky: [0.2, 0.27, 0.42], gnd: [0.1, 0.085, 0.06], zen: [0.07, 0.15, 0.38], hor: [0.44, 0.36, 0.33], glow: [1.25, 0.55, 0.2], fog: [0.36, 0.34, 0.37], fogSun: [0.95, 0.56, 0.3], fogD: 0.00027, cloud: [1.0, 0.72, 0.52], cloudDark: [0.2, 0.2, 0.3], cover: 0.5, head: 0.06 },
  day: { name: '白天', el: 48, az: 150, sun: [3.3, 3.1, 2.8], sky: [0.24, 0.34, 0.54], gnd: [0.12, 0.11, 0.09], zen: [0.05, 0.16, 0.46], hor: [0.36, 0.5, 0.68], glow: [0.45, 0.42, 0.36], fog: [0.36, 0.47, 0.62], fogSun: [0.62, 0.64, 0.64], fogD: 0.00021, cloud: [0.92, 0.92, 0.92], cloudDark: [0.36, 0.4, 0.5], cover: 0.42, head: 0 },
  night: { name: '夜晚', el: 34, az: 240, sun: [0.1, 0.13, 0.2], sky: [0.012, 0.017, 0.03], gnd: [0.004, 0.004, 0.005], zen: [0.004, 0.007, 0.018], hor: [0.02, 0.028, 0.045], glow: [0.05, 0.06, 0.09], fog: [0.012, 0.017, 0.028], fogSun: [0.03, 0.04, 0.06], fogD: 0.0005, cloud: [0.06, 0.07, 0.1], cloudDark: [0.008, 0.01, 0.016], cover: 0.4, head: 1 },
};
// shared by every shader of the land (with the world uniforms WU)
const LU = {
  uSunDir: { value: new V3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSkyCol: { value: new THREE.Color() }, uGndCol: { value: new THREE.Color() },
  uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uLFog: { value: new THREE.Color() }, uLFogSun: { value: new THREE.Color() },
  uCloud: { value: new THREE.Color() }, uCloudDark: { value: new THREE.Color() }, uCover: { value: 0.5 }, uLFogD: { value: 0.0004 }, uNightK: { value: 0 },
  uToLand: { value: new THREE.Matrix3() }, uCarPos: { value: new V3() }, uLTime: { value: 0 },
  tH: { value: null }, tNrm: { value: null }, tBio: { value: null }, tShade: { value: null }, tCarSh: { value: null }, tContact: { value: null },
  uShMat: { value: new THREE.Matrix4() }, uContactScale: { value: new THREE.Vector2(1 / SHW, 1 / SHD) }, uLapL: { value: 1 },
};
const GLSL_LAND = GLSL_WORLD + `
uniform vec3 uSunDir, uSunCol, uSkyCol, uGndCol, uZen, uHor, uGlow, uLFog, uLFogSun, uCloud, uCloudDark, uCarPos;
uniform float uCover, uLFogD, uNightK, uLTime, uLapL;
uniform mat3 uToLand;
uniform mat4 uShMat;
uniform vec2 uContactScale;
uniform sampler2D tNrm, tBio, tShade, tCarSh, tContact;
const float L_SIZE = ${LG.SIZE.toFixed(1)}, L_HALF = ${LG.HALF.toFixed(1)}, L_WATER = ${LG.WATER.toFixed(1)};
float fbm3(vec2 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 11.7) + 0.125 * vnoise(p * 4.01 + 5.3) + 0.0625 * vnoise(p * 8.1 + 1.9); }
// sky in a direction of the land's frame: gradient, the glow round the sun, clouds on a high layer
vec3 skyBase(vec3 d){
  float h = max(d.y, 0.0), sd = max(dot(d, uSunDir), 0.0);
  vec3 c = mix(uHor, uZen, pow(h, 0.5));
  c += uGlow * (pow(sd, 5.0) * 0.4 + pow(sd, 40.0) * 0.9) * (1.0 - 0.5 * h);
  return c;
}
float cloudCover(vec3 d, float t){
  vec2 p = d.xz / (d.y + 0.11) * 1.5 + vec2(t * 0.004, t * 0.0016);
  float n = fbm3(p) + 0.35 * vnoise(p * 0.31 + 3.1);
  return smoothstep(1.0 - uCover * 0.95, 1.38 - uCover * 0.7, n) * smoothstep(0.0, 0.1, d.y);
}
vec3 skyCol(vec3 d, float t){
  vec3 c = skyBase(d);
  float cv = cloudCover(d, t), sd = max(dot(d, uSunDir), 0.0);
  vec3 cl = mix(uCloudDark, uCloud, 0.35 + 0.65 * smoothstep(0.2, 1.0, 1.0 - cv * 0.8)) + uGlow * pow(sd, 6.0) * 0.5;
  c = mix(c, cl, cv * 0.92);
  return mix(uLFog, c, smoothstep(-0.02, 0.1, d.y));
}
// shade of clouds drifting over the ground, of trees and buildings (baked), of the car (its silhouette from the sun)
float cloudShade(vec2 xz){ return 1.0 - 0.5 * smoothstep(0.52, 0.8, fbm3(xz / 620.0 + vec2(uLTime * 0.006, uLTime * 0.0024))) * uCover * 1.4; }
float carShade(vec3 wp){
  vec4 q = uShMat * vec4(wp, 1.0);
  vec2 uv = q.xy * 0.5 + 0.5;
  if (uv.x < 0.01 || uv.x > 0.99 || uv.y < 0.01 || uv.y > 0.99) return 1.0;
  float z = q.z * 0.5 + 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 || i == 3 ? -1.0 : 1.0, i < 2 ? -1.0 : 1.0) * 0.0021;
    // (coverage is smoothed by the filter; the depth under it is the stored one over the coverage)
    vec4 t = texture2D(tCarSh, uv + o);
    s += smoothstep(0.25, 0.75, t.a) * step(t.r / max(t.a, 0.05) + 0.012, z);
  }
  return 1.0 - 0.25 * s;
}
float contactAO(vec3 wp){
  vec2 suv = wp.xz * uContactScale + 0.5;
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 || wp.y > 0.4) return 0.0;
  return clamp(texture2D(tContact, suv).a, 0.0, 1.0);
}
float headBeam(vec3 wp){
  float E = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 L = wp - vec3(2.15, 0.46, i == 0 ? -0.66 : 0.66);
    if (L.x < 0.6) continue;
    float d2 = dot(L, L), lat = (L.z - 0.08 * L.x * sign(L.z)) / L.x;
    // (out here they are the only light at night: they fall off with the square of the distance and reach far)
    E += exp(-lat * lat / 0.07) * smoothstep(1.0, 7.0, L.x) * 62.0 / d2;
  }
  return E;
}
// light on a surface: albedo, normal and position in the land's frame, position in the car's frame
vec3 landLit(vec3 alb, vec3 N, vec3 lp, vec3 wp, float shadeK){
  float sh = (1.0 - shadeK * texture2D(tShade, lp.xz / L_SIZE + 0.5).r) * cloudShade(lp.xz) * carShade(wp);
  vec3 amb = mix(uGndCol, uSkyCol, 0.5 + 0.5 * N.y) * (1.0 - 0.8 * contactAO(wp));
  return alb * (uSunCol * max(dot(N, uSunDir), 0.0) * sh + amb + vec3(1.0, 0.95, 0.85) * headBeam(wp) * uHeadI * max(N.y, 0.3));
}
vec3 landFog(vec3 c, vec3 wp){
  vec3 v = wp - cameraPosition; float d = length(v);
  float f = 1.0 - exp(-pow(uLFogD * d, 1.25) * 2.2);
  float sd = max(dot(uToLand * (v / max(d, 1e-3)), uSunDir), 0.0);
  return mix(c, mix(uLFog, uLFogSun, pow(sd, 4.0)), f);
}
// grass as it is coloured everywhere (the land and the road's verges must match)
vec3 grassCol(vec2 xz, float fine){
  float n2 = vnoise(xz / 17.0), n3 = vnoise(xz / 140.0 + 7.3), n1 = vnoise(xz / 2.3);
  vec3 g = mix(vec3(0.07, 0.115, 0.032), vec3(0.15, 0.155, 0.055), smoothstep(0.25, 0.8, n3));
  return g * (0.78 + 0.44 * n2) * (1.0 + (n1 - 0.5) * 0.5 * fine);
}
`;
// a material of the land: lit as above, dissolving in with the reveal, fogged
function landMat(o) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, WU, LU, o.uniforms || {}),
    vertexShader: `${GLSL_LAND}
      varying vec3 vWP; varying vec3 vLP; varying vec3 vN; varying vec2 vUv2; varying vec3 vCol;
      ${o.vertexPars || ''}
      void main(){
        vec3 lp = position; vec3 ln = normal; vCol = vec3(1.0); vUv2 = uv;
        ${o.instanced ? 'lp = (instanceMatrix * vec4(position, 1.0)).xyz; ln = normalize(mat3(instanceMatrix) * normal);' : ''}
        ${o.vertexMain || ''}
        vLP = lp; vN = ln;
        vec4 wp = modelMatrix * vec4(lp, 1.0);
        vWP = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `${GLSL_LAND}
      varying vec3 vWP; varying vec3 vLP; varying vec3 vN; varying vec2 vUv2; varying vec3 vCol;
      ${o.fragmentPars || ''}
      void main(){
        float vis = revealVis(vWP);
        if (vis < 0.002 || vis < hash12(gl_FragCoord.xy)) discard;
        float alpha = 1.0;
        vec3 outC;
        ${o.fragmentMain}
        ${o.noFog ? '' : 'outC = landFog(outC, vWP);'}
        gl_FragColor = vec4(outC, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: o.side || THREE.FrontSide, transparent: !!o.transparent, depthWrite: o.depthWrite !== false, alphaToCoverage: !!o.a2c,
    polygonOffset: !!o.offset, polygonOffsetFactor: o.offset ? -1 : 0, polygonOffsetUnits: o.offset || 0,
  });
}

/* ---------- data textures ---------- */
function landTextures() {
  const N = LG.N, H = LG.H;
  const tH = new THREE.DataTexture(H, N, N, THREE.RedFormat, THREE.FloatType);
  tH.minFilter = tH.magFilter = THREE.NearestFilter; tH.needsUpdate = true;
  // normals (and the height above the lake, for the shore) at the height grid's own samples
  const nrm = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const q = j * N + i, i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const hx = (H[j * N + i1] - H[j * N + i0]) / ((i1 - i0) * LG.CELL), hz = (H[j1 * N + i] - H[j0 * N + i]) / ((j1 - j0) * LG.CELL), l = 1 / Math.hypot(hx, 1, hz);
    nrm[q * 4] = Math.round((-hx * l * 0.5 + 0.5) * 255); nrm[q * 4 + 1] = Math.round((-hz * l * 0.5 + 0.5) * 255);
    nrm[q * 4 + 2] = Math.round(clamp((H[q] - LG.WATER + 6) / 12, 0, 1) * 255); nrm[q * 4 + 3] = 255;
  }
  const tN = new THREE.DataTexture(nrm, N, N, THREE.RGBAFormat);
  tN.minFilter = tN.magFilter = THREE.LinearFilter; tN.needsUpdate = true;
  const tB = new THREE.DataTexture(LG.biome, 1024, 1024, THREE.RGBAFormat);
  tB.minFilter = THREE.LinearMipmapLinearFilter; tB.magFilter = THREE.LinearFilter; tB.generateMipmaps = true; tB.needsUpdate = true;
  LU.tH.value = tH; LU.tNrm.value = tN; LU.tBio.value = tB;
  LU.tContact.value = shadowRT.texture;
  LU.uLapL.value = LG.road.L;
}
// shade thrown by trees and buildings for the sun as it stands, 2 m a texel; kept on the CPU too, to dim the car
function landShade() {
  const n = 2048, S = new Uint8Array(n * n), T = LG.trees, sun = LU.uSunDir.value;
  const el = Math.max(0.12, sun.y), hx = -sun.x / el, hz = -sun.z / el;   // where a metre of height throws its shadow
  const px = n / LG.SIZE;
  const blob = (x, z, r, hgt, dark) => {
    // an ellipse from the foot of the thing to where its top's shadow falls
    const len = Math.min(hgt * Math.hypot(hx, hz), 60), dl = Math.hypot(hx, hz) || 1, ux = hx / dl, uz = hz / dl;
    const cx = x + ux * len * 0.5, cz = z + uz * len * 0.5, a = len * 0.5 + r, b = r;
    const R = Math.ceil((a + 1) * px), ci = Math.round((cx + LG.HALF) * px), cj = Math.round((cz + LG.HALF) * px);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const dx = di / px, dz = dj / px, u = (dx * ux + dz * uz) / a, v = (-dx * uz + dz * ux) / b, d = u * u + v * v;
      if (d >= 1) continue;
      const q = j * n + i, val = dark * (1 - d * d) * 255;
      if (val > S[q]) S[q] = val;
    }
  };
  for (let i = 0; i < T.n; i++) { const s = T.s[i], k = T.kind[i]; blob(T.x[i], T.z[i], (k === 0 ? 2.1 : k === 1 ? 3.4 : 1.6) * s, (k === 0 ? 11 : k === 1 ? 8.5 : 15) * s, 0.86); }
  for (const b of LAND.casters || []) blob(b[0], b[1], b[2], b[3], 0.9);
  LAND.shadeCPU = S;
  if (LU.tShade.value) LU.tShade.value.dispose();
  const t = new THREE.DataTexture(S, n, n, THREE.RedFormat);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  LU.tShade.value = t;
}
function landShadeAt(x, z) {
  const S = LAND.shadeCPU; if (!S) return 0;
  const n = 2048, i = clamp(Math.round((x + LG.HALF) / LG.SIZE * n), 0, n - 1), j = clamp(Math.round((z + LG.HALF) / LG.SIZE * n), 0, n - 1);
  return S[j * n + i] / 255;
}

/* ---------- terrain ---------- */
const LAND_CHUNK = 256, LAND_LODS = [[64, 4], [16, 16], [4, 64]];
function landGridGeometry(n) {
  // (n+1)² grid in cell units, plus a skirt hanging from its edge to hide the seams between levels of detail
  const pos = [], idx = [], m = n + 1;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) pos.push(i, 0, j);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * m + i, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
  const edge = [];
  for (let i = 0; i < n; i++) edge.push([i, 0]);
  for (let j = 0; j < n; j++) edge.push([n, j]);
  for (let i = n; i > 0; i--) edge.push([i, n]);
  for (let j = n; j > 0; j--) edge.push([0, j]);
  const base = pos.length / 3;
  for (const [i, j] of edge) pos.push(i, -1, j);
  for (let e = 0; e < edge.length; e++) {
    const e1 = (e + 1) % edge.length, a = edge[e][1] * m + edge[e][0], b = edge[e1][1] * m + edge[e1][0], c = base + e, d = base + e1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new V3(), 1e6);
  return g;
}
function landTerrainMat() {
  return landMat({
    vertexPars: `attribute vec3 aInst; uniform sampler2D tH;`,
    vertexMain: `
      vec2 xz = aInst.xy + position.xz * aInst.z;
      ivec2 tc = clamp(ivec2((xz + L_HALF) / ${LG.CELL.toFixed(1)} + 0.5), ivec2(0), ivec2(${LG.N - 1}));
      lp = vec3(xz.x, texelFetch(tH, tc, 0).r + position.y * aInst.z * 0.7, xz.y);`,
    fragmentMain: `
      vec2 xz = vLP.xz, tuv = (xz + L_HALF) / L_SIZE * ${((LG.N - 1) / LG.N).toFixed(6)} + ${(0.5 / LG.N).toFixed(6)};
      vec4 nt = texture2D(tNrm, tuv);
      vec3 N = vec3(nt.x * 2.0 - 1.0, 0.0, nt.y * 2.0 - 1.0); N.y = sqrt(max(0.05, 1.0 - dot(N.xz, N.xz)));
      vec4 bio = texture2D(tBio, (xz + L_HALF) / L_SIZE);
      float dist = length(vWP - cameraPosition), fine = 1.0 - smoothstep(30.0, 160.0, dist);
      float h = vLP.y, n2 = vnoise(xz / 17.0), n4 = vnoise(xz / 61.0 + 3.3);
      vec3 alb = grassCol(xz, fine);
      // tufts and blades close to the eye
      alb *= 1.0 + fine * 0.35 * (vnoise(xz * vec2(7.0, 2.3)) - 0.5);
      // farmland on the low, level ground: fields of different crops worked in rows, hedges between them
      vec2 fp = xz / 170.0 + vec2(vnoise(xz / 430.0 + 1.3), vnoise(xz / 430.0 + 9.7)) * 1.5;
      vec2 fc = floor(fp), ff = fract(fp);
      float fh = hash12(fc), fedge = min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y));
      float farm = smoothstep(0.42, 0.6, vnoise(xz / 610.0 + 4.2)) * (1.0 - smoothstep(48.0, 70.0, h)) * smoothstep(0.975, 0.992, N.y) * (1.0 - smoothstep(0.15, 0.45, bio.g)) * step(L_WATER + 2.5, h);
      float fa = fh * 6.2832, rows = 0.5 + 0.5 * sin(dot(xz, vec2(cos(fa), sin(fa))) * 3.6);
      vec3 crop = fh < 0.3 ? vec3(0.27, 0.215, 0.085) : fh < 0.52 ? vec3(0.085, 0.15, 0.04) : fh < 0.68 ? vec3(0.15, 0.115, 0.075) : fh < 0.8 ? vec3(0.3, 0.27, 0.05) : alb;
      crop *= 0.86 + 0.28 * n2 + (rows - 0.5) * 0.3 * fine * step(fh, 0.8);
      alb = mix(alb, crop, farm * smoothstep(0.012, 0.03, fedge));
      alb = mix(alb, vec3(0.03, 0.052, 0.02), farm * (1.0 - smoothstep(0.008, 0.02, fedge)) * 0.9);
      alb = mix(alb, vec3(0.034, 0.055, 0.022) * (0.75 + 0.5 * n2), bio.g * 0.85);
      vec3 earth = mix(vec3(0.15, 0.11, 0.07), vec3(0.23, 0.18, 0.115), n4) * (0.85 + 0.3 * vnoise(xz / 1.3) * fine);
      alb = mix(alb, earth, smoothstep(0.25, 0.75, bio.r + (n2 - 0.5) * 0.3));
      float steep = smoothstep(0.82, 0.62, N.y + (n4 - 0.5) * 0.12);
      vec3 rock = mix(vec3(0.085, 0.08, 0.078), vec3(0.19, 0.17, 0.15), vnoise(vec2(xz.x / 23.0 + h * 0.11, h * 0.21 + xz.y / 31.0) + 3.0 * vnoise(xz / 90.0))) * (0.8 + 0.4 * vnoise(xz / 4.1));
      alb = mix(alb, rock, max(steep, smoothstep(0.35, 0.9, bio.b)));
      alb = mix(alb, vec3(0.4, 0.34, 0.235) * (0.9 + 0.2 * n2), bio.a);
      float snow = smoothstep(265.0, 330.0, h + 50.0 * n4) * smoothstep(0.55, 0.8, N.y);
      alb = mix(alb, vec3(0.42, 0.44, 0.48), snow);
      // under the lake
      float deep = clamp((L_WATER - h) / 4.0, 0.0, 1.0);
      alb = mix(alb, alb * vec3(0.3, 0.5, 0.5), deep);
      // small relief in the light
      N = normalize(N + vec3(vnoise(xz / 2.9) - 0.5, 0.0, vnoise(xz / 2.9 + 31.7) - 0.5) * 0.3 * fine);
      outC = landLit(alb, N, vLP, vWP, 0.82);`,
  });
}
function buildTerrain() {
  const mat = landTerrainMat();
  for (const [n, cell] of LAND_LODS) {
    const m = new THREE.Mesh(landGridGeometry(n), mat);
    m.frustumCulled = false; m.userData.cell = cell;
    LAND.group.add(m); LAND.terrain.push(m);
  }
}
function updateTerrainLod(x, z, force) {
  if (!force && Math.hypot(x - LAND.lastLod[0], z - LAND.lastLod[1]) < 24) return;
  LAND.lastLod = [x, z];
  const nC = LG.SIZE / LAND_CHUNK, cnt = [0, 0, 0];
  const A = LAND.terrain.map((m) => m.geometry.attributes.aInst.array);
  for (let j = 0; j < nC; j++) for (let i = 0; i < nC; i++) {
    const x0 = -LG.HALF + i * LAND_CHUNK, z0 = -LG.HALF + j * LAND_CHUNK;
    const d = Math.hypot(clamp(x, x0, x0 + LAND_CHUNK) - x, clamp(z, z0, z0 + LAND_CHUNK) - z);
    const l = d < 380 ? 0 : d < 1300 ? 1 : 2, q = cnt[l]++ * 3;
    A[l][q] = x0; A[l][q + 1] = z0; A[l][q + 2] = LAND_LODS[l][1];
  }
  LAND.terrain.forEach((m, l) => { m.geometry.instanceCount = cnt[l]; m.geometry.attributes.aInst.needsUpdate = true; });
}

/* ---------- the road ---------- */
const ROAD_COLS = [-(LG.HW + LG.VERGE), -(LG.HW + LG.VERGE - LG.SKIRT), -(LG.HW + LG.KERB), -(LG.HW + LG.KERB * 0.45), -LG.HW, 0, LG.HW, LG.HW + LG.KERB * 0.45, LG.HW + LG.KERB, LG.HW + LG.VERGE - LG.SKIRT, LG.HW + LG.VERGE];
function buildRoadMesh() {
  const R = LG.road, STEP = 2, rows = Math.round(R.n / STEP), C = ROAD_COLS.length;
  const pos = new Float32Array((rows + 1) * C * 3), road = new Float32Array((rows + 1) * C * 2), feat = new Float32Array((rows + 1) * C * 4), idx = [];
  for (let r = 0; r <= rows; r++) {
    const i = r === rows ? 0 : r * STEP, s = r * STEP * R.ds, th = R.th[i], nx = -Math.sin(th), nz = Math.cos(th);
    for (let c = 0; c < C; c++) {
      const n = ROAD_COLS[c], v = r * C + c;
      pos[v * 3] = R.x[i] + nx * n; pos[v * 3 + 1] = lgRibbonY(i, 0, n); pos[v * 3 + 2] = R.z[i] + nz * n;
      road[v * 2] = s; road[v * 2 + 1] = n;
      feat[v * 4] = R.kerbL[i]; feat[v * 4 + 1] = R.kerbR[i]; feat[v * 4 + 2] = R.solid[i]; feat[v * 4 + 3] = R.line[i];
    }
    if (r < rows) for (let c = 0; c < C - 1; c++) { const a = r * C + c, b = a + 1, d = a + C, e = d + 1; idx.push(a, b, d, b, e, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRoad', new THREE.BufferAttribute(road, 2));
  g.setAttribute('aFeat', new THREE.BufferAttribute(feat, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = landMat({
    offset: -6,
    uniforms: { uPatch: { value: Array.from({ length: PATCH_N / 2 }, (_, i) => new THREE.Vector4(PATCHES[i * 4], PATCHES[i * 4 + 1], PATCHES[i * 4 + 2], PATCHES[i * 4 + 3])) } },
    vertexPars: 'attribute vec2 aRoad; attribute vec4 aFeat; varying vec2 vRoad; varying vec4 vFeat;',
    vertexMain: 'vRoad = aRoad; vFeat = aFeat;',
    fragmentPars: `varying vec2 vRoad; varying vec4 vFeat; uniform vec4 uPatch[${PATCH_N / 2}];
      float sqI(float x, float d){ return floor(x) * d + min(fract(x), d); }
      float sqF(float x, float d, float w){ w = max(w, 1e-4); return (sqI(x + 0.5 * w, d) - sqI(x - 0.5 * w, d)) / w; }
      float bandF(float x, float a, float b, float w){ w = max(w, 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }`,
    fragmentMain: `
      float s = vRoad.x, n = vRoad.y, an = abs(n), side = n < 0.0 ? -1.0 : 1.0;
      float fs = fwidth(s), fn = fwidth(n), ws = fs + uBlur;
      float HW = ${LG.HW.toFixed(2)}, KE = ${(LG.HW + LG.KERB).toFixed(2)};
      float onRoad = 1.0 - smoothstep(HW - fn, HW + fn, an);
      float kerbW = side > 0.0 ? vFeat.y : vFeat.x;
      float kerb = step(0.5, kerbW) * (1.0 - onRoad) * (1.0 - smoothstep(KE - fn, KE + fn, an));
      // asphalt: aggregate, the worn line, tar seams, patches
      float blurS = 1.0 + uBlur / 0.5, fineAmp = 1.0 - smoothstep(0.08, 0.4, max(fs, fn) + uBlur * 0.6);
      float grain = vnoise(vec2(s / (0.35 * blurS), n / 0.35)) * fineAmp + vnoise(vec2(s / (2.6 + uBlur), n / 2.6)) * 0.8;
      float albA = 0.085 + 0.024 * (grain - 0.9) + 0.016 * (vnoise(vec2(s / 37.0, n / 9.0)) - 0.5);
      float dl = n - vFeat.w;
      albA *= 1.0 - exp(-dl * dl / 2.6) * 0.2 - (exp(-(dl - 0.86) * (dl - 0.86) / 0.07) + exp(-(dl + 0.86) * (dl + 0.86) / 0.07)) * 0.07;
      float tar = (1.0 - smoothstep(0.012, 0.02 + fn, abs(vnoise(vec2(s / (14.0 + uBlur * 6.0), n / 3.0)) - 0.5))) * (1.0 - smoothstep(0.1, 0.5, uBlur)) * 0.45;
      albA *= 1.0 - tar;
      float ci = floor(mod(s, ${TRACK.P.toFixed(1)}) / ${PATCH_CELL.toFixed(1)});
      vec4 pv = uPatch[int(ci) / 2];
      vec2 pe = (int(ci) % 2 == 0) ? pv.xy : pv.zw;
      float sl = mod(s, ${PATCH_CELL.toFixed(1)});
      float patchF = pe.x < 0.0 ? 0.0 : bandF(sl, pe.x, pe.y, ws);
      albA = mix(albA, 0.062 + 0.012 * grain, patchF);
      vec3 A = vec3(albA) * vec3(0.98, 1.0, 1.03);
      // paint: edge lines, the centre line (dashed, solid through the bends), the start line and the grid
      float wear = 0.75 + 0.25 * vnoise(vec2(s / 1.7, n * 3.0));
      float line = bandF(an, HW - 0.32, HW - 0.16, fn);
      float dash = mix(sqF(s / 12.0, 0.33, ws / 12.0), 1.0, clamp(vFeat.z * 1.5, 0.0, 1.0));
      float sw = s > uLapL * 0.5 ? s - uLapL : s;
      float inStadium = step(-330.0, sw) * step(sw, 610.0);
      line += bandF(an, 0.0, 0.075, fn) * dash * (1.0 - inStadium);
      float chk = bandF(sw, -0.6, 0.6, ws) * onRoad;
      float cq = step(0.5, fract(n / 1.2)) + step(0.5, fract((sw + 0.6) / 1.2));
      // grid boxes: two files, staggered, every 8 m behind the line
      float gs = -sw - 6.0, slot = fract(gs / 16.0) * 16.0, file = n > 0.0 ? 0.0 : 8.0;
      float gbox = step(0.0, gs) * step(gs, 16.0 * 10.0) * bandF(slot - file, 0.0, 0.14, ws) * bandF(abs(abs(n) - 2.6), 0.0, 1.25, fn);
      gbox += step(0.0, gs) * step(gs, 16.0 * 10.0) * bandF(slot - file, 0.0, 1.6, ws) * bandF(abs(abs(abs(n) - 2.6) - 1.25), 0.0, 0.07, fn);
      A = mix(A, vec3(0.5) * wear, clamp(line + gbox, 0.0, 1.0) * onRoad);
      A = mix(A, vec3(0.52) * (mod(cq, 2.0) < 0.5 ? 1.0 : 0.08), chk);
      // kerbs, then the verge, which is the land's own grass
      float stripe = sqF(s / 2.0, 0.5, ws / 2.0);
      A = mix(A, mix(vec3(0.5, 0.045, 0.035), vec3(0.55), stripe), kerb);
      float dist = length(vWP - cameraPosition), fine = 1.0 - smoothstep(30.0, 160.0, dist);
      vec3 gr = grassCol(vLP.xz, fine) * (1.0 + fine * 0.35 * (vnoise(vLP.xz * vec2(7.0, 2.3)) - 0.5));
      // a strip of gravel and worn earth along the edge
      float edge = (1.0 - smoothstep(0.0, 1.6, an - (kerbW > 0.5 ? KE : HW))) * (0.5 + 0.5 * vnoise(vec2(s / 6.0, n * 2.0)));
      gr = mix(gr, vec3(0.2, 0.17, 0.125) * (0.8 + 0.4 * grain), edge * 0.8);
      float verge = (1.0 - onRoad) * (1.0 - kerb);
      A = mix(A, gr, verge);
      vec3 N = normalize(vN);
      outC = landLit(A, N, vLP, vWP, 0.85);
      // the low sun glancing off the asphalt
      vec3 V = normalize(uToLand * (cameraPosition - vWP)), Hh = normalize(V + uSunDir);
      float spec = pow(max(dot(N, Hh), 0.0), 90.0) * (1.0 - verge) * (0.25 + 0.75 * pow(1.0 - max(V.y, 0.0), 4.0));
      outC += uSunCol * spec * 0.22 * (1.0 - texture2D(tShade, vLP.xz / L_SIZE + 0.5).r) * cloudShade(vLP.xz) * carShade(vWP);`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.renderOrder = 1;
  LAND.group.add(m); LAND.road = m;
}

/* ---------- sky, water ---------- */
function skyMaterial(env) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, WU, LU), side: THREE.BackSide, depthWrite: false, transparent: !env,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `${GLSL_LAND}
      varying vec3 vP;
      float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main(){
        vec3 d = normalize(vP);
        vec3 c = skyCol(d, uLTime);
        float sd = dot(d, uSunDir), cv = cloudCover(d, uLTime);
        // the disc of the sun (or the moon), dimmed behind cloud
        c += uSunCol * ${env ? '6.0' : '26.0'} * smoothstep(0.99955, 0.9998, sd) * (1.0 - cv * 0.9) * smoothstep(-0.01, 0.03, d.y);
        // stars
        vec3 q = d * 300.0, cell = floor(q);
        c += vec3(0.85, 0.9, 1.0) * uNightK * step(0.9965, h13(cell)) * (1.0 - smoothstep(0.05, 0.16, length(fract(q) - 0.5))) * smoothstep(0.05, 0.3, d.y) * (0.35 + 1.3 * h13(cell + 17.0)) * (1.0 - cv);
        // far ranges beyond the map, pale in the haze
        float a = atan(d.z, d.x);
        float top = 0.02 + 0.045 * vnoise(vec2(a * 4.0, 1.7)) + 0.02 * vnoise(vec2(a * 13.0, 4.2)) + 0.008 * vnoise(vec2(a * 41.0, 2.2));
        float m = 1.0 - smoothstep(top - 0.004, top, d.y);
        float sdh = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
        c = mix(c, mix(uLFog, uLFogSun, pow(sdh, 4.0)) * mix(0.62, 1.0, smoothstep(0.0, top, d.y)), m * step(0.0, d.y + 0.02));
        ${env ? 'if (d.y < 0.0) c = mix(uGndCol * 2.2 + uSunCol * vec3(0.05, 0.06, 0.035), uLFog, smoothstep(-0.25, 0.0, d.y));' : ''}
        gl_FragColor = vec4(c, ${env ? '1.0' : 'uMix'});
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function buildSky() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), skyMaterial(false));
  m.renderOrder = -9; m.frustumCulled = false;
  LAND.group.add(m); LAND.sky = m;
}
function buildWater() {
  const K = LG_LAKE, g = new THREE.PlaneGeometry(K.rx * 3.4, K.rz * 3.4).rotateX(-Math.PI / 2).translate(K.x, LG.WATER, K.z);
  const mat = landMat({
    transparent: true, depthWrite: false,
    uniforms: {},
    fragmentMain: `
      vec2 xz = vLP.xz, tuv = (xz + L_HALF) / L_SIZE * ${((LG.N - 1) / LG.N).toFixed(6)} + ${(0.5 / LG.N).toFixed(6)};
      float depth = (0.5 - texture2D(tNrm, tuv).z) * 12.0;
      if (depth < -0.3) discard;
      float t = uLTime;
      // ripples: two trains of small waves crossing
      vec2 w1 = xz * 0.21 + vec2(t * 0.35, t * 0.12), w2 = xz * 0.47 + vec2(-t * 0.28, t * 0.4);
      vec3 N = normalize(vec3((vnoise(w1) - 0.5) * 0.14 + (vnoise(w2) - 0.5) * 0.09, 1.0, (vnoise(w1 + 17.3) - 0.5) * 0.14 + (vnoise(w2 + 9.1) - 0.5) * 0.09));
      vec3 V = normalize(uToLand * (cameraPosition - vWP));
      vec3 Rr = reflect(-V, N); Rr.y = abs(Rr.y);
      float fres = 0.03 + 0.97 * pow(1.0 - max(dot(V, N), 0.0), 5.0);
      vec3 deep = vec3(0.012, 0.05, 0.06) * (uSkyCol.b * 3.0 + 0.12) + uSunCol * vec3(0.004, 0.012, 0.011);
      outC = mix(deep, skyCol(Rr, t), fres);
      outC += uSunCol * pow(max(dot(Rr, uSunDir), 0.0), 600.0) * 5.0 * cloudShade(xz);
      // the shallows show the bed, the edge wets the sand
      alpha = smoothstep(-0.05, 1.4, depth) * 0.92 + 0.06;`,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 2;
  LAND.group.add(m); LAND.water = m;
}

/* ---------- light: the sun on the car, the sky in its paint, its shadow on the ground ---------- */
function landSetTod(id) {
  const T = LAND_TOD[id] || LAND_TOD.dusk;
  LAND.tod = LAND_TOD[id] ? id : 'dusk';
  const el = RAD(T.el), az = RAD(T.az);
  LU.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  LU.uSunCol.value.setRGB(...T.sun); LU.uSkyCol.value.setRGB(...T.sky); LU.uGndCol.value.setRGB(...T.gnd);
  LU.uZen.value.setRGB(...T.zen); LU.uHor.value.setRGB(...T.hor); LU.uGlow.value.setRGB(...T.glow);
  LU.uLFog.value.setRGB(...T.fog); LU.uLFogSun.value.setRGB(...T.fogSun); LU.uCloud.value.setRGB(...T.cloud); LU.uCloudDark.value.setRGB(...T.cloudDark);
  LU.uCover.value = T.cover; LU.uLFogD.value = T.fogD; LU.uNightK.value = id === 'night' ? 1 : 0;
  LAND.headK = T.head;
  if (!LAND.built) return;
  landShade();
  landEnv();
  if (LAND.sun) LAND.sun.color.setRGB(T.sun[0], T.sun[1], T.sun[2]).multiplyScalar(1 / Math.max(...T.sun));
  LAND.sunI = Math.max(...T.sun) * Math.PI * 0.62;
  needsRender = true;
}
// what the car's paint reflects out here: the sky as it is, over lit ground
function landEnv() {
  if (!LAND.envScene) {
    LAND.envScene = new THREE.Scene();
    LAND.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), skyMaterial(true)));
  }
  const gen = new THREE.PMREMGenerator(renderer), prev = LAND.env;
  LAND.env = gen.fromScene(LAND.envScene, 0.01);
  gen.dispose();
  ENV.land = LAND.env;
  ENV.last = -1;
  if (prev) prev.dispose();
}
function buildLandLight() {
  LAND.sun = new THREE.DirectionalLight(0xffffff, 0);
  scene.add(LAND.sun, LAND.sun.target);
  // the car seen from the sun: its silhouette and depth, for the shadow it throws on the land
  LAND.carSh = new THREE.WebGLRenderTarget(512, 512, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
  LAND.shCam = new THREE.OrthographicCamera(-3.5, 3.5, 3.5, -3.5, 0.5, 30);
  LAND.shMat = new THREE.ShaderMaterial({
    vertexShader: 'varying float vZ; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); vZ = gl_Position.z * 0.5 + 0.5; }',
    fragmentShader: 'varying float vZ; void main(){ gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }', side: THREE.DoubleSide,
  });
  LU.tCarSh.value = LAND.carSh.texture;
}
const _lsd = new V3(), _lsm = new THREE.Matrix4();
function renderCarShadow() {
  const c = LAND.shCam, S = _lsd.copy(LU.uSunDir.value).applyAxisAngle(_lv3y, LAND.group.rotation.y);
  // the frame turned to the sun; a low sun stretches the shadow, so the picture is taken from further off, wider
  c.position.set(VIEW_DX + S.x * 14, 0.5 + S.y * 14, S.z * 14);
  c.up.set(0, 1, 0); c.lookAt(VIEW_DX, 0.5, 0); c.updateMatrixWorld(true);
  LU.uShMat.value.multiplyMatrices(c.projectionMatrix, _lsm.copy(c.matrixWorld).invert());
  const vis = scene.children.map((o) => o.visible), hid = [];
  for (const o of scene.children) if (o !== carRoot) o.visible = false;
  carRoot.traverse((o) => { if (o.userData.noShadow && o.visible) { hid.push(o); o.visible = false; } });
  const bg = scene.background, alpha = renderer.getClearAlpha();
  scene.background = null; scene.overrideMaterial = LAND.shMat;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(LAND.carSh); renderer.clear(); renderer.render(scene, c);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, alpha);
  scene.overrideMaterial = null; scene.background = bg;
  scene.children.forEach((o, i) => (o.visible = vis[i]));
  for (const o of hid) o.visible = true;
}
const _lv3y = new V3(0, 1, 0);

/* ---------- assembly ---------- */
// the steps of building the land, spread over frames by the page (one a frame) or run at once by the tools
function landSteps() {
  const S = lgSteps();
  return [...S,
    () => { LAND.group = new THREE.Group(); LAND.group.userData.noShadow = true; LAND.group.visible = false; scene.add(LAND.group); landTextures(); buildTerrain(); },
    () => { buildRoadMesh(); buildSky(); buildWater(); buildLandLight(); },
    () => { buildScenery(); },
    () => { LAND.built = true; landSetTod(LAND.tod); },
  ];
}
function landBuildNow() { if (LAND.built) return; for (const f of landSteps()) f(); LAND.building = null; }
// one step a frame; true once the land is there
function landBuildStep() {
  if (LAND.built) return true;
  if (!LAND.building) LAND.building = { steps: landSteps(), i: 0 };
  const B = LAND.building;
  B.steps[B.i++]();
  landProgress(B.i / B.steps.length);
  if (B.i >= B.steps.length) { LAND.building = null; return true; }
  return false;
}

/* ---------- per frame ---------- */
function updateLand(dt, snap) {
  if (!LAND.built) return false;
  const m = WORLD.mix, on = WORLD.kind === 'land' && m > 0;
  LAND.group.visible = on;
  // out here the eye reaches kilometres: the far plane goes out, and the near one too unless the camera is in the car
  const far = on ? 5600 : 1600, near = on && state.view !== 'driver' && state.view !== 'cabin' ? 0.3 : 0.05;
  if (camera.far !== far || camera.near !== near) { camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
  if (!on) { LAND.sun.intensity = 0; scene.environmentRotation.y = 0; bloom.strength = 0.3; bloom.threshold = 0.96; return false; }
  const v = FREE.view, th = FREE.th, cs = Math.cos(th), sn = Math.sin(th), g = LAND.group;
  g.rotation.y = th;
  g.position.set(-(cs * v.x + sn * v.z), -v.y, -(-sn * v.x + cs * v.z));
  g.updateMatrixWorld(true);
  LAND.sky.position.set(v.x, v.y - 60, v.z);
  LU.uToLand.value.set(cs, 0, -sn, 0, 1, 0, sn, 0, cs);
  LU.uCarPos.value.set(v.x, v.y, v.z);
  if (!snap) LU.uLTime.value += dt;
  WU.uHeadI.value = (state.lights ? 1 : 0) * LAND.headK;
  WU.uV.value = FREE.u; WU.uVz.value = FREE.w; WU.uW.value = FREE.r; WU.uBlur.value = Math.abs(FREE.u) * EXPO;
  updateTerrainLod(v.x, v.z, snap);
  updateScenery(dt, snap);
  // the sun on the car, dimmed where the car stands in shade
  const S = _lsd.copy(LU.uSunDir.value).applyAxisAngle(_lv3y, th);
  LAND.sun.position.copy(S).multiplyScalar(60); LAND.sun.target.position.set(0, 0, 0);
  const shade = 1 - 0.85 * landShadeAt(v.x, v.z);
  LAND.shadeK = snap || LAND.shadeK === undefined ? shade : LAND.shadeK + (shade - LAND.shadeK) * (1 - Math.exp(-dt * 14));
  LAND.sun.intensity = LAND.sunI * m * LAND.shadeK;
  // daylight is bright everywhere: only the sun itself and its glints are left to bloom
  bloom.strength = lerp(0.3, 0.13, m); bloom.threshold = lerp(0.96, 1.5, m);
  scene.environmentRotation.y = (th - Math.round(th / (2 * Math.PI)) * 2 * Math.PI) * sstep(0, 1, m);
  renderCarShadow();
  return true;
}
