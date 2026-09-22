import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, rateAudience } from '../public/shared/check.js';
import { counters, segments, rankedAnswers, demandCurve, leaders, listView, readCheck, whySplit, mostAnnoyed, voicesOf } from '../public/shared/summary.js';
import { crowd } from '../public/shared/personas.js';
import { PRESETS, REASONS, ASKS, lookOf, answersFor, CANT_TELL } from '../public/shared/presets.js';
import { openingRequest, openingAnswers } from '../public/shared/requests.js';
import { drawAnswer } from '../public/shared/draw.js';
import { ASK_WEIGHT } from '../public/shared/feed.js';
import { unit } from '../public/shared/rng.js';

const people = crowd('uk');

const asks = (question, id) => question.instructions.endsWith(ASKS[id].ask);

/**
 * A stand-in for Jev: gardeners love the text, everybody else scrolls past; buyers ask about the price.
 * Those who scrolled past mostly find the text is not for them, and the annoyed blame the tone.
 */
function fakeJev({ questions }) {
  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'score') answers[id] = { score: id === 'interest:gardening' ? 4 : 0 };
    else if ('negotiable' in question.criteria) answers[id] = { probabilities: { negotiable: 0.6, photos: 0.4 } };
    else if ('p0' in question.criteria) answers[id] = { probabilities: { p1: 0.5, p2: 0.3, p3: 0.2 } };
    else if (id.startsWith('check:')) answers[id] = { noul: id === 'check:concrete' ? 0.9 : 0.1 };
    else if (asks(question, 'why')) answers[id] = { probabilities: question.instructions.includes('went past') ? { not_for_them: 0.8, weak_opening: 0.1, cant_tell: 0.1 } : { tone: 0.9, cant_tell: 0.1 } };
    else if (asks(question, 'hook')) {
      const [first, second] = Object.keys(question.criteria);
      answers[id] = { probabilities: { [first]: 0.5, [second]: 0.3, cant_tell: 0.2 } };
    } else if (asks(question, 'comment')) answers[id] = { probabilities: { none: 0.6, question: 0.3, cant_tell: 0.1 } };
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

const LONG_POST = 'Tomatoes need warm nights. '.repeat(8);

/** What a request asks: the opening one, a closing question (presets.js:ASKS), or reactions and the follow-up. */
function kindOf({ questions }) {
  const first = Object.values(questions)[0];
  if (first.type !== 'choice') return 'opening';
  return Object.keys(ASKS).find((id) => asks(first, id)) ?? 'reactions';
}

/** A one-wave check that keeps every request it sent, with its kind and the ids of the people in it. */
async function recorded(options, send = fakeJev) {
  const sent = [];
  const result = await runCheck({ versionId: 'v1', maxWaves: 1, pool: 'uk', ...options, send: (request) => {
    sent.push({ kind: kindOf(request), ids: Object.keys(request.questions).map((id) => Number(id.slice(1))) });
    return send(request);
  } });
  return { result, sent, asked: (kind) => sent.filter((one) => one.kind === kind) };
}

/** fakeJev with every reaction replaced by reactionOf(id, index), index counting the people in the order they were asked. */
function reacting(reactionOf) {
  let index = 0;
  return (request) => fakeJev(request).then((result) => {
    if (kindOf(request) === 'reactions') for (const id of Object.keys(request.questions)) result.answers[id] = { probabilities: { [reactionOf(Number(id.slice(1)), index++)]: 1 } };
    return result;
  });
}

