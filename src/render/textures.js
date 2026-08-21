/**
 * Procedural textures (§103, §115).
 *
 * Every texture in the game is generated at runtime on a canvas rather than
 * downloaded. That keeps the build asset-free and licence-clean (§115 forbids
 * unlicensed assets), keeps the game playable offline, and lets a texture take
 * its colours from the planet it is actually on — the same rock texture tints
 * itself red on a lava world and grey on a moon.
 *
 * Everything is cached by cache key, so a given texture is rasterised once per
 * session no matter how many meshes use it.
 */
import * as THREE from '../../vendor/three.module.js';

const CACHE = new Map();

function cached(key, build) {
  let t = CACHE.get(key);
  if (!t) {
    t = build();
    CACHE.set(key, t);
  }
  return t;
}

/** Deterministic value noise on a 2D grid, tileable by wrapping the lattice. */
function valueNoise2D(width, height, cells, seed) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  let s = (seed >>> 0) || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      // Wrap the last row/column onto the first so the texture tiles.
      grid[y * (cells + 1) + x] = (x === cells || y === cells)
        ? grid[(y % cells) * (cells + 1) + (x % cells)]
        : rnd();
    }
  }
  const out = new Float32Array(width * height);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < height; y++) {
    const gy = (y / height) * cells;
    const y0 = Math.floor(gy), fy = smooth(gy - y0);
    for (let x = 0; x < width; x++) {
      const gx = (x / width) * cells;
      const x0 = Math.floor(gx), fx = smooth(gx - x0);
      const a = grid[y0 * (cells + 1) + x0];
      const b = grid[y0 * (cells + 1) + x0 + 1];
      const c = grid[(y0 + 1) * (cells + 1) + x0];
      const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      out[y * width + x] = (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    }
  }
  return out;
}

/** Sum several octaves of value noise into one [0,1] field. */
function fbmField(size, seed, octaves = 4, baseCells = 4) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise2D(size, size, cells, seed + o * 7919);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  return c;
}

function finish(canvas, repeat = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 16;
  return tex;
}

/**
 * A general-purpose speckled surface texture. `roughness` controls how much
 * high-frequency grain is layered on top of the broad blotches.
 */
export function surfaceTexture(key, {
  size = 256, seed = 1, grain = 0.35, contrast = 0.5, repeat = 1,
  min = 0, max = 1,
} = {}) {
  return cached(`surface:${key}`, () => {
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    const broad = fbmField(size, seed, 4, 3);
    const fine = fbmField(size, seed + 13, 3, 16);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      let v = broad[i] * (1 - grain) + fine[i] * grain;
      v = 0.5 + (v - 0.5) * (1 + contrast);
      // Remap into [min,max]. Ground detail is deliberately kept in a narrow
      // bright band: a full-range high-contrast noise tiled across open
      // terrain turns into severe moiré streaks at the grazing angles you
      // actually view ground at, no amount of anisotropy fixes it.
      v = min + Math.max(0, Math.min(1, v)) * (max - min);
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      img.data[i * 4] = b; img.data[i * 4 + 1] = b; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, repeat);
  });
}

/**
 * Building facade: dark wall with a grid of lit and unlit windows.
 * Used as an emissive map so lit windows glow at night (§21, §23).
 */
export function facadeTexture(seed = 1, accent = '#7fd3ff') {
  return cached(`facade:${seed}:${accent}`, () => {
    const size = 256;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, size, size);

    let s = (seed >>> 0) || 1;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

    const cols = 8, rows = 12;
    const cw = size / cols, ch = size / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rnd() > 0.62) continue;                 // dark window
        const bright = 0.35 + rnd() * 0.65;
        ctx.globalAlpha = bright;
        ctx.fillStyle = rnd() > 0.75 ? accent : '#ffd9a0';
        ctx.fillRect(x * cw + cw * 0.22, y * ch + ch * 0.22, cw * 0.56, ch * 0.5);
      }
    }
    ctx.globalAlpha = 1;
    return finish(canvas);
  });
}

/** Brushed metal for ship hulls and stations. */
export function metalTexture(seed = 1) {
  return cached(`metal:${seed}`, () => {
    const size = 256;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    const field = fbmField(size, seed, 3, 6);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        // Stretch the noise horizontally so it reads as a brushed finish.
        const streak = field[y * size + ((x * 4) % size)] * 0.5 + field[i] * 0.5;
        const b = Math.round((0.55 + streak * 0.45) * 255);
        img.data[i * 4] = b; img.data[i * 4 + 1] = b; img.data[i * 4 + 2] = Math.min(255, b + 8);
        img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Panel seams.
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (size / 4) * i); ctx.lineTo(size, (size / 4) * i);
      ctx.moveTo((size / 4) * i, 0); ctx.lineTo((size / 4) * i, size);
      ctx.stroke();
    }
    return finish(canvas);
  });
}

/** Foliage canopy — mottled leaf clumps with soft alpha edges. */
export function foliageTexture(seed = 1) {
  return cached(`foliage:${seed}`, () => {
    const size = 128;
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    const field = fbmField(size, seed, 3, 8);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = field[i];
      const b = Math.round((0.45 + v * 0.55) * 255);
      img.data[i * 4] = b; img.data[i * 4 + 1] = b; img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas);
  });
}

/**
 * Derive a cheap normal map from a greyscale texture's canvas by finite
 * differences. Gives terrain and hulls surface relief without any extra art.
 */
export function normalFromCanvas(key, canvas, strength = 2.2) {
  return cached(`normal:${key}`, () => {
    const size = canvas.width;
    const src = canvas.getContext('2d').getImageData(0, 0, size, size).data;
    const out = makeCanvas(size);
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(size, size);
    const at = (x, y) => src[((y & (size - 1)) * size + (x & (size - 1))) * 4] / 255;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1) || 1;
        const i = (y * size + x) * 4;
        img.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
        img.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
        img.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(out);
  });
}

/** Ground detail texture chosen to suit a planet class. */
export function groundTextureFor(planet) {
  const seed = (planet.seed >>> 0) % 100000;
  // Narrow brightness band (see surfaceTexture): enough grain to break up a
  // flat field up close, too subtle to alias into streaks at distance.
  const opts = { seed, min: 0.80, max: 1.0 };
  switch (planet.class) {
    case 'desert': case 'scorched':
      return surfaceTexture(`sand${seed}`, { ...opts, grain: 0.55, contrast: 0.25 });
    case 'ice': case 'frozen_ocean':
      return surfaceTexture(`ice${seed}`, { ...opts, grain: 0.2, contrast: 0.2 });
    case 'lava': case 'barren': case 'radioactive':
      return surfaceTexture(`rock${seed}`, { ...opts, grain: 0.5, contrast: 0.5, min: 0.72 });
    default:
      return surfaceTexture(`ground${seed}`, { ...opts, grain: 0.42, contrast: 0.35 });
  }
}
