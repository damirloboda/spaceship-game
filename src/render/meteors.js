// Meteoroids streaking through open space: tumbling rocks with a glowing
// coma, a warm dust tail and a thin blue ion tail. They cross the ship's
// path, whoosh past on near misses and can clip the hull. Inside an
// atmosphere at night, shooting stars cross the sky instead.
import * as THREE from 'three';
import { rockGeometry } from './asteroids.js';
import { texture } from './textures.js';
import { V_HEAD, V_TAIL, F_HEAD, F_DEPTH } from './shaders.js';

const tv = new THREE.Vector3();

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,230,190,0.85)');
  grd.addColorStop(0.45, 'rgba(255,150,80,0.25)');
  grd.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function tailMaterial(color, power) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(...color) }, uAlpha: { value: 1 }, uTime: { value: 0 } },
    vertexShader: V_HEAD + /* glsl */`
      varying vec2 vUv; varying float vFacing;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
        ${V_TAIL}
      }`,
    fragmentShader: F_HEAD + /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vUv; varying float vFacing;
      void main(){
        ${F_DEPTH}
        float along = 1.0 - vUv.y;               // 1 at the head, 0 at the tip
        float flick = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 18.0 + vUv.x * 6.283);
        float a = pow(along, ${power.toFixed(1)}) * pow(vFacing, 1.6) * flick * uAlpha;
        gl_FragColor = vec4(uColor * (1.0 + along * 2.0), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// Unit cone: radius 1 at the origin, tip at z = -1.
export const TAIL_GEO = new THREE.CylinderGeometry(0, 1, 1, 16, 8, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);

export class SpaceMeteors {
  constructor(game, count = 6) {
    this.game = game;
    this.geos = [0, 1, 2].map((i) => rockGeometry(4400 + i * 31));
    this.rockMat = new THREE.MeshStandardMaterial({
      map: texture('asteroid_diff.jpg', { srgb: true, repeat: 1 }),
      normalMap: texture('asteroid_nor.jpg', { repeat: 1 }),
      roughness: 0.95, metalness: 0.1,
      emissive: new THREE.Color(1, 0.38, 0.12), emissiveIntensity: 0.6,
    });
    this.glowTex = glowTexture();
    this.pool = [];
    for (let i = 0; i < count; i++) this.pool.push(this.make(i));
    this.timer = 3;
    this.skyTimer = 6;
  }

  make(i) {
    const root = new THREE.Group();
    root.name = 'meteor';
    const rock = new THREE.Mesh(this.geos[i % this.geos.length], this.rockMat);
    const dust = new THREE.Mesh(TAIL_GEO, tailMaterial([1, 0.72, 0.42], 2.2));
    const ion = new THREE.Mesh(TAIL_GEO, tailMaterial([0.35, 0.65, 1.0], 2.4));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    for (const o of [dust, ion, glow]) { o.frustumCulled = false; o.renderOrder = 3; }
    root.add(rock, dust, ion, glow);
    root.visible = false;
    return { root, rock, dust, ion, glow, vel: new THREE.Vector3(), spin: new THREE.Vector3(), size: 1, life: 0, active: false, missed: false };
  }

  // Launch one meteoroid on a path that crosses close to the ship.
  spawn(ship, frame) {
    const m = this.pool.find((p) => !p.active);
    if (!m) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.root.quaternion);
    const rnd = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    // Aim point: ahead of the ship, offset sideways so most fly by.
    const lead = Math.min(2500, 300 + ship.speed * 2.5);
    const aim = ship.root.position.clone().addScaledVector(fwd, lead).addScaledVector(rnd(), 40 + Math.random() * 450);
    const dir = rnd().addScaledVector(fwd, -0.3).normalize();
    const speed = 220 + Math.random() * 520;
    const start = aim.clone().addScaledVector(dir, -(1800 + Math.random() * 1600));
    m.size = 2 + Math.random() * Math.random() * 14;
    m.vel.copy(dir).multiplyScalar(speed).add(ship.vel.clone().multiplyScalar(0.0));
    m.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.5);
    m.root.position.copy(start);
    m.rock.scale.setScalar(m.size);
    const tailLen = m.size * (14 + Math.random() * 18);
    m.dust.scale.set(m.size * 1.6, m.size * 1.6, tailLen);
    m.ion.scale.set(m.size * 0.55, m.size * 0.55, tailLen * 2.2);
    m.glow.scale.setScalar(m.size * 9);
    m.life = 0;
    m.active = true;
    m.missed = false;
    m.root.visible = true;
    if (m.root.parent !== frame) frame.add(m.root);
  }

  release(m) {
    m.active = false;
    m.root.visible = false;
    m.root.removeFromParent();
  }

  update(dt, { inSpace, daylight, body, weatherClear }) {
    const game = this.game;
    const ship = game.ship;
    const piloting = game.mode === 'pilot' && ship && !ship.landed && !ship.docked;
    const frame = ship?.root.parent;
    if (inSpace && piloting && frame) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // Mostly singles, sometimes a swarm.
        const n = Math.random() < 0.18 ? 3 + Math.floor(Math.random() * 3) : 1;
        for (let i = 0; i < n; i++) this.spawn(ship, frame);
        this.timer = 4 + Math.random() * 9;
      }
    }
    for (const m of this.pool) {
      if (!m.active) continue;
      if (!frame || m.root.parent !== frame) { this.release(m); continue; }
      m.life += dt;
      m.root.position.addScaledVector(m.vel, dt);
      m.rock.rotation.x += m.spin.x * dt;
      m.rock.rotation.y += m.spin.y * dt;
      m.root.lookAt(tv.copy(m.root.position).add(m.vel).applyMatrix4(frame.matrixWorld));
      m.dust.material.uniforms.uTime.value = m.ion.material.uniforms.uTime.value = m.life;
      const fade = Math.min(1, m.life / 0.8);
      m.dust.material.uniforms.uAlpha.value = 0.55 * fade;
      m.ion.material.uniforms.uAlpha.value = 0.4 * fade;
      m.glow.material.opacity = 0.9 * fade;
      const d = m.root.position.distanceTo(ship.root.position);
      if (!m.missed && d < 90 + m.size * 4) {
        m.missed = true;
        if (d < m.size + 7) {
          const broken = ship.systems.applyDamage(8 + m.size);
          game.onShipDamaged?.(broken, 12);
          game.audio?.play('crash');
          ship.shake = 1;
        } else {
          game.audio?.play('whoosh');
          ship.shake = Math.max(ship.shake, 0.45);
        }
      }
      // Gone once it has passed the ship and is far away.
      const receding = tv.copy(m.root.position).sub(ship.root.position).dot(m.vel) > 0;
      if ((receding && d > 4500) || m.life > 30) this.release(m);
    }
    // Shooting stars over a clear night sky.
    if (!inSpace && body && daylight < 0.25 && weatherClear && game.effects) {
      this.skyTimer -= dt;
      if (this.skyTimer <= 0) {
        this.skyTimer = 5 + Math.random() * 14;
        const cam = game.mode === 'pilot' ? ship.root.position : game.player?.pos;
        if (cam) {
          const up = cam.clone().normalize();
          const side = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          side.addScaledVector(up, -side.dot(up)).normalize();
          const h = body.radius + body.atmoHeight * 0.85;
          const a = cam.clone().addScaledVector(side, 1500 + Math.random() * 2500).normalize().multiplyScalar(h);
          const b = a.clone().addScaledVector(side, -(1200 + Math.random() * 1800)).normalize().multiplyScalar(h - body.atmoHeight * 0.25);
          game.effects.meteor(body, a, b, false);
        }
      }
    }
  }

  clear() {
    for (const m of this.pool) if (m.active) this.release(m);
  }
}
