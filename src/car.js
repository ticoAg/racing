import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =========================================================================
   Utilities
   ========================================================================= */
const V3 = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const cosWin = (t) => (Math.abs(t) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t));
let _seed = 20261102;
const rand = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };

// Smooth design curve: monotone cubic through keys, sampled to a LUT and gaussian-blurred
function designCurve(keys, sigma = 0.04, x0 = -2.7, x1 = 2.8, step = 0.002) {
  const k = keys.slice().sort((p, q) => p[0] - q[0]);
  const xs = k.map(p => p[0]), ys = k.map(p => p[1]), n = xs.length;
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  const ev = (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] > x) hi = mid; else lo = mid; }
    const t = (x - xs[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * h[lo] * m[lo + 1];
  };
  const N = Math.ceil((x1 - x0) / step) + 1;
  let lut = new Float32Array(N);
  for (let i = 0; i < N; i++) lut[i] = ev(x0 + i * step);
  if (sigma > 0) {
    const r = Math.ceil(3 * sigma / step), w = [];
    let ws = 0;
    for (let j = -r; j <= r; j++) { const v = Math.exp(-0.5 * (j * step / sigma) ** 2); w.push(v); ws += v; }
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += lut[clamp(i + j, 0, N - 1)] * w[j + r];
      out[i] = s / ws;
    }
    lut = out;
  }
  return (x) => {
    const f = (x - x0) / step;
    if (f <= 0) return lut[0];
    if (f >= N - 1) return lut[N - 1];
    const i = f | 0, t = f - i;
    return lut[i] + (lut[i + 1] - lut[i]) * t;
  };
}

// Build an indexed grid surface from rows of points. Triangle order gives outward normals
// when rows advance along +X and points advance in the "ring" direction.
function gridGeometry(rows, opts = {}) {
  const S = rows.length, P = rows[0].length;
  const pos = new Float32Array(S * P * 3), uv = new Float32Array(S * P * 2);
  for (let i = 0; i < S; i++) {
    let acc = 0;
    for (let j = 0; j < P; j++) {
      const p = rows[i][j], k = i * P + j;
      pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
      if (j > 0) { const q = rows[i][j - 1]; acc += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
      uv[k * 2] = opts.uFn ? opts.uFn(i, j, p, acc) : p[0];
      uv[k * 2 + 1] = opts.vFn ? opts.vFn(i, j, p, acc) : acc;
    }
  }
  const nG = opts.groups || 1;
  const buckets = Array.from({ length: nG }, () => []);
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < P - 1; j++) {
    const a = i * P + j, b = a + 1, c = a + P, d = c + 1;
    const tgt = buckets[opts.groupOf ? opts.groupOf(i, j) : 0];
    // split each quad along its shorter 3D diagonal (avoids saw-tooth shading on slanted creases)
    const dad = (pos[a * 3] - pos[d * 3]) ** 2 + (pos[a * 3 + 1] - pos[d * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[d * 3 + 2]) ** 2;
    const dbc = (pos[b * 3] - pos[c * 3]) ** 2 + (pos[b * 3 + 1] - pos[c * 3 + 1]) ** 2 + (pos[b * 3 + 2] - pos[c * 3 + 2]) ** 2;
    if (dad < dbc * 0.999) {
      if (opts.flip) tgt.push(a, d, b, a, c, d); else tgt.push(a, b, d, a, d, c);
    } else {
      if (opts.flip) tgt.push(a, c, b, b, c, d); else tgt.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const all = [];
  let start = 0;
  buckets.forEach((arr, gi) => { if (nG > 1) g.addGroup(start, arr.length, gi); start += arr.length; for (let q = 0; q < arr.length; q++) all.push(arr[q]); });
  g.setIndex(all);
  g.computeVertexNormals();
  return g;
}

// Parametric patch on a surface function: P(u,v) -> [x,y,z]; normal estimated by finite differences.
function patchGeometry(nu, nv, P, offsetFn, opts = {}) {
  const rows = [];
  const eps = 1e-3;
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, row = [];
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const p = P(u, v);
      const pu = P(Math.min(1, u + eps), v), pu0 = P(Math.max(0, u - eps), v);
      const pv = P(u, Math.min(1, v + eps)), pv0 = P(u, Math.max(0, v - eps));
      const du = new V3(pu[0] - pu0[0], pu[1] - pu0[1], pu[2] - pu0[2]);
      const dv = new V3(pv[0] - pv0[0], pv[1] - pv0[1], pv[2] - pv0[2]);
      const nrm = new V3().crossVectors(dv, du).normalize();
      if (opts.flipNormal) nrm.negate();
      const o = offsetFn ? offsetFn(u, v) : 0;
      row.push([p[0] + nrm.x * o, p[1] + nrm.y * o, p[2] + nrm.z * o]);
    }
    rows.push(row);
  }
  return gridGeometry(rows, { flip: !!opts.flip, uFn: opts.uFn, vFn: opts.vFn });
}

function lathe(points, segs = 96, phiStart = 0, phiLen = Math.PI * 2) {
  const g = new THREE.LatheGeometry(points.map(p => new THREE.Vector2(p[0], p[1])), segs, phiStart, phiLen);
  g.rotateX(Math.PI / 2); // lathe axis (Y) -> Z
  return g;
}

// Lit materials write HDR into half-float targets, which overflow to Inf above 65504. A floodlight glinting off
// near-mirror clearcoat or chrome can exceed that in a pixel or two; tone mapping turns Inf into NaN and bloom
// spreads it into black blocks. Cap what any built-in material can write.
const HDR_MAX = 256;
THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment.replace(
  'gl_FragColor = vec4( outgoingLight, diffuseColor.a );', `gl_FragColor = vec4( min( outgoingLight, vec3( ${HDR_MAX}.0 ) ), diffuseColor.a );`);

/* =========================================================================
   Renderer, scene, camera
   ========================================================================= */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__TEST__ });
} catch (e) {
  const l = document.getElementById('loader-msg');
  if (l) l.textContent = 'This studio needs WebGL 2, which this browser or device has turned off.';
  throw e;
}
const DPR = Math.min(window.devicePixelRatio || 1, window.__TEST__ ? 1 : (window.innerWidth < 700 ? 1.5 : 1.75));
renderer.setPixelRatio(DPR);
renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 1600);
camera.position.set(5.6, 1.45, 4.9);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.0, 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 2.2;
controls.maxDistance = 18;
controls.maxPolarAngle = Math.PI * 0.492;
controls.enablePan = true;

const carRoot = new THREE.Group();
scene.add(carRoot);
const car = new THREE.Group(); // sprung body: poses tilt and lower this group
carRoot.add(car);

/* =========================================================================
   Procedural textures
   ========================================================================= */
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

// textures outlive a model change: made once per content, shared by every car that shows it
const TEXC = new Map();
const texOnce = (key, make) => { let t = TEXC.get(key); if (!t) { t = make(); TEXC.set(key, t); } return t; };

function heightToNormal(hgt, w, h, strength) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = hgt[y * w + ((x - 1 + w) % w)], xr = hgt[y * w + ((x + 1) % w)];
    const yu = hgt[((y - 1 + h) % h) * w + x], yd = hgt[((y + 1) % h) * w + x];
    let nx = (xl - xr) * strength, ny = (yd - yu) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// Metallic flake normal map for the base paint layer
function makeFlakeTexture() {
  const s = 256, data = new Uint8Array(s * s * 4);
  for (let i = 0; i < s * s; i++) {
    const a = rand() * Math.PI * 2, r = Math.pow(rand(), 0.7) * 0.55;
    const x = Math.cos(a) * r, y = Math.sin(a) * r, z = Math.sqrt(1 - x * x - y * y);
    data[i * 4] = (x * 0.5 + 0.5) * 255; data[i * 4 + 1] = (y * 0.5 + 0.5) * 255; data[i * 4 + 2] = (z * 0.5 + 0.5) * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.repeat.set(16, 16); t.needsUpdate = true;
  return t;
}

// 2x2 twill carbon weave: albedo + normal
function makeCarbon() {
  const S = 256, cells = 8, cw = S / cells;
  const hgt = new Float32Array(S * S);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ci = Math.floor(x / cw), cj = Math.floor(y / cw);
    const warp = ((ci + cj) % 4) < 2;
    const lx = (x % cw) / cw, ly = (y % cw) / cw;
    const across = warp ? lx : ly, along = warp ? ly : lx;
    const bulge = Math.sin(Math.PI * across);
    const fib = 0.85 + 0.15 * Math.sin((warp ? x : y) * 2.9 + Math.sin((warp ? y : x) * 0.21) * 2.0);
    hgt[y * S + x] = bulge * 0.9 + 0.1 * Math.sin(Math.PI * along);
    const v = (warp ? 0.105 : 0.075) * (0.55 + 0.45 * bulge) * fib;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = v * 255; img.data[i + 2] = v * 262; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const nrm = heightToNormal(hgt, S, S, 2.2);
  return { map, nrm };
}

function hexPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  ctx.closePath();
}
function drawHoneycomb(ctx, x0, y0, w, h, cell, rim = '#2c2d31', hole = '#030304') {
  ctx.fillStyle = rim; ctx.fillRect(x0, y0, w, h);
  const dx = cell * Math.sqrt(3), dy = cell * 1.5;
  for (let j = -1, y = y0 - cell; y < y0 + h + cell; j++, y += dy) {
    for (let x = x0 - cell + ((j & 1) ? dx / 2 : 0); x < x0 + w + cell; x += dx) {
      const g = ctx.createLinearGradient(x, y - cell, x, y + cell);
      g.addColorStop(0, '#000000'); g.addColorStop(1, hole);
      ctx.fillStyle = g; hexPath(ctx, x, y, cell * 0.80); ctx.fill();
    }
  }
}

/* =========================================================================
   Materials
   ========================================================================= */
const flakeTex = makeFlakeTexture();
const carbonTex = makeCarbon();
carbonTex.map.repeat.set(22, 22); carbonTex.nrm.repeat.set(22, 22);
const carbonBody = { map: carbonTex.map.clone(), nrm: carbonTex.nrm.clone() };
carbonBody.map.repeat.set(10, 10); carbonBody.nrm.repeat.set(10, 10); carbonBody.map.needsUpdate = true; carbonBody.nrm.needsUpdate = true;

const livery = {
  stripe: { value: new THREE.Color('#f2f2ee') },
  pin: { value: new THREE.Color('#d0102c') },
  second: { value: new THREE.Color('#0a0b0d') },
  style: { value: 1.0 },
  // per model: where the tail ends, bonnet and engine-cover shut lines
  xr: { value: -2.19 },
  hood: { value: new THREE.Vector3(0.985, 0.60, 2.16) },
  deck: { value: new THREE.Vector3(-1.30, 0.66, -2.10) },
};

