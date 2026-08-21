/**
 * Terrain rendering — concentric LOD rings (§4, §54, §106).
 *
 * The first version rendered a single 1.4 km patch, which on a planet of this
 * size meant the ground visibly ended ~700 m out — well inside the 3.6 km
 * horizon — and the world read as a small flat green plane. Terrain is now
 * drawn as several concentric square patches centred on the player, each
 * covering a much larger area at a lower resolution than the one inside it.
 * The outermost ring reaches 150 km, which is roughly how far a 2 km mountain
 * peak stays above the horizon on a world this size, so distant ranges are
 * actually visible from the ground.
 *
 * Rings overlap rather than interlocking. Each coarser ring is pushed a metre
 * or two *down* along the radius so the finer geometry always wins the depth
 * test in the shared area — no crack-stitching, no skirts, and (with the
 * renderer's logarithmic depth buffer) no z-fighting. The visible cost is a
 * ~1-2 m step at each ring boundary, which at that distance is invisible.
 *
 * Water is a separate set of patches held flat at sea level, so the sea can
 * have its own shiny material instead of being matte vertex-coloured ground.
 * Terrain therefore renders the bare seabed (`radiusAt`) rather than the
 * "ground or sea surface, whichever is higher" value.
 */
import * as THREE from '../../vendor/three.module.js';
import { BIOMES } from '../gen/planet.js';
import { fbm } from '../core/rng.js';
import { groundTextureFor, surfaceTexture, normalFromCanvas } from './textures.js';

/**
 * LOD levels, innermost first.
 * `refreshAt` is how far the player may move before that ring is rebuilt —
 * the coarse outer rings barely need to move at all.
 */
export const RING_LEVELS = [
  // Ring 0 is deliberately small and dense: ~3 m per quad. A 2.4 km innermost
  // ring at this vertex count gave 21 m quads, which at eye height are seen
  // almost edge-on and read as enormous stretched facets — the ground looked
  // like faceted cardboard no matter how good the texture was.
  /*
   * Every ring samples terrain at FULL detail. Trimming high-frequency octaves
   * on the coarse rings looked like an easy optimisation, but those octaves
   * carry up to ~160 m of amplitude — vastly more than the 1-9 m the rings are
   * separated by — so the coarse rings punched straight up through the fine
   * ones right under the player's feet and the world rendered as seabed.
   * Overlapping LOD only works while every level agrees on the same surface.
   *
   * The cost is modest: the two dense inner rings needed full detail anyway,
   * and the coarse rings are few vertices and rebuild very rarely.
   */
  { size: 320, resolution: 96, drop: 0.0, refreshAt: 40 },
  { size: 1500, resolution: 96, drop: 0.5, refreshAt: 190 },
  { size: 7000, resolution: 84, drop: 1.5, refreshAt: 900 },
  { size: 34000, resolution: 68, drop: 4.0, refreshAt: 4000 },
  { size: 160000, resolution: 52, drop: 10.0, refreshAt: 20000 },
];

