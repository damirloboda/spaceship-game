/**
 * Набор "активных" чанков. Физика воды, осыпания, феромоны и загрузка текстур
 * обрабатывают только активные чанки — мир в 1.5 млн клеток стоит столько,
 * сколько в нём реально происходит.
 */
export class ChunkSet {
  readonly cw: number;
  readonly ch: number;
  private flag: Uint8Array;
  private list: number[] = [];

  constructor(worldW: number, worldH: number, readonly size: number) {
    this.cw = Math.ceil(worldW / size);
    this.ch = Math.ceil(worldH / size);
    this.flag = new Uint8Array(this.cw * this.ch);
  }

  markCell(x: number, y: number): void {
    const cx = (x / this.size) | 0;
    const cy = (y / this.size) | 0;
    if (cx < 0 || cy < 0 || cx >= this.cw || cy >= this.ch) return;
    this.markChunk(cy * this.cw + cx);
  }

  markChunk(ci: number): void {
    if (this.flag[ci]) return;
    this.flag[ci] = 1;
    this.list.push(ci);
  }

  /** Отметить клетку и соседние чанки, если клетка у границы. */
  markCellNeighborhood(x: number, y: number): void {
    const s = this.size;
    this.markCell(x, y);
    const lx = x % s;
    const ly = y % s;
    if (lx === 0) this.markCell(x - 1, y);
    if (lx === s - 1) this.markCell(x + 1, y);
    if (ly === 0) this.markCell(x, y - 1);
    if (ly === s - 1) this.markCell(x, y + 1);
  }

  /** Забрать текущий список (флаги сбрасываются — повторная отметка добавит снова). */
  drain(): number[] {
    const l = this.list;
    this.list = [];
    for (const ci of l) this.flag[ci] = 0;
    return l;
  }

  get size_(): number {
    return this.list.length;
  }

  has(ci: number): boolean {
    return this.flag[ci] === 1;
  }

  clear(): void {
    this.drain();
  }
}
