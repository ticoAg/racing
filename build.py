"""Build the single-page app.

public/index.html  – production page (three.js from jsDelivr), deployed by Cloudflare Pages
dev/test.html      – local three.js + window.__TEST__ hooks, used by tools/*.js
dev/live.html      – local three.js, normal runtime
"""
import json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')

def read(name):
    with open(os.path.join(SRC, name), encoding='utf-8') as f:
        return f.read()

js = re.sub(r'/\*@include ([\w.]+)\*/', lambda m: read(m.group(1)), read('car.js'))
assert '</script' not in js
tpl = read('page.template.html')

CDN = {"imports": {"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
                   "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}
LOCAL = {"imports": {"three": "/node_modules/three/build/three.module.js",
                     "three/addons/": "/node_modules/three/examples/jsm/"}}

def page(importmap, test=False):
    body = (tpl.replace('__IMPORTMAP__', json.dumps(importmap))
               .replace('__SCRIPT__', js)
               .replace('__TESTFLAG__', '<script>window.__TEST__ = true;</script>' if test else ''))
    head, rest = body.split('<style>', 1)
    return ('<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<meta name="description" content="Halcyon H9 — 原创程序化超跑配置器（three.js）">\n'
            '<meta name="theme-color" content="#0c0d10">\n'
            + head + '<style>' + rest.replace('</style>', '</style>\n</head>\n<body>', 1) + '\n</body>\n</html>\n')

def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)

write('public/index.html', page(CDN))
write('dev/test.html', page(LOCAL, test=True))
write('dev/live.html', page(LOCAL))
print('built public/index.html', os.path.getsize(os.path.join(ROOT, 'public/index.html')) // 1024, 'KB')