test('the town is asked in at most three requests of weight 100, in pick order', async () => {
  const { result, sent, asked } = await recorded({ presetId: 'post', text: LONG_POST });
  for (const question of Object.keys(ASKS)) assert.equal(asked(question).length, 1, question);
  assert.equal(sent.length, 1 + asked('reactions').length + 3);
  // The reaction batches go out in the order the feed picked people.
  const picked = asked('reactions').flatMap((one) => one.ids);
  const first = (test) => picked.filter((id) => test(PRESETS.post.reactions[result.keys[result.reactions[id] - 1]])).slice(0, ASK_WEIGHT);
  assert.deepEqual(asked('why')[0].ids, first((reaction) => !reaction.stopped && !reaction.hollow));
  assert.deepEqual(asked('hook')[0].ids, first((reaction) => reaction.tone === 1));
  assert.deepEqual(asked('comment')[0].ids, first((reaction) => reaction.stopped));
  const view = listView(result.said, 'scrolled', 'post');
  assert.deepEqual(view.lead, { kind: 'one', ids: ['not_for_them'] });
  assert.ok(Math.abs(view.rows[0].share - 0.889) < 0.001, `not for them: ${view.rows[0].share}`);
  assert.ok(Math.abs(view.drain - 0.1) < 1e-9, `drain: ${view.drain}`);
  // A drawn drain is no answer: those people are left out of the picks.
  for (const picks of Object.values(result.said.picks)) assert.ok(!(CANT_TELL in picks));
  const hook = result.said.picks.hook;
  assert.ok(Object.values(hook).flat().length < result.said.lists.hook.asked, 'some of the glad drew the drain');
  // Each question draws with its own salt, so one person's answers to two questions are not alike.
  const [top, next] = Object.keys(answersFor('hook', 'post', 'glad'));
  for (const id of asked('hook')[0].ids) {
    const pick = drawAnswer({ [top]: 0.5, [next]: 0.3, [CANT_TELL]: 0.2 }, 'uk', id, 'v1', 'hook');
    assert.equal(Object.keys(hook).find((answer) => hook[answer].includes(id)) ?? CANT_TELL, pick, `person ${id}`);
  }
});

test('a post asks why, hook and comment; the other presets ask only why and hook', async () => {
  const questions = async (presetId, text) => (await recorded({ presetId, text, prices: [5, 10] })).sent.map((one) => one.kind).filter((kind) => kind in ASKS).sort();
  assert.deepEqual(await questions('post', 'tomatoes'), ['comment', 'hook', 'why']);
  assert.deepEqual(await questions('product', LONG_POST), ['hook', 'why']);
  assert.deepEqual(await questions('headline', LONG_POST), ['hook', 'why']);
  assert.deepEqual(await questions('listing', LONG_POST), ['hook', 'why']);
});

test('the sorry are asked why apart, up to 40', async () => {
  const { result } = await recorded({ presetId: 'post', text: 'tomatoes' }, reacting((id) => (id % 3 === 0 ? 'blocked' : 'scrolled_past')));
  assert.equal(result.said.lists.sorry.asked, 40);
  assert.equal(result.said.lists.scrolled.asked, 60);
});

test('nobody who passed, nobody asked why; a group under ten is not asked', async () => {
  const glad = await recorded({ presetId: 'post', text: 'tomatoes' }, reacting(() => 'liked'));
  assert.equal(glad.asked('why').length, 0);
  assert.equal(glad.asked('hook').length, 1);
  const few = await recorded({ presetId: 'post', text: 'tomatoes' }, reacting((id, index) => (index < 5 ? 'liked' : 'scrolled_past')));
  assert.equal(few.asked('hook').length, 0);
  assert.equal(few.asked('why').length, 1);
});

test('a failed question does not stop the check', async () => {
  const { result } = await recorded({ presetId: 'post', text: LONG_POST }, (request) => (kindOf(request) === 'hook' ? Promise.reject(new Error('boom')) : fakeJev(request)));
  const whole = await recorded({ presetId: 'post', text: LONG_POST });
  assert.deepEqual(result.said.missing, { hook: 'failed' });
  assert.deepEqual(Object.keys(result.said.lists), ['scrolled', 'comment']);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.reactions, whole.result.reactions);
});

test('the same text and version give the same answers from the town', async () => {
  const run = () => runCheck({ send: fakeJev, presetId: 'post', pool: 'uk', text: LONG_POST, versionId: 'v1', maxWaves: 2 });
  const [first, second] = [await run(), await run()];
  assert.deepEqual(first.said, second.said);
  assert.ok(Object.keys(first.said.picks.hook).length > 0);
});

test('the text checks come back with the opening request; the point first is asked of a listing, a headline only one', async () => {
  const { result } = await recorded({ presetId: 'post', text: 'tomatoes' });
  assert.deepEqual(result.checks, { ask: 0.1, concrete: 0.9 });
  const checksOf = (presetId) => Object.keys(openingRequest(presetId, 'x').questions).filter((id) => id.startsWith('check:'));
  assert.deepEqual(checksOf('headline'), ['check:concrete']);
  assert.deepEqual(checksOf('listing'), ['check:point_first', 'check:ask', 'check:concrete']);
  assert.deepEqual(checksOf('product'), ['check:ask', 'check:concrete']);
  assert.equal(openingAnswers({ 'check:concrete': { noul: 0.987 } }).checks.concrete, 0.99);
});

