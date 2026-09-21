import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD } from '../public/shared/quiz.js';
import { cleanProfile, publicProfile, residentPersona, residentLine, tenant, residentsOf, pickCards, nearAnswers, earlierWords, topicsOf, quizRequest, profileRequest, likeliest, scores, QUIZ_REACTIONS, TUNE_CARDS, TEST_CARDS, SENT_ANSWERS, ABOUT_CHARS } from '../public/shared/resident.js';
import { persona, personaLine, CROWD } from '../public/shared/personas.js';
import { reactionRequest, questionId } from '../public/shared/requests.js';
import { INTEREST } from '../public/shared/vocab.js';
import { DICTIONARIES } from '../public/i18n.js';

const profile = cleanProfile({ name: ' Ivan ', gender: 'male', age: 31, job: 'розробник', city: 'Ужгород', interests: ['startups', 'ai_tools', 'nonsense', 'programming', 'books'], temper: 'skeptic', budget: 'comfortable', about: 'I hate "caps"\nand ads' });

test('every quiz post is written in both languages about a known interest', () => {
  assert.equal(new Set(CARDS.map((card) => card.id)).size, CARDS.length);
  for (const card of CARDS) assert.ok(card.uk && card.en && card.by && card.style && INTEREST[card.topic], card.id);
  for (const t of Object.values(DICTIONARIES)) assert.deepEqual(Object.keys(t.me.do), QUIZ_REACTIONS);
});

test('a profile is cleaned before it is kept or shown to Jev', () => {
  assert.deepEqual(profile.interests, ['startups', 'ai_tools', 'programming']);
  assert.equal(profile.name, 'Ivan');
  assert.equal(profile.about, 'I hate caps and ads'); // no quotes and no line breaks: the words end up inside a quoted sentence
  assert.equal(cleanProfile({ name: 'x', gender: 'female', age: 30, interests: [] }), null);
  assert.equal(cleanProfile({ name: '', gender: 'female', age: 30, interests: ['books'] }), null);
  assert.equal(cleanProfile({ name: 'x', age: 30, interests: ['books'] }), null);
  assert.equal(cleanProfile(null), null);
  assert.equal(cleanProfile({ name: 'x', gender: 'female', age: 30, interests: ['books'], about: 'a'.repeat(999) }).about.length, ABOUT_CHARS);
  assert.equal(residentLine(profile, 'uk'), 'Ivan, 31, software developer, Uzhhorod; into startups, AI tools, programming; skeptical, distrusts ads and big claims; comfortable income; in their own words: "I hate caps and ads"');
  assert.equal(publicProfile(profile).about, undefined);
});

test('a resident is a person of the town like any other, after the 10,000', () => {
  const who = residentPersona('uk', 3, profile);
  assert.equal(who.id, CROWD + 3);
  assert.deepEqual([who.x, who.y], [3, 100]);
  assert.deepEqual([who.job, who.field, who.ageGroup, who.city.uk], ['developer', 'it', 'a25', 'Ужгород']);
  assert.deepEqual(Object.keys(persona('uk', 0)).filter((key) => !(key in who)), []);

  const own = residentPersona('en', 0, cleanProfile({ name: 'Bo', gender: 'female', age: 70, job: 'lighthouse keeper', city: 'Nowhere', interests: ['fishing'] }));
  assert.deepEqual([own.job, own.jobText, own.field, own.city.en], [null, 'lighthouse keeper', 'retired', 'Nowhere']);
  assert.ok(personaLine(own, { market: true }).startsWith('Bo, 70, lighthouse keeper, Nowhere; into fishing;'));

  // Somebody moved out of the second house: one of the 10,000 kinds of people lives there now.
  const town = residentsOf('uk', [publicProfile(profile), null]);
  assert.deepEqual(town.map((one) => one.id), [CROWD, CROWD + 1]);
  assert.deepEqual(town[1], tenant('uk', 1));
  assert.ok(town[1].name.uk && !town[1].resident);
});

