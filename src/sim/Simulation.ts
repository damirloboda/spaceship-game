import { AntStore, S } from '../ants/AntStore';
import { AntSystem } from '../ants/AntSystem';
import { C, T } from '../ants/Castes';
import { Colony } from '../colony/Colony';
import { ColonyDirector } from '../colony/ColonyDirector';
import { Nest } from '../colony/Nest';
import { BPK, ConstructionSystem, JK } from '../construction/ConstructionSystem';
import { LivingStructures, SK_NAMES } from '../construction/LivingStructures';
import { EventBus } from '../core/EventBus';
import { hashSeed, Rng } from '../core/Rng';
import { CreatureSystem } from '../creatures/CreatureSystem';
import { FoodSystem, HaulContext } from '../food/FoodSystem';
import { FOOD_KINDS } from '../food/FoodTypes';
import { FlowFieldCache } from '../nav/FlowFieldCache';
import { NavGrid } from '../nav/NavGrid';
import { SpatialHash } from '../nav/SpatialHash';
import { Granular } from '../physics/Granular';
import { Stability } from '../physics/Stability';
import { Water } from '../physics/Water';
import { P } from '../pheromone/PheromoneField';
import { PlantSystem } from '../plants/PlantSystem';
import { WorldData } from '../procgen/WorldGenerator';
import { RouteManager } from '../swarm/Routes';
import { StreamManager } from '../swarm/StreamManager';
import { Clock } from '../weather/Clock';
import { WeatherSystem } from '../weather/WeatherSystem';
import { IS_SOLID, M } from '../world/Materials';
import { F_FORBID, Terrain } from '../world/Terrain';
import { Zone } from '../world/Zones';
import { Command } from './Commands';
import { ModeConfig } from './Modes';

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export interface SimSettings {
  agentCap: number;
  physicsBudget: number;
}

export interface ParticleHook {
  dig(x: number, y: number, mat: number): void;
  dust(x: number, y: number, n: number): void;
}

/**
 * Оркестратор симуляции. Владеет всеми системами и вызывает их в фиксированном
 * порядке с фиксированным шагом (30 Гц). Никакой зависимости от рендера и DOM:
 * симуляцию можно гонять в тестах, в воркере или на сервере.
 */
export class Simulation {
  readonly bus = new EventBus();
  readonly rng: Rng;
  time = 0;
  tick = 0;
  readonly terrain: Terrain;
  readonly zones: Zone[];
  readonly nav: NavGrid;
  readonly flow: FlowFieldCache;
  readonly structures: LivingStructures;
  readonly construction: ConstructionSystem;
  readonly ants = new AntStore(4096);
  readonly antHash: SpatialHash;
  readonly antSystem: AntSystem;
  readonly colonies: Colony[] = [];
  readonly directors: ColonyDirector[] = [];
  readonly food: FoodSystem;
  readonly plants: PlantSystem;
  readonly creatures: CreatureSystem;
  readonly stability: Stability;
  readonly granular: Granular;
  readonly water: Water;
  readonly clock = new Clock();
  readonly weather: WeatherSystem;
  readonly routes: RouteManager;
  readonly streams: StreamManager;
  readonly settings: SimSettings = { agentCap: 12000, physicsBudget: 1 };
  view = { x0: 0, y0: 0, x1: 200, y1: 120 };
  particles: ParticleHook | null = null;
  private commands: Command[] = [];
  private haulCtx: HaulContext;
  landmarks: { name: string; x: number; y: number }[];
  gameOver = false;
  /** счётчики производительности (мс) */
  perf = { ants: 0, physics: 0, pher: 0, other: 0, total: 0 };

  /** все генераторы случайных чисел подсистем — для сохранения/загрузки */
  readonly rngs: Rng[] = [];

