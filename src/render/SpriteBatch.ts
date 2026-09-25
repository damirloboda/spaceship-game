import { program, uniforms } from './GL';
import { SPRITE_FS, SPRITE_VS } from './shaders/sprites';

const STRIDE = 24;

/**
 * Пакет инстансов: 24 байта на объект, один draw call на кадр.
 * Буфер растёт по мере надобности (object pooling для GPU-памяти).
 */
export class SpriteBatch {
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null>;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private buf: ArrayBuffer;
  private f32: Float32Array;
  private u8: Uint8Array;
  private cap = 0;
  count = 0;
  private gpuCap = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = program(gl, SPRITE_VS, SPRITE_FS);
    this.u = uniforms(gl, this.prog, ['u_cam', 'u_zoom', 'u_res', 'u_time', 'u_light', 'u_food', 'u_cr', 'u_pal']);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, STRIDE, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, STRIDE, 20);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.buf = new ArrayBuffer(0);
    this.f32 = new Float32Array(0);
    this.u8 = new Uint8Array(0);
    this.ensure(4096);
  }

  private ensure(n: number): void {
    if (n <= this.cap) return;
    let c = Math.max(4096, this.cap);
    while (c < n) c *= 2;
    const nb = new ArrayBuffer(c * STRIDE);
    new Uint8Array(nb).set(this.u8.subarray(0, this.count * STRIDE));
    this.buf = nb;
    this.f32 = new Float32Array(nb);
    this.u8 = new Uint8Array(nb);
    this.cap = c;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, rot: number, size: number, kind: number, anim: number, flags: number, extra: number, tint: number, cargo: number, dirt: number, variant: number): void {
    if (this.count >= this.cap) this.ensure(this.count + 1);
    const o = this.count * 6;
    this.f32[o] = x;
    this.f32[o + 1] = y;
    this.f32[o + 2] = rot;
    this.f32[o + 3] = size;
    const b = this.count * STRIDE + 16;
    const u = this.u8;
    u[b] = kind;
    u[b + 1] = anim & 255;
    u[b + 2] = flags & 255;
    u[b + 3] = extra & 255;
    u[b + 4] = tint & 255;
    u[b + 5] = cargo & 255;
    u[b + 6] = dirt & 255;
    u[b + 7] = variant & 255;
    this.count++;
  }

  draw(cam: { cx: number; cy: number; zoom: number }, resW: number, resH: number, time: number, light: number, palettes: { food: Float32Array; cr: Float32Array; pal: Float32Array }): void {
    const gl = this.gl;
    if (this.count === 0) return;
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.u_cam, cam.cx, cam.cy);
    gl.uniform1f(this.u.u_zoom, cam.zoom);
    gl.uniform2f(this.u.u_res, resW, resH);
    gl.uniform1f(this.u.u_time, time);
    gl.uniform1f(this.u.u_light, light);
    gl.uniform3fv(this.u.u_food, palettes.food);
    gl.uniform3fv(this.u.u_cr, palettes.cr);
    gl.uniform3fv(this.u.u_pal, palettes.pal);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const bytes = this.count * STRIDE;
    if (this.gpuCap < bytes) {
      this.gpuCap = this.cap * STRIDE;
      gl.bufferData(gl.ARRAY_BUFFER, this.gpuCap, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.u8, 0, bytes);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
  }
}

export const K = {
  ANT: 0,
  QUEEN: 1,
  BROOD: 2,
  FOOD0: 3,
  CREATURE0: 20,
  DUST: 30,
  DROP: 31,
  LEAF: 32,
  PILE: 34,
  FUNGUS: 35,
  RING: 36,
} as const;

/** Флаги инстанса муравья. */
export const IF = { FLIP: 1, MOVING: 2, LOCKED: 4, DIG: 8, FIGHT: 16, HURT: 32, RIVAL: 64, DARK: 128 } as const;
