/**
 * Procedural creature generator (§17, §18, §71, §72).
 *
 * A creature is a set of numbers — limb count, mass, sensory layout, diet,
 * intelligence — from which both the renderer and the AI read. Nothing is
 * hand-authored per species, but the numbers are constrained by the planet
 * they evolved on: high gravity produces squat heavy-boned animals, thin air
 * produces huge lungs and slow metabolisms, dark worlds produce more eyes.
 */
import { RNG, hashInts } from '../core/rng.js';
import { makeWord } from './names.js';
import { BIOMES } from './planet.js';

export const DIETS = ['photosynth', 'herbivore', 'omnivore', 'carnivore', 'apex', 'scavenger', 'filter'];

/** Where a creature lives — decides which chunks may spawn it. */
export const HABITATS = ['ground', 'air', 'water', 'underground', 'space'];

export const BODY_PLANS = {
  quadruped:   { legs: 4, weight: 1.0 },
  biped:       { legs: 2, weight: 0.5 },
  hexapod:     { legs: 6, weight: 0.7 },
  octoped:     { legs: 8, weight: 0.4 },
  serpentine:  { legs: 0, weight: 0.5 },
  floater:     { legs: 0, weight: 0.3 },
  radial:      { legs: 5, weight: 0.25 },
  colonial:    { legs: 0, weight: 0.15 },
};

const SKINS = ['scaled', 'furred', 'chitinous', 'plated', 'membranous', 'crystalline', 'fungal', 'smooth', 'feathered'];

/**
 * Size classes. `giant` and `titan` are the §72 creatures you can see from a
 * long way off and whose dens are worth finding.
 */
const SIZE_CLASSES = [
  { id: 'tiny',   height: [0.05, 0.4],  weight: 26 },
  { id: 'small',  height: [0.4, 1.2],   weight: 30 },
  { id: 'medium', height: [1.2, 2.8],   weight: 22 },
  { id: 'large',  height: [2.8, 7],     weight: 14 },
  { id: 'giant',  height: [7, 22],      weight: 6 },
  { id: 'titan',  height: [22, 120],    weight: 2 },
];

/**
 * Generate one species for a planet.
 * @param {number} seed
 * @param {object} planet planet record
 * @param {object} [opts] {habitat, diet, sizeBias}
 */