  constructor(readonly world: WorldData, readonly mode: ModeConfig, readonly restore = false) {
    const seed = world.params.seed;
    this.rng = new Rng(hashSeed(seed * 7 + 13));
    const origFork = this.rng.fork.bind(this.rng);
    this.rng.fork = (salt: number | string) => { const r = origFork(salt); this.rngs.push(r); return r; };
    this.rngs.push(this.rng);
    this.terrain = world.terrain;
    this.zones = world.zones;
    this.landmarks = world.landmarks;
    const t = this.terrain;
    this.nav = new NavGrid(t);
    this.nav.rebuildAll();
    this.flow = new FlowFieldCache(this.nav, t.W, t.H, 14);
    this.structures = new LivingStructures(t, this.nav, this.bus);
    this.construction = new ConstructionSystem(t, this.nav, this.bus, this.rng.fork('construction'));
    this.antHash = new SpatialHash(t.W, t.H, 2, 4096);
    this.food = new FoodSystem(t, this.nav, this.rng.fork('food'));
    this.stability = new Stability(t, this.bus, this.rng.fork('stability'));
    this.granular = new Granular(t, this.rng.fork('granular'));
    this.water = new Water(t, this.rng.fork('water'));
    this.weather = new WeatherSystem(this.rng.fork('weather'), this.bus);
    this.routes = new RouteManager(this);
    this.streams = new StreamManager(this);
    this.antSystem = new AntSystem(this);
    this.creatures = new CreatureSystem(this);
    this.plants = new PlantSystem(this);
    for (const p of world.plants) this.plants.add(p);
    for (const f of world.foods) this.food.spawn(f.kind, f.x + 0.5, f.y + 0.5 - 0.3, f.mass * mode.foodMul);
    for (const c of world.creatures) {
      if (c.kind === 0 && mode.predators < 0.5 && this.rng.chance(0.5)) continue;
      this.creatures.spawn(c.kind, c.x, c.y, c.home);
    }

    // колонии
    for (const ns of world.nests) {
      if (ns.colony > 0 && !mode.rival) continue;
      const nest = new Nest(ns.entranceX, ns.entranceY, t, this.nav);
      const col = new Colony(ns.colony, nest, t.W, t.H, this.rng.fork('colony' + ns.colony));
      for (const [x0, y0, x1, y1, type] of ns.rooms) nest.addRoom(type, x0, y0, x1, y1, true);
      const qr = nest.rooms.find((r) => r.type === 0);
      if (qr) { col.queen.x = qr.cx; col.queen.y = qr.cy + 1; col.queen.room = qr.id; }
      nest.field.buildNow(nest.homeSources());
      nest.carry.buildNow(nest.carrySources());
      this.colonies.push(col);
      const dir = new ColonyDirector(this, col);
      this.directors.push(dir);
      if (restore) {
        // состояние будет восстановлено из сохранения
      } else if (ns.colony === 0) {
        col.food = mode.startFood;
        col.evo.level = mode.startLevel;
        col.evo.xp = [0, 120, 450, 1300, 3500, 9000, 22000, 55000, 140000, 360000][mode.startLevel - 1];
        col.brood.lay(6, nest.rooms.find((r) => r.type === 2)?.id ?? -1);
        const n = mode.startAnts;
        const agentsNow = Math.min(n, 40);
        for (let k = 0; k < agentsNow; k++) {
          const caste = k % 4 === 3 ? C.SCOUT : C.WORKER;
          const id = this.antSystem.spawn(0, caste, ns.entranceX + this.rng.range(-3, 3), ns.entranceY + 0.5);
          this.ants.state[id] = S.IDLE;
          this.ants.timer[id] = this.rng.range(0, 2);
        }
        const rest = n - agentsNow;
        col.residents[C.WORKER] += Math.round(rest * 0.75);
        col.residents[C.SCOUT] += Math.round(rest * 0.1);
        if (col.unlockedCaste(C.CARRIER)) col.residents[C.CARRIER] += Math.round(rest * 0.08);
        else col.residents[C.WORKER] += Math.round(rest * 0.08);
        if (col.unlockedCaste(C.BUILDER)) col.residents[C.BUILDER] += Math.round(rest * 0.05);
        if (col.unlockedCaste(C.SOLDIER)) col.residents[C.SOLDIER] += Math.round(rest * 0.02);
      } else {
        col.food = 120;
        col.evo.level = 2;
        col.residents[C.WORKER] = 40;
        col.residents[C.SCOUT] = 6;
        col.residents[C.SOLDIER] = 8;
        col.priorities = [3, 2, 2, 2, 1];
        col.brood.lay(10, nest.rooms.find((r) => r.type === 2)?.id ?? -1);
      }
      col.evo.onLevelUp = (lvl) => this.bus.emit({ type: 'levelUp', level: lvl + (col.isPlayer ? 0 : 100) });
    }
    // туман войны открыт в режимах без тумана
    if (!mode.fog) for (const col of this.colonies) col.memory.fog.fill(255);
    // открываем окрестность гнезда
    for (const col of this.colonies) col.memory.reveal(col.nest.entranceX, col.nest.entranceY, 40, 0);

    this.stability.onStressed = (x, y) => { for (const d of this.directors) d.onStressed(x, y); };
    this.construction.onBlueprintComplete = (bp) => {
      if (bp.kind === BPK.ROOM) this.directors.find((d) => d.col.id === bp.colony)?.onRoomDug(bp);
      else if (bp.player) this.bus.emit({ type: 'notice', text: `Готово: ${bp.label || 'стройка'}`, x: bp.x, y: bp.y, tone: 'good' });
    };
    this.structures.onRelease = (antId, fall) => {
      const a = this.ants;
      if (!a.alive[antId]) return;
      if (fall) {
        a.state[antId] = S.FALL;
        a.prevState[antId] = S.IDLE;
        a.vy[antId] = 0;
        a.vx[antId] = 0;
      } else {
        a.state[antId] = S.IDLE;
        a.timer[antId] = 0.5;
      }
    };
    this.haulCtx = {
      homeDir: (colony, x, y, out) => this.colonies[colony]?.nest.field.descend(x, y, out) ?? false,
      homeX: (colony) => this.colonies[colony]?.nest.entranceX ?? 0,
      carryDir: (colony, x, y) => this.colonies[colony]?.nest.carry.direction(x, y) ?? 0,
      carryDist: (colony, x, y) => this.colonies[colony]?.nest.carry.dist(x, y) ?? 65535,
      atNest: (colony, x, y, r) => {
        const n = this.colonies[colony]?.nest;
        return !!n && Math.hypot(x - n.entranceX, y - n.entranceY) < r + 4;
      },
      deliver: (colony, kind, amount) => {
        const col = this.colonies[colony];
        if (col) col.addFood(kind, amount);
      },
      release: (antId) => {
        if (this.ants.alive[antId] && this.ants.state[antId] === S.CARRY_TEAM) { this.ants.state[antId] = S.IDLE; this.ants.timer[antId] = 0.3; }
      },
      strength: (antId) => (this.ants.alive[antId] && this.ants.state[antId] === S.CARRY_TEAM ? this.antSystem.brain.strength(antId) : 0),
      wind: 0,
    };
    this.bus.on((e) => this.onEvent(e));
    if (!restore) this.weather.setKind(0);
  }

