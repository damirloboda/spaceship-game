// Merge every static mesh under a group by material, so a detailed prop
// costs a few draw calls. Meshes (or their parents) flagged userData.keep
// stay separate so they can still move.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map();
  const drop = [];
  group.traverse((o) => {
    if (!o.isMesh || o.userData.keep || o.isPoints) return;
    let hasKeptParent = false;
    for (let p = o.parent; p && p !== group; p = p.parent) if (p.userData.keep) hasKeptParent = true;
    if (hasKeptParent) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const list = byMat.get(o.material) || [];
    list.push({ geo, cast: o.castShadow });
    byMat.set(o.material, list);
    drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list.map((l) => l.geo), false);
    for (const l of list) l.geo.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = list.some((l) => l.cast) && !mat.transparent;
    m.receiveShadow = true;
    group.add(m);
  }
}

