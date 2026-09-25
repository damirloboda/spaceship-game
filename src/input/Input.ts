import { S, STATE_NAMES } from '../ants/AntStore';
import { CASTES } from '../ants/Castes';
import { CS_NAMES } from '../creatures/CreatureSystem';
import { FOOD_KINDS } from '../food/FoodTypes';
import { P_NAMES } from '../pheromone/PheromoneField';
import type { Renderer } from '../render/Renderer';
import type { Simulation } from '../sim/Simulation';
import { M } from '../world/Materials';
import type { UI } from '../ui/UI';

/**
 * Ввод: мышь, тач (щипок/два пальца), клавиатура. Инструменты превращаются
 * в команды симуляции — ввод никогда не трогает мир напрямую.
 */
export class Input {
  /** текущая нарисованная линия (мир) */
  stroke: number[][] = [];
  /** клетки под кистью */
  brushCells = new Map<number, [number, number]>();
  hover: [number, number] = [0, 0];
  hoverScreen: [number, number] = [0, 0];
  private down = false;
  private panning = false;
  private erase = false;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;
  private pointers = new Map<number, [number, number]>();
  private pinchD = 0;
  private keys = new Set<string>();
  follow = false;
  cinematic = false;

  constructor(private canvas: HTMLCanvasElement, private sim: Simulation, private r: Renderer, private ui: UI) {
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    this.attachCanvas(canvas);
  }

