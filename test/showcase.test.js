import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { counters } from '../public/shared/summary.js';
import { PRESETS } from '../public/shared/presets.js';
import { DICTIONARIES } from '../public/i18n.js';

const example = JSON.parse(await readFile(new URL('../public/examples/iphone.json', import.meta.url), 'utf8'));
const keys = Object.keys(PRESETS[example.preset].reactions);

test('the numbers of the example on the first screen are counted from its saved reactions', () => {
  assert.equal(example.versions.length, 2);
  for (const version of example.versions) {
    const reactions = new Uint8Array(Buffer.from(version.reactions, 'base64'));
    assert.equal(reactions.length, 10000);
    assert.deepEqual(counters(example.preset, keys, reactions), version.counters);
  }
});

test('what the example says in words holds for its numbers, in both languages', () => {
  const [careful, advance] = example.versions.map((version) => version.counters);
  assert.equal(careful.reach, 2100); // "went into a second wave": 600 + 1,500
  assert.equal(advance.reach, 600); // "never left the first wave"
  assert.ok(Math.abs(advance.byReaction.scam / advance.reach - 1 / 3) < 0.01); // "one persona in three"
  for (const { show } of Object.values(DICTIONARIES)) {
    assert.equal(show.variants.length, example.versions.length);
    assert.match(show.findings[0](careful)[0], new RegExp(`^${careful.byReaction.wrote} `));
    assert.match(show.findings[1](advance)[1], new RegExp(`${advance.byReaction.scam}\\D+${advance.reach}`));
  }
});
