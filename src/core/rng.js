// Deterministic random helpers. Every procedural system derives its randomness
// from a seed so the same galaxy, planet or creature is generated every time.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashInts(...values) {
  let h = 0x9e3779b9 | 0;
  for (const v of values) {
    h ^= (v | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export function hashMix(seed, label) {
  return hashInts(seed, hashString(String(label)));
}

export class RNG {
  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
    this.s = this.seed;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) {
    return a + (b - a) * this.next();
  }

  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e.w;
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.w;
      if (r <= 0) return e.v;
    }
    return entries[entries.length - 1].v;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Independent stream derived from the original seed, not the current position.
  fork(label) {
    return new RNG(hashMix(this.seed, label));
  }
}

const SYLLABLES = {
  start: ['ka', 've', 'zo', 'ar', 'tel', 'myr', 'sol', 'ith', 'qua', 'dra', 'no', 'bel', 'xe', 'or', 'ul', 'ry', 'sa', 'tor', 'eli', 'va', 'hy', 'cor', 'lum', 'nex'],
  mid: ['ra', 'li', 'on', 'ta', 'ze', 'ma', 'ri', 'the', 'va', 'lo', 'ne', 'ka', 'xi', 'du', 'mi', 'sha', 'por'],
  end: ['us', 'a', 'is', 'on', 'ar', 'eth', 'ia', 'or', 'ix', 'um', 'el', 'os', 'yn', 'ae', 'ok', 'ra'],
};

export function makeName(rng, sets = SYLLABLES, minMid = 0, maxMid = 1) {
  let name = rng.pick(sets.start);
  const mids = rng.int(minMid, maxMid);
  for (let i = 0; i < mids; i++) name += rng.pick(sets.mid);
  name += rng.pick(sets.end);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