const M = {};
M.paint = new THREE.MeshPhysicalMaterial({
  color: '#0b2f86', metalness: 0.62, roughness: 0.34,
  clearcoat: 1.0, clearcoatRoughness: 0.022,
  normalMap: flakeTex, normalScale: new THREE.Vector2(0.16, 0.16),
  envMapIntensity: 1.0,
});
M.paint.onBeforeCompile = (sh) => {
  sh.uniforms.uStripe = livery.stripe; sh.uniforms.uPin = livery.pin; sh.uniforms.uSecond = livery.second; sh.uniforms.uStyle = livery.style;
  sh.uniforms.uTailX = livery.xr; sh.uniforms.uHood = livery.hood; sh.uniforms.uDeck = livery.deck;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;\nvarying vec3 vCarNrm;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;\nvCarNrm = normal;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vCarPos; varying vec3 vCarNrm;
uniform vec3 uStripe; uniform vec3 uPin; uniform vec3 uSecond; uniform float uStyle;
uniform float uTailX; uniform vec3 uHood; uniform vec3 uDeck;
float bandAA(float x, float a, float b){ float w = fwidth(x) + 1e-5; return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float seamAA(float d){ float w = fwidth(d) * 1.5 + 2e-5; return 1.0 - smoothstep(0.0010, 0.0010 + w, d); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
vec3 cn = normalize(vCarNrm);
float az = abs(vCarPos.z);
float upF = smoothstep(-0.30, 0.05, cn.y) * step(uTailX, vCarPos.x);
float stripe = 0.0, pin = 0.0, second = 0.0;
if (uStyle > 0.5 && uStyle < 1.5) {
  stripe = bandAA(az, 0.028, 0.150) * upF;
  pin = bandAA(az, 0.163, 0.171) * upF;
} else if (uStyle > 1.5 && uStyle < 2.5) {
  stripe = bandAA(vCarPos.z, -0.44, -0.16) * upF;
  pin = (bandAA(vCarPos.z, -0.142, -0.132) + bandAA(vCarPos.z, -0.468, -0.458)) * upF;
} else if (uStyle > 2.5 && uStyle < 3.5) {
  float line = 0.415 + 0.05 * vCarPos.x;
  float wy = fwidth(vCarPos.y) + 1e-5;
  float sideOnly = 1.0 - smoothstep(0.55, 0.85, cn.y);
  second = (1.0 - smoothstep(line - wy, line + wy, vCarPos.y)) * sideOnly;
  pin = bandAA(vCarPos.y, line + 0.012, line + 0.020) * sideOnly;
} else if (uStyle > 3.5) {
  float sl = vCarPos.x + 0.45 * vCarPos.y;
  stripe = bandAA(sl, -0.42, -0.20);
  pin = bandAA(sl, -0.172, -0.160) + bandAA(sl, -0.462, -0.450);
}
pin = clamp(pin, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, uSecond, second);
diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, stripe);
diffuseColor.rgb = mix(diffuseColor.rgb, uPin, pin);
float liveryMask = max(stripe, pin);
float topF = smoothstep(0.35, 0.6, cn.y);
// door shut lines: the same four planes that cut the doors out of the body
float f1 = 0.93 - vCarPos.x;
float f2 = vCarPos.y - 0.325;
float f3 = dot(vec2(vCarPos.x + 0.06, vCarPos.y - 0.325), vec2(0.7336, 0.6795));
float f4 = az - 0.585;
float i1 = step(-0.003, f1), i2 = step(-0.003, f2), i3 = step(-0.003, f3), i4 = step(-0.003, f4);
float seam = max(max(seamAA(abs(f1)) * i2 * i3 * i4, seamAA(abs(f2)) * i1 * i3 * i4), max(seamAA(abs(f3)) * i1 * i2 * i4, seamAA(abs(f4)) * i1 * i2 * i3));
vec2 tp = vec2(vCarPos.x, az);
float dTop = min(min(segD(tp, vec2(uHood.x, 0.0), uHood.xy), segD(tp, uHood.xy, uHood.zy)),
                 min(segD(tp, vec2(uDeck.x, 0.0), uDeck.xy), segD(tp, uDeck.xy, uDeck.zy)));
seam = max(seam, seamAA(dTop) * topF);
diffuseColor.rgb *= 1.0 - 0.92 * seam;`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, liveryMask);\nroughnessFactor = mix(roughnessFactor, 0.28, second);\nroughnessFactor = mix(roughnessFactor, 0.9, seam);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, max(liveryMask, second));');
};
M.interior = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.92, metalness: 0.0 });
M.under = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.6 });
// Thin tinted glass without a transmission pass: reflections are added on top (premultiplied),
// while whatever is behind is attenuated by the tint.
M.glass = new THREE.MeshPhysicalMaterial({
  color: 0x0b0d10, metalness: 0, roughness: 0.03, ior: 1.52, opacity: 0.66, transparent: true, depthWrite: false,
  specularIntensity: 1.0, envMapIntensity: 1.35, side: THREE.FrontSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
});
M.glass.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
    `gl_FragColor = vec4( min( totalDiffuse * diffuseColor.a + ( outgoingLight - totalDiffuse ), vec3( ${HDR_MAX}.0 ) ), diffuseColor.a );`);
};
M.blackGloss = new THREE.MeshPhysicalMaterial({ color: 0x040405, metalness: 0.0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03 });
M.carbon = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, map: carbonTex.map, normalMap: carbonTex.nrm, normalScale: new THREE.Vector2(0.35, 0.35),
  metalness: 0.45, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.035,
});
M.rubber = new THREE.MeshPhysicalMaterial({ color: 0x101012, roughness: 0.78, metalness: 0.0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x2a2a2e) });
M.rim = new THREE.MeshPhysicalMaterial({ color: 0x2d2f33, metalness: 0.92, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.08 });
M.rimLip = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1.0, roughness: 0.1 });
M.rimBarrel = new THREE.MeshStandardMaterial({ color: 0x4a4b4f, metalness: 0.9, roughness: 0.42, side: THREE.BackSide });
M.caliper = new THREE.MeshPhysicalMaterial({ color: 0xd0122c, metalness: 0.1, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.05 });
M.chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.06 });
M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.8, roughness: 0.45 });
M.seat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.95 });
M.seatAccent = new THREE.MeshStandardMaterial({ color: 0xa8101f, roughness: 0.7 });
M.doorCard = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.85 });
M.jamb = new THREE.MeshPhysicalMaterial({ color: 0x8a8a8e, map: carbonTex.map, normalMap: carbonTex.nrm, normalScale: new THREE.Vector2(0.25, 0.25), metalness: 0.3, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.12, envMapIntensity: 0.55, side: THREE.DoubleSide });
M.blur = new THREE.MeshStandardMaterial({ color: 0x2d2f33, metalness: 0.85, roughness: 0.35, transparent: true, opacity: 0, depthWrite: false });

/* =========================================================================
   BODY — lofted cross-sections with wheel arches, side scoops, cabin well
   ========================================================================= */
/*@include blk_models.js*/

// the active model's spec and the hard points taken from it (set by useModel)
let SPEC = null;
let XF, XR, AX, BC, SC_X0, SC_X1, LC, NFC, NRAKE, LR, CEND, SIDE, SK0, SK1, SPL_X0, WING, SPOIL, WBASE;
const FLARE = 0.05;
const RLIP = 0.012;
const TUCKP = 2.2;
const ZT = 0.60;            // tub half-width (inner wheel-well wall)
const WELL_FLOOR = 0.30, ZW = 0.565, WX0 = -0.74, WX1 = 0.72;   // cabin well: the tub is the same in every model

function archTop(X, ys) {
  let y = ys;
  for (const w of AX) {
    const dx = Math.abs(X - w.x);
    let ya = ys;
    if (dx <= w.Ra) ya = w.yc + Math.sqrt(w.Ra * w.Ra - dx * dx);
    else if (dx < w.Ra + FLARE) { const u = (dx - w.Ra) / FLARE; ya = w.yc - (w.yc - ys) * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); }
    if (ya > y) y = ya;
  }
  return y;
}
const frontClose = (X, y) => {
  const xe = XF - NRAKE * sstep(0.12, 0.50, y);
  const t = (X - (xe - LC)) / LC;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return Math.pow(1 - Math.pow(t, NFC), 1 / NFC);
};
const rearClose = (X) => {
  const t = ((XR + LR) - X) / LR;
  if (t <= 0) return 1;
  return CEND + (1 - CEND) * Math.pow(1 - Math.pow(Math.min(t, 1), 2.2), 1 / 2.2);
};
const wellX = (X) => sstep(WX0, WX0 + 0.09, X) * (1 - sstep(WX1 - 0.09, WX1, X));

function sideDisp(X, y) {
  let d = 0;
  // sculpted door channel sweeping up into the intake
  {
    const t = clamp((0.95 - X) / 1.25, 0, 1);
    const yc = lerp(0.31, 0.45, t), hw = lerp(0.075, 0.10, t);
    const amp = SIDE.channel * sstep(0.99, 0.62, X) * (1 - sstep(-0.18, -0.34, X));
    d -= amp * cosWin((y - yc) / hw);
  }
  // side intake scoop
  if (SIDE.scoop > 0 && X < SC_X0 + 0.01 && X > SC_X1 - 0.03) {
    const u = clamp((SC_X0 - X) / (SC_X0 - SC_X1), 0, 1);
    const yTop = lerp(0.585, 0.665, u), yBot = lerp(0.50, 0.30, u);
    const win = sstep(yBot - 0.012, yBot + 0.03, y) * (1 - sstep(yTop - 0.022, yTop + 0.004, y));
    const along = sstep(SC_X0, SC_X0 - 0.36, X) * sstep(SC_X1 - 0.012, SC_X1 + 0.006, X);
    const mid = Math.sin(Math.PI * clamp((y - yBot) / Math.max(0.02, yTop - yBot), 0, 1));
    d -= SIDE.scoop * along * win * (0.72 + 0.28 * mid);
  }
  // shoulder ledge under the character line (doors)
  {
    const wl = sstep(SK0 + 0.06, SK0 - 0.08, X) * sstep(SK1 - 0.06, SK1 + 0.10, X) * (1 - 0.85 * cosWin((X - 0.22) / 0.42));
    const ybx = BC.yb(X);
    d -= SIDE.ledge * wl * (1 - sstep(ybx - 0.032, ybx - 0.004, y));
  }
  // rocker crease between the wheels
  {
    const wx = sstep(SK0 + 0.03, SK0 - 0.04, X) * sstep(SK1 - 0.02, SK1 + 0.04, X);
    d -= SIDE.rocker * wx * (1 - sstep(0.195, 0.232, y));
  }
  return d;
}

const LOW_CNT = [4, 5, 10, 9, 11], LOW_N = 39, NUP = 80, NLIP = 5, NCE = 8, NWA = 8, NFL = 7;
const _up = new Float32Array(201 * 3);

function sectionAt(X) {
  const a = BC.a(X), yb = BC.yb(X), crown = BC.crown(X), cy = BC.cy(X), zv = BC.zv(X), n = BC.n(X), tuck = BC.tuck(X), ys = BC.ys(X), yf = BC.yf(X);
  const H = Math.max(0.03, crown - yb), D = Math.max(0, crown - cy), e = 2 / n;
  const yt = archTop(X, ys);
  const ystart = yt + RLIP;
  const M = 200;
  let L = 0;
  for (let k = 0; k <= M; k++) {
    const phi = (Math.PI / 2) * k / M;
    const z = a * Math.pow(Math.max(0, Math.cos(phi)), e), y = yb + H * Math.pow(Math.sin(phi), e);
    if (k > 0) L += Math.hypot(z - _up[(k - 1) * 3], y - _up[(k - 1) * 3 + 1]);
    _up[k * 3] = z; _up[k * 3 + 1] = y; _up[k * 3 + 2] = L;
  }
  const Ll = Math.max(1e-4, yb - ys);
  // start on the upper curve when the arch lip sits above the character line
  let s0 = 0;
  if (ystart > yb) {
    let k = 0;
    while (k < M && _up[(k + 1) * 3 + 1] < ystart) k++;
    const y0 = _up[k * 3 + 1], y1 = _up[(k + 1) * 3 + 1];
    const f = clamp((ystart - y0) / Math.max(1e-6, y1 - y0), 0, 1);
    s0 = lerp(_up[k * 3 + 2], _up[(k + 1) * 3 + 2], f);
  }
  // lower side: fixed-count runs between knots pinned to features (rocker crease, scoop ledge)
  const yBotC = lerp(0.50, 0.30, clamp((SC_X0 - X) / (SC_X0 - SC_X1), 0, 1));
  const kn = [ystart, 0.185, 0.245, yBotC - 0.03, yBotC + 0.05, yb];
  for (let q = 1; q < kn.length - 1; q++) kn[q] = clamp(kn[q], kn[q - 1], Math.max(kn[q - 1], yb));
  kn[kn.length - 1] = Math.max(yb, kn[kn.length - 2]);
  const wx = wellX(X);
  const skin = [];
  let kk = 0;
  const NTOT = LOW_N + NUP;
  for (let k = 0; k < NTOT; k++) {
    let z, y, upper = false;
    let s = -1;
    if (k < LOW_N && ystart <= yb) {
      let q = 0, m = k;
      while (m >= LOW_CNT[q]) { m -= LOW_CNT[q]; q++; }
      y = lerp(kn[q], kn[q + 1], m / LOW_CNT[q]);
      z = a - tuck * Math.pow(clamp((yb - y) / Ll, 0, 1), TUCKP);
    } else {
      s = k < LOW_N ? s0 : lerp(s0, L, (k - LOW_N) / (NUP - 1));
    }
    if (s >= 0) {
      upper = true;
      while (kk < M - 1 && _up[(kk + 1) * 3 + 2] < s) kk++;
      while (kk > 0 && _up[kk * 3 + 2] > s) kk--;
      const s0k = _up[kk * 3 + 2], s1k = _up[(kk + 1) * 3 + 2];
      const f = clamp((s - s0k) / Math.max(1e-7, s1k - s0k), 0, 1);
      z = lerp(_up[kk * 3], _up[(kk + 1) * 3], f);
      y = lerp(_up[kk * 3 + 1], _up[(kk + 1) * 3 + 1], f);
    }
    if (k === NTOT - 1) z = 0;
    const sw = 1 - sstep(yb + 0.03, yb + 0.20, y);
    if (sw > 0) z += sideDisp(X, y) * sw;
    if (upper && D > 0 && z < zv) { const u = z / zv; y -= D * (1 - u * u) * (1 - u * u); }
    let wm = 0;
    if (wx > 0) { wm = wx * (1 - sstep(ZW - 0.035, ZW + 0.01, z)); y = lerp(y, WELL_FLOOR, wm); }
    skin.push([z, y, wm]);
  }
  const zs = skin[0][0];
  const lip = [];
  for (let k = 0; k < NLIP - 1; k++) {
    const ang = -Math.PI / 2 + (Math.PI / 2) * k / (NLIP - 1);
    lip.push([zs - RLIP + RLIP * Math.cos(ang), ystart + RLIP * Math.sin(ang), 0]);
  }
  const zl = zs - RLIP;
  const zt = Math.min(ZT, zl - 0.015);
  const ceil = [], wall = [], floor = [];
  for (let k = 0; k < NCE; k++) ceil.push([lerp(zt, zl, k / (NCE - 1)), yt]);
  for (let k = 0; k < NWA; k++) wall.push([zt, lerp(yf, yt, k / (NWA - 1))]);
  for (let k = 0; k < NFL; k++) floor.push([lerp(0, zt, k / (NFL - 1)), yf]);
  const rc = rearClose(X);
  const close = (p) => { p[0] *= frontClose(X, p[1]) * rc; return p; };
  const lipSkin = lip.concat(skin).map(close);
  return { lipSkin, ceil: ceil.map(close), wall: wall.map(close), floor: floor.map(close) };
}

function stationList() {
  const dens = (x) => {
    let d = 1 / 0.026;
    for (const w of AX) for (const s of [-1, 1]) {
      const xe = w.x + s * (w.Ra + FLARE * 0.45);
      d += (1 / 0.0045) * Math.exp(-0.5 * ((x - xe) / 0.04) ** 2);
    }
    if (SIDE.scoop > 0) {
      d += (1 / 0.004) * Math.exp(-0.5 * ((x - SC_X1) / 0.02) ** 2);
      d += (1 / 0.016 - 1 / 0.026) * sstep(SC_X1 - 0.06, SC_X1, x) * sstep(SC_X0 + 0.06, SC_X0, x);
    }
    d += (1 / 0.004) * sstep(XF - 0.22, XF, x);
    d += (1 / 0.008) * sstep(XR + 0.16, XR, x);
    d += (1 / 0.01) * (Math.exp(-0.5 * ((x - WX0) / 0.05) ** 2) + Math.exp(-0.5 * ((x - WX1) / 0.05) ** 2));
    return d;
  };
  const xs = [XR];
  let x = XR;
  if (!SPEC.body.nose.fine) {
    while (x < XF - 1e-6) { x = Math.min(XF, x + 1 / dens(x)); xs.push(x); }
    return xs;
  }
  // a rounded nose: the last stations follow equal steps of angle round the plan-view closure, so the
  // front face is as finely panelled as the flanks
  const xn = XF - 0.06;
  while (x < xn - 1e-6) { x = Math.min(xn, x + 1 / dens(x)); xs.push(x); }
  const th0 = Math.asin(Math.pow((xn - (XF - LC)) / LC, NFC / 2)), K = 44;
  for (let k = 1; k <= K; k++) xs.push(k === K ? XF : XF - LC + LC * Math.pow(Math.sin(th0 + (Math.PI / 2 - th0) * k / K), 2 / NFC));
  return xs;
}

const BODY = {}; // filled by buildBody (keeps section data for other parts)

function buildBody() {
  const xs = stationList();
  const skinRows = [], wmRows = [], ceilR = [], ceilL = [], wallR = [], wallL = [], floorRows = [];
  const sections = [];
  for (const X of xs) {
    const s = sectionAt(X);
    sections.push({ X, s });
    const left = s.lipSkin.map(p => [X, p[1], -p[0]]);
    const right = s.lipSkin.slice(0, -1).reverse().map(p => [X, p[1], p[0]]);
    skinRows.push(left.concat(right));
    const wml = s.lipSkin.map(p => p[2] || 0);
    wmRows.push(wml.concat(wml.slice(0, -1).reverse()));
    ceilR.push(s.ceil.slice().reverse().map(p => [X, p[1], p[0]]));
    ceilL.push(s.ceil.map(p => [X, p[1], -p[0]]));
    wallR.push(s.wall.slice().reverse().map(p => [X, p[1], p[0]]));
    wallL.push(s.wall.map(p => [X, p[1], -p[0]]));
    floorRows.push(s.floor.slice().reverse().map(p => [X, p[1], p[0]]).concat(s.floor.slice(1).map(p => [X, p[1], -p[0]])));
  }
  BODY.sections = sections;
  const skinGeo = gridGeometry(skinRows, {
    groups: 2,
    groupOf: (i, j) => ((wmRows[i][j] + wmRows[i][j + 1] + wmRows[i + 1][j] + wmRows[i + 1][j + 1]) * 0.25 > 0.02 ? 1 : 0),
  });
  // Normals from the surface function itself (finite differences along X), so mirror-like
  // reflections are not limited by station spacing. Falls back to mesh normals where the
  // parameterisation slides (arch edges, nose closure).
  {
    const h = 0.0015;
    const rowAt = (X) => {
      const sec = sectionAt(X);
      const l = sec.lipSkin.map(p => [X, p[1], -p[0]]);
      const r = sec.lipSkin.slice(0, -1).reverse().map(p => [X, p[1], p[0]]);
      return l.concat(r);
    };
    const nrm = skinGeo.attributes.normal;
    const P = skinRows[0].length;
    const tX = new V3(), tJ = new V3(), n = new V3(), mn = new V3();
    for (let i = 0; i < xs.length; i++) {
      const X = xs[i];
      if (X > XF - 0.02) continue;
      const rm = rowAt(X - h), rp = rowAt(X + h), row = skinRows[i];
      for (let j = 0; j < P; j++) {
        const ja = Math.max(0, j - 1), jb = Math.min(P - 1, j + 1);
        tJ.set(row[jb][0] - row[ja][0], row[jb][1] - row[ja][1], row[jb][2] - row[ja][2]);
        const lj = tJ.length();
        if (lj < 1e-6) continue;
        tJ.divideScalar(lj);
        tX.set(rp[j][0] - rm[j][0], rp[j][1] - rm[j][1], rp[j][2] - rm[j][2]);
        tX.addScaledVector(tJ, -tX.dot(tJ));
        if (tX.length() < h * 0.6) continue;
        n.crossVectors(tJ, tX).normalize();
        mn.fromBufferAttribute(nrm, i * P + j);
        if (n.dot(mn) < 0.6) continue;
        nrm.setXYZ(i * P + j, n.x, n.y, n.z);
      }
    }
    nrm.needsUpdate = true;
  }
  const under = mergeGeometries([gridGeometry(ceilR), gridGeometry(ceilL), gridGeometry(wallR), gridGeometry(wallL), gridGeometry(floorRows)]);
  const skin = new THREE.Mesh(skinGeo, [M.paint, M.interior]);
  const underMesh = new THREE.Mesh(under, M.under);
  car.add(skin, underMesh);
  BODY.skin = skin;

  // Tail cap (flat Kamm face) from the last section ring
  const last = sections[0].s;
  const ring = [];
  last.lipSkin.forEach(p => ring.push([-p[0], p[1]]));
  last.lipSkin.slice(0, -1).reverse().forEach(p => ring.push([p[0], p[1]]));
  last.ceil.slice().reverse().forEach(p => ring.push([p[0], p[1]]));
  last.wall.slice().reverse().forEach(p => ring.push([p[0], p[1]]));
  last.floor.slice().reverse().forEach(p => ring.push([p[0], p[1]]));
  last.floor.slice(1).forEach(p => ring.push([-p[0], p[1]]));
  last.wall.forEach(p => ring.push([-p[0], p[1]]));
  last.ceil.forEach(p => ring.push([-p[0], p[1]]));
  const clean = [];
  for (const p of ring) { const q = clean[clean.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) clean.push(p); }
  if (Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 1e-5) clean.pop();
  const contour = clean.map(p => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const cpos = [], cuv = [];
  for (const p of clean) { cpos.push(XR, p[1], p[0]); cuv.push(p[0], p[1]); }
  const cidx = [];
  for (const t of tris) {
    // orient to face -X
    const A = clean[t[0]], Bp = clean[t[1]], Cp = clean[t[2]];
    const cross = (Bp[0] - A[0]) * (Cp[1] - A[1]) - (Bp[1] - A[1]) * (Cp[0] - A[0]);
    if (cross > 0) cidx.push(t[0], t[1], t[2]); else cidx.push(t[0], t[2], t[1]);
  }
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
  capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  capGeo.setIndex(cidx);
  capGeo.computeVertexNormals();
  BODY.tailRing = clean;
  return { skin, underMesh, capGeo };
}

/* =========================================================================
   CANOPY — glass bubble with painted roof, rear fairing and black A-pillars
   ========================================================================= */
const CX0 = -1.25, CX1 = 1.10, CYB = 0.60;
const CC = {
  yR: designCurve([[1.10, 0.60], [1.0, 0.665], [0.9, 0.725], [0.75, 0.80], [0.55, 0.905], [0.32, 1.005], [0.1, 1.075], [-0.1, 1.105], [-0.3, 1.10], [-0.55, 1.065], [-0.8, 1.0], [-1.0, 0.935], [-1.15, 0.875], [-1.25, 0.82]], 0.04),
  wB: designCurve([[1.10, 0.54], [0.9, 0.62], [0.6, 0.675], [0.2, 0.695], [-0.2, 0.69], [-0.5, 0.655], [-0.8, 0.57], [-1.05, 0.46], [-1.25, 0.36]], 0.05),
  n: designCurve([[1.1, 2.0], [0.6, 2.3], [-0.2, 2.5], [-0.8, 2.4], [-1.25, 2.1]], 0.05),
};
function canopyPoint(X, phi, side) {
  const yR = CC.yR(X), wB = CC.wB(X), e = 2 / CC.n(X);
  const c = Math.max(0, Math.cos(phi)), s = Math.max(0, Math.sin(phi));
  return [X, CYB + (yR - CYB) * Math.pow(s, e), wB * Math.pow(c, e) * side];
}
const PHI_RAIL = 0.87;
const XB = (phi) => -0.56 - 0.24 * Math.pow(1 - Math.sin(phi), 1.4);
const XH = (psi) => 0.08 + 0.035 * (1 - psi * psi);
const XA = (phi) => lerp(0.95, 0.065, Math.pow(clamp((phi - 0.06) / 0.86, 0, 1), 1 / 0.85)); // A-pillar centreline

function buildCanopy() {
  // windshield: everything in front of the A-pillars and below the roof header
  const xRear = (phi) => {
    const psiR = (Math.PI / 2 - phi) / (Math.PI / 2 - PHI_RAIL);
    const xh = XH(Math.min(1, psiR));
    const xa = phi <= 0.92 ? XA(phi) : 0.065;
    return Math.max(xa, xh);
  };
  const wsP = (u, v) => {
    const psi = v * 2 - 1, side = psi < 0 ? -1 : 1;
    const phi = (Math.PI / 2) * (1 - Math.abs(psi));
    return canopyPoint(lerp(xRear(phi), CX1, u), phi, side);
  };
  const glass = new THREE.Mesh(patchGeometry(64, 96, wsP, null), M.glass);
  glass.renderOrder = 2;
  car.add(glass);
  REFL_HIDE.push(glass);
  BODY.glass = glass;
  // side windows travel with the doors (parented in buildDoors)
  BODY.doorGlass = {};
  for (const side of [-1, 1]) {
    const dgP = (u, v) => { const phi = lerp(0.20, PHI_RAIL, u); return canopyPoint(lerp(XB(phi), XA(phi), v), phi, side); };
    const g = new THREE.Mesh(patchGeometry(28, 64, dgP, null, { flip: side < 0 }), M.glass);
    g.renderOrder = 2;
    BODY.doorGlass[side] = g;
    REFL_HIDE.push(g);
  }

  const OFF = 0.0032;
  const taper = (d) => 0.35 + 0.65 * sstep(0.0, 0.014, d);
  // roof + rear fairing (painted)
  const roofP = (u, v) => {
    const psi = v * 2 - 1, side = psi < 0 ? -1 : 1;
    const X = lerp(CX0, XH(psi), u);
    const phi = Math.PI / 2 - Math.abs(psi) * (Math.PI / 2 - PHI_RAIL);
    return canopyPoint(X, phi, side);
  };
  const xbRail = XB(PHI_RAIL);
  const roofOff = (u, v) => {
    const psi = v * 2 - 1;
    const X = lerp(CX0, XH(psi), u);
    const dFront = XH(psi) - X;
    const sideOpen = sstep(xbRail - 0.02, xbRail + 0.02, X);
    const dSide = lerp(1, (1 - Math.abs(psi)) * 0.42, sideOpen);
    return OFF * taper(Math.min(dFront, dSide));
  };
  const roof = new THREE.Mesh(patchGeometry(90, 60, roofP, roofOff, { flip: false }), M.paint);
  car.add(roof);
  BODY.roof = roof;
  for (const side of [-1, 1]) {
    const qP = (u, v) => {
      const phi = u * PHI_RAIL;
      const X = lerp(CX0, XB(phi), v);
      return canopyPoint(X, phi, side);
    };
    const qOff = (u, v) => { const phi = u * PHI_RAIL; const X = lerp(CX0, XB(phi), v); return OFF * taper(XB(phi) - X); };
    const q = new THREE.Mesh(patchGeometry(40, 70, qP, qOff, { flip: side < 0 }), M.paint);
    car.add(q);
    BODY['quarter' + side] = q;
  }
  // A-pillars
  for (const side of [-1, 1]) {
    const N = 48, across = [-1, -0.82, 0, 0.82, 1], offs = [0.0004, 0.0032, 0.0045, 0.0032, 0.0004];
    const rowsA = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const X = lerp(0.95, 0.065, t), phi = lerp(0.06, 0.92, Math.pow(t, 0.85));
      const p = canopyPoint(X, phi, side);
      const p2 = canopyPoint(X - 0.002, lerp(0.06, 0.92, Math.pow(Math.min(1, t + 0.002), 0.85)), side);
      const pa = canopyPoint(X, phi + 0.002, side), pb = canopyPoint(X + 0.002, phi, side);
      const T = new V3(p2[0] - p[0], p2[1] - p[1], p2[2] - p[2]).normalize();
      const Nn = new V3().crossVectors(new V3(pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]), new V3(pb[0] - p[0], pb[1] - p[1], pb[2] - p[2])).normalize();
      if (Nn.y < 0 && Math.abs(Nn.z) < 0.5) Nn.negate();
      if (Math.sign(Nn.z) !== side && Math.abs(Nn.z) > 0.2) Nn.negate();
      const Bv = new V3().crossVectors(Nn, T).normalize();
      const w = 0.028;
      const row = across.map((s, k) => [p[0] + Bv.x * s * w + Nn.x * offs[k], p[1] + Bv.y * s * w + Nn.y * offs[k], p[2] + Bv.z * s * w + Nn.z * offs[k]]);
      rowsA.push(side > 0 ? row : row.slice().reverse());
    }
    const g = gridGeometry(rowsA);
    // ensure outward normals
    const nrm = g.attributes.normal; let sz = 0;
    for (let k = 0; k < nrm.count; k++) sz += nrm.getZ(k);
    if (Math.sign(sz) !== side) { const idx = g.index.array; for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; } g.computeVertexNormals(); }
    car.add(new THREE.Mesh(g, M.pillar || (M.pillar = Object.assign(M.blackGloss.clone(), { side: THREE.DoubleSide }))));
  }
}

/* =========================================================================
   DOORS — cut from the lofted skin along four planes, hinged butterfly-style
   ========================================================================= */
const DOOR = { X0: 0.93, Y0: 0.325, R0x: -0.06, R0y: 0.325, Z0: 0.585, T: 0.045 };
const DN3 = [0.7336, 0.6795];               // normal of the slanted rear cut
const HINGE = { x: 0.90, y: 0.72, z: 0.84, ax: [-0.40, 0.86, -0.32], angle: 1.12 };
const DOORS = {};
const doorF = (side) => [
  (p) => DOOR.X0 - p[0],
  (p) => p[1] - DOOR.Y0,
  (p) => (p[0] - DOOR.R0x) * DN3[0] + (p[1] - DOOR.R0y) * DN3[1],
  (p) => p[2] * side - DOOR.Z0,
];

function vlerp(A, B, t) {
  return {
    p: [A.p[0] + (B.p[0] - A.p[0]) * t, A.p[1] + (B.p[1] - A.p[1]) * t, A.p[2] + (B.p[2] - A.p[2]) * t],
    n: [A.n[0] + (B.n[0] - A.n[0]) * t, A.n[1] + (B.n[1] - A.n[1]) * t, A.n[2] + (B.n[2] - A.n[2]) * t],
    u: [A.u[0] + (B.u[0] - A.u[0]) * t, A.u[1] + (B.u[1] - A.u[1]) * t], i: -1,
  };
}
// keep = 1 keeps f >= 0, keep = -1 keeps f <= 0
function clipBy(poly, f, keep) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length];
    const fa = f(A.p) * keep, fb = f(B.p) * keep;
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) out.push(vlerp(A, B, fa / (fa - fb)));
  }
  return out;
}

// Weld a triangle soup by position and return its open (boundary) edges
function boundaryEdges(P, N) {
  const map = new Map(), verts = [], tri = [];
  for (let i = 0; i < P.length / 3; i++) {
    const key = Math.round(P[i * 3] * 2e4) + '|' + Math.round(P[i * 3 + 1] * 2e4) + '|' + Math.round(P[i * 3 + 2] * 2e4);
    let id = map.get(key);
    if (id === undefined) { id = verts.length; map.set(key, id); verts.push({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] }); }
    tri.push(id);
  }
  const em = new Map();
  for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = tri[t + e], b = tri[t + (e + 1) % 3];
    if (a === b) continue;
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    const r = em.get(k);
    if (r) r.c++; else em.set(k, { a, b, c: 1 });
  }
  const edges = [];
  for (const r of em.values()) if (r.c === 1) edges.push(r);
  return { verts, edges };
}

function splitDoors() {
  const geo = BODY.skin.geometry;
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, uva = geo.attributes.uv.array;
  const idx = geo.index.array;
  const P = Array.from(pos), N = Array.from(nrm), U = Array.from(uva);
  const paint = [], inner = [];
  const door = { 1: { P: [], N: [], U: [] }, [-1]: { P: [], N: [], U: [] } };
  const V = (i) => ({ p: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]], n: [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], u: [uva[i * 2], uva[i * 2 + 1]], i });
  const addV = (v) => {
    if (v.i >= 0) return v.i;
    const id = P.length / 3, l = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
    P.push(v.p[0], v.p[1], v.p[2]); N.push(v.n[0] / l, v.n[1] / l, v.n[2] / l); U.push(v.u[0], v.u[1]);
    v.i = id; return id;
  };
  const emitBody = (poly, list) => { const ids = poly.map(addV); for (let k = 1; k < ids.length - 1; k++) list.push(ids[0], ids[k], ids[k + 1]); };
  const emitDoor = (side, poly) => {
    const D = door[side];
    for (let k = 1; k < poly.length - 1; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
      const l = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
      D.P.push(v.p[0], v.p[1], v.p[2]); D.N.push(v.n[0] / l, v.n[1] / l, v.n[2] / l); D.U.push(v.u[0], v.u[1]);
    }
  };
  const fr = (x, y) => (x - DOOR.R0x) * DN3[0] + (y - DOOR.R0y) * DN3[1];
  for (const g of geo.groups) {
    for (let t = g.start; t < g.start + g.count; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const keep = g.materialIndex === 0 ? paint : inner;
      const xa = pos[a * 3], xb = pos[b * 3], xc = pos[c * 3];
      const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yc = pos[c * 3 + 1];
      const za = pos[a * 3 + 2], zb = pos[b * 3 + 2], zc = pos[c * 3 + 2];
      const side = za + zb + zc >= 0 ? 1 : -1;
      if ((xa > DOOR.X0 && xb > DOOR.X0 && xc > DOOR.X0) || (ya < DOOR.Y0 && yb < DOOR.Y0 && yc < DOOR.Y0) ||
          (za * side < DOOR.Z0 && zb * side < DOOR.Z0 && zc * side < DOOR.Z0) || (fr(xa, ya) < 0 && fr(xb, yb) < 0 && fr(xc, yc) < 0)) {
        keep.push(a, b, c); continue;
      }
      let poly = [V(a), V(b), V(c)];
      for (const f of doorF(side)) {
        if (poly.every((v) => f(v.p) >= 0)) continue;
        const o = clipBy(poly, f, -1);
        if (o.length >= 3) emitBody(o, keep);
        poly = clipBy(poly, f, 1);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) emitDoor(side, poly);
    }
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  ng.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  ng.setIndex(paint.concat(inner));
  ng.addGroup(0, paint.length, 0);
  ng.addGroup(paint.length, inner.length, 1);
  geo.dispose();
  BODY.skin.geometry = ng;
  return door;
}

function soupGeometry(P, N, U) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (U) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  if (!N) g.computeVertexNormals();
  return g;
}

function buildDoors() {
  const parts = splitDoors();
  const T = DOOR.T;
  for (const side of [-1, 1]) {
    const D = parts[side];
    const skin = new THREE.Mesh(soupGeometry(D.P, D.N, D.U), M.paint);
    // inner door card: the skin pushed inward, winding reversed
    const ip = [], inn = [];
    for (let i = 0; i < D.P.length; i += 9) for (const k of [0, 2, 1]) {
      const o = i + k * 3;
      ip.push(D.P[o] - D.N[o] * T, D.P[o + 1] - D.N[o + 1] * T, D.P[o + 2] - D.N[o + 2] * T);
      inn.push(-D.N[o], -D.N[o + 1], -D.N[o + 2]);
    }
    const card = new THREE.Mesh(soupGeometry(ip, inn), M.doorCard);
    // carbon edge band closing skin and card
    const { verts, edges } = boundaryEdges(D.P, D.N);
    const bp = [], bu = [];
    for (const e of edges) {
      const A = verts[e.a], B = verts[e.b];
      const A2 = [A.p[0] - A.n[0] * T, A.p[1] - A.n[1] * T, A.p[2] - A.n[2] * T];
      const B2 = [B.p[0] - B.n[0] * T, B.p[1] - B.n[1] * T, B.p[2] - B.n[2] * T];
      bp.push(...A.p, ...B.p, ...B2, ...A.p, ...B2, ...A2);
      for (const q of [A.p, B.p, B2, A.p, B2, A2]) bu.push(q[0] + q[2], q[1]);
    }
    const band = new THREE.Mesh(soupGeometry(bp, null, bu), M.jamb);
    const pivot = new THREE.Group();
    const H = new V3(HINGE.x, HINGE.y, HINGE.z * side);
    pivot.position.copy(H);
    const content = new THREE.Group();
    content.position.copy(H).negate();
    content.add(skin, card, band);
    if (BODY.doorGlass && BODY.doorGlass[side]) content.add(BODY.doorGlass[side]);
    pivot.add(content);
    car.add(pivot);
    const axis = new V3(HINGE.ax[0], HINGE.ax[1], HINGE.ax[2] * side).normalize();
    DOORS[side] = { pivot, content, skin, card, axis, angle: HINGE.angle * side };
  }
  buildJambs();
  car.updateMatrixWorld(true);
}

// Carbon aperture around the opening, so an open door shows a finished frame and sill
function buildJambs() {
  const geo = BODY.skin.geometry;
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array, idx = geo.index.array;
  const P = [], N = [];
  for (let t = 0; t < idx.length; t += 3) {
    let near = true;
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k], x = pos[i * 3], y = pos[i * 3 + 1], z = Math.abs(pos[i * 3 + 2]);
      if (x < -0.75 || x > 0.97 || y < 0.29 || z < 0.55) { near = false; break; }
    }
    if (!near) continue;
    for (let k = 0; k < 3; k++) { const i = idx[t + k]; P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); N.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]); }
  }
  const { verts, edges } = boundaryEdges(P, N);
  const onPlane = (v, k) => Math.abs(doorF(v.p[2] >= 0 ? 1 : -1)[k](v.p)) < 3e-5;
  const target = (v, k) => {
    if (k === 3) return [v.p[0], v.p[1] - 0.05, v.p[2]];
    const side = v.p[2] >= 0 ? 1 : -1;
    const s = sstep(0.35, 0.7, Math.abs(v.n[2]));
    const down = [v.p[0] - v.n[0] * 0.05, v.p[1] - v.n[1] * 0.05, v.p[2] - v.n[2] * 0.05];
    return [lerp(down[0], v.p[0], s), lerp(down[1], v.p[1], s), lerp(down[2], side * 0.60, s)];
  };
  const bp = [], bu = [];
  for (const e of edges) {
    const A = verts[e.a], B = verts[e.b];
    let plane = -1;
    for (let k = 0; k < 4 && plane < 0; k++) if (onPlane(A, k) && onPlane(B, k)) plane = k;
    if (plane < 0) continue;
    const A2 = target(A, plane), B2 = target(B, plane);
    bp.push(...A.p, ...B.p, ...B2, ...A.p, ...B2, ...A2);
    for (const q of [A.p, B.p, B2, A.p, B2, A2]) bu.push(q[0] + q[2], q[1]);
  }
  if (bp.length) car.add(new THREE.Mesh(soupGeometry(bp, null, bu), M.jamb));
}

/* =========================================================================
   WHEELS
   ========================================================================= */
function makeTireProfile(R, hw, rimR) {
  const sw = R - rimR, gw = 0.0115, gd = 0.0075;
  const outer = [
    [rimR + 0.004, hw * 0.80], [rimR + 0.012, hw * 0.865], [rimR + sw * 0.22, hw * 0.94],
    [rimR + sw * 0.42, hw * 0.985], [rimR + sw * 0.6, hw * 1.0], [rimR + sw * 0.78, hw * 0.985],
    [R - 0.02, hw * 0.955], [R - 0.009, hw * 0.93], [R - 0.0025, hw * 0.895], [R, hw * 0.86],
  ];
  const tread = [];
  const grooves = [0.62, 0.22];
  let w = hw * 0.86;
  for (const g of grooves) {
    const gc = g * hw;
    tread.push([R, gc + gw / 2], [R - gd, gc + gw / 2 - 0.0012], [R - gd, gc - gw / 2 + 0.0012], [R, gc - gw / 2]);
  }
  tread.push([R, 0.0]);
  const half = outer.concat(tread); // from outer bead to centre (w decreasing)
  const full = half.map(p => [p[0], -p[1]]).concat(half.slice(0, -1).reverse()); // inner bead -> outer bead (w increasing)
  return full;
}

function tireTextTexture(text1, text2) {
  return canvasTex(4096, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const off of [0, w / 2]) {
      ctx.fillStyle = 'rgba(238,238,232,1)';
      setFont(ctx, 800, 128, 'expanded');
      ctx.fillText(text1, off + 620, h * 0.54);
      ctx.fillStyle = 'rgba(200,200,196,1)';
      setFont(ctx, 600, 58, 'normal');
      ctx.fillText(text2, off + 1560, h * 0.54);
    }
  });
}

function discTexture() {
  return canvasTex(1024, 1024, (ctx, w) => {
    const c = w / 2;
    const g = ctx.createRadialGradient(c, c, c * 0.55, c, c, c);
    g.addColorStop(0, '#5a5654'); g.addColorStop(0.5, '#4a4644'); g.addColorStop(1, '#3d3a39');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    // carbon-ceramic speckle
    for (let i = 0; i < 9000; i++) {
      const a = rand() * Math.PI * 2, r = c * (0.6 + rand() * 0.4);
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '20,20,20' : '120,115,110'},${0.15 + rand() * 0.2})`;
      ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 2, 2);
    }
    // spiral drilled holes
    const rows = 3, per = 36;
    for (let k = 0; k < per; k++) for (let j = 0; j < rows; j++) {
      const a = (k / per) * Math.PI * 2 + j * 0.055;
      const r = c * (0.70 + j * 0.095);
      ctx.fillStyle = '#0b0b0b';
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(140,135,130,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    }
    // pad wear ring
    ctx.strokeStyle = 'rgba(160,155,150,0.10)'; ctx.lineWidth = c * 0.33;
    ctx.beginPath(); ctx.arc(c, c, c * 0.79, 0, Math.PI * 2); ctx.stroke();
  });
}

