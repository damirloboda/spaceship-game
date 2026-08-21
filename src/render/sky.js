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
uniform float uSunElevation;
uniform vec3 uDayColor;
uniform vec3 uDuskColor;
uniform vec3 uNightColor;
uniform float uDensity;
varying vec3 vWorldPos;

/*
 * Two independent inputs decide what the sky looks like:
 *
 *  - How high the SUN is (uSunElevation = dot(sunDir, localUp)) decides
 *    whether it is day, dusk or night. This is a property of the world, not
 *    of where the player happens to be looking.
 *  - Where the CAMERA is looking decides the gradient: bright near the
 *    horizon, deeper toward the zenith, plus a warm bloom toward the sun.
 *
 * The first version drove day/night from dot(viewDir, sunDir), which meant
 * simply turning your back on the sun produced a night sky at noon — the
 * whole world rendered dark blue in broad daylight.
 */
void main() {
  vec3 viewDir = normalize(vWorldPos);
  float horizonness = 1.0 - abs(dot(viewDir, uCameraUp));
  float toSun = max(0.0, dot(viewDir, uSunDir));

  float day = smoothstep(-0.16, 0.28, uSunElevation);
  // Dusk peaks while the sun sits near the horizon, in either direction.
  float dusk = exp(-pow(uSunElevation * 4.2, 2.0));

  vec3 col = mix(uNightColor, uDayColor, day);
  // Classic sky gradient: deeper overhead, paler toward the horizon haze.
  col = mix(col * 0.72, col * 1.18, pow(horizonness, 1.5));
  // Warm the sky toward the sun, strongest at sunrise/sunset.
  col = mix(col, uDuskColor, clamp(dusk * pow(toSun, 3.0) * 0.85, 0.0, 1.0));
  // A soft bloom right around the sun disc at any time of day.
  col += uDuskColor * pow(toSun, 26.0) * 0.35 * day;

  // Opaque enough to read as sky by day; thin at night so stars show through.
  float alpha = uDensity * (0.35 + 0.65 * horizonness + 0.55 * day);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
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
      uSunElevation: { value: 0.5 },
      uDayColor: { value: dayColor },
      uDuskColor: { value: new THREE.Color(0xff8a4a) },
      uNightColor: { value: new THREE.Color(0x030510) },
      uDensity: { value: Math.min(1, (planet.atmosphere || 0) / 0.85) },
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

/* ------------------------------------------------------------------ */
/* Sun, clouds, weather                                                */
/* ------------------------------------------------------------------ */

/**
 * Sun billboard (§14). A glowing disc plus a soft halo, drawn far away and
 * always facing the camera. Coloured by the star's actual temperature, so a
 * red dwarf really does give a dim orange day and a blue giant a harsh
 * white-blue one.
 */
export function buildSun(star, distance = 4e7) {
  const g = new THREE.Group();
  const color = new THREE.Color(star.color[0], star.color[1], star.color[2]);

  // Angular size scales with the star's radius; the disc is sized so a
  // Sol-like star subtends roughly half a degree as it does from Earth.
  const size = distance * 0.009 * Math.max(0.35, Math.min(6, star.radiusSol || 1));

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(size, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false }),
  );
  g.add(disc);

  // Halo: a larger disc with a radial alpha falloff painted on a canvas.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(255,255,255,0.85)`);
  grad.addColorStop(0.25, `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},0.42)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const haloTex = new THREE.CanvasTexture(canvas);

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 9, size * 9),
    new THREE.MeshBasicMaterial({
      map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  halo.position.z = -size * 0.05;
  g.add(halo);

  g.userData.distance = distance;
  g.renderOrder = -10;
  return g;
}

/** Point the sun billboard at `sunDir` and keep it facing the camera. */
export function placeSun(sunGroup, sunDir, camera) {
  const d = sunGroup.userData.distance;
  sunGroup.position.set(sunDir.x * d, sunDir.y * d, sunDir.z * d);
  sunGroup.lookAt(camera.position);
}

/**
 * Cloud deck (§103's volumetric-clouds goal, approximated). A ring of soft
 * billboards at altitude, cheap enough for a phone and enough to make the sky
 * read as weather rather than a flat gradient.
 */
export function buildClouds(planet, surfaceRadius, seed = 1) {
  if ((planet.atmosphere || 0) < 0.25) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.92)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);

  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.55,
  });

  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

  const count = 46;
  const altitude = 1600 + rnd() * 1800;
  const spread = 26000;
  const geo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < count; i++) {
    const puff = new THREE.Mesh(geo, mat);
    const scale = 1800 + rnd() * 4200;
    puff.scale.set(scale, scale * 0.55, 1);
    puff.position.set(
      (rnd() - 0.5) * spread,
      altitude + (rnd() - 0.5) * 700,
      (rnd() - 0.5) * spread,
    );
    puff.userData.drift = 4 + rnd() * 10;
    group.add(puff);
  }
  group.userData.altitude = altitude;
  return group;
}

/** Keep cloud billboards level with the local horizon and facing the camera. */
export function placeClouds(clouds, playerUp, camera, timeS, wind = 0) {
  if (!clouds) return;
  const up = new THREE.Vector3(playerUp.x, playerUp.y, playerUp.z);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  clouds.quaternion.copy(q);
  for (const puff of clouds.children) {
    // Drift with the wind, wrapping so the deck never runs out.
    const drift = ((timeS * puff.userData.drift * (0.2 + wind * 0.05)) % 26000) - 13000;
    puff.position.x = ((puff.position.x + drift + 39000) % 26000) - 13000;
    puff.lookAt(camera.position);
  }
}

/**
 * Weather particles (§15) — rain, snow, sand or ash falling around the player.
 * A single Points cloud recycled in place; particles that fall below the
 * player are lifted back to the top.
 */
export class WeatherParticles {
  constructor(scene, count = 2600) {
    this.count = count;
    this.extent = 46;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * this.extent;
      this.positions[i * 3 + 1] = Math.random() * this.extent;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.extent;
      this.velocities[i] = 0.6 + Math.random() * 0.7;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xbfd8ff, size: 0.14, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.scene = scene;
  }

  /** Match the particle look to the current weather, or hide it entirely. */
  setWeather(weather) {
    const kind = weather && weather.particles;
    if (!kind) { this.points.visible = false; return; }
    this.points.visible = true;
    this.kind = kind;
    const style = {
      rain: { color: 0x9fc4ff, size: 0.1, speed: 24, opacity: 0.6 },
      snow: { color: 0xffffff, size: 0.3, speed: 2.4, opacity: 0.85 },
      sand: { color: 0xd8b483, size: 0.2, speed: 9, opacity: 0.7 },
      ash: { color: 0x6b6660, size: 0.22, speed: 3.5, opacity: 0.75 },
      acid: { color: 0xbcd84f, size: 0.14, speed: 16, opacity: 0.65 },
      ion: { color: 0x86e0ff, size: 0.2, speed: 12, opacity: 0.8 },
      meteor: { color: 0xffb46b, size: 0.45, speed: 40, opacity: 0.9 },
    }[kind] || { color: 0xffffff, size: 0.2, speed: 8, opacity: 0.7 };

    this.material.color.setHex(style.color);
    this.material.size = style.size;
    this.material.opacity = style.opacity * (0.4 + (weather.intensity || 0.5) * 0.6);
    this.speed = style.speed;
  }

  /**
   * Fall the particles. They live in a box centred on the camera, oriented so
   * "down" is toward the planet — on a sphere that direction changes as you
   * travel, so it's recomputed from the player's up vector each frame.
   */
  update(dt, playerUp, windSpeed = 0) {
    if (!this.points.visible) return;
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(playerUp.x, playerUp.y, playerUp.z),
    );
    this.points.quaternion.copy(q);

    const drop = (this.speed || 8) * dt;
    const drift = windSpeed * dt * 0.35;
    for (let i = 0; i < this.count; i++) {
      const yi = i * 3 + 1;
      this.positions[yi] -= drop * this.velocities[i];
      this.positions[i * 3] += drift * this.velocities[i];
      if (this.positions[yi] < -this.extent * 0.4) {
        this.positions[yi] = this.extent * 0.6;
        this.positions[i * 3] = (Math.random() - 0.5) * this.extent;
        this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.extent;
      }
      if (Math.abs(this.positions[i * 3]) > this.extent * 0.5) {
        this.positions[i * 3] = -Math.sign(this.positions[i * 3]) * this.extent * 0.5;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  place(origin) {
    // Particles are camera-local, so the group simply sits at the origin.
    this.points.position.set(0, 0, 0);
  }
}
