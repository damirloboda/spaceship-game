/**
 * Шейдер мира. Материалы процедурно текстурируются прямо в шейдере по id клетки:
 * у земли — комки и камешки, у глины — слои, у кирпича — кладка, у дерева — волокна,
 * у травы — травинки, качающиеся на ветру, и т.д. Никаких растровых текстур и
 * случайного AI-арта: единый стиль задаётся одной функцией освещения и палитрой.
 */
export const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_mat;
uniform sampler2D u_water;
uniform sampler2D u_pher;
uniform sampler2D u_fog;
uniform sampler2D u_sky;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_res;
uniform vec2 u_world;
uniform float u_time;
uniform float u_light;
uniform float u_wind;
uniform int u_overlay;
uniform float u_fogOn;
uniform vec2 u_indoor;
uniform float u_groundY;
uniform float u_ultra;
uniform float u_tod;
uniform vec3 u_pal[32];

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

vec4 cellAt(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(u_world.x) || c.y >= int(u_world.y)) return vec4(5.0 / 255.0, 1.0, 0.0, 0.0);
  return texelFetch(u_mat, c, 0);
}
int matOf(vec4 t) { return int(t.r * 255.0 + 0.5); }
bool solidM(int m) { return m != 0 && m != 23; }
bool foliageM(int m) { return m == 7 || m == 8 || m == 27 || m == 28; }
bool opaqueM(int m) { return solidM(m) && !foliageM(m) && m != 24; }

// Кадр свет/тень: небо сверху, темнеет в глубине, днём/ночью
bool indoorAt(vec2 w) { return w.x >= u_indoor.x && w.x < u_indoor.y; }
float skyAt(vec2 w) {
  float sky = texelFetch(u_sky, ivec2(clamp(int(w.x), 0, int(u_world.x) - 1), 0), 0).r;
  // в доме "небо" — это уровень пола: интерьер освещён лампой, не считается подземельем
  return indoorAt(w) ? max(sky, u_groundY - 2.0) : sky;
}
float lightAt(vec2 w) {
  float depth = w.y - skyAt(w);
  float surface = depth < 0.0 ? 1.0 : exp(-depth / 22.0);
  float dayK = indoorAt(w) ? 0.85 : u_light;
  return mix(0.30, 1.0, surface * dayK);
}

