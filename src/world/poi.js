// Points of interest on a planet: ancient ruins, crash sites, abandoned
// outposts, nomad camps, monoliths, giant fossils and crystal groves.
// Placement is deterministic from the planet seed; a couple are always
// within walking/short-hop distance of the landing area.
import { RNG } from '../core/rng.js';

// Which kinds suit which worlds (weights).
const BY_TYPE = {
  life: { ruins: 3, crash: 2, outpost: 2, camp: 3, monolith: 1, fossil: 2, crystals: 1 },
  desert: { ruins: 4, crash: 2, outpost: 2, camp: 2, monolith: 1, fossil: 3, crystals: 1 },
  ice: { ruins: 1, crash: 3, outpost: 3, monolith: 1, fossil: 2, crystals: 3 },
  hot: { crash: 2, outpost: 2, monolith: 2, crystals: 4, ruins: 1 },
  bare: { crash: 3, outpost: 3, monolith: 2, crystals: 3, ruins: 1 },
};

export const POI_FLAT = { ruins: 34, camp: 30, outpost: 28, monolith: 22, fossil: 30, crash: 24, crystals: 18 };

function profile(def) {
  const t = def.type;
  if (t === 'desert') return BY_TYPE.desert;
  if (t === 'ice' || t === 'supercold') return BY_TYPE.ice;
  if (t === 'lava' || t === 'superhot' || t === 'radioactive' || t === 'electric') return BY_TYPE.hot;
  if (!def.atmosphere || t === 'barren' || t === 'crystal') return BY_TYPE.bare;
  return BY_TYPE.life;
}

function randomDir(rng, near, maxAngle) {
  if (!near) {
    const y = rng.range(-0.7, 0.7), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - y * y);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  }
  const [nx, ny, nz] = near;
  let tx = -nz, ty = 0, tz = nx;
  if (Math.abs(ny) > 0.9) { tx = 1; tz = 0; }
  const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const a = rng.range(0, Math.PI * 2), d = rng.range(0.35, 1) * maxAngle;
  const x = nx + (tx * Math.cos(a) + bx * Math.sin(a)) * d, y = ny + (ty * Math.cos(a) + by * Math.sin(a)) * d, z = nz + (tz * Math.cos(a) + bz * Math.sin(a)) * d;
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
}

// Returns [{ id, kind, dir, height, heading, seed }] and flattens the ground
// under structures. `avoid` is a list of { dir, radius } (city, pads).
export function planPOIs(surface, def, { near = null, avoid = [], count = 9 } = {}) {
  const rng = new RNG((def.seed ^ 0x5eed) >>> 0);
  const weights = profile(def);
  const kinds = Object.entries(weights);
  const R = def.radius;
  const out = [];
  const angDist = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * R;
  for (let i = 0, tries = 0; out.length < count && tries < count * 60; tries++) {
    // The first two sit 0.7-2.5 km from the landing area.
    const close = near && out.length < 2;
    const dir = randomDir(rng, close ? near : null, close ? 2500 / R : 0);
    const h = surface.rawHeight(...dir);
    if (def.ocean && h < 4) continue;
    if (surface.slopeAtRaw(...dir, 30) > 0.35) continue;
    if (avoid.some((a) => angDist(a.dir, dir) < a.radius)) continue;
    if (out.some((p) => angDist(p.dir, dir) < 900)) continue;
    let total = 0;
    for (const [, w] of kinds) total += w;
    let r = rng.next() * total, kind = kinds[0][0];
    for (const [k, w] of kinds) { r -= w; if (r <= 0) { kind = k; break; } }
    // Keep the first finds varied: a structure and a wreck.
    if (close) kind = out.length === 0 ? (weights.ruins ? 'ruins' : 'outpost') : 'crash';
    const p = { id: `${def.id}/poi${i++}`, kind, dir, height: h, heading: rng.range(0, Math.PI * 2), seed: (rng.next() * 1e9) | 0 };
    const flat = POI_FLAT[kind];
    if (flat) surface.addFlatZone(dir, flat, h, flat * 1.4, { clear: true });
    out.push(p);
  }
  return out;
}
