// Free driving in the real page: out of the studio onto the land with a click, away under the keys (throttle,
// steering, brake, handbrake, reverse), the camera and the other switches, back onto the road, back to the studio,
// then the same start for every model. Reports page errors. --shots saves pictures on the way (out/free_*.png).
// usage: node tools/free.js [--shots] [--quick]
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
const shots = process.argv.includes('--shots'), quick = process.argv.includes('--quick');
(async () => {
  await new Promise((r) => server.listen(8771, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.setDefaultTimeout(600000);
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/GPU stall|GL Driver|UniformsUtils|already non-indexed/.test(t)) errs.push(m.type() + ': ' + t.slice(0, 300)); } });
  let fail = 0;
  const check = (name, ok, info = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fail++; };
  const st = () => page.evaluate(() => { const u = window.__ui, F = u.FREE, d = u.DRIVE; return { on: F.on, mix: +u.WORLD.mix.toFixed(2), kind: u.WORLD.kind, kmh: +(Math.hypot(F.u, F.w) * 3.6).toFixed(1), u: +F.u.toFixed(2), s: +F.s.toFixed(0), n: +F.n.toFixed(1), gear: d.gear, rpm: Math.round(d.rpm), engine: d.engine, th: +F.th.toFixed(2), view: u.state.view, pose: u.state.pose, x: +F.x.toFixed(1), z: +F.z.toFixed(1), air: F.air, road: F.onRoad, lap: F.lap.on }; });
  const shot = async (name) => { if (shots) { fs.mkdirSync(path.join(root, 'out'), { recursive: true }); await page.screenshot({ path: path.join(root, 'out', 'free_' + name + '.png'), timeout: 300000 }); console.log('     saved out/free_' + name + '.png'); } };
  // (the software renderer manages a few frames a second, and the model runs in step with the frames: wait on the
  // car itself, not on the clock)
  const until = (fn, arg, timeout = 600000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  await page.goto('http://localhost:8771/dev/live.html');
  await until(() => document.body.classList.contains('is-ready'));
  await page.click('[data-pose="free"]');
  await until(() => window.__ui.FREE.on && window.__ui.WORLD.mix >= 1 && window.__ui.DRIVE.engine >= 1);
  let s = await st();
  check('out of the studio onto the grid', s.on && s.kind === 'land' && s.view === 'chase' && s.kmh < 1 && s.road, JSON.stringify(s));
  check('the map and the lap clock are shown', await page.evaluate(() => document.body.classList.contains('land-on') && document.body.classList.contains('is-driving')));
  await shot('grid');
  // away: throttle held
  await page.keyboard.down('KeyW');
  await until(() => window.__ui.FREE.u > 30);
  s = await st();
  check('pulls away under the throttle key', s.kmh > 100 && s.gear >= 2 && s.road, JSON.stringify(s));
  check('the lap clock starts over the line', s.lap);
  await shot('straight');
  // steering: a tap to the right moves the car to the right of the road and it stays on it
  const n0 = s.n;
  await page.keyboard.down('KeyD');
  await until((n) => window.__ui.FREE.n > n + 1.2 || !window.__ui.FREE.onRoad, n0);
  await page.keyboard.up('KeyD');
  s = await st();
  check('steers', s.n > n0 + 1, 'n ' + n0 + ' -> ' + s.n);
  await page.keyboard.up('KeyW');
  // brake to a stop, then the brake key reverses
  await page.keyboard.down('KeyS');
  await until(() => window.__ui.FREE.u < -2);
  s = await st();
  check('brakes to a stop, then backs up', s.u < -2 && s.gear === -1, JSON.stringify(s));
  await page.keyboard.up('KeyS');
  await page.keyboard.down('KeyW');
  await until(() => window.__ui.FREE.u > 8);
  s = await st();
  check('forward again', s.gear >= 1 && s.u > 8);
  if (!quick) {
    // handbrake turn
    const th0 = s.th;
    await until(() => window.__ui.FREE.u > 22);
    await page.keyboard.down('KeyA'); await page.keyboard.down('Space');
    await until((t) => Math.abs(window.__ui.FREE.th - t) > 1.2 || Math.hypot(window.__ui.FREE.u, window.__ui.FREE.w) < 2, th0);
    await shot('handbrake');
    await page.keyboard.up('Space'); await page.keyboard.up('KeyA');
    s = await st();
    check('the handbrake swings the car round', Math.abs(s.th - th0) > 0.8, 'heading ' + th0 + ' -> ' + s.th);
  }
  await page.keyboard.up('KeyW');
  // camera, assists, time of day, the car driving itself
  await page.keyboard.press('KeyC');
  check('C: the further camera', await page.evaluate(() => window.__ui.CHASE.far === true && window.__ui.state.view === 'chase'));
  await page.keyboard.press('KeyC');
  check('C: the driver\'s seat', (await st()).view === 'driver');
  await page.keyboard.press('KeyC');
  check('C: behind the car again', (await st()).view === 'chase');
  await page.keyboard.press('KeyT');
  check('T: assists off', await page.evaluate(() => window.__ui.FREE.assist.tcs === false));
  await page.keyboard.press('KeyT');
  await page.keyboard.press('KeyN');
  check('N: another time of day', await page.evaluate(() => window.__ui.LAND.tod === 'day'));
  await shot('day');
  await page.keyboard.press('KeyR');
  s = await st();
  check('R: back on the road, at rest', s.road && s.kmh < 1 && Math.abs(s.n) <= 3.1, JSON.stringify(s));
  await page.keyboard.press('KeyP');
  await until(() => window.__ui.FREE.auto && window.__ui.FREE.u > 25);
  s = await st();
  check('P: the car drives itself along the road', s.road && s.kmh > 80, JSON.stringify(s));
  await shot('auto');
  await page.keyboard.press('KeyN'); await page.keyboard.press('KeyN');
  // back to the studio
  await page.keyboard.press('Escape');
  await until(() => !window.__ui.FREE.on && window.__ui.WORLD.mix === 0 && window.__ui.DRIVE.engine === 0);
  s = await st();
  check('Esc: stops, parks, the studio comes back', s.pose === 'park' && s.mix === 0 && s.view === 'front', JSON.stringify(s));
  check('the driving display is gone', await page.evaluate(() => !document.body.classList.contains('land-on') && !document.body.classList.contains('is-driving')));
  await shot('studio');
  if (!quick) {
    // the night circuit still runs, and the land comes back after it
    await page.click('[data-pose="cruise"]');
    await until(() => window.__ui.DRIVE.v > 8 && window.__ui.WORLD.kind === 'track');
    check('the circuit programs still run', true);
    await page.click('[data-pose="free"]');
    await until(() => window.__ui.FREE.on && window.__ui.WORLD.kind === 'land' && window.__ui.WORLD.mix >= 1);
    check('from the circuit to the land, by way of the studio', true);
    // every model starts and pulls away out there
    for (const id of ['g8', 'e4', 'r10']) {
      await page.click(`[data-model="${id}"]`);
      await until((m) => window.__ui.SPEC.id === m && !document.body.classList.contains('is-switching'), id);
      await page.click('[data-pose="free"]');
      await until(() => window.__ui.FREE.on && window.__ui.WORLD.mix >= 1 && window.__ui.DRIVE.engine >= 1);
      await page.keyboard.down('ArrowUp');
      await until(() => window.__ui.FREE.u > 20);
      await page.keyboard.up('ArrowUp');
      s = await st();
      check(id + ' drives', s.kmh > 60 && s.road, JSON.stringify(s));
    }
    await shot('model');
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close(); server.close();
  if (fail || errs.length) process.exit(1);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
