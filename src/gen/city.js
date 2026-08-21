/**
 * Procedural cities (§21).
 *
 * A city is a road graph plus typed buildings. Layout style comes from the
 * owning civilization's architecture rules, so a Koth hive city and a Vessarid
 * spire city are laid out by different logic, not just tinted differently.
 *
 * Coordinates are local metres on the planet's tangent plane at the city site;
 * the renderer lifts them onto the sphere.
 */
import { RNG, hashInts } from '../core/rng.js';
import { CIV_BY_ID } from './civ.js';

/** Building types the NPC schedule system expects to find. */
export const BUILDING_TYPES = [
  'home', 'market', 'workshop', 'lab', 'hospital', 'spaceport',
  'farm', 'factory', 'gate', 'restaurant', 'plaza', 'hotel', 'storage',
];

/** Guaranteed civic buildings, in build order. */
const CIVIC_PLAN = [
  { type: 'spaceport', count: 1, size: [40, 70] },
  { type: 'plaza', count: 1, size: [25, 45] },
  { type: 'market', count: 2, size: [16, 28] },
  { type: 'workshop', count: 2, size: [12, 22] },
  { type: 'lab', count: 2, size: [14, 26] },
  { type: 'hospital', count: 1, size: [18, 30] },
  { type: 'restaurant', count: 2, size: [10, 18] },
  { type: 'hotel', count: 1, size: [14, 24] },
  { type: 'factory', count: 2, size: [22, 40] },
  { type: 'farm', count: 2, size: [30, 60] },
  { type: 'storage', count: 2, size: [16, 26] },
  { type: 'gate', count: 2, size: [8, 14] },
];

/**
 * Build a city layout.
 * @param {object} poi the city point-of-interest from PlanetSurface
 * @param {object} planet planet record
 */
export function generateCity(poi, planet) {
  const seed = hashInts(planet.seed, 0xC17, Math.round(poi.dir.x * 1e4));
  const rng = new RNG(seed);
  const civ = CIV_BY_ID[poi.civilization] || CIV_BY_ID.concord;
  const arch = civ.architecture;

  const radius = poi.radius || 500;
  const buildings = [];
  const roads = [];
  let nextId = 0;

  const place = (type, x, z, w, d, h) => {
    const b = {
      id: `b${nextId++}`,
      type,
      x, z,
      width: +w.toFixed(1),
      depth: +d.toFixed(1),
      height: +h.toFixed(1),
      rotation: 0,
      // Style flags the mesh builder reads.
      style: arch.style,
      lit: arch.roofLights && rng.chance(0.8),
      tier: rng.next(),
    };
    buildings.push(b);
    return b;
  };

  const occupied = [];
  const fits = (x, z, w, d) => {
    for (const o of occupied) {
      if (Math.abs(x - o.x) < (w + o.w) * 0.5 + 6 && Math.abs(z - o.z) < (d + o.d) * 0.5 + 6) return false;
    }
    return true;
  };
  const claim = (x, z, w, d) => occupied.push({ x, z, w, d });

  /*
   * Road network. Radial cities (spire, monolith) get ring + spoke roads;
   * everything else gets an irregular grid. The road graph is what building
   * placement snaps to, so cities read as planned rather than scattered.
   */
  const radial = arch.style === 'spire' || arch.style === 'monolith' || arch.style === 'suspended';
  if (radial) {
    const spokes = rng.int(5, 9);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      roads.push({ kind: 'spoke', angle: a, from: 0, to: radius, width: rng.range(7, 12) });
    }
    const rings = rng.int(2, 4);
    for (let i = 1; i <= rings; i++) {
      roads.push({ kind: 'ring', radius: (i / (rings + 1)) * radius, width: rng.range(6, 10) });
    }
  } else {
    const spacing = rng.range(55, 95);
    const n = Math.ceil((radius * 2) / spacing);
    for (let i = 0; i <= n; i++) {
      const o = -radius + i * spacing;
      roads.push({ kind: 'x', offset: o, width: rng.range(6, 11) });
      roads.push({ kind: 'z', offset: o, width: rng.range(6, 11) });
    }
  }

  // Civic core, placed near the centre along the road network.
  let ring = 0;
  for (const plan of CIVIC_PLAN) {
    for (let c = 0; c < plan.count; c++) {
      let placed = false;
      for (let attempt = 0; attempt < 60 && !placed; attempt++) {
        const dist = (plan.type === 'spaceport' ? 0.62 : plan.type === 'plaza' ? 0.08 : 0.15 + ring * 0.045)
          * radius * rng.range(0.75, 1.3);
        const a = rng.range(0, Math.PI * 2);
        const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
        const w = rng.range(plan.size[0], plan.size[1]);
        const d = rng.range(plan.size[0], plan.size[1]);
        if (Math.hypot(x, z) > radius * 0.95 || !fits(x, z, w, d)) continue;
        const h = plan.type === 'spaceport' || plan.type === 'farm'
          ? rng.range(6, 14)
          : rng.range(arch.height[0], arch.height[1]) * 0.55;
        const b = place(plan.type, x, z, w, d, h);
        b.rotation = radial ? Math.atan2(z, x) : rng.pick([0, Math.PI / 2]);
        claim(x, z, w, d);
        placed = true;
      }
      ring++;
    }
  }

  // Housing fills the remainder at the civilization's density.
  const area = Math.PI * radius * radius;
  const homeTarget = Math.min(420, Math.floor((area / 9000) * arch.density));
  for (let i = 0; i < homeTarget * 3 && buildings.filter((b) => b.type === 'home').length < homeTarget; i++) {
    const a = rng.range(0, Math.PI * 2);
    const dist = Math.sqrt(rng.next()) * radius * 0.96;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const w = rng.range(arch.footprint[0], arch.footprint[1]);
    const d = rng.range(arch.footprint[0], arch.footprint[1]);
    if (!fits(x, z, w, d)) continue;
    // Height falls off from the centre — downtown is tall, outskirts are low.
    const centrality = 1 - dist / radius;
    const h = rng.range(arch.height[0], arch.height[1]) * (0.35 + centrality * 0.9);
    const b = place('home', x, z, w, d, h);
    b.rotation = radial ? Math.atan2(z, x) : rng.pick([0, Math.PI / 2]);
    claim(x, z, w, d);
  }

  // Landing pads at the spaceport.
  const port = buildings.find((b) => b.type === 'spaceport');
  const pads = [];
  if (port) {
    const padCount = rng.int(2, 5);
    for (let i = 0; i < padCount; i++) {
      const a = (i / padCount) * Math.PI * 2;
      pads.push({
        x: port.x + Math.cos(a) * rng.range(40, 75),
        z: port.z + Math.sin(a) * rng.range(40, 75),
        radius: rng.range(12, 20),
        occupied: rng.chance(0.35),
      });
    }
  }

  return {
    seed,
    name: poi.name,
    civilization: poi.civilization,
    dir: poi.dir,
    radius,
    population: poi.population,
    style: arch.style,
    color: arch.color,
    accent: arch.accent,
    buildings,
    roads,
    pads,
    // How many NPCs to instantiate at once; the rest of the population is
    // statistical until you get close enough to meet them.
    npcBudget: Math.min(160, Math.max(24, Math.floor(poi.population / 260))),
  };
}
