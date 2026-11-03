const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
  // repo root first (dev/ pages, node_modules), then public/ (vendor/, fonts/) — mirrors the deployed site
  const tryRead = (paths) => { const p = paths.shift(); fs.readFile(p, (e, d) => { if (e) { if (paths.length) return tryRead(paths); res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); };
  tryRead([path.join(root, url), path.join(root, 'public', url)]);
});
const W = +(process.argv[3] || 1280), H = +(process.argv[4] || 760);
(async () => {
  await new Promise(r => server.listen(8767, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('requestfailed', r => errs.push('requestfailed: ' + r.url()));
  const t0 = Date.now();
  await page.goto('http://localhost:8767/' + process.argv[2]);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 240000 });
  console.log('ready after', Date.now() - t0, 'ms', 'panel open:', await page.evaluate(() => document.body.classList.contains('panel-open')));
  const clicks = [
    '[data-tab="paint"]', '[data-opt="paint"][data-val="lava"]', '[data-opt="finish"][data-val="chameleon"]',
    '[data-tab="wheels"]', '[data-opt="wheel"][data-val="turbine"]', '[data-opt="rim"][data-val="bronze"]', '[data-opt="caliper"][data-val="yellow"]',
    '[data-tab="kit"]', '[data-opt="wing"][data-val="active"]', '[data-opt="kit"][data-val="road"]',
    '[data-tab="livery"]', '[data-opt="livery"][data-val="hoop"]',
    '[data-tab="cabin"]', '[data-opt="cabin"][data-val="tan"]',
    '[data-toggle="doors"]', '[data-toggle="wing"]', '[data-toggle="lights"]',
    '[data-toggle="sound"]', '[data-pose="cruise"]', '[data-pose="corner"]', '[data-toggle="aero"]', '[data-pose="brake"]',
    '[data-view="rear"]', '[data-view="wheel"]', '[data-view="cabin"]', '[data-view="driver"]',
  ];
  for (const c of clicks) { await page.click(c, { timeout: 60000 }); await page.waitForTimeout(250); }
  await page.waitForTimeout(6000);
  const extra = await page.evaluate(() => ({ aeroKey: window.__ui.AERO.key, aeroOn: window.__ui.AERO.on, drive: { prog: window.__ui.DRIVE.prog, v: +(window.__ui.DRIVE.v * 3.6).toFixed(1), gear: window.__ui.DRIVE.gear, rpm: Math.round(window.__ui.DRIVE.rpm), engine: window.__ui.DRIVE.engine }, hud: document.body.classList.contains('hud-on'), hudSpeed: document.getElementById('hudSpeed').textContent, hudDown: document.getElementById('hudDown').textContent, fov: +window.__cam().toFixed(1) }));
  console.log('extra:', JSON.stringify(extra));
  const mid = await page.evaluate(() => { const s = window.__ui.state; return { paint: s.paint, finish: s.finish, wheel: s.wheel, rim: s.rim, caliper: s.caliper, wing: s.wing, kit: s.kit, livery: s.livery, cabin: s.cabin, doors: s.doors, wingUp: s.wingUp, lights: s.lights, pose: s.pose, view: s.view, tab: s.tab }; });
  console.log('after options:', JSON.stringify(mid));
  for (const c of ['[data-tab="style"]', '[data-preset="4"]', '[data-pose="park"]', '[data-toggle="turntable"]', '[data-toggle="panel"]']) { await page.click(c, { timeout: 60000 }); await page.waitForTimeout(300); }
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const s = window.__ui.state;
    return {
      state: { preset: s.preset, paint: s.paint, finish: s.finish, livery: s.livery, wing: s.wing, pose: s.pose, turntable: s.turntable, panel: s.panel, doors: s.doors },
      pressed: [...document.querySelectorAll('[data-toggle]')].map(b => b.dataset.toggle + '=' + b.getAttribute('aria-pressed')).join(' '),
      checkedPreset: document.querySelector('[data-preset][aria-checked="true"]')?.dataset.preset,
      checkedPose: document.querySelector('[data-pose][aria-checked="true"]')?.dataset.pose,
      shownPanes: [...document.querySelectorAll('[data-pane]')].filter(p => !p.hidden).map(p => p.dataset.pane).join(','),
    };
  });
  console.log('final:', JSON.stringify(st));
  console.log(errs.filter(e => !e.includes('UniformsUtils') && !e.includes('GPU stall') && !e.includes('GL Driver')).join('\n') || 'no errors');
  await page.click('[data-toggle="turntable"]'); await page.waitForTimeout(3000);
  try { await page.screenshot({ path: 'out/interact_' + path.basename(process.argv[2], '.html') + '.png', timeout: 120000 }); console.log('screenshot saved'); } catch (e) { console.log('screenshot skipped'); }
  await browser.close(); server.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
