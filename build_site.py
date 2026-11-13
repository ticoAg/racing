"""The pages round the configurator, and what search engines and agents read (called from build.py).

site/<lang>/*.md        the pages' text; {{range}}, {{specs}} and {{options}} are filled from the app's own data
public/<path>/index.html  each page, and beside it index.md: the same text as Markdown
public/sitemap.xml, llms.txt, llms-full.txt, llms-full.zh.txt, 404.html
public/.well-known/agent-skills/   how an agent works the configurator

The Chinese pages live at the root (the app is Chinese), the English ones under /en/. The app itself is the
Chinese home page: its head, structured data and the text inside its <canvas> come from here too.
"""
import datetime, hashlib, html, json, os, re, shutil, subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'site')
PUB = os.path.join(ROOT, 'public')
SITE = 'https://racing.ticoag.fun'
REPO = 'https://github.com/ticoAg/racing'
IMG = (1200, 630)

# slug, path under the language's root
DOCS = [('home', ''), ('models', 'models/'), ('h9', 'models/h9/'), ('g8', 'models/g8/'), ('e4', 'models/e4/'),
        ('r10', 'models/r10/'), ('guide', 'guide/'), ('tech', 'tech/')]
LANGS = {
    'zh': dict(code='zh-CN', og='zh_CN', prefix='', other='en', switch='EN', launch='打开配置器', navlabel='栏目',
               nav=[('models', '车型'), ('guide', '指南'), ('tech', '技术')], crumb='首页', faq='常见问题',
               foot=[('Markdown', '{md}'), ('llms.txt', '/llms.txt'), ('GitHub', REPO)],
               range=['车型', '定位', '动力', '功率', '驱动', '质量', '极速', '0–100 km/h', '过弯'],
               drive={True: '四轮驱动', False: '后轮驱动'}, sec='秒', sep='：',
               spec=dict(kind='定位', engine='动力', power='最大功率', torque='峰值扭矩', redline='红线转速', motor='电机最高转速',
                         gearbox='变速箱', drive='驱动', mass='质量（含驾驶员）', split='前后配重', cg='重心高度', length='车长',
                         wheelbase='轴距', tyre='轮胎', vmax='极速', accel='0–100 km/h', grip='过弯极限', presets='风格预设'),
               from0='{nm} N·m，从静止起', opt=['参数', '可选值'],
               app='Halcyon 配置器', appdesc='在浏览器里运行的 3D 跑车配置器与驾驶模拟：四款程序化生成的原创车型，可定制、拆解、驾驶，并带实时风洞与合成引擎声。'),
    'en': dict(code='en', og='en_US', prefix='/en', other='zh', switch='中文', launch='Launch', navlabel='Sections',
               nav=[('models', 'Models'), ('guide', 'Guide'), ('tech', 'How it works')], crumb='Home', faq='FAQ',
               foot=[('Markdown', '{md}'), ('llms.txt', '/llms.txt'), ('GitHub', REPO)],
               range=['Model', 'Kind', 'Powertrain', 'Power', 'Drive', 'Mass', 'Top speed', '0–100 km/h', 'Cornering'],
               drive={True: 'All-wheel drive', False: 'Rear-wheel drive'}, sec='s', sep=': ',
               spec=dict(kind='Kind', engine='Powertrain', power='Peak power', torque='Peak torque', redline='Red line', motor='Motor speed limit',
                         gearbox='Gearbox', drive='Drive', mass='Mass with driver', split='Weight split, front / rear', cg='Centre of gravity height', length='Length',
                         wheelbase='Wheelbase', tyre='Tyres', vmax='Top speed', accel='0–100 km/h', grip='Cornering limit', presets='Style presets'),
               from0='{nm} N·m from a standstill', opt=['Parameter', 'Values'],
               app='Halcyon configurator', appdesc='A 3D car configurator and driving simulation in the browser: four original, procedurally generated cars to configure, take apart and drive, with a live wind tunnel and synthesised engine sound.'),
}
FEATURES = {
    'zh': ['四款程序化生成的原创车型：H9、G8、E4、R10', '10 种车色 × 7 种涂层、轮毂、空力套件、涂装与内饰配置', '整车拆解为九大系统的零件仓库',
           '夜间赛道上的巡航、过弯、制动驾驶程序', '4 公里见方开放地图上的自由驾驶，支持键盘、手柄与触屏', 'GPU 实时三维格子玻尔兹曼风洞', '按点火顺序实时合成的引擎声'],
    'en': ['Four original, procedurally generated cars: H9, G8, E4, R10', '10 colours × 7 finishes, wheels, aero kits, liveries and interiors', 'Parts store: the whole car taken apart into nine systems',
           'Cruise, corner and brake driving programs on a night circuit', 'Free driving over a 4 km square open map with keyboard, gamepad or touch', 'Live 3D lattice-Boltzmann wind tunnel on the GPU', 'Engine sound synthesised live from each firing order'],
}

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()

