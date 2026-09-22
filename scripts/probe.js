// Step 0 of the plan: measurements with a real key, before any interface exists.
//   node --env-file=.env.local scripts/probe.js attributes batch presets crowd waves
// `town` measures what the town is asked when a check closes and the text checks; its gates decide which stay.
// It is paid, about $0.22, and stops at PROBE_BUDGET_USD like every step.
// `audience` measures how Jev reads an audience in words against its own reading of each person (paid, about $0.04).
// Raw numbers go to data/probe/*.json (not committed); the conclusions are in docs/measurements.md.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { crowd, withAttributes, personaLine } from '../public/shared/personas.js';
import { PRESETS, priceLadder, questionOfList, CANT_TELL } from '../public/shared/presets.js';
import { reactionRequest, followUpRequest, exposureRequest, exposureScores, openingRequest, openingAnswers, questionId, TEXT_CHECKS } from '../public/shared/requests.js';
import { pickProvider, ask, eachLimit } from '../public/shared/jev.js';
import { firstWave, nextWave, travels, mood, exposure, gatherAsked, asking, audienceOf, WAVES, ASK_WEIGHT, MIN_ASKED, MIN_AUDIENCE } from '../public/shared/feed.js';
import { askQuestion, listsOf, rateAudience } from '../public/shared/check.js';
import { listView, whySplit } from '../public/shared/summary.js';
import { drawReaction } from '../public/shared/draw.js';
import { rng, hash32 } from '../public/shared/rng.js';

const OUT = new URL('../data/probe/', import.meta.url);
const BUDGET_USD = Number(process.env.PROBE_BUDGET_USD ?? 1.5);
/** The `batch` step showed that 200 personas in one request answer the same as 50 or 1; 255 is the ceiling. */
const PER_REQUEST = 200;

const TEXTS = {
  post_garden: { preset: 'post', pool: 'uk', text: 'Цього року посадив 15 сортів томатів і нарешті зрозумів, чому розсада витягувалась: справа не в світлі, а в температурі вночі. Тримаю тепер 14–16 градусів після сходів, і стебло товсте, як олівець. Кому цікаво, розпишу весь графік від посіву до висадки в теплицю.' },
  post_dev: { preset: 'post', pool: 'uk', text: 'Місяць писав код тільки з ШІ-асистентом і порахував: рутинні задачі закриваю втричі швидше, але на рев’ю свого ж коду йде вдвічі більше часу. Найбільший виграш не в швидкості, а в тому, що я перестав відкладати нудні задачі. Тести, міграції, документація тепер робляться одразу.' },
  post_broad: { preset: 'post', pool: 'uk', text: 'Кава в моїй кав’ярні біля дому за рік подорожчала з 45 до 70 гривень. Порахував: якщо брати її щодня, це 25 тисяч на рік. Купив кавоварку за 9 тисяч і тепер не знаю, чи я молодець, чи просто сумую за розмовами з баристою.' },
  listing_iphone: { preset: 'listing', pool: 'uk', text: 'iPhone 13, 128 ГБ, синій. Стан акумулятора 86%, не ремонтувався, весь час у чохлі та зі склом. У комплекті коробка й кабель. 14 000 грн, Львів, можу надіслати Новою поштою з оглядом.' },
  product_socks: { preset: 'product', pool: 'en', prices: [9, 15, 24, 39], text: 'Merino wool running socks that do not smell after a week of training. Seamless toe, no blisters, 2-year guarantee: if they wear through, we send a new pair. $24 a pair.' },
  headline_ai: { preset: 'headline', pool: 'en', text: 'I replaced my morning routine with one 4-minute habit. Here is what changed in 30 days' },
};

const provider = pickProvider(process.env);
if (!provider) throw new Error('no key: run with node --env-file=.env.local');

const spend = { usd: 0, tokens: 0, requests: 0, throttled: 0 };
async function send(request) {
  if (spend.usd > BUDGET_USD) throw Object.assign(new Error(`probe budget of $${BUDGET_USD} is spent`), { fatal: true });
  const result = await ask(provider, request);
  spend.usd += result.usd;
  spend.tokens += result.tokens;
  spend.requests += 1;
  spend.throttled += result.throttled;
  return result;
}

const crowds = {};
const crowdOf = (pool) => (crowds[pool] ??= crowd(pool));
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
const round = (value, digits = 3) => Number(value.toFixed(digits));
const percent = (share) => `${Math.round(share * 100)}%`;
const stoppedShare = (presetId, probabilities) => Object.entries(probabilities).reduce((sum, [id, value]) => sum + (PRESETS[presetId].reactions[id]?.stopped ? value : 0), 0);
/** Total variation distance between two answers to the same question. */
const distance = (a, b) => Object.keys({ ...a, ...b }).reduce((sum, key) => sum + Math.abs((a[key] ?? 0) - (b[key] ?? 0)), 0) / 2;
const top = (probabilities) => Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];

async function save(name, data) {
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data));
}

/** Asks about personas in batches; → { probabilities: Map(id → {reaction: p}), tokens, ms: [], throttled, failed, seconds }. */
async function askCrowd(presetId, text, personas, { perRequest = 50, atOnce = 8, build = reactionRequest } = {}) {
  const probabilities = new Map();
  const stats = { tokens: 0, usd: 0, ms: [], throttled: 0, failed: 0, requests: 0 };
  const startedAt = performance.now();
  await eachLimit(chunk(personas, perRequest), atOnce, async (batch) => {
    const result = await send(build(presetId, text, batch));
    stats.tokens += result.tokens;
    stats.usd += result.usd;
    stats.ms.push(result.ms);
    stats.throttled += result.throttled;
    stats.requests += 1;
    for (const who of batch) probabilities.set(who.id, result.answers[questionId(who)]?.probabilities ?? {});
  }, (batch, error) => {
    if (error.fatal) throw error;
    stats.failed += 1;
    stats.throttled += error.throttledTimes ?? 0;
    console.warn('  batch failed:', error.message);
  });
  stats.seconds = round((performance.now() - startedAt) / 1000, 1);
  return { probabilities, ...stats };
}

