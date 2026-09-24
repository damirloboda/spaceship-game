// Custom shaders. All include log-depth chunks because the renderer uses a
// logarithmic depth buffer to cover centimetres to light-seconds.
import * as THREE from 'three';

export const V_HEAD = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const V_TAIL = /* glsl */`
#include <logdepthbuf_vertex>
`;
export const F_HEAD = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
`;
export const F_DEPTH = /* glsl */`
#include <logdepthbuf_fragment>
`;
export const F_TAIL = /* glsl */`
#include <tonemapping_fragment>
#include <colorspace_fragment>
`;

export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

// Physically based single scattering (Rayleigh + Mie), raymarched against
// analytic spheres in the shell's object space. Works from space (front
// faces) and from inside (back faces). Coefficients are expressed as zenith
// optical depths so tiny game planets get Earth-like skies: deep blue zenith,
// bright horizon, a sun disc and orange sunsets. The planet's atmosphere
// colour tints the Rayleigh spectrum (red-orange skies on dusty worlds).
export function atmosphereParams({ radius, top, color, density }) {
  const height = top - radius;
  const HR = height * 0.22, HM = height * 0.06;
  const mx = Math.max(color[0], color[1], color[2], 1e-3);
  const tau = color.map((c) => 0.265 * Math.pow(Math.max(c, 0.02) / mx, 1.6) * density);
  return {
    betaR: new THREE.Vector3(tau[0] / HR, tau[1] / HR, tau[2] / HR),
    betaM: (0.012 + 0.01 * Math.max(0, density - 0.8)) / HM,
    HR, HM,
  };
}

export function createAtmosphereMaterial({ radius, top, color, density, steps = 12, lightSteps = 4 }) {
  const P = atmosphereParams({ radius, top, color, density });
  return new THREE.ShaderMaterial({
    defines: { STEPS: steps, LSTEPS: lightSteps },
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uR: { value: radius },
      uRa: { value: top },
      uHR: { value: P.HR },
      uHM: { value: P.HM },
      uBetaR: { value: P.betaR },
      uBetaM: { value: P.betaM },
      uSunI: { value: 22 },
      uStorm: { value: 0 },
    },
    vertexShader: V_HEAD + /* glsl */`
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        ${V_TAIL}
      }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform vec3 uCam; uniform vec3 uSun; uniform float uR; uniform float uRa;
      uniform float uHR; uniform float uHM; uniform vec3 uBetaR; uniform float uBetaM;
      uniform float uSunI; uniform float uStorm;
      varying vec3 vPos;
      vec2 rs(vec3 ro, vec3 rd, float r){ float b=dot(ro,rd); float c=dot(ro,ro)-r*r; float h=b*b-c; if(h<0.0) return vec2(1e20,-1e20); h=sqrt(h); return vec2(-b-h,-b+h); }
      void main(){
        ${F_DEPTH}
        vec3 rd = normalize(vPos - uCam);
        vec2 a = rs(uCam, rd, uRa);
        float t0 = max(a.x, 0.0);
        float t1 = a.y;
        vec2 p = rs(uCam, rd, uR);
        bool hitGround = p.x > 0.0;
        if (hitGround) t1 = min(t1, p.x);
        if (t1 <= t0) discard;
        float seg = (t1 - t0) / float(STEPS);
        vec3 sumR = vec3(0.0), sumM = vec3(0.0);
        float odR = 0.0, odM = 0.0;
        vec3 betaM3 = vec3(uBetaM * 1.1);
        for (int i = 0; i < STEPS; i++) {
          vec3 q = uCam + rd * (t0 + seg * (float(i) + 0.5));
          float h = max(length(q) - uR, 0.0);
          float dR = exp(-h / uHR) * seg, dM = exp(-h / uHM) * seg;
          odR += dR; odM += dM;
          vec2 ls = rs(q, uSun, uRa);
          float lseg = max(ls.y, 0.0) / float(LSTEPS);
          float lR = 0.0, lM = 0.0; bool shadow = false;
          for (int j = 0; j < LSTEPS; j++) {
            vec3 lq = q + uSun * lseg * (float(j) + 0.5);
            float lh = length(lq) - uR;
            if (lh < 0.0) { shadow = true; break; }
            lR += exp(-lh / uHR) * lseg; lM += exp(-lh / uHM) * lseg;
          }
          if (!shadow) {
            vec3 att = exp(-(uBetaR * (odR + lR) + betaM3 * (odM + lM)));
            sumR += att * dR; sumM += att * dM;
          }
        }
        float mu = dot(rd, uSun);
        float phaseR = 0.0597 * (1.0 + mu * mu);
        const float g = 0.78;
        float phaseM = 0.1194 * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
        vec3 col = uSunI * (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM);
        vec3 T = exp(-(uBetaR * odR + betaM3 * odM));
        if (!hitGround) col += smoothstep(0.99955, 0.9998, mu) * T * uSunI * 6.0;
        col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.55, uStorm);
        float alpha = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0);
        if (!hitGround) alpha = max(alpha, clamp(dot(col, vec3(0.5)), 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
        ${F_TAIL}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.FrontSide,
  });
}

