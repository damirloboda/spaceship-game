// Cube-sphere quadtree terrain with streaming LOD. Chunks are generated on
// demand within a per-frame time budget, so the player can fly from orbit to
// the ground without a loading screen. Geometry is stored relative to each
// chunk centre to keep float32 precision on large planets.
import * as THREE from 'three';

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

export function cubeToSphere(face, u, v, out) {
  const f = FACES[face];
  const x = f.n[0] + u * f.u[0] + v * f.v[0];
  const y = f.n[1] + u * f.u[1] + v * f.v[1];
  const z = f.n[2] + u * f.u[2] + v * f.v[2];
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3);
  out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3);
  out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3);
  return out;
}

const tmpDir = [0, 0, 0];

class Node {
  constructor(terrain, face, level, u0, v0, size, parent) {
    this.terrain = terrain;
    this.face = face;
    this.level = level;
    this.u0 = u0;
    this.v0 = v0;
    this.size = size;
    this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.water = null;
    this.visible = false;
    this.queued = false;
    this.disposed = false;
    this.key = `${face}:${level}:${Math.round(u0 * 65536)}:${Math.round(v0 * 65536)}`;
    const s = terrain.surface;
    cubeToSphere(face, u0 + size / 2, v0 + size / 2, tmpDir);
    this.dir = new THREE.Vector3(tmpDir[0], tmpDir[1], tmpDir[2]);
    const h = s.heightAt(tmpDir[0], tmpDir[1], tmpDir[2]);
    this.center = this.dir.clone().multiplyScalar(s.radius + Math.max(h, s.hasOcean ? 0 : h));
    this.arc = size * (Math.PI / 4) * s.radius;
    this.angRadius = size * (Math.PI / 4) * 0.75;
  }
}

export class Terrain {
  constructor(surface, { grid = 16, split = 2.0, maxLevel = null, material, waterMaterial, hooks = {} }) {
    this.surface = surface;
    this.grid = grid;
    this.split = split;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.hooks = hooks;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    const faceArc = (Math.PI / 2) * surface.radius;
    // Leaf vertex spacing around 2.5-3 m.
    this.maxLevel = maxLevel ?? Math.max(3, Math.round(Math.log2(faceArc / (grid * 2.8))));
    this.queue = [];
    this.nodes = new Map();
    this.roots = [];
    for (let f = 0; f < 6; f++) {
      const n = this.createNode(f, 0, -1, -1, 2, null);
      this.buildNode(n);
      this.roots.push(n);
    }
    this.camLocal = new THREE.Vector3();
    this.stats = { chunks: 0, visible: 0, builtThisFrame: 0, pending: 0 };
    this.rMin = surface.radius + surface.minHeight;
    this.rMax = surface.radius + surface.maxHeight;
  }

  createNode(face, level, u0, v0, size, parent) {
    const n = new Node(this, face, level, u0, v0, size, parent);
    this.nodes.set(n.key, n);
    this.hooks.onCreate?.(n);
    return n;
  }

  setQuality(grid, split) {
    this.split = split;
    if (grid !== this.grid) {
      this.grid = grid;
      const faceArc = (Math.PI / 2) * this.surface.radius;
      this.maxLevel = Math.max(3, Math.round(Math.log2(faceArc / (grid * 2.8))));
      for (const r of this.roots) {
        this.disposeChildren(r);
        this.freeMesh(r);
        this.buildNode(r);
      }
    }
  }