const meanAnswer = (presetId, answers) => {
  const keys = Object.keys(PRESETS[presetId].reactions);
  return Object.fromEntries(keys.map((key) => [key, round(mean(answers.map((answer) => answer[key] ?? 0)))]));
};

// 1. Do persona attributes move the answers? The same 40 people, one attribute changed at a time.
async function attributes() {
  const sample = (pool) => Array.from({ length: 40 }, (_, i) => crowdOf(pool)[137 + i * 241]);
  const scenarios = [
    { text: 'post_garden', variants: { 'as generated': {}, 'into gardening': { interests: ['gardening', 'cooking', 'travel'] }, 'into programming': { interests: ['programming', 'games', 'crypto'] }, troll: { temper: 'troll' }, supporter: { temper: 'supporter' }, lurker: { temper: 'lurker' } } },
    { text: 'post_dev', variants: { 'into gardening': { interests: ['gardening', 'cooking', 'travel'] }, 'into programming': { interests: ['programming', 'games', 'crypto'] }, 'developer, 28': { job: 'developer', age: 28 }, 'pensioner, 68': { job: 'retired', age: 68 } } },
    { text: 'listing_iphone', variants: { 'wants a phone': { shopping: 'phone' }, 'wants nothing': { shopping: 'nothing' }, 'wants a phone, tight budget': { shopping: 'phone', budget: 'tight' }, 'wants a phone, wealthy': { shopping: 'phone', budget: 'wealthy' }, 'wants a phone, in Lviv': { shopping: 'phone', city: { en: 'Lviv', uk: 'Львів' } }, 'wants a phone, skeptic': { shopping: 'phone', temper: 'skeptic' } } },
    { text: 'product_socks', variants: { 'into running': { interests: ['cycling', 'fitness', 'travel'] }, 'into anime': { interests: ['anime', 'games', 'memes'] }, 'into running, tight budget': { interests: ['cycling', 'fitness', 'travel'], budget: 'tight' }, 'into running, wealthy': { interests: ['cycling', 'fitness', 'travel'], budget: 'wealthy' } } },
  ];
  const report = [];
  for (const scenario of scenarios) {
    const { preset, pool, text, prices } = TEXTS[scenario.text];
    for (const [name, changes] of Object.entries(scenario.variants)) {
      const people = sample(pool).map((who) => withAttributes(who, changes));
      const asked = await askCrowd(preset, text, people, { perRequest: 10 });
      const answers = [...asked.probabilities.values()];
      const row = { text: scenario.text, variant: name, stopped: round(mean(answers.map((answer) => stoppedShare(preset, answer)))), ...meanAnswer(preset, answers) };
      if (prices) {
        const ladder = priceLadder(prices);
        const paid = await askCrowd(preset, text, people, { perRequest: 10, build: (id, body, batch) => followUpRequest(id, body, batch, ladder) });
        const steps = [...paid.probabilities.values()];
        Object.keys(ladder).forEach((key) => { row[`pay_${key}`] = round(mean(steps.map((answer) => answer[key] ?? 0))); });
      }
      report.push(row);
      console.log(row);
    }
  }
  await save('attributes', report);
}

// 2. How many personas fit in one request, and do the answers change with the batch size?
async function batch() {
  const { preset, pool, text } = TEXTS.post_garden;
  const all = crowdOf(pool);
  // Half of them live where gardeners live, half are spread over the grid.
  const people = [...Array.from({ length: 25 }, (_, i) => all[8200 + i * 7]), ...Array.from({ length: 25 }, (_, i) => all[311 + i * 379])];
  const report = { sizes: [], limits: [] };

  const alone = await askCrowd(preset, text, people, { perRequest: 1, atOnce: 6 });
  const again = await askCrowd(preset, text, people, { perRequest: 1, atOnce: 6 });
  const compare = (name, asked, base = alone) => {
    const ids = people.map((who) => who.id).filter((id) => Object.keys(asked.probabilities.get(id) ?? {}).length);
    const row = {
      size: name,
      answered: ids.length,
      distance_from_alone: round(mean(ids.map((id) => distance(asked.probabilities.get(id), base.probabilities.get(id))))),
      same_top_answer: round(mean(ids.map((id) => (top(asked.probabilities.get(id)) === top(base.probabilities.get(id)) ? 1 : 0)))),
      stopped: round(mean(ids.map((id) => stoppedShare(preset, asked.probabilities.get(id))))),
      cant_tell: round(mean(ids.map((id) => asked.probabilities.get(id).cant_tell ?? 0))),
      tokens_per_persona: Math.round(asked.tokens / asked.probabilities.size),
      ms_per_request: Math.round(percentile(asked.ms, 0.5)),
    };
    report.sizes.push(row);
    console.log(row);
  };
  compare('1', alone);
  compare('1 again', again);
  for (const size of [10, 25, 50]) compare(String(size), await askCrowd(preset, text, people, { perRequest: size }));
  // The same 50 inside one request of 200, the other 150 being strangers.
  compare('200', await askCrowd(preset, text, [...people, ...all.slice(5000, 5150)], { perRequest: 200 }));
  compare('50 reversed order', await askCrowd(preset, text, [...people].reverse(), { perRequest: 50 }));
  compare('50, answers listed backwards', await askCrowd(preset, text, people, {
    perRequest: 50,
    build: (...args) => {
      const request = reactionRequest(...args);
      for (const question of Object.values(request.questions)) question.criteria = Object.fromEntries(Object.entries(question.criteria).reverse());
      return request;
    },
  }));

  // Where is the ceiling? Bigger batches of other people until the API refuses.
  for (const size of [100, 150, 200, 255, 300]) {
    const batchPeople = all.slice(5000, 5000 + size);
    try {
      const result = await send(reactionRequest(preset, text, batchPeople));
      const answered = batchPeople.filter((who) => result.answers[questionId(who)]?.probabilities).length;
      report.limits.push({ size, answered, tokens: result.tokens, ms: result.ms });
    } catch (error) {
      report.limits.push({ size, error: error.message });
    }
    console.log(report.limits.at(-1));
    if (report.limits.at(-1).error) break;
  }
  await save('batch', report);
}

