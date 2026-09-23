// Procedural galaxy. Space is an infinite grid of sectors; each sector cell
// deterministically holds 0-3 star systems derived from the galaxy seed, so
// millions of systems exist without being stored anywhere.
import { RNG, hashInts, hashMix, makeName, clamp } from '../core/rng.js';

export const GALAXY_SEED = 0x51a7c05;
export const SECTOR_SIZE = 12; // light years per sector cell
export const HOME_SYSTEM_ID = 'home';
export const LY = 9.4607e15; // metres, only used for display

export const STAR_TYPES = {
  red_dwarf: { color: [1.0, 0.45, 0.3], temp: 3200, radius: 0.6, lum: 0.35, w: 30 },
  orange: { color: [1.0, 0.68, 0.42], temp: 4400, radius: 0.85, lum: 0.7, w: 20 },
  yellow: { color: [1.0, 0.93, 0.78], temp: 5800, radius: 1.0, lum: 1.0, w: 18 },
  white: { color: [0.95, 0.97, 1.0], temp: 7800, radius: 1.3, lum: 1.5, w: 10 },
  blue: { color: [0.62, 0.74, 1.0], temp: 15000, radius: 2.0, lum: 3.0, w: 5 },
  giant: { color: [1.0, 0.6, 0.35], temp: 4000, radius: 3.5, lum: 2.4, w: 5 },
  supergiant: { color: [1.0, 0.5, 0.4], temp: 3600, radius: 6.0, lum: 4.0, w: 2 },
  binary: { color: [1.0, 0.85, 0.7], temp: 5200, radius: 0.9, lum: 1.4, w: 6 },
  trinary: { color: [0.95, 0.9, 0.85], temp: 5600, radius: 0.8, lum: 1.7, w: 2 },
  unstable: { color: [0.8, 0.9, 1.0], temp: 9000, radius: 1.4, lum: 2.0, w: 1.5 },
  black_hole: { color: [0.0, 0.0, 0.0], temp: 0, radius: 0.5, lum: 0.0, w: 0.5 },
};

export const PLANET_TYPES = [
  'terran', 'ocean', 'desert', 'ice', 'lava', 'toxic', 'radioactive', 'electric',
  'fungal', 'crystal', 'bioluminescent', 'barren', 'cloud', 'superhot', 'supercold',
];

export const DANGER_LEVELS = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME', 'UNKNOWN'];

// Per-type physical and visual profile. Colours are linear-ish RGB triplets.
export const PLANET_PROFILES = {
  terran: { atmo: 1.0, breathable: true, ocean: true, life: 1.0, sky: [0.35, 0.58, 1.0], hazard: 0, weather: ['clear', 'cloudy', 'rain', 'storm'] },
  ocean: { atmo: 1.1, breathable: true, ocean: true, life: 0.9, sky: [0.3, 0.6, 1.0], hazard: 0, weather: ['clear', 'cloudy', 'rain', 'storm', 'hurricane'] },
  desert: { atmo: 0.7, breathable: false, ocean: false, life: 0.35, sky: [0.95, 0.7, 0.45], hazard: 1, weather: ['clear', 'sandstorm'] },
  ice: { atmo: 0.6, breathable: false, ocean: false, life: 0.3, sky: [0.6, 0.78, 1.0], hazard: 1, weather: ['clear', 'snow', 'blizzard', 'fog'] },
  lava: { atmo: 0.8, breathable: false, ocean: false, life: 0.05, sky: [1.0, 0.4, 0.2], hazard: 3, weather: ['clear', 'ash'] },
  toxic: { atmo: 1.4, breathable: false, ocean: true, life: 0.5, sky: [0.6, 0.95, 0.35], hazard: 2, weather: ['fog', 'acid_rain', 'clear'] },
  radioactive: { atmo: 0.6, breathable: false, ocean: false, life: 0.15, sky: [0.8, 0.95, 0.4], hazard: 3, weather: ['clear', 'storm'] },
  electric: { atmo: 1.0, breathable: false, ocean: false, life: 0.3, sky: [0.55, 0.45, 1.0], hazard: 2, weather: ['electric_storm', 'clear'] },
  fungal: { atmo: 1.1, breathable: true, ocean: true, life: 1.0, sky: [0.8, 0.55, 0.9], hazard: 1, weather: ['fog', 'rain', 'clear'] },
  crystal: { atmo: 0.5, breathable: false, ocean: false, life: 0.2, sky: [0.7, 0.9, 1.0], hazard: 1, weather: ['clear', 'storm'] },
  bioluminescent: { atmo: 0.9, breathable: true, ocean: true, life: 1.0, sky: [0.2, 0.3, 0.6], hazard: 1, weather: ['clear', 'fog', 'rain'] },
  barren: { atmo: 0.0, breathable: false, ocean: false, life: 0.0, sky: [0, 0, 0], hazard: 1, weather: ['clear'] },
  cloud: { atmo: 1.8, breathable: false, ocean: false, life: 0.2, sky: [0.9, 0.85, 0.75], hazard: 2, weather: ['storm', 'fog', 'clear'] },
  superhot: { atmo: 1.2, breathable: false, ocean: false, life: 0.0, sky: [1.0, 0.55, 0.3], hazard: 4, weather: ['ash', 'clear'] },
  supercold: { atmo: 0.4, breathable: false, ocean: false, life: 0.05, sky: [0.5, 0.7, 1.0], hazard: 3, weather: ['blizzard', 'clear'] },
};

