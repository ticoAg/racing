/* =========================================================================
   AIRFLOW — surface pressure map, force arrows and aero loads. The live view
   comes from the 3D lattice-Boltzmann tunnel (blk_flow.js); where float
   render targets are missing it falls back to 2D potential flow (stream
   function) in longitudinal slices with traced streamlines, wake turbulence,
   tip vortices and recirculation eddies, and a pressure estimate from the
   surface orientation.
   ========================================================================= */
const AERO = {
  on: false, fade: 0, key: '', busy: false, queued: false,
  mesh: null, uni: null, cpMat: null, saved: null, arrows: null, slices: [0, 0.3, 0.6, 0.86],
};
const TUNNEL_V = 200 / 3.6;
// parked with the airflow view on, the studio becomes a wind tunnel running at 200 km/h
const airspeed = () => (AERO.on && DRIVE.prog === 'park' && DRIVE.v < 0.5 ? TUNNEL_V : DRIVE.v);

// loads at airspeed v for the current wing position and airbrake (kg of downforce per axle, N of drag)
function aeroLoads(v) {
  const A = aeroForces(v, clamp(wingDeploy, 0, 1), DRIVE.airbrake, {});
  return { front: A.f / GRAV, rear: A.r / GRAV, drag: A.drag };
}

/* ---------- body silhouette per slice ---------- */
function canopyTop(X, zq) {
  if (X < CX0 || X > CX1) return -1;
  const wB = CC.wB(X), yR = CC.yR(X), e = 2 / CC.n(X);
  if (zq >= wB) return -1;
  const c = Math.pow(zq / wB, 1 / e), s = Math.sqrt(Math.max(0, 1 - c * c));
  return CYB + (yR - CYB) * Math.pow(s, e);
}
function sliceProfile(zq, xs) {
  const secs = BODY.sections;
  const top = new Float32Array(secs.length).fill(-1), bot = new Float32Array(secs.length).fill(-1);
  secs.forEach(({ X, s }, k) => {
    const L = s.lipSkin;
    let best = -1, zmax = 0;
    for (let i = 0; i < L.length - 1; i++) {
      const a = L[i], b = L[i + 1];
      zmax = Math.max(zmax, a[0]);
      if ((a[0] - zq) * (b[0] - zq) <= 0 && a[0] !== b[0]) best = Math.max(best, a[1] + (b[1] - a[1]) * (zq - a[0]) / (b[0] - a[0]));
    }
    if (zq <= zmax && best > 0) {
      top[k] = Math.max(best, canopyTop(X, zq));
      bot[k] = zq < ZT ? BC.yf(X) : L[0][1];
    }
  });
  const T = new Float32Array(xs.length).fill(-1), Bt = new Float32Array(xs.length).fill(-1);
  let k = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x < secs[0].X || x > secs[secs.length - 1].X) continue;
    while (k < secs.length - 2 && secs[k + 1].X < x) k++;
    const a = secs[k], b = secs[k + 1];
    if (top[k] < 0 || top[k + 1] < 0) continue;
    const f = clamp((x - a.X) / Math.max(1e-6, b.X - a.X), 0, 1);
    T[i] = lerp(top[k], top[k + 1], f); Bt[i] = lerp(bot[k], bot[k + 1], f);
  }
  return { T, B: Bt };
}

/* ---------- grids ---------- */
function makeGrid(xs, ys) {
  const nx = xs.length, ny = ys.length;
  const cxm = new Float64Array(nx), cxp = new Float64Array(nx), cym = new Float64Array(ny), cyp = new Float64Array(ny);
  for (let i = 1; i < nx - 1; i++) { const a = xs[i] - xs[i - 1], b = xs[i + 1] - xs[i]; cxm[i] = 2 / (a * (a + b)); cxp[i] = 2 / (b * (a + b)); }
  for (let j = 1; j < ny - 1; j++) { const a = ys[j] - ys[j - 1], b = ys[j + 1] - ys[j]; cym[j] = 2 / (a * (a + b)); cyp[j] = 2 / (b * (a + b)); }
  return { xs, ys, nx, ny, cxm, cxp, cym, cyp };
}
const AGRID = (() => {
  const xs = []; for (let x = -7.6; x <= 5.6 + 1e-9; x += 0.04) xs.push(+x.toFixed(4));
  const ys = [0]; let y = 0;
  while (y < 1.6 - 1e-9) { y += 0.02; ys.push(+y.toFixed(4)); }
  let h = 0.02; while (y < 8) { h *= 1.075; y += h; ys.push(y); }
  const fine = makeGrid(Float64Array.from(xs), Float64Array.from(ys));
  const cx = xs.filter((_, i) => i % 2 === 0), cy = ys.filter((_, j) => j % 2 === 0);
  if (cx[cx.length - 1] !== xs[xs.length - 1]) cx.push(xs[xs.length - 1]);
  if (cy[cy.length - 1] !== ys[ys.length - 1]) cy.push(ys[ys.length - 1]);
  return { fine, coarse: makeGrid(Float64Array.from(cx), Float64Array.from(cy)) };
})();

