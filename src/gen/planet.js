/**
 * Planet surface generation.
 *
 * `PlanetSurface.elevation(unitVector)` is the single source of truth for a
 * world's shape. The terrain mesh builder and the character/ship collision
 * both call it, so what you see is exactly what you stand on — no separate
 * collision heightmap to drift out of sync.
 *
 * Everything is a pure function of the planet seed, so a world is identical on
 * every device and needs no storage.
 */
import { RNG, fbm, ridged, worley3, noise3, hashInts, hashString } from '../core/rng.js';
import { cityName } from './names.js';
import { CIV_BY_ID } from './civ.js';

/* ------------------------------------------------------------------ */
/* Biomes                                                              */
/* ------------------------------------------------------------------ */

/**
 * A biome maps to a ground colour, a physical surface material (§59, drives
 * footstep sound, friction and footprints) and what grows/lives there.
 */
export const BIOMES = {
  ocean:      { color: [0.05, 0.19, 0.35], material: 'water',   walkable: false, vegetation: 0,    fauna: 0.4 },
  beach:      { color: [0.76, 0.70, 0.50], material: 'sand',    walkable: true,  vegetation: 0.1,  fauna: 0.3 },
  grass:      { color: [0.28, 0.42, 0.20], material: 'dirt',    walkable: true,  vegetation: 0.8,  fauna: 1.0 },
  forest:     { color: [0.16, 0.30, 0.14], material: 'dirt',    walkable: true,  vegetation: 1.0,  fauna: 0.9 },
  jungle:     { color: [0.13, 0.34, 0.12], material: 'organic', walkable: true,  vegetation: 1.0,  fauna: 1.0 },
  savanna:    { color: [0.52, 0.47, 0.22], material: 'dirt',    walkable: true,  vegetation: 0.5,  fauna: 0.8 },
  desert:     { color: [0.75, 0.60, 0.36], material: 'sand',    walkable: true,  vegetation: 0.08, fauna: 0.3 },
  dunes:      { color: [0.80, 0.66, 0.42], material: 'sand',    walkable: true,  vegetation: 0.02, fauna: 0.15 },
  rock:       { color: [0.38, 0.36, 0.34], material: 'rock',    walkable: true,  vegetation: 0.15, fauna: 0.4 },
  mountain:   { color: [0.30, 0.29, 0.29], material: 'rock',    walkable: true,  vegetation: 0.05, fauna: 0.2 },
  snow:       { color: [0.90, 0.92, 0.96], material: 'snow',    walkable: true,  vegetation: 0.02, fauna: 0.2 },
  ice:        { color: [0.72, 0.84, 0.92], material: 'ice',     walkable: true,  vegetation: 0,    fauna: 0.15 },
  tundra:     { color: [0.45, 0.44, 0.38], material: 'dirt',    walkable: true,  vegetation: 0.3,  fauna: 0.5 },
  lava:       { color: [0.85, 0.22, 0.05], material: 'lava',    walkable: false, vegetation: 0,    fauna: 0.05 },
  basalt:     { color: [0.16, 0.14, 0.14], material: 'rock',    walkable: true,  vegetation: 0,    fauna: 0.1 },
  ash:        { color: [0.32, 0.29, 0.28], material: 'dirt',    walkable: true,  vegetation: 0.05, fauna: 0.2 },
  toxic:      { color: [0.42, 0.52, 0.16], material: 'organic', walkable: true,  vegetation: 0.4,  fauna: 0.6 },
  acid_pool:  { color: [0.55, 0.70, 0.18], material: 'liquid',  walkable: false, vegetation: 0,    fauna: 0.2 },
  crystal:    { color: [0.55, 0.62, 0.85], material: 'crystal', walkable: true,  vegetation: 0.2,  fauna: 0.3 },
  fungal:     { color: [0.48, 0.30, 0.52], material: 'organic', walkable: true,  vegetation: 0.9,  fauna: 0.7 },
  biolum:     { color: [0.12, 0.28, 0.40], material: 'organic', walkable: true,  vegetation: 0.9,  fauna: 0.8, glow: [0.2, 0.9, 1.0] },
  irradiated: { color: [0.40, 0.44, 0.30], material: 'rock',    walkable: true,  vegetation: 0.2,  fauna: 0.4, glow: [0.4, 1.0, 0.3] },
  metal:      { color: [0.44, 0.45, 0.48], material: 'metal',   walkable: true,  vegetation: 0,    fauna: 0.1 },
  regolith:   { color: [0.42, 0.40, 0.37], material: 'sand',    walkable: true,  vegetation: 0,    fauna: 0.05 },
  cloud_deck: { color: [0.62, 0.60, 0.70], material: 'liquid',  walkable: false, vegetation: 0,    fauna: 0.3 },
};

