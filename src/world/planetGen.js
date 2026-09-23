// Planet surface generator. Pure math (no rendering) so it can be unit tested
// and shared by terrain meshes, collision, flora placement and AI.
import { Noise3 } from '../core/noise.js';
import { RNG, clamp, smoothstep, lerp } from '../core/rng.js';

// Colours are authored in sRGB and converted to linear once.
const toLin = (c) => c.map((v) => Math.pow(v, 2.2));

export const BIOMES = {
  seabed: { color: [0.36, 0.33, 0.26], material: 'sand' },
  beach: { color: [0.8, 0.73, 0.52], material: 'sand' },
  grassland: { color: [0.36, 0.56, 0.2], material: 'grass' },
  forest: { color: [0.2, 0.4, 0.15], material: 'grass' },
  savanna: { color: [0.58, 0.55, 0.3], material: 'grass' },
  wetland: { color: [0.25, 0.33, 0.18], material: 'mud' },
  rock: { color: [0.43, 0.41, 0.39], material: 'rock' },
  snow: { color: [0.93, 0.95, 0.98], material: 'snow' },
  tundra: { color: [0.55, 0.57, 0.5], material: 'rock' },
  desert: { color: [0.85, 0.66, 0.42], material: 'sand' },
  dunes: { color: [0.9, 0.72, 0.46], material: 'sand' },
  mesa: { color: [0.66, 0.38, 0.24], material: 'rock' },
  ice: { color: [0.72, 0.84, 0.95], material: 'ice' },
  glacier: { color: [0.86, 0.93, 1.0], material: 'snow' },
  basalt: { color: [0.14, 0.12, 0.12], material: 'rock' },
  lavafield: { color: [0.95, 0.35, 0.08], material: 'rock' },
  ash: { color: [0.3, 0.28, 0.27], material: 'sand' },
  mire: { color: [0.36, 0.5, 0.16], material: 'mud' },
  toxicflat: { color: [0.62, 0.7, 0.22], material: 'mud' },
  fungal: { color: [0.5, 0.3, 0.52], material: 'organic' },
  sporefield: { color: [0.72, 0.5, 0.62], material: 'organic' },
  crystal: { color: [0.62, 0.78, 0.9], material: 'crystal' },
  glowmoss: { color: [0.1, 0.32, 0.36], material: 'organic' },
  regolith: { color: [0.5, 0.49, 0.47], material: 'rock' },
  irradiated: { color: [0.55, 0.6, 0.25], material: 'rock' },
  storm: { color: [0.32, 0.3, 0.45], material: 'metal' },
  cloudtop: { color: [0.82, 0.78, 0.7], material: 'sand' },
};
// Detail texture layer per biome: 0 grass/organic, 1 rock, 2 sand/soil, 3 snow/ice.
const LAYER_OF = { sand: 2, grass: 0, mud: 2, rock: 1, snow: 3, ice: 3, crystal: 1, organic: 0, metal: 1 };
for (const b of Object.values(BIOMES)) { b.lin = toLin(b.color); b.layer = LAYER_OF[b.material] ?? 1; }

export class PlanetSurface {
  constructor(def) {
    this.def = def;
    this.radius = def.radius;
    this.t = def.terrain;
    this.amp = def.terrain.amplitude;
    this.hasOcean = !!def.ocean;
    const rng = new RNG(def.seed);
    this.nContinent = new Noise3(rng.int(1, 1e9));
    this.nMountain = new Noise3(rng.int(1, 1e9));
    this.nHills = new Noise3(rng.int(1, 1e9));
    this.nDetail = new Noise3(rng.int(1, 1e9));
    this.nMoist = new Noise3(rng.int(1, 1e9));
    this.nCrater = new Noise3(rng.int(1, 1e9));
    this.flatZones = [];
    this.detailFreq = this.radius / 45;
    this.fineFreq = this.radius / 14;
    this.maxHeight = this.amp * 2.2;
    this.minHeight = -this.amp * 1.1;
  }

  addFlatZone(dir, radius, height, falloff = radius) {
    this.flatZones.push({ x: dir[0], y: dir[1], z: dir[2], radius, height, falloff });
  }

