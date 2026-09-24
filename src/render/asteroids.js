// Asteroid fields: debris inside planetary rings and a belt around the star.
// Rocks are generated per cell around the ship (deterministic), drawn with
// instancing, spin, collide with the ship, and can be shot apart.
import * as THREE from 'three';
import { Noise3 } from '../core/noise.js';
import { RNG, hashInts, hashString } from '../core/rng.js';
import { texture } from './textures.js';

const VARIANTS = 6;
const CELL = 1400;
const RANGE = 7000;
const CAP = 900;

export function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const n = new Noise3(seed);
  const rng = new RNG(seed);
  const stretch = new THREE.Vector3(rng.range(0.7, 1.3), rng.range(0.6, 1.0), rng.range(0.8, 1.4));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let d = 1 + n.fbm(v.x * 1.6, v.y * 1.6, v.z * 1.6, 4) * 0.32 + n.ridged(v.x * 3, v.y * 3, v.z * 3, 2) * 0.12;
    const c = n.noise(v.x * 4 + 9, v.y * 4, v.z * 4);
    if (c > 0.45) d -= (c - 0.45) * 0.5; // craters
    v.multiplyScalar(d).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class AsteroidFields {
  constructor(game) {
    this.game = game;
    this.geos = Array.from({ length: VARIANTS }, (_, i) => rockGeometry(1000 + i * 77));
    this.material = new THREE.MeshStandardMaterial({
      map: texture('asteroid_diff.jpg', { srgb: true, repeat: 2 }),
      normalMap: texture('asteroid_nor.jpg', { repeat: 2 }),
      roughnessMap: texture('asteroid_rough.jpg', { repeat: 2 }),
      roughness: 1, metalness: 0.05, envMapIntensity: 0.6,
    });
    this.fields = [];
    this.destroyed = new Set();
  }

  setup(universe) {
    for (const f of this.fields) {
      for (const m of f.meshes) { m.removeFromParent(); m.dispose(); }
      if (f.ownFrame) f.frame.removeFromParent();
    }
    this.fields = [];
    this.destroyed = new Set(this.game.state.story.asteroids || []);
    for (const b of universe.bodies) {
      if (b.rings && b.def.rings) {
        const r = b.def.rings;
        // Rocks co-rotate with the planet's frame (the ship's frame near it),
        // so they do not sweep past the ship; the ring shader is symmetric.
        const frame = new THREE.Group();
        frame.rotation.copy(b.rings.rotation);
        b.spin.add(frame);
        frame.updateMatrixWorld(true);
        this.addField({ kind: 'ring', id: `${b.id}/ring`, frame, ownFrame: true, inner: r.inner, outer: r.outer, thickness: 260, tint: new THREE.Color(...r.color), density: 1.2, body: b });
      }
    }
    const belt = universe.system.belt;
    if (belt) {
      const frame = new THREE.Group();
      frame.rotation.x = -Math.PI / 2; // belt lies in the system's XZ plane, like rings in local XY
      universe.root.add(frame);
      frame.updateMatrixWorld(true);
      this.addField({ kind: 'belt', id: `${universe.system.id}/belt`, frame, inner: belt.radius - belt.width, outer: belt.radius + belt.width, thickness: belt.thickness, tint: new THREE.Color(...belt.color), density: 1, ownFrame: true });
    }
  }

  addField(f) {
    f.cells = new Map();
    f.rocks = [];
    f.meshes = this.geos.map((g) => {
      const m = new THREE.InstancedMesh(g, this.material, CAP);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      f.frame.add(m);
      return m;
    });
    f.seed = hashString(f.id);
    this.fields.push(f);
  }

  // Rocks for one cell (field-local XY plane, Z is thickness).
  cellRocks(f, cx, cy) {
    const ccx = (cx + 0.5) * CELL, ccy = (cy + 0.5) * CELL;
    const r = Math.hypot(ccx, ccy);
    if (r < f.inner - CELL || r > f.outer + CELL) return [];
    const edge = Math.min(r - f.inner, f.outer - r);
    const falloff = THREE.MathUtils.clamp(edge / 2500 + 0.2, 0, 1);
    const rng = new RNG(hashInts(f.seed, cx, cy));
    const n = Math.floor(rng.next() * 7 * f.density * falloff);
    const rocks = [];
    for (let i = 0; i < n; i++) {
      const id = `${f.id}:${cx}:${cy}:${i}`;
      if (this.destroyed.has(id)) { rng.next(); rng.next(); continue; }
      const big = rng.next();
      const radius = big > 0.97 ? rng.range(120, 260) : big > 0.8 ? rng.range(35, 90) : rng.range(6, 30);
      const pos = new THREE.Vector3(ccx + rng.range(-0.5, 0.5) * CELL, ccy + rng.range(-0.5, 0.5) * CELL, rng.range(-1, 1) * f.thickness);
      const axis = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
      const shade = rng.range(0.7, 1.15);
      rocks.push({
        id, pos, radius, variant: rng.int(0, VARIANTS - 1), axis, spin: rng.range(-0.15, 0.15) * (20 / radius), angle: rng.range(0, 6.28),
        hp: radius * 3, maxHp: radius * 3, color: f.tint.clone().multiplyScalar(shade), field: f,
        resource: radius > 100 ? 'aurum' : rng.pick(['ferrite', 'ferrite', 'cobalt', 'ice', 'oxyite']),
      });
    }
    return rocks;
  }

  update(dt, shipWorld) {
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (const f of this.fields) {
      const local = f.frame.worldToLocal(shipWorld.clone());
      const rad = Math.hypot(local.x, local.y);
      const near = Math.abs(local.z) < RANGE + f.thickness && rad > f.inner - RANGE && rad < f.outer + RANGE;
      f.near = near;
      if (!near) {
        if (f.cells.size) { f.cells.clear(); f.rocks = []; for (const mesh of f.meshes) mesh.count = 0; }
        continue;
      }
      // Stream cells in and out around the ship.
      const cx0 = Math.floor(local.x / CELL), cy0 = Math.floor(local.y / CELL);
      const R = Math.ceil(RANGE / CELL);
      const want = new Set();
      let changed = false;
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          if (dx * dx + dy * dy > R * R) continue;
          const key = `${cx0 + dx},${cy0 + dy}`;
          want.add(key);
          if (!f.cells.has(key)) { f.cells.set(key, this.cellRocks(f, cx0 + dx, cy0 + dy)); changed = true; }
        }
      }
      for (const key of f.cells.keys()) if (!want.has(key)) { f.cells.delete(key); changed = true; }
      if (changed || f.dirty) {
        f.rocks = [];
        for (const list of f.cells.values()) for (const r of list) if (r.hp > 0) f.rocks.push(r);
        f.dirty = false;
      }
      const counts = new Array(VARIANTS).fill(0);
      for (const r of f.rocks) {
        r.angle += r.spin * dt;
        if (r.vel) r.pos.addScaledVector(r.vel, dt);
        const c = counts[r.variant];
        if (c >= CAP) continue;
        q.setFromAxisAngle(r.axis, r.angle);
        s.setScalar(r.radius);
        m.compose(r.pos, q, s);
        const mesh = f.meshes[r.variant];
        mesh.setMatrixAt(c, m);
        mesh.setColorAt(c, r.color);
        counts[r.variant] = c + 1;
      }
      f.meshes.forEach((mesh, i) => {
        mesh.count = counts[i];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
  }

  // Closest rock hit by a world-space segment, or null.
  raycast(fromW, toW) {
    let best = null, bt = Infinity;
    for (const f of this.fields) {
      if (!f.near || !f.rocks.length) continue;
      const a = f.frame.worldToLocal(fromW.clone());
      const b = f.frame.worldToLocal(toW.clone());
      const d = b.clone().sub(a);
      const len = d.length();
      if (len < 1e-6) continue;
      d.divideScalar(len);
      for (const r of f.rocks) {
        const oc = a.clone().sub(r.pos);
        const bb = oc.dot(d);
        const c = oc.lengthSq() - (r.radius * 0.95) ** 2;
        const h = bb * bb - c;
        if (h < 0) continue;
        const t = -bb - Math.sqrt(h);
        if (t >= 0 && t <= len && t < bt) { bt = t; best = { rock: r, field: f, point: f.frame.localToWorld(a.clone().addScaledVector(d, t)) }; }
      }
    }
    return best;
  }

  // Sphere overlap against the ship: returns {rock, normalWorld, depth}.
  collide(worldPos, radius) {
    for (const f of this.fields) {
      if (!f.near) continue;
      const p = f.frame.worldToLocal(worldPos.clone());
      for (const r of f.rocks) {
        const d = p.distanceTo(r.pos);
        const lim = r.radius * 0.9 + radius;
        if (d < lim) {
          const nLocal = p.clone().sub(r.pos).normalize();
          const nW = f.frame.localToWorld(nLocal.clone().add(r.pos)).sub(f.frame.localToWorld(r.pos.clone())).normalize();
          return { rock: r, normal: nW, depth: lim - d };
        }
      }
    }
    return null;
  }

  destroy(rock) {
    rock.hp = 0;
    rock.field.dirty = true;
    this.destroyed.add(rock.id);
    const st = this.game.state;
    st.story.asteroids = [...this.destroyed].slice(-3000);
  }

  worldPosOf(rock) {
    return rock.field.frame.localToWorld(rock.pos.clone());
  }

  // Rock closest to the aim line within a cone (aim assist). Returns the
  // rock's world centre or null.
  aimAssist(eye, dir, maxAngle = 0.06, maxDist = 3500) {
    let best = null, bestA = maxAngle;
    const v = new THREE.Vector3();
    for (const f of this.fields) {
      if (!f.near) continue;
      for (const r of f.rocks) {
        if (r.hp <= 0) continue;
        v.copy(r.pos).applyMatrix4(f.frame.matrixWorld).sub(eye);
        const d = v.length();
        if (d > maxDist || d < 1) continue;
        const a = Math.acos(Math.min(1, v.dot(dir) / d)) - Math.atan(r.radius / d);
        if (a < bestA) { bestA = a; best = v.clone().add(eye); }
      }
    }
    return best;
  }

  nearestRock(worldPos) {
    let best = null, bd = Infinity;
    for (const f of this.fields) {
      if (!f.near) continue;
      const p = f.frame.worldToLocal(worldPos.clone());
      for (const r of f.rocks) { const d = p.distanceTo(r.pos) - r.radius; if (d < bd) { bd = d; best = r; } }
    }
    return best ? { rock: best, distance: bd } : null;
  }
}
