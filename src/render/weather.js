// Dynamic weather per planet: clear, cloudy, rain, storms with lightning,
// snow, blizzards, sand storms, ash, acid rain, fog, electric storms.
import * as THREE from 'three';
import { orientOnSurface } from './fauna.js';
import { V_HEAD, V_TAIL, F_HEAD, F_DEPTH } from './shaders.js';

export const WEATHER = {
  clear: { precip: null, fog: 1, storm: 0, wind: 0.15, clouds: 0.35 },
  cloudy: { precip: null, fog: 1.4, storm: 0.25, wind: 0.3, clouds: 0.65 },
  rain: { precip: 'rain', fog: 2.2, storm: 0.45, wind: 0.4, clouds: 0.8 },
  storm: { precip: 'rain', fog: 3.5, storm: 0.8, wind: 0.8, clouds: 0.95, lightning: true },
  hurricane: { precip: 'rain', fog: 5, storm: 1, wind: 1, clouds: 1, lightning: true },
  snow: { precip: 'snow', fog: 2.5, storm: 0.4, wind: 0.3, clouds: 0.8 },
  blizzard: { precip: 'snow', fog: 6, storm: 0.8, wind: 1, clouds: 1, dust: 'snow', tint: [0.78, 0.82, 0.9] },
  sandstorm: { precip: 'sand', fog: 16, storm: 0.75, wind: 1, clouds: 0.3, dust: 'sand', tint: [0.72, 0.47, 0.24] },
  ash: { precip: 'ash', fog: 4, storm: 0.6, wind: 0.5, clouds: 0.7, dust: 'ash', tint: [0.26, 0.23, 0.21] },
  acid_rain: { precip: 'acid', fog: 2.5, storm: 0.5, wind: 0.4, clouds: 0.85, tint: [0.42, 0.5, 0.26] },
  fog: { precip: null, fog: 8, storm: 0.2, wind: 0.1, clouds: 0.6, dust: 'mist', tint: [0.62, 0.64, 0.67] },
  electric_storm: { precip: null, fog: 2, storm: 0.7, wind: 0.6, clouds: 0.9, lightning: true },
};

const PRECIP = {
  rain: { color: [0.7, 0.8, 1.0], len: 1.4, speed: 22, drift: 0.2 },
  acid: { color: [0.6, 1.0, 0.3], len: 1.2, speed: 18, drift: 0.2 },
  snow: { color: [1, 1, 1], len: 0.08, speed: 2.2, drift: 1.2 },
  sand: { color: [0.9, 0.7, 0.45], len: 0.25, speed: 2, drift: 14 },
  ash: { color: [0.35, 0.33, 0.32], len: 0.1, speed: 1.5, drift: 2.5 },
};

// Big soft billows that roll with the wind: the body of a sand storm,
// blizzard, ash cloud or ground fog.
const DUST = {
  sand: { color: [0.78, 0.55, 0.32], alpha: 0.55, size: [10, 34], speed: 16 },
  snow: { color: [0.9, 0.93, 1.0], alpha: 0.4, size: [8, 26], speed: 12 },
  ash: { color: [0.3, 0.28, 0.27], alpha: 0.3, size: [10, 30], speed: 5 },
  mist: { color: [0.8, 0.83, 0.86], alpha: 0.16, size: [16, 44], speed: 1.5 },
};
const DUST_BOX = 220;

