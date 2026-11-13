// Drives the free-driving vehicle model without a browser: every model through standing starts, stops, steady and
// sudden cornering, a handbrake turn, a full throttle exit, and a lap of the map by the built-in driver.
// usage: node tools/sim.js [car id ...] [--lap] [--trace=name]
const fs = require('fs'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const shim = `
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
let _seed = 20261102;
const rand = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const state = { wing: 'gt', kit: 'track', wingUp: true, pose: 'free', lights: true };
let wingDeploy = 1, SPEC = null, AX, XF, XR, WBASE;
const XPL = { any: false }, WORLD = { mix: 1 };
`;
const runner = fs.readFileSync(path.join(__dirname, 'sim_run.js'), 'utf8');
const code = [shim, src('blk_models.js'), src('blk_track.js'), src('blk_drive.js'), src('blk_landgen.js'), src('blk_dyn.js'), runner].join('\n');
new Function('ARGV', 'console', code)(process.argv.slice(2), console);
