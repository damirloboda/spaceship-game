/**
 * Procedural galaxy.
 *
 * The galaxy is an infinite lattice of sectors. A sector is 100 light-years on
 * a side and holds 0..N star systems. Nothing is stored: a system is rebuilt
 * from its integer coordinates on demand, so the galaxy is effectively
 * unbounded (2^32 sector coordinates x systems per sector) while costing no
 * memory. Only the player's *discoveries* are persisted.
 */
import { RNG, hashInts, fbm } from '../core/rng.js';
import { starName, planetName, moonName } from './names.js';
import { CIVILIZATIONS } from './civ.js';

export const LY = 9.4607e15;            // metres in a light-year
export const SECTOR_LY = 100;           // sector edge in light-years
export const AU = 1.496e11;             // metres in an astronomical unit

/* ------------------------------------------------------------------ */
/* Stars                                                               */
/* ------------------------------------------------------------------ */

export const STAR_TYPES = {
  red_dwarf:    { label: 'M', weight: 60, tempK: [2400, 3700],   radius: [0.12, 0.6],  lum: [0.0002, 0.08], color: [1.0, 0.42, 0.24] },
  orange_dwarf: { label: 'K', weight: 14, tempK: [3700, 5200],   radius: [0.6, 0.9],   lum: [0.08, 0.6],    color: [1.0, 0.66, 0.38] },
  yellow:       { label: 'G', weight: 10, tempK: [5200, 6000],   radius: [0.9, 1.15],  lum: [0.6, 1.6],     color: [1.0, 0.93, 0.76] },
  white:        { label: 'F', weight: 6,  tempK: [6000, 7500],   radius: [1.15, 1.5],  lum: [1.6, 6],       color: [0.96, 0.97, 1.0] },
  blue_giant:   { label: 'B', weight: 3,  tempK: [10000, 30000], radius: [2.5, 8],     lum: [50, 3000],     color: [0.62, 0.75, 1.0] },
  giant:        { label: 'III',weight: 4, tempK: [3000, 5000],   radius: [15, 60],     lum: [80, 900],      color: [1.0, 0.55, 0.3] },
  supergiant:   { label: 'I', weight: 1,  tempK: [3500, 20000],  radius: [80, 900],    lum: [3000, 90000],  color: [1.0, 0.72, 0.55] },
  white_dwarf:  { label: 'D', weight: 2,  tempK: [8000, 40000],  radius: [0.008, 0.02],lum: [0.0005, 0.05], color: [0.85, 0.9, 1.0] },
  neutron:      { label: 'N', weight: 0.6,tempK: [200000, 900000],radius: [0.00002, 0.00003], lum: [0.5, 20], color: [0.8, 0.88, 1.0] },
  unstable:     { label: 'V', weight: 1.4,tempK: [4000, 12000],  radius: [1.5, 6],     lum: [2, 200],       color: [1.0, 0.5, 0.5] },
};

const STAR_WEIGHTS = Object.entries(STAR_TYPES).map(([k, v]) => [k, v.weight]);

/* ------------------------------------------------------------------ */
/* Planet classes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Planet archetypes. `zone` biases where they form: 0 = scorching inner orbit,
 * 1 = temperate, 2 = cold outer orbit. `hazard` feeds the danger rating.
 */
