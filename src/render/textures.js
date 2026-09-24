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
  tex.anisotropy = aniso;
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
let aniso = 4;

// Anisotropic filtering for every PBR and terrain texture (per preset).
export function setAnisotropy(n) {
  if (n === aniso) return;
  aniso = n;
  for (const t of [...cache.values(), terrainTextures.detail, terrainTextures.normal]) {
    if (!t) continue;
    t.anisotropy = n;
    t.needsUpdate = true;
  }
}

// Standard PBR texture (albedo sRGB, others linear) with repeat wrapping.
export function texture(name, { srgb = false, repeat = 1 } = {}) {
  const key = `${name}|${repeat}`;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + name, undefined, undefined, () => log.warn(`texture ${name} failed`));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  cache.set(key, t);
  return t;
}

// Patches a terrain MeshStandardMaterial with triplanar detail textures,
// triplanar normal mapping and per-layer roughness.
// Shared clock for animated terrain effects (sea-floor caustics).
export const terrainTime = { value: 0 };

export function applyTerrainDetail(material, { strength = 1, tile = 3.2, seaRadius = 0 } = {}) {
  const uniforms = {
    uTTime: terrainTime,
    uSeaR: { value: seaRadius },
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
        uniform float uTTime;
        uniform float uSeaR;
        varying vec3 vLpos;
        varying vec4 vLayers;
        varying vec3 vLnormal;
        // Sunlight focused by the waves above: dancing caustic web.
        float caustic(vec2 p, float t) {
          vec2 q = p;
          float c = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i) + 1.0;
            q = p + vec2(cos(t * 0.53 * fi - q.x) + sin(t * 0.37 * fi + q.y), sin(t * 0.47 * fi - q.y) + cos(t * 0.29 * fi + q.x));
            c += 1.0 / length(vec2(p.x / (sin(q.x + t) * 0.9), p.y / (cos(q.y + t) * 0.9)));
          }
          c = 1.17 - pow(c / 4.0, 1.4);
          return pow(abs(c), 8.0);
        }
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
        }
        if (uSeaR > 0.0) {
          float seaD = uSeaR - length(vLpos);
          if (seaD > 0.05) {
            vec3 ca = abs(normalize(vLpos));
            vec2 cp = (ca.y > max(ca.x, ca.z) ? vLpos.xz : ca.x > ca.z ? vLpos.zy : vLpos.xy) * 0.35;
            float cs = caustic(mod(cp, 6.2831853 * 8.0), uTTime * 0.6);
            float cFade = exp(-seaD * 0.12) * smoothstep(0.05, 0.6, seaD) * (1.0 - smoothstep(60.0, 220.0, length(vViewPosition)));
            // Water tints the sea floor blue-green with depth.
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.75, 0.8), 1.0 - exp(-seaD * 0.08));
            diffuseColor.rgb += vec3(0.75, 0.95, 0.9) * clamp(cs, 0.0, 1.2) * 0.35 * cFade;
          }
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

// Triplanar panel detail for hand-made hulls whose UVs point into a colour
// atlas: object-space normal map plus a touch of grime from the hull albedo.
export function applyHullDetail(material, { tile = 2.5, strength = 0.8 } = {}) {
  const uniforms = {
    uHullNor: { value: texture('hull_nor.jpg') },
    uHullDiff: { value: texture('hull_diff.jpg', { srgb: true }) },
    uHullTile: { value: tile },
    uHullStrength: { value: strength },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHullPos;\nvarying vec3 vHullN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullPos = position;\nvHullN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uHullNor; uniform sampler2D uHullDiff; uniform float uHullTile; uniform float uHullStrength;
        uniform mat3 normalMatrix;
        varying vec3 vHullPos; varying vec3 vHullN;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 hN = normalize(vHullN);
        vec3 hW = pow(abs(hN), vec3(6.0)); hW /= dot(hW, vec3(1.0));
        vec3 hP = vHullPos / uHullTile;
        float grime = dot(texture2D(uHullDiff, hP.zy).rgb * hW.x + texture2D(uHullDiff, hP.xz).rgb * hW.y + texture2D(uHullDiff, hP.xy).rgb * hW.z, vec3(0.333));
        diffuseColor.rgb *= mix(1.0, clamp(grime * 1.25, 0.6, 1.15), 0.55 * uHullStrength);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 tx = texture2D(uHullNor, hP.zy).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(uHullNor, hP.xz).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(uHullNor, hP.xy).xyz * 2.0 - 1.0;
          vec3 s = sign(hN);
          tx.x *= s.x; ty.x *= s.y; tz.x *= -s.z;
          tx = vec3(tx.xy + hN.zy, abs(tx.z) * hN.x);
          ty = vec3(ty.xy + hN.xz, abs(ty.z) * hN.y);
          tz = vec3(tz.xy + hN.xy, abs(tz.z) * hN.z);
          vec3 dn = normalize(tx.zyx * hW.x + ty.xzy * hW.y + tz.xyz * hW.z);
          normal = normalize(normalMatrix * normalize(mix(hN, dn, uHullStrength)));
        }`);
  };
  material.customProgramCacheKey = () => 'hull-detail';
}
