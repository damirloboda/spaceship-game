/**
 * ULTRA COSMOS — game shell.
 *
 * Wires the deterministic generation + simulation layers (src/gen, src/sim) to
 * the player/ship models (src/game) and the renderer (src/render) behind a
 * small state machine: SURFACE -> SHIP (landed) -> FLIGHT -> ORBIT/SPACE ->
 * LIGHTBREAK -> new system, with no loading screen between any of them
 * (§54, §123).
 *
 * All positions are stored in true metres (double precision) as the source of
 * truth; everything handed to Three.js is positioned camera-relative each
 * frame ("floating origin") so nothing loses precision at planetary scale.
 */
import * as THREE from '../vendor/three.module.js';
import { findStartSystem, systemsNear, generateSystem } from './gen/galaxy.js';
import { getSurface } from './gen/planet.js';
import { generateCity } from './gen/city.js';
import { Player } from './game/player.js';
import { Ship } from './game/ship.js';
import { InputManager } from './game/input.js';
import { World } from './sim/world.js';
import { weatherAt } from './sim/weather.js';
import { TerrainStreamer, buildPlanetMesh, tangentBasis } from './render/terrain.js';
import { SceneryField, CreatureField, buildCityMesh } from './render/scenery.js';
import { buildShipModel, setShipThrust, animateShip, buildFirstPersonRig, updateFirstPersonRig } from './render/ship.js';
import {
  buildAtmosphere, buildStarfield, buildRings,
  buildSun, placeSun, buildClouds, placeClouds, WeatherParticles,
} from './render/sky.js';
import { mountHUD, updateHUD } from './ui/hud.js';
import { mountTouchControls } from './ui/touch.js';

const app = document.getElementById('app');
const bootStatus = document.getElementById('boot-status');

/* ------------------------------------------------------------------ */
/* Renderer / scene                                                    */
/* ------------------------------------------------------------------ */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  // Planet-scale scenes span 1 m to 10^9 m in one frame; a normal depth buffer
  // has nowhere near the precision for that and everything z-fights.
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.id = 'view';
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 1e10);
scene.add(camera);   // the first-person rig is parented to the camera

const sunLight = new THREE.DirectionalLight(0xffffff, 2.4);
scene.add(sunLight, sunLight.target);
const ambient = new THREE.AmbientLight(0x5a6a80, 0.55);
scene.add(ambient);
// Bounce light from the ground, so shadowed sides aren't pure black.
const bounce = new THREE.HemisphereLight(0x88aaff, 0x4a4030, 0.45);
scene.add(bounce);

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
const player = new Player({ jetpack: 'civilian' });
const ship = new Ship('explorer', { name: 'Long Horizon' });

let currentSystem = null;
let currentPlanet = null;
let surface = null;

// Render objects, rebuilt per planet.
let terrain = null;
let scenery = null;
let creatures = null;
let cityMesh = null;
let atmosphereMesh = null;
let ringMesh = null;
let starfield = null;
let planetFarMesh = null;
let cloudDeck = null;
let sunBillboard = null;
let shipModel = null;
let fpRig = null;
let weatherFX = null;
let currentCity = null;

/** 'surface' | 'ship_landed' | 'ship_flight' | 'space' */
let mode = 'surface';
let discoveryText = null;
let discoveryTimer = 0;
let lightbreakRunTime = 0;
const clock = new THREE.Clock();

// Day/night: the sun's direction in the planet's frame, spun by world time.
let sunAxisDir = new THREE.Vector3(0.6, 0.35, 0.4).normalize();
let sunEpochS = 0;

function announce(text, seconds = 3.5) {
  discoveryText = text;
  discoveryTimer = seconds;
}

