// The models' figures and the configurator's options as JSON, read from src/: build_site.py puts them in the
// spec sheets and option tables of the site's pages, so those cannot drift from the app.
// usage: node tools/specs.js
const fs = require('fs'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const MODELS = new Function(src('blk_models.js') + '\nreturn MODELS;')();
// the option lists are plain data in car.js, between these two lines
const lists = src('car.js').match(/^const PAINTS = [\s\S]*?(?=^\/\/ the model the page opens with)/m);
if (!lists) throw new Error('option lists not found in src/car.js');
const O = new Function(lists[0] + '\nreturn { paint: PAINTS, finish: FINISHES, wheel: WHEELS, rim: RIMS, caliper: CALIPERS, wing: WINGS, kit: KITS, livery: LIVERIES, cabin: CABINS };')();
const options = Object.fromEntries(Object.entries(O).map(([k, list]) => [k, list.map((o) => ({ id: o.id, name: o.name }))]));
const r = (v, n = 0) => +v.toFixed(n);
const models = MODELS.map((m) => {
  const p = m.power, c = m.chassis, wb = m.axles[0].x - m.axles[1].x;
  // peak torque off the torque curve (Nm against rpm)
  const nm = p.torque.slice().sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return {
    id: m.id, name: m.name, tag: m.tag, electric: p.type === 'ev',
    cylinders: m.mech.engine ? m.mech.engine.n : 0, vee: m.mech.engine ? m.mech.engine.v : 0,
    nm: nm[1], nmRpm: nm[0], redline: p.redline,
    gears: p.gearTop.length - 1, awd: !!c.awd, vmax: p.vcap,
    mass: c.m, front: r(100 * (1 - c.a / wb)), cgHeight: r(c.h * 1000),
    length: r((m.body.XF - m.body.XR) * 1000), wheelbase: r(wb * 1000),
    tyre: m.tyre[1].replace(/\s+/g, ' '),
    presets: m.presets.map((s) => s.name), first: m.presets[0],
  };
});
process.stdout.write(JSON.stringify({ models, options }, null, 1) + '\n');
