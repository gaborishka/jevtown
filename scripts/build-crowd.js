// Writes worker/crowd-<pool>.bin: the attributes of every persona, packed. Run it after any change
// to the vocabularies or to the persona generator; `npm test` fails while the files are stale.
import { writeFile } from 'node:fs/promises';
import { crowd } from '../public/shared/personas.js';
import { packCrowd } from '../public/shared/pack.js';
import { POOLS } from '../public/shared/vocab.js';

for (const pool of Object.keys(POOLS)) {
  const bytes = packCrowd(crowd(pool));
  await writeFile(new URL(`../worker/crowd-${pool}.bin`, import.meta.url), bytes);
  console.log(`worker/crowd-${pool}.bin: ${bytes.length} bytes`);
}
