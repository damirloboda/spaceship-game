# Architecture

Plain ES modules, no bundler. `index.html` maps `three` to a pinned CDN build
(r170); tests use the same version from `node_modules`.

```
src/
  core/      rng (seeded), simplex noise, event bus, error log + guard, safe storage
  config/    build flags (RELEASE disables dev tools), settings & graphics presets
  i18n/      en / ru / tr / uk string tables (no text in game code)
  world/     galaxy (systems), planetGen (height/biome), lifeGen, civGen,
             body (one planet/moon), universe (the loaded system)
  render/    terrain (quadtree LOD), scatter (plants & deposits), fauna, city,
             station, shipModel, shaders, sky, weather, effects, models
  player/    input, player (on foot / interior), ship (flight), skimmer
  game/      game (loop & modes), state, save, items, inventory, jetpack,
             shipSystems, economy, expedition, tools, interactions, director, audio
  ui/        hud, menus, touch, photo, dom helpers
```

## Key decisions

- **Pure logic is separate from rendering.** `world/galaxy`, `world/planetGen`,
  `game/jetpack`, `game/shipSystems`, `game/save`, `game/economy` and friends
  import no rendering code, so they run in Node unit tests.
- **Deterministic generation.** Everything derives from seeds; a planet is the
  same every visit. Only player changes (mined deposits, bases, discoveries)
  are saved.
- **Frames of reference.** Each body has an `anchor` (position + tilt) and a
  `spin` group (day/night rotation). Everything on or near a planet lives in
  its `spin` frame; the ship re-parents between frames at the sphere of
  influence, preserving velocity. Geometry is stored relative to chunk centres
  and a logarithmic depth buffer covers centimetres to millions of kilometres.
- **Streaming.** Terrain chunks and vegetation are built within a per-frame
  time budget, sorted by distance. Only one star system is in memory; a
  Lightbreak jump disposes it and generates the next one while the tunnel
  effect plays.
- **Safe fallback.** Every subsystem update runs inside `guard()`: errors are
  logged, repeated failures disable only that subsystem. Saves keep a backup
  and are migrated by version.
- **Performance budgets.** Quality presets control terrain grid, split
  distance, vegetation density and view distance, shadows, bloom, creature
  count and weather particles; dynamic resolution adapts the pixel ratio to
  the frame time.
