// The two tools an agent gets: check_text follows one text through the town, compare_texts reads the
// first waves of a few variants of it. Both run the engine on this machine, as `npm run check` does:
// nothing is posted or stored, and the only traffic is the requests to Jev on the key of whoever runs
// the server. This file knows nothing about JSON-RPC; mcp/protocol.js carries the tools.
import { createHash } from 'node:crypto';
import { runCheck, AT_ONCE, PER_REQUEST } from '../public/shared/check.js';
import { PRESETS, priceLadder } from '../public/shared/presets.js';
import { MAX_TEXT_CHARS } from '../public/shared/requests.js';
import { WAVES } from '../public/shared/feed.js';
import { crowd, poolFor, CROWD } from '../public/shared/personas.js';
import { counters, segments, topSegments, biggestSegments, rankedAnswers, demandCurve } from '../public/shared/summary.js';
import { TYPESAFE_USD_PER_TOKEN, PROVIDERS } from '../public/shared/jev.js';
import { DICTIONARIES } from '../public/i18n.js';
import { groupLabel, verdictOf, summary, compareSummary, startOf } from './words.js';

/** Every check draws with this version id, so a person who reads two variants draws the same number for both. */
const SEED = 'mcp';
const MAX_VARIANTS = 5;
/** Up to 5,100 people: a niche text stops there anyway, and a whole-town check may not fit in a client's minute. */
const DEFAULT_WAVES = 3;
/** The Worker's ENOUGH_BATCHES: a wave with fewer of its people answered says nothing about the text. */
const ENOUGH_ANSWERED = 0.7;
/**
 * The most a request is assumed to cost when the budget is checked, and what one costs when the
 * provider reports neither dollars nor tokens. The dearest request measured is a listing's follow-up,
 * $0.022 per 1,000 people (docs/measurements.md), which is $0.0022 for a request of 100.
 */
export const WORST_USD_PER_REQUEST = 0.0025;
/** Answers kept for repeats; one is about 20 KB, so this is about 10 MB. */
const CACHE_SIZE = 500;
const MAX_PRICES = 6;
/** Groups, scores and questions: as many as the post page shows. */
const TOP = 7;
const TOP_IN_ROW = 3;
const LANGS = ['en', 'uk'];
const POOLS = ['uk', 'en'];

export const INSTRUCTIONS = 'Jevtown reads texts; it does not write them. Write variants yourself, compare them with compare_texts (first waves only, about a cent each), then follow the best one with check_text. Every call spends money on the Jev key of whoever runs this server, and the server runs one call at a time.';

const KEY_NAMES = Object.values(PROVIDERS).map((provider) => provider.keyName);

/** A mistake of the caller or of the setup: it goes back to the agent as a tool error, without a stack trace in the log. */
const mistake = (message) => Object.assign(new Error(message), { mistake: true });
const isFatal = (error) => Boolean(error?.fatal || error?.code === 'no_key');
const round = (value, digits = 2) => Number(value.toFixed(digits)) || 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The most requests a check can make: the opening one, every wave full, and a follow-up question for everybody reached. */
export function worstRequests(presetId, maxWaves) {
  let reach = 0;
  let requests = 1;
  for (const wave of WAVES.slice(0, maxWaves)) {
    const people = Math.min(wave.size, CROWD - reach);
    reach += people;
    requests += Math.ceil(people / PER_REQUEST);
  }
  if (PRESETS[presetId].followUp) requests += Math.ceil(reach / PER_REQUEST);
  return requests;
}

// Arguments are checked by the rules the inputSchema states, and refused rather than rewritten.

const PRESET_IDS = Object.keys(PRESETS);
const TEXT = `The text must be 1 to ${MAX_TEXT_CHARS} characters.`;
const PRICES = `A product needs 2 to ${MAX_PRICES} different prices, as positive numbers, for example [9, 15, 24].`;

