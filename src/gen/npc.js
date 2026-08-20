/**
 * NPCs (§22, §23, §52).
 *
 * Every NPC has a name, a profession, a home, a workplace, a daily schedule
 * they actually follow, a personality that colours their dialogue, and a small
 * story of their own. They are generated from the city seed, so a city of
 * 40,000 people costs nothing until you walk up to one of them — only the few
 * hundred near the player are ever instantiated.
 */
import { RNG, hashInts } from '../core/rng.js';
import { personName } from './names.js';
import { CIV_BY_ID } from './civ.js';

export const PROFESSIONS = {
  trader:      { workplace: 'market',    wealth: [400, 9000], talks: 'prices' },
  mechanic:    { workplace: 'workshop',  wealth: [200, 2500], talks: 'ships' },
  scientist:   { workplace: 'lab',       wealth: [300, 4000], talks: 'research' },
  doctor:      { workplace: 'hospital',  wealth: [500, 6000], talks: 'medicine' },
  pilot:       { workplace: 'spaceport', wealth: [300, 7000], talks: 'routes' },
  farmer:      { workplace: 'farm',      wealth: [100, 1200], talks: 'weather' },
  miner:       { workplace: 'factory',   wealth: [150, 2200], talks: 'deposits' },
  engineer:    { workplace: 'factory',   wealth: [400, 5000], talks: 'machines' },
  guard:       { workplace: 'gate',      wealth: [200, 1800], talks: 'law' },
  cook:        { workplace: 'restaurant',wealth: [120, 1600], talks: 'food' },
  archivist:   { workplace: 'lab',       wealth: [250, 3000], talks: 'history' },
  broker:      { workplace: 'market',    wealth: [800, 24000], talks: 'contracts' },
  navigator:   { workplace: 'spaceport', wealth: [350, 5200], talks: 'stars' },
  biologist:   { workplace: 'lab',       wealth: [300, 3800], talks: 'creatures' },
  geologist:   { workplace: 'lab',       wealth: [300, 3800], talks: 'planets' },
  smuggler:    { workplace: 'spaceport', wealth: [0, 30000],  talks: 'rumours' },
};

const PROFESSION_KEYS = Object.keys(PROFESSIONS);

const TRAITS = ['curious', 'guarded', 'talkative', 'blunt', 'anxious', 'proud', 'generous', 'greedy', 'weary', 'zealous', 'wry', 'homesick'];

/** Small personal stories, filled from the NPC's own context (§52). */
const STORY_TEMPLATES = [
  { id: 'lost_sibling',  hook: 'is looking for a sibling who shipped out and never called back', reward: 'contact' },
  { id: 'bad_debt',      hook: 'owes money to people who do not send reminders', reward: 'credits' },
  { id: 'first_survey',  hook: 'wants one planet named after them before they die', reward: 'reputation' },
  { id: 'broken_part',   hook: 'needs a part nobody on this rock stocks any more', reward: 'goods' },
  { id: 'old_signal',    hook: 'keeps hearing the same signal and everyone says it is nothing', reward: 'coordinates' },
  { id: 'seed_vault',    hook: 'is quietly building a seed vault against a bad year', reward: 'goods' },
  { id: 'left_behind',   hook: 'was left behind by an expedition and has stopped pretending it was a mistake', reward: 'crew' },
  { id: 'buried_map',    hook: 'inherited a map they cannot read', reward: 'coordinates' },
  { id: 'no_story',      hook: null, reward: null },
  { id: 'no_story2',     hook: null, reward: null },
];

/**
 * Generate NPC #i of a settlement.
 * @param {number} settlementSeed
 * @param {number} i index within the settlement
 * @param {string} civId
 * @param {object} layout city layout (for home/work placement)
 */