  get player(): Colony {
    return this.colonies[0];
  }

  queue(c: Command): void {
    this.commands.push(c);
  }

  private onEvent(e: import('../core/EventBus').GameEvent): void {
    switch (e.type) {
      case 'collapse':
        for (const d of this.directors) d.onCollapse(e.x, e.y);
        this.particles?.dust(e.x, e.y, Math.min(60, e.size * 6));
        break;
      case 'structureComplete': {
        const s = this.structures.get(e.id);
        const col = s ? this.colonies[s.colony] : null;
        if (col) {
          col.stats.bridges++;
          col.evo.add(25);
          if (col.isPlayer) this.bus.emit({ type: 'notice', text: `${SK_NAMES[e.kind]} готов: ${e.ants} муравьёв сцепились`, x: e.x, y: e.y, tone: 'good' });
        }
        break;
      }
      case 'foodFound':
        if (e.colony === 0 && e.mass > 20) this.bus.emit({ type: 'notice', text: `Разведчик нашёл: ${FOOD_KINDS[e.kind].name} (${Math.round(e.mass)})`, x: e.x, y: e.y, tone: 'good' });
        break;
      case 'levelUp':
        if (e.level < 100) this.bus.emit({ type: 'notice', text: `Уровень колонии ${e.level}!`, tone: 'good' });
        break;
    }
  }

