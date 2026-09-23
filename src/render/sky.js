// Deep-space backdrop: procedural Milky Way texture, point stars that follow
// the camera, and Overdrive/Lightbreak star-streak effects.
import * as THREE from 'three';
import { Noise3 } from '../core/noise.js';
import { RNG } from '../core/rng.js';
import { V_HEAD, V_TAIL, F_HEAD, F_DEPTH } from './shaders.js';

export function createGalaxyBackground(seed = 7, width = 1024) {
  const height = width / 2;
  const data = new Uint8Array(width * height * 4);
  const n = new Noise3(seed);
  const rng = new RNG(seed);
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
  // Faint background star dust baked in.
  for (let s = 0; s < width * 3; s++) {
    const x = rng.int(0, width - 1), y = rng.int(0, height - 1);
    const i = (y * width + x) * 4;
    const v = rng.range(60, 200);
    data[i] = Math.max(data[i], v); data[i + 1] = Math.max(data[i + 1], v); data[i + 2] = Math.max(data[i + 2], v * 1.05);
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
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
