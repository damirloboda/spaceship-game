/**
 * Player character (§55, §56, §86).
 *
 * Position is a full 3D vector in planet space (metres from the planet's
 * centre), so "down" is always toward the core and walking around the world
 * eventually brings you back where you started — no flat-world seams.
 *
 * This module is deliberately free of rendering code: it takes input and a
 * PlanetSurface and produces state. That keeps the movement model testable.
 */
import { Jetpack } from './jetpack.js';
import { BIOMES } from '../gen/planet.js';

/** Per-material movement feel (§59). */
export const MATERIAL_PROPERTIES = {
  sand:    { friction: 0.72, footprints: true,  sound: 'sand',   slowdown: 0.82 },
  snow:    { friction: 0.65, footprints: true,  sound: 'snow',   slowdown: 0.7 },
  ice:     { friction: 0.12, footprints: false, sound: 'ice',    slowdown: 1.05 },
  rock:    { friction: 0.95, footprints: false, sound: 'rock',   slowdown: 1.0 },
  dirt:    { friction: 0.88, footprints: true,  sound: 'dirt',   slowdown: 0.95 },
  metal:   { friction: 0.9,  footprints: false, sound: 'metal',  slowdown: 1.0 },
  crystal: { friction: 0.8,  footprints: false, sound: 'crystal',slowdown: 1.0 },
  organic: { friction: 0.85, footprints: true,  sound: 'organic',slowdown: 0.9 },
  water:   { friction: 0.4,  footprints: false, sound: 'water',  slowdown: 0.45 },
  liquid:  { friction: 0.4,  footprints: false, sound: 'water',  slowdown: 0.45 },
  lava:    { friction: 0.6,  footprints: false, sound: 'lava',   slowdown: 0.5, damage: 40 },
};

const EYE_HEIGHT = 1.68;
const CROUCH_HEIGHT = 0.95;
const PLAYER_MASS = 78;              // kg, before gear

export class Player {
  constructor(opts = {}) {
    // Planet-space position and velocity, in metres.
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };

    // Look angles, radians. Yaw is around the local up axis.
    this.yaw = 0;
    this.pitch = 0;

    this.onGround = false;
    this.crouching = false;
    this.sprinting = false;
    this.swimming = false;
    this.eyeHeight = EYE_HEIGHT;

    this.walkSpeed = 4.4;
    this.sprintSpeed = 8.2;
    this.swimSpeed = 2.6;
    this.jumpImpulse = 4.6;          // m/s at 1g, scaled by gravity below

    this.jetpack = new Jetpack(opts.jetpack || 'none', opts.jetpackUpgrades || []);

    /* Survival (§86) — supportive, not punishing. */
    this.health = 100;
    this.oxygen = 100;
    this.energy = 100;
    this.temperature = 37;           // body core, celsius
    this.suit = {
      sealed: true,
      oxygenCapacity: 100,
      thermalRating: 60,             // kelvin of deviation it can shrug off
      hazardShield: 0.35,            // 0..1 damage reduction
      radiationShield: 0.3,
    };

