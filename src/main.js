/**
 * ULTRA COSMOS — game shell.
 *
 * Wires the deterministic generation + simulation layers (src/gen, src/sim)
 * to the player/ship models (src/game) and the Three.js renderer (src/render)
 * behind a small state machine: SURFACE -> SHIP (landed) -> FLIGHT ->
 * ORBIT/SPACE -> LIGHTBREAK -> new system, with no loading screen between any
 * of them (§54, §123).
 *
 * All positions are stored in true metres (double precision) as the source of
 * truth; every object handed to Three.js is positioned camera-relative each
 * frame ("floating origin") so nothing loses precision at planetary scale.
 */
import * as THREE from '../vendor/three.module.js';
import { findStartSystem, systemsNear, generateSystem, orbitTemperature, AU, LY } from './gen/galaxy.js';
import { getSurface } from './gen/planet.js';
import { Player } from './game/player.js';
import { Ship, NITRO_PARTS, C } from './game/ship.js';
import { InputManager } from './game/input.js';
import { World } from './sim/world.js';
import { weatherAt } from './sim/weather.js';
import { TerrainStreamer, buildPlanetMesh } from './render/terrain.js';
import { buildAtmosphere, buildStarfield, buildRings } from './render/sky.js';
import { mountHUD, updateHUD } from './ui/hud.js';
import { mountTouchControls } from './ui/touch.js';

const app = document.getElementById('app');
const bootStatus = document.getElementById('boot-status');

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.id = 'view';
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2_000_000_000);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x445566, 0.35));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ------------------------------------------------------------------ */
/* HUD / input                                                         */
/* ------------------------------------------------------------------ */

const hudRoot = document.createElement('div');
app.appendChild(hudRoot);
mountHUD(hudRoot);

const input = new InputManager(renderer.domElement);
mountTouchControls(app, input);

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

const world = new World(0xC0517);
let currentSystem = null;
let currentPlanet = null;
let surface = null;
let terrain = null;
let atmosphereMesh = null;
let ringMesh = null;
let starfield = null;
let planetFarMesh = null;

let sunAxisDir = new THREE.Vector3(0.6, 0.35, 0.4).normalize();
let sunEpochS = 0;

const player = new Player({ jetpack: 'civilian' });
const ship = new Ship('explorer', { name: 'Long Horizon' });
let shipObject = null;              // simple placeholder mesh
const shipLandingSpot = { x: 0, y: 0, z: 0 };

/** 'surface' | 'ship_landed' | 'ship_flight' | 'space' */
let mode = 'surface';
let discoveryText = null, discoveryTimer = 0;
let lightbreakRunTime = 0;
let clock = new THREE.Clock();

function announce(text, seconds = 3.5) {
  discoveryText = text;
  discoveryTimer = seconds;
}

/* ------------------------------------------------------------------ */
/* World loading                                                       */
/* ------------------------------------------------------------------ */

function loadSystem(system, planetIndex, arriveOnSurface = true) {
  currentSystem = system;
  currentPlanet = system.planets[planetIndex];
  world.markVisited(system.id);
  world.discoveries.planets++;

  if (terrain) terrain.dispose();
  if (atmosphereMesh) scene.remove(atmosphereMesh);
  if (ringMesh) scene.remove(ringMesh);
  if (planetFarMesh) scene.remove(planetFarMesh);
  if (starfield) scene.remove(starfield);

  surface = getSurface(currentPlanet);
  world.restoreEcosystem(currentPlanet);

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
  terrain = new TerrainStreamer(scene, surface, { patchSize: 1400, resolution: 84, material: mat });

  atmosphereMesh = buildAtmosphere(currentPlanet, surface.radius);
  scene.add(atmosphereMesh);

  ringMesh = buildRings(currentPlanet, surface.radius);
  if (ringMesh) scene.add(ringMesh);

  starfield = buildStarfield(system.seed, 5000, 6e8);
  scene.add(starfield);

  if (arriveOnSurface) {
    const pad = surface.pointsOfInterest().find((p) => p.kind === 'landing_pad')
      || surface.pointsOfInterest().find((p) => p.kind === 'city');
    const dir = pad ? pad.dir : { x: 0, y: 1, z: 0 };
    player.spawnAt(surface, dir, 0.1);

    // Point the sun roughly overhead-but-angled at the spawn site (a mid-
    // morning angle, not high noon) so the very first thing the player sees
    // is a lit world, then let the day/night cycle run from there.
    const up = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    let side = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    side = side.clone().sub(up.clone().multiplyScalar(up.dot(side))).normalize();
    sunAxisDir = up.clone().multiplyScalar(0.72).add(side.multiplyScalar(0.68)).normalize();
    sunEpochS = world.timeS;
    shipLandingSpot.x = dir.x; shipLandingSpot.y = dir.y; shipLandingSpot.z = dir.z;
    const shipR = surface.surfaceRadiusAt(dir.x, dir.y, dir.z) + 2;
    ship.pos = { x: dir.x * shipR, y: dir.y * shipR, z: dir.z * shipR };
    ship.vel = { x: 0, y: 0, z: 0 };
    ship.landed = true;
    mode = 'surface';
  }

  terrain.update(player.onGround || mode === 'surface' ? dirOf(player.pos) : dirOf(ship.pos));
  bootStatus.textContent = '';
}

