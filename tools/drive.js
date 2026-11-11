// Drives every model through the three programs without rendering and prints what the vehicle model does:
// acceleration, top speed, peak g, and the body attitude each car takes (squat, dive, roll, ride height).
// usage: node tools/drive.js [car id ...]
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
(async () => {
  await new Promise((r) => server.listen(8775, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
  page.setDefaultTimeout(600000);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8775/dev/test.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  const rows = await page.evaluate(async (only) => {
    const ui = window.__ui, out = [];
    for (const m of ui.MODELS) {
      if (only.length && !only.includes(m.id)) continue;
      await ui.setModel(m.id);
      // rows: t, km/h, gear, rpm, longitudinal g, lateral g, pitch (deg), roll (deg), heave (mm)
      const a = window.__driveTest(60, [[0, 'cruise']], 0.05), b = window.__driveTest(45, [[0, 'brake']], 0.05), c = window.__driveTest(40, [[0, 'corner']], 0.05);
      const t0 = a.find((r) => r[1] > 0.5)[0], vmax = Math.max(...a.map((r) => r[1]));
      const at = (kmh) => { const r = a.find((r) => r[1] >= kmh); return r ? (r[0] - t0).toFixed(1) : '–'; };
      const min = (rows, i) => Math.min(...rows.map((r) => r[i])), max = (rows, i) => Math.max(...rows.map((r) => r[i]));
      out.push({
        car: m.name, '0-100 s': at(100), '0-200 s': at(200), '0-300 s': at(300), 'V-max': vmax, 'to V-max s': at(vmax - 1), gears: max(a, 2), 'rpm max': max(a, 3),
        'brake g': min(b, 4), 'corner g': max(c, 5), 'corner km/h': Math.min(...c.filter((r) => Math.abs(r[5]) > 1).map((r) => r[1])),
        'squat °': max(a, 6), 'dive °': min(b, 6), 'roll °': max(c, 7), 'heave mm': min(a, 8),
      });
    }
    return out;
  }, process.argv.slice(2));
  console.table(rows);
  await browser.close(); server.close();
  if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
