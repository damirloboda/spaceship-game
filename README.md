# ULTRA COSMOS

Open-world space exploration sandbox that runs in the browser (Windows, macOS,
iOS, Android — keyboard + mouse, gamepad or touch). Built with plain
JavaScript ES modules and [three.js](https://threejs.org) r170. There is no
build step and nothing to install to play: open `index.html` through any
static web server.

> **Status: vertical slice (stage 1 of the roadmap).** One complete star system
> with a streaming, walkable planet, a moon, a city with living NPCs, an
> orbital station, a walkable ship with Nitro and Lightbreak, and procedural
> systems beyond it. See [docs/ROADMAP.md](docs/ROADMAP.md) for what is done and
> what comes next.

## Play

```bash
npm start            # serves the folder on http://localhost:8080
```

Add `?dev=1` to the URL for developer tools (press <kbd>`</kbd>).

### The first expedition

1. Wake on **Aurel**, a ringed ocean world. Your ship waits on a pad nearby.
2. Scan (<kbd>F</kbd>) creatures and plants, mine deposits (hold <kbd>LMB</kbd>/<kbd>R</kbd>).
3. Walk to the city of **Solace Reach**, sell resources, buy a **Jetpack**.
4. Help the mechanic recover a lost drone — the reward is a **Nitro** module
   (or buy one).
5. Board the ship, go to **TECHNICAL BAY → ENGINE COMPARTMENT → NITRO SLOT →
   INSTALL**.
6. Sit in the cockpit, take off, fly into orbit, hold **BOOST** for
   **OVERDRIVE** until **LIGHTBREAK READY**.
7. Pick a system on the map (<kbd>M</kbd>) and press <kbd>B</kbd>. Stars turn
   into lines… **NEW SYSTEM DISCOVERED · UNKNOWN WORLD · FIRST DISCOVERY**.

### Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move / look | WASD / mouse | sticks | left stick / drag right |
| Jump · jetpack (hold) | Space | A | JUMP |
| Interact | E | X | USE |
| Scan · mine | F · LMB or R | Y · RT | SCAN · MINE |
| Ship throttle · roll | W/S · A/D, Q/Z | LT/RT | stick |
| Overdrive · Lightbreak | Shift · B | RB · R3 | BOOST · LIGHT BREAK |
| Map · inventory · journal | M · I · J | Select · D-up | MAP · BAG |
| First/third person · photo | V · P | LB · D-down | VIEW · 📷 |

## Features in the slice

- **Procedural galaxy**: infinite sector grid, 11 star types (binary/trinary,
  giants, unstable, black holes), planets, moons, rings, wormholes, derelicts,
  signal-dead "unknown regions". Every system comes from its seed.
- **Seamless planets**: cube-sphere quadtree terrain streamed within a frame
  budget — fly from the ground to orbit with no loading screen. Biomes,
  oceans (swimming and diving), atmospheric scattering, clouds, rings visible
  from the surface, real day/night rotation.
- **Life**: 10 procedural creature species per world with a food chain
  (herbivores flee, predators hunt, populations shift) and 20 plant species.
- **Civilization**: the Veyari Concord city with markets, lab, hospital,
  hotel, workshops and a spaceport; citizens with names, jobs, homes,
  personalities and daily schedules. Ten civilizations defined for later
  stages.
- **Ship**: walkable interior (cockpit, quarters, lab, galley, technical bay
  with an opening engine-compartment panel, workbench, cargo hold), module
  damage and repair, fuel, power distribution, Nitro/Overdrive, Lightbreak
  (in-system cruise and interstellar jumps), autopilot, auto/emergency landing,
  docking at the orbital station.
- **Jetpack** with fuel, heat/overheat and gravity-dependent thrust.
- **Economy & reputation**: supply/demand prices, reputation tiers that change
  prices and access, crafting, research, museum, bases with storage and a
  garage, hover-bike.
- **Living world**: dynamic weather (rain, storms with lightning, snow,
  sandstorms, ash…), meteor showers, city outages, migrations, distress calls,
  radio chatter and the Galactic News Network, an unmarked Precursor mystery.
- **Saves**: versioned local save with migration and backup recovery,
  autosave, export/import code to move progress between PC and phone.
- **UI & settings**: minimalist HUD, graphics presets (PC LOW…CINEMATIC,
  mobile BATTERY…ULTRA MOBILE) with dynamic resolution, accessibility options,
  photo mode, English / Русский / Türkçe / Українська.

## Tests

```bash
npm install          # three.js for the unit tests
npm test             # generation, saves, jetpack, nitro, lightbreak, economy, i18n
npm run test:e2e     # headless Chromium: full slice walkthrough with screenshots
node tests/e2e/gameplay.mjs   # real keyboard input: walk, scan, mine, buy, fly, install Nitro, take off, save/load
```

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
