import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOg, OG_W, OG_H } from '../worker/og.js';
import { openingRequest, openingAnswers, checksFor } from '../public/shared/requests.js';
import { PRESETS, ASKS, lookOf, answersFor, LOOKS, CANT_TELL } from '../public/shared/presets.js';
import { persona } from '../public/shared/personas.js';
import { DICTIONARIES } from '../public/i18n.js';
import { toAsk, askTown, ASK_STAGE } from '../worker/town.js';

test('the link preview is a PNG of the right size', async () => {
  const reactions = Uint8Array.from({ length: 10_000 }, (_, id) => (id % 3 ? 0 : 1 + (id % 7)));
  const png = await renderOg({ presetId: 'post', reactions, counters: { reach: 3334, stopped: 1200, glad: 400, sorry: 30 } }, 'crowd.example');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, 16, 8);
  assert.deepEqual([view.getUint32(0), view.getUint32(4)], [OG_W, OG_H]);
});

test('the opening request scores the text and decides whether it may be listed', () => {
  const request = openingRequest('listing', 'text');
  assert.ok(request.questions['shopping:phone'] && request.questions['unlisted:hate']);
  const answers = { 'interest:cars': { score: 4 }, 'unlisted:hate': { noul: 0.1 }, 'unlisted:illegal': { noul: 0.9 } };
  assert.deepEqual(openingAnswers(answers), { scores: { 'interest:cars': 1 }, unlisted: ['illegal'], blocked: ['illegal'], checks: {} });
  // Between the two thresholds a text is read but stays out of the feed; an insult and keyboard mashing are asked about too.
  assert.ok(request.questions['unlisted:insult'] && request.questions['unlisted:gibberish']);
  assert.deepEqual(openingAnswers({ 'unlisted:insult': { noul: 0.84 }, 'unlisted:gibberish': { noul: 0.85 } }), { scores: {}, unlisted: ['insult', 'gibberish'], blocked: ['gibberish'], checks: {} });
});

test('every reaction has a look and words in both languages', () => {
  for (const [presetId, preset] of Object.entries(PRESETS)) {
    for (const reaction of Object.keys(preset.reactions)) {
      assert.ok(LOOKS[lookOf(presetId, reaction)], `${presetId}.${reaction} has no look`);
      for (const t of Object.values(DICTIONARIES)) assert.equal(t.reactions[reaction]?.length, 3, `${t.lang}: no words for ${reaction}`);
    }
    for (const t of Object.values(DICTIONARIES)) assert.ok(t.presets[presetId]?.name, `${t.lang}: no name for ${presetId}`);
  }
  for (const answer of Object.keys(PRESETS.listing.followUp.answers)) assert.ok(DICTIONARIES.uk.answers[answer], `uk: no words for the buyer's question ${answer}`);
});

test('every closing answer and text check has words in both languages', () => {
  for (const t of Object.values(DICTIONARIES)) {
    for (const [question, { presets }] of Object.entries(ASKS)) {
      for (const presetId of presets) {
        for (const look of Object.keys(LOOKS)) {
          for (const id of Object.keys(answersFor(question, presetId, look))) {
            if (id !== CANT_TELL) assert.ok(t.said.labels[question][id], `${t.lang}: no words for ${question}.${id}`);
          }
        }
      }
    }
    for (const presetId of Object.keys(PRESETS)) {
      for (const [id] of checksFor(presetId)) {
        const label = t.checks.labels[id];
        assert.ok(typeof label === 'string' ? label : label[presetId], `${t.lang}: no words for the check ${id} of a ${presetId}`);
      }
    }
    for (const [key, sentences] of Object.entries(t.verdict.asked)) {
      assert.equal(typeof sentences.one('x'), 'string', `${t.lang}: ${key}.one`);
      assert.equal(typeof sentences.equal('x, y'), 'string', `${t.lang}: ${key}.equal`);
      assert.equal(typeof sentences.none, 'string', `${t.lang}: ${key}.none`);
    }
    assert.equal(t.and(['a']), 'a');
    assert.match(t.and(['a', 'b', 'c']), /^a, b \S+ c$/);
    // What the page already showed keeps its shape.
    for (const key of ['label', 'everyone', 'why']) assert.equal(typeof t.verdict[key], 'string', `${t.lang}: verdict.${key}`);
    for (const key of ['stopped', 'reached', 'balance']) assert.equal(typeof t.verdict[key], 'function', `${t.lang}: verdict.${key}`);
  }
});

// -- asking the town at the last close (worker/town.js), against a small stand-in for D1

const LONG_POST = 'Tomatoes need warm nights. '.repeat(8);
const VERSION = { post: 'p1', number: 1, preset: 'post', pool: 'uk', text: LONG_POST };
const KEYS = Object.keys(PRESETS.post.reactions);
const range = (from, count) => Array.from({ length: count }, (_, i) => from + i);
// Twenty who scrolled past and twenty who liked it: why, hook and comment are asked.
const REACTIONS = Uint8Array.from({ length: 10_000 }, (_, id) => (id < 20 ? 1 + KEYS.indexOf('scrolled_past') : id < 40 ? 1 + KEYS.indexOf('liked') : 0));
const PLAN = { gathered: { scrolled: range(0, 20), sorry: [], glad: range(20, 20), stopped: range(20, 20) } };
const part = (list) => ({ lists: { [list]: { asked: 20, totals: { cant_tell: 2 } } }, picks: {} });
const STORED = [['y', 'scrolled'], ['h', 'hook'], ['c', 'comment']].map(([stage, list]) => ({ stage, result: JSON.stringify(part(list)) }));

