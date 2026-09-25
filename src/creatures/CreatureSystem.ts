import { S } from '../ants/AntStore';
import { CASTES } from '../ants/Castes';
import { angleWrap } from '../core/MathUtil';
import { FK } from '../food/FoodTypes';
import { P } from '../pheromone/PheromoneField';
import { IS_SOLID, M } from '../world/Materials';
import type { Simulation } from '../sim/Simulation';
import { CK, CreatureDef, CREATURES } from './CreatureTypes';

export const CS = { WANDER: 0, LURK: 1, HUNT: 2, ATTACK: 3, EAT: 4, RETREAT: 5, BURROW: 6, RAID: 7, FLEE: 8 } as const;
export const CS_NAMES = ['бродит', 'затаился', 'охотится', 'атакует', 'ест', 'отступает', 'роет', 'грабит', 'бежит'];

export interface Creature {
  id: number;
  kind: number;
  def: CreatureDef;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  hp: number;
  state: number;
  target: number;
  timer: number;
  heading: number;
  anim: number;
  homeX: number;
  homeY: number;
  alive: boolean;
  dirSign: number;
  /** сколько атакующих муравьёв рядом (для реакции "бежать/драться") */
  pressure: number;
  lastHitBy: number;
  dying: number;
  size: number;
}

/**
 * Живая экосистема. У каждого вида своё поведение, а не просто "HP":
 * паук охотится на одиночек и отступает от толпы; жук ворует еду и лезет в кладовые;
 * червь роет ходы сквозь почву (и может проломить комнату); гусеница объедает листья;
 * муха кружит над едой. Убитое существо становится едой для колонии.
 */
export class CreatureSystem {
  list: Creature[] = [];
  private nextId = 1;
  private tmp = [0, 0];

  constructor(private sim: Simulation) {}

  spawn(kind: number, x: number, y: number, home?: [number, number]): Creature {
    const def = CREATURES[kind];
    const c: Creature = {
      id: this.nextId++, kind, def, x, y, px: x, py: y, vx: 0, vy: 0, hp: def.hp, state: kind === CK.SPIDER ? CS.LURK : kind === CK.WORM ? CS.BURROW : CS.WANDER,
      target: -1, timer: 0, heading: 0, anim: this.sim.rng.next() * 10, homeX: home ? home[0] : x, homeY: home ? home[1] : y, alive: true,
      dirSign: this.sim.rng.sign(), pressure: 0, lastHitBy: -1, dying: 0, size: 0.85 + this.sim.rng.next() * 0.3,
    };
    this.list.push(c);
    return c;
  }

  get(id: number): Creature | undefined {
    for (const c of this.list) if (c.id === id) return c;
    return undefined;
  }

