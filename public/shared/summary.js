// From the bytes of a finished check to what the post page shows: counters, the segments that
// stopped or got annoyed, the buyers' questions, the demand curve, what the town said when asked,
// the voices. The page, the terminal and whoever reads a check through runCheck read it the same way.
import { PRESETS, REASONS, lookOf, answersFor, questionOfList, NOT_SHOWN, CANT_TELL } from './presets.js';
import { MIN_ASKED } from './feed.js';
import { unit } from './rng.js';

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

/** What the feed algorithm scores people by (feed.js): a temper would name the trolls of every broad text, and a city is not whom a text is written for. */
const SCORED = ['interest', 'field', 'age', 'shopping', 'budget'];

/**
 * The group most often annoyed among the people the text reached: at least MIN_SEGMENT of them reached,
 * at least 8 annoyed, and 1.3 times the share of the whole reach. Counted over the reached, since a
 * group shown the text more would otherwise look more annoyed. → a segment of segments(), or null
 */
export function mostAnnoyed(all, totals) {
  if (!totals.reach) return null;
  const share = totals.sorry / totals.reach;
  return all
    .filter((segment) => SCORED.includes(segment.attribute) && segment.reached >= MIN_SEGMENT && segment.sorry >= 8 && segment.sorry / segment.reached >= 1.3 * share)
    .sort((a, b) => b.sorry / b.reached - a.sorry / a.reached)[0] ?? null;
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

// -- what the town said when asked (presets.js:ASKS)

/** From this share of the people asked, a list says that Jev could place nobody: about three times the most the reaction question's own "can't tell" takes. */
export const DRAIN_NOTE_FROM = 0.2;
/** Where a text check reads as yes or no; between them Jev did not decide. */
export const CHECK_YES_FROM = 0.7;
export const CHECK_NO_UNTIL = 0.3;

/**
 * Which answers lead a list. Answer k is about equal to the leader when the gap between their shares
 * is within two standard errors of it, `2·sqrt((p1 + pk − (p1 − pk)²) / n)`, the summed probabilities
 * taken as n draws. One leader alone is 'one', two or three about equal are 'equal', more are 'none':
 * then no answer stands out. rows: [{ id, share }], most given first. → { kind, ids }
 */
export function leaders(rows, n, most = 3) {
  if (!rows.length) return { kind: 'none', ids: [] };
  const top = rows[0].share;
  const equal = rows.filter((row) => top - row.share <= 2 * Math.sqrt(Math.max(0, top + row.share - (top - row.share) ** 2) / n));
  if (equal.length > most) return { kind: 'none', ids: [] };
  return { kind: equal.length === 1 ? 'one' : 'equal', ids: equal.map((row) => row.id) };
}

/**
 * One list of what the town said, as the page shows it, or null when it was not asked or fewer than
 * MIN_ASKED people's worth of real answers came back. Shares are counted among the real answers, the
 * drain left out, and so is the error of `leaders`: n is the real mass, not the headcount. Every real
 * answer offered is a row, zeros included, most given first and ties in the order offered; an id no
 * longer offered is dropped. → { asked, real, drain, rows: [{ id, share }], lead: { kind, ids } }
 */
export function listView(said, list, presetId) {
  const stored = said?.lists?.[list];
  if (!stored) return null;
  const offered = Object.keys(answersFor(questionOfList(list), presetId, list)).filter((id) => id !== CANT_TELL);
  const real = offered.reduce((sum, id) => sum + (stored.totals[id] ?? 0), 0);
  if (real < MIN_ASKED) return null;
  const rows = offered.map((id) => ({ id, share: (stored.totals[id] ?? 0) / real })).sort((a, b) => b.share - a.share);
  return { asked: stored.asked, real, drain: (stored.totals[CANT_TELL] ?? 0) / stored.asked, rows, lead: leaders(rows, real) };
}

/** A text check's probability → 'yes', 'no' or 'unclear'. */
export const readCheck = (probability) => (probability >= CHECK_YES_FROM ? 'yes' : probability <= CHECK_NO_UNTIL ? 'no' : 'unclear');

/** How much of why they scrolled past is about the text and how much about who read it. view: listView of 'scrolled'. → { text, readers } or null */
export function whySplit(view) {
  if (!view) return null;
  const sum = (audience) => view.rows.reduce((total, row) => total + (Boolean(REASONS[row.id].audience) === audience ? row.share : 0), 0);
  return { text: sum(false), readers: sum(true) };
}

/**
 * People to quote under a post: a seeded shuffle of those who reacted, the rarer reactions first.
 * saidOf(id) → the person's answer to a closing question, or null: with it, people who scrolled past
 * join the mix when they gave a real answer, and whoever answered leads their group. Without it the
 * voices are the ones a post had before the town was asked anything. → [{ id, reaction, look }], and `total`
 */
export function voicesOf(postId, presetId, reactions, only = null, saidOf = null) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const turn = ['spreads', 'sorry', 'glad', 'stopped', 'scrolled']; // the rare reactions speak first: they are the interesting ones
  const keep = only ? 400 : 60; // per reaction; a few thousand objects per card of the feed would be a waste
  const byReaction = new Map();
  for (let id = 0; id < reactions.length; id++) {
    if (!reactions[id]) continue;
    const reaction = keys[reactions[id] - 1];
    const look = lookOf(presetId, reaction);
    const answered = Boolean(saidOf?.(id));
    if (only ? reaction !== only : !turn.includes(look) || (look === 'scrolled' && !answered)) continue;
    let group = byReaction.get(reaction);
    if (!group) byReaction.set(reaction, (group = { look, total: 0, people: [] }));
    group.total += 1;
    group.people.push({ id, reaction, look, order: unit('voice', postId, id) - (answered ? 1 : 0) });
    if (group.people.length > keep * 2) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  }
  const groups = [...byReaction.values()].sort((a, b) => turn.indexOf(a.look) - turn.indexOf(b.look));
  for (const group of groups) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  // Two of each reaction, then two more of each: no reaction drowns the others because it is ten times as common.
  const found = [];
  for (let round = 0; found.length < groups.reduce((sum, group) => sum + group.people.length, 0); round++) {
    for (const group of groups) found.push(...group.people.slice(round * 2, round * 2 + 2));
  }
  found.total = groups.reduce((sum, group) => sum + group.total, 0);
  return found;
}
