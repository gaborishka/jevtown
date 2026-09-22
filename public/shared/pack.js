// The crowd as bytes. Building 10,000 personas takes about 100 ms of CPU, ten times what a free
// Worker invocation may use, and the feed algorithm needs only seven attributes of each. So the
// attributes are packed once, 8 bytes a persona (scripts/build-crowd.js), and the Worker unpacks them.
import { INTERESTS, FIELDS, AGE_GROUPS, SHOPPING, BUDGETS, TEMPERS } from './vocab.js';

export const BYTES_PER_PERSONA = 8;
const FIELD_IDS = Object.keys(FIELDS);
const indexOf = (list) => Object.fromEntries(list.map((item, index) => [item.id ?? item, index]));
const AT = { interest: indexOf(INTERESTS), field: indexOf(FIELD_IDS), age: indexOf(AGE_GROUPS), shopping: indexOf(SHOPPING), budget: indexOf(BUDGETS), temper: indexOf(TEMPERS) };

/** personas in id order → Uint8Array */
export function packCrowd(people) {
  const bytes = new Uint8Array(people.length * BYTES_PER_PERSONA);
  people.forEach((who, i) => {
    bytes.set([...who.interests.map((id) => AT.interest[id]), AT.field[who.field], AT.age[who.ageGroup], AT.shopping[who.shopping], AT.budget[who.budget], AT.temper[who.temper]], i * BYTES_PER_PERSONA);
  });
  return bytes;
}

/** Uint8Array → what the feed algorithm reads of a persona: { id, interests, field, ageGroup, shopping, budget, temper } */
export function unpackCrowd(bytes) {
  return Array.from({ length: bytes.length / BYTES_PER_PERSONA }, (_, id) => {
    const at = id * BYTES_PER_PERSONA;
    return {
      id,
      interests: [INTERESTS[bytes[at]].id, INTERESTS[bytes[at + 1]].id, INTERESTS[bytes[at + 2]].id],
      field: FIELD_IDS[bytes[at + 3]],
      ageGroup: AGE_GROUPS[bytes[at + 4]].id,
      shopping: SHOPPING[bytes[at + 5]].id,
      budget: BUDGETS[bytes[at + 6]].id,
      temper: TEMPERS[bytes[at + 7]].id,
    };
  });
}

/**
 * The three interests of one persona, main one first, read straight from the bytes: building a
 * persona again is mostly drawing its interests, and the Worker asks about a few hundred at a time.
 */
export function interestsAt(bytes, id) {
  const at = id * BYTES_PER_PERSONA;
  return [INTERESTS[bytes[at]].id, INTERESTS[bytes[at + 1]].id, INTERESTS[bytes[at + 2]].id];
}
