const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
(async () => {
  await new Promise(r => server.listen(8766, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) } });
  page.setDefaultTimeout(300000);
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
  await page.goto('http://localhost:8766/dev/test.html');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const shots = JSON.parse(process.argv[2]);
  for (const [name, code, pos, tgt] of shots) {
    const url = await page.evaluate(async ([c, p, t]) => { await (new Function('return (async () => {' + c + '})()'))(); if (p) window.__setView(p, t); return window.__grab(); }, [code, pos, tgt]);
    fs.writeFileSync(`out/st_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', name);
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
