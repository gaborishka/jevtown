// One check from start to finish: Jev says whom the text is for, the text goes out in waves while
// people are glad to see it, and those who stopped answer the preset's follow-up question.
// The caller supplies the way to Jev, so the same code runs in the terminal, in tests and, cut into
// pieces, in the Worker.
import { crowd } from './personas.js';
import { PRESETS, priceLadder, NOT_SHOWN } from './presets.js';
import { reactionRequest, followUpRequest, exposureRequest, exposureScores, questionId } from './requests.js';
import { firstWave, nextWave, mood, travels, WAVES } from './feed.js';
import { drawReaction } from './draw.js';
import { eachLimit } from './jev.js';
import { rng, hash32 } from './rng.js';

export const PER_REQUEST = 100;
export const AT_ONCE = 8;
export { NOT_SHOWN };

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * runCheck({ send, presetId, pool, text, versionId, prices, currency, maxWaves, onWave }) → the finished check.
 * send(request) → { answers, tokens, usd } is `ask` bound to a provider. onWave(wave, reactions) is called
 * after every wave, for whoever draws the grid.
 */
export async function runCheck({ send, presetId, pool, text, versionId, prices, currency, maxWaves = WAVES.length, onWave }) {
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

  const scores = exposureScores((await paid(exposureRequest(presetId, text))).answers);

  const reactions = new Uint8Array(people.length);
  const reached = new Map();
  const waves = [];
  const random = rng(hash32('waves', pool, versionId));
  let wave = firstWave(people, scores, presetId, random);
  for (let index = 0; index < maxWaves && wave.length; index++) {
    const waveStartedAt = performance.now();
    const drawn = [];
    await askAbout(wave, (batch) => reactionRequest(presetId, text, batch), (persona, probabilities) => {
      const reaction = drawReaction(probabilities, pool, persona.id, versionId);
      reactions[persona.id] = 1 + keys.indexOf(reaction);
      reached.set(persona.id, reaction);
      drawn.push(reaction);
    });
    const finished = { index, size: drawn.length, mood: mood(presetId, drawn), travels: travels(presetId, drawn), seconds: (performance.now() - waveStartedAt) / 1000 };
    waves.push(finished);
    onWave?.(finished, reactions);
    if (!finished.travels) break;
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

  return { presetId, pool, keys, scores, reactions, waves, reach: reached.size, followUp, ...spent, seconds: (performance.now() - startedAt) / 1000 };
}
