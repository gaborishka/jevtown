// The whole back end, as one Cloudflare Worker on the free plan. A free invocation may make 50
// outgoing requests and use 10 ms of CPU, so no single request can run a check. Instead the browser
// drives it: POST /api/check asks Jev whom the text is for and plans the first wave, /api/batch
// asks Jev about 100 people of the current wave, /api/wave closes the wave and decides whether the
// text travels further. Every reaction on a page comes from rows this Worker wrote itself; the
// browser only sets the pace.
import { persona, poolFor, CROWD } from '../public/shared/personas.js';
import { unpackCrowd } from '../public/shared/pack.js';
import { PRESETS, priceLadder } from '../public/shared/presets.js';
import { reactionRequest, followUpRequest, openingRequest, openingAnswers, questionId, MAX_TEXT_CHARS, UNLISTED, UNLISTED_FROM } from '../public/shared/requests.js';
import { firstWave, nextWave, mood, travels, WAVES } from '../public/shared/feed.js';
import { drawReaction, drawAnswer } from '../public/shared/draw.js';
import { counters } from '../public/shared/summary.js';
import { ask, pickProvider, PROVIDERS } from '../public/shared/jev.js';
import { rng, hash32 } from '../public/shared/rng.js';
import { POOLS } from '../public/shared/vocab.js';
import { DICTIONARIES } from '../public/i18n.js';
import { cleanProfile, publicProfile, residentPersona, tenant, lightTenant, quizRequest, profileRequest, earlierWords, topicsOf, likeliest, QUIZ_REACTIONS, TUNE_CARDS, TEST_CARDS, RESIDENT_WEIGHT } from '../public/shared/resident.js';
import { CARD } from '../public/shared/quiz.js';
import { renderOg } from './og.js';
import packedUk from './crowd-uk.bin';
import packedEn from './crowd-en.bin';

const PER_REQUEST = 100;
const RETRIES_PER_BATCH = 3;
const ENOUGH_BATCHES = 0.7; // a wave closes when this share of its batches is answered; the rest stay "not shown"
const SNIPPET = 280;
const FEED_POSTS = 30;
const PERSONA_HISTORY = 12;
const MAX_PRICES = 6;
const YEAR_S = 365 * 24 * 3600;
const STALE_RUN_MS = 10 * 60 * 1000; // a check nobody drives any more does not block a new version
const RETRIES_PER_QUIZ = 6;
const MOVES_PER_DAY = 3; // residents one address may move in a day
const MAX_RESIDENTS = 2000; // per crowd: every resident is asked about every post that travels far // a test round is eight requests to Jev at once; they share these retries

const PACKED = { uk: packedUk, en: packedEn };
const crowds = {};
/** What the feed algorithm reads of every persona; unpacked once per isolate. */
const lightCrowd = (pool) => (crowds[pool] ??= unpackCrowd(new Uint8Array(PACKED[pool])));

/** How many people live in a town now: the 10,000 and every house a visitor ever moved somebody into. */
const townSize = async (env, pool) => CROWD + ((await env.DB.prepare('SELECT MAX(number) + 1 AS houses FROM residents WHERE pool = ?').bind(pool).first('houses')) ?? 0);

/** The people the feed algorithm picks from: the 10,000 and whoever lived in town when the text was posted. */
async function townOf(env, pool, size) {
  const light = lightCrowd(pool);
  if (size <= CROWD) return light;
  const { results } = await env.DB.prepare('SELECT number, profile FROM residents WHERE pool = ? AND number < ? ORDER BY number').bind(pool, size - CROWD).all();
  return light.concat(results.map((row) => (row.profile ? residentPersona(pool, row.number, JSON.parse(row.profile)) : lightTenant(pool, row.number, light))));
}

/** A stage is asked in requests of about 100 personas; a resident's question is as long as four of theirs. → [[from, to], …] over `ids`. */
function batchesOf(ids) {
  const cuts = [];
  let from = 0;
  let weight = 0;
  ids.forEach((id, at) => {
    const next = id < CROWD ? 1 : RESIDENT_WEIGHT;
    if (weight + next > PER_REQUEST) {
      cuts.push([from, at]);
      from = at;
      weight = 0;
    }
    weight += next;
  });
  if (ids.length > from) cuts.push([from, ids.length]);
  return cuts;
}

const today = () => new Date().toISOString().slice(0, 10);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const refuse = (code, message, status = 400, more = {}) => json({ error: { code, message, ...more } }, status);
const bytesOf = (blob) => (blob ? (blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob)) : new Uint8Array(0));
/** A byte per person of a town of `size`; what is stored may be shorter, from the days the town was smaller. */
function crowdBytes(blob, size = CROWD) {
  const stored = bytesOf(blob);
  if (stored.length >= size) return stored;
  const bytes = new Uint8Array(size);
  bytes.set(stored);
  return bytes;
}

