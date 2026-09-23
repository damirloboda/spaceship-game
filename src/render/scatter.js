// Plants and resource deposits scattered over terrain chunks. Placement is
// deterministic per chunk (same planet = same forest). Rendered with one
// InstancedMesh per species, rebuilt only when the set of chunks changes.
import * as THREE from 'three';
import { RNG, hashMix, hashString } from '../core/rng.js';
import { floraModelFor, staticParts } from './modelLib.js';
import { cubeToSphere } from './terrain.js';
import { plantGeometry, depositGeometry, DEPOSIT_TYPES } from './models.js';

const UP = new THREE.Vector3(0, 1, 0);

const DEPOSIT_WEIGHTS = {
  terran: { ferrite: 4, carbon: 4, cobalt: 2, oxyite: 1.5, aurum: 0.3 },
  ocean: { ferrite: 3, carbon: 3, cobalt: 2, oxyite: 2, aurum: 0.3 },
  desert: { ferrite: 5, cobalt: 1.5, aurum: 0.8, oxyite: 0.5 },
  ice: { ice: 5, ferrite: 2, cobalt: 2, aurum: 0.4 },
  lava: { ferrite: 3, oxyite: 3, aurum: 1 },
  crystal: { cobalt: 4, aurum: 1.2, ferrite: 2 },
  barren: { ferrite: 4, ice: 1, cobalt: 1.5, aurum: 0.6 },
  default: { ferrite: 4, carbon: 2, cobalt: 1.5, oxyite: 1, aurum: 0.4 },
};

const BARE_BIOMES = new Set(['seabed', 'beach', 'snow', 'glacier', 'lavafield', 'cloudtop']);

