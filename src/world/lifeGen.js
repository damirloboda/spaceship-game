// Procedural creature and plant species. Each planet gets its own biosphere
// organised as a food chain: plants -> herbivores -> predators -> apex.
import { RNG, makeName, clamp } from '../core/rng.js';

const CREATURE_SYL = {
  start: ['gro', 'ska', 'vul', 'mo', 'thr', 'bra', 'lu', 'ki', 'sna', 'pel', 'dro', 'fen', 'ow', 'ze', 'hu'],
  mid: ['ra', 'ba', 'ti', 'lo', 'mu', 'ke', 'za'],
  end: ['ox', 'ling', 'mander', 'pod', 'wing', 'back', 'sk', 'ard', 'ith', 'or', 'une', 'aloo'],
};
const PLANT_SYL = {
  start: ['ver', 'lum', 'fi', 'cae', 'mos', 'ser', 'or', 'thal', 'pho', 'myc', 'ari', 'bel'],
  mid: ['a', 'e', 'i', 'o', 'ul', 'en'],
  end: ['bloom', 'frond', 'cap', 'spire', 'vine', 'reed', 'thorn', 'shade', 'bulb', 'palm', 'moss', 'coral'],
};

const PALETTES = {
  terran: [[0.45, 0.35, 0.25], [0.6, 0.55, 0.4], [0.3, 0.3, 0.32], [0.7, 0.5, 0.3], [0.55, 0.4, 0.5]],
  alien: [[0.3, 0.6, 0.7], [0.75, 0.3, 0.4], [0.5, 0.7, 0.3], [0.8, 0.7, 0.2], [0.4, 0.3, 0.7]],
};

export const DIETS = ['herbivore', 'herbivore', 'herbivore', 'herbivore', 'omnivore', 'predator', 'predator', 'apex'];

export function generateFauna(planet, count = 10) {
  if (!planet.life) return [];
  const rng = new RNG(planet.seed ^ 0xfa11a);
  const species = [];
  const pal = planet.type === 'terran' || planet.type === 'ocean' ? PALETTES.terran : PALETTES.alien;
  for (let i = 0; i < count; i++) {
    const r = rng.fork(`sp${i}`);
    const diet = i < DIETS.length ? DIETS[i] : r.pick(DIETS);
    const flying = r.chance(diet === 'herbivore' ? 0.18 : 0.12);
    const giant = diet === 'apex' && r.chance(0.6);
    const size = giant ? r.range(6, 14) : diet === 'predator' ? r.range(1.2, 3.0) : r.range(0.4, 2.8);
    const legs = flying ? r.pick([0, 2]) : r.pick([2, 4, 4, 4, 6]);
    const skin = r.pick(pal).map((c) => clamp(c * r.range(0.7, 1.3), 0, 1));
    const accent = r.pick(PALETTES.alien).map((c) => clamp(c * r.range(0.8, 1.2), 0, 1));
    species.push({
      id: `${planet.id}/fauna${i}`,
      name: makeName(r.fork('n'), CREATURE_SYL, 0, 1),
      diet,
      tier: diet === 'herbivore' ? 1 : diet === 'omnivore' ? 2 : diet === 'predator' ? 3 : 4,
      size,
      mass: Math.round(size * size * size * r.range(40, 120)),
      bodyLength: r.range(1.1, 2.2),
      bodyHeight: r.range(0.6, 1.1),
      legs,
      legLength: r.range(0.5, 1.3),
      wings: flying || r.chance(0.08),
      flying,
      eyes: r.pick([1, 2, 2, 2, 3, 4, 6]),
      tail: r.chance(0.7) ? r.range(0.3, 1.2) : 0,
      horns: r.chance(diet === 'herbivore' ? 0.4 : 0.25) ? r.int(1, 3) : 0,
      shell: r.chance(0.2),
      skin,
      accent,
      glow: planet.type === 'bioluminescent' || r.chance(0.1),
      headSize: r.range(0.35, 0.7),
      neck: r.range(0, 0.8),
      speed: (diet === 'predator' ? r.range(7, 11) : r.range(3, 9)) * (flying ? 1.5 : 1),
      intelligence: diet === 'apex' ? r.range(0.4, 0.8) : r.range(0.05, 0.5),
      temperament: diet === 'herbivore' ? r.pick(['timid', 'timid', 'calm']) : r.pick(['territorial', 'aggressive', 'calm']),
      herd: diet === 'herbivore' ? r.int(2, 6) : diet === 'apex' ? 1 : r.int(1, 2),
      habitats: habitatsFor(planet.type, r),
      giant,
      population: 1,
    });
  }
  return species;
}

