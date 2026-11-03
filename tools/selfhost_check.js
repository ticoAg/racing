// Loads the built page and fails if anything is fetched from outside this site.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', 'public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
(async () => {
  await new Promise((r) => server.listen(8771, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.setDefaultTimeout(400000);
  const external = [], failed = [], errors = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://localhost:8771/') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto('http://localhost:8771/');
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 400000 });
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => `${f.family} ${f.style} ${f.status}`); });
  await page.screenshot({ path: path.join(__dirname, '..', 'out', 'selfhost.png'), timeout: 120000 }).catch(() => {});
  console.log(JSON.stringify({ external, failed, errors, fonts }, null, 1));
  await browser.close(); server.close();
  process.exit(external.length || failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
