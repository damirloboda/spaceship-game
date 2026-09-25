import { hash2 } from './Rng';

/** Сглаженный value-noise + fBm. Детерминирован от seed. */
export class Noise {
  constructor(private readonly seed: number) {}

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  value2(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = this.seed;
    const a = hash2(xi, yi, s);
    const b = hash2(xi + 1, yi, s);
    const c = hash2(xi, yi + 1, s);
    const d = hash2(xi + 1, yi + 1, s);
    const u = Noise.fade(xf);
    const v = Noise.fade(yf);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; // [0,1)
  }

  value1(x: number): number {
    return this.value2(x, 17.31);
  }

  /** fBm в диапазоне примерно [0,1). */
  fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value2(x * freq + i * 31.7, y * freq - i * 17.3);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  fbm1(x: number, octaves = 4): number {
    return this.fbm2(x, 3.7, octaves);
  }

  /** "Гребневой" шум — хорош для извилистых пещер. */
  ridged2(x: number, y: number, octaves = 3): number {
    let amp = 0.5;
    let freq = 1;
    let sum = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.value2(x * freq, y * freq) * 2 - 1);
      sum += n * n * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }
}
