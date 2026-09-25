import { C, CASTES, T, TASK_COUNT } from '../ants/Castes';
import { Rng } from '../core/Rng';
import { FOOD_KINDS } from '../food/FoodTypes';
import { PheromoneField } from '../pheromone/PheromoneField';
import { ROOM } from '../procgen/WorldGenerator';
import { Brood } from './Brood';
import { ColonyMemory } from './ColonyMemory';
import { Evolution } from './Evolution';
import { Nest } from './Nest';

/** Множители стимула для приоритетов игрока: ВЫКЛ / НИЗКИЙ / СРЕДНИЙ / ВЫСОКИЙ. */
export const PRIORITY_MUL = [0, 0.45, 1, 1.9];
export const PRIORITY_NAMES = ['выкл', 'низкий', 'средний', 'высокий'];

export interface Threat {
  id: number;
  kind: 'creature' | 'ant';
  ref: number;
  x: number;
  y: number;
  level: number;
  assigned: number;
  seen: number;
  /** без поводка: приказ игрока или набег — преследовать куда угодно */
  unleashed: boolean;
}

/** Радиус "своей" территории вокруг гнезда: дальше оборона не преследует. */
export const TERRITORY_R = 110;

export interface ColonyStats {
  delivered: number;
  born: number;
  died: number;
  dug: number;
  built: number;
  bridges: number;
  kills: number;
  peak: number;
}

/**
 * Колония — уровень 6 иерархии ИИ ("вся колония").
 * Не управляет муравьями напрямую: считает стимулы (голод, стройка, угрозы,
 * неизвестность), а муравьи сами берутся за работу по модели порогов реакции
 * (response threshold, Bonabeau/Theraulaz): P = s² / (s² + θ²). Пороги каждого
 * муравья снижаются от опыта — так возникает специализация без явных команд.
 */
export class Colony {
  readonly isPlayer: boolean;
  pher: PheromoneField;
  memory: ColonyMemory;
  evo = new Evolution();
  brood = new Brood();
  food = 40;
  leaves = 0;
  /** жители гнезда, не являющиеся агентами (уровень "секций") */
  residents = [0, 0, 0, 0, 0, 0];
  priorities = [2, 2, 2, 2, 2];
  stimulus = [0, 0, 0, 0, 0];
  agents = 0;
  agentsByTask = [0, 0, 0, 0, 0];
  agentsByCaste = [0, 0, 0, 0, 0, 0];
  /** агенты, которых колония хочет иметь снаружи по задачам */
  desired = [0, 0, 0, 0, 0];
  threats: Threat[] = [];
  private nextThreat = 1;
  queen = { alive: true, x: 0, y: 0, hp: 1, anim: 0, room: -1 };
  stats: ColonyStats = { delivered: 0, born: 0, died: 0, dug: 0, built: 0, bridges: 0, kills: 0, peak: 0 };
  /** мощность потоков (абстрактные муравьи на маршрутах) */
  streamAnts = 0;
  structureAnts = 0;
  mindTimer = 0;
  energy = 1;
  hunger = 0;
  agentBudget = 6000;
  /** отложенные доставки потоков: [время, количество] */
  pendingDeliveries: [number, number][] = [];
  starving = false;
  sealRequested = false;
  lastThreatTime = -1e9;
  starveAcc = 0;
  /** доход еды (ед./с, экспоненциальное среднее) — матка ориентируется на него */
  income = 0;
  private incomeAcc = 0;
  lastRaid = -1e9;
  /** метки игрока: 0 — исследовать, 1 — атаковать, 2 — еда */
  beacons: { id: number; x: number; y: number; kind: number; until: number }[] = [];
  private nextBeacon = 1;
  /** приоритет типов комнат (игрок может запретить/поднять) */
  roomPriority = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

  constructor(
    readonly id: number,
    public nest: Nest,
    worldW: number,
    worldH: number,
    private rng: Rng,
  ) {
    this.isPlayer = id === 0;
    this.pher = new PheromoneField(worldW, worldH);
    this.memory = new ColonyMemory(worldW, worldH);
  }

  /** Общая численность: агенты + жители + потоки + конструкции. */
  population(): number {
    let r = 0;
    for (const v of this.residents) r += v;
    return this.agents + r + this.streamAnts + this.structureAnts;
  }

  residentTotal(): number {
    let r = 0;
    for (const v of this.residents) r += v;
    return r;
  }

  foodCapacity(): number {
    return 60 + this.nest.capacity(ROOM.FOOD) * 4;
  }