// 4. Tokens and dollars for each preset, from one request of 50, scaled to the whole crowd.
async function presets() {
  const report = [];
  for (const [name, { preset, pool, text, prices }] of Object.entries(TEXTS)) {
    if (report.some((row) => row.preset === preset)) continue;
    const people = crowdOf(pool).filter((who) => who.id % 200 === 7);
    const reaction = await send(reactionRequest(preset, text, people));
    const scoring = await send(exposureRequest(preset, text));
    const row = {
      preset, text: name, people: people.length,
      tokens_per_persona: Math.round(reaction.tokens / people.length),
      whole_crowd_usd: round((reaction.usd / people.length) * 10_000, 4),
      wave_1_usd: round((reaction.usd / people.length) * WAVES[0].size, 4),
      scoring_questions: Object.keys(scoring.answers).length, scoring_tokens: scoring.tokens, scoring_usd: round(scoring.usd, 5), scoring_ms: scoring.ms,
    };
    if (PRESETS[preset].followUp) {
      const answers = prices ? priceLadder(prices) : undefined;
      const followUp = await send(followUpRequest(preset, text, people, answers));
      row.follow_up_tokens_per_persona = Math.round(followUp.tokens / people.length);
      row.follow_up_usd_per_1000 = round((followUp.usd / people.length) * 1000, 4);
    }
    report.push(row);
    console.log(row);
  }
  await save('presets', report);
}

// 3 and 5a. The whole crowd, once per text, 50 requests of 200 personas, each run with more of them in flight.
async function wholeCrowd() {
  const runs = [['post_garden', 4], ['post_dev', 8], ['listing_iphone', 16], ['product_socks', 25], ['post_broad', 50]];
  const report = [];
  for (const [name, atOnce] of runs) {
    const { preset, pool, text } = TEXTS[name];
    const people = crowdOf(pool);
    const scoring = await send(exposureRequest(preset, text));
    const asked = await askCrowd(preset, text, people, { perRequest: PER_REQUEST, atOnce });
    const keys = Object.keys(PRESETS[preset].reactions);
    await save(`crowd-${name}`, {
      name, preset, pool, keys, scores: exposureScores(scoring.answers),
      probabilities: people.map((who) => keys.map((key) => asked.probabilities.get(who.id)?.[key] ?? null)),
    });
    const row = {
      text: name, in_flight: atOnce, requests: asked.requests, failed: asked.failed, throttled: asked.throttled, seconds: asked.seconds,
      personas_per_second: Math.round(people.length / asked.seconds), ms_p50: percentile(asked.ms, 0.5), ms_p95: percentile(asked.ms, 0.95),
      tokens: asked.tokens, usd: round(asked.usd, 4),
    };
    report.push(row);
    console.log(row);
  }
  await save('crowd', report);
}

// 5b. Offline, from the saved runs: would the waves have found the people who react?
async function waves() {
  const report = [];
  for (const name of ['post_garden', 'post_dev', 'post_broad', 'listing_iphone', 'product_socks']) {
    let saved;
    try {
      saved = JSON.parse(await readFile(new URL(`crowd-${name}.json`, OUT), 'utf8'));
    } catch {
      continue;
    }
    const { preset, pool, keys, scores, probabilities } = saved;
    const people = crowdOf(pool).filter((who) => probabilities[who.id][0] !== null);
    const answerOf = (who) => Object.fromEntries(keys.map((key, index) => [key, probabilities[who.id][index]]));
    const stops = new Map(people.map((who) => [who.id, stoppedShare(preset, answerOf(who))]));
    const allStops = [...stops.values()].reduce((sum, value) => sum + value, 0);
    const found = (ids) => ids.reduce((sum, id) => sum + stops.get(id), 0) / allStops;

    const random = rng(7);
    const reactions = new Map();
    const row = { text: name, crowd_stopped: round(allStops / people.length), top_groups: Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, score]) => `${id} ${round(score, 2)}`).join(', ') };
    let wave = firstWave(people, scores, preset, random);
    for (let index = 0; index < WAVES.length && wave.length; index++) {
      const drawn = wave.map((who) => drawReaction(answerOf(who), pool, who.id, name));
      wave.forEach((who, i) => reactions.set(who.id, drawn[i]));
      const reached = [...reactions.keys()];
      row[`wave_${index + 1}`] = {
        reached: reached.length,
        engaged: round(mean(drawn.map((reaction) => (PRESETS[preset].reactions[reaction]?.stopped ? 1 : 0)))),
        mood: round(mood(preset, drawn)),
        travels: travels(preset, drawn),
        found_of_all_who_stop: round(found(reached)),
        random_would_find: round(reached.length / people.length),
        best_possible: round(found([...stops].sort((a, b) => b[1] - a[1]).slice(0, reached.length).map(([id]) => id))),
      };
      if (!travels(preset, drawn)) break;
      wave = nextWave(people, reactions, scores, preset, index + 1, random);
    }
    row.reach = reactions.size;
    // How well does Jev's first guess alone order the crowd?
    const byGuess = [...people].sort((a, b) => exposure(b, scores, preset) - exposure(a, scores, preset));
    row.guess_alone_top_2100 = round(found(byGuess.slice(0, 2100).map((who) => who.id)));
    report.push(row);
    console.log(JSON.stringify(row, null, 1));
  }
  await save('waves', report);
}

