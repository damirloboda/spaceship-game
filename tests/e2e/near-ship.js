// Debug helper for tests/e2e/debug.mjs: puts the player at (sx, sz) in ship
// space, facing the ship, in third person. Usage: "$(cat near-ship.js)(30, -2)"
((sx, sz) => {
  const g = window.__game, s = g.ship, b = s.body;
  const V = () => s.root.position.clone();
  const local = b.spin.worldToLocal(s.root.localToWorld(V().set(sx, 0, sz)));
  const target = b.spin.worldToLocal(s.root.localToWorld(V().set(0, 0, -2)));
  const up = local.clone().normalize();
  const fwd = target.sub(local).normalize();
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  g.player.placeOnBody(b, local, fwd);
  if (g.cameraMode !== 'third') g.toggleView();
  return { interaction: g.interaction?.key || null };
})