def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

def url(lang, slug):
    return LANGS[lang]['prefix'] + '/' + dict(DOCS)[slug]

def esc(s):
    return html.escape(s, quote=True)

# ---- when a source last changed (git), for dateModified and the sitemap ----
def git(*args):
    try:
        return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ''
HEAD_DATE = git('log', '-1', '--format=%cI') or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
def changed(*paths):
    return git('log', '-1', '--format=%cI', '--', *paths) or HEAD_DATE

# ---- a small Markdown: headings, paragraphs, lists, tables, images, links, bold, code ----
def parse(text):
    meta = {}
    if text.startswith('---\n'):
        front, text = text[4:].split('\n---\n', 1)
        for line in front.splitlines():
            k, v = line.split(':', 1)
            meta[k.strip()] = v.strip()
    return meta, text.strip() + '\n'

def inline(s):
    keep = []
    def stash(h):
        keep.append(h)
        return f'\x00{len(keep) - 1}\x00'
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', lambda m: stash(f'<code>{m.group(1)}</code>'), s)
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', lambda m: stash(f'<a href="{m.group(2)}">{m.group(1)}</a>'), s)
    # a bare address is a link too
    s = re.sub(r'https://[^\s<，。；）)]*[^\s<，。；）).,]', lambda m: stash(f'<a href="{m.group(0)}">{m.group(0)}</a>'), s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    return re.sub('\x00(\\d+)\x00', lambda m: keep[int(m.group(1))], s)

def cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]

def to_html(md, table_class=None):
    out, lines, i = [], md.splitlines(), 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif line.startswith('#'):
            n = len(line) - len(line.lstrip('#'))
            out.append(f'<h{n}>{inline(line[n:].strip())}</h{n}>')
            i += 1
        elif line.startswith('!['):
            alt, src = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', line).groups()
            out.append(f'<figure class="hero"><img src="{src}" width="{IMG[0]}" height="{IMG[1]}" alt="{esc(alt)}" loading="lazy"></figure>')
            i += 1
        elif line.startswith('<'):          # a block of HTML put in by the build
            out.append(line)
            i += 1
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(cells(lines[i]))
                i += 1
            head, body = rows[0], rows[2:]
            cls = (table_class or {}).get(head[0], '')
            thead = '' if not any(head) else '<thead><tr>' + ''.join(f'<th scope="col">{inline(c)}</th>' for c in head) + '</tr></thead>'
            tbody = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in body)
            out.append(f'<div class="table{" " + cls if cls else ""}"><table>{thead}<tbody>{tbody}</tbody></table></div>')
        elif line.startswith('- '):
            items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(f'<li>{inline(lines[i][2:])}</li>')
                i += 1
            out.append('<ul>' + ''.join(items) + '</ul>')
        else:
            para = []
            while i < len(lines) and lines[i].strip() and not re.match(r'[#|<]|- |!\[', lines[i]):
                para.append(lines[i].strip())
                i += 1
            out.append(f'<p>{inline(" ".join(para))}</p>')
    return '\n'.join(out)

def plain(md):
    s = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', md)
    return re.sub(r'[`*]', '', s).strip()

def absolute(md):
    """Links in a Markdown twin are whole addresses: it is read away from the site."""
    return re.sub(r'\]\((/[^)]*)\)', lambda m: f']({SITE}{m.group(1)})', md)

# ---- the app's own data in the pages ----
def spec_data():
    return json.loads(subprocess.run(['node', os.path.join(ROOT, 'tools', 'specs.js')], capture_output=True, text=True, check=True).stdout)

def num(n, lang):
    return f'{n:,}' if lang == 'en' and n >= 10000 else str(n)

def range_table(lang, models, metas):
    L = LANGS[lang]
    rows = ['| ' + ' | '.join(L['range']) + ' |', '|' + ' --- |' * len(L['range'])]
    for m in models:
        f = metas[m['id']]
        rows.append(f"| [{m['name']}]({url(lang, m['id'])}) | {f['kind']} | {f['engine']} | {f['power']} | {L['drive'][m['awd']]} | "
                    f"{num(m['mass'], lang)} kg | {m['vmax']} km/h | {f['accel']} | {f['grip']} |")
    return '\n'.join(rows)