function known(raw, tool, names) {
  if (raw === undefined) return {};
  if (!isObject(raw)) throw mistake(`${tool} takes an object of arguments: ${names.join(', ')}.`);
  const unknown = Object.keys(raw).find((name) => !names.includes(name));
  if (unknown !== undefined) throw mistake(`Unknown argument "${unknown}". ${tool} takes: ${names.join(', ')}.`);
  return raw;
}

function textFrom(value, message) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > MAX_TEXT_CHARS) throw mistake(message);
  return text;
}

/** preset, prices, currency and lang, which both tools take. */
function common(args) {
  const presetId = args.preset ?? 'post';
  if (typeof presetId !== 'string' || !PRESETS[presetId]) throw mistake(`Unknown preset "${presetId}": use ${PRESET_IDS.slice(0, -1).join(', ')} or ${PRESET_IDS.at(-1)}.`);
  let prices;
  let currency;
  if (presetId === 'product') {
    const given = args.prices;
    const valid = Array.isArray(given) && given.length >= 2 && given.length <= MAX_PRICES && given.every((price) => typeof price === 'number' && price > 0 && price < 1e7) && new Set(given).size === given.length;
    if (!valid) throw mistake(PRICES);
    // priceLadder needs the prices in ascending order; the order changes no meaning.
    prices = [...given].sort((a, b) => a - b);
    currency = args.currency ?? '$';
    if (typeof currency !== 'string' || currency.length < 1 || currency.length > 4) throw mistake('currency must be 1 to 4 characters, for example $ or UAH.');
  } else {
    if (args.prices !== undefined) throw mistake('prices apply to preset product only.');
    if (args.currency !== undefined) throw mistake('currency applies to preset product only.');
  }
  const lang = args.lang ?? 'en';
  if (!LANGS.includes(lang)) throw mistake('lang must be en or uk.');
  if (args.pool !== undefined && !POOLS.includes(args.pool)) throw mistake('pool must be uk or en.');
  return { presetId, prices, currency, lang };
}

const CHECK_ARGS = ['text', 'preset', 'prices', 'currency', 'pool', 'waves', 'lang'];
const COMPARE_ARGS = ['texts', 'preset', 'prices', 'currency', 'pool', 'lang'];

export function checkArgs(raw) {
  const args = known(raw, 'check_text', CHECK_ARGS);
  const text = textFrom(args.text, TEXT);
  const options = common(args);
  const maxWaves = args.waves ?? DEFAULT_WAVES;
  if (!Number.isInteger(maxWaves) || maxWaves < 1 || maxWaves > WAVES.length) throw mistake(`waves must be a whole number from 1 to ${WAVES.length}.`);
  return { ...options, text, pool: args.pool ?? poolFor(text), maxWaves };
}

export function compareArgs(raw) {
  const args = known(raw, 'compare_texts', COMPARE_ARGS);
  const texts = args.texts;
  if (!Array.isArray(texts) || texts.length < 2 || texts.length > MAX_VARIANTS) throw mistake(`compare_texts takes 2 to ${MAX_VARIANTS} texts.`);
  const cleaned = texts.map((text, index) => textFrom(text, `Text ${index + 1} must be 1 to ${MAX_TEXT_CHARS} characters.`));
  const options = common(args);
  // poolFor would pick one town for all of them, and some variants would be read by people who do not speak their language.
  const pools = new Set(cleaned.map((text) => poolFor(text)));
  if (args.pool === undefined && pools.size > 1) throw mistake('These texts are in different languages, so different towns would read them. Pass pool: "uk" or "en" to have one town read them all.');
  return { ...options, texts: cleaned, pool: args.pool ?? [...pools][0] };
}

// The shape of the results. Nullable fields say so; no object forbids fields it does not list, so the results can grow.

