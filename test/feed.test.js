import test from 'node:test';
import assert from 'node:assert/strict';
import { crowd } from '../public/shared/personas.js';
import { exposure, firstWave, nextWave, travels, mood, gatherAsked, whoIsAsked, asking, anyoneLeft, WAVES } from '../public/shared/feed.js';
import { residentPersona } from '../public/shared/resident.js';
import { drawReaction, CONFIDENT_FROM } from '../public/shared/draw.js';
import { reactionRequest, exposureRequest, exposureScores, askRequest, openingAnswers, questionId } from '../public/shared/requests.js';
import { PRESETS, priceLadder, asksFor } from '../public/shared/presets.js';
import { weightOf } from '../worker/town.js';
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

test('the people kept for the closing questions are gathered by what they did, in pick order', () => {
  const cycle = ['liked', 'scrolled_past', 'blocked', 'cant_tell', 'read'];
  const reactionOf = (id) => cycle[id % 5];
  const ids = Array.from({ length: 300 }, (_, id) => id);
  const gathered = gatherAsked('post', ids, reactionOf);
  const every = (from) => ids.filter((id) => id % 5 === from);
  assert.deepEqual(gathered.scrolled, every(1));
  assert.deepEqual(gathered.sorry, every(2));
  assert.deepEqual(gathered.glad, every(0));
  assert.deepEqual(gathered.stopped, ids.filter((id) => [0, 2, 4].includes(id % 5)).slice(0, 100));
  // A second wave tops the groups up and never reorders them.
  assert.deepEqual(gatherAsked('post', ids.slice(150), reactionOf, gatherAsked('post', ids.slice(0, 150), reactionOf)), gathered);

  // A resident weighs four: with 98 taken and room for two, they are skipped and a lighter person after them fits.
  const resident = 10_000;
  const full = gatherAsked('post', [...Array.from({ length: 98 }, (_, i) => i), resident, 98], () => 'scrolled_past', undefined, weightOf);
  assert.deepEqual(full.scrolled.slice(-2), [97, 98]);
  assert.ok(!full.scrolled.includes(resident));
});

test('why goes to the annoyed first, up to 40, then to those who scrolled past', () => {
  const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);
  const groups = (sorry, scrolled) => ({ scrolled, sorry, glad: [1, 2], stopped: [3, 4] });
  const count = (asked, from, to) => asked.filter((id) => id >= from && id < to).length;
  const mixed = whoIsAsked('why', groups(range(0, 60), range(1000, 200)));
  assert.deepEqual(mixed, [...range(0, 40), ...range(1000, 60)]);
  const few = whoIsAsked('why', groups(range(0, 5), range(1000, 200)));
  assert.deepEqual([count(few, 0, 1000), count(few, 1000, 2000)], [5, 95]);
  assert.equal(whoIsAsked('why', groups(range(0, 150), [])).length, 100);
  const residents = whoIsAsked('why', groups([...range(10_000, 12), ...range(0, 30)], [...range(10_100, 10), ...range(1000, 100)]), weightOf);
  assert.ok(residents.reduce((sum, id) => sum + weightOf(id), 0) <= 100);
  const kept = groups([], []);
  assert.equal(whoIsAsked('hook', kept), kept.glad);
  assert.equal(whoIsAsked('comment', kept), kept.stopped);
  assert.deepEqual(asking('post', 'short', groups([], range(1000, 9))).map((asked) => asked.question), []);
  assert.deepEqual(asking('post', 'short', groups([], range(1000, 10))).map((asked) => asked.question), ['why']);
});

test('a post is asked why, hook and comment; the other presets why and hook', () => {
  assert.deepEqual(asksFor('post'), ['why', 'hook', 'comment']);
  for (const presetId of ['listing', 'product', 'headline']) assert.deepEqual(asksFor(presetId), ['why', 'hook']);
});

test('a closing question says what the person did, never why, and offers the answers their look has', () => {
  // Every other person got annoyed, where the preset has a way to.
  const annoyed = { post: 'blocked', listing: 'scam', headline: 'annoyed' };
  const batch = people.slice(0, 30);
  const allCriteria = Object.values(PRESETS).flatMap((preset) => Object.values(preset.reactions).map((reaction) => reaction.criteria));
  for (const presetId of Object.keys(PRESETS)) {
    const reactionOf = (id) => (id % 2 && annoyed[presetId]) || 'scrolled_past';
    const request = askRequest('why', presetId, 'Продам велосипед', batch, reactionOf);
    assert.deepEqual(request.state, reactionRequest(presetId, 'Продам велосипед', batch).state);
    for (const [id, question] of Object.entries(request.questions)) {
      assert.ok(!allCriteria.some((criteria) => question.instructions.includes(criteria)), `${presetId}.${id} quotes a reaction`);
      assert.equal(Object.keys(question.criteria).at(-1), 'cant_tell');
      const sorry = reactionOf(Number(id.slice(1))) !== 'scrolled_past';
      for (const reason of ['not_for_them', 'weak_opening', 'too_long']) assert.equal(reason in question.criteria, !sorry, `${presetId}: ${reason}`);
      assert.equal('price' in question.criteria, Boolean(PRESETS[presetId].market));
      assert.equal('disagree' in question.criteria, ['post', 'headline'].includes(presetId));
    }
  }
  const post = askRequest('why', 'post', 'text', batch, (id) => (id % 2 ? 'blocked' : 'scrolled_past'));
  assert.ok(post.questions.p0.instructions.endsWith('They saw it and went past without stopping. What is the main reason?'));
  assert.ok(post.questions.p1.instructions.endsWith('They blocked or muted the author. What is the main reason?'));
  const resident = { ...residentPersona('uk', 0, { name: 'Ніна', gender: 'female', age: 66, job: '', city: '', interests: ['gardening'], temper: 'supporter', budget: 'average', about: '' }), earlier: 'Earlier they said: "yes". ' };
  assert.match(askRequest('hook', 'post', 'text', [resident], () => 'liked').questions[questionId(resident)].instructions, /Earlier they said: "yes"\. They liked it\. What made them stop\?$/);
});

test('a text check lands among the checks only; a town with nobody left to reach is done', () => {
  assert.deepEqual(openingAnswers({ 'check:concrete': { noul: 0.99 }, 'interest:cars': { score: 4 } }), { scores: { 'interest:cars': 1 }, unlisted: [], blocked: [], checks: { concrete: 0.99 } });
  const town = new Uint8Array(10).fill(1);
  assert.equal(anyoneLeft(town), false);
  town[4] = 0;
  assert.equal(anyoneLeft(town), true);
  assert.equal(anyoneLeft(town, Uint8Array.from({ length: 10 }, (_, id) => (id === 4 ? 0 : 1))), false);
});