// 6. Does a weak text get a weak reaction? A thousand people spread over the grid, texts from dull to strong.
// The answer sets what "engaged enough to travel further" means.
const DULL = {
    spam: { preset: 'post', pool: 'uk', text: 'ЗАРОБЛЯЙ від 5000$ на місяць без вкладень!!! Пиши в особисті слово «ХОЧУ», місць мало. Працюють усі, навіть школярі.' },
    morning: { preset: 'post', pool: 'uk', text: 'Доброго ранку всім! Гарного дня і продуктивного тижня.' },
    vague: { preset: 'post', pool: 'uk', text: 'Багато думав останнім часом про різне. Життя складна штука. Можливо, колись напишу про це докладніше.' },
    rage: { preset: 'post', pool: 'uk', text: 'Усі, хто досі працює в офісі з дев’ятої до шостої, просто бояться визнати, що змарнували життя. Нормальні люди давно на фрилансі.' },
    listing_vague: { preset: 'listing', pool: 'uk', text: 'Продам телефон. Нормальний стан. Ціна договірна. Пишіть.' },
    listing_scam: { preset: 'listing', pool: 'uk', text: 'iPhone 15 Pro Max новий запакований, 9 000 грн, терміново. Тільки повна передоплата на картку, відправлю сьогодні.' },
};

async function calibrate() {
  const report = [];
  for (const [name, { preset, pool, text }] of Object.entries({ ...DULL, ...TEXTS })) {
    const people = crowdOf(pool).filter((who) => who.id % 10 === 3);
    const asked = await askCrowd(preset, text, people, { perRequest: PER_REQUEST, atOnce: 5 });
    const answers = [...asked.probabilities.values()];
    const tone = (sign) => round(mean(answers.map((answer) => Object.entries(answer).reduce((sum, [id, value]) => sum + (PRESETS[preset].reactions[id]?.tone === sign ? value : 0), 0))));
    const row = { text: name, preset, stopped: round(mean(answers.map((answer) => stoppedShare(preset, answer)))), glad: tone(1), sorry: tone(-1), ...meanAnswer(preset, answers) };
    report.push(row);
    console.log(row);
  }
  await save('calibrate', report);
}

// 3b. Is it faster to send the same people in smaller requests? 2,000 personas each way.
async function throughput() {
  const { preset, pool, text } = TEXTS.post_garden;
  const people = crowdOf(pool).slice(3000, 5000);
  const report = [];
  for (const [perRequest, atOnce] of [[200, 8], [100, 8], [50, 8], [50, 16], [25, 16]]) {
    const asked = await askCrowd(preset, text, people, { perRequest, atOnce });
    report.push({ per_request: perRequest, in_flight: atOnce, seconds: asked.seconds, personas_per_second: Math.round(people.length / asked.seconds), throttled: asked.throttled, failed: asked.failed, ms_p50: percentile(asked.ms, 0.5), tokens: asked.tokens });
    console.log(report.at(-1));
  }
  await save('throughput', report);
}

// 7. The real first wave for every text: what do the people the algorithm picked do, weak text or strong?
async function firstWaves() {
  const report = [];
  for (const [name, { preset, pool, text }] of Object.entries({ ...DULL, ...TEXTS })) {
    const scoring = await send(exposureRequest(preset, text));
    const scores = exposureScores(scoring.answers);
    const people = firstWave(crowdOf(pool), scores, preset, rng(11));
    const asked = await askCrowd(preset, text, people, { perRequest: 100, atOnce: 6 });
    const answers = [...asked.probabilities.values()];
    const tone = (sign) => round(mean(answers.map((answer) => Object.entries(answer).reduce((sum, [id, value]) => sum + (PRESETS[preset].reactions[id]?.tone === sign ? value : 0), 0))));
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    report.push({ text: name, seconds: asked.seconds, stopped: round(mean(answers.map((answer) => stoppedShare(preset, answer)))), glad: tone(1), sorry: tone(-1), best_group: `${best[0][0]} ${round(best[0][1], 2)}`, mean_score: round(mean(best.map(([, score]) => score)), 2) });
    console.log(report.at(-1));
  }
  await save('first-waves', report);
}

// 8. Does Jev go by what a persona thinks of the author? The same first-wave people, asked with a
// clause about the author at the end of their line. A follower cannot follow again, so the share of
// "followed" shows whether Jev reads the clause at all.
const AUTHOR_CLAUSES = {
  none: '',
  follows: '; follows this author',
  follows_liked: '; follows this author and liked their earlier posts',
  annoyed: '; was annoyed by an earlier post of this author',
};
async function memory() {
  const report = [];
  const texts = { post_garden: TEXTS.post_garden, post_dev: TEXTS.post_dev, post_broad: TEXTS.post_broad, morning: DULL.morning, spam: DULL.spam, rage: DULL.rage };
  for (const [name, { preset, pool, text }] of Object.entries(texts)) {
    const scores = exposureScores((await send(exposureRequest(preset, text))).answers);
    const people = firstWave(crowdOf(pool), scores, preset, rng(11)).slice(0, 150);
    for (const [clause, words] of Object.entries(AUTHOR_CLAUSES)) {
      const build = (presetId, body, batch) => {
        const request = reactionRequest(presetId, body, batch);
        for (const question of Object.values(request.questions)) question.instructions = question.instructions.replace(`. ${PRESETS[presetId].ask}`, `${words}. ${PRESETS[presetId].ask}`);
        return request;
      };
      const asked = await askCrowd(preset, text, people, { perRequest: 75, atOnce: 6, build });
      const answers = [...asked.probabilities.values()];
      const tone = (sign) => round(mean(answers.map((answer) => Object.entries(answer).reduce((sum, [id, value]) => sum + (PRESETS[preset].reactions[id]?.tone === sign ? value : 0), 0))));
      report.push({ text: name, clause, glad: tone(1), sorry: tone(-1), mood: round(tone(1) - tone(-1)), tokens_per_persona: Math.round(asked.tokens / people.length), ...meanAnswer(preset, answers) });
      console.log(report.at(-1));
    }
  }
  await save('memory', report);
}