const string = { type: 'string' };
const integer = { type: 'integer' };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
const nullable = (schema) => ({ ...schema, type: [schema.type, 'null'] });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', required, properties });
const array = (items) => ({ type: 'array', items });
const REASONS = array(string);
const GROUP = { group: string, label: string };
const SCORE = array(object({ ...GROUP, score: number }));
const COUNTERS = object({ reach: integer, stopped: integer, glad: integer, sorry: integer });
const QUESTION = object({ id: string, text: string, share: number });
const STEP = object({ price: number, buyers: integer, revenue: number });
const GROUPS = object({ everybody: number, standsOut: boolean, top: array(object({ ...GROUP, share: number, people: integer, size: integer, lift: number })) });
const COST = object({ requests: integer, cached: integer, failedBatches: integer, tokens: integer, usd: number, seconds: number });
const BUDGET = object({ day: string, spentUsd: number, limitUsd: nullable(number) });
const ABOUT = { preset: { type: 'string', enum: PRESET_IDS }, pool: { type: 'string', enum: POOLS }, lang: { type: 'string', enum: LANGS } };

/**
 * A result is built from sections. Each one names its fields in the outputSchema and fills them from
 * the context of a finished call, so a new part of the result is one more section.
 */
const schemaOf = (sections, more = {}) => object(Object.assign({}, ...sections.map((section) => section.properties), more));
const fill = (sections, context) => Object.assign({}, ...sections.map((section) => section.fields(context)));

const shownTo = ({ result, lang }, count) => Object.entries(result.scores).sort((a, b) => b[1] - a[1]).slice(0, count)
  .map(([group, score]) => ({ group, label: groupLabel(lang, ...group.split(':')), score: round(score) }));
const segmentOut = (lang, segment, what) => ({ group: `${segment.attribute}:${segment.value}`, label: groupLabel(lang, segment.attribute, segment.value), share: round(segment[what] / segment.size), people: segment[what], size: segment.size, lift: round(segment[`${what}Lift`]) });

/** Who stopped, was glad or got annoyed, the way the post page picks the groups: those above the town, or the biggest when nobody stands out. */
function groupsOf({ all, totals, lang, town }) {
  const one = (what) => {
    const standing = topSegments(all, what, TOP);
    const shown = standing.length ? standing : biggestSegments(all, what, TOP);
    return { everybody: round(totals[what] / town), standsOut: standing.length > 0, top: shown.map((segment) => segmentOut(lang, segment, what)) };
  };
  return { stopped: one('stopped'), glad: one('glad'), sorry: totals.sorry >= 10 ? one('sorry') : null };
}

/** The buyers' first questions to the seller, in the words of the page. */
function questionsOf({ result, lang }) {
  const answers = DICTIONARIES[lang].answers ?? PRESETS.listing.followUp.answers;
  return rankedAnswers({ ...result.followUp, answers }).slice(0, TOP).map(({ id, text, share }) => ({ id, text: text ?? id, share: round(share) }));
}

/** How many would buy at each price, and the price that earns the most if any does. */
function demandOf({ result, prices, currency }) {
  const curve = demandCurve({ ...result.followUp, answers: priceLadder(prices, currency) }, prices);
  const best = curve.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  return { currency, prices: curve, best: best.revenue > 0 ? best : null };
}

const costOf = ({ tally, seconds }) => ({ requests: tally.requests, cached: tally.cached, failedBatches: tally.failed, tokens: tally.tokens, usd: round(tally.usd, 6), seconds: round(seconds, 1) });