function sor(G, psi, mask, iters, omega = 1.86) {
  const { nx, ny, cxm, cxp, cym, cyp } = G;
  for (let it = 0; it < iters; it++) {
    for (let j = 1; j < ny - 1; j++) {
      const r = j * nx, a = cym[j], b = cyp[j];
      for (let i = 1; i < nx - 1; i++) {
        const k = r + i;
        if (mask[k]) continue;
        const c = cxm[i], d = cxp[i];
        psi[k] += omega * ((c * psi[k - 1] + d * psi[k + 1] + a * psi[k - nx] + b * psi[k + nx]) / (c + d + a + b) - psi[k]);
      }
      if (!mask[r]) psi[r] = psi[r + 1];
    }
  }
}
function freeStream(G, psi) {
  const { nx, ny, ys } = G;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) psi[j * nx + i] = ys[j];
}
function sampleGrid(G, arr, x, y) {
  const { xs, ys, nx, ny } = G;
  let i = Math.floor((x - xs[0]) / (xs[1] - xs[0]));
  i = clamp(i, 0, nx - 2);
  while (i < nx - 2 && xs[i + 1] < x) i++;
  while (i > 0 && xs[i] > x) i--;
  let lo = 0, hi = ny - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ys[m] > y) hi = m; else lo = m; }
  const fx = clamp((x - xs[i]) / (xs[i + 1] - xs[i]), 0, 1), fy = clamp((y - ys[lo]) / (ys[lo + 1] - ys[lo]), 0, 1);
  const k = lo * nx + i;
  return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + nx] * (1 - fx) + arr[k + nx + 1] * fx) * fy;
}

/* ---------- solids for one slice and one state ---------- */
function polyInside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function polyDist(poly, x, y) {
  let d = 1e9;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], vx = b[0] - a[0], vy = b[1] - a[1];
    const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / Math.max(1e-12, vx * vx + vy * vy), 0, 1);
    d = Math.min(d, Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t));
  }
  return d;
}
function wingShapes(zq, ab, dep, real = false) {
  // polygons (car frame, x-y) of the lifting elements crossing this slice, plus their wake when stalled as an airbrake
  const out = [];
  if (state.wing === 'gt' && zq <= WING.span / 2) {
    const dy = lerp(-WING.drop, 0, Math.max(dep, ab));
    out.push(BODY.wingFoil.map(([x, y]) => [x, y + dy]));
    const ang = lerp(lerp(-0.12, -0.45, Math.max(dep, ab)), -1.12, ab), c = Math.cos(ang), s = Math.sin(ang);
    const [px, py] = BODY.flapPivotPos;
    const flap = BODY.flapFoil.map(([x, y]) => [px + x * c - y * s, py + dy + x * s + y * c]);
    out.push(flap);
    if (ab > 0.5 && !real) {
      let lo = flap[0], hi = flap[0];
      for (const p of flap) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; }
      const xb = Math.min(lo[0], hi[0]);
      out.push([[xb, hi[1]], [xb - 0.5, (hi[1] + lo[1]) / 2 + 0.03], [xb, lo[1] + 0.02]]);
    }
  } else if (state.wing === 'active' && zq <= SPOIL.span / 2) {
    const S = BODY.spoiler, d2 = Math.max(dep, ab);
    const lift = lerp(0, 0.125, d2) + 0.02 * ab, ang = lerp(lerp(0, 0.2, d2), 0.92, ab);
    const c = Math.cos(-ang), s = Math.sin(-ang), oy = S.baseY + lift + (S.hAt(zq) - S.deckY);
    const poly = S.prof.map(([x, y]) => [S.xLE + x * c - y * s, oy + x * s + y * c]);
    out.push(poly);
    if (ab > 0.5 && !real) {
      let lo = poly[0], hi = poly[0];
      for (const p of poly) { if (p[1] < lo[1]) lo = p; if (p[1] > hi[1]) hi = p; }
      out.push([[hi[0], hi[1]], [Math.min(lo[0], hi[0]) - 0.55, (hi[1] + lo[1]) / 2], [lo[0], lo[1] + 0.01]]);
    }
  }
  return out;
}
function buildMask(G, prof, fineXs, zq, ab, dep) {
  const { xs, ys, nx, ny } = G;
  const mask = new Uint8Array(nx * ny);
  const step = fineXs.length === nx ? 1 : 2;
  const wheels = zq > 0.62 && zq < 1.02;
  // wake bubble behind the Kamm tail (central slices only)
  let bub = null;
  const ti = prof.T.findIndex((v, i) => v > 0 && fineXs[i] >= XR + 0.01);
  if (!wheels && ti >= 0) {
    const yT = prof.T[ti], yB = BC.yf(XR);
    bub = { yT, yB, L: (0.55 + 0.75 * (yT - yB)) * (1 + 0.6 * ab) };
  }
  for (let i = 0; i < nx; i++) {
    const x = xs[i];
    const fi = Math.min(fineXs.length - 1, Math.round(i * step));
    let top = prof.T[fi], bot = prof.B[fi];
    if (x > SPL_X0 && x < XF + SPEC.parts.splitter.nose && zq < lipZ(Math.min(x, XF - 0.001)) + 0.028) { bot = 0.068; if (top < 0) top = 0.08; }
    for (let j = 0; j < ny; j++) {
      const y = ys[j];
      let s = 0;
      if (top > 0 && y >= bot - 1e-4 && y <= top) s = 1;
      if (!s && wheels) for (const w of AX) { if ((x - w.x) ** 2 + (y - w.yc) ** 2 <= w.R * w.R) { s = 1; break; } }
      if (!s && bub && x < XR && x > XR - bub.L) {
        const u = (XR - x) / bub.L;
        const lo = bub.yB - 0.07 * u, hi = lo + (bub.yT - lo) * Math.pow(Math.max(0, 1 - Math.pow(u, 1.5)), 1.1);
        if (y >= lo && y <= hi) s = 1;
      }
      if (s) mask[j * nx + i] = 1;
    }
  }
  const shapes = wingShapes(zq, ab, dep);
  for (const poly of shapes) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 0.6 * Math.max(xs[1] - xs[0], 0.02);
    for (let i = 0; i < nx; i++) {
      if (xs[i] < x0 - pad || xs[i] > x1 + pad) continue;
      for (let j = 0; j < ny; j++) {
        if (ys[j] < y0 - pad || ys[j] > y1 + pad) continue;
        if (polyInside(poly, xs[i], ys[j]) || polyDist(poly, xs[i], ys[j]) < pad * 0.75) { const k = j * nx + i; if (!mask[k]) mask[k] = 2; }
      }
    }
  }
  return { mask, wheels, shapes, bub };
}
function applyMask(G, psi, mask, psiB, psiW) {
  for (let k = 0; k < mask.length; k++) if (mask[k] === 1) psi[k] = psiB; else if (mask[k] === 2) psi[k] = psiW;
  const { nx, ny, ys } = G;
  for (let i = 0; i < nx; i++) { psi[i] = 0; psi[(ny - 1) * nx + i] = ys[ny - 1]; }
  for (let j = 0; j < ny; j++) psi[j * nx + nx - 1] = ys[j];
}