  nearest(x: number, y: number, r: number, filter?: (c: Creature) => boolean): Creature | null {
    let best: Creature | null = null;
    let bd = r * r;
    for (const c of this.list) {
      if (!c.alive || c.dying > 0) continue;
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd && (!filter || filter(c))) { bd = d; best = c; }
    }
    return best;
  }

  damage(c: Creature, amount: number, byAnt: number): void {
    if (!c.alive || c.dying > 0) return;
    c.hp -= amount;
    c.lastHitBy = byAnt;
    if (c.hp <= 0) this.kill(c);
  }

  private kill(c: Creature): void {
    const sim = this.sim;
    c.dying = 1;
    sim.bus.emit({ type: 'creatureDied', x: c.x, y: c.y, kind: c.kind });
    if (c.kind !== CK.FLY || sim.rng.chance(0.5)) {
      const it = sim.food.spawn(c.kind === CK.WORM ? FK.MEAT : FK.INSECT, c.x, c.y, c.def.mass * c.size);
      it.known = 3;
    }
    if (c.lastHitBy >= 0 && sim.ants.alive[c.lastHitBy]) {
      const col = sim.colonies[sim.ants.colony[c.lastHitBy]];
      if (col) { col.stats.kills++; col.evo.add(15); }
    }
  }

  private walkableFor(c: Creature, x: number, y: number): boolean {
    const t = this.sim.terrain;
    const xi = x | 0;
    const yi = y | 0;
    if (!t.inBounds(xi, yi)) return false;
    if (t.solid(xi, yi)) return false;
    if (c.kind === CK.FLY) return true;
    // пауки и жуки держатся любых поверхностей (включая гладкие)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && t.solid(xi + dx, yi + dy)) return true;
    return this.sim.nav.walkable(xi, yi);
  }

  /** Движение по поверхности к цели (упрощённая версия муравьиной). */
  private move(c: Creature, dx: number, dy: number, speed: number, dt: number): void {
    const t = this.sim.terrain;
    if (c.kind === CK.WORM) return;
    const want = Math.atan2(dy, dx);
    if (dx !== 0 || dy !== 0) c.heading += angleWrap(want - c.heading) * Math.min(1, dt * 5);
    // падение
    if (c.kind !== CK.FLY && !this.walkableFor(c, c.x, c.y)) {
      if (t.solid(c.x | 0, c.y | 0)) { c.y -= 1; return; }
      c.vy = Math.min(25, c.vy + 40 * dt);
      const ny = c.y + c.vy * dt;
      if (!t.solid(c.x | 0, ny | 0)) c.y = ny;
      else c.vy = 0;
      return;
    }
    c.vy = 0;
    const step = speed * dt;
    for (const off of [0, 0.5, -0.5, 1.1, -1.1, 1.8, -1.8, 2.6, -2.6]) {
      const a = c.heading + off * c.dirSign;
      const nx = c.x + Math.cos(a) * step;
      const ny = c.y + Math.sin(a) * step;
      if (this.walkableFor(c, nx, ny)) {
        c.x = nx;
        c.y = ny;
        c.heading = a;
        c.anim += step * 1.4;
        return;
      }
    }
    c.dirSign = -c.dirSign;
    c.heading += Math.PI * 0.5;
  }

  update(dt: number): void {
    const sim = this.sim;
    const night = sim.clock.isNight();
    for (const c of this.list) {
      c.px = c.x;
      c.py = c.y;
      if (!c.alive) continue;
      if (c.dying > 0) {
        c.dying += dt;
        if (c.dying > 1.5) c.alive = false;
        continue;
      }
      // давление муравьёв вокруг
      let near = 0;
      sim.antHash.query(c.x, c.y, c.def.radius + 3, (a) => { if (sim.ants.state[a] !== S.DYING) near++; });
      c.pressure = near;
      switch (c.kind) {
        case CK.SPIDER: this.spider(c, dt, night); break;
        case CK.BEETLE: this.beetle(c, dt); break;
        case CK.WORM: this.worm(c, dt); break;
        case CK.CATERPILLAR: this.caterpillar(c, dt); break;
        case CK.FLY: this.fly(c, dt); break;
      }
      // регистрация угроз колониями
      if ((c.def.role === 'predator' || c.def.role === 'thief') && sim.tick % 15 === 0) {
        for (const col of sim.colonies) {
          const d = Math.hypot(c.x - col.nest.entranceX, c.y - col.nest.entranceY);
          if (d < 70 || c.pressure > 0 || c.state === CS.ATTACK) {
            if (!col.memory.isFogged(c.x, c.y) || d < 70) {
              col.addThreat('creature', c.id, c.x, c.y, c.def.role === 'predator' ? 2 : 1, sim.time);
            }
          }
        }
      }
    }
    if (sim.tick % 60 === 0) this.list = this.list.filter((c) => c.alive);
    this.respawn(dt);
  }

  private biteNearest(c: Creature, dt: number): number {
    const sim = this.sim;
    const ants = sim.ants;
    let best = -1;
    let bd = (c.def.radius + 1.3) ** 2;
    sim.antHash.query(c.x, c.y, c.def.radius + 2, (a) => {
      if (ants.state[a] === S.DYING) return;
      const d = (ants.x[a] - c.x) ** 2 + (ants.y[a] - c.y) ** 2;
      if (d < bd) { bd = d; best = a; }
    });
    if (best >= 0) {
      sim.antSystem.hurt(best, (c.def.attack * dt) / CASTES[ants.caste[best]].hp, 1);
      sim.colonies[ants.colony[best]]?.pher.deposit(P.DANGER, c.x, c.y, 3 * dt * 10, sim.time);
    }
    return best;
  }

  private spider(c: Creature, dt: number, night: boolean): void {
    const sim = this.sim;
    const ants = sim.ants;
    c.timer -= dt;
    // регенерация
    if (c.hp < c.def.hp) c.hp = Math.min(c.def.hp, c.hp + dt * (c.state === CS.LURK ? 3 : 0.5));
    // толпа — отступаем
    if ((c.pressure >= 7 || c.hp < c.def.hp * 0.35) && c.state !== CS.RETREAT) { c.state = CS.RETREAT; c.timer = 12; }
    switch (c.state) {
      case CS.LURK: {
        // плетёт паутину у логова
        if (sim.rng.chance(dt * 0.05)) {
          const wx = Math.round(c.homeX + sim.rng.range(-8, 8));
          const wy = Math.round(c.homeY + sim.rng.range(-10, 2));
          if (sim.terrain.get(wx, wy) === M.AIR && sim.terrain.water[wy * sim.terrain.W + wx] === 0) sim.terrain.set(wx, wy, M.WEB);
        }
        const dh = Math.hypot(c.homeX - c.x, c.homeY - c.y);
        if (dh > 3) this.move(c, c.homeX - c.x, c.homeY - c.y, c.def.speed * 0.5, dt);
        if (c.timer <= 0) {
          c.timer = 1.5;
          const range = night ? 45 : 28;
          // одиночки: мало соседей вокруг жертвы
          let best = -1;
          let bs = Infinity;
          sim.antHash.query(c.x, c.y, range, (a) => {
            if (ants.state[a] === S.DYING || ants.state[a] === S.STRUCT_NODE) return;
            const dens = sim.antHash.densityAround(ants.x[a], ants.y[a]);
            const d = Math.hypot(ants.x[a] - c.x, ants.y[a] - c.y);
            const s = d + dens * 6;
            if (dens < 6 && s < bs) { bs = s; best = a; }
          });
          if (best >= 0) { c.state = CS.HUNT; c.target = best; c.timer = 20; }
        }
        break;
      }
      case CS.HUNT: {
        const a = c.target;
        if (a < 0 || !ants.alive[a] || ants.state[a] === S.DYING || c.timer <= 0) { c.state = CS.LURK; c.timer = 4; break; }
        const dx = ants.x[a] - c.x;
        const dy = ants.y[a] - c.y;
        if (dx * dx + dy * dy < (c.def.radius + 1) ** 2) { c.state = CS.ATTACK; c.timer = 6; break; }
        this.move(c, dx, dy, c.def.speed, dt);
        break;
      }
      case CS.ATTACK: {
        const bitten = this.biteNearest(c, dt);
        if (bitten < 0 || c.timer <= 0) { c.state = CS.EAT; c.timer = 5; }
        break;
      }
      case CS.EAT:
        if (c.timer <= 0) { c.state = CS.LURK; c.timer = 3; }
        break;
      case CS.RETREAT: {
        this.move(c, c.homeX - c.x, c.homeY - c.y, c.def.speed * 1.2, dt);
        if (c.timer <= 0 && c.pressure < 3) { c.state = CS.LURK; c.timer = 8; }
        if (c.pressure > 0) this.biteNearest(c, dt * 0.5);
        break;
      }
    }
  }

  private beetle(c: Creature, dt: number): void {
    const sim = this.sim;
    c.timer -= dt;
    if (c.pressure >= 5 || c.hp < c.def.hp * 0.3) {
      c.state = CS.FLEE;
      if (c.timer <= 0) c.timer = 6;
    }
    switch (c.state) {
      case CS.WANDER: {
        if (c.timer <= 0) {
          c.timer = 2;
          const it = sim.food.sense(c.x, c.y, 30, (f) => f.mass > 0.5 && f.delivering < 0);
          if (it) { c.state = CS.EAT; c.target = it.id; c.timer = 25; break; }
          // запах кладовой гнезда — идёт грабить
          for (const col of sim.colonies) {
            if (col.food > 30 && Math.hypot(col.nest.entranceX - c.x, col.nest.entranceY - c.y) < 60 && sim.rng.chance(0.15)) {
              c.state = CS.RAID; c.target = col.id; c.timer = 40;
            }
          }
        }
        this.move(c, c.dirSign, 0, c.def.speed * 0.6, dt);
        break;
      }
      case CS.EAT: {
        const it = sim.food.get(c.target);
        if (!it || it.removed || c.timer <= 0) { c.state = CS.WANDER; c.timer = 3; break; }
        const dx = it.x - c.x;
        const dy = it.y - c.y;
        if (dx * dx + dy * dy > (it.r + c.def.radius + 0.5) ** 2) this.move(c, dx, dy, c.def.speed, dt);
        else sim.food.take(it, dt * 0.8);
        if (c.pressure > 0) this.biteNearest(c, dt);
        break;
      }
      case CS.RAID: {
        const col = sim.colonies[c.target];
        if (!col || c.timer <= 0) { c.state = CS.WANDER; break; }
        const f = col.nest.field;
        const dir = this.tmp;
        const d = f.dist(c.x, c.y);
        if (d < 4 || col.nest.atEntrance(c.x, c.y, 5)) {
          // в гнезде: ест запасы
          const stolen = Math.min(col.food, dt * 2.5);
          col.food -= stolen;
          col.addThreat('creature', c.id, c.x, c.y, 3, sim.time);
          col.pher.splash(P.DANGER, c.x, c.y, 6, 2 * dt * 10, sim.time);
        } else if (f.descend(c.x, c.y, dir)) this.move(c, dir[0], dir[1], c.def.speed, dt);
        else this.move(c, col.nest.entranceX - c.x, col.nest.entranceY - c.y, c.def.speed, dt);
        if (c.pressure > 0) this.biteNearest(c, dt);
        break;
      }
      case CS.FLEE: {
        this.move(c, c.dirSign, -0.2, c.def.speed * 1.3, dt);
        if (c.pressure > 0) this.biteNearest(c, dt);
        if (c.timer <= 0 && c.pressure < 2) { c.state = CS.WANDER; c.timer = 5; }
        break;
      }
      default:
        c.state = CS.WANDER;
    }
  }

  private worm(c: Creature, dt: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    c.timer -= dt;
    if (c.timer <= 0) {
      c.timer = sim.rng.range(4, 10);
      // в дождь черви лезут к поверхности
      const rain = sim.weather.rain > 0.3;
      const gy = t.groundY(c.x | 0);
      c.homeX = c.x + sim.rng.range(-30, 30);
      c.homeY = rain ? gy - 1 : gy + sim.rng.range(8, 50);
    }
    const dx = c.homeX - c.x;
    const dy = c.homeY - c.y;
    const l = Math.hypot(dx, dy) || 1;
    c.heading = Math.atan2(dy, dx);
    const sp = c.def.speed * dt;
    const nx = c.x + (dx / l) * sp;
    const ny = c.y + (dy / l) * sp;
    const xi = nx | 0;
    const yi = ny | 0;
    if (!t.inBounds(xi, yi)) return;
    const m = t.get(xi, yi);
    const soft = m === M.SOIL || m === M.TOPSOIL || m === M.LOOSE || m === M.MUD || m === M.CLAY || m === M.SAND || m === M.NESTWALL || m === M.BUILT || m === M.ORGANIC || m === M.AIR;
    if (!soft) { c.timer = 0; return; }
    c.x = nx;
    c.y = ny;
    c.anim += sp * 2;
    // ход червя: иногда остаётся полость — может вскрыть комнату гнезда
    if (m !== M.AIR && sim.rng.chance(dt * 0.4)) {
      t.set(xi, yi, M.AIR);
      t.moist[yi * t.W + xi] = Math.min(255, t.moist[yi * t.W + xi] + 40);
    }
    if (!IS_SOLID[m] && t.solid(xi, yi + 1) === false && c.y < t.groundY(xi)) c.y += dt * 8;
  }

  private caterpillar(c: Creature, dt: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    c.timer -= dt;
    if (c.timer <= 0) {
      c.timer = sim.rng.range(3, 7);
      c.dirSign = sim.rng.sign();
      // объедает соседний лист
      for (let k = 0; k < 6; k++) {
        const lx = Math.round(c.x + sim.rng.range(-2, 2));
        const ly = Math.round(c.y + sim.rng.range(-2, 2));
        if (t.get(lx, ly) === M.LEAF) { t.set(lx, ly, M.AIR); break; }
      }
    }
    this.move(c, c.dirSign, sim.rng.range(-0.5, 0.5), c.def.speed, dt);
  }

  private fly(c: Creature, dt: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    c.timer -= dt;
    if (c.timer <= 0) {
      c.timer = sim.rng.range(1, 3);
      const it = sim.food.sense(c.x, c.y, 60);
      if (it && sim.rng.chance(0.6)) { c.homeX = it.x; c.homeY = it.y - it.r - 1; }
      else { c.homeX = c.x + sim.rng.range(-40, 40); c.homeY = c.y + sim.rng.range(-25, 20); }
      const gy = t.groundY(Math.max(0, Math.min(t.W - 1, c.homeX | 0)));
      c.homeY = Math.min(c.homeY, gy - 2);
    }
    const dx = c.homeX - c.x;
    const dy = c.homeY - c.y;
    const l = Math.hypot(dx, dy);
    if (l > 0.5) {
      const sp = c.def.speed * dt;
      const nx = c.x + (dx / l) * sp + Math.sin(sim.time * 13 + c.id) * 0.15;
      const ny = c.y + (dy / l) * sp + Math.cos(sim.time * 11 + c.id) * 0.15;
      if (!t.solid(nx | 0, ny | 0)) { c.x = nx; c.y = ny; }
      else c.timer = 0;
      c.heading = Math.atan2(dy, dx);
    }
    c.anim += dt * 60;
    if (c.pressure > 0 && l < 0.6) this.damage(c, 0, -1);
  }

  /** Экосистема восполняется: новые мухи/жуки/гусеницы приходят со временем. */
  private respawnT = 0;
  private respawn(dt: number): void {
    const sim = this.sim;
    this.respawnT += dt;
    if (this.respawnT < 25) return;
    this.respawnT = 0;
    const counts = [0, 0, 0, 0, 0];
    for (const c of this.list) if (c.alive) counts[c.kind]++;
    const W = sim.terrain.W;
    const mode = sim.mode;
    const maxSp = Math.round(2 * mode.predators);
    if (counts[CK.FLY] < 6) this.spawn(CK.FLY, sim.rng.range(20, W - 20), sim.terrain.groundY(W / 2) - 60);
    if (counts[CK.BEETLE] < Math.round(4 * mode.predators) && sim.rng.chance(0.5)) {
      const x = sim.rng.chance(0.5) ? 8 : W - 8;
      this.spawn(CK.BEETLE, x, sim.terrain.groundY(x) - 3);
    }
    if (counts[CK.SPIDER] < maxSp && sim.rng.chance(0.25)) {
      const x = sim.rng.range(40, W - 40);
      const y = sim.terrain.groundY(x | 0) - 3;
      this.spawn(CK.SPIDER, x, y, [x, y]);
    }
    if (counts[CK.CATERPILLAR] < 5 && sim.rng.chance(0.4)) {
      const p = sim.plants.randomLeafy();
      if (p) this.spawn(CK.CATERPILLAR, p[0], p[1]);
    }
  }
}