test('an answer leads alone, a few lead about equally, or none stands out', () => {
  const rows = (...shares) => shares.map((share, i) => ({ id: `a${i}`, share }));
  assert.deepEqual(leaders(rows(0.5, 0.2, 0.2, 0.1), 100), { kind: 'one', ids: ['a0'] });
  // Within 0.161 of the leader and not within 0.145: the first two only.
  assert.deepEqual(leaders(rows(0.35, 0.3, 0.2, 0.15), 100), { kind: 'equal', ids: ['a0', 'a1'] });
  assert.deepEqual(leaders(rows(0.3, 0.29, 0.28, 0.13), 100), { kind: 'equal', ids: ['a0', 'a1', 'a2'] });
  assert.deepEqual(leaders(rows(0.26, 0.25, 0.25, 0.24), 100), { kind: 'none', ids: [] });
});

test('a list is read over its real answers, the drain left out', () => {
  // Twenty real answers of a hundred asked: apart by a hundred, about equal by twenty.
  const said = { lists: { hook: { asked: 100, totals: { example: 13.33, story: 6.67, invented: 5, cant_tell: 80 } } } };
  const view = listView(said, 'hook', 'post');
  assert.equal(view.asked, 100);
  assert.ok(Math.abs(view.real - 20) < 1e-9 && Math.abs(view.drain - 0.8) < 1e-9);
  assert.deepEqual(view.rows.map((row) => row.id), ['example', 'story', 'useful', 'humour', 'opinion', 'opening', 'topic']);
  assert.ok(Math.abs(view.rows[0].share - 0.6665) < 1e-9);
  assert.deepEqual(view.lead, { kind: 'equal', ids: ['example', 'story'] });
  assert.equal(leaders(view.rows, 100).kind, 'one');
  assert.equal(listView({ lists: { hook: { asked: 30, totals: { example: 9.5, cant_tell: 20.5 } } } }, 'hook', 'post'), null);
  assert.equal(listView({ lists: {} }, 'hook', 'post'), null);

  assert.deepEqual([0.3, 0.5, 0.7].map(readCheck), ['no', 'unclear', 'yes']);
  const scrolled = listView({ lists: { scrolled: { asked: 50, totals: { not_for_them: 30, weak_opening: 15, too_long: 5 } } } }, 'scrolled', 'post');
  const split = whySplit(scrolled);
  assert.ok(Math.abs(split.readers - 0.6) < 1e-9 && Math.abs(split.text - 0.4) < 1e-9, JSON.stringify(split));
});

test('the stored answer ids stay', () => {
  assert.deepEqual(Object.keys(REASONS), ['not_for_them', 'weak_opening', 'unclear', 'too_long', 'nothing_new', 'distrust', 'tone', 'disagree', 'price', 'missing']);
  assert.deepEqual(Object.keys(ASKS), ['why', 'hook', 'comment']);
  assert.deepEqual(Object.fromEntries(Object.entries(ASKS.hook.answers).map(([presetId, answers]) => [presetId, Object.keys(answers)])), {
    post: ['example', 'story', 'useful', 'humour', 'opinion', 'opening', 'topic'],
    listing: ['price', 'details', 'trust', 'terms', 'need'],
    product: ['price', 'benefit', 'claims', 'guarantee', 'details', 'need'],
    headline: ['curiosity', 'promise', 'detail', 'news', 'topic'],
  });
  assert.deepEqual(Object.keys(ASKS.comment.answers), ['adds_own', 'question', 'argues', 'thanks', 'joke', 'tags', 'none']);
  assert.ok(!('habit' in REASONS));
});

