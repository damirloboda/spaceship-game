// Deep-space backdrop: procedural Milky Way texture, point stars that follow
// the camera, and Overdrive/Lightbreak star-streak effects.
import * as THREE from 'three';
import { Noise3 } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { V_HEAD, V_TAIL, F_HEAD, F_DEPTH, NOISE_GLSL } from './shaders.js';

export function createGalaxyBackground(seed = 7, width = 1024) {
  const height = width / 2;
  const data = new Uint8Array(width * height * 4);
  const n = new Noise3(seed);
  for (let y = 0; y < height; y++) {
    const lat = (y / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
      // Galactic plane tilted relative to the system.
      const gy = dy * 0.9 + dx * 0.43;
      const band = Math.exp(-gy * gy * 14);
      const neb = n.fbm(dx * 2.5, dy * 2.5, dz * 2.5, 4) * 0.5 + 0.5;
      const dust = n.fbm(dx * 6 + 3, dy * 6, dz * 6, 3);
      const k = band * (0.5 + neb * 0.9) * (1 - Math.max(0, dust) * 0.8 * band);
      const hue = n.noise(dx * 1.3 + 9, dy * 1.3, dz * 1.3);
      const i = (y * width + x) * 4;
      const r = k * (0.22 + hue * 0.08) + neb * 0.012;
      const g = k * 0.17 + neb * 0.01;
      const b = k * (0.3 - hue * 0.06) + neb * 0.025;
      data[i] = Math.min(255, r * 255);
      data[i + 1] = Math.min(255, g * 255);
      data[i + 2] = Math.min(255, b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// High-resolution galaxy backdrop rendered once on the GPU into a cube
// map: the Milky Way band with a bright core and dark dust lanes, coloured
// emission nebulae, and thousands of faint background stars.
export function renderGalaxyCube(renderer, size = 1024, seed = 7) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSeed: { value: seed * 1.37 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: NOISE_GLSL + /* glsl */`
      uniform float uSeed; varying vec3 vDir;
      float fbm(vec3 p, int oct){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ if (i >= oct) break; s += snoise(p) * a; p *= 2.07; a *= 0.5; } return s; }
      float ridged(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += (1.0 - abs(snoise(p))) * a; p *= 2.13; a *= 0.5; } return s; }
      float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      // Point-like stars from a jittered 3D grid.
      float stars(vec3 d, float scale, float density, float rad){
        vec3 p = d * scale; vec3 c = floor(p); vec3 f = fract(p) - 0.5;
        float h = hash(c + uSeed);
        if (h < 1.0 - density) return 0.0;
        vec3 o = vec3(hash(c + 1.3), hash(c + 2.7), hash(c + 4.1)) - 0.5;
        float r = length(f - o * 0.7);
        return smoothstep(rad, 0.0, r) * (0.3 + 0.7 * hash(c + 9.9));
      }
      void main(){
        vec3 d = normalize(vDir);
        vec3 sp = d * 2.0 + uSeed;
        // Galactic plane tilted against the system; the core sits in it.
        vec3 nrm = normalize(vec3(-0.43, 0.9, 0.0));
        vec3 core = normalize(vec3(0.9, 0.43, 0.25));
        float gy = dot(d, nrm);
        float warp = fbm(sp * 1.5, 4) * 0.08;
        float band = exp(-pow(gy + warp, 2.0) * 38.0);
        float wide = exp(-pow(gy + warp, 2.0) * 8.0);
        float toCore = acos(clamp(dot(d, core), -1.0, 1.0));
        float bulge = exp(-toCore * toCore * 2.2) * exp(-gy * gy * 14.0);
        float clouds = fbm(sp * 3.0, 6) * 0.5 + 0.5;
        // Dust: a dark rift along the middle of the band plus soft patches.
        float riftW = 0.035 + fbm(sp * 2.0 + 4.0, 3) * 0.02;
        float rift = exp(-pow((gy + warp * 0.6 + fbm(sp * 3.5, 3) * 0.02) / riftW, 2.0));
        float patches = smoothstep(0.05, 0.45, fbm(sp * 2.6 + 7.0, 5));
        float lanes = clamp(rift * (0.55 + patches * 0.45) + patches * band * 0.35, 0.0, 1.0);
        float light = (band * (0.3 + clouds * 0.8) + wide * 0.1 + bulge * 0.8) * (1.0 - lanes * 0.8);
        vec3 coreCol = vec3(1.0, 0.82, 0.62), armCol = vec3(0.62, 0.72, 1.0);
        vec3 col = mix(armCol, coreCol, clamp(bulge * 1.6 + clouds * 0.25, 0.0, 1.0)) * light * 0.2;
        // Emission nebulae: pink hydrogen and teal oxygen clouds near the band.
        float nb1 = smoothstep(0.35, 0.8, fbm(sp * 1.2 + 11.0, 5) * 0.5 + 0.5) * wide;
        float nb2 = smoothstep(0.45, 0.85, fbm(sp * 1.7 - 5.0, 5) * 0.5 + 0.5) * wide;
        float wisps = fbm(sp * 6.0 + 3.0, 4) * 0.5 + 0.5;
        col += vec3(0.9, 0.25, 0.45) * nb1 * wisps * 0.16 + vec3(0.15, 0.6, 0.7) * nb2 * wisps * 0.1;
        // Unresolved star clouds sparkle along the band.
        float grain = pow(clamp(snoise(d * 180.0 + uSeed) * 0.5 + 0.5, 0.0, 1.0), 6.0) * band;
        col += vec3(1.0, 0.95, 0.9) * grain * 0.18 * (1.0 - lanes);
        // Faint background stars, denser in the band.
        float st = stars(d, 300.0, 0.06 + band * 0.18, 0.22) + stars(d, 150.0, 0.035, 0.15) * 1.5;
        vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash(floor(d * 300.0)));
        col += tint * st * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const rt = new THREE.WebGLCubeRenderTarget(size, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(renderer, scene);
  scene.children[0].geometry.dispose();
  mat.dispose();
  return rt.texture;
}

export function createStarfield(count = 7000, seed = 3) {
  const rng = new RNG(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const R = 4e8;
  for (let i = 0; i < count; i++) {
    let x, y, z;
    // Half the stars cluster in the galactic band.
    if (i % 2) {
      const a = rng.range(0, Math.PI * 2);
      const off = (rng.next() - 0.5) * 0.35;
      x = Math.cos(a); z = Math.sin(a); y = off;
      // tilt to match background band
      const tx = x * 0.9 - y * 0.43, ty = x * 0.43 + y * 0.9;
      x = tx; y = ty;
    } else {
      y = rng.range(-1, 1);
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(1 - y * y);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    const l = Math.hypot(x, y, z);
    pos[i * 3] = (x / l) * R; pos[i * 3 + 1] = (y / l) * R; pos[i * 3 + 2] = (z / l) * R;
    const t = rng.next();
    const c = t < 0.15 ? [1, 0.7, 0.5] : t < 0.3 ? [0.7, 0.8, 1] : [1, 1, 1];
    const b = Math.pow(rng.next(), 3) * 0.9 + 0.1;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    size[i] = rng.next() < 0.02 ? rng.range(2.0, 3.0) : rng.range(0.8, 1.7);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uFade: { value: 1 } },
    vertexShader: V_HEAD + /* glsl */`
      attribute float size; attribute vec3 color; varying vec3 vC; uniform float uPixelRatio;
      void main(){ vC = color; gl_PointSize = size * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      varying vec3 vC; uniform float uFade;
      void main(){ ${F_DEPTH} float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC * (1.0 - d * 1.6) * uFade * 0.85, 1.0); }`,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    transparent: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  return pts;
}

// Streaks aligned with +Z of the group; the group is oriented to the velocity.
export function createStreaks(count = 1400, seed = 11) {
  const rng = new RNG(seed);
  const pos = new Float32Array(count * 2 * 3);
  const phase = new Float32Array(count * 2);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(8, 140);
    const z = rng.range(-600, 600);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    for (let e = 0; e < 2; e++) {
      const k = (i * 2 + e) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      phase[i * 2 + e] = rng.next();
      end[i * 2 + e] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('endp', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uStretch: { value: 0 }, uIntensity: { value: 0 }, uTime: { value: 0 }, uSpeed: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      attribute float phase; attribute float endp; uniform float uStretch; uniform float uTime; uniform float uSpeed; varying float vA;
      void main(){
        vec3 p = position;
        float z = mod(p.z + phase * 1200.0 + uTime * uSpeed, 1200.0) - 600.0;
        p.z = z + endp * (4.0 + uStretch * 160.0);
        vA = (1.0 - abs(z) / 600.0) * (0.3 + endp * 0.7);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        ${V_TAIL}
      }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uIntensity; varying float vA;
      void main(){ ${F_DEPTH} gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * vA * uIntensity * 1.8, 1.0); }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 50;
  lines.visible = false;
  return lines;
}

// Hyperspace tunnel shown during interstellar Lightbreak.
export function createTunnel() {
  const geo = new THREE.CylinderGeometry(60, 60, 3000, 48, 1, true);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv; varying float vZ;
      void main(){ vUv = uv; vZ = position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uTime; uniform float uIntensity; varying vec2 vUv; varying float vZ;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        ${F_DEPTH}
        vec2 uv = vec2(vUv.x * 24.0, vUv.y * 6.0 - uTime * 3.0);
        vec2 i = floor(uv); vec2 f = fract(uv);
        float s = h(i);
        float streak = smoothstep(0.9, 1.0, s) * smoothstep(0.0, 0.1, f.y) * smoothstep(1.0, 0.3, f.y);
        float glow = 0.12 + 0.1 * sin(vUv.x * 6.2831 * 3.0 + uTime * 2.0);
        float fade = 1.0 - abs(vZ) / 1500.0;
        vec3 c = mix(vec3(0.2, 0.3, 1.0), vec3(0.6, 0.95, 1.0), s) * (streak * 3.0 + glow);
        gl_FragColor = vec4(c * fade * uIntensity * 0.55, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 49;
  m.visible = false;
  return m;
}
