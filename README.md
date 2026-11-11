# Halcyon

Live: https://racing.ticoag.fun

An original, fully procedural range of cars built with three.js — no model files, everything is generated in code.

| | | Engine | Drive | Mass | V-max | 0–100 | Cornering | Character |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **H9** | mid-engine hypercar | 6.5 l V12, 890 kW, 9000 rpm | rear, 7-speed dual-clutch | 1390 kg | 400 km/h | 2.7 s | 1.85 g | the reference: screams, stays flat |
| **G8** | front-engine grand tourer | 5.0 l supercharged cross-plane V8, 566 kW, 7200 rpm | rear, 8-speed automatic | 1720 kg | 335 km/h | 3.6 s | 1.37 g | long bonnet, soft springs: squats, dives and leans; burbles and whines |
| **E4** | electric hypercar | four motors, 1400 kW | all four wheels, one gear | 1980 kg | 380 km/h | 1.9 s | 1.59 g | closed nose, long tapering tail, no pipes; motor song and regeneration |
| **R10** | track car | 5.2 l V10, 625 kW, 10 500 rpm | rear, 6-speed sequential | 1180 kg | 325 km/h | 2.2 s | 3.4 g | roof scoop, fin, fixed wing, slicks and camber; shrieks over straight-cut gears |

The model is chosen in the header (or with `?car=g8`, `e4`, `r10`); the car is taken apart and rebuilt in place, each model keeping its own configuration. All four share the carbon tub, the canopy and the butterfly doors.

- Configurator: presets per model, 10 colours × 7 finishes (metallic, pearl, gloss, matte, chrome, chameleon, carbon), 4 wheel designs, rim and caliper colours, GT wing / active spoiler / no wing, track and road aero kits, 5 liveries, 4 interiors
- Butterfly doors, deployable wing and airbrake
- Detailed cockpit with a first-person driver view that rides the body and leans with the g-forces
- Vehicle model, per car: torque curve and gearbox (dual-clutch, automatic, sequential, or a single electric reduction with regeneration), rear- or all-wheel drive, tyres with load sensitivity, drag and downforce per axle, ABS brakes with a torque cap, traction and launch control, active low-drag wing trim at V-max, suspension springs with aero compression. Each model has its own attitude: pitch and roll per g, spring frequencies and damping, ride height, rake and camber
- Driving programs on a procedurally generated night circuit:
  - Cruise: launch and V-max run (the H9 to ~400 km/h in about 30 s with the GT wing, 22 s with the road kit), then holds it
  - Corner: fast esses at the limit of grip (1.4 g in the G8, 3.4 g in the R10) with kerb strikes at the apexes
  - Brake: flat out down the straight, maximum braking (the H9 from ~300 km/h at up to ~2.5 g with the airbrake, the R10 at over 3 g) into a hairpin past the 300/200/100 boards
- Night circuit: road with kerbs, patches, rubbered line and skid marks; barriers with catch fences and advertising; floodlight masts whose light pools sweep under the car and whose nearest lamps light the bodywork; gantries; horizon and night sky. The studio dissolves into it from under the car when a program starts and comes back after the car stops. Everything that passes is smeared over a 1/90 s exposure
- Speed effects: afterfire flames on the same events the sound plays, launch tyre smoke, condensation in the wing-tip vortices, specks streaking through the floodlit air, splitter sparks under braking and bottoming, glowing discs
- Airflow view: a live 3D lattice-Boltzmann wind tunnel on the GPU. D3Q19 with 5 cm cells around half the car, the centre plane a mirror (about 560k cells; 7 cm cells on touch screens); regularised collisions with a Smagorinsky eddy viscosity (LES) and a separate bulk viscosity that soaks up sound; a rolling road, tyres turning with the road, a wall model for the millimetre-thin turbulent boundary layer (the walls slide with the air and hold back its skin friction, while cells off convex edges hold the air so the flow leaves sharp edges), and the wing/spoiler/airbrake voxelised as they move. The air goes over, under and around the car, separates off the tail and sheds a turbulent wake on its own; the wing's tip vortices come out of the solution. Smoke rakes and wing-tip wands release tracers carried by the solved velocity (streaklines, coloured by local speed). The surface pressure map is the time-averaged pressure the solver finds next to the skin, as Cp. `tools/flow_check.js` measures the drag of a square plate with the same solver settings (Cd 0.95 against 1.17 measured at 10 cells across) and checks the car's flow. Falls back to 2D potential-flow streamlines where float render targets or six draw buffers are missing
- Sound (Web Audio): the engine is synthesised from the crank angle in an AudioWorklet from a firing table per model (angle, exhaust bank, strength): twelve even pulses for the V12, ten for the V10, the uneven bank sequence of the cross-plane V8 (strong half orders: the burble), with load, ignition cuts for shifts, limiter and launch control, and afterfire. The electric car has no firing table: its motors sing in orders of the shaft speed, under torque and under regeneration. Each model tunes its exhaust tracts and intake; the G8 adds a supercharger, the R10 straight-cut gear whine. Exhaust and intake are placed on the car and heard from the camera, with a muffled cockpit perspective, wind that climbs steeply with speed, tyre scrub, kerb rumble, patch thumps, barrier echoes and masts whooshing past; showroom music in the studio

## Layout

| Path | What |
| --- | --- |
| `src/car.js` | Main module; `/*@include file*/` markers pull in the blocks below |
| `src/blk_models.js` | The models: one spec each (body curves and hard points, axles, aero parts, lights, powertrain, chassis, attitude, voice, presets); the H9 is the base, the others state what differs |
| `src/blk_cockpit.js` | Interior |
| `src/blk_track.js` | Procedural circuit: curvature segments per program, racing line, kerbs, boards, centreline in the car frame |
| `src/blk_world.js` | Road/floor shader, barriers, floodlights, gantries, sky, environment-map blend, studio↔circuit reveal |
| `src/blk_drive.js` | Vehicle model from the active spec, speed planner, gearbox, suspension, sparks, HUD |
| `src/blk_fx.js` | Afterfire, tyre smoke, vortex vapour, specks, cockpit camera rig |
| `src/blk_aero.js` | Pressure map, force arrows, loads; potential-flow fallback |
| `src/blk_flow.js` | 3D lattice-Boltzmann tunnel: solver, voxelised car, smoke streaklines, physics checks |
| `src/blk_audio.js` | Sound engine (AudioWorklet engine voice from a firing table, electric motors, supercharger, gear whine) and music |
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
node tools/audio.js                          # renders the sound engine offline, prints levels (plan and car id optional)
node tools/drive.js                          # drives every model through the programs: acceleration, V-max, g, body attitude
node tools/selfhost_check.js                 # fails if the built page fetches anything off-site
node tools/hdr_check.js                      # fails if over-bright highlights turn into black blocks after bloom
node tools/flow_check.js                     # airflow solver: drag of a square plate against the measured value, checks on the car's flow (--car=g8 for another model)
CAR=e4 VIEWS=front34,side node tools/shot.js out/e4   # stills of a model
```

The tools need Playwright with Chromium installed.
