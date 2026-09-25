/** Небо: время суток, солнце/луна, звёзды, облака по ветру, дождь; внутри дома — обои и тёплый свет лампы. */
export const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_res;
uniform vec2 u_world;
uniform float u_time;
uniform float u_tod;
uniform float u_light;
uniform float u_cloud;
uniform float u_rain;
uniform float u_fog;
uniform float u_wind;
uniform float u_thunder;
uniform vec2 u_indoor;
uniform float u_groundY;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; } return s; }

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 w = u_cam + vec2(px.x - u_res.x * 0.5, u_res.y * 0.5 - px.y) / u_zoom;
  if (w.y > u_world.y || w.x < 0.0 || w.x > u_world.x) { o = vec4(0.03, 0.025, 0.02, 1.0); return; }
  // внутри дома — обои и свет лампы
  if (w.x >= u_indoor.x && w.x < u_indoor.y && w.y > 0.0) {
    float stripe = step(0.5, fract(w.x / 18.0));
    vec3 wall = mix(vec3(0.62, 0.55, 0.45), vec3(0.58, 0.5, 0.42), stripe);
    wall *= 0.9 + 0.1 * vnoise(w * 0.05);
    float lamp = exp(-length((w - vec2((u_indoor.x + u_indoor.y) * 0.5, 30.0)) / vec2(400.0, 300.0)));
    wall *= 0.45 + 0.6 * lamp;
    o = vec4(wall, 1.0);
    return;
  }
  // параллакс-небо: высота на экране
  float sy = clamp((u_groundY - w.y) / 400.0, -0.2, 1.2);
  float day = u_light;
  vec3 zenith = mix(vec3(0.02, 0.03, 0.08), vec3(0.24, 0.48, 0.82), day);
  vec3 horizon = mix(vec3(0.06, 0.06, 0.12), vec3(0.72, 0.84, 0.94), day);
  // закат/рассвет
  float dusk = exp(-pow((u_tod - 0.77) / 0.04, 2.0)) + exp(-pow((u_tod - 0.24) / 0.04, 2.0));
  horizon = mix(horizon, vec3(0.95, 0.55, 0.3), dusk * 0.7);
  vec3 col = mix(horizon, zenith, clamp(sy, 0.0, 1.0));
  // облачность серит небо
  col = mix(col, vec3(0.5, 0.52, 0.56) * (0.3 + day * 0.7), u_cloud * 0.55);
  // звёзды
  vec2 sp = floor(px / 2.0);
  float star = step(0.9975, h21(sp + floor(u_cam * 0.02))) * (1.0 - day) * (1.0 - u_cloud);
  col += star * (0.6 + 0.4 * sin(u_time * 3.0 + h21(sp) * 30.0));
  // солнце и луна движутся по дуге
  float ang = (u_tod - 0.25) * 6.2831;
  vec2 sunScreen = vec2(0.5 + 0.42 * cos(ang + 3.1416), 0.18 + 0.55 * (1.0 - sin(ang))) * u_res;
  sunScreen.y = u_res.y - sunScreen.y;
  vec2 moonScreen = vec2(0.5 + 0.42 * cos(ang), 0.18 + 0.55 * (1.0 + sin(ang))) * u_res;
  moonScreen.y = u_res.y - moonScreen.y;
  float ds = length(px - sunScreen) / u_res.y;
  col += vec3(1.0, 0.9, 0.7) * (smoothstep(0.035, 0.03, ds) + 0.35 * exp(-ds * 8.0)) * (1.0 - u_cloud * 0.8);
  float dm = length(px - moonScreen) / u_res.y;
  col += vec3(0.8, 0.85, 1.0) * smoothstep(0.025, 0.022, dm) * (1.0 - day) * (1.0 - u_cloud * 0.8);
  // облака
  vec2 cp = vec2(w.x * 0.004 + u_time * 0.004 * (0.3 + u_wind), w.y * 0.01);
  float cl = fbm(cp * 3.0 + vec2(0.0, 7.0));
  float cloudMask = smoothstep(0.55 - u_cloud * 0.3, 0.8, cl) * clamp(sy * 1.5, 0.0, 1.0);
  vec3 cloudCol = mix(vec3(0.3, 0.32, 0.38), vec3(0.95, 0.96, 1.0), day) * (0.75 + 0.25 * cl);
  col = mix(col, cloudCol, cloudMask * 0.85);
  // далёкие силуэты: огромные стебли травы сада (масштаб: муравей в 1 клетку)
  float farx = w.x * 0.35 + u_cam.x * 0.65;
  float blade = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float xx = farx / (40.0 + fk * 25.0);
    float id = floor(xx);
    float hgt = 120.0 + 260.0 * h21(vec2(id, fk));
    float cx = fract(xx) - 0.5 + 0.2 * sin(u_time * 0.3 + id) * u_wind;
    float wdt = 0.06 + 0.05 * h21(vec2(id, fk + 3.0));
    float top = u_groundY - hgt;
    if (w.y > top) blade = max(blade, smoothstep(wdt, wdt * 0.6, abs(cx)) * (0.25 + fk * 0.12));
  }
  vec3 silh = mix(vec3(0.05, 0.08, 0.06), vec3(0.3, 0.45, 0.3), day) * 0.8;
  col = mix(col, silh, blade * (1.0 - u_fog * 0.6) * smoothstep(1.5, 5.0, u_zoom));
  // туман
  col = mix(col, vec3(0.7, 0.72, 0.75) * (0.3 + day * 0.7), u_fog * 0.6);
  // дождь: косые штрихи
  if (u_rain > 0.01) {
    vec2 rp = px + vec2(u_wind * 80.0 * (px.y / u_res.y), 0.0);
    float lane = floor(rp.x / 7.0);
    float speed = 900.0 + 400.0 * h21(vec2(lane, 1.0));
    float yy = fract((rp.y + u_time * speed + h21(vec2(lane, 2.0)) * 1000.0) / 90.0);
    float drop = smoothstep(0.0, 0.02, yy) * smoothstep(0.18, 0.02, yy) * step(1.0 - u_rain * 0.7, h21(vec2(lane, floor((rp.y + u_time * speed) / 90.0))));
    drop *= smoothstep(1.2, 0.2, abs(fract(rp.x / 7.0) - 0.5) * 7.0);
    col = mix(col, vec3(0.75, 0.8, 0.9), drop * 0.35);
  }
  col += vec3(0.8, 0.85, 1.0) * u_thunder * 0.5;
  o = vec4(col, 1.0);
}`;
