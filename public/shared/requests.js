// Requests to Jev. One request carries the text once, as `state`, and a batch of personas, one
// choice question each. Instructions stay in English; the text stays in the author's language.
import { personaLine } from './personas.js';
import { PRESETS, ASKS, lookOf, answersFor } from './presets.js';
import { INTERESTS, FIELDS, AGE_GROUPS, BUDGETS, SHOPPING } from './vocab.js';

export const MAX_TEXT_CHARS = 2000;

const stateOf = (preset, text) => ({ seen_in: preset.seenIn, [preset.noun]: text.slice(0, MAX_TEXT_CHARS) });
const criteriaOf = (reactions) => Object.fromEntries(Object.entries(reactions).map(([id, reaction]) => [id, reaction.criteria]));

/** Persona ids are question ids: `p` + id. */
export const questionId = (who) => `p${who.id}`;

/**
 * Who is asked, as Jev reads it. Whoever builds the request may add `earlier` to a person: the
 * quoted reactions a resident was tuned on (shared/resident.js).
 */
const asked = (preset, who, question) => `${preset.who}: ${personaLine(who, preset)}. ${who.earlier ?? ''}${question}`;

/** The reaction question for a batch of personas. */
export function reactionRequest(presetId, text, personas) {
  const preset = PRESETS[presetId];
  const criteria = criteriaOf(preset.reactions);
  const questions = {};
  for (const who of personas) {
    questions[questionId(who)] = { type: 'choice', instructions: asked(preset, who, preset.ask), criteria };
  }
  return { state: stateOf(preset, text), questions };
}

/** The follow-up question (what a buyer asks, what a shopper would pay), for personas who stopped. */
export function followUpRequest(presetId, text, personas, answers = PRESETS[presetId].followUp.answers) {
  const preset = PRESETS[presetId];
  const questions = {};
  for (const who of personas) {
    questions[questionId(who)] = { type: 'choice', instructions: asked(preset, who, preset.followUp.ask), criteria: answers };
  }
  return { state: stateOf(preset, text), questions };
}

/**
 * One of the questions the town is asked when a check closes (presets.js:ASKS), for people it reached.
 * reactionOf(id) is what each of them did. A person is told that in neutral words and never why, and
 * gets the answers offered to their look, built once per look.
 */
export function askRequest(question, presetId, text, people, reactionOf) {
  const preset = PRESETS[presetId];
  const offered = new Map();
  const questions = {};
  for (const who of people) {
    const reaction = reactionOf(who.id);
    const look = lookOf(presetId, reaction);
    if (!offered.has(look)) offered.set(look, answersFor(question, presetId, look));
    questions[questionId(who)] = { type: 'choice', instructions: asked(preset, who, `${preset.reactions[reaction].did} ${ASKS[question].ask}`), criteria: offered.get(look) };
  }
  return { state: stateOf(preset, text), questions };
}

const CARE = ['Not at all: it has nothing to do with them', 'Barely', 'Some of them would stop for it', 'Most of them would stop for it', 'It is written exactly for them'];

/**
 * The feed algorithm's question: how much each kind of people cares about the text. One score
 * question per attribute value; ids are `<attribute>:<value>`. Shopping and budget are asked for
 * listings and products only.
 */
export function exposureRequest(presetId, text) {
  const preset = PRESETS[presetId];
  const groups = [
    ...INTERESTS.map((item) => [`interest:${item.id}`, `people who are into ${item.en}`]),
    ...Object.entries(FIELDS).map(([id, field]) => [`field:${id}`, field.group]),
    ...AGE_GROUPS.map((item) => [`age:${item.id}`, item.group]),
  ];
  if (preset.market) {
    groups.push(...SHOPPING.filter((item) => item.id !== 'nothing').map((item) => [`shopping:${item.id}`, `people who are looking to buy ${item.en}`]));
    groups.push(...BUDGETS.map((item) => [`budget:${item.id}`, item.group]));
  }
  const questions = {};
  for (const [id, group] of groups) {
    questions[id] = { type: 'score', instructions: `How much would ${group} care about this ${preset.noun}?`, criteria: CARE };
  }
  return { state: stateOf(preset, text), questions };
}

/** Answers of an exposure request → { 'interest:gardening': 0..1, ... }. */
export function exposureScores(answers) {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, (answer.score ?? 0) / (CARE.length - 1)]));
}

/**
 * What Jev is asked about the text itself, in the same request as the feed algorithm's scores.
 * From UNLISTED_FROM a text stays out of the public feed: it is still read, its page works by link.
 * From BLOCKED_FROM it is not posted at all. Measured on twenty texts (docs/measurements.md): abuse,
 * hate, threats, drugs and keyboard mashing answer 0.89 to 0.99; harsh criticism, swearing at a
 * situation, rage, spam and a scam listing stay under 0.3.
 */
