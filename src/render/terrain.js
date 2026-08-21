/**
 * Local terrain mesh (§4, §54).
 *
 * Rather than tessellating an entire planet, we mesh a square patch of the
 * tangent plane centred on the player and curve it onto the sphere. The patch
 * regenerates when the player has moved far enough that the edge would show,
 * which is what gives the "walk for hours, never load a screen" feel (§54)
 * without ever building geometry for terrain nobody is near.
 *
 * The same PlanetSurface.elevation() used here is what the player controller
 * collides against, so the ground never has a visible gap versus what you
 * stand on.
 */
import * as THREE from '../../vendor/three.module.js';
import { BIOMES } from '../gen/planet.js';

const tmpColor = new THREE.Color();

/**
 * Build one terrain patch.
 * @param {object} surface PlanetSurface
 * @param {{x,y,z}} centerDir unit direction of the patch centre
 * @param {number} size patch edge length in metres
 * @param {number} resolution vertices per edge
 */
export function buildTerrainPatch(surface, centerDir, size, resolution = 96) {
  const len = Math.hypot(centerDir.x, centerDir.y, centerDir.z) || 1;
  const up = { x: centerDir.x / len, y: centerDir.y / len, z: centerDir.z / len };

  // Tangent basis at the patch centre.
  let ref = Math.abs(up.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let ex = ref.y * up.z - ref.z * up.y, ey = ref.z * up.x - ref.x * up.z, ez = ref.x * up.y - ref.y * up.x;
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  const nx = up.y * ez - up.z * ey, ny = up.z * ex - up.x * ez, nz = up.x * ey - up.y * ex;

  const R = surface.radius;
  const half = size / 2;
  const verts = resolution + 1;
  const positions = new Float32Array(verts * verts * 3);
  const normals = new Float32Array(verts * verts * 3);
  const colors = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);

  // World-space centre point, so returned geometry is local (patch-relative)
  // and the mesh can simply be positioned at this offset — avoids precision
  // loss from huge planet-radius coordinates in the vertex buffer.
  const centerR = surface.surfaceRadiusAt(up.x, up.y, up.z);
  const centerWorld = { x: up.x * centerR, y: up.y * centerR, z: up.z * centerR };

  let vi = 0, ci = 0, ui = 0;
  for (let j = 0; j < verts; j++) {
    const v = (j / resolution - 0.5) * size;
    for (let i = 0; i < verts; i++) {
      const u = (i / resolution - 0.5) * size;
      // Project the flat patch coordinate onto the sphere (gnomonic-ish: for
      // patch sizes well under the planet radius the small-angle error is
      // negligible, and it's cheap).
      const px = up.x * R + ex * u + nx * v;
      const py = up.y * R + ey * u + ny * v;
      const pz = up.z * R + ez * u + nz * v;
      const pl = Math.hypot(px, py, pz) || 1;
      const dx = px / pl, dy = py / pl, dz = pz / pl;

      const r = surface.surfaceRadiusAt(dx, dy, dz);
      const wx = dx * r, wy = dy * r, wz = dz * r;

      positions[vi] = wx - centerWorld.x;
      positions[vi + 1] = wy - centerWorld.y;
      positions[vi + 2] = wz - centerWorld.z;

      const biome = surface.biomeAt(dx, dy, dz);
      const def = BIOMES[biome] || BIOMES.rock;
      tmpColor.setRGB(def.color[0], def.color[1], def.color[2]);
      colors[ci] = tmpColor.r; colors[ci + 1] = tmpColor.g; colors[ci + 2] = tmpColor.b;
      ci += 3;

      uvs[ui] = i / resolution; uvs[ui + 1] = j / resolution; ui += 2;
      vi += 3;
    }
  }

  const index = new Uint32Array(resolution * resolution * 6);
  let ii = 0;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const a = j * verts + i, b = a + 1, c = a + verts, d = c + 1;
      index[ii++] = a; index[ii++] = c; index[ii++] = b;
      index[ii++] = b; index[ii++] = c; index[ii++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  return { geometry: geo, center: centerWorld, up };
}

/**
 * Streams terrain patches around a moving point. Keeps a small ring of
 * patches loaded and swaps the centre one when the player nears its edge —
 * the mechanism behind §54's no-loading-screen movement.
 */
export class TerrainStreamer {
  constructor(scene, surface, opts = {}) {
    this.scene = scene;
    this.surface = surface;
    this.patchSize = opts.patchSize || 1200;
    this.resolution = opts.resolution || 96;
    this.material = opts.material || new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, metalness: 0.02,
    });
    this.mesh = null;
    this.currentDir = null;
    this.rebuildThreshold = this.patchSize * 0.28;
  }

  /** Call every frame (or on a throttle) with the player's surface direction. */
  update(dir) {
    if (!this.currentDir || this._angularDistance(dir, this.currentDir) > this._thresholdAngle()) {
      this._rebuild(dir);
    }
  }

  _thresholdAngle() {
    return this.rebuildThreshold / this.surface.radius;
  }

  _angularDistance(a, b) {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    return Math.acos(dot);
  }

  _rebuild(dir) {
    const { geometry, center } = buildTerrainPatch(this.surface, dir, this.patchSize, this.resolution);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(center.x, center.y, center.z);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);
    this.currentDir = dir;
    this.currentCenter = center;
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
  }
}

/**
 * Whole-planet low-poly mesh for orbital/space views — an icosphere displaced
 * at low frequency, cheap enough to rebuild per planet without streaming.
 */
export function buildPlanetMesh(surface, subdivisions = 5) {
  const geo = new THREE.IcosahedronGeometry(surface.radius, subdivisions);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length() || 1;
    const dx = v.x / len, dy = v.y / len, dz = v.z / len;
    const r = surface.surfaceRadiusAt(dx, dy, dz);
    pos.setXYZ(i, dx * r, dy * r, dz * r);
    const biome = surface.biomeAt(dx, dy, dz);
    const def = BIOMES[biome] || BIOMES.rock;
    colors[i * 3] = def.color[0]; colors[i * 3 + 1] = def.color[1]; colors[i * 3 + 2] = def.color[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  return new THREE.Mesh(geo, mat);
}
