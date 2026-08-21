/**
 * Dynamic weather (§15) and world events (§48, §66).
 *
 * Weather is a deterministic function of planet + time, so it is identical on
 * every client in co-op and needs no syncing, while still evolving continuously
 * rather than being rolled at random.
 */
import { fbm, RNG, hashInts } from '../core/rng.js';

export const WEATHER_TYPES = {
  clear:       { vis: 1.0,  wind: [0, 4],   particles: null,    danger: 0 },
  cloudy:      { vis: 0.9,  wind: [2, 8],   particles: null,    danger: 0 },
  rain:        { vis: 0.6,  wind: [4, 14],  particles: 'rain',  danger: 0.1 },
  storm:       { vis: 0.35, wind: [16, 34], particles: 'rain',  danger: 0.4, lightning: true },
  snow:        { vis: 0.5,  wind: [3, 16],  particles: 'snow',  danger: 0.2 },
  blizzard:    { vis: 0.15, wind: [22, 45], particles: 'snow',  danger: 0.7 },
  fog:         { vis: 0.22, wind: [0, 3],   particles: null,    danger: 0.1 },
  sandstorm:   { vis: 0.12, wind: [20, 42], particles: 'sand',  danger: 0.6 },
  ash_fall:    { vis: 0.3,  wind: [4, 18],  particles: 'ash',   danger: 0.5 },
  acid_rain:   { vis: 0.45, wind: [6, 20],  particles: 'acid',  danger: 0.8 },
  ion_storm:   { vis: 0.4,  wind: [12, 30], particles: 'ion',   danger: 0.9, lightning: true, emp: true },
  hurricane:   { vis: 0.2,  wind: [35, 70], particles: 'rain',  danger: 0.95, lightning: true },
  meteor_shower:{ vis: 0.8, wind: [0, 6],   particles: 'meteor',danger: 0.5 },
  heat_haze:   { vis: 0.7,  wind: [0, 5],   particles: null,    danger: 0.4 },
};

/** Which weather a planet class can produce, with weights. */
const CLASS_WEATHER = {
  temperate:      { clear: 5, cloudy: 3, rain: 2.5, storm: 1, fog: 0.8, snow: 0.6 },
  jungle:         { cloudy: 3, rain: 4, storm: 2, fog: 1.5, clear: 2 },
  ocean:          { cloudy: 3, rain: 3, storm: 2.5, hurricane: 0.7, clear: 2.5, fog: 1 },
  desert:         { clear: 6, sandstorm: 2.5, heat_haze: 2, cloudy: 1 },
  barren:         { clear: 8, meteor_shower: 0.6 },
  scorched:       { clear: 5, heat_haze: 3, ash_fall: 1 },
  lava:           { ash_fall: 4, heat_haze: 3, clear: 2, storm: 0.5 },
  toxic:          { acid_rain: 4, fog: 2.5, cloudy: 2, storm: 1 },
  ice:            { snow: 4, blizzard: 2, clear: 2.5, fog: 1 },
  frozen_ocean:   { snow: 3, blizzard: 3, clear: 2, fog: 1.5 },
  fungal:         { fog: 3, rain: 2.5, cloudy: 3, clear: 1.5 },
  crystalline:    { clear: 5, ion_storm: 1.5, snow: 1.5, fog: 1 },
  bioluminescent: { fog: 3, rain: 2, cloudy: 2.5, clear: 2 },
  radioactive:    { ash_fall: 2, acid_rain: 2, ion_storm: 1.5, clear: 2, fog: 1.5 },
  electric:       { ion_storm: 5, storm: 3, cloudy: 2, clear: 1 },
  cloud:          { storm: 3, cloudy: 4, rain: 2, hurricane: 1 },
  gas_giant:      { storm: 5, hurricane: 3, cloudy: 3 },
};

/**
 * Weather at a place and time.
 *
 * Two slow noise fields (a "front" field and an intensity field) are sampled
 * at the location; the planet's weather table converts them into a type. It
 * evolves smoothly, varies by region, and is exactly reproducible.
 *
 * @param {object} planet
 * @param {{x,y,z}} dir surface direction (unit)
 * @param {number} timeS world time in seconds
 */