function caliperLogoTexture(text) {
  return canvasTex(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 800 84px "Archivo", "Arial Black", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  });
}

let TIRE_TEX = null, DISC_TEX = null, CAL_TEX = null, TIRE_TEX_M = null, CAL_TEX_M = null, DISC_GLOW = null, BLUR_TEX = null;
const WHEEL_OBJS = [];
const FRONT_PIVOTS = [];
const WHEEL_DESIGN_IDS = ['yspoke', 'ten', 'turbine', 'mesh'];

// Spoke arms for each design: angle, width and depth as functions of radial position t (0 hub → 1 rim)
function spokeArms(design) {
  const arms = [];
  if (design === 'yspoke') {
    for (let k = 0; k < 5; k++) for (const s of [-1, 1]) arms.push({
      th: (t) => (k / 5) * Math.PI * 2 + s * (0.045 + 0.20 * Math.pow(t, 1.25)) + 0.06 * t * t,
      w: (t) => lerp(0.032, 0.021, Math.pow(t, 0.7)) + 0.018 * sstep(0.82, 1.0, t) + 0.012 * (1 - sstep(0.0, 0.15, t)),
      d: (t) => lerp(0.034, 0.026, t), dz: 0,
    });
  } else if (design === 'ten') {
    for (let k = 0; k < 10; k++) arms.push({
      th: (t) => (k / 10) * Math.PI * 2 + 0.02 * t,
      w: (t) => lerp(0.027, 0.019, Math.pow(t, 0.8)) + 0.016 * sstep(0.84, 1.0, t) + 0.006 * (1 - sstep(0.0, 0.12, t)),
      d: (t) => lerp(0.033, 0.025, t), dz: 0,
    });
  } else if (design === 'turbine') {
    for (let k = 0; k < 14; k++) arms.push({
      th: (t) => (k / 14) * Math.PI * 2 + 0.62 * Math.pow(t, 1.15),
      w: (t) => lerp(0.019, 0.013, t) + 0.010 * sstep(0.86, 1.0, t),
      d: (t) => lerp(0.030, 0.020, t), dz: 0,
    });
  } else {
    for (let k = 0; k < 10; k++) for (const s of [-1, 1]) arms.push({
      th: (t) => (k / 10) * Math.PI * 2 + s * 0.30 * t,
      w: (t) => lerp(0.016, 0.012, t) + 0.009 * sstep(0.88, 1.0, t) + 0.004 * (1 - sstep(0.0, 0.1, t)),
      d: (t) => lerp(0.026, 0.020, t), dz: s * 0.0025,
    });
  }
  return arms;
}

function buildSpokes(ax, design) {
  const rimR = ax.rim, hr = ax.rimW / 2;
  const r0 = 0.072, r1 = rimR - 0.006, zFaceRim = hr - 0.004;
  const section = [[-1, 0], [-0.82, 0.004], [0.82, 0.004], [1, 0], [0.86, -0.75], [0.62, -1], [-0.62, -1], [-0.86, -0.75]];
  const geos = [];
  for (const arm of spokeArms(design)) {
    const rowsS = [];
    const NT = 22;
    for (let i = 0; i <= NT; i++) {
      const t = i / NT, r = lerp(r0, r1, t);
      const t2 = Math.min(1, t + 0.01), r2 = lerp(r0, r1, t2);
      const th = arm.th(t), th2 = arm.th(t2);
      const zf = zFaceRim - ax.concave * Math.pow(1 - t, 1.5) - 0.002 + arm.dz;
      const width = arm.w(t), depth = arm.d(t);
      const C = new V3(r * Math.cos(th), r * Math.sin(th), zf);
      const dir = new V3(r2 * Math.cos(th2) - C.x, r2 * Math.sin(th2) - C.y, 0);
      if (dir.lengthSq() < 1e-12 || t2 === t) dir.set(Math.cos(th), Math.sin(th), 0);
      dir.normalize();
      const Tn = new V3(-dir.y, dir.x, 0);
      const row = section.map(([sx, sz]) => [C.x + Tn.x * sx * width / 2, C.y + Tn.y * sx * width / 2, C.z + sz * depth]);
      row.push(row[0]);
      rowsS.push(row);
    }
    geos.push(gridGeometry(rowsS, { uFn: (i, j, p) => p[0], vFn: (i, j, p) => p[1] }));
  }
  const g = mergeGeometries(geos);
  const nrm = g.attributes.normal;
  let acc = 0;
  for (let i = 0; i < nrm.count; i += 7) acc += nrm.getZ(i);
  if (acc < 0) flipWinding(g);
  return g;
}

function discGlowTexture() {
  return canvasTex(512, 512, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, c * 0.6, c, c, c);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.12, 'rgba(150,120,100,1)'); g.addColorStop(0.55, 'rgba(255,255,255,1)');
    g.addColorStop(0.93, 'rgba(255,225,190,1)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    for (let k = 0; k < 36; k++) for (let j = 0; j < 3; j++) {
      const a = (k / 36) * Math.PI * 2 + j * 0.055, r = c * (0.70 + j * 0.095);
      ctx.beginPath(); ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function wheelBlurTexture() {
  return canvasTex(512, 512, (ctx, w) => {
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0.0, 'rgba(255,255,255,0)'); g.addColorStop(0.27, 'rgba(255,255,255,0)');
    g.addColorStop(0.33, 'rgba(240,240,240,0.9)'); g.addColorStop(0.55, 'rgba(205,205,205,0.66)');
    g.addColorStop(0.86, 'rgba(215,215,215,0.7)'); g.addColorStop(0.96, 'rgba(255,255,255,0.92)'); g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 48; i++) {
      const r = c * (0.32 + 0.66 * rand());
      ctx.strokeStyle = `rgba(255,255,255,${0.04 + 0.08 * rand()})`; ctx.lineWidth = 1 + rand() * 2.5;
      ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    }
  });
}

function makeWheel(ax, mirrored = false) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const R = ax.R, hw = ax.w / 2, rimR = ax.rim, hr = ax.rimW / 2;
  spin.add(new THREE.Mesh(lathe(makeTireProfile(R, hw, rimR), 96), M.rubber));
  const sw = R - rimR;
  const band = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8, r = lerp(rimR + sw * 0.18, rimR + sw * 0.86, t);
    band.push([r, hw * (0.94 + 0.06 * Math.sin(Math.PI * clamp((r - rimR) / sw / 0.95, 0, 1))) + 0.0012]);
  }
  const letters = new THREE.Mesh(lathe(band.slice().reverse(), 128), new THREE.MeshStandardMaterial({ map: mirrored ? TIRE_TEX_M : TIRE_TEX, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  spin.add(letters);
  spin.add(new THREE.Mesh(lathe([[rimR - 0.012, hr + 0.004], [rimR + 0.004, hr + 0.006], [rimR + 0.016, hr + 0.005], [rimR + 0.021, hr + 0.001], [rimR + 0.022, hr - 0.006], [rimR + 0.016, hr - 0.012]].reverse(), 128), M.rimLip));
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(rimR - 0.012, rimR - 0.012, ax.rimW, 96, 1, true).rotateX(Math.PI / 2), M.rimBarrel));
  const designs = {};
  for (const id of WHEEL_DESIGN_IDS) {
    const m = new THREE.Mesh(buildSpokes(ax, id), M.rim);
    m.visible = id === 'yspoke';
    designs[id] = m;
    spin.add(m);
  }
  const zFaceRim = hr - 0.004, hubZ = zFaceRim - ax.concave - 0.004;
  spin.add(new THREE.Mesh(lathe([[0.0, hubZ + 0.012], [0.05, hubZ + 0.012], [0.07, hubZ + 0.004], [0.086, hubZ - 0.01], [0.086, hubZ - 0.04]].reverse(), 64), M.rim));
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.046, 0.032, 6, 1).rotateX(Math.PI / 2), M.chrome);
  nut.position.z = hubZ + 0.026; nut.rotation.z = 0.3;
  spin.add(nut);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.02, 40).rotateX(Math.PI / 2), M.caliper);
  cap.position.z = hubZ + 0.046;
  spin.add(cap);
  const dz = -0.012, th = 0.036, rIn = 0.128, rOut = ax.disc;
  spin.add(new THREE.Mesh(lathe([[rIn, dz - th], [rOut, dz - th], [rOut, dz], [rIn, dz]].reverse(), 96), M.darkMetal));
  const discFace = new THREE.Mesh(new THREE.RingGeometry(rIn, rOut, 96, 1), M.discFace);
  discFace.position.z = dz + 0.0006;
  {
    const p = discFace.geometry.attributes.position, uv = discFace.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * rOut) + 0.5, p.getY(i) / (2 * rOut) + 0.5);
  }
  spin.add(discFace);
  spin.add(new THREE.Mesh(lathe([[0.06, dz + 0.004], [rIn + 0.004, dz + 0.004], [rIn + 0.004, dz - 0.012], [0.06, dz - 0.03]].reverse(), 64), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.85, roughness: 0.35 })));
  const blur = new THREE.Mesh(new THREE.CircleGeometry(rimR - 0.004, 72), M.blur);
  blur.position.z = hr - 0.0015;
  blur.visible = false;
  blur.renderOrder = 1;
  spin.add(blur);
  // fixed parts: caliper (trailing side), its logo, the upright
  const a0 = Math.PI - 0.62, a1 = Math.PI + 0.62, cr0 = rOut - 0.058, cr1 = rOut + 0.028;
  const shp = new THREE.Shape();
  shp.absarc(0, 0, cr1, a0, a1, false);
  shp.absarc(0, 0, cr0, a1, a0, true);
  const calGeo = new THREE.ExtrudeGeometry(shp, { depth: 0.052, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.009, bevelSegments: 4, curveSegments: 40 });
  calGeo.translate(0, 0, dz - th / 2 - 0.026);
  g.add(new THREE.Mesh(calGeo, M.caliper));
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), new THREE.MeshStandardMaterial({ map: mirrored ? CAL_TEX_M : CAL_TEX, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  logo.position.set(-(cr0 + cr1) / 2, 0, dz - th / 2 + 0.026 + 0.0095);
  logo.rotation.z = Math.PI / 2;
  g.add(logo);
  const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.08, 32).rotateX(Math.PI / 2), M.under);
  upright.position.z = dz - th - 0.05;
  g.add(upright);
  g.userData = { spin, designs, letters, blur, R };
  return g;
}

