---
title: How Halcyon works: procedural cars, live wind tunnel, engine synthesis
description: How Halcyon generates four cars in code in the browser: bodies built from design curves, the vehicle dynamics models, a 3D lattice-Boltzmann wind tunnel on the GPU (D3Q19 with LES), and engine sound synthesised from firing order in an AudioWorklet.
nav: tech
---
# How it works

Everything in Halcyon is generated in code in the browser: bodywork, interior, engines, circuit, terrain, airflow and sound. There are no model files, no texture assets and no audio samples. Rendering uses three.js on WebGL 2.

## Procedural bodywork

Each car is one specification: a set of design curves along its length (half width, belt line, crown, centre line, section exponent, tuck, sill, floor) and hard points (wheelbase, track, engine position, exhaust tips). The skin is generated from the curves and then cut along its shut lines into bonnet, fenders, doors and other panels. The H9 is the base specification; the G8, E4 and R10 state only what differs. When the model is switched, the car is taken apart and rebuilt in place from the new specification.

What lies under the skin is generated the same way: block, heads, intake and exhaust manifolds of the V12, V10 and V8, gearbox, half shafts and radiators, or the electric car's battery, motors and inverters; and at each wheel the wishbones, coil-over damper, steering rack and anti-roll bar. These are placed from the hard points and kept inside the bodywork and clear of each other.

## Rendering

- The paint is a physically based material with a clearcoat. The finish sets metalness, roughness, a flake normal map and thin-film iridescence (pearl, chameleon).
- While driving, everything that passes is smeared over a 1/90 s exposure, and bright highlights bloom.
- The studio and the night circuit swap by a dissolve that spreads out from under the car.
- Speed effects: afterfire flames on the same events the sound plays, tyre smoke at launch, condensation in the wing-tip vortices, sparks under braking and bottoming, glowing brake discs.

## Vehicle dynamics

The driving programs use a longitudinal model on a planned line, with each car's figures taken from its specification: torque curve and gearbox (dual-clutch, automatic, sequential, or a single electric reduction with regeneration), rear- or all-wheel drive, tyres with load sensitivity, drag and downforce per axle, ABS with a torque cap, traction and launch control, a wing that trims flat at top speed, and springs compressed by the aero load.

Free driving uses a fuller model:

- The body moves in the plane with three degrees of freedom (forward speed, sideways speed and yaw) on tyres with combined slip.
- Each axle has its own speed, so wheels spin up and lock. There are differentials, and the electric car splits torque by load.
- The sprung body rides on four springs, dampers and anti-roll bars, with every wheel on the ground under it. Squat, dive and roll are whatever the load transfer makes them.
- The car goes light over crests, leaves the ground and lands. Kerbs, verges, grass, earth, sand and water each grip and drag differently.
- ABS, traction control, stability control and the steering assist can be switched off together.

Both models share the same powertrain, aero and grip figures, so they agree: the H9 reaches 100 km/h in 2.7 s in either.

## Procedural map

The free-driving map is 4 km square and is generated when first asked for. A closed road is drawn first, in plan, elevation and banking: a 1.4 km straight, esses, sweepers along a lake, three hairpins, a pass at 116 m, a ridge and a descent through forest. It has 21 bends with radii from 27 m and gradients up to 6%. The land is then raised round the road: close to it the land follows the road's own profile, and further off it grows into hills, a mountain range, a lake in a basin and a rim of snow-topped peaks. The terrain is drawn in chunks at three levels of detail, with 24,000 trees, farmland, a village, a stadium and wind turbines.

## Live wind tunnel

The airflow view is a 3D lattice-Boltzmann solver on the GPU:

- A D3Q19 lattice with 5 cm cells (7 cm on touch screens) round half the car, with the centre plane as a mirror: about 560,000 cells.
- Regularised collisions with a Smagorinsky eddy viscosity (large-eddy simulation) and a separate bulk viscosity that soaks up sound waves.
- A rolling road, with the tyres turning with it, and a wall model for the millimetre-thin turbulent boundary layer.
- The wing, spoiler and airbrake are voxelised again as they move, and the flow follows.
- The smoke is tracers carried by the solved velocity field (streaklines), coloured by local speed. The surface pressure map is the time-averaged pressure the solver finds next to the skin, shown as Cp.

As a check, the same solver settings give a square plate 10 cells across a drag coefficient of 0.95, against a measured 1.17. Devices without float render targets or multiple draw buffers get 2D potential-flow streamlines instead.

## Sound synthesis

Engine sound is synthesised from the crank angle in an AudioWorklet. Each model has a firing table (angle, exhaust bank, strength):

- H9, V12: twelve even pulses.
- R10, V10: the banks fire alternately 90° and 54° apart.
- G8, cross-plane V8: uneven intervals on each bank, giving strong half orders, which is the burble.
- E4: no firing table. The motors sing in orders of the shaft speed, differently under power and under regeneration.

Each model tunes its own exhaust tract lengths and intake sound. The G8 adds a supercharger and the R10 the whine of straight-cut gears. Exhaust and intake are placed on the car and heard from the camera, with a muffled cockpit perspective. Wind noise climbs steeply with speed, and there are tyre scrub, kerb rumble and echoes off the barriers. Ignition cuts on shifts, the rev limiter, launch control and afterfire are all in the sound.

## Delivery

The whole application is inlined into one HTML page, which loads only the three.js modules it imports. The fonts are self-hosted and subset. The page requests nothing from third-party CDNs or font services, so it behaves the same in every region.

Source code: https://github.com/ticoAg/racing