// 9. Asking the town when a check closes (presets.js:ASKS) and reading the text (requests.js:TEXT_CHECKS).
// A asks each text's first wave as the site would, B the same fixed people about every text, C the
// text checks alone. Jev leans towards the first-listed answer, so every
// closing question goes out in both orders. The gates at the end decide which questions and checks stay.
const PLAIN = {
  product_plain: { preset: 'product', pool: 'en', text: 'Wool socks for running. $24 a pair.' },
  headline_plain: { preset: 'headline', pool: 'en', text: 'Some thoughts about my mornings' },
};
/** A windy opening that pushes what is for sale out of the first sentence. */
const PAD = 'Давно збирався написати про одну річ, але все не було часу, а сьогодні нарешті сів і вирішив поділитися. ';
const ASK_ADDED = {
  post_dev: ' Напишіть у коментарях: вам асистент пришвидшив роботу чи ні?',
  post_broad: ' Порахуйте свої кавові витрати й напишіть, скільки вийшло.',
  product_socks: ' Order at the link in the profile, delivery in 3 days.',
};
const LISTING_CUT = 'iPhone 13, 128 ГБ, синій. Стан акумулятора 86%, не ремонтувався, весь час у чохлі та зі склом. У комплекті коробка й кабель. 14 000 грн.';
/** What every fixed person of B did: a glad reaction, so hook is asked of them all. */
const FIXED_DID = { post: 'liked', listing: 'saved', product: 'cart', headline: 'clicked' };
const ORDERS = ['listed', 'reversed'];

/** The texts of C with the answer each check should give. → [{ check, yes, name, preset, pool, text }] */
function checkCases() {
  const known = { ...DULL, ...TEXTS };
  const as = (name, change = '', text = known[name].text) => ({ ...known[name], name: change ? `${name}, ${change}` : name, text });
  const cases = [];
  const add = (check, yes, ...texts) => texts.forEach((one) => cases.push({ check, yes, ...one }));
  add('concrete', false, as('morning'), as('vague'), as('listing_vague'));
  add('concrete', true, ...Object.keys(TEXTS).map((name) => as(name)));
  add('point_first', true, as('listing_iphone'));
  add('point_first', false, as('listing_iphone', 'padded', PAD + known.listing_iphone.text));
  add('ask', false, as('post_dev'), as('post_broad'), as('listing_iphone', 'cut', LISTING_CUT), as('listing_vague'), as('product_socks'));
  add('ask', true, ...Object.entries(ASK_ADDED).map(([name, words]) => as(name, 'with an ask', known[name].text + words)), as('listing_iphone'));
  return cases;
}

/** The opening request with nothing but its text checks, to see whether the questions around them matter. */
function checksOnly(presetId, text) {
  const request = openingRequest(presetId, text);
  request.questions = Object.fromEntries(Object.entries(request.questions).filter(([id]) => id.startsWith('check:')));
  return request;
}

/** Every question's answers listed backwards, the drain still last. */
function backwards(request) {
  for (const question of Object.values(request.questions)) {
    const { [CANT_TELL]: drain, ...real } = question.criteria;
    question.criteria = { ...Object.fromEntries(Object.entries(real).reverse()), [CANT_TELL]: drain };
  }
  return request;
}

/** One closing question asked in both orders at once; each side keeps Jev's answers per person. */
async function inBothOrders(question, asked) {
  const sides = await Promise.all(ORDERS.map(async (order) => {
    let answers;
    const result = await askQuestion(async (request) => {
      const sent = await send(order === 'reversed' ? backwards(request) : request);
      answers = sent.answers;
      return sent;
    }, question, asked);
    return { ...result, answers };
  }));
  return Object.fromEntries(ORDERS.map((order, i) => [order, sides[i]]));
}

/** A list as the page reads it (summary.js:listView), its drain kept even when too few answered for the page. */
function readList(part, list, presetId) {
  const stored = part.lists[list];
  if (!stored) return null;
  const drain = round((stored.totals[CANT_TELL] ?? 0) / stored.asked, 2);
  const view = listView({ lists: { [list]: stored } }, list, presetId);
  if (!view) return { asked: stored.asked, drain };
  return {
    asked: view.asked, real: round(view.real, 1), drain,
    shares: Object.fromEntries(view.rows.map((row) => [row.id, round(row.share)])),
    top: view.rows.slice(0, 3).map((row) => `${row.id} ${round(row.share, 2)}`),
    lead: view.lead,
    ...(list === 'scrolled' && { text_share: round(whySplit(view).text) }),
  };
}
const bothLists = (sides, list, presetId) => {
  const [listed, reversed] = ORDERS.map((order) => readList(sides[order].part, list, presetId));
  return { listed, reversed, lead_changes: listed?.lead && reversed?.lead ? String(listed.lead.ids) !== String(reversed.lead.ids) : null };
};
const sideLine = (side) => (side?.top ? `${side.asked} asked, ${side.real} real, drain ${side.drain}: ${side.top.join(', ')}` : side ? `${side.asked} asked, drain ${side.drain}, under ten real` : 'no answer');
const topOf = (side) => (side?.shares ? Object.keys(side.shares)[0] : null);