/* =========================================================================
   PART HELPERS
   ========================================================================= */
function signedVolume(g) {
  const p = g.attributes.position, idx = g.index ? g.index.array : null;
  const n = idx ? idx.length : p.count;
  let v = 0;
  const a = new V3(), b = new V3(), c = new V3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, idx ? idx[i] : i); b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1); c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
function flipWinding(g) {
  if (g.index) { const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.index.needsUpdate = true; }
  else { const p = g.attributes.position; for (let i = 0; i < p.count; i += 3) { for (const att of Object.values(g.attributes)) { const s = att.itemSize; for (let k = 0; k < s; k++) { const t = att.array[(i + 1) * s + k]; att.array[(i + 1) * s + k] = att.array[(i + 2) * s + k]; att.array[(i + 2) * s + k] = t; } att.needsUpdate = true; } } }
  g.computeVertexNormals();
  return g;
}
// closed loft along a path of rings, with fan caps; auto-orients outward
function loftClosed(rings, opts = {}) {
  const rows = rings.map(r => r.concat([r[0]]));
  let g = gridGeometry(rows, { uFn: opts.uFn || ((i, j, p) => p[0]), vFn: opts.vFn });
  g = g.toNonIndexed();
  const capOf = (ring) => {
    const c = [0, 0, 0];
    ring.forEach(p => { c[0] += p[0] / ring.length; c[1] += p[1] / ring.length; c[2] += p[2] / ring.length; });
    const pos = [], uv = [];
    for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; pos.push(...c, ...a, ...b); uv.push(c[2], c[1], a[2], a[1], b[2], b[1]); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    cg.computeVertexNormals();
    return cg;
  };
  const geos = [g];
  if (opts.caps !== false) {
    const dir0 = new V3(...rings[1][0]).sub(new V3(...rings[0][0]));
    const c0 = capOf(rings[0]);
    if (new V3().fromBufferAttribute(c0.attributes.normal, 0).dot(dir0) > 0) flipWinding(c0);
    const L = rings.length;
    const dir1 = new V3(...rings[L - 1][0]).sub(new V3(...rings[L - 2][0]));
    const c1 = capOf(rings[L - 1]);
    if (new V3().fromBufferAttribute(c1.attributes.normal, 0).dot(dir1) < 0) flipWinding(c1);
    geos.push(c0, c1);
  }
  const m = mergeGeometries(geos);
  // tube orientation: if inward, flip only the tube part by checking volume sign of tube+caps
  if (signedVolume(m) < 0) { flipWinding(m); }
  return m;
}
function extrudeXY(points, depth, z0, opts = {}) {
  const shp = new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shp, { depth, steps: opts.steps || 1, bevelEnabled: !!opts.bevel, bevelThickness: opts.bevel || 0, bevelSize: opts.bevel || 0, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, z0 - depth / 2);
  return g;
}

const raycaster = new THREE.Raycaster();
function hitBody(origin, dir) {
  raycaster.set(origin, dir.clone().normalize());
  raycaster.far = 10;
  const targets = [BODY.skin];
  for (const s of [-1, 1]) if (DOORS[s]) targets.push(DOORS[s].skin);
  const h = raycaster.intersectObjects(targets, false);
  return h.length ? h[0] : null;
}

// Fast decal projector (box projection, back-face rejected, polygon clipped)
function clipPoly(poly, axis, sgn, lim) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const da = lim - sgn * A.p[axis], db = lim - sgn * B.p[axis];
    if (da >= 0) out.push(A);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ p: [A.p[0] + (B.p[0] - A.p[0]) * t, A.p[1] + (B.p[1] - A.p[1]) * t, A.p[2] + (B.p[2] - A.p[2]) * t], n: [A.n[0] + (B.n[0] - A.n[0]) * t, A.n[1] + (B.n[1] - A.n[1]) * t, A.n[2] + (B.n[2] - A.n[2]) * t] });
    }
  }
  return out;
}
function projectDecal(mesh, center, normal, up, sx, sy, sz, minDot = 0.12) {
  const zA = normal.clone().normalize();
  const xA = new V3().crossVectors(up, zA).normalize();
  const yA = new V3().crossVectors(zA, xA).normalize();
  const geo = mesh.geometry, pos = geo.attributes.position, nrm = geo.attributes.normal;
  const N = pos.count, px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dx = pos.getX(i) - center.x, dy = pos.getY(i) - center.y, dz = pos.getZ(i) - center.z;
    px[i] = dx * xA.x + dy * xA.y + dz * xA.z; py[i] = dx * yA.x + dy * yA.y + dz * yA.z; pz[i] = dx * zA.x + dy * zA.y + dz * zA.z;
  }
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const idx = geo.index ? geo.index.array : null;
  const nIdx = idx ? idx.length : pos.count;
  const P = [], Nn = [], U = [];
  for (let t = 0; t < nIdx; t += 3) {
    const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
    if ((px[a] > hx && px[b] > hx && px[c] > hx) || (px[a] < -hx && px[b] < -hx && px[c] < -hx)) continue;
    if ((py[a] > hy && py[b] > hy && py[c] > hy) || (py[a] < -hy && py[b] < -hy && py[c] < -hy)) continue;
    if ((pz[a] > hz && pz[b] > hz && pz[c] > hz) || (pz[a] < -hz && pz[b] < -hz && pz[c] < -hz)) continue;
    const e1x = px[b] - px[a], e1y = py[b] - py[a], e1z = pz[b] - pz[a], e2x = px[c] - px[a], e2y = py[c] - py[a], e2z = pz[c] - pz[a];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const fl = Math.hypot(fx, fy, fz);
    if (fl < 1e-14 || fz / fl < minDot) continue;
    let poly = [a, b, c].map(i => ({ p: [px[i], py[i], pz[i]], n: [nrm.getX(i), nrm.getY(i), nrm.getZ(i)] }));
    const planes = [[0, 1, hx], [0, -1, hx], [1, 1, hy], [1, -1, hy], [2, 1, hz], [2, -1, hz]];
    for (const [ax, sg, lim] of planes) { poly = clipPoly(poly, ax, sg, lim); if (poly.length < 3) break; }
    if (poly.length < 3) continue;
    for (let k = 1; k < poly.length - 1; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
      const [u0, v0, w0] = v.p;
      P.push(center.x + xA.x * u0 + yA.x * v0 + zA.x * w0, center.y + xA.y * u0 + yA.y * v0 + zA.y * w0, center.z + xA.z * u0 + yA.z * v0 + zA.z * w0);
      const l = Math.hypot(v.n[0], v.n[1], v.n[2]) || 1;
      Nn.push(v.n[0] / l, v.n[1] / l, v.n[2] / l);
      U.push(u0 / sx + 0.5, v0 / sy + 0.5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
function decalMaterial(map, extra = {}) {
  return new THREE.MeshPhysicalMaterial(Object.assign({
    map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    roughness: 0.38, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03,
  }, extra));
}
const DECALS = [];
const TINTED = [];
function addDecal(mesh, center, normal, up, sx, sy, sz, mat, opts = {}) {
  const g = projectDecal(mesh, center, normal, up, sx, sy, sz, opts.minDot);
  if (!g.attributes.position.count) return null;
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = opts.order || 3;
  (opts.parent || car).add(m);
  if (opts.role) DECAL_ROLES[opts.role].push(m);
  return m;
}

/* =========================================================================
   DECAL / LIVERY TEXTURES
   ========================================================================= */
function setFont(ctx, weight, size, stretch = 'normal', style = '') {
  try { ctx.fontStretch = stretch; } catch (e) { /* older engines */ }
  ctx.font = `${style} ${weight} ${size}px "Archivo", "Arial Black", Arial, sans-serif`;
}
function roundelTex(num) {
  return canvasTex(512, 512, (ctx) => {
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = '#f3f3ee'; ctx.beginPath(); ctx.arc(256, 256, 248, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c8102e'; ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(256, 256, 226, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#0d0f14'; setFont(ctx, 800, 300, 'semi-condensed'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num, 256, 272);
  });
}
function wordmarkTex(text, color = '#f2f2ee', w = 2048, h = 256, size = 190, stretch = 'expanded') {
  return canvasTex(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color; setFont(ctx, 800, size, stretch, 'italic');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + size * 0.04);
  });
}
function speedBarsTex() {
  return canvasTex(512, 256, (ctx) => {
    ctx.clearRect(0, 0, 512, 256);
    const cols = ['#f3f3ee', '#f3f3ee', '#c8102e'];
    cols.forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath();
      const x = 60 + i * 120;
      ctx.moveTo(x + 70, 20); ctx.lineTo(x + 160, 20); ctx.lineTo(x + 90, 236); ctx.lineTo(x, 236); ctx.closePath(); ctx.fill();
    });
  });
}
function bannerTex() {
  return canvasTex(2048, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(6,8,12,0.96)'); g.addColorStop(0.72, 'rgba(6,8,12,0.9)'); g.addColorStop(1, 'rgba(6,8,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee'; setFont(ctx, 800, 118, 'expanded', 'italic');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H A L C Y O N', w / 2, h * 0.40);
  });
}
function intakeTex(pathFn, w = 1024, h = 512, cell = 13) {
  return canvasTex(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save(); pathFn(ctx, w, h); ctx.clip();
    drawHoneycomb(ctx, 0, 0, w, h, cell, '#24262b', '#040405');
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.35, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.restore();
    ctx.save(); pathFn(ctx, w, h); ctx.lineWidth = 10; ctx.strokeStyle = '#0a0a0b'; ctx.stroke(); ctx.restore();
  });
}
function louverTex(w = 1024, h = 512, slats = 9, pathFn = null) {
  return canvasTex(w, h, (ctx) => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    if (pathFn) { pathFn(ctx, w, h); ctx.clip(); }
    ctx.fillStyle = '#050506'; ctx.fillRect(0, 0, w, h);
    const sh = h / slats;
    for (let i = 0; i < slats; i++) {
      const y = i * sh;
      const g = ctx.createLinearGradient(0, y, 0, y + sh);
      g.addColorStop(0, '#000000'); g.addColorStop(0.55, '#141519'); g.addColorStop(0.82, '#3a3c42'); g.addColorStop(0.9, '#0c0c0e'); g.addColorStop(1, '#000000');
      ctx.fillStyle = g; ctx.fillRect(0, y + sh * 0.08, w, sh * 0.84);
    }
    ctx.restore();
  });
}
function roundRectPath(x, y, w, h, r) {
  return (ctx) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
}
function headlightTex(emissive) {
  return canvasTex(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const outline = () => { ctx.beginPath(); ctx.moveTo(40, 40); ctx.lineTo(1000, 70); ctx.quadraticCurveTo(1012, 140, 960, 196); ctx.lineTo(150, 226); ctx.quadraticCurveTo(30, 200, 40, 40); ctx.closePath(); };
    if (!emissive) {
      outline();
      const g = ctx.createLinearGradient(0, 40, 0, 226);
      g.addColorStop(0, '#2a2d33'); g.addColorStop(0.5, '#0b0c0f'); g.addColorStop(1, '#1b1d22');
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 8; ctx.strokeStyle = '#050506'; ctx.stroke();
      // projector modules
      for (const cx of [610, 735, 860]) {
        const rg = ctx.createRadialGradient(cx - 8, 128, 4, cx, 136, 46);
        rg.addColorStop(0, '#dfe6f0'); rg.addColorStop(0.35, '#59606b'); rg.addColorStop(0.7, '#15171b'); rg.addColorStop(1, '#2c3036');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, 138, 44, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 3; ctx.stroke();
      }
    }
    // DRL blade (also lit in emissive map)
    ctx.fillStyle = emissive ? '#ffffff' : '#d9dee6';
    ctx.beginPath(); ctx.moveTo(70, 62); ctx.lineTo(980, 88); ctx.lineTo(976, 100); ctx.lineTo(80, 80); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(80, 80); ctx.lineTo(96, 80); ctx.lineTo(180, 206); ctx.lineTo(160, 208); ctx.closePath(); ctx.fill();
    if (emissive) {
      for (const cx of [610, 735, 860]) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(cx, 138, 26, 0, Math.PI * 2); ctx.fill(); }
    }
  }, { srgb: true });
}
function grilleTileTex() {
  const t = canvasTex(256, 256, (ctx) => drawHoneycomb(ctx, 0, 0, 256, 256, 256 / (Math.sqrt(3) * 4), '#1f2125', '#020203'), { repeat: true });
  t.repeat.set(9, 9);
  return t;
}
function screenTex() {
  return canvasTex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(256, 150, 100, Math.PI * 0.8, Math.PI * 2.2); ctx.stroke();
    ctx.strokeStyle = '#ff2a3c'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(256, 150, 100, Math.PI * 0.8, Math.PI * 1.55); ctx.stroke();
    ctx.fillStyle = '#e8eef6'; setFont(ctx, 800, 72, 'normal'); ctx.textAlign = 'center'; ctx.fillText('0', 256, 172);
    setFont(ctx, 600, 22, 'expanded'); ctx.fillStyle = '#7f8b99'; ctx.fillText('KM/H', 256, 205);
    ctx.fillText('N', 80, 60); ctx.fillText('98°', 440, 60);
  });
}

/* =========================================================================
   AERO, MIRRORS, EXHAUSTS, LIGHTS, INTERIOR
   ========================================================================= */
function lipZ(X) { const s = sectionAt(X); return s.lipSkin[0][0]; }

function buildAero() {
  BODY.track = [];
  const PT = SPEC.parts;
  // ---- front splitter (follows the nose outline) ----
  const pts = [];
  const xsN = [];
  for (let X = SPL_X0; X <= XF - 0.004; X += 0.02) xsN.push(X);
  for (let X = XF - 0.004; X < XF; X += 0.001) xsN.push(X);
  for (const X of xsN) { const zl = lipZ(X); pts.push([X + PT.splitter.lip * sstep(XF - 0.45, XF - 0.05, X), zl + 0.028]); }
  pts.push([XF + PT.splitter.nose, 0]);
  const outline = [];
  pts.forEach(p => outline.push([p[0], -p[1]]));
  for (let i = pts.length - 1; i >= 0; i--) outline.push([pts[i][0], pts[i][1]]);
  const shp = new THREE.Shape(outline.map(p => new THREE.Vector2(p[0], p[1])));
  const sg = new THREE.ExtrudeGeometry(shp, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 });
  sg.rotateX(-Math.PI / 2);
  sg.translate(0, 0.068, 0);
  // rotateX(-90) maps shape y -> -z; our outline y is +/-z already symmetric, fine
  car.add(new THREE.Mesh(sg, M.carbon));
  // splitter vertical fences
  if (PT.fences) for (const side of [-1, 1]) {
    const zl = lipZ(XF - 0.5) + 0.02;
    const fg = extrudeXY([[XF - 0.54, 0.07], [XF - 0.32, 0.07], [XF - 0.38, 0.16], [XF - 0.52, 0.18]], 0.008, 0);
    fg.translate(0, 0, side * zl);
    const fm = new THREE.Mesh(fg, M.carbon);
    car.add(fm);
    BODY.track.push(fm);
  }

  // ---- front canards (dive planes) ----
  for (const side of [-1, 1]) {
    for (const [cy0, cx0, len, wid] of PT.canards) {
      const hit = hitBody(new V3(cx0, cy0, side * 2), new V3(0, 0, -side));
      if (!hit) continue;
      const zb = Math.abs(hit.point.z) - 0.02;
      const plan = [[cx0 + len * 0.5, zb], [cx0 - len * 0.5, zb], [cx0 - len * 0.32, zb + wid], [cx0 + len * 0.18, zb + wid * 0.92]];
      const shp = new THREE.Shape(plan.map(p => new THREE.Vector2(p[0], -p[1])));
      const g = new THREE.ExtrudeGeometry(shp, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
      g.rotateX(-Math.PI / 2);
      if (side < 0) g.scale(1, 1, -1);
      const m = new THREE.Mesh(g, M.carbon);
      m.position.y = cy0;
      m.rotation.z = -0.16;
      m.position.x = cx0 * (1 - Math.cos(0.16)) - cy0 * Math.sin(0.16) * 0.0;
      car.add(m);
      BODY.track.push(m);
    }
  }

  // ---- side skirts ----
  for (const side of [-1, 1]) {
    const rings = [];
    const x0 = SK0, x1 = SK1;
    for (let i = 0; i <= 70; i++) {
      const X = lerp(x0, x1, i / 70);
      const zl = lipZ(X);
      const taper = sstep(0, 0.12, (x0 - X)) * sstep(0, 0.12, X - x1);
      const out = 0.045 * (0.25 + 0.75 * taper);
      const prof = [[zl - 0.035, 0.064], [zl + out, 0.064], [zl + out + 0.006, 0.072], [zl + out * 0.3, 0.128], [zl - 0.035, 0.14]];
      rings.push(prof.map(([z, y]) => [X, y, side * z]));
    }
    car.add(new THREE.Mesh(loftClosed(side > 0 ? rings : rings.map(r => r.slice().reverse())), M.carbon));
  }

  // ---- rear diffuser strakes ----
  const xStr = XR + 0.74;
  for (const z0 of PT.strakes) {
    const top = [];
    for (let X = XR - 0.025; X <= xStr; X += 0.04) top.push([X, BC.yf(X) + 0.01]);
    const poly = [[xStr, 0.088], [XR - 0.025, 0.088]].concat(top);
    car.add(new THREE.Mesh(extrudeXY(poly, 0.008, z0), M.carbon));
  }

  // ---- rear wing on swan-neck pylons ----
  const wing = new THREE.Group();
  const { chord, span, xLE, yLE, aoa } = WING;
  // the H9's end plate and pylon, carried along with the leading edge and scaled with the chord
  const kW = chord / 0.33, rel = ([x, y]) => [xLE + (x + 1.83) * kW, yLE + (y - 1.115) * kW];
  const foil = [];
  const m = 0.065, pp = 0.42, t = 0.13, NP = 40;
  const upper = [], lower = [];
  for (let i = 0; i <= NP; i++) {
    const x = 0.5 - 0.5 * Math.cos(Math.PI * i / NP);
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < pp ? m / (pp * pp) * (2 * pp * x - x * x) : m / ((1 - pp) ** 2) * ((1 - 2 * pp) + 2 * pp * x - x * x);
    const dyc = x < pp ? 2 * m / (pp * pp) * (pp - x) : 2 * m / ((1 - pp) ** 2) * (pp - x);
    const th = Math.atan(dyc);
    upper.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lower.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  const toWorld = ([x, y]) => {
    const X = -x * chord, Y = -y * chord; // inverted camber
    const b = -aoa;
    return [xLE + X * Math.cos(b) - Y * Math.sin(b), yLE + X * Math.sin(b) + Y * Math.cos(b)];
  };
  for (let i = NP; i >= 0; i--) foil.push(toWorld(upper[i]));
  for (let i = 1; i < NP; i++) foil.push(toWorld(lower[i]));
  const wingGeo = extrudeXY(foil, span, 0);
  wing.add(new THREE.Mesh(wingGeo, M.carbon));
  const te = toWorld([1, 0]);
  const gurney = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, span), M.blackGloss);
  gurney.position.set(te[0] + 0.001, te[1] + 0.011, 0);
  wing.add(gurney);
  // upper flap element: angle follows deploy state and airbrake
  const fChord = WING.flap, flapFoil = [];
  const fpt = ([x, y]) => [-x * fChord, -y * fChord];
  for (let i = NP; i >= 0; i--) flapFoil.push(fpt(upper[i]));
  for (let i = 1; i < NP; i++) flapFoil.push(fpt(lower[i]));
  const flapPivot = new THREE.Group();
  flapPivot.position.set(te[0] + 0.03, te[1] + 0.036, 0);
  flapPivot.add(new THREE.Mesh(extrudeXY(flapFoil, span - 0.012, 0), M.carbon));
  flapPivot.rotation.z = -0.45;
  wing.add(flapPivot);
  BODY.flap = flapPivot;
  BODY.wingFoil = foil.map((p) => p.slice());
  BODY.flapFoil = flapFoil.map((p) => p.slice());
  BODY.flapPivotPos = [te[0] + 0.03, te[1] + 0.036];
  // end plates
  BODY.wingPlate = [[-1.79, 1.05], [-2.20, 1.03], [-2.27, 1.10], [-2.27, 1.27], [-2.16, 1.315], [-1.88, 1.20], [-1.785, 1.11]].map(rel);
  for (const side of [-1, 1]) {
    const ep = extrudeXY(BODY.wingPlate, 0.009, side * (span / 2 + 0.0045), { bevel: 0.002 });
    wing.add(new THREE.Mesh(ep, M.carbon));
  }
  // swan-neck pylons
  const bez = (t, p0, p1, p2, p3) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; };
  const P0 = WING.base || rel([-1.66, 0.70]), P1 = rel([-1.73, 1.06]), P2 = rel([-1.86, 1.30]), P3 = rel([-2.0, 1.165]);
  const cl = [];
  for (let i = 0; i <= 40; i++) cl.push(bez(i / 40, P0, P1, P2, P3));
  const left = [], right = [];
  for (let i = 0; i <= 40; i++) {
    const a = cl[Math.max(0, i - 1)], b = cl[Math.min(40, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); tx /= l; ty /= l;
    const w = lerp(0.062, 0.03, Math.pow(i / 40, 0.8));
    left.push([cl[i][0] - ty * w / 2, cl[i][1] + tx * w / 2]);
    right.push([cl[i][0] + ty * w / 2, cl[i][1] - tx * w / 2]);
  }
  const pyl = left.concat(right.reverse());
  BODY.wingPylon = pyl;
  for (const side of [-1, 1]) wing.add(new THREE.Mesh(extrudeXY(pyl, 0.016, side * WING.pylonZ, { bevel: 0.003 }), M.carbon));
  car.add(wing);
  BODY.wing = wing;
  BODY.wingRel = rel;
}