const settings = (env) => ({
  dailyLimit: Number(env.CROWD_DAILY_LIMIT ?? 0),
  dailyBudget: Number(env.CROWD_DAILY_BUDGET_USD ?? 0),
  maxWaves: Math.min(WAVES.length, Math.max(1, Number(env.CROWD_MAX_WAVES ?? WAVES.length))),
});

async function sha(text, bytes = 8) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).subarray(0, bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const visitorId = (request) => sha(`${request.headers.get('CF-Connecting-IP') ?? 'local'}|${today()}`);
const randomId = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, bytes * 2);

/** The author is whoever holds the secret cookie; the database keeps its hash. */
const authorSecret = (request) => /(?:^|;\s*)crowd_author=([a-z0-9]{24,64})/.exec(request.headers.get('Cookie') ?? '')?.[1];
const authorOf = async (request) => {
  const secret = authorSecret(request);
  return secret ? sha(`author|${secret}`, 12) : null;
};
const authorCookie = (secret, url) => ({ 'Set-Cookie': `crowd_author=${secret}; Path=/; Max-Age=${YEAR_S}; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}` });
const foreign = (request, url) => request.headers.get('Origin') && request.headers.get('Origin') !== url.origin;

const spentToday = (env) => env.DB.prepare('SELECT COALESCE(SUM(usd), 0) AS usd FROM batches WHERE day = ?').bind(today()).first('usd');

const stageName = (current) => (current.kind === 'wave' ? `w${current.index}` : 'f');
const batchCount = (current) => batchesOf(current.ids).length;
const stageAnswer = (current, done = []) => ({ kind: current.kind, index: current.index, stage: stageName(current), people: current.ids.length, batches: batchCount(current), done });

const readVersion = async (env, post, number) => {
  const row = await env.DB.prepare('SELECT v.*, p.preset, p.pool, p.author, p.listed FROM versions v JOIN posts p ON p.id = v.post WHERE v.post = ? AND v.number = ?').bind(post, number).first();
  return row && { ...row, plan: JSON.parse(row.plan), options: JSON.parse(row.options), summary: row.summary && JSON.parse(row.summary) };
};