export function generateCreature(seed, planet, opts = {}) {
  const rng = new RNG(seed);
  const g = planet.gravity || 9.8;
  const gravityRatio = g / 9.8;
  const thinAir = (planet.atmosphere || 1) < 0.5;
  const dark = (planet.surfaceTemp || 280) < 200 || planet.class === 'bioluminescent';

  const habitat = opts.habitat || rng.weighted([
    ['ground', 0.55], ['air', planet.atmosphere > 0.5 ? 0.18 : 0.02],
    ['water', planet.water > 0.15 ? 0.2 : 0.01], ['underground', 0.12],
  ]);

  const diet = opts.diet || rng.weighted([
    ['herbivore', 0.34], ['omnivore', 0.2], ['carnivore', 0.18],
    ['scavenger', 0.1], ['apex', 0.06], ['filter', habitat === 'water' ? 0.12 : 0.02],
  ]);

  // Heavy worlds cap body size; predators skew larger than their prey.
  const sizeWeights = SIZE_CLASSES.map((sc) => {
    let w = sc.weight;
    w *= Math.pow(1 / gravityRatio, ['giant', 'titan'].includes(sc.id) ? 1.6 : 0.4);
    if (diet === 'apex') w *= sc.id === 'large' || sc.id === 'giant' ? 3 : 0.5;
    if (diet === 'filter' && sc.id === 'titan') w *= 4;
    if (opts.sizeBias) w *= (opts.sizeBias[sc.id] || 1);
    return [sc, w];
  });
  const sizeClass = rng.weighted(sizeWeights);
  const height = rng.range(sizeClass.height[0], sizeClass.height[1]);

  const plan = rng.weighted(
    Object.entries(BODY_PLANS).map(([k, v]) => {
      let w = v.weight;
      if (habitat === 'water') w = k === 'serpentine' || k === 'radial' || k === 'floater' ? w * 3 : w * 0.4;
      if (habitat === 'air') w = k === 'floater' || k === 'biped' ? w * 3 : w * 0.3;
      if (gravityRatio > 1.6) w = k === 'hexapod' || k === 'octoped' || k === 'quadruped' ? w * 2 : w * 0.5;
      return [k, w];
    })
  );

  // Mass from height with an allometric exponent, adjusted for build.
  const build = rng.range(0.7, 1.4) * (gravityRatio > 1.4 ? 1.25 : 1);
  const mass = +(Math.pow(height, 2.6) * 22 * build).toFixed(1);

  const wings = habitat === 'air' ? rng.int(2, 4) : rng.chance(0.12) ? 2 : 0;
  const eyes = dark ? rng.weighted([[0, 0.1], [2, 0.2], [4, 0.3], [6, 0.25], [8, 0.15]])
                    : rng.weighted([[2, 0.55], [1, 0.1], [3, 0.1], [4, 0.2], [6, 0.05]]);

  // Intelligence: rare, and the gate for the §18 tool-using species.
  const intelligence = rng.weighted([
    [rng.range(0.05, 0.3), 0.55],
    [rng.range(0.3, 0.6), 0.32],
    [rng.range(0.6, 0.85), 0.11],
    [rng.range(0.85, 1.0), 0.02],
  ]);

  const speed = +(rng.range(1.5, 9) * (habitat === 'air' ? 2.2 : 1) * Math.pow(1 / gravityRatio, 0.4)
    * (sizeClass.id === 'titan' ? 0.4 : sizeClass.id === 'tiny' ? 0.7 : 1)).toFixed(2);

  const aggression = diet === 'apex' ? rng.range(0.6, 1)
    : diet === 'carnivore' ? rng.range(0.4, 0.9)
    : diet === 'scavenger' ? rng.range(0.15, 0.5)
    : rng.range(0.02, 0.35);

  const skin = rng.weighted([
    ['scaled', 1], ['furred', planet.surfaceTemp < 270 ? 2.5 : 0.5], ['chitinous', 1.2],
    ['plated', gravityRatio > 1.3 ? 2 : 0.8], ['membranous', habitat === 'air' ? 2 : 0.4],
    ['crystalline', planet.class === 'crystalline' ? 4 : 0.15],
    ['fungal', planet.class === 'fungal' ? 4 : 0.2], ['smooth', habitat === 'water' ? 2.5 : 0.6],
    ['feathered', habitat === 'air' ? 1.5 : 0.3],
  ]);

  const hue = rng.next();
  const sat = planet.class === 'bioluminescent' ? rng.range(0.5, 0.95) : rng.range(0.15, 0.7);
  const lum = rng.range(0.25, 0.7);
  const glows = planet.class === 'bioluminescent' ? rng.chance(0.8) : rng.chance(0.08);

  return {
    id: `sp_${seed >>> 0}`,
    seed,
    name: makeWord(rng, rng.pick(['koth', 'mirreleth', 'vessarid', 'terran']), rng.int(2, 3)),
    planetSeed: planet.seed,
    habitat,
    diet,
    sizeClass: sizeClass.id,
    height: +height.toFixed(2),
    mass,
    bodyPlan: plan,
    legs: BODY_PLANS[plan].legs,
    wings,
    eyes,
    tail: rng.chance(0.6),
    horns: rng.chance(0.3) ? rng.int(1, 4) : 0,
    armour: skin === 'plated' || skin === 'chitinous' ? rng.range(0.4, 1) : rng.range(0, 0.35),
    skin,
    headSize: +rng.range(0.12, 0.42).toFixed(2),
    color: [hue, sat, lum],
    glows,
    glowColor: glows ? [rng.next(), 0.9, 0.6] : null,
    speed,
    intelligence: +intelligence.toFixed(2),
    aggression: +aggression.toFixed(2),
    social: +rng.range(0, 1).toFixed(2),
    herdSize: rng.weighted([[1, 0.35], [rng.int(2, 6), 0.4], [rng.int(7, 24), 0.2], [rng.int(25, 90), 0.05]]),
    // Thin air -> slow metabolism -> long lives, low reproduction.
    metabolism: +(thinAir ? rng.range(0.3, 0.7) : rng.range(0.6, 1.4)).toFixed(2),
    // Discovery/scan value scales with rarity.
    scanValue: Math.round((40 + intelligence * 300 + (sizeClass.id === 'titan' ? 600 : 0)) * rng.range(0.8, 1.3)),
    toolUser: intelligence > 0.72,
    discovered: false,
    named: null,          // player-assigned name once scanned
  };
}

