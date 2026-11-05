# Halcyon H9

Live: https://racing.ticoag.fun

An original, fully procedural hypercar built with three.js — no model files, everything is generated in code.

- Configurator: 6 presets, 10 colours × 7 finishes (metallic, pearl, gloss, matte, chrome, chameleon, carbon), 4 wheel designs, rim and caliper colours, GT wing / active spoiler / no wing, track and road aero kits, 5 liveries, 4 interiors
- Butterfly doors, deployable wing and airbrake
- Detailed cockpit with a first-person driver view that rides the body and leans with the g-forces
- Vehicle model: V12 torque curve (1045 Nm, ~890 kW), 7-speed dual-clutch box, semi-slick tyres with load sensitivity, drag and downforce per axle, ABS brakes with a torque cap, traction and launch control, active low-drag wing trim at V-max, suspension springs with aero compression
- Driving programs on a procedurally generated night circuit:
  - Cruise: launch and V-max run to ~400 km/h (about 30 s with the GT wing, 22 s with the road kit), then holds 400
  - Corner: fast esses at ~1.85 g with kerb strikes at the apexes
  - Brake: flat out to ~300 km/h, maximum braking (up to ~2.5 g with the airbrake) into an 82 km/h hairpin past the 300/200/100 boards
- Night circuit: road with kerbs, patches, rubbered line and skid marks; barriers with catch fences and advertising; floodlight masts whose light pools sweep under the car and whose nearest lamps light the bodywork; gantries; horizon and night sky. The studio dissolves into it from under the car when a program starts and comes back after the car stops. Everything that passes is smeared over a 1/90 s exposure
- Speed effects: afterfire flames on the same events the sound plays, launch tyre smoke, condensation in the wing-tip vortices, specks streaking through the floodlit air, splitter sparks under braking and bottoming, glowing discs
- Airflow view: a live 3D lattice-Boltzmann wind tunnel on the GPU. D3Q19 with 5 cm cells around half the car, the centre plane a mirror (about 560k cells; 7 cm cells on touch screens); regularised collisions with a Smagorinsky eddy viscosity (LES) and a separate bulk viscosity that soaks up sound; a rolling road, tyres turning with the road, a wall model for the millimetre-thin turbulent boundary layer (the walls slide with the air and hold back its skin friction, while cells off convex edges hold the air so the flow leaves sharp edges), and the wing/spoiler/airbrake voxelised as they move. The air goes over, under and around the car, separates off the tail and sheds a turbulent wake on its own; the wing's tip vortices come out of the solution. Smoke rakes and wing-tip wands release tracers carried by the solved velocity (streaklines, coloured by local speed). The surface pressure map is the time-averaged pressure the solver finds next to the skin, as Cp. `tools/flow_check.js` measures the drag of a square plate with the same solver settings (Cd 0.95 against 1.17 measured at 10 cells across) and checks the car's flow. Falls back to 2D potential-flow streamlines where float render targets or six draw buffers are missing
- Sound (Web Audio): a V12 synthesised from the crank angle in an AudioWorklet (firing order, two banks, load, ignition cuts for shifts, limiter and launch control, afterfire), exhaust and intake placed on the car and heard from the camera, a muffled cockpit perspective, wind that climbs steeply with speed, tyre scrub, kerb rumble, patch thumps, barrier echoes and masts whooshing past; showroom music in the studio

## Layout

| Path | What |
| --- | --- |
| `src/car.js` | Main module; `/*@include file*/` markers pull in the blocks below |
| `src/blk_cockpit.js` | Interior |
| `src/blk_track.js` | Procedural circuit: curvature segments per program, racing line, kerbs, boards, centreline in the car frame |
| `src/blk_world.js` | Road/floor shader, barriers, floodlights, gantries, sky, environment-map blend, studio↔circuit reveal |
| `src/blk_drive.js` | Vehicle model, speed planner, gearbox, suspension, sparks, HUD |
| `src/blk_fx.js` | Afterfire, tyre smoke, vortex vapour, specks, cockpit camera rig |
| `src/blk_aero.js` | Pressure map, force arrows, loads; potential-flow fallback |
| `src/blk_flow.js` | 3D lattice-Boltzmann tunnel: solver, voxelised car, smoke streaklines, physics checks |
| `src/blk_audio.js` | Sound engine (AudioWorklet V12) and music |
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

Pushes to `main` go to production at https://racing.ticoag.fun (also https://racing-ddu.pages.dev); other branches get preview URLs.

## Tools

```bash
npm install                                  # local three.js for dev/ pages
node tools/interact.js dev/live.html         # clicks every control, reports console errors
node tools/audio.js                          # renders the sound engine offline, prints levels
node tools/selfhost_check.js                 # fails if the built page fetches anything off-site
node tools/hdr_check.js                      # fails if over-bright highlights turn into black blocks after bloom
node tools/flow_check.js                     # airflow solver: drag of a square plate against the measured value, checks on the car's flow
```

The tools need Playwright with Chromium installed.
