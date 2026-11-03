# Halcyon H9

An original, fully procedural hypercar built with three.js — no model files, everything is generated in code.

- Configurator: 6 presets, 10 colours × 7 finishes (metallic, pearl, gloss, matte, chrome, chameleon, carbon), 4 wheel designs, rim and caliper colours, GT wing / active spoiler / no wing, track and road aero kits, 5 liveries, 4 interiors
- Butterfly doors, deployable wing and airbrake
- Detailed cockpit with a first-person driver view
- Driving programs: cruise, chicane cornering (~1.5 g), braking zone (230 → 80 km/h at ~1.8 g) with suspension dynamics, glowing discs and splitter sparks
- Airflow view: potential-flow streamlines per longitudinal slice, wake turbulence, tip vortices, surface pressure map, downforce/drag readout
- Synthesised V12, gearbox, tyre, wind and brake sounds plus showroom music (Web Audio)

## Layout

| Path | What |
| --- | --- |
| `src/car.js` | Main module; `/*@include file*/` markers pull in the blocks below |
| `src/blk_cockpit.js` | Interior |
| `src/blk_drive.js` | Driving programs, gearbox, suspension, sparks, HUD |
| `src/blk_aero.js` | Flow solver, streamlines, pressure map, loads |
| `src/blk_audio.js` | Sound engine and music |
| `src/page.template.html` | Markup and styles |
| `src/fonts.css` | `@font-face` rules for the self-hosted fonts (generated) |
| `build.py` | Inlines the app into `public/index.html` and copies the three.js modules it imports into `public/vendor/` |
| `public/` | Static site root. `fonts/` is committed; `index.html` and `vendor/` are generated |
| `tools/` | Headless Playwright checks (renders, click-through, offline audio levels) |

## Build and run

```bash
npm ci                    # three.js into node_modules
python3 build.py          # writes public/index.html and public/vendor/ (+ dev/ pages for the tools)
npx serve public          # or any static server
```

Everything is served from the site itself — no third-party CDNs or font services — so it works the same in every region.

### Fonts

Archivo (Latin) and Noto Sans SC are self-hosted as woff2 in `public/fonts/`. Noto Sans SC is subset to the Chinese characters that appear in `src/`, which keeps it around 50 KB. After adding UI text with new Chinese characters, regenerate:

```bash
pip install fonttools brotli
python3 tools/subset_fonts.py
```

Fonts and vendored modules have versioned or content-hashed URLs and are served with a one-year immutable cache (`public/_headers`).

## Deploy (Cloudflare Pages)

The Cloudflare Pages project `racing` is connected to this repository and builds on every push:

- Build command: `npm ci && python3 build.py`
- Build output directory: `public`

Pushes to `main` go to production; other branches get preview URLs.

## Tools

```bash
npm install                                  # local three.js for dev/ pages
node tools/interact.js dev/live.html         # clicks every control, reports console errors
node tools/audio.js                          # renders the sound engine offline, prints levels
node tools/selfhost_check.js                 # fails if the built page fetches anything off-site
```

The tools need Playwright with Chromium installed.
