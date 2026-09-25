import { C } from '../ants/Castes';
import { FOOD_KINDS } from '../food/FoodTypes';
import type { Simulation } from '../sim/Simulation';
import { Route, RP } from './Routes';

const STREAM_SPEED = 4.6;

/**
 * Потоки — уровень 4 иерархического роевого ИИ.
 * Когда агентов больше бюджета, колония не создаёт новых агентов, а "вливает"
 * муравьёв в поток по готовому маршруту. У муравья в потоке нет состояния:
 * его позиция — функция (номер, время, длина маршрута), поэтому поток из
 * 500 000 муравьёв стоит столько же, сколько из 50. При этом поток реален:
 * он забирает массу еды у источника, доставляет её с задержкой пути,
 * теряет муравьёв, если на маршрут выходит хищник, и рвётся, если путь перекрыт.
 */
export class StreamManager {
  private checkT = 0;
  private tmp = [0, 0, 0];

  constructor(private sim: Simulation) {}

  update(dt: number): void {
    const sim = this.sim;
    this.checkT += dt;
    const check = this.checkT > 1;
    if (check) this.checkT = 0;
    for (const col of sim.colonies) {
      let total = 0;
      for (const r of sim.routes.routes.values()) {
        if (r.colony !== col.id) continue;
        if (r.stream > 0 || check) this.updateRoute(r, dt, check);
        total += r.stream;
      }
      col.streamAnts = total;
      // отложенные доставки (еда в пути)
      const pd = col.pendingDeliveries;
      while (pd.length > 0 && pd[0][0] <= sim.time) {
        const [, amt] = pd.shift()!;
        col.store(amt);
        col.stats.delivered += amt;
        col.addIncome(amt);
        col.evo.add(amt * 0.9);
      }
    }
  }

  private updateRoute(r: Route, dt: number, check: boolean): void {
    const sim = this.sim;
    const col = sim.colonies[r.colony];
    const L = Math.max(10, sim.routes.length(r));
    r.streamPhase += dt * STREAM_SPEED;
    if (r.purpose !== RP.FOOD) {
      if (r.stream > 0) this.shrink(r, r.stream * dt * 0.2 + 1);
      return;
    }
    // доступная еда у конца маршрута
    let avail = 0;
    sim.food.query(r.endX, r.endY, 30, (it) => { if (!it.attached && !it.airborne && !FOOD_KINDS[it.kind].resource && it.delivering < 0) avail += it.mass; });
    if (check) {
      // проходимость (обвал, вода, разрушенный мост)
      r.blocked = !sim.routes.ready(r) || this.pathBlocked(r);
      if (r.blocked && r.stream > 0) {
        const lost = r.stream;
        // часть материализуется у места разрыва — реагировать на месте
        this.materializeNear(r, Math.min(40, Math.floor(lost * 0.05)));
        col.residentsReturn(r.stream);
        r.stream = 0;
        sim.bus.emit({ type: 'notice', text: `Поток прерван: путь перекрыт (${Math.round(lost)} муравьёв вернулись)`, x: r.endX, y: r.endY, tone: 'bad' });
        return;
      }
      // хищники на маршруте
      this.predation(r, dt * 1);
      // целевой размер потока
      const overBudget = col.agents >= col.agentBudget * 0.85;
      const residents = col.residents[C.WORKER] + col.residents[C.CARRIER];
      let target = 0;
      if (!r.blocked && avail > 1 && (overBudget || col.evo.has('streams'))) {
        const tripTime = (2 * L) / STREAM_SPEED + 2;
        // сколько нужно, чтобы вынести всю еду за ~2 минуты; поток не больше половины жителей
        target = Math.min(residents * 0.55 * Math.min(2, r.score), (avail / 120) * tripTime * 1.3 + 40);
        target = Math.max(0, Math.floor(target));
      }
      if (target > r.stream) {
        const grow = Math.floor(Math.min(target - r.stream, Math.max(4, r.stream * 0.12), col.residents[C.WORKER] - 5));
        if (grow > 0) {
          col.residents[C.WORKER] -= grow;
          r.stream += grow;
        }
      } else if (target < r.stream) this.shrink(r, Math.max(2, (r.stream - target) * 0.15));
    }
    if (r.stream <= 0) return;
    // перенос: каждый муравей потока совершает рейс за 2L/v
    const trip = (2 * L) / STREAM_SPEED + 2;
    let want = (r.stream / trip) * dt * 1.0;
    if (want > 0 && avail > 0) {
      let taken = 0;
      sim.food.query(r.endX, r.endY, 30, (it) => {
        if (want <= 0 || it.attached || it.airborne || FOOD_KINDS[it.kind].resource || it.delivering >= 0) return;
        const g = sim.food.take(it, want);
        want -= g;
        taken += g * FOOD_KINDS[it.kind].nutrition;
      });
      if (taken > 0) {
        col.pendingDeliveries.push([sim.time + L / STREAM_SPEED, taken]);
        r.deliveries += taken * 0.05;
      }
    }
  }

