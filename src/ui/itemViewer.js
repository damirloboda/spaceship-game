// Shop showroom: the selected item turns on a glowing pedestal, rendered with
// its own small WebGL canvas and studio reflections (RoomEnvironment).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildJetpack } from '../render/jetpackModel.js';
import { carbonMaterial, brushedMetal, paintedPanel, decalMaterial, gaugeMaterial } from '../render/materialsLib.js';
import { itemDef } from '../game/items.js';

const M = {
  chrome: () => brushedMetal(0xd3d8df, 0.18),
  dark: () => carbonMaterial(2),
  paint: (c) => paintedPanel(c, 0.8),
  glow: (c, i = 2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(c), emissiveIntensity: i }),
  glass: (c) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.22, clearcoat: 1 }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}

// Nitro tank: chrome cylinder with a window onto glowing blue fuel.
function nitroTank() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.62, 32), M.chrome()));
  g.add(mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.36, 32, 1, true, -0.6, 1.2), M.glass(0x88e8ff)));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.34, 32), M.glow(0x1aa8ff, 3.4)));
  for (const y of [-0.33, 0.33]) g.add(mesh(new THREE.CylinderGeometry(0.21, 0.18, 0.06, 32), M.dark(), 0, y));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 16), M.dark(), 0, 0.41));
  g.add(mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 20), M.chrome(), 0, 0.47, 0, Math.PI / 2));
  for (const y of [-0.22, 0.22]) g.add(mesh(new THREE.TorusGeometry(0.203, 0.012, 8, 40), M.glow(0x39d0ff, 3), 0, y, 0, Math.PI / 2));
  // Wrap-around label on the back half, gauge and a valve handwheel on top.
  g.add(mesh(new THREE.CylinderGeometry(0.203, 0.203, 0.3, 32, 1, true, 1.3, 3.7), decalMaterial({ lines: ['NITRO', 'N2O  LIQUID', 'MAX 3000 PSI', 'KEEP COOL'], accent: '#ffb13d', hazard: true, w: 512, h: 160 })));
  const gauge = new THREE.Group();
  gauge.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 24), M.chrome()));
  gauge.add(mesh(new THREE.CircleGeometry(0.043, 24), gaugeMaterial(), 0, 0.0135, 0, -Math.PI / 2));
  gauge.position.set(0.1, 0.4, 0.06); gauge.rotation.set(0.5, 0, -0.4);
  g.add(gauge);
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), M.chrome(), 0.06, 0.38, 0.03, 0, 0, -0.9));
  g.add(mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 32), new THREE.MeshStandardMaterial({ color: 0xc0392b, metalness: 0.3, roughness: 0.4 }), 0, 0.53, 0, Math.PI / 2));
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.15, 0.008, 0.008), M.chrome(), 0, 0.53, 0, 0, (i * Math.PI) / 3));
  // Frost on the lower dome from the cold liquid inside.
  g.add(mesh(new THREE.SphereGeometry(0.2, 32, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), new THREE.MeshStandardMaterial({ color: 0xeaf6ff, roughness: 0.9, transparent: true, opacity: 0.35 }), 0, -0.17));
  return g;
}

function nitroModule() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.62, 0.3, 0.42, 4, 0.04), M.dark()));
  for (const x of [-0.16, 0.16]) {
    g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 24), M.chrome(), x, 0.22, 0, 0, 0, Math.PI / 2));
    g.add(mesh(new THREE.TorusGeometry(0.082, 0.01, 8, 24), M.glow(0x39d0ff, 3), x, 0.22, 0.14, 0, 0, 0));
  }
  g.add(mesh(new THREE.SphereGeometry(0.1, 24, 16), M.glow(0x7ce3ff, 3.5), 0, 0.06, 0.2));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.02, 0.02), M.glow(0x39d0ff, 2), 0, -0.1, 0.215));
  return g;
}

function canister(color, glowColor) {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.42, 0.56, 0.18, 4, 0.04), M.paint(color)));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), M.dark(), 0, 0.33, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 16), M.dark(), 0.13, 0.33, 0));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.012), M.glow(glowColor, 2), 0, 0.02, 0.095));
  return g;
}

function toolbox(color) {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.3, 0.3, 4, 0.03), M.paint(color)));
  g.add(mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 24, Math.PI), M.chrome(), 0, 0.15, 0));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.12, 0.012), M.glow(0xffffff, 1.5), 0, 0, 0.155));
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.12, 0.014), M.paint(0xff4040), 0, 0, 0.158));
  g.add(mesh(new THREE.BoxGeometry(0.12, 0.04, 0.014), M.paint(0xff4040), 0, 0, 0.158));
  return g;
}

function scanner() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.22, 0.36, 0.08, 4, 0.03), M.dark()));
  g.add(mesh(new THREE.BoxGeometry(0.17, 0.2, 0.01), M.glow(0x6bffb0, 2.2), 0, 0.05, 0.045));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), M.chrome(), 0.07, 0.28, 0));
  g.add(mesh(new THREE.SphereGeometry(0.025, 12, 8), M.glow(0xff5d5d, 3), 0.07, 0.4, 0));
  return g;
}

function crate(color) {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.6, 0.5, 0.5, 4, 0.04), M.paint(color)));
  for (const x of [-0.31, 0.31]) g.add(mesh(new THREE.BoxGeometry(0.02, 0.4, 0.3), M.dark(), x));
  g.add(mesh(new THREE.BoxGeometry(0.62, 0.05, 0.52), M.glow(0xffb13d, 1.4), 0, 0.12));
  return g;
}

