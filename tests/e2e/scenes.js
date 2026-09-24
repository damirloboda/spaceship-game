// Debug scenes for tests/e2e/debug.mjs (evaluate one of these expressions).
window.__scenes = {
  // Teleport into nearby deep water and look around.
  ocean() {
    const g = window.__game, p = g.player, b = p.body, s = b.surface;
    const up = p.pos.clone().normalize();
    for (let i = 0; i < 20000; i++) {
      const d = up.clone().add(up.clone().set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4)).normalize();
      const h = s.heightAt(d.x, d.y, d.z);
      if (h < -14) {
        p.placeOnBody(b, d.clone().multiplyScalar(b.radius - 5), p.forward.clone());
        p.pos.copy(d).multiplyScalar(b.radius - 6);
        return { h: Math.round(h) };
      }
    }
    return 'no ocean';
  },
  // Spawn a herd of this planet's creatures in front of the player.
  herd(n = 4) {
    const g = window.__game, p = g.player, f = p.body.fauna;
    const ahead = p.pos.clone().addScaledVector(p.forward, 14);
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = f.spawnAt(ahead, f.species[i % f.species.length]);
      out.push(c && (c.obj.userData.model || 'procedural'));
    }
    return out;
  },
};
// Look at the home planet from high orbit (camera detached in photo mode).
window.__scenes.orbit = (alt = 2.2) => {
  const g = window.__game;
  g.photo.toggle(true);
  const b = g.player.body, cam = g.camera;
  const up = g.player.pos.clone().normalize();
  const side = up.clone().cross(new cam.position.constructor(0, 1, 0)).normalize();
  cam.position.copy(up).multiplyScalar(b.radius * alt).addScaledVector(side, b.radius * 0.8);
  cam.up.copy(up.clone().transformDirection(b.spin.matrixWorld));
  b.spin.updateMatrixWorld(true);
  cam.updateMatrixWorld(true);
  cam.lookAt(b.spin.getWorldPosition(new cam.position.constructor()));
  g.photo.update = () => {};
  document.querySelector('.photo')?.remove();
  return { r: b.radius };
};
// Stand on a beach facing the sea (third person, camera slightly raised).
window.__scenes.beach = () => {
  const g = window.__game, p = g.player, b = p.body, s = b.surface;
  const up = p.pos.clone().normalize();
  const V = () => up.clone();
  for (let i = 0; i < 40000; i++) {
    const d = up.clone().add(V().set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5)).normalize();
    const h = s.heightAt(d.x, d.y, d.z);
    if (h < 0.6 || h > 1.6) continue;
    // Find the downhill direction toward the water.
    const t1 = V().set(0, 1, 0).cross(d).normalize(), t2 = d.clone().cross(t1);
    let best = null, bh = h;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const dd = d.clone().addScaledVector(t1, Math.cos(ang) * 40 / b.radius).addScaledVector(t2, Math.sin(ang) * 40 / b.radius).normalize();
      const hh = s.heightAt(dd.x, dd.y, dd.z);
      if (hh < bh) { bh = hh; best = dd; }
    }
    if (!best || bh > -3) continue;
    const fwd = best.clone().sub(d).normalize();
    p.placeOnBody(b, d.clone().multiplyScalar(b.radius + h), fwd);
    if (g.cameraMode !== 'third') g.toggleView();
    g.hud.bannerQueue.length = 0;
    return { h: +h.toFixed(2), sea: +bh.toFixed(1) };
  }
  return 'no beach';
};
// Fly the jetpack (holds the jump action) and frame the pilot from behind.
window.__scenes.jet = (secs = 1.2) => {
  const g = window.__game;
  g.state.jetpack.owned = true;
  g.state.jetpack.fuel = g.state.jetpack.spec.fuelCapacity;
  if (g.cameraMode !== 'third') g.toggleView();
  g.hud.bannerQueue.length = 0;
  g.input.touch.held.add('jump');
  g.player.vel.addScaledVector(g.player.up, 4);
  g.player.grounded = false;
  g.player.airTime = 0.5;
  g.simulate(secs, 1 / 30);
  return { active: g.player.jetActive, alt: +g.player.body.altitude(g.player.pos).toFixed(1) };
};
// Board, sit and take off (holds the up action), chase camera.
window.__scenes.takeoff = (secs = 3) => {
  const g = window.__game;
  g.enterShipFromOutside();
  g.sitInPilotSeat();
  if (g.cameraMode !== 'third') g.toggleView();
  g.hud.bannerQueue.length = 0;
  g.input.touch.held.add('jump');
  g.input.touch.edges.add('jump');
  g.simulate(secs, 1 / 30);
  return { landed: g.ship.landed, alt: Math.round(g.ship.altitude) };
};
// Force a weather type on the current planet and let it blend in.
window.__scenes.storm = (type = 'sandstorm', secs = 25) => {
  const g = window.__game, b = g.player.body;
  if (g.cameraMode !== 'third') g.toggleView();
  g.weather.force(b, type);
  g.simulate(secs, 1 / 10);
  return { type: g.weather.currentType, blend: +g.weather.blend.toFixed(2) };
};
// Lightning bolt in front of the camera.
window.__scenes.bolt = () => {
  const g = window.__game, b = g.player.body;
  g.weather.force(b, 'storm');
  g.weather.states.get(b.id).blend = 1;
  const at = g.player.pos.clone().addScaledVector(g.player.forward, 900);
  g.weather.strike(b, g.player.pos.clone().addScaledVector(g.player.forward, 0));
  const bolt = g.weather.bolts.at(-1);
  // Move it so it lands ~700 m straight ahead.
  const up = g.player.pos.clone().normalize();
  const target = at.normalize().multiplyScalar(b.groundRadius(at.clone().normalize()));
  bolt.group.position.add(target.sub(bolt.group.children[0].geometry.parameters.path.curves.at(-1).v2));
  return { bolts: g.weather.bolts.length, up: !!up };
};
// Ship high above the planet with a swarm of meteoroids crossing ahead.
window.__scenes.rocks = () => {
  const g = window.__game, s = g.ship;
  g.enterShipFromOutside();
  g.sitInPilotSeat();
  if (g.cameraMode !== 'third') g.toggleView();
  g.hud.bannerQueue.length = 0;
  s.landed = false;
  const up = s.root.position.clone().normalize();
  s.root.position.copy(up).multiplyScalar(s.body.radius + s.body.atmoHeight * 2.2);
  s.vel.set(0, 0, 0);
  s.throttle = 0;
  g.simulate(0.5, 1 / 30);
  const fwd = new up.constructor(0, 0, -1).applyQuaternion(s.root.quaternion);
  const right = new up.constructor(1, 0, 0).applyQuaternion(s.root.quaternion);
  const frame = s.root.parent;
  for (let i = 0; i < 3; i++) {
    g.meteors.spawn(s, frame);
    const m = g.meteors.pool.filter((p) => p.active).at(-1);
    m.root.position.copy(s.root.position).addScaledVector(fwd, 220 + i * 140).addScaledVector(right, -120 + i * 110).addScaledVector(up, 25 - i * 20);
    m.vel.copy(right).multiplyScalar(260).addScaledVector(fwd, 60);
    m.life = 2;
  }
  g.simulate(0.2, 1 / 30);
  return { active: g.meteors.pool.filter((p) => p.active).length, inAtmo: s.inAtmosphere() };
};