function dirOf(p) {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */

bootStatus.textContent = 'searching for a habitable system…';
const { system: startSystem, planetIndex: startIndex } = findStartSystem();
loadSystem(startSystem, startIndex, true);
document.getElementById('boot-screen').classList.add('hidden');
announce(`${currentPlanet.name.toUpperCase()}\nFIRST LANDING`, 4);

/* ------------------------------------------------------------------ */
/* Ship mesh (placeholder geometry — good enough to see and dock with) */
/* ------------------------------------------------------------------ */

function buildShipMesh() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.CapsuleGeometry(3.2, 11, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x8fa2b8, roughness: 0.4, metalness: 0.6 }),
  );
  hull.rotation.z = Math.PI / 2;
  g.add(hull);
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x5fd3ff, roughness: 0.1, metalness: 0.2, emissive: 0x1a3d4d }),
  );
  cockpit.position.set(6, 0.5, 0);
  g.add(cockpit);
  const engineGlow = new THREE.PointLight(0x5fd3ff, 2, 40);
  engineGlow.position.set(-7, 0, 0);
  g.add(engineGlow);
  return g;
}
shipObject = buildShipMesh();
scene.add(shipObject);

/* ------------------------------------------------------------------ */
/* Interaction prompts                                                 */
/* ------------------------------------------------------------------ */

function distanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  input.update();

  world.advance(dt * 60 /* TIME_SCALE */);

  let promptText = '';
  let warnings = [];

  if (mode === 'surface') {
    player.yaw -= input.state.look.x * 0.0022;
    player.pitch -= input.state.look.y * 0.0022;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));

    const weather = weatherAt(currentPlanet, dirOf(player.pos), world.timeS);
    player.update(dt, {
      move: input.state.move, jump: input.state.jump, sprint: input.state.sprint,
      crouch: input.state.crouch, jetThrottle: input.state.jetThrottle,
    }, surface, currentPlanet, { weather });

    terrain.update(dirOf(player.pos));

    // Camera at player eye, floating-origin rendered.
    const origin = player.pos;
    camera.position.set(0, 0, 0);
    const look = player.lookDirection();
    camera.lookAt(look.x, look.y, look.z);
    positionRelative(terrain.mesh, terrain.currentCenter, origin);
    positionRelative(atmosphereMesh, { x: 0, y: 0, z: 0 }, origin);
    if (ringMesh) positionRelative(ringMesh, { x: 0, y: 0, z: 0 }, origin);
    positionRelative(shipObject, ship.pos, origin);
    shipObject.visible = true;
    starfield.visible = currentPlanet.atmosphere < 0.6;
    positionRelative(starfield, { x: 0, y: 0, z: 0 }, origin);
    updateSun(origin);

    if (distanceTo(player.pos, ship.pos) < 12) {
      promptText = 'E — Board ship';
      if (input.state.interact) { mode = 'ship_landed'; announce('', 0); }
    }
    warnings = player.warnings.slice();
    if (!player.alive) warnings.push('YOU HAVE DIED — press R to respawn');
    if (input.keys && input.keys.has('KeyR') && !player.alive) {
      player.alive = true; player.health = 100;
      player.spawnAt(surface, dirOf(ship.pos));
    }
  } else {
    // ---- ship modes: landed, flight, space ----
    const alt = altitudeOf(ship.pos);
    const nearGravity = mode !== 'space' ? Math.min(1, currentPlanet.gravity / 30) : 0;

    if (mode === 'ship_landed') {
      if (input.state.interact && distanceTo(player.pos, ship.pos) < 20) {
        mode = 'surface';
        player.spawnAt(surface, dirOf(ship.pos));
      }
      if (input.state.move.y > 0.5) {
        ship.landed = false;
        mode = 'ship_flight';
        // Point the ship's thrust vector at local "up" for liftoff — without
        // this the ship keeps whatever orientation it landed in (typically
        // near-horizontal) and gravity cancels most of the climb, so
        // throttling up just skids the ship along the ground.
        const up = dirOf(ship.pos);
        ship.orientation.pitch = Math.asin(Math.max(-1, Math.min(1, up.y)));
        ship.orientation.yaw = Math.atan2(up.x, up.z);
      }
    }

    if (mode !== 'ship_landed') {
      const dir = dirOf(ship.pos);
      const gravityDir = { x: -dir.x, y: -dir.y, z: -dir.z };
      const inAtmo = alt < surface.relief + 40000 && mode !== 'space';
      const atmosphere = inAtmo ? Math.max(0, currentPlanet.atmosphere * Math.max(0, 1 - alt / 90000)) : 0;

      // Throttle (W/S) and attitude (mouse look, Q/E roll) are independent
      // axes. They used to share W/S, so holding W to launch also drove the
      // nose continuously into the ground the whole time you accelerated.
      ship.update(dt, {
        throttle: Math.max(0, input.state.move.y),
        pitch: -input.state.look.y * 0.02,
        yaw: input.state.look.x * 0.02,
        roll: (input.keys.has('KeyQ') ? 1 : 0) - (input.keys.has('KeyE') ? 1 : 0),
        nitro: input.state.nitro,
        chargeLightbreak: input.state.lightbreakHold,
        lightbreak: mode === 'space' ? input.state.lightbreakHold : undefined,
      }, { gravity: mode === 'space' ? 0 : currentPlanet.gravity, gravityDir, atmosphere });

      // Simple ground contact so the ship doesn't burrow into terrain.
      if (mode !== 'space') {
        const groundR = surface.surfaceRadiusAt(dir.x, dir.y, dir.z);
        const r = Math.hypot(ship.pos.x, ship.pos.y, ship.pos.z);
        if (r < groundR + 2) {
          const nr = groundR + 2;
          ship.pos = { x: dir.x * nr, y: dir.y * nr, z: dir.z * nr };
          const vDot = ship.vel.x * dir.x + ship.vel.y * dir.y + ship.vel.z * dir.z;
          if (vDot < 0) { ship.vel.x -= dir.x * vDot; ship.vel.y -= dir.y * vDot; ship.vel.z -= dir.z * vDot; }
          if (ship.speed < 3) { ship.landed = true; mode = 'ship_landed'; }
        }
      }

      if (mode === 'ship_flight' && alt > surface.relief + 60000) {
        mode = 'space';
        announce('ORBIT REACHED', 2.5);
      }
      if (mode === 'space' && alt < surface.relief + 40000 && ship.speed < 200) {
        mode = 'ship_flight';
      }

      if (ship.lightbreak.engaged) {
        lightbreakRunTime += dt;
        if (lightbreakRunTime > 4 && mode === 'space') {
          performSystemJump();
          lightbreakRunTime = 0;
        }
      } else {
        lightbreakRunTime = Math.max(0, lightbreakRunTime - dt * 2);
      }

      // Camera: cockpit view, floating origin on the ship.
      camera.position.set(0, 0, 0);
      const fwd = ship.forward();
      camera.lookAt(fwd.x, fwd.y, fwd.z);
      camera.up.set(dir.x, dir.y, dir.z);

      const origin = ship.pos;
      if (mode !== 'space') {
        terrain.update(dir);
        positionRelative(terrain.mesh, terrain.currentCenter, origin);
        terrain.mesh.visible = alt < surface.relief + 20000;
      }
      positionRelative(atmosphereMesh, { x: 0, y: 0, z: 0 }, origin);
      if (ringMesh) positionRelative(ringMesh, { x: 0, y: 0, z: 0 }, origin);
      positionRelative(starfield, { x: 0, y: 0, z: 0 }, origin);
      // Stars are always visible once you're actually in space; inside the
      // atmosphere they wash out same as they would on the ground. This was
      // stuck permanently off whenever the planet's own atmosphere was thick,
      // because the only place that ever set it was the surface-mode branch.
      starfield.visible = mode === 'space' || currentPlanet.atmosphere < 0.6;
      shipObject.visible = false;               // first-person cockpit
      updateSun(origin);

      // Build/refresh a far view of the planet once we're clearly in space.
      if (mode === 'space') {
        if (!planetFarMesh) {
          planetFarMesh = buildPlanetMesh(surface, 4);
          scene.add(planetFarMesh);
        }
        positionRelative(planetFarMesh, { x: 0, y: 0, z: 0 }, origin);
        planetFarMesh.visible = true;
      } else if (planetFarMesh) {
        planetFarMesh.visible = false;
      }

      warnings = ship.warnings.slice();
      if (ship.lightbreak.engaged) promptText = 'LIGHTBREAK ENGAGED — hold to reach superspeed';
      else if (mode === 'space') promptText = 'B — charge Lightbreak · N — Nitro';
    }
  }

  discoveryTimer -= dt;
  if (discoveryTimer <= 0) discoveryText = null;

  updateHUD({
    player, ship, mode,
    locationLabel: `${currentPlanet.name} · ${currentSystem.name} · ${mode.replace('_', ' ').toUpperCase()}`,
    weather: mode === 'surface' ? weatherAt(currentPlanet, dirOf(player.pos), world.timeS) : null,
    news: world.headlines(1)[0]?.text || '',
    warnings,
    prompt: promptText,
    discovery: discoveryText,
  });

  renderer.render(scene, camera);
}

