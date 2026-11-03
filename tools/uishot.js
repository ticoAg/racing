const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
  // repo root first (dev/ pages, node_modules), then public/ (vendor/, fonts/) — mirrors the deployed site
  const tryRead = (paths) => { const p = paths.shift(); fs.readFile(p, (e, d) => { if (e) { if (paths.length) return tryRead(paths); res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); };
  tryRead([path.join(root, url), path.join(root, 'public', url)]);
});
(async () => {
  await new Promise(r => server.listen(8768, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, w, h, code, cam] of JSON.parse(process.argv[2])) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.setDefaultTimeout(400000);
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
    await page.goto('http://localhost:8768/dev/test.html');
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
    await page.evaluate(async ([c, cm]) => { await (new Function('return (async () => {' + c + '})()'))(); if (typeof cm === 'string') window.__ui.goView(cm, 0); else window.__setView(cm[0], cm[1]); window.__grab(); document.body.classList.add('is-ready'); }, [code, cam]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `out/ui_${name}.png`, timeout: 300000 });
    console.log('saved', name);
    await page.close();
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