/** D1 as far as town.js uses it, answering by the start of the SQL; every statement run is kept. */
function fakeD1({ stored = [], locked = true, down = false } = {}) {
  const ran = [];
  const statement = (sql) => ({
    sql,
    bind(...args) {
      this.args = args;
      return this;
    },
    async all() {
      ran.push(this);
      if (down) throw new Error('D1 is down');
      return { results: sql.startsWith('SELECT stage') ? stored : [] };
    },
    async run() {
      ran.push(this);
      return { meta: { changes: sql.startsWith('UPDATE versions') && !locked ? 0 : 1 } };
    },
  });
  return { ran, prepare: statement, batch: async (statements) => ran.push(...statements) };
}

/** A town with a fake Jev: every person gets the first answer offered, and a tenth goes to the drain. Jev refuses the `failing` question. */
function townWith(t, db, { spent = false, failing = null } = {}) {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    const { questions } = JSON.parse(init.body);
    // A 400 is not retried (jev.js), so the test does not wait out a backoff.
    if (failing && Object.values(questions)[0].instructions.endsWith(ASKS[failing].ask)) return new Response('{}', { status: 400 });
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, { probabilities: { [Object.keys(question.criteria)[0]]: 0.9, [CANT_TELL]: 0.1 } }]));
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 1000 } }), { status: 200 });
  });
  const town = { db, provider: { label: 'Jev', url: 'https://jev.test/', apiKey: 'test', usd: () => 0.001 }, peopleOf: async (ids) => ids.map((id) => persona('uk', id)), isSpent: async () => spent };
  return { fetch, ask: () => askTown(town, VERSION, PLAN, REACTIONS, KEYS) };
}

test('a close reuses what an earlier close stored, skips on a spent budget and asks the rest', () => {
  assert.deepEqual(toAsk(['why', 'hook', 'comment'], { hook: part('hook') }, false), { reuse: { hook: part('hook') }, ask: ['why', 'comment'], skipped: [] });
  assert.deepEqual(toAsk(['why', 'hook'], { hook: part('hook') }, true), { reuse: { hook: part('hook') }, ask: [], skipped: ['why'] });
});

test('the last close asks the town once, holding the asking, and stores every answer', async (t) => {
  const db = fakeD1();
  const town = townWith(t, db);
  const { said } = await town.ask();
  assert.equal(town.fetch.mock.callCount(), 3);
  assert.deepEqual(Object.keys(said.lists), ['scrolled', 'hook', 'comment']);
  assert.deepEqual(said.missing, {});
  assert.equal(said.lists.hook.asked, 20);
  const [select, lock, ...stored] = db.ran;
  assert.match(select.sql, /^SELECT stage, result FROM batches/);
  assert.match(lock.sql, /json_set\(plan, '\$\.asking', \?\)/);
  assert.deepEqual(stored.map((statement) => statement.args[2]).sort(), Object.values(ASK_STAGE).sort());
  assert.ok(stored.every((statement) => /ON CONFLICT .+ DO UPDATE SET usd = usd \+ excluded\.usd/.test(statement.sql)));
});

test('a close with every answer stored sends nothing', async (t) => {
  const town = townWith(t, fakeD1({ stored: STORED }));
  const { said } = await town.ask();
  assert.equal(town.fetch.mock.callCount(), 0);
  assert.deepEqual(said.lists.comment, part('comment').lists.comment);
});

test('a close that does not win the asking waits for the one that did', async (t) => {
  const db = fakeD1({ locked: false });
  const town = townWith(t, db);
  assert.deepEqual(await town.ask(), { busy: true });
  assert.equal(town.fetch.mock.callCount(), 0);
});

test('a spent budget leaves out what was not stored yet', async (t) => {
  const town = townWith(t, fakeD1({ stored: STORED.slice(1) }), { spent: true });
  const { said } = await town.ask();
  assert.equal(town.fetch.mock.callCount(), 0);
  assert.deepEqual(said.missing, { scrolled: 'budget' });
  assert.deepEqual(Object.keys(said.lists), ['hook', 'comment']);
});

test('when D1 fails, the check still closes with the lists marked failed', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const town = townWith(t, fakeD1({ down: true }));
  const { said } = await town.ask();
  assert.deepEqual(said, { lists: {}, picks: {}, missing: { scrolled: 'failed', hook: 'failed', comment: 'failed' } });
  assert.equal(town.fetch.mock.callCount(), 0);
  assert.equal(logged.mock.callCount(), 1);
});

test('a question Jev fails leaves out its own lists and keeps what the others paid for', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const db = fakeD1();
  const town = townWith(t, db, { failing: 'hook' });
  const { said } = await town.ask();
  assert.deepEqual(said.missing, { hook: 'failed' });
  assert.deepEqual(Object.keys(said.lists), ['scrolled', 'comment']);
  const stored = db.ran.filter((statement) => statement.sql.startsWith('INSERT INTO batches'));
  assert.deepEqual(stored.map((statement) => statement.args[2]).sort(), ['c', 'y']);
  assert.equal(logged.mock.callCount(), 1);
  assert.deepEqual(logged.mock.calls[0].arguments.slice(0, 2), ['ask', 'hook']);
});
