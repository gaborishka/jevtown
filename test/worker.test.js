import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOg, OG_W, OG_H } from '../worker/og.js';
import { openingRequest, openingAnswers } from '../public/shared/requests.js';
import { PRESETS, lookOf, LOOKS } from '../public/shared/presets.js';
import { DICTIONARIES } from '../public/i18n.js';

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
  assert.deepEqual(openingAnswers(answers), { scores: { 'interest:cars': 1 }, unlisted: ['illegal'], blocked: ['illegal'] });
  // Between the two thresholds a text is read but stays out of the feed; an insult and keyboard mashing are asked about too.
  assert.ok(request.questions['unlisted:insult'] && request.questions['unlisted:gibberish']);
  assert.deepEqual(openingAnswers({ 'unlisted:insult': { noul: 0.84 }, 'unlisted:gibberish': { noul: 0.85 } }), { scores: {}, unlisted: ['insult', 'gibberish'], blocked: ['gibberish'] });
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