  /** Холст пересоздаётся при новой игре — слушатели вешаются заново только на него. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.r.cam.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  rebind(sim: Simulation, r: Renderer, canvas: HTMLCanvasElement): void {
    this.sim = sim;
    this.r = r;
    this.stroke = [];
    this.brushCells.clear();
    this.attachCanvas(canvas);
  }

  private world(e: { clientX: number; clientY: number }): [number, number] {
    return this.r.cam.screenToWorld(e.clientX, e.clientY);
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.pointers.size === 2) {
      // второй палец — отменяем рисование, начинаем щипок/пан
      this.cancelStroke();
      this.panning = true;
      const [a, b] = [...this.pointers.values()];
      this.pinchD = Math.hypot(a[0] - b[0], a[1] - b[1]);
      this.lastX = (a[0] + b[0]) / 2;
      this.lastY = (a[1] + b[1]) / 2;
      return;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.moved = 0;
    if (e.button === 1 || e.button === 2 && this.ui.tool !== 'forbid' || this.keys.has(' ')) {
      this.panning = true;
      return;
    }
    this.down = true;
    this.erase = e.button === 2;
    this.r.cam.follow = -1;
    const [wx, wy] = this.world(e);
    const tool = this.ui.tool;
    if (tool === 'route') this.stroke = [[wx, wy]];
    else if (isBrush(tool)) { this.brushCells.clear(); this.paint(wx, wy); }
    else if (tool === 'inspect') this.panning = true;
  }

  private onMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
    this.hoverScreen = [e.clientX, e.clientY];
    this.hover = this.world(e);
    if (this.pointers.size === 2 && this.panning) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      this.r.cam.panBy(cx - this.lastX, cy - this.lastY);
      if (this.pinchD > 0) this.r.cam.zoomAt(cx, cy, d / this.pinchD);
      this.pinchD = d;
      this.lastX = cx;
      this.lastY = cy;
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.panning) {
      this.r.cam.panBy(dx, dy);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (!this.down) return;
    const [wx, wy] = this.hover;
    const tool = this.ui.tool;
    if (tool === 'route') {
      const last = this.stroke[this.stroke.length - 1];
      if (!last || Math.hypot(wx - last[0], wy - last[1]) > Math.max(1.2, 6 / this.r.cam.zoom)) this.stroke.push([wx, wy]);
    } else if (isBrush(tool)) this.paint(wx, wy);
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.panning) {
      if (this.pointers.size === 0) this.panning = false;
      if (this.ui.tool === 'inspect' && this.moved < 6) this.click(e);
      return;
    }
    if (!this.down) return;
    this.down = false;
    const tool = this.ui.tool;
    const sim = this.sim;
    if (tool === 'route') {
      if (this.stroke.length >= 2) {
        const pts = this.stroke.map(([x, y]) => [Math.round(x), Math.round(y)]);
        sim.queue({ type: 'route', points: pts });
      }
      this.stroke = [];
      return;
    }
    if (isBrush(tool)) {
      const cells = [...this.brushCells.values()];
      this.brushCells.clear();
      if (cells.length === 0) return;
      if (tool === 'dig') sim.queue({ type: 'dig', cells });
      else if (tool === 'build') sim.queue({ type: 'build', cells });
      else if (tool === 'reinforce') sim.queue({ type: 'reinforce', cells });
      else if (tool === 'forbid') sim.queue({ type: 'forbid', cells, on: !this.erase });
      else if (tool === 'paint') sim.queue({ type: 'paint', cells, mat: M.SOIL });
      else if (tool === 'erase') sim.queue({ type: 'paint', cells, mat: M.AIR });
      return;
    }
    if (this.moved < 8) this.click(e);
  }

  private click(e: { clientX: number; clientY: number }): void {
    const [x, y] = this.world(e);
    const sim = this.sim;
    switch (this.ui.tool) {
      case 'food': sim.queue({ type: 'markFood', x, y }); break;
      case 'attack': sim.queue({ type: 'attack', x, y }); this.ui.note('Приказ: атаковать', 'info'); break;
      case 'explore': sim.queue({ type: 'explore', x, y }); this.ui.note('Разведчики направлены', 'info'); break;
      case 'cfood': sim.queue({ type: 'spawnFood', kind: [0, 2, 3, 4, 5, 6][Math.floor(Math.random() * 6)], x, y, mass: 1 + Math.random() * 60 }); break;
      case 'water': sim.queue({ type: 'water', x, y }); break;
      case 'inspect': {
        const a = sim.ants;
        let best = -1;
        let bd = 3;
        for (let i = 0; i < a.n; i++) {
          if (!a.alive[i]) continue;
          const d = Math.hypot(a.x[i] - x, a.y[i] - y);
          if (d < bd) { bd = d; best = i; }
        }
        this.r.selectedAnt = best;
        if (best >= 0) { this.r.cam.follow = best; this.follow = true; }
        break;
      }
    }
  }

  private paint(wx: number, wy: number): void {
    const r = this.ui.brush;
    const t = this.sim.terrain;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const x = Math.floor(wx) + dx;
        const y = Math.floor(wy) + dy;
        if (!t.inBounds(x, y)) continue;
        this.brushCells.set(y * t.W + x, [x, y]);
      }
  }

  private cancelStroke(): void {
    this.down = false;
    this.stroke = [];
    this.brushCells.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    const ui = this.ui;
    if (k === 'escape') { if (ui.menuOpen) ui.closeMenu(); else if (this.stroke.length) this.cancelStroke(); else ui.openMenu(); return; }
    if (ui.menuOpen) return;
    const toolKeys: Record<string, string> = { '1': 'route', '2': 'food', '3': 'dig', '4': 'build', '5': 'reinforce', '6': 'forbid', '7': 'attack', '8': 'explore', '9': 'inspect' };
    if (toolKeys[k]) ui.setTool(toolKeys[k]);
    else if (k === ' ') { ui.setSpeed(0); e.preventDefault(); }
    else if (k === '+' || k === '=') ui.setSpeed(Math.min(8, ui.speed * 2));
    else if (k === '-') ui.setSpeed(Math.max(1, ui.speed / 2));
    else if (k === '[') { ui.brush = Math.max(0, ui.brush - 1); ui.hint(`Кисть: ${ui.brush}`, 1200); }
    else if (k === ']') { ui.brush = Math.min(12, ui.brush + 1); ui.hint(`Кисть: ${ui.brush}`, 1200); }
    else if (k === 'p') { this.r.overlay = this.r.overlay ? 0 : 1; ui.setOverlayOn(this.r.overlay === 1); }
    else if (k === 'f') { this.follow = !this.follow; if (!this.follow) this.r.cam.follow = -1; else if (this.r.selectedAnt >= 0) this.r.cam.follow = this.r.selectedAnt; }
    else if (k === 'c') { this.cinematic = !this.cinematic; ui.hint(this.cinematic ? 'Кинокамера: включена — камера сама покажет важные моменты' : 'Кинокамера: выключена', 2500); }
    else if (k === 'h') ui.openMenu('help');
    else if (k === 'g') ui.toggleQuality();
  }

  /** Непрерывные клавиши (пан/зум). */
  update(dt: number): void {
    const cam = this.r.cam;
    const sp = 900 * dt;
    if (this.keys.has('a') || this.keys.has('arrowleft')) cam.panBy(sp, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) cam.panBy(-sp, 0);
    if (this.keys.has('w') || this.keys.has('arrowup')) cam.panBy(0, sp);
    if (this.keys.has('s') || this.keys.has('arrowdown')) cam.panBy(0, -sp);
    if (this.keys.has('q')) cam.zoomAt(cam.w / 2, cam.h / 2, Math.exp(-dt * 2));
    if (this.keys.has('e')) cam.zoomAt(cam.w / 2, cam.h / 2, Math.exp(dt * 2));
    // следование за муравьём
    if (cam.follow >= 0) {
      const a = this.sim.ants;
      if (a.alive[cam.follow]) { cam.tx = a.x[cam.follow]; cam.ty = a.y[cam.follow]; }
      else cam.follow = -1;
    }
  }

