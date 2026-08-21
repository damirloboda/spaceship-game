/**
 * Sky, atmosphere, rings and starfield (§9, §14, §103).
 *
 * A single inside-out sphere with a physically-flavoured (not physically
 * exact — this runs on phones) Rayleigh-ish scattering shader gives the
 * horizon-to-zenith gradient and sunset colours from one draw call.
 */
import * as THREE from '../../vendor/three.module.js';

const ATMOSPHERE_VERT = `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMOSPHERE_FRAG = `
uniform vec3 uSunDir;
uniform vec3 uCameraUp;
uniform vec3 uDayColor;
uniform vec3 uDuskColor;
uniform vec3 uNightColor;
uniform float uDensity;
varying vec3 vWorldPos;

/*
 * This shell is a rigid sphere, so a fragment's distance from the planet
 * centre is the same everywhere on it — using that as an "altitude" term (the
 * first version of this shader did) makes the whole sky uniformly transparent
 * regardless of view angle. What actually reads as sky is how close the view
 * ray is to the local horizon versus the zenith, measured from the camera —
 * which on a floating-origin scene sits at the world origin, so the fragment
 * position itself already gives that ray.
 */
void main() {
  vec3 viewDir = normalize(vWorldPos);
  float horizonness = 1.0 - abs(dot(viewDir, uCameraUp));
  float sunDot = dot(viewDir, uSunDir);

  float dayFactor = smoothstep(-0.28, 0.35, sunDot);
  float duskFactor = clamp(1.0 - abs(sunDot) * 1.8, 0.0, 1.0) * smoothstep(-0.3, 0.15, sunDot);

  vec3 col = mix(uNightColor, uDayColor, dayFactor);
  col = mix(col, uDuskColor, duskFactor * 0.65);

  float fade = (0.22 + pow(horizonness, 1.6) * 0.85) * uDensity;
  gl_FragColor = vec4(col, clamp(fade, 0.0, 1.0));
}`;

/** Build the atmosphere shell for a planet. */
export function buildAtmosphere(planet, radius) {
  const height = radius * 0.045 * Math.min(2.2, Math.max(0.3, planet.atmosphere || 0.5));
  const geo = new THREE.SphereGeometry(radius + height, 48, 32);
  const dayColor = atmosphereDayColor(planet);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0.3, 0) },
      uCameraUp: { value: new THREE.Vector3(0, 1, 0) },
      uDayColor: { value: dayColor },
      uDuskColor: { value: new THREE.Color(0xff8a4a) },
      uNightColor: { value: new THREE.Color(0x030510) },
      uDensity: { value: Math.min(1, (planet.atmosphere || 0) / 1.4) },
    },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

function atmosphereDayColor(planet) {
  switch (planet.class) {
    case 'toxic': case 'radioactive': return new THREE.Color(0x8fae3a);
    case 'electric': return new THREE.Color(0x7fa8ff);
    case 'lava': case 'scorched': return new THREE.Color(0xd98a55);
    case 'ice': case 'frozen_ocean': return new THREE.Color(0xaee2ff);
    case 'desert': return new THREE.Color(0xffd9a0);
    default: return new THREE.Color(0x7ec8ff);
  }
}

/** Procedural starfield — thousands of points, no texture needed. */
export function buildStarfield(seed = 1, count = 6000, radius = 400000) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    positions[i * 3] = r * Math.cos(a) * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = r * Math.sin(a) * radius;
    const temp = rnd();
    const c = new THREE.Color().setHSL(0.58 - temp * 0.55, 0.5, 0.6 + rnd() * 0.4);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 240, vertexColors: true, sizeAttenuation: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Planet rings (§9) — a flat textured disc with a radial alpha ramp. */
export function buildRings(planet, planetRadius) {
  if (!planet.hasRings) return null;
  const inner = planetRadius * planet.ringInner;
  const outer = planetRadius * planet.ringOuter;
  const geo = new THREE.RingGeometry(inner, outer, 128, 8);
  // Radial UV so the fragment shader can ramp alpha from inner to outer edge.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    const d = (v3.length() - inner) / (outer - inner);
    uv.setXY(i, d, 0.5);
  }
  const canvas = ringGradientCanvas(planet);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2 + (planet.axialTilt || 0);
  return mesh;
}

function ringGradientCanvas(planet) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 4;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  let s = (planet.seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const band = (Math.sin(t * 40 + rnd()) * 0.5 + 0.5) * (rnd() * 0.6 + 0.2);
    const alpha = Math.max(0, band * (1 - Math.abs(t - 0.5) * 1.3));
    grad.addColorStop(t, `rgba(220,205,180,${alpha.toFixed(2)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 4);
  return c;
}
