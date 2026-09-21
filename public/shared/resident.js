// The people visitors move into the town. A resident is described by a visitor and lives next to the
// 10,000: the feed algorithm shows it posts, Jev answers for it, its dot sits on the map in the rows
// under the grid. Its ids continue the crowd's: 10000, 10001, … in the order of moving in.
//
// Whoever moved a resident in can tune it: say what it does with a quiz post. Every answer is kept,
// and Jev reads the nearest of them whenever it answers for the resident, in a test round and in the
// feed alike. A test round asks Jev first, then counts how often it said what the visitor said.
//
// Measured on three rule-driven readers (docs/measurements.md): every kept answer helps, since it
// may be the near one for some later post, but sending more than a handful dilutes them. Six near
// answers out of 24 to 36 kept beat all 36 sent at once, at a third of the tokens.
import { PRESETS, CANT_TELL } from './presets.js';
import { CARDS, CARD } from './quiz.js';
import { persona, personaLine, GRID, CROWD } from './personas.js';
import { INTEREST, JOBS, AGE_GROUPS, TEMPER, BUDGET, POOLS } from './vocab.js';
import { rng, hash32 } from './rng.js';

export const TUNE_CARDS = 12;
export const TEST_CARDS = 8;
export const SENT_ANSWERS = 6;
export const NAME_CHARS = 32;
export const PLACE_CHARS = 40;
export const ABOUT_CHARS = 300;
export const MAX_INTERESTS = 3;
/** In a request to Jev a resident's question is about this many personas long: its own words and six quoted posts. */
export const RESIDENT_WEIGHT = 4;

/** What a person can do with a quiz post: the reactions of the Post preset, without "can't tell". */
export const QUIZ_REACTIONS = Object.keys(PRESETS.post.reactions).filter((id) => id !== CANT_TELL);
const CRITERIA = Object.fromEntries(QUIZ_REACTIONS.map((id) => [id, PRESETS.post.reactions[id].criteria]));

const line = (value, length) => String(value ?? '').replace(/[\s"“”«»]+/g, ' ').trim().slice(0, length);

/** What the form sent → a profile safe to keep and to put before Jev, or null when it is not a person yet. */
export function cleanProfile(raw) {
  const name = line(raw?.name, NAME_CHARS);
  const age = Math.round(Number(raw?.age));
  const interests = [...new Set(Array.isArray(raw?.interests) ? raw.interests : [])].filter((id) => INTEREST[id]).slice(0, MAX_INTERESTS);
  if (!name || !(age >= 10 && age <= 110) || !interests.length || !['female', 'male'].includes(raw?.gender)) return null;
  return {
    name, age, interests,
    gender: raw.gender,
    job: line(raw.job, PLACE_CHARS),
    city: line(raw.city, PLACE_CHARS),
    temper: TEMPER[raw.temper] ? raw.temper : 'lurker',
    budget: BUDGET[raw.budget] ? raw.budget : 'average',
    about: line(raw.about, ABOUT_CHARS),
  };
}

/** What everybody may see of a resident. Its own words are for Jev alone. */
export const publicProfile = ({ about, ...shown }) => shown;

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * A profile → a person of the same shape `persona()` returns, so the feed algorithm, the map and the
 * pages treat a resident like anybody else. `number` is the order of moving in. A job out of the
 * list keeps the visitor's words; its field is then guessed from the age and the main interest.
 */
export function residentPersona(pool, number, profile) {
  const id = CROWD + number;
  const job = JOBS.find((known) => same(known.en, profile.job) || same(known.uk, profile.job));
  const city = POOLS[pool].cities.find(([english, ukrainian]) => same(english, profile.city) || same(ukrainian, profile.city));
  const field = job?.field ?? (profile.age < 23 ? 'student' : profile.age > 63 ? 'retired' : INTEREST[profile.interests[0]].field ?? 'office');
  return {
    pool, id, x: id % GRID, y: Math.floor(id / GRID), resident: true,
    name: { en: profile.name, uk: profile.name },
    gender: profile.gender ?? 'female',
    age: profile.age,
    ageGroup: (AGE_GROUPS.findLast((group) => profile.age >= group.from) ?? AGE_GROUPS[0]).id,
    city: city ? { en: city[0], uk: city[1] } : { en: profile.city, uk: profile.city },
    job: job?.id ?? null,
    jobText: job?.en ?? profile.job,
    field, interests: profile.interests, temper: profile.temper, budget: profile.budget, spending: 'neutral', shopping: 'nothing',
    ...(profile.about ? { about: profile.about } : {}),
    ...(profile.since ? { since: profile.since } : {}), // when it moved in, for its page
  };
}

/** When a resident moves out, one of the 10,000 kinds of people moves into the house: the town never shrinks. */
export function tenant(pool, number) {
  const id = CROWD + number;
  return { ...persona(pool, hash32('tenant', pool, number) % CROWD), id, x: id % GRID, y: Math.floor(id / GRID) };
}
/** The same for the packed crowd the Worker reads. */
export const lightTenant = (pool, number, light) => ({ ...light[hash32('tenant', pool, number) % CROWD], id: CROWD + number });

/** profiles: what is kept of every house in the order of moving in, null for a house somebody left → the people living there. */
export const residentsOf = (pool, profiles) => profiles.map((profile, number) => (profile ? residentPersona(pool, number, profile) : tenant(pool, number)));

/** The resident as Jev reads it: the line anybody in town has, then its own words. */
export const residentLine = (profile, pool = 'en') => personaLine(residentPersona(pool, 0, profile));

/**
 * Which posts come next. `answered` is the ids already used, `seed` keeps the order the same for one
 * resident. A tuning round spreads over the ways of writing and the topics met least so far, so a later
 * post finds a near answer; a test round is a plain draw from what is left.
 */
export function pickCards(kind, answered, seed) {
  const random = rng(hash32('quiz', seed));
  const left = CARDS.filter((card) => !answered.includes(card.id)).map((card) => ({ card, order: random() })).sort((a, b) => a.order - b.order).map((item) => item.card);
  if (kind === 'test') return left.slice(0, TEST_CARDS);
  const met = { style: {}, topic: {} };
  for (const id of answered) if (CARD[id]) for (const key of ['style', 'topic']) met[key][CARD[id][key]] = (met[key][CARD[id][key]] ?? 0) + 1;
  const picked = [];
  while (picked.length < TUNE_CARDS && left.length) {
    const rarity = (card) => (met.style[card.style] ?? 0) * 10 + (met.topic[card.topic] ?? 0);
    const next = left.reduce((best, card) => (rarity(card) < rarity(best) ? card : best));
    left.splice(left.indexOf(next), 1);
    picked.push(next);
    for (const key of ['style', 'topic']) met[key][next[key]] = (met[key][next[key]] ?? 0) + 1;
  }
  return picked;
}

/**
 * The kept answers nearest to a post: written the same way or on the same topic first, then the latest.
 * `answers` runs oldest to newest; `post` is { style, topics }. A quiz post has both; of a post in the
 * feed only the topics are known, the interests Jev scored highest for it.
 */
export function nearAnswers(answers, post, count = SENT_ANSWERS) {
  const near = (answer) => {
    const other = CARD[answer.card];
    return other ? (post.style && other.style === post.style ? 2 : 0) + (post.topics?.includes(other.topic) ? 2 : 0) : 0;
  };
  return answers
    .map((answer, index) => ({ answer, index, near: near(answer) }))
    .sort((a, b) => b.near - a.near || b.index - a.index)
    .slice(0, count)
    .map((item) => item.answer);
}

const clip = (text, length) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

/**
 * What goes into a question about a resident, between its line and the question itself: the near
 * answers, quoted. In the instructions Jev follows them more closely than from the state (0.69
 * against 0.63 of sixteen answers). → '' for a resident nobody tuned.
 */
export function earlierWords(answers, post, lang) {
  const kept = nearAnswers(answers, post).filter((answer) => CARD[answer.card]);
  if (!kept.length) return '';
  return `What this same reader really did with other posts: ${kept.map((answer) => `"${clip(CARD[answer.card][lang], 200)}" → ${CRITERIA[answer.human]}`).join('; ')}. Go by that before anything else. `;
}

/** The interests a post is about, as the feed algorithm's scores name them: the few Jev scored highest. */
export function topicsOf(scores, count = 3) {
  return Object.entries(scores)
    .filter(([id, score]) => id.startsWith('interest:') && score >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id]) => id.slice('interest:'.length));
}