const CHECK_SECTIONS = [
  {
    properties: {
      ...ABOUT,
      status: { type: 'string', enum: ['blocked', 'incomplete', 'stopped', 'everyone', 'cut_by_waves', 'cut_by_time'] },
      verdict: nullable(string),
      town: integer,
      reach: integer,
      stoppedAt: nullable(integer),
    },
    fields: ({ presetId, pool, lang, status, totals, town, stoppedAt }) => ({ preset: presetId, pool, lang, status, verdict: null, town, reach: totals.reach, stoppedAt }),
  },
  {
    properties: { unlisted: REASONS, blocked: REASONS },
    fields: ({ result }) => ({ unlisted: result.unlisted, blocked: result.blocked }),
  },
  {
    properties: { waves: array(object({ people: integer, answered: integer, mood: number, expectedMood: number, travels: boolean, margin: number }, ['people', 'answered', 'mood', 'expectedMood', 'travels'])) },
    fields: ({ result, margin }) => ({
      waves: result.waves.map((wave) => ({ people: wave.asked, answered: wave.size, mood: round(wave.mood), expectedMood: round(wave.expectedMood), travels: wave.travels, ...(wave.index === 0 ? { margin: round(margin, 3) } : {}) })),
    }),
  },
  {
    properties: { counters: object({ reach: integer, stopped: integer, glad: integer, sorry: integer, byReaction: { type: 'object' } }), shownTo: SCORE, groups: nullable(object({ stopped: GROUPS, glad: GROUPS, sorry: nullable(GROUPS) })) },
    fields: (context) => ({ counters: context.totals, shownTo: shownTo(context, TOP), groups: context.result.blocked.length ? null : groupsOf(context) }),
  },
  {
    properties: { questions: nullable(array(QUESTION)), demand: nullable(object({ currency: string, prices: array(STEP), best: nullable(STEP) })) },
    fields: (context) => ({
      questions: context.presetId === 'listing' && context.result.followUp ? (context.result.followUp.asked ? questionsOf(context) : []) : null,
      demand: context.presetId === 'product' && context.result.followUp ? demandOf(context) : null,
    }),
  },
  {
    properties: { cost: COST, budget: BUDGET },
    fields: (context) => ({ cost: costOf(context), budget: context.budget() }),
  },
];

const ROW_SECTIONS = [
  {
    properties: { index: integer, start: string, status: { type: 'string', enum: ['travels', 'stops', 'blocked', 'incomplete', 'failed'] }, error: nullable(string) },
    fields: ({ index, text, status, error }) => ({ index, start: startOf(text), status, error }),
  },
  {
    properties: { travels: nullable(boolean), people: nullable(integer), answered: nullable(integer), mood: nullable(number), expectedMood: nullable(number), margin: nullable(number), closeToBest: boolean, counters: nullable(COUNTERS) },
    fields: ({ wave, margin, totals }) => ({
      travels: wave ? wave.travels : null,
      people: wave ? wave.asked : null,
      answered: wave ? wave.size : null,
      mood: wave ? round(wave.mood) : null,
      expectedMood: wave ? round(wave.expectedMood) : null,
      margin: wave ? round(margin, 3) : null,
      closeToBest: false,
      counters: totals ? { reach: totals.reach, stopped: totals.stopped, glad: totals.glad, sorry: totals.sorry } : null,
    }),
  },
  {
    properties: { shownTo: nullable(SCORE), mostAnnoyed: nullable(object({ ...GROUP, share: number })) },
    fields: (context) => {
      if (!context.result) return { shownTo: null, mostAnnoyed: null };
      const annoyed = context.wave && context.totals.sorry >= 10 ? topSegments(context.all, 'sorry', 1)[0] : null;
      return { shownTo: shownTo(context, TOP_IN_ROW), mostAnnoyed: annoyed ? { group: `${annoyed.attribute}:${annoyed.value}`, label: groupLabel(context.lang, annoyed.attribute, annoyed.value), share: round(annoyed.sorry / annoyed.size) } : null };
    },
  },
  {
    properties: { topQuestion: nullable(QUESTION), bestPrice: nullable(STEP) },
    fields: (context) => ({
      topQuestion: context.presetId === 'listing' && context.result?.followUp?.asked ? questionsOf(context)[0] ?? null : null,
      bestPrice: context.presetId === 'product' && context.result?.followUp ? demandOf(context).best : null,
    }),
  },
  {
    properties: { unlisted: REASONS, blocked: REASONS },
    fields: ({ result }) => ({ unlisted: result?.unlisted ?? [], blocked: result?.blocked ?? [] }),
  },
];

/**
 * Two standard errors of a wave's drawn mood, from its own glad and sorry shares: how far the luck of
 * the draw can move it. It is a margin of the draw, not of how well Jev knows the town.
 */
function marginOf(totals, size) {
  const n = Math.max(1, size);
  const glad = totals.glad / n;
  const sorry = totals.sorry / n;
  return 2 * Math.sqrt(Math.max(0, glad + sorry - (glad - sorry) ** 2) / n);
}