/* ---------- solve one slice for the normal state and the airbrake state ---------- */
function solveSlice(zq) {
  const { fine: F, coarse: Cg } = AGRID;
  const dep = state.wingUp ? 1 : 0;
  const prof = sliceProfile(zq, F.xs);
  const out = [];
  let prev = null, psiW = 0.9;
  for (const ab of [0, 1]) {
    const mf = buildMask(F, prof, F.xs, zq, ab, dep);
    const psiB = mf.wheels ? 0 : 0.11;
    const psi = new Float64Array(F.nx * F.ny);
    if (!prev) {
      const mc = buildMask(Cg, prof, F.xs, zq, ab, dep);
      const pc = new Float64Array(Cg.nx * Cg.ny);
      freeStream(Cg, pc);
      // first pass without the wing gives the stream value at its trailing edge; the wing then carries a little more flow beneath it (downforce)
      const noWing = mc.mask.map((v) => (v === 2 ? 0 : v));
      applyMask(Cg, pc, noWing, psiB, 0);
      sor(Cg, pc, noWing, 380);
      if (mc.shapes.length) {
        const foil = mc.shapes[0];
        let te = foil[0]; for (const p of foil) if (p[0] < te[0]) te = p;
        psiW = sampleGrid(Cg, pc, te[0] - 0.02, te[1]) + 0.035;
      }
      applyMask(Cg, pc, mc.mask, psiB, psiW);
      sor(Cg, pc, mc.mask, 220);
      for (let j = 0; j < F.ny; j++) for (let i = 0; i < F.nx; i++) psi[j * F.nx + i] = sampleGrid(Cg, pc, F.xs[i], F.ys[j]);
      applyMask(F, psi, mf.mask, psiB, psiW);
      sor(F, psi, mf.mask, 110, 1.8);
    } else {
      psi.set(prev);
      applyMask(F, psi, mf.mask, psiB, psiW);
      sor(F, psi, mf.mask, 150, 1.8);
    }
    prev = psi;
    out.push({ psi, mask: mf.mask, psiB, wheels: mf.wheels, bub: mf.bub });
  }
  return { zq, states: out, prof };
}