  addFood(kind: number, amount: number): number {
    const def = FOOD_KINDS[kind];
    if (def.resource) {
      this.leaves += amount;
      return 0;
    }
    const v = amount * def.nutrition;
    this.store(v);
    this.stats.delivered += v;
    this.incomeAcc += v;
    this.evo.add(v * 0.9);
    return v;
  }

  /** Положить еду в кладовые: вместимость ограничивает приход, но не срезает запас. */
  store(v: number): void {
    const cap = this.foodCapacity() * 1.5;
    if (this.food < cap) this.food = Math.min(cap, this.food + v);
  }

  /** Обновить оценку дохода (вызывается раз в секунду). */
  sampleIncome(dt: number): void {
    const k = Math.min(1, dt / 60);
    this.income += (this.incomeAcc / dt - this.income) * k;
    this.incomeAcc = 0;
  }

  addIncome(v: number): void {
    this.incomeAcc += v;
  }

  eat(amount: number): number {
    const got = Math.min(this.food, amount);
    this.food -= got;
    return got;
  }

  /** Вернуть абстрактных муравьёв (из потока/моста) в гнездо. */
  residentsReturn(n: number): void {
    this.residents[C.WORKER] += Math.max(0, Math.round(n));
  }

  /** Взять абстрактных муравьёв из гнезда (для потока/утолщения моста). Возвращает сколько дали. */
  residentsTake(n: number): number {
    if (n < 0) {
      this.residents[C.WORKER] += -n;
      this.structureAnts = Math.max(0, this.structureAnts + n);
      return n;
    }
    const avail = Math.max(0, this.residents[C.WORKER] - 10);
    const got = Math.min(avail, n);
    this.residents[C.WORKER] -= got;
    this.structureAnts += got;
    return got;
  }

  addBeacon(x: number, y: number, kind: number, until: number): void {
    this.beacons.push({ id: this.nextBeacon++, x, y, kind, until });
  }

  unlockedCaste(c: number): boolean {
    if (c === C.CARRIER) return this.evo.has('carrier');
    if (c === C.BUILDER) return this.evo.has('builder');
    if (c === C.SOLDIER) return this.evo.has('soldier');
    return c !== C.QUEEN;
  }

  /** Каста новорождённого: по потребностям колонии и открытым кастам. */
  chooseCaste(): number {
    const s = this.stimulus;
    const w = [
      0.9 + s[T.FOOD] * 0.3,
      this.unlockedCaste(C.SOLDIER) ? 0.1 + s[T.DEFENSE] * 0.6 : 0,
      0.12 + s[T.EXPLORE] * 0.2,
      this.unlockedCaste(C.BUILDER) ? 0.1 + s[T.BUILD] * 0.35 : 0,
      this.unlockedCaste(C.CARRIER) ? 0.08 + s[T.FOOD] * 0.2 : 0,
    ];
    let sum = 0;
    for (const v of w) sum += v;
    let r = this.rng.next() * sum;
    for (let c = 0; c < w.length; c++) { r -= w[c]; if (r <= 0) return c; }
    return C.WORKER;
  }

  /**
   * Модель порогов реакции для отдельного муравья: выбрать категорию работы.
   * thr — пороги муравья (его личный опыт), caste — каста.
   */
  chooseTask(thr: Float32Array, base: number, caste: number): number {
    const s = this.stimulus;
    let best = -1;
    let bestP = 0;
    for (let c = 0; c < TASK_COUNT; c++) {
      const st = s[c];
      if (st <= 0) continue;
      const th = thr[base + c];
      const p = (st * st) / (st * st + th * th);
      // насыщение: если категорий уже хватает, меньше желающих
      const sat = this.agentsByTask[c] > this.desired[c] * 1.2 + 2 ? 0.25 : 1;
      const v = p * sat * (0.6 + this.rng.next() * 0.8);
      if (v > bestP) { bestP = v; best = c; }
    }
    if (bestP < 0.08) return -1;
    void caste;
    return best;
  }

  /** Обучение порогов: выполняемая работа снижает порог, остальные медленно растут. */
  learnThresholds(thr: Float32Array, base: number, task: number, dt: number): void {
    for (let c = 0; c < TASK_COUNT; c++) {
      const i = base + c;
      if (c === task) thr[i] = Math.max(0.04, thr[i] - 0.012 * dt);
      else thr[i] = Math.min(1.2, thr[i] + 0.002 * dt);
    }
  }

  initThresholds(thr: Float32Array, base: number, caste: number): void {
    const t = CASTES[caste].thresholds;
    for (let c = 0; c < TASK_COUNT; c++) thr[base + c] = Math.max(0.04, t[c] * (0.8 + this.rng.next() * 0.4));
  }