def spec_table(lang, m, f):
    L, S = LANGS[lang], LANGS[lang]['spec']
    torque = L['from0'].format(nm=num(m['nm'], lang)) if m['electric'] else f"{num(m['nm'], lang)} N·m / {num(m['nmRpm'], lang)} rpm"
    rows = [(S['kind'], f['kind']), (S['engine'], f['engine']), (S['power'], f['power']), (S['torque'], torque),
            (S['motor' if m['electric'] else 'redline'], f"{num(m['redline'], lang)} rpm"), (S['gearbox'], f['gearbox']),
            (S['drive'], L['drive'][m['awd']]), (S['mass'], f"{num(m['mass'], lang)} kg"), (S['split'], f"{m['front']} / {100 - m['front']}"),
            (S['cg'], f"{m['cgHeight']} mm"), (S['length'], f"{num(m['length'], lang)} mm"), (S['wheelbase'], f"{num(m['wheelbase'], lang)} mm"),
            (S['tyre'], 'Trackform ' + m['tyre']), (S['vmax'], f"{m['vmax']} km/h"),
            (S['accel'], f['accel']), (S['grip'], f['grip'])]
    if lang == 'zh':
        rows.append((S['presets'], '、'.join(m['presets'])))
    return '\n'.join(['|  |  |', '| --- | --- |'] + [f'| {k} | {v} |' for k, v in rows])

def option_table(lang, options):
    L = LANGS[lang]
    rows = [f"| {L['opt'][0]} | {L['opt'][1]} |", '| --- | --- |', '| `car` | `h9` `g8` `e4` `r10` |']
    for key, opts in options.items():
        rows.append(f'| `{key}` | ' + ' '.join(f"`{o['id']}` {o['name']}" + ('' if o is opts[-1] else ' ·') for o in opts) + ' |')
    return '\n'.join(rows)

# ---- <head> ----
def head(lang, title, desc, path, image, alt, graph, twin=None, app=False, index=True):
    L = LANGS[lang]
    h = [f'<!doctype html>\n<html lang="{L["code"]}">\n<head>\n<meta charset="utf-8">',
         '<meta name="viewport" content="width=device-width, initial-scale=1' + (', viewport-fit=cover' if app else '') + '">',
         f'<title>{esc(title)}</title>',
         f'<meta name="description" content="{esc(desc)}">']
    if index:
        h += ['<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">',
              f'<link rel="canonical" href="{SITE}{path}">']
        if twin:
            for code, p in twin:
                h.append(f'<link rel="alternate" hreflang="{code}" href="{SITE}{p}">')
        h.append(f'<link rel="alternate" type="text/markdown" href="{path}index.md">')
    else:
        h.append('<meta name="robots" content="noindex">')
    h += ['<meta name="theme-color" content="#0c0d10">',
          '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
          '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
          '<link rel="manifest" href="/manifest.webmanifest">']
    if index:
        h += [f'<meta property="og:type" content="website">', f'<meta property="og:site_name" content="Halcyon">',
              f'<meta property="og:title" content="{esc(title)}">', f'<meta property="og:description" content="{esc(desc)}">',
              f'<meta property="og:url" content="{SITE}{path}">', f'<meta property="og:locale" content="{L["og"]}">',
              f'<meta property="og:locale:alternate" content="{LANGS[L["other"]]["og"]}">',
              f'<meta property="og:image" content="{SITE}{image}">', f'<meta property="og:image:width" content="{IMG[0]}">',
              f'<meta property="og:image:height" content="{IMG[1]}">', f'<meta property="og:image:alt" content="{esc(alt)}">',
              '<meta name="twitter:card" content="summary_large_image">']
        h.append('<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>')
    return '\n'.join(h)