// top of the bodywork on the centre line: canopy where there is one, the deck behind it
const topY = (X) => Math.max(canopyTop(X, 0), BC.cy(X));
// race-car parts some models carry: a roof scoop feeding the engine, a fin down the spine to the wing
function buildExtras() {
  const SC = SPEC.parts.scoop, FN = SPEC.parts.fin;
  if (SC) {
    const { x0, x1, w, h } = SC, N = 48, rings = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, X = lerp(x0, x1, u);
      // full height behind the lip, then down into the engine cover; it narrows as it goes
      const hh = h * (0.86 + 0.14 * sstep(0, 0.12, u)) * (1 - sstep(0.3, 1, u)) + 0.012, ww = w * lerp(1, 0.55, sstep(0.2, 1, u));
      const base = topY(X) - 0.03, ring = [];
      for (let k = 0; k <= 20; k++) { const th = Math.PI * k / 20; ring.push([X, base + 0.03 + hh * Math.pow(Math.sin(th), 0.8), ww * Math.cos(th)]); }
      ring.push([X, base, -ww], [X, base, ww]);
      rings.push(ring);
    }
    car.add(new THREE.Mesh(loftClosed(rings), M.paint));
    // the mouth
    const mouth = new THREE.Shape();
    const y0 = topY(x0) + 0.006, hm = h * 0.86 - 0.016, wm = w - 0.018;
    mouth.moveTo(wm, y0);
    for (let k = 1; k <= 20; k++) { const th = Math.PI * k / 20; mouth.lineTo(wm * Math.cos(th), y0 + hm * Math.pow(Math.sin(th), 0.8)); }
    const mg = new THREE.ShapeGeometry(mouth, 4).rotateY(Math.PI / 2).translate(x0 + 0.0015, 0, 0);
    car.add(new THREE.Mesh(mg, M.under));
  }
  if (FN) {
    const { x0, x1, y } = FN, top = [], bot = [];
    for (let i = 0; i <= 30; i++) {
      const u = i / 30, X = lerp(x0, x1, u);
      // rises out of the scoop, runs level, ends square under the wing
      top.push([X, Math.max(topY(X), lerp(topY(x0), y, sstep(0, 0.42, u)) - 0.02 * u)]);
      bot.push([X, topY(X) - 0.04]);
    }
    const poly = top.concat(bot.reverse());
    car.add(new THREE.Mesh(extrudeXY(poly, 0.012, 0, { bevel: 0.002 }), M.paint));
  }
}

function buildMirrors() {
  for (const side of [-1, 1]) {
    const tgt = DOORS[side] ? DOORS[side].content : car;
    const hc = new V3(0.60, 0.905, side * 0.995);
    const housing = new THREE.SphereGeometry(1, 48, 24, Math.PI / 2, Math.PI);
    housing.scale(0.10, 0.042, 0.112);
    housing.translate(hc.x, hc.y, hc.z);
    const h = new THREE.Mesh(housing, M.paint);
    tgt.add(h);
    const glassG = new THREE.CircleGeometry(1, 48);
    glassG.scale(0.102, 0.036, 1);
    glassG.rotateY(-Math.PI / 2);
    glassG.translate(hc.x - 0.002, hc.y, hc.z);
    tgt.add(new THREE.Mesh(glassG, M.chrome));
    const rim = new THREE.TorusGeometry(1, 0.06, 8, 48);
    rim.scale(0.108, 0.041, 1);
    rim.rotateY(-Math.PI / 2);
    rim.translate(hc.x - 0.001, hc.y, hc.z);
    tgt.add(new THREE.Mesh(rim, M.blackGloss));
    // stalk
    const a = new V3(0.64, 0.745, side * 0.865), b = new V3(0.62, 0.885, side * 0.955);
    const len = a.distanceTo(b);
    const stalk = new THREE.Mesh(new RoundedBoxGeometry(0.075, len + 0.02, 0.014, 2, 0.005), M.carbon);
    stalk.position.copy(a).add(b).multiplyScalar(0.5);
    stalk.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize());
    tgt.add(stalk);
  }
}

function buildExhausts() {
  if (!M.ti) {
    const grad = canvasTex(4, 128, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#000'); g.addColorStop(0.45, '#555'); g.addColorStop(1, '#fff'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { srgb: false });
    M.ti = new THREE.MeshPhysicalMaterial({ color: 0xc9c4bc, metalness: 1.0, roughness: 0.2, iridescence: 0.85, iridescenceIOR: 1.7, iridescenceThicknessRange: [140, 470], iridescenceThicknessMap: grad });
    M.pipeIn = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
  }
  const E = SPEC.parts.exhaust;
  if (!E) return;
  const k = E.r;
  for (const z of E.z) {
    const tip = lathe([[0.050, -0.06], [0.064, -0.06], [0.066, -0.05], [0.066, 0.04], [0.058, 0.05], [0.052, 0.045], [0.052, -0.06]].map(([r, x]) => [r * k, x]), 64);
    tip.rotateY(Math.PI / 2);
    tip.translate(XR - 0.02, E.y, z);
    car.add(new THREE.Mesh(tip, M.ti));
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.052 * k, 40).rotateY(-Math.PI / 2), M.pipeIn);
    inner.position.set(XR + 0.02, E.y, z);
    car.add(inner);
  }
}

// straight at the nose along the centre plane. That plane is a seam of the mesh: a ray that slips through it
// (and lands in the cabin) is cast again just beside it
function hitNose(y) {
  let h = hitBody(new V3(XF + 0.8, y, 0), new V3(-1, 0, 0));
  if (!h || h.point.x < XF - 0.6) h = hitBody(new V3(XF + 0.8, y, 0.012), new V3(-1, 0, 0));
  if (h) h.point.setZ(0);
  return h;
}

function tailTopY(z) {
  // top contour of the tail ring at lateral position z
  const ring = BODY.tailRing;
  let best = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a[0] - z) * (b[0] - z) <= 0 && a[0] !== b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      best = Math.max(best, a[1] + (b[1] - a[1]) * t);
    }
  }
  return best;
}

function lightBarTex(emissive) {
  return canvasTex(1024, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // smoked housing, or only the lit blade for the emissive map
    if (!emissive) { ctx.fillStyle = '#07080a'; roundRectPath(4, 4, w - 8, h - 8, h * 0.45)(ctx); ctx.fill(); }
    ctx.fillStyle = emissive ? '#ffffff' : '#dfe6f0';
    roundRectPath(26, h * 0.36, w - 52, h * 0.28, h * 0.14)(ctx); ctx.fill();
  });
}
function buildLights() {
  const LS = SPEC.lights, TL = LS.tail;
  // ---- tail light bar on the Kamm face (one sweep, or two halves either side of a gap) ----
  const zmax = Math.max(...BODY.tailRing.map(p => p[0]));
  if (!M.tail) {
    M.tail = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff0a12, emissiveIntensity: 2.2, roughness: 0.3 });
    M.tailHousing = new THREE.MeshPhysicalMaterial({ color: 0x0b0203, roughness: 0.1, clearcoat: 1, side: THREE.DoubleSide });
  }
  const zEnd = zmax * TL.inset;
  for (const [z0, z1] of TL.gap > 0 ? [[-zEnd, -TL.gap], [TL.gap, zEnd]] : [[-zEnd, zEnd]]) {
    const ptsBar = [], N = TL.gap > 0 ? 30 : 60;
    for (let i = 0; i <= N; i++) {
      const z = lerp(z0, z1, i / N);
      ptsBar.push(new V3(XR - 0.004, tailTopY(z) - TL.drop - 0.035 * Math.pow(Math.abs(z) / zmax, 6), z));
    }
    const curve = new THREE.CatmullRomCurve3(ptsBar);
    car.add(new THREE.Mesh(new THREE.TubeGeometry(curve, N * 4, 0.0075, 8, false), M.tail));
    // smoked housing strip
    const sp = [], si = [];
    ptsBar.forEach((p, i) => { sp.push(p.x + 0.001, p.y + 0.024, p.z, p.x + 0.001, p.y - 0.024, p.z); if (i) { const k = i * 2; si.push(k - 2, k, k - 1, k - 1, k, k + 1); } });
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setIndex(si); sg.computeVertexNormals();
    car.add(new THREE.Mesh(sg, M.tailHousing));
  }
  // rain light in diffuser
  if (LS.rain) {
    const rain = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035).rotateY(-Math.PI / 2), M.tail);
    rain.position.set(XR - 0.008, LS.rain, 0);
    car.add(rain);
  }
  // rear lettering
  const lt = texOnce('rear-letters', () => wordmarkTex('HALCYON', '#ffffff', 2048, 256, 170, 'ultra-expanded'));
  if (!M.letters) M.letters = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.18, alphaMap: lt, transparent: true, depthWrite: false, envMapIntensity: 2.2 });
  const letters = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.08).rotateY(-Math.PI / 2), M.letters);
  letters.position.set(XR - 0.006, LS.letter, 0);
  car.add(letters);

  // ---- headlights (decals on the nose corners) ----
  M.headE = { value: 0 };
  M.headlights = [];
  const hlMap = texOnce('headlight', () => headlightTex(false)), hlEm = texOnce('headlight-e', () => headlightTex(true));
  const H = LS.head;
  for (const side of [-1, 1]) {
    const hit = hitBody(new V3(XF + 0.8, H.y, side * H.z), new V3(-1, 0, 0));
    if (!hit) continue;
    const n = hit.face.normal.clone().lerp(new V3(1, 0, side * 0.35), 0.5).normalize();
    const up = new V3(0, 1, 0);
    const mat = decalMaterial(hlMap, { emissiveMap: hlEm, emissive: new THREE.Color(0xdfeaff), emissiveIntensity: 2.5, roughness: 0.25, metalness: 0.4 });
    M.headlights.push(mat);
    const flipU = side < 0;
    const d = addDecal(BODY.skin, hit.point, n, up, H.w, H.h, 0.30, mat);
    if (d && flipU) { const uv = d.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  }
  // ---- a thin light blade across the nose ----
  if (LS.bar) {
    const hit = hitNose(LS.bar.y);
    if (hit) {
      const mat = decalMaterial(texOnce('lightbar', () => lightBarTex(false)), { emissiveMap: texOnce('lightbar-e', () => lightBarTex(true)), emissive: new THREE.Color(0xdfeaff), emissiveIntensity: 2.5, roughness: 0.25 });
      M.headlights.push(mat);
      addDecal(BODY.skin, hit.point, new V3(1, 0, 0), new V3(0, 1, 0), LS.bar.w, LS.bar.h, 0.5, mat, { minDot: 0.02 });
    }
  }
}

function buildIntakesAndVents() {
  const V = SPEC.vents, xRay = XF + 0.8;
  const flipU = (d) => { const uv = d.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); };
  // centre nose intake
  if (V.centre) {
    const centre = texOnce('intake-centre', () => intakeTex((ctx, w, h) => { ctx.beginPath(); ctx.moveTo(w * 0.04, h * 0.10); ctx.lineTo(w * 0.96, h * 0.10); ctx.quadraticCurveTo(w * 0.99, h * 0.12, w * 0.95, h * 0.30); ctx.lineTo(w * 0.83, h * 0.90); ctx.lineTo(w * 0.17, h * 0.90); ctx.lineTo(w * 0.05, h * 0.30); ctx.quadraticCurveTo(w * 0.01, h * 0.12, w * 0.04, h * 0.10); ctx.closePath(); }));
    const hitC = hitNose(V.centre.y);
    if (hitC) addDecal(BODY.skin, hitC.point, new V3(1, 0, 0), new V3(0, 1, 0), V.centre.w, V.centre.h, 0.45, decalMaterial(centre, { roughness: 0.5 }), { minDot: 0.02 });
  }
  // corner intakes
  if (V.corner) {
    const corner = texOnce('intake-corner', () => intakeTex((ctx, w, h) => { ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.12); ctx.lineTo(w * 0.80, h * 0.06); ctx.quadraticCurveTo(w * 0.97, h * 0.08, w * 0.95, h * 0.30); ctx.lineTo(w * 0.86, h * 0.92); ctx.lineTo(w * 0.14, h * 0.92); ctx.quadraticCurveTo(w * 0.04, h * 0.6, w * 0.06, h * 0.12); ctx.closePath(); }, 1024, 768));
    for (const side of [-1, 1]) {
      const hit = hitBody(new V3(xRay, V.corner.y, side * V.corner.z), new V3(-1, 0, 0));
      if (!hit) continue;
      const n = new V3(1, 0, side * 0.55).normalize();
      const d = addDecal(BODY.skin, hit.point, n, new V3(0, 1, 0), V.corner.w, V.corner.h, 0.45, decalMaterial(corner, { roughness: 0.5 }));
      if (d && side < 0) flipU(d);
    }
  }
  // bonnet outlet
  if (V.hood) {
    const hood = texOnce('louver-hood', () => louverTex(1024, 512, 7, (ctx, w, h) => { ctx.beginPath(); ctx.moveTo(w * 0.12, h * 0.05); ctx.lineTo(w * 0.88, h * 0.05); ctx.quadraticCurveTo(w * 0.98, h * 0.5, w * 0.80, h * 0.95); ctx.lineTo(w * 0.20, h * 0.95); ctx.quadraticCurveTo(w * 0.02, h * 0.5, w * 0.12, h * 0.05); ctx.closePath(); }));
    for (const z of V.hood.z || [0]) {
      const hitH = hitBody(new V3(V.hood.x, 2.0, z), new V3(0, -1, 0));
      if (hitH) addDecal(BODY.skin, hitH.point, hitH.face.normal, new V3(1, 0, 0), V.hood.w, V.hood.l, 0.3, decalMaterial(hood, { roughness: 0.45 }));
    }
  }
  // fender louvres over the front wheels
  if (V.fender) {
    const fl = texOnce('louver-fender', () => louverTex(512, 512, 8, roundRectPath(20, 20, 472, 472, 60)));
    for (const side of [-1, 1]) {
      const hit = hitBody(new V3(V.fender.x, 2.0, side * V.fender.z), new V3(0, -1, 0));
      if (hit) addDecal(BODY.skin, hit.point, hit.face.normal, new V3(1, 0, 0), 0.26, 0.20, 0.25, decalMaterial(fl, { roughness: 0.45 }));
    }
  }
  // engine-cover louvres
  if (V.engine) {
    const el = texOnce('louver-engine', () => louverTex(1024, 512, 10, roundRectPath(16, 16, 992, 480, 50)));
    for (const side of [-1, 1]) {
      const hit = hitBody(new V3(V.engine.x, 2.0, side * V.engine.z), new V3(0, -1, 0));
      if (hit) addDecal(BODY.skin, hit.point, hit.face.normal, new V3(1, 0, 0), 0.42, 0.26, 0.25, decalMaterial(el, { roughness: 0.45 }));
    }
  }
  // side scoop intake mesh (rear wall of the scoop)
  if (V.scoop && SIDE.scoop > 0) {
    const scoop = texOnce('intake-scoop', () => intakeTex((ctx, w, h) => roundRectPath(8, 8, w - 16, h - 16, 30)(ctx), 512, 1024, 11));
    for (const side of [-1, 1]) {
      const c = new V3(SC_X1 - 0.003, 0.48, side * 0.90);
      const d = addDecal(BODY.skin, c, new V3(1, 0, 0), new V3(0, 1, 0), 0.26, 0.42, 0.022, decalMaterial(scoop, { roughness: 0.6, clearcoat: 0 }), { minDot: 0.55 });
      if (d && side < 0) flipU(d);
    }
  }
  // outlet in the flank behind the front wheel
  if (V.flank) {
    const fk = texOnce('louver-flank', () => louverTex(512, 1024, 3, roundRectPath(30, 20, 452, 984, 120)));
    for (const side of [-1, 1]) {
      const hit = hitBody(new V3(V.flank.x, V.flank.y, side * 3), new V3(0, 0, -side));
      if (!hit) continue;
      const d = addDecal(hit.object, hit.point, new V3(0.25, 0.1, side).normalize(), new V3(0, 1, 0), V.flank.w, V.flank.h, 0.25, decalMaterial(fk, { roughness: 0.45 }));
      if (d && side < 0) flipU(d);
    }
  }
}

// Active rear spoiler: folds flush into the tail deck, rises on two struts, tilts into an airbrake
function buildSpoiler() {
  const { span, chord, xLE } = SPOIL;
  car.updateMatrixWorld(true);
  const N = 24, hs = [];
  for (let i = 0; i <= N; i++) {
    const z = lerp(-span / 2, span / 2, i / N);
    let hmax = -1;
    for (const x of [xLE - 0.01, xLE - chord * 0.5, xLE - chord + 0.01]) {
      const h = hitBody(new V3(x, 2, z), new V3(0, -1, 0));
      if (h) hmax = Math.max(hmax, h.point.y);
    }
    hs.push(hmax > 0 ? hmax : 0.84);
  }
  const hAt = (z) => { const f = clamp((z + span / 2) / span, 0, 1) * N; const i = Math.min(N - 1, Math.floor(f)); return lerp(hs[i], hs[i + 1], f - i); };
  const base = hAt(0);
  const prof = [[0.0, 0.0], [0.0, 0.006], [-0.025, 0.014], [-0.10, 0.017], [-chord + 0.01, 0.008], [-chord, 0.003], [-chord, 0.0]];
  const geo = extrudeXY(prof, span, 0, { steps: 48, bevel: 0.0015 });
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + hAt(p.getZ(i)) - base);
  geo.computeVertexNormals();
  const group = new THREE.Group();
  group.position.set(xLE, base + 0.004, 0);
  group.add(new THREE.Mesh(geo, M.carbon));
  car.add(group);
  const struts = [];
  for (const z of [-0.28 * span, 0.28 * span]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1, 0.012), M.carbon);
    st.position.set(xLE - 0.085, base, z);
    st.scale.y = 0.001;
    car.add(st);
    struts.push(st);
  }
  BODY.spoiler = { group, struts, deckY: base, baseY: base + 0.004, prof, xLE, hAt };
}

