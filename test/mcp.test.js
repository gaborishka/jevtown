import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, LEGACY } from '../mcp/protocol.js';
import { createTools, INSTRUCTIONS, WORST_USD_PER_REQUEST } from '../mcp/tools.js';
import { runCheck, AT_ONCE } from '../public/shared/check.js';
import { counters } from '../public/shared/summary.js';
import { expectedTone, CONFIDENT_FROM } from '../public/shared/draw.js';
import { ask, TYPESAFE_USD_PER_TOKEN } from '../public/shared/jev.js';
import { DICTIONARIES } from '../public/i18n.js';
import { createFakeJev, kindOf } from './fake-jev.js';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const NOON = Date.UTC(2026, 8, 22, 12);
const ENV_FILE = '/somewhere/jevtown/.env.local';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const until = async (condition) => {
  while (!condition()) await tick();
};

/** A server with the fake behind it, and a client that waits for answers by id. */
function connect({ fake = createFakeJev(), now = () => NOON, ...options } = {}) {
  const messages = [];
  const waiting = new Map();
  let nextId = 1;
  const server = createServer({
    info: { name: 'jevtown', title: 'Jevtown', version: '0.0.0' },
    instructions: INSTRUCTIONS,
    tools: createTools({ send: fake.send, now, envFile: ENV_FILE, ...options }),
    write: (message) => {
      messages.push(message);
      const id = Array.isArray(message) ? 'batch' : message.id;
      waiting.get(id)?.(message);
      waiting.delete(id);
    },
  });
  const send = (line, id) => new Promise((resolve) => {
    waiting.set(id, resolve);
    server.receive(typeof line === 'string' ? line : JSON.stringify(line));
  });
  const request = (method, params, id = nextId++) => send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, id);
  const call = (name, args, { meta = META, progressToken, id = nextId++ } = {}) => request('tools/call', { name, arguments: args, _meta: { ...meta, ...(progressToken ? { progressToken } : {}) } }, id);
  const legacyCall = (name, args) => request('tools/call', { name, arguments: args });
  const notify = (method, params) => server.receive(JSON.stringify({ jsonrpc: '2.0', method, params }));
  return { server, fake, messages, request, send, call, legacyCall, notify, newId: () => nextId++ };
}

/** The checks the tests need of JSON Schema: type, required, properties, items, enum. */
function conforms(value, schema, path = '$') {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const types = [].concat(schema.type ?? []);
  if (types.length && !types.some((type) => type === kind || (type === 'number' && kind === 'integer'))) return `${path} is ${kind}, not ${types.join(' or ')}`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} is ${value}, not one of ${schema.enum.join(', ')}`;
  if (kind === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is missing`;
    for (const [key, inner] of Object.entries(schema.properties ?? {})) {
      const problem = key in value && conforms(value[key], inner, `${path}.${key}`);
      if (problem) return problem;
    }
  }
  if (kind === 'array' && schema.items) {
    for (const [index, item] of value.entries()) {
      const problem = conforms(item, schema.items, `${path}[${index}]`);
      if (problem) return problem;
    }
  }
  return null;
}

const toolsOf = async (client) => (await client.request('tools/list', { _meta: META })).result.tools;
const structured = (answer) => answer.result.structuredContent;
const textOf = (answer) => answer.result.content[0].text;

test('legacy clients get the tools, with the fields their revision knows', async () => {
  for (const version of LEGACY) {
    const client = connect();
    const opened = await client.request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(opened.result.protocolVersion, version);
    assert.deepEqual(opened.result.capabilities, { tools: {} });
    assert.equal(opened.result.instructions, INSTRUCTIONS);
    client.notify('notifications/initialized');
    const { tools } = (await client.request('tools/list')).result;
    assert.deepEqual(tools.map((tool) => tool.name), ['check_text', 'compare_texts']);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal('outputSchema' in tool, version >= '2025-06-18', `${version} outputSchema`);
      assert.equal('title' in tool, version >= '2025-06-18', `${version} title`);
      assert.equal('annotations' in tool, version >= '2025-03-26', `${version} annotations`);
    }
    assert.equal(opened.result.serverInfo.title === undefined, version < '2025-06-18');
    assert.deepEqual((await client.request('ping')).result, {});
  }
  const old = connect();
  assert.equal((await old.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} })).result.protocolVersion, '2025-11-25');
  for (const method of ['toString', 'isPrototypeOf', '__proto__']) assert.equal((await old.request(method)).error.code, -32601, method);
  const answer = await old.legacyCall('check_text', { text: 'meh', waves: 1 });
  assert.equal(answer.result.isError, false);
  assert.ok(answer.result.structuredContent && !('resultType' in answer.result));

  const oldest = connect();
  await oldest.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
  const plain = await oldest.legacyCall('check_text', { text: 'meh', waves: 1 });
  assert.equal(plain.result.isError, false);
  assert.ok(!('structuredContent' in plain.result));
  assert.equal(JSON.parse(plain.result.content[1].text).status, 'stopped');
});

