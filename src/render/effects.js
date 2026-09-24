// Pooled visual effects: footprints, mining beam, scan pulse, particles
// (smoke, sparks, dust), meteors and impacts.
import * as THREE from 'three';

export class Effects {
  constructor(game) {
    this.game = game;
    this.footprints = [];
    this.fpIndex = 0;
    this.fpGeo = new THREE.PlaneGeometry(0.16, 0.3).rotateX(-Math.PI / 2);
    this.fpMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(this.fpGeo, this.fpMat);
      m.visible = false;
      m.renderOrder = 1;
      this.footprints.push(m);
    }
    const beamGeo = new THREE.CylinderGeometry(0.02, 0.05, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.2).multiplyScalar(3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.pulse = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 1), transparent: true, opacity: 0.3, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.pulse.visible = false;
    this.pulseT = 0;
    this.particles = [];
    this.pGeo = new THREE.IcosahedronGeometry(1, 0);
    this.meteors = [];
  }

  // Footprints only on soft ground.
  footprint(body, pos, forward, left, material) {
    if (!['snow', 'sand', 'mud'].includes(material)) return;
    const m = this.footprints[this.fpIndex];
    this.fpIndex = (this.fpIndex + 1) % this.footprints.length;
    if (m.parent !== body.spin) body.spin.add(m);
    const up = pos.clone().normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    m.position.copy(pos).addScaledVector(up, 0.03).addScaledVector(right, left ? -0.13 : 0.13);
    const mtx = new THREE.Matrix4().makeBasis(right, up, forward.clone().negate());
    m.quaternion.setFromRotationMatrix(mtx);
    m.visible = true;
    m.userData.age = 0;
  }

  clearFootprints() {
    for (const m of this.footprints) { m.visible = false; m.removeFromParent(); }
  }

  showBeam(parent, fromLocal, toLocal) {
    if (this.beam.parent !== parent) parent.add(this.beam);
    this.beam.visible = true;
    this.beam.position.copy(fromLocal);
    const d = toLocal.clone().sub(fromLocal);
    this.beam.scale.set(1, 1, d.length());
    this.beam.lookAt(parent.localToWorld(toLocal.clone()));
    this.beam.scale.x = this.beam.scale.y = 0.8 + Math.random() * 0.5;
  }

  hideBeam() {
    this.beam.visible = false;
  }

  scanPulse(parent, local, radius) {
    if (this.pulse.parent !== parent) parent.add(this.pulse);
    this.pulse.position.copy(local);
    this.pulse.visible = true;
    this.pulseT = 0;
    this.pulseR = radius;
  }

  burst(parent, local, { count = 12, color = 0xffffff, size = 0.15, speed = 4, life = 1.2, up = null, gravity = 0 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.pGeo, mat);
      m.scale.setScalar(size * (0.5 + Math.random()));
      m.position.copy(local);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      if (up) v.addScaledVector(up, speed * 0.6);
      parent.add(m);
      this.particles.push({ m, v, life, age: 0, gravity, up, mat });
    }
  }

  smoke(parent, local, up, scale = 3) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this.pGeo, mat);
      m.scale.setScalar(scale * (0.5 + Math.random()));
      m.position.copy(local).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(scale * 2));
      parent.add(m);
      this.particles.push({ m, v: up.clone().multiplyScalar(2 + Math.random() * 3), life: 8 + Math.random() * 6, age: 0, gravity: 0, grow: 0.25, mat });
    }
  }

  // A meteor streak crossing the sky, optionally impacting.
  meteor(body, fromLocal, toLocal, impact) {
    const geo = new THREE.CylinderGeometry(0.0, 3, 120, 6, 1, true).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(geo, mat);
    body.spin.add(m);
    m.position.copy(fromLocal);
    this.meteors.push({ m, body, from: fromLocal.clone(), to: toLocal.clone(), t: 0, dur: 2.2 + Math.random(), impact, mat });
  }

  update(dt) {
    for (const m of this.footprints) {
      if (!m.visible) continue;
      m.userData.age += dt;
      if (m.userData.age > 240) m.visible = false;
    }
    if (this.pulse.visible) {
      this.pulseT += dt;
      const k = this.pulseT / 1.2;
      this.pulse.scale.setScalar(Math.max(0.1, k * this.pulseR));
      this.pulse.material.opacity = 0.35 * (1 - k);
      if (k >= 1) this.pulse.visible = false;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      p.m.position.addScaledVector(p.v, dt);
      if (p.gravity && p.up) p.v.addScaledVector(p.up, -p.gravity * dt);
      if (p.grow) p.m.scale.multiplyScalar(1 + p.grow * dt);
      p.mat.opacity = Math.max(0, 0.9 * (1 - p.age / p.life));
      if (p.age >= p.life) {
        p.m.removeFromParent();
        this.particles.splice(i, 1);
        if (!this.particles.some((q) => q.mat === p.mat)) p.mat.dispose();
      }
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const me = this.meteors[i];
      me.t += dt;
      const k = Math.min(1, me.t / me.dur);
      me.m.position.lerpVectors(me.from, me.to, k);
      me.m.lookAt(me.body.spin.localToWorld(me.to.clone()));
      if (k >= 1) {
        me.m.removeFromParent();
        me.m.geometry.dispose();
        me.mat.dispose();
        this.meteors.splice(i, 1);
        if (me.impact) this.game.onMeteorImpact(me.body, me.to);
      }
    }
  }

  clearParticles() {
    for (const p of this.particles) p.m.removeFromParent();
    this.particles = [];
    for (const me of this.meteors) me.m.removeFromParent();
    this.meteors = [];
    this.hideBeam();
    this.pulse.visible = false;
  }
}