const DECAL_ROLES = { number: [], word: [], bars: [], banner: [], wingText: [] };
function buildLivery() {
  const rnd = texOnce('roundel-' + SPEC.number, () => roundelTex(SPEC.number));
  const wm = texOnce('wordmark', () => wordmarkTex('HALCYON'));
  const bars = texOnce('speedbars', speedBarsTex);
  const [bx, by] = SPEC.livery.bars;
  car.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const door = DOORS[side];
    const h1 = hitBody(new V3(0.28, 0.585, side * 3), new V3(0, 0, -side));
    if (h1) {
      const onDoor = door && h1.object === door.skin;
      addDecal(h1.object, h1.point, new V3(0, 0.32, side).normalize(), new V3(0, 1, 0), 0.30, 0.30, 0.3, decalMaterial(rnd), { role: 'number', parent: onDoor ? door.content : car });
    }
    const h2 = hitBody(new V3(0.20, 0.262, side * 3), new V3(0, 0, -side));
    if (h2) { const m = decalMaterial(wm); TINTED.push(m); addDecal(h2.object, h2.point, new V3(0, 0, side), new V3(0, 1, 0), 0.86, 0.10, 0.25, m, { role: 'word' }); }
    const h3 = hitBody(new V3(bx, by, side * 3), new V3(0, 0, -side));
    if (h3) { const m = decalMaterial(bars); TINTED.push(m); addDecal(h3.object, h3.point, new V3(0, 0, side), new V3(0, 1, 0), 0.20, 0.10, 0.25, m, { role: 'bars' }); }
  }
  raycaster.set(new V3(0.18, 3, 0), new V3(0, -1, 0));
  const bhs = raycaster.intersectObject(BODY.glass, false);
  if (bhs.length) {
    const bh = bhs[0];
    addDecal(BODY.glass, bh.point.clone().add(new V3(0.05, 0, 0)), bh.face.normal.clone(), new V3(-1, 0, 0), 1.2, 0.20, 0.25, decalMaterial(texOnce('banner', bannerTex), { clearcoat: 0, roughness: 0.2 }), { role: 'banner', order: 5 });
  }
  if (!M.wingText) M.wingText = new THREE.MeshStandardMaterial({ map: wm, transparent: true, depthWrite: false, roughness: 0.4 });
  const [tx, ty] = BODY.wingRel([-2.02, 1.17]);
  for (const side of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.04), M.wingText);
    pl.position.set(tx, ty, side * (WING.span / 2 + 0.01));
    if (side < 0) pl.rotation.y = Math.PI;
    BODY.wing.add(pl);
    DECAL_ROLES.wingText.push(pl);
  }
}

/*@include blk_cockpit.js*/

/* =========================================================================
   STUDIO ENVIRONMENT, BACKDROP, FLOOR
   ========================================================================= */
function buildStudioEnv() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.018,0.019,0.022), vec3(0.006,0.0065,0.008), smoothstep(-0.1, 0.8, h)); c = mix(vec3(0.012,0.012,0.013), c, smoothstep(-0.05, 0.02, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  env.add(room);
  const panel = (w, h, I, pos, look, color = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(I), side: THREE.DoubleSide }));
    m.position.copy(pos); m.lookAt(look); env.add(m); return m;
  };
  // big overhead softbox, long along the car
  panel(10, 2.8, 4.2, new V3(0, 7.5, 0), new V3(0, 0, 0));
  // two thin overhead strips flanking it
  panel(11, 0.35, 9.0, new V3(0, 7.2, 2.4), new V3(0, 0, 1.2));
  panel(11, 0.35, 9.0, new V3(0, 7.2, -2.4), new V3(0, 0, -1.2));
  // tall side strips (vertical highlights on the flanks)
  for (const z of [-9, 9]) for (const x of [-4.5, 0.5, 5.5]) panel(0.9, 6, 3.2, new V3(x, 3.2, z), new V3(x * 0.6, 1.2, 0));
  // front/rear key softboxes
  panel(4, 3, 2.4, new V3(10, 3.5, 3), new V3(0, 0.6, 0));
  panel(4, 3, 1.6, new V3(-10, 3.5, -3), new V3(0, 0.6, 0));
  // warm rim accent
  panel(3, 1.2, 1.4, new V3(-6, 1.6, 8), new V3(0, 0.6, 0), 0xffd9b0);
  // horizon line ring
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 0.55, 96, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(0.9), side: THREE.BackSide }));
  ring.position.y = 1.9;
  env.add(ring);
  return env;
}

function buildBackdrop() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color(0x030304) }, uHorizon: { value: new THREE.Color(0x15171b) }, uNight: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform float uNight; varying vec3 vP;
      float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.42, h));
        if (uNight > 0.0) {
          // night over the circuit: deep blue zenith, a warm dome of light low over the track, stars
          vec3 n = mix(vec3(0.034, 0.045, 0.062), vec3(0.003, 0.005, 0.011), smoothstep(-0.02, 0.45, h));
          n += vec3(0.075, 0.05, 0.03) * exp(-max(h, 0.0) * 16.0) * 0.55;
          vec3 q = d * 300.0, cell = floor(q);
          float hs = h13(cell), r = length(fract(q) - 0.5);
          n += vec3(0.85, 0.9, 1.0) * step(0.9965, hs) * (1.0 - smoothstep(0.05, 0.16, r)) * smoothstep(0.1, 0.35, h) * (0.35 + 1.3 * h13(cell + 17.0));
          c = mix(c, n, uNight);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), mat);
  m.renderOrder = -10;
  return m;
}

// contact shadow (rendered from below, blurred)
const SHW = 6.6, SHD = 3.4;
const shadowRT = new THREE.WebGLRenderTarget(1024, 512);
const shadowBlurRT = new THREE.WebGLRenderTarget(1024, 512);
const shadowCam = new THREE.OrthographicCamera(-SHW / 2, SHW / 2, SHD / 2, -SHD / 2, 0, 1.25);
shadowCam.rotation.x = Math.PI / 2;
const depthMat = new THREE.MeshDepthMaterial();
depthMat.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.6 ) * 1.0 );');
};
depthMat.side = THREE.DoubleSide;
const blurScene = new THREE.Scene();
const blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader); hBlur.depthTest = false;
const vBlur = new THREE.ShaderMaterial(VerticalBlurShader); vBlur.depthTest = false;
const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), hBlur);
blurScene.add(blurQuad);

function renderContactShadow() {
  const hidden = [];
  scene.traverse((o) => { if (o.userData.noShadow && o.visible) { hidden.push(o); o.visible = false; } });
  const prevBg = scene.background;
  scene.background = null;
  scene.overrideMaterial = depthMat;
  const prevClear = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(shadowRT);
  renderer.clear();
  renderer.render(scene, shadowCam);
  scene.overrideMaterial = null;
  scene.background = prevBg;
  hidden.forEach(o => (o.visible = true));
  const blur = (amt) => {
    blurQuad.material = hBlur; hBlur.uniforms.tDiffuse.value = shadowRT.texture; hBlur.uniforms.h.value = amt / 1024;
    renderer.setRenderTarget(shadowBlurRT); renderer.render(blurScene, blurCam);
    blurQuad.material = vBlur; vBlur.uniforms.tDiffuse.value = shadowBlurRT.texture; vBlur.uniforms.v.value = amt / 512;
    renderer.setRenderTarget(shadowRT); renderer.render(blurScene, blurCam);
  };
  blur(3.0); blur(2.0); blur(1.2);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, prevClear);
}

/*@include blk_track.js*/

/*@include blk_world.js*/

/* =========================================================================
   ASSEMBLY
   ========================================================================= */
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromScene(buildStudioEnv(), 0.012);
const envTrackRT = pmrem.fromScene(buildTrackEnv(), 0.012);
setupEnvBlend(envRT, envTrackRT);
scene.environment = envRT.texture;
scene.environmentIntensity = 1.0;
pmrem.dispose();

const backdrop = buildBackdrop();
backdrop.userData.noShadow = true;
scene.add(backdrop);

const floor = new Reflector(buildGroundGeometry(), {
  shader: FloorShader, textureWidth: 1024, textureHeight: 1024, clipBias: 0.0, multisample: 4,
});
floor.rotation.x = -Math.PI / 2;
floor.userData.noShadow = true;
floor.frustumCulled = false;
// the floor shares the world uniforms (the Reflector cloned them)
for (const k of Object.keys(WU)) floor.material.uniforms[k] = WU[k];
{
  const rt = floor.getRenderTarget();
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
}
floor.material.uniforms.tShadow.value = shadowRT.texture;
scene.add(floor);
const REFL_HIDE = [];
{
  const obr = floor.onBeforeRender;
  floor.onBeforeRender = function (...args) {
    const prev = REFL_HIDE.map((o) => o.visible);
    for (const o of REFL_HIDE) o.visible = false;
    obr.apply(this, args);
    REFL_HIDE.forEach((o, i) => (o.visible = prev[i]));
  };
}

/* ---------- configuration data ---------- */
const PAINTS = [
  { id: 'abyss', name: '深海蓝', hex: '#0b2f86', stripe: '#f2f2ee', pin: '#d0102c', second: '#0a0b0d', chip: ['#5f86ef', '#123a9e', '#06153d'] },
  { id: 'lava', name: '熔岩红', hex: '#7a0610', stripe: '#f2f2ee', pin: '#101114', second: '#0a0b0d', chip: ['#ff6a6a', '#a30c18', '#3a0307'] },
  { id: 'amber', name: '琥珀橙', hex: '#c27206', stripe: '#111216', pin: '#f2f2ee', second: '#0a0b0d', chip: ['#ffd27a', '#d98a12', '#5a2e02'] },
  { id: 'neon', name: '霓虹黄', hex: '#c2cf00', stripe: '#111216', pin: '#111216', second: '#0a0b0d', chip: ['#f6ff8f', '#c3d400', '#4b5300'] },
  { id: 'verdant', name: '赛道绿', hex: '#063a2a', stripe: '#ebe5d2', pin: '#c9a227', second: '#0a0b0d', chip: ['#5fc79c', '#0f6146', '#04241a'] },
  { id: 'violet', name: '极光紫', hex: '#3a1670', stripe: '#f2f2ee', pin: '#e0b030', second: '#0a0b0d', chip: ['#b48cff', '#5a28b0', '#1c0838'] },
  { id: 'champagne', name: '香槟金', hex: '#a88c5c', stripe: '#1a1712', pin: '#f2efe6', second: '#16140f', chip: ['#f6e7c4', '#c2a46e', '#5a4626'] },
  { id: 'graphite', name: '石墨灰', hex: '#4a505a', stripe: '#ebebe6', pin: '#d0102c', second: '#0a0b0d', chip: ['#9aa1ad', '#3b4048', '#121417'] },
  { id: 'obsidian', name: '曜石黑', hex: '#0c0d10', stripe: '#d8d9dc', pin: '#d0102c', second: '#3a3f47', chip: ['#5a5e66', '#16181c', '#030304'] },
  { id: 'glacier', name: '冰川白', hex: '#e4e5e1', stripe: '#0b2f86', pin: '#d0102c', second: '#0a0b0d', chip: ['#ffffff', '#e2e3df', '#a6a8a6'] },
];
const FINISHES = [
  { id: 'metallic', name: '金属', metal: 0.62, rough: 0.34, cc: 1, ccr: 0.022, flake: 0.16 },
  { id: 'pearl', name: '珠光', metal: 0.32, rough: 0.30, cc: 1, ccr: 0.02, flake: 0.08, irid: 0.65, iridIOR: 1.45, iridRange: [250, 420] },
  { id: 'solid', name: '高光', metal: 0.0, rough: 0.30, cc: 1, ccr: 0.016 },
  { id: 'matte', name: '哑光', metal: 0.22, rough: 0.6, cc: 0, ccr: 0.5, flake: 0.04 },
  { id: 'chrome', name: '镜面', metal: 1.0, rough: 0.06, cc: 0.4, ccr: 0.02 },
  { id: 'chameleon', name: '变色龙', metal: 0.78, rough: 0.26, cc: 1, ccr: 0.02, flake: 0.1, irid: 1.0, iridIOR: 1.9, iridRange: [330, 860] },
  { id: 'carbon', name: '碳纤维', metal: 0.45, rough: 0.36, cc: 1, ccr: 0.03, carbon: true },
];
const WHEELS = [{ id: 'yspoke', name: 'Y 型双辐' }, { id: 'ten', name: '十辐' }, { id: 'turbine', name: '涡轮' }, { id: 'mesh', name: '交叉网' }];
const RIMS = [
  { id: 'graphite', name: '石墨', color: 0x2d2f33, metal: 0.92, rough: 0.3, cc: 0.8, chip: ['#6a6d73', '#2d2f33', '#101113'] },
  { id: 'silver', name: '亮银', color: 0xc9ccd1, metal: 1.0, rough: 0.16, cc: 0.6, chip: ['#ffffff', '#c9ccd1', '#5f636a'] },
  { id: 'bronze', name: '古铜', color: 0x8c6a3a, metal: 1.0, rough: 0.26, cc: 0.7, chip: ['#ecc98f', '#8c6a3a', '#33240f'] },
  { id: 'black', name: '亮黑', color: 0x0b0b0c, metal: 0.2, rough: 0.2, cc: 1.0, chip: ['#5b5c60', '#0d0d0e', '#000000'] },
  { id: 'carbon', name: '碳纤维', carbon: true },
];
const CALIPERS = [
  { id: 'red', name: '赤红', color: '#d0122c' }, { id: 'yellow', name: '明黄', color: '#f0b400' }, { id: 'blue', name: '宝蓝', color: '#1747c8' },
  { id: 'black', name: '曜黑', color: '#17181b' }, { id: 'green', name: '荧绿', color: '#4cc21a' }, { id: 'orange', name: '亮橙', color: '#ff6a00' },
];
const WINGS = [{ id: 'gt', name: '鹅颈尾翼' }, { id: 'active', name: '主动扰流' }, { id: 'none', name: '无尾翼' }];
const KITS = [{ id: 'track', name: '赛道套件' }, { id: 'road', name: '公路套件' }];
const LIVERIES = [{ id: 'none', name: '纯色', style: 0 }, { id: 'twin', name: '双条纹', style: 1 }, { id: 'offset', name: '偏置条纹', style: 2 }, { id: 'twotone', name: '双色', style: 3 }, { id: 'hoop', name: '斜环', style: 4 }];
const CABINS = [
  { id: 'black', name: '碳黑', seat: '#141416', accent: '#a8101f', card: '#17181b', well: '#121214', stitch: '#c8102e', harness: '#a8101f', suede: '#1a1a1d', led: '#ff2238' },
  { id: 'red', name: '赛道红', seat: '#6e0b12', accent: '#141416', card: '#2a0b0e', well: '#1a0a0c', stitch: '#e6dfd2', harness: '#141416', suede: '#1c1012', led: '#ff3434' },
  { id: 'tan', name: '马鞍棕', seat: '#6b4124', accent: '#141416', card: '#3a2516', well: '#1c140e', stitch: '#efe5cf', harness: '#1d1510', suede: '#1f1813', led: '#ffae5c' },
  { id: 'ivory', name: '象牙白', seat: '#d6cfbf', accent: '#0b2f86', card: '#8f897c', well: '#2a2824', stitch: '#0b2f86', harness: '#0b2f86', suede: '#26262a', led: '#5aa8ff' },
];
// the model the page opens with: ?car=<id>
const START_MODEL = modelById(new URLSearchParams(location.search).get('car'));
let PRESETS = START_MODEL.presets;
/*@include blk_drive.js*/

/*@include blk_fx.js*/
const CONFIG_KEYS = ['paint', 'finish', 'livery', 'wheel', 'rim', 'caliper', 'wing', 'kit', 'cabin'];
const byId = (arr, id) => arr.find((o) => o.id === id) || arr[0];

const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wideScreen = () => window.innerWidth >= 900;
// the panel docks at the side on desktops and landscape tablets, and becomes a bottom sheet on phones
const SHEET_MQ = window.matchMedia('(max-width: 899px) and (max-aspect-ratio: 5/4), (max-width: 639px)');
const sheetLayout = () => SHEET_MQ.matches;
const state = Object.assign({}, PRESETS[0], {
  model: START_MODEL.id, preset: 0, doors: false, wingUp: true, lights: true, pose: 'park', view: 'front', tab: 'style',
  turntable: !reduceMotion && !window.__TEST__, panel: !window.__TEST__ && wideScreen(),
});
delete state.name;
let paintAnim = null, camAnim = null, doorAnim = null;
let doorOpen = 0, wingDeploy = 1, viewShift = 0, pull = 1, shadowDirty = 0, frameNo = 0;

/* ---------- apply configuration ---------- */
function paintTargets() {
  const p = byId(PAINTS, state.paint), f = byId(FINISHES, state.finish);
  let c = new THREE.Color(p.hex);
  if (f.carbon) c = new THREE.Color(1, 1, 1).lerp(c, 0.35).multiplyScalar(2.6);
  if (f.id === 'chrome') { const hsl = {}; c.getHSL(hsl); c = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.8), Math.max(hsl.l, 0.42)); }
  return { c, s: new THREE.Color(p.stripe), pn: new THREE.Color(p.pin), sc: new THREE.Color(p.second) };
}
function applyFinish() {
  const f = byId(FINISHES, state.finish), m = M.paint;
  m.metalness = f.metal; m.roughness = f.rough; m.clearcoat = f.cc; m.clearcoatRoughness = f.ccr;
  m.iridescence = f.irid || 0;
  if (f.irid) { m.iridescenceIOR = f.iridIOR; m.iridescenceThicknessRange = f.iridRange.slice(); }
  if (f.carbon) { m.map = carbonBody.map; m.normalMap = carbonBody.nrm; m.normalScale.set(0.45, 0.45); }
  else { m.map = null; m.normalMap = f.flake ? flakeTex : null; m.normalScale.set(f.flake || 0, f.flake || 0); }
  m.needsUpdate = true;
}
const tintDecals = () => TINTED.forEach((m) => m.color.copy(livery.stripe.value));
function applyPaint(animate = true) {
  applyFinish();
  const to = paintTargets();
  if (!animate || reduceMotion) {
    M.paint.color.copy(to.c); livery.stripe.value.copy(to.s); livery.pin.value.copy(to.pn); livery.second.value.copy(to.sc);
    tintDecals(); paintAnim = null;
  } else {
    paintAnim = { t: 0, from: { c: M.paint.color.clone(), s: livery.stripe.value.clone(), pn: livery.pin.value.clone(), sc: livery.second.value.clone() }, to };
  }
  needsRender = true;
}
function applyLivery() {
  const st = byId(LIVERIES, state.livery).style;
  livery.style.value = st;
  if (AERO.saved) return;
  const vis = { number: st === 1 || st === 4, word: st > 0, bars: st === 1 || st === 2, banner: st > 0, wingText: st > 0 };
  for (const [role, list] of Object.entries(DECAL_ROLES)) list.forEach((m) => (m.visible = vis[role]));
  needsRender = true;
}
function applyWheels() {
  for (const w of WHEEL_OBJS) for (const [id, mesh] of Object.entries(w.userData.designs)) mesh.visible = id === state.wheel;
  const r = byId(RIMS, state.rim);
  M.rim.map = r.carbon ? carbonTex.map : null;
  M.rim.normalMap = r.carbon ? carbonTex.nrm : null;
  M.rim.color.set(r.carbon ? 0xffffff : r.color);
  M.rim.metalness = r.carbon ? 0.45 : r.metal; M.rim.roughness = r.carbon ? 0.34 : r.rough; M.rim.clearcoat = r.carbon ? 1 : r.cc;
  M.rim.needsUpdate = true;
  M.blur.color.copy(r.carbon ? new THREE.Color(0x1d1e21) : M.rim.color);
  M.blur.metalness = M.rim.metalness; M.blur.roughness = Math.max(0.3, M.rim.roughness);
  M.caliper.color.set(byId(CALIPERS, state.caliper).color);
  needsRender = true;
}
function applyKit() {
  const track = state.kit === 'track';
  (BODY.track || []).forEach((m) => (m.visible = track));
  BODY.wing.visible = state.wing === 'gt';
  BODY.spoiler.group.visible = state.wing === 'active';
  BODY.spoiler.struts.forEach((s) => (s.visible = state.wing === 'active'));
  shadowDirty = 2; needsRender = true;
}
function applyCabin() {
  const c = byId(CABINS, state.cabin);
  M.seat.color.set(c.seat); M.seatAccent.color.set(c.accent); M.doorCard.color.set(c.card); M.interior.color.set(c.well);
  if (CAB.leather) {
    CAB.leather.color.set(c.seat); CAB.suede.color.set(c.suede); CAB.stitch.value.set(c.stitch); CAB.mono.color.set(c.stitch);
    M.harnessMat.color.set(c.harness); CAB.led.color.set(c.led).multiplyScalar(2.4);
  }
  needsRender = true;
}
function applyAll(animate) { applyPaint(animate); applyLivery(); applyWheels(); applyKit(); applyCabin(); }