const incomplete = (wave) => wave.size < ENOUGH_ANSWERED * wave.asked;

/**
 * Indices of the rows that can be ranked, best first: first by the town's rule (did the first wave
 * send the variant on), then by the mood that wave has on average over draws.
 */
export function ranking(rows, moods) {
  return rows.filter((row) => !row.error && !row.blocked.length)
    .sort((a, b) => Number(b.travels) - Number(a.travels) || moods[b.index].expected - moods[a.index].expected)
    .map((row) => row.index);
}

/**
 * createTools({ send, budgetUsd, maxSeconds, envFile, now }) → [check_text, compare_texts]. send(request)
 * is `ask` bound to a provider. budgetUsd is dollars per UTC day, 0 for no limit; maxSeconds is the
 * time a check may plan for, 0 for no limit; envFile is where the server looks for a key; now() is the clock.
 */
export function createTools({ send, budgetUsd = 1, maxSeconds = 45, envFile, now = Date.now }) {
  const towns = {};
  const townOf = (pool) => (towns[pool] ??= crowd(pool));

  // The day's spending lives in memory: a restarted server starts the day from $0.
  const spent = { day: null, usd: 0 };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const spentToday = () => {
    if (spent.day !== today()) Object.assign(spent, { day: today(), usd: 0 });
    return spent;
  };
  const budget = () => ({ day: today(), spentUsd: round(spentToday().usd, 4), limitUsd: budgetUsd || null });
  /** Refuses a call whose worst case would pass the day's budget, before anything is sent. */
  function guard(requests) {
    const worst = requests * WORST_USD_PER_REQUEST;
    const left = budgetUsd - spentToday().usd;
    if (budgetUsd && worst > left) {
      throw mistake(`This check could cost up to $${worst.toFixed(2)} (${requests} requests to Jev), and this server has $${Math.max(0, left).toFixed(2)} left of its $${budgetUsd.toFixed(2)} for today (JEVTOWN_MCP_DAILY_BUDGET_USD, UTC days). Nothing was sent. Use fewer waves or variants, raise the limit, or wait for the next UTC day.`);
    }
  }
  const priceOf = (answer) => (answer.usd > 0 ? answer.usd : answer.tokens > 0 ? answer.tokens * TYPESAFE_USD_PER_TOKEN : WORST_USD_PER_REQUEST);

  // At most AT_ONCE requests are in flight for the whole process: past that, each one only takes longer.
  let sending = 0;
  const waiting = [];
  const slot = () => (sending < AT_ONCE ? (sending++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)));
  const free = () => {
    const next = waiting.shift();
    if (next) next();
    else sending--;
  };

  // Jev's answers by the SHA-256 of the request, oldest out first. A request already on its way is
  // awaited, not sent twice; a failure is not kept.
  const cache = new Map();
  const keyOf = (request) => createHash('sha256').update(JSON.stringify(request)).digest('base64');
  const remember = (key, pending) => {
    cache.set(key, pending);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  };

  // One call at a time. The call stays busy until every request it started has come back, because
  // runCheck gives up on a fatal error while its other lanes still wait on theirs.
  let busy = null;
  const release = (job) => {
    if (job.finished && job.open === 0 && busy === job) busy = null;
  };

  /** A running call: its own stop switch, tied to the client's cancel, and what its requests cost. */
  function begin(signal, onSettle) {
    const stop = new AbortController();
    if (signal?.aborted) stop.abort();
    else signal?.addEventListener('abort', () => stop.abort(), { once: true });
    const job = { signal: stop.signal, stop: () => stop.abort(), open: 0, finished: false, message: undefined, tally: { requests: 0, cached: 0, failed: 0, tokens: 0, usd: 0, settled: 0 } };
    job.send = sender(job, onSettle);
    job.end = () => {
      job.finished = true;
      release(job);
    };
    busy = job;
    return job;
  }

  const stopped = () => Object.assign(new Error('the check was stopped'), { fatal: true, stopped: true });

  /** send, as runCheck sees it: one call's requests, through the slots, the cache and the budget. */
  const sender = (job, onSettle) => async (request) => {
    job.open += 1;
    try {
      const answer = await ask(request, job);
      job.tally.requests += 1;
      return answer;
    } catch (error) {
      if (!error.stopped) error.fromJev = true;
      if (!isFatal(error)) job.tally.failed += 1;
      // A fatal answer (no key, a refused request) ends the call: the other lanes send nothing more.
      else if (!error.stopped) job.stop();
      throw error;
    } finally {
      job.open -= 1;
      job.tally.settled += 1;
      onSettle(job.tally.settled);
      release(job);
    }
  };

  async function ask(request, job) {
    if (job.signal.aborted) throw stopped();
    const key = keyOf(request);
    if (cache.has(key)) return fromMemory(key, job);
    await slot();
    let held = true;
    const letGo = () => held && ((held = false), free());
    try {
      if (job.signal.aborted) throw stopped();
      if (cache.has(key)) {
        letGo();
        return await fromMemory(key, job);
      }
      const pending = send(request);
      remember(key, pending);
      let answer;
      try {
        answer = await pending;
      } catch (error) {
        if (cache.get(key) === pending) cache.delete(key);
        throw error;
      }
      // Failed requests count as $0: nothing says what they cost. Answered ones count always, even for a cancelled call.
      const usd = priceOf(answer);
      spentToday().usd += usd;
      job.tally.usd += usd;
      job.tally.tokens += answer.tokens ?? 0;
      return { answers: answer.answers, tokens: answer.tokens ?? 0, usd };
    } finally {
      letGo();
    }
  }

  async function fromMemory(key, job) {
    const answer = await cache.get(key);
    job.tally.cached += 1;
    return { answers: answer.answers, tokens: 0, usd: 0 };
  }

  function refuseIfBusy() {
    if (busy) throw mistake('Another check is running on this server. Wait for it to finish; to check several texts, pass them to compare_texts in one call.');
  }

  /** A failed call as the agent reads it. A cancelled one is passed on untouched, since nobody reads it, and so is a bug of this server. */
  function failure(error, signal) {
    if (signal?.aborted || !error.fromJev) return error;
    if (error.code === 'no_key') return mistake(`No Jev key. Set ${KEY_NAMES.join(' or ')} in this server's environment, or put one into ${envFile ?? '.env.local'}.`);
    return mistake(`Jev did not answer: ${error.message}. Nothing more was sent; what was spent is counted.`);
  }

  const context = (presetId, pool, lang, result, extra) => {
    const people = townOf(pool);
    const totals = counters(presetId, result.keys, result.reactions);
    return { presetId, pool, lang, result, totals, town: result.reactions.length, all: result.waves.length ? segments(presetId, result.keys, result.reactions, people) : [], budget, ...extra };
  };

  const checkText = {
    name: 'check_text',
    title: 'Check a text with Jevtown',
    description: "Shows a text to Jevtown, a town of 10,000 computed personas who speak its language (Ukrainian or English), and reports what they did: how far it travelled in waves of 600, 1,500 and 3,000 people (and everybody else with waves: 4), who stopped, who was glad and who got annoyed, and for a listing or a product what buyers would ask or pay. Every reaction comes from Jev, a model that answers typed questions with probabilities and writes no text, so rewriting is up to you. It is paid from the Jev key of whoever runs this server: a text that dies in the first wave costs under a cent, one that reaches 5,100 people about five cents, and a listing or product that reaches everybody up to about thirty cents. A check takes from a few seconds to under a minute; a wave that would not finish within the server's time limit is not started. Reactions are drawn with a fixed seed, so the same text gives nearly the same result; that is not a measure of certainty. A post of the same text on the site will differ: it has its own seed and the residents visitors moved in.",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS, description: `The text exactly as it would be published, 1 to ${MAX_TEXT_CHARS} characters.` },
        ...commonInputs(),
        waves: { type: 'integer', minimum: 1, maximum: WAVES.length, default: DEFAULT_WAVES, description: 'How far the text may travel: 1 = the first 600 people only, 3 = up to 5,100 people (default), 4 = the whole town. More waves cost more and take longer.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: schemaOf(CHECK_SECTIONS),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },

    async run(raw, { signal, progress } = {}) {
      refuseIfBusy();
      const { text, presetId, pool, prices, currency, maxWaves, lang } = checkArgs(raw);
      const total = worstRequests(presetId, maxWaves);
      guard(total);
      const job = begin(signal, (settled) => progress?.(settled, total, job.message));
      const keys = Object.keys(PRESETS[presetId].reactions);
      const startedAt = now();
      const elapsed = () => (now() - startedAt) / 1000;
      let firstWave = null;
      let asked = 0;
      let answered = 0;
      let outOfTime = false;
      try {
        const result = await runCheck({
          send: job.send, presetId, pool, text, versionId: SEED, prices, currency, maxWaves, opening: true,
          onWave: (wave, reactions) => {
            if (wave.index === 0) firstWave = counters(presetId, keys, reactions);
            asked += wave.asked;
            answered += wave.size;
            job.message = waveLine(wave);
          },
          // The next wave starts only if Jev answered enough of this one, and if it is expected to end within the limit at the pace so far.
          mayGoOn: (wave) => {
            if (incomplete(wave)) return false;
            if (wave.index + 1 >= maxWaves || !maxSeconds) return true;
            const next = Math.min(WAVES[wave.index + 1].size, CROWD - answered);
            const seconds = elapsed();
            outOfTime = seconds + (next * seconds) / asked > maxSeconds;
            return !outOfTime;
          },
        });
        const incompleteAt = result.waves.findIndex(incomplete);
        const last = result.waves.at(-1);
        const status = result.blocked.length ? 'blocked'
          : incompleteAt >= 0 ? 'incomplete'
            : !last.travels && last.index < WAVES.length - 1 ? 'stopped'
              : outOfTime ? 'cut_by_time'
                : result.waves.length < WAVES.length ? 'cut_by_waves'
                  : 'everyone';
        const report = fill(CHECK_SECTIONS, context(presetId, pool, lang, result, {
          status, stoppedAt: status === 'stopped' ? last.index : null, prices, currency, tally: job.tally, seconds: elapsed(),
          margin: firstWave ? marginOf(firstWave, result.waves[0].size) : 0,
        }));
        report.verdict = verdictOf(lang, report, { maxSeconds });
        return { structured: report, text: summary(lang, report, { incompleteAt }) };
      } catch (error) {
        throw failure(error, signal);
      } finally {
        job.end();
      }
    },
  };

  const compareTexts = {
    name: 'compare_texts',
    title: 'Compare variants with Jevtown',
    description: "Shows two to five variants of one text to Jevtown's first wave: for each variant, the 500 people Jev thinks it is for plus 100 random ones, so variants may meet different people. Ranks them by the town's rule: first whether the first wave sent the variant on (glad minus sorry at least 0.1 of the wave), then by the glad minus sorry that wave has on average. Variants closer than the draw can move them are marked as too close to call. Use it to choose between variants you wrote, then run check_text on the best one. It costs about a cent per variant, up to two for a listing, on the key of whoever runs this server, and takes about 10 to 20 seconds for five.",
    inputSchema: {
      type: 'object',
      properties: {
        texts: { type: 'array', minItems: 2, maxItems: MAX_VARIANTS, items: { type: 'string', minLength: 1, maxLength: MAX_TEXT_CHARS }, description: `Two to five variants of one text, each exactly as it would be published, 1 to ${MAX_TEXT_CHARS} characters.` },
        ...commonInputs(),
      },
      required: ['texts'],
      additionalProperties: false,
    },
    outputSchema: object({ ...ABOUT, ranking: array(integer), rows: array(schemaOf(ROW_SECTIONS)), cost: COST, budget: BUDGET }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },

    async run(raw, { signal, progress } = {}) {
      refuseIfBusy();
      const { texts, presetId, pool, prices, currency, lang } = compareArgs(raw);
      const total = texts.length * worstRequests(presetId, 1);
      guard(total);
      const job = begin(signal, (settled) => progress?.(settled, total, job.message));
      const keys = Object.keys(PRESETS[presetId].reactions);
      const startedAt = now();
      const firstWaves = [];
      try {
        // The variants run side by side and share the slots, so five take little longer than one.
        const settled = await Promise.allSettled(texts.map((text, index) => runCheck({
          send: job.send, presetId, pool, text, versionId: SEED, prices, currency, maxWaves: 1, opening: true,
          onWave: (wave, reactions) => {
            firstWaves[index] = counters(presetId, keys, reactions);
            job.message = `variant ${index + 1}, ${waveLine(wave)}`;
          },
        })));
        const errors = settled.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
        // A fatal answer ends the whole call, and so does a bug of this server, which must not pass for Jev's failure in a row.
        const fatal = errors.find((error) => isFatal(error) && !error.stopped) ?? errors.find(isFatal) ?? errors.find((error) => !error.fromJev);
        if (fatal) throw fatal;

        const moods = [];
        const rows = settled.map((outcome, index) => {
          const result = outcome.status === 'fulfilled' ? outcome.value : null;
          const wave = result?.waves[0] ?? null;
          const margin = wave ? marginOf(firstWaves[index], wave.size) : 0;
          moods[index] = { expected: wave?.expectedMood ?? 0, margin };
          const status = !result ? 'failed' : result.blocked.length ? 'blocked' : incomplete(wave) ? 'incomplete' : wave.travels ? 'travels' : 'stops';
          const error = !result ? `Jev did not answer: ${outcome.reason.message}`
            : status === 'incomplete' ? `Jev answered for only ${wave.size} of ${wave.asked} people in the first wave.` : null;
          const base = { index, text: texts[index], status, error, lang, presetId, pool, prices, currency, wave: status === 'blocked' ? null : wave, margin };
          return fill(ROW_SECTIONS, result ? context(presetId, pool, lang, result, base) : base);
        });
        const order = ranking(rows, moods);
        const [best] = order;
        for (const index of order.slice(1)) {
          rows[index].closeToBest = Math.abs(moods[best].expected - moods[index].expected) < Math.max(moods[best].margin, moods[index].margin);
        }
        const report = { preset: presetId, pool, lang, ranking: order, rows, cost: costOf({ tally: job.tally, seconds: (now() - startedAt) / 1000 }), budget: budget() };
        return { structured: report, text: compareSummary(lang, report, texts) };
      } catch (error) {
        throw failure(error, signal);
      } finally {
        job.end();
      }
    },
  };

  return [checkText, compareTexts];
}

