// Requests to Jev. One request carries the text once, as `state`, and a batch of personas, one
// choice question each. Instructions stay in English; the text stays in the author's language.
import { personaLine } from './personas.js';
import { PRESETS, ASKS, lookOf, answersFor } from './presets.js';
import { INTERESTS, FIELDS, AGE_GROUPS, BUDGETS, SHOPPING } from './vocab.js';

export const MAX_TEXT_CHARS = 2000;
/** How long an audience description may be: a line, not a brief. */
export const MAX_AUDIENCE_CHARS = 200;

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

/** The kinds of people the feed algorithm knows, as Jev reads them: 60, and 83 in a market. → [['interest:gardening', 'people who are into gardening'], …] */
export function groupsOf(market) {
  const groups = [
    ...INTERESTS.map((item) => [`interest:${item.id}`, `people who are into ${item.en}`]),
    ...Object.entries(FIELDS).map(([id, field]) => [`field:${id}`, field.group]),
    ...AGE_GROUPS.map((item) => [`age:${item.id}`, item.group]),
  ];
  if (market) {
    groups.push(...SHOPPING.filter((item) => item.id !== 'nothing').map((item) => [`shopping:${item.id}`, `people who are looking to buy ${item.en}`]));
    groups.push(...BUDGETS.map((item) => [`budget:${item.id}`, item.group]));
  }
  return groups;
}

/**
 * The feed algorithm's question: how much each kind of people cares about the text. One score
 * question per attribute value; ids are `<attribute>:<value>`. Shopping and budget are asked for
 * listings and products only.
 */
export function exposureRequest(presetId, text) {
  const preset = PRESETS[presetId];
  const questions = {};
  for (const [id, group] of groupsOf(preset.market)) {
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
const NOUL = { true: 'Yes, clearly', false: 'No, or it is only mentioned or discussed' };

/**
 * What Jev reads in the text for its author, asked in the same request: yes or no questions whose
 * answers are shown as Jev's reading of the text, never as the town's reactions, and never keep a
 * text out of the feed. A question with a wording per preset is not asked of the presets it lacks:
 * a headline is one line, and its only ask is the click.
 */
export const TEXT_CHECKS = {
  // Asked of a listing only: for a post and a product Jev answered near 0.5 whether the point came first (docs/measurements.md).
  point_first: {
    ask: {
      listing: 'Does the first sentence of the listing say what is for sale?',
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
};

/** The text checks a preset is asked. → [[id, instructions, criteria]] */
export const checksFor = (presetId) => Object.entries(TEXT_CHECKS)
  .map(([id, check]) => [id, typeof check.ask === 'string' ? check.ask : check.ask[presetId], check.criteria])
  .filter(([, instructions]) => instructions);

/** The scoring request with the moderation questions and the text checks added; their ids are `unlisted:<reason>` and `check:<id>`. */
export function openingRequest(presetId, text) {
  const request = exposureRequest(presetId, text);
  for (const [id, instructions] of Object.entries(UNLISTED)) {
    request.questions[`unlisted:${id}`] = { type: 'noul', instructions, criteria: NOUL };
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

// -- an audience in words: whom the author says the text is for

const FIT = ['None of them', 'A few of them', 'Some of them', 'Most of them', 'All of them'];
/** From this answer Jev says the description names a part of a person. Not measured yet (scripts/probe.js audience). */
export const NAMED_FROM = 0.5;
/**
 * The parts of a person the town knows, the ones feed.js:namesOf scores. The description counts
 * only in the parts it names: "people over 60" says nothing about work, so it keeps those who work.
 */
export const PARTS = {
  field: 'Does the description say what the people do: their work, or that they study, stay at home with children or are retired?',
  age: 'Does the description say how old the people are?',
  interest: 'Does the description say what the people are into: hobbies, topics, pastimes?',
  budget: 'Does the description say how much money the people have?',
  shopping: 'Does the description say what the people are looking to buy?',
};

/**
 * What Jev reads in an audience description, in one request with the description as state and no
 * text: how many of the people it is about are in each group the feed knows (83, money and shopping
 * included, since a description can name them), which parts of a person it names, and the moderation
 * questions about the description. The group question asks the audience's share in the group: the
 * reverse gives "a few" for every job when the audience is rare.
 */
export function audienceRequest(description) {
  const questions = {};
  for (const [id, group] of groupsOf(true)) {
    questions[id] = { type: 'score', instructions: `How many of the people this description is about are ${group}?`, criteria: FIT };
  }
  for (const [id, instructions] of Object.entries(PARTS)) {
    questions[`part:${id}`] = { type: 'noul', instructions, criteria: { true: 'Yes, it says so', false: 'No, or it only makes it likely' } };
  }
  // The moderation questions ask about the description, as resident.js:profileRequest asks about a profile.
  for (const [id, instructions] of Object.entries(UNLISTED)) {
    questions[`unlisted:${id}`] = { type: 'noul', instructions: instructions.replace(/\btext\b/g, 'description'), criteria: NOUL };
  }
  return { state: { seen_in: 'an author describing, in their own words, the readers a text is written for', audience: description.slice(0, MAX_AUDIENCE_CHARS) }, questions };
}

/** Answers of an audience request → { scores, named: ['field', …], unlisted, blocked }. */
export function audienceAnswers(answers) {
  const named = [];
  const rest = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (id.startsWith('part:')) {
      if ((answer.noul ?? 0) >= NAMED_FROM) named.push(id.slice('part:'.length));
    } else rest[id] = answer;
  }
  const { scores, unlisted, blocked } = openingAnswers(rest);
  return { scores, named: Object.keys(PARTS).filter((part) => named.includes(part)), unlisted, blocked };
}
