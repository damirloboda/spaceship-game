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
  blizzard: { precip: 'snow', fog: 6, storm: 0.8, wind: 1, clouds: 1 },
  sandstorm: { precip: 'sand', fog: 7, storm: 0.6, wind: 1, clouds: 0.3 },
  ash: { precip: 'ash', fog: 4, storm: 0.6, wind: 0.5, clouds: 0.7 },
  acid_rain: { precip: 'acid', fog: 2.5, storm: 0.5, wind: 0.4, clouds: 0.85 },
  fog: { precip: null, fog: 8, storm: 0.2, wind: 0.1, clouds: 0.6 },
  electric_storm: { precip: null, fog: 2, storm: 0.7, wind: 0.6, clouds: 0.9, lightning: true },
};

const PRECIP = {
  rain: { color: [0.7, 0.8, 1.0], len: 1.4, speed: 22, drift: 0.2 },
  acid: { color: [0.6, 1.0, 0.3], len: 1.2, speed: 18, drift: 0.2 },
  snow: { color: [1, 1, 1], len: 0.08, speed: 2.2, drift: 1.2 },
  sand: { color: [0.9, 0.7, 0.45], len: 0.25, speed: 2, drift: 14 },
  ash: { color: [0.35, 0.33, 0.32], len: 0.1, speed: 1.5, drift: 2.5 },
};

export class Weather {
  constructor(game, count = 1500) {
    this.game = game;
    this.count = count;
    this.states = new Map();
    this.flash = 0;
    this.group = new THREE.Group();
    this.group.name = 'weather';
    this.buildParticles(count);
    this.bolt = null;
  }

  buildParticles(count) {
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 40, z = (Math.random() - 0.5) * 60;
      for (let e = 0; e < 2; e++) {
        pos.set([x, y, z], (i * 2 + e) * 3);
        seed[i * 2 + e] = Math.random();
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
    this.flash = Math.max(0, this.flash - dt * 3);
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
    const w = WEATHER[s.type] || WEATHER.clear;
    this.current = w;
    this.currentType = s.type;
    const alt = playerLocal ? playerLocal.length() - body.radius : Infinity;
    const precip = w.precip && alt < body.atmoHeight * 0.4 && !underground ? PRECIP[w.precip] : null;
    this.group.visible = !!precip;
    if (precip && playerLocal) {
      if (this.group.parent !== body.spin) body.spin.add(this.group);
      this.group.position.copy(playerLocal);
      const up = playerLocal.clone().normalize();
      const f = new THREE.Vector3(1, 0, 0).cross(up);
      if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
      orientOnSurface(this.group, up, f.normalize());
      this.uniforms.uSpeed.value = precip.speed;
      this.uniforms.uLen.value = precip.len;
      this.uniforms.uDrift.value = precip.drift * w.wind;
      this.uniforms.uColor.value.setRGB(...precip.color);
      this.uniforms.uAlpha.value = (w.precip === 'snow' ? 0.9 : 0.45) * s.blend;
      this.lines.geometry.setDrawRange(0, Math.floor(this.count * 2 * Math.min(1, 0.4 + w.storm)));
    }
    if (w.lightning && Math.random() < dt * 0.12 * w.storm && alt < body.atmoHeight) {
      this.flash = 1;
      const delay = 300 + Math.random() * 2500;
      setTimeout(() => this.game.audio?.play('thunder'), delay);
    }
    this.game.audio?.setLoop('wind', (0.02 + w.wind * 0.1) * Math.max(0, 1 - Math.max(0, alt) / body.atmoHeight) * body.def.atmosphere.density);
    this.game.audio?.setLoop('rain', precip && (w.precip === 'rain' || w.precip === 'acid') ? 0.06 * s.blend : 0);
    return w;
  }

  get stormAmount() {
    const s = this.current;
    return s ? s.storm : 0;
  }
}
