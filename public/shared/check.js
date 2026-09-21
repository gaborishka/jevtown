// One check from start to finish: Jev says whom the text is for, the text goes out in waves while
// people are glad to see it, those who stopped answer the preset's follow-up question, and then up
// to four questions go to up to 100 of the people it reached. The caller supplies the way to Jev, so
// the same code runs in the terminal, in tests and, cut into pieces, in the Worker.
import { crowd } from './personas.js';
import { PRESETS, priceLadder, lookOf, listOf, answersFor, LISTS, NOT_SHOWN, CANT_TELL } from './presets.js';
import { reactionRequest, followUpRequest, askRequest, openingRequest, openingAnswers, questionId } from './requests.js';
import { firstWave, nextWave, mood, travels, gatherAsked, asking, emptyGathered, WAVES } from './feed.js';
import { drawReaction, drawAnswer, expectedTone } from './draw.js';
import { eachLimit } from './jev.js';
import { rng, hash32 } from './rng.js';

export const PER_REQUEST = 100;
export const AT_ONCE = 8;
export { NOT_SHOWN };

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * One closing question (presets.js:ASKS) asked of `people` in one request, the answers tallied by
 * list: `asked` counts the people Jev answered for, `totals` sums their probabilities, the drain
 * included. Every person's own answer is drawn for the map and the voices and kept only when it is a
 * real one. reactionOf(id) is what each of them did.
 * → { part: { lists: { [list]: { asked, totals } }, picks: { [list]: { [answer]: [personId, …] } } }, usd, tokens }
 */
export async function askQuestion(send, question, { presetId, text, people, reactionOf, pool, versionId }) {
  const { answers, usd, tokens } = await send(askRequest(question, presetId, text, people, reactionOf));
  const lists = {};
  const picks = {};
  for (const who of people) {
    const look = lookOf(presetId, reactionOf(who.id));
    const offered = answersFor(question, presetId, look);
    const probabilities = Object.fromEntries(Object.entries(answers[questionId(who)]?.probabilities ?? {}).filter(([id]) => id in offered));
    if (!Object.keys(probabilities).length) continue;
    const list = listOf(question, look);
    const tally = (lists[list] ??= { asked: 0, totals: {} });
    tally.asked += 1;
    for (const [id, value] of Object.entries(probabilities)) tally.totals[id] = (tally.totals[id] ?? 0) + value;
    const pick = drawAnswer(probabilities, pool, who.id, versionId, question);
    if (pick !== CANT_TELL) ((picks[list] ??= {})[pick] ??= []).push(who.id);
  }
  for (const tally of Object.values(lists)) for (const id of Object.keys(tally.totals)) tally.totals[id] = round2(tally.totals[id]);
  return { part: { lists, picks }, usd, tokens };
}

/** The lists a closing question fills with the answers of `ids`: why fills one for each look among them. */
export const listsOf = (question, presetId, ids, reactionOf) => [...new Set(ids.map((id) => listOf(question, lookOf(presetId, reactionOf(id)))))];

/**
 * The answered parts of the closing questions as one, in the order of LISTS. `missing` names the lists
 * a question would have filled: 'failed' when it was asked and not answered, 'budget' when the day's
 * money was spent before it. → { lists, picks, missing }
 */
export function mergeSaid(parts, missing = {}) {
  const said = { lists: {}, picks: {}, missing: {} };
  for (const list of LISTS) {
    const part = parts.find((candidate) => candidate.lists[list]);
    if (part) {
      said.lists[list] = part.lists[list];
      said.picks[list] = part.picks[list] ?? {};
    }
    if (missing[list]) said.missing[list] = missing[list];
  }
  return said;
}

/**
 * runCheck({ send, presetId, pool, text, versionId, prices, currency, maxWaves, onWave, blocking, mayGoOn }) → the finished check,
 * with `said` (what the people asked at the end answered, as mergeSaid gives it) and `checks`, `unlisted`
 * and `blocked` from the opening request, acted upon only with `blocking`.
 * send(request) → { answers, tokens, usd } is `ask` bound to a provider. onWave(wave, reactions) is called
 * after every wave, for whoever draws the grid.
 * blocking: act on the opening request's moderation questions as the Worker does, so a text the site
 * would not post is read by nobody.
 * mayGoOn(wave): called after a wave that travels; false stops the check there, for a caller with a
 * clock or a budget of its own.
 */
