// From the bytes of a finished check to what the post page shows: counters, the segments that
// stopped or got annoyed, the buyers' questions, the demand curve.
import { PRESETS, NOT_SHOWN } from './presets.js';

/** Segments smaller than this are not reported: a handful of people is noise. */
const MIN_SEGMENT = 40;

/** How many personas did what. → { reach, stopped, glad, sorry, byReaction: { liked: 12, ... } } */
export function counters(presetId, keys, reactions) {
  const preset = PRESETS[presetId];
  const byReaction = Object.fromEntries(keys.map((key) => [key, 0]));
  const totals = { reach: 0, stopped: 0, glad: 0, sorry: 0 };
  for (const byte of reactions) {
    if (byte === NOT_SHOWN) continue;
    const reaction = preset.reactions[keys[byte - 1]];
    byReaction[keys[byte - 1]] += 1;
    totals.reach += 1;
    if (reaction.stopped) totals.stopped += 1;
    if (reaction.tone === 1) totals.glad += 1;
    if (reaction.tone === -1) totals.sorry += 1;
  }
  return { ...totals, byReaction };
}

const SEGMENTS = {
  interest: (who) => who.interests,
  field: (who) => [who.field],
  age: (who) => [who.ageGroup],
  temper: (who) => [who.temper],
  budget: (who) => [who.budget],
  shopping: (who) => (who.shopping === 'nothing' ? [] : [who.shopping]),
  city: (who) => [who.city.en],
};

/**
 * Every segment of the crowd: how many of its people the text reached, and what share of the whole
 * segment stopped, was glad, was sorry. People the text never reached count as not stopped, the way
 * a network counts: "56% of all runners stopped" against "10% of everybody". The lifts are those
 * shares over the crowd's. → [{ attribute, value, size, reached, stopped, glad, sorry, stoppedLift, gladLift, sorryLift }]
 */
export function segments(presetId, keys, reactions, people) {
  const preset = PRESETS[presetId];
  const all = counters(presetId, keys, reactions);
  const tallies = new Map();
  for (const who of people) {
    const byte = reactions[who.id];
    const reaction = byte === NOT_SHOWN ? null : preset.reactions[keys[byte - 1]];
    for (const [attribute, valuesOf] of Object.entries(SEGMENTS)) {
      if (attribute === 'shopping' && !preset.market) continue;
      for (const value of valuesOf(who)) {
        const id = `${attribute}:${value}`;
        let tally = tallies.get(id);
        if (!tally) tallies.set(id, (tally = { attribute, value, size: 0, reached: 0, stopped: 0, glad: 0, sorry: 0 }));
        tally.size += 1;
        if (!reaction) continue;
        tally.reached += 1;
        if (reaction.stopped) tally.stopped += 1;
        if (reaction.tone === 1) tally.glad += 1;
        if (reaction.tone === -1) tally.sorry += 1;
      }
    }
  }
  const lift = (count, size, total) => (total ? count / size / (total / people.length) : 0);
  return [...tallies.values()]
    .filter((tally) => tally.size >= MIN_SEGMENT)
    .map((tally) => ({
      ...tally,
      stoppedLift: lift(tally.stopped, tally.size, all.stopped),
      gladLift: lift(tally.glad, tally.size, all.glad),
      sorryLift: lift(tally.sorry, tally.size, all.sorry),
    }));
}

/** The few segments worth naming for one of 'stopped', 'glad', 'sorry': clearly above the crowd, and not a handful of people. */
export function topSegments(all, what, count = 5) {
  return all
    .filter((segment) => segment[what] >= 8 && segment[`${what}Lift`] >= 1.3)
    .sort((a, b) => b[`${what}Lift`] - a[`${what}Lift`])
    .slice(0, count);
}

/**
 * When nobody stands out (the text worked on everybody alike, as a text that reached the whole crowd
 * does): the biggest groups, ordered by how much of each took part.
 */
export function biggestSegments(all, what, count = 5) {
  return [...all]
    .sort((a, b) => b.size - a.size)
    .slice(0, count * 3)
    .filter((segment) => segment[what] >= 8)
    .sort((a, b) => b[what] / b.size - a[what] / a.size)
    .slice(0, count);
}

/** The buyers' questions, most asked first. → [{ id, text, share }] */
export function rankedAnswers(followUp) {
  return Object.entries(followUp.totals)
    .map(([id, total]) => ({ id, text: followUp.answers[id], share: followUp.asked ? total / followUp.asked : 0 }))
    .sort((a, b) => b.share - a.share);
}

/**
 * The demand curve from the price ladder. A shopper who would pay "up to $19" buys at $9 and at $19.
 * → [{ price, buyers, revenue }], buyers being people out of the whole crowd reached.
 */
export function demandCurve(followUp, prices) {
  let buyers = 0;
  const curve = [];
  for (let step = prices.length; step >= 1; step--) {
    buyers += followUp.totals[`p${step}`] ?? 0;
    const people = Math.round(buyers); // the totals are sums of probabilities; the page shows whole people, and the revenue is theirs
    curve.unshift({ price: prices[step - 1], buyers: people, revenue: people * prices[step - 1] });
  }
  return curve;
}
