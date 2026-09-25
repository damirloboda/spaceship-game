/**
 * Детерминированный генератор случайных чисел (mulberry32).
 * Вся симуляция использует только Rng, никогда Math.random —
 * поэтому один seed + одинаковые команды игрока = одинаковый мир.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  irange(a: number, b: number): number {
    return a + Math.floor((b - a + 1) * this.next());
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  gauss(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Независимый поток для подсистемы: один seed мира -> много воспроизводимых потоков. */
  fork(salt: number | string): Rng {
    return new Rng(hashSeed(this.s ^ hashSeed(salt)));
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** Хеш строки/числа в 32-битный seed. */
export function hashSeed(v: number | string): number {
  if (typeof v === 'number') {
    let h = v | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  let h = 2166136261;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return hashSeed(h);
}

/** Бессостоятельный хеш координат -> [0,1). Используется для визуальной вариативности и генерации. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash1(x: number, seed = 0): number {
  return hash2(x, 0x51ed27, seed);
}