export const PLANET_CLASSES = {
  lava:           { zone: [0],    hazard: 4, atmos: [0.1, 1.5],  water: 0,    temp: [600, 1800] },
  scorched:       { zone: [0],    hazard: 3, atmos: [0, 0.3],    water: 0,    temp: [400, 900] },
  desert:         { zone: [0, 1], hazard: 2, atmos: [0.3, 1.2],  water: 0.05, temp: [280, 380] },
  toxic:          { zone: [0, 1], hazard: 4, atmos: [1.5, 8],    water: 0.2,  temp: [320, 520] },
  temperate:      { zone: [1],    hazard: 1, atmos: [0.7, 1.4],  water: 0.62, temp: [255, 305] },
  ocean:          { zone: [1],    hazard: 2, atmos: [0.8, 1.6],  water: 0.94, temp: [265, 300] },
  jungle:         { zone: [1],    hazard: 2, atmos: [0.9, 1.8],  water: 0.5,  temp: [290, 325] },
  fungal:         { zone: [1],    hazard: 3, atmos: [0.6, 1.3],  water: 0.35, temp: [270, 310] },
  crystalline:    { zone: [1, 2], hazard: 3, atmos: [0.05, 0.6], water: 0.02, temp: [140, 260] },
  bioluminescent: { zone: [1, 2], hazard: 3, atmos: [0.5, 1.2],  water: 0.4,  temp: [230, 285] },
  radioactive:    { zone: [0, 1, 2], hazard: 5, atmos: [0.2, 1.0], water: 0.1, temp: [250, 420] },
  electric:       { zone: [1, 2], hazard: 5, atmos: [1.2, 3.0],  water: 0.15, temp: [200, 300] },
  ice:            { zone: [2],    hazard: 2, atmos: [0.1, 0.9],  water: 0.8,  temp: [40, 220] },
  frozen_ocean:   { zone: [2],    hazard: 3, atmos: [0.2, 1.0],  water: 0.9,  temp: [90, 200] },
  barren:         { zone: [0, 1, 2], hazard: 1, atmos: [0, 0.05], water: 0,   temp: [70, 400] },
  cloud:          { zone: [1, 2], hazard: 3, atmos: [3, 20],     water: 0.3,  temp: [180, 340] },
  gas_giant:      { zone: [2],    hazard: 4, atmos: [50, 400],   water: 0,    temp: [70, 180] },
};

const CLASS_KEYS = Object.keys(PLANET_CLASSES);

export const DANGER_LEVELS = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME', 'UNKNOWN'];

/* ------------------------------------------------------------------ */
/* Sector -> systems                                                   */
/* ------------------------------------------------------------------ */

/** Galactic density falls off with radius and rises inside spiral arms. */
export function sectorDensity(sx, sy, sz) {
  const rx = sx * SECTOR_LY, ry = sy * SECTOR_LY, rz = sz * SECTOR_LY;
  const r = Math.sqrt(rx * rx + ry * ry) / 1000;      // kly from core
  const disc = Math.exp(-Math.abs(rz * 0.02));        // thin disc
  const core = Math.exp(-r * 0.25) * 1.6;
  // two-armed logarithmic spiral
  const theta = Math.atan2(ry, rx);
  const arm = Math.cos(2 * (theta - Math.log(Math.max(r, 0.4)) * 2.4)) * 0.5 + 0.5;
  const noise = fbm(4242, sx * 0.07, sy * 0.07, sz * 0.07, 3) * 0.5 + 0.5;
  return Math.max(0, (core + arm * 0.9 * Math.exp(-r * 0.12)) * disc * (0.55 + noise * 0.9));
}

/** Is this a region the map refuses to resolve until visited? (§74) */
export function isUnknownRegion(sx, sy, sz) {
  return fbm(90210, sx * 0.045, sy * 0.045, sz * 0.045, 3) > 0.42;
}

/** Stable per-sector seed. */
export function sectorSeed(sx, sy, sz) {
  return hashInts(0x5eed, sx, sy, sz);
}

/** Cheap catalog entry for a system: enough for the map, no planet detail. */
export function systemStub(sx, sy, sz, i) {
  const seed = hashInts(sectorSeed(sx, sy, sz), i);
  const rng = new RNG(seed);
  const starType = rng.weighted(STAR_WEIGHTS);
  const def = STAR_TYPES[starType];
  const companions = rng.weighted([[0, 0.62], [1, 0.28], [2, 0.1]]);
  return {
    id: `${sx}.${sy}.${sz}.${i}`,
    seed,
    sector: [sx, sy, sz],
    index: i,
    name: starName(seed),
    starType,
    starClass: def.label,
    companions,
    // position within the sector, in light-years, absolute galactic frame
    pos: [
      (sx + rng.next()) * SECTOR_LY,
      (sy + rng.next()) * SECTOR_LY,
      (sz + rng.next()) * SECTOR_LY,
    ],
    unknown: isUnknownRegion(sx, sy, sz),
    hasBlackHole: rng.chance(starType === 'neutron' ? 0.25 : 0.012),
    hasWormhole: rng.chance(0.02),
    hasStation: rng.chance(0.34),
    hasAnomaly: rng.chance(0.14),
  };
}

/**
 * All system stubs in a sector.
 *
 * Real stellar density would put thousands of stars in a 100ly cube, which is
 * neither navigable nor enumerable. We generate a playable sample — up to ~220
 * per sector — which still means a 60ly scan returns a crowded map.
 *
 * Results are cached: the galaxy map re-queries the same sectors every frame.
 */