export function weatherAt(planet, dir, timeS) {
  const table = CLASS_WEATHER[planet.class] || CLASS_WEATHER.barren;
  const entries = Object.entries(table);

  // Airless worlds have no weather to speak of.
  if ((planet.atmosphere || 0) < 0.08) {
    return makeState('clear', 0, planet, 0);
  }

  // Weather systems drift: a slowly moving noise field over the sphere.
  const t = timeS / 3600 * 0.06;                    // ~17h to cross a cell
  const f = 2.4;
  const front = fbm(planet.seed + 4001, dir.x * f + t, dir.y * f, dir.z * f - t * 0.7, 3) * 0.5 + 0.5;
  const intensity = fbm(planet.seed + 4002, dir.x * f * 1.7 - t * 0.5, dir.y * f * 1.7, dir.z * f * 1.7, 3) * 0.5 + 0.5;

  // Map `front` onto the weighted table.
  let total = 0;
  for (const [, w] of entries) total += w;
  let acc = 0, chosen = entries[0][0];
  for (const [k, w] of entries) {
    acc += w / total;
    if (front <= acc) { chosen = k; break; }
  }

  // Strong intensity upgrades weather to its severe form.
  if (intensity > 0.82) {
    if (chosen === 'rain') chosen = 'storm';
    else if (chosen === 'snow') chosen = 'blizzard';
    else if (chosen === 'storm' && table.hurricane) chosen = 'hurricane';
    else if (chosen === 'cloudy') chosen = table.rain ? 'rain' : 'cloudy';
  }

  return makeState(chosen, intensity, planet, timeS);
}

function makeState(type, intensity, planet, timeS) {
  const def = WEATHER_TYPES[type] || WEATHER_TYPES.clear;
  const atm = Math.max(0.05, Math.min(4, planet.atmosphere || 1));
  const windScale = Math.sqrt(atm);
  return {
    type,
    label: type.replace(/_/g, ' ').toUpperCase(),
    intensity: +intensity.toFixed(3),
    visibility: def.vis + (1 - def.vis) * (1 - intensity) * 0.5,
    windSpeed: +((def.wind[0] + (def.wind[1] - def.wind[0]) * intensity) * windScale).toFixed(1),
    windDir: (timeS * 0.0002 + planet.seed * 0.001) % (Math.PI * 2),
    particles: def.particles,
    lightning: !!def.lightning,
    emp: !!def.emp,
    danger: def.danger,
    // What the survival system should apply per second while exposed.
    hazard: def.danger * intensity,
  };
}

/**
 * Rare, planet-wide events (§66). Deterministic per planet per day, so all
 * clients agree, but rare enough to feel like an occasion.
 */
export function worldEventFor(planet, day) {
  const rng = new RNG(hashInts(planet.seed, Math.floor(day)));
  if (!rng.chance(0.035)) return null;

  const options = [];
  if (planet.class === 'barren' || planet.atmosphere < 0.3) options.push('meteor_shower');
  if (planet.hasCity) options.push('power_failure', 'epidemic', 'trade_boom');
  if (planet.civilization) options.push('unrest');
  options.push('migration', 'quake', 'aurora');
  if (planet.class === 'lava' || planet.class === 'scorched') options.push('eruption');
  if (planet.water > 0.4) options.push('tsunami');

  const kind = rng.pick(options);
  return {
    kind,
    day: Math.floor(day),
    durationDays: rng.range(0.5, 6),
    severity: rng.range(0.3, 1),
    planetSeed: planet.seed,
    planetName: planet.name,
  };
}

export function describeWorldEvent(ev) {
  switch (ev.kind) {
    case 'meteor_shower': return `Meteor shower over ${ev.planetName}.`;
    case 'power_failure': return `Grid failure on ${ev.planetName}; settlements are running on reserves.`;
    case 'epidemic': return `Outbreak reported on ${ev.planetName}. Medical supplies are scarce.`;
    case 'trade_boom': return `${ev.planetName} is buying above market rate this season.`;
    case 'unrest': return `Civil unrest on ${ev.planetName}.`;
    case 'migration': return `Mass migration of native fauna across ${ev.planetName}.`;
    case 'quake': return `Seismic activity on ${ev.planetName}.`;
    case 'aurora': return `Exceptional auroral activity visible from ${ev.planetName}.`;
    case 'eruption': return `Major eruption on ${ev.planetName}.`;
    case 'tsunami': return `Coastal flooding on ${ev.planetName}.`;
    default: return `Event on ${ev.planetName}.`;
  }
}
