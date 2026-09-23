// Texture library: CC0 photo-scanned detail maps (Poly Haven) loaded in the
// background. Materials work without them and sharpen once they arrive.
import * as THREE from 'three';
import { log } from '../core/log.js';

const BASE = 'assets/textures/';
const TERRAIN_LAYERS = ['grass', 'rock', 'sand', 'snow'];
const SIZE = 512;

export const terrainTextures = {
  detail: null, // DataArrayTexture (4 layers)
  normal: null,
  ready: false,
  listeners: [],
};

function loadImage(src) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`texture ${src}`));
    img.src = src;
  });
}

function toArray(images, srgb) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(SIZE * SIZE * 4 * images.length);
  images.forEach((img, i) => {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    data.set(ctx.getImageData(0, 0, SIZE, SIZE).data, i * SIZE * SIZE * 4);
  });
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, images.length);
  tex.format = THREE.RGBAFormat;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export async function loadTerrainTextures() {
  try {
    const det = await Promise.all(TERRAIN_LAYERS.map((l) => loadImage(`${BASE}${l}_detail.jpg`)));
    const nor = await Promise.all(TERRAIN_LAYERS.map((l) => loadImage(`${BASE}${l}_normal.jpg`)));
    terrainTextures.detail = toArray(det, false);
    terrainTextures.normal = toArray(nor, false);
    terrainTextures.ready = true;
    for (const fn of terrainTextures.listeners) fn();
  } catch (err) {
    log.warn('terrain textures unavailable, using vertex colours only', err);
  }
}

const loader = new THREE.TextureLoader();
const cache = new Map();

// Standard PBR texture (albedo sRGB, others linear) with repeat wrapping.
export function texture(name, { srgb = false, repeat = 1 } = {}) {
  const key = `${name}|${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + name, undefined, undefined, () => log.warn(`texture ${name} failed`));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, t);
  return t;
}

// Patches a terrain MeshStandardMaterial with triplanar detail textures,
// triplanar normal mapping and per-layer roughness.
export function applyTerrainDetail(material, { strength = 1, tile = 3.2 } = {}) {
  const uniforms = {
    uDetail: { value: terrainTextures.detail },
    uNormalArr: { value: terrainTextures.normal },
    uDetailOn: { value: terrainTextures.ready ? 1 : 0 },
    uTile: { value: tile },
    uStrength: { value: strength },
  };
  material.userData.detailUniforms = uniforms;
  terrainTextures.listeners.push(() => {
    uniforms.uDetail.value = terrainTextures.detail;
    uniforms.uNormalArr.value = terrainTextures.normal;
    uniforms.uDetailOn.value = 1;
    material.needsUpdate = true;
  });
  material.defines = { ...(material.defines || {}), TERRAIN_DETAIL: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 lpos;\nattribute vec4 layers;\nvarying vec3 vLpos;\nvarying vec4 vLayers;\nvarying vec3 vLnormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLpos = lpos;\nvLayers = layers;\nvLnormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform mediump sampler2DArray uDetail;
        uniform mediump sampler2DArray uNormalArr;
        uniform float uDetailOn;
        uniform float uTile;
        uniform float uStrength;
        uniform mat3 normalMatrix;
        varying vec3 vLpos;
        varying vec4 vLayers;
        varying vec3 vLnormal;
        vec3 triAlbedo(vec3 p, vec3 w, float layer) {
          vec3 a = texture(uDetail, vec3(p.zy, layer)).rgb * w.x;
          a += texture(uDetail, vec3(p.xz, layer)).rgb * w.y;
          a += texture(uDetail, vec3(p.xy, layer)).rgb * w.z;
          return a;
        }
        vec3 triNormal(vec3 p, vec3 w, vec3 n, float layer) {
          vec3 tx = texture(uNormalArr, vec3(p.zy, layer)).xyz * 2.0 - 1.0;
          vec3 ty = texture(uNormalArr, vec3(p.xz, layer)).xyz * 2.0 - 1.0;
          vec3 tz = texture(uNormalArr, vec3(p.xy, layer)).xyz * 2.0 - 1.0;
          vec3 s = sign(n);
          tx.x *= s.x; ty.x *= s.y; tz.x *= -s.z;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float dDist = length(vViewPosition);
        float dFade = (1.0 - smoothstep(40.0, 320.0, dDist)) * uDetailOn;
        vec3 dN = normalize(vLnormal);
        vec3 dW = pow(abs(dN), vec3(4.0)); dW /= dot(dW, vec3(1.0));
        vec3 dP = vLpos / uTile;
        vec3 dP2 = vLpos / (uTile * 7.3);
        vec3 detailCol = vec3(0.0);
        vec3 detailN = vec3(0.0);
        if (dFade > 0.001) {
          for (int i = 0; i < 4; i++) {
            float lw = vLayers[i];
            if (lw < 0.03) continue;
            float li = float(i);
            // near + macro scale break up the tiling
            detailCol += lw * mix(triAlbedo(dP, dW, li), triAlbedo(dP2, dW, li), 0.35);
            detailN += lw * triNormal(dP, dW, dN, li);
          }
          diffuseColor.rgb *= mix(vec3(1.0), clamp(detailCol * 2.0, 0.0, 2.0), dFade * uStrength);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, dot(vLayers, vec4(0.92, 0.8, 0.95, 0.5)), 0.7);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (dFade > 0.001 && dot(detailN, detailN) > 0.0) {
          vec3 pn = normalize(mix(dN, normalize(detailN), dFade * uStrength));
          normal = normalize(normalMatrix * pn);
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif
        }`);
  };
  material.customProgramCacheKey = () => 'terrain-detail';
}
