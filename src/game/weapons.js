// Ship lasers: twin wing cannons with heat, glowing bolts, muzzle flashes,
// impacts on terrain and asteroids, explosions and physically simulated debris.
import * as THREE from 'three';

const BOLT_SPEED = 2200;
const FIRE_INTERVAL = 0.11;
const HEAT_PER_SHOT = 4.5;
const DEBRIS_MAX = 160;

export class Weapons {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.overheated = false;
    this.cooldown = 0;
    this.side = 1;
    this.bolts = [];
    this.debris = [];
    this.flashes = [];
    const boltGeo = new THREE.CylinderGeometry(0.18, 0.18, 14, 6, 1, true).rotateX(Math.PI / 2);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.35, 0.25).multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.boltGlowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.3, 0.2).multiplyScalar(1.5), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.boltGeo = boltGeo;
    this.glowGeo = new THREE.CylinderGeometry(0.6, 0.6, 16, 8, 1, true).rotateX(Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(boltGeo, this.boltMat);
      m.add(new THREE.Mesh(this.glowGeo, this.boltGlowMat));
      m.visible = false;
      m.frustumCulled = false;
      this.pool.push(m);
    }
    this.flashTex = radialTexture();
    this.debrisGeo = new THREE.IcosahedronGeometry(1, 1);
    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.95, flatShading: true });
    this.emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.2).multiplyScalar(3), toneMapped: false, transparent: true });
  }

  get root() {
    return this.game.universe.root;
  }

  update(dt, input) {
    const g = this.game;
    this.cooldown -= dt;
    const firing = g.mode === 'pilot' && input.held('mine') && g.ship.lb.phase === 'none' && !g.ship.landed && !g.ship.docked;
    if (this.overheated && this.heat < 35) this.overheated = false;
    if (firing && !this.overheated && this.cooldown <= 0) this.fire();
    if (!firing || this.overheated) this.heat = Math.max(0, this.heat - dt * 28);
    this.updateBolts(dt);
    this.updateDebris(dt);
    this.updateFlashes(dt);
  }

  fire() {
    const g = this.game;
    this.shots = (this.shots || 0) + 1;
    const ship = g.ship;
    this.cooldown = FIRE_INTERVAL;
    this.heat += HEAT_PER_SHOT;
    if (this.heat >= 100) { this.heat = 100; this.overheated = true; g.hud.toast('hud.weapons_overheated', 'warn'); }
    this.side = -this.side;
    const muzzleLocal = new THREE.Vector3(this.side * 8.2, 0.3, -4.4);
    const from = ship.root.localToWorld(muzzleLocal.clone());
    const q = ship.root.getWorldQuaternion(new THREE.Quaternion());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    // Converge on whatever is under the crosshair (or 1.2 km ahead).
    const eye = ship.root.localToWorld(new THREE.Vector3(0, 1.0, -20));
    const far = ship.root.localToWorld(new THREE.Vector3(0, 1.0, -3500));
    const target = g.asteroids.raycast(eye, far);
    const aim = target ? target.point : ship.root.localToWorld(new THREE.Vector3(0, 1.0, -1200));
    dir.copy(aim).sub(from).normalize();
    const shipVelW = ship.vel.clone().applyQuaternion(ship.root.parent.getWorldQuaternion(new THREE.Quaternion()));
    const mesh = this.pool.find((m) => !m.visible);
    if (!mesh) return;
    if (mesh.parent !== this.root) this.root.add(mesh);
    const rootInv = this.root.matrixWorld.clone().invert();
    mesh.position.copy(from).applyMatrix4(rootInv);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    mesh.visible = true;
    this.bolts.push({ mesh, vel: dir.multiplyScalar(BOLT_SPEED).add(shipVelW), life: 1.6 });
    this.flash(from, 6, 0.08, 0xff8a60);
    ship.shake = Math.max(ship.shake, 0.12);
    g.audio.play('laser');
  }

  updateBolts(dt) {
    const g = this.game;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const from = b.mesh.getWorldPosition(new THREE.Vector3());
      const to = from.clone().addScaledVector(b.vel, dt);
      let hit = g.asteroids.raycast(from, to);
      let hitPoint = hit?.point;
      if (!hit) {
        const body = g.universe.dominantBody(to);
        if (body) {
          const local = body.spin.worldToLocal(to.clone());
          if (body.altitude(local) < 0) hitPoint = to;
        }
      }
      if (hitPoint || b.life <= 0) {
        if (hitPoint) this.impact(hitPoint, hit);
        b.mesh.visible = false;
        this.bolts.splice(i, 1);
        continue;
      }
      b.mesh.position.addScaledVector(b.vel, dt);
    }
  }

  impact(point, hit) {
    const g = this.game;
    this.hits = (this.hits || 0) + (hit ? 1 : 0);
    this.impacts = (this.impacts || 0) + 1;
    this.flash(point, 18, 0.18, 0xffb070);
    this.spawnDebris(point, hit ? hit.rock.color : new THREE.Color(0.5, 0.45, 0.4), 3, 30, 0.4, true);
    if (!hit) return;
    const r = hit.rock;
    r.hp -= 22;
    r.color.lerp(new THREE.Color(1, 0.5, 0.3), 0.05);
    if (r.hp <= 0) this.explodeRock(r);
    else g.audio.play('hit');
  }

  explodeRock(r) {
    const g = this.game;
    const center = g.asteroids.worldPosOf(r);
    g.asteroids.destroy(r);
    this.flash(center, r.radius * 3.2, 0.6, 0xffc080);
    this.flash(center, r.radius * 1.6, 1.2, 0xff6a30);
    const n = Math.min(24, 8 + Math.floor(r.radius / 6));
    this.spawnDebris(center, r.color, n, 40 + r.radius * 0.4, r.radius * 0.18, false, r.radius);
    this.spawnDebris(center, r.color, 10, 70, 0.8, true, r.radius);
    const yieldN = Math.max(2, Math.round(r.radius / 5));
    const left = g.state.cargo.add(r.resource, yieldN);
    g.hud.pickup(r.resource, yieldN - left);
    g.state.addXP('piloting', 4);
    g.state.addXP('survival', 3);
    g.audio.play('explosion');
    const dist = center.distanceTo(g.ship.worldPosition(new THREE.Vector3()));
    g.ship.shake = Math.max(g.ship.shake, THREE.MathUtils.clamp(1 - dist / 2000, 0, 1));
    g.events.emit('asteroid:destroyed', { rock: r });
  }

  spawnDebris(worldPos, color, count, speed, size, embers, spread = 1) {
    const inv = this.root.matrixWorld.clone().invert();
    for (let i = 0; i < count; i++) {
      if (this.debris.length >= DEBRIS_MAX) {
        const old = this.debris.shift();
        old.mesh.removeFromParent();
        old.mat?.dispose?.();
      }
      const mat = embers ? this.emberMat.clone() : this.debrisMat.clone();
      if (!embers) mat.color.copy(color);
      const mesh = new THREE.Mesh(this.debrisGeo, mat);
      const s = embers ? size * (0.3 + Math.random()) : size * (0.4 + Math.random() * 1.2);
      mesh.scale.set(s, s * (0.5 + Math.random() * 0.8), s * (0.6 + Math.random() * 0.8));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      mesh.position.copy(worldPos).addScaledVector(dir, Math.random() * spread * 0.4).applyMatrix4(inv);
      this.root.add(mesh);
      this.debris.push({
        mesh, mat, embers,
        vel: dir.multiplyScalar(speed * (0.3 + Math.random() * 0.9)),
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4),
        life: embers ? 0.8 + Math.random() * 0.8 : 8 + Math.random() * 6,
        age: 0,
      });
    }
  }

  updateDebris(dt) {
    const g = this.game;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      // Gravity and drag near planets; free drift in space.
      const w = d.mesh.getWorldPosition(new THREE.Vector3());
      const body = g.universe.dominantBody(w);
      if (body) {
        const local = body.spin.worldToLocal(w.clone());
        const r = local.length();
        const down = body.anchor.getWorldPosition(new THREE.Vector3()).sub(w).normalize();
        d.vel.addScaledVector(down, body.gravityAt(local) * dt);
        d.vel.multiplyScalar(1 - Math.min(0.9, body.airDensity(local) * 0.4 * dt));
        if (body.altitude(local) < 0.3) {
          // bounce off the ground with friction
          const n = down.clone().negate();
          const vn = d.vel.dot(n);
          if (vn < 0) d.vel.addScaledVector(n, -vn * 1.4).multiplyScalar(0.6);
          d.spin.multiplyScalar(0.7);
        }
      }
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const fade = 1 - Math.max(0, (d.age - d.life * 0.7) / (d.life * 0.3));
      if (d.embers) { d.mat.opacity = fade; d.mesh.scale.multiplyScalar(0.985); }
      else if (fade < 1) { d.mat.transparent = true; d.mat.opacity = fade; }
      if (d.age >= d.life) {
        d.mesh.removeFromParent();
        d.mat.dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  flash(worldPos, size, life, color) {
    const mat = new THREE.SpriteMaterial({ map: this.flashTex, color: new THREE.Color(color).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(worldPos).applyMatrix4(this.root.matrixWorld.clone().invert());
    sp.scale.setScalar(size);
    this.root.add(sp);
    this.flashes.push({ sp, mat, life, age: 0, size });
  }

  updateFlashes(dt) {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const k = f.age / f.life;
      f.mat.opacity = Math.max(0, 1 - k);
      f.sp.scale.setScalar(f.size * (1 + k * 1.2));
      if (k >= 1) { f.sp.removeFromParent(); f.mat.dispose(); this.flashes.splice(i, 1); }
    }
  }

  clear() {
    for (const b of this.bolts) b.mesh.visible = false;
    this.bolts = [];
    for (const d of this.debris) { d.mesh.removeFromParent(); d.mat.dispose(); }
    this.debris = [];
    for (const f of this.flashes) { f.sp.removeFromParent(); f.mat.dispose(); }
    this.flashes = [];
    for (const m of this.pool) m.removeFromParent();
  }
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,220,180,0.8)');
  grd.addColorStop(0.5, 'rgba(255,140,60,0.25)');
  grd.addColorStop(1, 'rgba(255,100,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
