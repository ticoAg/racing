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
| `build.py` | Inlines everything into `public/index.html` |
| `public/` | Static site deployed to Cloudflare Pages |
| `tools/` | Headless Playwright checks (renders, click-through, offline audio levels) |

## Build and run

```bash
python3 build.py          # writes public/index.html (+ dev/ pages for the tools)
npx serve public          # or any static server
```

## Deploy (Cloudflare Pages)

Connect the repository in Cloudflare Pages with:

- Framework preset: None
- Build command: `python3 build.py` (or leave empty — the built `public/index.html` is committed)
- Build output directory: `public`

Or from a terminal: `npx wrangler pages deploy public --project-name halcyon-h9`.

## Tools

```bash
npm install                                  # local three.js for dev/ pages
node tools/interact.js dev/live.html         # clicks every control, reports console errors
node tools/audio.js                          # renders the sound engine offline, prints levels
```

The tools need Playwright with Chromium installed.
