# ULTRA COSMOS

A procedurally generated, open-world space exploration sandbox. Everything —
galaxy, stars, planets, terrain, creatures, cities, NPCs, economies, and ten
distinct civilizations — is generated deterministically from seeds, so the
whole universe fits in code rather than in asset files.

Runs in any modern browser via WebGL/Three.js. No build step, no backend.

## Quick start

```
npm install          # installs the dev-only headless browser test dependency
npm run dev           # serves the game at http://localhost:8080
npm test              # runs the automated test suite (51 tests)
```

Open `http://localhost:8080` in a browser, click to lock the pointer, and:

| Action | Key |
|---|---|
| Move | `W A S D` |
| Look | Mouse |
| Jump / jetpack thrust | `Space` (hold to fly once you have a jetpack) |
| Sprint | `Shift` |
| Crouch | `Ctrl` / `C` |
| Interact (board ship, etc.) | `E` |
| Ship: throttle | `W` / `S` |
| Ship: roll | `Q` / `E` |
| Nitro overdrive | `N` |
| Charge / hold Lightbreak | `B` |
| Respawn after death | `R` |

Touch controls (virtual stick + buttons) and gamepad input work automatically
when a touchscreen or a connected controller is detected — see
`src/game/input.js`.

## What's actually here

This is built in the staged order the spec calls for (CORE → PLANET → PLAYER
→ SHIP → JETPACK → NITRO → LIGHTBREAK → NPC/CITIES → ECONOMY/FACTIONS →
render → tests), and every stage was built, tested, and fixed before moving
to the next — see `docs/ARCHITECTURE.md` for the full list of bugs that
testing actually caught (inverted terrain winding, a night-side sun at spawn,
an ecosystem that quietly went extinct on its own, oceans that came out 1%
full instead of 62%, a jetpack that could bench-press a building). Nothing
below is a stub: every listed mechanic runs, is unit-tested, and (for the
player-facing loop) was driven end-to-end in a real headless browser.

**Playable today, first person, in a real render:**
- Walk, run, crouch, jump, and fly with a jetpack (real thrust/fuel/heat, not
  an animation) across seamlessly streamed procedural terrain — 17 planet
  classes, oceans, mountains, craters, caves, biomes, weather.
- Board your ship, take off, climb through the atmosphere into orbit and
  space with no loading screen, install Nitro overdrive by hand in the engine
  bay, charge and engage Lightbreak, and watch a Lightbreak run open a new
  system.
- Survival systems (oxygen, temperature, weather hazards) that support
  exploration rather than fighting you for the sake of it.

**Fully simulated, tested, and ready for a UI (see Roadmap):**
- A galaxy of unbounded size: sectored star systems, 10 star types, black
  holes, wormholes, asteroid belts, and regions the map won't resolve until
  you visit them.
- A living ecosystem per planet: real food chains in equilibrium by
  construction, where hunting a species to the edge measurably cascades
  through its predators.
- Ten hand-designed civilizations with their own languages, architecture,
  tech bias, and a diplomacy simulation that runs wars, alliances and
  territory shifts while you're elsewhere — and player reputation that gates
  real access (docking, trade, prices), not just a label.
- A supply-and-demand economy across every market, with saturation and
  recovery, tied to each planet's ecosystem health.
- Procedural cities (road networks, typed buildings, population-correct
  density) and NPCs with real daily schedules, homes, jobs, and small
  personal stories.
- Ships as a set of physical, damageable modules — refitting genuinely
  changes what the ship can do — plus a skill/profession system that never
  locks you into a class.

## Project layout

```
src/
  core/     seeded RNG, Perlin/ridged/Worley noise (the deterministic bedrock)
  gen/      galaxy, star systems, planets, terrain, creatures, cities, NPCs,
            civilizations, procedural names — pure generation, no game state
  sim/      ecosystem, economy, factions, weather, and the world clock that
            ties them together and keeps running while you're away
  game/     player controller, jetpack, ship, inventory, skill progression,
            input — the interactive layer
  render/   Three.js: terrain streaming, sky/atmosphere/rings/starfield
  ui/       HUD and touch controls
  main.js   the game shell: boots the galaxy and wires everything above into
            a frame loop and a small state machine (surface → ship → orbit →
            deep space → Lightbreak jump)
tests/      51 automated tests (node --test) + a headless-browser smoke test
tools/      dev server, browser smoke-test runner
docs/       architecture notes and the staged build log
vendor/     three.module.js, vendored so the game runs with zero network
            dependency once served
```

## Testing

```
npm test                        # 51 unit/integration tests, ~0.5s
node tools/serve.js &           # start a local server
node tests/browser.smoke.mjs    # real Chromium: boot, walk, board, launch — checks for zero console errors
```

The test suite isn't a formality — it's how most of the real bugs in this
project were found (see `docs/ARCHITECTURE.md` § "What testing actually
caught"). Every generation and simulation system is exercised for
determinism, physical plausibility, and long-run stability (ecosystems are
run forward centuries in the test suite to catch slow-motion bugs that only
show up after a long absence).

## Roadmap

The spec is enormous — a full AAA MMO-scale sandbox. This build follows its
own staged instruction: get each layer *actually working and tested* before
building the next, rather than sketching all 126 sections at once as
placeholders. What exists is real; what's next is:

1. **Galaxy map UI** (3D, GALAXY → SECTOR → SYSTEM → PLANET → LOCATION) — the
   underlying `systemsNear`/sector generation is done and tested, it has no
   screen yet.
2. **Trading/inventory/base-building UI** — `sim/economy.js`,
   `game/inventory.js` and the city/NPC layers are complete; they need
   interactive panels.
3. **Crew, multiplayer, and mission/quest content** on top of the faction and
   NPC systems.
4. **Quadtree LOD** to replace the current single-resolution local patch —
   fine for the vertical slice, but a full planet-scale LOD system is the
   honest next step for far-view fidelity.
5. Localization content (the string-external architecture is ready; only
   English strings are written), settings screens, and cloud save.

See `docs/ARCHITECTURE.md` for design rationale and `docs/ROADMAP.md` for the
fuller section-by-section status against the original spec.