function systemName(rng) {
  const name = makeName(rng, undefined, 0, 1);
  const suffix = rng.chance(0.35) ? `-${rng.int(2, 999)}` : rng.chance(0.3) ? ` ${['Prime', 'Major', 'Minor', 'Reach', 'Deep'][rng.int(0, 4)]}` : '';
  return name + suffix;
}

// Enumerate systems inside one sector cell.
export function sectorSystems(cx, cy, cz) {
  const h = hashInts(GALAXY_SEED, cx, cy, cz);
  const rng = new RNG(h);
  // Galactic disc: density falls off with |cy| and radius from the core.
  const r = Math.hypot(cx, cz) * SECTOR_SIZE;
  const density = clamp(1.4 - r / 4000, 0.25, 1.4) * clamp(1 - Math.abs(cy) / 6, 0, 1);
  const count = Math.floor(rng.next() * 2.4 * density + (rng.next() < density * 0.5 ? 1 : 0));
  const out = [];
  for (let n = 0; n < count; n++) {
    const id = `${cx}:${cy}:${cz}:${n}`;
    out.push({
      id,
      position: [
        (cx + rng.next()) * SECTOR_SIZE,
        (cy + rng.next()) * SECTOR_SIZE * 0.4,
        (cz + rng.next()) * SECTOR_SIZE,
      ],
    });
  }
  return out;
}

export const HOME_POSITION = [2.5 * SECTOR_SIZE, 0.2, 3.5 * SECTOR_SIZE];

// Lightweight descriptors for the galaxy map (no planets generated).
export function systemsNear(position, radiusLy) {
  const [px, py, pz] = position;
  const cr = Math.ceil(radiusLy / SECTOR_SIZE);
  const c0 = [Math.floor(px / SECTOR_SIZE), Math.floor(py / (SECTOR_SIZE * 0.4)), Math.floor(pz / SECTOR_SIZE)];
  const found = [];
  for (let x = -cr; x <= cr; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -cr; z <= cr; z++) {
        for (const s of sectorSystems(c0[0] + x, c0[1] + y, c0[2] + z)) {
          const d = Math.hypot(s.position[0] - px, s.position[1] - py, s.position[2] - pz);
          if (d <= radiusLy && d > 0.01) found.push({ ...summarizeSystem(s.id, s.position), distance: d });
        }
      }
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  return found;
}

export function systemPosition(id) {
  if (id === HOME_SYSTEM_ID) return HOME_POSITION.slice();
  const [cx, cy, cz, n] = id.split(':').map(Number);
  const s = sectorSystems(cx, cy, cz)[n];
  return s ? s.position : [cx * SECTOR_SIZE, cy * SECTOR_SIZE * 0.4, cz * SECTOR_SIZE];
}

function pickStarType(rng, id) {
  // Guarantee a black hole and a wormhole-bearing system close to home so the
  // first expedition can find them; everything else is weighted random.
  if (id === '2:0:4:0') return 'black_hole';
  const entries = Object.entries(STAR_TYPES).map(([v, s]) => ({ v, w: s.w }));
  return rng.weighted(entries);
}