  /** Текст подсказки инспектора под курсором. */
  inspectText(): string {
    const sim = this.sim;
    const [x, y] = this.hover;
    const lines: string[] = [];
    const a = sim.ants;
    let best = -1;
    let bd = Math.max(1.5, 8 / this.r.cam.zoom);
    for (let i = 0; i < a.n; i++) {
      if (!a.alive[i]) continue;
      const d = Math.hypot(a.x[i] - x, a.y[i] - y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const i = best;
      lines.push(`<b>${CASTES[a.caste[i]].name}</b> ${a.colony[i] ? '(чужая колония)' : ''} — ${STATE_NAMES[a.state[i]]}`);
      lines.push(`энергия ${Math.round(a.energy[i] * 100)}% · здоровье ${Math.round(a.health[i] * 100)}% · возраст ${Math.round(a.age[i])} с`);
      const thr = [0, 1, 2, 3, 4].map((c) => a.thr[i * 5 + c].toFixed(2)).join(' / ');
      lines.push(`пороги (еда/стр/обор/разв/рес): ${thr}`);
      if (a.cargo[i]) lines.push(`несёт: ${a.cargo[i] === 1 ? FOOD_KINDS[a.cargoKind[i]]?.name : a.cargo[i] === 2 ? 'землю' : a.cargo[i] === 3 ? 'личинок' : 'лист'}`);
      if (a.state[i] === S.STRUCT_NODE) lines.push('держит живую конструкцию');
    }
    for (const it of sim.food.items) {
      if (Math.hypot(it.x - x, it.y - y) < it.r + 0.8) {
        lines.push(`<b>${FOOD_KINDS[it.kind].name}</b>: масса ${it.mass.toFixed(1)}, свежесть ${Math.round(it.fresh * 100)}%${it.carriers.length ? `, тащат ${it.carriers.length} (сила ${it.lift.toFixed(1)})` : ''}${it.cut ? ', режут на куски' : ''}`);
        break;
      }
    }
    const c = sim.creatures.nearest(x, y, 4);
    if (c) lines.push(`<b>${c.def.name}</b> — ${CS_NAMES[c.state]} · ${Math.round((c.hp / c.def.hp) * 100)}%`);
    lines.push(sim.inspect(x, y));
    const ph = this.r.pherAt(x, y);
    const strong = ph.map((v, k) => (v > 0.05 ? `${P_NAMES[k]} ${v.toFixed(2)}` : '')).filter(Boolean);
    if (strong.length) lines.push('феромоны: ' + strong.join(', '));
    return lines.join('<br>');
  }
}

function isBrush(t: string): boolean {
  return t === 'dig' || t === 'build' || t === 'reinforce' || t === 'forbid' || t === 'paint' || t === 'erase';
}