vec3 matColor(int m, vec2 w, ivec2 c, vec2 f, float det, out float alpha) {
  alpha = 1.0;
  vec3 base = u_pal[m];
  float r = h21(vec2(c));
  float n = vnoise(w * 3.1);
  float g = vnoise(w * 9.0);
  vec3 col = base * (0.95 + 0.1 * r) * (0.9 + 0.2 * fbm(w * 0.18));
  if (m == 1 || m == 26 || m == 21 || m == 20) {
    // земля/гумус/уложенная/рыхлая: комочки и камешки
    col *= 0.85 + 0.3 * n;
    vec2 pq = fract(w * 2.2) - 0.5;
    float peb = step(0.9, h21(floor(w * 2.2))) * smoothstep(0.32, 0.2, length(pq));
    col = mix(col, col * vec3(1.35, 1.3, 1.2), peb * det * 0.7);
    if (m == 21) { vec2 q = fract(w * 2.0) - 0.5; col *= 0.85 + 0.25 * smoothstep(0.5, 0.1, length(q)); }
    if (m == 20) col *= 0.9 + 0.25 * step(0.6, g);
    if (m == 26) col = mix(col, vec3(0.2, 0.14, 0.08), 0.25 * step(0.8, vnoise(vec2(w.x * 7.0, w.y * 1.2))));
  } else if (m == 2) {
    col *= 0.9 + 0.2 * g;
    col += 0.06 * step(0.9, h21(floor(w * 5.0)));
  } else if (m == 3) {
    col *= 0.88 + 0.18 * sin(w.y * 2.3 + n * 3.0);
  } else if (m == 4 || m == 5) {
    float cr = abs(vnoise(w * 1.3) - 0.5);
    col *= 0.8 + 0.3 * fbm(w * 1.7);
    col *= mix(0.75, 1.0, smoothstep(0.0, 0.05, cr));
  } else if (m == 6) {
    col *= 0.8 + 0.25 * sin(w.x * 7.0 + vnoise(w * vec2(0.5, 3.0)) * 4.0);
  } else if (m == 7) {
    // листья: перекрывающиеся пластинки с жилками и просветами
    float lf = vnoise(w * 1.6 + 3.0);
    col *= 0.75 + 0.5 * lf;
    col = mix(col, col * 1.25, smoothstep(0.02, 0.0, abs(fract(w.x * 1.5 + w.y * 0.8) - 0.5)) * 0.4);
    alpha = smoothstep(0.22, 0.4, vnoise(w * 2.3 + 11.0) + 0.15);
  } else if (m == 8) {
    // травинка: узкая полоса по центру клетки с качанием на ветру
    vec4 below = cellAt(c + ivec2(0, 1));
    vec4 below2 = cellAt(c + ivec2(0, 2));
    float hgt = (matOf(below) == 8 ? 1.0 : 0.0) + (matOf(below2) == 8 ? 1.0 : 0.0);
    bool tip = matOf(cellAt(c + ivec2(0, -1))) != 8;
    float rc = h21(vec2(float(c.x), 7.0));
    float sway = u_wind * (0.15 + hgt * 0.12) * sin(u_time * 2.2 + float(c.x) * 0.9);
    float cx = 0.5 + sway + (rc - 0.5) * 0.3;
    float wdt = tip ? mix(0.03, 0.2, f.y) : 0.2;
    float d = abs(f.x - cx);
    alpha = det < 0.5 ? 1.0 : smoothstep(wdt, wdt - 0.08, d);
    col = base * (0.75 + 0.5 * smoothstep(-0.2, 0.2, f.x - cx)) * (0.85 + 0.3 * rc);
  } else if (m == 27) {
    vec2 q = f - 0.5;
    float pet = 0.5 + 0.5 * cos(atan(q.y, q.x) * 6.0 + r * 6.0);
    col = mix(base, base * vec3(1.1, 1.05, 0.7), pet);
    alpha = smoothstep(0.55, 0.35, length(q) - pet * 0.1);
  } else if (m == 28) {
    // цветы сакуры: облака мелких пятилепестковых цветков, розовый градиент, просветы
    vec2 q = fract(w * 1.3) - 0.5;
    float fl = 0.5 + 0.5 * cos(atan(q.y, q.x) * 5.0 + h21(floor(w * 1.3)) * 6.0);
    float petals = smoothstep(0.5, 0.3, length(q) - fl * 0.12);
    float cl = vnoise(w * 0.9 + 4.0);
    col = mix(vec3(0.99, 0.84, 0.9), vec3(0.93, 0.52, 0.66), cl * 0.8 + 0.2 * (1.0 - f.y));
    col = mix(col, vec3(1.0, 0.95, 0.97), petals * 0.35);
    col *= 0.9 + 0.2 * h21(floor(w * 1.3) + 3.0);
    alpha = mix(1.0, smoothstep(0.12, 0.3, vnoise(w * 0.8 + 21.0) * 0.6 + vnoise(w * 3.0) * 0.4 + 0.12), det) * (0.9 + 0.1 * petals);
  } else if (m == 24) {
    col *= 0.85 + 0.3 * smoothstep(0.0, 0.5, 0.5 - abs(f.x - 0.5));
  } else if (m == 9) {
    col *= 0.8 + 0.3 * sin(w.x * 3.0 + w.y * 5.0 + n * 6.0);
  } else if (m == 10) {
    col *= 0.8 + 0.35 * n;
    col += 0.12 * pow(max(0.0, vnoise(w * 4.0 + u_time * 0.2) - 0.6), 2.0);
  } else if (m == 11) {
    col *= 0.85 + 0.25 * (vnoise(vec2(w.x * 0.3, w.y * 12.0)));
    col += 0.18 * smoothstep(0.9, 1.0, sin(w.x * 0.2 + w.y * 0.05));
  } else if (m == 12) {
    alpha = 0.45;
    col = mix(base, vec3(1.0), 0.3 * smoothstep(0.96, 1.0, sin((w.x + w.y) * 0.4)));
  } else if (m == 13) {
    col *= 0.9 + 0.15 * smoothstep(0.3, 0.9, vnoise(w * 0.4));
  } else if (m == 14) {
    col *= 0.92 + 0.12 * vnoise(w * vec2(12.0, 2.0));
  } else if (m == 15) {
    float weave = step(0.5, fract(w.x * 2.0)) * step(0.5, fract(w.y * 2.0)) + step(fract(w.x * 2.0), 0.5) * step(fract(w.y * 2.0), 0.5);
    col *= 0.85 + 0.2 * weave;
  } else if (m == 16) {
    col *= 0.9 + 0.12 * g + 0.05 * step(0.95, h21(floor(w * 6.0)));
  } else if (m == 17) {
    // кирпичная кладка
    vec2 b = w / vec2(6.0, 3.0);
    b.x += step(1.0, mod(floor(b.y), 2.0)) * 0.5;
    vec2 bf = fract(b);
    float mortar = step(bf.x, 0.06) + step(bf.y, 0.1);
    col = mix(base * (0.85 + 0.3 * h21(floor(b))), vec3(0.55, 0.53, 0.5), clamp(mortar, 0.0, 1.0));
  } else if (m == 18) {
    col *= 0.8 + 0.4 * step(0.8, h21(floor(w * 4.0)));
  } else if (m == 19) {
    col *= 0.8 + 0.4 * n;
  } else if (m == 22) {
    // укреплённая стена: гладкая, с блеском секрета
    col *= 0.92 + 0.1 * n;
    col += 0.05 * smoothstep(0.7, 1.0, vnoise(w * 0.8 + 5.0));
  } else if (m == 25) {
    vec2 q = fract(w * 1.5) - 0.5;
    col *= 0.7 + 0.45 * smoothstep(0.55, 0.1, length(q)) * (0.8 + 0.4 * h21(floor(w * 1.5)));
  }
  return col;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 w = u_cam + vec2(px.x - u_res.x * 0.5, u_res.y * 0.5 - px.y) / u_zoom;
  if (w.x < 0.0 || w.y < 0.0 || w.x >= u_world.x || w.y >= u_world.y) discard;
  ivec2 c = ivec2(floor(w));
  vec2 f = fract(w);
  float det = smoothstep(1.5, 6.0, u_zoom);
  vec4 t = cellAt(c);
  int m = matOf(t);
  float sky = skyAt(w);
  bool under = float(c.y) > sky + 0.5;
  float light = lightAt(w);
  vec4 res = vec4(0.0);

  // фон подземелья: тёмная "задняя стенка" в пещерах и ходах
  if (!solidM(m) || foliageM(m) || m == 12 || m == 24) {
    if (under) {
      float bn = fbm(w * 0.35);
      vec3 bg = mix(vec3(0.16, 0.11, 0.075), vec3(0.24, 0.17, 0.11), bn);
      bg *= 0.75 + 0.25 * vnoise(w * 2.0);
      res = vec4(bg * light * 0.8, 1.0);
    }
  }

  if (solidM(m) || m == 23) {
    float a;
    vec3 col = matColor(m, w, c, f, det, a);
    // органичные края листвы и цветов: скругление углов по соседям
    if ((m == 7 || m == 28) && det > 0.3) {
      float en = vnoise(w * 2.7 + 9.0) * 0.35;
      if (matOf(cellAt(c + ivec2(0, -1))) != m) a *= smoothstep(0.0, 0.35 + en, f.y);
      if (matOf(cellAt(c + ivec2(0, 1))) != m) a *= smoothstep(0.0, 0.35 + en, 1.0 - f.y);
      if (matOf(cellAt(c + ivec2(-1, 0))) != m) a *= smoothstep(0.0, 0.35 + en, f.x);
      if (matOf(cellAt(c + ivec2(1, 0))) != m) a *= smoothstep(0.0, 0.35 + en, 1.0 - f.x);
    }
    if (m == 23) {
      // паутина: тонкие нити
      vec2 q = f - 0.5;
      float web = smoothstep(0.06, 0.0, abs(q.x - q.y)) + smoothstep(0.06, 0.0, abs(q.x + q.y)) + smoothstep(0.05, 0.0, abs(length(q) - 0.3));
      col = vec3(0.92);
      a = clamp(web, 0.0, 1.0) * 0.7;
    }
    // влажность темнит пористые материалы
    float moist = t.b;
    col *= 1.0 - moist * 0.35;
    // повреждение (копание)
    float hp = t.g;
    if (hp < 0.99) {
      float crack = smoothstep(0.5, 0.52, vnoise(w * 6.0 + float(c.x)));
      col *= mix(1.0, 0.55 + 0.3 * crack, (1.0 - hp) * det);
    }
    // напряжение: трещины перед обвалом
    int flags = int(t.a * 255.0 + 0.5);
    float stress = float(flags & 63) / 63.0;
    if (stress > 0.02) {
      float cr = smoothstep(0.03, 0.0, abs(vnoise(w * 2.5) - 0.5)) * stress;
      col = mix(col, vec3(0.05, 0.02, 0.02), cr * 0.9);
      col += vec3(0.25, 0.05, 0.0) * stress * 0.4 * (0.5 + 0.5 * sin(u_time * 8.0));
    }
    // края: затенение у пустых соседей, подсветка верхней грани
    if (opaqueM(m)) {
      bool upE = !opaqueM(matOf(cellAt(c + ivec2(0, -1))));
      bool dnE = !opaqueM(matOf(cellAt(c + ivec2(0, 1))));
      bool lfE = !opaqueM(matOf(cellAt(c + ivec2(-1, 0))));
      bool rtE = !opaqueM(matOf(cellAt(c + ivec2(1, 0))));
      float e = 1.0;
      if (upE) { e *= mix(1.25, 1.0, smoothstep(0.0, 0.25, f.y)); }
      if (dnE) e *= mix(0.6, 1.0, smoothstep(0.0, 0.3, 1.0 - f.y));
      if (lfE) e *= mix(0.75, 1.0, smoothstep(0.0, 0.25, f.x));
      if (rtE) e *= mix(0.75, 1.0, smoothstep(0.0, 0.25, 1.0 - f.x));
      col *= mix(1.0, e, det);
      if (u_ultra > 0.5 && upE && !under) {
        // тёплый контровой свет солнца по верхней кромке (утром/вечером — золотой)
        float dusk = exp(-pow((u_tod - 0.75) / 0.06, 2.0)) + exp(-pow((u_tod - 0.26) / 0.06, 2.0));
        vec3 rim = mix(vec3(1.0, 0.95, 0.8), vec3(1.0, 0.65, 0.35), clamp(dusk, 0.0, 1.0));
        col += rim * smoothstep(0.3, 0.0, f.y) * 0.22 * u_light;
      }
      // натоптанные дороги: верх поверхности, где ходит много муравьёв
      if (upE) {
        vec4 ph = texture(u_pher, (w - vec2(0.0, 1.0)) / u_world);
        float road = smoothstep(0.05, 0.6, ph.a);
        col = mix(col, col * vec3(1.18, 1.12, 1.02), road * smoothstep(0.35, 0.0, f.y));
      }
    }
    // план стройки / запрет
    if ((flags & 64) != 0) {
      float st = step(0.5, fract((w.x + w.y) * 0.5 - u_time * 0.3));
      col = mix(col, vec3(1.0, 0.85, 0.2), 0.35 * st);
    }
    if ((flags & 128) != 0) {
      float st = step(0.5, fract((w.x - w.y) * 0.5));
      col = mix(col, vec3(0.9, 0.1, 0.1), 0.35 * st);
    }
    col *= light;
    vec4 fg = vec4(col * a, a);
    res = fg + res * (1.0 - fg.a);
  } else {
    // запрет в пустых клетках
    int flags = int(t.a * 255.0 + 0.5);
    if ((flags & 128) != 0) {
      float st = step(0.5, fract((w.x - w.y) * 0.5));
      vec4 fg = vec4(vec3(0.8, 0.1, 0.1) * 0.25 * st, 0.25 * st);
      res = fg + res * (1.0 - fg.a);
    }
  }

  // вода
  float water = texelFetch(u_water, c, 0).r;
  if (water > 0.01 && (!solidM(m) || foliageM(m))) {
    float above = texelFetch(u_water, c + ivec2(0, -1), 0).r;
    float level = above > 0.05 ? 1.0 : water;
    float surf = 1.0 - level + 0.04 * sin(w.x * 1.7 + u_time * 2.5) * det;
    if (f.y >= surf) {
      vec3 wc = mix(vec3(0.16, 0.36, 0.52), vec3(0.28, 0.5, 0.62), vnoise(w * 0.7 + u_time * 0.3));
      float edge = smoothstep(0.12, 0.0, f.y - surf) * (above > 0.05 ? 0.0 : 1.0);
      wc += edge * 0.35;
      float wa = 0.62 + edge * 0.3;
      if (u_ultra > 0.5 && !under) {
        // отражение неба, солнечные блики и рябь на открытой воде
        float ripple = vnoise(vec2(w.x * 0.8 - u_time * 0.6, w.y * 3.0 + u_time)) * vnoise(vec2(w.x * 1.7 + u_time * 0.4, w.y * 2.0));
        vec3 skyRef = mix(vec3(0.55, 0.72, 0.9), vec3(0.08, 0.1, 0.2), 1.0 - u_light);
        wc = mix(wc, skyRef, 0.35 + 0.2 * ripple);
        wc += vec3(1.0, 0.92, 0.75) * pow(ripple, 6.0) * 3.0 * u_light;
        wa = 0.72 + edge * 0.25;
      }
      vec4 fg = vec4(wc * light * wa, wa);
      res = fg + res * (1.0 - fg.a);
    }
  }

  // оверлей феромонов (включается игроком)
  if (u_overlay == 1 && !opaqueM(m)) {
    vec4 ph = texture(u_pher, w / u_world);
    vec3 pc = vec3(0.0);
    pc += vec3(0.25, 1.0, 0.35) * ph.r;
    pc += vec3(0.3, 0.55, 1.0) * ph.g;
    pc += vec3(1.0, 0.2, 0.15) * ph.b;
    float pa = clamp(max(ph.r, max(ph.g, ph.b)) * 0.9, 0.0, 0.85);
    vec4 fg = vec4(pc * pa, pa);
    res = fg + res * (1.0 - fg.a);
  }

  // туман войны
  if (u_fogOn > 0.5) {
    float fog = texture(u_fog, w / u_world).r;
    float k = mix(0.12, 1.0, smoothstep(0.1, 0.9, fog));
    if (under) {
      res.rgb *= k;
      if (under && res.a < 0.01 && fog < 0.5) res = vec4(vec3(0.02, 0.02, 0.03) * (1.0 - fog), (1.0 - fog) * 0.85);
    }
  }
  o = res;
}`;
