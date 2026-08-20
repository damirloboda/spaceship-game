/**
 * ULTRA COSMOS — deterministic random & noise.
 *
 * Every procedural object in the galaxy is derived from a 32-bit seed, so the
 * same coordinates always produce the same world on every device and in every
 * session. Nothing here touches Math.random().
 */

/** FNV-1a style string hash -> uint32. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mix an arbitrary number of integers into one uint32 seed. */
export function hashInts(...ints) {
  let h = 2166136261 >>> 0;
  for (const v of ints) {
    let x = (v | 0) >>> 0;
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
      x >>>= 8;
    }
  }
  // final avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mulberry32 — small, fast, good enough for content generation and fully
 * reproducible across engines.
 */
export class RNG {
  constructor(seed = 1) {
    this.seed = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;
    this.state = this.seed;
  }

  /** Fresh generator derived from this one plus a label (no state shared). */
  derive(label) {
    return new RNG(hashInts(this.seed, hashString(String(label))));
  }

  /** Uniform float in [0,1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min,max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min,max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Uniform element of an array. */
  pick(arr) {
    if (!arr.length) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Weighted pick. `entries` is [[value, weight], ...] or an object of
   * value->weight. Weights need not sum to 1.
   */
  weighted(entries) {
    const list = Array.isArray(entries) ? entries : Object.entries(entries);
    let total = 0;
    for (const [, w] of list) total += w;
    if (total <= 0) return list.length ? list[0][0] : undefined;
    let r = this.next() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r <= 0) return v;
    }
    return list[list.length - 1][0];
  }

  /** Fisher-Yates, in place, returns the same array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Approximately normal (Irwin-Hall), mean 0 sigma 1. */
  gaussian() {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) / 0.7071;
  }

  /** Uniform point on the unit sphere. */
  onSphere() {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(a), r * Math.sin(a), z];
  }
}

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

/*
 * Terrain sampling is the hottest path in the game: every terrain vertex and
 * every collision query runs `elevation()`, which is ~15 noise evaluations.
 * Hashing lattice points arithmetically (hashInts) cost ~12 multiplies per
 * gradient and capped us at 0.27M samples/s — roughly 4 seconds to build one
 * planet's worth of chunks. A seeded permutation table turns each gradient
 * lookup into three array reads and gets us an order of magnitude back.
 */

const PERM_CACHE = new Map();
const PERM_CACHE_MAX = 64;
let lastPermSeed = -1;
let lastPerm = null;

/** 512-entry seeded permutation table (doubled to avoid an index wrap). */
export function permFor(seed) {
  const s = seed >>> 0;
  if (s === lastPermSeed) return lastPerm;
  let perm = PERM_CACHE.get(s);
  if (!perm) {
    const rng = new RNG(s || 1);
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = src[i]; src[i] = src[j]; src[j] = t;
    }
    perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = src[i & 255];
    if (PERM_CACHE.size >= PERM_CACHE_MAX) PERM_CACHE.delete(PERM_CACHE.keys().next().value);
    PERM_CACHE.set(s, perm);
  }
  lastPermSeed = s;
  lastPerm = perm;
  return perm;
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14) ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Perlin gradient noise, roughly [-1,1]. Takes a prepared permutation table so
 * fractal loops pay the table lookup once instead of once per octave.
 */
function perlin(perm, x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const rx = x - X, ry = y - Y, rz = z - Z;
  X &= 255; Y &= 255; Z &= 255;

  const u = fade(rx), v = fade(ry), w = fade(rz);

  const A = perm[X] + Y, AA = perm[A & 255] + Z, AB = perm[(A + 1) & 255] + Z;
  const B = perm[(X + 1) & 255] + Y, BA = perm[B & 255] + Z, BB = perm[(B + 1) & 255] + Z;

  const n000 = grad(perm[AA & 255], rx, ry, rz);
  const n100 = grad(perm[BA & 255], rx - 1, ry, rz);
  const n010 = grad(perm[AB & 255], rx, ry - 1, rz);
  const n110 = grad(perm[BB & 255], rx - 1, ry - 1, rz);
  const n001 = grad(perm[(AA + 1) & 255], rx, ry, rz - 1);
  const n101 = grad(perm[(BA + 1) & 255], rx - 1, ry, rz - 1);
  const n011 = grad(perm[(AB + 1) & 255], rx, ry - 1, rz - 1);
  const n111 = grad(perm[(BB + 1) & 255], rx - 1, ry - 1, rz - 1);

  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return (y0 + w * (y1 - y0)) * 1.15;      // normalise toward [-1,1]
}

/**
 * Classic gradient (Perlin) noise in 3D. Stateless: same seed + coords always
 * give the same value, which is what lets CPU collision match the GPU mesh.
 */
export function noise3(seed, x, y, z) {
  return perlin(permFor(seed), x, y, z);
}

// Per-octave coordinate offsets. Shifting coordinates decorrelates octaves
// without needing a different permutation table (and cache miss) per octave.
const OCT_OFF = [
  [0, 0, 0], [37.3, 11.7, 91.1], [-63.9, 47.2, 17.5], [113.1, -29.4, 55.8],
  [-21.6, 83.3, -71.2], [59.4, -95.1, 33.6], [7.9, 61.4, -13.7], [-88.2, 5.6, 77.4],
];

/** Fractal Brownian motion. Returns roughly [-1,1]. */
export function fbm(seed, x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  const perm = permFor(seed);
  let amp = 1, freq = 1, sum = 0, norm = 0;
  const n = Math.min(octaves, OCT_OFF.length);
  for (let i = 0; i < n; i++) {
    const o = OCT_OFF[i];
    sum += amp * perlin(perm, x * freq + o[0], y * freq + o[1], z * freq + o[2]);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged multifractal — sharp mountain crests. Returns roughly [0,1]. */
export function ridged(seed, x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  const perm = permFor(seed);
  let amp = 1, freq = 1, sum = 0, norm = 0;
  const n = Math.min(octaves, OCT_OFF.length);
  for (let i = 0; i < n; i++) {
    const o = OCT_OFF[i];
    const v = 1 - Math.abs(perlin(perm, x * freq + o[0], y * freq + o[1], z * freq + o[2]));
    sum += amp * v * v;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Worley / cellular noise (F1 distance) for craters, cave chambers and crystal
 * fields. Returns [0,1], 0 at a cell centre. Feature points come from the same
 * permutation table rather than an integer hash, for the same speed reason.
 */
export function worley3(seed, x, y, z) {
  const perm = permFor(seed);
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  let best = 4;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = fx + dx, cy = fy + dy, cz = fz + dz;
        const h = perm[(perm[(perm[cx & 255] + cy) & 255] + cz) & 255];
        const h2 = perm[(h + cx) & 255];
        const h3 = perm[(h2 + cy) & 255];
        const px = cx + h / 255, py = cy + h2 / 255, pz = cz + h3 / 255;
        const ddx = px - x, ddy = py - y, ddz = pz - z;
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}
