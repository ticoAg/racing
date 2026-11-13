// Checks what search engines and agents read of the built site (public/):
//   files: every page of the sitemap is there with its title, description, canonical address, language twins, one
//          heading, structured data that parses and a Markdown twin; every link inside the site leads somewhere;
//          robots.txt, llms.txt and the agent skill say what the build wrote
//   function: which Accept headers are answered with Markdown (functions/_middleware.js)
//   page: the app opens in the configuration its address names, keeps the model in its title, carries its text inside
//          the canvas, and offers its controls as tools (WebMCP) that do what the buttons do
// usage: node tools/site.js [--files]   (--files leaves the browser out)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..'), pub = path.join(root, 'public');
const SITE = 'https://racing.ticoag.fun';
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); return ok ? 'ok' : 'FAILED'; };
const read = (rel) => fs.readFileSync(path.join(pub, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(pub, rel)) && fs.statSync(path.join(pub, rel)).isFile();
// the file an address of the site is served from
const fileOf = (p) => { p = p.split('#')[0].split('?')[0]; return (p.endsWith('/') ? p + 'index.html' : p).replace(/^\//, ''); };
const attr = (tag, name) => (tag.match(new RegExp(name + '="([^"]*)"')) || [])[1];

function files() {
  const urls = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(urls.length === 16 && urls.every((u) => u.startsWith(SITE + '/')), 'sitemap lists the 16 pages');
  const pages = {};
  for (const u of urls) {
    const p = u.slice(SITE.length), h = read(fileOf(p)), head = h.slice(0, h.indexOf('</head>'));
    const links = [...head.matchAll(/<link [^>]+>/g)].map((m) => m[0]);
    const page = pages[p] = {
      title: (head.match(/<title>([^<]*)<\/title>/) || [])[1] || '', desc: attr((head.match(/<meta name="description"[^>]*>/) || [''])[0], 'content') || '',
      canonical: attr(links.find((l) => l.includes('rel="canonical"')) || '', 'href'),
      twins: Object.fromEntries(links.filter((l) => l.includes('hreflang=')).map((l) => [attr(l, 'hreflang'), attr(l, 'href')])),
      lang: attr(h.match(/<html[^>]*>/)[0], 'lang'), h1: (h.match(/<h1[ >]/g) || []).length, image: attr((head.match(/<meta property="og:image"[^>]*>/) || [''])[0], 'content'),
    };
    let ld = null; try { ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); } catch (e) { /* reported below */ }
    page.types = ld ? ld['@graph'].map((n) => n['@type']) : [];
    const faq = ld && ld['@graph'].find((n) => n['@type'] === 'FAQPage');
    const bad = [];
    if (!page.title.includes('Halcyon') || page.title.length > 70) bad.push('title');
    if (page.desc.length < 50 || page.desc.length > 320) bad.push('description');
    if (page.canonical !== u) bad.push('canonical');
    if (page.h1 !== 1) bad.push('h1 ×' + page.h1);
    if (!ld || !page.types.includes('WebPage') && !page.types.includes('CollectionPage') || !page.types.includes('BreadcrumbList')) bad.push('structured data');
    if (/\/guide\/$/.test(p) && !(faq && faq.mainEntity.length >= 8 && faq.mainEntity.every((q) => q.name && q.acceptedAnswer.text.length > 20))) bad.push('FAQ');
    if (!page.image || !exists(page.image.slice(SITE.length + 1))) bad.push('picture');
    if (!exists(fileOf(p).replace(/index\.html$/, 'index.md'))) bad.push('Markdown twin');
    else if (!read(fileOf(p).replace(/index\.html$/, 'index.md')).includes('url: ' + u + '\n')) bad.push('Markdown twin address');
    // links inside the site lead to files
    for (const m of h.matchAll(/(?:href|src)="(\/[^"]*)"/g)) if (!exists(fileOf(m[1]))) bad.push('dead link ' + m[1]);
    console.log(p.padEnd(18), page.lang.padEnd(6), page.types.join(' ').padEnd(64), check(!bad.length, p + ': ' + bad.join(', ')), bad.join(', '));
  }
  // each language names the other, both ways
  for (const [p, page] of Object.entries(pages)) {
    const t = page.twins, other = Object.values(t).find((x) => x !== SITE + p);
    check(t['zh-CN'] && t.en && t['x-default'] && (t['zh-CN'] === SITE + p || t.en === SITE + p) && other && pages[other.slice(SITE.length)] && Object.values(pages[other.slice(SITE.length)].twins).includes(SITE + p), 'language twins of ' + p);
  }
  const app = read('index.html'), text = app.slice(app.indexOf('<canvas id="scene"'), app.indexOf('</canvas>'));
  console.log('app page:', Math.round(app.length / 1024) + ' KB,', text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length, 'characters of text inside the canvas, ahead of the script', check(text.includes('<h1>') && text.includes('href="/models/h9/"') && app.indexOf('</canvas>') < app.indexOf('<script type="module">'), 'the app page carries its text'));
  const robots = read('robots.txt');
  console.log('robots.txt:', check(/^Sitemap: https:\/\/racing\.ticoag\.fun\/sitemap\.xml$/m.test(robots) && /^Content-Signal: /m.test(robots) && !/^Disallow: \/$/m.test(robots), 'robots.txt names the sitemap and shuts nobody out'));
  const llms = read('llms.txt'), dead = [...llms.matchAll(/\]\(https:\/\/racing\.ticoag\.fun(\/[^)]*)\)/g)].map((m) => m[1]).filter((p) => !exists(fileOf(p)));
  console.log('llms.txt:', llms.split('\n').filter((l) => l.startsWith('- [')).length, 'links', check(llms.startsWith('# Halcyon\n\n> ') && !dead.length, 'llms.txt: ' + dead.join(' ')));
  const index = JSON.parse(read('.well-known/agent-skills/index.json')), sk = index.skills[0], body = read(sk.url.slice(SITE.length + 1));
  console.log('agent skill:', sk.name, check(sk.digest === 'sha256:' + crypto.createHash('sha256').update(body).digest('hex') && body.startsWith('---\nname: ' + sk.name + '\n'), 'agent skill index matches the skill'));
  const lost = read('404.html');
  console.log('404 page:', check(lost.includes('content="noindex"') && !lost.includes('rel="canonical"'), '404 page stays out of the indexes'));
  const headers = read('_headers'), routes = JSON.parse(read('_routes.json'));
  console.log('headers, routes:', check(headers.includes('https://racing-ddu.pages.dev/*\n  X-Robots-Tag: noindex') && routes.include.includes('/') && Object.keys(pages).every((p) => p === '/' || routes.include.some((r) => r.endsWith('/*') && p.startsWith(r.slice(0, -1)))), 'pages.dev stays out of the indexes; every page is on the function\'s routes'));
}

