import { TASK_COUNT } from './Castes';

/** Состояния муравья (автомат поведения). */
export const S = {
  IDLE: 0,
  EXPLORE: 1,
  FORAGE: 2,
  RETURN: 3,
  GOTO_ITEM: 4,
  CARRY_TEAM: 5,
  GOTO_JOB: 6,
  DIG: 7,
  HAUL: 8,
  BUILD: 9,
  STRUCT_JOIN: 10,
  STRUCT_NODE: 11,
  ATTACK: 12,
  FLEE: 13,
  EVACUATE: 14,
  FALL: 15,
  HOME: 16,
  DYING: 17,
  ROUTE: 18,
  GATHER: 19,
  PATROL: 20,
} as const;
export const STATE_NAMES = [
  'ожидает', 'исследует', 'ищет еду', 'несёт домой', 'идёт к грузу', 'тащит груз', 'идёт на стройку', 'копает',
  'несёт землю', 'строит', 'идёт в мост', 'держит мост', 'атакует', 'убегает', 'спасает личинку', 'падает',
  'идёт домой', 'уходит', 'идёт по маршруту', 'собирает ресурсы', 'патрулирует',
];

/** Груз. */
export const CG = {
  NONE: 0,
  FOOD: 1,
  SOIL: 2,
  LARVA: 3,
  RESOURCE: 4,
} as const;

export const AF_ON_STRUCT = 1;
export const AF_RECRUIT = 2; // нашёл большую еду — зовёт
export const AF_DETAIL = 4; // в зоне камеры — полная симуляция
export const AF_WET = 8;
export const AF_HURT = 16;
export const AF_SIDE = 32; // сторона обхода препятствий (левша/правша)

/**
 * Хранилище муравьёв в формате Structure of Arrays (ECS без объектов).
 * Никаких GameObject/Actor на муравья: 100 000 муравьёв — это несколько
 * десятков типизированных массивов, дружелюбных к кэшу и к пересылке в воркер/GPU.
 */
export class AntStore {
  capacity: number;
  /** верхняя граница занятых индексов */
  n = 0;
  count = 0;
  private free: number[] = [];

  alive!: Uint8Array;
  colony!: Uint8Array;
  caste!: Uint8Array;
  state!: Uint8Array;
  prevState!: Uint8Array;
  cargo!: Uint8Array;
  cargoKind!: Uint8Array;
  task!: Uint8Array;
  lod!: Uint8Array;
  tint!: Uint8Array;
  dirt!: Uint8Array;
  flags!: Uint8Array;
  x!: Float32Array;
  y!: Float32Array;
  px!: Float32Array;
  py!: Float32Array;
  vx!: Float32Array;
  vy!: Float32Array;
  heading!: Float32Array;
  energy!: Float32Array;
  health!: Float32Array;
  age!: Float32Array;
  exp!: Float32Array;
  cargoAmt!: Float32Array;
  tx!: Float32Array;
  ty!: Float32Array;
  timer!: Float32Array;
  walk!: Float32Array;
  anim!: Float32Array;
  memX!: Float32Array;
  memY!: Float32Array;
  stuck!: Float32Array;
  /** контроль прогресса к цели: лучшее расстояние и время с последнего улучшения */
  goalD!: Float32Array;
  goalT!: Float32Array;
  target!: Int32Array;
  target2!: Int32Array;
  /** пороги реакции TASK_COUNT на муравья — "опыт" специализации */
  thr!: Float32Array;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.alloc(capacity);
  }

  private alloc(cap: number): void {
    const grow = <T extends Uint8Array | Float32Array | Int32Array>(old: T | undefined, ctor: new (n: number) => T, mul = 1): T => {
      const a = new ctor(cap * mul);
      if (old) a.set(old.subarray(0, Math.min(old.length, cap * mul)) as any);
      return a;
    };
    this.alive = grow(this.alive, Uint8Array);
    this.colony = grow(this.colony, Uint8Array);
    this.caste = grow(this.caste, Uint8Array);
    this.state = grow(this.state, Uint8Array);
    this.prevState = grow(this.prevState, Uint8Array);
    this.cargo = grow(this.cargo, Uint8Array);
    this.cargoKind = grow(this.cargoKind, Uint8Array);
    this.task = grow(this.task, Uint8Array);
    this.lod = grow(this.lod, Uint8Array);
    this.tint = grow(this.tint, Uint8Array);
    this.dirt = grow(this.dirt, Uint8Array);
    this.flags = grow(this.flags, Uint8Array);
    this.x = grow(this.x, Float32Array);
    this.y = grow(this.y, Float32Array);
    this.px = grow(this.px, Float32Array);
    this.py = grow(this.py, Float32Array);
    this.vx = grow(this.vx, Float32Array);
    this.vy = grow(this.vy, Float32Array);
    this.heading = grow(this.heading, Float32Array);
    this.energy = grow(this.energy, Float32Array);
    this.health = grow(this.health, Float32Array);
    this.age = grow(this.age, Float32Array);
    this.exp = grow(this.exp, Float32Array);
    this.cargoAmt = grow(this.cargoAmt, Float32Array);
    this.tx = grow(this.tx, Float32Array);
    this.ty = grow(this.ty, Float32Array);
    this.timer = grow(this.timer, Float32Array);
    this.walk = grow(this.walk, Float32Array);
    this.anim = grow(this.anim, Float32Array);
    this.memX = grow(this.memX, Float32Array);
    this.memY = grow(this.memY, Float32Array);
    this.stuck = grow(this.stuck, Float32Array);
    this.goalD = grow(this.goalD, Float32Array);
    this.goalT = grow(this.goalT, Float32Array);
    this.target = grow(this.target, Int32Array);
    this.target2 = grow(this.target2, Int32Array);
    this.thr = grow(this.thr, Float32Array, TASK_COUNT);
    this.capacity = cap;
  }

  spawn(colony: number, caste: number, x: number, y: number, tint: number): number {
    let id: number;
    if (this.free.length > 0) id = this.free.pop()!;
    else {
      if (this.n >= this.capacity) this.alloc(this.capacity * 2);
      id = this.n++;
    }
    this.alive[id] = 1;
    this.colony[id] = colony;
    this.caste[id] = caste;
    this.state[id] = S.IDLE;
    this.prevState[id] = S.IDLE;
    this.cargo[id] = 0;
    this.cargoKind[id] = 0;
    this.cargoAmt[id] = 0;
    this.task[id] = 0;
    this.lod[id] = 0;
    this.tint[id] = tint;
    this.dirt[id] = 0;
    this.flags[id] = 0;
    this.x[id] = x;
    this.y[id] = y;
    this.px[id] = x;
    this.py[id] = y;
    this.vx[id] = 0;
    this.vy[id] = 0;
    this.heading[id] = (tint / 255) * Math.PI * 2;
    this.energy[id] = 1;
    this.health[id] = 1;
    this.age[id] = 0;
    this.exp[id] = 0;
    this.tx[id] = x;
    this.ty[id] = y;
    this.timer[id] = 0;
    this.walk[id] = 0;
    this.anim[id] = tint * 0.1;
    this.memX[id] = -1;
    this.memY[id] = -1;
    this.stuck[id] = 0;
    this.goalD[id] = 1e9;
    this.goalT[id] = 0;
    this.target[id] = -1;
    this.target2[id] = -1;
    this.count++;
    return id;
  }

  kill(id: number): void {
    if (!this.alive[id]) return;
    this.alive[id] = 0;
    this.count--;
    this.free.push(id);
  }

  clear(): void {
    this.alive.fill(0);
    this.n = 0;
    this.count = 0;
    this.free = [];
  }
}
