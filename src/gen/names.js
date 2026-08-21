/**
 * Procedural naming. Each civilization owns a phoneme set, so names read as if
 * they came from a language rather than from a random letter generator.
 */
import { RNG } from '../core/rng.js';

export const PHONEME_SETS = {
  // Human / colonial common tongue
  terran: {
    onset: ['b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'br', 'dr', 'gr', 'kr', 'st', 'tr'],
    nucleus: ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ou'],
    coda: ['n', 'r', 's', 'l', 'm', 'th', 'st', 'nd', 'x', ''],
  },
  // Deep-void ascetics: long vowels, breathy consonants
  vessarid: {
    onset: ['v', 'ss', 'th', 'sh', 'h', 'z', 'l', 'vr', 'shl'],
    nucleus: ['aa', 'ee', 'ii', 'ae', 'oa', 'ei'],
    coda: ['th', 'sh', 'l', 'r', 'n', ''],
  },
  // Silicate hive-builders: hard clicks and stops
  koth: {
    onset: ['k', 'kt', 'g', 'gr', 'd', 'tk', 'q', 'x', 'zk'],
    nucleus: ['a', 'o', 'u', 'ok', 'ak'],
    coda: ['k', 'kt', 'g', 'rr', 'x', 'th'],
  },
  // Gas-giant drifters: flowing liquids
  mirreleth: {
    onset: ['m', 'l', 'n', 'r', 'ml', 'nr', 'lh', 'w'],
    nucleus: ['i', 'e', 'ie', 'ea', 'ei', 'yu'],
    coda: ['l', 'n', 'm', 'th', 'r', ''],
  },
  // Machine lineage: numeric-flavoured, clipped
  arkhon: {
    onset: ['ar', 'kh', 'ok', 'tz', 'ph', 'zr', 'dh'],
    nucleus: ['o', 'a', 'y', 'ei', 'au'],
    coda: ['n', 'k', 'x', 'th', 'r', 'm'],
  },
  // Ancient / precursor tongue — used for ruins and artifacts
  precursor: {
    onset: ['ael', 'sy', 'thal', 'ne', 'ov', 'ur', 'is', 'xa'],
    nucleus: ['aa', 'io', 'ue', 'ei', 'oa'],
    coda: ['n', 'l', 'th', 'r', 's', ''],
  },
};

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Sigma', 'Omega', 'Tau', 'Rho'];
const CATALOG = ['HX', 'KRV', 'NQ', 'ULT', 'VSR', 'ZD', 'PLX', 'ORN', 'THN'];

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build one word from a phoneme set. Syllables are assembled onset+nucleus
 * (+optional coda), then cleaned: no syllable repeats its predecessor's onset,
 * no letter appears three times running, and nothing gets past 12 characters.
 * Without that pass the generator happily produces "Ssoashsseehii".
 */
export function makeWord(rng, setName = 'terran', syllables = 0) {
  const set = PHONEME_SETS[setName] || PHONEME_SETS.terran;
  const n = Math.max(1, Math.min(3, syllables || rng.int(2, 3)));
  let out = '';
  let prevOnset = '';
  for (let i = 0; i < n; i++) {
    let onset = rng.pick(set.onset);
    if (onset === prevOnset) onset = rng.pick(set.onset.filter((o) => o !== prevOnset)) || onset;
    prevOnset = onset;
    // Don't butt a coda straight into an identical-starting onset.
    if (out && onset[0] === out[out.length - 1]) onset = onset.slice(1) || onset;
    out += onset + rng.pick(set.nucleus);
    if (i === n - 1 ? rng.chance(0.6) : rng.chance(0.25)) out += rng.pick(set.coda);
  }
  out = out.replace(/(.)\1{2,}/g, '$1$1');       // "sss" -> "ss"
  out = out.replace(/([aeiou]{3,})/g, (m) => m.slice(0, 2));
  if (out.length > 12) out = out.slice(0, 12).replace(/[^a-z]+$/, '');
  return capitalize(out);
}

/** Star-system designation: either a catalogued code or a proper name. */
export function starName(seed) {
  const rng = new RNG(seed);
  const style = rng.weighted([['catalog', 0.45], ['proper', 0.4], ['greek', 0.15]]);
  if (style === 'catalog') {
    return `${rng.pick(CATALOG)}-${rng.int(100, 9999)}`;
  }
  if (style === 'greek') {
    return `${rng.pick(GREEK)} ${makeWord(rng, rng.pick(['terran', 'vessarid', 'arkhon']), 2)}`;
  }
  return makeWord(rng, rng.pick(['terran', 'vessarid', 'koth', 'mirreleth', 'arkhon']));
}

/** Planets are named after their star: "Vaelan III" style, or given a name. */
export function planetName(seed, star, index) {
  const rng = new RNG(seed);
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  if (rng.chance(0.25)) return makeWord(rng, rng.pick(['terran', 'vessarid', 'mirreleth', 'precursor']));
  return `${star} ${roman[index] || String(index + 1)}`;
}

export function moonName(seed, planet, index) {
  const rng = new RNG(seed);
  if (rng.chance(0.4)) return makeWord(rng, rng.pick(['koth', 'terran', 'precursor']), 2);
  return `${planet} ${String.fromCharCode(97 + index)}`;
}

const FIRST_FALLBACK = ['Ada', 'Ilo', 'Mira', 'Sten', 'Yuki', 'Ren', 'Oskar', 'Nadia', 'Tovar', 'Enis', 'Sable', 'Kito'];

/** Person name for an NPC of a given civilization. */
export function personName(seed, phonemes = 'terran') {
  const rng = new RNG(seed);
  const first = rng.chance(0.6) ? makeWord(rng, phonemes, 2) : rng.pick(FIRST_FALLBACK);
  const last = makeWord(rng, phonemes, rng.int(2, 3));
  return `${first} ${last}`;
}

export function shipName(seed) {
  const rng = new RNG(seed);
  const adjectives = ['Long', 'Silent', 'Bright', 'Deep', 'Far', 'Cold', 'Patient', 'Last', 'Iron', 'Quiet'];
  const nouns = ['Horizon', 'Current', 'Lantern', 'Passage', 'Vigil', 'Harvest', 'Meridian', 'Anchor', 'Ember', 'Drift'];
  if (rng.chance(0.35)) return makeWord(rng, rng.pick(['vessarid', 'precursor']), 3);
  return `${rng.pick(adjectives)} ${rng.pick(nouns)}`;
}

export function cityName(seed, phonemes = 'terran') {
  const rng = new RNG(seed);
  const suffix = ['port', 'reach', 'hold', 'gate', 'span', 'basin', 'crest', ''];
  const base = makeWord(rng, phonemes, 2);
  return rng.chance(0.5) ? base + rng.pick(suffix) : base;
}
