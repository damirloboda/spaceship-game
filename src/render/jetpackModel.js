// The player's jetpack: a detailed procedural model (carbon-fibre backplate,
// painted gunmetal shell with a printed label and gauge, brushed steel tanks
// with feed lines, bell nozzles with glowing rings, unfolding stabiliser
// fins, fuel LEDs), a two-layer plasma flame, a light that washes the ground,
// and particle sparks, smoke and ground dust.
import * as THREE from 'three';
import { carbonMaterial, brushedMetal, paintedPanel, decalMaterial, gaugeMaterial } from './materialsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createExhaustMaterial, V_HEAD, V_TAIL, F_HEAD, F_DEPTH, F_TAIL } from './shaders.js';

// ---------------------------------------------------------------------------
// Lightweight GPU point particles (one draw call per blend mode).
function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let dotTex = null;

export class Particles {
  constructor(count, { additive = false } = {}) {
    dotTex = dotTex || softDot();
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(1e9);
    this.life = new Float32Array(count).fill(1);
    this.grow = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.base = new Float32Array(count * 4); // r g b size0
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: dotTex }, uScale: { value: 600 } },
      vertexShader: V_HEAD + /* glsl */`
        attribute float aAlpha; attribute float aSize; attribute vec3 color;
        uniform float uScale; varying float vA; varying vec3 vC;
        void main(){
          vA = aAlpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          ${V_TAIL}
        }`,
      fragmentShader: F_HEAD + /* glsl */`
        uniform sampler2D uTex; varying float vA; varying vec3 vC;
        void main(){
          ${F_DEPTH}
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vC, t.a * vA);
          if (gl_FragColor.a < 0.004) discard;
          ${F_TAIL}
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(p, v, { color = [1, 1, 1], size = 0.2, life = 1, grow = 0, drag = 0 } = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.base[i * 4] = color[0]; this.base[i * 4 + 1] = color[1]; this.base[i * 4 + 2] = color[2]; this.base[i * 4 + 3] = size;
    this.age[i] = 0; this.life[i] = life; this.grow[i] = grow; this.drag[i] = drag;
  }

  // gravity: vector (local frame) applied to every particle.
  update(dt, gravity) {
    for (let i = 0; i < this.count; i++) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] = (this.vel[i * 3] + gravity.x * dt) * k;
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1] + gravity.y * dt) * k;
      this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] + gravity.z * dt) * k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = a / this.life[i];
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.alpha[i] = fade;
      this.size[i] = this.base[i * 4 + 3] * (1 + this.grow[i] * t);
      this.col[i * 3] = this.base[i * 4]; this.col[i * 3 + 1] = this.base[i * 4 + 1]; this.col[i * 3 + 2] = this.base[i * 4 + 2];
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.color.needsUpdate = true; g.aAlpha.needsUpdate = true; g.aSize.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
function plasmaCoreMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; ${V_TAIL} }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform float uTime; uniform float uPower; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        ${F_DEPTH}
        float along = vUv.y;
        float edge = pow(abs(dot(vN, vV)), 2.0);
        // Shock diamonds: bright knots marching down the jet.
        float knots = 0.6 + 0.4 * pow(abs(sin(along * 18.0 - uTime * 30.0)), 4.0);
        float a = pow(along, 1.2) * edge * knots * uPower;
        vec3 col = mix(vec3(0.35, 0.75, 1.0), vec3(1.0), pow(along, 3.0));
        gl_FragColor = vec4(col * a * 4.0, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function buildJetpack(accent = new THREE.Color(0x39d0ff)) {
  const root = new THREE.Group();
  root.name = 'jetpack';
  const carbon = carbonMaterial(2.5);
  const shell = paintedPanel(0x59616d, 0.6);
  const chrome = brushedMetal(0xc8cdd5, 0.22);
  const finMat = carbonMaterial(1.5);
  finMat.side = THREE.DoubleSide;
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: accent.clone(), emissiveIntensity: 1.2, roughness: 0.4 });
  const heatMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: new THREE.Color(1.0, 0.35, 0.08), emissiveIntensity: 0, roughness: 0.5 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  // Backplate and shell
  add(new RoundedBoxGeometry(0.46, 0.56, 0.14, 4, 0.05), carbon, 0, 0, 0);
  add(new RoundedBoxGeometry(0.34, 0.42, 0.06, 4, 0.025), shell, 0, 0.03, 0.085);
  // Accent light strip and vents on the shell
  add(new THREE.BoxGeometry(0.03, 0.3, 0.012), glowMat, 0, 0.04, 0.12);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.22, 0.012, 0.02), carbon, 0, -0.14 + i * 0.028, 0.118);
  // Fuel tanks with chrome finish and accent bands
  const tankGeo = new THREE.CapsuleGeometry(0.068, 0.3, 6, 18);
  const bandGeo = new THREE.TorusGeometry(0.07, 0.009, 8, 24);
  for (const x of [-0.2, 0.2]) {
    add(tankGeo, chrome, x, 0.02, 0.1);
    for (const y of [-0.08, 0.13]) add(bandGeo, glowMat, x, y, 0.1, Math.PI / 2);
  }
  // Thruster housings, bell nozzles, glowing throat rings and heat rings
  const bell = new THREE.LatheGeometry([
    new THREE.Vector2(0.045, 0), new THREE.Vector2(0.05, -0.03), new THREE.Vector2(0.065, -0.08),
    new THREE.Vector2(0.085, -0.13), new THREE.Vector2(0.088, -0.135),
  ], 24);
  const nozzles = [];
  for (const x of [-0.13, 0.13]) {
    add(new THREE.CylinderGeometry(0.062, 0.07, 0.12, 20), carbon, x, -0.3, 0.04);
    add(bell, darkMetal, x, -0.36, 0.04);
    add(new THREE.TorusGeometry(0.052, 0.008, 8, 24), glowMat, x, -0.365, 0.04, Math.PI / 2);
    add(new THREE.TorusGeometry(0.08, 0.01, 8, 24), heatMat, x, -0.49, 0.04, Math.PI / 2);
    const n = new THREE.Object3D();
    n.position.set(x, -0.5, 0.04);
    root.add(n);
    nozzles.push(n);
  }
  // Stabiliser fins that swing out in flight
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0); finShape.lineTo(0.2, -0.05); finShape.lineTo(0.22, -0.2); finShape.lineTo(0.03, -0.26); finShape.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  finGeo.translate(0, 0, -0.006);
  const fins = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.23, 0.16, 0.02);
    const f = new THREE.Mesh(finGeo, finMat);
    f.scale.x = side;
    f.castShadow = true;
    pivot.add(f);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.016), glowMat);
    stripe.position.set(side * 0.1, -0.1, 0);
    stripe.rotation.z = side * -0.4;
    pivot.add(stripe);
    root.add(pivot);
    fins.push({ pivot, side });
  }
  // Printed label with a hazard stripe, a pressure gauge, rivets and the
  // braided feed lines from the tanks down to the thrusters.
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), decalMaterial({ lines: ['JX-7', 'N2O 3000 PSI', 'SER 0417-A'], accent: '#' + accent.getHexString(), hazard: true }));
  label.position.set(0.085, 0.13, 0.1165);
  root.add(label);
  const gauge = new THREE.Group();
  gauge.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.018, 24), chrome));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), gaugeMaterial('#' + accent.getHexString()));
  face.rotation.x = -Math.PI / 2; face.position.y = 0.0095;
  gauge.add(face);
  gauge.rotation.x = Math.PI / 2 - 0.25;
  gauge.position.set(-0.085, 0.16, 0.125);
  root.add(gauge);
  const rivetGeo = new THREE.SphereGeometry(0.007, 8, 6);
  for (const [x, y] of [[-0.15, 0.22], [0.15, 0.22], [-0.15, -0.16], [0.15, -0.16], [0, 0.22], [0, -0.16]]) add(rivetGeo, chrome, x, y, 0.117);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.6, roughness: 0.45 });
  for (const side of [-1, 1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.2, -0.17, 0.1), new THREE.Vector3(side * 0.2, -0.22, 0.12),
      new THREE.Vector3(side * 0.16, -0.26, 0.1), new THREE.Vector3(side * 0.13, -0.27, 0.08),
    ]);
    add(new THREE.TubeGeometry(path, 16, 0.011, 8, false), lineMat, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), chrome, side * 0.2, -0.165, 0.1);
  }
  // Antenna and fuel LEDs
  add(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 6), darkMetal, 0.16, 0.34, -0.02);
  add(new THREE.SphereGeometry(0.014, 8, 6), glowMat, 0.16, 0.42, -0.02);
  const leds = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: new THREE.Color(0.2, 1, 0.5), emissiveIntensity: 1.5 });
    leds.push(add(new THREE.BoxGeometry(0.028, 0.014, 0.01), m, -0.07 + i * 0.035, 0.23, 0.12));
  }
  // Flames: orange torch around a blue plasma core
  const outerMat = createExhaustMaterial([1.0, 0.5, 0.18]);
  const coreMat = plasmaCoreMaterial();
  const flames = [];
  for (const n of nozzles) {
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.01, 1.0, 18, 6, true).translate(0, -0.5, 0), outerMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.004, 0.62, 14, 6, true).translate(0, -0.31, 0), coreMat);
    // UV v runs 1 at the nozzle to 0 at the tip, as the shaders expect.
    n.add(outer, core);
    flames.push({ outer, core });
  }
  const light = new THREE.PointLight(0xff9a50, 0, 9, 1.6);
  light.position.set(0, -0.8, 0.05);
  root.add(light);

  let t = 0, power = 0, finOpen = 0;
  const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
  const api = {
    root, nozzles, flames, fins, leds, light,
    smoke: new Particles(160),
    sparks: new Particles(120, { additive: true }),
    emitAcc: 0,
    // state: { active, fuelPct, heatPct, overheated, visible }
    // frame: object the particles live in (the planet frame); up: local up.
    update(dt, state, frame, up, groundDist = Infinity) {
      t += dt;
      const target = state.active ? 1 : 0;
      power += (target - power) * Math.min(1, dt * (state.active ? 14 : 6));
      finOpen += ((state.active ? 1 : 0) - finOpen) * Math.min(1, dt * 5);
      for (const f of fins) f.pivot.rotation.set(0, f.side * -0.35 * finOpen, f.side * 0.75 * finOpen);
      outerMat.uniforms.uTime.value = t;
      outerMat.uniforms.uPower.value = power * 1.2;
      coreMat.uniforms.uTime.value = t;
      coreMat.uniforms.uPower.value = power;
      for (const fl of flames) {
        const flick = 0.85 + Math.random() * 0.3;
        fl.outer.visible = fl.core.visible = power > 0.02;
        fl.outer.scale.set(1, (0.35 + power * 0.9) * flick, 1);
        fl.core.scale.set(1, (0.4 + power * 0.8) * (0.9 + Math.random() * 0.2), 1);
      }
      light.intensity = power * (5 + Math.random() * 2.5);
      glowMat.emissiveIntensity = 1.1 + power * 2.2 + Math.sin(t * 3) * 0.15;
      heatMat.emissiveIntensity = Math.max(0, (state.heatPct - 0.35) * 3) + (state.overheated ? Math.abs(Math.sin(t * 10)) * 2 : 0);
      const lit = Math.ceil(Math.max(0, state.fuelPct) * leds.length - 0.001);
      leds.forEach((l, i) => {
        l.material.emissiveIntensity = i < lit ? 1.6 : 0.05;
        l.material.emissive.setRGB(state.fuelPct < 0.25 ? 1 : 0.2, state.fuelPct < 0.25 ? 0.25 : 1, 0.4);
      });
      // Particles live in the planet frame so trails stay behind the pilot.
      if (frame && this.smoke.points.parent !== frame) { frame.add(this.smoke.points, this.sparks.points); }
      if (state.active && frame && state.visible !== false) {
        this.emitAcc += dt;
        const step = 1 / 70;
        while (this.emitAcc > step) {
          this.emitAcc -= step;
          for (const n of nozzles) {
            n.getWorldPosition(tmpW);
            frame.worldToLocal(tmpW);
            const down = tmpV.copy(up).multiplyScalar(-1);
            const jitter = () => (Math.random() - 0.5);
            this.sparks.emit(tmpW, new THREE.Vector3(jitter(), jitter(), jitter()).multiplyScalar(2).addScaledVector(down, 9 + Math.random() * 5),
              { color: Math.random() < 0.5 ? [1.0, 0.7, 0.3] : [0.5, 0.8, 1.0], size: 0.05 + Math.random() * 0.05, life: 0.25 + Math.random() * 0.2, drag: 1 });
            if (Math.random() < 0.45) {
              this.smoke.emit(tmpW.clone().addScaledVector(down, 0.5), new THREE.Vector3(jitter(), jitter(), jitter()).multiplyScalar(1.2).addScaledVector(down, 4),
                { color: [0.78, 0.78, 0.8], size: 0.25, life: 1.4 + Math.random(), grow: 5, drag: 2.2 });
            }
          }
          // Dust ring blasted off the ground under the pilot.
          if (groundDist < 4 && Math.random() < 0.8) {
            nozzles[0].getWorldPosition(tmpW);
            frame.worldToLocal(tmpW).addScaledVector(up, -groundDist);
            const a = Math.random() * Math.PI * 2;
            const side = new THREE.Vector3(Math.cos(a), Math.sin(a), Math.cos(a * 1.7)).cross(up).normalize();
            this.smoke.emit(tmpW, side.multiplyScalar(5 + Math.random() * 4).addScaledVector(up, 0.6),
              { color: [0.72, 0.66, 0.55], size: 0.35, life: 1.2 + Math.random() * 0.8, grow: 4, drag: 2.5 });
          }
        }
      }
      const g = tmpV.copy(up).multiplyScalar(0.6); // smoke rises a little
      this.smoke.update(dt, g);
      this.sparks.update(dt, tmpW.copy(up).multiplyScalar(-6));
    },
    dispose() { this.smoke.dispose(); this.sparks.dispose(); },
  };
  return api;
}
