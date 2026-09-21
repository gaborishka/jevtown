// The feed algorithm: who sees a post, and whether it travels further. Wave 1 goes to the people
// Jev thinks the post is for, plus some random ones. Later waves follow the people who really
// reacted, and the grid neighbours of those who spread it. Every post is on its own: the town keeps
// no memory of who wrote what.
import { GRID } from './personas.js';
import { PRESETS } from './presets.js';

// The sizes, the rule and the weights below come from docs/measurements.md.
export const WAVES = [
  { size: 600, random: 100 },
  { size: 1500, random: 150 },
  { size: 3000, random: 300 },
  { size: Infinity, random: 0 },
];
/**
 * A wave sends the text further when the glad reactions outweigh the sorry ones by this share of
 * the wave. Measured on first waves: strong texts give 0.12 to 0.33, weak ones -0.39 to 0.02.
 */
export const GLAD_ENOUGH = 0.1;

/** A persona's attributes as the feed algorithm names them, with how much each one counts. */
const namesOf = (who, market) => [
  ...who.interests.map((id) => [`interest:${id}`, 1]),
  [`field:${who.field}`, 1],
  [`age:${who.ageGroup}`, 0.6],
  ...(market && who.shopping !== 'nothing' ? [[`shopping:${who.shopping}`, 1.5]] : []),
  ...(market ? [[`budget:${who.budget}`, 0.6]] : []),
];
// A wave looks at all 10,000 people, and a free Worker has 10 ms of CPU: the names are built once per persona.
const NAMES = [new WeakMap(), new WeakMap()];
function attributesOf(who, market) {
  const cache = NAMES[market ? 1 : 0];
  let names = cache.get(who);
  if (!names) cache.set(who, (names = namesOf(who, market)));
  return names;
}

/**
 * How much a persona should see the text: the sum of cubes of the scores of its own attributes.
 * The cube lets one strong match ("is looking for a phone") outweigh several lukewarm ones; of the
 * formulas tried it came closest to the best possible order, 83 to 97% of it on the first 500.
 */
export function exposure(who, scores, presetId) {
  return attributesOf(who, Boolean(PRESETS[presetId].market)).reduce((sum, [attribute, weight]) => sum + (weight * (scores[attribute] ?? 0)) ** 3, 0);
}

/**
 * The `size - random` unseen personas that rank highest, best first, plus `random` other unseen ones
 * picked by `random()`. Ranks go through a typed array, which sorts several times faster than objects.
 */
function pick(personas, seen, rank, { size, random: randomCount }, random) {
  const unseen = personas.filter((who) => !seen.has(who.id));
  if (unseen.length <= size) return unseen;
  const ranks = Float64Array.from(unseen, rank);
  const wanted = size - randomCount;
  const cut = Float64Array.from(ranks).sort()[unseen.length - wanted];
  const best = [];
  const rest = [];
  unseen.forEach((who, i) => (ranks[i] > cut ? best : rest).push({ who, rank: ranks[i] }));
  // People exactly on the cut fill the places that are left.
  for (let i = 0; i < rest.length && best.length < wanted; i++) if (rest[i].rank === cut) best.push(...rest.splice(i--, 1));
  const wave = best.sort((a, b) => b.rank - a.rank).map((item) => item.who);
  for (let i = 0; i < randomCount && rest.length; i++) {
    const at = Math.floor(random() * rest.length);
    wave.push(rest[at].who);
    rest[at] = rest.at(-1);
    rest.pop();
  }
  return wave;
}

/** Wave 1: the people Jev thinks the text is for. */
export function firstWave(personas, scores, presetId, random) {
  return pick(personas, new Set(), (who) => exposure(who, scores, presetId), WAVES[0], random);
}

/**
 * The next wave. `reactions` is a Map of persona id → reaction id for everyone reached so far.
 * Every attribute value gets the share of its people who stopped, pulled towards the overall share
 * while only a few of them have seen the text; a persona ranks by its own values, with Jev's first
 * guess as a tie-breaker. Grid neighbours of those who spread the text come first.
 */
export function nextWave(personas, reactions, scores, presetId, waveIndex, random) {
  const preset = PRESETS[presetId];
  const market = Boolean(preset.market);
  const stoppedBy = new Map();
  let reached = 0;
  let stopped = 0;
  for (const who of personas) {
    const reaction = reactions.get(who.id);
    if (reaction === undefined) continue;
    const hit = preset.reactions[reaction]?.stopped ? 1 : 0;
    reached += 1;
    stopped += hit;
    for (const [attribute] of attributesOf(who, market)) {
      const tally = stoppedBy.get(attribute) ?? { seen: 0, stopped: 0 };
      tally.seen += 1;
      tally.stopped += hit;
      stoppedBy.set(attribute, tally);
    }
  }
  const overall = stopped / Math.max(1, reached);
  const PRIOR = 20;
  const share = new Map();
  for (const [attribute, tally] of stoppedBy) share.set(attribute, (tally.stopped + PRIOR * overall) / (tally.seen + PRIOR));

  // The town is 100 people wide; the people visitors moved in live in the rows under the first hundred.
  const size = personas.reduce((most, who) => Math.max(most, who.id + 1), 0);
  const nearSpreader = new Set();
  for (const [id, reaction] of reactions) {
    if (!preset.reactions[reaction]?.spreads) continue;
    const x = id % GRID;
    const y = Math.floor(id / GRID);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < GRID && ny >= 0 && ny * GRID + nx < size) nearSpreader.add(ny * GRID + nx);
      }
    }
  }

  const rank = (who) => {
    const attributes = attributesOf(who, market);
    let best = 0;
    let sum = 0;
    let guess = 0;
    for (const [attribute, weight] of attributes) {
      const value = share.get(attribute) ?? overall;
      if (value > best) best = value;
      sum += value;
      guess += (weight * (scores[attribute] ?? 0)) ** 3;
    }
    return 0.6 * best + 0.4 * (sum / attributes.length) + 0.05 * guess + (nearSpreader.has(who.id) ? 0.1 : 0);
  };
  return pick(personas, new Set(reactions.keys()), rank, WAVES[Math.min(waveIndex, WAVES.length - 1)], random);
}

/** Glad reactions minus sorry ones, as a share of the wave. waveReactions: the reaction ids of that wave alone. */
export function mood(presetId, waveReactions) {
  const preset = PRESETS[presetId];
  const net = waveReactions.reduce((sum, reaction) => sum + (preset.reactions[reaction]?.tone ?? 0), 0);
  return net / Math.max(1, waveReactions.length);
}

/** Does a finished wave send the text further? */
export const travels = (presetId, waveReactions) => mood(presetId, waveReactions) >= GLAD_ENOUGH;
