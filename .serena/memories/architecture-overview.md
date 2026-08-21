# ULTRA COSMOS — architecture overview (memory, written 2026-08-21)

Layering: `core → gen → sim → game → render/ui → main.js`. Each layer only
depends on layers to its left. Nothing procedural is stored — everything is a
pure function of an integer seed (see `src/core/rng.js`).

## Key files by responsibility
- `src/core/rng.js` — seeded RNG + Perlin/ridged/Worley noise (permutation-table based, fast)
- `src/gen/galaxy.js` — sectored infinite galaxy, star systems, `findStartSystem()`
- `src/gen/planet.js` — `PlanetSurface.elevation()` is the single source of truth for
  terrain shape; both the mesh builder and player/ship collision call it
- `src/gen/civ.js`, `src/gen/city.js`, `src/gen/npc.js`, `src/gen/creature.js` — civilizations, cities, NPCs, fauna/flora
- `src/sim/ecosystem.js` — food-chain population sim, equilibrium by construction (see architecture doc for the bug history)
- `src/sim/economy.js`, `src/sim/faction.js`, `src/sim/weather.js`, `src/sim/world.js` — markets, diplomacy, weather, offline world clock
- `src/game/player.js` — planet-space first-person controller
- `src/game/jetpack.js` — thrust/fuel/heat physics
- `src/game/ship.js` — modular ships, Nitro overdrive, Lightbreak superspeed
- `src/game/inventory.js`, `src/game/progression.js` — containers, skills/professions
- `src/render/terrain.js`, `src/render/sky.js` — Three.js terrain streaming, atmosphere/rings/starfield
- `src/main.js` — the game shell; wires everything into a state machine
  (`surface → ship_landed → ship_flight → space → Lightbreak jump`), uses
  floating-origin rendering (camera always at 0,0,0)
- `tests/*.test.js` — 51 node:test tests; `tests/browser.smoke.mjs` — real headless-Chromium E2E check

## Full docs
See `docs/ARCHITECTURE.md` for design rationale and a detailed list of real
bugs testing caught (ocean coverage, ecosystem extinction cascade, jetpack
balance, terrain backface culling, sun/atmosphere shader bugs, ship control
scheme). See `docs/ROADMAP.md` for section-by-section status against the
original 126-section spec.

## Working conventions
- Test with `npm test` (fast, ~0.5s) before any commit touching gen/sim/game.
- For renderer changes, verify visually: `node tools/serve.js &` then
  `node tests/browser.smoke.mjs` (headless Chromium, checks for a real
  rendered frame + zero console errors, not just that it boots).
- Dev branch: `claude/ultra-cosmos-game-ok4d3u`. PR #1 open against `main`.
