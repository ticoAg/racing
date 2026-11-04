// Floodlight glints on clearcoat can overflow half-float render targets; one Inf pixel used to turn into a black
// block after tone mapping and bloom. This pushes the lamp lights far past normal (WORLD.lightBoost) from views
// behind and beside the car at V-max and fails if the composited frame shows black blocks.
// usage: node tools/hdr_check.js
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
const VIEWS = [[[-9, 3.4, 0], [4, 0.3, 0]], [[-5.5, 1.55, 4.7], [0, 0.5, 0]], [[3.4, 6.2, 3.9], [0, 0.25, 0]]];
(async () => {
  await new Promise((r) => server.listen(8772, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:8772/dev/test.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  let worst = 0;
  for (const boost of [1, 400]) for (const [pos, tgt] of VIEWS) {
    const black = await page.evaluate(async ([b, p, t]) => {
      window.__ui.WORLD.lightBoost = b; window.__ui.setPose('cruise'); window.__setView(p, t);
      const img = new Image(); img.src = window.__grab(); await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] === 0) n++;
      return 100 * n / (c.width * c.height);
    }, [boost, pos, tgt]);
    worst = Math.max(worst, black);
    console.log(`boost ${String(boost).padStart(3)}  view ${pos.join(',').padEnd(14)} pure black ${black.toFixed(2)}%`);
  }
  await browser.close(); server.close();
  // a normal night frame has a few pure-black pixels at most; a NaN block covers a large share of the frame
  if (worst > 2) { console.log('FAIL: black blocks in the composited frame'); process.exit(1); }
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