const SECTOR_CACHE = new Map();
const SECTOR_CACHE_MAX = 512;

export function sectorSystems(sx, sy, sz) {
  const key = `${sx},${sy},${sz}`;
  const hit = SECTOR_CACHE.get(key);
  if (hit) return hit;

  const rng = new RNG(hashInts(sectorSeed(sx, sy, sz), 77));
  const density = sectorDensity(sx, sy, sz);
  const count = Math.min(220, Math.floor(density * rng.range(20, 70)));
  const out = [];
  for (let i = 0; i < count; i++) out.push(systemStub(sx, sy, sz, i));

  if (SECTOR_CACHE.size >= SECTOR_CACHE_MAX) {
    SECTOR_CACHE.delete(SECTOR_CACHE.keys().next().value);
  }
  SECTOR_CACHE.set(key, out);
  return out;
}

/** Drop cached sectors (used by the debug 'regenerate galaxy' tool). */
export function clearSectorCache() {
  SECTOR_CACHE.clear();
}

/** Every system within `radiusLy` of a galactic position. */
export function systemsNear(posLy, radiusLy) {
  const rs = Math.ceil(radiusLy / SECTOR_LY);
  const cx = Math.floor(posLy[0] / SECTOR_LY);
  const cy = Math.floor(posLy[1] / SECTOR_LY);
  const cz = Math.floor(posLy[2] / SECTOR_LY);
  const out = [];
  for (let x = cx - rs; x <= cx + rs; x++) {
    for (let y = cy - rs; y <= cy + rs; y++) {
      for (let z = cz - rs; z <= cz + rs; z++) {
        for (const s of sectorSystems(x, y, z)) {
          const d = Math.hypot(s.pos[0] - posLy[0], s.pos[1] - posLy[1], s.pos[2] - posLy[2]);
          if (d <= radiusLy) out.push({ ...s, distanceLy: d });
        }
      }
    }
  }
  out.sort((a, b) => a.distanceLy - b.distanceLy);
  return out;
}

/* ------------------------------------------------------------------ */
/* Full system generation                                              */
/* ------------------------------------------------------------------ */

function starPhysical(rng, type) {
  const def = STAR_TYPES[type];
  return {
    type,
    class: def.label,
    tempK: Math.round(rng.range(def.tempK[0], def.tempK[1])),
    radiusSol: rng.range(def.radius[0], def.radius[1]),
    luminositySol: rng.range(def.lum[0], def.lum[1]),
    color: def.color,
  };
}

/** Equilibrium temperature in kelvin at a given orbit. */
export function orbitTemperature(luminositySol, orbitAu, albedo = 0.3) {
  // T = 278.6 * (L^0.25) / sqrt(a)  (albedo-adjusted)
  return 278.6 * Math.pow(luminositySol * (1 - albedo) / 0.7, 0.25) / Math.sqrt(Math.max(0.01, orbitAu));
}

function zoneForTemp(t) {
  if (t > 400) return 0;
  if (t > 200) return 1;
  return 2;
}

function pickPlanetClass(rng, zone, orbitAu) {
  const candidates = CLASS_KEYS.filter((k) => PLANET_CLASSES[k].zone.includes(zone));
  const weights = candidates.map((k) => {
    let w = 1;
    if (k === 'gas_giant') w = orbitAu > 3 ? 3.2 : 0.05;
    if (k === 'temperate') w = 0.55;      // habitable worlds stay special
    if (k === 'ocean') w = 0.4;
    if (k === 'barren') w = 1.6;
    return [k, w];
  });
  return rng.weighted(weights);
}

/**
 * Build a full planet record. Everything the surface generator needs is
 * derived here, so a planet is one deterministic object the whole game shares.
 */
