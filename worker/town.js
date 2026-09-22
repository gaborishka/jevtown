// Asking the town when a check closes. The last /api/wave asks up to four questions
// (shared/presets.js:ASKS), each of up to 100 of the people the check reached, one request each, sent
// together. It lives apart from index.js, which imports the packed crowds, so tests can load it.
import { CROWD } from '../public/shared/personas.js';
import { RESIDENT_WEIGHT } from '../public/shared/resident.js';
import { asking, emptyGathered } from '../public/shared/feed.js';
import { askQuestion, mergeSaid, listsOf } from '../public/shared/check.js';
import { ask } from '../public/shared/jev.js';

/** The `batches` stage each question's answers are stored under, with n = 0. */
export const ASK_STAGE = { why: 'y', hook: 'h', comment: 'c', depth: 'd' };
const QUESTION_OF = Object.fromEntries(Object.entries(ASK_STAGE).map(([question, stage]) => [stage, question]));
/**
 * How long one close holds the asking. Longer than the slowest ask: three attempts of jev.js's 30 s
 * timeout with the backoff between them, about 92 s. A close killed midway holds it until then; the
 * next close takes it over.
 */
export const ASKING_MS = 120_000;
/** The retries all questions of a close share: four requests and two retries are 6 of the 50 an invocation may make. */
export const RETRIES_FOR_ASKING = 2;

/** How much of a request a person takes: a resident's question is about four personas long. */
export const weightOf = (id) => (id < CROWD ? 1 : RESIDENT_WEIGHT);

const today = () => new Date().toISOString().slice(0, 10);
// Two closes can both pay for one question only when one of them took the asking over after ASKING_MS.
// The first answer is kept and every spend is added, so the day's budget and the summary never undercount.
const STORE = 'INSERT INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, ?, ?, 0, ?, ?, ?, ?) ON CONFLICT (post, number, stage, n) DO UPDATE SET usd = usd + excluded.usd, tokens = tokens + excluded.tokens';

/**
 * What a close does with each question it wants asked: reuse the answers an earlier close stored, ask
 * it, or skip it when the day's budget is spent. wanted: [question], stored: { question: part }.
 * → { reuse: { question: part }, ask: [question], skipped: [question] }
 */
export function toAsk(wanted, stored, budgetSpent) {
  const plan = { reuse: {}, ask: [], skipped: [] };
  for (const question of wanted) {
    if (stored[question]) plan.reuse[question] = stored[question];
    else (budgetSpent ? plan.skipped : plan.ask).push(question);
  }
  return plan;
}

/**
 * Asks the town at the last close of a check. db is D1, provider the way to Jev, peopleOf(ids) the
 * people as Jev is asked about them, isSpent() whether the day's budget is used up. version is the
 * running version with its post, number, preset, pool and text; reactions its bytes; keys the preset's
 * reaction ids. → { said } as check.js:mergeSaid gives it, or { busy: true } when another close is asking.
 *
 * Before paying, a close takes the asking with one compare-and-set on its plan, so a reload or a second
 * tab waiting on the same close does not pay again; the done write stores the plan without it. Asking
 * never fails a check: a question it cannot ask is left out, its lists marked 'budget' or 'failed'.
 */
export async function askTown({ db, provider, peopleOf, isSpent }, version, plan, reactions, keys) {
  const { post, number, preset, pool, text } = version;
  const reactionOf = (id) => keys[reactions[id] - 1];
  const wanted = asking(preset, text, plan.gathered ?? emptyGathered(), weightOf);
  if (!wanted.length) return { said: mergeSaid([]) };
  const listsOfQuestion = (question) => listsOf(question, preset, wanted.find((one) => one.question === question).ids, reactionOf);
  const parts = {};
  const missing = {};
  const failed = new Set();
  let skipped = [];
  try {
    const stages = Object.values(ASK_STAGE);
    const { results } = await db.prepare(`SELECT stage, result FROM batches WHERE post = ? AND number = ? AND stage IN (${stages.map(() => '?').join(', ')})`).bind(post, number, ...stages).all();
    const stored = Object.fromEntries(results.map((row) => [QUESTION_OF[row.stage], JSON.parse(row.result)]));
    const something = wanted.some(({ question }) => !stored[question]);
    const next = toAsk(wanted.map(({ question }) => question), stored, something && (await isSpent()));
    Object.assign(parts, next.reuse);
    skipped = next.skipped;
    for (const question of skipped) for (const list of listsOfQuestion(question)) missing[list] = 'budget';

    if (next.ask.length) {
      const now = Date.now();
      const taken = await db.prepare("UPDATE versions SET plan = json_set(plan, '$.asking', ?) WHERE post = ? AND number = ? AND state = 'running' AND COALESCE(json_extract(plan, '$.asking'), 0) < ?").bind(now, post, number, now - ASKING_MS).run();
      if (!taken.meta.changes) return { busy: true };
      const asked = wanted.filter(({ question }) => next.ask.includes(question));
      const people = new Map((await peopleOf([...new Set(asked.flatMap(({ ids }) => ids))])).map((who) => [who.id, who]));
      const retries = { left: RETRIES_FOR_ASKING };
      const answered = [];
      await Promise.all(asked.map(({ question, ids }) => askQuestion((request) => ask(provider, request, retries), question, { presetId: preset, text, people: ids.map((id) => people.get(id)), reactionOf, pool, versionId: `${post}.${number}` })
        .then((answer) => answered.push({ question, ...answer }), (error) => {
          console.error('ask', question, post, number, error.message);
          failed.add(question);
        })));
      // What was paid for is shown even if storing it fails below.
      for (const { question, part } of answered) parts[question] = part;
      if (answered.length) await db.batch(answered.map(({ question, part, usd, tokens }) => db.prepare(STORE).bind(post, number, ASK_STAGE[question], JSON.stringify(part), usd, tokens, today())));
    }
  } catch (error) {
    // A D1 query or peopleOf failed: the questions still without answers are left out. When only
    // storing failed, this close shows the answers all the same.
    const left = wanted.map(({ question }) => question).filter((question) => !parts[question] && !skipped.includes(question));
    console.error('ask', left.length ? left.join(' ') : 'storing', post, number, error.message);
    for (const question of left) failed.add(question);
  }
  for (const question of failed) for (const list of listsOfQuestion(question)) missing[list] = 'failed';
  return { said: mergeSaid(Object.values(parts), missing) };
}
