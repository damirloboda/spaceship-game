// Living creatures with a simple food chain: herbivores graze and flee,
// predators hunt herbivores, apex giants roam. Populations shift when
// predators eat, and spawn rates follow those populations.
import * as THREE from 'three';
import { RNG, hashString } from '../core/rng.js';
import { creatureModel } from './models.js';
import { creatureModelFor, animatedInstance } from './modelLib.js';

const tmpUp = new THREE.Vector3();
const tmpF = new THREE.Vector3();
const tmpR = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

export function orientOnSurface(obj, up, forward) {
  tmpR.crossVectors(forward, up).normalize();
  if (tmpR.lengthSq() < 1e-6) tmpR.set(1, 0, 0);
  tmpF.crossVectors(up, tmpR).normalize();
  // Object faces -Z, so the basis is (right, up, -forward).
  tmpM.makeBasis(tmpR, up, tmpF.clone().negate());
  obj.quaternion.setFromRotationMatrix(tmpM);
}

export class Fauna {
  constructor(body, species, { max = 20, ecosystem = {} } = {}) {
    this.body = body;
    this.surface = body.surface;
    this.species = species;
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'fauna';
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, flatShading: true });
    this.glowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, flatShading: true, emissive: new THREE.Color(0.25, 0.4, 0.45) });
    this.templates = new Map();
    this.creatures = [];
    this.spawnTimer = 0;
    this.rng = new RNG(body.def.seed ^ 0xa11);
    this.ecosystem = ecosystem; // speciesId -> population 0..1.5
    for (const sp of species) if (this.ecosystem[sp.id] === undefined) this.ecosystem[sp.id] = 1;
    this.events = [];
  }

  // Hand-made animated model for a species (stable per species), or null.
  modelName(sp) {
    if (!this.modelNames) this.modelNames = new Map();
    if (!this.modelNames.has(sp.id)) this.modelNames.set(sp.id, creatureModelFor(this.body.def.type, sp, new RNG(hashString(sp.id))));
    return this.modelNames.get(sp.id);
  }

  makeCreatureObject(sp) {
    const name = this.modelName(sp);
    const inst = name ? animatedInstance(name, Math.max(0.9, sp.size * 1.25), { byLength: true }) : null;
    if (inst) {
      const obj = inst.root;
      obj.legs = [];
      obj.wings = [];
      return { obj, anim: inst };
    }
    const obj = this.template(sp).clone();
    obj.legs = obj.userData.legIdx.map((i) => obj.children[i]);
    obj.wings = obj.userData.wingIdx.map((i) => obj.children[i]);
    obj.legs.forEach((leg, i) => { leg.userData.phase = (i % 4 < 2 ? 0 : Math.PI) + (i % 2 ? Math.PI : 0); });
    return { obj, anim: null };
  }

  template(sp) {
    if (!this.templates.has(sp.id)) this.templates.set(sp.id, creatureModel(sp, sp.glow ? this.glowMaterial : this.material));
    return this.templates.get(sp.id);
  }

  groundAt(dir) {
    const s = this.surface;
    const h = s.heightAt(dir.x, dir.y, dir.z);
    return { r: s.radius + h, h };
  }

  spawnNear(center, sp, count, rng) {
    const up = center.clone().normalize();
    const t1 = new THREE.Vector3(1, 0, 0).cross(up);
    if (t1.lengthSq() < 1e-4) t1.set(0, 0, 1).cross(up);
    t1.normalize();
    const t2 = up.clone().cross(t1);
    for (let i = 0; i < count && this.creatures.length < this.max; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 8 + sp.size * 3);
      const dir = up.clone().addScaledVector(t1, (Math.cos(a) * d) / this.surface.radius).addScaledVector(t2, (Math.sin(a) * d) / this.surface.radius).normalize();
      const g = this.groundAt(dir);
      if (this.surface.hasOcean && g.h < 0.5) continue;
      const { obj, anim } = this.makeCreatureObject(sp);
      const hover = sp.flying ? rng.range(6, 18) : 0;
      const pos = dir.clone().multiplyScalar(g.r + hover);
      obj.position.copy(pos);
      const heading = t1.clone().applyAxisAngle(up, rng.range(0, Math.PI * 2));
      orientOnSurface(obj, up, heading);
      this.group.add(obj);
      this.creatures.push({
        sp, obj, anim, pos, heading, hover, hp: 25 + sp.size * 20, dying: 0, provoked: false, state: 'wander', timer: rng.range(1, 4), target: null, speed: 0, phase: rng.range(0, 10), attackCd: 0, alive: true, scanned: false,
      });
    }
  }

  pickSpecies(biome, rng) {
    const opts = this.species
      .filter((sp) => sp.habitats.includes(biome) || rng.chance(0.15))
      .map((sp) => ({ v: sp, w: (sp.tier === 1 ? 3 : sp.tier === 4 ? 0.4 : 1) * (this.ecosystem[sp.id] ?? 1) }));
    return opts.length ? rng.weighted(opts) : null;
  }

  update(dt, playerLocal, ctx = {}) {
    if (!this.species.length) return;
    const s = this.surface;
    const R = s.radius;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && playerLocal) {
      this.spawnTimer = 1.5;
      const alt = playerLocal.length() - R;
      if (this.creatures.length < this.max && alt < 800) {
        const rng = this.rng;
        const up = playerLocal.clone().normalize();
        const rnd = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).cross(up).normalize();
        const dist = rng.range(70, 220);
        const dir = up.clone().addScaledVector(rnd, dist / R).normalize();
        const g = this.groundAt(dir);
        if (!(s.hasOcean && g.h < 1)) {
          const biome = s.biomeAt(dir.x, dir.y, dir.z, g.h, 0);
          const sp = this.pickSpecies(biome, rng);
          if (sp) this.spawnNear(dir.clone().multiplyScalar(g.r), sp, sp.herd, rng);
        }
      }
    }
    // Ecosystem recovers slowly toward balance.
    for (const id in this.ecosystem) this.ecosystem[id] += (1 - this.ecosystem[id]) * Math.min(1, dt / 600);
    const t = (this.time = (this.time || 0) + dt);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dp = playerLocal ? c.pos.distanceTo(playerLocal) : Infinity;
      if (dp > 420) { c.alive = false; continue; }
      if (c.dying > 0) {
        // Death animation, then the body fades out of the world.
        c.dying -= dt;
        if (c.anim) c.anim.update(dt);
        else c.obj.scale.setScalar(Math.max(0.01, c.dying / 2.5));
        if (c.dying <= 0) c.alive = false;
        continue;
      }
      this.think(c, dt, playerLocal, dp, ctx);
      // Move along the tangent plane then snap to the ground.
      const up = tmpUp.copy(c.pos).normalize();
      c.heading.addScaledVector(up, -c.heading.dot(up)).normalize();
      c.pos.addScaledVector(c.heading, c.speed * dt);
      up.copy(c.pos).normalize();
      const g = this.groundAt(up);
      if (s.hasOcean && g.h < 0.2 && !c.sp.flying) {
        // Avoid walking into the sea: turn around.
        c.heading.negate();
        c.pos.addScaledVector(c.heading, c.speed * dt * 2);
        up.copy(c.pos).normalize();
      }
      const bob = c.sp.flying ? Math.sin(t * 2 + c.phase) * 0.6 : 0;
      const ground = this.groundAt(up).r + c.hover + bob;
      c.pos.copy(up).multiplyScalar(ground);
      c.obj.position.copy(c.pos);
      orientOnSurface(c.obj, up, c.heading);
      // Animation
      if (c.anim) {
        c.attackAnim = Math.max(0, (c.attackAnim || 0) - dt);
        const run = c.speed > c.sp.speed * 0.6;
        const state = c.attackAnim > 0 ? 'attack' : c.speed > 0.15 ? (run ? 'run' : 'walk') : 'idle';
        const rate = state === 'walk' ? THREE.MathUtils.clamp(c.speed / Math.max(0.5, c.sp.speed * 0.35), 0.6, 1.6) : 1;
        c.anim.play(state, 0.3, rate);
        // Far creatures animate at a lower rate.
        c.animAcc = (c.animAcc || 0) + dt;
        if (dp < 120 || c.animAcc > 0.1) { c.anim.update(c.animAcc); c.animAcc = 0; }
        continue;
      }
      const k = Math.min(1, c.speed / Math.max(1, c.sp.speed * 0.5));
      for (const leg of c.obj.legs) leg.rotation.x = Math.sin(t * (4 + c.speed * 1.2) + leg.userData.phase) * 0.6 * k;
      for (const w of c.obj.wings) w.rotation.z = Math.sin(t * 9 + c.phase) * 0.6 * w.scale.x;
    }
    // Remove dead / despawned creatures.
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      if (!this.creatures[i].alive) {
        this.group.remove(this.creatures[i].obj);
        this.creatures[i].anim?.dispose();
        this.creatures.splice(i, 1);
      }
    }
  }

  think(c, dt, playerLocal, dp, ctx) {
    const sp = c.sp;
    c.timer -= dt;
    c.attackCd -= dt;
    const rng = this.rng;
    if (sp.tier === 1 || sp.tier === 2) {
      // Flee from predators and a close player.
      const threat = this.nearest(c, (o) => o.sp.tier >= 3, 26);
      const scaredOfPlayer = sp.temperament === 'timid' && dp < 10;
      if (threat || scaredOfPlayer) {
        const from = threat ? threat.pos : playerLocal;
        c.heading.subVectors(c.pos, from).normalize();
        c.speed = sp.speed;
        c.state = 'flee';
        c.timer = 2;
        return;
      }
    }
    if (sp.tier >= 3) {
      const prey = this.nearest(c, (o) => o.sp.tier < sp.tier && o.sp.size < sp.size * 1.6, 45);
      const hostile = c.provoked || (ctx.hostile && (sp.temperament === 'aggressive' || (sp.temperament === 'territorial' && dp < 12)));
      if (hostile && dp < 30 && playerLocal) {
        c.heading.subVectors(playerLocal, c.pos).normalize();
        c.speed = sp.speed * 0.8;
        c.state = 'attack';
        if (dp < 2 + sp.size * 0.6 && c.attackCd <= 0) {
          c.attackCd = 1.6;
          this.events.push({ type: 'attack', damage: 4 + sp.size * 2, species: sp });
          c.attackAnim = 0.8;
          c.heading.negate();
        }
        return;
      }
      if (prey && c.state !== 'rest') {
        c.heading.subVectors(prey.pos, c.pos).normalize();
        c.speed = sp.speed;
        c.state = 'hunt';
        if (c.pos.distanceTo(prey.pos) < 1.5 + (sp.size + prey.sp.size) * 0.4) {
          c.attackAnim = 0.8;
          prey.alive = false;
          this.ecosystem[prey.sp.id] = Math.max(0.2, (this.ecosystem[prey.sp.id] ?? 1) - 0.04);
          this.ecosystem[sp.id] = Math.min(1.5, (this.ecosystem[sp.id] ?? 1) + 0.02);
          this.events.push({ type: 'predation', predator: sp, prey: prey.sp, pos: prey.pos.clone() });
          c.state = 'rest';
          c.timer = 12;
          c.speed = 0;
        }
        return;
      }
    }
    if (c.timer <= 0) {
      c.timer = rng.range(2, 7);
      if (c.state === 'rest' || rng.chance(0.4)) {
        c.state = 'graze';
        c.speed = 0;
      } else {
        c.state = 'wander';
        const up = c.pos.clone().normalize();
        c.heading.applyAxisAngle(up, rng.range(-1.5, 1.5));
        c.speed = sp.speed * rng.range(0.2, 0.45);
      }
    }
  }

  nearest(c, filter, radius) {
    let best = null, bd = radius;
    for (const o of this.creatures) {
      if (o === c || !o.alive || o.dying > 0 || !filter(o)) continue;
      const d = o.pos.distanceTo(c.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // Living creature closest to an aim ray (body-local eye + unit direction).
  inAim(eye, dir, range = 45, cone = 0.1) {
    let best = null, bestA = Infinity;
    const v = new THREE.Vector3();
    for (const c of this.creatures) {
      if (!c.alive || c.dying > 0) continue;
      v.copy(c.pos).addScaledVector(tmpUp.copy(c.pos).normalize(), c.sp.size * 0.45).sub(eye);
      const d = v.length();
      if (d > range || d < 0.3) continue;
      const a = Math.acos(Math.min(1, v.dot(dir) / d)) - Math.atan((c.sp.size * 0.6) / d);
      if (a < cone && a < bestA) { bestA = a; best = c; }
    }
    return best;
  }

  // Hurt a creature: prey flees, predators turn on the attacker.
  damage(c, amount, fromPos) {
    if (!c.alive || c.dying > 0) return false;
    c.hp -= amount;
    if (c.sp.tier >= 3) c.provoked = true;
    else if (fromPos) {
      c.heading.subVectors(c.pos, fromPos).normalize();
      c.speed = c.sp.speed;
      c.state = 'flee';
      c.timer = 4;
    }
    if (c.hp > 0) return false;
    c.dying = 2.5;
    c.speed = 0;
    c.anim?.play('death', 0.15);
    this.ecosystem[c.sp.id] = Math.max(0.2, (this.ecosystem[c.sp.id] ?? 1) - 0.05);
    this.events.push({ type: 'killed', species: c.sp, pos: c.pos.clone() });
    return true;
  }

  near(pos, radius) {
    return this.creatures.filter((c) => c.alive && c.pos.distanceTo(pos) < radius);
  }

  // Test / debug helper
  spawnAt(pos, sp) {
    this.spawnNear(pos, sp || this.species[0], 1, this.rng);
    return this.creatures[this.creatures.length - 1];
  }

  clear() {
    for (const c of this.creatures) { this.group.remove(c.obj); c.anim?.dispose(); }
    this.creatures = [];
  }

  dispose() {
    this.clear();
    for (const tpl of this.templates.values()) tpl.traverse((o) => o.geometry?.dispose());
    this.material.dispose();
    this.glowMaterial.dispose();
  }
}