    this.carryMass = 0;              // set by the inventory
    this.footprintTimer = 0;
    this.lastMaterial = 'rock';
    this.alive = true;
    this.warnings = [];
  }

  get totalMass() {
    return PLAYER_MASS + this.carryMass + (this.jetpack.stats ? this.jetpack.stats.mass : 0);
  }

  /** Unit "up" vector at the player's position. */
  up() {
    const l = Math.hypot(this.pos.x, this.pos.y, this.pos.z) || 1;
    return { x: this.pos.x / l, y: this.pos.y / l, z: this.pos.z / l };
  }

  /** Distance from the planet's centre. */
  radius() {
    return Math.hypot(this.pos.x, this.pos.y, this.pos.z);
  }

  /** Height above the local ground surface. */
  altitude(surface) {
    const u = this.up();
    return this.radius() - surface.surfaceRadiusAt(u.x, u.y, u.z);
  }

  /** Place the player on the ground at a surface direction. */
  spawnAt(surface, dir, extraHeight = 0.1) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const u = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    const r = surface.surfaceRadiusAt(u.x, u.y, u.z) + this.eyeHeight + extraHeight;
    this.pos = { x: u.x * r, y: u.y * r, z: u.z * r };
    this.vel = { x: 0, y: 0, z: 0 };
    this.onGround = true;
  }

  /**
   * Build the local tangent basis (forward/right/up) from the look angles.
   * Forward is the direction the player walks when pressing W.
   */
  basis() {
    const up = this.up();
    // Any vector not parallel to up, to seed the tangent frame.
    let ref = Math.abs(up.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    // east = normalize(cross(ref, up))
    let ex = ref.y * up.z - ref.z * up.y;
    let ey = ref.z * up.x - ref.x * up.z;
    let ez = ref.x * up.y - ref.y * up.x;
    const el = Math.hypot(ex, ey, ez) || 1;
    ex /= el; ey /= el; ez /= el;
    // north = cross(up, east)
    const nx = up.y * ez - up.z * ey;
    const ny = up.z * ex - up.x * ez;
    const nz = up.x * ey - up.y * ex;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const forward = {
      x: nx * cy + ex * sy,
      y: ny * cy + ey * sy,
      z: nz * cy + ez * sy,
    };
    const right = {
      x: ex * cy - nx * sy,
      y: ey * cy - ny * sy,
      z: ez * cy - nz * sy,
    };
    return { forward, right, up, east: { x: ex, y: ey, z: ez }, north: { x: nx, y: ny, z: nz } };
  }

  /** Camera look direction, including pitch. */
  lookDirection() {
    const { forward, up } = this.basis();
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return {
      x: forward.x * cp + up.x * sp,
      y: forward.y * cp + up.y * sp,
      z: forward.z * cp + up.z * sp,
    };
  }

  /**
   * Advance the player one step.
   *
   * @param {number} dt seconds
   * @param {object} input {move:{x,y}, jump, sprint, crouch, jetThrottle}
   * @param {object} surface PlanetSurface
   * @param {object} planet planet record
   * @param {object} env {weather, timeS}
   */
  update(dt, input, surface, planet, env = {}) {
    if (!this.alive) return;
    dt = Math.min(dt, 0.1);                   // never integrate a huge step

    const g = planet.gravity || 9.8;
    const up = this.up();
    const groundR = surface.surfaceRadiusAt(up.x, up.y, up.z);
    const terrainR = surface.radiusAt(up.x, up.y, up.z);
    const alt = this.radius() - groundR;

    this.swimming = surface.hasOcean
      && surface.elevation(up.x, up.y, up.z) < surface.seaLevel
      && alt < this.eyeHeight * 0.6;

    const material = this.swimming ? 'water' : surface.materialAt(up.x, up.y, up.z);
    const mat = MATERIAL_PROPERTIES[material] || MATERIAL_PROPERTIES.rock;
    this.lastMaterial = material;

    const { forward, right } = this.basis();

    /* ---- horizontal movement ---- */
    const wantX = Math.max(-1, Math.min(1, input.move?.x || 0));
    const wantY = Math.max(-1, Math.min(1, input.move?.y || 0));
    const mag = Math.hypot(wantX, wantY);
    this.sprinting = !!input.sprint && mag > 0.1 && !this.crouching && this.energy > 5;
    this.crouching = !!input.crouch && this.onGround;

    let speed = this.swimming ? this.swimSpeed
      : this.sprinting ? this.sprintSpeed
      : this.crouching ? this.walkSpeed * 0.45
      : this.walkSpeed;
    speed *= mat.slowdown;
    // Heavy gear slows you down; so does thin air on an unsealed suit.
    speed *= Math.max(0.45, 1 - this.carryMass / 420);

    let desiredX = 0, desiredY = 0, desiredZ = 0;
    if (mag > 0.001) {
      const nx = wantX / Math.max(1, mag), ny = wantY / Math.max(1, mag);
      desiredX = (forward.x * ny + right.x * nx) * speed;
      desiredY = (forward.y * ny + right.y * nx) * speed;
      desiredZ = (forward.z * ny + right.z * nx) * speed;
    }

    // Split velocity into vertical (along up) and horizontal components.
    let vDot = this.vel.x * up.x + this.vel.y * up.y + this.vel.z * up.z;
    let hx = this.vel.x - up.x * vDot;
    let hy = this.vel.y - up.y * vDot;
    let hz = this.vel.z - up.z * vDot;

    // Ground control is crisp; air control is limited (but jetpack helps).
    const control = this.onGround ? (this.swimming ? 3.5 : 12 * mat.friction)
      : (this.jetpack.active ? 3.0 : 1.2);
    const k = 1 - Math.exp(-control * dt);
    hx += (desiredX - hx) * k;
    hy += (desiredY - hy) * k;
    hz += (desiredZ - hz) * k;

    /* ---- vertical: gravity, jump, jetpack, buoyancy ---- */
    let accV = -g;

    if (this.swimming) {
      // Buoyancy plus drag: you bob rather than sink.
      accV += g * 1.06;
      vDot *= Math.exp(-2.2 * dt);
      if (input.jump) accV += g * 0.9;
    }

    const jetThrust = this.jetpack.update(dt, input.jetThrottle || 0);
    if (jetThrust > 0) {
      accV += jetThrust / this.totalMass;
      this.onGround = false;
    }

    if (input.jump && this.onGround && !this.swimming) {
      // Jump height stays sane across gravities: scale impulse with sqrt(g).
      vDot = this.jumpImpulse * Math.sqrt(Math.max(0.15, g / 9.8));
      this.onGround = false;
    }

    vDot += accV * dt;

    // Atmospheric drag — terminal velocity, and it's why airless worlds are
    // more dangerous to fall on than thick-atmosphere ones.
    const atm = Math.max(0, planet.atmosphere || 0);
    if (atm > 0.01 && !this.onGround) {
      const drag = 0.0016 * atm;
      const sp = Math.abs(vDot);
      vDot -= Math.sign(vDot) * drag * sp * sp * dt;
    }

    // Wind pushes you around in bad weather (§15).
    if (env.weather && env.weather.windSpeed > 8 && !this.onGround) {
      const w = env.weather.windSpeed * 0.012 * dt;
      const { east, north } = this.basis();
      const wd = env.weather.windDir || 0;
      hx += (east.x * Math.cos(wd) + north.x * Math.sin(wd)) * w;
      hy += (east.y * Math.cos(wd) + north.y * Math.sin(wd)) * w;
      hz += (east.z * Math.cos(wd) + north.z * Math.sin(wd)) * w;
    }

    this.vel = {
      x: hx + up.x * vDot,
      y: hy + up.y * vDot,
      z: hz + up.z * vDot,
    };

    /* ---- integrate and resolve ground collision ---- */
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const nu = this.up();
    const standR = surface.surfaceRadiusAt(nu.x, nu.y, nu.z);
    const targetR = standR + (this.crouching ? CROUCH_HEIGHT : this.eyeHeight);
    const curR = this.radius();

    if (curR <= targetR) {
      const impactSpeed = -(this.vel.x * nu.x + this.vel.y * nu.y + this.vel.z * nu.z);
      // Fall damage above a gravity-scaled safe speed.
      const safe = 11 * Math.sqrt(Math.max(0.2, 9.8 / g));
      if (impactSpeed > safe && !this.swimming) {
        this.damage((impactSpeed - safe) * 3.4, 'impact');
      }
      // Snap to the surface and kill the inward velocity component.
      this.pos = { x: nu.x * targetR, y: nu.y * targetR, z: nu.z * targetR };
      const vd = this.vel.x * nu.x + this.vel.y * nu.y + this.vel.z * nu.z;
      if (vd < 0) {
        this.vel.x -= nu.x * vd;
        this.vel.y -= nu.y * vd;
        this.vel.z -= nu.z * vd;
      }
      this.onGround = true;

      // Footprints on soft ground (§60).
      if (mat.footprints) {
        this.footprintTimer -= dt;
        if (this.footprintTimer <= 0 && Math.hypot(hx, hy, hz) > 0.6) {
          this.footprintTimer = 0.42;
          this.pendingFootprint = { pos: { ...this.pos }, normal: nu, material };
        }
      }
    } else {
      this.onGround = false;
    }

    this.eyeHeight = this.crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    this._updateSurvival(dt, surface, planet, env, mat, terrainR);
  }

  /** Oxygen, temperature, energy, hazards (§86). */
  _updateSurvival(dt, surface, planet, env, mat, terrainR) {
    this.warnings.length = 0;
    const up = this.up();

    // Oxygen: only drains where the air is unbreathable.
    const breathable = planet.atmosphere > 0.45 && planet.atmosphere < 4
      && planet.class !== 'toxic' && planet.class !== 'radioactive' && !this.swimming;
    if (breathable) {
      this.oxygen = Math.min(this.suit.oxygenCapacity, this.oxygen + 14 * dt);
    } else {
      const drain = this.swimming ? 3.2 : 1.7;
      this.oxygen -= drain * dt;
      if (this.oxygen < 25) this.warnings.push('OXYGEN LOW');
      if (this.oxygen <= 0) {
        this.oxygen = 0;
        this.damage(9 * dt, 'asphyxiation');
      }
    }

    // Temperature: the suit absorbs a band around comfortable, beyond that
    // your core drifts and you start taking damage.
    const ambientK = surface.temperatureAt(up.x, up.y, up.z);
    const comfortK = 293;
    const deviation = ambientK - comfortK;
    const unshielded = Math.max(0, Math.abs(deviation) - this.suit.thermalRating) * Math.sign(deviation);
    this.temperature += (unshielded * 0.004 - (this.temperature - 37) * 0.35) * dt;
    if (this.temperature > 40) {
      this.warnings.push('HEAT WARNING');
      this.damage((this.temperature - 40) * 5 * dt, 'heat');
    } else if (this.temperature < 34) {
      this.warnings.push('HYPOTHERMIA');
      this.damage((34 - this.temperature) * 5 * dt, 'cold');
    }

    // Weather and surface hazards.
    if (env.weather && env.weather.hazard > 0.05) {
      const exposure = env.weather.hazard * (1 - this.suit.hazardShield);
      if (exposure > 0.1) {
        this.warnings.push(env.weather.label);
        this.damage(exposure * 2.4 * dt, 'weather');
      }
    }
    if (mat.damage) {
      this.warnings.push('SURFACE HAZARD');
      this.damage(mat.damage * (1 - this.suit.hazardShield) * dt, 'surface');
    }
    if (planet.class === 'radioactive') {
      this.damage(1.6 * (1 - this.suit.radiationShield) * dt, 'radiation');
      this.warnings.push('RADIATION');
    }

    // Stamina.
    if (this.sprinting) this.energy = Math.max(0, this.energy - 7 * dt);
    else this.energy = Math.min(100, this.energy + 4.5 * dt);

    // Slow regeneration when nothing is hurting you.
    if (!this.warnings.length && this.health < 100) {
      this.health = Math.min(100, this.health + 0.9 * dt);
    }
  }

  damage(amount, cause = 'unknown') {
    if (amount <= 0 || !this.alive) return;
    this.health -= amount;
    this.lastDamageCause = cause;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
    if (this.health > 0) this.alive = true;
  }

  save() {
    return {
      pos: this.pos, vel: this.vel, yaw: this.yaw, pitch: this.pitch,
      health: this.health, oxygen: this.oxygen, energy: this.energy,
      temperature: this.temperature, suit: this.suit, alive: this.alive,
      jetpack: this.jetpack.save(),
    };
  }

  load(d) {
    if (!d) return;
    Object.assign(this, {
      pos: d.pos || this.pos, vel: d.vel || this.vel,
      yaw: d.yaw || 0, pitch: d.pitch || 0,
      health: d.health ?? 100, oxygen: d.oxygen ?? 100,
      energy: d.energy ?? 100, temperature: d.temperature ?? 37,
      alive: d.alive ?? true,
    });
    if (d.suit) this.suit = { ...this.suit, ...d.suit };
    this.jetpack.load(d.jetpack);
  }
}