test('the group most often annoyed is counted over those it reached', () => {
  const totals = { reach: 1000, sorry: 100 };
  const group = (attribute, value, size, reached, sorry) => ({ attribute, value, size, reached, sorry });
  // The smaller group was reached less and annoyed more of those it reached.
  const small = group('interest', 'cooking', 400, 50, 20);
  const big = group('field', 'it', 600, 300, 60);
  assert.equal(mostAnnoyed([big, small], totals, 'post'), small);
  assert.equal(mostAnnoyed([big, small, group('temper', 'troll', 300, 100, 90), group('city', 'Lviv', 300, 100, 80)], totals, 'post'), small);
  assert.equal(mostAnnoyed([group('interest', 'cooking', 400, 39, 30)], totals, 'post'), null);
  assert.equal(mostAnnoyed([group('interest', 'cooking', 400, 50, 7)], totals, 'post'), null, 'fewer than 8 annoyed');
  assert.equal(mostAnnoyed([group('interest', 'cooking', 400, 100, 12)], totals, 'post'), null, 'under 1.3 times the whole reach');
  // The feed scores what people buy and spend only in a market, so only a market names them.
  const budget = group('budget', 'low', 400, 50, 30);
  assert.equal(mostAnnoyed([budget, big], totals, 'post'), big);
  assert.equal(mostAnnoyed([budget, big], totals, 'listing'), budget);
});

/** voicesOf as it was before the town was asked anything, to hold the new one to it. */
function voicesBefore(postId, presetId, reactions, only = null) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  const turn = ['spreads', 'sorry', 'glad', 'stopped'];
  const keep = only ? 400 : 60;
  const byReaction = new Map();
  for (let id = 0; id < reactions.length; id++) {
    if (!reactions[id]) continue;
    const reaction = keys[reactions[id] - 1];
    const look = lookOf(presetId, reaction);
    if (only ? reaction !== only : !turn.includes(look)) continue;
    let group = byReaction.get(reaction);
    if (!group) byReaction.set(reaction, (group = { look, total: 0, people: [] }));
    group.total += 1;
    group.people.push({ id, reaction, look, order: unit('voice', postId, id) });
    if (group.people.length > keep * 2) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  }
  const groups = [...byReaction.values()].sort((a, b) => turn.indexOf(a.look) - turn.indexOf(b.look));
  for (const group of groups) group.people = group.people.sort((a, b) => a.order - b.order).slice(0, keep);
  const found = [];
  for (let round = 0; found.length < groups.reduce((sum, group) => sum + group.people.length, 0); round++) {
    for (const group of groups) found.push(...group.people.slice(round * 2, round * 2 + 2));
  }
  found.total = groups.reduce((sum, group) => sum + group.total, 0);
  return found;
}

test('voices stay as they were without answers; with them, those who answered speak first', () => {
  const reactions = Uint8Array.from({ length: 60 }, (_, id) => (id % 10 === 9 ? 0 : 1 + (id % 8)));
  for (const only of [null, 'liked', 'scrolled_past']) {
    const now = voicesOf('p1', 'post', reactions, only);
    assert.deepEqual(now, voicesBefore('p1', 'post', reactions, only));
    assert.equal(now.total, voicesBefore('p1', 'post', reactions, only).total);
  }
  // 3 and 8 share no factor, so every reaction has people with an answer and people without.
  const saidOf = (id) => (id % 3 === 0 ? 'example' : null);
  const voices = voicesOf('p1', 'post', reactions, null, saidOf);
  const scrollers = voices.filter((voice) => voice.look === 'scrolled');
  assert.ok(scrollers.length && scrollers.every((voice) => saidOf(voice.id)));
  const quiet = [...reactions.keys()].filter((id) => reactions[id] && lookOf('post', Object.keys(PRESETS.post.reactions)[reactions[id] - 1]) === 'scrolled' && !saidOf(id));
  assert.ok(quiet.length && quiet.every((id) => !voices.some((voice) => voice.id === id)), 'a scroller without an answer stays quiet');
  const byReaction = Map.groupBy(voices, (voice) => voice.reaction);
  assert.ok([...byReaction.values()].some((group) => group.some((voice) => saidOf(voice.id)) && group.some((voice) => !saidOf(voice.id))), 'a group mixes both');
  for (const reaction of new Set(voices.map((voice) => voice.reaction))) {
    const answered = voices.filter((voice) => voice.reaction === reaction).map((voice) => Boolean(saidOf(voice.id)));
    assert.deepEqual(answered, [...answered].sort((a, b) => b - a), `${reaction}: those who answered come first`);
  }
});

test('every reaction a person can be asked about says what they did', () => {
  for (const [presetId, preset] of Object.entries(PRESETS)) {
    for (const [id, reaction] of Object.entries(preset.reactions)) {
      if (!reaction.hollow) assert.equal(typeof reaction.did, 'string', `${presetId}.${id}`);
    }
  }
});

