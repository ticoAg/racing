// Builds the free-drive map without a browser, prints what the road is like (length, tightest bend, steepest climb,
// cuts and fills, barriers, trees) and saves a picture of it: relief, water, woods, the road and its barriers.
// usage: node tools/landmap.js [out.png] [--zoom=x,z,span]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'blk_landgen.js'), 'utf8');
const api = new Function(src + '; return { LG, lgSteps, lgLandH, lgRoadAt, lgRoadPose, lgGround, lgLakeD, lgField, lgRibbonY, LG_WALL_N };')();
const { LG, lgSteps, lgLandH, lgRoadPose, lgGround } = api;
const t0 = Date.now();
for (const f of lgSteps()) { const t = Date.now(); f(); process.stdout.write((Date.now() - t) + ' ms  '); }
console.log('\nbuilt in', Date.now() - t0, 'ms');
const R = LG.road;
let kmax = 0, gmax = 0, hmin = 1e9, hmax = -1e9, cut = 0, fill = 0, rmax = 0;
const p = {};
for (let i = 0; i < R.n; i++) {
  kmax = Math.max(kmax, Math.abs(R.k[i]));
  gmax = Math.max(gmax, Math.abs(R.h[i + 1] - R.h[i]) / R.ds);
  hmin = Math.min(hmin, R.h[i]); hmax = Math.max(hmax, R.h[i]);
  rmax = Math.max(rmax, Math.hypot(R.x[i], R.z[i]));
  for (const side of [-1, 1]) { lgRoadPose(i * R.ds, side * 40, p); const d = lgLandH(p.x, p.z) - p.h; cut = Math.max(cut, d); fill = Math.min(fill, d); }
}
const wl = (A) => { let n = 0; for (let i = 0; i < R.n; i++) if (A[i]) n++; return n; };
console.log({ length: +R.L.toFixed(1), samples: R.n, tightestRadius: +(1 / kmax).toFixed(1), steepest: +(gmax * 100).toFixed(1) + '%', low: +hmin.toFixed(1), high: +hmax.toFixed(1),
  farthest: +rmax.toFixed(0), cut40: +cut.toFixed(1), fill40: +fill.toFixed(1), corners: R.corners.length, kerbs: LG.kerbs.length, walls: LG.walls.length, wallL: wl(R.wallL), wallR: wl(R.wallR),
  trees: LG.trees.n, rocks: LG.rocks.n, obstacles: LG.obst.list.length / 3, spawn: LG.spawn });
