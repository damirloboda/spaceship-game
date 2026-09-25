import { Rng } from '../core/Rng';
import { EventBus } from '../core/EventBus';
import { Water } from '../physics/Water';
import { Terrain } from '../world/Terrain';
import { Zone } from '../world/Zones';
import { Clock } from './Clock';

export const WK = { CLEAR: 0, CLOUDY: 1, RAIN: 2, STORM: 3, FOG: 4, HEAT: 5, COLD: 6, WIND: 7 } as const;
export const WEATHER_NAMES = ['Ясно', 'Облачно', 'Дождь', 'Ливень', 'Туман', 'Жара', 'Холод', 'Ветер'];

const TRANSITIONS: number[][] = [
  // CLEAR CLOUDY RAIN STORM FOG HEAT COLD WIND
  [0.3, 0.3, 0.05, 0.0, 0.08, 0.14, 0.05, 0.08],
  [0.3, 0.15, 0.3, 0.08, 0.07, 0.0, 0.05, 0.05],
  [0.1, 0.35, 0.25, 0.2, 0.05, 0.0, 0.0, 0.05],
  [0.05, 0.3, 0.45, 0.1, 0.0, 0.0, 0.0, 0.1],
  [0.5, 0.3, 0.1, 0.0, 0.05, 0.0, 0.05, 0.0],
  [0.4, 0.3, 0.05, 0.15, 0.0, 0.1, 0.0, 0.0],
  [0.4, 0.3, 0.1, 0.0, 0.15, 0.0, 0.05, 0.0],
  [0.35, 0.3, 0.15, 0.1, 0.0, 0.0, 0.0, 0.1],
];

/**
 * Погода — марковская цепь состояний с плавными параметрами.
 * Дождь реально льёт воду в мир (в открытые небу колонки), ветер качает растения
 * и сносит семена, жара ускоряет испарение, туман сокращает дальность чутья.
 */
export class WeatherSystem {
  kind: number = WK.CLEAR;
  rain = 0;
  wind = 0.1;
  fog = 0;
  cloud = 0.1;
  tempOffset = 0;
  private target = { rain: 0, wind: 0.1, fog: 0, cloud: 0.1, temp: 0 };
  private timer = 90;
  rainScale = 1;
  thunder = 0;

  constructor(private rng: Rng, private bus: EventBus) {}

  setKind(k: number): void {
    this.kind = k;
    const T = this.target;
    const sgn = this.rng.sign();
    switch (k) {
      case WK.CLEAR: Object.assign(T, { rain: 0, wind: 0.1 * sgn, fog: 0, cloud: 0.05, temp: 0 }); break;
      case WK.CLOUDY: Object.assign(T, { rain: 0, wind: 0.25 * sgn, fog: 0, cloud: 0.6, temp: -2 }); break;
      case WK.RAIN: Object.assign(T, { rain: 0.45, wind: 0.3 * sgn, fog: 0.15, cloud: 0.85, temp: -4 }); break;
      case WK.STORM: Object.assign(T, { rain: 1, wind: 0.9 * sgn, fog: 0.25, cloud: 1, temp: -6 }); break;
      case WK.FOG: Object.assign(T, { rain: 0, wind: 0.02, fog: 0.8, cloud: 0.5, temp: -3 }); break;
      case WK.HEAT: Object.assign(T, { rain: 0, wind: 0.05, fog: 0, cloud: 0, temp: 12 }); break;
      case WK.COLD: Object.assign(T, { rain: 0, wind: 0.3 * sgn, fog: 0.1, cloud: 0.4, temp: -14 }); break;
      case WK.WIND: Object.assign(T, { rain: 0, wind: 1 * sgn, fog: 0, cloud: 0.3, temp: -2 }); break;
    }
    this.timer = 70 + this.rng.next() * 150;
    this.bus.emit({ type: 'weather', kind: k });
  }

  update(dt: number, t: Terrain, water: Water, zones: Zone[], clock: Clock): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      const row = TRANSITIONS[this.kind];
      let r = this.rng.next();
      let next = 0;
      for (let k = 0; k < row.length; k++) { r -= row[k]; if (r <= 0) { next = k; break; } }
      this.setKind(next);
    }
    const T = this.target;
    const k = Math.min(1, dt * 0.08);
    this.rain += (T.rain - this.rain) * k;
    this.wind += (T.wind - this.wind) * k;
    this.fog += (T.fog - this.fog) * k;
    this.cloud += (T.cloud - this.cloud) * k;
    this.tempOffset += (T.temp - this.tempOffset) * k;
    if (this.kind === WK.STORM && this.rng.chance(dt * 0.08)) this.thunder = 1;
    this.thunder = Math.max(0, this.thunder - dt * 1.5);

    // дождь: капли падают в открытые небу колонки
    const drops = Math.floor(this.rain * this.rainScale * t.W * 0.012 * dt * 30);
    for (let d = 0; d < drops; d++) {
      const x = 1 + this.rng.int(t.W - 2);
      let indoor = false;
      for (const z of zones) if (z.indoor && x >= z.x0 && x < z.x1) indoor = true;
      if (indoor) continue;
      const y = t.skyline[x] - 1;
      if (y < 1) continue;
      water.add(x, y, 22 + this.rng.int(12));
    }
    // испарение и температура
    const light = clock.light();
    const airT = 8 + light * 14 + this.tempOffset;
    water.evaporation = Math.max(0.02, 0.15 + light * 0.5 + Math.max(0, this.tempOffset) * 0.08 - this.rain * 0.5);
    // медленное обновление температуры поверхности
    const n = Math.min(t.tempW, 64);
    for (let s = 0; s < n; s++) {
      const tx = this.rng.int(t.tempW);
      const sky = t.skyline[Math.min(t.W - 1, tx * 8)];
      for (let ty = 0; ty < t.tempH; ty++) {
        const y = ty * 8;
        const i = ty * t.tempW + tx;
        const depth = y - sky;
        const target = depth < 0 ? airT : depth < 40 ? airT + (16 - airT) * (depth / 40) : 16;
        t.temp[i] += (target - t.temp[i]) * 0.05;
      }
    }
  }

  temperature(clock: Clock): number {
    return 8 + clock.light() * 14 + this.tempOffset;
  }
}