async function negotiation() {
  const src = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
  const { wantsMarkdown, tokens, onRequest } = await import('data:text/javascript,' + encodeURIComponent(src));
  const cases = [['text/markdown', true], ['text/markdown, text/html;q=0.9', true], ['text/html, text/markdown', false], ['text/markdown;q=0.5, text/html', false],
    ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', false], ['*/*', false], ['', false], [null, false], ['text/markdown;q=0', false], ['TEXT/Markdown ; q=1', true]];
  const wrong = cases.filter(([a, want]) => wantsMarkdown(a) !== want).map(([a]) => a);
  const env = { ASSETS: { fetch: async (req) => { const f = fileOf(new URL(req.url).pathname); return exists(f) ? new Response(read(f)) : new Response('', { status: 404 }); } } };
  const next = async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
  const ask = (p, accept) => onRequest({ request: new Request('https://x.test' + p, { headers: accept ? { Accept: accept } : {} }), next, env });
  const md = await ask('/models/h9/', 'text/markdown'), page = await ask('/models/h9/', 'text/html'), none = await ask('/nowhere/', 'text/markdown'), text = await md.text();
  const ok = !wrong.length && md.headers.get('Content-Type').startsWith('text/markdown') && text.includes('# Halcyon H9') && +md.headers.get('X-Markdown-Tokens') === tokens(text) && md.headers.get('Vary') === 'Accept'
    && md.headers.get('Link') === `<${SITE}/models/h9/>; rel="canonical"` && page.headers.get('Content-Type') === 'text/html' && page.headers.get('Vary') === 'Accept' && none.headers.get('Content-Type') === 'text/html';
  console.log('function:', cases.length, 'Accept headers,', md.headers.get('X-Markdown-Tokens'), 'tokens for /models/h9/', check(ok, 'Markdown by Accept header ' + wrong.join(' | ')));
}

async function browser() {
  const { chromium } = require('playwright');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => { const p = path.join(pub, fileOf(decodeURIComponent(req.url))); fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });
  await new Promise((r) => server.listen(8772, r));
  const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await br.newPage({ viewport: { width: 1280, height: 760 } });
  page.setDefaultTimeout(400000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!/^(http:\/\/localhost:8772\/|data:|blob:)/.test(r.url())) external.push(r.url()); });
  // a browser with WebMCP: the tools the page registers are kept where the test can call them
  await page.addInitScript(() => { window.__tools = {}; Object.defineProperty(document, 'modelContext', { value: { registerTool: async (t) => { window.__tools[t.name] = t; } } }); });
  await page.goto('http://localhost:8772/?car=g8&paint=lava&finish=matte&wheel=mesh&wing=none&cabin=nonsense');
  await page.waitForFunction(() => document.body.classList.contains('is-ready'));
  const call = (name, args) => page.evaluate(async ([name, args]) => JSON.parse((await window.__tools[name].execute(args)).content[0].text), [name, args]);
  const opened = await call('get_configuration', {});
  console.log('link:', JSON.stringify({ model: opened.model, ...opened.options }), check(opened.model === 'g8' && opened.options.paint === 'lava' && opened.options.finish === 'matte' && opened.options.wheel === 'mesh' && opened.options.wing === 'none' && opened.options.cabin === 'tan', 'the page opens in the configuration its address names'));
  const title = await page.title(), names = await page.evaluate(() => Object.keys(window.__tools));
  console.log('title:', title, check(/^Halcyon G8 — /.test(title), 'the model is in the title'));
  console.log('tools:', names.join(' '), check(names.length === 6 && opened.choices.options.paint.length === 10 && opened.choices.model.length === 4, 'the page registers its tools'));
  const set = await call('set_options', { paint: 'glacier', kit: 'track' }), pressed = await page.evaluate(() => document.querySelector('[data-opt="paint"][data-val="glacier"]').getAttribute('aria-checked'));
  console.log('set_options:', JSON.stringify(set.options), check(set.options.paint === 'glacier' && set.options.kit === 'track' && set.options.finish === 'matte' && pressed === 'true', 'set_options changes what it names and the panel follows'));
  const refused = await page.evaluate(() => window.__tools.set_options.execute({ paint: 'plaid' }).then(() => '', (e) => e.message));
  console.log('unknown value:', refused, check(refused.includes('plaid'), 'an unknown value is refused'));
  const feat = await call('set_feature', { feature: 'doors', on: true }), view = await call('set_view', { view: 'side' });
  console.log('set_feature, set_view:', JSON.stringify(feat.features), view.view, check(feat.features.doors === true && view.view === 'side' && view.features.turntable === false, 'set_feature and set_view'));
  const prog = await call('run_program', { program: 'cruise' });
  await page.waitForFunction(() => window.__tools && document.querySelector('[data-pose="cruise"]').getAttribute('aria-checked') === 'true');
  const parked = await call('run_program', { program: 'park' });
  console.log('run_program:', prog.program, '→', parked.program, check(prog.program === 'cruise' && parked.program === 'park', 'run_program'));
  // (another model comes up in its own first preset, not in what was set on the last one)
  const model = await call('select_model', { model: 'h9' }), t2 = await page.title();
  console.log('select_model:', model.model, model.options.paint, '·', t2, check(model.model === 'h9' && /^Halcyon H9 — /.test(t2) && model.options.paint === 'abyss', 'select_model builds the other model'));
  console.log('errors:', JSON.stringify(errors), 'off-site requests:', JSON.stringify(external), check(!errors.length && !external.length, 'no errors, nothing fetched off-site'));
  await br.close(); server.close();
}

(async () => {
  files();
  await negotiation();
  if (!process.argv.includes('--files')) await browser();
  if (fails.length) { console.error('FAILED: ' + fails.join('; ')); process.exit(1); }
  console.log('site ok');
})().catch((e) => { console.error(e); process.exit(1); });