  // Height above the base radius, in metres, for a unit direction.
  rawHeight(x, y, z) {
    const t = this.t;
    const amp = this.amp;
    const cf = t.continentFreq;
    let c = this.nContinent.fbm(x * cf, y * cf, z * cf, 5) + t.seaBias;
    let h;
    if (this.hasOcean) {
      // Push continents up and oceans down for readable coastlines.
      h = c > 0 ? c * amp * 0.55 : c * amp * 0.9;
    } else {
      h = c * amp * 0.5;
    }
    const mf = t.mountainFreq;
    const land = smoothstep(-0.02, 0.3, c);
    const r = this.nMountain.ridged(x * mf, y * mf, z * mf, 5);
    h += r * r * amp * 1.35 * t.ridgeWeight * land;
    h += this.nHills.fbm(x * mf * 3.5, y * mf * 3.5, z * mf * 3.5, 4) * amp * 0.1;
    const df = this.detailFreq;
    h += this.nDetail.noise(x * df, y * df, z * df) * 1.6;
    const ff = this.fineFreq;
    h += this.nDetail.noise(x * ff + 17.1, y * ff, z * ff) * 0.35;
    if (t.craters > 0) {
      const cr = this.nCrater.noise(x * 9, y * 9, z * 9);
      const bowl = smoothstep(0.45, 0.85, cr);
      const rim = smoothstep(0.3, 0.45, cr) * (1 - smoothstep(0.45, 0.6, cr));
      h += (rim * 0.25 - bowl * 0.6) * amp * t.craters;
    }
    if (this.def.type === 'crystal') {
      const s = this.nHills.ridged(x * 40, y * 40, z * 40, 2);
      h += Math.pow(s, 6) * amp * 0.25;
    }
    return h;
  }

  heightAt(x, y, z) {
    let h = this.rawHeight(x, y, z);
    const zones = this.flatZones;
    for (let i = 0; i < zones.length; i++) {
      const zn = zones[i];
      const dx = x - zn.x, dy = y - zn.y, dz = z - zn.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.radius;
      if (d < zn.radius + zn.falloff) {
        const k = 1 - smoothstep(zn.radius, zn.radius + zn.falloff, d);
        h = lerp(h, zn.height, k);
      }
    }
    return h;
  }

  // Radius of the solid surface (ignores water).
  groundRadius(x, y, z) {
    return this.radius + this.heightAt(x, y, z);
  }

  moistureAt(x, y, z) {
    return this.nMoist.fbm(x * 3.1, y * 3.1, z * 3.1, 3) * 0.5 + 0.5;
  }

  // Biome id for a direction and height. slope in [0,1] (0 = flat).
  biomeAt(x, y, z, h, slope = 0) {
    const type = this.def.type;
    const amp = this.amp;
    const lat = Math.abs(y);
    const m = this.moistureAt(x, y, z);
    const hn = h / amp;
    switch (type) {
      case 'terran':
      case 'ocean':
        if (this.hasOcean && h < -1.5) return 'seabed';
        if (this.hasOcean && h < 5) return 'beach';
        if (hn > 0.95 || (lat > 0.86 && hn > 0.05) || lat > 0.93) return 'snow';
        if (slope > 0.35 || hn > 0.7) return 'rock';
        if (lat > 0.75) return 'tundra';
        if (m > 0.62) return 'forest';
        if (m < 0.36) return 'savanna';
        if (m > 0.55 && hn < 0.08) return 'wetland';
        return 'grassland';
      case 'desert':
        if (slope > 0.3 || hn > 0.6) return 'mesa';
        if (m > 0.55) return 'dunes';
        return 'desert';
      case 'ice':
      case 'supercold':
        if (slope > 0.38) return 'rock';
        if (m > 0.6) return 'glacier';
        return hn > 0.2 ? 'snow' : 'ice';
      case 'lava':
      case 'superhot':
        if (hn < -0.05) return 'lavafield';
        if (m > 0.6) return 'ash';
        return 'basalt';
      case 'toxic':
        if (this.hasOcean && h < 2) return 'mire';
        return m > 0.5 ? 'toxicflat' : 'rock';
      case 'radioactive':
        return m > 0.45 ? 'irradiated' : 'regolith';
      case 'electric':
        return m > 0.5 ? 'storm' : 'basalt';
      case 'fungal':
        if (this.hasOcean && h < 4) return 'mire';
        return m > 0.5 ? 'fungal' : 'sporefield';
      case 'crystal':
        return slope > 0.3 || m > 0.55 ? 'crystal' : 'regolith';
      case 'bioluminescent':
        if (this.hasOcean && h < 4) return 'beach';
        return m > 0.45 ? 'glowmoss' : 'forest';
      case 'cloud':
        return 'cloudtop';
      default:
        if (slope > 0.4) return 'rock';
        return lat > 0.85 && this.def.type === 'ice' ? 'ice' : 'regolith';
    }
  }

  // Linear RGB into out[offset..offset+2] with subtle variation.
  colorAt(x, y, z, h, slope, out, offset) {
    const biome = this.biomeAt(x, y, z, h, slope);
    const base = BIOMES[biome].lin;
    // Two scales of tint variation so large fields do not look flat.
    const v = 0.86 + this.nDetail.noise(x * 180, y * 180, z * 180) * 0.1 + this.nMoist.noise(x * 40, y * 40, z * 40) * 0.08;
    const warm = this.nHills.noise(x * 25 + 3, y * 25, z * 25) * 0.06;
    // Blend rock into steep slopes for readability.
    const rockMix = clamp((slope - 0.25) * 2.2, 0, 0.6);
    const rock = BIOMES.rock.lin;
    out[offset] = lerp(base[0], rock[0], rockMix) * v * (1 + warm);
    out[offset + 1] = lerp(base[1], rock[1], rockMix) * v;
    out[offset + 2] = lerp(base[2], rock[2], rockMix) * v * (1 - warm);
    return biome;
  }

