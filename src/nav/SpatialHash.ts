/**
 * Пространственный хеш на сортировке подсчётом. Перестраивается за O(N)
 * каждый тик; запрос соседей — O(k). Используется для избегания толпы,
 * боя, поиска помощников для переноски и оценки плотности потока.
 */
export class SpatialHash {
  readonly gw: number;
  readonly gh: number;
  readonly counts: Uint16Array;
  private start: Int32Array;
  private items: Int32Array;
  private cellOf: Int32Array;
  private cursor: Int32Array;

  constructor(worldW: number, worldH: number, readonly cell: number, capacity = 1024) {
    this.gw = Math.ceil(worldW / cell);
    this.gh = Math.ceil(worldH / cell);
    this.counts = new Uint16Array(this.gw * this.gh);
    this.start = new Int32Array(this.gw * this.gh + 1);
    this.cursor = new Int32Array(this.gw * this.gh);
    this.items = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
  }

  build(n: number, xs: Float32Array, ys: Float32Array, alive: Uint8Array): void {
    if (this.items.length < n) {
      this.items = new Int32Array(n * 2);
      this.cellOf = new Int32Array(n * 2);
    }
    const counts = this.counts;
    counts.fill(0);
    const gw = this.gw;
    const gh = this.gh;
    const inv = 1 / this.cell;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) { this.cellOf[i] = -1; continue; }
      let cx = (xs[i] * inv) | 0;
      let cy = (ys[i] * inv) | 0;
      if (cx < 0) cx = 0; else if (cx >= gw) cx = gw - 1;
      if (cy < 0) cy = 0; else if (cy >= gh) cy = gh - 1;
      const c = cy * gw + cx;
      this.cellOf[i] = c;
      if (counts[c] < 65535) counts[c]++;
    }
    const start = this.start;
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      start[c] = acc;
      acc += counts[c];
    }
    start[counts.length] = acc;
    const cursor = this.cursor;
    cursor.set(start.subarray(0, counts.length));
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i];
      if (c < 0) continue;
      const p = cursor[c]++;
      if (p < start[c + 1]) this.items[p] = i;
    }
  }

  /** Перебрать всех в радиусе клеток сетки вокруг точки. Возврат false из cb прерывает. */
  query(x: number, y: number, r: number, cb: (id: number) => boolean | void): void {
    const inv = 1 / this.cell;
    const x0 = Math.max(0, ((x - r) * inv) | 0);
    const y0 = Math.max(0, ((y - r) * inv) | 0);
    const x1 = Math.min(this.gw - 1, ((x + r) * inv) | 0);
    const y1 = Math.min(this.gh - 1, ((y + r) * inv) | 0);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.gw + cx;
        const s = this.start[c];
        const e = this.start[c + 1];
        for (let k = s; k < e; k++) if (cb(this.items[k]) === false) return;
      }
    }
  }

  countAt(x: number, y: number): number {
    const cx = Math.max(0, Math.min(this.gw - 1, (x / this.cell) | 0));
    const cy = Math.max(0, Math.min(this.gh - 1, (y / this.cell) | 0));
    return this.counts[cy * this.gw + cx];
  }

  /** Плотность в окрестности 3x3 ячеек. */
  densityAround(x: number, y: number): number {
    const cx = (x / this.cell) | 0;
    const cy = (y / this.cell) | 0;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= this.gh) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= this.gw) continue;
        s += this.counts[yy * this.gw + xx];
      }
    }
    return s;
  }
}