function setOption(key, val) {
  if (state[key] === val) return;
  state[key] = val;
  state.preset = PRESETS.findIndex((p) => CONFIG_KEYS.every((k) => p[k] === state[k]));
  if (key === 'paint' || key === 'finish') applyPaint(true);
  else if (key === 'livery') applyLivery();
  else if (key === 'wheel' || key === 'rim' || key === 'caliper') applyWheels();
  else if (key === 'wing' || key === 'kit') applyKit();
  else if (key === 'cabin') applyCabin();
  syncUI();
}
function applyPreset(i) {
  const p = PRESETS[i];
  for (const k of CONFIG_KEYS) state[k] = p[k];
  state.preset = i;
  applyAll(true);
  syncUI();
}
function setLights(on) {
  state.lights = on;
  (M.headlights || []).forEach((m) => (m.emissiveIntensity = on ? 2.5 : 0.0));
  if (M.tail) M.tail.emissiveIntensity = on ? 2.2 : 0.25;
  needsRender = true;
}
function setDoors(open) {
  state.doors = open;
  if (reduceMotion) { doorOpen = open ? 1 : 0; poseDoors(); shadowDirty = 1; needsRender = true; return; }
  doorAnim = { t: 0, from: doorOpen, to: open ? 1 : 0 };
}
function poseDoors() {
  const k = ease(doorOpen);
  for (const s of [-1, 1]) { const D = DOORS[s]; if (D) D.pivot.quaternion.setFromAxisAngle(D.axis, D.angle * k); }
}
function setWingUp(up) { state.wingUp = up; needsRender = true; }
function setPose(name) { state.pose = name; needsRender = true; }
function setTurntable(on) { state.turntable = on; controls.autoRotate = on; syncUI(); }
function setPanel(open) { state.panel = open; syncUI(); }
function setTab(tab) { state.tab = tab; syncUI(); }

/* ---------- camera ---------- */
const VIEWS = {
  // (the wheel view follows the model's front axle)
  front: [[5.6, 1.45, 4.9], [0, 0.5, 0]],
  side: [[0.15, 0.9, 8.6], [0, 0.55, 0]],
  rear: [[-5.5, 1.55, 4.7], [0, 0.5, 0]],
  top: [[3.4, 6.2, 3.9], [0, 0.25, 0]],
  wheel: [[2.55, 0.62, 2.8], [1.38, 0.36, 0.86]],
  cabin: [[-0.95, 1.4, 2.25], [0.15, 0.55, 0.05]],
  driver: [[-0.345, 0.905, -0.31], [-0.29, 0.896, -0.309]],
};
const DEG = THREE.MathUtils.radToDeg, RAD = THREE.MathUtils.degToRad;
// [tan(vfov/2), distance factor] that frames the car in a canvas of aspect a
function frameRule(a) {
  if (a < 1.2) return [Math.tan(THREE.MathUtils.degToRad(17)) / a, 1.12];
  return [Math.tan(THREE.MathUtils.degToRad(15)), lerp(1.12, 0.94, sstep(1.2, 1.65, a))];
}
function framing() { return frameRule(camera.aspect)[1]; }
// lens per view: the driver's seat gets a wide interior lens
function viewFov(view, a) {
  if (view === 'driver') return a < 1.05 ? DEG(2 * Math.atan(Math.tan(RAD(35)) / a)) : 66;
  return DEG(2 * Math.atan(frameRule(a)[0]));
}
function applyFov() {
  if (camAnim) return;
  const f = viewFov(state.view, camera.aspect);
  if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
}
// orbit limits: inside the car the controls only look around
function viewLimits(name) {
  const inside = name === 'driver';
  controls.minDistance = inside ? 0.02 : 2.2;
  controls.maxDistance = inside ? 0.12 : 18;
  controls.enableZoom = !inside; controls.enablePan = !inside;
  controls.maxPolarAngle = inside ? Math.PI * 0.72 : Math.PI * 0.492;
  controls.rotateSpeed = inside ? 0.45 : 1;
}
// the part of the canvas the open panel leaves free (CSS px)
function freeSize() {
  const [w, h] = size0();
  if (!state.panel) return [w, h];
  const el = panelEl();
  if (!sheetLayout()) return [w - ((el ? el.offsetWidth : 332) + 24), h];
  return [w, h - ((el ? el.offsetHeight : 300) + 12)];
}
// how much further back the camera sits so the car fits the free part as it would a canvas of that size
function panelPull() {
  const [w, h] = size0(), [fw, fh] = freeSize();
  if (fw >= w - 1 && fh >= h - 1) return 1;
  const [ta, ka] = frameRule(w / h), [te, ke] = frameRule(Math.max(fw, 1) / Math.max(fh, 1));
  return clamp((ke * te * h) / (ka * ta * Math.max(fh, 1)), 1, 1.9);
}
// the outside views look at the middle of the body, which sits further forward on a long-bonnet car
let VIEW_DX = 0;
const OUTSIDE = { front: 1, side: 1, rear: 1, top: 1 };
function viewTarget(name) {
  const [p, t] = VIEWS[name];
  const k = name === 'driver' ? 1 : (name === 'wheel' || name === 'cabin' ? 1 : framing()) * pull;
  const tv = new V3(...t), pv = new V3(...p).sub(tv).multiplyScalar(k).add(tv);
  if (OUTSIDE[name]) { tv.x += VIEW_DX; pv.x += VIEW_DX; }
  return { p: pv, t: tv };
}
function goView(name, dur = 1.25) {
  const from = state.view;
  state.view = name;
  if (name === 'cabin' && !state.doors) setDoors(true);
  if (name === 'driver' && state.turntable) setTurntable(false);
  const { p, t } = viewTarget(name);
  const fov1 = viewFov(name, camera.aspect);
  if (reduceMotion || dur === 0) {
    camAnim = null; viewLimits(name);
    camera.position.copy(p); controls.target.copy(t); camera.fov = fov1; camera.updateProjectionMatrix();
    controls.update(); needsRender = true; syncUI(); return;
  }
  // free limits while flying between the outside and the driver's seat
  controls.minDistance = 0.02; controls.maxDistance = 18;
  const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const s1 = new THREE.Spherical().setFromVector3(p.clone().sub(t));
  let dth = s1.theta - s0.theta;
  while (dth > Math.PI) dth -= Math.PI * 2;
  while (dth < -Math.PI) dth += Math.PI * 2;
  const inOut = (from === 'driver') !== (name === 'driver');
  camAnim = { t: 0, dur: inOut ? Math.max(dur, 1.6) : dur, s0, s1, dth, t0: controls.target.clone(), t1: t, fov0: camera.fov, fov1, name };
  syncUI();
}
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const panelEl = () => document.getElementById('panel');
// keep the car centred in the space the panel leaves free: sideways on desktop, upward above the phone sheet
function viewShiftTarget() {
  const [w, h] = size0(), [fw, fh] = freeSize();
  return sheetLayout() ? -(h - fh) / 2 : (w - fw) / 2;
}
function applyViewShift() {
  const [w, h] = size0();
  if (Math.abs(viewShift) < 0.5) { camera.clearViewOffset(); return; }
  if (!sheetLayout()) camera.setViewOffset(w, h, viewShift, 0, w, h);
  else camera.setViewOffset(w, h, 0, -viewShift, w, h);
}

/*@include blk_aero.js*/

/*@include blk_flow.js*/

/*@include blk_audio.js*/

/* ---------- models ---------- */
// take a model's spec into the hard points and tables the builders, the drive model and the effects read
function useModel(m) {
  SPEC = m;
  const b = m.body;
  XF = b.XF; XR = b.XR; AX = m.axles;
  LC = b.nose.LC; NFC = b.nose.NFC; NRAKE = b.nose.rake; LR = b.tail.LR; CEND = b.tail.CEND;
  SIDE = b.side; SC_X0 = b.side.scoopX[0]; SC_X1 = b.side.scoopX[1];
  // the sills run between the wheel arches
  SK0 = AX[0].x - AX[0].Ra - 0.088; SK1 = AX[1].x + AX[1].Ra + 0.078;
  SPL_X0 = m.parts.splitter.x0; WING = m.parts.wing; SPOIL = m.parts.spoiler;
  WBASE = AX[0].x - AX[1].x;
  if (!m._bc) {
    m._bc = {};
    for (const [k, [keys, sigma]] of Object.entries(b.curves)) m._bc[k] = designCurve(keys, sigma, Math.min(-2.7, XR - 0.4), Math.max(2.8, XF + 0.4));
  }
  BC = m._bc;
  livery.xr.value = XR + 0.03; livery.hood.value.fromArray(b.seams.hood); livery.deck.value.fromArray(b.seams.deck);
  PRESETS = m.presets;
  VIEWS.wheel = [[AX[0].x + 1.15, 0.62, 2.8], [AX[0].x - 0.02, 0.36, 0.86]];
  VIEW_DX = Math.round(((XF + XR) / 2 - 0.09) * 1000) / 1000;
  useModelDrive(m);
}
// everything built for one model: the sprung body's children and the four wheel pivots
const MODEL_PIVOTS = [];
function disposeModel() {
  const shared = new Set();
  for (const v of [...Object.values(M), ...Object.values(CAB)]) for (const m of Array.isArray(v) ? v : [v]) if (m && m.isMaterial) shared.add(m);
  const drop = (root) => root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (!shared.has(m)) m.dispose();
  });
  for (const o of [...car.children]) { drop(o); car.remove(o); }
  for (const p of MODEL_PIVOTS) { drop(p); carRoot.remove(p); }
  MODEL_PIVOTS.length = 0; WHEEL_OBJS.length = 0; FRONT_PIVOTS.length = 0; REFL_HIDE.length = 0; TINTED.length = 0;
  for (const list of Object.values(DECAL_ROLES)) list.length = 0;
  for (const k of Object.keys(BODY)) delete BODY[k];
  delete DOORS[1]; delete DOORS[-1];
  M.headlights = []; FX.flames = []; FX.vortex = null; CAB.spin = null; CAB.sig = '';
}

// the name in the header, the page title, the canvas label
function showModel(m = SPEC) {
  document.title = 'Halcyon ' + m.name;
  const mk = document.querySelector('.mark'); if (mk) mk.setAttribute('aria-label', 'Halcyon ' + m.name);
  canvas.setAttribute('aria-label', `工作室中的 Halcyon ${m.name}。拖动旋转，滚轮或双指缩放。`);
  const vn = document.getElementById('veilName'); if (vn) vn.innerHTML = `<b>${m.mark[0]}</b>${m.mark[1]}`;
}
function restDrive() {
  trackReset('park');
  Object.assign(DRIVE, {
    prog: 'park', t: 0, phase: '', s: 0, n: 0, psi: 0, v: 0, a: 0, k: 0, throttle: 0, brake: 0, gear: 1, rpm: 0, rpmT: 0, engine: 0, start: 0, idleT: 0,
    shiftCut: 0, blip: 0, overrun: 0, cut: 0, cutT: 0, slip: 0, heat: 0, airbrake: 0, abHold: 0, lowDrag: 0, abs: 0,
    pitch: 0, pitchV: 0, roll: 0, rollV: 0, heave: 0, heaveV: 0, yaw: 0, latG: 0, lonG: 0, kerbL: 0, kerbR: 0, sparkBurst: 0,
  });
  DRIVE.events.length = 0;
}
// each model comes back in the configuration it was left in
const SAVED = {};
let switching = false;
async function setModel(id) {
  const m = modelById(id);
  if (m === SPEC || switching || !window.__ready) return;
  switching = true;
  SAVED[SPEC.id] = Object.fromEntries(CONFIG_KEYS.map((k) => [k, state[k]]));
  const quick = reduceMotion || window.__TEST__;
  const veilBar = document.getElementById('veil-bar');
  const vstep = async (f) => { if (veilBar) veilBar.style.transform = `scaleX(${f})`; if (!window.__TEST__) await new Promise((r) => requestAnimationFrame(() => r())); };
  showModel(m);
  state.model = m.id; syncUI();
  document.body.classList.add('is-switching');
  await vstep(0.04);
  if (!quick) await new Promise((r) => setTimeout(r, 260));
  // the car goes back to the studio, at rest, and is taken apart
  const aero = AERO.on;
  if (AERO.saved) setPressureView(false);
  state.pose = 'park';
  restDrive();
  WORLD.mix = WORLD.target = 0;
  disposeModel();
  const dx0 = VIEW_DX;
  useModel(m);
  // an outside camera keeps looking at the middle of the car
  if (state.view !== 'driver' && state.view !== 'cabin' && state.view !== 'wheel') {
    const dx = VIEW_DX - dx0;
    camera.position.x += dx; controls.target.x += dx;
    if (camAnim) { camAnim.t0.x += dx; camAnim.t1.x += dx; }
  }
  Object.assign(state, SAVED[m.id] || Object.fromEntries(CONFIG_KEYS.map((k) => [k, PRESETS[0][k]])));
  state.preset = PRESETS.findIndex((p) => CONFIG_KEYS.every((k) => p[k] === state[k]));
  await buildModel(vstep, false);
  applyAll(false);
  setLights(state.lights);
  poseDoors();
  if (FLOW.ok) { flowCar(); flowReset(); }
  AERO.key = '';
  if (aero) setPressureView(true);
  if (SND.eng) SND.eng.setVoice(SPEC);
  renderPresets();
  if (state.view === 'wheel') goView('wheel', 0);
  // at rest in the studio, wing and doors where their switches say
  updateDrive(0, clock.elapsedTime, true); updateWorld(0, true); updateAero(0, true); updateCockpit(clock.elapsedTime);
  renderContactShadow();
  shadowDirty = 2; needsRender = true;
  try { history.replaceState(null, '', m === MODELS[0] ? location.pathname : '?car=' + m.id); } catch (e) { /* file: pages */ }
  syncUI();
  await vstep(1);
  switching = false;
  document.body.classList.remove('is-switching');
}

