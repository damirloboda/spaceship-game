/**
 * Ship and player-character models (§24, §31, §55, §56).
 *
 * Built from primitives at runtime — no downloaded assets (§115) — but shaped
 * so each hull class reads as a distinct silhouette: a scout is a needle, a
 * hauler is a slab of cargo pods, an expedition ship is a long spine with a
 * habitat ring. The ship the player flies is the same model they see parked on
 * the ground, so landing next to it feels continuous.
 */
import * as THREE from '../../vendor/three.module.js';
import { metalTexture } from './textures.js';

function hullMaterials(seed = 1, accentColor = 0x5fd3ff) {
  const map = metalTexture(seed);
  /*
   * Metalness is deliberately moderate. A physically "correct" hull at
   * metalness 0.8 reflects almost nothing but the environment, and with no
   * environment map in the scene that renders as solid black — the first
   * build's ship was a black silhouette in full daylight. Until there is a
   * real IBL probe, dielectric-leaning values light correctly from the sun.
   */
  return {
    hull: new THREE.MeshStandardMaterial({ map, color: 0xb4c0cd, roughness: 0.48, metalness: 0.30 }),
    dark: new THREE.MeshStandardMaterial({ map, color: 0x59636f, roughness: 0.62, metalness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8fd8ff, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.55,
      emissive: new THREE.Color(0x122d3a), emissiveIntensity: 0.5,
    }),
    glow: new THREE.MeshBasicMaterial({ color: accentColor }),
    accent: new THREE.MeshStandardMaterial({
      color: accentColor, roughness: 0.3, metalness: 0.4,
      emissive: new THREE.Color(accentColor), emissiveIntensity: 0.7,
    }),
  };
}

/**
 * Build a ship model.
 * @param {string} classId one of SHIP_CLASSES
 * @param {number} seed for panel-texture variation
 * @returns {THREE.Group} +Z is forward, +Y is up, origin at the ship's centre
 */