/**
 * Per-class terrain recipe: relief in metres, which noise dominates, which
 * biomes are reachable, and how the sky behaves.
 */
const TERRAIN_PROFILES = {
  temperate:      { relief: 2600, ridge: 0.55, warp: 0.5,  craters: 0,    seaBiome: 'ocean', land: ['beach', 'grass', 'forest', 'savanna', 'rock', 'mountain', 'snow'] },
  jungle:         { relief: 2200, ridge: 0.5,  warp: 0.7,  craters: 0,    seaBiome: 'ocean', land: ['beach', 'jungle', 'jungle', 'forest', 'rock', 'mountain'] },
  ocean:          { relief: 1500, ridge: 0.35, warp: 0.4,  craters: 0,    seaBiome: 'ocean', land: ['beach', 'grass', 'rock'] },
  desert:         { relief: 1900, ridge: 0.45, warp: 0.9,  craters: 0.15, seaBiome: 'ocean', land: ['dunes', 'desert', 'desert', 'rock', 'mountain'] },
  barren:         { relief: 2400, ridge: 0.5,  warp: 0.2,  craters: 0.8,  seaBiome: 'rock',  land: ['regolith', 'rock', 'rock', 'mountain'] },
  scorched:       { relief: 2100, ridge: 0.6,  warp: 0.3,  craters: 0.5,  seaBiome: 'basalt',land: ['basalt', 'ash', 'rock', 'mountain'] },
  lava:           { relief: 3000, ridge: 0.8,  warp: 0.6,  craters: 0.3,  seaBiome: 'lava',  land: ['basalt', 'ash', 'basalt', 'mountain'] },
  toxic:          { relief: 1700, ridge: 0.4,  warp: 0.8,  craters: 0,    seaBiome: 'acid_pool', land: ['toxic', 'toxic', 'ash', 'rock', 'mountain'] },
  ice:            { relief: 2300, ridge: 0.6,  warp: 0.3,  craters: 0.3,  seaBiome: 'ice',   land: ['ice', 'snow', 'snow', 'rock', 'mountain'] },
  frozen_ocean:   { relief: 900,  ridge: 0.3,  warp: 0.2,  craters: 0.2,  seaBiome: 'ice',   land: ['ice', 'ice', 'snow', 'rock'] },
  fungal:         { relief: 1800, ridge: 0.45, warp: 0.9,  craters: 0,    seaBiome: 'ocean', land: ['fungal', 'fungal', 'forest', 'rock', 'mountain'] },
  crystalline:    { relief: 2800, ridge: 0.9,  warp: 0.4,  craters: 0.2,  seaBiome: 'ice',   land: ['crystal', 'crystal', 'rock', 'mountain', 'snow'] },
  bioluminescent: { relief: 2000, ridge: 0.5,  warp: 0.8,  craters: 0,    seaBiome: 'ocean', land: ['biolum', 'biolum', 'fungal', 'rock', 'mountain'] },
  radioactive:    { relief: 2200, ridge: 0.55, warp: 0.5,  craters: 0.4,  seaBiome: 'acid_pool', land: ['irradiated', 'ash', 'rock', 'mountain'] },
  electric:       { relief: 2500, ridge: 0.7,  warp: 0.4,  craters: 0.1,  seaBiome: 'ocean', land: ['metal', 'crystal', 'rock', 'mountain', 'basalt'] },
  cloud:          { relief: 1200, ridge: 0.3,  warp: 0.6,  craters: 0,    seaBiome: 'cloud_deck', land: ['cloud_deck', 'rock', 'metal'] },
  gas_giant:      { relief: 400,  ridge: 0.2,  warp: 1.0,  craters: 0,    seaBiome: 'cloud_deck', land: ['cloud_deck'] },
};

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