function makePlanet(rng, star, starName_, index, orbitAu, isMoon = false, parentName = '') {
  const seed = rng.int(0, 0x7fffffff);
  const prng = new RNG(seed);
  const tempBase = orbitTemperature(star.luminositySol, orbitAu);
  const zone = zoneForTemp(tempBase);
  const cls = isMoon && prng.chance(0.55)
    ? prng.pick(['barren', 'ice', 'crystalline', 'frozen_ocean'])
    : pickPlanetClass(prng, zone, orbitAu);
  const def = PLANET_CLASSES[cls];

  const gas = cls === 'gas_giant';
  // Radius in metres. Super-earths are deliberately possible (§7).
  let radius;
  if (gas) radius = prng.range(24000e3, 71000e3);
  else if (isMoon) radius = prng.range(320e3, 2600e3);
  else radius = prng.weighted([[prng.range(1500e3, 3400e3), 0.25], [prng.range(3400e3, 7200e3), 0.5], [prng.range(7200e3, 14000e3), 0.25]]);

  const densityKgM3 = gas ? prng.range(700, 1600) : prng.range(3200, 6200);
  const G = 6.674e-11;
  const mass = (4 / 3) * Math.PI * radius ** 3 * densityKgM3;
  const gravity = (G * mass) / (radius * radius);       // m/s^2

  const atmosphere = prng.range(def.atmos[0], def.atmos[1]) * (isMoon ? 0.25 : 1);
  const surfaceTemp = Math.round(tempBase + prng.range(-25, 25) + atmosphere * 12);
  const water = Math.max(0, Math.min(1, def.water * prng.range(0.6, 1.35)));

  const hazardScore = def.hazard
    + (atmosphere < 0.15 ? 1 : 0)
    + (gravity > 18 ? 1 : 0)
    + (surfaceTemp > 380 || surfaceTemp < 150 ? 1 : 0);
  const danger = DANGER_LEVELS[Math.max(0, Math.min(4, Math.round(hazardScore * 0.8)))];

  const habitable = !gas && atmosphere > 0.4 && atmosphere < 4
    && surfaceTemp > 250 && surfaceTemp < 320 && water > 0.05;

  const civ = !gas && prng.chance(habitable ? 0.5 : 0.09)
    ? prng.pick(CIVILIZATIONS).id
    : null;

  const name = isMoon
    ? moonName(seed, parentName, index)
    : planetName(seed, starName_, index);

  return {
    seed,
    name,
    class: cls,
    isMoon,
    index,
    radius,
    gravity: +gravity.toFixed(2),
    mass,
    orbitAu,
    orbitPhase: prng.range(0, Math.PI * 2),
    orbitInclination: prng.range(-0.09, 0.09),
    dayLengthS: prng.range(1800, 260000),
    axialTilt: prng.range(-0.45, 0.45),
    atmosphere: +atmosphere.toFixed(2),
    pressureBar: +(atmosphere * prng.range(0.8, 1.2)).toFixed(2),
    surfaceTemp,
    water: +water.toFixed(2),
    danger,
    habitable,
    gasGiant: gas,
    hasRings: !isMoon && prng.chance(gas ? 0.55 : 0.16),
    ringInner: prng.range(1.4, 1.8),
    ringOuter: prng.range(2.0, 2.9),
    civilization: civ,
    hasCity: !!civ && prng.chance(0.75),
    hasRuins: prng.chance(0.22),
    hasCaves: !gas && prng.chance(0.7),
    moons: [],
  };
}