export const UNLISTED = {
  hate: 'Does the text attack or demean people for who they are: nationality, race, religion, gender, orientation, disability?',
  sexual: 'Does the text contain explicit sexual content?',
  violence: 'Does the text threaten somebody or call for violence?',
  private_data: "Does the text reveal a specific private person's phone number, home address or documents?",
  illegal: 'Does the text offer drugs, weapons, stolen goods or forged documents?',
  insult: 'Is the text itself abuse aimed at a person or at its readers: name-calling, humiliation, obscene swearing at somebody? The text may be in Ukrainian. Harsh criticism of a product, a company or an idea is not abuse, and neither is swearing at a situation.',
  gibberish: 'Is the text meaningless: random characters, keyboard mashing, or filler a reader could not react to, such as "asdf", "test test", "aaaa"? The text may be in Ukrainian. A short but meaningful text, even one word, is not meaningless.',
};
export const UNLISTED_FROM = 0.5;
export const BLOCKED_FROM = 0.85;

/**
 * What Jev reads in the text for its author, asked in the same request: yes or no questions whose
 * answers are shown as Jev's reading of the text, never as the town's reactions, and never keep a
 * text out of the feed. A question with a wording per preset is not asked of the presets it lacks:
 * a headline is one line, and its only ask is the click.
 */
export const TEXT_CHECKS = {
  point_first: {
    ask: {
      post: 'Does the post say its main point in its first sentence?',
      listing: 'Does the first sentence of the listing say what is for sale?',
      product: 'Does the first sentence say what the product is and what it does for the buyer?',
    },
    criteria: { true: 'Yes', false: 'No, the main point comes later or not at all' },
  },
  // A listing's ask is how the deal is done, not how to reach the seller: the marketplace has its own button.
  ask: {
    ask: {
      post: 'Is it clear what the author wants readers to do after reading: reply, try something, share, sign up or buy?',
      listing: 'Does the listing say how the deal is done: pickup, delivery, payment or checking it first?',
      product: 'Does the text say what the shopper should do next and where: buy, order or sign up?',
    },
    criteria: { true: 'Yes, it is clear', false: 'No, the reader has to guess' },
  },
  concrete: { ask: 'Does the text have at least one concrete number, name or example?', criteria: { true: 'Yes', false: 'No, it stays general' } },
  ai: { ask: 'Does the text read as if an AI chatbot wrote it: stock phrases, smooth and generic, nothing only this author would say? The text may be in Ukrainian.', criteria: { true: 'Yes, it reads machine-written', false: 'No, it reads like a person wrote it' } },
};

/** The text checks a preset is asked. → [[id, instructions, criteria]] */
export const checksFor = (presetId) => Object.entries(TEXT_CHECKS)
  .map(([id, check]) => [id, typeof check.ask === 'string' ? check.ask : check.ask[presetId], check.criteria])
  .filter(([, instructions]) => instructions);

/** The scoring request with the moderation questions and the text checks added; their ids are `unlisted:<reason>` and `check:<id>`. */
export function openingRequest(presetId, text) {
  const request = exposureRequest(presetId, text);
  for (const [id, instructions] of Object.entries(UNLISTED)) {
    request.questions[`unlisted:${id}`] = { type: 'noul', instructions, criteria: { true: 'Yes, clearly', false: 'No, or it is only mentioned or discussed' } };
  }
  for (const [id, instructions, criteria] of checksFor(presetId)) request.questions[`check:${id}`] = { type: 'noul', instructions, criteria };
  return request;
}

/**
 * Answers of an opening request → { scores, unlisted: ['hate', ...], blocked: ['hate', ...], checks: { concrete: 0.91, ... } };
 * what is blocked is unlisted too. A check is kept as Jev's probability, rounded, so where yes and no
 * begin (summary.js:readCheck) can move without rewriting what is stored.
 */
export function openingAnswers(answers) {
  const scores = {};
  const unlisted = [];
  const blocked = [];
  const checks = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (id.startsWith('unlisted:')) {
      const reason = id.slice('unlisted:'.length);
      if ((answer.noul ?? 0) >= UNLISTED_FROM) unlisted.push(reason);
      if ((answer.noul ?? 0) >= BLOCKED_FROM) blocked.push(reason);
    } else if (id.startsWith('check:')) checks[id.slice('check:'.length)] = Math.round((answer.noul ?? 0) * 100) / 100;
    else scores[id] = (answer.score ?? 0) / (CARE.length - 1);
  }
  return { scores, unlisted, blocked, checks };
}