/**
 * One request about one quiz post, two questions: `tuned` has the near answers, `plain` has the
 * description alone. The gap between the two is what tuning gave.
 */
export function quizRequest(profile, card, answers, lang) {
  const preset = PRESETS.post;
  const who = `${preset.who}: ${residentLine(profile, lang)}. `;
  const earlier = earlierWords(answers.filter((answer) => answer.card !== card.id), { style: card.style, topics: [card.topic] }, lang);
  const questions = { plain: { type: 'choice', instructions: who + preset.ask, criteria: CRITERIA } };
  if (earlier) questions.tuned = { type: 'choice', instructions: who + earlier + preset.ask, criteria: CRITERIA };
  return { state: { seen_in: preset.seenIn, [preset.noun]: card[lang] }, questions };
}

/**
 * Before a resident is shown to everybody, Jev reads what the visitor typed: the name, the job, the
 * city and the resident's own words. The same questions a post is asked (requests.js).
 */
export function profileRequest(profile, questions) {
  const asked = {};
  for (const [id, instructions] of Object.entries(questions)) asked[id] = { type: 'noul', instructions: instructions.replaceAll('the text', 'the profile').replaceAll('The text', 'The profile'), criteria: { true: 'Yes, clearly', false: 'No' } };
  return { state: { seen_in: 'the public profile of a member of a social network', profile: [profile.name, profile.job, profile.city, profile.about].filter(Boolean).join(' · ') }, questions: asked };
}

/** A choice answer → the reaction Jev finds most likely, or null. */
export function likeliest(answer) {
  return Object.entries(answer?.probabilities ?? {}).filter(([id]) => QUIZ_REACTIONS.includes(id)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Test answers → [{ round, asked, tuned, plain }], a line per test round, oldest first. */
export function scores(answers) {
  const rounds = new Map();
  for (const answer of answers) {
    if (answer.kind !== 'test') continue;
    const round = rounds.get(answer.round) ?? { round: answer.round, asked: 0, tuned: 0, plain: 0 };
    round.asked += 1;
    if (answer.jev === answer.human) round.tuned += 1;
    if (answer.plain === answer.human) round.plain += 1;
    rounds.set(answer.round, round);
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round);
}
