import { SK, SS } from '../construction/LivingStructures';
import type { Camera } from '../render/Camera';
import type { Simulation } from '../sim/Simulation';
import type { Input } from '../input/Input';

/**
 * 2D-оверлей поверх мира: нарисованная линия, маршруты, план живых конструкций,
 * кисть, подписи ориентиров. Всё в мировых координатах через камеру.
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(sim: Simulation, cam: Camera, input: Input, tool: string, brush: number): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const z = cam.zoom / cam.dpr;
    const ws = (x: number, y: number) => cam.worldToScreen(x, y);
    // маршруты
    for (const r of sim.routes.routes.values()) {
      if (r.colony !== 0) continue;
      g.save();
      g.lineWidth = Math.max(1.5, Math.min(4, z * 0.35));
      g.strokeStyle = r.player ? 'rgba(232,176,74,0.75)' : 'rgba(180,200,160,0.35)';
      g.setLineDash(r.player ? [8, 6] : [3, 6]);
      g.lineDashOffset = -sim.time * 12;
      g.beginPath();
      for (let k = 0; k < r.pts.length; k += 2) {
        const [sx, sy] = ws(r.pts[k], r.pts[k + 1] - 0.5);
        if (k === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
      const [ex, ey] = ws(r.endX, r.endY - 0.5);
      g.fillStyle = r.player ? 'rgba(232,176,74,0.9)' : 'rgba(180,200,160,0.5)';
      g.beginPath();
      g.arc(ex, ey, 5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // живые конструкции в процессе: план пунктиром
    for (const s of sim.structures.items.values()) {
      if (s.colony !== 0 || s.state !== SS.FORMING) continue;
      g.save();
      g.strokeStyle = 'rgba(143,209,106,0.6)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 5]);
      g.beginPath();
      for (let k = 0; k < s.nodes; k++) {
        const [sx, sy] = ws(s.nx[k], s.ny[k]);
        if (k === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
      const [mx, my] = ws((s.ax + s.bx) / 2, Math.min(s.ay, s.by) - 3);
      g.font = '12px system-ui';
      g.fillStyle = 'rgba(241,231,214,0.9)';
      g.textAlign = 'center';
      const name = s.kind === SK.BRIDGE ? 'мост' : s.kind === SK.LADDER ? 'лестница' : 'башня';
      g.fillText(`${name}: ${s.filled}/${s.nodes}${s.joiners ? ` (+${s.joiners} идут)` : ''}`, mx, my);
      g.restore();
    }
    // текущая линия
    if (input.stroke.length > 1) {
      g.save();
      g.strokeStyle = 'rgba(255,220,140,0.95)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      input.stroke.forEach(([x, y], i) => { const [sx, sy] = ws(x, y); if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy); });
      g.stroke();
      g.restore();
    }
    // кисть
    const brushTool = tool === 'dig' || tool === 'build' || tool === 'reinforce' || tool === 'forbid' || tool === 'paint' || tool === 'erase';
    if (brushTool) {
      g.save();
      g.fillStyle = tool === 'forbid' ? 'rgba(240,90,70,0.3)' : 'rgba(232,176,74,0.28)';
      for (const [x, y] of input.brushCells.values()) {
        const [sx, sy] = ws(x, y);
        g.fillRect(sx, sy, Math.max(1, z), Math.max(1, z));
      }
      const [hx, hy] = input.hoverScreen;
      g.strokeStyle = 'rgba(255,230,170,0.7)';
      g.beginPath();
      g.arc(hx, hy, Math.max(4, (brush + 0.5) * z), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    // ориентиры при отдалении
    if (z < 3) {
      g.save();
      g.font = '12px system-ui';
      g.textAlign = 'center';
      for (const l of sim.landmarks) {
        const [sx, sy] = ws(l.x, l.y - 12);
        if (sx < -50 || sy < -20 || sx > cam.w + 50 || sy > cam.h + 20) continue;
        g.fillStyle = 'rgba(0,0,0,0.45)';
        const w = g.measureText(l.name).width + 12;
        g.fillRect(sx - w / 2, sy - 13, w, 18);
        g.fillStyle = 'rgba(241,231,214,0.95)';
        g.fillText(l.name, sx, sy);
      }
      g.restore();
    }
  }
}