export function summarizeSystem(id, position) {
  const seed = hashMix(GALAXY_SEED, id);
  const rng = new RNG(seed);
  const name = id === HOME_SYSTEM_ID ? 'Helion' : systemName(rng.fork('name'));
  const starType = id === HOME_SYSTEM_ID ? 'yellow' : pickStarType(rng.fork('star'), id);
  const planetCount = id === HOME_SYSTEM_ID ? 3 : starType === 'black_hole' ? rng.fork('pc').int(0, 2) : rng.fork('pc').int(1, 5);
  // Some regions do not resolve on the map: signal-dead zones.
  const unknownRegion = id !== HOME_SYSTEM_ID && rng.fork('unknown').chance(0.08);
  return { id, seed, name, starType, planetCount, position: position || systemPosition(id), unknownRegion };
}

// Full system: star, planets, moons, stations, anomalies.
export function generateSystem(id) {
  if (id === HOME_SYSTEM_ID) return homeSystem();
  const summary = summarizeSystem(id);
  const rng = new RNG(summary.seed);
  const star = makeStar(summary.starType, rng.fork('starprops'));
  const bodies = [];
  const orbitRng = rng.fork('orbits');
  let orbit = 2.6e6 * star.radiusScale + orbitRng.range(0, 1e6);
  for (let i = 0; i < summary.planetCount; i++) {
    orbit += orbitRng.range(1.2e6, 3.5e6);
    const planet = makePlanet(`${id}/p${i}`, rng.fork(`planet${i}`), star, orbit, i);
    bodies.push(planet);
    const moons = rng.fork(`moons${i}`).int(0, planet.radius > 14000 ? 2 : 1);
    for (let m = 0; m < moons; m++) {
      bodies.push(makeMoon(`${id}/p${i}m${m}`, rng.fork(`moon${i}-${m}`), planet, m));
    }
  }
  const anomalies = [];
  const aRng = rng.fork('anomalies');
  if (summary.starType === 'black_hole') {
    anomalies.push({ type: 'black_hole', id: `${id}/bh`, position: [0, 0, 0], radius: 9000, influence: 2.2e6 });
  }
  if (aRng.chance(0.22) || id === '3:0:3:0') {
    const ang = aRng.range(0, Math.PI * 2);
    const dist = aRng.range(2e6, 6e6);
    anomalies.push({
      type: 'wormhole', id: `${id}/wh`, position: [Math.cos(ang) * dist, aRng.range(-2e5, 2e5), Math.sin(ang) * dist],
      radius: 400, stability: aRng.range(0.3, 1), lifetime: aRng.range(600, 3600),
    });
  }
  if (aRng.chance(0.25)) {
    const ang = aRng.range(0, Math.PI * 2);
    anomalies.push({ type: 'derelict', id: `${id}/dr`, position: [Math.cos(ang) * 3e6, 1e5, Math.sin(ang) * 3e6], radius: 60 });
  }
  const hasStation = summary.starType !== 'black_hole' && rng.fork('station').chance(0.55) && bodies.length > 0;
  if (hasStation) bodies[0].station = { altitude: 16000 };
  return { ...summary, star, bodies, anomalies };
}

function makeStar(type, rng) {
  const t = STAR_TYPES[type];
  const companions = type === 'binary' ? 1 : type === 'trinary' ? 2 : 0;
  return {
    type,
    color: t.color,
    temperature: t.temp * rng.range(0.9, 1.1),
    radiusScale: t.radius,
    radius: 150000 * t.radius,
    luminosity: t.lum,
    companions: Array.from({ length: companions }, (_, i) => ({
      offset: [(i + 1) * 900000 * (i % 2 ? -1 : 1), rng.range(-2e5, 2e5), (i + 1) * 500000],
      radius: 150000 * t.radius * rng.range(0.4, 0.8),
      color: STAR_TYPES[rng.pick(['red_dwarf', 'orange', 'white'])].color,
    })),
    unstable: type === 'unstable',
  };
}

function planetTypeFor(rng, star, orbit) {
  // Equilibrium temperature proxy: hotter stars and closer orbits are hotter.
  const heat = (star.luminosity * 5.5e6) / orbit;
  const pool = heat > 2.4 ? ['lava', 'superhot', 'desert', 'radioactive']
    : heat > 1.4 ? ['desert', 'toxic', 'terran', 'electric', 'crystal', 'radioactive']
      : heat > 0.8 ? ['terran', 'ocean', 'fungal', 'bioluminescent', 'toxic', 'crystal', 'cloud']
        : heat > 0.45 ? ['ice', 'crystal', 'cloud', 'fungal', 'barren']
          : ['supercold', 'ice', 'barren', 'crystal'];
  return { type: rng.pick(pool), heat };
}