# ---- structured data ----
ORG = {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Halcyon', 'url': SITE + '/', 'logo': SITE + '/icon-512.png', 'sameAs': [REPO]}
def website():
    return {'@type': 'WebSite', '@id': SITE + '/#website', 'url': SITE + '/', 'name': 'Halcyon', 'inLanguage': ['zh-CN', 'en'], 'publisher': {'@id': SITE + '/#org'}}

def webapp(lang, path, version):
    L = LANGS[lang]
    return {'@type': 'WebApplication', '@id': SITE + '/#app', 'name': L['app'], 'alternateName': 'Halcyon', 'url': SITE + '/', 'description': L['appdesc'],
            'applicationCategory': 'GameApplication', 'applicationSubCategory': 'Car configurator, driving simulation',
            'operatingSystem': 'Any', 'browserRequirements': 'Requires JavaScript and WebGL 2', 'softwareVersion': version, 'inLanguage': 'zh-CN',
            'isAccessibleForFree': True, 'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
            'featureList': FEATURES[lang], 'image': SITE + '/img/h9.jpg', 'screenshot': SITE + '/img/h9.jpg',
            'author': {'@id': SITE + '/#org'}, 'isPartOf': {'@id': SITE + '/#website'}}

def crumbs(lang, slug, title):
    L, trail = LANGS[lang], [(LANGS[lang]['crumb'], url(lang, 'home'))]
    nav = dict(L['nav'])
    if slug in ('h9', 'g8', 'e4', 'r10'):
        trail.append((nav['models'], url(lang, 'models')))
    if slug != 'home':
        trail.append((nav.get(slug, title), url(lang, slug)))
    return {'@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': SITE + p} for i, (n, p) in enumerate(trail)]}

def faq(md, heading):
    m = re.search(r'^## ' + re.escape(heading) + r'\n(.*?)(?=^## |\Z)', md, re.S | re.M)
    qa = re.findall(r'^### (.+?)\n+(.*?)(?=^### |\Z)', m.group(1), re.S | re.M) if m else []
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': plain(q), 'acceptedAnswer': {'@type': 'Answer', 'text': plain(' '.join(a.split()))}} for q, a in qa]}

def page_graph(lang, slug, meta, body, path, image, when, models, version):
    L = LANGS[lang]
    page = {'@type': 'WebPage', '@id': SITE + path + '#page', 'url': SITE + path, 'name': meta['title'], 'description': meta['description'],
            'inLanguage': L['code'], 'isPartOf': {'@id': SITE + '/#website'}, 'dateModified': when,
            'primaryImageOfPage': {'@type': 'ImageObject', 'url': SITE + image, 'width': IMG[0], 'height': IMG[1]}}
    graph = [website(), ORG, page, crumbs(lang, slug, meta['title'])]
    if slug == 'home':
        page['mainEntity'] = {'@id': SITE + '/#app'}
        graph.append(webapp(lang, path, version))
        graph.append({'@type': 'ItemList', 'name': dict(L['nav'])['models'], 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': 'Halcyon ' + m['name'], 'url': SITE + url(lang, m['id'])} for i, m in enumerate(models)]})
    elif slug == 'models':
        page['@type'] = 'CollectionPage'
        page['mainEntity'] = {'@type': 'ItemList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': 'Halcyon ' + m['name'], 'url': SITE + url(lang, m['id'])} for i, m in enumerate(models)]}
    elif slug == 'guide':
        graph.append(faq(body, L['faq']))
    elif slug == 'tech':
        graph.append({'@type': 'TechArticle', 'headline': meta['title'], 'description': meta['description'], 'inLanguage': L['code'], 'dateModified': when,
                      'image': SITE + image, 'author': {'@id': SITE + '/#org'}, 'publisher': {'@id': SITE + '/#org'}, 'mainEntityOfPage': {'@id': SITE + path + '#page'},
                      'about': {'@id': SITE + '/#app'}, 'proficiencyLevel': 'Expert'})
    else:
        page['about'] = {'@type': 'Thing', 'name': 'Halcyon ' + slug.upper(), 'description': meta['description'], 'image': SITE + image,
                         'subjectOf': {'@id': SITE + '/#app'}}
    return graph

# ---- the build ----
def load(models, options):
    """Every page of both languages: its front matter, and its text with the tables filled in."""
    docs = {}
    for lang in LANGS:
        raw = {slug: parse(read(os.path.join(SRC, lang, slug + '.md'))) for slug, _ in DOCS}
        metas = {m['id']: raw[m['id']][0] for m in models}
        for slug, (meta, body) in raw.items():
            if '{{range}}' in body:
                body = body.replace('{{range}}', range_table(lang, models, metas))
            if '{{specs}}' in body:
                body = body.replace('{{specs}}', spec_table(lang, next(m for m in models if m['id'] == slug), meta))
            if '{{options}}' in body:
                body = body.replace('{{options}}', option_table(lang, options))
            assert '{{' not in body, (lang, slug)
            docs[lang, slug] = (meta, body)
    return docs

