/* =========================================================================
   AGENTS — the page's controls offered as tools to an agent working in the
   browser (WebMCP), where the browser has it. Each tool does what the
   matching button does and answers with the state that results.
   ========================================================================= */
const OPTIONS = { paint: PAINTS, finish: FINISHES, wheel: WHEELS, rim: RIMS, caliper: CALIPERS, wing: WINGS, kit: KITS, livery: LIVERIES, cabin: CABINS };
const AGENT_VIEWS = ['front', 'side', 'rear', 'top', 'wheel', 'cabin', 'driver', 'chase'];
const AGENT_PROGRAMS = ['park', 'cruise', 'corner', 'brake'];
const AGENT_FEATURES = {
  doors: [() => state.doors, setDoors], wing: [() => state.wingUp, setWingUp], lights: [() => state.lights, setLights],
  parts_store: [() => state.explode, setExplode], airflow: [() => AERO.on, setAero], turntable: [() => state.turntable, setTurntable],
};
function agentState(choices) {
  const s = {
    model: state.model, options: Object.fromEntries(CONFIG_KEYS.map((k) => [k, state[k]])),
    program: state.pose, view: state.view, speed_kmh: Math.round(DRIVE.v * 3.6),
    features: Object.fromEntries(Object.entries(AGENT_FEATURES).map(([k, f]) => [k, !!f[0]()])),
  };
  if (choices) s.choices = {
    model: MODELS.map((m) => ({ id: m.id, name: 'Halcyon ' + m.name, powertrain: m.tag })),
    options: Object.fromEntries(Object.entries(OPTIONS).map(([k, list]) => [k, list.map((o) => ({ id: o.id, name: o.name }))])),
    program: AGENT_PROGRAMS, view: AGENT_VIEWS, feature: Object.keys(AGENT_FEATURES),
  };
  return s;
}
const AGENT_TOOLS = [
  {
    name: 'get_configuration',
    description: 'The car shown now: model, paint and other options, driving program, camera view and switches, with every value each of them accepts.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
    run: () => agentState(true),
  },
  {
    name: 'select_model',
    description: 'Show another model of the range: h9 (mid-engine V12 hypercar), g8 (front-engine supercharged V8 grand tourer), e4 (electric hypercar), r10 (V10 track car). The car is rebuilt in place, which takes a few seconds.',
    inputSchema: { type: 'object', properties: { model: { type: 'string', enum: MODELS.map((m) => m.id) } }, required: ['model'] },
    run: async ({ model }) => { if (!MODELS.some((m) => m.id === model)) throw new Error('unknown model: ' + model); await setModel(model); return agentState(false); },
  },
  {
    name: 'set_options',
    description: 'Change the configuration of the car shown: paint colour and finish, wheel design, rim finish, caliper colour, wing, aero kit, livery, cabin trim. Give only what should change.',
    inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(OPTIONS).map(([k, list]) => [k, { type: 'string', enum: list.map((o) => o.id) }])) },
    run: (args) => {
      const set = Object.entries(args || {}).filter(([k]) => OPTIONS[k]);
      for (const [k, v] of set) if (!OPTIONS[k].some((o) => o.id === v)) throw new Error(`unknown ${k}: ${v}`);
      for (const [k, v] of set) setOption(k, v);
      return agentState(false);
    },
  },
  {
    name: 'set_view',
    description: 'Move the camera to a view of the car: front, side, rear or top; wheel (a front wheel, close); cabin (the interior); driver (from the driver\'s seat); chase (behind the car, following it).',
    inputSchema: { type: 'object', properties: { view: { type: 'string', enum: AGENT_VIEWS } }, required: ['view'] },
    run: ({ view }) => { if (!AGENT_VIEWS.includes(view)) throw new Error('unknown view: ' + view); setTurntable(false); goView(view); return agentState(false); },
  },
  {
    name: 'run_program',
    description: 'Start a driving program on the night circuit, or stop it: cruise (launch, then top speed), corner (fast bends at the limit of grip), brake (maximum braking into a hairpin), park (back to the studio, at rest).',
    inputSchema: { type: 'object', properties: { program: { type: 'string', enum: AGENT_PROGRAMS } }, required: ['program'] },
    run: ({ program }) => { if (!AGENT_PROGRAMS.includes(program)) throw new Error('unknown program: ' + program); setPose(program); syncUI(); return agentState(false); },
  },
  {
    name: 'set_feature',
    description: 'Switch something on the car or in the studio on or off: doors (open), wing (raised), lights, parts_store (the parked car taken apart and laid out on the floor), airflow (the wind tunnel view), turntable (the camera circling the car).',
    inputSchema: { type: 'object', properties: { feature: { type: 'string', enum: Object.keys(AGENT_FEATURES) }, on: { type: 'boolean' } }, required: ['feature', 'on'] },
    run: async ({ feature, on }) => { const f = AGENT_FEATURES[feature]; if (!f) throw new Error('unknown feature: ' + feature); if (!!f[0]() !== !!on) await f[1](!!on); syncUI(); return agentState(false); },
  },
];
function registerAgentTools() {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return;
  for (const t of AGENT_TOOLS) {
    const tool = {
      name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations,
      // (nothing is switched while another model is being built)
      execute: async (args) => {
        if (switching) throw new Error('another model is being built: try again in a few seconds');
        return { content: [{ type: 'text', text: JSON.stringify(await t.run(args || {})) }] };
      },
    };
    try { const r = mc.registerTool(tool); if (r && r.catch) r.catch(() => {}); } catch (e) { /* a browser with another draft of the interface */ }
  }
}