function dangerFrom(profile, heat, rng) {
  let level = profile.hazard + (rng.chance(0.25) ? 1 : 0);
  if (rng.chance(0.06)) return 'UNKNOWN';
  level = clamp(level, 0, 4);
  return DANGER_LEVELS[level];
}

export function makePlanet(id, rng, star, orbit, index) {
  const { type, heat } = planetTypeFor(rng.fork('type'), star, orbit);
  const profile = PLANET_PROFILES[type];
  const sizeRoll = rng.next();
  // Super-earths are rare but huge.
  const radius = sizeRoll > 0.9 ? rng.range(18000, 24000) : rng.range(7000, 15000);
  const ang = rng.range(0, Math.PI * 2);
  const position = [Math.cos(ang) * orbit, rng.range(-1.5e5, 1.5e5), Math.sin(ang) * orbit];
  const gravity = clamp((radius / 12000) * rng.range(5.5, 13.5), 1.2, 26);
  return {
    id,
    kind: 'planet',
    seed: rng.fork('seed').int(1, 2 ** 31 - 1),
    name: makeName(rng.fork('name'), undefined, 0, 2),
    type,
    radius,
    gravity,
    position,
    tilt: rng.range(-0.45, 0.45),
    spinPeriod: rng.range(900, 2400),
    spinPhase: rng.range(0, Math.PI * 2),
    atmosphere: profile.atmo > 0 ? { density: profile.atmo * rng.range(0.8, 1.2), color: jitterColor(profile.sky, rng), breathable: profile.breathable } : null,
    ocean: profile.ocean && rng.chance(0.85),
    temperature: Math.round((heat * 290 - 273) * rng.range(0.85, 1.15)),
    rings: rng.chance(0.3) ? { inner: radius * rng.range(1.4, 1.8), outer: radius * rng.range(2.1, 3.0), color: jitterColor([0.85, 0.78, 0.65], rng), tilt: rng.range(-0.3, 0.3) } : null,
    life: profile.life * rng.range(0.6, 1.2) > 0.25,
    lifeRichness: profile.life,
    danger: dangerFrom(profile, heat, rng.fork('danger')),
    weather: profile.weather,
    terrain: {
      amplitude: rng.range(0.025, 0.06) * radius,
      continentFreq: rng.range(1.2, 2.6),
      mountainFreq: rng.range(3, 7),
      ridgeWeight: rng.range(0.3, 0.9),
      craters: type === 'barren' || type === 'crystal' ? rng.range(0.3, 1) : 0,
      seaBias: profile.ocean ? rng.range(-0.1, 0.15) : -1,
    },
    civilization: profile.life > 0.5 && rng.chance(0.3) ? rng.int(0, 9) : null,
    orbitIndex: index,
  };
}

function makeMoon(id, rng, planet, index) {
  const radius = rng.range(2200, 4500);
  const dist = planet.radius * rng.range(6, 10) + index * 30000;
  const ang = rng.range(0, Math.PI * 2);
  const type = rng.pick(['barren', 'ice', 'crystal', 'barren']);
  const profile = PLANET_PROFILES[type];
  return {
    id,
    kind: 'moon',
    parent: planet.id,
    seed: rng.fork('seed').int(1, 2 ** 31 - 1),
    name: `${planet.name} ${['I', 'II', 'III'][index] || 'IV'}`,
    type,
    radius,
    gravity: rng.range(1.0, 3.0),
    position: [planet.position[0] + Math.cos(ang) * dist, planet.position[1] + rng.range(-5000, 5000), planet.position[2] + Math.sin(ang) * dist],
    tilt: rng.range(-0.2, 0.2),
    spinPeriod: rng.range(1500, 4000),
    spinPhase: rng.range(0, Math.PI * 2),
    atmosphere: type === 'ice' && rng.chance(0.3) ? { density: 0.25, color: profile.sky, breathable: false } : null,
    ocean: false,
    subsurfaceOcean: type === 'ice' && rng.chance(0.5),
    temperature: planet.temperature - rng.range(20, 90) | 0,
    rings: null,
    life: false,
    lifeRichness: 0,
    danger: rng.pick(['SAFE', 'LOW', 'LOW', 'MEDIUM']),
    weather: ['clear'],
    terrain: { amplitude: radius * rng.range(0.03, 0.07), continentFreq: rng.range(1.5, 3), mountainFreq: rng.range(4, 8), ridgeWeight: 0.3, craters: rng.range(0.5, 1), seaBias: -1 },
    ancientSite: rng.chance(0.25),
    civilization: null,
  };
}