export const RESOURCES = {
  ferrite:   { label: 'Ferrite',        tier: 1, baseValue: 4,   biomes: ['rock', 'mountain', 'regolith', 'basalt'] },
  silica:    { label: 'Silica',         tier: 1, baseValue: 5,   biomes: ['sand', 'desert', 'dunes', 'beach'] },
  carbon:    { label: 'Carbon',         tier: 1, baseValue: 3,   biomes: ['forest', 'jungle', 'grass', 'fungal', 'biolum'] },
  ice_water: { label: 'Water Ice',      tier: 1, baseValue: 6,   biomes: ['ice', 'snow', 'frozen_ocean'] },
  copper:    { label: 'Copper',         tier: 2, baseValue: 22,  biomes: ['rock', 'mountain', 'ash'] },
  titanium:  { label: 'Titanium',       tier: 2, baseValue: 48,  biomes: ['mountain', 'basalt', 'metal'] },
  sulphur:   { label: 'Sulphur',        tier: 2, baseValue: 18,  biomes: ['toxic', 'ash', 'basalt'] },
  biomass:   { label: 'Biomass',        tier: 2, baseValue: 14,  biomes: ['jungle', 'fungal', 'forest', 'biolum', 'toxic'] },
  helium3:   { label: 'Helium-3',       tier: 3, baseValue: 90,  biomes: ['regolith', 'cloud_deck', 'ice'] },
  iridium:   { label: 'Iridium',        tier: 3, baseValue: 140, biomes: ['mountain', 'basalt', 'irradiated'] },
  crystal:   { label: 'Resonant Crystal', tier: 3, baseValue: 180, biomes: ['crystal', 'ice', 'mountain'] },
  luminite:  { label: 'Luminite',       tier: 4, baseValue: 320, biomes: ['biolum', 'fungal', 'crystal'] },
  voidglass: { label: 'Voidglass',      tier: 4, baseValue: 520, biomes: ['basalt', 'irradiated', 'metal', 'crystal'] },
  precursor_alloy: { label: 'Precursor Alloy', tier: 5, baseValue: 1400, biomes: [] }, // ruins only
};

/* ------------------------------------------------------------------ */
/* Surface                                                             */
/* ------------------------------------------------------------------ */

export class PlanetSurface {
  /** @param {object} planet a planet record from gen/galaxy.js */
  constructor(planet) {
    this.planet = planet;
    this.seed = planet.seed;
    this.radius = planet.radius;
    this.profile = TERRAIN_PROFILES[planet.class] || TERRAIN_PROFILES.barren;

    const rng = new RNG(hashInts(planet.seed, 991));
    this.rng = rng;

    // Relief scales with planet size but is clamped: a super-earth shouldn't
    // become an unclimbable spike field, and a moon still deserves mountains.
    // The 1.9 factor is tuned so a typical world peaks around 3-5 km, which is
    // what makes a range read as a landmark from orbit and from the ground.
    const sizeFactor = Math.min(1.8, Math.max(0.8, planet.radius / 5000e3));
    this.relief = this.profile.relief * sizeFactor * 1.9 * rng.range(0.8, 1.3);

    // Continent frequency: bigger worlds get more, smaller ones fewer, so
    // continents stay a comparable *absolute* size to walk across.
    this.continentFreq = 1.1 * Math.max(0.6, planet.radius / 6000e3);
    this.detailFreq = this.continentFreq * 9;
    this.warpFreq = this.continentFreq * 2.2;
    this.warpAmount = this.profile.warp * 0.35;

    this.craterStrength = this.profile.craters * (planet.atmosphere < 0.3 ? 1 : 0.35);
    this.ridgeMix = this.profile.ridge;

    // Sea level. Analytic approximations of the elevation distribution were
    // off by a factor of fifty (a 62%-water world came out 1% flooded), so we
    // measure it instead: sample the finished elevation field over the whole
    // globe and take the quantile that floods exactly `water` of the surface.
    this.hasOcean = planet.water > 0.02 && !planet.gasGiant;
    this.seaLevel = this.hasOcean ? this._calibrateSeaLevel(planet.water) : -Infinity;
    this.seaBiome = this.profile.seaBiome;

    this.poi = null;                    // built lazily by pointsOfInterest()
  }

