# Halcyon

Live: https://racing.ticoag.fun

An original, fully procedural range of cars built with three.js — no model files, everything is generated in code.

| | | Engine | Drive | Mass | V-max | 0–100 | Cornering | Character |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **H9** | mid-engine hypercar | 6.5 l V12, 890 kW, 9000 rpm | rear, 7-speed dual-clutch | 1390 kg | 400 km/h | 2.7 s | 1.85 g | the reference: screams, stays flat |
| **G8** | front-engine grand tourer | 5.0 l supercharged cross-plane V8, 566 kW, 7200 rpm | rear, 8-speed automatic | 1720 kg | 335 km/h | 3.6 s | 1.37 g | long bonnet, soft springs: squats, dives and leans; burbles and whines |
| **E4** | electric hypercar | four motors, 1400 kW | all four wheels, one gear | 1980 kg | 380 km/h | 1.9 s | 1.59 g | closed nose, long tapering tail, no pipes; motor song and regeneration |
| **R10** | track car | 5.2 l V10, 625 kW, 10 500 rpm | rear, 6-speed sequential | 1180 kg | 325 km/h | 2.2 s | 3.4 g | roof scoop, fin, fixed wing, slicks and camber; shrieks over straight-cut gears |

The model is chosen in the header (or with `?car=g8`, `e4`, `r10`); the car is taken apart and rebuilt in place, each model keeping its own configuration. A configuration can be written into the address too (`?car=g8&paint=lava&finish=matte&wing=none`; the [guide](https://racing.ticoag.fun/en/guide/) lists every value). All four share the carbon tub, the canopy and the butterfly doors.

- Configurator: presets per model, 10 colours × 7 finishes (metallic, pearl, gloss, matte, chrome, chameleon, carbon), 4 wheel designs, rim and caliper colours, GT wing / active spoiler / no wing, track and road aero kits, 5 liveries, 4 interiors
- Butterfly doors, deployable wing and airbrake
- Parts store: one button takes the parked car apart and sets its parts out on the studio floor around the bare tub, sorted by system into nine outlined bays; the same button puts it all back together. While the store is open the systems have their own buttons, so each can be fitted to the car or taken off on its own:
  - body: bonnet, engine cover and the four fenders, cut from the skin along its shut lines, each keeping the lights, vents and lettering on it (with the engine behind the cabin, the cover comes off from the bulkhead back, so the engine can be seen in its bay)
  - doors: outer panels, trim panels, windows, mirrors
  - canopy: windscreen, pillars, roof and rear quarters with their headlining, roof scoop
  - aero: splitter, fences, canards, skirts, diffuser, wing (main plane, flap, end plates, pylons) or spoiler, fin
  - cabin: seats, dashboard, steering wheel, console, pedals, bulkhead
  - wheels: per corner the upright, caliper, disc, wheel, tyre and centre lock, in a row along the axle
  - tail: tail panel, light bar, exhausts
  - suspension: per corner the lower and upper wishbone and the coil-over damper (its foot a fork round the half shaft on a driven axle), the steering rack with its tie rods, front and rear anti-roll bars with their drop links
  - powertrain, as each model's spec has it. H9: 65° V12 behind the cabin (block with its bores, flywheel and belt drive, two heads with cam covers, coils and ports, twin carbon plenums and air filters, six-into-one manifolds), 7-speed transaxle with the differential, half shafts, a silencer and tail pipe per bank over the gearbox, two radiators in the nose. R10: 90° V10 with ten intake trumpets and a sequential gearbox. G8: 90° V8 behind the front axle with the supercharger in its V, a torque tube under the cabin to the 8-speed transaxle at the rear, and a pipe per bank under the floor to the silencers in the tail. E4: the battery under the floor, and on each axle two motors (hollow, the half shafts run through them), the reduction gears between them and the inverter above, with its cables

  The powertrain and the suspension lie under the skin and are only drawn while the store is open. They are built from the model's hard points (axles, engine position, exhaust tips) and kept inside the bodywork that was drawn first: under the skin or in a wheel arch, over the floor, clear of the cabin and of each other.

  The part under the pointer is named beside it (左前下叉臂, 右排气歧管, 发动机盖 …), and so is the part held up. Any part, lying in its bay or fitted to the car, is picked up with a click: it rises to eye level and floats there, the camera comes in, the studio darkens behind it and the part stands in a light of its own (a tent of soft boxes on every side and a key lamp over the camera's shoulder). A drag turns the part itself about its middle, so every side of it can be brought into the light; zooming in shows the paint flake, the carbon weave, the stitching. With the turntable on, the held part turns by itself. A click beside it, Escape or a view button sets it down where it lay.

  The bays are packed from the sizes of the parts, so they suit every model and configuration (parts not fitted, such as the other wing or the track kit, take no place). The camera rises to look over the whole floor (the wheel and cabin views look at their bays); pointing at a system's button lights its bay. While the store is open the system buttons take the place of the driving programs, and the airflow view puts the car together first; asked for while driving, the car parks, switches off and is then taken apart
- Detailed cockpit with a first-person driver view that rides the body and leans with the g-forces
- Vehicle model, per car: torque curve and gearbox (dual-clutch, automatic, sequential, or a single electric reduction with regeneration), rear- or all-wheel drive, tyres with load sensitivity, drag and downforce per axle, ABS brakes with a torque cap, traction and launch control, active low-drag wing trim at V-max, suspension springs with aero compression. Each model has its own attitude: pitch and roll per g, spring frequencies and damping, ride height, rake and camber
- Driving programs on a procedurally generated night circuit:
  - Cruise: launch and V-max run (the H9 to ~400 km/h in about 30 s with the GT wing, 22 s with the road kit), then holds it
  - Corner: fast esses at the limit of grip (1.4 g in the G8, 3.4 g in the R10) with kerb strikes at the apexes
  - Brake: flat out down the straight, maximum braking (the H9 from ~300 km/h at up to ~2.5 g with the airbrake, the R10 at over 3 g) into a hairpin past the 300/200/100 boards
- Free driving (自由驾驶): the car is driven by hand over open country, in daylight. One button takes it from the studio to the grid of a 10 km road course; the land spreads out from under it as the circuit does
  - Controls: `W A S D` or the arrow keys (the brake key reverses from a standstill), `Space` handbrake, `C` camera (close behind, further behind, driver's seat), `B` look back, `R` back onto the road, `T` driving assists on/off, `P` the car drives itself, `N` time of day (dusk, day, night), `Esc` stop and return to the studio. A gamepad takes over once it is touched (left stick, triggers, A handbrake, Y camera, X reset, B look back, right stick looks round); touch screens get a steering pad and pedals. A drag swings the camera round the car, the wheel moves it in and out
  - The map: 4 km square, generated when first asked for. A closed road is drawn first (plan and elevation: a 1.4 km main straight through a stadium, esses, sweepers along a lake, three hairpins up the face of a range to a pass at 116 m, a ridge, a descent through forest, a back straight across the middle of the map and a long right-hander that turns it round: 21 bends, radii from 27 m, climbs to 6 %, banked into the bends), then the land is raised round it: close to the road it follows the road's own profile, further off the relief grows into hills, a mountain range, a lake in a basin and a rim of snow-topped peaks nobody drives over
  - Vehicle model (`blk_dyn.js`): the body in the plane (forward and sideways speed, yaw) on tyres with combined slip, an axle speed per axle (wheels spin up and lock), differentials, load-following torque split on the electric car; and the sprung body on four springs, dampers and anti-roll bars derived from each model's attitude figures, every wheel on the ground under it. Squat, dive and roll are what the loads make them; the car goes light over crests, leaves the ground and lands; kerbs, verges, grass, earth, sand and water each grip and drag differently. Steering input asks for a share of the cornering force the car has at its speed, so a touch of the key is a touch at 60 and at 300 km/h. On the keys a tap moves the wheel a little and a held key turns it faster. Anti-lock brakes, traction control (it holds the engine to what the driven tyres can still put down beside the cornering force they carry), stability control and a steering assist that turns into a slide can be switched off together for drifting. Guardrails, walls, trees, rocks and buildings push back
  - Powertrain, aero and grip are the same figures the driving programs use: the H9 still reaches 100 km/h in 2.7 s and 397 km/h, the R10 still brakes at 3.5 g
  - Scenery: terrain in chunks at three levels of detail, 24 000 trees of three kinds (full shape near the car, simple shapes far off) and rocks, farmland on the low ground, the lake, guardrails round the outside of bends and along drops, the stadium (walls with catch fences, grandstands, pit building, start gantry, grid), a village round its church and barns among the fields (their windows lit at night), marshals' posts, chevron and distance boards, marker posts, wind turbines, balloons. A low sun with haze towards it, clouds whose shadows drift over the ground, tree shade baked for the sun's position (the car dims as it passes through it), the car's own shadow thrown from the sun; tyre marks, tyre smoke on the road and dust off it
  - On screen: speed, gear, revs and g as in the programs, the lap clock (started over the line, a lap counts when every sector has been passed) with the best lap, a map of the course, and a word for a lap, the speed trap on the main straight, a drift held and banked, a jump landed
- Night circuit: road with kerbs, patches, rubbered line and skid marks; barriers with catch fences and advertising; floodlight masts whose light pools sweep under the car and whose nearest lamps light the bodywork; gantries; horizon and night sky. The studio dissolves into it from under the car when a program starts and comes back after the car stops. Everything that passes is smeared over a 1/90 s exposure
- Speed effects: afterfire flames on the same events the sound plays, launch tyre smoke, condensation in the wing-tip vortices, specks streaking through the floodlit air, splitter sparks under braking and bottoming, glowing discs
- Airflow view: a live 3D lattice-Boltzmann wind tunnel on the GPU. D3Q19 with 5 cm cells around half the car, the centre plane a mirror (about 560k cells; 7 cm cells on touch screens); regularised collisions with a Smagorinsky eddy viscosity (LES) and a separate bulk viscosity that soaks up sound; a rolling road, tyres turning with the road, a wall model for the millimetre-thin turbulent boundary layer (the walls slide with the air and hold back its skin friction, while cells off convex edges hold the air so the flow leaves sharp edges), and the wing/spoiler/airbrake voxelised as they move. The air goes over, under and around the car, separates off the tail and sheds a turbulent wake on its own; the wing's tip vortices come out of the solution. Smoke rakes and wing-tip wands release tracers carried by the solved velocity (streaklines, coloured by local speed). The surface pressure map is the time-averaged pressure the solver finds next to the skin, as Cp. `tools/flow_check.js` measures the drag of a square plate with the same solver settings (Cd 0.95 against 1.17 measured at 10 cells across) and checks the car's flow. Falls back to 2D potential-flow streamlines where float render targets or six draw buffers are missing
- Sound (Web Audio): the engine is synthesised from the crank angle in an AudioWorklet from a firing table per model (angle, exhaust bank, strength): twelve even pulses for the V12, ten for the V10, the uneven bank sequence of the cross-plane V8 (strong half orders: the burble), with load, ignition cuts for shifts, limiter and launch control, and afterfire. The electric car has no firing table: its motors sing in orders of the shaft speed, under torque and under regeneration. Each model tunes its exhaust tracts and intake; the G8 adds a supercharger, the R10 straight-cut gear whine. Exhaust and intake are placed on the car and heard from the camera, with a muffled cockpit perspective, wind that climbs steeply with speed, tyre scrub, kerb rumble, patch thumps, barrier echoes and masts whooshing past; showroom music in the studio

## Layout

| Path | What |
| --- | --- |
| `src/car.js` | Main module; `/*@include file*/` markers pull in the blocks below |
| `src/blk_models.js` | The models: one spec each (body curves and hard points, axles, aero parts, lights, powertrain, mechanical layout, chassis, attitude, voice, presets); the H9 is the base, the others state what differs |
| `src/blk_cockpit.js` | Interior |
| `src/blk_track.js` | Procedural circuit: curvature segments per program, racing line, kerbs, boards, centreline in the car frame |
| `src/blk_landgen.js` | The free-driving map as plain data: noise, the road (spline, elevation, banking, kerbs, barriers), the height grid raised round it, ground cover, trees and rocks, and the queries the vehicle model asks (ground under a wheel, road coordinates of a point) |
| `src/blk_land.js` | The land drawn round the car: terrain chunks reading the height texture, the road's mesh and markings, lake, sky, times of day, sun and sky light, baked shade, the car's shadow, the environment map |
| `src/blk_scenery.js` | Trees, rocks, barriers and fences, the stadium, signs, turbines, balloons, tyre marks |
| `src/blk_dyn.js` | Free-driving vehicle model: tyres, axles, sprung body, collisions, controls and assists, the built-in driver, lap and drift scoring |
| `src/blk_free.js` | Keyboard, gamepad and touch input, going out onto the land and back, the following camera, the driver's display |
| `src/blk_world.js` | Road/floor shader, barriers, floodlights, gantries, sky, environment-map blend, studio↔circuit reveal |
| `src/blk_drive.js` | Vehicle model from the active spec, speed planner, gearbox, suspension, sparks, HUD |
| `src/blk_fx.js` | Afterfire, tyre smoke, vortex vapour, specks, cockpit camera rig |
| `src/blk_aero.js` | Pressure map, force arrows, loads; potential-flow fallback |
| `src/blk_flow.js` | 3D lattice-Boltzmann tunnel: solver, voxelised car, smoke streaklines, physics checks |
| `src/blk_audio.js` | Sound engine (AudioWorklet engine voice from a firing table, electric motors, supercharger, gear whine) and music |
| `src/blk_mech.js` | What is under the skin: engine, intake, manifolds, gearbox, shafts, exhaust and radiators, or motors, inverters and battery; wishbones, coil-overs, rack and anti-roll bars |
| `src/blk_agent.js` | The controls offered as tools to an agent in the browser (WebMCP) |
| `src/blk_explode.js` | Parts store: the systems and their bays, the floor plan packed from the parts' sizes, the skin cut into panels along the shut lines, inner faces for one-sided surfaces, the overview camera, the parts' names under the pointer, picking a part up to turn it in its own light |
| `src/page.template.html` | Markup and styles |
| `src/fonts.css` | `@font-face` rules for the self-hosted fonts (generated) |
| `build.py` | Inlines the app into `public/index.html` and copies the three.js modules it imports into `public/vendor/` |
| `site/` | The reading pages as Markdown, in Chinese (`zh/`, served at the root) and English (`en/`, served under `/en/`), their template and stylesheet, and the agent skill |
| `build_site.py` | Writes the reading pages, their Markdown twins, `sitemap.xml`, `llms.txt`, the structured data and the app page's head (called by `build.py`) |
| `functions/_middleware.js` | Cloudflare Pages Function: answers a page asked for with `Accept: text/markdown` with its Markdown twin |
| `public/` | Static site root. `fonts/`, `img/`, the icons, `robots.txt`, `_headers` and `_routes.json` are committed; everything else is generated |
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

## Search engines and agents

The app is one canvas, so what it shows is also written down, for people who search and for programs that read:

- Reading pages: the range (`/models/`), each model with a spec sheet (`/models/h9/` …), a guide with the controls and an FAQ (`/guide/`), and how it works (`/tech/`), in Chinese at the root and in English under `/en/`. Their text is Markdown in `site/`; the spec sheets, the comparison table and the table of link parameters are filled in from `src/` by `tools/specs.js`, so they cannot drift from the app. The app's own page carries the Chinese overview inside its `<canvas>`, as the element's fallback content
- Every page has a title, description, canonical address, `hreflang` twins, Open Graph card (1200 × 630 pictures rendered by `tools/og.js`) and JSON-LD: `WebSite`, `Organization`, `WebPage` with `BreadcrumbList`, and `WebApplication` and `ItemList` on the home pages, `FAQPage` on the guide, `TechArticle` on the technical page. The cars are fictional, so nothing is marked up as a product
- `robots.txt` lets everyone in, AI search and training crawlers by name, with a Content Signal; `sitemap.xml` lists the 16 pages with their language twins
- For language models: `/llms.txt` (the map), `/llms-full.txt` and `/llms-full.zh.txt` (every page in one file), and a Markdown twin of every page at `<page>index.md`. A page asked for with `Accept: text/markdown` is answered with that twin by the Pages Function (Cloudflare's own Markdown for Agents needs a paid plan). The home page's `Link` header points to all of these
- For agents that work the page: the model and configuration can be set by link; every control is a button with a `data-` attribute and its state in ARIA; where the browser has WebMCP (`document.modelContext`), the page registers six tools (`get_configuration`, `select_model`, `set_options`, `set_view`, `run_program`, `set_feature`). `/.well-known/agent-skills/` describes all of this as an agent skill
- An address that is not a page gets `404.html` (without that file Cloudflare Pages answers every address with the app). The project's `pages.dev` address is the same site and is sent with `X-Robots-Tag: noindex`

## Deploy (Cloudflare Pages)

The Cloudflare Pages project `racing` is connected to this repository and builds on every push:

- Build command: `npm ci && python3 build.py`
- Build output directory: `public`

Pushes to `main` go to production at https://racing.ticoag.fun (also https://racing-ddu.pages.dev); other branches get preview URLs. `functions/` is picked up by the same build; it runs only on the pages' own addresses (`public/_routes.json`), and the static files are served as before if it fails.

Three settings of the `ticoag.fun` zone act on crawlers before this site's own files do, for every hostname of the zone. For the site to be read by search engines and AI crawlers alike, they are set so:

- **Block AI bots** (Security → Settings → Bot traffic) is **off**. On, it refuses AI training crawlers at the edge with a 403 (GPTBot, ClaudeBot, CCBot, Bytespider, Amazonbot).
- The **managed robots.txt** is **off**. On, it puts Cloudflare's own groups in front of `public/robots.txt`: `Disallow: /` for the training crawlers and also for Baiduspider, PetalBot and KimiBot, and `ai-train=no`. `public/robots.txt` names the search engines again with `Allow: /` in case it is switched back on.
- **Crawler Hints** (Caching → Configuration) is **on**: Bing, Yandex and the other search engines that take IndexNow are told when content changes.

The rest of the zone's hostnames are open to these crawlers too. To close one again, use a WAF custom rule that names the hostname rather than the zone-wide switch.

## Tools

```bash
npm install                                  # local three.js for dev/ pages
node tools/interact.js dev/live.html         # clicks every control, reports console errors
node tools/audio.js                          # renders the sound engine offline, prints levels (plan and car id optional)
node tools/drive.js                          # drives every model through the programs: acceleration, V-max, g, body attitude
node tools/sim.js                            # free-driving vehicle model without a browser: every model through standing starts, stops, steady and sudden cornering, a handbrake turn, and a lap of the map by the built-in driver (--lap for the laps alone, a car id for one model)
node tools/landmap.js                        # builds the free-driving map without a browser: length, bends, gradients, a picture of it (out/landmap.png); checks that the road lies on top of the land
node tools/free.js                           # free driving in the real page: out of the studio, away under the keys, camera and switches, back again, every model (--shots saves pictures)
node tools/selfhost_check.js                 # fails if the built page fetches anything off-site
node tools/site.js                           # what search engines and agents read: every page's head, structured data, links and Markdown twin, robots.txt, llms.txt, Markdown by Accept header; then in the page: the configuration from the address, and the WebMCP tools (--files leaves the browser out)
node tools/og.js                             # renders the pictures in public/img/ (each model's hero and social card, the parts store)
node tools/specs.js                          # the models' figures and the option lists as JSON, as the reading pages get them
node tools/hdr_check.js                      # fails if over-bright highlights turn into black blocks after bloom
node tools/flow_check.js                     # airflow solver: drag of a square plate against the measured value, checks on the car's flow (--car=g8 for another model)
node tools/explode.js                        # parts store: every model laid out and put together again (panels cover the skin, every part on the floor in its bay, none overlapping, the powertrain and suspension under the skin and over the floor, every part named under the pointer, a part picked up and let go, one system alone), then the buttons, a part picked up by a click, driving and airflow (--shots saves stills, --stills skips the clicks)
CAR=e4 VIEWS=front34,side node tools/shot.js out/e4   # stills of a model
```

The tools need Playwright with Chromium installed.
