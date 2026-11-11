// Physics checks for the airflow solver (src/blk_flow.js), run headless on the real shaders.
//  1. Drag of a square plate square-on to the flow, with the car's own solver settings (LES, wall model), from the
//     momentum exchange at its surface, against Cd 1.17 at high Reynolds numbers (Hoerner, Fluid-Dynamic Drag).
//  2. The car in the tunnel: stagnation at the nose, faster air over the roof, the wing sucking (lower pressure
//     underneath), reverse flow behind the tail, a calm free stream upstream, nothing blowing up.
// usage: node tools/flow_check.js [--quick] [--car=g8]     (--quick: coarser plate and fewer steps; --car: another model)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
  // repo root first (dev/ pages, node_modules), then public/ (vendor/, fonts/) — mirrors the deployed site
  const tryRead = (paths) => { const p = paths.shift(); fs.readFile(p, (e, d) => { if (e) { if (paths.length) return tryRead(paths); res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); };
  tryRead([path.join(root, url), path.join(root, 'public', url)]);
});
const quick = process.argv.includes('--quick');
const carArg = (process.argv.find((a) => a.startsWith('--car=')) || '').slice(6);
(async () => {
  await new Promise((r) => server.listen(8774, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
  page.setDefaultTimeout(7200000);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // the car case runs on the 7 cm grid (the one phones get) to keep the software renderer's time reasonable
  await page.addInitScript(() => { window.__FLOW_GRID = { DX: 0.07, NX: 154, NY: 39, NZ: 34 }; });
  await page.goto('http://localhost:8774/dev/test.html' + (carArg ? '?car=' + carArg : ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  const fails = [];
  const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };

  const plate = await page.evaluate((q) => window.__ui.FLOW.checkBody(q ? { shape: 'plate', D: 8, steps: 4000 } : { shape: 'plate', D: 10, steps: 6000 }), quick);
  console.log('plate', JSON.stringify(plate));
  check(Math.abs(plate.err) < 0.25, `square plate: Cd ${plate.cd} (±${plate.sd} over the second half) vs ${plate.ref} (${(plate.err * 100).toFixed(1)}%)`);

  const car = await page.evaluate(async (n) => {
    await window.__ui.setAero(true);
    const F = window.__ui.FLOW;
    if (!F.ok) return null;
    for (let s = 0; s < n; s += 100) { F.advance(100); await new Promise((r) => setTimeout(r, 0)); }
    return F.probe();
  }, quick ? 900 : 1500);
  console.log('car', JSON.stringify(car));
  if (!car) check(false, 'solver did not start');
  else {
    check(car.nan === 0, `no NaN cells (${car.nan})`);
    check(car.cpNose > 0.6 && car.cpNose < 1.3, `stagnation at the nose: Cp ${car.cpNose}`);
    check(car.roof > 1.05, `air speeds up over the roof: ${car.roof} x free stream`);
    // (only where the swan-neck wing is fitted: some models stand with the active spoiler)
    if ('cpBelow' in car.wing) check(car.wing.cpBelow < car.wing.cpAbove - 0.1, `wing pushes down: Cp ${car.wing.cpBelow} under it, ${car.wing.cpAbove} over it (air ${car.wing.below} / ${car.wing.above} x free stream)`);
    check(car.wakeReverse > 50, `recirculation behind the tail: ${car.wakeReverse} cells of reverse flow`);
    check(Math.abs(car.upstream - 1) < 0.06, `free stream upstream: ${car.upstream}`);
    check(car.speedMax < 2.5, `no runaway cells: fastest air ${car.speedMax} x free stream`);
  }
  await browser.close(); server.close();
  if (fails.length) { console.log(`FAIL: ${fails.length} check(s)`); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