export class Weather {
  constructor(game, count = 1500) {
    this.game = game;
    this.count = count;
    this.states = new Map();
    this.flash = 0;
    this.group = new THREE.Group();
    this.group.name = 'weather';
    this.buildParticles(count);
    this.buildDust(Math.round(count / 5));
    this.bolts = [];
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.82, 1).multiplyScalar(8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.55, 1).multiplyScalar(1.2), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.blend = 0;
  }

  buildDust(count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([(Math.random() - 0.5) * DUST_BOX, Math.random() * 45, (Math.random() - 0.5) * DUST_BOX], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustU = { uTime: { value: 0 }, uWind: { value: 10 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uSize: { value: new THREE.Vector2(10, 30) }, uH: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustU,
      vertexShader: V_HEAD + /* glsl */`
        attribute float seed; uniform float uTime; uniform float uWind; uniform vec2 uSize; uniform float uH; varying float vA; varying float vSeed;
        void main(){
          vec3 p = position;
          float B = ${DUST_BOX.toFixed(1)};
          p.x = mod(p.x + uTime * uWind * (0.7 + seed * 0.6) + B * 0.5, B) - B * 0.5;
          p.z += sin(uTime * 0.3 + seed * 40.0) * 6.0;
          p.y += sin(uTime * 0.5 + seed * 17.0) * 3.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = mix(uSize.x, uSize.y, seed);
          gl_PointSize = clamp(size * projectionMatrix[1][1] * uH * 0.5 / max(1.0, -mv.z), 1.0, 900.0);
          // Fade at the box edges and very close to the eye.
          vA = (1.0 - smoothstep(B * 0.3, B * 0.5, length(p.xz))) * smoothstep(2.0, 14.0, -mv.z);
          vSeed = seed;
          gl_Position = projectionMatrix * mv;
          ${V_TAIL}
        }`,
      fragmentShader: F_HEAD + /* glsl */`
        uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying float vA; varying float vSeed;
        void main(){
          ${F_DEPTH}
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          float ang = atan(c.y, c.x);
          float billow = 0.75 + 0.25 * sin(ang * 3.0 + vSeed * 20.0 + uTime * 0.6) * sin(r * 5.0 - uTime * 0.8 + vSeed * 9.0);
          float a = pow(max(0.0, 1.0 - r), 1.6) * billow * vA * uAlpha;
          gl_FragColor = vec4(uColor * (0.85 + 0.3 * vSeed), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dust.position.set(0, -6, 0);
    this.dust.renderOrder = 2;
    this.group.add(this.dust);
  }

  // A forked lightning bolt from the cloud deck to the ground near `at`.
  strike(body, at) {
    const up = at.clone().normalize();
    const side = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    side.addScaledVector(up, -side.dot(up)).normalize();
    const dist = 250 + Math.random() * 2200;
    const gdir = at.clone().addScaledVector(side, dist).normalize();
    const ground = gdir.clone().multiplyScalar(body.groundRadius(gdir));
    const top = ground.clone().addScaledVector(gdir, 900 + Math.random() * 700).addScaledVector(side, (Math.random() - 0.5) * 400);
    const group = new THREE.Group();
    const jag = (a, b, n, spread) => {
      const pts = [a.clone()];
      for (let i = 1; i < n; i++) {
        const p = a.clone().lerp(b, i / n);
        p.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread));
        pts.push(p);
      }
      pts.push(b.clone());
      return pts;
    };
    const tube = (pts, r) => {
      const path = new THREE.CurvePath();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      const m = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, r, 4, false), this.boltMat);
      const halo = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length, r * 5, 6, false), this.haloMat);
      m.frustumCulled = halo.frustumCulled = false;
      group.add(m, halo);
    };
    const main = jag(top, ground, 16, 90);
    tube(main, 2.2);
    // Branches off the upper two thirds.
    for (let b = 0; b < 4; b++) {
      const k = 1 + Math.floor(Math.random() * 9);
      const from = main[k];
      const to = from.clone().addScaledVector(up, -(120 + Math.random() * 260)).addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), 120 + Math.random() * 200);
      tube(jag(from, to, 6, 40), 0.9);
    }
    body.spin.add(group);
    this.bolts.push({ group, t: 0 });
    this.flash = Math.max(this.flash, dist < 900 ? 1 : 0.6);
    setTimeout(() => this.game.audio?.play('thunder'), Math.min(4000, (dist / 343) * 1000));
  }

  updateBolts(dt) {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      // Main stroke, then two return strokes.
      const t = b.t;
      b.group.visible = t < 0.07 || (t > 0.12 && t < 0.18) || (t > 0.26 && t < 0.3);
      if (t > 0.12 && t < 0.13) this.flash = Math.max(this.flash, 0.7);
      if (t > 0.35) {
        b.group.removeFromParent();
        b.group.traverse((o) => o.geometry?.dispose());
        this.bolts.splice(i, 1);
      }
    }
  }

  buildParticles(count) {
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 40, z = (Math.random() - 0.5) * 60;
      const sd = Math.random(); // both ends of a streak share one seed
      for (let e = 0; e < 2; e++) {
        pos.set([x, y, z], (i * 2 + e) * 3);
        seed[i * 2 + e] = sd;
        end[i * 2 + e] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('endp', new THREE.BufferAttribute(end, 1));
    this.uniforms = { uTime: { value: 0 }, uSpeed: { value: 20 }, uLen: { value: 1 }, uDrift: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: V_HEAD + /* glsl */`
        attribute float seed; attribute float endp; uniform float uTime; uniform float uSpeed; uniform float uLen; uniform float uDrift; varying float vA;
        void main(){
          vec3 p = position;
          float fall = mod(p.y - uTime * uSpeed * (0.8 + seed * 0.4), 40.0);
          p.y = fall + endp * uLen;
          p.x = mod(p.x + uTime * uDrift + 30.0, 60.0) - 30.0 + sin(uTime + seed * 30.0) * 0.3 * uDrift / 4.0;
          p.z += cos(uTime * 0.7 + seed * 20.0) * 0.2;
          p.x += endp * uDrift * 0.03;
          vA = 1.0 - abs(p.x) / 30.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          ${V_TAIL}
        }`,
      fragmentShader: F_HEAD + /* glsl */`
        uniform vec3 uColor; uniform float uAlpha; varying float vA;
        void main(){ ${F_DEPTH} gl_FragColor = vec4(uColor, uAlpha * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.position.set(0, -20, 0);
    this.group.add(this.lines);
  }

  stateFor(body) {
    if (!this.states.has(body.id)) {
      const opts = body.def.weather || ['clear'];
      this.states.set(body.id, { type: body.def.home ? 'clear' : opts[0], timer: body.def.home ? 240 : 60 + Math.random() * 120, blend: 0 });
    }
    return this.states.get(body.id);
  }

  force(body, type) {
    const s = this.stateFor(body);
    s.type = type;
    s.timer = 240;
    s.blend = 0;
  }

  update(dt, body, playerLocal, underground = false) {
    this.uniforms.uTime.value += dt;
    this.dustU.uTime.value += dt;
    this.dustU.uH.value = this.game.renderer?.domElement?.height || 800;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.updateBolts(dt);
    if (!body || !body.def.atmosphere) {
      this.group.visible = false;
      this.current = WEATHER.clear;
      return this.current;
    }
    const s = this.stateFor(body);
    s.timer -= dt;
    if (s.timer <= 0) {
      const opts = body.def.weather;
      // Clear weather is more common than extremes.
      s.type = Math.random() < 0.45 ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
      s.timer = 120 + Math.random() * 240;
      s.blend = 0;
      if (WEATHER[s.type].storm > 0.5) this.game.events.emit('weather:storm', { body, type: s.type });
    }
    s.blend = Math.min(1, s.blend + dt / 20);
    this.blend = s.blend;
    const w = WEATHER[s.type] || WEATHER.clear;
    this.current = w;
    this.currentType = s.type;
    const alt = playerLocal ? playerLocal.length() - body.radius : Infinity;
    const precip = w.precip && alt < body.atmoHeight * 0.4 && !underground ? PRECIP[w.precip] : null;
    const agl = playerLocal && body.altitude ? body.altitude(playerLocal) : alt;
    const dust = w.dust && agl < 400 && !underground ? DUST[w.dust] : null;
    this.group.visible = !!(precip || dust) && !!playerLocal;
    this.lines.visible = !!precip;
    this.dust.visible = !!dust;
    if (dust) {
      this.dustU.uWind.value = dust.speed * (0.4 + w.wind * 0.6);
      this.dustU.uColor.value.setRGB(...dust.color);
      this.dustU.uAlpha.value = dust.alpha * s.blend * (1 - Math.max(0, agl) / 400);
      this.dustU.uSize.value.set(...dust.size);
    }
    if ((precip || dust) && playerLocal) {
      if (this.group.parent !== body.spin) body.spin.add(this.group);
      this.group.position.copy(playerLocal);
      const up = playerLocal.clone().normalize();
      const f = new THREE.Vector3(1, 0, 0).cross(up);
      if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
      orientOnSurface(this.group, up, f.normalize());
    }
    if (precip && playerLocal) {
      this.uniforms.uSpeed.value = precip.speed;
      this.uniforms.uLen.value = precip.len;
      this.uniforms.uDrift.value = precip.drift * w.wind;
      this.uniforms.uColor.value.setRGB(...precip.color);
      this.uniforms.uAlpha.value = (w.precip === 'snow' ? 0.9 : 0.45) * s.blend;
      this.lines.geometry.setDrawRange(0, Math.floor(this.count * 2 * Math.min(1, 0.4 + w.storm)));
    }
    if (w.lightning && playerLocal && Math.random() < dt * 0.22 * w.storm * s.blend && alt < body.atmoHeight) this.strike(body, playerLocal);
    this.game.audio?.setLoop('wind', (0.02 + w.wind * 0.1) * Math.max(0, 1 - Math.max(0, alt) / body.atmoHeight) * body.def.atmosphere.density);
    this.game.audio?.setLoop('rain', precip && (w.precip === 'rain' || w.precip === 'acid') ? 0.06 * s.blend : 0);
    return w;
  }

  get stormAmount() {
    const s = this.current;
    return s ? s.storm : 0;
  }
}