function dirOf(p) {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

function distanceTo(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/* ------------------------------------------------------------------ */
/* World loading                                                       */
/* ------------------------------------------------------------------ */

function disposeWorldObjects() {
  if (terrain) terrain.dispose();
  if (scenery) scenery.dispose();
  if (creatures) creatures.dispose();
  for (const obj of [cityMesh, atmosphereMesh, ringMesh, starfield, planetFarMesh, cloudDeck, sunBillboard]) {
    if (obj) scene.remove(obj);
  }
  cityMesh = atmosphereMesh = ringMesh = starfield = planetFarMesh = cloudDeck = sunBillboard = null;
  planetFarMesh = null;
}


/**
 * Find the most striking direction to look from a spawn point (§123 asks for
 * "a huge mountain in the distance").
 *
 * Landing sites are chosen for flatness, which by construction puts the player
 * in the least dramatic spot on the planet — the first build spawned on a
 * featureless plain with the ground simply ending at the horizon. This scans a
 * ring of bearings at several distances and returns the bearing of the highest
 * ground found, so the opening view has real relief in it.
 *
 * @returns {{yaw:number, height:number, distance:number}|null}
 */
function findScenicBearing(surf, dir) {
  const { up, east, north } = tangentBasis(dir);
  const R = surf.radius;
  const here = surf.elevation(up.x, up.y, up.z);
  let best = null;

  for (let b = 0; b < 48; b++) {
    const bearing = (b / 48) * Math.PI * 2;
    const ce = Math.cos(bearing), cn = Math.sin(bearing);
    for (const dist of [2500, 6000, 12000, 22000, 40000]) {
      const u = ce * dist, v = cn * dist;
      const px = up.x * R + east.x * u + north.x * v;
      const py = up.y * R + east.y * u + north.y * v;
      const pz = up.z * R + east.z * u + north.z * v;
      const pl = Math.hypot(px, py, pz) || 1;
      const e = surf.elevation(px / pl, py / pl, pz / pl);
      // Prefer tall ground that is also close enough to loom.
      const score = (e - here) / Math.sqrt(dist);
      if (!best || score > best.score) {
        best = { score, yaw: Math.atan2(ce, cn), height: e - here, distance: dist };
      }
    }
  }
  return best;
}

function loadSystem(system, planetIndex, arriveOnSurface = true) {
  currentSystem = system;
  currentPlanet = system.planets[planetIndex];
  world.markVisited(system.id);
  world.discoveries.planets++;

  disposeWorldObjects();

  surface = getSurface(currentPlanet);
  const eco = world.restoreEcosystem(currentPlanet);

  terrain = new TerrainStreamer(scene, surface, currentPlanet);
  scenery = new SceneryField(scene, surface, currentPlanet);
  creatures = new CreatureField(scene, surface, eco.livingSpecies());

  atmosphereMesh = buildAtmosphere(currentPlanet, surface.radius);
  scene.add(atmosphereMesh);

  ringMesh = buildRings(currentPlanet, surface.radius);
  if (ringMesh) scene.add(ringMesh);

  starfield = buildStarfield(system.seed, 5000, 6e8);
  scene.add(starfield);

  sunBillboard = buildSun(system.star, 4e7);
  scene.add(sunBillboard);

  cloudDeck = buildClouds(currentPlanet, surface.radius, system.seed);
  if (cloudDeck) scene.add(cloudDeck);

  // The city is generated data already — render it (§21).
  const cityPoi = surface.pointsOfInterest().find((p) => p.kind === 'city');
  if (cityPoi) {
    const city = generateCity(cityPoi, currentPlanet);
    cityMesh = buildCityMesh(city, surface);
    scene.add(cityMesh);
    currentCity = city;
  } else {
    currentCity = null;
  }

  if (arriveOnSurface) {
    // Land near the city if there is one — §123 opens with the city in sight.
    const pad = cityPoi || surface.pointsOfInterest().find((p) => p.kind === 'landing_pad');
    const dir = pad ? pad.dir : { x: 0, y: 1, z: 0 };
    player.spawnAt(surface, dir, 0.1);

    // Aim the sun so the spawn point starts in mid-morning light rather than
    // on the night side — a fixed direction put the very first build in the
    // dark, which read as a black screen.
    const up = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    let side = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    side = side.sub(up.clone().multiplyScalar(up.dot(side))).normalize();
    sunAxisDir = up.clone().multiplyScalar(0.72).add(side.multiplyScalar(0.68)).normalize();
    sunEpochS = world.timeS;

    // Face whatever is most dramatic on the skyline, and stand the ship in
    // that same direction so the opening shot has the ship in frame with the
    // landscape behind it.
    const scenic = findScenicBearing(surface, dir);
    player.yaw = scenic ? scenic.yaw : 0;
    player.pitch = 0;

    const { east, north } = tangentBasis(dir);
    // Set the ship down ahead and to one side, seen broadside: nose-on from
    // directly behind, a ship is an unreadable dark blob.
    const shipOffset = 34;
    const shipBearing = player.yaw + 0.42;
    const bx = Math.sin(shipBearing), bz = Math.cos(shipBearing);
    const offE = bx * shipOffset, offN = bz * shipOffset;
    const sx = dir.x * surface.radius + east.x * offE + north.x * offN;
    const sy = dir.y * surface.radius + east.y * offE + north.y * offN;
    const sz = dir.z * surface.radius + east.z * offE + north.z * offN;
    const sl = Math.hypot(sx, sy, sz) || 1;
    const sDir = { x: sx / sl, y: sy / sl, z: sz / sl };
    const shipR = surface.radiusAt(sDir.x, sDir.y, sDir.z) + 4;
    ship.pos = { x: sDir.x * shipR, y: sDir.y * shipR, z: sDir.z * shipR };
    ship.vel = { x: 0, y: 0, z: 0 };
    ship.landed = true;
    mode = 'surface';
  }

  scenery.setExclusions([
    { pos: { ...player.pos }, radius: 15 },
    { pos: { ...ship.pos }, radius: 26 },
  ]);

  const focusDir = mode === 'surface' ? dirOf(player.pos) : dirOf(ship.pos);
  terrain.update(focusDir);
  scenery.rebuild(focusDir);
  creatures.rebuild(focusDir);
  bootStatus.textContent = '';
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

bootStatus.textContent = 'searching for a habitable system…';
const { system: startSystem, planetIndex: startIndex } = findStartSystem();

shipModel = buildShipModel(ship.classId, ship.stats.mass | 0);
scene.add(shipModel);

fpRig = buildFirstPersonRig(player.jetpack.installed);
camera.add(fpRig);

weatherFX = new WeatherParticles(scene, 1200);

loadSystem(startSystem, startIndex, true);
document.getElementById('boot-screen').classList.add('hidden');
announce(`${currentPlanet.name.toUpperCase()}\nFIRST LANDING`, 4);

/* ------------------------------------------------------------------ */
/* Per-frame helpers                                                   */
/* ------------------------------------------------------------------ */


/**
 * Orient an object so its +Y is the local surface normal and its +Z points
 * along a bearing in the local tangent plane. Used to stand the ship on the
 * ground pointing somewhere sensible rather than at an arbitrary roll.
 */
const _m4 = new THREE.Matrix4();
function orientOnSurface(obj, upDir, yaw) {
  const { up, east, north } = tangentBasis(upDir);
  const fx = east.x * Math.sin(yaw) + north.x * Math.cos(yaw);
  const fy = east.y * Math.sin(yaw) + north.y * Math.cos(yaw);
  const fz = east.z * Math.sin(yaw) + north.z * Math.cos(yaw);
  // right = up x forward
  const rx = up.y * fz - up.z * fy;
  const ry = up.z * fx - up.x * fz;
  const rz = up.x * fy - up.y * fx;
  _m4.makeBasis(
    new THREE.Vector3(rx, ry, rz).normalize(),
    new THREE.Vector3(up.x, up.y, up.z),
    new THREE.Vector3(fx, fy, fz).normalize(),
  );
  obj.quaternion.setFromRotationMatrix(_m4);
}

/** Position an object at (truePos - origin) — the floating-origin trick. */
function positionRelative(obj, truePos, origin) {
  if (!obj) return;
  obj.position.set(truePos.x - origin.x, truePos.y - origin.y, truePos.z - origin.z);
}

function currentSunDirection() {
  const tilt = currentPlanet.axialTilt || 0;
  const spinAxis = new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0.15).normalize();
  const dayLength = Math.max(120, currentPlanet.dayLengthS || 3600);
  const angle = ((world.timeS - sunEpochS) / dayLength) * Math.PI * 2;
  return sunAxisDir.clone().applyAxisAngle(spinAxis, angle);
}

function updateSun(origin, sunDir) {
  // The directional light is placed relative to the camera, which sits at the
  // origin — only its direction matters for lighting.
  sunLight.position.set(sunDir.x * 1000, sunDir.y * 1000, sunDir.z * 1000);
  sunLight.target.position.set(0, 0, 0);

  const up = dirOf(origin);
  const elevation = sunDir.x * up.x + sunDir.y * up.y + sunDir.z * up.z;
  // Dim and warm the light as the sun sets; kill it below the horizon.
  const day = Math.max(0, Math.min(1, (elevation + 0.12) / 0.42));
  sunLight.intensity = 0.15 + day * 2.6;
  sunLight.color.setRGB(1, 0.72 + day * 0.28, 0.5 + day * 0.5);
  ambient.intensity = 0.12 + day * 0.5;
  bounce.intensity = 0.08 + day * 0.45;

  if (atmosphereMesh) {
    atmosphereMesh.material.uniforms.uSunDir.value.copy(sunDir);
    atmosphereMesh.material.uniforms.uCameraUp.value.set(up.x, up.y, up.z);
    atmosphereMesh.material.uniforms.uSunElevation.value = elevation;
  }
  if (sunBillboard) placeSun(sunBillboard, sunDir, camera);
  return day;
}

/** Distance fog tuned to the planet's atmosphere, so depth reads properly. */
function updateFog(daylight) {
  const atm = Math.max(0, currentPlanet.atmosphere || 0);
  if (mode === 'space' || atm < 0.08) {
    scene.fog = null;
    scene.background = null;
    return;
  }
  const density = 0.0000055 * Math.min(3, atm);
  if (!scene.fog) scene.fog = new THREE.FogExp2(0x8fbfe0, density);
  scene.fog.density = density;
  const c = scene.fog.color;
  c.setRGB(0.30 + daylight * 0.32, 0.42 + daylight * 0.30, 0.55 + daylight * 0.28);
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  input.update();
  world.advance(dt * 60);

  let promptText = '';
  let warnings = [];
  const sunDir = currentSunDirection();

  if (mode === 'surface') {
    /* ---------------- on foot ---------------- */
    player.yaw -= input.state.look.x * 0.0022;
    player.pitch -= input.state.look.y * 0.0022;
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));

    const pDir = dirOf(player.pos);
    const weather = weatherAt(currentPlanet, pDir, world.timeS);

    player.update(dt, {
      move: input.state.move, jump: input.state.jump, sprint: input.state.sprint,
      crouch: input.state.crouch, jetThrottle: input.state.jetThrottle,
    }, surface, currentPlanet, { weather });

    const origin = player.pos;
    const newDir = dirOf(origin);

    // Stream terrain, and follow it with scenery/wildlife.
    terrain.update(newDir);
    if (scenery.needsRebuild(newDir)) scenery.rebuild(newDir);
    if (creatures.needsRebuild(newDir)) creatures.rebuild(newDir);

    camera.position.set(0, 0, 0);
    const look = player.lookDirection();
    camera.up.set(newDir.x, newDir.y, newDir.z);
    camera.lookAt(look.x, look.y, look.z);

    terrain.setVisible(true);
    terrain.place(origin);
    scenery.setVisible(true);
    scenery.place(origin);
    creatures.setVisible(true);
    creatures.update(dt, origin, world.timeS);

    positionRelative(atmosphereMesh, { x: 0, y: 0, z: 0 }, origin);
    if (ringMesh) positionRelative(ringMesh, { x: 0, y: 0, z: 0 }, origin);
    if (cityMesh) {
      positionRelative(cityMesh, cityMesh.userData.worldCenter, origin);
      cityMesh.visible = true;
    }
    positionRelative(starfield, { x: 0, y: 0, z: 0 }, origin);
    starfield.visible = currentPlanet.atmosphere < 0.55;
    if (planetFarMesh) planetFarMesh.visible = false;

    positionRelative(shipModel, ship.pos, origin);
    // Stand the parked ship upright, nose pointing away from the player.
    orientOnSurface(shipModel, dirOf(ship.pos), player.yaw - Math.PI * 0.5);
    shipModel.visible = true;
    setShipThrust(shipModel, 0);
    animateShip(shipModel, dt);

    if (cloudDeck) {
      cloudDeck.visible = true;
      cloudDeck.position.set(0, 0, 0);
      placeClouds(cloudDeck, newDir, camera, world.timeS, weather.windSpeed);
    }

    const daylight = updateSun(origin, sunDir);
    updateFog(daylight);

    weatherFX.setWeather(weather);
    weatherFX.update(dt, newDir, weather.windSpeed);
    weatherFX.place(origin);

    // First-person body.
    fpRig.visible = true;
    const hSpeed = Math.hypot(player.vel.x, player.vel.y, player.vel.z);
    updateFirstPersonRig(fpRig, {
      speed: hSpeed, jetThrottle: player.jetpack.throttle,
      dt, grounded: player.onGround,
    });

    if (distanceTo(player.pos, ship.pos) < 16) {
      promptText = 'E — Board ship';
      if (input.state.interact) { mode = 'ship_landed'; announce('', 0); }
    }
    warnings = player.warnings.slice();
    if (!player.alive) {
      warnings.push('YOU HAVE DIED — press R to respawn');
      if (input.keys.has('KeyR')) {
        player.alive = true; player.health = 100; player.oxygen = 100;
        player.spawnAt(surface, dirOf(ship.pos));
      }
    }
  } else {
    /* ---------------- in the ship ---------------- */
    const shipDir = dirOf(ship.pos);
    const alt = Math.hypot(ship.pos.x, ship.pos.y, ship.pos.z)
      - surface.surfaceRadiusAt(shipDir.x, shipDir.y, shipDir.z);

    if (mode === 'ship_landed') {
      if (input.state.interact && distanceTo(player.pos, ship.pos) < 24) {
        mode = 'surface';
        player.spawnAt(surface, dirOf(ship.pos), 1.0);
      }
      promptText = 'W — Launch · E — Disembark';
      if (input.state.move.y > 0.5) {
        ship.landed = false;
        mode = 'ship_flight';
        // Point thrust at local "up" for liftoff — otherwise the ship keeps
        // whatever near-horizontal attitude it landed in and just skids.
        ship.orientation.pitch = Math.asin(Math.max(-1, Math.min(1, shipDir.y)));
        ship.orientation.yaw = Math.atan2(shipDir.x, shipDir.z);
      }
    }

    if (mode !== 'ship_landed') {
      const gravityDir = { x: -shipDir.x, y: -shipDir.y, z: -shipDir.z };
      const inAtmo = mode !== 'space';
      const atmosphere = inAtmo
        ? Math.max(0, (currentPlanet.atmosphere || 0) * Math.max(0, 1 - alt / 90000))
        : 0;

      // Throttle (W/S) and attitude (mouse, Q/E roll) are independent axes.
      ship.update(dt, {
        throttle: Math.max(0, input.state.move.y),
        pitch: -input.state.look.y * 0.02,
        yaw: input.state.look.x * 0.02,
        roll: (input.keys.has('KeyQ') ? 1 : 0) - (input.keys.has('KeyE') ? 1 : 0),
        nitro: input.state.nitro,
        chargeLightbreak: input.state.lightbreakHold,
        lightbreak: mode === 'space' ? input.state.lightbreakHold : undefined,
      }, { gravity: mode === 'space' ? 0 : currentPlanet.gravity, gravityDir, atmosphere });

      // Ground contact so the ship can't burrow into terrain.
      if (mode !== 'space') {
        const groundR = surface.surfaceRadiusAt(shipDir.x, shipDir.y, shipDir.z);
        const r = Math.hypot(ship.pos.x, ship.pos.y, ship.pos.z);
        if (r < groundR + 4) {
          const nr = groundR + 4;
          ship.pos = { x: shipDir.x * nr, y: shipDir.y * nr, z: shipDir.z * nr };
          const vDot = ship.vel.x * shipDir.x + ship.vel.y * shipDir.y + ship.vel.z * shipDir.z;
          if (vDot < 0) {
            ship.vel.x -= shipDir.x * vDot; ship.vel.y -= shipDir.y * vDot; ship.vel.z -= shipDir.z * vDot;
          }
          if (ship.speed < 4) { ship.landed = true; mode = 'ship_landed'; }
        }
      }

      if (mode === 'ship_flight' && alt > 60000) {
        mode = 'space';
        announce('ORBIT REACHED', 2.5);
      }
      if (mode === 'space' && alt < 40000 && ship.speed < 400) mode = 'ship_flight';

      if (ship.lightbreak.engaged) {
        lightbreakRunTime += dt;
        if (lightbreakRunTime > 4 && mode === 'space') {
          performSystemJump();
          lightbreakRunTime = 0;
        }
      } else {
        lightbreakRunTime = Math.max(0, lightbreakRunTime - dt * 2);
      }

      warnings = ship.warnings.slice();
      promptText = ship.lightbreak.engaged
        ? 'LIGHTBREAK ENGAGED'
        : mode === 'space' ? 'B — charge Lightbreak · N — Nitro' : 'W — throttle · Q/E — roll';
    }

    /* ---- camera and placement, cockpit view ---- */
    const origin = ship.pos;
    const upDir = dirOf(origin);
    camera.position.set(0, 0, 0);
    const fwd = ship.forward();
    camera.up.set(upDir.x, upDir.y, upDir.z);
    camera.lookAt(fwd.x, fwd.y, fwd.z);

    const nearGround = mode !== 'space' && alt < 30000;
    terrain.setVisible(nearGround);
    scenery.setVisible(nearGround && alt < 3000);
    creatures.setVisible(nearGround && alt < 1500);
    if (nearGround) {
      terrain.update(upDir);
      terrain.place(origin);
      if (scenery.needsRebuild(upDir)) scenery.rebuild(upDir);
      scenery.place(origin);
      creatures.update(dt, origin, world.timeS);
    }

    positionRelative(atmosphereMesh, { x: 0, y: 0, z: 0 }, origin);
    if (ringMesh) positionRelative(ringMesh, { x: 0, y: 0, z: 0 }, origin);
    if (cityMesh) {
      positionRelative(cityMesh, cityMesh.userData.worldCenter, origin);
      cityMesh.visible = mode !== 'space';
    }
    positionRelative(starfield, { x: 0, y: 0, z: 0 }, origin);
    starfield.visible = true;

    if (cloudDeck) cloudDeck.visible = false;
    weatherFX.setWeather(null);

    // Show the ship model from outside while landed; hide it in the cockpit.
    shipModel.visible = mode === 'ship_landed';
    if (shipModel.visible) {
      positionRelative(shipModel, ship.pos, origin);
      orientOnSurface(shipModel, upDir, ship.orientation.yaw || 0);
    }
    setShipThrust(shipModel, ship.throttle, ship.nitro.active);
    animateShip(shipModel, dt);
    fpRig.visible = false;

    const daylight = updateSun(origin, sunDir);
    updateFog(daylight);

    // Once clearly in space, show the whole planet below.
    if (mode === 'space') {
      if (!planetFarMesh) {
        planetFarMesh = buildPlanetMesh(surface, 5);
        scene.add(planetFarMesh);
      }
      positionRelative(planetFarMesh, { x: 0, y: 0, z: 0 }, origin);
      planetFarMesh.visible = true;
    } else if (planetFarMesh) {
      planetFarMesh.visible = false;
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

/** §123's "NEW SYSTEM DISCOVERED" moment. */
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

  const dir = { x: 0.4, y: 0.6, z: 0.4 };
  const l = Math.hypot(dir.x, dir.y, dir.z);
  const r = surface.radius + 80000;
  ship.pos = { x: (dir.x / l) * r, y: (dir.y / l) * r, z: (dir.z / l) * r };
  ship.vel = { x: 0, y: 0, z: 0 };
  mode = 'space';
  announce(`${full.name.toUpperCase()}\nUNKNOWN WORLD — FIRST DISCOVERY`, 5);
}

requestAnimationFrame(frame);

// Exposed for debugging and the automated smoke test.
window.__ULTRA_COSMOS__ = {
  world, ship, player, scene, camera, renderer,
  get mode() { return mode; },
  get planet() { return currentPlanet; },
  get terrain() { return terrain; },
  get scenery() { return scenery; },
  get city() { return currentCity; },
};
