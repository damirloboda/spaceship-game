import { C } from '../ants/Castes';

export interface Cohort {
  stage: number; // 0 яйца, 1 личинки, 2 куколки
  count: number;
  t: number;
  room: number;
}

const STAGE_TIME = [18, 34, 24];

/**
 * Выводок: матка откладывает яйца, личинки едят, куколки превращаются во взрослых.
 * Каста взрослых определяется потребностями колонии в момент окукливания.
 */
export class Brood {
  cohorts: Cohort[] = [];
  eggAcc = 0;

  totals(): [number, number, number] {
    const r: [number, number, number] = [0, 0, 0];
    for (const c of this.cohorts) r[c.stage] += c.count;
    return r;
  }

  total(): number {
    let s = 0;
    for (const c of this.cohorts) s += c.count;
    return s;
  }

  lay(count: number, room: number): void {
    const last = this.cohorts[this.cohorts.length - 1];
    if (last && last.stage === 0 && last.t > STAGE_TIME[0] - 3 && last.room === room) last.count += count;
    else this.cohorts.push({ stage: 0, count, t: STAGE_TIME[0], room });
  }

  /**
   * @returns количество вылупившихся взрослых по кастам
   */
  update(dt: number, feed: (need: number) => number, chooseCaste: () => number, speed: number): number[] {
    const hatched = [0, 0, 0, 0, 0, 0];
    // кормление личинок
    let larvae = 0;
    for (const c of this.cohorts) if (c.stage === 1) larvae += c.count;
    if (larvae > 0) {
      const need = larvae * 0.008 * dt;
      const got = feed(need);
      if (got < need * 0.5) {
        // голод: часть личинок погибает
        const loss = Math.max(0, Math.floor(larvae * 0.02 * dt * (1 - got / need)));
        let left = loss;
        for (const c of this.cohorts) if (c.stage === 1 && left > 0) { const d = Math.min(c.count, left); c.count -= d; left -= d; }
      }
    }
    for (const c of this.cohorts) {
      c.t -= dt * speed;
      if (c.t <= 0) {
        if (c.stage < 2) {
          c.stage++;
          c.t = STAGE_TIME[c.stage];
        } else {
          for (let k = 0; k < c.count; k++) hatched[chooseCaste()]++;
          c.count = 0;
        }
      }
    }
    this.cohorts = this.cohorts.filter((c) => c.count > 0);
    return hatched;
  }

  /** Потерять часть выводка в комнате (затопление/обвал). */
  lose(room: number, frac: number): number {
    let lost = 0;
    for (const c of this.cohorts) if (c.room === room) { const d = Math.ceil(c.count * frac); c.count -= d; lost += d; }
    this.cohorts = this.cohorts.filter((c) => c.count > 0);
    return lost;
  }

  moveRoom(from: number, to: number, n: number): number {
    let left = n;
    for (const c of this.cohorts) {
      if (c.room !== from || left <= 0) continue;
      const d = Math.min(c.count, left);
      if (d === c.count) c.room = to;
      else { c.count -= d; this.cohorts.push({ stage: c.stage, count: d, t: c.t, room: to }); }
      left -= d;
    }
    return n - left;
  }

  inRoom(room: number): number {
    let s = 0;
    for (const c of this.cohorts) if (c.room === room) s += c.count;
    return s;
  }
}

export const DEFAULT_CASTE = C.WORKER;
