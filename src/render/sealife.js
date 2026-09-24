// Ocean life around a swimming player: schools of reef fish, rays, dolphins,
// the odd shark and a distant whale. Purely ambient (no ecosystem), spawned
// near the player only while they are in the water.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { animatedInstance, hasModel } from './modelLib.js';
import { orientOnSurface } from './fauna.js';

const KINDS = [
  { name: 'Fish1', w: 5, size: 0.7, speed: 2.4, school: [3, 6] },
  { name: 'Fish2', w: 4, size: 0.6, speed: 2.0, school: [3, 5] },
  { name: 'Fish3', w: 4, size: 0.45, speed: 2.2, school: [4, 7] },
  { name: 'Manta_ray', w: 1.2, size: 3.2, speed: 1.6, school: [1, 2] },
  { name: 'Dolphin', w: 1.2, size: 2.4, speed: 5.5, school: [2, 4] },
  { name: 'Shark', w: 0.7, size: 3.6, speed: 3.2, school: [1, 1] },
  { name: 'Whale', w: 0.3, size: 16, speed: 2.2, school: [1, 1], far: true },
];

const tUp = new THREE.Vector3();

export class SeaLife {
  constructor(body) {
    this.body = body;
    this.surface = body.surface;
    this.group = new THREE.Group();
    this.group.name = 'sealife';
    body.spin.add(this.group);
    this.fish = [];
    this.timer = 0;
    this.rng = new RNG(body.def.seed ^ 0x5ea);
    this.kinds = KINDS.filter((k) => hasModel(k.name));
    this.max = 18;
  }

  update(dt, playerLocal, inWater) {
    if (!this.kinds.length) return;
    this.timer -= dt;
    if (inWater && playerLocal && this.timer <= 0 && this.fish.length < this.max) {
      this.timer = 1.2;
      this.spawn(playerLocal);
    }
    const R = this.surface.radius;
    for (const f of this.fish) {
      const d = playerLocal ? f.pos.distanceTo(playerLocal) : Infinity;
      if (d > (f.kind.far ? 260 : 140) || !inWater && d > 60) { f.dead = true; continue; }
      f.turn -= dt;
      const up = tUp.copy(f.pos).normalize();
      if (f.turn <= 0) {
        f.turn = this.rng.range(2, 6);
        f.heading.applyAxisAngle(up, this.rng.range(-0.9, 0.9));
      }
      f.heading.addScaledVector(up, -f.heading.dot(up)).normalize();
      f.pos.addScaledVector(f.heading, f.kind.speed * dt);
      // Stay between the sea floor and the surface.
      const dir = up.copy(f.pos).normalize();
      const floor = R + this.surface.heightAt(dir.x, dir.y, dir.z) + f.kind.size * 0.6 + 0.5;
      const top = R - 1.2 - f.kind.size * 0.3;
      if (floor > top) { f.heading.negate(); f.pos.addScaledVector(f.heading, f.kind.speed * dt * 2); }
      const bob = Math.sin((f.t += dt) * 1.3) * 0.3;
      const r = THREE.MathUtils.clamp(f.depthR + bob, Math.min(floor, top), top);
      f.pos.copy(dir).multiplyScalar(r);
      f.anim.root.position.copy(f.pos);
      orientOnSurface(f.anim.root, dir, f.heading);
      f.anim.play('walk', 0.3, 0.8 + f.kind.speed * 0.1);
      f.anim.update(dt);
    }
    for (let i = this.fish.length - 1; i >= 0; i--) {
      if (!this.fish[i].dead) continue;
      this.group.remove(this.fish[i].anim.root);
      this.fish[i].anim.dispose();
      this.fish.splice(i, 1);
    }
  }

  spawn(playerLocal) {
    const rng = this.rng;
    const kind = rng.weighted(this.kinds.map((k) => ({ v: k, w: k.w })));
    const R = this.surface.radius;
    const up = playerLocal.clone().normalize();
    const side = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).cross(up).normalize();
    const dist = kind.far ? rng.range(90, 150) : rng.range(14, 38);
    const center = up.clone().addScaledVector(side, dist / R).normalize();
    const ground = R + this.surface.heightAt(center.x, center.y, center.z);
    if (ground > R - 2 - kind.size) return; // too shallow for this one
    const heading = side.clone().cross(up).normalize().applyAxisAngle(up, rng.range(-1, 1));
    const n = rng.int(kind.school[0], kind.school[1]);
    for (let i = 0; i < n && this.fish.length < this.max; i++) {
      const anim = animatedInstance(kind.name, kind.size * rng.range(0.85, 1.15), { byLength: true, yaw: Math.PI });
      if (!anim) return;
      const off = new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).multiplyScalar(kind.size * 2.5);
      const dir = center.clone().addScaledVector(side, off.x / R).addScaledVector(heading, off.z / R).normalize();
      const depthR = THREE.MathUtils.lerp(Math.max(ground + kind.size, R - 24), R - 1.5 - kind.size * 0.3, rng.range(0.15, 0.9));
      const pos = dir.multiplyScalar(depthR);
      this.group.add(anim.root);
      this.fish.push({ kind, anim, pos, depthR, heading: heading.clone(), turn: rng.range(1, 4), t: rng.range(0, 10) });
    }
  }

  dispose() {
    for (const f of this.fish) { this.group.remove(f.anim.root); f.anim.dispose(); }
    this.fish = [];
    this.group.removeFromParent();
  }
}
