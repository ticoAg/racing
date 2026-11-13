---
name: halcyon-configurator
description: Open, configure and operate the Halcyon car configurator at racing.ticoag.fun. Choose a model, set paint, wheels and aero by link or with the page's tools, start the driving programs, and read the cars' specifications.
---
# Halcyon configurator

Halcyon (https://racing.ticoag.fun/) is a free 3D car configurator and driving simulation that runs in the browser. Its four cars, the H9, G8, E4 and R10, are fictional and generated in code. The interface is Chinese.

## Read before you browse

The car is drawn in a WebGL canvas, so the page itself holds little text. The facts are in the reading pages, each of which has a Markdown twin:

- Overview and page list: https://racing.ticoag.fun/llms.txt
- Specifications of all four models: https://racing.ticoag.fun/en/models/index.md
- Controls, features and FAQ: https://racing.ticoag.fun/en/guide/index.md
- How it is built: https://racing.ticoag.fun/en/tech/index.md

Any page answers with Markdown when asked with `Accept: text/markdown`.

## Open a car by link

The model and its configuration are query parameters. A user who follows the link sees exactly that car:

`https://racing.ticoag.fun/?car=g8&paint=lava&finish=matte&wheel=mesh&wing=none`

{{options}}

Parameters left out take the values of the model's first preset. Unknown values are ignored.

## Work the page with tools (WebMCP)

Where the browser provides `document.modelContext`, the page registers these tools once it has loaded:

| Tool | Arguments | What it does |
| --- | --- | --- |
| `get_configuration` | none | The current model, options, program, view and switches, and every value each of them accepts |
| `select_model` | `model` | Builds another model in place (takes a few seconds) |
| `set_options` | any of `paint` `finish` `wheel` `rim` `caliper` `wing` `kit` `livery` `cabin` | Changes the configuration |
| `set_view` | `view` | Moves the camera: `front` `side` `rear` `top` `wheel` `cabin` `driver` `chase` |
| `run_program` | `program` | `park` `cruise` `corner` `brake`: stops the car in the studio, or drives it on the night circuit |
| `set_feature` | `feature`, `on` | Switches `doors` `wing` `lights` `parts_store` `airflow` `turntable` |

Each tool answers with the resulting state as JSON.

## Work the page without tools

Every control is a button with a stable attribute, and its state is in `aria-checked` or `aria-pressed`:

- Model: `[data-model="g8"]`
- Option: `[data-opt="paint"][data-val="lava"]` (options sit in the panel's tabs; show a tab first with `[data-tab="paint"]`, tabs are `style` `paint` `wheels` `kit` `livery` `cabin`)
- Preset: `[data-preset="0"]`
- Program: `[data-pose="cruise"]` (`park` `cruise` `corner` `brake` `free`)
- View: `[data-view="side"]`
- Switch: `[data-toggle="doors"]` (`doors` `wing` `lights` `explode` `aero` `sound` `turntable` `panel`)

Wait until `<body>` has the class `is-ready` before acting. While it has `is-switching` another model is being built and the controls do nothing. The result is only visible in the canvas, so take a screenshot to see it. Free driving (`free`) is driven by hand with the keyboard: `W` `A` `S` `D`, `Space`, `Esc` to leave.
