/**
 * Инстансный шейдер всех живых и физических объектов: муравьи всех каст,
 * матка, личинки, еда, существа, частицы. Каждый объект — один инстанс (20 байт);
 * форма рисуется SDF-функциями прямо в фрагментном шейдере, поэтому муравей
 * детален при любом приближении, а при отдалении плавно вырождается в точку
 * (LOD в шейдере — сотни тысяч инстансов за один draw call).
 */
export const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_quad;
layout(location=1) in vec4 i_pos;   // x, y, rot, size
layout(location=2) in uvec4 i_a;    // kind, anim, flags, extra
layout(location=3) in uvec4 i_b;    // tint, cargo, dirt, variant
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_res;
out vec2 v_p;
flat out uvec4 v_a;
flat out uvec4 v_b;
out float v_px;
flat out float v_ext;

float extentFor(uint kind) {
  if (kind == 0u || kind == 1u) return 0.78;
  if (kind == 2u) return 0.7;
  if (kind >= 3u && kind < 20u) return 1.35;
  if (kind >= 20u && kind < 30u) return 1.7;
  if (kind == 36u) return 1.2;
  return 1.0;
}

void main() {
  float ext = extentFor(i_a.x);
  float size = i_pos.w;
  float r = i_pos.z;
  vec2 q = a_quad * ext;
  // в пикселях размер тела — для LOD
  float px = size * u_zoom;
  // слишком мелкие — раздуваем квад до минимально видимого
  float minPx = 1.6;
  float inflate = max(1.0, minPx / max(px * ext, 0.0001));
  q *= inflate;
  vec2 rotq = vec2(q.x * cos(r) - q.y * sin(r), q.x * sin(r) + q.y * cos(r));
  vec2 w = i_pos.xy + rotq * size;
  vec2 ndc = (w - u_cam) * u_zoom / (u_res * 0.5);
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_p = q;
  v_a = i_a;
  v_b = i_b;
  v_px = px;
  v_ext = ext;
}`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in uvec4 v_a;
flat in uvec4 v_b;
in float v_px;
flat in float v_ext;
out vec4 o;
uniform float u_time;
uniform float u_light;
uniform vec3 u_food[16];
uniform vec3 u_cr[8];
uniform vec3 u_pal[32];

float h11(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdE(vec2 p, vec2 r) { float k = length(p / r); return (k - 1.0) * min(r.x, r.y); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

vec4 over(vec4 top, vec4 bot) { return top + bot * (1.0 - top.a); }
vec4 fillSD(float d, vec3 col, float aa) { float a = smoothstep(aa, -aa, d); return vec4(col * a, a); }

// ------------------------------------------------------------ муравей
vec4 ant(vec2 p, uint anim, uint flags, uint extra, uint tint, uint cargo, uint dirt, uint variant, bool queen) {
  float aa = max(0.012, 1.4 / max(v_px, 1.0));
  uint caste = extra & 7u;
  uint cargoT = (extra >> 3u) & 7u;
  bool flip = (flags & 1u) != 0u;
  bool locked = (flags & 4u) != 0u;
  bool dig = (flags & 8u) != 0u;
  bool rival = (flags & 64u) != 0u;
  bool moving = (flags & 2u) != 0u;
  if (flip) p.y = -p.y;
  float ph = float(anim) / 255.0 * 6.2831;
  float t = float(tint) / 255.0;
  // пропорции каст
  float headS = caste == 1u ? 1.4 : caste == 2u ? 0.9 : 1.0;
  float gastS = queen ? 1.6 : caste == 4u ? 1.15 : caste == 2u ? 0.85 : 1.0;
  float thorS = caste == 4u ? 1.2 : 1.0;
  float legL = caste == 2u ? 1.15 : 1.0;
  vec3 base = rival ? vec3(0.52, 0.17, 0.08) : vec3(0.15, 0.095, 0.065);
  if (caste == 1u) base = rival ? vec3(0.6, 0.2, 0.08) : vec3(0.24, 0.1, 0.06);
  if (caste == 2u) base *= 1.25;
  if (queen) base = rival ? vec3(0.55, 0.2, 0.1) : vec3(0.22, 0.12, 0.07);
  base *= 0.85 + 0.3 * t;
  vec3 dirtC = vec3(0.42, 0.3, 0.2);
  base = mix(base, dirtC, float(dirt) / 255.0 * 0.45);
  float bob = moving ? sin(ph * 2.0) * 0.012 : 0.0;
  // --- тело
  vec2 gp = rot(p - vec2(-0.3 * gastS, -0.02 + bob), -0.18);
  float dG = sdE(gp, vec2(0.21, 0.15) * gastS);
  float dP = length(p - vec2(-0.1, 0.0)) - 0.034;
  float dT = sdE(p - vec2(0.03, -0.025), vec2(0.14, 0.066) * thorS);
  vec2 hp = p - vec2(0.23 + (headS - 1.0) * 0.05, -0.045 + (dig ? sin(ph * 3.0) * 0.03 : 0.0));
  float dH = sdE(hp, vec2(0.085, 0.075) * headS);
  float body = min(min(dG, dP), min(dT, dH));
  // --- ноги (треножная походка), дальние темнее
  float legNear = 1e5, legFar = 1e5;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 hip = vec2(-0.02 + fi * 0.065, 0.02);
    float phase = ph + (mod(fi, 2.0) < 0.5 ? 0.0 : 3.1416);
    float stride = moving ? 0.085 * legL : 0.0;
    vec2 foot = vec2(-0.16 + fi * 0.15, 0.24) * vec2(legL, 1.0) + vec2(stride * sin(phase), -max(0.0, cos(phase)) * 0.05 * (moving ? 1.0 : 0.0));
    if (locked) foot = vec2((fi - 1.0) * 0.42, 0.06 + 0.04 * sin(fi * 2.0 + u_time));
    vec2 knee = mix(hip, foot, 0.42) + vec2(0.0, locked ? -0.05 : -0.1);
    legNear = min(legNear, min(sdSeg(p, hip, knee), sdSeg(p, knee, foot)) - 0.015);
    float phase2 = phase + 3.1416;
    vec2 foot2 = vec2(-0.13 + fi * 0.15, 0.22) * vec2(legL, 1.0) + vec2(stride * sin(phase2), -max(0.0, cos(phase2)) * 0.05 * (moving ? 1.0 : 0.0));
    if (locked) foot2 = vec2((fi - 1.0) * 0.38 + 0.05, 0.02);
    vec2 knee2 = mix(hip, foot2, 0.42) + vec2(0.02, -0.09);
    legFar = min(legFar, min(sdSeg(p, hip + vec2(0.02, -0.01), knee2), sdSeg(p, knee2, foot2)) - 0.012);
  }
  // --- усики (коленчатые) и жвала
  float wig = sin(u_time * 7.0 + t * 20.0) * 0.03;
  vec2 ab = vec2(0.27 + (headS - 1.0) * 0.05, -0.1);
  vec2 ae = ab + vec2(0.06, -0.12 + wig);
  vec2 at = ae + vec2(0.13, 0.08 - wig);
  float dAnt = min(sdSeg(p, ab, ae), sdSeg(p, ae, at)) - 0.009;
  vec2 mb = vec2(0.3 + (headS - 1.0) * 0.08, -0.015);
  float mOpen = locked || dig ? 0.04 : 0.015;
  float dMand = min(sdSeg(p, mb, mb + vec2(0.07 * headS, 0.02 - mOpen)), sdSeg(p, mb + vec2(0.0, 0.02), mb + vec2(0.07 * headS, 0.03 + mOpen))) - 0.012 * headS;
  // --- освещение: сверху светлее, блики на брюшке и голове
  vec3 shade = base * (0.75 + 0.55 * clamp(-p.y * 3.0 + 0.4, 0.0, 1.0));
  float spec = smoothstep(0.08, 0.0, length(gp - vec2(0.02, -0.08) * gastS)) * 0.45 + smoothstep(0.035, 0.0, length(hp - vec2(-0.01, -0.035))) * 0.35;
  shade += spec * mix(vec3(0.9, 0.85, 0.8), vec3(1.0, 0.7, 0.5), rival ? 1.0 : 0.0);
  // полоски на брюшке
  shade *= 1.0 - 0.18 * smoothstep(0.012, 0.0, abs(fract(gp.x * 11.0) - 0.5) - 0.3) * step(dG, 0.0);
  // кант
  float rim = smoothstep(-0.02, 0.0, body);
  shade = mix(shade, base * 0.4, rim * 0.6);
  vec4 col = vec4(0.0);
  col = over(fillSD(legFar, base * 0.55, aa), col);
  col = over(fillSD(body, shade, aa), col);
  col = over(fillSD(legNear, base * 0.85, aa), col);
  col = over(fillSD(dAnt, base * 0.8, aa), col);
  col = over(fillSD(dMand, base * 0.6, aa), col);
  // глаз
  float eye = length(hp - vec2(0.02, -0.02)) - 0.02 * headS;
  col = over(fillSD(eye, vec3(0.02), aa), col);
  // матка: крылья-обрубки и светлые полосы
  if (queen) {
    float wing = sdE(rot(p - vec2(-0.05, -0.14), 0.4), vec2(0.18, 0.05));
    col = over(fillSD(wing, vec3(0.8, 0.8, 0.85) * 0.6, aa) * 0.5, col);
  }
  // груз в жвалах
  if (cargoT != 0u) {
    vec2 cp = p - vec2(0.42 + (headS - 1.0) * 0.08, -0.02);
    vec3 cc = cargoT == 1u ? u_food[cargo & 15u] : cargoT == 2u ? u_pal[cargo & 31u] : cargoT == 3u ? vec3(0.95, 0.93, 0.85) : vec3(0.35, 0.6, 0.25);
    float r = cargoT == 3u ? 0.09 : 0.1;
    float dc = cargoT == 4u ? sdE(rot(cp, 0.6), vec2(0.16, 0.06)) : sdE(cp, vec2(r, r * 0.85));
    vec3 cs = cc * (0.8 + 0.4 * clamp(-cp.y * 8.0 + 0.5, 0.0, 1.0));
    col = over(fillSD(dc, cs, aa), col);
  }
  return col;
}

vec4 antFar(vec2 p, uint flags, uint extra, uint tint) {
  bool rival = (flags & 64u) != 0u;
  vec3 base = rival ? vec3(0.55, 0.18, 0.08) : vec3(0.12, 0.08, 0.05);
  if ((flags & 1u) != 0u) p.y = -p.y;
  float d = sdE(p - vec2(-0.02, 0.0), vec2(0.42, 0.16));
  float aa = max(0.03, 1.5 / max(v_px, 1.0));
  vec4 c = fillSD(d, base, aa);
  if (((extra >> 3u) & 7u) != 0u) c = over(fillSD(length(p - vec2(0.42, 0.0)) - 0.13, vec3(0.8, 0.7, 0.5), aa), c);
  return c;
}

// ------------------------------------------------------------ личинки
vec4 brood(vec2 p, uint variant, uint anim) {
  float aa = max(0.02, 1.2 / max(v_px, 1.0));
  vec3 c = vec3(0.95, 0.93, 0.86);
  if (variant == 0u) return fillSD(sdE(p, vec2(0.18, 0.12)), c, aa);
  if (variant == 2u) return fillSD(sdE(p, vec2(0.34, 0.16)), vec3(0.86, 0.78, 0.6) * (0.85 + 0.15 * sin(p.x * 40.0)), aa);
  float wig = sin(u_time * 2.0 + float(anim)) * 0.05;
  float d = abs(length(p - vec2(0.0, 0.1)) - 0.22) - 0.1 + wig * p.x;
  d = max(d, p.y - 0.14);
  vec3 cc = c * (0.85 + 0.15 * sin(atan(p.y - 0.1, p.x) * 14.0));
  return fillSD(d, cc, aa);
}

// ------------------------------------------------------------ еда
vec4 food(vec2 p, uint kind, uint variant, uint anim) {
  float aa = max(0.02, 1.4 / max(v_px, 1.0));
  vec3 c = u_food[kind];
  float v = float(variant) / 255.0;
  vec3 lit = c * (0.75 + 0.5 * clamp(-p.y + 0.4, 0.0, 1.0));
  if (kind == 0u || kind == 11u || kind == 7u) {
    float a = atan(p.y, p.x);
    float rr = 0.82 + 0.16 * sin(a * 3.0 + v * 20.0) + 0.08 * sin(a * 7.0 + v * 9.0);
    float d = length(p) - rr;
    vec3 cc = lit * (0.9 + 0.2 * h11(floor(p.x * 6.0) + floor(p.y * 6.0) * 7.0 + v));
    if (kind == 7u) cc = mix(cc, vec3(0.95, 0.9, 0.85), smoothstep(0.05, 0.0, abs(p.y - 0.2 * sin(p.x * 4.0)) - 0.08));
    return fillSD(d, cc, aa);
  }
  if (kind == 1u) {
    vec2 q = rot(p, 0.4 + v);
    float d = sdE(q + vec2(0.0, q.x * 0.25), vec2(0.9, 0.55));
    return fillSD(d, lit * (0.85 + 0.2 * smoothstep(0.2, 0.0, abs(q.y))), aa);
  }
  if (kind == 2u) {
    float d = length(p) - 0.85;
    vec3 cc = lit + 0.5 * smoothstep(0.25, 0.0, length(p - vec2(-0.3, -0.35)));
    vec4 col = fillSD(d, cc, aa);
    float cal = sdE(p - vec2(0.0, -0.82), vec2(0.28, 0.1));
    return over(fillSD(cal, vec3(0.25, 0.4, 0.15), aa), col);
  }
  if (kind == 3u) {
    // огрызок яблока: талия, кожура сверху и снизу, семечки
    float waist = 0.55 + 0.35 * pow(abs(p.y), 1.6);
    float d = max(abs(p.x) - waist, abs(p.y) - 0.92);
    vec3 cc = mix(c, vec3(0.75, 0.15, 0.12), smoothstep(0.7, 0.8, abs(p.y)));
    cc *= 0.8 + 0.3 * clamp(-p.y + 0.5, 0.0, 1.0);
    vec4 col = fillSD(d, cc, aa);
    float seed = min(sdE(p - vec2(-0.12, 0.05), vec2(0.07, 0.12)), sdE(p - vec2(0.12, -0.05), vec2(0.07, 0.12)));
    col = over(fillSD(seed, vec3(0.3, 0.18, 0.08), aa), col);
    return over(fillSD(sdSeg(p, vec2(0.0, -0.9), vec2(0.05, -1.15)) - 0.04, vec3(0.35, 0.25, 0.12), aa), col);
  }
  if (kind == 4u || kind == 12u) {
    // печенье/чипсы: сбоку это толстый диск
    float d = sdE(p, vec2(1.0, kind == 4u ? 0.36 : 0.22));
    if (kind == 12u) d = sdE(p - vec2(0.0, 0.15 * p.x * p.x), vec2(1.0, 0.18));
    vec3 cc = lit;
    if (kind == 4u) {
      float chip = step(0.82, h11(floor(p.x * 7.0) * 13.0 + floor(p.y * 7.0) + v * 50.0));
      cc = mix(cc, vec3(0.28, 0.16, 0.08), chip);
      cc *= 0.85 + 0.2 * smoothstep(0.1, 0.0, abs(p.y + 0.3));
    }
    return fillSD(d, cc, aa);
  }
  if (kind == 5u) {
    vec2 q = abs(p) - vec2(0.9, 0.55);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.25;
    vec3 crust = vec3(0.55, 0.32, 0.14);
    vec3 cc = mix(c * 1.1, crust, smoothstep(-0.12, 0.0, d));
    cc *= 0.9 + 0.15 * h11(floor(p.x * 9.0) + floor(p.y * 9.0) * 3.0);
    return fillSD(d, cc, aa);
  }
  if (kind == 6u) {
    vec2 q = rot(p, v * 3.0);
    vec2 b = abs(q) - vec2(0.62);
    float d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
    return fillSD(d, vec3(0.97) * (0.8 + 0.25 * step(0.0, q.x - q.y)), aa);
  }
  if (kind == 8u) {
    // туша насекомого (лапками вверх) — без натурализма
    float d = sdE(p - vec2(0.0, 0.1), vec2(0.9, 0.45));
    vec4 col = fillSD(d, c * (0.8 + 0.4 * clamp(-p.y, 0.0, 1.0)), aa);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float leg = sdSeg(p, vec2(-0.4 + fi * 0.4, -0.2), vec2(-0.5 + fi * 0.45, -0.75)) - 0.05;
      col = over(fillSD(leg, c * 0.7, aa), col);
    }
    return col;
  }
  if (kind == 9u) {
    float cap = max(sdE(p - vec2(0.0, 0.05), vec2(0.95, 0.7)), p.y - 0.05);
    float stem = sdE(p - vec2(0.0, 0.5), vec2(0.28, 0.45));
    vec4 col = fillSD(stem, vec3(0.9, 0.87, 0.8), aa);
    vec3 cc = c * (0.8 + 0.3 * clamp(-p.y, 0.0, 1.0));
    cc = mix(cc, vec3(1.0), step(0.85, h11(floor(p.x * 5.0) + floor(p.y * 5.0) * 7.0)) * 0.5);
    return over(fillSD(cap, cc, aa), col);
  }
  if (kind == 10u) {
    vec2 q = rot(p, v * 6.28 + float(anim) * 0.02);
    float d = sdE(q, vec2(0.95, 0.45 * (1.0 - q.x * q.x * 0.3)));
    vec3 cc = c * (0.85 + 0.3 * clamp(-q.y, 0.0, 1.0));
    cc = mix(cc, cc * 1.35, smoothstep(0.04, 0.0, abs(q.y)));
    return fillSD(d, cc, aa);
  }
  if (kind == 13u) {
    vec2 q = rot(p, v * 6.28);
    float d = sdSeg(q, vec2(-0.9, 0.0), vec2(0.9, 0.0)) - 0.16;
    d = min(d, sdSeg(q, vec2(0.2, 0.0), vec2(0.6, -0.35)) - 0.08);
    return fillSD(d, c * (0.8 + 0.3 * clamp(-q.y * 3.0, 0.0, 1.0)), aa);
  }
  return fillSD(length(p) - 0.8, lit, aa);
}

// ------------------------------------------------------------ существа
vec4 creature(vec2 p, uint kind, uint anim, uint flags) {
  float aa = max(0.02, 1.4 / max(v_px, 1.0));
  vec3 c = u_cr[kind];
  float ph = float(anim) / 255.0 * 6.2831;
  bool flip = (flags & 1u) != 0u;
  if (flip) p.y = -p.y;
  vec4 col = vec4(0.0);
  if (kind == 0u) {
    // паук: брюшко, головогрудь, 8 длинных ног
    float legs = 1e5;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 hip = vec2(0.15 + fi * 0.05, 0.0);
      float s = sin(ph + fi * 1.6) * 0.12;
      vec2 knee = vec2(-0.55 + fi * 0.42 + s, -0.55);
      vec2 foot = vec2(-0.85 + fi * 0.55 + s * 1.5, 0.5);
      legs = min(legs, min(sdSeg(p, hip, knee), sdSeg(p, knee, foot)) - 0.035);
    }
    col = over(fillSD(legs, c * 0.8, aa), col);
    float ab = sdE(p - vec2(-0.38, -0.08), vec2(0.42, 0.34));
    float ce = sdE(p - vec2(0.22, -0.02), vec2(0.26, 0.2));
    vec3 sh = c * (0.8 + 0.5 * clamp(-p.y * 2.0, 0.0, 1.0));
    sh = mix(sh, vec3(0.55, 0.45, 0.35), smoothstep(0.03, 0.0, abs(length(p - vec2(-0.38, -0.08)) - 0.2)) * 0.5);
    col = over(fillSD(min(ab, ce), sh, aa), col);
    col = over(fillSD(length(p - vec2(0.42, -0.08)) - 0.04, vec3(0.9, 0.2, 0.1), aa), col);
    return col;
  }
  if (kind == 1u) {
    // жук: блестящие надкрылья
    float legs = 1e5;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float s = sin(ph + fi * 2.1) * 0.08;
      legs = min(legs, min(sdSeg(p, vec2(-0.3 + fi * 0.3, 0.1), vec2(-0.4 + fi * 0.35 + s, 0.3)), sdSeg(p, vec2(-0.4 + fi * 0.35 + s, 0.3), vec2(-0.5 + fi * 0.4 + s * 1.3, 0.5))) - 0.04);
    }
    col = over(fillSD(legs, c * 0.7, aa), col);
    float el = max(sdE(p - vec2(-0.1, 0.12), vec2(0.72, 0.55)), p.y - 0.18);
    float hd = sdE(p - vec2(0.65, 0.05), vec2(0.18, 0.14));
    vec3 sh = c * (0.7 + 0.6 * clamp(-p.y * 1.5, 0.0, 1.0));
    sh += vec3(0.2, 0.35, 0.3) * smoothstep(0.15, 0.0, abs(length(p - vec2(-0.2, 0.2)) - 0.45)) * 0.6;
    col = over(fillSD(min(el, hd), sh, aa), col);
    return col;
  }
  if (kind == 2u) {
    float y = 0.15 * sin(p.x * 5.0 + ph * 2.0);
    float d = abs(p.y - y) - 0.2 * (1.0 - pow(abs(p.x) * 1.05, 6.0));
    d = max(d, abs(p.x) - 0.98);
    vec3 cc = c * (0.8 + 0.25 * sin(p.x * 30.0));
    return fillSD(d, cc * (0.85 + 0.3 * clamp(y - p.y + 0.2, 0.0, 1.0)), aa);
  }
  if (kind == 3u) {
    float d = 1e5;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float x = -0.8 + fi * 0.3;
      float yy = -0.08 * sin(fi * 1.2 + ph);
      d = min(d, length(p - vec2(x, yy)) - 0.2);
    }
    vec3 cc = c * (0.8 + 0.3 * clamp(-p.y * 3.0, 0.0, 1.0));
    cc = mix(cc, vec3(0.95, 0.85, 0.3), smoothstep(0.03, 0.0, abs(p.y + 0.1)) * 0.6);
    return fillSD(d, cc, aa);
  }
  // муха
  float wingA = sin(u_time * 60.0) * 0.5;
  float w1 = sdE(rot(p - vec2(-0.1, -0.35), wingA), vec2(0.45, 0.16));
  col = over(fillSD(w1, vec3(0.85, 0.9, 1.0), aa) * 0.45, col);
  float bd = sdE(p, vec2(0.55, 0.3));
  col = over(fillSD(bd, c * (0.8 + 0.4 * clamp(-p.y * 2.0, 0.0, 1.0)), aa), col);
  col = over(fillSD(length(p - vec2(0.45, -0.1)) - 0.14, vec3(0.6, 0.1, 0.1), aa), col);
  return col;
}

void main() {
  uint kind = v_a.x;
  vec2 p = v_p;
  vec4 col;
  if (kind == 0u || kind == 1u) {
    if (v_px < 5.0 && kind == 0u) col = antFar(p, v_a.z, v_a.w, v_b.x);
    else col = ant(p, v_a.y, v_a.z, v_a.w, v_b.x, v_b.y, v_b.z, v_b.w, kind == 1u);
  } else if (kind == 2u) {
    col = brood(p, v_b.w, v_a.y);
  } else if (kind >= 3u && kind < 20u) {
    col = food(p, kind - 3u, v_b.w, v_a.y);
    // свежесть: гниющее темнеет
    col.rgb *= mix(0.55, 1.0, float(v_b.x) / 255.0);
  } else if (kind >= 20u && kind < 30u) {
    col = creature(p, kind - 20u, v_a.y, v_a.z);
    float dying = float(v_b.z) / 255.0;
    col *= 1.0 - dying;
  } else if (kind == 30u) {
    float a = smoothstep(1.0, 0.2, length(p)) * float(v_a.y) / 255.0;
    col = vec4(u_pal[v_b.y & 31u] * a, a);
  } else if (kind == 31u) {
    float a = smoothstep(1.0, 0.4, length(p)) * float(v_a.y) / 255.0 * 0.8;
    col = vec4(vec3(0.6, 0.75, 0.9) * a, a);
  } else if (kind == 32u) {
    vec2 q = rot(p, float(v_a.y) * 0.05);
    float d = sdE(q, vec2(0.9, 0.4));
    col = fillSD(d, vec3(0.45, 0.6, 0.25), 0.05);
  } else if (kind == 34u) {
    // куча запасов/земли
    float a2 = atan(p.y, p.x);
    float d = max(length(p * vec2(1.0, 1.6)) - 0.95 - 0.08 * sin(a2 * 9.0 + float(v_b.w)), p.y - 0.35);
    vec3 cc = u_food[v_b.y & 15u] * (0.75 + 0.35 * clamp(-p.y, 0.0, 1.0));
    col = fillSD(d, cc, 0.04);
  } else if (kind == 35u) {
    float d = length(p) - 0.8 - 0.12 * sin(atan(p.y, p.x) * 11.0 + float(v_b.w));
    vec3 cc = vec3(0.86, 0.84, 0.78) * (0.75 + 0.3 * sin(p.x * 25.0) * sin(p.y * 25.0));
    col = fillSD(d, cc, 0.04);
  } else if (kind == 36u) {
    float d = abs(length(p) - 0.9) - 0.06;
    col = fillSD(d, vec3(1.0, 0.85, 0.3), 0.04);
  } else {
    col = vec4(1.0, 0.0, 1.0, 1.0);
  }
  // общее освещение сцены
  float l = float(v_b.z) > 0.0 && kind >= 20u && kind < 30u ? 1.0 : 1.0;
  float lightK = (v_a.z & 128u) != 0u ? 0.55 : 1.0;
  col.rgb *= mix(0.45, 1.0, u_light) * lightK * l;
  if (col.a < 0.003) discard;
  o = col;
}`;
