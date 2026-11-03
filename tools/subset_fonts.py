"""Regenerate the self-hosted fonts in public/fonts and src/fonts.css.

Archivo (Latin, variable wdth + wght, upright and italic) is subset to Latin and
common punctuation. Noto Sans SC is subset to exactly the CJK characters that
appear in src/, so the Chinese font stays small. Run again whenever the UI text
gains new Chinese characters:

    python3 tools/subset_fonts.py            # downloads sources into .fontcache/
Needs: pip install fonttools brotli
"""
import hashlib, os, re, urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.fontcache')
OUT = os.path.join(ROOT, 'public', 'fonts')
GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
SOURCES = {
    'archivo': 'archivo/Archivo%5Bwdth%2Cwght%5D.ttf',
    'archivo-italic': 'archivo/Archivo-Italic%5Bwdth%2Cwght%5D.ttf',
    'noto-sans-sc': 'notosanssc/NotoSansSC%5Bwght%5D.ttf',
}
LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215'

def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + '.ttf')
    if not os.path.exists(path):
        print('downloading', SOURCES[name])
        urllib.request.urlretrieve(GF + SOURCES[name], path)
    return path

def used_cjk():
    chars = set()
    for dirpath, _, files in os.walk(os.path.join(ROOT, 'src')):
        for f in files:
            with open(os.path.join(dirpath, f), encoding='utf-8') as fh:
                chars |= {c for c in fh.read() if ord(c) > 0x2E7F}
    return ''.join(sorted(chars))

def make(name, unicodes=None, text=None, wght=None):
    font = TTFont(fetch(name))
    if wght:
        font = instancer.instantiateVariableFont(font, {'wght': wght})
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    if text:
        sub.populate(text=text)
    else:
        sub.populate(unicodes=subset.parse_unicodes(unicodes))
    sub.subset(font)
    tmp = os.path.join(CACHE, name + '.woff2')
    font.flavor = 'woff2'
    font.recalcTimestamp = False
    font['head'].created = font['head'].modified = 3786825600   # fixed 2024-01-01, reproducible hash
    font.save(tmp)
    data = open(tmp, 'rb').read()
    fname = f'{name}.{hashlib.sha1(data).hexdigest()[:10]}.woff2'
    with open(os.path.join(OUT, fname), 'wb') as fh:
        fh.write(data)
    print(f'{fname}: {len(data) // 1024} KB')
    return fname

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.woff2'):
        os.remove(os.path.join(OUT, f))
cjk = used_cjk()
print(len(cjk), 'CJK characters')
a = make('archivo', unicodes=LATIN)
ai = make('archivo-italic', unicodes=LATIN)
sc = make('noto-sans-sc', text=cjk + '，。：；！？、（）·—…')
css = f"""@font-face {{ font-family: "Archivo"; font-style: normal; font-weight: 100 900; font-stretch: 62% 125%; font-display: swap; src: url("/fonts/{a}") format("woff2"); }}
@font-face {{ font-family: "Archivo"; font-style: italic; font-weight: 100 900; font-stretch: 62% 125%; font-display: swap; src: url("/fonts/{ai}") format("woff2"); }}
@font-face {{ font-family: "Noto Sans SC"; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/fonts/{sc}") format("woff2"); }}
"""
with open(os.path.join(ROOT, 'src', 'fonts.css'), 'w', encoding='utf-8') as fh:
    fh.write(css)
print('wrote src/fonts.css')