def image_of(slug):
    return f'/img/{slug}.jpg' if slug in ('h9', 'g8', 'e4', 'r10') else '/img/h9.jpg'

def twins(slug):
    return [('zh-CN', url('zh', slug)), ('en', url('en', slug)), ('x-default', url('en', slug))]

def classes(lang):
    return {LANGS[lang]['range'][0]: 'range', '': 'spec'}

def app_parts(version):
    """For build.py: the head of the app's page, and the text that goes inside its <canvas>."""
    data = spec_data()
    docs = load(data['models'], data['options'])
    meta, body = docs['zh', 'home']
    when = changed('src', 'site/zh/home.md', 'build.py', 'build_site.py')
    graph = page_graph('zh', 'home', meta, body, '/', '/img/h9.jpg', when, data['models'], version)
    alt = '摄影棚中的 Halcyon H9 超跑'
    # (the links are for readers of the markup: they are kept out of the tab order, where nothing would show the focus)
    text = to_html(body, classes('zh')).replace('<a href=', '<a tabindex="-1" href=')
    return head('zh', meta['title'], meta['description'], '/', '/img/h9.jpg', alt, graph, twins('home'), app=True), text

def run(version, fonts_css):
    data = spec_data()
    models, options = data['models'], data['options']
    docs = load(models, options)
    tpl, css = read(os.path.join(SRC, 'page.html')), read(os.path.join(SRC, 'site.css'))
    fonts = '\n'.join(l for l in fonts_css.splitlines() if '"Archivo"' in l)       # the reading pages set Chinese in the system's own fonts
    preload = '\n'.join(f'<link rel="preload" href="{u}" as="font" type="font/woff2" crossorigin>' for u in re.findall(r'url\("([^"]+)"\)', fonts) if 'italic' not in u)
    for d in ('models', 'guide', 'tech', 'en', '.well-known'):
        shutil.rmtree(os.path.join(PUB, d), ignore_errors=True)

    def render(lang, slug, meta, body, path, index=True):
        L = LANGS[lang]
        image, when = image_of(slug), changed(f'site/{lang}/{slug}.md', 'src/blk_models.js')
        main = to_html(body, classes(lang))
        if meta.get('model') or slug == 'home':     # the picture goes under the opening paragraph
            fig = f'<figure class="hero"><img src="{image}" width="{IMG[0]}" height="{IMG[1]}" alt="{esc(meta.get("image_alt", "Halcyon H9"))}" fetchpriority="high"></figure>'
            main = main.replace('</p>', '</p>\n' + fig, 1)
        graph = page_graph(lang, slug, meta, body, path, image, when, models, version) if index else []
        nav = ''.join(f'<a href="{url(lang, s)}"' + (' aria-current="page"' if meta.get('nav') == s and s == slug else ' aria-current="true"' if meta.get('nav') == s else '') + f'>{t}</a>' for s, t in L['nav'])
        other = L['other']
        lang_link = f'<a class="lang" href="{url(other, slug) if index else url(other, "home")}" hreflang="{LANGS[other]["code"]}" lang="{LANGS[other]["code"]}">{L["switch"]}</a>'
        foot = ''.join(f'<a href="{href.format(md=path + "index.md")}">{t}</a>' for t, href in L['foot'] if index or t != 'Markdown')
        page = (tpl.replace('__HEAD__', head(lang, meta['title'], meta['description'], path, image, meta.get('image_alt', 'Halcyon H9'), graph, twins(slug) if index else None, index=index) + '\n' + preload)
                .replace('__FONTS__', fonts).replace('__CSS__', css).replace('__HOME__', url(lang, 'home')).replace('__NAVLABEL__', L['navlabel'])
                .replace('__NAV__', nav).replace('__LANG__', lang_link).replace('__LAUNCH__', L['launch'])
                .replace('__APP__', '/' + (f'?car={meta["model"]}' if meta.get('model') and meta['model'] != 'h9' else ''))
                .replace('__MAIN__', main).replace('__FOOT__', foot))
        return page

    listed = []
    for lang in LANGS:
        for slug, _ in DOCS:
            meta, body = docs[lang, slug]
            path = url(lang, slug)
            twin = f'---\ntitle: {meta["title"]}\ndescription: {meta["description"]}\nurl: {SITE}{path}\nlang: {LANGS[lang]["code"]}\n---\n\n' + absolute(body)
            write(os.path.join(PUB, path.strip('/'), 'index.md'), twin)
            if (lang, slug) != ('zh', 'home'):      # (the Chinese home page is the app: build.py writes it)
                write(os.path.join(PUB, path.strip('/'), 'index.html'), render(lang, slug, meta, body, path))
            when = changed('src', 'build.py', 'build_site.py') if (lang, slug) == ('zh', 'home') else changed(f'site/{lang}/{slug}.md', 'src/blk_models.js')
            listed.append((path, slug, when[:10]))

    # ---- sitemap ----
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for path, slug, day in listed:
        alts = ''.join(f'<xhtml:link rel="alternate" hreflang="{code}" href="{SITE}{p}"/>' for code, p in twins(slug))
        sm.append(f'<url><loc>{SITE}{path}</loc><lastmod>{day}</lastmod>{alts}</url>')
    write(os.path.join(PUB, 'sitemap.xml'), '\n'.join(sm + ['</urlset>']) + '\n')

    # ---- llms.txt: the map for language models, and everything in one file per language ----
    en, zh = docs['en', 'home'][0], docs['zh', 'home'][0]
    ll = ['# Halcyon', '', '> ' + en['description'], '',
          'Halcyon lives at ' + SITE + '/. The H9, G8, E4 and R10 are fictional cars made for this project; they are not products of any real manufacturer. '
          'The app\'s interface is Chinese. Every page has a Markdown twin: add `index.md` to its address, or ask for the page with `Accept: text/markdown`. '
          'A model and configuration can be opened by link, for example `' + SITE + '/?car=g8&paint=lava&finish=matte`; the guide lists every parameter.', '']
    for lang, title in (('en', 'Pages'), ('zh', '中文页面')):
        ll += ['## ' + title, '']
        for slug, _ in DOCS:
            meta = docs[lang, slug][0]
            ll.append(f'- [{meta["title"]}]({SITE}{url(lang, slug)}index.md): {meta["description"]}')
        ll.append('')
    ll += ['## Optional', '', f'- [llms-full.txt]({SITE}/llms-full.txt): every English page in one file', f'- [llms-full.zh.txt]({SITE}/llms-full.zh.txt): 全部中文页面合为一个文件',
           f'- [Agent skill]({SITE}/.well-known/agent-skills/halcyon-configurator/SKILL.md): how an agent opens a model, sets options and works the page',
           f'- [Source code]({REPO})', '']
    write(os.path.join(PUB, 'llms.txt'), '\n'.join(ll))
    for lang, name in (('en', 'llms-full.txt'), ('zh', 'llms-full.zh.txt')):
        parts = [f'# Halcyon\n\n> {docs[lang, "home"][0]["description"]}\n']
        for slug, _ in DOCS:
            meta, body = docs[lang, slug]
            # one level down, under the file's own title
            parts.append(f'<!-- {SITE}{url(lang, slug)} -->\n\n' + re.sub(r'^(#+) ', r'#\1 ', absolute(body), flags=re.M))
        write(os.path.join(PUB, name), '\n\n'.join(parts))

    # ---- the agent skill, and its index ----
    smeta, sbody = parse(read(os.path.join(SRC, 'skill.md')))
    skill = f'---\nname: {smeta["name"]}\ndescription: {smeta["description"]}\n---\n\n' + sbody.replace('{{options}}', option_table('en', options))
    rel = f'.well-known/agent-skills/{smeta["name"]}/SKILL.md'
    write(os.path.join(PUB, rel), skill)
    write(os.path.join(PUB, '.well-known/agent-skills/index.json'), json.dumps({
        '$schema': 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        'skills': [{'name': smeta['name'], 'type': 'skill-md', 'description': smeta['description'], 'url': f'{SITE}/{rel}',
                    'digest': 'sha256:' + hashlib.sha256(skill.encode('utf-8')).hexdigest()}]}, ensure_ascii=False, indent=2) + '\n')

    # ---- 404: any address that is not a page (without this file, Pages answers every address with the app) ----
    lost = ({'title': '404 — Halcyon', 'description': 'This page does not exist.'},
            '# 404\n\n这个页面不存在。This page does not exist.\n\n- [打开配置器 · Launch the configurator](/)\n- [车型](/models/) · [指南](/guide/) · [技术](/tech/)\n- [Models](/en/models/) · [Guide](/en/guide/) · [How it works](/en/tech/)\n')
    write(os.path.join(PUB, '404.html'), render('zh', '404', lost[0], lost[1], '/404', index=False))
    return len(listed)
