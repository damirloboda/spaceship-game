import { FK } from '../food/FoodTypes';
import { placePlantCell } from '../procgen/WorldGenerator';
import { IS_SOLID, M } from '../world/Materials';
import type { Simulation } from '../sim/Simulation';
import { makeGenome, Plant, PK, rasterPlant } from './PlantShapes';

/**
 * Растения живут: пьют влагу из почвы корнями, растут днём и после дождя,
 * дают ягоды и семена, теряют листья на ветру, объедаются гусеницами и
 * листорезами, засыхают без воды. Если перегрызть ствол у основания — дерево падает
 * и превращается в бревно-мост и груду листьев.
 */
export class PlantSystem {
  plants: Plant[] = [];
  private byId = new Map<number, Plant>();
  private cursor = 0;
  private nextId = 1;
  /** семена на земле: food id -> время, когда прорастёт */
  private seeds = new Map<number, number>();

  constructor(private sim: Simulation) {
    sim.terrain.onChange((x, y, old, nm) => {
      const pid = sim.terrain.changedPlant;
      if (!pid || nm !== M.AIR) return;
      const p = this.byId.get(pid);
      if (!p || p.fallen) return;
      // перегрызли основание ствола/стебля
      if ((old === M.WOOD || old === M.STEM || old === M.GRASS) && y >= p.y - 2 && Math.abs(x - p.x) <= Math.max(1, p.genome.trunkW)) {
        this.fall(p);
      }
    });
  }

  add(p: Plant): void {
    this.plants.push(p);
    this.byId.set(p.id, p);
    this.nextId = Math.max(this.nextId, p.id + 1);
  }

  get(id: number): Plant | undefined {
    return this.byId.get(id);
  }

  randomLeafy(): [number, number] | null {
    const cands = this.plants.filter((p) => !p.dead && (p.kind === PK.BUSH || p.kind === PK.TREE));
    if (cands.length === 0) return null;
    const p = cands[this.sim.rng.int(cands.length)];
    return [p.x + this.sim.rng.range(-8, 8), p.y - p.genome.height * p.size * 0.7];
  }

  update(dt: number): void {
    const sim = this.sim;
    const n = Math.min(this.plants.length, 6);
    const light = sim.clock.light();
    for (let k = 0; k < n; k++) {
      if (this.cursor >= this.plants.length) this.cursor = 0;
      const p = this.plants[this.cursor++];
      if (!p) continue;
      const step = dt * (this.plants.length / n);
      this.tickPlant(p, step, light);
    }
    // прорастание семян
    if (sim.tick % 30 === 0) {
      for (const [fid, when] of this.seeds) {
        const it = sim.food.get(fid);
        if (!it || it.removed) { this.seeds.delete(fid); continue; }
        if (sim.time >= when) {
          this.seeds.delete(fid);
          const x = Math.round(it.x);
          const gy = this.groundBelow(x, Math.round(it.y));
          const gm = sim.terrain.get(x, gy);
          if ((gm === M.TOPSOIL || gm === M.SOIL) && this.plants.length < 400) {
            sim.food.remove(it);
            this.sprout(it.kind === FK.SEED && sim.rng.chance(0.4) ? PK.DANDELION : PK.GRASS, x, gy);
          }
        }
      }
    }
    if (sim.tick % 60 === 0) this.plants = this.plants.filter((p) => !(p.dead && p.fallen && p.age > 1e9));
  }

  private groundBelow(x: number, y: number): number {
    const t = this.sim.terrain;
    let yy = y;
    while (yy < t.H - 1 && !IS_SOLID[t.get(x, yy)]) yy++;
    return yy;
  }

  sprout(kind: number, x: number, groundY: number): Plant | null {
    const sim = this.sim;
    if (sim.terrain.get(x, groundY - 1) !== M.AIR) return null;
    const p: Plant = {
      id: this.nextId++, kind, x, y: groundY, seed: (sim.rng.next() * 1e9) | 0, size: 0.08, age: 0, health: 1, water: 1,
      dead: false, fallen: false, genome: makeGenome(kind, (sim.rng.next() * 1e9) | 0), fruitTimer: 60, seedTimer: 90, growTimer: 0, flower: 0,
    };
    this.add(p);
    this.raster(p);
    return p;
  }

