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
| Ship lasers | LMB or R (in cockpit) | RT | FIRE |
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
- **Life**: 10 creature species per world with a food chain (herbivores flee,
  predators hunt, populations shift), shown as animated hand-made models —
  farm animals and wolves on Earth-like worlds, penguins and yetis on ice,
  cute monsters on alien worlds — with idle/walk/run/attack/death animations.
  Oceans have schools of fish, rays, dolphins, sharks and whales. 20 plant
  species per world use instanced tree, bush, grass and cactus models (snowy,
  dead or alien variants per planet type), plus decorative boulders.
- **Characters**: pick an animated astronaut (Fernando, Finn or Barbara);
  citizens are animated astronauts and service mechs. The multitool mines
  deposits and doubles as a defence beam against hostile creatures.
- **Civilization**: the Veyari Concord city with markets, lab, hospital,
  hotel, workshops and a spaceport; citizens with names, jobs, homes,
  personalities and daily schedules. Ten civilizations defined for later
  stages.
- **Ship**: walkable interior (cockpit, quarters, lab, galley, technical bay
  with an opening engine-compartment panel, workbench, cargo hold), module
  damage and repair, fuel, power distribution, Nitro/Overdrive, Lightbreak
  (in-system cruise and interstellar jumps), autopilot, auto/emergency landing,
  docking at the orbital station.
- **Sky & grading**: physically based Rayleigh/Mie sky (blue zenith, bright
  horizon, sun disc, orange sunsets, alien-tinted skies); fog takes the sky
  colour in the view direction; filmic colour grade with vignette and grain.
- **Grass**: tens of thousands of wind-animated grass clumps around the player,
  coloured by biome.
- **Ocean**: Gerstner waves, scrolling ripple normals, depth-based absorption
  (turquoise shallows, deep blue), see-through shallows, shore surf and crest
  foam, sub-surface glow, a Fresnel mirror of the real sky with a glittering
  sun path, and dancing caustics on the sea floor.
- **Jetpack**: carbon and chrome pack with glowing thrusters, unfolding fins,
  fuel LEDs, a two-layer plasma flame, a light that washes the ground, sparks,
  smoke trails and ground dust; the pilot leans into the flight.
- **Trade & talk**: shops show the selected item turning on a 3D pedestal;
  Nitro tanks are sold for coins and swap in automatically when Nitro runs
  dry. Conversations are chats with topics (the person, the planet, the city,
  advice, rumours, haggling for a discount) and per-citizen delivery jobs.
- **Graphics**: photo-scanned CC0 textures (Poly Haven) blended triplanar over
  procedural biomes with normal mapping, image-based lighting (reflections of
  the sky or the galaxy), animated ocean waves with foam, a hand-made fighter
  hull with four engine plumes, lens flare, bloom. Skinned models are animated
  with mesh-relative bone matrices so they stay precise millions of metres
  from the world origin.
- **Phones**: third person by default, the move stick sprints at full tilt,
  the USE button pulses and names what it will do (tap the prompt too), aim
  assist for ship lasers and the multitool, haptic feedback. Board the ship
  from anywhere within a few metres of the hull.
- **Asteroid fields** inside planetary rings and star-system belts: streamed
  around the ship, spinning, collidable; shoot them with the twin wing
  lasers and they explode into physically simulated debris and ore.
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

## Model tools

```bash
node tools/convert-models.mjs <srcDir> <outDir> <names>   # Quaternius FBX -> GLB (colour/texture fixes)
node tools/preview-models.mjs out.png <names>             # contact sheet (SIDE=1 side view, ANIM=1 posed)
node tools/pack-models-bundle.mjs <outDir> [chunkMB]      # base64 bundles for hosts that refuse .glb
```

The loader tries `assets/models/<name>.glb` first and falls back to
`assets/models/models.json` bundles when `.glb` files are not served.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

Textures in `assets/textures` are derived from [Poly Haven](https://polyhaven.com) assets (CC0).
Models in `assets/models` (ship, astronauts, trees, animals, monsters, fish) are by
[Quaternius](https://quaternius.com) (CC0); photoscanned plants and rocks (`ph_*`) are
from [Poly Haven](https://polyhaven.com) (CC0) — see `assets/models/LICENSE.md`. If a model
fails to load the game falls back to its procedural geometry. Sounds and shaders are
generated in code.