/* ---------- streamline tracing ---------- */
function traceLine(G, psi, mask, target) {
  const { xs, ys, nx } = G;
  const P = (x, y) => sampleGrid(G, psi, x, y);
  const grad = (x, y) => { const e = 0.012; return [(P(x + e, y) - P(x - e, y)) / (2 * e), (P(x, y + e) - P(x, y - e)) / (2 * e)]; };
  let x = xs[xs.length - 1] - 0.08, y = target;
  for (let n = 0; n < 6; n++) { const g = grad(x, y); y += (target - P(x, y)) / Math.max(0.2, g[1]); }
  const pts = [];
  for (let n = 0; n < 4000; n++) {
    const g = grad(x, y);
    const sp = Math.hypot(g[0], g[1]);
    pts.push([x, y, sp]);
    if (x < xs[0] + 0.3 || sp < 0.015 || y < 0.004) break;
    const h = 0.018;
    const xm = x - g[1] / sp * h * 0.5, ym = y + g[0] / sp * h * 0.5;
    const g2 = grad(xm, ym), s2 = Math.hypot(g2[0], g2[1]) || 1;
    x -= g2[1] / s2 * h; y += g2[0] / s2 * h;
    const g3 = grad(x, y), gg = g3[0] * g3[0] + g3[1] * g3[1];
    if (gg > 1e-6) { const c = (target - P(x, y)) / gg; x += c * g3[0]; y += c * g3[1]; }
  }
  return pts;
}
// resample on shared x stations so the normal and airbrake versions of a line can be blended
const AX_ST = (() => { const a = []; for (let x = 5.48; x > -7.2; x -= (x > 1.55 && x < 2.6 ? 0.012 : 0.03)) a.push(x); return a; })();
function resampleX(pts) {
  const out = new Float32Array(AX_ST.length * 2).fill(NaN);
  const clean = [];
  let xm = 1e9;
  for (const p of pts) if (p[0] < xm - 1e-5) { clean.push(p); xm = p[0]; }
  let k = 0;
  for (let i = 0; i < AX_ST.length; i++) {
    const x = AX_ST[i];
    while (k < clean.length - 2 && clean[k + 1][0] > x) k++;
    if (k >= clean.length - 1) break;
    const a = clean[k], b = clean[k + 1];
    if (x > a[0] || x < b[0]) continue;
    const f = (a[0] - x) / Math.max(1e-9, a[0] - b[0]);
    out[i * 2] = lerp(a[1], b[1], f); out[i * 2 + 1] = lerp(a[2], b[2], f);
  }
  return out;
}

