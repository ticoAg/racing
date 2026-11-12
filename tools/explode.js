// Parts store: takes every model apart onto the floor, system by system, and puts it back together.
//   test page (stills): the cut panels cover exactly the skin they replace; every part lies on the floor inside its
//                       system's bay and no two parts overlap; one system can be fitted on its own; nothing dips
//                       under the floor on the way; nothing extra is drawn once the car is whole again
//   live page (clicks): the button and the system buttons, a driving program, the airflow view, a model change
// usage: node tools/explode.js [--shots] [--stills]      (--shots saves out/store_<model>.png and out/store_ui.png; --stills skips the clicks)
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
  if (shots) fs.mkdirSync(path.join(root, 'out'), { recursive: true });

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
      // where the parts are right now: the box round each one in the studio
      const boxes = () => X.items.filter((it) => it.at).map((it) => {
        const b = new X.box.constructor();
        for (const j of it.objs) b.union(new X.box.constructor().setFromObject(j.o, true));
        return { key: it.key, mod: it.mod, b };
      });
      const home = (mod) => X.items.filter((it) => !mod || it.mod === mod).every((it) => it.objs.every((j) => j.o.position.lengthSq() < 1e-12));
      const calls0 = window.__info().calls;
      // (twice: the front wheels straighten up in the frame after the store opens)
      u.setExplode(true); window.__renderNow(); window.__renderNow();
      const laid = boxes(), out = { parts: X.items.length, laid: laid.length, bays: Object.keys(X.bays).length };
      out.floor = [Math.min(...laid.map((p) => p.b.min.y)), Math.max(...laid.map((p) => p.b.min.y))].map((v) => +v.toFixed(4));
      // each inside its own bay
      out.astray = laid.filter((p) => { const z = X.bays[p.mod], e = 1e-3; return !(p.b.min.x >= z.x0 - e && p.b.max.x <= z.x1 + e && p.b.min.z >= z.z0 - e && p.b.max.z <= z.z1 + e); }).map((p) => p.key);
      // no two on the same floor
      out.overlaps = [];
      for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i].b, b = laid[j].b, e = 1e-3;
        if (a.min.x < b.max.x - e && b.min.x < a.max.x - e && a.min.z < b.max.z - e && b.min.z < a.max.z - e) out.overlaps.push(laid[i].key + '/' + laid[j].key);
      }
      // parts with no place are the ones not fitted to this car (the other wing, the track kit)
      out.unplaced = X.items.filter((it) => !it.at).map((it) => it.key);
      const decals = B.shell.children.filter((o) => o !== B.skin);
      Object.assign(out, {
        skin: +area(B.skin.geometry).toFixed(4), panels: +X.panels.reduce((s, h) => s + area(h.children[0].geometry), 0).toFixed(4), nPanels: X.panels.length,
        decals: +decals.reduce((s, d) => s + area(d.geometry), 0).toFixed(4), pieces: +X.pieces.reduce((s, [m]) => s + area(m.geometry), 0).toFixed(4),
        shellHidden: !B.shell.visible, span: [X.box.max.x - X.box.min.x, X.box.max.z - X.box.min.z].map((v) => +v.toFixed(1)),
      });
      u.goView('front', 0);
      out.png = window.__grab();
      // one system back onto the car, the others stay where they are
      u.setModule('wheels', false); window.__renderNow();
      out.one = home('wheels') && !home('body') && !home('cabin') && X.any;
      u.setModule('wheels', true); window.__renderNow();
      // half way there: nothing under the floor
      X.hold = 0.5; window.__renderNow();
      out.dip = +Math.min(...boxes().map((p) => p.b.min.y)).toFixed(4);
      X.hold = 1; window.__renderNow();
      // closed and opened again: how long the floor plan takes
      u.setExplode(false); window.__renderNow();
      // (a cambered tyre stands a few millimetres in the floor on the car itself)
      out.rest = +Math.min(...boxes().map((p) => p.b.min.y)).toFixed(4);
      Object.assign(out, { back: home(), shellBack: B.shell.visible, twinsOff: X.twins.every((t) => !t.visible), panelsOff: X.panels.every((h) => !h.visible), linesOff: !X.floor.visible, calls0, calls2: window.__info().calls });
      const t0 = performance.now();
      u.setExplode(true); window.__renderNow();
      out.ms = Math.round(performance.now() - t0);
      u.setExplode(false); window.__renderNow();
      u.goView('front', 0);
      return out;
    });
    if (shots) fs.writeFileSync(path.join(root, 'out', `store_${id}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
    console.log(id, JSON.stringify(r));
    console.log('  panels cover the skin:', check(Math.abs(r.panels - r.skin) < 1e-3 * r.skin && r.nPanels === 7, id + ' panel area'),
      '| lettering cut with them:', check(Math.abs(r.pieces - r.decals) < 1e-3 * Math.max(r.decals, 1e-6), id + ' decal area'),
      '| on the floor:', check(r.laid > 55 && r.bays === 7 && r.floor[0] > 0.005 && r.floor[1] < 0.03 && r.shellHidden, id + ' on the floor'),
      '| each in its bay:', check(r.astray.length === 0, id + ' astray: ' + r.astray),
      '| none overlap:', check(r.overlaps.length === 0, id + ' overlaps: ' + r.overlaps),
      '| one system alone:', check(r.one, id + ' single system'),
      '| above the floor on the way:', check(r.dip > Math.min(0, r.rest) - 1e-3, id + ' dips'),
      '| all back:', check(r.back && r.shellBack && r.twinsOff && r.panelsOff && r.linesOff && r.calls2 === r.calls0, id + ' back'));
  }
  await page.close();
  if (process.argv.includes('--stills')) { await browser.close(); server.close(); if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); } console.log('stills ok'); return; }

  /* ---------- clicks ---------- */
  page = await open('dev/live.html', 960, 540);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 300000 });
  const st = () => page.evaluate(() => {
    const u = window.__ui, b = document.querySelector('[data-toggle="explode"]');
    return {
      explode: u.state.explode, live: u.XPL.live, any: u.XPL.any, k: Object.values(u.XPL.mods).map((m) => +m.k.toFixed(2)).join(' '),
      pose: u.state.pose, prog: u.DRIVE.prog, engine: u.DRIVE.engine, v: +u.DRIVE.v.toFixed(1), aero: u.AERO.on, pressed: b.getAttribute('aria-pressed'), title: b.title,
      fitted: [...document.querySelectorAll('[data-mod][aria-pressed="true"]')].map((c) => c.dataset.mod).join(' '),
      buttons: !document.querySelector('.mods').hidden, programs: !document.querySelector('.poses').hidden,
    };
  });
  const allOut = () => page.waitForFunction(() => Object.values(window.__ui.XPL.mods).every((m) => m.k === 1), null, { timeout: 400000, polling: 250 });
  const allHome = () => page.waitForFunction(() => !window.__ui.XPL.any && !window.__ui.XPL.live, null, { timeout: 400000, polling: 250 });
  await page.click('[data-toggle="explode"]'); await allOut();
  let s = await st();
  console.log('button:', JSON.stringify(s), check(s.explode && s.live && s.pressed === 'true' && s.title === '组合' && s.buttons && !s.programs && s.fitted === '', 'button lays the car out'));
  // one system fitted, then taken off again
  await page.click('[data-mod="wheels"]');
  await page.waitForFunction(() => window.__ui.XPL.mods.wheels.k === 0, null, { timeout: 400000, polling: 250 });
  s = await st();
  const fitted = s.fitted === 'wheels' && s.any && s.k === '1 1 1 1 1 0 1';
  if (shots) await page.screenshot({ path: path.join(root, 'out', 'store_ui.png'), timeout: 120000 });
  await page.click('[data-mod="wheels"]'); await allOut();
  s = await st();
  console.log('one system:', JSON.stringify(s), check(fitted && s.fitted === '', 'a system is fitted and taken off on its own'));
  // everything back with one click; then a driving program
  await page.click('[data-toggle="explode"]'); await allHome();
  s = await st();
  console.log('together:', JSON.stringify(s), check(!s.explode && s.pressed === 'false' && s.title === '分解' && !s.buttons && s.programs, 'button puts it together'));
  await page.click('[data-pose="cruise"]');
  await page.waitForFunction(() => window.__ui.DRIVE.prog === 'cruise', null, { timeout: 400000, polling: 250 });
  // asked for while driving: the car parks, stops, and then its parts are laid out
  await page.click('[data-toggle="explode"]');
  s = await st();
  const parked = s.pose === 'park' && !s.live && !s.any;
  await allOut();
  s = await st();
  console.log('from driving:', JSON.stringify(s), check(parked && s.v === 0 && s.engine === 0, 'parks before it is taken apart'));
  // the airflow view wants a whole car, and laying the car out again switches the airflow off
  // (not waited for: the software renderer needs minutes for the wind tunnel's first frames)
  await page.click('[data-toggle="aero"]');
  s = await st();
  const whole = s.aero && !s.explode && s.pressed === 'false';
  await page.click('[data-toggle="explode"]'); await allOut();
  s = await st();
  console.log('airflow:', JSON.stringify(s), check(whole && !s.aero && s.explode, 'airflow and the parts store exclude each other'));
  // another model while the store is open: its parts are laid out in its turn
  await page.click('[data-model="e4"]');
  await page.waitForFunction(() => window.__ui.SPEC.id === 'e4' && !document.body.classList.contains('is-switching'), null, { timeout: 400000 });
  await allOut();
  s = await st();
  console.log('model change:', JSON.stringify(s), check(s.explode && s.live, 'new model is laid out'));
  await page.click('[data-toggle="explode"]'); await allHome();
  s = await st();
  console.log('together:', JSON.stringify(s), check(!s.explode && s.pressed === 'false', 'and put together'));
  const bad = errs.filter((e) => !e.includes('GPU stall') && !e.includes('GL Driver'));
  console.log(bad.join('\n') || 'no errors');
  if (bad.length) fails.push('console errors');
  await browser.close(); server.close();
  if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); }
  console.log('parts store ok');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