/** Build an orthonormal tangent basis at a unit direction. */
export function tangentBasis(dir) {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const up = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const ref = Math.abs(up.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  let ex = ref.y * up.z - ref.z * up.y;
  let ey = ref.z * up.x - ref.x * up.z;
  let ez = ref.x * up.y - ref.y * up.x;
  const el = Math.hypot(ex, ey, ez) || 1;
  ex /= el; ey /= el; ez /= el;
  const nx = up.y * ez - up.z * ey;
  const ny = up.z * ex - up.x * ez;
  const nz = up.x * ey - up.y * ex;
  return { up, east: { x: ex, y: ey, z: ez }, north: { x: nx, y: ny, z: nz } };
}

const tmpColor = new THREE.Color();
const seabedColor = new THREE.Color(0.10, 0.13, 0.16);

/**
 * Build one square patch of terrain projected onto the sphere.
 *
 * @param {object} surface PlanetSurface
 * @param {{x,y,z}} centerDir unit direction of the patch centre
 * @param {number} size patch edge length in metres
 * @param {number} resolution quads per edge
 * @param {object} [opts] {drop, flatRadius}
 *   - drop: metres to sink the whole patch along the radius (LOD ordering)
 *   - flatRadius: if set, ignore terrain and hold every vertex at this radius
 *     (used for the sea surface)
 */
export function buildTerrainPatch(surface, centerDir, size, resolution, opts = {}) {
  const drop = opts.drop || 0;
  const detail = opts.detail ?? 4;
  const flatRadius = opts.flatRadius;
  const { up, east, north } = tangentBasis(centerDir);

  const R = surface.radius;
  const verts = resolution + 1;
  const positions = new Float32Array(verts * verts * 3);
  const colors = flatRadius ? null : new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  // Tile size grows with the patch so every ring gets the same number of
  // texture repeats — a fixed metre-based tile would alias badly on the
  // 150 km outer ring.
  const tileSize = Math.max(40, size / 60);

  // Patch geometry is built relative to its own centre so the vertex buffer
  // never holds planet-radius-sized coordinates (float32 would lose metres).
  const centerR = (flatRadius ?? surface.radiusAt(up.x, up.y, up.z, detail)) - drop;
  const center = { x: up.x * centerR, y: up.y * centerR, z: up.z * centerR };

  let vi = 0, ci = 0, ti = 0;
  let anyAbove = false;      // for water: does this patch contain any sea?

  for (let j = 0; j < verts; j++) {
    const v = (j / resolution - 0.5) * size;
    for (let i = 0; i < verts; i++) {
      const u = (i / resolution - 0.5) * size;

      // Project the flat tangent-plane coordinate out onto the sphere.
      const px = up.x * R + east.x * u + north.x * v;
      const py = up.y * R + east.y * u + north.y * v;
      const pz = up.z * R + east.z * u + north.z * v;
      const pl = Math.hypot(px, py, pz) || 1;
      const dx = px / pl, dy = py / pl, dz = pz / pl;

      let r;
      if (flatRadius !== undefined) {
        r = flatRadius - drop;
        // Only keep a water patch if some of it is actually above the seabed.
        if (!anyAbove && surface.radiusAt(dx, dy, dz, detail) < flatRadius) anyAbove = true;
      } else {
        r = surface.radiusAt(dx, dy, dz, detail) - drop;
      }

      positions[vi] = dx * r - center.x;
      positions[vi + 1] = dy * r - center.y;
      positions[vi + 2] = dz * r - center.z;
      vi += 3;

      uvs[ti] = u / tileSize;
      uvs[ti + 1] = v / tileSize;
      ti += 2;

      if (colors) {
        const elevation = r + drop - R;
        if (surface.hasOcean && elevation < surface.seaLevel) {
          // Seabed: the sea itself is drawn by the water patches on top.
          colors[ci] = seabedColor.r; colors[ci + 1] = seabedColor.g; colors[ci + 2] = seabedColor.b;
        } else {
          const def = BIOMES[surface.biomeAt(dx, dy, dz)] || BIOMES.rock;
          /*
           * Vertex-level colour variation. This is where terrain gets its
           * visual interest: it is interpolated across the mesh, so unlike a
           * tiled detail texture it can never alias or moiré however grazing
           * the view angle. Driven by the same elevation field, so patches of
           * colour follow the actual shape of the ground.
           */
          const rel = (r + drop - R - surface.seaLevel) / Math.max(1, surface.relief);
          const mottle = fbm(surface.seed + 8191, dx * 260, dy * 260, dz * 260, 2) * 0.14;
          const height = Math.max(-0.12, Math.min(0.16, rel * 0.35));
          const shade = 1 + mottle + height;
          tmpColor.setRGB(
            Math.max(0, Math.min(1, def.color[0] * shade)),
            Math.max(0, Math.min(1, def.color[1] * shade)),
            Math.max(0, Math.min(1, def.color[2] * shade)),
          );
          colors[ci] = tmpColor.r; colors[ci + 1] = tmpColor.g; colors[ci + 2] = tmpColor.b;
        }
        ci += 3;
      }
    }
  }

  if (flatRadius !== undefined && !anyAbove) return null;   // no sea here

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
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  return { geometry: geo, center, up, east, north };
}

/**
 * Streams the LOD ring stack around a moving point.
 */
export class TerrainStreamer {
  constructor(scene, surface, planet, opts = {}) {
    this.scene = scene;
    this.surface = surface;
    this.planet = planet;
    this.levels = opts.levels || RING_LEVELS;

    // Vertex colours carry the biome; the texture supplies the fine grain that
    // stops open ground reading as a flat sheet of colour.
    const groundTex = planet ? groundTextureFor(planet) : null;
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: groundTex,
      normalMap: groundTex ? normalFromCanvas(`ground${planet.seed >>> 0}`, groundTex.image, 1.1) : null,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.94,
      metalness: 0.0,
      // The tangent-plane→sphere mapping winds either way depending on where
      // on the globe it is evaluated, so terrain is never back-face culled.
      side: THREE.DoubleSide,
    });

    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.10, 0.30, 0.46),
      roughness: 0.06,
      metalness: 0.35,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      // A faint normal-ish grain so the sea catches the sun instead of
      // rendering as a single flat blue polygon.
      normalMap: surfaceTexture('water-grain', { seed: 99, grain: 0.7, contrast: 0.1 }),
      normalScale: new THREE.Vector2(0.18, 0.18),
    });

    this.rings = this.levels.map(() => ({ mesh: null, water: null, dir: null, center: null }));
    /** Centre of the innermost patch, for the scenery scatter to line up with. */
    this.nearCenter = null;
    this.nearDir = null;
  }

  /** Angular distance between two unit directions, in metres along the surface. */
  _surfaceDistance(a, b) {
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
    return Math.acos(dot) * this.surface.radius;
  }

  /**
   * Rebuild whichever rings the player has outrun.
   * @returns {boolean} true if the innermost ring was rebuilt (scenery should follow)
   */
  update(dir) {
    let nearRebuilt = false;
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      const ring = this.rings[i];
      if (ring.dir && this._surfaceDistance(dir, ring.dir) < level.refreshAt) continue;
      this._rebuildRing(i, dir);
      if (i === 0) nearRebuilt = true;
    }
    return nearRebuilt;
  }

  _rebuildRing(i, dir) {
    const level = this.levels[i];
    const ring = this.rings[i];

    const built = buildTerrainPatch(this.surface, dir, level.size, level.resolution, { drop: level.drop, detail: level.detail });
    if (ring.mesh) {
      this.scene.remove(ring.mesh);
      ring.mesh.geometry.dispose();
    }
    ring.mesh = new THREE.Mesh(built.geometry, this.material);
    ring.mesh.renderOrder = -i;        // draw fine rings first
    this.scene.add(ring.mesh);
    ring.center = built.center;
    ring.dir = dir;

    // Matching sea surface, if this world has one.
    if (ring.water) {
      this.scene.remove(ring.water);
      ring.water.geometry.dispose();
      ring.water = null;
    }
    if (this.surface.hasOcean) {
      const seaR = this.surface.radius + this.surface.seaLevel;
      const w = buildTerrainPatch(this.surface, dir, level.size, Math.min(level.resolution, 48), {
        drop: level.drop, flatRadius: seaR, detail: level.detail,
      });
      if (w) {
        ring.water = new THREE.Mesh(w.geometry, this.waterMaterial);
        ring.water.renderOrder = 1;
        ring.waterCenter = w.center;
        this.scene.add(ring.water);
      }
    }

    if (i === 0) {
      this.nearCenter = built.center;
      this.nearDir = dir;
    }
  }

  /**
   * Position every ring for this frame's floating origin.
   * @param {{x,y,z}} origin the player/ship true position
   */
  place(origin) {
    for (const ring of this.rings) {
      if (ring.mesh && ring.center) {
        ring.mesh.position.set(ring.center.x - origin.x, ring.center.y - origin.y, ring.center.z - origin.z);
      }
      if (ring.water && ring.waterCenter) {
        ring.water.position.set(
          ring.waterCenter.x - origin.x, ring.waterCenter.y - origin.y, ring.waterCenter.z - origin.z,
        );
      }
    }
  }

  setVisible(v) {
    for (const ring of this.rings) {
      if (ring.mesh) ring.mesh.visible = v;
      if (ring.water) ring.water.visible = v;
    }
  }

  dispose() {
    for (const ring of this.rings) {
      if (ring.mesh) { this.scene.remove(ring.mesh); ring.mesh.geometry.dispose(); }
      if (ring.water) { this.scene.remove(ring.water); ring.water.geometry.dispose(); }
    }
    this.rings = this.levels.map(() => ({ mesh: null, water: null, dir: null, center: null }));
  }
}

/**
 * Whole-planet mesh for the orbital/space view — an icosphere displaced by the
 * same elevation function, cheap enough to rebuild per planet.
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
    // Show the sea surface from orbit, not the seabed.
    // Coarse detail is correct here: this mesh is seen from orbit and its
    // triangles span tens of kilometres.
    const r = surface.surfaceRadiusAt(dx, dy, dz, 1);
    pos.setXYZ(i, dx * r, dy * r, dz * r);
    const def = BIOMES[surface.biomeAt(dx, dy, dz)] || BIOMES.rock;
    colors[i * 3] = def.color[0]; colors[i * 3 + 1] = def.color[1]; colors[i * 3 + 2] = def.color[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  return new THREE.Mesh(geo, mat);
}