function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** How far apart two random halves of the same people answer: the noise a difference between texts must beat. */
function halvesApart(answers, ids) {
  const sharesOf = (half) => {
    const totals = {};
    for (const id of half) for (const [answer, value] of Object.entries(answers[questionId({ id })]?.probabilities ?? {})) if (answer !== CANT_TELL) totals[answer] = (totals[answer] ?? 0) + value;
    const real = Object.values(totals).reduce((sum, value) => sum + value, 0);
    return Object.fromEntries(Object.entries(totals).map(([answer, value]) => [answer, value / real]));
  };
  const mixed = shuffled(ids, rng(5));
  return round(distance(sharesOf(mixed.slice(0, mixed.length >> 1)), sharesOf(mixed.slice(mixed.length >> 1))));
}

/** A text's opening request and first wave as the site runs them. → { checks, wave, reactionOf, gathered } */
async function firstWaveOf({ preset, pool, text }) {
  const { scores, checks } = openingAnswers((await send(openingRequest(preset, text))).answers);
  const wave = firstWave(crowdOf(pool), scores, preset, rng(11));
  const asked = await askCrowd(preset, text, wave, { perRequest: 100, atOnce: 6 });
  const reactions = new Map(wave.map((who) => [who.id, drawReaction(asked.probabilities.get(who.id) ?? {}, pool, who.id, 'probe')]));
  const reactionOf = (id) => reactions.get(id);
  return { checks, wave, reactionOf, gathered: gatherAsked(preset, wave.map((who) => who.id), reactionOf) };
}

async function town() {
  const report = { site: {}, not_for_them: {}, drain_by_temper: {}, fixed: {}, checks: [] };
  const sites = {};
  const drains = { lurker: [], rest: [] };

  // A. As the site asks: the first wave's people in pick order, and why of a random 100 of its scrollers.
  for (const [name, { preset, pool, text }] of Object.entries({ ...DULL, ...TEXTS })) {
    const site = (sites[name] = await firstWaveOf({ preset, pool, text }));
    const people = crowdOf(pool);
    const about = (ids) => ({ presetId: preset, text, people: ids.map((id) => people[id]), reactionOf: site.reactionOf, pool, versionId: 'probe' });
    const scrollers = site.wave.map((who) => who.id).filter((id) => {
      const reaction = PRESETS[preset].reactions[site.reactionOf(id)];
      return reaction && !reaction.stopped && !reaction.hollow;
    });
    const [asked, random] = await Promise.all([
      Promise.all(asking(preset, text, site.gathered).map(async ({ question, ids }) => ({ question, ids, sides: await inBothOrders(question, about(ids)) }))),
      scrollers.length >= MIN_ASKED ? askQuestion(send, 'why', about(shuffled(scrollers, rng(13)).slice(0, ASK_WEIGHT))) : null,
    ]);
    const row = (report.site[name] = { preset, groups: Object.fromEntries(Object.entries(site.gathered).map(([group, ids]) => [group, ids.length])), checks: site.checks, lists: {}, tokens_per_person: {} });
    for (const { question, ids, sides } of asked) {
      row.tokens_per_person[question] = Math.round(sides.listed.tokens / ids.length);
      for (const list of listsOf(question, preset, ids, site.reactionOf)) row.lists[list] = bothLists(sides, list, preset);
      for (const side of Object.values(sides)) {
        for (const id of ids) {
          const probabilities = side.answers[questionId({ id })]?.probabilities;
          if (probabilities) drains[people[id].temper === 'lurker' ? 'lurker' : 'rest'].push(probabilities[CANT_TELL] ?? 0);
        }
      }
    }
    report.not_for_them[name] = { in_pick_order: row.lists.scrolled?.listed?.shares?.not_for_them ?? null, random: (random && readList(random.part, 'scrolled', preset)?.shares?.not_for_them) ?? null };
    console.log(`${name}: ${Object.entries(row.groups).map(([group, count]) => `${group} ${count}`).join(', ')}; checks ${Object.entries(row.checks).map(([id, p]) => `${id} ${p}`).join(', ')}; tokens per person ${JSON.stringify(row.tokens_per_person)}`);
    for (const [list, both] of Object.entries(row.lists)) console.log(`  ${list}: ${sideLine(both.listed)} | reversed: ${sideLine(both.reversed)}${both.lead_changes ? ' | the lead changes' : ''}`);
    console.log(`  not_for_them among scrollers, in pick order ${report.not_for_them[name].in_pick_order}, at random ${report.not_for_them[name].random}`);
  }
  report.drain_by_temper = Object.fromEntries(Object.entries(drains).map(([temper, values]) => [temper, { answers: values.length, drain: round(mean(values)) }]));
  console.log('drain by temper:', report.drain_by_temper);

  // B. The same 100 people of a pool, all glad in the same way, about every text of a preset.
  for (const [name, { preset, pool, text }] of Object.entries({ ...DULL, ...TEXTS, ...PLAIN })) {
    const people = crowdOf(pool).filter((who) => who.id % 100 === 3);
    const about = { presetId: preset, text, people, reactionOf: () => FIXED_DID[preset], pool, versionId: 'probe' };
    const row = (report.fixed[name] = { preset });
    await Promise.all((preset === 'post' ? ['hook', 'comment'] : ['hook']).map(async (question) => {
      const sides = await inBothOrders(question, about);
      row[question] = { ...bothLists(sides, question, preset), halves_apart: halvesApart(sides.listed.answers, people.map((who) => who.id)) };
      console.log(`${name}, ${question}: ${sideLine(row[question].listed)} | reversed: ${sideLine(row[question].reversed)}`);
    }));
  }

  // C. The text checks alone, one request per text, beside what the opening requests of A said.
  const cases = checkCases();
  const key = (one) => `${one.preset} ${one.text}`;
  const alone = new Map();
  await eachLimit([...new Map(cases.map((one) => [key(one), one])).values()], 8, async (one) => {
    alone.set(key(one), openingAnswers((await send(checksOnly(one.preset, one.text))).answers).checks);
  }, (one, error) => {
    if (error.fatal) throw error;
    console.warn('  checks failed:', one.name, error.message);
  });
  report.checks = cases.map((one) => ({ check: one.check, text: one.name, preset: one.preset, yes: one.yes, alone: alone.get(key(one))?.[one.check] ?? null, in_opening: sites[one.name]?.checks[one.check] ?? null }));
  for (const one of report.checks) console.log(`${one.check.padEnd(12)} ${(one.yes ? 'yes' : 'no').padEnd(4)} alone ${one.alone}, in the opening ${one.in_opening}  ${one.text}`);

  report.gates = townGates(report);
  console.log(JSON.stringify(report.gates, null, 1));
  await save('town', report);
}

