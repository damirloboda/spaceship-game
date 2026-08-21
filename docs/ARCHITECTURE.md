# Architecture

## Design principle: everything is a pure function of a seed

Nothing procedural is stored. A star system, a planet's terrain, a city's
buildings, an NPC's schedule — all of it is recomputed from integer seeds on
demand (`src/core/rng.js`'s `RNG` and `hashInts`/`hashString`), which is what
lets the galaxy be unbounded while the save file stays kilobytes, not
gigabytes. Only *discoveries and disturbances* are persisted: which systems
you've visited, an ecosystem's population after you've hunted in it, a
market's stock after you've traded there. Anything untouched regenerates
identically from its seed.

The same principle extends to terrain: `PlanetSurface.elevation()`
(`src/gen/planet.js`) is the single source of truth for a world's shape. The
terrain mesh builder and the player/ship collision code both call it, so
there is no separate collision heightmap to drift out of sync with what's
rendered.

## Layering

```
core   →  gen  →  sim  →  game  →  render / ui  →  main.js
```

Each layer only depends on the ones to its left. `sim` (ecosystem, economy,
factions, weather) depends on `gen` (galaxy, planets, creatures) but not on
`render` — the entire simulation is testable and was tested headlessly, with
zero dependency on a browser or GPU. `main.js` is the only file that knows
about all of them at once; it is deliberately thin, a wiring layer over a
small state machine (`surface → ship_landed → ship_flight → space →
Lightbreak jump`).

## Floating-origin rendering

Planet radii run into the millions of metres, well past where a single-
precision GPU matrix keeps sub-metre accuracy. Every object handed to
Three.js is positioned as `truePosition - origin` each frame, with the camera
always at `(0,0,0)` and `origin` equal to the player's or ship's true
position (`positionRelative()` in `src/main.js`). True positions are kept as
ordinary JS numbers (double precision) as the source of truth; only the
render-facing offset is ever small. Terrain patches additionally store their
own local-space vertices independent of world position, for the same reason.

## What testing actually caught

This is the part worth reading if you're wondering whether "tested" here
means anything. In build order:

- **Ugly names.** The first name generator produced things like
  `Ssoashsseehii`. Fixed by rejecting repeated onsets/vowel runs and capping
  word length.
- **Arithmetic-hash noise was 20x too slow to stream terrain.** Sampling
  0.27M elevations/sec meant building one terrain patch took seconds.
  Switched to a seeded permutation-table Perlin implementation; same seed →
  same output (verified), 5.5M fbm/s.
- **A "62% ocean" planet came out 1% underwater.** The analytic sea-level
  formula (an inverse-normal-CDF approximation) was simply wrong. Replaced
  with empirical calibration: sample elevation on a Fibonacci sphere, sort,
  pick the quantile that actually floods the target fraction. Verified exact
  to within measurement noise across all 16 planet classes.
- **The galaxy's starter planet was EXTREME-danger and airless-adjacent.**
  `findStartSystem` wasn't filtering for survivable conditions. Added
  constraints (habitable class, SAFE/LOW danger, breathable gravity range)
  and a calm-star preference — verified by regenerating and inspecting the
  result.
- **The ecosystem quietly drove itself extinct with the player nowhere near
  it.** Three separate bugs stacked: an unstable Euler integrator, death
  rates that didn't scale with metabolism the way birth rates did, and — the
  one that took real diagnosis — prey biomass weighted by raw body mass, so
  one 2400-tonne herbivore effectively *was* the food supply and any wobble
  in its population starved every predator on the planet. Fixed with
  sub-stepping, Kleiber's-law mass weighting, and normalizing food supply
  against each tier's own baseline. Verified: 187 planets, 1000 simulated
  years, zero drift, zero unprovoked extinctions — and hunting a species out
  now visibly cascades through its predators, which is the feature this was
  supposed to have all along.
- **A stock jetpack had a thrust-to-weight ratio of 4.8** — closer to a
  rocket than a backpack, and its heat limiter never bound before the fuel
  tank ran dry, making the "overheat" mechanic dead code. Retuned to ~1.4 TWR
  at 1g with heat as the binding constraint on every model — verified
  numerically for all four jetpack tiers.
- **A single 650-damage hit zeroed a ship's engine, cargo, and shield in one
  shot.** Damage scaling wasn't proportional to hull strength and could hit
  the same subsystem multiple times. Fixed to scale against each hull's own
  strength and hit each system at most once per impact.
- **Nitro reported "READY" after one second of a 22-second recharge** — the
  readiness check compared against a fixed constant instead of a fraction of
  the installed part's actual capacity.
- **The rendered terrain was pure black.** Draw calls were happening (21,524
  triangles submitted) but nothing was visible — turned out to be backface
  culling from a winding order that only sometimes matches the tangent-plane
  projection depending on where on the sphere it's evaluated. Fixed by not
  culling terrain.
- **Still black after that: the sun was on the planet's night side at
  spawn**, because its direction was an arbitrary constant unrelated to where
  the player landed. Fixed by deriving the initial sun direction from the
  spawn point itself (with a proper day/night cycle from there), and while
  fixing it, found and fixed a second bug in the atmosphere shader: it
  measured "altitude" as distance from the planet's centre to a point *on a
  sphere*, which is constant everywhere on that sphere by definition — the
  sky was 100% transparent at every pixel, always. Replaced with a
  horizon-relative fade measured from the camera.
- **Holding W to launch also continuously pitched the ship into the
  ground**, because throttle and pitch were bound to the same keys. Split
  them, and gave liftoff an initial nose-up orientation so thrust actually
  points away from the ground instead of wherever the ship happened to be
  facing when it landed.

All of the above were caught by either the automated test suite
(`tests/*.test.js`, 51 tests) or by actually driving the game in a headless
Chromium via Playwright and checking real state, not by inspection. The
`tests/browser.smoke.mjs` script is the same technique kept around for
regression checking — it boots the real game, walks the player, boards the
ship, launches to orbit, and fails loudly on any console error or a
suspiciously small (i.e. probably-black) rendered frame.

## Performance approach

- **Generation is on-demand and cached**, not precomputed: sector star lists
  cache up to 512 sectors (`SECTOR_CACHE` in `src/gen/galaxy.js`); planet
  surfaces cache up to 24 instances. Nothing is generated until something
  asks for it.
- **Terrain streams as local patches**, not a whole-planet mesh: a
  ~1.4km×1.4km grid centred on the player, rebuilt only once they've moved
  roughly a third of the patch size from its centre. See
  `TerrainStreamer` in `src/render/terrain.js`.
- **World simulation batches into whole-day steps** rather than ticking
  every system every frame (`World.advance` in `src/sim/world.js`), and a
  long time-skip (returning from an absence) samples events across the whole
  elapsed interval instead of just the day you land on.
- Performance budgets are enforced as tests (`tests/performance.test.js`),
  not just claimed: noise throughput, terrain-patch build time, galaxy-map
  query time, and system-generation time all have regression guards.

## Deliberate scope decisions

- **Local terrain patches instead of a whole-planet quadtree.** A real
  quadtree LOD (§4 of the spec) is the correct end state for far-view
  fidelity, but a single streamed local patch already delivers the
  "seamless, walk-for-hours, no loading screens" feel (§54) that's the point
  of the mechanic, and it's honest about being a smaller piece of engineering
  than a full LOD system. Noted in the roadmap, not hidden.
- **Simulation before UI, where a choice had to be made.** Every system in
  `sim/` (economy, factions, ecosystem, weather) is complete and tested but
  several don't have a dedicated screen yet (galaxy map, trading panel, base
  builder). Per the spec's own §120 ("no placeholder UI, no empty menus"), a
  working system with no screen is more honest than a screen wired to
  nothing.