/**
 * A planet's full species list plus the food chain that links them (§16).
 * Producers feed herbivores, herbivores feed carnivores, carnivores feed apex
 * predators, and everything feeds scavengers.
 */
export function generateFauna(planet, count = 0) {
  const rng = new RNG(hashInts(planet.seed, 0xFA))
  const biomeFauna = planet.gasGiant ? 0.3 : 1;
  const habitability = planet.habitable ? 1 : 0.45;
  const n = count || Math.max(0, Math.round(rng.range(4, 14) * biomeFauna * habitability));

  const species = [];
  // Seed the chain deliberately so every world has a working food web rather
  // than, say, twelve apex predators and nothing to eat.
  const plan = [];
  plan.push({ diet: 'herbivore' }, { diet: 'herbivore' });
  if (n > 3) plan.push({ diet: 'carnivore' });
  if (n > 5) plan.push({ diet: 'omnivore' }, { diet: 'scavenger' });
  if (n > 7) plan.push({ diet: 'apex' });
  while (plan.length < n) plan.push({});

  for (let i = 0; i < n; i++) {
    species.push(generateCreature(hashInts(planet.seed, 0xC0 + i), planet, plan[i] || {}));
  }
  return species;
}

/** Which biomes a species will actually be spawned in. */
export function habitatBiomes(species) {
  const out = [];
  for (const [id, b] of Object.entries(BIOMES)) {
    if (species.habitat === 'water' && b.material !== 'water' && b.material !== 'liquid') continue;
    if (species.habitat !== 'water' && (b.material === 'water' || b.material === 'lava')) continue;
    if (b.fauna <= 0.05) continue;
    out.push(id);
  }
  return out;
}

/**
 * Procedural flora (§121 wants 20 plants on the first world). Plants are
 * simpler than animals but still drive the ecosystem's producer tier.
 */
export function generateFlora(planet, count = 0) {
  const rng = new RNG(hashInts(planet.seed, 0xF10));
  const n = count || (planet.gasGiant ? 0 : rng.int(8, 22));
  const out = [];
  // Form is chosen first and height follows from it — picking them
  // independently produced 39-metre grass.
  const FORMS = {
    tree:            { height: [3, 45], weightBase: 1.6 },
    shrub:           { height: [0.4, 2.5], weightBase: 2 },
    grass:           { height: [0.1, 1.4], weightBase: 2.5 },
    fungus:          { height: [0.2, 9], weightBase: 0.7 },
    crystal_growth:  { height: [0.5, 12], weightBase: 0.1 },
    vine:            { height: [1, 20], weightBase: 1 },
    pod:             { height: [0.3, 3], weightBase: 0.8 },
  };
  for (let i = 0; i < n; i++) {
    const r = new RNG(hashInts(planet.seed, 0xF20 + i));
    const form = r.weighted(Object.entries(FORMS).map(([k, v]) => {
      let w = v.weightBase;
      if (k === 'fungus' && planet.class === 'fungal') w = 5;
      if (k === 'crystal_growth' && planet.class === 'crystalline') w = 5;
      if (k === 'tree' && planet.water < 0.1) w = 0.3;
      return [k, w];
    }));
    const span = FORMS[form].height;
    // Low gravity lets everything grow taller (§11).
    const gravityStretch = Math.min(2.2, Math.max(0.6, 9.8 / (planet.gravity || 9.8)));
    const height = r.range(span[0], span[1]) * gravityStretch;
    out.push({
      id: `fl_${i}_${planet.seed >>> 0}`,
      name: makeWord(r, r.pick(['mirreleth', 'terran', 'vessarid']), 2),
      form,
      height: +height.toFixed(2),
      color: [r.next(), r.range(0.2, 0.85), r.range(0.2, 0.6)],
      glows: planet.class === 'bioluminescent' ? r.chance(0.75) : r.chance(0.05),
      edible: r.chance(0.4),
      medicinal: r.chance(0.18),
      toxic: r.chance(0.2),
      harvest: r.pick(['carbon', 'biomass', 'biomass', 'luminite']),
      scanValue: r.int(15, 120),
      discovered: false,
    });
  }
  return out;
}