// -- an audience in words

/** fakeJev, with an audience request read as "into gardening": interests named, gardening scored 4, nothing else. */
function audienceJev(request) {
  if (!request.state.audience) return fakeJev(request);
  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    answers[id] = question.type === 'score' ? { score: id === 'interest:gardening' ? 4 : 0 } : { noul: id === 'part:interest' ? 0.9 : 0.02 };
  }
  return Promise.resolve({ answers, tokens: 100, usd: 0.001 });
}

/** A check that keeps every request it sent. */
async function sending(options, send = audienceJev) {
  const sent = [];
  const result = await runCheck({ versionId: 'v1', pool: 'uk', presetId: 'post', text: 'tomatoes', ...options, send: (request) => (sent.push(request), send(request)) });
  return { result, sent };
}
const isReaction = (request) => kindOf(request) === 'reactions';

test('a check with an audience is read by its people only, in the town\'s waves cut at its size', async () => {
  const { result, sent } = await sending({ audience: 'gardeners' }, (request) => audienceJev(request).then((answer) => {
    // Everybody is glad, so the text goes on until nobody in the audience is left.
    if (isReaction(request)) for (const id of Object.keys(request.questions)) answer.answers[id] = { probabilities: { liked: 1 } };
    return answer;
  }));
  assert.equal(result.audience.size, 712);
  assert.deepEqual(result.audience.parts, { interest: ['gardening'] });
  assert.deepEqual(result.waves.map((wave) => wave.size), [600, 112]);
  assert.equal(result.reach, 712);
  assert.ok([...result.reactions.keys()].every((id) => !result.reactions[id] || result.audience.members[id] === 1));
  assert.equal(sent.filter((request) => request.state.audience).length, 1);
  assert.equal(sent.filter(isReaction).length, Math.ceil(600 / 100) + Math.ceil(112 / 100));
});

test('without an audience nothing about one is sent', async () => {
  const { result, sent } = await sending({ maxWaves: 1 });
  assert.equal(result.audience, null);
  assert.ok(!sent.some((request) => request.state.audience));
});

test('an audience read once goes to the same people in every check', async () => {
  const spent = [];
  const rated = await rateAudience((request) => (spent.push(request), audienceJev(request)), 'gardeners');
  assert.equal(spent.length, 1);
  const [first, second] = [await sending({ audience: rated, maxWaves: 1 }), await sending({ audience: rated, maxWaves: 1, text: 'tomatoes and more' })];
  assert.deepEqual(first.result.audience.members, second.result.audience.members);
  assert.ok(![...first.sent, ...second.sent].some((request) => request.state.audience));
  assert.equal(first.result.requests, first.sent.length);
  assert.deepEqual((await sending({ audience: rated, maxWaves: 1 })).result.reactions, first.result.reactions);
});

test('a description the town cannot read, or one too few fit, stops the check before any wave', async () => {
  const blind = (request) => (request.state.audience ? Promise.resolve({ answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, question.type === 'score' ? { score: 1 } : { noul: 0.02 }])), tokens: 100, usd: 0.001 }) : fakeJev(request));
  const sent = [];
  await assert.rejects(runCheck({ send: (request) => (sent.push(request), blind(request)), presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'v1', audience: 'left-handed people' }), (error) => {
    assert.equal(error.code, 'no_fit');
    assert.equal(error.spent.requests, 2);
    return true;
  });
  assert.ok(!sent.some((request) => Object.keys(request.questions).some((id) => /^p\d/.test(id))), 'nobody was asked');

  const scored = { 'interest:crypto': 4, 'age:a60': 4, 'budget:wealthy': 4 };
  const few = (request) => (request.state.audience ? Promise.resolve({ answers: Object.fromEntries(Object.entries(request.questions).map(([id, question]) => [id, question.type === 'score' ? { score: scored[id] ?? 0 } : { noul: ['part:interest', 'part:age', 'part:budget'].includes(id) ? 0.9 : 0.02 }])), tokens: 100, usd: 0.001 }) : fakeJev(request));
  await assert.rejects(runCheck({ send: few, presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'v1', audience: 'wealthy crypto fans over 60' }), (error) => error.code === 'few_fit' && error.fits === 1);
});