  /**
   * Sea level such that `water` of the surface floods. Sampled on a Fibonacci
   * sphere (even coverage, no polar clustering) and read off the sorted
   * elevations — exact by construction for any terrain profile.
   */
  _calibrateSeaLevel(water) {
    const N = 1024;
    const samples = new Float64Array(N);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * i + 1) / N;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      samples[i] = this.elevation(Math.cos(th) * r, y, Math.sin(th) * r);
    }
    samples.sort();
    const idx = Math.max(0, Math.min(N - 1, Math.round(water * (N - 1))));
    return samples[idx];
  }

  /**
   * Elevation in metres above sea level for a point on the unit sphere.
   * Hot path — called for every terrain vertex and every collision query.
   */
  elevation(x, y, z) {
    const s = this.seed;
    const cf = this.continentFreq;

    // Domain warp gives coastlines and ranges their crumpled, non-noisy look.
    const wa = this.warpAmount;
    let wx = x, wy = y, wz = z;
    if (wa > 0) {
      const f = this.warpFreq;
      wx = x + wa * noise3(s + 501, x * f, y * f, z * f);
      wy = y + wa * noise3(s + 502, x * f, y * f, z * f);
      wz = z + wa * noise3(s + 503, x * f, y * f, z * f);
    }

    // Continents: low frequency, high amplitude.
    const continent = fbm(s, wx * cf, wy * cf, wz * cf, 4, 2.1, 0.5);

    // Mountains: ridged noise, masked to continent highs so ranges sit inland.
    // The mask is zero over deep ocean, so skipping it there saves five octaves
    // on a large fraction of every water world's vertices.
    const mountainMask = continent * 0.5 + 0.35;
    let mountains = 0;
    if (mountainMask > 0.001) {
      const mf = cf * 3.1;
      mountains = ridged(s + 77, wx * mf, wy * mf, wz * mf, 5, 2.2, 0.5) * mountainMask;
    }

    // Mid + fine detail.
    const df = this.detailFreq;
    const detail = fbm(s + 131, wx * df, wy * df, wz * df, 4, 2.3, 0.45);

    let h = continent * (1 - this.ridgeMix * 0.5)
          + mountains * this.ridgeMix * 1.5
          + detail * 0.12;

    // Craters for thin-atmosphere worlds.
    if (this.craterStrength > 0) {
      const cfq = cf * 6;
      const w = worley3(s + 313, wx * cfq, wy * cfq, wz * cfq);
      // Rim at w≈0.35, bowl inside.
      const bowl = Math.max(0, 0.34 - w) * 3.0;
      const rim = Math.max(0, 1 - Math.abs(w - 0.38) * 9) * 0.35;
      h += (rim - bowl) * this.craterStrength * 0.6;
    }

    return h * this.relief;
  }

  /** Elevation from a normalised direction array/vector-like. */
  elevationAt(dir) {
    return this.elevation(dir.x ?? dir[0], dir.y ?? dir[1], dir.z ?? dir[2]);
  }

  /** Terrain radius (planet centre to ground) at a unit direction. */
  radiusAt(x, y, z) {
    return this.radius + this.elevation(x, y, z);
  }

  /**
   * Surface radius including liquid: standing on an ocean planet you float on
   * the sea surface, not on the seabed.
   */
  surfaceRadiusAt(x, y, z) {
    const e = this.elevation(x, y, z);
    return this.radius + (this.hasOcean ? Math.max(e, this.seaLevel) : e);
  }

  isUnderwater(x, y, z) {
    return this.hasOcean && this.elevation(x, y, z) < this.seaLevel;
  }

  /** Approximate surface normal via finite differences, in planet space. */
  normalAt(x, y, z, eps = 1e-4) {
    // Build a tangent basis around the direction.
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len, ny = y / len, nz = z / len;
    let ax = 0, ay = 0, az = 1;
    if (Math.abs(nz) > 0.9) { ax = 1; ay = 0; az = 0; }
    // t1 = normalize(cross(a, n)), t2 = cross(n, t1)
    let t1x = ay * nz - az * ny, t1y = az * nx - ax * nz, t1z = ax * ny - ay * nx;
    const l1 = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= l1; t1y /= l1; t1z /= l1;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;

    const r0 = this.radiusAt(nx, ny, nz);
    const hA = this.radiusAt(nx + t1x * eps, ny + t1y * eps, nz + t1z * eps);
    const hB = this.radiusAt(nx + t2x * eps, ny + t2y * eps, nz + t2z * eps);
    const d = eps * this.radius;
    // Gradient of height along the two tangents.
    const gu = (hA - r0) / d, gv = (hB - r0) / d;
    let vx = nx - (t1x * gu + t2x * gv);
    let vy = ny - (t1y * gu + t2y * gv);
    let vz = nz - (t1z * gu + t2z * gv);
    const l = Math.hypot(vx, vy, vz) || 1;
    return { x: vx / l, y: vy / l, z: vz / l };
  }

  /** Slope in radians (0 = flat ground). */
  slopeAt(x, y, z) {
    const n = this.normalAt(x, y, z);
    const len = Math.hypot(x, y, z) || 1;
    const dot = (n.x * x + n.y * y + n.z * z) / len;
    return Math.acos(Math.max(-1, Math.min(1, dot)));
  }

  /** Latitude in [-1,1] from a direction (used for climate bands). */
  latitude(x, y, z) {
    const len = Math.hypot(x, y, z) || 1;
    return y / len;
  }

  /**
   * Local surface temperature in kelvin. Falls with altitude and toward the
   * poles; this is what the survival system reads (§86).
   */
  temperatureAt(x, y, z) {
    const p = this.planet;
    const lat = Math.abs(this.latitude(x, y, z));
    const alt = Math.max(0, this.elevation(x, y, z) - Math.max(0, this.seaLevel));
    const lapse = p.atmosphere > 0.1 ? 0.0065 : 0.0;      // K per metre
    const poleDrop = (p.surfaceTemp * 0.26) * lat ** 1.7;
    return p.surfaceTemp - poleDrop - alt * lapse;
  }

  /** Humidity 0..1 — drives forest vs savanna vs desert inside a class. */
  humidityAt(x, y, z) {
    const f = this.continentFreq * 1.7;
    const n = fbm(this.seed + 909, x * f, y * f, z * f, 3) * 0.5 + 0.5;
    const oceanBonus = this.hasOcean ? Math.max(0, 1 - Math.abs(this.elevation(x, y, z) - this.seaLevel) / (this.relief * 0.7)) * 0.3 : 0;
    return Math.max(0, Math.min(1, n * 0.85 + oceanBonus + this.planet.water * 0.2));
  }

  /**
   * Which biome is at a point. Uses elevation, latitude/temperature and
   * humidity, then falls back to the class's biome palette.
   */
  biomeAt(x, y, z) {
    const e = this.elevation(x, y, z);
    if (this.hasOcean && e < this.seaLevel) return this.seaBiome;

    const land = this.profile.land;
    const t = this.temperatureAt(x, y, z);
    const hum = this.humidityAt(x, y, z);
    const above = e - Math.max(this.seaLevel, -this.relief);
    const rel = above / (this.relief * 1.25);          // 0 at shore, 1 at peaks

    // Universal climate overrides first.
    if (t < 232 && this.planet.atmosphere > 0.05) return rel > 0.55 ? 'snow' : 'ice';
    if (t < 268 && rel > 0.45) return 'snow';

    if (this.hasOcean && above < this.relief * 0.018) return land[0];   // shoreline

    if (rel > 0.72) return t < 285 ? 'snow' : 'mountain';
    if (rel > 0.45) return 'mountain';
    if (rel > 0.28) return 'rock';

    // Lowlands: humidity chooses between the class's lowland options.
    const lowlands = land.slice(1, Math.max(2, land.length - 2));
    if (!lowlands.length) return land[0];
    if (this.planet.class === 'temperate') {
      if (hum > 0.62) return 'forest';
      if (hum > 0.36) return 'grass';
      return t > 295 ? 'savanna' : 'grass';
    }
    if (this.planet.class === 'desert') return hum > 0.55 ? 'desert' : 'dunes';
    const idx = Math.min(lowlands.length - 1, Math.floor(hum * lowlands.length));
    return lowlands[idx];
  }

  /** Physical material at a point (§59). */
  materialAt(x, y, z) {
    return (BIOMES[this.biomeAt(x, y, z)] || BIOMES.rock).material;
  }

  /**
   * Resource concentration 0..1 for a given resource at a point. Rich veins
   * are clustered, not uniform, so prospecting is a real activity.
   */
  resourceAt(resourceId, x, y, z) {
    const res = RESOURCES[resourceId];
    if (!res) return 0;
    const biome = this.biomeAt(x, y, z);
    const mat = (BIOMES[biome] || {}).material;
    if (res.biomes.length && !res.biomes.includes(biome) && !res.biomes.includes(mat)) return 0;
    const f = this.continentFreq * 14;
    const seed = hashInts(this.seed, hashString(resourceId), res.tier);
    const v = fbm(seed, x * f, y * f, z * f, 3) * 0.5 + 0.5;
    const threshold = 0.55 + res.tier * 0.05;
    return v > threshold ? Math.min(1, (v - threshold) / (1 - threshold)) : 0;
  }

  /** Which resources are worth mining anywhere on this world. */
  resourceSurvey() {
    const rng = new RNG(hashInts(this.seed, 0x5217));
    const out = [];
    for (const [id, res] of Object.entries(RESOURCES)) {
      if (id === 'precursor_alloy') continue;
      const classMatch = res.biomes.some((b) => this.profile.land.includes(b) || this.profile.seaBiome === b
        || this.profile.land.some((l) => (BIOMES[l] || {}).material === b));
      if (!classMatch) continue;
      const abundance = rng.range(0.2, 1) * (res.tier >= 4 ? 0.35 : 1);
      if (abundance > 0.25) out.push({ id, label: res.label, tier: res.tier, abundance: +abundance.toFixed(2) });
    }
    return out.sort((a, b) => a.tier - b.tier);
  }

  /**
   * Find a flat, dry, walkable spot near a preferred direction. Used to place
   * cities, the player's landing site, bases and ruins so nothing spawns in an
   * ocean or on a cliff.
   */
  findFlatSite(dir, opts = {}) {
    const { maxSlope = 0.22, tries = 220, spread = 0.30, minAltitude = null } = opts;
    const rng = new RNG(hashInts(this.seed, opts.seed ?? 7));
    let best = null;
    const base = normalize(dir);
    for (let i = 0; i < tries; i++) {
      const jitter = i === 0 ? 0 : spread * Math.sqrt(i / tries);
      const cand = normalize({
        x: base.x + rng.range(-jitter, jitter),
        y: base.y + rng.range(-jitter, jitter),
        z: base.z + rng.range(-jitter, jitter),
      });
      const e = this.elevation(cand.x, cand.y, cand.z);
      if (this.hasOcean && e < this.seaLevel + this.relief * 0.02) continue;
      if (minAltitude !== null && e < minAltitude) continue;
      const biome = this.biomeAt(cand.x, cand.y, cand.z);
      if (!(BIOMES[biome] || {}).walkable) continue;
      const slope = this.slopeAt(cand.x, cand.y, cand.z);
      const score = slope + (i / tries) * 0.05;
      if (slope <= maxSlope) return { dir: cand, elevation: e, biome, slope };
      if (!best || score < best.score) best = { dir: cand, elevation: e, biome, slope, score };
    }
    return best || { dir: base, elevation: this.elevation(base.x, base.y, base.z), biome: 'rock', slope: 0 };
  }

  /**
   * Landmarks on this world: the city, the landing site, ruins, cave mouths,
   * crashed ships and unmarked oddities (§37 — some have no map marker).
   */
  pointsOfInterest() {
    if (this.poi) return this.poi;
    const p = this.planet;
    const rng = new RNG(hashInts(p.seed, 1201));
    const out = [];

    const randDir = () => {
      const [x, y, z] = rng.onSphere();
      return { x, y, z };
    };

    if (p.hasCity && p.civilization) {
      const site = this.findFlatSite(randDir(), { maxSlope: 0.12, tries: 400, spread: 0.9, seed: 11 });
      const civ = CIV_BY_ID[p.civilization];
      // Radius follows from population rather than being rolled separately —
      // otherwise a quarter-million people ended up in a 500-metre village.
      // ~450 residents per hectare of footprint, which is dense-urban but
      // reasonable for a world where flat, safe ground is the scarce thing.
      const population = rng.int(1200, 240000);
      const radius = Math.max(240, Math.min(2600, Math.sqrt(population / (Math.PI * 0.045))));
      out.push({
        kind: 'city',
        name: cityName(hashInts(p.seed, 3), civ ? civ.phonemes : 'terran'),
        dir: site.dir,
        civilization: p.civilization,
        radius,
        population,
        marked: true,
      });
    }

    // Landing pads: always at least one flat, safe place to set down.
    const padCount = rng.int(1, 3);
    for (let i = 0; i < padCount; i++) {
      const site = this.findFlatSite(randDir(), { maxSlope: 0.1, tries: 300, spread: 1.0, seed: 40 + i });
      out.push({ kind: 'landing_pad', name: `Pad ${String.fromCharCode(65 + i)}`, dir: site.dir, marked: true });
    }

    if (p.hasRuins) {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const site = this.findFlatSite(randDir(), { maxSlope: 0.25, tries: 200, spread: 1.0, seed: 80 + i });
        out.push({
          kind: 'ruins',
          name: 'Unidentified structure',
          dir: site.dir,
          age: rng.int(40000, 3200000),
          looted: false,
          marked: false,            // you have to notice these yourself
        });
      }
    }

    if (p.hasCaves) {
      const n = rng.int(2, 6);
      for (let i = 0; i < n; i++) {
        const site = this.findFlatSite(randDir(), { maxSlope: 0.5, tries: 120, spread: 1.0, seed: 120 + i });
        out.push({ kind: 'cave', name: 'Cave entrance', dir: site.dir, depth: rng.range(200, 2400), marked: false });
      }
    }

    if (rng.chance(0.45)) {
      const site = this.findFlatSite(randDir(), { maxSlope: 0.35, tries: 150, spread: 1.0, seed: 200 });
      out.push({ kind: 'crash_site', name: 'Wreckage', dir: site.dir, salvaged: false, marked: false });
    }

    if (rng.chance(0.3)) {
      const site = this.findFlatSite(randDir(), { maxSlope: 0.4, tries: 150, spread: 1.0, seed: 240 });
      out.push({ kind: 'signal', name: 'Repeating signal', dir: site.dir, decoded: false, marked: false });
    }

    // A resource-rich outcrop worth flying to.
    const survey = this.resourceSurvey();
    if (survey.length) {
      const rich = survey[survey.length - 1];
      const site = this.findFlatSite(randDir(), { maxSlope: 0.4, tries: 150, spread: 1.0, seed: 300 });
      out.push({ kind: 'deposit', name: `${rich.label} deposit`, resource: rich.id, dir: site.dir, marked: true });
    }

    this.poi = out;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function normalize(v) {
  const x = v.x ?? v[0], y = v.y ?? v[1], z = v.z ?? v[2];
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

/** Great-circle surface distance in metres between two directions. */
export function surfaceDistance(radius, a, b) {
  const A = normalize(a), B = normalize(b);
  const dot = Math.max(-1, Math.min(1, A.x * B.x + A.y * B.y + A.z * B.z));
  return Math.acos(dot) * radius;
}

const cache = new Map();
/** Cached surface per planet seed — building one is cheap but not free. */
export function getSurface(planet) {
  let s = cache.get(planet.seed);
  if (!s) {
    s = new PlanetSurface(planet);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    cache.set(planet.seed, s);
  }
  return s;
}
