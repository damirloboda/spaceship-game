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
