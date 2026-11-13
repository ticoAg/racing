---
title: Halcyon guide: configuring, parts store, driving, airflow and FAQ
description: How to use the Halcyon configurator: switching models and options, taking the car apart, the driving programs, keyboard, gamepad and touch controls for free driving, the airflow view, sharing a configuration by link, and answers to common questions.
nav: guide
---
# Guide

Halcyon opens in a photo studio with the car in the middle. Drag to orbit; use the wheel or pinch to zoom. The row of buttons at the bottom works the doors, wing, lights, parts store, airflow, sound and camera views; the panel on the right holds the configuration. The interface is in Chinese, so the Chinese label of each control is given here.

## Switching models

H9, G8, E4 and R10 at the top left switch the model. The car is taken apart and rebuilt in place, and each model keeps its own configuration. A link can open a model directly: `https://racing.ticoag.fun/?car=g8`.

## Configuring

The panel on the right has six tabs:

- **Style** (风格): complete presets for each model that set every option at once.
- **Paint** (漆面): 10 colours and 7 finishes (metallic, pearl, gloss, matte, chrome, chameleon, carbon).
- **Wheels** (轮毂): 4 designs, 5 rim finishes, 6 caliper colours.
- **Kit** (套件): swan-neck GT wing, active spoiler or no wing; track or road aero kit.
- **Livery** (涂装): plain, twin stripes, offset stripe, two-tone, hoop.
- **Cabin** (内饰): carbon black, track red, saddle tan, ivory.

## Sharing a configuration by link

The model and every option can be written into the link, and the page opens with exactly that car:

`https://racing.ticoag.fun/?car=g8&paint=lava&finish=matte&wheel=mesh&wing=none`

{{options}}

Options left out take the values of the model's first preset.

## Parts store

With the car parked, the 分解 button takes it apart and lays the parts out on the floor in nine bays, one per system: body, doors, canopy, aero, cabin, wheels, tail, suspension and powertrain. The same button puts it back together. While the store is open each system has its own button, to fit it to the car or take it off on its own.

![The parts of a Halcyon H9 laid out on the studio floor in nine bays](/img/parts.jpg)

The part under the pointer is named. Click any part to pick it up: it rises to eye level, the camera moves in and the studio darkens behind it. Drag to turn the part; zoom in to see the paint flake, the carbon weave and the stitching. Click beside it or press `Esc` to put it down.

## Driving programs

Three programs drive the car for you on a procedurally generated night circuit. The studio dissolves into the circuit from under the car and returns once the car has stopped.

- **Cruise** (巡航): a launch and a run to top speed, which is then held.
- **Corner** (过弯): fast esses at the limit of grip, striking the kerbs at the apexes.
- **Brake** (制动): flat out down the straight, then maximum braking into a hairpin.

The display shows speed, gear, revs and g, with downforce, drag and the front axle's share of the downforce.

## Free driving

自由驾驶 takes the car from the studio to the grid of a 10 km road course, in daylight, to be driven by hand. The map is 4 km square: a 1.4 km main straight through a stadium, sweepers along a lake, three hairpins up to a pass at 116 m, and a descent through forest. There are 21 bends in all.

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` or arrow keys | Throttle, steering, brake (the brake key reverses from a standstill) |
| `Space` | Handbrake |
| `C` | Camera: close behind, further behind, driver's seat |
| `B` | Look back |
| `R` | Back onto the road |
| `T` | Driving assists on or off (ABS, traction control, stability control) |
| `P` | The car drives itself |
| `N` | Time of day: dusk, day, night |
| `Esc` | Stop and return to the studio |

A gamepad takes over once it is touched: left stick to steer, triggers for throttle and brake, A handbrake, Y camera, X reset, B look back, right stick to look round. Touch screens get a steering pad and pedals.

The lap clock starts over the line, and a lap counts once every sector has been passed. The display also shows a map of the course, the best lap, the speed trap on the main straight, and calls for drifts and jumps. With the assists off the car can be drifted.

## Airflow

The 气流 button opens the wind tunnel view. Smoke streams pass over and under the car, separate off the tail and form the wake, and the wing-tip vortices show clearly. The colours on the body are the pressure coefficient Cp. Raise the wing or the airbrake and the flow changes with it. Devices without the GPU features it needs get 2D streamlines instead.

## Sound

Sound is off until you press the 声音 button. The studio has music; once a driving program starts you hear the engine, exhaust, intake, wind and tyres, muffled when the camera is in the driver's seat.

## FAQ

### What is Halcyon?

Halcyon is a 3D car configurator and driving simulation that runs in the browser. Its four cars (H9, G8, E4, R10) are generated entirely in code, with no 3D model files, and rendered in real time with three.js.

### Are these real cars?

No. The H9, G8, E4 and R10 are fictional designs made for this project and have no connection with any real car maker. Their figures are the simulation's own settings and the results it produces.

### Does it cost anything, or need an install or an account?

No. Halcyon is a free web page: open https://racing.ticoag.fun and it runs. There are no accounts and no ads.

### What device and browser does it need?

A current browser with WebGL 2, on a desktop or a phone. The 3D wind tunnel needs GPU features such as float render targets; without them it falls back to 2D streamlines. A faster GPU gives a smoother picture.

### Can I drive on a phone?

Yes. Touch screens get a steering pad, throttle and brake pedals, a handbrake, and buttons for camera, reset and exit.

### Is the wind tunnel a real calculation?

Yes. The airflow view is a 3D lattice-Boltzmann (D3Q19) flow solved live on the GPU with a large-eddy turbulence model over about 560,000 cells. It is not a recorded animation. With the same solver settings a square plate comes out at a drag coefficient of 0.95, against a measured 1.17.

### Are the engine sounds recordings?

No. Each engine is synthesised in an AudioWorklet from its crank angle and the model's firing order, which is why the V12, the cross-plane V8 and the V10 each sound different. The electric E4 sings in orders of its motor speed.

### Which model is the fastest?

The H9 has the highest top speed (400 km/h), the E4 accelerates hardest (0–100 km/h in 1.9 s), and the R10 corners fastest (3.4 g).

### Is it open source?

The source code is public on GitHub: https://github.com/ticoAg/racing