function skimmer() {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(1.1, 0.18, 0.46, 4, 0.08), M.paint(0xe8eef5)));
  g.add(mesh(new RoundedBoxGeometry(0.5, 0.2, 0.3, 4, 0.06), M.dark(), -0.1, 0.16, 0));
  g.add(mesh(new THREE.BoxGeometry(0.9, 0.03, 0.5), M.glow(0x39d0ff, 2.5), 0, -0.1, 0));
  for (const z of [-0.26, 0.26]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.25, 16), M.chrome(), 0.5, 0, z, 0, 0, Math.PI / 2));
  return g;
}

function gem(color) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.IcosahedronGeometry(0.26, 0), new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.15, emissive: new THREE.Color(color), emissiveIntensity: 0.35, flatShading: true })));
  return g;
}

function modelFor(id) {
  const d = itemDef(id);
  switch (id) {
    case 'jetpack': case 'jetpack_mk2': {
      const jp = buildJetpack(new THREE.Color(id === 'jetpack_mk2' ? 0xffc040 : 0x39d0ff));
      jp.root.scale.setScalar(1.35);
      return { obj: jp.root, tick: (dt) => jp.update(dt, { active: true, fuelPct: 1, heatPct: 0.2, overheated: false }, null, new THREE.Vector3(0, 1, 0)) };
    }
    case 'nitro_cell': return { obj: nitroTank() };
    case 'nitro': return { obj: nitroModule() };
    case 'jet_fuel': return { obj: canister(0xff8a2b, 0xffd27a) };
    case 'fuel_cell': case 'energy_cell': return { obj: canister(id === 'fuel_cell' ? 0xffd84a : 0x8f9bff, 0xffffff) };
    case 'repair_kit': case 'medkit': return { obj: toolbox(id === 'medkit' ? 0xf2f4f7 : 0xd84a3a) };
    case 'scanner_mk2': return { obj: scanner() };
    case 'base_kit': return { obj: crate(0x4a5563) };
    case 'skimmer': return { obj: skimmer() };
    default: return { obj: gem(d.color || '#9fdcff') };
  }
}

export class ItemViewer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewer3d';
    this.ok = false;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.92;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.ok = true;
    } catch { return; }
    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.05, 50);
    this.camera.position.set(0, 0.5, 2.8);
    this.camera.lookAt(0, 0.0, 0);
    // Studio lighting: a soft top spot with contact shadows, a cool rim
    // from behind and a warm low fill.
    const key = new THREE.SpotLight(0xfff4e8, 26, 8, 0.42, 0.7, 1.6);
    key.position.set(0.9, 3.2, 1.4);
    key.target.position.set(0, -0.2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    const rim = new THREE.DirectionalLight(0x7fd8ff, 2.2); rim.position.set(-2, 1.6, -2.5);
    const fill = new THREE.DirectionalLight(0xffb27a, 0.5); fill.position.set(2, -0.2, 2);
    this.scene.add(key, key.target, rim, fill, new THREE.AmbientLight(0x3a4458, 0.35));
    // Glossy pedestal with a glowing ring
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.06, 64), new THREE.MeshPhysicalMaterial({ color: 0x10141a, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }));
    ped.position.y = -0.52;
    ped.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.008, 8, 96), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(0x39d0ff), emissiveIntensity: 3 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.485;
    this.ringMat = ring.material;
    // Light beam from the spot and dust drifting through it.
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.62, 3, 32, 1, true), new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.5); gl_FragColor = vec4(vec3(1.0, 0.95, 0.88), e * 0.07 * (0.25 + vY * 0.75)); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.position.y = 1.0;
    const dustGeo = new THREE.BufferGeometry();
    const dp = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) dp.set([(Math.random() - 0.5) * 1.3, Math.random() * 2 - 0.5, (Math.random() - 0.5) * 1.3], i * 3);
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff1dd, size: 0.012, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(ped, ring, beam, this.dust);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.id = null;
    this.tick = null;
    this.last = performance.now();
    this.loop = this.loop.bind(this);
  }

  show(id) {
    if (!this.ok || id === this.id) return;
    this.id = id;
    this.holder.clear();
    const { obj, tick } = modelFor(id);
    // Fit the model to the pedestal.
    // Fit by the solid parts only (flames and particles excluded).
    const solid = (o) => {
      const b = new THREE.Box3();
      o.updateMatrixWorld(true);
      o.traverse((m) => { if (m.isMesh && !m.material.isShaderMaterial) b.expandByObject(m, false); });
      return b;
    };
    const size = solid(obj).getSize(new THREE.Vector3()).length();
    obj.scale.multiplyScalar(1.05 / Math.max(0.1, size));
    const c = solid(obj).getCenter(new THREE.Vector3());
    obj.position.sub(c).add(new THREE.Vector3(0, 0.12, 0));
    obj.traverse((m) => { if (m.isMesh && !m.material.isShaderMaterial && !m.material.transparent) m.castShadow = true; });
    this.holder.add(obj);
    this.tick = tick || null;
    this.ringMat.emissive.set(itemDef(id).color || '#39d0ff');
    if (!this.running) { this.running = true; requestAnimationFrame(this.loop); }
  }

  loop(now) {
    if (!this.canvas.isConnected) { this.running = false; return; }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    if (w && hgt && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(hgt * this.renderer.getPixelRatio()))) {
      this.renderer.setSize(w, hgt, false);
      this.camera.aspect = w / hgt;
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.y += dt * 0.5;
    this.dust.rotation.y += dt * 0.05;
    this.dust.position.y = Math.sin(now / 4000) * 0.05;
    // Slow breathing camera orbit.
    const a = Math.sin(now / 5200) * 0.18;
    this.camera.position.set(Math.sin(a) * 2.8, 0.5 + Math.sin(now / 3700) * 0.05, Math.cos(a) * 2.8);
    this.camera.lookAt(0, 0, 0);
    this.holder.position.y = Math.sin(now / 900) * 0.02;
    this.tick?.(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  }
}
