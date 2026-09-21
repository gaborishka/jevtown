import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../public/shared/check.js';
import { counters, segments, rankedAnswers, demandCurve } from '../public/shared/summary.js';
import { crowd } from '../public/shared/personas.js';

const people = crowd('uk');

/** A stand-in for Jev: gardeners love the text, everybody else scrolls past; buyers ask about the price. */
function fakeJev({ questions }) {
  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'score') answers[id] = { score: id === 'interest:gardening' ? 4 : 0 };
    else if ('negotiable' in question.criteria) answers[id] = { probabilities: { negotiable: 0.6, photos: 0.4 } };
    else if ('p0' in question.criteria) answers[id] = { probabilities: { p1: 0.5, p2: 0.3, p3: 0.2 } };
    else {
      const first = Object.keys(question.criteria)[1];
      const glad = Object.keys(question.criteria)[2];
      answers[id] = { probabilities: /into [^;]*gardening/.test(question.instructions) ? { [glad]: 0.8, [first]: 0.2 } : { scrolled_past: 1 } };
    }
  }
  return Promise.resolve({ answers, tokens: 100, usd: 0.001 });
}

test('a niche text goes to its people first and stops when the rest do not care', async () => {
  const seen = [];
  const result = await runCheck({ send: fakeJev, presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'v1', onWave: (wave) => seen.push(wave.size) });
  const gardeners = people.filter((who) => who.interests.includes('gardening')).length;
  assert.equal(seen[0], 600);
  assert.ok(result.waves.length >= 2 && result.waves.length < 4, `waves: ${result.waves.length}`);
  assert.ok(!result.waves.at(-1).travels);
  const totals = counters('post', result.keys, result.reactions);
  assert.equal(totals.reach, result.reach);
  assert.ok(totals.stopped > 0.8 * gardeners, `stopped ${totals.stopped} of ${gardeners} gardeners`);
  const best = segments('post', result.keys, result.reactions, people).sort((a, b) => b.stoppedLift - a.stoppedLift)[0];
  assert.equal(`${best.attribute}:${best.value}`, 'interest:gardening');
  assert.equal(result.followUp, null);
});

test('the same text and version give the same crowd', async () => {
  const run = () => runCheck({ send: fakeJev, presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'v1', maxWaves: 2 });
  assert.deepEqual((await run()).reactions, (await run()).reactions);
});

test('a text nobody is glad about dies in the first wave', async () => {
  const bored = (request) => fakeJev(request).then((result) => ({ ...result, answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, request.questions[id].type === 'score' ? { score: 1 } : { probabilities: { scrolled_past: 1 } }])) }));
  const result = await runCheck({ send: bored, presetId: 'post', pool: 'en', text: 'meh', versionId: 'v1' });
  assert.equal(result.reach, 600);
  assert.equal(result.waves.length, 1);
});

test('those who stopped answer the follow-up question', async () => {
  const listing = await runCheck({ send: fakeJev, presetId: 'listing', pool: 'uk', text: 'seedlings', versionId: 'v1', maxWaves: 1 });
  assert.ok(listing.followUp.asked > 0);
  assert.deepEqual(rankedAnswers(listing.followUp).slice(0, 2).map((answer) => [answer.id, Number(answer.share.toFixed(2))]), [['negotiable', 0.6], ['photos', 0.4]]);

  const product = await runCheck({ send: fakeJev, presetId: 'product', pool: 'uk', text: 'seedlings', versionId: 'v1', maxWaves: 1, prices: [5, 10, 20] });
  const asked = product.followUp.asked;
  assert.deepEqual(demandCurve(product.followUp, [5, 10, 20]).map((step) => step.buyers), [asked, Math.round(asked * 0.5), Math.round(asked * 0.2)]);
});
