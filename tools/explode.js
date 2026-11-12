// Exploded view: takes every model apart and puts it back together.
//   test page (stills): the cut panels cover exactly the skin they replace, every part leaves its place and returns to it,
//                       nothing extra is drawn once the car is whole again
//   live page (clicks): the button, a driving program and the airflow view while the car is apart
// usage: node tools/explode.js [--shots]      (--shots saves out/explode_<model>.png)
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
const shots = process.argv.includes('--shots');
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); return ok ? 'ok' : 'FAIL'; };

(async () => {
  await new Promise((r) => server.listen(8769, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  const open = async (file, w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(400000);
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:8769/' + file);
    return page;
  };

  /* ---------- stills ---------- */
  let page = await open('dev/test.html', 1280, 720);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  for (const id of ['h9', 'g8', 'e4', 'r10']) {
    if (id !== 'h9') {
      await page.evaluate((m) => window.__ui.setModel(m), id);
      await page.waitForFunction((m) => window.__ui.SPEC.id === m && !document.body.classList.contains('is-switching'), id, { timeout: 300000 });
    }
    const r = await page.evaluate(() => {
      const u = window.__ui, X = u.XPL, B = u.BODY;
      const area = (g) => {
        const p = g.attributes.position.array, ix = g.index ? g.index.array : null, n = ix ? ix.length : p.length / 3;
        let a = 0;
        for (let t = 0; t < n; t += 3) {
          const i = (ix ? ix[t] : t) * 3, j = (ix ? ix[t + 1] : t + 1) * 3, k = (ix ? ix[t + 2] : t + 2) * 3;
          const ux = p[j] - p[i], uy = p[j + 1] - p[i + 1], uz = p[j + 2] - p[i + 2], vx = p[k] - p[i], vy = p[k + 1] - p[i + 1], vz = p[k + 2] - p[i + 2];
          a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        }
        return a;
      };
      const moved = () => X.parts.filter((p) => p.o.position.lengthSq() > 1e-8).length;
      const calls0 = window.__info().calls;
      const t0 = performance.now();
      u.setExplode(true); window.__renderNow();
      const ms = Math.round(performance.now() - t0);
      const decals = B.shell.children.filter((o) => o !== B.skin);
      const out = {
        parts: X.parts.length, apart: moved(), ms,
        skin: +area(B.skin.geometry).toFixed(4), panels: +X.panels.reduce((s, h) => s + area(h.children[0].geometry), 0).toFixed(4), nPanels: X.panels.length,
        decals: +decals.reduce((s, d) => s + area(d.geometry), 0).toFixed(4), pieces: +X.pieces.reduce((s, [m]) => s + area(m.geometry), 0).toFixed(4),
        shellHidden: !B.shell.visible, calls1: window.__info().calls,
      };
      u.goView('front', 0);
      out.png = window.__grab();
      u.setExplode(false); window.__renderNow();
      Object.assign(out, { back: moved(), shellBack: B.shell.visible, twinsOff: X.twins.every((t) => !t.visible), panelsOff: X.panels.every((h) => !h.visible), calls0, calls2: window.__info().calls });
      u.goView('front', 0);
      return out;
    });
    if (shots) { fs.mkdirSync(path.join(root, 'out'), { recursive: true }); fs.writeFileSync(path.join(root, 'out', `explode_${id}.png`), Buffer.from(r.png.split(',')[1], 'base64')); }
    delete r.png;
    console.log(id, JSON.stringify(r));
    console.log('  panels cover the skin:', check(Math.abs(r.panels - r.skin) < 1e-3 * r.skin && r.nPanels === 7, id + ' panel area'),
      '| lettering cut with them:', check(Math.abs(r.pieces - r.decals) < 1e-3 * Math.max(r.decals, 1e-6), id + ' decal area'),
      '| every part leaves:', check(r.apart === r.parts && r.shellHidden, id + ' apart'),
      '| and returns:', check(r.back === 0 && r.shellBack && r.twinsOff && r.panelsOff, id + ' back'),
      '| draw calls as before:', check(r.calls2 === r.calls0, id + ' draw calls'));
  }
  await page.close();

  /* ---------- clicks ---------- */
  page = await open('dev/live.html', 960, 540);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 300000 });
  const st = () => page.evaluate(() => { const u = window.__ui, b = document.querySelector('[data-toggle="explode"]'); return { explode: u.state.explode, k: +u.XPL.k.toFixed(3), pose: u.state.pose, prog: u.DRIVE.prog, engine: u.DRIVE.engine, v: +u.DRIVE.v.toFixed(1), aero: u.AERO.on, pressed: b.getAttribute('aria-pressed'), title: b.title }; });
  const K = (k) => page.waitForFunction((q) => window.__ui.XPL.k === q, k, { timeout: 400000, polling: 250 });
  await page.click('[data-toggle="explode"]'); await K(1);
  let s = await st();
  console.log('button:', JSON.stringify(s), check(s.explode && s.pressed === 'true' && s.title === '组合', 'button takes the car apart'));
  if (shots) await page.screenshot({ path: path.join(root, 'out', 'explode_ui.png'), timeout: 120000 });
  // a driving program: together first, then the engine
  await page.click('[data-pose="cruise"]');
  s = await st();
  const waited = s.prog === 'park' && s.engine === 0;
  await K(0);
  await page.waitForFunction(() => window.__ui.DRIVE.prog === 'cruise', null, { timeout: 400000, polling: 250 });
  s = await st();
  console.log('cruise:', JSON.stringify(s), check(waited && !s.explode && s.pressed === 'false' && s.k === 0, 'whole before it drives'));
  // asked for while driving: the car parks, stops, and then comes apart
  await page.click('[data-toggle="explode"]');
  s = await st();
  const parked = s.pose === 'park' && s.k === 0;
  await K(1);
  s = await st();
  console.log('from driving:', JSON.stringify(s), check(parked && s.v === 0 && s.engine === 0, 'parks before it comes apart'));
  // the airflow view wants a whole car, and taking the car apart again switches the airflow off
  // (not waited for: the software renderer needs minutes for the wind tunnel's first frames)
  await page.click('[data-toggle="aero"]');
  s = await st();
  const whole = s.aero && !s.explode && s.pressed === 'false';
  await page.click('[data-toggle="explode"]'); await K(1);
  s = await st();
  console.log('airflow:', JSON.stringify(s), check(whole && !s.aero && s.explode, 'airflow and the exploded view exclude each other'));
  // another model while apart: it comes apart in its turn
  await page.click('[data-model="e4"]');
  await page.waitForFunction(() => window.__ui.SPEC.id === 'e4' && !document.body.classList.contains('is-switching'), null, { timeout: 400000 });
  await K(1);
  s = await st();
  console.log('model change:', JSON.stringify(s), check(s.explode && s.k === 1, 'new model comes apart'));
  await page.click('[data-toggle="explode"]'); await K(0);
  s = await st();
  console.log('together:', JSON.stringify(s), check(!s.explode && s.pressed === 'false' && s.title === '分解', 'button puts it together'));
  const bad = errs.filter((e) => !e.includes('GPU stall') && !e.includes('GL Driver'));
  console.log(bad.join('\n') || 'no errors');
  if (bad.length) fails.push('console errors');
  await browser.close(); server.close();
  if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); }
  console.log('exploded view ok');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