export function buildShipModel(classId = 'explorer', seed = 1) {
  const g = new THREE.Group();
  const M = hullMaterials(seed);

  // Overall length in metres, by class.
  const LENGTH = {
    scout: 14, explorer: 22, cargo: 40, science: 26, mining: 34, rescue: 20,
    passenger: 46, luxury: 26, military: 30, expedition: 78, colony: 120,
  };
  const L = LENGTH[classId] || 22;
  const W = L * (classId === 'cargo' || classId === 'colony' ? 0.42 : 0.3);

  const add = (mesh, x, y, z, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };

  /* ---- fuselage ---- */
  const bodyLen = L * 0.62;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.36, W * 0.44, bodyLen, 12), M.hull);
  add(body, 0, 0, 0, Math.PI / 2, 0, 0);

  // Nose cone.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(W * 0.36, L * 0.26, 12), M.hull);
  add(nose, 0, 0, bodyLen * 0.5 + L * 0.13, Math.PI / 2, 0, 0);

  // Tail section.
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.44, W * 0.3, L * 0.16, 12), M.dark);
  add(tail, 0, 0, -bodyLen * 0.5 - L * 0.08, Math.PI / 2, 0, 0);

  /* ---- cockpit ---- */
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(W * 0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.glass);
  add(canopy, 0, W * 0.26, bodyLen * 0.32);

  /* ---- wings ---- */
  if (classId !== 'colony' && classId !== 'passenger') {
    const wingSpan = W * (classId === 'scout' || classId === 'military' ? 2.1 : 1.5);
    const wingGeo = new THREE.BoxGeometry(wingSpan, L * 0.012, L * 0.2);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeo, M.hull);
      add(wing, side * (W * 0.42 + wingSpan * 0.5), -W * 0.06, -L * 0.05, 0, side * -0.14, side * 0.16);
      // Wingtip light: red to port, green to starboard, like any real aircraft.
      const tipMat = new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3b30 : 0x30ff6a });
      const tipLight = new THREE.Mesh(new THREE.SphereGeometry(L * 0.012, 6, 5), tipMat);
      add(tipLight, side * (W * 0.42 + wingSpan), -W * 0.06, -L * 0.05);
    }
  }

  /* ---- engines ---- */
  const engineCount = classId === 'colony' ? 4 : classId === 'cargo' || classId === 'expedition' ? 3 : 2;
  const nacelleLen = L * 0.24;
  for (let i = 0; i < engineCount; i++) {
    const spread = engineCount === 1 ? 0 : (i / (engineCount - 1) - 0.5);
    const ex = spread * W * 1.5;
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.16, W * 0.19, nacelleLen, 10), M.dark);
    add(nacelle, ex, -W * 0.04, -bodyLen * 0.5 - nacelleLen * 0.35, Math.PI / 2, 0, 0);

    // Exhaust bell + glow disc. `glow` is tagged so the flight code can pulse
    // it with the throttle.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.2, W * 0.13, nacelleLen * 0.3, 10), M.dark);
    add(bell, ex, -W * 0.04, -bodyLen * 0.5 - nacelleLen * 0.82, Math.PI / 2, 0, 0);

    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(W * 0.15, 12), M.glow);
    glowDisc.name = 'engineGlow';
    add(glowDisc, ex, -W * 0.04, -bodyLen * 0.5 - nacelleLen * 0.96, 0, Math.PI, 0);
  }

  /* ---- class-specific structure ---- */
  if (classId === 'cargo' || classId === 'mining') {
    // Cargo pods slung along the spine.
    const podGeo = new THREE.BoxGeometry(W * 0.5, W * 0.5, L * 0.18);
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        add(new THREE.Mesh(podGeo, M.dark), side * W * 0.62, -W * 0.1, (i - 1.5) * L * 0.2);
      }
    }
  }
  if (classId === 'expedition' || classId === 'colony') {
    // Rotating habitat ring — the silhouette that says "this thing lives out here".
    const ring = new THREE.Mesh(new THREE.TorusGeometry(W * 1.1, W * 0.13, 8, 28), M.hull);
    ring.name = 'habitatRing';
    add(ring, 0, 0, -L * 0.02, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(W * 2.0, W * 0.05, W * 0.05), M.dark);
      add(spoke, 0, 0, -L * 0.02, 0, 0, (i / 4) * Math.PI);
    }
  }
  if (classId === 'science' || classId === 'explorer') {
    // Sensor dish.
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(W * 0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), M.hull,
    );
    add(dish, 0, W * 0.42, -L * 0.1, -Math.PI * 0.25, 0, 0);
  }

  /* ---- landing gear ---- */
  const gearGeo = new THREE.CylinderGeometry(L * 0.008, L * 0.008, W * 0.42, 5);
  const footGeo = new THREE.CylinderGeometry(L * 0.02, L * 0.024, L * 0.012, 6);
  for (const [gx, gz] of [[-W * 0.4, L * 0.16], [W * 0.4, L * 0.16], [0, -L * 0.2]]) {
    add(new THREE.Mesh(gearGeo, M.dark), gx, -W * 0.42, gz);
    add(new THREE.Mesh(footGeo, M.dark), gx, -W * 0.62, gz);
  }

  /* ---- running lights ---- */
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 4; i++) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(L * 0.008, 5, 4), beaconMat);
    add(beacon, 0, W * 0.38, (i / 3 - 0.5) * bodyLen * 0.8);
  }

  // Engine light so the ship lights its own surroundings on a dark pad.
  const engineLight = new THREE.PointLight(0x6fd8ff, 3, L * 4);
  engineLight.position.set(0, 0, -bodyLen * 0.6);
  engineLight.name = 'engineLight';
  g.add(engineLight);

  g.userData.length = L;
  return g;
}