/* ---------- ribbons ---------- */
function ribbonMaterial() {
  AERO.uni = {
    uTime: { value: 0 }, uBlend: { value: 0 }, uWidth: { value: 1.8 }, uTurb: { value: 1 }, uVis: { value: 3.5 },
    uPulse: { value: 1.5 }, uOpacity: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
  };
  return new THREE.ShaderMaterial({
    uniforms: AERO.uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aPosB; attribute vec3 aNext; attribute vec4 aData; attribute vec4 aMisc; attribute float aLum;
      uniform float uTime, uBlend, uWidth, uTurb, uVis; uniform vec2 uRes;
      varying vec4 vData; varying vec2 vMisc; varying float vLum;
      vec3 turb(vec3 p, float w, float seed) {
        float s = p.x + uTime * uVis;
        float k1 = s * 2.7 + seed * 6.2832, k2 = s * 4.9 + seed * 17.0 + p.y * 3.1, k3 = s * 8.3 + seed * 29.0 - uTime * 2.0;
        float grow = 0.035 + 0.08 * clamp((-2.1 - p.x) / 3.0, 0.0, 1.0);
        return w * uTurb * grow * vec3(0.0, sin(k1) * 0.6 + sin(k2) * 0.3 + sin(k3) * 0.18, cos(k1 * 0.8 + 1.7) * 0.55 + sin(k2 * 1.3 + 0.4) * 0.3);
      }
      void main() {
        float w = aMisc.x, seed = aMisc.y;
        vec3 p = mix(position, aPosB, uBlend);
        vec3 q = aNext + (p - position);
        p += turb(p, w, seed); q += turb(q, w, seed);
        vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec4 cq = projectionMatrix * viewMatrix * vec4(q, 1.0);
        vec2 d = (cq.xy / cq.w - cp.xy / cp.w) * uRes;
        float L = length(d);
        d = L > 1e-6 ? d / L : vec2(1.0, 0.0);
        cp.xy += vec2(-d.y, d.x) * aMisc.w * uWidth / uRes * cp.w;
        gl_Position = cp;
        vData = vec4(mix(aData.x, aData.y, uBlend), mix(aData.z, aData.w, uBlend), w, seed);
        vMisc = vec2(aMisc.z, aMisc.w);
        vLum = aLum;
      }`,
    fragmentShader: `
      uniform float uTime, uPulse, uOpacity, uVis;
      varying vec4 vData; varying vec2 vMisc; varying float vLum;
      // flow speed relative to the free stream: slow violet, free stream cyan, fast amber to red
      vec3 ramp(float s) {
        vec3 c = mix(vec3(0.30, 0.18, 1.0), vec3(0.08, 0.42, 1.0), smoothstep(0.4, 0.75, s));
        c = mix(c, vec3(0.16, 0.82, 1.0), smoothstep(0.75, 1.0, s));
        c = mix(c, vec3(0.82, 0.97, 0.95), smoothstep(1.02, 1.16, s));
        c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(1.16, 1.36, s));
        return mix(c, vec3(1.0, 0.22, 0.1), smoothstep(1.36, 1.62, s));
      }
      void main() {
        float loopMode = step(1.5, vData.w);
        float f = fract(mix(uTime * uPulse - vData.y / uVis * uPulse, uTime * 0.55 - vMisc.x * 2.0, loopMode));
        float head = exp(-f * 11.0);
        float a = (0.2 + 0.8 * head) * smoothstep(0.0, 0.035, vMisc.x) * (1.0 - smoothstep(0.88, 1.0, vMisc.x));
        a *= (1.0 - smoothstep(0.45, 1.0, abs(vMisc.y))) * vLum;
        gl_FragColor = vec4(ramp(vData.x) * (0.6 + 1.25 * head), a * uOpacity);
      }`,
  });
}
// polylines -> one ribbon geometry. each line: { A: [[x,y,z,speed,tau]...], B: same length, wake: [..], seed }
function ribbonGeometry(lines) {
  let nv = 0; for (const l of lines) nv += l.A.length * 2;
  const pos = new Float32Array(nv * 3), posB = new Float32Array(nv * 3), nxt = new Float32Array(nv * 3), dat = new Float32Array(nv * 4), misc = new Float32Array(nv * 4), lum = new Float32Array(nv);
  const idx = [];
  let v = 0;
  for (const l of lines) {
    const n = l.A.length;
    for (let i = 0; i < n; i++) {
      const a = l.A[i], b = l.B[i], an = l.A[Math.min(n - 1, i + 1)], ap = l.A[Math.max(0, i - 1)];
      const nx = i < n - 1 ? an : [2 * a[0] - ap[0], 2 * a[1] - ap[1], 2 * a[2] - ap[2]];
      for (const side of [-1, 1]) {
        pos.set([a[0], a[1], a[2]], v * 3); posB.set([b[0], b[1], b[2]], v * 3); nxt.set([nx[0], nx[1], nx[2]], v * 3);
        dat.set([a[3], b[3], a[4], b[4]], v * 4);
        misc.set([l.wake ? l.wake[i] : 0, l.seed, i / (n - 1), side], v * 4);
        lum[v] = l.lum === undefined ? 1 : l.lum;
        v++;
      }
      if (i) { const s = v - 4; idx.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPosB', new THREE.BufferAttribute(posB, 3));
  g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
  g.setAttribute('aData', new THREE.BufferAttribute(dat, 4));
  g.setAttribute('aMisc', new THREE.BufferAttribute(misc, 4));
  g.setAttribute('aLum', new THREE.BufferAttribute(lum, 1));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return g;
}

/* ---------- assemble lines, vortices and eddies for the current configuration ---------- */
function aeroKey() { return [state.wing, state.kit, state.wingUp ? 1 : 0].join('|'); }
async function buildAeroViz() {
  if (AERO.busy) { AERO.queued = true; return; }
  AERO.busy = true;
  const key = aeroKey();
  if (FLOW.pending) { AERO.busy = false; return; }
  if (FLOW.ok) {
    // the solver makes its own tip vortices, wake and recirculation
    if (AERO.mesh) AERO.mesh.visible = false;
    AERO.key = key; AERO.busy = false; AERO.queued = false; needsRender = true;
    return;
  }
  const F = AGRID.fine;
  const lines = [];
  const yield_ = () => new Promise((r) => (window.__TEST__ ? r() : requestAnimationFrame(() => r())));
  for (const zq of AERO.slices) {
    await yield_();
    const S = solveSlice(zq);
    const [A, B] = S.states;
    const levels = A.wheels ? [0.12, 0.22, 0.34, 0.48, 0.66, 0.88, 1.16, 1.5] : [0.035, 0.075, 0.17, 0.26, 0.38, 0.52, 0.7, 0.92, 1.2, 1.55];
    const tailTop = A.bub ? A.bub.yT : 0.9;
    for (const lv of levels) {
      const ra = resampleX(traceLine(F, A.psi, A.mask, lv)), rb = resampleX(traceLine(F, B.psi, B.mask, lv));
      // keep the run of stations where both versions exist
      let i0 = -1, i1 = -1;
      for (let i = 0; i < AX_ST.length; i++) { const ok = !isNaN(ra[i * 2]) && !isNaN(rb[i * 2]); if (ok && i0 < 0) i0 = i; if (ok) i1 = i; else if (i0 >= 0) break; }
      if (i0 < 0 || i1 - i0 < 30) continue;
      for (const sz of zq === 0 ? [0] : [-zq, zq]) {
        const LA = [], LB = [], wake = [];
        let tA = 0, tB = 0;
        for (let i = i0; i <= i1; i++) {
          const x = AX_ST[i];
          if (i > i0) {
            const xp = AX_ST[i - 1];
            tA += Math.hypot(x - xp, ra[i * 2] - ra[i * 2 - 2]) / Math.max(0.12, ra[i * 2 + 1]);
            tB += Math.hypot(x - xp, rb[i * 2] - rb[i * 2 - 2]) / Math.max(0.12, rb[i * 2 + 1]);
          }
          LA.push([x, ra[i * 2], sz, ra[i * 2 + 1], tA]);
          LB.push([x, rb[i * 2], sz, rb[i * 2 + 1], tB]);
          const y = ra[i * 2];
          wake.push(sstep(XR + 0.15, XR - 0.7, x) * (y < 0.5 && lv < 0.11 ? 1 : 1 - sstep(tailTop + 0.1, tailTop + 0.85, y)) * (A.wheels ? 0.6 : 1));
        }
        lines.push({ A: LA, B: LB, wake, seed: rand(), lum: lv > 1.0 ? 0.5 : 1 });
      }
    }
    // recirculating eddies inside the separated bubble behind the tail
    if (A.bub && B.bub) {
      for (const [fx, fy, fa, fb, dir] of [[0.42, 0.62, 0.34, 0.27, 1], [0.3, 0.2, 0.22, 0.13, -1]]) {
        for (const sz of zq === 0 ? [0] : [-zq, zq]) {
          const mk = (bb) => { const h = bb.yT - bb.yB; return { cx: XR - fx * bb.L, cy: bb.yB + fy * h, a: fa * bb.L, b: fb * h }; };
          const ea = mk(A.bub), eb = mk(B.bub);
          const N = 90, LA = [], LB = [], wake = [];
          for (let i = 0; i <= N; i++) {
            const th = dir * 2 * Math.PI * i / N + Math.PI / 2;
            LA.push([ea.cx + ea.a * Math.cos(th), ea.cy + ea.b * Math.sin(th), sz, 0.32, 0]);
            LB.push([eb.cx + eb.a * Math.cos(th), eb.cy + eb.b * Math.sin(th), sz, 0.3, 0]);
            wake.push(0.35);
          }
          lines.push({ A: LA, B: LB, wake, seed: 2 + rand() });
        }
      }
    }
  }
  // tip vortices off the wing or spoiler
  const tips = [];
  const dep = state.wingUp ? 1 : 0;
  if (state.wing === 'gt') {
    const dyA = lerp(-WING.drop, 0, dep), [tx, ty] = BODY.wingRel([-2.24, 1.29]), tz = WING.span / 2 + 0.005;
    tips.push({ A: [tx, ty + dyA, tz], B: [tx, ty, tz], r: 1 });
  } else if (state.wing === 'active') {
    const S = BODY.spoiler, yA = S.baseY + lerp(0, 0.125, dep) + 0.01, yB = S.baseY + 0.145 + 0.17;
    tips.push({ A: [S.xLE - 0.22, yA, SPOIL.span / 2], B: [S.xLE - 0.12, yB, SPOIL.span / 2], r: 0.6 });
  }
  for (const tip of tips) for (const side of [-1, 1]) for (let strand = 0; strand < 3; strand++) {
    const N = 220, LA = [], LB = [], wake = [];
    for (let i = 0; i <= N; i++) {
      const s = 6.2 * i / N;
      const r = (0.02 + 0.055 * Math.sqrt(s)) * tip.r;
      const th = strand * 2 * Math.PI / 3 + side * 2 * Math.PI * 1.9 * s / (1 + 0.22 * s);
      const pt = (o, grow) => [o[0] - s, o[1] - 0.035 * s + r * grow * Math.sin(th), side * (o[2] + 0.025 * s) + r * grow * Math.cos(th)];
      LA.push([...pt(tip.A, 1), 1.12 - 0.12 * Math.min(1, s / 3), s * 1.05]);
      LB.push([...pt(tip.B, 1.35), 1.2 - 0.12 * Math.min(1, s / 3), s * 1.1]);
      wake.push(0.25 * sstep(0.5, 3, s));
    }
    lines.push({ A: LA, B: LB, wake, seed: rand() });
  }
  const geo = ribbonGeometry(lines);
  if (!AERO.mesh) {
    AERO.mesh = new THREE.Mesh(geo, ribbonMaterial());
    AERO.mesh.frustumCulled = false;
    AERO.mesh.renderOrder = 4;
    AERO.mesh.userData.noShadow = true;
    scene.add(AERO.mesh);
  } else { AERO.mesh.geometry.dispose(); AERO.mesh.geometry = geo; }
  AERO.key = key;
  AERO.busy = false;
  needsRender = true;
  if (AERO.queued) { AERO.queued = false; if (aeroKey() !== AERO.key) buildAeroViz(); }
}

/* ---------- surface pressure map ---------- */
function pressureMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.0, envMapIntensity: 0.7, side: THREE.DoubleSide });
  m.userData.uni = {
    uWingY: { value: 0 }, uWingGT: { value: 1 }, uWingBox: { value: new THREE.Vector4(-2.3, -1.76, 0.98, 1.36) }, uWingZ: { value: 0.93 },
    tFlowM: { value: null }, uFlowOn: { value: 0 }, uFlowG: { value: new THREE.Vector4(0, 1, 0.1, 0) }, uFlowN: { value: new THREE.Vector4(1, 1, 1, 1) }, uW2C: { value: new THREE.Matrix4() },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN; varying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWN; varying vec3 vWP; uniform float uWingY; uniform float uWingGT; uniform vec4 uWingBox; uniform float uWingZ;
uniform sampler2D tFlowM; uniform float uFlowOn; uniform vec4 uFlowG, uFlowN; uniform mat4 uW2C;
// time-averaged pressure from the lattice-Boltzmann tunnel, read just off the skin: p = rho / 3 in lattice units,
// so Cp = (p - p_inf) / (rho u0^2 / 2) = 2 (rho - 1) / (3 u0^2). Solid cells carry no pressure and are left out.
float cpFlow(vec3 pw, vec3 nw, out float wsum) {
  ivec4 N = ivec4(uFlowN + 0.5);
  vec3 p = (uW2C * vec4(pw, 1.0)).xyz + normalize(mat3(uW2C) * nw) * 1.3 * uFlowG.y;
  vec3 g = vec3((p.x - uFlowG.x) / uFlowG.y, p.y / uFlowG.y, abs(p.z) / uFlowG.y) - 0.5;
  ivec3 i0 = ivec3(floor(g));
  vec3 t = g - vec3(i0);
  float rs = 0.0;
  wsum = 0.0;
  for (int k = 0; k < 8; k++) {
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, k >> 2), c = i0 + o;
    if (c.z < 0) c.z = -1 - c.z;
    if (c.x < 0 || c.y < 0 || c.x >= N.x || c.y >= N.y || c.z >= N.z) continue;
    vec4 m = texelFetch(tFlowM, ivec2(c.x + (c.z % N.w) * N.x, c.y + (c.z / N.w) * N.y), 0);
    vec3 b = mix(1.0 - t, t, vec3(o));
    float w = b.x * b.y * b.z;
    if (m.w > -1.0) { wsum += w; rs += w * m.w; }
  }
  return 2.0 * rs / max(wsum, 1e-5) / (3.0 * uFlowG.z * uFlowG.z);
}
float cpAt(vec3 n, vec3 p) {
  float c = n.x;                                   // facing the oncoming air (+x)
  float side = -0.16 - 0.5 * smoothstep(-1.8, 1.3, p.x) * (1.0 - 0.6 * smoothstep(1.6, 2.3, p.x));
  side -= 0.62 * smoothstep(0.55, 1.0, n.y) * smoothstep(0.66, 1.05, p.y) * step(p.x, 1.75);
  float cp = c > 0.0 ? mix(side, 1.0, pow(c, 1.6)) : mix(side, -0.24, smoothstep(0.0, -0.85, c));
  float under = smoothstep(-0.55, -0.95, n.y) * (1.0 - smoothstep(0.09, 0.3, p.y));
  float throat = smoothstep(2.4, 1.3, p.x) * (0.7 + 0.5 * smoothstep(0.6, -1.3, p.x)) * (1.0 - smoothstep(-1.6, -2.25, p.x));
  cp = mix(cp, -0.45 - 1.05 * throat, under);
  float wz = step(uWingBox.z + uWingY, p.y) * step(p.y, uWingBox.w + uWingY) * step(p.x, uWingBox.y) * step(uWingBox.x, p.x) * step(abs(p.z), uWingZ) * uWingGT;
  cp = mix(cp, n.y < 0.0 ? -0.3 - 1.4 * (-n.y) : 0.25 + 0.5 * n.y, wz);
  return clamp(cp, -1.6, 1.0);
}
vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x); vec2 v2 = v4.zw * v4.z;
  return clamp(vec3(dot(v4, vec4(0.13572138, 4.6153926, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
              dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
              dot(v4, vec4(0.1066733, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973))), 0.0, 1.0);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 wn = normalize(vWN) * (gl_FrontFacing ? 1.0 : -1.0);
float cpv = cpAt(wn, vWP);
if (uFlowOn > 0.0) { float ws; float cf = cpFlow(vWP, wn, ws); cpv = mix(cpv, clamp(cf, -2.2, 1.1), uFlowOn * smoothstep(0.12, 0.4, ws)); }
float tq = (cpv + 1.6) / 2.6;
float iso = abs(fract(cpv * 5.0 + 0.5) - 0.5) / max(fwidth(cpv * 5.0), 1e-4);
vec3 cpCol = pow(turbo(0.04 + 0.92 * tq), vec3(2.2)) * (1.0 - 0.4 * (1.0 - smoothstep(0.0, 1.2, iso)));
diffuseColor.rgb = cpCol;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cpCol * 0.32;');
  };
  return m;
}
function setPressureView(on) {
  if (!AERO.cpMat) {
    AERO.cpMat = pressureMaterial();
    // the canopy keeps its transparency so the cockpit view still looks out
    AERO.cpGlass = pressureMaterial();
    AERO.cpGlass.userData.uni = AERO.cpMat.userData.uni;
    Object.assign(AERO.cpGlass, { transparent: true, opacity: 0.22, depthWrite: false });
  }
  if (on && !AERO.saved) {
    AERO.saved = [];
    const decals = new Set(DECALS.map((d) => d.mesh || d));
    carRoot.traverse((o) => {
      if (!o.isMesh || o.material === M.blur) return;
      if (BODY.interior && (o === BODY.interior || isChildOf(o, BODY.interior))) return;
      AERO.saved.push([o, o.material, o.visible]);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (decals.has(o) || mats.some((m) => m.alphaMap || (m.transparent && m !== M.glass))) { o.visible = false; return; }
      const cp = (m) => (m === M.glass ? AERO.cpGlass : AERO.cpMat);
      o.material = Array.isArray(o.material) ? o.material.map(cp) : cp(o.material);
    });
  } else if (!on && AERO.saved) {
    for (const [o, m, vis] of AERO.saved) { o.material = m; o.visible = vis; }
    AERO.saved = null;
    applyLivery(); applyKit();
  }
}
const isChildOf = (o, p) => { for (let q = o.parent; q; q = q.parent) if (q === p) return true; return false; };

/* ---------- force arrows: front and rear downforce, drag ---------- */
function buildArrows() {
  const g = new THREE.Group();
  const mk = (color) => {
    const a = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1, 12).translate(0, 0.5, 0), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.1, 20).translate(0, 0.05, 0), mat);
    a.add(shaft, head);
    a.userData = { shaft, head, mat };
    g.add(a);
    return a;
  };
  AERO.arrows = { group: g, front: mk(new THREE.Color(0.55, 1.6, 2.2)), rear: mk(new THREE.Color(0.55, 1.6, 2.2)), drag: mk(new THREE.Color(2.4, 1.25, 0.3)) };
  g.visible = false;
  g.userData.noShadow = true;
  scene.add(g);
}
function poseArrow(a, base, dir, len) {
  len = Math.max(0.0, len);
  const L = Math.max(0.001, len - 0.1);
  a.userData.shaft.scale.set(1, L, 1);
  a.userData.head.position.set(0, L, 0);
  a.position.copy(base);
  a.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir);
  a.visible = len > 0.02;
}
const _ab = new V3();
function updateAeroViz(dt, t, snap = false) {
  const want = AERO.on ? 1 : 0;
  AERO.fade += (want - AERO.fade) * (1 - Math.exp(-dt * 5));
  if (Math.abs(AERO.fade - want) < 0.002) AERO.fade = want;
  if (AERO.on && !AERO.busy && AERO.key !== aeroKey()) buildAeroViz();
  const live = AERO.fade > 0.001;
  if (FLOW.ok) {
    if (live) updateFlow(dt, snap);
    updateFlowMesh(AERO.fade);
  }
  if (AERO.mesh) {
    AERO.mesh.visible = live && AERO.key !== '';
    const v = airspeed(), [w, h] = size0();
    const u = AERO.uni;
    u.uTime.value = t; u.uBlend.value = DRIVE.airbrake; u.uOpacity.value = AERO.fade;
    u.uVis.value = 1.8 + 2.4 * clamp(v / TUNNEL_V, 0.2, 1.3);
    u.uTurb.value = 0.7 + 1.5 * DRIVE.airbrake + 0.25 * clamp(v / 55, 0, 1.4);
    u.uRes.value.set(w * DPR, h * DPR);
    u.uWidth.value = 1.7 * DPR;
  }
  if (AERO.arrows) {
    AERO.arrows.group.visible = live;
    if (live) {
      const L = aeroLoads(airspeed());
      const k = 1 / 620;
      const yF = 1.0, yR = 1.0;
      poseArrow(AERO.arrows.front, _ab.set(AX[0].x, yF + L.front * k + 0.02, 0), new V3(0, -1, 0), L.front * k);
      poseArrow(AERO.arrows.rear, _ab.set(AX[1].x, yR + L.rear * k + 0.02, 0), new V3(0, -1, 0), L.rear * k);
      poseArrow(AERO.arrows.drag, _ab.set(XR - 0.06, 0.62, 0), new V3(-1, 0, 0), L.drag / 4200);
      for (const a of [AERO.arrows.front, AERO.arrows.rear, AERO.arrows.drag]) a.userData.mat.opacity = 0.95 * AERO.fade;
    }
  }
  if (AERO.cpMat) {
    const U = AERO.cpMat.userData.uni;
    U.uWingY.value = BODY.wing.position.y; U.uWingGT.value = state.wing === 'gt' ? 1 : 0;
    const w0 = BODY.wingRel([-2.3, 0.98]), w1 = BODY.wingRel([-1.76, 1.36]);
    U.uWingBox.value.set(w0[0], w1[0], w0[1], w1[1]); U.uWingZ.value = WING.span / 2 + 0.01;
    U.uFlowOn.value = FLOW.ok && live ? FLOW.cpOn : 0;
    if (FLOW.ok) {
      const L = FLOW.L;
      U.tFlowM.value = L.mrt[L.mcur].texture;
      U.uFlowG.value.set(FLOW.X0, FLOW.DX, Math.max(FLOW.u0, 1e-3), 0);
      U.uFlowN.value.set(L.NX, L.NY, L.NZ, L.TX);
      car.updateMatrixWorld();
      U.uW2C.value.copy(car.matrixWorld).invert();
    }
  }
  return live;
}
async function setAero(on) {
  AERO.on = on;
  if (on) {
    syncUI();
    FLOW.init = FLOW.init || flowInit();
    await FLOW.init;
    if (!AERO.on) return;   // switched off again while the solver was getting ready
  }
  if (on && FLOW.ok) {
    flowReset();
    if (!flowSelfTest()) { FLOW.ok = false; if (FLOW.mesh) FLOW.mesh.visible = false; AERO.key = ''; }
    else flowReset();
  }
  setPressureView(on);
  if (on && !AERO.arrows) buildArrows();
  syncUI();
  needsRender = true;
  if (on && AERO.key !== aeroKey()) await buildAeroViz();
}
