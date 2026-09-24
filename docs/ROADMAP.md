# Roadmap

Development follows the staged plan: CORE → PLANET → PLAYER → SHIP → JETPACK →
NITRO → LIGHTBREAK → NPC → CITIES → FACTIONS → ECONOMY → EXPEDITIONS →
MULTIPLAYER → OPTIMIZATION, with build · test · fix · profile · optimize ·
document after each stage.

## Stage 1 — vertical slice (this release)

| Area | State |
| --- | --- |
| Core (seeded RNG, noise, events, error guard, storage, i18n) | done, unit tested |
| Galaxy / systems / planets / moons / rings | done, unit tested |
| Streaming planet terrain, oceans, atmosphere, clouds, weather | done |
| Player on foot: walk, sprint, jump, swim, dive, footprints, FP/TP camera | done |
| Jetpack (fuel, heat, gravity) | done, unit + e2e tested |
| Ship: interior, flight, landing, docking, damage/repair, autopilot | done, e2e tested |
| Nitro install in the engine compartment, Overdrive | done, unit + e2e tested |
| Lightbreak: in-system cruise and interstellar jumps | done, unit + e2e tested |
| City, NPC schedules, dialogue, side stories | done |
| Station, markets, reputation, crafting, research, museum | done |
| Base building (single module + storage + garage), skimmer | first version |
| Saves, autosave, export/import between devices | done, unit + e2e tested |
| Settings, presets, touch/gamepad, photo mode, 4 languages | done |

## Next stages

1. **NPC / cities / factions** — cities on other civilised worlds, faction
   territories and diplomacy missions, crew hiring (expedition ship), NPC
   travel between cities and the station.
2. **Economy / expeditions** — trade routes between systems, pirates and
   escort missions, space battles, the expedition ship with modules, cryo
   voyages that advance the simulated galaxy.
3. **World depth** — caves and underground biomes, underwater vehicles and
   bases, giant creatures with lairs, drones and repair robots, larger colonies
   with farms and automation.
4. **Story** — the Lightbreak Gates main arc, more Precursor sites, the Silent.
5. **Multiplayer** — 4-player co-op sharing one ship (pilot, scanner,
   engineer, lab), guilds with shared discovery maps. Needs a backend
   (authoritative server + WebRTC/WebSocket) — not part of the offline slice.
6. **Platforms** — packaged desktop (Tauri) and mobile (Capacitor) builds,
   cloud saves.
7. **Optimization** — Web Worker terrain generation, GPU-instanced grass,
   impostors for distant vegetation, texture streaming.