export class Scatter {
  constructor(body, { flora, density = 1, isMined = () => false }) {
    this.body = body;
    this.surface = body.surface;
    this.density = density;
    this.isMined = isMined;
    this.group = new THREE.Group();
    this.group.name = 'scatter';
    this.time = { value: 0 };
    const R = this.surface.radius;
    const faceArc = (Math.PI / 2) * R;
    this.floraLevel = Math.max(2, Math.round(Math.log2(faceArc / 600)));
    this.depositLevel = this.floraLevel + 1;
    this.chunks = new Map();
    this.pending = [];
    this.dirty = false;
    this.rebuildTimer = 0;
    const wantBiomes = ['grassland', 'forest', 'savanna', 'wetland', 'tundra', 'desert', 'dunes', 'mesa', 'ice', 'snow', 'rock', 'fungal', 'sporefield', 'mire', 'toxicflat', 'crystal', 'glowmoss', 'regolith', 'basalt', 'ash', 'irradiated', 'storm'];
    // Decorative boulders (not scannable) so every world has some detail.
    const rrng = new RNG(hashMix(body.def.seed, 'rocks'));
    const rocks = [0, 1, 2].map((i) => ({
      id: `${body.def.id}/rock${i}`, form: 'rock', decor: true, height: rrng.range(0.9, 3.2), leaf: [0.5, 0.5, 0.5], glow: 0,
      density: rrng.range(0.25, 0.5), collider: 0.7,
    }));
    const hasRockModels = rocks.some((r) => floraModelFor(body.def.type, 'rock', new RNG(1)));
    this.species = [...flora, ...(hasRockModels ? rocks : [])].map((sp, i) => {
      const r = new RNG(hashMix(body.def.seed, sp.id));
      // Each species prefers a few biomes; forests are denser.
      const pref = new Set(r.shuffle(wantBiomes.slice()).slice(0, 7));
      if (['conifer', 'broadleaf'].includes(sp.form)) pref.add('forest');
      if (sp.form === 'cactus') { pref.add('desert'); pref.add('dunes'); }
      if (sp.form === 'mushroom') { pref.add('fungal'); pref.add('glowmoss'); }
      if (sp.form === 'crystal') { pref.add('crystal'); pref.add('ice'); }
      if (sp.form === 'reed') { pref.add('wetland'); pref.add('mire'); }
      if (sp.form === 'rock') for (const b of ['rock', 'mesa', 'tundra', 'regolith', 'basalt', 'ash', 'beach', 'snow', 'glacier', 'lavafield']) pref.add(b);
      const cap = Math.floor(2600 * density);
      const modelName = floraModelFor(body.def.type, sp.form, new RNG(hashString(sp.id)));
      const parts = modelName ? staticParts(modelName) : null;
      let meshes;
      if (parts?.length) {
        // Hand-made model: one instanced mesh per material, sharing matrices.
        meshes = parts.map((part) => {
          const mat = part.material.clone();
          if (sp.glow) { mat.emissive = new THREE.Color(sp.leaf[0], sp.leaf[1], sp.leaf[2]).multiplyScalar(sp.glow * 0.35); }
          if (sp.form !== 'rock') this.addSway(mat, 1);
          return new THREE.InstancedMesh(part.geometry, mat, cap);
        });
        for (const m of meshes.slice(1)) m.instanceMatrix = meshes[0].instanceMatrix;
      } else {
        const geo = plantGeometry(sp);
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: sp.form === 'crystal' ? 0.25 : 0.85,
          metalness: sp.form === 'crystal' ? 0.3 : 0,
          emissive: sp.glow ? new THREE.Color(sp.leaf[0], sp.leaf[1], sp.leaf[2]).multiplyScalar(sp.glow * 0.6) : new THREE.Color(0),
          flatShading: true,
        });
        this.addSway(mat, sp.height);
        meshes = [new THREE.InstancedMesh(geo, mat, cap)];
      }
      for (const mesh of meshes) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = sp.height > 3;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      const mesh = meshes[0];
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Models are 1 unit tall: instance scale carries the species height.
      const unitScale = parts?.length ? sp.height : 1;
      return { def: sp, pref, mesh, meshes, cap, index: i, unitScale, model: parts?.length ? modelName : null };
    });
    const weights = DEPOSIT_WEIGHTS[body.def.type] || DEPOSIT_WEIGHTS.default;
    this.depositWeights = Object.entries(weights).map(([v, w]) => ({ v, w }));
    this.depositMeshes = {};
    for (const type of Object.keys(DEPOSIT_TYPES)) {
      const d = DEPOSIT_TYPES[type];
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: d.shape === 'crystal' ? 0.2 : 0.9, metalness: d.shape === 'crystal' ? 0.4 : 0.1, flatShading: true,
        emissive: new THREE.Color(d.color[0], d.color[1], d.color[2]).multiplyScalar(d.glow * 0.5),
      });
      const mesh = new THREE.InstancedMesh(depositGeometry(type), mat, 600);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.depositMeshes[type] = mesh;
    }
    this.activeDeposits = [];
    this.maxDistance = 1600 * Math.sqrt(density);
    this.lastFocus = new THREE.Vector3(Infinity, 0, 0);
  }

  addSway(mat, height) {
    const time = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
          #else
            float ph = 0.0;
          #endif
          float sway = sin(uTime * 1.6 + ph) * 0.04 * max(position.y, 0.0) / ${Math.max(1, height).toFixed(1)};
          transformed.x += sway * position.y;
          transformed.z += sway * 0.6 * position.y;`);
    };
  }

  onNodeCreate(node) {
    if (node.level === this.floraLevel || node.level === this.depositLevel) this.pending.push(node);
  }

  onNodeDispose(node) {
    if (this.chunks.delete(node.key)) this.dirty = true;
    const i = this.pending.indexOf(node);
    if (i >= 0) this.pending.splice(i, 1);
  }

  generate(node) {
    const s = this.surface;
    const R = s.radius;
    const rng = new RNG(hashMix(this.body.def.seed, node.key));
    const d = [0, 0, 0];
    const chunk = { key: node.key, plants: [], deposits: [], center: node.center.clone() };
    const q = new THREE.Quaternion();
    const yaw = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const dir = new THREE.Vector3();
    if (node.level === this.floraLevel && this.species.length) {
      const samples = Math.floor(260 * this.density * (this.body.def.life ? 1 : 0.35));
      for (let i = 0; i < samples; i++) {
        cubeToSphere(node.face, node.u0 + rng.next() * node.size, node.v0 + rng.next() * node.size, d);
        const h = s.heightAt(d[0], d[1], d[2]);
        if (s.hasOcean && h < 1.5) continue;
        const biome = s.biomeAt(d[0], d[1], d[2], h, 0);
        if (BARE_BIOMES.has(biome) && rng.next() > 0.15) continue;
        const cands = this.species.filter((sp) => sp.pref.has(biome));
        if (!cands.length) continue;
        const sp = rng.weighted(cands.map((c) => ({ v: c, w: c.def.density * (biome === 'forest' ? 2 : 1) })));
        if (rng.next() > 0.35 + sp.def.density * 0.6) continue;
        dir.set(d[0], d[1], d[2]);
        pos.copy(dir).multiplyScalar(R + h - 0.2);
        q.setFromUnitVectors(UP, dir);
        yaw.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
        q.multiply(yaw);
        const sc = 0.7 + rng.next() * 0.6;
        const us = sc * sp.unitScale;
        scale.set(us, us * (0.9 + rng.next() * 0.2), us);
        m.compose(pos, q, scale);
        chunk.plants.push({ sp: sp.index, matrix: m.toArray(new Float32Array(16)), pos: pos.clone(), radius: sp.def.collider * sc });
      }
    }
    if (node.level === this.depositLevel) {
      const n = 4 + Math.floor(rng.next() * 8);
      for (let i = 0; i < n; i++) {
        cubeToSphere(node.face, node.u0 + rng.next() * node.size, node.v0 + rng.next() * node.size, d);
        const h = s.heightAt(d[0], d[1], d[2]);
        if (s.hasOcean && h < 0.5) continue;
        const type = rng.weighted(this.depositWeights);
        const id = `${this.body.def.id}|${node.key}#${i}`;
        if (this.isMined(id)) continue;
        dir.set(d[0], d[1], d[2]);
        pos.copy(dir).multiplyScalar(R + h - 0.1);
        q.setFromUnitVectors(UP, dir);
        yaw.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
        q.multiply(yaw);
        const sc = type === 'aurum' ? 0.8 : 0.8 + rng.next() * 0.8;
        scale.set(sc, sc, sc);
        m.compose(pos, q, scale);
        chunk.deposits.push({ id, type, matrix: m.toArray(new Float32Array(16)), pos: pos.clone(), mined: false });
      }
    }
    const existing = this.chunks.get(node.key);
    if (existing) {
      existing.plants.push(...chunk.plants);
      existing.deposits.push(...chunk.deposits);
    } else {
      this.chunks.set(node.key, chunk);
    }
    this.dirty = true;
  }

  rebuild() {
    const counts = this.species.map(() => 0);
    const dcounts = {};
    for (const t of Object.keys(this.depositMeshes)) dcounts[t] = 0;
    this.activeDeposits = [];
    const far2 = (this.maxDistance + 400) ** 2;
    const focus = this.lastFocus;
    for (const chunk of this.chunks.values()) {
      // Distant vegetation is dropped entirely: it is sub-pixel anyway.
      if (Number.isFinite(focus.x) && chunk.center.distanceToSquared(focus) > far2) {
        for (const dep of chunk.deposits) if (!dep.mined) this.activeDeposits.push(dep);
        continue;
      }
      for (const p of chunk.plants) {
        const sp = this.species[p.sp];
        const c = counts[p.sp];
        if (c >= sp.cap) continue;
        sp.mesh.instanceMatrix.array.set(p.matrix, c * 16);
        counts[p.sp] = c + 1;
      }
      for (const dep of chunk.deposits) {
        if (dep.mined) continue;
        const mesh = this.depositMeshes[dep.type];
        const c = dcounts[dep.type];
        if (c >= 600) continue;
        mesh.instanceMatrix.array.set(dep.matrix, c * 16);
        dcounts[dep.type] = c + 1;
        this.activeDeposits.push(dep);
      }
    }
    this.species.forEach((sp, i) => {
      for (const m of sp.meshes) m.count = counts[i];
      sp.mesh.instanceMatrix.needsUpdate = true;
    });
    for (const [t, mesh] of Object.entries(this.depositMeshes)) {
      mesh.count = dcounts[t];
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.dirty = false;
  }

  update(dt, budgetMs = 2, focus = null) {
    this.time.value += dt;
    if (focus && focus.distanceToSquared(this.lastFocus) > 120 * 120) {
      this.lastFocus.copy(focus);
      this.dirty = true;
    }
    if (this.pending.length) {
      const t0 = performance.now();
      while (this.pending.length && performance.now() - t0 < budgetMs) {
        const node = this.pending.shift();
        if (!node.disposed) this.generate(node);
      }
    }
    this.rebuildTimer -= dt;
    if (this.dirty && this.rebuildTimer <= 0) {
      this.rebuild();
      this.rebuildTimer = 0.3;
    }
  }

  flush() {
    while (this.pending.length) {
      const node = this.pending.shift();
      if (!node.disposed) this.generate(node);
    }
    this.rebuild();
  }

  // Deposit closest to `origin` within `maxDist`, preferring the aim direction.
  findDeposit(origin, forward, maxDist = 7) {
    let best = null, bestScore = Infinity;
    const v = new THREE.Vector3();
    for (const dep of this.activeDeposits) {
      v.subVectors(dep.pos, origin);
      const dist = v.length();
      if (dist > maxDist) continue;
      const aim = forward ? 1 - v.normalize().dot(forward) : 0;
      const score = dist * 0.3 + aim * 6;
      if (score < bestScore) { bestScore = score; best = dep; }
    }
    return best;
  }

  removeDeposit(dep) {
    dep.mined = true;
    this.dirty = true;
    this.rebuildTimer = 0;
  }

  plantsNear(origin, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const chunk of this.chunks.values()) {
      for (const p of chunk.plants) {
        if (this.species[p.sp].def.decor) continue;
        if (p.pos.distanceToSquared(origin) < r2) out.push({ species: this.species[p.sp].def, pos: p.pos });
      }
    }
    return out;
  }

  // Push a moving circle out of tree trunks (tangent plane approximation).
  collide(pos, radius) {
    const push = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (const chunk of this.chunks.values()) {
      for (const p of chunk.plants) {
        if (!p.radius) continue;
        const rr = p.radius + radius;
        const dx = pos.x - p.pos.x, dy = pos.y - p.pos.y, dz = pos.z - p.pos.z;
        if (Math.abs(dx) > rr + 20 || Math.abs(dz) > rr + 20 || Math.abs(dy) > rr + 20) continue;
        v.set(dx, dy, dz);
        const up = p.pos.clone().normalize();
        const along = v.dot(up);
        if (along < -1 || along > 12) continue;
        v.addScaledVector(up, -along);
        const d = v.length();
        if (d < rr && d > 1e-4) push.addScaledVector(v, (rr - d) / d);
      }
    }
    return push;
  }

  stats() {
    let plants = 0;
    for (const sp of this.species) plants += sp.mesh.count;
    return { plants, deposits: this.activeDeposits.length, chunks: this.chunks.size };
  }

  dispose() {
    for (const sp of this.species) for (const m of sp.meshes) { if (!sp.model) m.geometry.dispose(); m.material.dispose(); m.dispose(); }
    for (const mesh of Object.values(this.depositMeshes)) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
  }
}
