// The crowd. A persona is computed from its pool and id alone: nothing is stored, nothing is asked
// of an LLM. The id is the persona's place on the 100×100 grid, and the place decides the age and
// the main interest, so neighbours on the grid are similar people.
import { unit, pickWeighted } from './rng.js';
import { INTERESTS, INTEREST_COLUMNS, INTEREST, FIELDS, JOBS, JOB, AGE_GROUPS, TEMPERS, TEMPER, BUDGETS, BUDGET, SPENDING, SPEND, SHOPPING, SHOP, POOLS } from './vocab.js';

export const GRID = 100;
export const CROWD = GRID * GRID;

const ROWS = INTERESTS.length / INTEREST_COLUMNS;
const CELL = { width: GRID / INTEREST_COLUMNS, height: GRID / ROWS };

/** Where each interest lives on the grid: the middle of its cell, nudged so the map is not a chessboard. */
const HOMES = INTERESTS.map((interest, index) => ({
  id: interest.id,
  x: ((index % INTEREST_COLUMNS) + 0.5) * CELL.width + (unit('home-x', interest.id) - 0.5) * 5,
  y: (Math.floor(index / INTEREST_COLUMNS) + 0.5) * CELL.height + (unit('home-y', interest.id) - 0.5) * 6,
}));

/** Where people with this main interest live on the grid, { x, y } in cells. */
export const interestHome = (id) => HOMES.find((home) => home.id === id);

/** Interests by distance from a grid point, nearest first; the noise makes the borders ragged. */
function interestsAround(pool, id, x, y) {
  return HOMES.map((home) => ({
    id: home.id,
    distance: Math.hypot((x - home.x) / CELL.width, (y - home.y) / CELL.height) + unit(pool, id, 'near', home.id) * 0.45,
  })).sort((a, b) => a.distance - b.distance);
}

/** persona(pool, id) → the same person every time. pool is 'uk' or 'en', id is 0..9999. */
export function persona(pool, id) {
  const names = POOLS[pool];
  if (!names) throw new Error(`unknown pool: ${pool}`);
  const u = (salt) => unit(pool, id, salt);
  const x = id % GRID;
  const y = Math.floor(id / GRID);

  const age = Math.round(Math.min(80, Math.max(18, 18 + (y / (GRID - 1)) * 48 + (u('age') - 0.5) * 14)));
  const ageGroup = AGE_GROUPS.findLast((group) => age >= group.from).id;

  const around = interestsAround(pool, id, x, y);
  const interests = [around[0].id];
  interests.push(u('second') < 0.5 ? around[1].id : pickOther(interests, u('second-any')));
  interests.push(pickOther(interests, u('third')));

  const job = pickJob(age, INTEREST[interests[0]].field, u);
  const field = JOB[job].field;

  const gender = u('gender') < 0.5 ? 'female' : 'male';
  // Names run from young to old, so the name follows the age with some slack.
  const list = names[gender];
  const [nameEn, nameUk] = list[Math.min(list.length - 1, Math.floor((((age - 18) / 62) * 0.65 + u('name') * 0.35) * list.length))];
  const [cityEn, cityUk] = pickWeighted(names.cities, (city) => city[2], u('city'));

  const temper = pickWeighted(TEMPERS, (item) => item.weight, u('temper')).id;
  const level = Math.round((u('budget') - 0.5) * 2.6 + FIELDS[field].income * 0.7);
  const budget = BUDGETS.findLast((item) => level >= item.level)?.id ?? BUDGETS[0].id;
  const spending = pickWeighted(SPENDING, (item) => item.weight, u('spending')).id;

  const wanted = INTEREST[interests[0]].shopping;
  const shopping = u('shopping') < 0.4 ? 'nothing' : wanted && u('shopping-own') < 0.45 ? wanted : SHOPPING[1 + Math.floor(u('shopping-any') * (SHOPPING.length - 1))].id;

  return { pool, id, x, y, name: { en: nameEn, uk: nameUk }, gender, age, ageGroup, city: { en: cityEn, uk: cityUk }, job, field, interests, temper, budget, spending, shopping };
}

function pickOther(taken, u) {
  const free = INTERESTS.filter((interest) => !taken.includes(interest.id));
  return free[Math.floor(u * free.length)].id;
}

function pickJob(age, nearField, u) {
  if (age < 23 && u('student') < 0.6) return 'student';
  if (age > 63 && u('retired') < 0.75) return 'retired';
  const working = JOBS.filter((job) => job.field !== 'student' && job.field !== 'retired');
  const near = nearField && u('job-near') < 0.45 ? working.filter((job) => job.field === nearField) : [];
  const from = near.length ? near : working;
  return from[Math.floor(u('job') * from.length)].id;
}

/**
 * Which crowd reads a text: the one that speaks its language. Cyrillic letters against Latin ones;
 * a text with no letters at all goes to `fallback`.
 */
export function poolFor(text, fallback = 'en') {
  const cyrillic = text.match(/[\u0400-\u04ff]/g)?.length ?? 0;
  const latin = text.match(/[a-z]/gi)?.length ?? 0;
  if (!cyrillic && !latin) return fallback;
  return cyrillic >= latin ? 'uk' : 'en';
}

/** The whole crowd of a pool, in grid order. Takes a few dozen milliseconds. */
export function crowd(pool) {
  return Array.from({ length: CROWD }, (_, id) => persona(pool, id));
}

/**
 * What Jev reads about a persona, one English line:
 * "Oksana, 34, accountant, Lviv; into gardening, movies and TV series, travel; skeptical, distrusts ads; careful with money".
 * `market` adds what the persona is looking to buy, for listings and products.
 * The 10,000 are computed here; the people visitors move in (shared/resident.js) have the same shape.
 */
export function personaLine(who, { market = false } = {}) {
  const money = [BUDGET[who.budget].line, SPEND[who.spending]?.line].filter(Boolean).join(', ');
  const parts = [
    // A resident a visitor moved in names the job and the city in their own words, or leaves them out.
    [who.name.en, who.age, who.jobText ?? JOB[who.job].en, who.city.en].filter(Boolean).join(', '),
    `into ${who.interests.map((id) => INTEREST[id].en).join(', ')}`,
    TEMPER[who.temper].line,
    money,
  ];
  if (market) parts.push(`looking to buy: ${SHOP[who.shopping].en}`);
  if (who.about) parts.push(`in their own words: "${who.about}"`);
  return parts.join('; ');
}

/** A copy of a persona with some attributes replaced; the probe uses it to change one thing at a time. */
export function withAttributes(who, changes) {
  const next = { ...who, ...changes };
  if (changes.job) next.field = JOB[changes.job].field;
  if (changes.age) next.ageGroup = AGE_GROUPS.findLast((group) => changes.age >= group.from).id;
  return next;
}
