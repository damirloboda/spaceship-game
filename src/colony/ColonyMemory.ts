/**
 * Память колонии по секторам (32x32 клетки) — уровень "секций колонии" в иерархии ИИ.
 * Хранит: исследовано ли, сколько еды здесь находили, насколько опасно, когда были.
 * Разведка идёт к границе известного, обходя опасное; маршруты через опасные сектора
 * теряют приоритет — колония учится.
 */
export const SECTOR = 32;

export class ColonyMemory {
  readonly sw: number;
  readonly sh: number;
  explored: Uint8Array;
  food: Float32Array;
  danger: Float32Array;
  visited: Float32Array;
  /** мелкая сетка исследованности 8x8 для тумана войны */
  readonly fw: number;
  readonly fh: number;
  fog: Uint8Array;
  fogDirty = true;
  exploredCount = 0;

  constructor(worldW: number, worldH: number) {
    this.sw = Math.ceil(worldW / SECTOR);
    this.sh = Math.ceil(worldH / SECTOR);
    this.explored = new Uint8Array(this.sw * this.sh);
    this.food = new Float32Array(this.sw * this.sh);
    this.danger = new Float32Array(this.sw * this.sh);
    this.visited = new Float32Array(this.sw * this.sh);
    this.fw = Math.ceil(worldW / 8);
    this.fh = Math.ceil(worldH / 8);
    this.fog = new Uint8Array(this.fw * this.fh);
  }

  sector(x: number, y: number): number {
    const sx = Math.max(0, Math.min(this.sw - 1, (x / SECTOR) | 0));
    const sy = Math.max(0, Math.min(this.sh - 1, (y / SECTOR) | 0));
    return sy * this.sw + sx;
  }

  /** Муравей видит окрестность — открываем туман. */
  reveal(x: number, y: number, r: number, time: number): boolean {
    const fx0 = Math.max(0, ((x - r) / 8) | 0);
    const fx1 = Math.min(this.fw - 1, ((x + r) / 8) | 0);
    const fy0 = Math.max(0, ((y - r) / 8) | 0);
    const fy1 = Math.min(this.fh - 1, ((y + r) / 8) | 0);
    let newly = false;
    for (let fy = fy0; fy <= fy1; fy++)
      for (let fx = fx0; fx <= fx1; fx++) {
        const i = fy * this.fw + fx;
        if (this.fog[i] < 255) { this.fog[i] = 255; this.fogDirty = true; }
      }
    const s = this.sector(x, y);
    this.visited[s] = time;
    if (!this.explored[s]) {
      this.explored[s] = 1;
      this.exploredCount++;
      newly = true;
    }
    return newly;
  }

  isFogged(x: number, y: number): boolean {
    const fx = Math.max(0, Math.min(this.fw - 1, (x / 8) | 0));
    const fy = Math.max(0, Math.min(this.fh - 1, (y / 8) | 0));
    return this.fog[fy * this.fw + fx] === 0;
  }

  addDanger(x: number, y: number, v: number): void {
    this.danger[this.sector(x, y)] += v;
  }

  addFood(x: number, y: number, v: number): void {
    this.food[this.sector(x, y)] += v;
  }

  decay(dt: number): void {
    const k = Math.exp(-dt / 240);
    const kf = Math.exp(-dt / 600);
    for (let i = 0; i < this.danger.length; i++) {
      this.danger[i] *= k;
      this.food[i] *= kf;
    }
  }

  /**
   * Выбрать цель для разведки: неисследованный сектор у границы известного,
   * не слишком далеко, без опасности, с долей случайности.
   */
  pickFrontier(fromX: number, fromY: number, rnd: () => number, surfaceY: (x: number) => number): [number, number] | null {
    let best = -Infinity;
    let bx = -1;
    let by = -1;
    for (let k = 0; k < 40; k++) {
      const sx = Math.floor(rnd() * this.sw);
      const sy = Math.floor(rnd() * this.sh);
      const i = sy * this.sw + sx;
      if (this.explored[i]) continue;
      let border = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx >= 0 && ny >= 0 && nx < this.sw && ny < this.sh && this.explored[ny * this.sw + nx]) border++;
      }
      const cx = sx * SECTOR + SECTOR / 2;
      const cy = sy * SECTOR + SECTOR / 2;
      const d = Math.hypot(cx - fromX, cy - fromY);
      // поверхность интереснее глубины
      const depth = Math.max(0, cy - surfaceY(cx));
      const score = border * 2 - d * 0.012 - this.danger[i] * 3 - depth * 0.01 + rnd();
      if (score > best) { best = score; bx = cx; by = cy; }
    }
    return bx < 0 ? null : [bx, by];
  }

  exploredFraction(): number {
    return this.exploredCount / this.explored.length;
  }
}
