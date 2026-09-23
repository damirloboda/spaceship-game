// Skimmer: a hover-bike for fast surface travel. Stored in the base garage
// or summoned next to the landed ship.
import * as THREE from 'three';
import { colorize, merge } from '../render/models.js';
import { orientOnSurface } from '../render/fauna.js';

export class Skimmer {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'skimmer';
    const parts = [];
    const hull = new THREE.CapsuleGeometry(0.7, 2.6, 4, 10);
    hull.rotateX(Math.PI / 2); hull.scale(1, 0.5, 1); hull.translate(0, 0.9, 0);
    parts.push(colorize(hull, [0.2, 0.55, 0.85]));
    const seat = new THREE.BoxGeometry(0.6, 0.25, 1.1); seat.translate(0, 1.3, 0.4);
    parts.push(colorize(seat, [0.15, 0.15, 0.17]));
    const bar = new THREE.BoxGeometry(1.2, 0.08, 0.08); bar.translate(0, 1.55, -0.7);
    parts.push(colorize(bar, [0.3, 0.3, 0.32]));
    for (const x of [-0.85, 0.85]) {
      const pod = new THREE.CylinderGeometry(0.28, 0.32, 1.8, 10); pod.rotateX(Math.PI / 2); pod.translate(x, 0.6, 0.2);
      parts.push(colorize(pod, [0.9, 0.9, 0.92]));
    }
    this.mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5 }));
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 1).multiplyScalar(2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.position.y = 0.2;
    this.root.add(glow);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.body = null;
    this.active = false;
    this.speed = 0;
  }

  deploy(body, local, forward) {
    this.body = body;
    body.spin.add(this.root);
    this.pos.copy(local);
    this.forward.copy(forward);
    this.vel.set(0, 0, 0);
    this.active = true;
    this.root.visible = true;
    this.snap(0);
  }

  stow() {
    this.active = false;
    this.root.removeFromParent();
  }

  snap(dt) {
    const up = this.pos.clone().normalize();
    const surf = this.body.surfaceRadius(up) + 1.1;
    const r = this.pos.length();
    const target = Math.max(surf, r - 9.8 * dt * 2);
    this.pos.copy(up).multiplyScalar(r < surf ? surf : target);
    this.forward.addScaledVector(up, -this.forward.dot(up)).normalize();
    this.root.position.copy(this.pos);
    orientOnSurface(this.root, up, this.forward);
  }

  update(dt, input, driving) {
    if (!this.active || !this.body) return;
    const up = this.pos.clone().normalize();
    if (driving) {
      const mv = input.move();
      const look = input.lookDelta(dt);
      this.forward.applyAxisAngle(up, -mv.x * dt * 1.8 - look.x);
      const boost = input.held('sprint') ? 1.6 : 1;
      const wish = this.forward.clone().multiplyScalar(mv.y * 32 * boost);
      const vt = this.vel.clone().addScaledVector(up, -this.vel.dot(up));
      vt.lerp(wish, 1 - Math.exp(-(mv.y ? 1.4 : 0.8) * dt));
      this.vel.copy(vt);
      if (input.pressed('jump')) this.vel.addScaledVector(up, 7);
    } else {
      this.vel.multiplyScalar(Math.exp(-3 * dt));
    }
    // vertical: gravity pulls down to hover height
    const vr = this.vel.dot(up) - 9.8 * dt;
    this.vel.addScaledVector(up, vr - this.vel.dot(up));
    this.pos.addScaledVector(this.vel, dt);
    const r = this.pos.length();
    const surf = this.body.surfaceRadius(up) + 1.1;
    if (r < surf) {
      this.pos.copy(up).multiplyScalar(surf);
      const v2 = this.vel.dot(up);
      if (v2 < 0) this.vel.addScaledVector(up, -v2);
    }
    // obstacles
    const push = this.body.scatter.collide(this.pos, 1.2);
    const city = this.body.city?.collide(this.pos, 1.2);
    if (city) push.add(city);
    if (push.lengthSq()) { this.pos.add(push); this.vel.multiplyScalar(0.7); }
    this.speed = this.vel.length();
    this.forward.addScaledVector(up, -this.forward.dot(up)).normalize();
    this.root.position.copy(this.pos);
    orientOnSurface(this.root, up, this.forward);
    if (driving) {
      this.game.state.stats.distance += this.speed * dt;
      this.game.state.addXP('piloting', dt * 0.05 * Math.min(1, this.speed / 20));
    }
  }
}