function jitterColor(c, rng) {
  return c.map((v) => clamp(v * rng.range(0.85, 1.15), 0, 1));
}

// The hand-tuned starting system for the vertical slice.
function homeSystem() {
  const summary = summarizeSystem(HOME_SYSTEM_ID, HOME_POSITION);
  const star = makeStar('yellow', new RNG(7));
  star.radius = 150000;
  const aurel = {
    id: 'home/aurel',
    kind: 'planet',
    seed: 424242,
    name: 'Aurel',
    type: 'terran',
    radius: 12000,
    gravity: 9.3,
    position: [6.0e6, 0, 0],
    tilt: 0.28,
    spinPeriod: 1440,
    spinPhase: 1.4,
    atmosphere: { density: 1.0, color: [0.32, 0.56, 1.0], breathable: true },
    ocean: true,
    temperature: 18,
    rings: { inner: 19000, outer: 31000, color: [0.86, 0.8, 0.7], tilt: 0.12 },
    life: true,
    lifeRichness: 1,
    danger: 'SAFE',
    weather: ['clear', 'cloudy', 'rain', 'storm'],
    terrain: { amplitude: 620, continentFreq: 1.8, mountainFreq: 4.2, ridgeWeight: 0.75, craters: 0, seaBias: 0.02 },
    civilization: 0,
    city: { name: 'Solace Reach' },
    station: { altitude: 16000, name: 'Meridian Station' },
    home: true,
  };
  const tessa = {
    id: 'home/tessa',
    kind: 'moon',
    parent: 'home/aurel',
    seed: 90210,
    name: 'Tessa',
    type: 'ice',
    radius: 3200,
    gravity: 1.9,
    position: [6.0e6 - 52000, 14000, 64000],
    tilt: 0.1,
    spinPeriod: 2600,
    spinPhase: 0.2,
    atmosphere: null,
    ocean: false,
    subsurfaceOcean: true,
    temperature: -140,
    rings: null,
    life: false,
    lifeRichness: 0,
    danger: 'LOW',
    weather: ['clear'],
    terrain: { amplitude: 170, continentFreq: 2.2, mountainFreq: 5, ridgeWeight: 0.4, craters: 0.9, seaBias: -1 },
    ancientSite: true,
    civilization: null,
  };
  const pyra = {
    ...makePlanet('home/pyra', new RNG(99), star, 6.9e6, 1),
    name: 'Pyra',
    type: 'desert',
    position: [6.4e6, 2.1e5, 1.15e6],
    radius: 9000,
    gravity: 7.1,
    atmosphere: { density: 0.7, color: [0.95, 0.66, 0.42], breathable: false },
    ocean: false,
    temperature: 64,
    danger: 'MEDIUM',
    rings: null,
    civilization: null,
    weather: ['clear', 'sandstorm'],
  };
  pyra.terrain = { ...pyra.terrain, seaBias: -1, amplitude: 480 };
  const glacia = {
    ...makePlanet('home/glacia', new RNG(1234), star, 9e6, 2),
    name: 'Glacia',
    type: 'ice',
    position: [4.2e6, -3.0e5, -2.3e6],
    radius: 16500,
    gravity: 11.2,
    atmosphere: { density: 0.6, color: [0.6, 0.8, 1.0], breathable: false },
    ocean: false,
    temperature: -88,
    danger: 'MEDIUM',
    rings: { inner: 26000, outer: 38000, color: [0.75, 0.82, 0.95], tilt: -0.2 },
    civilization: null,
    weather: ['clear', 'snow', 'blizzard'],
  };
  glacia.terrain = { ...glacia.terrain, seaBias: -1 };
  return {
    ...summary,
    star,
    bodies: [aurel, tessa, pyra, glacia],
    anomalies: [{ type: 'derelict', id: 'home/derelict', position: [5.2e6, 3e5, 6e5], radius: 60, hidden: true }],
  };
}
