import test from 'node:test';
import assert from 'node:assert/strict';
import { crowd } from '../public/shared/personas.js';
import { exposure, firstWave, nextWave, travels, mood, WAVES } from '../public/shared/feed.js';
import { residentPersona } from '../public/shared/resident.js';
import { drawReaction, CONFIDENT_FROM } from '../public/shared/draw.js';
import { reactionRequest, exposureRequest, exposureScores, questionId } from '../public/shared/requests.js';
import { priceLadder } from '../public/shared/presets.js';
import { rng } from '../public/shared/rng.js';

const people = crowd('uk');
const scores = { 'interest:gardening': 0.95, 'interest:summer_house': 0.8, 'field:agriculture': 0.6, 'age:a60': 0.5, 'shopping:garden': 0.9 };

test('the first wave is the people the text is for, plus some random ones', () => {
  const wave = firstWave(people, scores, 'post', rng(1));
  assert.equal(wave.length, WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
  const gardeners = wave.filter((who) => who.interests.includes('gardening')).length;
  assert.ok(gardeners > 400, `gardeners in wave 1: ${gardeners}`);
  assert.ok(wave.length - gardeners > 50, 'random people are in too');
});

test('a resident a visitor moved in is picked by the same rules, from the row under the grid', () => {
  const gardener = residentPersona('uk', 0, { name: 'Ніна', gender: 'female', age: 66, job: '', city: '', interests: ['gardening', 'summer_house'], temper: 'supporter', budget: 'average', about: '' });
  const town = [...people, gardener];
  assert.ok(firstWave(town, scores, 'post', rng(1)).some((who) => who.id === gardener.id));
  // The neighbour above her reposted: the next wave comes to her door first.
  const reactions = new Map([[gardener.id - 100, 'reposted']]);
  const wave = nextWave(town, reactions, {}, 'post', 1, rng(1));
  assert.ok(wave.some((who) => who.id === gardener.id));
});

test('what a persona is looking to buy counts only for a market', () => {
  const buyer = people.find((who) => who.shopping === 'garden' && !who.interests.includes('gardening'));
  assert.ok(exposure(buyer, scores, 'listing') > exposure(buyer, scores, 'post'));
});

test('the next wave follows those who reacted and skips everyone already reached', () => {
  const wave = firstWave(people, scores, 'post', rng(1));
  // Only football fans stopped: the algorithm guessed wrong, the reactions put it right.
  const reactions = new Map(wave.map((who) => [who.id, who.interests.includes('football') ? 'liked' : 'scrolled_past']));
  const next = nextWave(people, reactions, scores, 'post', 1, rng(2));
  assert.equal(next.length, WAVES[1].size);
  assert.ok(next.every((who) => !reactions.has(who.id)));
  const fans = next.filter((who) => who.interests.includes('football')).length;
  assert.ok(fans > 0.5 * next.length, `football fans in wave 2: ${fans}`);
});

test('a wave travels when glad reactions outweigh sorry ones', () => {
  const wave = (liked, blocked, rest) => [...Array(liked).fill('liked'), ...Array(blocked).fill('blocked'), ...Array(rest).fill('scrolled_past')];
  assert.equal(mood('post', wave(20, 5, 75)), 0.15);
  assert.ok(travels('post', wave(20, 5, 75)));
  assert.ok(!travels('post', wave(20, 15, 65)));
  assert.ok(!travels('post', wave(0, 0, 100)));
});

test('a reaction is drawn the same way every time and follows the odds', () => {
  const odds = { scrolled_past: 0.7, read: 0.2, liked: 0.1 };
  assert.equal(drawReaction(odds, 'uk', 5, 'v1'), drawReaction(odds, 'uk', 5, 'v1'));
  const drawn = people.slice(0, 5000).map((who) => drawReaction(odds, 'uk', who.id, 'v1'));
  const share = drawn.filter((reaction) => reaction === 'scrolled_past').length / drawn.length;
  assert.ok(Math.abs(share - 0.7) < 0.03, `scrolled past: ${share}`);
  assert.equal(drawReaction({ a: CONFIDENT_FROM - 0.05, b: 0.3, c: 0.3 }, 'uk', 1, 'v1'), 'cant_tell');
  assert.equal(drawReaction({}, 'uk', 1, 'v1'), 'cant_tell');
});

test('requests carry the text once and one question per persona', () => {
  const batch = people.slice(0, 3);
  const request = reactionRequest('listing', 'Продам велосипед', batch);
  assert.equal(request.state.listing, 'Продам велосипед');
  assert.deepEqual(Object.keys(request.questions), batch.map(questionId));
  assert.match(request.questions.p0.instructions, /^Buyer: .+looking to buy: .+\. What is the most this buyer does/);
  assert.ok('cant_tell' in request.questions.p0.criteria);

  const asked = exposureRequest('post', 'text');
  assert.ok(!Object.keys(asked.questions).some((id) => id.startsWith('shopping:')));
  assert.ok(Object.keys(exposureRequest('product', 'text').questions).some((id) => id.startsWith('shopping:')));
  assert.deepEqual(exposureScores({ 'age:a18': { score: 3 } }), { 'age:a18': 0.75 });
  assert.deepEqual(Object.values(priceLadder([5, 9, 19])).slice(1), ['Buys it only at $5 or less', 'Buys it at $9, not above', 'Buys it even at $19']);
});
