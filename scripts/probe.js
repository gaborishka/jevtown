// Step 0 of the plan: measurements with a real key, before any interface exists.
//   node --env-file=.env.local scripts/probe.js attributes batch presets crowd waves
// Raw numbers go to data/probe/*.json (not committed); the conclusions are in docs/measurements.md.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { crowd, withAttributes } from '../public/shared/personas.js';
import { PRESETS, priceLadder } from '../public/shared/presets.js';
import { reactionRequest, followUpRequest, exposureRequest, exposureScores, questionId } from '../public/shared/requests.js';
import { pickProvider, ask, eachLimit } from '../public/shared/jev.js';
import { firstWave, nextWave, travels, mood, exposure, WAVES } from '../public/shared/feed.js';
import { drawReaction } from '../public/shared/draw.js';
import { rng } from '../public/shared/rng.js';

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

const steps = { attributes, batch, presets, crowd: wholeCrowd, waves, calibrate, throughput, 'first-waves': firstWaves, memory };
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
