import test from 'node:test';
import assert from 'node:assert/strict';
import { persona, crowd, personaLine, withAttributes, poolFor, CROWD } from '../public/shared/personas.js';
import { drawAnswer } from '../public/shared/draw.js';
import { INTEREST, JOB, SHOP } from '../public/shared/vocab.js';

test('a persona is the same person every time', () => {
  assert.deepEqual(persona('uk', 4242), persona('uk', 4242));
  assert.notDeepEqual(persona('uk', 4242).name, persona('en', 4242).name);
});

test('the crowd is complete and built from the vocabularies', () => {
  const people = crowd('uk');
  assert.equal(people.length, CROWD);
  for (const who of people) {
    assert.ok(who.age >= 18 && who.age <= 80);
    assert.equal(new Set(who.interests).size, 3);
    assert.ok(who.interests.every((id) => INTEREST[id]) && JOB[who.job] && SHOP[who.shopping]);
  }
});

test('neighbours on the grid are similar people', () => {
  const people = crowd('en');
  let same = 0;
  let pairs = 0;
  let ageGap = 0;
  for (const who of people) {
    if (who.x === 99) continue;
    pairs += 1;
    same += people[who.id + 1].interests[0] === who.interests[0] ? 1 : 0;
    ageGap += Math.abs(people[who.id + 1].age - who.age);
  }
  assert.ok(same / pairs > 0.7, `same main interest: ${same / pairs}`);
  assert.ok(ageGap / pairs < 8, `age gap: ${ageGap / pairs}`);
});

test('the line for Jev names what matters and adds shopping only for a market', () => {
  const who = withAttributes(persona('uk', 7), { interests: ['gardening', 'cooking', 'travel'], temper: 'skeptic', shopping: 'phone' });
  const line = personaLine(who);
  assert.match(line, /^\w+, \d+, .+; into gardening, cooking, travel; skeptical/);
  assert.doesNotMatch(line, /looking to buy/);
  assert.match(personaLine(who, { market: true }), /looking to buy: a phone$/);
});

test('a text is read by the crowd that speaks its language', () => {
  assert.equal(poolFor('Продам велосипед Trek Marlin 5, рама M'), 'uk');
  assert.equal(poolFor('Merino wool running socks'), 'en');
  assert.equal(poolFor('iPhone 13 Pro Max 256 GB, стан ідеальний, Львів'), 'uk');
  assert.equal(poolFor('🔥 2025', 'uk'), 'uk');
  assert.equal(poolFor('🔥 2025'), 'en');
});

test('a follow-up answer is drawn from the probabilities, the same one on every reload', () => {
  const odds = { negotiable: 0.5, photos: 0.3, nothing: 0.2 };
  const picks = Array.from({ length: 400 }, (_, id) => drawAnswer(odds, 'uk', id, 'p.1'));
  assert.deepEqual(picks, Array.from({ length: 400 }, (_, id) => drawAnswer(odds, 'uk', id, 'p.1')));
  const share = picks.filter((pick) => pick === 'negotiable').length / picks.length;
  assert.ok(share > 0.4 && share < 0.6, `negotiable: ${share}`);
  assert.equal(drawAnswer({}, 'uk', 1, 'p.1'), null);
});
