# Roadmap — status against the original spec

The original brief (126 numbered sections) describes a full AAA MMO-scale
game. This tracks what's real today versus what's next, grouped by theme
rather than section-by-section, since most sections cluster into one system.

Legend: ✅ implemented & tested · 🧩 simulated/generated, no dedicated UI yet ·
⏭ not started

## Galaxy & planets (§2–17, §74–79)
✅ Procedural galaxy (unbounded sectors, spiral-arm density, 10 star types,
black holes, wormholes, unknown regions) · ✅ 17 planet classes with derived
gravity/atmosphere/temperature/danger · ✅ seamless local terrain streaming,
no loading screens between ground/atmosphere/orbit · ✅ rings, weather,
biomes, resources, caves/ruins/crash-site points of interest (some
deliberately unmarked, §37) · 🧩 3D galaxy map (`GALAXY→SECTOR→SYSTEM→PLANET`)
— the query layer (`systemsNear`) is built and tested, no map screen yet ·
⏭ full whole-planet quadtree LOD (current approach: streamed local patches,
see Architecture doc)

## Creatures, ecosystem, civilizations (§16–23, §71–72)
✅ Procedural creature & flora generator, gravity/habitat-aware · ✅ food-chain
ecosystem simulation in equilibrium by construction, with real predation
cascades · ✅ 10 civilizations with distinct language/architecture/tech ·
✅ procedural cities and NPCs with real daily schedules and small personal
stories · ⏭ giant/titan creature "logo" encounters and dedicated
archaeology/museum systems

## Player, ship, Jetpack, Nitro, Lightbreak (§24–33, §55–60, §86–90)
✅ First-person planetary-gravity controller, survival (O2/temp/hazard) ·
✅ real jetpack physics (thrust/fuel/heat, heat binds first) · ✅ 11 ship
classes as physical modular loadouts, real damage/repair · ✅ Nitro installed
into the engine bay, real overdrive multiplier and recharge cycle ·
✅ Lightbreak: charge → engage → superspeed ramp → interstellar jump, aborts
near mass shadows · 🧩 full ship interior walkthrough, crew hiring/relations —
data model exists (`Ship.crew`), no interior mesh or crew UI yet

## Economy, factions, diplomacy (§20, §44–50, §67–68, §81–82)
✅ supply/demand markets with saturation & recovery · ✅ 10-faction diplomacy
sim: wars, alliances, territory, running while the player is elsewhere ·
✅ reputation that gates real access (dock/trade/price), not a label ·
✅ skill/profession progression, fully reversible · 🧩 trading UI, stations/
docking UI, galactic news screen — `World.headlines()` and market objects are
complete and tested, no dedicated panels yet

## World persistence & offline simulation (§50, §107–108)
✅ deterministic save/load for world, ecosystems, markets, factions, player,
ship · ✅ long-absence catch-up samples events across the whole elapsed
interval · ⏭ cloud save sync across devices

## UI, accessibility, platform (§55–58, §109–115)
✅ minimal sci-fi HUD, touch controls, gamepad polling, first-person camera ·
⏭ settings screens (graphics/audio/controls presets), localization content
(architecture supports it; only English strings written), photo mode,
third-person camera toggle

## Multiplayer (§96–99)
⏭ not started — everything in `sim/` and `game/` is written as pure
state + update functions specifically so a netcode layer could drive them
later, but no networking exists yet.

## Testing, tooling, docs (§116–120, §124)
✅ 51 automated tests + a real headless-browser end-to-end smoke test ·
✅ performance budgets enforced as tests · ✅ this doc set · ✅ staged build
order followed (core → planet → player → ship → jetpack → nitro →
lightbreak → NPC/economy/factions → render → test), with each stage actually
verified before the next began — see `docs/ARCHITECTURE.md` for the bug list
that verification produced.