test('a tuning round covers every way of writing; a test round takes what is left', () => {
  const tune = pickCards('tune', [], 'seed');
  assert.equal(tune.length, TUNE_CARDS);
  assert.equal(new Set(tune.map((card) => card.style)).size, new Set(CARDS.map((card) => card.style)).size);
  assert.deepEqual(pickCards('tune', [], 'seed'), tune);
  assert.notDeepEqual(pickCards('tune', [], 'other'), tune);
  const answered = tune.map((card) => card.id);
  const exam = pickCards('test', answered, 'seed');
  assert.equal(exam.length, TEST_CARDS);
  assert.ok(exam.every((card) => !answered.includes(card.id)));
  assert.deepEqual(pickCards('test', CARDS.map((card) => card.id), 'seed'), []);
});

test('Jev is given the few answers nearest to the post, never the post itself', () => {
  const answers = CARDS.map((card) => ({ card: card.id, human: 'liked' }));
  const near = nearAnswers(answers.filter((answer) => answer.card !== 'replace'), { style: CARD.replace.style, topics: [CARD.replace.topic] });
  assert.equal(near.length, SENT_ANSWERS);
  assert.ok(near.every((answer) => CARD[answer.card].style === 'hype' || CARD[answer.card].topic === 'ai_tools'));

  const request = quizRequest(profile, CARD.replace, answers, 'uk');
  assert.equal(request.state.post, CARD.replace.uk);
  assert.deepEqual(Object.keys(request.questions.tuned.criteria), QUIZ_REACTIONS);
  assert.ok(!request.questions.tuned.instructions.includes(CARD.replace.uk.slice(0, 40)));
  assert.ok(request.questions.tuned.instructions.includes(CARD.x100.uk.slice(0, 40)));
  assert.ok(!request.questions.plain.instructions.includes('really did'));
  assert.deepEqual(Object.keys(quizRequest(profile, CARD.replace, [], 'en').questions), ['plain']);
});

test('in the feed a resident is asked with its own words and the answers near the post', () => {
  const scoresOfPost = { 'interest:gardening': 1, 'interest:cooking': 0.75, 'interest:crypto': 0.25, 'field:it': 1, 'interest:pets': 0.5, 'interest:books': 0.5 };
  assert.deepEqual(topicsOf(scoresOfPost), ['gardening', 'cooking', 'pets']);
  const answers = CARDS.map((card) => ({ card: card.id, human: 'reposted' }));
  const earlier = earlierWords(answers, { topics: ['gardening'] }, 'uk');
  assert.ok(earlier.includes(CARD.tomatoes.uk.slice(0, 40)) && earlier.endsWith('Go by that before anything else. '));
  assert.equal(earlierWords([], { topics: ['gardening'] }, 'uk'), '');

  const resident = { ...residentPersona('uk', 0, profile), earlier };
  const neighbour = persona('uk', 7);
  const { questions } = reactionRequest('post', 'Текст', [resident, neighbour]);
  const asked = questions[questionId(resident)].instructions;
  assert.ok(asked.includes('in their own words: "I hate caps and ads". What this same reader really did'));
  assert.ok(asked.endsWith('What is the most this reader does with the post?'));
  assert.equal(questions[questionId(neighbour)].instructions, `Reader: ${personaLine(neighbour)}. What is the most this reader does with the post?`);
});

test('what a visitor typed is read by Jev before everybody sees it', () => {
  const request = profileRequest(profile, { insult: 'Is the text itself abuse? The text may be in Ukrainian.' });
  assert.equal(request.state.profile, 'Ivan · розробник · Ужгород · I hate caps and ads');
  assert.equal(request.questions.insult.instructions, 'Is the profile itself abuse? The profile may be in Ukrainian.');
});

test('a test round is scored with and without the kept answers', () => {
  assert.equal(likeliest({ probabilities: { liked: 0.3, read: 0.5, cant_tell: 0.9 } }), 'read');
  assert.equal(likeliest(undefined), null);
  const answers = [
    { round: 1, kind: 'tune', human: 'liked' },
    { round: 2, kind: 'test', human: 'liked', jev: 'liked', plain: 'read' },
    { round: 2, kind: 'test', human: 'blocked', jev: 'read', plain: 'read' },
    { round: 4, kind: 'test', human: 'read', jev: 'read', plain: 'read' },
  ];
  assert.deepEqual(scores(answers), [{ round: 2, asked: 2, tuned: 1, plain: 0 }, { round: 4, asked: 1, tuned: 1, plain: 1 }]);
});