  private raster(p: Plant): void {
    const t = this.sim.terrain;
    rasterPlant(p, p.size, (x, y, m) => {
      if (m === M.FLOWER && p.flower >= 2) return;
      placePlantCell(t, p.id, x, y, m, false);
    });
  }

  private tickPlant(p: Plant, dt: number, light: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    p.age += dt;
    if (p.fallen) return;
    // вода из почвы у корней
    let moist = 0;
    let cnt = 0;
    for (let d = 2; d < 12; d += 3) {
      const yy = p.y + d;
      if (yy >= t.H) break;
      moist += t.moist[yy * t.W + p.x];
      cnt++;
    }
    const soil = cnt ? moist / cnt / 255 : 0;
    p.water += (soil * 1.4 - 0.25) * dt * 0.02;
    p.water = Math.max(0, Math.min(1.2, p.water));
    // корни пьют: почва сохнет
    if (cnt && sim.rng.chance(dt * 0.2)) {
      const i = (p.y + 4) * t.W + p.x;
      if (t.moist[i] > 3) t.moist[i] -= 3;
    }
    if (p.water < 0.1) p.health -= dt * 0.004;
    else p.health = Math.min(1, p.health + dt * 0.002);
    if (p.health <= 0 && !p.dead) this.die(p);
    if (p.dead) {
      // засохшее растение осыпается
      if (sim.rng.chance(dt * 0.02)) this.shed(p, 1);
      return;
    }
    // рост
    if (p.size < 1) {
      const rate = (p.kind === PK.TREE ? 0.0009 : p.kind === PK.BUSH ? 0.002 : 0.006) * (0.3 + light) * Math.min(1, p.water + 0.2);
      const before = Math.floor(p.size * 20);
      p.size = Math.min(1, p.size + rate * dt);
      if (Math.floor(p.size * 20) !== before) this.raster(p);
    } else {
      p.growTimer -= dt;
      if (p.growTimer <= 0) {
        // отрастание объеденных листьев
        p.growTimer = 40 + sim.rng.next() * 40;
        if (p.water > 0.3) this.raster(p);
      }
    }
    // плоды
    if (p.kind === PK.BUSH && p.size > 0.7) {
      p.fruitTimer -= dt * (0.5 + p.water);
      if (p.fruitTimer <= 0) {
        p.fruitTimer = 70 + sim.rng.next() * 90;
        const spots: [number, number][] = [];
        rasterPlant(p, p.size, () => {}, spots);
        let hanging = 0;
        for (const it of sim.food.items) if (it.attached === p.id) hanging++;
        if (spots.length && hanging < 5) {
          const [fx, fy] = spots[sim.rng.int(spots.length)];
          if (!t.solid(fx, fy)) sim.food.spawn(FK.BERRY, fx + 0.5, fy + 0.5, sim.rng.range(6, 10), { attached: p.id });
        }
      }
      // спелые ягоды падают (ветер ускоряет)
      if (sim.rng.chance(dt * (0.01 + Math.abs(sim.weather.wind) * 0.05))) {
        for (const it of sim.food.items) if (it.attached === p.id && it.age > 60) { it.attached = 0; break; }
      }
    }
    if (p.kind === PK.DANDELION && p.size > 0.8) {
      p.seedTimer -= dt;
      if (p.seedTimer <= 0) {
        if (p.flower === 0) { p.flower = 1; p.seedTimer = 60; }
        else if (p.flower === 1) {
          // пух разлетается семенами по ветру
          p.flower = 2;
          p.seedTimer = 200;
          const topY = p.y - p.genome.height * p.size - 3;
          this.clearMaterial(p, M.FLOWER);
          for (let k = 0; k < 5; k++) {
            const it = sim.food.spawn(FK.SEED, p.x + sim.rng.range(-2, 2), topY + sim.rng.range(-2, 2), 1, { airborne: true });
            this.seeds.set(it.id, sim.time + 90 + sim.rng.next() * 120);
          }
        } else { p.flower = 0; p.seedTimer = 120; this.raster(p); }
      }
    }
    if (p.kind === PK.TREE && p.size > 0.9) {
      p.seedTimer -= dt;
      if (p.seedTimer <= 0) {
        p.seedTimer = 50 + sim.rng.next() * 80;
        const spots: [number, number][] = [];
        rasterPlant(p, p.size, () => {}, spots);
        if (spots.length) {
          const [sx, sy] = spots[sim.rng.int(spots.length)];
          sim.food.spawn(FK.SEED, sx, sy, 2);
          if (sim.rng.chance(0.3)) sim.food.spawn(FK.TWIG, sx + 2, sy, 1.2);
        }
      }
      // листопад на сильном ветру
      if (Math.abs(sim.weather.wind) > 0.6 && sim.rng.chance(dt * 0.1)) this.shed(p, 1);
    }
  }