/** The gates of the town step, from its report. A question or check that fails one is dropped or rewritten before it ships. */
function townGates({ site, fixed, checks }) {
  const dull = Object.keys(DULL);
  const lists = (name, list) => site[name].lists[list];
  const everyOrder = (test) => ORDERS.every(test);
  const gates = {};

  // 1. Those who scrolled past a dull text are not all put down to the wrong audience: at least 5 of 6, in each order.
  const notAudience = ORDERS.map((order) => dull.filter((name) => {
    const top = topOf(lists(name, 'scrolled')?.[order]);
    return top && top !== 'not_for_them';
  }).length);
  gates.why_scrolled = { dull_texts_led_by_another_reason: notAudience, pass: notAudience.every((count) => count >= 5) };

  // 2. Spam and the scam listing annoy by distrust, rage by something else, in each order.
  const sorryTop = (name, order) => topOf(lists(name, 'sorry')?.[order]);
  gates.why_sorry = {
    tops: Object.fromEntries(['spam', 'listing_scam', 'rage'].map((name) => [name, ORDERS.map((order) => sorryTop(name, order))])),
    pass: everyOrder((order) => sorryTop('spam', order) === 'distrust' && sorryTop('listing_scam', order) === 'distrust' && ![null, 'distrust'].includes(sorryTop('rage', order))),
  };

  // 3. The split line: dull texts put more of the passing down to the text than strong ones do, by more than the order moves it.
  const textShares = (names) => names.map((name) => ORDERS.map((order) => lists(name, 'scrolled')?.[order]?.text_share)).filter((pair) => pair.every((share) => share != null));
  const dullShare = mean(textShares(dull).map(mean));
  const strongShare = mean(textShares(Object.keys(TEXTS)).map(mean));
  const orderShift = mean(textShares(Object.keys(site)).map(([a, b]) => Math.abs(a - b)));
  gates.split_line = { dull: round(dullShare), strong: round(strongShare), order_shift: round(orderShift), pass: dullShare - strongShare > orderShift };

  // 4. hook and comment tell texts apart by more than twice the noise of the order and of halving the people.
  gates.hook_comment = {};
  for (const [question, presets] of [['hook', Object.keys(PRESETS)], ['comment', ['post']]]) {
    for (const presetId of presets) {
      const rows = Object.values(fixed).filter((row) => row.preset === presetId && row[question] && ORDERS.every((order) => row[question][order]?.real >= 50)).map((row) => row[question]);
      const between = [];
      for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) for (const order of ORDERS) between.push(distance(rows[i][order].shares, rows[j][order].shares));
      const noise = Math.max(mean(rows.map((row) => distance(row.listed.shares, row.reversed.shares))), mean(rows.map((row) => row.halves_apart)));
      gates.hook_comment[`${question}.${presetId}`] = { texts: rows.length, between: round(mean(between)), noise: round(noise), pass: rows.length >= 2 && mean(between) > 2 * noise };
    }
  }
  const posts = Object.values(fixed).filter((row) => row.preset === 'post' && row.hook);
  const ledByOpening = ORDERS.map((order) => posts.filter((row) => topOf(row.hook[order]) === 'opening').length);
  gates.hook_opening = { post_texts: posts.length, led_by_opening: ledByOpening, drop: ledByOpening.every((count) => count > posts.length / 2) };

  // 5. A question whose drain takes more than half of those asked on more than half of its texts says too little.
  const drains = {};
  for (const { lists: byList } of Object.values(site)) {
    const byQuestion = {};
    for (const [list, both] of Object.entries(byList)) {
      for (const order of ORDERS) {
        const side = both[order];
        if (!side) continue;
        const sum = (byQuestion[questionOfList(list)] ??= { drained: 0, asked: 0 });
        sum.drained += side.drain * side.asked;
        sum.asked += side.asked;
      }
    }
    for (const [question, { drained, asked }] of Object.entries(byQuestion)) (drains[question] ??= []).push(drained / asked);
  }
  gates.drain = Object.fromEntries(Object.entries(drains).map(([question, values]) => [question, { texts: values.length, drained: values.filter((value) => value > 0.5).length, drop: values.filter((value) => value > 0.5).length > values.length / 2 }]));

  // 6. Every text check answers yes and no where it should, and mostly outside 0.3 to 0.7, per wording.
  const byWording = {};
  for (const one of checks) {
    const wording = typeof TEXT_CHECKS[one.check].ask === 'string' ? one.check : `${one.check}.${one.preset}`;
    for (const p of [one.alone, one.in_opening]) if (p != null) (byWording[wording] ??= []).push({ yes: one.yes, p });
  }
  gates.checks = Object.fromEntries(Object.entries(byWording).map(([wording, answers]) => {
    const right = answers.filter(({ yes, p }) => (yes ? p >= 0.5 : p < 0.5)).length;
    const clear = answers.filter(({ p }) => p < 0.3 || p > 0.7).length;
    return [wording, { answers: answers.length, right, clear, pass: right === answers.length && clear >= answers.length * 0.75 }];
  }));
  return gates;
}