export async function runCheck({ send, presetId, pool, text, versionId, prices, currency, maxWaves = WAVES.length, onWave, blocking = false, mayGoOn }) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`unknown preset: ${presetId}`);
  const people = crowd(pool);
  const keys = Object.keys(preset.reactions);
  const startedAt = performance.now();
  const spent = { tokens: 0, usd: 0, requests: 0, failed: 0 };
  const paid = async (request) => {
    const result = await send(request);
    spent.tokens += result.tokens;
    spent.usd += result.usd;
    spent.requests += 1;
    return result;
  };

  /** Asks `build(batch)` about everybody in `who`; calls answer(persona, probabilities) for each. A failed batch leaves its people untouched. */
  const askAbout = (who, build, answer) => eachLimit(chunk(who, PER_REQUEST), AT_ONCE, async (batch) => {
    const { answers } = await paid(build(batch));
    for (const persona of batch) answer(persona, answers[questionId(persona)]?.probabilities ?? {});
  }, (batch, error) => {
    if (error.fatal || error.code === 'no_key') throw error;
    spent.failed += 1;
  });

  const opening = openingAnswers((await paid(openingRequest(presetId, text))).answers);
  const { scores } = opening;
  // As on the site: a text it would not post is read by nobody, and the one request is all it costs.
  if (blocking && opening.blocked.length) {
    const { checks, unlisted, blocked } = opening;
    return { presetId, pool, keys, scores, reactions: new Uint8Array(people.length), waves: [], reach: 0, followUp: null, said: mergeSaid([]), checks, unlisted, blocked, ...spent, seconds: (performance.now() - startedAt) / 1000 };
  }

  const reactions = new Uint8Array(people.length);
  const reached = new Map();
  const reactionOf = (id) => reached.get(id);
  const waves = [];
  const random = rng(hash32('waves', pool, versionId));
  let gathered = emptyGathered();
  let wave = firstWave(people, scores, presetId, random);
  for (let index = 0; index < maxWaves && wave.length; index++) {
    const waveStartedAt = performance.now();
    const drawn = [];
    let expected = 0;
    await askAbout(wave, (batch) => reactionRequest(presetId, text, batch), (persona, probabilities) => {
      const reaction = drawReaction(probabilities, pool, persona.id, versionId);
      reactions[persona.id] = 1 + keys.indexOf(reaction);
      reached.set(persona.id, reaction);
      drawn.push(reaction);
      expected += expectedTone(presetId, probabilities);
    });
    // `asked` against `size` shows how many answers failed batches took away; `expectedMood` is the mood over all possible draws.
    const finished = { index, asked: wave.length, size: drawn.length, mood: mood(presetId, drawn), expectedMood: expected / Math.max(1, drawn.length), travels: travels(presetId, drawn), seconds: (performance.now() - waveStartedAt) / 1000 };
    waves.push(finished);
    gathered = gatherAsked(presetId, wave.map((persona) => persona.id), reactionOf, gathered);
    onWave?.(finished, reactions);
    if (!finished.travels || mayGoOn?.(finished) === false) break;
    wave = nextWave(people, reached, scores, presetId, index + 1, random);
  }

  let followUp = null;
  if (preset.followUp) {
    const answers = preset.followUp.answers ?? priceLadder(prices ?? [5, 9, 19, 49], currency);
    const stopped = people.filter((persona) => preset.reactions[reached.get(persona.id)]?.stopped);
    const totals = Object.fromEntries(Object.keys(answers).map((id) => [id, 0]));
    let asked = 0;
    await askAbout(stopped, (batch) => followUpRequest(presetId, text, batch, answers), (persona, probabilities) => {
      asked += 1;
      for (const [id, value] of Object.entries(probabilities)) totals[id] = (totals[id] ?? 0) + value;
    });
    followUp = { answers, asked, totals };
  }

  const parts = [];
  const missing = {};
  await Promise.all(asking(presetId, text, gathered).map(({ question, ids }) => askQuestion(paid, question, { presetId, text, people: ids.map((id) => people[id]), reactionOf, pool, versionId })
    .then(({ part }) => parts.push(part), (error) => {
      if (error.fatal || error.code === 'no_key') throw error;
      spent.failed += 1;
      for (const list of listsOf(question, presetId, ids, reactionOf)) missing[list] = 'failed';
    })));
  const said = mergeSaid(parts, missing);

  const { checks, unlisted, blocked } = opening;
  return { presetId, pool, keys, scores, reactions, waves, reach: reached.size, followUp, said, checks, unlisted, blocked, ...spent, seconds: (performance.now() - startedAt) / 1000 };
}