/** A finished wave as a progress message, in the words of scripts/check.js. */
const waveLine = (wave) => `wave ${wave.index + 1}: ${wave.size} people, mood ${wave.mood.toFixed(2)} → ${wave.travels ? 'travels further' : 'stops here'}`;

function commonInputs() {
  return {
    preset: { type: 'string', enum: PRESET_IDS, default: 'post', description: 'post: a social feed (default); listing: classifieds, returns buyers\' first questions; product: an ad that leads to a store page, needs prices; headline: a list of headlines.' },
    prices: { type: 'array', minItems: 2, maxItems: MAX_PRICES, uniqueItems: true, items: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1e7 }, description: `For preset product only, and required there: 2 to ${MAX_PRICES} different positive numbers. Everybody who stops is asked the highest of them they would pay.` },
    currency: { type: 'string', minLength: 1, maxLength: 4, default: '$', description: 'For product: the sign shown before the prices, up to 4 characters. Default $.' },
    pool: { type: 'string', enum: POOLS, description: "uk or en. By default, the town that speaks the text's language. compare_texts needs it when the texts are in different languages." },
    lang: { type: 'string', enum: LANGS, default: 'en', description: 'The language of the summary sentence and the group labels: en (default) or uk. Field names and ids stay English.' },
  };
}