/** Full system: star(s), planets, moons, station, hazards. Deterministic. */
export function generateSystem(stub) {
  const rng = new RNG(hashInts(stub.seed, 0xA11CE));
  const star = starPhysical(rng, stub.starType);
  const stars = [star];
  for (let c = 0; c < stub.companions; c++) {
    const t = rng.weighted(STAR_WEIGHTS);
    const comp = starPhysical(rng, t);
    comp.orbitAu = rng.range(0.4, 60);
    comp.orbitPhase = rng.range(0, Math.PI * 2);
    stars.push(comp);
  }

  const totalLum = stars.reduce((s, x) => s + x.luminositySol, 0);
  const planetCount = rng.weighted([[0, 0.05], [1, 0.1], [2, 0.14], [3, 0.16], [4, 0.15], [5, 0.13], [6, 0.1], [7, 0.07], [8, 0.05], [9, 0.03], [10, 0.02]]);

  const planets = [];
  let a = rng.range(0.15, 0.5);
  for (let i = 0; i < planetCount; i++) {
    const p = makePlanet(rng, { luminositySol: totalLum }, stub.name, i, a);
    const moonCount = p.gasGiant
      ? rng.int(0, 6)
      : rng.weighted([[0, 0.5], [1, 0.3], [2, 0.14], [3, 0.06]]);
    for (let m = 0; m < moonCount; m++) {
      p.moons.push(makePlanet(rng, { luminositySol: totalLum }, stub.name, m, a, true, p.name));
    }
    planets.push(p);
    a *= rng.range(1.35, 2.1);          // Titius-Bode-ish spacing
  }

  const asteroidBelts = [];
  const beltCount = rng.weighted([[0, 0.45], [1, 0.4], [2, 0.15]]);
  for (let i = 0; i < beltCount; i++) {
    asteroidBelts.push({
      innerAu: rng.range(1.5, 8),
      width: rng.range(0.4, 2.5),
      density: rng.range(0.2, 1),
      richness: rng.range(0.3, 1),
    });
  }

  return {
    ...stub,
    stars,
    star,
    planets,
    asteroidBelts,
    comets: rng.int(0, 5),
    station: stub.hasStation ? generateStation(stub, rng) : null,
    blackHole: stub.hasBlackHole ? {
      massSol: rng.range(4, 4.2e6),
      radiusM: 0,                        // filled below
      spin: rng.range(0, 0.998),
      accretion: rng.chance(0.7),
      orbitAu: rng.range(20, 200),
    } : null,
    wormhole: stub.hasWormhole ? {
      stable: rng.chance(0.35),
      orbitAu: rng.range(15, 120),
      // Destination is a jump of 200..4000 ly in a fixed random direction
      jumpLy: rng.range(200, 4000),
      dir: rng.onSphere(),
      lifetimeS: rng.range(600, 4000),
    } : null,
    anomaly: stub.hasAnomaly ? {
      kind: rng.pick(['signal', 'derelict', 'gravity_well', 'energy_bloom', 'silent_beacon', 'ancient_array']),
      orbitAu: rng.range(0.5, 40),
      investigated: false,
    } : null,
  };
}

function generateStation(stub, rng) {
  const civ = rng.pick(CIVILIZATIONS);
  return {
    name: `${stub.name} ${rng.pick(['Station', 'Depot', 'Waypoint', 'Yard', 'Terminal'])}`,
    civilization: civ.id,
    orbitAu: rng.range(0.6, 12),
    size: rng.pick(['outpost', 'station', 'port', 'megaport']),
    services: {
      refuel: true,
      repair: rng.chance(0.9),
      market: true,
      shipyard: rng.chance(0.55),
      missions: rng.chance(0.85),
      crew: rng.chance(0.6),
      lab: rng.chance(0.4),
    },
  };
}

// Schwarzschild radius helper (kept out of the object literal for clarity).
export function schwarzschildRadius(massSol) {
  return 2 * 6.674e-11 * (massSol * 1.989e30) / (299792458 ** 2);
}

/** Planet classes a new player can survive without any gear. */
const STARTER_CLASSES = new Set(['temperate', 'jungle', 'ocean', 'desert']);

/**
 * The starting system. The opening scene (§123) needs, in one place: a
 * survivable home world with a city, a ringed planet visible in the sky, and
 * an orbital station to fly to. Rather than hard-code a seed, we search the
 * sectors around the galactic origin for the first system that has all three —
 * deterministic, and robust if the generator is ever tuned.
 */
export function findStartSystem() {
  for (let i = 0; i < 343; i++) {
    const sx = (i % 7) - 3;
    const sy = (Math.floor(i / 7) % 7) - 3;
    const sz = (Math.floor(i / 49) % 7) - 3;
    for (const stub of sectorSystems(sx, sy, sz)) {
      if (stub.unknown || !stub.hasStation) continue;
      // A calm, bright star: red dwarfs and giants make a grim first sunrise.
      if (stub.starType !== 'yellow' && stub.starType !== 'orange_dwarf') continue;
      const sys = generateSystem(stub);
      const home = sys.planets.find((p) => p.habitable && p.hasCity && !p.gasGiant
        && STARTER_CLASSES.has(p.class)
        && (p.danger === 'SAFE' || p.danger === 'LOW')
        && p.gravity > 5 && p.gravity < 13
        && p.radius < 9000e3 && p.moons.length > 0);
      const ringed = sys.planets.some((p) => p.hasRings);
      if (home && ringed && sys.planets.length >= 4) {
        return { system: sys, planetIndex: sys.planets.indexOf(home) };
      }
    }
  }
  // Fallback: best-effort pick from the origin sector so the game always boots.
  const stub = sectorSystems(0, 0, 0)[0] || systemStub(0, 0, 0, 0);
  const sys = generateSystem(stub);
  const idx = Math.max(0, sys.planets.findIndex((p) => !p.gasGiant));
  return { system: sys, planetIndex: idx };
}
