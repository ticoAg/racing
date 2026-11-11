// usage: [CAR=g8] [VIEWS=front34,side] node shot.js out_prefix [w h]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
  // repo root first (dev/ pages, node_modules), then public/ (vendor/, fonts/) — mirrors the deployed site
  const tryRead = (paths) => { const p = paths.shift(); fs.readFile(p, (e, d) => { if (e) { if (paths.length) return tryRead(paths); res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); };
  tryRead([path.join(root, url), path.join(root, 'public', url)]);
});
const VIEWS = {
  front34: [[5.6, 1.45, 4.9], [0, 0.5, 0]],
  rear34: [[-5.4, 1.6, 4.6], [0, 0.5, 0]],
  side: [[0, 0.75, 8.6], [0, 0.55, 0]],
  front: [[8.5, 0.8, 0], [0, 0.5, 0]],
  rear: [[-8.5, 0.9, 0], [0, 0.5, 0]],
  top: [[0.01, 9.5, 0.6], [0, 0, 0]],
  wheel: [[2.4, 0.6, 2.6], [1.4, 0.35, 0.86]],
  low34: [[4.2, 0.45, 3.4], [0, 0.45, 0]],
  hood: [[3.6, 2.2, 1.6], [0.8, 0.6, 0]],
  scoop: [[-2.2, 0.9, 2.6], [-0.6, 0.45, 0.9]],
  scoopf: [[0.6, 0.7, 2.4], [-0.6, 0.45, 0.9]],
  nose: [[3.9, 0.55, 1.7], [2.1, 0.3, 0.2]],
  tail: [[-3.9, 0.7, 1.6], [-2.1, 0.5, 0]],
};
(async () => {
  const prefix = process.argv[2] || 'shot';
  const w = +(process.argv[3] || 1280), h = +(process.argv[4] || 720);
  const which = (process.env.VIEWS || 'front34').split(',');
  await new Promise(r => server.listen(8765, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(300000);
  page.on('console', m => { const t = m.text(); if (!t.includes('GPU stall')) console.log('[console]', m.type(), t.slice(0, 400)); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto('http://localhost:8765/' + (process.env.PAGE || 'dev/test.html') + (process.env.CAR ? '?car=' + process.env.CAR : ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  console.log('ready in', Date.now() - t0, 'ms');
  await page.evaluate(() => window.__grab());
  console.log('info', JSON.stringify(await page.evaluate(() => window.__info())));
  for (const v of which) {
    const [pos, tgt] = VIEWS[v];
    const url = await page.evaluate(([p, t]) => { window.__setView(p, t); return window.__grab(); }, [pos, tgt]);
    fs.writeFileSync(`${prefix}_${v}.png`, Buffer.from(url.split(',')[1], 'base64'));
    if (process.env.UI) { await page.evaluate(() => document.body.classList.add('is-ready')); await page.waitForTimeout(1600); await page.screenshot({ path: `${prefix}_${v}_ui.png`, timeout: 120000 }); }
    console.log('saved', `${prefix}_${v}.png`);
  }
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