  addThreat(kind: 'creature' | 'ant', ref: number, x: number, y: number, level: number, time: number, unleashed = false): Threat {
    for (const th of this.threats) {
      if (th.kind === kind && th.ref === ref) {
        th.x = x; th.y = y; th.level = Math.max(th.level, level); th.seen = time;
        th.unleashed = th.unleashed || unleashed;
        return th;
      }
    }
    const th: Threat = { id: this.nextThreat++, kind, ref, x, y, level, assigned: 0, seen: time, unleashed };
    this.threats.push(th);
    this.lastThreatTime = time;
    return th;
  }

  /**
   * "Мысль" колонии раз в полсекунды: стимулы из реального состояния мира.
   */
  think(ctx: {
    time: number;
    openBuild: number;
    structDemand: number;
    stressed: number;
    haulDemand: number;
    routeFoodDemand: number;
    routeExploreDemand: number;
    knownFoodMass: number;
    farmNeed: number;
    maxAgents: number;
  }): void {
    const pm = this.priorities.map((p) => PRIORITY_MUL[p]);
    const pop = Math.max(1, this.population());
    const reserve = pop * 0.35 + 20;
    this.hunger = Math.max(0, Math.min(1, 1 - this.food / reserve));
    this.starving = this.food <= 0.5;
    this.energy = Math.max(0, Math.min(1, this.food / reserve));
    // угрозы стареют
    this.threats = this.threats.filter((th) => ctx.time - th.seen < 20);
    let threatLevel = 0;
    let antThreat = 0;
    for (const th of this.threats) {
      if (th.kind === 'ant' && !th.unleashed) antThreat += th.level;
      else threatLevel += th.level;
    }
    threatLevel += Math.min(3, antThreat);

    const food = 0.35 + this.hunger * 1.3 + (ctx.haulDemand > 0 ? 0.35 : 0) + (ctx.routeFoodDemand > 0 ? 0.4 : 0) + (ctx.knownFoodMass > 0 ? 0.15 : 0);
    const build = ctx.openBuild > 0 || ctx.structDemand > 0 ? Math.min(1.6, 0.35 + ctx.openBuild / (25 + pop * 0.05) + ctx.structDemand * 0.05 + ctx.stressed * 0.2) : 0;
    const defense = threatLevel > 0 ? Math.min(2, 0.3 + threatLevel * 0.25) : 0.02;
    const explore = 0.25 + (ctx.knownFoodMass < 20 ? 0.35 : 0) + (ctx.routeExploreDemand > 0 ? 0.5 : 0) - this.memory.exploredFraction() * 0.2;
    const resource = ctx.farmNeed > 0 ? 0.25 + ctx.farmNeed * 0.4 : 0.05;
    this.stimulus[T.FOOD] = food * pm[T.FOOD];
    this.stimulus[T.BUILD] = build * pm[T.BUILD];
    this.stimulus[T.DEFENSE] = defense * pm[T.DEFENSE];
    this.stimulus[T.EXPLORE] = Math.max(0, explore) * pm[T.EXPLORE];
    this.stimulus[T.RESOURCE] = resource * pm[T.RESOURCE];

    // желаемое число агентов по задачам: часть колонии всегда внутри (нянчит, отдыхает)
    const activeFrac = Math.min(0.85, 0.25 + 0.18 * this.stimulus.reduce((a, b) => a + b, 0));
    const totalActive = Math.min(ctx.maxAgents, Math.ceil(pop * activeFrac));
    let ssum = 0;
    for (const v of this.stimulus) ssum += v * v;
    for (let c = 0; c < TASK_COUNT; c++) {
      this.desired[c] = ssum > 0 ? Math.round((totalActive * this.stimulus[c] * this.stimulus[c]) / ssum) : 0;
    }
    // конкретные потребности как нижняя граница
    this.desired[T.BUILD] = Math.max(this.desired[T.BUILD], Math.min(ctx.structDemand + Math.min(ctx.openBuild, 30), totalActive));
    this.desired[T.FOOD] = Math.max(this.desired[T.FOOD], Math.min(ctx.haulDemand + ctx.routeFoodDemand, totalActive));
    this.desired[T.EXPLORE] = Math.max(this.desired[T.EXPLORE], Math.min(ctx.routeExploreDemand, totalActive));
    this.desired[T.DEFENSE] = Math.min(Math.max(this.desired[T.DEFENSE], Math.ceil(threatLevel * 4)), Math.ceil(pop * 0.35) + 2, totalActive);
    if (pm[T.EXPLORE] > 0) this.desired[T.EXPLORE] = Math.max(1, this.desired[T.EXPLORE]);
    this.stats.peak = Math.max(this.stats.peak, pop);
  }
}