test('modern clients need no handshake, and bad requests get the right errors', async () => {
  const client = connect();
  const found = (await client.request('server/discover', { _meta: META })).result;
  assert.deepEqual(found.supportedVersions, ['2026-07-28']);
  assert.equal(found.resultType, 'complete');
  assert.equal(found._meta['io.modelcontextprotocol/serverInfo'].name, 'jevtown');
  assert.equal(found.instructions, INSTRUCTIONS);
  assert.ok(found.ttlMs >= 0 && found.cacheScope === 'public');
  const listed = (await client.request('tools/list', { _meta: META })).result;
  assert.ok(listed.resultType === 'complete' && listed.ttlMs >= 0 && listed.cacheScope === 'public');
  assert.ok(listed.tools.every((tool) => tool.title && tool.outputSchema && tool.annotations.readOnlyHint === false));

  for (const requested of ['1900-01-01', '2025-11-25']) {
    const refused = await client.request('tools/list', { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': requested } });
    assert.deepEqual(refused.error.data, { supported: ['2026-07-28'], requested });
    assert.equal(refused.error.code, -32022);
  }
  const code = async (method, params) => (await client.request(method, params)).error?.code;
  assert.equal(await code('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }), -32602);
  assert.equal(await code('tools/list'), -32602); // no _meta, and no initialize before it
  assert.equal(await code('tools/call', { name: 'check_text', arguments: [], _meta: META }), -32602);
  assert.equal(await code('tools/call', { name: 'rewrite_text', arguments: {}, _meta: META }), -32602);
  assert.equal(await code('resources/list', { _meta: META }), -32601);
  assert.equal(await code('ping', { _meta: META }), -32601); // 2026-07-28 has no ping
  for (const method of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) assert.equal(await code(method, { _meta: META }), -32601, method);
  assert.deepEqual((await client.send('[{"jsonrpc":"2.0","id":90,"method":"ping"}]', undefined)).error.code, -32600);
  const broken = await client.send('{"jsonrpc":"2.0", "id": 91', undefined);
  assert.deepEqual([broken.error.code, 'id' in broken], [-32700, false]);
  assert.equal((await client.send({ jsonrpc: '2.0', id: null, method: 'tools/list' }, undefined)).error.code, -32600);
  // A message with neither a method nor a result is no request and no response, and it gets an answer rather than silence.
  const noMethod = await client.send('{"jsonrpc":"2.0","id":14}', 14);
  assert.deepEqual([noMethod.id, noMethod.error.code], [14, -32600]);
  for (const line of ['{"jsonrpc":"2.0"}', '{"jsonrpc":"2.0","method":1}']) {
    const answer = await client.send(line, undefined);
    assert.deepEqual([answer.error.code, 'id' in answer], [-32600, false], line);
  }

  const before = client.messages.length;
  client.notify('notifications/initialized');
  client.notify('notifications/cancelled', { requestId: 12345 });
  client.notify('notifications/whatever');
  client.server.receive('{"jsonrpc":"2.0","id":15,"result":{}}'); // a response: this server asked nothing
  await tick();
  assert.equal(client.messages.length, before);
});

test('under 2025-03-26 a batch gets one array of answers', async () => {
  const client = connect();
  await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
  const answers = await client.send([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'tools/list' }], 'batch');
  assert.deepEqual(answers.map((answer) => answer.id), ['a', 'b']);
  assert.deepEqual(answers[0].result, {});
  assert.equal(answers[1].result.tools.length, 2);
});

test('check_text returns what the post page would, in the shape it declares', async () => {
  const client = connect();
  const schema = (await toolsOf(client)).find((tool) => tool.name === 'check_text').outputSchema;
  const answer = await client.call('check_text', { text: 'tomatoes', pool: 'uk' });
  const report = structured(answer);
  assert.equal(answer.result.isError, false);
  assert.equal(conforms(report, schema), null);
  assert.deepEqual(JSON.parse(answer.result.content[1].text), report);
  assert.equal(report.cost.requests, client.fake.calls);
  assert.equal(report.cost.cached, 0);

  const direct = await runCheck({ send: createFakeJev().send, presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'mcp', maxWaves: 3, blocking: true });
  assert.deepEqual(report.counters, counters('post', direct.keys, direct.reactions));
  assert.equal(report.waves.length, direct.waves.length);
  assert.equal(report.status, 'stopped');
  assert.equal(report.stoppedAt, direct.waves.length - 1);
  assert.equal(report.verdict, DICTIONARIES.en.verdict.stopped(report.stoppedAt));
  assert.match(textOf(answer), /residents saw it\. Glad: /);
  assert.deepEqual([report.waves[0].people, report.waves[0].answered], [600, 600]);
  assert.ok(report.waves[0].margin > 0 && !('margin' in report.waves[1]));
  assert.deepEqual(report.shownTo[0], { group: 'interest:gardening', label: 'into gardening', score: 1 });
  const top = report.groups.stopped.top[0];
  assert.deepEqual([top.group, top.label], ['interest:gardening', 'into gardening']);
  assert.ok(top.lift > 1.3 && report.groups.stopped.standsOut);
  assert.equal(report.groups.sorry, null);
  assert.deepEqual([report.questions, report.demand, report.unlisted, report.blocked], [null, null, [], []]);
  // What the people asked at the end said, and Jev's reading of the text, as the post page shows them.
  assert.deepEqual(report.said.lists.map((list) => list.list), ['scrolled', 'hook', 'comment']);
  const scrolled = report.said.lists[0];
  assert.deepEqual([scrolled.question, scrolled.lead, scrolled.answers[0].text, scrolled.wrongAudience], ['why', { kind: 'one', ids: ['not_for_them'] }, 'not for them', 0.67]);
  assert.ok(!scrolled.answers.some((answer) => answer.id === 'cant_tell') && Math.abs(scrolled.drain - 0.1) < 0.01);
  assert.match(textOf(answer), /\nThe reason given most often for scrolling past: not for them\.\n/);
  assert.deepEqual(report.checks.map((check) => [check.id, check.reading]), [['ask', 'no'], ['concrete', 'no']]);
  assert.match(textOf(answer), /\nHow Jev reads the text: clear what readers should do: no; has a concrete number, name or example: no\.\n/);

  const inUkrainian = structured(await client.call('check_text', { text: 'tomatoes', pool: 'uk', lang: 'uk' }));
  assert.equal(inUkrainian.groups.stopped.top[0].label, 'цікавляться: садівництво');
  assert.equal(inUkrainian.verdict, DICTIONARIES.uk.verdict.stopped(report.stoppedAt));
});

test('a listing returns buyers\' questions, a product the price that earns the most', async () => {
  const client = connect();
  const listing = structured(await client.call('check_text', { text: 'coffee grinder', preset: 'listing', waves: 1 }));
  assert.equal(listing.questions[0].id, 'negotiable');
  assert.equal(listing.questions[0].text, 'Is the price negotiable?');
  assert.equal(listing.demand, null);

  const product = await client.call('check_text', { text: 'coffee beans', preset: 'product', prices: [24, 9, 15], currency: '€', waves: 1 });
  const { demand } = structured(product);
  assert.deepEqual(demand.prices.map((step) => step.price), [9, 15, 24]);
  assert.equal(demand.best.price, 15);
  assert.match(textOf(product), /€15 earns the most/);

  const sent = client.fake.calls;
  for (const prices of [undefined, [9, 9], ['x', 5], [1, 2, 3, 4, 5, 6, 7], [0, 5]]) {
    const refused = await client.call('check_text', { text: 'coffee beans', preset: 'product', ...(prices ? { prices } : {}) });
    assert.equal(refused.result.isError, true);
    assert.match(textOf(refused), /A product needs 2 to 6 different prices/);
  }
  assert.match(textOf(await client.call('check_text', { text: 'coffee', prices: [9, 15] })), /prices apply to preset product only/);
  assert.equal(client.fake.calls, sent);
});

test('bad arguments are refused before anything is sent', async () => {
  const client = connect();
  const refusal = async (name, args) => {
    const answer = await client.call(name, args);
    assert.equal(answer.result.isError, true, JSON.stringify(args));
    return textOf(answer);
  };
  assert.match(await refusal('check_text', { text: '   ' }), /The text must be 1 to 2000 characters/);
  assert.match(await refusal('check_text', {}), /The text must be 1 to 2000 characters/);
  assert.match(await refusal('check_text', { text: 'x'.repeat(2001) }), /The text must be 1 to 2000 characters/);
  // Names every object inherits are no presets; the server refuses them and stays free for the next call.
  assert.match(await refusal('check_text', { text: 'coffee', preset: 'toString', waves: 1 }), /Unknown preset "toString"/);
  assert.match(await refusal('compare_texts', { texts: ['coffee', 'tea'], preset: 'constructor' }), /Unknown preset "constructor"/);
  assert.match(await refusal('check_text', { text: 'coffee', preset: 'tweet' }), /Unknown preset "tweet": use post, listing, product or headline/);
  assert.match(await refusal('check_text', { text: 'coffee', waves: 5 }), /waves must be a whole number from 1 to 4/);
  assert.match(await refusal('check_text', { text: 'coffee', waves: 2.5 }), /waves must be a whole number/);
  assert.match(await refusal('check_text', { text: 'coffee', lang: 'de' }), /lang must be en or uk/);
  assert.match(await refusal('check_text', { text: 'coffee', pool: 'de' }), /pool must be uk or en/);
  assert.equal(await refusal('check_text', { text: 'coffee', variants: 2 }), 'Unknown argument "variants". check_text takes: text, preset, prices, currency, pool, waves, lang.');
  assert.match(await refusal('compare_texts', { texts: ['coffee'] }), /compare_texts takes 2 to 5 texts/);
  assert.match(await refusal('compare_texts', { texts: Array(6).fill('coffee') }), /compare_texts takes 2 to 5 texts/);
  assert.match(await refusal('compare_texts', { texts: ['coffee', ''] }), /Text 2 must be 1 to 2000 characters/);
  assert.match(await refusal('compare_texts', { texts: ['coffee', 'tea'], waves: 2 }), /Unknown argument "waves"/);
  assert.match(await refusal('compare_texts', { texts: ['Кава зранку', 'Coffee in the morning'] }), /different languages.+pool: "uk" or "en"/);
  assert.equal(client.fake.calls, 0);
});

test('the site\'s moderation comes at no extra request', async () => {
  const client = connect();
  const answer = await client.call('check_text', { text: 'insult' });
  const report = structured(answer);
  assert.deepEqual([report.status, report.blocked, report.reach, report.waves, report.groups, report.said, report.mostAnnoyed], ['blocked', ['insult'], 0, [], null, null, null]);
  assert.equal(client.fake.calls, 1);
  assert.equal(report.verdict, 'The site would not post this text: insults. The town did not read it.');

  const rude = structured(await client.call('check_text', { text: 'rude coffee', waves: 1 }));
  assert.deepEqual([rude.unlisted, rude.blocked, rude.waves.length], [['insult'], [], 1]);
  assert.notEqual(rude.status, 'blocked');
  const inUkrainian = await client.call('check_text', { text: 'rude coffee', waves: 1, lang: 'uk' });
  assert.match(textOf(inUkrainian), /На сайті він не потрапив би до спільної стрічки: образи\./);
});

test('compare_texts ranks the variants by the town\'s rule', async () => {
  const client = connect();
  const schema = (await toolsOf(client)).find((tool) => tool.name === 'compare_texts').outputSchema;
  const answer = await client.call('compare_texts', { texts: ['meh', 'tomatoes'], pool: 'uk' });
  const report = structured(answer);
  assert.equal(conforms(report, schema), null);
  assert.deepEqual(JSON.parse(answer.result.content[1].text), report);
  assert.deepEqual(report.ranking, [1, 0]);
  assert.deepEqual(report.rows.map((row) => [row.status, row.travels]), [['stops', false], ['travels', true]]);
  // The opening request and six batches each, then the closing questions: why alone for meh, which nobody
  // stopped at, and why, hook and comment for tomatoes.
  assert.equal(client.fake.calls, 2 * (1 + 6) + 1 + 3);
  assert.deepEqual(report.rows[1].mainReason, { kind: 'one', ids: ['not_for_them'], texts: ['not for them'] });
  assert.match(textOf(answer), /\n2\. "tomatoes": travels on, mood \+0\.\d\d \(±0\.\d\d\), main reason for scrolling past: not for them\n/);
  assert.equal(report.rows[1].shownTo.length, 3);
  assert.match(textOf(answer), /^Variant 2 ranks first: glad minus sorry in its first wave is \+0\.\d\d on average, and it travels on\./);

  const close = structured(await connect().call('compare_texts', { texts: ['glad 0.30', 'glad 0.32'] }));
  assert.deepEqual(close.ranking, [1, 0]);
  assert.equal(close.rows[0].closeToBest, true);
  assert.ok(close.rows[0].margin > 0.02);
  const apart = await connect().call('compare_texts', { texts: ['glad 0.30', 'glad 0.60'], lang: 'uk' });
  assert.deepEqual(structured(apart).rows.map((row) => row.closeToBest), [false, false]);
  assert.match(textOf(apart), /^Першим іде варіант 2: настрій першої хвилі в середньому \+0\.60, і текст іде далі\./);
});

test('failed batches do not count as a weak text', async () => {
  let failures = 0;
  const failing = createFakeJev({ fail: (request) => kindOf(request) === 'wave' && failures++ < 5 });
  const answer = await connect({ fake: failing }).call('check_text', { text: 'coffee' });
  const report = structured(answer);
  assert.deepEqual([report.status, report.verdict, report.waves.length], ['incomplete', null, 1]);
  assert.deepEqual([report.waves[0].people, report.waves[0].answered, report.cost.failedBatches], [600, 100, 5]);
  assert.match(textOf(answer), /^Jev answered for only 100 of 600 people in the first wave, so this check says nothing about the text\./);
  assert.match(textOf(answer), /Requests that failed: 5; their people count as not shown\./);

  // An incomplete listing does not pay for the buyers' question: the check says nothing about the text anyway.
  let listingFailures = 0;
  const failingListing = createFakeJev({ fail: (request) => kindOf(request) === 'wave' && listingFailures++ < 5 });
  const listing = structured(await connect({ fake: failingListing }).call('check_text', { text: 'coffee grinder', preset: 'listing', waves: 1 }));
  assert.deepEqual([listing.status, listing.questions], ['incomplete', null]);
  assert.ok(!failingListing.requests.some((request) => kindOf(request) === 'follow-up'));

  let coffeeFailures = 0;
  const partly = createFakeJev({ fail: (request) => kindOf(request) === 'wave' && request.state.post === 'coffee' && coffeeFailures++ < 5 });
  const compared = structured(await connect({ fake: partly }).call('compare_texts', { texts: ['coffee', 'meh'] }));
  assert.equal(compared.rows[0].status, 'incomplete');
  assert.match(compared.rows[0].error, /100 of 600/);
  assert.deepEqual(compared.ranking, [1]);
});

test('the budget refuses before sending and counts what was answered', async () => {
  const tight = connect({ budgetUsd: 0.05 });
  const refused = await tight.call('check_text', { text: 'tomatoes' });
  assert.equal(refused.result.isError, true);
  // Three waves, and why, hook and comment at the end.
  assert.match(textOf(refused), new RegExp(`could cost up to \\$${(55 * WORST_USD_PER_REQUEST).toFixed(2)} \\(55 requests to Jev\\).+\\$0\\.05 left of its \\$0\\.05 for today.+Nothing was sent`));
  assert.equal(tight.fake.calls, 0);
  assert.equal((await tight.call('check_text', { text: 'tomatoes', waves: 1 })).result.isError, false);
  assert.equal(tight.fake.calls, 10);

  const byTokens = structured(await connect({ fake: createFakeJev({ usd: 0, tokens: 1000 }) }).call('check_text', { text: 'meh', waves: 1 }));
  // Nobody stopped at meh: of the closing questions, only why is asked.
  assert.equal(byTokens.cost.usd, Number((8 * 1000 * TYPESAFE_USD_PER_TOKEN).toFixed(6)));

  let now = NOON;
  const silent = connect({ fake: createFakeJev({ usd: 0, tokens: 0 }), budgetUsd: 0.03, now: () => now });
  const first = structured(await silent.call('check_text', { text: 'meh', waves: 1 }));
  assert.equal(first.cost.usd, Number((8 * WORST_USD_PER_REQUEST).toFixed(6)));
  assert.deepEqual(first.budget, { day: '2026-09-22', spentUsd: 0.02, limitUsd: 0.03 });
  const second = await silent.call('check_text', { text: 'tea', waves: 1 });
  assert.match(textOf(second), /\$0\.01 left of its \$0\.03/);
  now += 24 * 3600 * 1000;
  const nextDay = structured(await silent.call('check_text', { text: 'tea', waves: 1 }));
  assert.deepEqual(nextDay.budget, { day: '2026-09-23', spentUsd: 0.02, limitUsd: 0.03 });
});

test('one call at a time, and at most AT_ONCE requests in flight', async () => {
  const client = connect({ fake: createFakeJev({ delay: 5 }) });
  const running = client.call('check_text', { text: 'coffee', waves: 1 });
  const refused = await client.call('check_text', { text: 'meh', waves: 1 });
  assert.equal(refused.result.isError, true);
  assert.match(textOf(refused), /^Another check is running on this server/);
  assert.equal((await running).result.isError, false);
  assert.ok(client.fake.requests.every((request) => request.state.post !== 'meh'));

  const compare = await client.call('compare_texts', { texts: ['glad 0.1', 'glad 0.2', 'glad 0.3', 'glad 0.4', 'glad 0.5'] });
  assert.equal(structured(compare).ranking.length, 5);
  assert.equal(client.fake.mostInFlight, AT_ONCE);
});

test('a cancelled call stops asking Jev, gets no answer, and holds the server until its requests are back', async () => {
  let client;
  let id;
  let allowance;
  // The opening and the first wave (calls 1 to 7) answer at once. The second wave sends 8 at a time: call 8
  // answers soon, 9 to 15 slowly, and the cancel comes once all 8 are out. runCheck gives up when call 8 is
  // back, while 9 to 15 are still on their way.
  const fake = createFakeJev({
    delay: (request, call) => (call <= 7 ? 0 : call === 8 ? 5 : 100),
    onSend: (request, retries) => {
      allowance ??= retries;
      if (fake.calls === 15) setImmediate(() => client.notify('notifications/cancelled', { requestId: id, reason: 'test' }));
    },
  });
  client = connect({ fake });
  id = client.newId();
  const cancelled = client.call('check_text', { text: 'coffee' }, { id });
  await until(() => fake.calls === 15 && fake.inFlight === 7);
  await tick();
  const refused = await client.call('check_text', { text: 'meh', waves: 1 });
  assert.match(textOf(refused), /^Another check is running/);
  assert.ok(fake.inFlight > 0);
  assert.equal(allowance.left, 0, 'the requests on their way retry nothing');
  await until(() => fake.inFlight === 0);
  await tick();
  assert.equal(fake.calls, 15);
  assert.ok(!client.messages.some((message) => message.id === id));
  const after = await client.call('check_text', { text: 'meh', waves: 1 });
  assert.equal(after.result.isError, false);
  // What Jev answered for the cancelled call is paid, so the day's spending counts it: every call at $0.001.
  assert.equal(structured(after).budget.spentUsd, Number((fake.calls * 0.001).toFixed(4)));
  assert.equal(await Promise.race([cancelled.then(() => 'answered'), tick().then(() => 'silent')]), 'silent');
});

test('progress only grows, and only for a client that asked for it', async () => {
  const client = connect();
  await client.call('check_text', { text: 'coffee', waves: 2 }, { progressToken: 'p1' });
  const notes = client.messages.filter((message) => message.method === 'notifications/progress');
  assert.equal(notes.length, 1 + 6 + 15 + 3);
  assert.ok(notes.every((note) => note.params.progressToken === 'p1' && note.params.total === 25 && note.params.progress <= 25));
  assert.ok(notes.every((note, index) => index === 0 || note.params.progress > notes[index - 1].params.progress));
  assert.ok(notes.some((note) => /^wave 1: 600 people, mood 0\.\d\d → travels further$/.test(note.params.message)));

  const quiet = connect();
  await quiet.call('check_text', { text: 'coffee', waves: 1 });
  assert.ok(!quiet.messages.some((message) => message.method === 'notifications/progress'));
});

test('the time limit stops before the wave that would not fit', async () => {
  let now = NOON;
  const fake = createFakeJev({ onSend: () => (now += 500) }); // half a second a request, whatever runs alongside
  const answer = await connect({ fake, now: () => now, maxSeconds: 45 }).call('check_text', { text: 'coffee', waves: 4 });
  const report = structured(answer);
  assert.deepEqual([report.waves.length, report.status, report.stoppedAt], [3, 'cut_by_time', null]);
  assert.equal(report.verdict, 'It got past the third wave; with the next one the check would not have finished within 45 s, so it stopped there.');

  // A listing's buyers get their question after the last wave, and the limit leaves room for it.
  let clock = NOON;
  const listing = createFakeJev({ onSend: () => (clock += 400) });
  const asked = structured(await connect({ fake: listing, now: () => clock, maxSeconds: 45 }).call('check_text', { text: 'coffee grinder', preset: 'listing', waves: 4 }));
  assert.deepEqual([asked.waves.length, asked.status], [3, 'cut_by_time']);
  assert.ok(asked.questions.length && asked.cost.seconds <= 45, `${asked.cost.seconds} s`);

  // After a comparison the first wave comes from memory, at no time, and the pace is still Jev's own.
  let later = NOON;
  const warm = connect({ fake: createFakeJev({ onSend: () => (later += 500) }), now: () => later, maxSeconds: 45 });
  await warm.call('compare_texts', { texts: ['coffee', 'meh'] });
  const followed = structured(await warm.call('check_text', { text: 'coffee', waves: 4 }));
  // The first wave and the closing questions: those go to the first 100 of each group in pick order, all of them from the first wave.
  assert.deepEqual([followed.waves.length, followed.status, followed.cost.cached], [3, 'cut_by_time', 10]);
  assert.ok(followed.cost.seconds <= 45, `${followed.cost.seconds} s`);
  const unlimited = structured(await connect({ fake: createFakeJev(), maxSeconds: 0 }).call('check_text', { text: 'coffee', waves: 4 }));
  assert.deepEqual([unlimited.waves.length, unlimited.status, unlimited.reach], [4, 'everyone', 10000]);
  const short = structured(await connect().call('check_text', { text: 'coffee', waves: 2 }));
  assert.deepEqual([short.status, short.verdict], ['cut_by_waves', 'It got past the second wave; this check was set to stop there.']);
});

test('a repeated request is answered from memory', async () => {
  const client = connect();
  const first = structured(await client.call('check_text', { text: 'tomatoes', waves: 1 }));
  const sent = client.fake.calls;
  const again = await client.call('check_text', { text: 'tomatoes', waves: 1 });
  assert.equal(client.fake.calls, sent);
  assert.equal(structured(again).cost.cached, structured(again).cost.requests);
  assert.deepEqual(structured(again).counters, first.counters);
  assert.match(textOf(again), /Cost: 10 requests to Jev \(10 from this server's memory\), \$0\.0000/);

  const twice = connect();
  const report = structured(await twice.call('compare_texts', { texts: ['coffee', 'coffee'] }));
  assert.equal(twice.fake.calls, 10);
  assert.deepEqual([report.cost.requests, report.cost.cached], [20, 10]);

  // A failure is not kept: the batch that failed goes to Jev again, and only that one.
  let failed = false;
  const flaky = connect({ fake: createFakeJev({ fail: (request) => kindOf(request) === 'wave' && !failed && (failed = true) }) });
  assert.equal(structured(await flaky.call('check_text', { text: 'tomatoes', waves: 1 })).cost.failedBatches, 1);
  const before = flaky.fake.requests.length;
  const retried = structured(await flaky.call('check_text', { text: 'tomatoes', waves: 1 }));
  const resent = flaky.fake.requests.slice(before);
  assert.deepEqual([resent.filter((request) => kindOf(request) === 'wave').length, retried.cost.failedBatches], [1, 0]);
  // The closing questions go to the first people of each group, who now include the failed batch's: those are new requests.
  assert.equal(retried.cost.requests - retried.cost.cached, resent.length);
  assert.ok(resent.every((request) => ['wave', 'closing'].includes(kindOf(request))));
});

test('no key is a tool error that says where the key goes', async () => {
  const client = connect({ fake: { send: (request) => ask(null, request) } });
  for (const attempt of [1, 2]) {
    const answer = await client.call('check_text', { text: 'coffee' });
    assert.equal(answer.result.isError, true, `attempt ${attempt}`);
    assert.equal(textOf(answer), `No Jev key. Set TYPESAFE_API_KEY or OPENROUTER_API_KEY in this server's environment, or put one into ${ENV_FILE}.`);
  }
});

test('the engine reports what the MCP server needs, and its other callers see no change', async () => {
  assert.equal(expectedTone('post', { liked: 0.5, blocked: 0.2, read: 0.3 }), 0.3);
  assert.equal(expectedTone('post', { liked: CONFIDENT_FROM - 0.01, blocked: 0.3, read: 0.3 }), 0);
  assert.equal(expectedTone('post', {}), 0);

  const fake = createFakeJev();
  const plain = await runCheck({ send: fake.send, presetId: 'post', pool: 'en', text: 'glad 0.4', versionId: 'v1', maxWaves: 2 });
  assert.equal(kindOf(fake.requests[0]), 'opening');
  assert.deepEqual(plain.waves.map((wave) => [wave.asked, wave.size]), [[600, 600], [1500, 1500]]);
  assert.ok(Math.abs(plain.waves[0].expectedMood - 0.4) < 1e-9);

  // Without blocking, a text the site would refuse is still read, as npm run check reports it; with it, nobody reads it.
  const reported = await runCheck({ send: fake.send, presetId: 'post', pool: 'en', text: 'insult', versionId: 'v1', maxWaves: 1 });
  assert.deepEqual([reported.blocked, reported.waves.length], [['insult'], 1]);
  const refused = await runCheck({ send: createFakeJev().send, presetId: 'post', pool: 'en', text: 'insult', versionId: 'v1', blocking: true });
  assert.deepEqual([refused.blocked, refused.waves.length, refused.requests, refused.said.lists], [['insult'], 0, 1, {}]);

  const seen = [];
  const stoppedEarly = await runCheck({ send: fake.send, presetId: 'post', pool: 'en', text: 'glad 0.4', versionId: 'v1', mayGoOn: (wave) => (seen.push(wave.index), false) });
  assert.deepEqual([stoppedEarly.waves.length, seen], [1, [0]]);

  const listing = createFakeJev();
  const noQuestion = await runCheck({ send: listing.send, presetId: 'listing', pool: 'en', text: 'coffee grinder', versionId: 'v1', maxWaves: 1, mayFollowUp: (waves) => (seen.push(waves.length), false) });
  assert.deepEqual([noQuestion.followUp, seen.at(-1)], [null, 1]);
  assert.ok(!listing.requests.some((request) => kindOf(request) === 'follow-up'));

  const quiet = createFakeJev();
  const nobodyAsked = await runCheck({ send: quiet.send, presetId: 'post', pool: 'en', text: 'tomatoes', versionId: 'v1', maxWaves: 1, mayAsk: (waves) => (seen.push(waves.length), false) });
  assert.deepEqual([nobodyAsked.said.lists, seen.at(-1)], [{}, 1]);
  assert.ok(!quiet.requests.some((request) => kindOf(request) === 'closing'));
});

test('over stdio, stdout carries MCP messages and nothing else', async (t) => {
  // The server reads .env.local next to package.json. It runs from a copy that has none, so no key of this
  // checkout is loaded and no setting in the file changes what the server prints; the settings and keys of
  // the environment are left out too.
  const copy = mkdtempSync(join(tmpdir(), 'jevtown-mcp-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const path of ['mcp', 'public', 'package.json']) cpSync(new URL(`../${path}`, import.meta.url), join(copy, path), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(TYPESAFE_API_KEY|OPENROUTER_API_KEY|JEV_PROVIDER|JEVTOWN_MCP_.*)$/.test(name)));
  const child = spawn(process.execPath, [join(copy, 'mcp', 'server.js')], { cwd: copy, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((message) => `${JSON.stringify(message)}\n`).join(''));
  const code = await new Promise((resolve) => child.on('close', resolve));
  const lines = stdout.trimEnd().split('\n');
  assert.equal(code, 0);
  assert.equal(lines.length, 2);
  const [opened, listed] = lines.map((line) => JSON.parse(line));
  assert.deepEqual([opened.jsonrpc, opened.id, opened.result.protocolVersion], ['2.0', 1, '2025-11-25']);
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['check_text', 'compare_texts']);
  assert.equal(stderr, 'Jevtown MCP server · no Jev key · $1.00 a day · 45 s\n');
});
