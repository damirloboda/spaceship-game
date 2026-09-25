import { FULLSCREEN_VS, program, uniforms } from './GL';

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src; uniform float u_th;
void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(u_th, 1.0, l);
  o = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src; uniform vec2 u_dir;
void main() {
  vec3 s = texture(u_src, v_uv).rgb * 0.227;
  s += texture(u_src, v_uv + u_dir * 1.385).rgb * 0.316;
  s += texture(u_src, v_uv - u_dir * 1.385).rgb * 0.316;
  s += texture(u_src, v_uv + u_dir * 3.231).rgb * 0.07;
  s += texture(u_src, v_uv - u_dir * 3.231).rgb * 0.07;
  o = vec4(s, 1.0);
}`;

/** Объёмные лучи: радиальное размытие ярких участков (небо, солнце) к позиции солнца. */
const RAYS_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src; uniform vec2 u_sun; uniform float u_str;
void main() {
  vec2 d = (v_uv - u_sun) / 56.0 * 0.95;
  vec2 uv = v_uv;
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 56; i++) {
    uv -= d;
    acc += texture(u_src, uv).rgb * decay;
    decay *= 0.965;
  }
  o = vec4(acc / 56.0 * u_str, 1.0);
}`;

/** Финальная сборка: свечение, лучи, плёночная кривая, цветокоррекция, аберрация, виньетка, зерно. */
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_scene; uniform sampler2D u_bloom; uniform sampler2D u_bloom2; uniform sampler2D u_rays;
uniform float u_time; uniform float u_bloomK; uniform float u_raysK; uniform float u_night; uniform vec3 u_tint; uniform vec2 u_res;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);
  // хроматическая аберрация — только у краёв кадра
  vec2 ca = cc * r2 * 0.012;
  vec3 c;
  c.r = texture(u_scene, uv + ca).r;
  c.g = texture(u_scene, uv).g;
  c.b = texture(u_scene, uv - ca).b;
  vec3 b = texture(u_bloom, uv).rgb * 0.6 + texture(u_bloom2, uv).rgb * 0.8;
  c += b * u_bloomK;
  c += texture(u_rays, uv).rgb * u_raysK * u_tint;
  // мягкая плёночная кривая
  c = c / (1.0 + c * 0.18) * 1.12;
  c = smoothstep(vec3(-0.03), vec3(1.02), c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // тёплые света, прохладные тени (ночью — синее)
  c = mix(c, c * vec3(1.06, 1.0, 0.9), smoothstep(0.45, 1.0, l) * 0.5);
  c = mix(c, c * mix(vec3(0.9, 0.97, 1.08), vec3(0.75, 0.85, 1.2), u_night), (1.0 - smoothstep(0.0, 0.45, l)) * 0.55);
  c = mix(vec3(l), c, 1.15);
  // виньетка
  c *= 1.0 - smoothstep(0.18, 0.75, r2) * 0.42;
  // зерно
  c += (h(uv * u_res + u_time) - 0.5) * 0.025;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

/**
 * Пост-обработка режима "Максимальная": сцена рисуется в текстуру,
 * затем свечение (двухуровневый bloom), объёмные лучи и финальная цветокоррекция.
 */
export class PostFX {
  private scene!: Target;
  private half!: Target;
  private halfB!: Target;
  private q!: Target;
  private qB!: Target;
  private rays!: Target;
  private pBright: WebGLProgram;
  private pBlur: WebGLProgram;
  private pRays: WebGLProgram;
  private pComp: WebGLProgram;
  private uBright; private uBlur; private uRays; private uComp;
  private w = 0;
  private h = 0;

  constructor(private gl: WebGL2RenderingContext, private vao: WebGLVertexArrayObject) {
    this.pBright = program(gl, FULLSCREEN_VS, BRIGHT_FS);
    this.pBlur = program(gl, FULLSCREEN_VS, BLUR_FS);
    this.pRays = program(gl, FULLSCREEN_VS, RAYS_FS);
    this.pComp = program(gl, FULLSCREEN_VS, COMPOSITE_FS);
    this.uBright = uniforms(gl, this.pBright, ['u_src', 'u_th']);
    this.uBlur = uniforms(gl, this.pBlur, ['u_src', 'u_dir']);
    this.uRays = uniforms(gl, this.pRays, ['u_src', 'u_sun', 'u_str']);
    this.uComp = uniforms(gl, this.pComp, ['u_scene', 'u_bloom', 'u_bloom2', 'u_rays', 'u_time', 'u_bloomK', 'u_raysK', 'u_night', 'u_tint', 'u_res']);
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private free(t?: Target): void {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    for (const t of [this.scene, this.half, this.halfB, this.q, this.qB, this.rays]) this.free(t);
    this.w = w;
    this.h = h;
    this.scene = this.target(w, h);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    this.half = this.target(hw, hh);
    this.halfB = this.target(hw, hh);
    this.q = this.target(qw, qh);
    this.qB = this.target(qw, qh);
    this.rays = this.target(hw, hh);
  }

  /** Начать кадр: всё рисуется в текстуру сцены. */
  begin(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.scene.fb);
  }

  private pass(prog: WebGLProgram, dst: Target | null, setup: () => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
    gl.useProgram(prog);
    setup();
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bind(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  end(p: { time: number; sunUV: [number, number]; sunVisible: number; night: number; tint: [number, number, number] }): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    // яркое -> половина
    this.pass(this.pBright, this.half, () => { this.bind(0, this.scene.tex, this.uBright.u_src); gl.uniform1f(this.uBright.u_th, 0.8); });
    // размытие на половине
    this.pass(this.pBlur, this.halfB, () => { this.bind(0, this.half.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 1 / this.half.w, 0); });
    this.pass(this.pBlur, this.half, () => { this.bind(0, this.halfB.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 0, 1 / this.half.h); });
    // широкое размытие на четверти
    this.pass(this.pBlur, this.qB, () => { this.bind(0, this.half.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 2 / this.q.w, 0); });
    this.pass(this.pBlur, this.q, () => { this.bind(0, this.qB.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 0, 2 / this.q.h); });
    this.pass(this.pBlur, this.qB, () => { this.bind(0, this.q.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 4 / this.q.w, 0); });
    this.pass(this.pBlur, this.q, () => { this.bind(0, this.qB.tex, this.uBlur.u_src); gl.uniform2f(this.uBlur.u_dir, 0, 4 / this.q.h); });
    // лучи
    this.pass(this.pRays, this.rays, () => {
      this.bind(0, this.half.tex, this.uRays.u_src);
      gl.uniform2f(this.uRays.u_sun, p.sunUV[0], p.sunUV[1]);
      gl.uniform1f(this.uRays.u_str, 1.6 * p.sunVisible);
    });
    // сборка на экран
    this.pass(this.pComp, null, () => {
      this.bind(0, this.scene.tex, this.uComp.u_scene);
      this.bind(1, this.half.tex, this.uComp.u_bloom);
      this.bind(2, this.q.tex, this.uComp.u_bloom2);
      this.bind(3, this.rays.tex, this.uComp.u_rays);
      gl.uniform1f(this.uComp.u_time, p.time);
      gl.uniform1f(this.uComp.u_bloomK, 0.28 + p.night * 0.8);
      gl.uniform1f(this.uComp.u_raysK, 0.55);
      gl.uniform1f(this.uComp.u_night, p.night);
      gl.uniform3f(this.uComp.u_tint, p.tint[0], p.tint[1], p.tint[2]);
      gl.uniform2f(this.uComp.u_res, this.w, this.h);
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }
}