  // Build vertex data for one chunk.
  buildNode(node) {
    if (node.disposed) return;
    const s = this.surface;
    const R = s.radius;
    const N = this.grid;
    const E = N + 3;
    const ext = new Float64Array(E * E * 3);
    const dirs = new Float64Array((N + 1) * (N + 1) * 3);
    const hs = new Float64Array((N + 1) * (N + 1));
    const d = [0, 0, 0];
    let minH = Infinity;
    for (let j = -1; j <= N + 1; j++) {
      for (let i = -1; i <= N + 1; i++) {
        cubeToSphere(node.face, node.u0 + (node.size * i) / N, node.v0 + (node.size * j) / N, d);
        const h = s.heightAt(d[0], d[1], d[2]);
        const r = R + h;
        const e = ((j + 1) * E + (i + 1)) * 3;
        ext[e] = d[0] * r; ext[e + 1] = d[1] * r; ext[e + 2] = d[2] * r;
        if (i >= 0 && j >= 0 && i <= N && j <= N) {
          const k = j * (N + 1) + i;
          dirs[k * 3] = d[0]; dirs[k * 3 + 1] = d[1]; dirs[k * 3 + 2] = d[2];
          hs[k] = h;
          if (h < minH) minH = h;
        }
      }
    }
    const main = (N + 1) * (N + 1);
    const skirt = 4 * (N + 1);
    const total = main + skirt;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const c = node.center;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const e = ((j + 1) * E + (i + 1)) * 3;
        const eL = ((j + 1) * E + i) * 3, eR = ((j + 1) * E + i + 2) * 3;
        const eD = (j * E + (i + 1)) * 3, eU = ((j + 2) * E + (i + 1)) * 3;
        const ax = ext[eR] - ext[eL], ay = ext[eR + 1] - ext[eL + 1], az = ext[eR + 2] - ext[eL + 2];
        const bx = ext[eU] - ext[eD], by = ext[eU + 1] - ext[eD + 1], bz = ext[eU + 2] - ext[eD + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
        if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        pos[k * 3] = ext[e] - c.x; pos[k * 3 + 1] = ext[e + 1] - c.y; pos[k * 3 + 2] = ext[e + 2] - c.z;
        nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
        const cosA = Math.min(1, Math.max(0.05, nx * dx + ny * dy + nz * dz));
        const slope = Math.sqrt(1 - cosA * cosA) / cosA;
        s.colorAt(dx, dy, dz, hs[k], slope, col, k * 3);
      }
    }
    // Skirts hide cracks between neighbouring LOD levels.
    const depth = Math.max(2, node.arc * 0.03);
    const edges = [];
    for (let i = 0; i <= N; i++) edges.push(i); // bottom
    for (let i = 0; i <= N; i++) edges.push(N * (N + 1) + i); // top
    for (let j = 0; j <= N; j++) edges.push(j * (N + 1)); // left
    for (let j = 0; j <= N; j++) edges.push(j * (N + 1) + N); // right
    for (let e = 0; e < edges.length; e++) {
      const k = edges[e];
      const sk = main + e;
      pos[sk * 3] = pos[k * 3] - dirs[k * 3] * depth;
      pos[sk * 3 + 1] = pos[k * 3 + 1] - dirs[k * 3 + 1] * depth;
      pos[sk * 3 + 2] = pos[k * 3 + 2] - dirs[k * 3 + 2] * depth;
      nor[sk * 3] = nor[k * 3]; nor[sk * 3 + 1] = nor[k * 3 + 1]; nor[sk * 3 + 2] = nor[k * 3 + 2];
      col[sk * 3] = col[k * 3]; col[sk * 3 + 1] = col[k * 3 + 1]; col[sk * 3 + 2] = col[k * 3 + 2];
    }
    // Winding: check the first cell against the outward direction.
    const flip = this.cellFlip(pos, dirs, N);
    const idx = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, cc = a + N + 1, dd = cc + 1;
        if (!flip) { idx.push(a, cc, b, b, cc, dd); } else { idx.push(a, b, cc, b, dd, cc); }
      }
    }
    const skirtIdx = [];
    for (let side = 0; side < 4; side++) {
      for (let q = 0; q < N; q++) {
        const e0 = side * (N + 1) + q;
        const a = edges[e0], b = edges[e0 + 1], sa = main + e0, sb = main + e0 + 1;
        // both windings so skirts are visible from either side
        skirtIdx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const all = idx.concat(skirtIdx);
    geo.setIndex(total > 65535 ? new THREE.Uint32BufferAttribute(all, 1) : new THREE.Uint16BufferAttribute(all, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.copy(c);
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    node.mesh = mesh;
    this.group.add(mesh);
    if (s.hasOcean && minH < 1 && this.waterMaterial) {
      const wpos = new Float32Array(main * 3);
      const wnor = new Float32Array(main * 3);
      for (let k = 0; k < main; k++) {
        wpos[k * 3] = dirs[k * 3] * R - c.x;
        wpos[k * 3 + 1] = dirs[k * 3 + 1] * R - c.y;
        wpos[k * 3 + 2] = dirs[k * 3 + 2] * R - c.z;
        wnor[k * 3] = dirs[k * 3]; wnor[k * 3 + 1] = dirs[k * 3 + 1]; wnor[k * 3 + 2] = dirs[k * 3 + 2];
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
      wg.setAttribute('normal', new THREE.BufferAttribute(wnor, 3));
      wg.setIndex(main > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      wg.computeBoundingSphere();
      const wm = new THREE.Mesh(wg, this.waterMaterial);
      wm.position.copy(c);
      wm.visible = false;
      wm.renderOrder = 2;
      wm.matrixAutoUpdate = false;
      wm.updateMatrix();
      node.water = wm;
      this.group.add(wm);
    }
    node.queued = false;
  }

  cellFlip(pos, dirs, N) {
    const a = 0, b = 1, c = N + 1;
    const ax = pos[b * 3] - pos[a * 3], ay = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2];
    const bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    // triangle (a, c, b): normal = (c - a) x (b - a)
    const nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
    return nx * dirs[0] + ny * dirs[1] + nz * dirs[2] < 0;
  }

  freeMesh(node) {
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh = null;
    }
    if (node.water) {
      this.group.remove(node.water);
      node.water.geometry.dispose();
      node.water = null;
    }
  }

  disposeChildren(node) {
    if (!node.children) return;
    for (const ch of node.children) {
      this.disposeChildren(ch);
      this.freeMesh(ch);
      ch.disposed = true;
      this.nodes.delete(ch.key);
      this.hooks.onDispose?.(ch);
    }
    node.children = null;
  }

  splitNode(node) {
    const h = node.size / 2;
    node.children = [
      this.createNode(node.face, node.level + 1, node.u0, node.v0, h, node),
      this.createNode(node.face, node.level + 1, node.u0 + h, node.v0, h, node),
      this.createNode(node.face, node.level + 1, node.u0, node.v0 + h, h, node),
      this.createNode(node.face, node.level + 1, node.u0 + h, node.v0 + h, h, node),
    ];
    for (const c of node.children) {
      c.queued = true;
      this.queue.push(c);
    }
  }

  setNodeVisible(node, v) {
    if (node.mesh) node.mesh.visible = v;
    if (node.water) node.water.visible = v;
    node.visible = v && !!node.mesh;
  }

  hideTree(node) {
    this.setNodeVisible(node, false);
    if (node.children) for (const c of node.children) this.hideTree(c);
  }

  inHorizon(node, cam, camDist) {
    if (camDist <= this.rMin) return true;
    const hor = Math.acos(Math.min(1, this.rMin / camDist)) + Math.acos(Math.min(1, this.rMin / this.rMax));
    const cosA = node.dir.dot(cam) / camDist;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    return ang < hor + node.angRadius;
  }

  updateNode(node, cam, camDist) {
    if (!this.inHorizon(node, cam, camDist)) {
      this.hideTree(node);
      if (node.children && node.level > 1) this.disposeChildren(node);
      return;
    }
    const dist = node.center.distanceTo(cam);
    const threshold = node.arc * this.split;
    const wantSplit = node.level < this.maxLevel && dist < threshold;
    if (wantSplit) {
      if (!node.children) this.splitNode(node);
      const ready = node.children.every((c) => c.mesh);
      if (ready) {
        this.setNodeVisible(node, false);
        for (const c of node.children) this.updateNode(c, cam, camDist);
      } else {
        this.setNodeVisible(node, true);
        for (const c of node.children) this.hideTree(c);
      }
    } else {
      if (node.children) {
        if (dist > threshold * 1.25) this.disposeChildren(node);
        else for (const c of node.children) this.hideTree(c);
      }
      this.setNodeVisible(node, true);
      if (!node.mesh && !node.queued) {
        node.queued = true;
        this.queue.push(node);
      }
    }
  }

  // camLocal: camera position in the planet's local frame.
  update(camLocal, budgetMs = 4) {
    this.camLocal.copy(camLocal);
    const camDist = camLocal.length();
    for (const r of this.roots) this.updateNode(r, camLocal, camDist);
    this.stats.builtThisFrame = 0;
    if (this.queue.length) {
      this.queue = this.queue.filter((n) => !n.disposed && !n.mesh);
      this.queue.sort((a, b) => a.center.distanceToSquared(camLocal) - b.center.distanceToSquared(camLocal));
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < budgetMs) {
        this.buildNode(this.queue.shift());
        this.stats.builtThisFrame++;
      }
    }
    this.stats.pending = this.queue.length;
    this.stats.chunks = this.nodes.size;
  }

  // Synchronous streaming until the view around the camera is complete.
  warmup(camLocal, maxMs = 4000) {
    const t0 = performance.now();
    let passes = 0;
    do {
      this.update(camLocal, 50);
      passes++;
    } while ((this.queue.length || passes < 3) && performance.now() - t0 < maxMs && passes < 400);
    this.update(camLocal, 0);
  }

  visibleCount() {
    let n = 0;
    for (const node of this.nodes.values()) if (node.visible) n++;
    return n;
  }

  dispose() {
    for (const r of this.roots) {
      this.disposeChildren(r);
      this.freeMesh(r);
    }
    this.nodes.clear();
  }
}