export function generateNPC(settlementSeed, i, civId, layout = null) {
  const seed = hashInts(settlementSeed, 0x4E, i);
  const rng = new RNG(seed);
  const civ = CIV_BY_ID[civId] || CIV_BY_ID.concord;

  const profession = rng.weighted(PROFESSION_KEYS.map((k) => {
    let w = 1;
    if (k === 'smuggler') w = 0.15 + civ.hostility * 0.5;
    if (k === 'scientist' || k === 'biologist' || k === 'geologist') w = civ.tech.science * 1.4;
    if (k === 'mechanic' || k === 'engineer') w = civ.tech.engines * 1.3;
    if (k === 'miner') w = civ.tech.mining * 1.5;
    if (k === 'doctor') w = civ.tech.medicine * 1.2;
    return [k, w];
  }));
  const def = PROFESSIONS[profession];

  // Home and work are real places in the city layout, which is what makes the
  // daily commute in schedule() go somewhere rather than being decorative.
  const homes = layout ? layout.buildings.filter((b) => b.type === 'home') : [];
  const works = layout ? layout.buildings.filter((b) => b.type === def.workplace) : [];
  const home = homes.length ? homes[i % homes.length] : null;
  const work = works.length ? works[rng.int(0, works.length - 1)] : (homes.length ? homes[(i + 3) % homes.length] : null);

  const shiftStart = rng.weighted([[6, 0.35], [7, 0.25], [8, 0.15], [14, 0.1], [22, 0.15]]);

  return {
    id: `npc_${settlementSeed >>> 0}_${i}`,
    seed,
    name: personName(seed, civ.phonemes),
    civilization: civId,
    profession,
    age: rng.int(19, 96),
    wealth: rng.int(def.wealth[0], def.wealth[1]),
    traits: [rng.pick(TRAITS), rng.pick(TRAITS)].filter((v, idx, a) => a.indexOf(v) === idx),
    talks: def.talks,
    homeId: home ? home.id : null,
    workId: work ? work.id : null,
    shiftStart,
    shiftHours: rng.int(6, 10),
    // Relationships are stored as indices into the same settlement; resolved
    // lazily so we never need the whole population in memory.
    relations: {
      partner: rng.chance(0.45) ? rng.int(0, 200) : null,
      friends: [rng.int(0, 200), rng.int(0, 200)],
      rival: rng.chance(0.25) ? rng.int(0, 200) : null,
    },
    story: rng.pick(STORY_TEMPLATES),
    mood: rng.range(0.3, 0.9),
    metPlayer: false,
  };
}

/**
 * Where an NPC should be at a given local hour (0..24). The renderer walks
 * them between these points, so a city visibly wakes up, commutes, shops and
 * goes home (§23).
 */
export function npcSchedule(npc, hour) {
  const start = npc.shiftStart;
  const end = (start + npc.shiftHours) % 24;
  const inShift = start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);

  if (inShift) return { activity: 'work', target: npc.workId };

  const sinceEnd = (hour - end + 24) % 24;
  if (sinceEnd < 1.5) return { activity: 'commute', target: npc.homeId };
  if (sinceEnd < 3.5) return { activity: npc.wealth > 800 ? 'shop' : 'socialise', target: 'market' };
  if (sinceEnd < 5) return { activity: 'eat', target: 'restaurant' };
  if (sinceEnd < 7) return { activity: 'socialise', target: 'plaza' };
  return { activity: 'sleep', target: npc.homeId };
}

/** One line of contextual dialogue. Not a quest — just a person talking. */
export function npcGreeting(npc, ctx = {}) {
  const rng = new RNG(hashInts(npc.seed, Math.floor(ctx.hour || 0)));
  const civ = CIV_BY_ID[npc.civilization];
  const lines = [];
  const t = npc.traits[0];

  if (t === 'talkative') lines.push(`You're the one who came down in the ship, aren't you. Everyone saw it.`);
  if (t === 'guarded') lines.push(`Mm.`);
  if (t === 'homesick') lines.push(`I was born two systems from here. I still call that "home" and I've stopped correcting myself.`);
  if (t === 'weary') lines.push(`Long shift. Say what you need.`);

  switch (npc.talks) {
    case 'prices': lines.push(`Prices move when a hauler is overdue. One is overdue.`); break;
    case 'ships': lines.push(`Whatever's rattling in your engine bay, it won't fix itself. They never do.`); break;
    case 'research': lines.push(`We catalogue things here. Slowly. Correctly.`); break;
    case 'deposits': lines.push(`There's good ore in the high ground. There's also weather in the high ground.`); break;
    case 'stars': lines.push(`Half the systems on my chart are guesses. The honest half is marked.`); break;
    case 'creatures': lines.push(`Don't scan the big ones from close range. They notice.`); break;
    case 'rumours': lines.push(`Depends who's asking and how loudly.`); break;
    case 'weather': lines.push(`Storm's coming. You can taste it before you see it.`); break;
    default: lines.push(civ ? civ.greeting : 'Hm.');
  }
  return rng.pick(lines);
}
