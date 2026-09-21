import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  assert.deepEqual((await client.send('[{"jsonrpc":"2.0","id":90,"method":"ping"}]', undefined)).error.code, -32600);
  const broken = await client.send('{"jsonrpc":"2.0", "id": 91', undefined);
  assert.deepEqual([broken.error.code, 'id' in broken], [-32700, false]);
  assert.equal((await client.send({ jsonrpc: '2.0', id: null, method: 'tools/list' }, undefined)).error.code, -32600);

  const before = client.messages.length;
  client.notify('notifications/initialized');
  client.notify('notifications/cancelled', { requestId: 12345 });
  client.notify('notifications/whatever');
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

  const direct = await runCheck({ send: createFakeJev().send, presetId: 'post', pool: 'uk', text: 'tomatoes', versionId: 'mcp', maxWaves: 3, opening: true });
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
  assert.deepEqual([report.status, report.blocked, report.reach, report.waves, report.groups], ['blocked', ['insult'], 0, [], null]);
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
  assert.equal(client.fake.calls, 2 * (1 + 6));
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
  assert.match(textOf(refused), new RegExp(`could cost up to \\$${(52 * WORST_USD_PER_REQUEST).toFixed(2)} \\(52 requests to Jev\\).+\\$0\\.05 left of its \\$0\\.05 for today.+Nothing was sent`));
  assert.equal(tight.fake.calls, 0);
  assert.equal((await tight.call('check_text', { text: 'tomatoes', waves: 1 })).result.isError, false);
  assert.equal(tight.fake.calls, 7);

  const byTokens = structured(await connect({ fake: createFakeJev({ usd: 0, tokens: 1000 }) }).call('check_text', { text: 'meh', waves: 1 }));
  assert.equal(byTokens.cost.usd, Number((7 * 1000 * TYPESAFE_USD_PER_TOKEN).toFixed(6)));

  let now = NOON;
  const silent = connect({ fake: createFakeJev({ usd: 0, tokens: 0 }), budgetUsd: 0.03, now: () => now });
  const first = structured(await silent.call('check_text', { text: 'meh', waves: 1 }));
  assert.equal(first.cost.usd, Number((7 * WORST_USD_PER_REQUEST).toFixed(6)));
  assert.deepEqual(first.budget, { day: '2026-09-22', spentUsd: 0.0175, limitUsd: 0.03 });
  const second = await silent.call('check_text', { text: 'tea', waves: 1 });
  assert.match(textOf(second), /\$0\.01 left of its \$0\.03/);
  now += 24 * 3600 * 1000;
  const nextDay = structured(await silent.call('check_text', { text: 'tea', waves: 1 }));
  assert.deepEqual(nextDay.budget, { day: '2026-09-23', spentUsd: 0.0175, limitUsd: 0.03 });
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
  const fake = createFakeJev({ delay: 20, onSend: () => fake.calls === 1 && setImmediate(() => client.notify('notifications/cancelled', { requestId: id, reason: 'test' })) });
  client = connect({ fake });
  id = client.newId();
  const cancelled = client.call('check_text', { text: 'coffee' }, { id });
  await tick();
  const refused = await client.call('check_text', { text: 'meh', waves: 1 });
  assert.match(textOf(refused), /^Another check is running/);
  await until(() => fake.inFlight === 0);
  await tick();
  assert.ok(!client.messages.some((message) => message.id === id));
  assert.ok(fake.calls < 10, `sent ${fake.calls}`);
  const after = await client.call('check_text', { text: 'meh', waves: 1 });
  assert.equal(after.result.isError, false);
  assert.equal(await Promise.race([cancelled.then(() => 'answered'), tick().then(() => 'silent')]), 'silent');
});

test('progress only grows, and only for a client that asked for it', async () => {
  const client = connect();
  await client.call('check_text', { text: 'coffee', waves: 2 }, { progressToken: 'p1' });
  const notes = client.messages.filter((message) => message.method === 'notifications/progress');
  assert.equal(notes.length, 1 + 6 + 15);
  assert.ok(notes.every((note) => note.params.progressToken === 'p1' && note.params.total === 22 && note.params.progress <= 22));
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
  assert.equal(report.verdict, 'It got past the third wave; the next one would not have finished within 45 s, so the check stopped there.');
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
  assert.match(textOf(again), /Cost: 7 requests to Jev \(7 from this server's memory\), \$0\.0000/);

  const twice = connect();
  const report = structured(await twice.call('compare_texts', { texts: ['coffee', 'coffee'] }));
  assert.equal(twice.fake.calls, 7);
  assert.deepEqual([report.cost.requests, report.cost.cached], [14, 7]);
});

test('no key is a tool error that says where the key goes', async () => {
  const client = connect({ fake: { send: (request) => ask(null, request) } });
  for (const attempt of [1, 2]) {
    const answer = await client.call('check_text', { text: 'coffee' });
    assert.equal(answer.result.isError, true, `attempt ${attempt}`);
    assert.equal(textOf(answer), `No Jev key. Set TYPESAFE_API_KEY or OPENROUTER_API_KEY in this server's environment, or put one into ${ENV_FILE}.`);
  }
});

test('the engine reports what the MCP server needs, and old callers see no change', async () => {
  assert.equal(expectedTone('post', { liked: 0.5, blocked: 0.2, read: 0.3 }), 0.3);
  assert.equal(expectedTone('post', { liked: CONFIDENT_FROM - 0.01, blocked: 0.3, read: 0.3 }), 0);
  assert.equal(expectedTone('post', {}), 0);

  const fake = createFakeJev();
  const plain = await runCheck({ send: fake.send, presetId: 'post', pool: 'en', text: 'glad 0.4', versionId: 'v1', maxWaves: 2 });
  assert.ok(!('unlisted' in plain) && !('blocked' in plain));
  assert.equal(kindOf(fake.requests[0]), 'opening');
  assert.ok(!Object.keys(fake.requests[0].questions).some((id) => id.startsWith('unlisted:')));
  assert.deepEqual(plain.waves.map((wave) => [wave.asked, wave.size]), [[600, 600], [1500, 1500]]);
  assert.ok(Math.abs(plain.waves[0].expectedMood - 0.4) < 1e-9);

  const seen = [];
  const stoppedEarly = await runCheck({ send: fake.send, presetId: 'post', pool: 'en', text: 'glad 0.4', versionId: 'v1', mayGoOn: (wave) => (seen.push(wave.index), false) });
  assert.deepEqual([stoppedEarly.waves.length, seen], [1, [0]]);
});

test('over stdio, stdout carries MCP messages and nothing else', async () => {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.OPENROUTER_API_KEY;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.js', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
  assert.match(stderr, /^Jevtown MCP server · /);
});