  // Detail-texture blend weights (grass, rock, sand, snow) for a biome and slope.
  layerWeights(biome, slope, out, offset) {
    const rock = clamp((slope - 0.22) * 2.5, 0, 1);
    const l = BIOMES[biome].layer;
    out[offset] = 0; out[offset + 1] = 0; out[offset + 2] = 0; out[offset + 3] = 0;
    out[offset + l] += 1 - rock;
    out[offset + 1] += rock;
  }

  materialAt(x, y, z) {
    const h = this.heightAt(x, y, z);
    return BIOMES[this.biomeAt(x, y, z, h, 0)].material;
  }

  // Estimate slope (0..1) by sampling neighbours `step` metres away.
  slopeAt(x, y, z, step = 4) {
    const e = step / this.radius;
    const h0 = this.heightAt(x, y, z);
    // Build two tangents from an arbitrary helper axis.
    let tx = -z, ty = 0, tz = x;
    if (Math.abs(y) > 0.9) { tx = 1; ty = 0; tz = 0; }
    let l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
    const bx = y * tz - z * ty, by = z * tx - x * tz, bz = x * ty - y * tx;
    const h1 = this.heightAt(x + tx * e, y + ty * e, z + tz * e);
    const h2 = this.heightAt(x + bx * e, y + by * e, z + bz * e);
    const g = Math.hypot(h1 - h0, h2 - h0) / step;
    return clamp(g, 0, 1);
  }

  // Deterministic search for flat, dry land (city, landing pads).
  findSite(label, { minH = 30, maxH = 220, near = null, maxAngle = Math.PI, tries = 400 } = {}) {
    const rng = new RNG(this.def.seed ^ label.length * 7919);
    let best = null;
    for (let i = 0; i < tries; i++) {
      let x, y, z;
      if (near) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.1, 1) * maxAngle;
        // tangent basis at `near`
        const [nx, ny, nz] = near;
        let tx = -nz, ty = 0, tz = nx;
        if (Math.abs(ny) > 0.9) { tx = 1; ty = 0; tz = 0; }
        let l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
        const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
        x = nx + (tx * Math.cos(a) + bx * Math.sin(a)) * d;
        y = ny + (ty * Math.cos(a) + by * Math.sin(a)) * d;
        z = nz + (tz * Math.cos(a) + bz * Math.sin(a)) * d;
      } else {
        // Uniform on sphere, but keep away from the poles.
        y = rng.range(-0.55, 0.55);
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(1 - y * y);
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
      const l = Math.hypot(x, y, z);
      x /= l; y /= l; z /= l;
      const h = this.rawHeight(x, y, z);
      if (h < minH || h > maxH) continue;
      const s = this.slopeAtRaw(x, y, z, 60);
      const score = s + Math.abs(h - (minH + maxH) / 2) / 2000;
      if (!best || score < best.score) best = { dir: [x, y, z], height: h, score };
    }
    return best;
  }

  slopeAtRaw(x, y, z, step) {
    const e = step / this.radius;
    const h0 = this.rawHeight(x, y, z);
    const h1 = this.rawHeight(x + e, y, z);
    const h2 = this.rawHeight(x, y + e, z);
    const h3 = this.rawHeight(x, y, z + e);
    return (Math.abs(h1 - h0) + Math.abs(h2 - h0) + Math.abs(h3 - h0)) / step;
  }
}

// Rough 2D tangent-frame helper used by city/site layout. Returns unit vectors.
export function tangentFrame(dir) {
  const [x, y, z] = dir;
  // east = normalize(cross(Y, up)); fall back near the poles
  let ex = z, ey = 0, ez = -x;
  let l = Math.hypot(ex, ey, ez);
  if (l < 1e-4) { ex = 1; ey = 0; ez = 0; l = 1; }
  ex /= l; ey /= l; ez /= l;
  // north = cross(up, east)
  const nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex;
  return { up: [x, y, z], east: [ex, ey, ez], north: [nx, ny, nz] };
}

export function offsetOnSphere(dir, frame, eastM, northM, radius) {
  const x = dir[0] + (frame.east[0] * eastM + frame.north[0] * northM) / radius;
  const y = dir[1] + (frame.east[1] * eastM + frame.north[1] * northM) / radius;
  const z = dir[2] + (frame.east[2] * eastM + frame.north[2] * northM) / radius;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}
