import { clamp } from '../core/MathUtil';

/**
 * Камера с масштабом от "одного муравья во весь экран" до "вся колония — точки".
 * zoom — пикселей на клетку мира. Плавное следование к целевым значениям.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 8;
  tx = 0;
  ty = 0;
  tzoom = 8;
  minZoom = 0.3;
  maxZoom = 96;
  w = 800;
  h = 600;
  dpr = 1;
  shake = 0;
  follow = -1;
  private sx = 0;
  private sy = 0;

  constructor(private worldW: number, private worldH: number) {}

  setViewport(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.minZoom = Math.max(0.2, Math.min((w * dpr) / this.worldW, (h * dpr) / this.worldH) * 0.9);
  }

  jump(x: number, y: number, zoom?: number): void {
    this.x = this.tx = x;
    this.y = this.ty = y;
    if (zoom !== undefined) this.zoom = this.tzoom = zoom;
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 10);
    // зум логарифмически плавный
    const lz = Math.log(this.zoom) + (Math.log(this.tzoom) - Math.log(this.zoom)) * k;
    this.zoom = Math.exp(lz);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.clampTargets();
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      const s = (this.shake * this.shake * 6) / this.zoom;
      this.sx = Math.sin(time * 71) * s;
      this.sy = Math.cos(time * 53) * s;
    } else { this.sx = 0; this.sy = 0; }
  }

  private clampTargets(): void {
    this.tzoom = clamp(this.tzoom, this.minZoom, this.maxZoom);
    const hw = (this.w * this.dpr) / this.zoom / 2;
    const hh = (this.h * this.dpr) / this.zoom / 2;
    this.tx = hw * 2 > this.worldW ? this.worldW / 2 : clamp(this.tx, hw, this.worldW - hw);
    this.ty = hh * 2 > this.worldH ? this.worldH / 2 : clamp(this.ty, hh, this.worldH - hh);
  }

  get cx(): number {
    return this.x + this.sx;
  }

  get cy(): number {
    return this.y + this.sy;
  }

  /** CSS-пиксели -> мир */
  screenToWorld(px: number, py: number): [number, number] {
    const z = this.zoom / this.dpr;
    return [this.cx + (px - this.w / 2) / z, this.cy + (py - this.h / 2) / z];
  }

  worldToScreen(x: number, y: number): [number, number] {
    const z = this.zoom / this.dpr;
    return [(x - this.cx) * z + this.w / 2, (y - this.cy) * z + this.h / 2];
  }

  /** Зум к точке под курсором. */
  zoomAt(px: number, py: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(px, py);
    const nz = clamp(this.tzoom * factor, this.minZoom, this.maxZoom);
    const z = nz / this.dpr;
    this.tzoom = nz;
    this.tx = wx - (px - this.w / 2) / z;
    this.ty = wy - (py - this.h / 2) / z;
    this.clampTargets();
  }

  panBy(dxCss: number, dyCss: number): void {
    const z = this.zoom / this.dpr;
    this.tx -= dxCss / z;
    this.ty -= dyCss / z;
    this.x -= dxCss / z;
    this.y -= dyCss / z;
    this.clampTargets();
  }

  /** Видимая область мира. */
  view(): { x0: number; y0: number; x1: number; y1: number } {
    const hw = (this.w * this.dpr) / this.zoom / 2;
    const hh = (this.h * this.dpr) / this.zoom / 2;
    return { x0: this.cx - hw, y0: this.cy - hh, x1: this.cx + hw, y1: this.cy + hh };
  }
}