/** Descriptions an author might write; the last two name nothing the town knows and should give no_fit. */
const AUDIENCES = [
  { pool: 'en', text: 'people who work in IT and are into startups' },
  { pool: 'en', text: 'tech founders of early-stage B2B SaaS' },
  { pool: 'en', text: 'people over 60' }, // does Jev name their work too?
  { pool: 'en', text: 'parents of toddlers' },
  { pool: 'uk', text: 'пенсіонери, які мають город' },
  { pool: 'uk', text: 'студенти-айтівці' },
  { pool: 'en', text: 'left-handed people', none: true },
  { pool: 'en', text: 'everybody', none: true },
];
const SAMPLE = { members: 100, near: 100, far: 200 };

/** Jev asked, with the description as the state, whether each person is one of the people it is about → Map(id → yes). */
async function fitsOf(description, personas) {
  const yes = new Map();
  await eachLimit(chunk(personas, PER_REQUEST), 8, async (batch) => {
    const questions = Object.fromEntries(batch.map((who) => [questionId(who), { type: 'noul', instructions: `${personaLine(who, { market: true })}. Is this person one of the people the description is about?`, criteria: { true: 'Yes', false: 'No' } }]));
    const result = await send({ state: { seen_in: 'an author describing, in their own words, the readers a text is written for', audience: description }, questions });
    for (const who of batch) yes.set(who.id, result.answers[questionId(who)]?.noul ?? 0);
  }, (batch, error) => {
    if (error.fatal) throw error;
    console.warn('  batch failed:', error.message);
  });
  return yes;
}

/**
 * Each description rated twice: do the parts and the members hold? Then Jev's own reading of 100 members,
 * 100 near misses (they fit every counting part but one) and 200 others, for precision and an estimate of recall.
 */
async function audience() {
  const rows = [];
  for (const { pool, text, none } of AUDIENCES) {
    const town = crowdOf(pool);
    const [first, second] = [await rateAudience(send, text), await rateAudience(send, text)];
    const sizes = [first, second].map((rated) => (rated.parts ? audienceOf(town, rated.parts).length : 0));
    const row = { pool, text, expected: none ? 'no_fit' : 'fits', named: first.named, parts: first.parts, sizes, holds: JSON.stringify(first.parts) === JSON.stringify(second.parts), unlisted: first.unlisted };
    console.log(`\n"${text}" (${pool}): named ${first.named.join(', ') || 'nothing'}, parts ${JSON.stringify(first.parts)}, ${sizes.join(' then ')} fit${row.holds ? '' : ' (the second reading differs)'}${none ? ', expected no_fit' : ''}`);
    if (first.parts && sizes[0] >= MIN_AUDIENCE) {
      const members = audienceOf(town, first.parts);
      const inside = new Set(members.map((who) => who.id));
      const parts = Object.entries(first.parts);
      // Near misses fit every counting part but one; with a single part, that is everybody else.
      const near = town.filter((who) => !inside.has(who.id) && parts.filter(([part, values]) => audienceOf([who], { [part]: values }).length).length === parts.length - 1);
      const nearIds = new Set(near.map((who) => who.id));
      const far = town.filter((who) => !inside.has(who.id) && !nearIds.has(who.id));
      const random = rng(hash32('audience', text));
      const sample = (people, count) => shuffled(people, random).slice(0, count);
      const asked = { members: sample(members, SAMPLE.members), near: sample(near, SAMPLE.near), far: sample(far, SAMPLE.far) };
      const yes = await fitsOf(text, Object.values(asked).flat());
      const rate = (people) => (people.length ? mean(people.map((who) => ((yes.get(who.id) ?? 0) >= 0.5 ? 1 : 0))) : 0);
      const rates = Object.fromEntries(Object.entries(asked).map(([name, people]) => [name, round(rate(people))]));
      const truePositives = rates.members * members.length;
      const falseNegatives = rates.near * near.length + rates.far * far.length;
      Object.assign(row, { rates, counts: { members: members.length, near: near.length, far: far.length }, precision: rates.members, recall: round(truePositives / Math.max(1, truePositives + falseNegatives)) });
      console.log(`  Jev says yes to ${percent(rates.members)} of members, ${percent(rates.near)} of near misses (${near.length} in town), ${percent(rates.far)} of the rest (${far.length}); recall about ${percent(row.recall)}`);
    }
    rows.push(row);
  }
  const noFit = rows.filter((row) => row.expected === 'no_fit');
  console.log(`\nno_fit where expected: ${noFit.filter((row) => !row.parts).length} of ${noFit.length}; parts held on a second reading: ${rows.filter((row) => row.holds).length} of ${rows.length}`);
  await save('audience', rows);
}

const steps = { attributes, batch, presets, crowd: wholeCrowd, waves, calibrate, throughput, 'first-waves': firstWaves, memory, town, audience };
const wanted = process.argv.slice(2);
if (!wanted.length || wanted.some((name) => !steps[name])) {
  console.log(`usage: node --env-file=.env.local scripts/probe.js <${Object.keys(steps).join('|')}> ...`);
  process.exit(1);
}
console.log(`Jev via ${provider.label}, budget $${BUDGET_USD}`);
for (const name of wanted) {
  console.log(`\n== ${name}`);
  await steps[name]();
  console.log(`spent so far: $${spend.usd.toFixed(4)}, ${spend.tokens} tokens, ${spend.requests} requests, ${spend.throttled} throttled`);
}
