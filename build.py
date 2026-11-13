"""Build the single-page app into public/ (the Cloudflare Pages output directory).

public/index.html                    page with all app code inlined
public/vendor/three@<ver>/...        only the three.js modules the page imports (from node_modules)
public/fonts/, public/img/           subset fonts (see tools/subset_fonts.py) and pictures (tools/og.js), committed
public/models/, guide/, tech/, en/   the reading pages, each with its Markdown twin; sitemap.xml, llms.txt (build_site.py)
dev/test.html, dev/live.html         same page with window.__TEST__ hooks / plain, for tools/*.js

Requires `npm install` (or `npm ci`) first so node_modules/three exists.
"""
import json, os, re, shutil
import build_site

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
PUB = os.path.join(ROOT, 'public')
THREE = os.path.join(ROOT, 'node_modules', 'three')

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

if not os.path.exists(os.path.join(THREE, 'package.json')):
    raise SystemExit('node_modules/three is missing: run `npm ci` first')
VER = json.loads(read(os.path.join(THREE, 'package.json')))['version']
VBASE = f'/vendor/three@{VER}/'

# ---- app script ----
js = re.sub(r'/\*@include ([\w.]+)\*/', lambda m: read(os.path.join(SRC, m.group(1))), read(os.path.join(SRC, 'car.js')))
assert '</script' not in js

# ---- vendor three.js: follow static imports from the page's entry points ----
IMPORT = re.compile(r'''(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]''')
def to_file(spec):
    if spec == 'three':
        return 'build/three.module.js'
    if spec.startswith('three/addons/'):
        return 'examples/jsm/' + spec[len('three/addons/'):]
    raise ValueError(spec)
todo = [to_file(m.group(1) or m.group(2)) for m in IMPORT.finditer(js)]
seen = set()
while todo:
    rel = todo.pop()
    if rel in seen:
        continue
    seen.add(rel)
    for m in IMPORT.finditer(read(os.path.join(THREE, rel))):
        spec = m.group(1) or m.group(2)
        if spec == 'three' or spec.startswith('three/'):
            todo.append(to_file(spec))
        elif spec.startswith('.'):
            todo.append(os.path.normpath(os.path.join(os.path.dirname(rel), spec)).replace(os.sep, '/'))
shutil.rmtree(os.path.join(PUB, 'vendor'), ignore_errors=True)
for rel in sorted(seen):
    dst = os.path.join(PUB, 'vendor', f'three@{VER}', rel)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.join(THREE, rel), dst)
shutil.copyfile(os.path.join(THREE, 'LICENSE'), os.path.join(PUB, 'vendor', f'three@{VER}', 'LICENSE'))
importmap = {"imports": {"three": VBASE + 'build/three.module.js', "three/addons/": VBASE + 'examples/jsm/'}}

# ---- fonts ----
fonts_css = read(os.path.join(SRC, 'fonts.css'))
preload = '\n'.join(
    f'<link rel="preload" href="{u}" as="font" type="font/woff2" crossorigin>'
    for u in re.findall(r'url\("([^"]+)"\)', fonts_css) if 'italic' not in u)
preload += f'\n<link rel="modulepreload" href="{VBASE}build/three.module.js">'

# ---- head, structured data and the text inside the canvas: the same source as the reading pages ----
VERSION = json.loads(read(os.path.join(ROOT, 'package.json')))['version']
app_head, app_text = build_site.app_parts(VERSION)

tpl = read(os.path.join(SRC, 'page.template.html'))
def page(test=False):
    body = (tpl.replace('__IMPORTMAP__', json.dumps(importmap))
               .replace('__FALLBACK__', app_text)
               .replace('__PRELOAD__', preload)
               .replace('__FONTS__', fonts_css)
               .replace('__SCRIPT__', js)
               .replace('__TESTFLAG__', '<script>window.__TEST__ = true;</script>' if test else ''))
    head, rest = body.split('<style>', 1)
    return (app_head + '\n' + head + '<style>' + rest.replace('</style>', '</style>\n</head>\n<body>', 1) + '\n</body>\n</html>\n')

write(os.path.join(PUB, 'index.html'), page())
write(os.path.join(ROOT, 'dev', 'test.html'), page(test=True))
write(os.path.join(ROOT, 'dev', 'live.html'), page())
pages = build_site.run(VERSION, fonts_css)
size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(os.path.join(PUB, 'vendor')) for f in fs)
print(f'built public/index.html ({os.path.getsize(os.path.join(PUB, "index.html")) // 1024} KB), '
      f'vendored {len(seen)} three.js modules ({size // 1024} KB), wrote {pages} pages with their Markdown twins')
for rel in sorted(seen):
    print('  ', rel)
