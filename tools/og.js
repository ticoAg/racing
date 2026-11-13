// The site's pictures: one of each model (the page's hero and its social card, 1200 × 630) and one of the parts
// store, rendered from the test page and saved as JPEG in public/img/. Run again when a model's shape changes:
//   node tools/og.js [car id ...]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..'), out = path.join(root, 'public', 'img');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const tryRead = (paths) => { const p = paths.shift(); fs.readFile(p, (e, d) => { if (e) { if (paths.length) return tryRead(paths); res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); };
  tryRead([path.join(root, url), path.join(root, 'public', url)]);
});
const W = 1200, H = 630, SS = 2;                 // drawn at twice the size and scaled down: smooth edges
const CARS = ['h9', 'g8', 'e4', 'r10'].filter((id) => process.argv.length < 3 || process.argv.slice(2).includes(id));
// camera and target, as offsets from the middle of the car
const HERO = [[4.35, 1.02, 3.75], [0.1, 0.42, 0]], STORE = [[7.2, 10.4, 10.6], [0.9, 0, 1.5]];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(8766, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W * SS, height: H * SS } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // the frame scaled down, the name set over it as in the page's header, and the whole as JPEG
  const save = async (file, view, mark) => {
    const url = await page.evaluate(async ([view, mark, W, H]) => {
      const dx = window.__ui.controls.target.x - (window.__dx0 ?? (window.__dx0 = window.__ui.controls.target.x));
      window.__setView(view[0].map((v, i) => v + (i ? 0 : dx)), view[1].map((v, i) => v + (i ? 0 : dx)));
      const frame = new Image(); frame.src = window.__grab(); await frame.decode();
      await document.fonts.load('italic 800 22px Archivo'); await document.fonts.load('300 22px Archivo');
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high'; g.drawImage(frame, 0, 0, W, H);
      g.textBaseline = 'alphabetic'; g.fontStretch = 'extra-expanded';
      g.font = 'italic 800 22px Archivo'; g.letterSpacing = '5.3px'; g.fillStyle = '#ecebe6';
      g.fillText('HALCYON', 48, 70);
      let x = 48 + g.measureText('HALCYON').width + 14;
      if (mark) {
        g.fillStyle = 'rgba(236,235,230,0.28)'; g.fillRect(x, 50, 1, 26); x += 16;
        g.fontStretch = 'normal'; g.letterSpacing = '1.8px';
        g.font = '700 22px Archivo'; g.fillStyle = '#d0102c'; g.fillText(mark[0], x, 70); x += g.measureText(mark[0]).width;
        g.font = '300 22px Archivo'; g.fillStyle = '#ecebe6'; g.fillText(mark[1], x, 70);
      }
      return c.toDataURL('image/jpeg', 0.9);
    }, [view, mark, W, H]);
    fs.writeFileSync(path.join(out, file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved public/img/' + file, Math.round(fs.statSync(path.join(out, file)).size / 1024) + ' KB');
  };
  for (const id of CARS) {
    await page.goto('http://localhost:8766/dev/test.html?car=' + id);
    await page.waitForFunction(() => window.__ready === true);
    const mark = await page.evaluate(() => window.__ui.SPEC.mark);
    await save(id + '.jpg', HERO, mark);
    if (id === 'h9') {
      await page.evaluate(() => { const u = window.__ui; u.setExplode(true); window.__renderNow(); window.__renderNow(); });
      await save('parts.jpg', STORE, null);
    }
  }
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