/** Pulse the engine glow with throttle — called each frame by the game loop. */
export function setShipThrust(model, throttle, overdrive = false) {
  const intensity = 0.25 + Math.max(0, Math.min(1, throttle)) * (overdrive ? 2.6 : 1.4);
  model.traverse((o) => {
    if (o.name === 'engineGlow' && o.material) {
      o.material.color.setRGB(
        overdrive ? 1.0 : 0.35 * intensity,
        0.75 * intensity,
        1.0 * intensity,
      );
      o.scale.setScalar(0.7 + intensity * 0.5);
    }
    if (o.name === 'engineLight') o.intensity = 1 + intensity * 4;
  });
}

/** Spin an expedition ship's habitat ring. */
export function animateShip(model, dt) {
  model.traverse((o) => {
    if (o.name === 'habitatRing') o.rotation.z += dt * 0.25;
  });
}

/* ------------------------------------------------------------------ */
/* Player character                                                    */
/* ------------------------------------------------------------------ */

/**
 * First-person body: the arms and jetpack the player can actually see when
 * they look down (§55 — hands, equipment and jetpack must be visible).
 * Parented to the camera, so it moves with the view.
 */
export function buildFirstPersonRig(hasJetpack = true) {
  const rig = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.62, metalness: 0.18 });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x2f8fbf, roughness: 0.4, metalness: 0.3,
    emissive: new THREE.Color(0x0d3a52), emissiveIntensity: 0.6,
  });

  // Forearms, angled into view at the bottom of the screen.
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.24, 3, 7), suit);
    upper.rotation.set(-0.95, 0, side * 0.13);
    upper.position.set(side * 0.2, -0.24, -0.3);
    arm.add(upper);

    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), accent);
    glove.position.set(side * 0.235, -0.35, -0.46);
    arm.add(glove);

    arm.name = side < 0 ? 'leftArm' : 'rightArm';
    rig.add(arm);
  }

  // Chest rig / torso hint at the very bottom of the frame.
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.16), suit);
  chest.position.set(0, -0.44, -0.16);
  rig.add(chest);

  if (hasJetpack) {
    // Jetpack shoulder tanks, visible in peripheral vision and in third person.
    for (const side of [-1, 1]) {
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.16, 3, 7), accent);
      tank.position.set(side * 0.16, -0.36, 0.12);
      rig.add(tank);
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 6), suit);
      nozzle.rotation.x = Math.PI;
      nozzle.position.set(side * 0.16, -0.47, 0.12);
      nozzle.name = 'jetNozzle';
      rig.add(nozzle);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.035, 0.22, 6),
        new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9 }),
      );
      flame.rotation.x = Math.PI;
      flame.position.set(side * 0.16, -0.6, 0.12);
      flame.name = 'jetFlame';
      flame.visible = false;
      rig.add(flame);
    }
  }

  rig.userData.bobPhase = 0;
  return rig;
}

/**
 * Animate the first-person rig: walk bob, and jetpack flames when thrusting
 * (§58 — the camera and the body should react to what the player is doing).
 */
export function updateFirstPersonRig(rig, { speed = 0, jetThrottle = 0, dt = 0.016, grounded = true }) {
  rig.userData.bobPhase += dt * (2.2 + speed * 0.55);
  const bobAmount = grounded ? Math.min(1, speed / 7) * 0.022 : 0.004;
  rig.position.y = Math.sin(rig.userData.bobPhase * 2) * bobAmount;
  rig.position.x = Math.cos(rig.userData.bobPhase) * bobAmount * 0.6;

  const firing = jetThrottle > 0.02;
  rig.traverse((o) => {
    if (o.name === 'jetFlame') {
      o.visible = firing;
      if (firing) {
        const jitter = 0.75 + Math.random() * 0.5;
        o.scale.set(1, jetThrottle * 1.9 * jitter, 1);
        o.material.opacity = 0.55 + jetThrottle * 0.45;
      }
    }
  });
}
