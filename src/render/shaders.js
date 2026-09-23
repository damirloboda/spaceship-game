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

// Single-scattering-ish atmosphere, raymarched against analytic spheres in the
// shell's object space. Works from space (front faces) and from inside (back).
export function createAtmosphereMaterial({ radius, top, color, density }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uR: { value: radius },
      uRa: { value: top },
      uH: { value: (top - radius) * 0.28 },
      uColor: { value: new THREE.Color(color[0], color[1], color[2]) },
      uDensity: { value: density },
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
      uniform vec3 uCam; uniform vec3 uSun; uniform float uR; uniform float uRa; uniform float uH;
      uniform vec3 uColor; uniform float uDensity; uniform float uStorm;
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
        const int STEPS = 10;
        float seg = (t1 - t0) / float(STEPS);
        float od = 0.0; vec3 sum = vec3(0.0); float lit = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 q = uCam + rd * (t0 + seg * (float(i) + 0.5));
          float hq = max(length(q) - uR, 0.0);
          float d = exp(-hq / uH) * seg / uH;
          od += d;
          float sunAmt = clamp(dot(normalize(q), uSun) * 3.0 + 0.25, 0.0, 1.0);
          float att = exp(-od * 0.22);
          sum += d * sunAmt * att;
          lit += d * sunAmt;
        }
        float mu = dot(rd, uSun);
        float phaseR = 0.75 * (1.0 + mu * mu);
        float phaseM = pow(max(mu, 0.0), 12.0) * 2.5 + pow(max(mu, 0.0), 3.0) * 0.3;
        vec3 sunset = vec3(1.0, 0.45, 0.2);
        float lowSun = 1.0 - clamp(abs(dot(normalize(uCam), uSun)) * 2.5, 0.0, 1.0);
        vec3 tint = mix(uColor, mix(uColor, sunset, 0.65), lowSun * 0.6);
        vec3 col = sum * uDensity * (tint * phaseR * 0.45 + vec3(1.0, 0.9, 0.75) * phaseM * 0.25);
        col = mix(col, vec3(dot(col, vec3(0.33))) * 0.6, uStorm);
        float litFrac = lit / max(od, 1e-4);
        float alpha = (1.0 - exp(-od * 0.5 * uDensity)) * mix(0.08, 0.92, litFrac) * (hitGround ? 0.55 : 1.0);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
        float d = smoothstep(1.0 - cov - 0.25, 1.0 - cov + 0.35, n * 0.5 + 0.5);
        if (d < 0.01) discard;
        float light = clamp(dot(vN, uSun) * 1.3 + 0.2, 0.03, 1.0);
        vec3 c = uColor * light * mix(1.0, 0.45, uStorm);
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

// Wave-perturbed water using the standard PBR pipeline (fog, shadows, lights).
export function createWaterMaterial(color = [0.03, 0.18, 0.3]) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: 0.86,
  });
  const uniforms = { uTime: { value: 0 } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWPos;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        vec3 wp = vWPos * 0.35;
        float w1 = sin(wp.x * 1.1 + uTime * 1.3) * cos(wp.z * 0.9 + uTime * 1.1);
        float w2 = sin(wp.x * 2.7 - uTime * 2.1 + wp.y * 1.9) * 0.5;
        float w3 = cos(wp.z * 3.3 + uTime * 1.7 + wp.y * 2.3) * 0.5;
        normal = normalize(normal + vec3(w1 + w2, w2 * w3, w3 - w1) * 0.06);
      `);
  };
  return mat;
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