function altitudeOf(pos) {
  const dir = dirOf(pos);
  return Math.hypot(pos.x, pos.y, pos.z) - surface.surfaceRadiusAt(dir.x, dir.y, dir.z);
}

/** Position an object at (truePos - origin), the floating-origin trick. */
function positionRelative(obj, truePos, origin) {
  if (!obj) return;
  obj.position.set(truePos.x - origin.x, truePos.y - origin.y, truePos.z - origin.z);
}

/*
 * Day/night cycle: the sun's direction is fixed in the planet's inertial
 * frame (sunAxisDir) and the planet spins under it. Rather than transform
 * every terrain/collision query by a rotating body frame — real, but a much
 * bigger change — we approximate by rotating the *apparent* sun direction the
 * opposite way, which is exactly equivalent for lighting and sky purposes and
 * costs nothing extra elsewhere.
 *
 * sunAxisDir is chosen when a planet loads so the player's spawn point starts
 * in daylight — a fixed arbitrary direction landed the very first build on
 * the planet's night side with only ambient light, which read as a black
 * screen.
 */
function currentSunDirection() {
  const spinAxis = new THREE.Vector3(Math.sin(currentPlanet.axialTilt || 0), Math.cos(currentPlanet.axialTilt || 0) , 0.15).normalize();
  const dayLength = Math.max(120, currentPlanet.dayLengthS || 3600);
  const angle = ((world.timeS - sunEpochS) / dayLength) * Math.PI * 2;
  return sunAxisDir.clone().applyAxisAngle(spinAxis, angle);
}

function updateSun(origin) {
  const d = currentSunDirection();
  sun.position.set(d.x * 1000, d.y * 1000, d.z * 1000);
  sun.target.position.set(0, 0, 0);
  if (atmosphereMesh) {
    atmosphereMesh.material.uniforms.uSunDir.value.copy(d);
    atmosphereMesh.material.uniforms.uCameraUp.value.copy(dirOf(origin));
  }
}

/** §123's "NEW SYSTEM DISCOVERED" moment — jump to a nearby undiscovered system. */
function performSystemJump() {
  const nearby = systemsNear(currentSystem.pos, 4000)
    .filter((s) => s.id !== currentSystem.id && !world.hasVisited(s.id));
  if (!nearby.length) {
    announce('NO CHARTED DESTINATION NEARBY', 2.5);
    ship.disengageLightbreak();
    return;
  }
  const target = nearby[Math.floor(Math.random() * Math.min(5, nearby.length))];
  const full = generateSystem(target);
  const homeIdx = Math.max(0, full.planets.findIndex((p) => !p.gasGiant));
  ship.disengageLightbreak();
  ship.landed = false;
  loadSystem(full, homeIdx, false);
  // Drop the ship into orbit of the new system rather than on the surface.
  const dir = { x: 0.4, y: 0.6, z: 0.4 };
  const r = surface.radius + surface.relief + 80000;
  ship.pos = { x: dir.x * r, y: dir.y * r, z: dir.z * r };
  ship.vel = { x: 0, y: 0, z: 0 };
  mode = 'space';
  announce(`${full.name.toUpperCase()}\nUNKNOWN WORLD — FIRST DISCOVERY`, 5);
}

requestAnimationFrame(frame);

// Expose for debugging / automated smoke tests.
window.__ULTRA_COSMOS__ = {
  world, ship, player, scene, camera, renderer,
  get mode() { return mode; }, get planet() { return currentPlanet; },
  get terrain() { return terrain; },
};
