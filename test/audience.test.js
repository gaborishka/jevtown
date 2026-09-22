import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceRequest, audienceAnswers, exposureRequest, MAX_AUDIENCE_CHARS } from '../public/shared/requests.js';
import { partsOf, audienceOf, audienceMask, waveReach, firstWave, nextWave, MIN_AUDIENCE } from '../public/shared/feed.js';
import { inAudience, minSegment } from '../public/shared/summary.js';
import { crowd, CROWD } from '../public/shared/personas.js';
import { residentPersona } from '../public/shared/resident.js';
import { drawReaction } from '../public/shared/draw.js';
import { rng } from '../public/shared/rng.js';

const uk = crowd('uk');
const en = crowd('en');
const gardeners = { interest: ['gardening'] };

test('the audience request rates the 83 groups, the five parts and the moderation questions, and never the text', () => {
  const request = audienceRequest('people who work in IT and are into startups');
  const ids = Object.keys(request.questions);
  const groups = Object.keys(exposureRequest('listing', 'x').questions);
  assert.equal(ids.length, 95);
  assert.deepEqual(ids.slice(0, 83), groups);
  assert.deepEqual(ids.slice(83, 88), ['part:field', 'part:age', 'part:interest', 'part:budget', 'part:shopping']);
  assert.equal(ids.filter((id) => id.startsWith('unlisted:')).length, 7);
  assert.ok(!ids.includes('shopping:nothing'));
  assert.equal(request.state.audience, 'people who work in IT and are into startups');
  assert.ok(Object.values(request.questions).every((question) => !/\btext\b/i.test(question.instructions)), 'no question is about a text');
  assert.equal(audienceRequest('x'.repeat(300)).state.audience.length, MAX_AUDIENCE_CHARS);
  assert.equal(Object.keys(exposureRequest('post', 'x').questions).length, 60);

  const read = audienceAnswers({ 'interest:gardening': { score: 4 }, 'part:interest': { noul: 0.9 }, 'part:age': { noul: 0.2 }, 'unlisted:hate': { noul: 0.9 } });
  assert.deepEqual(read, { scores: { 'interest:gardening': 1 }, named: ['interest'], unlisted: ['hate'], blocked: ['hate'] });
});

test('a part the description does not name excludes nobody', () => {
  const over60 = audienceOf(uk, partsOf({ 'age:a60': 1, 'field:retired': 1, 'interest:gardening': 0.5 }, ['age']));
  assert.equal(over60.length, 1418);
  assert.equal(over60.filter((who) => who.field !== 'retired').length, 885);
});

test('two named parts mean both, and within a part one group is enough', () => {
  const parts = partsOf({ 'field:it': 1, 'field:business': 0.5, 'interest:startups': 1, 'interest:programming': 0.5 }, ['field', 'interest']);
  assert.deepEqual(parts, { field: ['it'], interest: ['startups'] });
  const members = audienceOf(en, parts);
  assert.equal(members.length, 64);
  assert.ok(members.every((who) => who.field === 'it' && who.interests.includes('startups')));
  assert.deepEqual(members.map((who) => who.id), [...members.map((who) => who.id)].sort((a, b) => a - b));
  // "Most of them" counts next to "All of them"; "Some of them" does not.
  assert.deepEqual(partsOf({ 'interest:gardening': 1, 'interest:summer_house': 0.75, 'interest:cooking': 0.5 }, ['interest']), { interest: ['gardening', 'summer_house'] });
});

test('no part counts when none is named, or when every group of a named one is under "Some of them"', () => {
  assert.equal(partsOf({ 'interest:gardening': 1 }, []), null);
  const leftHanded = Object.fromEntries(Object.keys(exposureRequest('listing', 'x').questions).map((id) => [id, 0.25]));
  assert.equal(partsOf(leftHanded, ['field', 'interest']), null);
  // The few who fit every part are too few for a check.
  assert.equal(audienceOf(uk, { interest: ['crypto'], age: ['a60'], budget: ['wealthy'] }).length, 1);
  assert.ok(MIN_AUDIENCE > 1);
});

test('the mask has a byte per person, and a resident who fits joins', () => {
  const nina = residentPersona('uk', 0, { name: 'Ніна', gender: 'female', age: 66, job: '', city: '', interests: ['gardening'], temper: 'supporter', budget: 'average', about: '' });
  const town = [...uk, nina];
  const members = audienceOf(town, gardeners);
  assert.equal(members.at(-1), nina);
  const mask = audienceMask(members, town.length);
  assert.equal(mask.length, CROWD + 1);
  assert.equal(mask.reduce((sum, byte) => sum + byte, 0), members.length);
  assert.equal(mask[nina.id], 1);
});

test('the people in an audience: everybody without one, and nobody who moved in after the check', () => {
  assert.equal(inAudience(uk, null), uk);
  const nina = residentPersona('uk', 0, { name: 'Ніна', gender: 'female', age: 66, job: '', city: '', interests: ['gardening'], temper: 'supporter', budget: 'average', about: '' });
  const mask = audienceMask(audienceOf(uk, gardeners), CROWD);
  const members = inAudience([...uk, nina], mask);
  assert.equal(members.length, 712);
  assert.ok(!members.includes(nina));
});

test('the waves of an audience are the town\'s, cut where they reach everybody', () => {
  assert.deepEqual(waveReach(CROWD), [600, 2100, 5100, 10000]);
  assert.deepEqual(waveReach(712), [600, 712]);
  assert.deepEqual(waveReach(300), [300]);
  assert.deepEqual([minSegment(10_000), minSegment(10_400), minSegment(712)], [40, 40, 15]);
});

test('the first wave of 712 gardeners takes 600 of them, the next the other 112 and nobody else', () => {
  const members = audienceOf(uk, gardeners);
  const random = rng(7);
  const first = firstWave(members, { 'interest:gardening': 1 }, 'post', random);
  assert.equal(first.length, 600);
  const reached = new Map(first.map((who) => [who.id, drawReaction({ liked: 1 }, 'uk', who.id, 'v1')]));
  const second = nextWave(members, reached, { 'interest:gardening': 1 }, 'post', 1, random);
  assert.equal(second.length, 112);
  const inMask = audienceMask(members, CROWD);
  assert.ok([...first, ...second].every((who) => inMask[who.id]));
  assert.equal(new Set([...first, ...second].map((who) => who.id)).size, 712);
});
