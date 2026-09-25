import { Rng } from '../core/Rng';
import { SpriteBatch, K } from './SpriteBatch';

/** Частицы на CPU с пулом: пыль копания, пыль обвала, брызги, листья на ветру. */
export class Particles {
  private n = 0;
  private cap = 6000;
  private x = new Float32Array(this.cap);
  private y = new Float32Array(this.cap);
  private vx = new Float32Array(this.cap);
  private vy = new Float32Array(this.cap);
  private life = new Float32Array(this.cap);
  private max = new Float32Array(this.cap);
  private kind = new Uint8Array(this.cap);
  private mat = new Uint8Array(this.cap);
  private size = new Float32Array(this.cap);
  private rng = new Rng(99);

  spawn(kind: number, x: number, y: number, vx: number, vy: number, life: number, size: number, mat = 1): void {
    let i: number;
    if (this.n < this.cap) i = this.n++;
    else i = this.rng.int(this.cap);
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.mat[i] = mat;
  }

  dig(x: number, y: number, mat: number): void {
    for (let k = 0; k < 4; k++) this.spawn(K.DUST, x + this.rng.range(-0.4, 0.4), y + this.rng.range(-0.4, 0.4), this.rng.range(-1.5, 1.5), this.rng.range(-3, 0), 0.6 + this.rng.next() * 0.5, 0.25 + this.rng.next() * 0.2, mat);
  }

  dust(x: number, y: number, n: number): void {
    for (let k = 0; k < n; k++) this.spawn(K.DUST, x + this.rng.range(-6, 6), y + this.rng.range(-4, 4), this.rng.range(-4, 4), this.rng.range(-5, 1), 1.2 + this.rng.next(), 0.6 + this.rng.next() * 0.9, 20);
  }

  splash(x: number, y: number): void {
    for (let k = 0; k < 2; k++) this.spawn(K.DROP, x, y, this.rng.range(-3, 3), this.rng.range(-6, -2), 0.35, 0.18, 0);
  }

  leaf(x: number, y: number, wind: number): void {
    this.spawn(K.LEAF, x, y, wind * 6 + this.rng.range(-1, 1), this.rng.range(0.5, 2), 6, 0.5 + this.rng.next() * 0.4, 7);
  }

  petal(x: number, y: number, wind: number): void {
    this.spawn(33, x, y, wind * 5 + this.rng.range(-1, 1), this.rng.range(0.4, 1.4), 9, 0.45 + this.rng.next() * 0.25, 28);
  }

  firefly(x: number, y: number): void {
    this.spawn(37, x, y, this.rng.range(-1.5, 1.5), this.rng.range(-1, 1), 8 + this.rng.next() * 6, 0.9 + this.rng.next() * 0.5, 0);
  }

  mote(x: number, y: number): void {
    this.spawn(38, x, y, this.rng.range(-0.3, 0.3), this.rng.range(-0.2, 0.2), 6 + this.rng.next() * 4, 0.35 + this.rng.next() * 0.3, 0);
  }

  update(dt: number, solid: (x: number, y: number) => boolean, wind: number): void {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const k = this.kind[i];
      if (k === K.LEAF || k === 33) {
        // лёгкое тело: сопротивление воздуха сильнее тяжести, парит и кружится
        this.vx[i] += (wind * 6 + Math.sin(this.life[i] * 2.3 + i) * 1.5 - this.vx[i]) * dt;
        this.vy[i] = (k === 33 ? 0.9 : 1.2) + Math.sin(this.life[i] * 3 + i) * 0.8;
      } else if (k === 37) {
        this.vx[i] += (Math.sin(this.life[i] * 1.3 + i * 7) * 1.2 - this.vx[i]) * dt;
        this.vy[i] += (Math.cos(this.life[i] * 1.7 + i * 3) * 0.8 - this.vy[i]) * dt;
      } else if (k === 38) {
        this.vx[i] += (wind * 0.6 - this.vx[i]) * dt * 0.3;
      } else this.vy[i] += (k === K.DUST ? 6 : 30) * dt;
      const nx = this.x[i] + this.vx[i] * dt;
      const ny = this.y[i] + this.vy[i] * dt;
      if (solid(nx, ny)) {
        this.vx[i] *= 0.3;
        this.vy[i] = 0;
        if (k === K.LEAF || k === 33) this.life[i] = Math.min(this.life[i], 1.5);
      } else {
        this.x[i] = nx;
        this.y[i] = ny;
      }
      if (w !== i) {
        this.x[w] = this.x[i]; this.y[w] = this.y[i]; this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
        this.life[w] = this.life[i]; this.max[w] = this.max[i]; this.kind[w] = this.kind[i]; this.mat[w] = this.mat[i]; this.size[w] = this.size[i];
      }
      w++;
    }
    this.n = w;
  }

  draw(b: SpriteBatch, x0: number, y0: number, x1: number, y1: number): void {
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i];
      const y = this.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const a = Math.round(Math.min(1, this.life[i] / this.max[i] * 1.5) * 255);
      const k = this.kind[i];
      b.push(x, y, 0, this.size[i], k, k === K.LEAF || k === 33 ? Math.round(this.life[i] * 40) : a, 0, 0, 0, this.mat[i], 0, (i * 37) & 255);
    }
  }

  get count(): number {
    return this.n;
  }
}