/* ---------- UI ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const swatchBg = (c) => `radial-gradient(circle at 34% 30%, ${c[0]} 0%, ${c[1]} 46%, ${c[2]} 100%)`;
const CARBON_BG = 'repeating-linear-gradient(45deg, #2c2d31 0 3px, #101113 3px 6px)';
const radio = (key, o, cls, inner, style = '') => `<button type="button" class="${cls}" role="radio" data-opt="${key}" data-val="${o.id}" aria-checked="false" title="${o.name}"${style ? ` style="${style}"` : ''}>${inner}</button>`;
const sr = (t) => `<span class="sr">${t}</span>`;
function wheelIcon(id) {
  let paths = '';
  for (const a of spokeArms(id)) {
    let d = '';
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, r = lerp(4.4, 13.0, t), th = a.th(t);
      d += (i ? 'L' : 'M') + (16 + r * Math.cos(th)).toFixed(2) + ' ' + (16 - r * Math.sin(th)).toFixed(2);
    }
    paths += `<path d="${d}"/>`;
  }
  const sw = id === 'mesh' || id === 'turbine' ? 1.1 : 1.8;
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.4" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="16" cy="16" r="3.6" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round">${paths}</g></svg>`;
}
function liveryIcon(id) {
  const body = '<rect x="3" y="7" width="38" height="18" rx="7" fill="currentColor" opacity=".28"/>';
  const clip = '<clipPath id="lv-' + id + '"><rect x="3" y="7" width="38" height="18" rx="7"/></clipPath>';
  const pats = {
    none: '',
    twin: '<rect x="3" y="13.4" width="38" height="2.2" fill="currentColor"/><rect x="3" y="16.4" width="38" height="2.2" fill="currentColor"/>',
    offset: '<rect x="3" y="9.6" width="38" height="4.4" fill="currentColor"/>',
    twotone: '<rect x="3" y="18" width="38" height="8" fill="currentColor"/>',
    hoop: '<path d="M24 5 L31 5 L22 27 L15 27 Z" fill="currentColor"/>',
  };
  return `<svg viewBox="0 0 44 32" aria-hidden="true"><defs>${clip}</defs>${body}<g clip-path="url(#lv-${id})">${pats[id] || ''}</g></svg>`;
}
function renderPresets() {
  $('#presets').innerHTML = PRESETS.map((p, i) => {
    const paint = byId(PAINTS, p.paint), rim = byId(RIMS, p.rim), cal = byId(CALIPERS, p.caliper);
    const look = p.finish === 'carbon' ? CARBON_BG : swatchBg(paint.chip);
    return `<button type="button" class="preset" role="radio" data-preset="${i}" aria-checked="false">
      <span class="preset-look"><span class="pc big" style="background:${look}"></span><span class="pc" style="background:${rim.chip ? swatchBg(rim.chip) : CARBON_BG}"></span><span class="pc small" style="background:${cal.color}"></span></span>
      <span class="preset-name">${p.name}</span></button>`;
  }).join('');
}
function buildUI() {
  renderPresets();
  const models = $('#models');
  if (models) {
    models.innerHTML = MODELS.map((m) => `<button type="button" class="mm" role="radio" data-model="${m.id}" aria-checked="false" aria-label="${m.name} ${m.tag}" title="${m.tag}"><b>${m.mark[0]}</b>${m.mark[1]}</button>`).join('');
    models.addEventListener('click', (e) => { const b = e.target.closest('[data-model]'); if (b) setModel(b.dataset.model); });
  }
  $('#paints').innerHTML = PAINTS.map((p) => radio('paint', p, 'sw', sr(p.name), `background:${swatchBg(p.chip)}`)).join('');
  $('#finishes').innerHTML = FINISHES.map((f) => radio('finish', f, 'chip', `<span class="fin" data-fin="${f.id}"></span><span>${f.name}</span>`)).join('');
  $('#wheelDesigns').innerHTML = WHEELS.map((w) => radio('wheel', w, 'chip tile', `${wheelIcon(w.id)}<span>${w.name}</span>`)).join('');
  $('#rims').innerHTML = RIMS.map((r) => radio('rim', r, 'sw sm', sr(r.name), `background:${r.chip ? swatchBg(r.chip) : CARBON_BG}`)).join('');
  $('#calipers').innerHTML = CALIPERS.map((c) => radio('caliper', c, 'sw sm', sr(c.name), `background:${c.color}`)).join('');
  $('#wings').innerHTML = WINGS.map((w) => radio('wing', w, 'chip', `<span>${w.name}</span>`)).join('');
  $('#kits').innerHTML = KITS.map((k) => radio('kit', k, 'chip', `<span>${k.name}</span>`)).join('');
  $('#liveries').innerHTML = LIVERIES.map((l) => radio('livery', l, 'chip tile', `${liveryIcon(l.id)}<span>${l.name}</span>`)).join('');
  $('#cabins').innerHTML = CABINS.map((c) => radio('cabin', c, 'chip', `<span class="duo" style="background:linear-gradient(135deg, ${c.seat} 0 56%, ${c.accent} 56% 100%)"></span><span>${c.name}</span>`)).join('');

  const panel = panelEl();
  // (nothing is switched while another model is being built)
  panel.addEventListener('click', (e) => {
    if (switching) return;
    const b = e.target.closest('[data-opt]'); if (b) { setOption(b.dataset.opt, b.dataset.val); return; }
    const p = e.target.closest('[data-preset]'); if (p) { applyPreset(+p.dataset.preset); return; }
    const tb = e.target.closest('[data-tab]'); if (tb) { setTab(tb.dataset.tab); return; }
    if (e.target.closest('[data-panel-close]')) setPanel(false);
  });
  // arrow keys move within any radio group
  document.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const cur = e.target.closest && e.target.closest('[role="radio"]');
    const group = cur && cur.closest('[role="radiogroup"]');
    if (!group) return;
    const items = Array.from(group.querySelectorAll('[role="radio"]'));
    const i = items.indexOf(cur), n = items.length;
    const next = items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : n - 1)) % n];
    next.focus(); next.click(); e.preventDefault();
  });
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    if (switching) return;
    const k = b.dataset.toggle;
    if (k === 'doors') setDoors(!state.doors);
    if (k === 'wing') setWingUp(!state.wingUp);
    if (k === 'lights') setLights(!state.lights);
    if (k === 'turntable') setTurntable(!state.turntable);
    if (k === 'panel') setPanel(!state.panel);
    if (k === 'aero') setAero(!AERO.on);
    if (k === 'sound') setSound(!SND.on);
    syncUI();
  }));
  $$('[data-pose]').forEach((b) => b.addEventListener('click', () => { if (switching) return; setPose(b.dataset.pose); syncUI(); }));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => { if (switching) return; setTurntable(false); goView(b.dataset.view); }));
  syncUI();
}
function syncUI() {
  $$('[data-model]').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.model === state.model)); b.tabIndex = b.dataset.model === state.model ? 0 : -1; });
  $$('[data-opt]').forEach((b) => b.setAttribute('aria-checked', String(state[b.dataset.opt] === b.dataset.val)));
  $$('[data-preset]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.preset === state.preset)));
  $$('[data-tab]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); b.tabIndex = b.dataset.tab === state.tab ? 0 : -1; });
  $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== state.tab));
  const pressed = { doors: state.doors, wing: state.wingUp && state.wing !== 'none', lights: state.lights, turntable: state.turntable, panel: state.panel, aero: AERO.on, sound: SND.on };
  $$('[data-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(!!pressed[b.dataset.toggle])));
  const wb = $('[data-toggle="wing"]'); if (wb) wb.disabled = state.wing === 'none';
  $$('[data-pose]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pose === state.pose)));
  $$('[data-view]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === state.view)));
  document.body.classList.toggle('panel-open', state.panel);
  document.body.classList.toggle('aero-on', AERO.on);
  fitRail();
  const nm =(sel, list, key) => { const el = $(sel); if (el) el.textContent = byId(list, state[key]).name; };
  nm('#paintName', PAINTS, 'paint'); nm('#finishName', FINISHES, 'finish'); nm('#rimName', RIMS, 'rim'); nm('#caliperName', CALIPERS, 'caliper');
  const pc = byId(PAINTS, state.paint).chip, fe = $('#finishes');
  if (fe) { fe.style.setProperty('--p1', pc[0]); fe.style.setProperty('--p2', pc[1]); fe.style.setProperty('--p3', pc[2]); }
}
// a rail that no longer fits on one line wraps into a rounded block without separators
function fitRail() {
  const rail = $('.rail');
  if (!rail) return;
  rail.classList.add('measure');
  const need = rail.offsetWidth;
  rail.classList.remove('measure');
  const [w] = size0(), el = panelEl();
  const avail = w - 32 - (state.panel && !sheetLayout() && el ? el.offsetWidth + 24 : 0);
  rail.classList.toggle('wrapped', need > avail);
}
controls.addEventListener('start', () => { camAnim = null; if (state.turntable) setTurntable(false); });

const loaderBar = $('#loader-bar');
const step = async (f) => { if (loaderBar) loaderBar.style.transform = `scaleX(${f})`; await new Promise((r) => requestAnimationFrame(() => r())); };

// the car itself, from the active spec. On the first build the circuit and the scene-wide effects are made along the way.
async function buildModel(step, first) {
  TIRE_TEX = texOnce('tyre|' + SPEC.tyre.join('|'), () => tireTextTexture(SPEC.tyre[0], SPEC.tyre[1]));
  TIRE_TEX_M = texOnce('tyre-m|' + SPEC.tyre.join('|'), () => { const t = TIRE_TEX.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.needsUpdate = true; return t; });
  await step(0.14);
  const { capGeo } = buildBody();
  await step(0.38);
  if (!M.tailCap) {
    M.tailCap = new THREE.MeshStandardMaterial({ color: 0xffffff, map: grilleTileTex(), roughness: 0.55, metalness: 0.5 });
    M.tailPanel = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05 });
  }
  // the flat tail: a grille, a gloss panel, or painted with a dark valance round the pipes
  const TF = SPEC.body.tail;
  BODY.cap = new THREE.Mesh(capGeo, TF.face === 'grille' ? M.tailCap : TF.face === 'gloss' ? M.tailPanel : M.paint);
  car.add(BODY.cap);
  if (TF.valance) {
    const vt = texOnce('intake-valance', () => intakeTex((ctx, w, h) => roundRectPath(10, 10, w - 20, h - 20, h * 0.32)(ctx), 2048, 384, 12));
    addDecal(BODY.cap, new V3(XR, TF.valance.y, 0), new V3(-1, 0, 0), new V3(0, 1, 0), TF.valance.w, TF.valance.h, 0.1, decalMaterial(vt, { roughness: 0.5 }));
  }
  buildCanopy();
  buildDoors();
  await step(0.5);
  buildMirrors(); buildAero(); buildSpoiler(); buildExhausts(); buildExtras();
  await step(0.62);
  buildLights(); buildIntakesAndVents();
  await step(0.74);
  buildLivery(); buildInterior();
  if (first) { buildSparks(); trackReset('park'); buildWorld(); }
  buildFX(first);
  await step(0.84);
  const cam = SPEC.stance.camber;
  for (const ax of AX) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(ax.x, ax.yc, side * ax.track);
      const wheel = makeWheel(ax, side < 0);
      if (side < 0) wheel.scale.z = -1;
      // static camber: the top of the tyre leans in
      wheel.rotation.x = -side * cam[ax.front ? 0 : 1];
      wheel.userData.spin.rotation.z = rand() * Math.PI * 2;
      pivot.add(wheel);
      if (ax.front) { pivot.rotation.y = 0.17; FRONT_PIVOTS.push(pivot); }
      carRoot.add(pivot);
      MODEL_PIVOTS.push(pivot);
      WHEEL_OBJS.push(wheel);
    }
  }
  await step(0.94);
}

async function build() {
  const t0 = performance.now();
  try {
    await Promise.race([
      Promise.all(['800 100px "Archivo"', 'italic 800 100px "Archivo"', '600 60px "Archivo"'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch (e) { /* fall back to system fonts for decal text */ }
  await step(0.08);
  useModel(START_MODEL);
  DISC_TEX = discTexture();
  DISC_GLOW = discGlowTexture();
  BLUR_TEX = wheelBlurTexture();
  CAL_TEX = caliperLogoTexture('HALCYON');
  CAL_TEX_M = CAL_TEX.clone(); CAL_TEX_M.wrapS = THREE.RepeatWrapping; CAL_TEX_M.repeat.x = -1; CAL_TEX_M.needsUpdate = true;
  M.discFace = new THREE.MeshStandardMaterial({ map: DISC_TEX, metalness: 0.35, roughness: 0.5, emissive: new THREE.Color(0xff4a10), emissiveMap: DISC_GLOW, emissiveIntensity: 0 });
  M.blur.map = BLUR_TEX;
  await buildModel(step, true);
  applyAll(false);
  setLights(state.lights);
  renderContactShadow();
  buildUI();
  showModel();
  if (document.fonts) document.fonts.ready.then(() => fitRail());
  if (window.__TEST__) console.info('build ms', Math.round(performance.now() - t0));
  window.__ready = true;
  needsRender = true;
  pull = panelPull();
  const hero = viewTarget('front');
  if (!reduceMotion && !window.__TEST__) {
    camera.position.copy(hero.p.clone().sub(hero.t).applyAxisAngle(new V3(0, 1, 0), -0.75).multiplyScalar(1.35).add(new V3(0, -0.35, 0)).add(hero.t));
    controls.target.copy(hero.t);
    goView('front', 2.6);
  } else { camera.position.copy(hero.p); controls.target.copy(hero.t); }
  controls.update();
  await step(1);
  document.body.classList.add('is-ready');
}

/* =========================================================================
   POST + LOOP
   ========================================================================= */
const size0 = () => [canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight];
const rtOpts = { type: THREE.HalfFloatType, samples: 4 };
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size0()[0] * DPR, size0()[1] * DPR, rtOpts));
composer.addPass(new RenderPass(scene, camera));
// last line of defence before bloom: no NaN or Inf may reach the blur chain
composer.addPass(new ShaderPass({
  name: 'HdrSanitize',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float fin(float x){ return isnan(x) ? 0.0 : clamp(x, 0.0, ${HDR_MAX * 2}.0); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(fin(c.r), fin(c.g), fin(c.b), c.a); }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(size0()[0], size0()[1]), 0.3, 0.55, 0.96);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let needsRender = true;
controls.addEventListener('change', () => { needsRender = true; });
function resize() {
  const [w, h] = size0();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  applyFov();
  camera.updateProjectionMatrix();
  viewShift = viewShiftTarget();
  applyViewShift();
  fitRail();
  const rw =Math.max(256, Math.round(w * DPR * 0.6)), rh = Math.max(256, Math.round(h * DPR * 0.6));
  floor.getRenderTarget().setSize(rw, rh);
  floor.material.uniforms.uTexel.value.set(1 / rw, 1 / rh);
  needsRender = true;
}
window.addEventListener('resize', resize);
resize();

function updateAero(dt, snap = false) {
  const target = state.wingUp ? 1 - DRIVE.lowDrag : 0;
  let moving = false;
  if (Math.abs(target - wingDeploy) > 1e-4) { wingDeploy += (target - wingDeploy) * (snap ? 1 : 1 - Math.exp(-dt * 3.2)); moving = true; } else wingDeploy = target;
  const ab = DRIVE.airbrake, dep = Math.max(wingDeploy, ab);
  BODY.wing.position.y = lerp(-WING.drop, 0, dep);
  if (BODY.flap) BODY.flap.rotation.z = lerp(lerp(-0.12, -0.45, dep), -1.12, ab);
  const S = BODY.spoiler;
  const lift = lerp(0, 0.125, dep) + 0.02 * ab;
  const ang = lerp(lerp(0, 0.20, dep), 0.92, ab);
  S.group.position.y = S.baseY + lift;
  S.group.rotation.z = -ang;
  const h = lift + 0.085 * Math.sin(ang) + 0.006;
  for (const st of S.struts) { st.scale.y = Math.max(0.001, h); st.position.y = S.deckY + h / 2; }
  if (moving) shadowDirty = Math.max(shadowDirty, 2);
  return moving;
}
function updateDoors(dt, snap = false) {
  if (!doorAnim) return false;
  doorAnim.t = snap ? 1 : Math.min(1, doorAnim.t + dt / 1.6);
  doorOpen = lerp(doorAnim.from, doorAnim.to, doorAnim.t);
  poseDoors();
  shadowDirty = Math.max(shadowDirty, 2);
  if (doorAnim.t >= 1) doorAnim = null;
  return true;
}

const clock = new THREE.Clock();
function stepWorld(dt, snap) {
  const t = clock.elapsedTime;
  let active = updateDrive(dt, t, snap);
  active = updateWorld(dt, snap) || active;
  active = updateFX(dt, t, snap) || active;
  active = updateAero(dt, snap) || active;
  active = updateDoors(dt, snap) || active;
  active = updateAeroViz(snap ? 5 : dt, t, snap) || active;
  active = updateCockpit(t) || active;
  updateHUD(t, snap);
  const vt = viewShiftTarget();
  if (Math.abs(vt - viewShift) > 0.5) { viewShift = snap ? vt : viewShift + (vt - viewShift) * (1 - Math.exp(-dt * 7)); applyViewShift(); active = true; }
  else if (viewShift !== vt) { viewShift = vt; applyViewShift(); active = true; }
  const pt = panelPull();
  if (pt !== pull) {
    let np = snap ? pt : pull + (pt - pull) * (1 - Math.exp(-dt * 7));
    if (Math.abs(pt - np) < 1e-3) np = pt;
    const r = np / pull;
    camera.position.sub(controls.target).multiplyScalar(r).add(controls.target);
    if (camAnim) { camAnim.s0.radius *= r; camAnim.s1.radius *= r; }
    pull = np; active = true;
  }
  return active;
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (window.__TEST__) return;
  let active = false;
  const live = window.__ready && !switching;
  if (live) active = stepWorld(dt, false);
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / camAnim.dur);
    const k = ease(camAnim.t), a = camAnim.s0, b = camAnim.s1;
    const sp = new THREE.Spherical(lerp(a.radius, b.radius, k), lerp(a.phi, b.phi, k), a.theta + camAnim.dth * k);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, k);
    camera.position.setFromSpherical(sp).add(controls.target);
    if (Math.abs(camAnim.fov1 - camAnim.fov0) > 0.01) { camera.fov = lerp(camAnim.fov0, camAnim.fov1, k); camera.updateProjectionMatrix(); }
    if (camAnim.t >= 1) { viewLimits(camAnim.name); camAnim = null; }
    active = true;
  }
  if (paintAnim) {
    paintAnim.t = Math.min(1, paintAnim.t + dt / 0.7);
    const k = ease(paintAnim.t), f = paintAnim.from, to = paintAnim.to;
    M.paint.color.lerpColors(f.c, to.c, k);
    livery.stripe.value.lerpColors(f.s, to.s, k); livery.pin.value.lerpColors(f.pn, to.pn, k); livery.second.value.lerpColors(f.sc, to.sc, k);
    tintDecals();
    if (paintAnim.t >= 1) paintAnim = null;
    active = true;
  }
  controls.autoRotate = state.turntable && !camAnim;
  controls.autoRotateSpeed = 0.55;
  if (controls.update(dt)) needsRender = true;
  frameNo++;
  if (live && shadowDirty > 0 && (frameNo % 3 === 0 || shadowDirty === 1)) { renderContactShadow(); shadowDirty--; }
  if ((needsRender || active) && live) {
    cameraRigApply();
    composer.render();
    cameraRigRestore();
    needsRender = false;
  }
  if (live) audioFrame(dt);
}
loop();

// test hooks
function settle() {
  if (paintAnim) { const to = paintAnim.to; M.paint.color.copy(to.c); livery.stripe.value.copy(to.s); livery.pin.value.copy(to.pn); livery.second.value.copy(to.sc); tintDecals(); paintAnim = null; }
  if (doorAnim) updateDoors(0, true);
  stepWorld(0, true);
  renderContactShadow();
  car.updateMatrixWorld(true);
}
window.__setView = (pos, target) => { camAnim = null; camera.position.set(...pos); controls.target.set(...target); controls.minDistance = Math.min(2.2, camera.position.distanceTo(controls.target) * 0.99); controls.update(); };
window.__renderNow = () => { settle(); controls.update(); cameraRigApply(); composer.render(); cameraRigRestore(); };
window.__grab = () => { settle(); controls.update(); cameraRigApply(); composer.render(); cameraRigRestore(); return renderer.domElement.toDataURL('image/png'); };
window.__info = () => {
  settle();
  renderer.info.autoReset = false; renderer.info.reset();
  composer.render();
  const r = { tris: renderer.info.render.triangles, calls: renderer.info.render.calls, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures };
  let sceneTris = 0;
  carRoot.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { const g = o.geometry; sceneTris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  r.carTris = Math.round(sceneTris);
  renderer.info.autoReset = true;
  return r;
};
window.__cam = () => camera.fov;
window.__ui = { setOption, applyPreset, setDoors, setWingUp, setPose, setLights, goView, setPanel, setAero, setModel, state, DRIVE, AERO, FX, WORLD, TRACK, FLOW, MODELS, get SPEC() { return SPEC; } };
// offline render of the sound engine through a scripted drive, for automated level checks
window.__audioTest = async (sec = 16, plan = [[0, 'park'], [3.5, 'brake'], [10, 'corner']]) => {
  const sr = 22050, ctx = new OfflineAudioContext(2, sr * sec, sr);
  const S = await createSound(ctx);
  S.out.gain.value = 0.9;
  const keep = { mix: WORLD.mix, pose: state.pose };
  restDrive();
  const dt = 1 / 60, cam = { pos: new V3(5.6, 1.45, 4.9), fwd: new V3(-5.6, -0.95, -4.9).normalize(), up: new V3(0, 1, 0), inside: false };
  for (let t = 0; t < sec; t += dt) {
    for (const [t0, p] of plan) if (t >= t0) state.pose = p;
    WORLD.mix = DRIVE.prog === 'park' && DRIVE.engine === 0 && DRIVE.v === 0 ? 0 : 1;
    driveProgram(dt);
    DRIVE.latG = DRIVE.v * DRIVE.v * DRIVE.k / GRAV; DRIVE.lonG = DRIVE.a / GRAV;
    S.update(t, dt, DRIVE, 0, false, cam);
    DRIVE.events.length = 0;
  }
  const buf = await ctx.startRendering();
  const rows = [];
  for (let c = 0; c < 1; c++) {
    const ch = buf.getChannelData(c);
    for (let s0 = 0; s0 < sec; s0++) {
      let pk = 0, sum = 0, bad = 0;
      for (let i = s0 * sr; i < (s0 + 1) * sr; i++) { const v = ch[i]; if (!Number.isFinite(v)) bad++; else { pk = Math.max(pk, Math.abs(v)); sum += v * v; } }
      rows.push([s0, +Math.sqrt(sum / sr).toFixed(4), +pk.toFixed(3), bad]);
    }
  }
  state.pose = keep.pose; WORLD.mix = keep.mix;
  restDrive();
  return rows;
};
// scripted drive without rendering: speed, gear, rpm, g and body attitude over time (tools/drive.js)
window.__driveTest = (sec = 30, plan = [[0, 'cruise']], every = 0.5) => {
  const keep = { mix: WORLD.mix, pose: state.pose }, d = DRIVE;
  restDrive();
  const dt = 1 / 60, rows = [];
  let next = 0;
  for (let t = 0; t < sec; t += dt) {
    for (const [t0, p] of plan) if (t >= t0) state.pose = p;
    WORLD.mix = d.prog === 'park' && d.engine === 0 && d.v === 0 ? 0 : 1;
    updateDrive(dt, t, false);
    updateAero(dt, false);
    d.events.length = 0;
    if (t >= next) { next += every; rows.push([+t.toFixed(2), +(d.v * 3.6).toFixed(1), d.gear, Math.round(d.rpm), +d.lonG.toFixed(2), +d.latG.toFixed(2), +(d.pitch * 57.3).toFixed(2), +(d.roll * 57.3).toFixed(2), +(d.heave * 1000).toFixed(1)]); }
  }
  state.pose = keep.pose; WORLD.mix = keep.mix;
  restDrive();
  return rows;
};
// (from: build the sound for another model first, then retune it to the active one, as a model change does)
window.__engineSpectrum = async (rpm = 6000, load = 1, sec = 1.2, from = null) => {
  const sr = 44100, ctx = new OfflineAudioContext(1, sr * sec, sr);
  const S = await createSound(ctx, from ? modelById(from) : SPEC);
  if (from) S.setVoice(SPEC);
  S.out.gain.value = 0.9;
  const d = Object.assign({}, DRIVE, { engine: 1, start: 0, rpm, throttle: load, v: 0, cut: 0, shiftCut: 0, events: [], kerbL: 0, kerbR: 0, abs: 0, slip: 0, airbrake: 0, latG: 0, brake: 0 });
  const keep = WORLD.mix; WORLD.mix = 0;
  const cam = { pos: new V3(-5, 1.2, 2), fwd: new V3(1, 0, -0.4).normalize(), up: new V3(0, 1, 0), inside: false };
  for (let t = 0; t < sec; t += 1 / 60) S.update(t, 1 / 60, d, 0, false, cam);
  const buf = await ctx.startRendering();
  WORLD.mix = keep;
  const x = buf.getChannelData(0), n0 = Math.floor(sr * 0.4), N = x.length - n0;
  const goertzel = (f) => { const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (let i = 0; i < N; i++) { const s = x[n0 + i] + c * s1 - s2; s2 = s1; s1 = s; } return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / N; };
  const f1 = rpm / 60, orders = [0.5, 1, 1.5, 2, 2.5, 3, 4, 4.5, 5, 6, 7.5, 8, 9, 10, 12, 16, 18, 24];
  const res = { worklet: S.worklet, rms: 0, orders: {} };
  let sum = 0; for (let i = 0; i < N; i++) sum += x[n0 + i] * x[n0 + i]; res.rms = +Math.sqrt(sum / N).toFixed(4);
  for (const o of orders) res.orders[o] = +(goertzel(o * f1) * 1000).toFixed(2);
  return res;
};
build().catch((e) => { console.error(e); const l = document.getElementById('loader-msg'); if (l) l.textContent = '车辆构建失败：' + e.message; });
