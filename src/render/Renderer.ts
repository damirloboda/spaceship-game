import { CG, S } from '../ants/AntStore';
import { C, CASTES } from '../ants/Castes';
import { SK, SS } from '../construction/LivingStructures';
import { CREATURES } from '../creatures/CreatureTypes';
import { FOOD_KINDS } from '../food/FoodTypes';
import { N_SOLID } from '../nav/NavGrid';
import { P, PH_CELL } from '../pheromone/PheromoneField';
import { ROOM } from '../procgen/WorldGenerator';
import type { Simulation } from '../sim/Simulation';
import { MATERIALS } from '../world/Materials';
import { CHUNK } from '../world/Terrain';
import { Z } from '../world/Zones';
import { Camera } from './Camera';
import { FULLSCREEN_VS, fullscreenVAO, program, texture, uniforms } from './GL';
import { Particles } from './Particles';
import { IF, K, SpriteBatch } from './SpriteBatch';
import { SKY_FS } from './shaders/sky';
import { TERRAIN_FS } from './shaders/terrain';

export interface RenderStats {
  instances: number;
  agentsDrawn: number;
  streamDrawn: number;
  implicitDrawn: number;
  ms: number;
}

/**
 * Рендерер: небо → мир (один полноэкранный шейдер по текстуре клеток) →
 * инстансы (жители гнезда, еда, агенты, потоки, конструкции, существа, частицы).
 * Мир на GPU обновляется только изменившимися чанками.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly cam: Camera;
  readonly particles = new Particles();
  private skyProg: WebGLProgram;
  private terProg: WebGLProgram;
  private skyU: Record<string, WebGLUniformLocation | null>;
  private terU: Record<string, WebGLUniformLocation | null>;
  private fsVAO: WebGLVertexArrayObject;
  private texMat: WebGLTexture;
  private texWater: WebGLTexture;
  private texPher: WebGLTexture;
  private texFog: WebGLTexture;
  private texSky: WebGLTexture;
  private batch: SpriteBatch;
  private matBuf: Uint8Array;
  private waterBuf: Uint8Array;
  private pherBuf: Uint8Array;
  private skyBuf: Float32Array;
  private pal: Float32Array;
  private foodPal: Float32Array;
  private crPal: Float32Array;
  overlay = 0;
  stats: RenderStats = { instances: 0, agentsDrawn: 0, streamDrawn: 0, implicitDrawn: 0, ms: 0 };
  selectedAnt = -1;
  private tmp = [0, 0, 0];
  private indoor: [number, number] = [-1, -1];
  private groundY: number;

  constructor(readonly canvas: HTMLCanvasElement, private sim: Simulation) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 не поддерживается этим браузером');
    this.gl = gl;
    const t = sim.terrain;
    this.cam = new Camera(t.W, t.H);
    this.skyProg = program(gl, FULLSCREEN_VS, SKY_FS);
    this.terProg = program(gl, FULLSCREEN_VS, TERRAIN_FS);
    this.skyU = uniforms(gl, this.skyProg, ['u_cam', 'u_zoom', 'u_res', 'u_world', 'u_time', 'u_tod', 'u_light', 'u_cloud', 'u_rain', 'u_fog', 'u_wind', 'u_thunder', 'u_indoor', 'u_groundY']);
    this.terU = uniforms(gl, this.terProg, ['u_mat', 'u_water', 'u_pher', 'u_fog', 'u_sky', 'u_cam', 'u_zoom', 'u_res', 'u_world', 'u_time', 'u_light', 'u_wind', 'u_overlay', 'u_fogOn', 'u_indoor', 'u_groundY', 'u_pal']);
    this.fsVAO = fullscreenVAO(gl);
    this.matBuf = new Uint8Array(t.size * 4);
    this.waterBuf = new Uint8Array(t.size);
    const pf = sim.player.pher;
    this.pherBuf = new Uint8Array(pf.w * pf.h * 4);
    this.skyBuf = new Float32Array(t.W);
    this.fillMat(0, 0, t.W, t.H);
    this.texMat = texture(gl, t.W, t.H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.matBuf);
    this.waterBuf.set(t.water);
    this.texWater = texture(gl, t.W, t.H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, this.waterBuf);
    this.texPher = texture(gl, pf.w, pf.h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.pherBuf, gl.LINEAR);
    const mem = sim.player.memory;
    this.texFog = texture(gl, mem.fw, mem.fh, gl.R8, gl.RED, gl.UNSIGNED_BYTE, mem.fog, gl.LINEAR);
    for (let x = 0; x < t.W; x++) this.skyBuf[x] = t.skyline[x];
    this.texSky = texture(gl, t.W, 1, gl.R32F, gl.RED, gl.FLOAT, this.skyBuf);
    this.batch = new SpriteBatch(gl);
    this.pal = new Float32Array(32 * 3);
    for (const m of MATERIALS) { this.pal[m.id * 3] = m.color[0] / 255; this.pal[m.id * 3 + 1] = m.color[1] / 255; this.pal[m.id * 3 + 2] = m.color[2] / 255; }
    this.foodPal = new Float32Array(16 * 3);
    for (const f of FOOD_KINDS) { this.foodPal[f.id * 3] = f.color[0] / 255; this.foodPal[f.id * 3 + 1] = f.color[1] / 255; this.foodPal[f.id * 3 + 2] = f.color[2] / 255; }
    this.crPal = new Float32Array(8 * 3);
    for (const c of CREATURES) { this.crPal[c.id * 3] = c.color[0] / 255; this.crPal[c.id * 3 + 1] = c.color[1] / 255; this.crPal[c.id * 3 + 2] = c.color[2] / 255; }
    for (const z of sim.zones) if (z.kind === Z.HOUSE) this.indoor = [z.x0 + 12, z.x1 - 12];
    this.groundY = Math.round(t.H * 0.43) - 10;
    sim.particles = this.particles;
    t.renderDirty.clear();
    sim.water.renderDirty.clear();
  }

  /** Упаковка клетки в RGBA: материал, прочность, влажность, флаги (трещины/план/запрет). */
  private fillMat(x0: number, y0: number, x1: number, y1: number): void {
    const t = this.sim.terrain;
    const W = t.W;
    const b = this.matBuf;
    for (let y = y0; y < y1; y++) {
      let i = y * W + x0;
      for (let x = x0; x < x1; x++, i++) {
        const o = i * 4;
        b[o] = t.mat[i];
        b[o + 1] = t.hp[i];
        b[o + 2] = t.moist[i];
        const f = t.flags[i];
        b[o + 3] = (t.stress[i] >> 2) | (f & 2 ? 64 : 0) | (f & 1 ? 128 : 0);
      }
    }
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.cam.setViewport(w, h, dpr);
  }

  private upload(): void {
    const gl = this.gl;
    const t = this.sim.terrain;
    const W = t.W;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // мир
    const dirty = t.renderDirty.drain();
    if (dirty.length > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.texMat);
      const cw = t.renderDirty.cw;
      const sub = new Uint8Array(CHUNK * CHUNK * 4);
      for (let k = 0; k < dirty.length; k++) {
        const ci = dirty[k];
        if (k > 400) { t.renderDirty.markChunk(ci); continue; }
        const x0 = (ci % cw) * CHUNK;
        const y0 = ((ci / cw) | 0) * CHUNK;
        const x1 = Math.min(W, x0 + CHUNK);
        const y1 = Math.min(t.H, y0 + CHUNK);
        this.fillMat(x0, y0, x1, y1);
        const w = x1 - x0;
        const h = y1 - y0;
        for (let y = 0; y < h; y++) sub.set(this.matBuf.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, sub.subarray(0, w * h * 4));
      }
      for (let x = 0; x < W; x++) this.skyBuf[x] = t.skyline[x];
      gl.bindTexture(gl.TEXTURE_2D, this.texSky);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 1, gl.RED, gl.FLOAT, this.skyBuf);
    }
    // вода
    const wd = this.sim.water.renderDirty.drain();
    if (wd.length > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.texWater);
      const cw = this.sim.water.renderDirty.cw;
      const sub = new Uint8Array(32 * 32);
      for (const ci of wd) {
        const x0 = (ci % cw) * 32;
        const y0 = ((ci / cw) | 0) * 32;
        const x1 = Math.min(W, x0 + 32);
        const y1 = Math.min(t.H, y0 + 32);
        const w = x1 - x0;
        for (let y = y0; y < y1; y++) sub.set(t.water.subarray(y * W + x0, y * W + x1), (y - y0) * w);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, y1 - y0, gl.RED, gl.UNSIGNED_BYTE, sub.subarray(0, w * (y1 - y0)));
      }
    }
    // феромоны и протоптанность игрока
    const pf = this.sim.player.pher;
    if (pf.renderDirty.size > 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.texPher);
      const cs = pf.chunkSize;
      const sub = new Uint8Array(cs * cs * 4);
      let n = 0;
      for (const k of pf.renderDirty) {
        pf.renderDirty.delete(k);
        if (++n > 300) break;
        const [x0, y0, x1, y1] = pf.chunkRect(k);
        const w = x1 - x0;
        let o = 0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const i = y * pf.w + x;
            sub[o++] = Math.min(255, pf.ch[P.FOOD][i] * 60);
            sub[o++] = Math.min(255, pf.ch[P.HOME][i] * 40);
            sub[o++] = Math.min(255, (pf.ch[P.DANGER][i] + pf.ch[P.ATTACK][i]) * 60);
            sub[o++] = Math.min(255, pf.traffic[i] * 4);
          }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, sub.subarray(0, w * (y1 - y0) * 4));
      }
    }
    const mem = this.sim.player.memory;
    if (mem.fogDirty) {
      mem.fogDirty = false;
      gl.bindTexture(gl.TEXTURE_2D, this.texFog);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mem.fw, mem.fh, gl.RED, gl.UNSIGNED_BYTE, mem.fog);
    }
  }

  frame(alpha: number, realTime: number, dt: number): void {
    const t0 = performance.now();
    const gl = this.gl;
    const sim = this.sim;
    const cam = this.cam;
    cam.update(dt, realTime);
    const W = this.canvas.width;
    const H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    this.upload();
    const light = sim.clock.light();
    const time = sim.time;
    // небо
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    const su = this.skyU;
    gl.uniform2f(su.u_cam, cam.cx, cam.cy);
    gl.uniform1f(su.u_zoom, cam.zoom);
    gl.uniform2f(su.u_res, W, H);
    gl.uniform2f(su.u_world, sim.terrain.W, sim.terrain.H);
    gl.uniform1f(su.u_time, time);
    gl.uniform1f(su.u_tod, sim.clock.tod);
    gl.uniform1f(su.u_light, light);
    gl.uniform1f(su.u_cloud, sim.weather.cloud);
    gl.uniform1f(su.u_rain, sim.weather.rain);
    gl.uniform1f(su.u_fog, sim.weather.fog);
    gl.uniform1f(su.u_wind, sim.weather.wind);
    gl.uniform1f(su.u_thunder, sim.weather.thunder);
    gl.uniform2f(su.u_indoor, this.indoor[0], this.indoor[1]);
    gl.uniform1f(su.u_groundY, this.groundY);
    gl.bindVertexArray(this.fsVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // мир
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.terProg);
    const tu = this.terU;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texMat); gl.uniform1i(tu.u_mat, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texWater); gl.uniform1i(tu.u_water, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texPher); gl.uniform1i(tu.u_pher, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texFog); gl.uniform1i(tu.u_fog, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.texSky); gl.uniform1i(tu.u_sky, 4);
    gl.uniform2f(tu.u_cam, cam.cx, cam.cy);
    gl.uniform1f(tu.u_zoom, cam.zoom);
    gl.uniform2f(tu.u_res, W, H);
    gl.uniform2f(tu.u_world, sim.terrain.W, sim.terrain.H);
    gl.uniform1f(tu.u_time, time);
    gl.uniform1f(tu.u_light, light);
    gl.uniform1f(tu.u_wind, sim.weather.wind);
    gl.uniform1i(tu.u_overlay, this.overlay);
    gl.uniform1f(tu.u_fogOn, sim.mode.fog ? 1 : 0);
    gl.uniform2f(tu.u_indoor, this.indoor[0], this.indoor[1]);
    gl.uniform1f(tu.u_groundY, this.groundY);
    gl.uniform3fv(tu.u_pal, this.pal);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    // объекты
    this.particles.update(dt * (sim.tick > 0 ? 1 : 0), (x, y) => sim.terrain.solid(x | 0, y | 0), sim.weather.wind);
    this.collect(alpha);
    this.batch.draw(cam, W, H, time, light, { food: this.foodPal, cr: this.crPal, pal: this.pal });
    this.stats.instances = this.batch.count;
    this.stats.ms = performance.now() - t0;
  }

  // ------------------------------------------------------------------ сбор инстансов

  private collect(alpha: number): void {
    const sim = this.sim;
    const b = this.batch;
    b.begin();
    const v = this.cam.view();
    const m = 4;
    const x0 = v.x0 - m;
    const y0 = v.y0 - m;
    const x1 = v.x1 + m;
    const y1 = v.y1 + m;
    this.stats.implicitDrawn = 0;
    this.collectNests(x0, y0, x1, y1);
    this.collectFood(x0, y0, x1, y1);
    this.collectAgents(alpha, x0, y0, x1, y1);
    this.collectStreams(x0, y0, x1, y1);
    this.collectStructures(x0, y0, x1, y1);
    this.collectCreatures(alpha, x0, y0, x1, y1);
    this.particles.draw(b, x0, y0, x1, y1);
    // выделенный муравей
    const s = this.selectedAnt;
    if (s >= 0 && sim.ants.alive[s]) b.push(sim.ants.x[s], sim.ants.y[s], 0, 1.4, K.RING, 0, 0, 0, 0, 0, 0, 0);
    // дождевые брызги в кадре
    if (sim.weather.rain > 0.2 && this.cam.zoom > 3) {
      const n = Math.round(sim.weather.rain * 6);
      for (let k = 0; k < n; k++) {
        const x = x0 + Math.random() * (x1 - x0);
        const gy = sim.terrain.skyline[Math.max(0, Math.min(sim.terrain.W - 1, x | 0))];
        if (gy > y0 && gy < y1) this.particles.splash(x, gy - 0.2);
      }
    }
    if (Math.abs(sim.weather.wind) > 0.5 && Math.random() < 0.3) {
      const x = x0 + Math.random() * (x1 - x0);
      this.particles.leaf(x, y0 + Math.random() * (y1 - y0) * 0.5, sim.weather.wind);
    }
  }

  private isDark(x: number, y: number): boolean {
    const t = this.sim.terrain;
    return y > t.skyline[Math.max(0, Math.min(t.W - 1, x | 0))] + 3;
  }

  /** Жители гнезда, матка, выводок, запасы — неявные популяции (без агентов). */
  private collectNests(x0: number, y0: number, x1: number, y1: number): void {
    const sim = this.sim;
    const b = this.batch;
    const time = sim.time;
    for (const col of sim.colonies) {
      const rival = col.id !== 0 ? IF.RIVAL : 0;
      const rooms = col.nest.rooms.filter((r) => r.built);
      if (rooms.length === 0) continue;
      let area = 0;
      for (const r of rooms) area += r.area;
      const res = col.residentTotal();
      for (const r of rooms) {
        if (r.x1 < x0 || r.x0 > x1 || r.y1 < y0 || r.y0 > y1) continue;
        const rx = (r.x1 - r.x0) / 2;
        const ry = (r.y1 - r.y0) / 2;
        const floorY = (dx: number) => r.cy + ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx + 0.01))) - 0.35;
        // матка
        if (r.type === ROOM.QUEEN && col.queen.alive && r.id === col.queen.room) {
          const qx = r.cx + Math.sin(time * 0.1) * rx * 0.3;
          b.push(qx, floorY(qx - r.cx) - 0.9, 0, 2.6, K.QUEEN, Math.round(time * 6) & 255, IF.MOVING | rival | IF.DARK, C.QUEEN, 128, 0, 0, 0);
        }
        // выводок
        const brood = col.brood.inRoom(r.id);
        const nb = Math.min(brood, 90);
        for (let k = 0; k < nb; k++) {
          const u = ((k * 0.618) % 1) * 2 - 1;
          const dx = u * rx * 0.8;
          const layer = Math.floor(k / 20);
          const stage = k % 5 === 0 ? 0 : k % 7 === 0 ? 2 : 1;
          b.push(r.cx + dx, floorY(dx) - 0.15 - layer * 0.3, (k * 1.7) % 6.28, 0.9, K.BROOD, k * 13, 0, 0, 0, 0, 0, stage);
        }
        // запасы
        if (r.type === ROOM.FOOD && col.food > 1) {
          const share = Math.min(1, col.food / Math.max(1, col.foodCapacity()));
          const piles = Math.max(1, Math.round(share * 6));
          for (let k = 0; k < piles; k++) {
            const dx = (k / Math.max(1, piles - 1) - 0.5) * rx * 1.2;
            b.push(r.cx + dx, floorY(dx) - 0.3, 0, 0.8 + share * 1.2, K.PILE, 0, 0, 0, 0, k % 3 === 0 ? 1 : 0, 0, k * 40);
          }
        }
        if (r.type === ROOM.FARM) {
          for (let k = 0; k < 6; k++) {
            const dx = (k / 5 - 0.5) * rx * 1.4;
            b.push(r.cx + dx, floorY(dx) - 0.6, 0, 0.8 + r.stock * 1.4, K.FUNGUS, 0, 0, 0, 0, 0, 0, k * 30);
          }
        }
        // жители комнаты
        const share = res * (r.area / area);
        const n = Math.min(Math.round(share), this.cam.zoom > 2 ? 140 : 40);
        for (let k = 0; k < n; k++) {
          const sp = 0.03 + ((k * 7) % 13) * 0.004;
          let u = (time * sp + k * 0.37) % 2;
          const dirR = u < 1;
          u = dirR ? u : 2 - u;
          const dx = (u * 2 - 1) * rx * 0.85;
          const y = floorY(dx) - 0.05 - (k % 4) * 0.12;
          const caste = k % 11 === 0 ? C.SOLDIER : k % 7 === 0 ? C.SCOUT : C.WORKER;
          b.push(r.cx + dx, y, dirR ? 0 : Math.PI, CASTES[caste].size, K.ANT, Math.round((time * 3 + k) * 40) & 255, IF.MOVING | rival | IF.DARK | (dirR ? 0 : IF.FLIP), caste, k * 23, 0, 0, 0);
          this.stats.implicitDrawn++;
        }
      }
    }
  }

  private collectFood(x0: number, y0: number, x1: number, y1: number): void {
    const b = this.batch;
    for (const it of this.sim.food.items) {
      if (it.removed) continue;
      if (it.x + it.r < x0 || it.x - it.r > x1 || it.y + it.r < y0 || it.y - it.r > y1) continue;
      const fresh = Math.max(0, Math.min(255, Math.round(it.fresh * 255)));
      b.push(it.x, it.y, it.airborne ? Math.sin(it.age * 3) * 0.4 : 0, it.r, K.FOOD0 + it.kind, Math.round(it.age * 10) & 255, this.isDark(it.x, it.y) ? IF.DARK : 0, 0, fresh, 0, 0, (it.id * 37) & 255);
    }
  }

  private collectAgents(alpha: number, x0: number, y0: number, x1: number, y1: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const b = this.batch;
    const t = sim.terrain;
    const nav = sim.nav.nav;
    const W = t.W;
    const detail = this.cam.zoom > 2.5;
    let drawn = 0;
    for (let i = 0; i < a.n; i++) {
      if (!a.alive[i]) continue;
      const px = a.px[i];
      const py = a.py[i];
      let x = a.x[i];
      let y = a.y[i];
      if (a.lod[i] === 0 && Math.abs(x - px) < 2 && Math.abs(y - py) < 2) {
        x = px + (x - px) * alpha;
        y = py + (y - py) * alpha;
      }
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const st = a.state[i];
      let h = a.heading[i];
      const hx = Math.cos(h);
      const hy = Math.sin(h);
      // нормаль к опоре: куда направлены лапки
      let nx = 0;
      let ny = 1;
      if (detail && st !== S.STRUCT_NODE && st !== S.FALL) {
        const cx = x | 0;
        const cy = y | 0;
        let sx = 0;
        let sy = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = cx + dx;
            const yy = cy + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= t.H) continue;
            if (nav[yy * W + xx] & N_SOLID) { sx += dx; sy += dy; }
          }
        if (sx !== 0 || sy !== 0) { nx = sx; ny = sy; }
      }
      // лапками на поверхность: сдвиг вдоль нормали к опоре
      if (detail && (nx !== 0 || ny !== 0) && st !== S.STRUCT_NODE && st !== S.FALL && st !== S.CARRY_TEAM) {
        const size = CASTES[a.caste[i]].size;
        if (Math.abs(ny) >= Math.abs(nx)) {
          if (ny > 0 && (nav[((y | 0) + 1) * W + (x | 0)] & N_SOLID)) y = Math.floor(y) + 1 - 0.25 * size;
          else if (ny < 0 && (nav[((y | 0) - 1) * W + (x | 0)] & N_SOLID)) y = Math.floor(y) + 0.25 * size;
        } else {
          if (nx > 0 && (nav[(y | 0) * W + (x | 0) + 1] & N_SOLID)) x = Math.floor(x) + 1 - 0.25 * size;
          else if (nx < 0 && (nav[(y | 0) * W + (x | 0) - 1] & N_SOLID)) x = Math.floor(x) + 0.25 * size;
        }
      }
      const cross = hx * ny - hy * nx;
      let flags = 0;
      if (cross < 0) flags |= IF.FLIP;
      const moving = Math.abs(a.x[i] - a.px[i]) + Math.abs(a.y[i] - a.py[i]) > 0.004 || st === S.DIG || st === S.CARRY_TEAM;
      if (moving) flags |= IF.MOVING;
      if (st === S.STRUCT_NODE) flags |= IF.LOCKED;
      if (st === S.DIG || st === S.BUILD || st === S.GATHER) flags |= IF.DIG;
      if (a.colony[i] !== 0) flags |= IF.RIVAL;
      if (this.isDark(x, y)) flags |= IF.DARK;
      if (st === S.DYING) {
        // тихий уход: без крови, просто замирает и тает
        const k = a.timer[i] / 1.8;
        if (k > 0.95) continue;
        flags &= ~IF.MOVING;
        h += k * 0.6;
      }
      const cargoT = a.cargo[i];
      const extra = a.caste[i] | (cargoT << 3);
      let cargoV = a.cargoKind[i];
      if (cargoT === CG.SOIL) cargoV = a.cargoKind[i];
      b.push(x, y, h, CASTES[a.caste[i]].size, K.ANT, Math.round(a.anim[i] * 60) & 255, flags, extra, a.tint[i], cargoV, a.dirt[i], a.tint[i]);
      drawn++;
    }
    this.stats.agentsDrawn = drawn;
  }

  /** Муравьи потоков: позиции вычисляются из (номер, время), а не хранятся. */
  private collectStreams(x0: number, y0: number, x1: number, y1: number): void {
    const sim = this.sim;
    const b = this.batch;
    const out = this.tmp;
    let drawn = 0;
    const budget = 120000;
    for (const r of sim.routes.routes.values()) {
      if (r.stream <= 0) continue;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < r.pts.length; k += 2) {
        bx0 = Math.min(bx0, r.pts[k]); bx1 = Math.max(bx1, r.pts[k]);
        by0 = Math.min(by0, r.pts[k + 1]); by1 = Math.max(by1, r.pts[k + 1]);
      }
      if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
      const L = sim.routes.length(r);
      const n = Math.round(r.stream);
      const stride = Math.max(1, Math.ceil(n / budget));
      const rival = r.colony !== 0 ? IF.RIVAL : 0;
      for (let i = 0; i < n; i += stride) {
        const back = sim.streams.antPos(r, i, L, out);
        const x = out[0];
        const y = out[1];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const h = out[2];
        const flip = Math.cos(h) < 0 ? IF.FLIP : 0;
        const extra = C.WORKER | ((back ? CG.FOOD : 0) << 3);
        b.push(x, y, h, 1, K.ANT, Math.round(sim.time * 90 + i * 17) & 255, IF.MOVING | flip | rival | (this.isDark(x, y) ? IF.DARK : 0), extra, (i * 29) & 255, 0, 0, 0);
        drawn++;
      }
    }
    this.stats.streamDrawn = drawn;
  }

  /** Утолщение живых мостов — абстрактная масса муравьёв вокруг узлов цепи. */
  private collectStructures(x0: number, y0: number, x1: number, y1: number): void {
    const sim = this.sim;
    const b = this.batch;
    for (const s of sim.structures.items.values()) {
      if (s.thickness <= 0 || s.state !== SS.ACTIVE) continue;
      const minx = Math.min(s.ax, s.bx) - 4;
      const maxx = Math.max(s.ax, s.bx) + 4;
      const miny = Math.min(s.ay, s.by) - 8;
      const maxy = Math.max(s.ay, s.by) + 8;
      if (maxx < x0 || minx > x1 || maxy < y0 || miny > y1) continue;
      const rival = s.colony !== 0 ? IF.RIVAL : 0;
      const n = Math.min(s.thickness, 40000);
      for (let k = 0; k < n; k++) {
        const node = k % s.nodes;
        const layer = Math.floor(k / s.nodes) + 1;
        const k2 = Math.min(s.nodes - 1, node + 1);
        const k1 = Math.max(0, node - 1);
        const ang = Math.atan2(s.cy[k2] - s.cy[k1], s.cx[k2] - s.cx[k1]);
        const side = layer % 2 === 0 ? -1 : 1;
        const off = Math.ceil(layer / 2) * 0.32 * side;
        const jitter = (((k * 7919) % 100) / 100 - 0.5) * 0.3;
        const x = s.cx[node] - Math.sin(ang) * off + Math.cos(ang) * jitter;
        const y = s.cy[node] + Math.cos(ang) * off;
        b.push(x, y, ang + (side < 0 ? 0 : 0), 1, K.ANT, (k * 31 + Math.round(sim.time * 5)) & 255, IF.LOCKED | rival | (side < 0 ? IF.FLIP : 0), C.WORKER, (k * 13) & 255, 0, 0, 0);
        this.stats.implicitDrawn++;
      }
      void SK;
    }
  }

  private collectCreatures(alpha: number, x0: number, y0: number, x1: number, y1: number): void {
    const b = this.batch;
    for (const c of this.sim.creatures.list) {
      if (!c.alive) continue;
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha;
      if (x < x0 - 4 || x > x1 + 4 || y < y0 - 4 || y > y1 + 4) continue;
      const flip = Math.cos(c.heading) < 0 ? 1 : 0;
      const dying = c.dying > 0 ? Math.min(255, Math.round((c.dying / 1.5) * 255)) : 0;
      const rot = c.kind === 2 ? c.heading : c.heading;
      b.push(x, y, rot, c.def.radius * c.size, K.CREATURE0 + c.kind, Math.round(c.anim * 30) & 255, flip | (this.isDark(x, y) ? IF.DARK : 0), 0, 0, 0, dying, 0);
    }
  }

  /** Координаты для наведения феромонов в инспекторе. */
  pherAt(x: number, y: number): number[] {
    const pf = this.sim.player.pher;
    const out: number[] = [];
    for (let c = 0; c < 8; c++) out.push(pf.sample(c, x, y));
    void PH_CELL;
    return out;
  }
}