  private shrink(r: Route, n: number): void {
    const col = this.sim.colonies[r.colony];
    const d = Math.min(r.stream, Math.ceil(n));
    r.stream -= d;
    col.residentsReturn(d);
  }

  /**
   * Проходим ли маршрут. Поверхность меняется (холмик у входа растёт, обвалы),
   * поэтому точки маршрута "переприлипают" к ближайшей поверхности по вертикали;
   * заблокирован маршрут, только если поверхности рядом нет вовсе.
   */
  private pathBlocked(r: Route): boolean {
    const sim = this.sim;
    const t = sim.terrain;
    for (let k = 0; k < r.pts.length; k += 2) {
      const x = r.pts[k] | 0;
      const y = r.pts[k + 1] | 0;
      if (sim.nav.walkable(x, y)) continue;
      let found = -1;
      for (let d = 1; d <= 8 && found < 0; d++) {
        if (sim.nav.walkable(x, y - d)) found = y - d;
        else if (sim.nav.walkable(x, y + d)) found = y + d;
      }
      if (found >= 0) { r.pts[k + 1] = found + 0.5; continue; }
      if (t.water[y * t.W + x] > 110) continue;
      return true;
    }
    return false;
  }

  /** Хищник у маршрута ловит муравьёв потока; колония учит, что маршрут опасен. */
  private predation(r: Route, dt: number): void {
    const sim = this.sim;
    if (r.stream <= 0) return;
    const col = sim.colonies[r.colony];
    for (const c of sim.creatures.list) {
      if (!c.alive || c.dying > 0 || c.def.role !== 'predator') continue;
      for (let k = 0; k < r.pts.length; k += 6) {
        const d = Math.hypot(r.pts[k] - c.x, r.pts[k + 1] - c.y);
        if (d < 8) {
          const kills = Math.min(r.stream, Math.max(1, Math.round(dt * 0.8 * Math.min(10, 1 + r.stream / 500))));
          r.stream -= kills;
          col.stats.died += kills;
          r.danger += kills * 0.2;
          col.addThreat('creature', c.id, c.x, c.y, 2, sim.time);
          col.memory.addDanger(c.x, c.y, 0.3);
          break;
        }
      }
    }
  }

  /** Превратить часть потока обратно в полноценных агентов около точки разрыва. */
  private materializeNear(r: Route, n: number): void {
    const sim = this.sim;
    const p = this.tmp;
    const L = sim.routes.length(r);
    for (let k = 0; k < n; k++) {
      sim.routes.pointAt(r, sim.rng.next() * L * 0.4, p);
      if (!sim.nav.walkable(p[0] | 0, p[1] | 0)) continue;
      const id = sim.antSystem.spawn(r.colony, C.WORKER, p[0], p[1]);
      sim.antSystem.brain.goHome(id);
      r.stream = Math.max(0, r.stream - 1);
    }
  }

  /**
   * Позиция i-го муравья потока в момент времени (для рендера). Полностью
   * детерминирована и не хранится: половина идёт к цели, половина — с грузом домой.
   */
  antPos(r: Route, i: number, L: number, out: number[]): boolean {
    const spacing = L * 2 / Math.max(1, r.stream);
    let s = (r.streamPhase + i * spacing + ((i * 2654435761) % 997) * 0.003) % (L * 2);
    const back = s > L;
    if (back) s = L * 2 - s;
    this.sim.routes.pointAt(r, s, out);
    // ширина "реки" растёт с числом муравьёв
    const width = Math.min(4, 0.4 + Math.sqrt(r.stream) * 0.02);
    const lane = ((((i * 7919) % 1000) / 1000) - 0.5) * width;
    const ang = out[2];
    out[0] += -Math.sin(ang) * lane;
    out[1] += Math.cos(ang) * lane * 0.5 - Math.abs(lane) * 0.5;
    out[2] = back ? ang + Math.PI : ang;
    return back;
  }
}