  private applyCommand(c: Command): void {
    const col = this.player;
    if (!col) return;
    const t = this.terrain;
    switch (c.type) {
      case 'route': {
        const r = this.routes.planFromLine(0, c.points);
        if (r) this.bus.emit({ type: 'notice', text: `Маршрут: ${r.label}`, x: r.endX, y: r.endY, tone: 'info' });
        else this.bus.emit({ type: 'notice', text: 'Линия слишком короткая или вне мира', tone: 'bad' });
        break;
      }
      case 'removeRoute': this.routes.remove(c.id); break;
      case 'dig': {
        const cells = c.cells.map(([x, y]) => [x, y, JK.DIG] as [number, number, number]);
        const bp = this.construction.addBlueprint(0, BPK.DIG_AREA, cells, { player: true, priority: 2, label: 'Раскопка' });
        if (!bp) this.bus.emit({ type: 'notice', text: 'Здесь нечего копать (камень/металл не копаются)', tone: 'bad' });
        break;
      }
      case 'build': {
        const cells = c.cells.map(([x, y]) => [x, y, JK.BUILD] as [number, number, number]);
        this.construction.addBlueprint(0, BPK.WALL, cells, { player: true, priority: 2, label: 'Стена' });
        break;
      }
      case 'reinforce': {
        const cells = c.cells.map(([x, y]) => [x, y, JK.REINFORCE] as [number, number, number]);
        this.construction.addBlueprint(0, BPK.REINFORCE, cells, { player: true, priority: 2, label: 'Укрепление' });
        break;
      }
      case 'forbid':
        for (const [x, y] of c.cells) {
          if (!t.inBounds(x, y)) continue;
          const i = y * t.W + x;
          if (c.on) t.flags[i] |= F_FORBID;
          else t.flags[i] &= ~F_FORBID;
          t.renderDirty.markCell(x, y);
        }
        break;
      case 'markFood': {
        let n = 0;
        this.food.query(c.x, c.y, 18, (it) => { it.known |= 1; n++; });
        col.pher.splash(P.FOOD, c.x, c.y, 8, 4, this.time);
        col.addBeacon(c.x, c.y, 2, this.time + 120);
        this.bus.emit({ type: 'notice', text: n ? `Отмечено: ${n} ед. еды/ресурсов` : 'Метка ресурса поставлена', x: c.x, y: c.y, tone: 'info' });
        break;
      }
      case 'attack': {
        const cr = this.creatures.nearest(c.x, c.y, 20);
        if (cr) col.addThreat('creature', cr.id, cr.x, cr.y, 4, this.time, true);
        else col.addBeacon(c.x, c.y, 1, this.time + 60);
        col.pher.splash(P.ATTACK, c.x, c.y, 10, 6, this.time);
        if (col.priorities[T.DEFENSE] < 2) col.priorities[T.DEFENSE] = 2;
        break;
      }
      case 'explore':
        col.addBeacon(c.x, c.y, 0, this.time + 180);
        break;
      case 'priority':
        col.priorities[c.task] = Math.max(0, Math.min(3, c.level));
        break;
      case 'cancelBlueprint':
        this.construction.cancelBlueprint(c.id);
        break;
      case 'spawnFood':
        this.food.spawn(c.kind, c.x, c.y, c.mass);
        break;
      case 'spawnAnts':
        col.residents[C.WORKER] += Math.round(c.n * 0.8);
        col.residents[C.CARRIER] += Math.round(c.n * 0.08);
        col.residents[C.SOLDIER] += Math.round(c.n * 0.05);
        col.residents[C.SCOUT] += Math.round(c.n * 0.04);
        col.residents[C.BUILDER] += Math.round(c.n * 0.03);
        break;
      case 'spawnCreature':
        this.creatures.spawn(c.kind, c.x, c.y, [c.x, c.y]);
        break;
      case 'paint':
        for (const [x, y] of c.cells) if (t.inBounds(x, y) && t.get(x, y) !== M.BEDROCK) t.set(x, y, c.mat);
        break;
      case 'water':
        for (let k = 0; k < 40; k++) this.water.add(Math.round(c.x + this.rng.range(-6, 6)), Math.round(c.y + this.rng.range(-6, 0)), 255);
        break;
      case 'weather':
        this.weather.setKind(c.kind);
        break;
    }
  }