// the road must lie on top of the land along its whole width, and the land must come up over the verge's outer edge
{
  let poke = 0, gap = 0, n = 0;
  const g = {};
  for (let i = 0; i < R.n; i += 3) for (const off of [-11, -6, 0, 6, 11]) {
    lgRoadPose(i * R.ds, off, p); n++;
    if (lgLandH(p.x, p.z) > p.h - 0.05) poke++;
  }
  for (let i = 0; i < R.n; i += 3) for (const off of [-14.4, 14.4]) { lgRoadPose(i * R.ds, off, p); if (lgLandH(p.x, p.z) < p.h - 1.0) gap++; }
  console.log('land above the road at', poke, 'of', n, 'points; verge edge above the land at', gap);
  lgGround(LG.spawn.x, LG.spawn.z, g); console.log('spawn ground', g);
}
// picture
const arg = process.argv.find((a) => a.startsWith('--zoom='));
const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'out/landmap.png';
const S = 1024;
let cx = 0, cz = 0, span = LG.SIZE;
if (arg) [cx, cz, span] = arg.slice(7).split(',').map(Number);
const px = new Uint8Array(S * S * 3);
const wx = (i) => cx - span / 2 + (i + 0.5) * span / S, wz = (j) => cz - span / 2 + (j + 0.5) * span / S;
const o = {};
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const x = wx(i), z = wz(j), e = span / S;
  if (Math.abs(x) > LG.HALF - 8 || Math.abs(z) > LG.HALF - 8) continue;
  const h = lgLandH(x, z), hx = lgLandH(x + e, z) - h, hz = lgLandH(x, z + e) - h;
  const shade = Math.max(0.25, Math.min(1.3, 0.85 + (-hx - hz) / e * 0.9));
  const t = Math.max(0, Math.min(1, (h - 10) / 330));
  let c = t < 0.25 ? [70 + 200 * t, 120 + 80 * t, 60] : t < 0.6 ? [120 + 100 * (t - 0.25), 140 - 40 * (t - 0.25), 60 + 60 * (t - 0.25)] : [155 + 250 * (t - 0.6), 126 + 300 * (t - 0.6), 81 + 400 * (t - 0.6)];
  const bn = 1024, bq = (Math.floor((z + LG.HALF) / LG.SIZE * bn) * bn + Math.floor((x + LG.HALF) / LG.SIZE * bn)) * 4;
  if (LG.biome[bq + 1] > 100) c = [c[0] * 0.55, c[1] * 0.75, c[2] * 0.5];
  if (LG.biome[bq + 2] > 150) c = [150, 145, 140];
  if (LG.biome[bq + 3] > 100) c = [215, 200, 150];
  if (h < LG.WATER) c = [50, 110, 190];
  const g = lgGround(x, z, o);
  if (g.road) c = g.surf === 0 ? [40, 40, 44] : g.surf === 1 ? [220, 40, 40] : [c[0] * 0.8 + 30, c[1] * 0.8 + 50, c[2] * 0.8];
  const q = (j * S + i) * 3;
  px[q] = Math.min(255, c[0] * shade); px[q + 1] = Math.min(255, c[1] * shade); px[q + 2] = Math.min(255, c[2] * shade);
}
const dot = (x, z, col, r = 0) => {
  const i = Math.round((x - cx + span / 2) / span * S - 0.5), j = Math.round((z - cz + span / 2) / span * S - 0.5);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const u = i + a, v = j + b; if (u < 0 || v < 0 || u >= S || v >= S) continue; const q = (v * S + u) * 3; px[q] = col[0]; px[q + 1] = col[1]; px[q + 2] = col[2]; }
};
if (span < 1500) for (let i = 0; i < LG.trees.n; i++) dot(LG.trees.x[i], LG.trees.z[i], LG.trees.kind[i] === 0 ? [20, 70, 40] : LG.trees.kind[i] === 1 ? [60, 120, 30] : [140, 170, 40], 0);
for (const w of LG.walls) for (let i = w.i0; i < w.i1; i++) { lgRoadPose(i * R.ds, w.side * api.LG_WALL_N[w.kind], p); dot(p.x, p.z, w.kind === 2 ? [255, 255, 255] : [255, 170, 0], 0); }
if (span > 1500) for (let i = 0; i < R.n; i++) dot(R.x[i], R.z[i], [250, 250, 250], 1);
for (let s = 0; s < R.L; s += 500) { lgRoadPose(s, 0, p); dot(p.x, p.z, s === 0 ? [255, 0, 0] : [255, 220, 0], span > 1500 ? 4 : 2); }
// minimal PNG writer
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const raw = Buffer.alloc(S * (S * 3 + 1));
for (let j = 0; j < S; j++) { raw[j * (S * 3 + 1)] = 0; Buffer.from(px.buffer, j * S * 3, S * 3).copy(raw, j * (S * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('saved', out);
console.table(R.corners.map((c) => { const m = Math.round((c.i0 + c.i1) / 2); return { s: c.i0, len: c.i1 - c.i0, dir: c.sgn > 0 ? 'R' : 'L', radius: +(1 / c.peak).toFixed(0), turn: +((R.th[c.i1] - R.th[c.i0]) * 57.3).toFixed(0), x: +R.x[m].toFixed(0), z: +R.z[m].toFixed(0), h: +R.h[m].toFixed(1) }; }));