  /** Сбросить несколько листьев как предметы (ресурс для грибной фермы). */
  private shed(p: Plant, n: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    const spots: [number, number][] = [];
    rasterPlant(p, p.size, () => {}, spots);
    for (let k = 0; k < n && spots.length; k++) {
      const [x, y] = spots[sim.rng.int(spots.length)];
      for (let r = 0; r < 12; r++) {
        const lx = x + sim.rng.irange(-4, 4);
        const ly = y + sim.rng.irange(-4, 4);
        if (t.get(lx, ly) === M.LEAF && t.plant[ly * t.W + lx] === p.id) {
          t.set(lx, ly, M.AIR);
          sim.food.spawn(FK.LEAF, lx + 0.5, ly + 0.5, 1);
          break;
        }
      }
    }
  }

  private clearMaterial(p: Plant, mat: number): void {
    const t = this.sim.terrain;
    const R = 8;
    const topY = Math.round(p.y - p.genome.height * p.size);
    for (let y = topY - R; y <= topY + R; y++)
      for (let x = p.x - R; x <= p.x + R; x++)
        if (t.inBounds(x, y) && t.get(x, y) === mat && t.plant[y * t.W + x] === p.id) t.set(x, y, M.AIR);
  }

  private die(p: Plant): void {
    p.dead = true;
    if (p.kind === PK.TREE || p.kind === PK.BUSH) this.sim.bus.emit({ type: 'notice', text: `Засохло: ${['трава', 'одуванчик', 'куст', 'дерево'][p.kind]}`, x: p.x, y: p.y, tone: 'info' });
  }

  /** Падение: всё надземное удаляется, ствол ложится бревном по ветру, листва — ресурсом. */
  fall(p: Plant): void {
    if (p.fallen) return;
    const sim = this.sim;
    const t = sim.terrain;
    p.fallen = true;
    p.dead = true;
    const g = p.genome;
    const R = Math.ceil(g.branchLen + g.leafR * 1.5 + 6);
    const top = Math.max(0, Math.round(p.y - g.height * p.size - g.leafR * 2 - 4));
    let wood = 0;
    let leaves = 0;
    for (let y = top; y < p.y; y++)
      for (let x = p.x - R; x <= p.x + R; x++) {
        if (!t.inBounds(x, y)) continue;
        const i = y * t.W + x;
        if (t.plant[i] !== p.id) continue;
        const m = t.mat[i];
        if (m === M.WOOD || m === M.STEM) wood++;
        if (m === M.LEAF || m === M.FLOWER || m === M.GRASS) leaves++;
        t.plant[i] = 0;
        t.set(x, y, M.AIR);
      }
    if (p.kind === PK.TREE || p.kind === PK.BUSH) {
      const dir = sim.weather.wind !== 0 ? Math.sign(sim.weather.wind) : sim.rng.sign();
      const len = Math.round(g.height * p.size * 0.9);
      const thick = Math.max(1, Math.round(g.trunkW * 0.7));
      for (let k = 1; k <= len; k++) {
        const x = p.x + dir * k;
        if (x < 1 || x >= t.W - 1) break;
        let y = 0;
        while (y < t.H - 1 && !IS_SOLID[t.mat[y * t.W + x]]) y++;
        for (let h = 1; h <= thick; h++) if (t.get(x, y - h) === M.AIR) t.set(x, y - h, M.WOOD);
      }
      const nLeaves = Math.min(60, Math.ceil(leaves / 8));
      for (let k = 0; k < nLeaves; k++) {
        const x = p.x + dir * sim.rng.range(len * 0.5, len * 1.1);
        sim.food.spawn(FK.LEAF, x, t.groundY(x | 0) - 6 - sim.rng.range(0, 6), 1);
      }
      for (let k = 0; k < Math.min(20, wood / 20); k++) sim.food.spawn(FK.TWIG, p.x + dir * sim.rng.range(2, len), t.groundY((p.x + dir * 4) | 0) - 5, 1.2);
      sim.bus.emit({ type: 'treeFell', x: p.x, y: p.y });
    }
  }
}
