import { smoothstep } from '../core/MathUtil';

/** Время суток. 0 — полночь, 0.25 — рассвет, 0.5 — полдень, 0.75 — закат. */
export class Clock {
  dayLength = 420;
  time = 0;
  /** начинаем утром */
  offset = 0.3;

  get tod(): number {
    return ((this.time / this.dayLength + this.offset) % 1 + 1) % 1;
  }

  get day(): number {
    return Math.floor(this.time / this.dayLength + this.offset) + 1;
  }

  /** Освещённость неба 0..1 */
  light(): number {
    const t = this.tod;
    const sunUp = smoothstep(0.2, 0.3, t) * (1 - smoothstep(0.72, 0.82, t));
    return 0.08 + 0.92 * sunUp;
  }

  isNight(): boolean {
    return this.light() < 0.3;
  }

  label(): string {
    const t = this.tod;
    const h = Math.floor(t * 24);
    const m = Math.floor((t * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