  step(): void {
    const t0 = performance.now();
    const dt = DT;
    this.tick++;
    this.time += dt;
    this.clock.time = this.time;
    for (const c of this.commands.splice(0)) this.applyCommand(c);

    this.weather.update(dt, this.terrain, this.water, this.zones, this.clock);
    this.haulCtx.wind = this.weather.wind;
    for (const d of this.directors) d.update(dt);

    const a = this.ants;
    this.antHash.build(a.n, a.x, a.y, a.alive);
    const t1 = performance.now();
    this.antSystem.update(dt);
    const t2 = performance.now();

    // поток "утолщает" мосты, по которым идёт
    for (const s of this.structures.items.values()) {
      if (s.routeId >= 0) {
        const r = this.routes.get(s.routeId);
        if (r && r.stream > 0) { s.crossings += r.stream * dt * 0.01; s.lastUsed = this.time; }
      }
    }
    this.structures.update(dt, this.time, (colony, want) => this.colonies[colony]?.residentsTake(want) ?? 0);
    for (const col of this.colonies) col.structureAnts = this.structures.totalAnts(col.id) - this.countNodes(col.id);
    this.food.update(dt, this.haulCtx);
    this.creatures.update(dt);
    if (this.tick % 30 === 0) this.construction.expire(this.time, (id) => !!a.alive[id] && a.state[id] !== S.DYING);
    this.plants.update(dt);

    const t3 = performance.now();
    const pb = this.settings.physicsBudget;
    this.stability.update(dt, Math.round(3000 * pb));
    this.granular.update(Math.round(160 * pb));
    this.water.update(Math.round(90 * pb), dt);
    this.water.soilPass(Math.max(1, Math.round(3 * pb)), 0.004 + Math.max(0, this.weather.tempOffset) * 0.001);
    const t4 = performance.now();
    for (const col of this.colonies) col.pher.update(this.time, 60);
    const t5 = performance.now();
    this.flow.update(40000, this.time);
    this.streams.update(dt);
    if (this.tick % 30 === 0) {
      this.routes.learn(1);
      for (const col of this.colonies) col.memory.decay(1);
    }
    // гибель колонии в выживании
    if (this.mode.survival && !this.gameOver && this.tick % 30 === 0 && this.player.population() <= 0) {
      this.gameOver = true;
      this.bus.emit({ type: 'notice', text: 'Колония погибла. Мир продолжает жить без неё.', tone: 'bad' });
    }
    this.bus.flush();
    const t6 = performance.now();
    const k = 0.1;
    this.perf.ants += (t2 - t1 - this.perf.ants) * k;
    this.perf.physics += (t4 - t3 - this.perf.physics) * k;
    this.perf.pher += (t5 - t4 - this.perf.pher) * k;
    this.perf.total += (t6 - t0 - this.perf.total) * k;
    this.perf.other = this.perf.total - this.perf.ants - this.perf.physics - this.perf.pher;
  }

  private countNodes(colony: number): number {
    let n = 0;
    for (const s of this.structures.items.values()) if (s.colony === colony) n += s.filled;
    return n;
  }

  /** Какая еда/муравей/существо под курсором — для инспектора. */
  inspect(x: number, y: number): string {
    const t = this.terrain;
    const lines: string[] = [];
    const xi = x | 0;
    const yi = y | 0;
    if (t.inBounds(xi, yi)) {
      const i = yi * t.W + xi;
      const m = t.mat[i];
      lines.push(`Клетка: ${MATERIAL_NAME(m)} · влажн. ${Math.round((t.moist[i] / 255) * 100)}% · ${t.tempAt(xi, yi).toFixed(0)}°C${t.water[i] ? ` · вода ${Math.round((t.water[i] / 255) * 100)}%` : ''}${t.stress[i] ? ` · трещины ${Math.round((t.stress[i] / 255) * 100)}%` : ''}`);
      if (IS_SOLID[m]) lines.push(`Прочность ${Math.round((t.hp[i] / 255) * 100)}%`);
    }
    return lines.join('\n');
  }
}

import { MATERIALS } from '../world/Materials';
function MATERIAL_NAME(m: number): string {
  return MATERIALS[m]?.name ?? '?';
}