// CPU version of the sky model above: colour of the sky along `dir` seen
// from `cam` (both in the atmosphere's object space). Used for fog so distant
// terrain melts into exactly the sky behind it.
const _q = new THREE.Vector3(), _lq = new THREE.Vector3();
function raySphere(ro, rd, r) {
  const b = ro.dot(rd), c = ro.lengthSq() - r * r, h = b * b - c;
  if (h < 0) return [1e20, -1e20];
  const s = Math.sqrt(h);
  return [-b - s, -b + s];
}
export function atmosphereColor(u, cam, dir, out = new THREE.Color(), steps = 8, lsteps = 3) {
  const R = u.uR.value, Ra = u.uRa.value, HR = u.uHR.value, HM = u.uHM.value, bR = u.uBetaR.value, bM = u.uBetaM.value * 1.1;
  const sun = u.uSun.value;
  const a = raySphere(cam, dir, Ra);
  const t0 = Math.max(a[0], 0);
  let t1 = a[1];
  const p = raySphere(cam, dir, R);
  if (p[0] > 0) t1 = Math.min(t1, p[0]);
  if (t1 <= t0) return out.setRGB(0, 0, 0);
  const seg = (t1 - t0) / steps;
  let sr = 0, sg = 0, sb = 0, mr = 0, mg = 0, mb = 0, odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    _q.copy(cam).addScaledVector(dir, t0 + seg * (i + 0.5));
    const h = Math.max(_q.length() - R, 0);
    const dR = Math.exp(-h / HR) * seg, dM = Math.exp(-h / HM) * seg;
    odR += dR; odM += dM;
    const ls = raySphere(_q, sun, Ra);
    const lseg = Math.max(ls[1], 0) / lsteps;
    let lR = 0, lM = 0, shadow = false;
    for (let j = 0; j < lsteps; j++) {
      _lq.copy(_q).addScaledVector(sun, lseg * (j + 0.5));
      const lh = _lq.length() - R;
      if (lh < 0) { shadow = true; break; }
      lR += Math.exp(-lh / HR) * lseg; lM += Math.exp(-lh / HM) * lseg;
    }
    if (shadow) continue;
    const tR = odR + lR, tM = (odM + lM) * bM;
    const ar = Math.exp(-(bR.x * tR + tM)), ag = Math.exp(-(bR.y * tR + tM)), ab = Math.exp(-(bR.z * tR + tM));
    sr += ar * dR; sg += ag * dR; sb += ab * dR;
    mr += ar * dM; mg += ag * dM; mb += ab * dM;
  }
  const mu = dir.dot(sun);
  const phaseR = 0.0597 * (1 + mu * mu);
  const g = 0.78;
  const phaseM = 0.1194 * ((1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const I = u.uSunI.value, m = u.uBetaM.value * phaseM;
  return out.setRGB(I * (sr * bR.x * phaseR + mr * m), I * (sg * bR.y * phaseR + mg * m), I * (sb * bR.z * phaseR + mb * m));
}

export function createCloudMaterial({ color = [1, 1, 1], octaves = 3, coverage = 0.5 }) {
  return new THREE.ShaderMaterial({
    defines: { OCTAVES: Math.max(1, Math.min(5, octaves)) },
    uniforms: {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
      uCoverage: { value: coverage },
      uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
      uStorm: { value: 0 },
      uFade: { value: 1 },
    },
    vertexShader: V_HEAD + /* glsl */`
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main(){
        vPos = normalize(position);
        vN = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
        ${V_TAIL}
      }`,
    fragmentShader: F_HEAD + NOISE_GLSL + /* glsl */`
      uniform vec3 uSun; uniform float uTime; uniform float uCoverage; uniform vec3 uColor; uniform float uStorm; uniform float uFade;
      varying vec3 vPos; varying vec3 vN; varying vec3 vView;
      void main(){
        ${F_DEPTH}
        vec3 p = vPos * 6.0 + vec3(uTime * 0.004, 0.0, uTime * 0.0025);
        float n = 0.0; float amp = 0.55; float f = 1.0;
        for (int i = 0; i < OCTAVES; i++) { n += snoise(p * f) * amp; f *= 2.3; amp *= 0.5; }
        float cov = mix(uCoverage, 0.95, uStorm);
        // Distinct cloud masses with clear sky between them, so land and sea
        // read from orbit; fine noise erodes the edges into wisps.
        float erode = snoise(p * 9.0 + 3.1) * 0.08;
        float d = smoothstep(1.0 - cov - 0.06, 1.0 - cov + 0.2, n * 0.5 + 0.5 + erode);
        if (d < 0.01) discard;
        float light = clamp(dot(vN, uSun) * 1.3 + 0.2, 0.03, 1.0);
        // Thin edges are bright, thick cores a touch darker (self-shadowing).
        vec3 c = uColor * light * mix(1.0, 0.45, uStorm) * mix(1.05, 0.82, d * d);
        float rim = clamp(dot(vN, uSun), 0.0, 1.0);
        c += vec3(1.0, 0.55, 0.3) * pow(1.0 - abs(dot(vN, uSun)), 8.0) * 0.3 * step(0.0, dot(vN, uSun) + 0.2);
        gl_FragColor = vec4(c, d * 0.85 * uFade);
        ${F_TAIL}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createRingMaterial({ inner, outer, color, planetRadius, seed = 1 }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: inner },
      uOuter: { value: outer },
      uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uR: { value: planetRadius },
      uSeed: { value: seed % 1000 },
    },
    vertexShader: V_HEAD + /* glsl */`
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uInner; uniform float uOuter; uniform vec3 uColor; uniform vec3 uSun; uniform float uR; uniform float uSeed;
      varying vec3 vPos;
      float h1(float x){ return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
      float n1(float x){ float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){
        ${F_DEPTH}
        float r = length(vPos.xy);
        float t = (r - uInner) / (uOuter - uInner);
        if (t < 0.0 || t > 1.0) discard;
        float bands = n1(t * 40.0) * 0.6 + n1(t * 160.0) * 0.3 + n1(t * 700.0) * 0.1;
        float edge = smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.9, t);
        float gap = smoothstep(0.02, 0.0, abs(t - 0.62)) ;
        float a = clamp(bands * 1.2 - 0.15, 0.0, 1.0) * edge * (1.0 - gap * 0.9);
        // Planet shadow: does the ray towards the sun hit the planet?
        vec3 p = vPos; vec3 L = normalize(uSun);
        float b = dot(p, L); float c = dot(p, p) - uR * uR; float h = b * b - c;
        float shadow = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.12 : 1.0;
        vec3 col = uColor * (0.55 + bands * 0.6) * shadow;
        gl_FragColor = vec4(col, a * 0.9);
        ${F_TAIL}
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Animated ocean: vertex waves (displaced along the planet normal, fading
// with distance), analytic wave normals, fine ripples and PBR reflections.
// Tileable ripple normal map built from integer-frequency sine waves.
let rippleTex = null;
function rippleNormalTexture(size = 256) {
  if (rippleTex) return rippleTex;
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((rnd() * 2 - 1) * (2 + i * 0.7)), ky = Math.round((rnd() * 2 - 1) * (2 + i * 0.7));
    if (!kx && !ky) continue;
    waves.push({ kx, ky, a: 1 / (1 + Math.hypot(kx, ky) * 0.6), p: rnd() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const ph = (2 * Math.PI * (w.kx * x + w.ky * y)) / size + w.p;
        const c = Math.cos(ph) * w.a;
        dx += c * w.kx; dy += c * w.ky;
      }
      const n = new THREE.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
      const o = (y * size + x) * 4;
      data[o] = (n.x * 0.5 + 0.5) * 255; data[o + 1] = (n.y * 0.5 + 0.5) * 255; data[o + 2] = (n.z * 0.5 + 0.5) * 255; data[o + 3] = 255;
    }
  }
  rippleTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping;
  rippleTex.magFilter = THREE.LinearFilter;
  rippleTex.minFilter = THREE.LinearMipmapLinearFilter;
  rippleTex.generateMipmaps = true;
  rippleTex.anisotropy = 8;
  rippleTex.needsUpdate = true;
  return rippleTex;
}

// Ocean: 6 Gerstner-style waves in the vertex shader, two scrolling ripple
// normal layers, depth-based absorption (turquoise shallows, deep blue),
// see-through shallows, shore and crest foam, sun-lit subsurface glow on
// wave crests and PBR sun glints / sky reflections from the standard model.
export function createWaterMaterial(color = [0.02, 0.14, 0.26]) {
  const deep = new THREE.Color(color[0], color[1], color[2]);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.035,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
    envMapIntensity: 0.25,
  });
  const uniforms = {
    uTime: { value: 0 },
    uRipple: { value: rippleNormalTexture() },
    uDeep: { value: deep },
    uShallow: { value: new THREE.Color(0.05, 0.42, 0.44).lerp(deep, 0.25) },
    uSunL: { value: new THREE.Vector3(0, 1, 0) },
    uCamL: { value: new THREE.Vector3() },
    uDay: { value: 1 },
    uSkyH: { value: new THREE.Color(0.6, 0.75, 0.9) },
    uSkyZ: { value: new THREE.Color(0.15, 0.35, 0.8) },
    uSunC: { value: new THREE.Color(1, 0.95, 0.85) },
  };
  mat.userData.uniforms = uniforms;
  const WAVES = /* glsl */`
    const int NW = 6;
    vec3 waveDir(int i) {
      if (i == 0) return normalize(vec3(0.8, 0.3, 0.5));
      if (i == 1) return normalize(vec3(-0.4, 0.7, 0.6));
      if (i == 2) return normalize(vec3(0.2, -0.6, 0.9));
      if (i == 3) return normalize(vec3(-0.9, -0.2, 0.3));
      if (i == 4) return normalize(vec3(0.5, 0.8, -0.3));
      return normalize(vec3(-0.3, -0.9, -0.4));
    }
    float waveK(int i) { return i == 0 ? 0.09 : i == 1 ? 0.14 : i == 2 ? 0.23 : i == 3 ? 0.37 : i == 4 ? 0.61 : 0.97; }
    float waveA(int i) { return i == 0 ? 0.6 : i == 1 ? 0.38 : i == 2 ? 0.2 : i == 3 ? 0.11 : i == 4 ? 0.055 : 0.03; }
  `;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute vec3 lpos;
        attribute float wdepth;
        varying vec3 vWPos;
        varying float vCrest;
        varying float vDepth;
        varying vec3 vWN;
        ${WAVES}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 wN = normalize(objectNormal);
        float wAmp = (1.0 - smoothstep(150.0, 900.0, length((modelViewMatrix * vec4(position, 1.0)).xyz)));
        // Waves calm down in the shallows so they break at the shore.
        wAmp *= smoothstep(-0.5, 4.0, wdepth) * 0.8 + 0.2;
        vec3 wGrad = vec3(0.0);
        vec3 wSide = vec3(0.0);
        float wH = 0.0;
        for (int i = 0; i < NW; i++) {
          vec3 d = waveDir(i);
          d = normalize(d - wN * dot(d, wN));
          float k = waveK(i);
          float ph = dot(lpos, d) * k + uTime * sqrt(9.8 * k) * 1.1;
          float a = waveA(i);
          wH += a * sin(ph);
          wGrad += a * k * cos(ph) * d;
          wSide += d * (a * 0.55) * cos(ph); // Gerstner: points bunch at crests
        }
        wH *= wAmp; wGrad *= wAmp; wSide *= wAmp;
        objectNormal = normalize(wN - wGrad);
        vWN = objectNormal;
        vCrest = smoothstep(0.35, 1.0, wH);
        vDepth = wdepth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += wN * wH + wSide;`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = lpos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform sampler2D uRipple; uniform vec3 uDeep; uniform vec3 uShallow;
        uniform vec3 uSunL; uniform vec3 uCamL; uniform float uDay;
        uniform vec3 uSkyH; uniform vec3 uSkyZ; uniform vec3 uSunC;
        uniform mat3 normalMatrix;
        vec3 wNL;
        varying vec3 vWPos; varying float vCrest; varying float vDepth; varying vec3 vWN;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Planar coordinates on the local tangent plane for ripples and foam.
        vec3 wUp = normalize(vWPos);
        vec3 wT = normalize(cross(abs(wUp.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), wUp));
        vec3 wB = cross(wUp, wT);
        // Planar coordinates from fixed axes (the dominant one is dropped).
        vec3 wA = abs(wUp);
        vec2 wUV = wA.y > max(wA.x, wA.z) ? vWPos.xz : wA.x > wA.z ? vWPos.zy : vWPos.xy;
        float wDist = length(vViewPosition);
        vec3 V = normalize(uCamL - vWPos);
        float depth = max(vDepth, 0.0);
        // Absorption: light fades through water, turquoise first, then deep blue.
        float shallowK = exp(-depth * 0.22);
        vec3 waterCol = mix(uDeep, uShallow, shallowK);
        // Subsurface glow where sunlight passes through wave crests.
        float sunBack = pow(max(dot(-V, uSunL) * 0.5 + 0.5, 0.0), 3.0);
        vec3 sss = uShallow * 0.9 * (vCrest * 0.9 + 0.04) * (0.25 + sunBack * 1.2) * uDay;
        // Foam: breaking crests and bands washing onto the shore.
        float n1 = wNoise(wUV * 0.35 + uTime * 0.07), n2 = wNoise(wUV * 1.3 - uTime * 0.11);
        float crestFoam = smoothstep(0.6, 1.0, vCrest + (n1 - 0.5) * 0.5) * 0.55;
        float shore = 1.0 - smoothstep(0.0, 2.2, vDepth);
        float bands = smoothstep(0.55, 0.95, sin(vDepth * 5.0 - uTime * 1.4 + n1 * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 1.6, vDepth));
        float edge = 1.0 - smoothstep(0.0, 0.35, vDepth);
        // Wind-driven foam streaks drift across open water: the sea visibly flows.
        vec2 flow = vec2(0.8, 0.6);
        vec2 sUV = vec2(dot(wUV, flow), dot(wUV, vec2(-flow.y, flow.x)));
        float drift = wNoise(vec2(sUV.x * 0.012 - uTime * 0.05, sUV.y * 0.06)) * wNoise(vec2(sUV.x * 0.03 - uTime * 0.09, sUV.y * 0.15 + 3.0));
        float streak = smoothstep(0.42, 0.7, drift) * smoothstep(1.5, 6.0, depth) * (1.0 - smoothstep(250.0, 700.0, wDist)) * 0.4;
        float foam = clamp(max(max(crestFoam, streak * (0.4 + n2)), (bands * 0.9 + edge) * shore) * (0.55 + n2 * 0.6), 0.0, 1.0);
        // Water's own albedo is dark: its colour comes from absorption, the
        // sea floor showing through and reflections.
        diffuseColor.rgb = mix(waterCol * 0.1, vec3(0.93, 0.97, 1.0), foam);
        // Deep water is opaque; shallows show the sea floor; foam is solid.
        float fres = pow(1.0 - clamp(dot(V, normalize(vWN)), 0.0, 1.0), 5.0);
        diffuseColor.a = clamp(mix(0.96, 0.3, shallowK) + fres * 0.35 + foam, 0.0, 1.0);
        diffuseColor.a *= smoothstep(-0.25, 0.05, vDepth) * 0.9 + 0.1;
        totalEmissiveRadiance += sss * (1.0 - foam);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, foam);`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          float rf = 1.0 - smoothstep(30.0, 400.0, wDist);
          vec3 r1 = texture2D(uRipple, wUV * 0.11 + vec2(uTime * 0.021, uTime * 0.013)).xyz * 2.0 - 1.0;
          vec3 r2 = texture2D(uRipple, wUV * 0.37 - vec2(uTime * 0.034, -uTime * 0.027)).xyz * 2.0 - 1.0;
          vec3 r3 = texture2D(uRipple, wUV * 0.023 + vec2(-uTime * 0.006, uTime * 0.009)).xyz * 2.0 - 1.0;
          vec3 r4 = texture2D(uRipple, wUV * 0.0061 + vec2(uTime * 0.0023, -uTime * 0.0017)).xyz * 2.0 - 1.0;
          vec2 slope = (r1.xy * 0.8 + r2.xy * 0.5) * rf + r3.xy * 0.55 + r4.xy * 0.45;
          // Far away the ripples average out (no sub-pixel sparkle).
          slope *= mix(1.0, 0.3, smoothstep(400.0, 3000.0, wDist));
          vec3 nL = normalize(normalize(vWN) - (wT * slope.x + wB * slope.y) * (1.0 - foam * 0.7));
          wNL = nL;
          normal = normalize(normalMatrix * nL);
        }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // Mirror of the real sky (same colours as the atmosphere) with
          // Fresnel, plus a glittering sun path.
          vec3 R = reflect(-V, wNL);
          float ru = max(dot(R, wUp), 0.0);
          vec3 skyR = mix(uSkyH * 0.8, uSkyZ, pow(ru, 0.35));
          // Microfacet shadowing keeps rough water from mirroring at grazing angles.
          float F = 0.02 + 0.68 * pow(1.0 - max(dot(V, wNL), 0.0), 5.0);
          float sd = max(dot(R, uSunL), 0.0);
          // Sharp glitter up close; a soft sun path in the distance (the sharp
          // lobe aliases into blocky sparkles through bloom far away).
          float gNear = 1.0 - smoothstep(150.0, 1200.0, wDist);
          float glint = pow(sd, 1200.0) * 90.0 * gNear + pow(sd, 90.0) * mix(0.8, 2.0, gNear) + pow(sd, 12.0) * 0.12;
          totalEmissiveRadiance += (skyR * F + uSunC * glint * (0.25 + F)) * (1.0 - foam) * (1.0 - smoothstep(-0.2, 0.3, -vDepth));
        }`);
  };
  mat.customProgramCacheKey = () => 'ocean-waves-v2';
  return mat;
}

// Engine exhaust plume: bright core fading along its length, flickering.
export function createExhaustMaterial(color = [0.35, 0.7, 1.0]) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0.3 }, uColor: { value: new THREE.Color(...color) } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uTime; uniform float uPower; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        ${F_DEPTH}
        float along = vUv.y;            // 1 at the nozzle, 0 at the tip
        float edge = pow(abs(dot(vN, vV)), 1.5);
        float flick = 0.85 + 0.15 * sin(uTime * 60.0 + along * 20.0) * sin(uTime * 37.0);
        float bands = 0.75 + 0.25 * sin(along * 40.0 - uTime * 50.0);
        float a = pow(along, 1.8) * edge * flick * uPower * bands;
        vec3 core = mix(uColor, vec3(1.0), pow(along, 5.0));
        gl_FragColor = vec4(core * a * 3.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function createStarGlowMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color[0], color[1], color[2]) }, uIntensity: { value: 1 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform vec3 uColor; uniform float uIntensity; varying vec2 vUv;
      void main(){
        ${F_DEPTH}
        float d = length(vUv - 0.5) * 2.0;
        float g = pow(max(1.0 - d, 0.0), 3.0) * 1.2 + pow(max(1.0 - d, 0.0), 12.0) * 4.0;
        float rays = pow(max(0.0, 1.0 - abs((vUv.x - 0.5) * (vUv.y - 0.5)) * 400.0), 4.0) * (1.0 - d) * 0.6;
        gl_FragColor = vec4(uColor * (g + rays) * uIntensity, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createBlackHoleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uTime; varying vec2 vUv;
      void main(){
        ${F_DEPTH}
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        float disk = smoothstep(0.28, 0.34, r) * smoothstep(1.0, 0.45, r);
        float swirl = 0.5 + 0.5 * sin(ang * 6.0 - uTime * 0.7 + r * 30.0);
        vec3 hot = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.9, 0.7), swirl * (1.0 - r));
        float ring = exp(-pow((r - 0.31) * 60.0, 2.0)) * 2.5;
        vec3 col = hot * disk * (0.6 + swirl * 0.8) + vec3(1.0, 0.8, 0.6) * ring;
        float a = clamp(disk + ring, 0.0, 1.0);
        if (r < 0.29) { col = vec3(0.0); a = 1.0; }
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createWormholeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; ${V_TAIL} }`,
    fragmentShader: F_HEAD + NOISE_GLSL + /* glsl */`
      uniform float uTime; varying vec3 vN; varying vec3 vV;
      void main(){
        ${F_DEPTH}
        float f = 1.0 - abs(dot(vN, vV));
        float n = snoise(vN * 3.0 + vec3(uTime * 0.3));
        vec3 c = mix(vec3(0.4, 0.1, 0.9), vec3(0.2, 0.9, 1.0), n * 0.5 + 0.5);
        float core = pow(1.0 - f, 4.0);
        gl_FragColor = vec4(c * (pow(f, 2.0) * 2.0 + core * 1.5), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Energy field around the ship during Overdrive / Lightbreak.
export function createFieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.8, 1.0) } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; ${V_TAIL} }`,
    fragmentShader: F_HEAD + NOISE_GLSL + /* glsl */`
      uniform float uTime; uniform float uIntensity; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        ${F_DEPTH}
        float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
        float n = snoise(vP * 0.15 + vec3(0.0, 0.0, uTime * 4.0)) * 0.5 + 0.5;
        float a = f * (0.4 + n * 0.8) * uIntensity;
        gl_FragColor = vec4(uColor * a * 1.5, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// Final colour grade in display space: filmic contrast, saturation, warm
// highlights / cool shadows, vignette and fine grain.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.28 },
    uSaturation: { value: 1.14 },
    uContrast: { value: 0.22 },
    uGrain: { value: 0.016 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes;
    uniform float uVignette; uniform float uSaturation; uniform float uContrast; uniform float uGrain;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c += vec3(0.028, 0.014, -0.02) * smoothstep(0.45, 1.0, l) + vec3(-0.012, 0.0, 0.022) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
      c *= mix(1.0 - uVignette, 1.0, smoothstep(0.95, 0.3, length(d)));
      float n = fract(sin(dot(vUv * uRes + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
