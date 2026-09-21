import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crowd } from '../public/shared/personas.js';
import { packCrowd, unpackCrowd } from '../public/shared/pack.js';

test('the packed crowds the Worker ships are current and unpack to the same people', async () => {
  for (const pool of ['uk', 'en']) {
    const people = crowd(pool);
    const stored = new Uint8Array(await readFile(new URL(`../worker/crowd-${pool}.bin`, import.meta.url)));
    assert.deepEqual(stored, packCrowd(people), `worker/crowd-${pool}.bin is stale: run node scripts/build-crowd.js`);
    const light = unpackCrowd(stored);
    for (const id of [0, 4242, 9999]) {
      const { interests, field, ageGroup, shopping, budget, temper } = people[id];
      assert.deepEqual(light[id], { id, interests, field, ageGroup, shopping, budget, temper });
    }
  }
});