function habitatsFor(type, r) {
  const map = {
    terran: ['grassland', 'forest', 'savanna', 'wetland', 'tundra', 'beach'],
    ocean: ['beach', 'grassland', 'forest', 'wetland'],
    desert: ['desert', 'dunes', 'mesa'],
    ice: ['snow', 'ice', 'glacier'],
    toxic: ['mire', 'toxicflat'],
    fungal: ['fungal', 'sporefield', 'mire'],
    bioluminescent: ['glowmoss', 'forest', 'beach'],
    crystal: ['crystal', 'regolith'],
    electric: ['storm', 'basalt'],
  };
  const pool = map[type] || ['regolith', 'rock'];
  return r.shuffle(pool.slice()).slice(0, r.int(2, pool.length));
}

export const PLANT_FORMS = ['conifer', 'broadleaf', 'palm', 'mushroom', 'crystal', 'frond', 'bush', 'cactus', 'coral', 'bulb', 'spire', 'reed'];

const FORMS_BY_TYPE = {
  terran: ['conifer', 'broadleaf', 'broadleaf', 'palm', 'bush', 'bush', 'reed', 'frond'],
  ocean: ['palm', 'broadleaf', 'bush', 'reed', 'coral'],
  desert: ['cactus', 'bush', 'spire', 'bulb'],
  ice: ['conifer', 'crystal', 'bush', 'spire'],
  toxic: ['bulb', 'frond', 'mushroom', 'reed'],
  fungal: ['mushroom', 'mushroom', 'bulb', 'frond'],
  bioluminescent: ['mushroom', 'coral', 'frond', 'bulb', 'broadleaf'],
  crystal: ['crystal', 'crystal', 'spire'],
  electric: ['spire', 'crystal', 'bush'],
  lava: ['spire', 'bush'],
  radioactive: ['bulb', 'bush', 'spire'],
};

export function generateFlora(planet, count = 20) {
  const rng = new RNG(planet.seed ^ 0xf10a);
  const forms = FORMS_BY_TYPE[planet.type] || ['bush', 'spire', 'crystal'];
  const richness = planet.life ? 1 : 0.25;
  const n = Math.max(3, Math.round(count * (planet.life ? 1 : 0.3)));
  const species = [];
  for (let i = 0; i < n; i++) {
    const r = rng.fork(`fl${i}`);
    const form = forms[i % forms.length];
    const alien = planet.type !== 'terran' && planet.type !== 'ocean';
    const leaf = alien
      ? r.pick([[0.6, 0.2, 0.7], [0.2, 0.7, 0.8], [0.9, 0.5, 0.2], [0.3, 0.9, 0.5], [0.9, 0.3, 0.4]])
      : r.pick([[0.18, 0.42, 0.14], [0.25, 0.5, 0.18], [0.35, 0.45, 0.12], [0.12, 0.32, 0.12], [0.55, 0.45, 0.15]]);
    const tall = ['conifer', 'broadleaf', 'palm', 'spire', 'mushroom'].includes(form);
    species.push({
      id: `${planet.id}/flora${i}`,
      name: makeName(r.fork('n'), PLANT_SYL, 0, 1),
      form,
      height: tall ? r.range(4, 14) : r.range(0.6, 2.4),
      width: r.range(0.6, 1.4),
      trunk: r.pick([[0.3, 0.2, 0.12], [0.4, 0.3, 0.2], [0.25, 0.22, 0.2], [0.5, 0.45, 0.4]]),
      leaf: leaf.map((c) => clamp(c * r.range(0.8, 1.2), 0, 1)),
      glow: planet.type === 'bioluminescent' || form === 'crystal' ? r.range(0.3, 1) : 0,
      density: r.range(0.3, 1) * richness,
      collider: tall ? r.range(0.3, 0.8) : 0,
      biomes: null, // resolved at placement from the planet's biome list
      tier: 0,
      medicinal: r.chance(0.2),
    });
  }
  return species;
}