// POST /api/check { preset, text, prices, currency, nickname, listed, post, pool? } → the first wave to run.
// The crowd that reads a text is the one that speaks its language; `pool` is for callers that know better.
async function handleCheck(request, env, url) {
  if (foreign(request, url)) return refuse('origin', 'wrong origin', 403);
  const body = await request.json().catch(() => null);
  const preset = PRESETS[body?.preset];
  const text = String(body?.text ?? '').trim();
  if (!preset || (body.pool != null && !POOLS[body.pool])) return refuse('bad_request', 'unknown preset or crowd');
  if (!text || text.length > MAX_TEXT_CHARS) return refuse('bad_text', `the text must be 1 to ${MAX_TEXT_CHARS} characters`);
  const provider = pickProvider(env);
  if (!provider) return refuse('no_key', `neither ${Object.values(PROVIDERS).map((known) => known.keyName).join(' nor ')} is set`, 500);

  const options = {};
  if (body.preset === 'product') {
    const prices = [...new Set((Array.isArray(body.prices) ? body.prices : []).map(Number).filter((price) => price > 0 && price < 1e7))].sort((a, b) => a - b).slice(0, MAX_PRICES);
    if (prices.length < 2) return refuse('bad_prices', 'a product needs at least two prices');
    options.prices = prices;
    options.currency = String(body.currency ?? '$').slice(0, 4);
  }

  const { dailyLimit, dailyBudget } = settings(env);
  if (dailyBudget && (await spentToday(env)) >= dailyBudget) return refuse('limit', 'daily budget is used up', 429);
  const visitor = await visitorId(request);
  if (dailyLimit) {
    const checks = await env.DB.prepare("SELECT COUNT(*) AS checks FROM checks WHERE visitor = ? AND day = ? AND post NOT LIKE '~%'").bind(visitor, today()).first('checks');
    if (checks >= dailyLimit) return refuse('limit', 'daily limit reached', 429);
  }

  let secret = authorSecret(request);
  const isNewAuthor = !secret;
  if (!secret) secret = randomId(16);
  const author = await sha(`author|${secret}`, 12);

  // A new version of an existing post: only by its author, with the same preset; the crowd stays the same.
  let post = null;
  if (body.post) {
    post = await env.DB.prepare('SELECT id, author, preset, pool, created_at, (SELECT MAX(number) FROM versions WHERE post = posts.id) AS versions FROM posts WHERE id = ?').bind(String(body.post)).first();
    if (!post || post.author !== author) return refuse('not_yours', 'only the author can add a version', 403);
    if (post.preset !== body.preset) return refuse('bad_request', 'a version keeps the preset of its post');
    const running = await env.DB.prepare("SELECT COUNT(*) AS running FROM versions WHERE post = ? AND state = 'running' AND created_at > ?").bind(post.id, new Date(Date.now() - STALE_RUN_MS).toISOString()).first('running');
    if (running) return refuse('busy', 'the previous version is still running', 409);
  }

  const pool = post?.pool ?? body.pool ?? poolFor(text);
  const opening = await ask(provider, openingRequest(body.preset, text), { left: RETRIES_PER_BATCH });
  const { scores, unlisted, blocked } = openingAnswers(opening.answers);
  if (blocked.length) {
    // Nothing of the text is kept. The question to Jev was paid for and the attempt counts towards the day's limit.
    const attempt = randomId(5);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, 0, ?, 0, NULL, ?, ?, ?)').bind(attempt, 's', opening.usd, opening.tokens, today()),
      env.DB.prepare('INSERT INTO checks (visitor, day, post, created_at) VALUES (?, ?, ?, ?)').bind(visitor, today(), attempt, new Date().toISOString()),
    ]);
    return refuse('blocked', `not posted: ${blocked.join(', ')}`, 422, { reasons: blocked });
  }
  const id = post?.id ?? randomId(5);
  const number = (post?.versions ?? 0) + 1;
  const now = new Date().toISOString();
  const size = await townSize(env, pool);
  const ids = firstWave(await townOf(env, pool, size), scores, body.preset, rng(hash32('waves', id, number))).map((who) => who.id);
  const current = { kind: 'wave', index: 0, ids };
  const listed = body.listed !== false && !unlisted.length ? 1 : 0;
  const nickname = String(body.nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, 32) || 'anonymous';

  await env.DB.batch([
    post
      ? env.DB.prepare('UPDATE posts SET listed = MIN(listed, ?), nickname = ? WHERE id = ?').bind(listed, nickname, id)
      : env.DB.prepare('INSERT INTO posts (id, author, nickname, preset, pool, listed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, author, nickname, body.preset, pool, listed, now),
    env.DB.prepare('INSERT INTO versions (post, number, text, options, state, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, number, text, JSON.stringify(options), 'running', JSON.stringify({ scores, unlisted, waves: [], current, size }), now),
    env.DB.prepare('INSERT INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, ?, ?, 0, NULL, ?, ?, ?)').bind(id, number, 's', opening.usd, opening.tokens, today()),
    env.DB.prepare('INSERT INTO checks (visitor, day, post, created_at) VALUES (?, ?, ?, ?)').bind(visitor, today(), id, now),
  ]);
  const cookie = isNewAuthor ? authorCookie(secret, url) : {};
  return json({ post: id, number, pool, size, scores, unlisted, stage: stageAnswer(current) }, 200, cookie);
}

/**
 * The people of a batch as Jev is asked about them. A resident comes with the reactions it was tuned
 * on, the ones nearest to what the post is about.
 */
async function peopleOf(env, version, ids) {
  const numbers = ids.filter((id) => id >= CROWD).map((id) => id - CROWD);
  const moved = new Map();
  if (numbers.length) {
    const marks = (items) => items.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(`SELECT number, author, profile FROM residents WHERE pool = ? AND profile IS NOT NULL AND number IN (${marks(numbers)})`).bind(version.pool, ...numbers).all();
    const tuned = version.preset === 'post' && results.length
      ? (await env.DB.prepare(`SELECT author, card, human FROM resident_answers WHERE author IN (${marks(results)}) ORDER BY rowid`).bind(...results.map((row) => row.author)).all()).results
      : [];
    const topics = topicsOf(version.plan.scores);
    for (const row of results) {
      const who = residentPersona(version.pool, row.number, JSON.parse(row.profile));
      who.earlier = earlierWords(tuned.filter((answer) => answer.author === row.author), { topics }, version.pool);
      moved.set(who.id, who);
    }
  }
  return ids.map((id) => moved.get(id) ?? (id < CROWD ? persona(version.pool, id) : tenant(version.pool, id - CROWD)));
}

// GET /api/batch?post=&v=&stage=&n= → the reactions of up to 100 people, drawn and stored.
async function handleBatch(env, url) {
  const [post, number, stage, n] = [url.searchParams.get('post'), Number(url.searchParams.get('v')), url.searchParams.get('stage'), Number(url.searchParams.get('n'))];
  const version = post && (await readVersion(env, post, number));
  const current = version?.plan.current;
  // Only batches of a wave planned here are asked: nobody can spend the key on people of their own choosing.
  if (!current || version.state !== 'running' || stageName(current) !== stage || !(n >= 0 && n < batchCount(current))) return refuse('no_stage', 'this batch is not part of the running stage', 409);

  const ids = current.ids.slice(...batchesOf(current.ids)[n]);
  const keys = Object.keys(PRESETS[version.preset].reactions);
  const stored = await env.DB.prepare('SELECT result FROM batches WHERE post = ? AND number = ? AND stage = ? AND n = ?').bind(post, number, stage, n).first();
  if (stored) return json(current.kind === 'wave' ? { ids, reactions: [...bytesOf(stored.result)], reused: true } : { ...JSON.parse(new TextDecoder().decode(bytesOf(stored.result))), reused: true });

  const provider = pickProvider(env);
  const people = await peopleOf(env, version, ids);
  const isWave = current.kind === 'wave';
  const ladder = version.options.prices ? priceLadder(version.options.prices, version.options.currency) : undefined;
  let answer;
  try {
    answer = await ask(provider, isWave ? reactionRequest(version.preset, version.text, people) : followUpRequest(version.preset, version.text, people, ladder), { left: RETRIES_PER_BATCH });
  } catch (error) {
    return refuse(error.throttled ? 'throttled' : 'jev', error.message, error.throttled ? 429 : 502);
  }

  let result;
  let body;
  if (isWave) {
    result = Uint8Array.from(people, (who) => 1 + keys.indexOf(drawReaction(answer.answers[questionId(who)]?.probabilities ?? {}, version.pool, who.id, `${post}.${number}`)));
    body = { ids, reactions: [...result] };
  } else {
    const answerKeys = Object.keys(ladder ?? PRESETS[version.preset].followUp.answers);
    const totals = {};
    const picks = [];
    for (const who of people) {
      const probabilities = answer.answers[questionId(who)]?.probabilities ?? {};
      for (const [id, value] of Object.entries(probabilities)) totals[id] = (totals[id] ?? 0) + value;
      picks.push(1 + answerKeys.indexOf(drawAnswer(probabilities, version.pool, who.id, `${post}.${number}`)));
    }
    body = { asked: people.length, totals, picks };
    result = new TextEncoder().encode(JSON.stringify(body));
  }
  await env.DB.prepare('INSERT OR IGNORE INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(post, number, stage, n, result, answer.usd, answer.tokens, today()).run();
  return json({ ...body, usd: answer.usd, tokens: answer.tokens, ms: answer.ms });
}

// GET /api/wave?post=&v= → closes the running stage; answers with the next one, or with the finished version.
async function handleWave(env, url) {
  const [post, number] = [url.searchParams.get('post'), Number(url.searchParams.get('v'))];
  const version = post && (await readVersion(env, post, number));
  if (!version) return refuse('not_found', 'no such version', 404);
  if (version.state === 'done') return json({ done: true, version: publicVersion(version) });

  const { plan } = version;
  const current = plan.current;
  const preset = PRESETS[version.preset];
  const keys = Object.keys(preset.reactions);
  const { results } = await env.DB.prepare('SELECT n, result FROM batches WHERE post = ? AND number = ? AND stage = ?').bind(post, number, stageName(current)).all();
  if (results.length < batchCount(current) * ENOUGH_BATCHES) return refuse('incomplete', `${results.length} of ${batchCount(current)} batches are answered`, 409);

  const size = plan.size ?? CROWD;
  const reactions = crowdBytes(version.reactions, size);
  const waves = crowdBytes(version.waves, size);
  const answers = crowdBytes(version.answers, size);
  const cuts = batchesOf(current.ids);
  let next = null;
  if (current.kind === 'wave') {
    const drawn = [];
    for (const row of results) {
      const ids = current.ids.slice(...cuts[row.n]);
      bytesOf(row.result).forEach((byte, i) => {
        reactions[ids[i]] = byte;
        waves[ids[i]] = current.index + 1;
        drawn.push(keys[byte - 1]);
      });
    }
    const wave = { index: current.index, size: drawn.length, mood: mood(version.preset, drawn), travels: travels(version.preset, drawn) };
    plan.waves.push(wave);
    const { maxWaves, dailyBudget } = settings(env);
    const mayGoOn = wave.travels && current.index + 1 < maxWaves && !(dailyBudget && (await spentToday(env)) >= dailyBudget);
    if (mayGoOn) {
      const reached = new Map();
      reactions.forEach((byte, id) => byte && reached.set(id, keys[byte - 1]));
      const ids = nextWave(await townOf(env, version.pool, size), reached, plan.scores, version.preset, current.index + 1, rng(hash32('waves', post, number, current.index + 1))).map((who) => who.id);
      if (ids.length) next = { kind: 'wave', index: current.index + 1, ids };
    }
    if (!next && preset.followUp) {
      const ids = [];
      reactions.forEach((byte, id) => byte && preset.reactions[keys[byte - 1]].stopped && ids.push(id));
      if (ids.length) next = { kind: 'followup', index: 0, ids };
    }
  } else {
    const followUp = { asked: 0, totals: {} };
    for (const row of results) {
      const batch = JSON.parse(new TextDecoder().decode(bytesOf(row.result)));
      followUp.asked += batch.asked;
      for (const [id, value] of Object.entries(batch.totals)) followUp.totals[id] = (followUp.totals[id] ?? 0) + value;
      const ids = current.ids.slice(...cuts[row.n]);
      batch.picks?.forEach((pick, i) => (answers[ids[i]] = pick));
    }
    plan.followUp = followUp;
  }

  plan.current = next;
  if (next) {
    await env.DB.prepare('UPDATE versions SET plan = ?, reactions = ?, waves = ? WHERE post = ? AND number = ?').bind(JSON.stringify(plan), reactions, waves, post, number).run();
    return json({ done: false, wave: plan.waves.at(-1), stage: stageAnswer(next) });
  }

  const cost = await env.DB.prepare('SELECT COALESCE(SUM(usd), 0) AS usd, COALESCE(SUM(tokens), 0) AS tokens, COUNT(*) AS requests FROM batches WHERE post = ? AND number = ?').bind(post, number).first();
  const now = new Date().toISOString();
  const totals = counters(version.preset, keys, reactions);
  const summary = { counters: totals, followUp: plan.followUp ?? null, usd: cost.usd, tokens: cost.tokens, requests: cost.requests, seconds: (Date.now() - new Date(version.created_at)) / 1000, finishedAt: now };
  await env.DB.batch([
    env.DB.prepare("UPDATE versions SET state = 'done', plan = ?, reactions = ?, waves = ?, answers = ?, summary = ? WHERE post = ? AND number = ?").bind(JSON.stringify(plan), reactions, waves, answers, JSON.stringify(summary), post, number),
    env.DB.prepare('UPDATE posts SET version = ?, snippet = ?, reach = ?, stopped = ?, glad = ?, sorry = ?, finished_at = ? WHERE id = ?').bind(number, version.text.replace(/\s+/g, ' ').slice(0, SNIPPET), totals.reach, totals.stopped, totals.glad, totals.sorry, now, post),
  ]);
  return json({ done: true, wave: plan.waves.at(-1), version: publicVersion({ ...version, state: 'done', plan, summary }) });
}

/** A version as the browser sees it: no persona ids of the running stage, those stay here. */
function publicVersion(version, done = []) {
  const { plan } = version;
  return {
    number: version.number, text: version.text, options: version.options, state: version.state, createdAt: version.created_at,
    scores: plan.scores, unlisted: plan.unlisted ?? [], waves: plan.waves, summary: version.summary ?? null,
    stage: version.state === 'running' && plan.current ? stageAnswer(plan.current, done) : null,
  };
}

// GET /api/post/<id> → the post with all its versions.
async function handlePost(request, env, id) {
  const post = await env.DB.prepare('SELECT id, author, nickname, preset, pool, listed, created_at FROM posts WHERE id = ?').bind(id).first();
  if (!post) return refuse('not_found', 'no such post', 404);
  const { results } = await env.DB.prepare('SELECT post, number, text, options, state, plan, summary, created_at FROM versions WHERE post = ? ORDER BY number').bind(id).all();
  const versions = [];
  for (const row of results) {
    const version = { ...row, plan: JSON.parse(row.plan), options: JSON.parse(row.options), summary: row.summary && JSON.parse(row.summary) };
    let done = [];
    if (version.state === 'running' && version.plan.current) {
      const answered = await env.DB.prepare('SELECT n FROM batches WHERE post = ? AND number = ? AND stage = ?').bind(id, row.number, stageName(version.plan.current)).all();
      done = answered.results.map((batch) => batch.n);
    }
    versions.push(publicVersion(version, done));
  }
  const { author, created_at: createdAt, ...rest } = post;
  return json({ ...rest, listed: Boolean(post.listed), createdAt, mine: author === (await authorOf(request)), versions });
}

// GET /api/reactions/<post>/<number> → three bytes a person, 30,000 and up: the reaction of every persona,
// then the wave that reached it, then its follow-up answer. A finished version never changes, so it is cached for good.
async function handleReactions(env, path) {
  const [post, number] = path.split('/');
  const row = await env.DB.prepare('SELECT state, reactions, waves, answers FROM versions WHERE post = ? AND number = ?').bind(post, Number(number)).first();
  if (!row) return new Response('not found', { status: 404 });
  const size = Math.max(CROWD, bytesOf(row.reactions).length); // the town as it was when the text was posted
  const body = new Uint8Array(size * 3);
  [row.reactions, row.waves, row.answers].forEach((blob, part) => body.set(bytesOf(blob), part * size));
  return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': row.state === 'done' ? 'public, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// GET /api/feed?sort=latest|top → one feed for everybody: a text is read by the crowd that speaks its language.
async function handleFeed(env, url) {
  const order = url.searchParams.get('sort') === 'top' ? 'reach DESC, glad DESC' : 'finished_at DESC';
  const { results } = await env.DB.prepare(
    `SELECT id, nickname, preset, pool, version, snippet, reach, stopped, glad, sorry, created_at AS createdAt, finished_at AS finishedAt,
       (SELECT COUNT(*) FROM versions WHERE post = posts.id) AS versions FROM posts
     WHERE listed = 1 AND version > 0 ORDER BY ${order} LIMIT ?`,
  ).bind(FEED_POSTS).all();
  const totals = await env.DB.prepare('SELECT COUNT(*) AS posts, COALESCE(SUM(reach), 0) AS reach FROM posts WHERE version > 0').first();
  return json({ posts: results, totals });
}

// GET /api/persona/<pool>/<id> → what this persona did with recent posts. One byte is read out of each stored crowd.
// A house a visitor moved somebody into shows what was done since its present tenant came.
async function handlePersona(env, path) {
  const [pool, idText] = path.split('/');
  const id = Number(idText);
  if (!POOLS[pool] || !(Number.isInteger(id) && id >= 0)) return refuse('not_found', 'no such persona', 404);
  let since = '';
  if (id >= CROWD) {
    const house = await env.DB.prepare('SELECT profile, created_at, updated_at FROM residents WHERE pool = ? AND number = ?').bind(pool, id - CROWD).first();
    if (!house) return refuse('not_found', 'no such persona', 404);
    since = house.profile ? house.created_at : house.updated_at;
  }
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.preset, p.nickname, p.snippet, p.version, p.finished_at AS finishedAt, v.options, hex(substr(v.reactions, ?1, 1)) AS byte, hex(substr(v.answers, ?1, 1)) AS answer
     FROM posts p JOIN versions v ON v.post = p.id AND v.number = p.version
     WHERE p.listed = 1 AND p.pool = ?2 AND p.version > 0 AND p.finished_at > ?3 ORDER BY p.finished_at DESC LIMIT 80`,
  ).bind(id + 1, pool, since).all();
  const history = [];
  for (const row of results) {
    const byte = parseInt(row.byte || '0', 16);
    if (!byte) continue;
    history.push({ post: row.id, preset: row.preset, nickname: row.nickname, snippet: row.snippet, finishedAt: row.finishedAt, options: JSON.parse(row.options), reaction: Object.keys(PRESETS[row.preset].reactions)[byte - 1], answer: parseInt(row.answer || '0', 16) });
    if (history.length >= PERSONA_HISTORY) break;
  }
  return json({ history, looked: results.length });
}

// GET /api/residents → { uk: [...], en: [...] }: what everybody may see of each house, in the order of
// moving in; null for a house somebody left. The browser builds the rest of the town itself.
async function handleResidents(env) {
  const { results } = await env.DB.prepare('SELECT pool, number, profile, created_at FROM residents ORDER BY pool, number').all();
  const towns = Object.fromEntries(Object.keys(POOLS).map((pool) => [pool, []]));
  for (const row of results) towns[row.pool][row.number] = row.profile ? { ...publicProfile(JSON.parse(row.profile)), since: row.created_at } : null;
  return json(towns);
}

// -- the resident a visitor moved in

/** Shown to everybody, so Jev reads it first: the same questions a post is asked, the ones a profile can fail. */
const PROFILE_QUESTIONS = Object.fromEntries(['hate', 'sexual', 'violence', 'private_data', 'insult'].map((id) => [id, UNLISTED[id]]));
const SHOWN = ['name', 'job', 'city', 'about'];

/** The resident of whoever holds the author cookie, with every answer it was tuned on, oldest first. */
async function readMe(env, author) {
  const row = author && (await env.DB.prepare('SELECT pool, number, profile, seed, created_at FROM residents WHERE author = ?').bind(author).first());
  if (!row) return { resident: null, answers: [] };
  const { results } = await env.DB.prepare('SELECT card, round, kind, human, jev, plain FROM resident_answers WHERE author = ? ORDER BY round, rowid').bind(author).all();
  return { resident: { ...JSON.parse(row.profile), pool: row.pool, id: CROWD + row.number, seed: row.seed, createdAt: row.created_at }, answers: results };
}

// POST /api/me { pool, name, gender, age, job, city, interests, temper, budget, about } → the resident, moved in or changed.
async function handleResident(request, env, url) {
  if (foreign(request, url)) return refuse('origin', 'wrong origin', 403);
  const body = await request.json().catch(() => null);
  const profile = cleanProfile(body);
  if (!profile) return refuse('bad_profile', 'a resident needs a name, an age and at least one interest');
  let secret = authorSecret(request);
  const isNewAuthor = !secret;
  if (!secret) secret = randomId(16);
  const author = await sha(`author|${secret}`, 12);
  const old = (await readMe(env, author)).resident;
  const pool = old?.pool ?? (POOLS[body.pool] ? body.pool : 'en');
  const visitor = await visitorId(request);
  const now = new Date().toISOString();

  if (!old) {
    if ((await townSize(env, pool)) - CROWD >= MAX_RESIDENTS) return refuse('full', 'the town takes no more residents', 429);
    const moves = settings(env).dailyLimit && (await env.DB.prepare("SELECT COUNT(*) AS moves FROM checks WHERE visitor = ? AND day = ? AND post LIKE '~%'").bind(visitor, today()).first('moves'));
    if (moves >= MOVES_PER_DAY) return refuse('limit', 'too many residents today', 429);
  }
  const provider = pickProvider(env);
  const spent = `~${author}.${randomId(3)}`; // what Jev cost counts towards the day's budget, under a name no post can have
  if (provider && (!old || SHOWN.some((key) => old[key] !== profile[key]))) {
    let read;
    try {
      read = await ask(provider, profileRequest(profile, PROFILE_QUESTIONS), { left: RETRIES_PER_BATCH });
    } catch (error) {
      return refuse(error.throttled ? 'throttled' : 'jev', error.message, error.throttled ? 429 : 502);
    }
    await env.DB.prepare('INSERT INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, 0, ?, 0, NULL, ?, ?, ?)').bind(spent, 'r', read.usd, read.tokens, today()).run();
    const reasons = Object.entries(read.answers).filter(([, answer]) => (answer.noul ?? 0) >= UNLISTED_FROM).map(([id]) => id);
    if (reasons.length) return refuse('blocked', `not moved in: ${reasons.join(', ')}`, 422, { reasons });
  }

  if (old) await env.DB.prepare('UPDATE residents SET profile = ?, updated_at = ? WHERE author = ?').bind(JSON.stringify(profile), now, author).run();
  else {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO residents (pool, number, author, profile, seed, created_at, updated_at) SELECT ?1, COALESCE(MAX(number) + 1, 0), ?2, ?3, ?4, ?5, ?5 FROM residents WHERE pool = ?1').bind(pool, author, JSON.stringify(profile), randomId(4), now),
      env.DB.prepare('INSERT INTO checks (visitor, day, post, created_at) VALUES (?, ?, ?, ?)').bind(visitor, today(), spent, now),
    ]);
  }
  return json(await readMe(env, author), 200, isNewAuthor ? authorCookie(secret, url) : {});
}

// POST /api/me/answers { kind: tune|test, lang, answers: [{ card, reaction }] } → the resident with the round added.
// A tuning round is only kept. In a test round Jev answers for the resident first, from the answers
// kept before this round, and then the visitor's answers are kept as well.
async function handleAnswers(request, env, url) {
  if (foreign(request, url)) return refuse('origin', 'wrong origin', 403);
  const body = await request.json().catch(() => null);
  const author = await authorOf(request);
  const me = await readMe(env, author);
  if (!me.resident) return refuse('no_resident', 'nobody has moved in yet', 404);
  const lang = body?.lang === 'uk' ? 'uk' : 'en';
  const isTest = body?.kind === 'test';
  if (!isTest && body?.kind !== 'tune') return refuse('bad_request', 'a round is tune or test');

  const answered = new Set(me.answers.map((answer) => answer.card));
  const given = [];
  for (const item of Array.isArray(body.answers) ? body.answers : []) {
    if (!CARD[item?.card] || !QUIZ_REACTIONS.includes(item.reaction) || answered.has(item.card)) continue;
    answered.add(item.card);
    given.push({ card: item.card, human: item.reaction, jev: null, plain: null });
  }
  given.splice(isTest ? TEST_CARDS : TUNE_CARDS);
  if (!given.length) return refuse('bad_request', 'no new answers');

  const round = 1 + Math.max(0, ...me.answers.map((answer) => answer.round));
  const rows = [];
  if (isTest) {
    const provider = pickProvider(env);
    if (!provider) return refuse('no_key', 'no Jev API key is set', 500);
    const { dailyBudget } = settings(env);
    if (dailyBudget && (await spentToday(env)) >= dailyBudget) return refuse('limit', 'daily budget is used up', 429);
    const retries = { left: RETRIES_PER_QUIZ };
    const spent = `~${author}.${randomId(3)}`;
    let said;
    try {
      said = await Promise.all(given.map((item) => ask(provider, quizRequest(me.resident, CARD[item.card], me.answers, lang), retries)));
    } catch (error) {
      return refuse(error.throttled ? 'throttled' : 'jev', error.message, error.throttled ? 429 : 502);
    }
    said.forEach((answer, n) => {
      given[n].plain = likeliest(answer.answers.plain);
      given[n].jev = likeliest(answer.answers.tuned) ?? given[n].plain; // a resident nobody tuned yet has the description alone
      rows.push(env.DB.prepare('INSERT INTO batches (post, number, stage, n, result, usd, tokens, day) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)').bind(spent, round, 'q', n, answer.usd, answer.tokens, today()));
    });
  }
  const now = new Date().toISOString();
  for (const item of given) rows.push(env.DB.prepare('INSERT INTO resident_answers (author, card, round, kind, human, jev, plain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(author, item.card, round, isTest ? 'test' : 'tune', item.human, item.jev, item.plain, now));
  await env.DB.batch(rows);
  return json(await readMe(env, author));
}

// POST /api/me/reset { resident? } → the answers are forgotten; with `resident` the resident moves out as well.
// The house stays: what was written there is wiped, and one of the 10,000 kinds of people lives in it from now on.
async function handleReset(request, env, url) {
  if (foreign(request, url)) return refuse('origin', 'wrong origin', 403);
  const body = await request.json().catch(() => null);
  const author = await authorOf(request);
  if (!author) return json({ resident: null, answers: [] });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM resident_answers WHERE author = ?').bind(author),
    ...(body?.resident ? [env.DB.prepare('UPDATE residents SET author = NULL, profile = NULL, updated_at = ? WHERE author = ?').bind(new Date().toISOString(), author)] : []),
  ]);
  return json(await readMe(env, author));
}

async function handleOg(request, env, ctx, name) {
  const hit = await caches.default.match(request);
  if (hit) return hit;
  const id = name.replace(/\.png$/, '');
  const row = await env.DB.prepare('SELECT p.preset, p.version, v.reactions, v.summary FROM posts p JOIN versions v ON v.post = p.id AND v.number = p.version WHERE p.id = ? AND p.version > 0').bind(id).first();
  if (!row) return new Response('not found', { status: 404 });
  const png = await renderOg({ presetId: row.preset, reactions: bytesOf(row.reactions), counters: JSON.parse(row.summary).counters }, new URL(request.url).host);
  const response = new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' } });
  ctx.waitUntil(caches.default.put(request, response.clone()));
  return response;
}

const escapeHtml = (value) => String(value).replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A link to a post pasted into a messenger should say what the crowd did, so the page head is filled in here. */
async function pageHead(request, env, url) {
  const id = url.pathname.startsWith('/p/') && url.pathname.slice(3);
  const post = id && (await env.DB.prepare('SELECT id, preset, pool, snippet, version, reach, stopped, glad, sorry FROM posts WHERE id = ? AND version > 0').bind(id).first());
  // A post is described in its own language, any other page in the visitor's.
  const t = DICTIONARIES[post ? post.pool : /^(uk|ru)/i.test(request.headers.get('Accept-Language') ?? '') ? 'uk' : 'en'];
  let title = `${t.brand} · ${t.title}`;
  let description = t.lead;
  let image = `${url.origin}/brand/og-default.png`;
  if (post) {
    title = `${post.snippet.slice(0, 90)}${post.snippet.length > 90 ? '…' : ''}`;
    description = t.headLine(post);
    image = `${url.origin}/og/${post.id}.png?v=${post.version}`;
  }
  return `<title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(t.brand)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />${
      image
        ? `
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${escapeHtml(t.brand + ' · ' + t.title)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />`
        : ''
    }`;
}

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-cache',
  // Cloudflare adds its Web Analytics script to pages of a zone that has it on: no cookies, page views and referrers only.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

async function servePage(request, env, url) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { headers: request.headers }));
  const html = await asset.text();
  // The interface opens in the visitor's language (app.js makes the same guess), and the page says so from the first byte.
  const visitorLang = /^(uk|ru)/i.test(request.headers.get('Accept-Language') ?? '') ? 'uk' : 'en';
  return new Response(html.replace('<html lang="uk">', `<html lang="${visitorLang}">`).replace('<!-- head -->', await pageHead(request, env, url)), { headers: PAGE_HEADERS });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      const posted = { '/api/check': handleCheck, '/api/me/answers': handleAnswers, '/api/me/reset': handleReset }[path] ?? (path === '/api/me' && request.method === 'POST' && handleResident);
      if (posted) return request.method === 'POST' ? await posted(request, env, url) : new Response(null, { status: 405 });
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      if (path === '/api/batch') return await handleBatch(env, url);
      if (path === '/api/wave') return await handleWave(env, url);
      if (path === '/api/feed') return await handleFeed(env, url);
      if (path === '/api/me') return json(await readMe(env, await authorOf(request)));
      if (path === '/api/residents') return await handleResidents(env);
      if (path.startsWith('/api/post/')) return await handlePost(request, env, path.slice('/api/post/'.length));
      if (path.startsWith('/api/reactions/')) return await handleReactions(env, path.slice('/api/reactions/'.length));
      if (path.startsWith('/api/persona/')) return await handlePersona(env, path.slice('/api/persona/'.length));
      if (path.startsWith('/og/')) return await handleOg(request, env, ctx, path.slice('/og/'.length));
      if (path === '/' || path === '/crowd' || path === '/me' || path.startsWith('/p/') || path.startsWith('/u/')) return await servePage(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return refuse('error', 'something went wrong', 500);
    }
  },
};
