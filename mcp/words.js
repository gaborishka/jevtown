// The sentences an agent reads in a tool's answer, in English or Ukrainian. Whatever the post page
// already says comes from public/i18n.js, so the MCP server names groups and results as the site
// does; this file holds only the sentences the site never needs.
import { DICTIONARIES } from '../public/i18n.js';
import { INTEREST, AGE_GROUP, BUDGET, SHOP, POOLS } from '../public/shared/vocab.js';

const CITY = Object.fromEntries(Object.values(POOLS).flatMap((pool) => pool.cities.map(([en, uk]) => [en, { en, uk }])));

/** 'interest', 'gardening' → "into gardening" or «цікавляться: садівництво», by the rule of groupLabel in public/app.js. */
export function groupLabel(lang, attribute, value) {
  const t = DICTIONARIES[lang];
  const label = {
    interest: () => INTEREST[value]?.[lang],
    field: () => t.fields[value],
    age: () => AGE_GROUP[value]?.[lang],
    temper: () => t.tempers[value],
    budget: () => BUDGET[value]?.[lang],
    shopping: () => SHOP[value]?.[lang],
    city: () => CITY[value]?.[lang] ?? value,
  }[attribute]?.();
  return label ? t.segments[attribute](label) : `${attribute}: ${value}`;
}

const signed = (value) => {
  const rounded = Number(value.toFixed(2)) || 0;
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(2)}`;
};
const sentence = (words) => (/[.!?]$/.test(words) ? words : `${words}.`);
const money = (usd, digits) => `$${usd.toFixed(digits)}`;
// Ukrainian needs the wave's ordinal in two cases: "passed the second wave" and "of the second wave".
const NTH = {
  en: ['first', 'second', 'third', 'fourth'],
  uk: { passed: ['першу', 'другу', 'третю', 'четверту'], of: ['першої', 'другої', 'третьої', 'четвертої'] },
};
const listOf = (items, and) => (items.length < 2 ? String(items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)}`);
/** A variant as a summary line quotes it: the start of its text. */
export const startOf = (text, chars = 40) => (text.length > chars ? `${text.slice(0, chars).trimEnd()}…` : text);

const WORDS = {
  en: {
    cutByWaves: (wave) => `It got past the ${NTH.en[wave]} wave; this check was set to stop there.`,
    cutByTime: (wave, seconds) => `It got past the ${NTH.en[wave]} wave; the next one would not have finished within ${seconds} s, so the check stopped there.`,
    incomplete: (answered, asked, wave, n) => `Jev answered for only ${n(answered)} of ${n(asked)} people in the ${NTH.en[wave]} wave, so this check says nothing about the text. Try again later.`,
    blocked: (reasons) => `The site would not post this text: ${reasons}. The town did not read it.`,
    unlisted: (reasons) => `On the site it would stay out of the public feed: ${reasons}.`,
    failed: (count) => `Requests that failed: ${count}; their people count as not shown.`,
    cost: ({ requests, cached, usd, seconds }) => `Cost: ${requests} request${requests === 1 ? '' : 's'} to Jev${cached ? ` (${cached} from this server's memory)` : ''}, ${money(usd, 4)}, ${Math.round(seconds)} s.`,
    budget: ({ spentUsd, limitUsd }) => (limitUsd ? `Spent by this server today: ${money(spentUsd, 2)} of ${money(limitUsd, 2)}.` : `Spent by this server today: ${money(spentUsd, 2)}; it has no daily limit.`),
    first: (variant, mood, goesOn) => `Variant ${variant} ranks first: glad minus sorry in its first wave is ${signed(mood)} on average, and it ${goesOn ? 'travels on' : 'stops there'}.`,
    tooClose: (variants) => `Variants ${listOf(variants, 'and')} are too close to call: their first-wave moods differ by less than the draw can move them.`,
    noneRanked: 'No variant could be ranked.',
    row: (variant, start, goesOn, mood, margin) => `${variant}. "${start}": ${goesOn ? 'travels on' : 'stops'}, mood ${signed(mood)} (±${margin.toFixed(2)})`,
    rowBlocked: (variant, start, reasons) => `${variant}. "${start}": the site would not post it: ${reasons}`,
    rowError: (variant, start, error) => `${variant}. "${start}": not ranked: ${error}`,
  },
  uk: {
    cutByWaves: (wave) => `Текст пройшов ${NTH.uk.passed[wave]} хвилю; ця перевірка мала на ній зупинитися.`,
    cutByTime: (wave, seconds) => `Текст пройшов ${NTH.uk.passed[wave]} хвилю; наступна не встигла б за ${seconds} с, тож перевірка на цьому зупинилась.`,
    incomplete: (answered, asked, wave, n) => `Jev відповів лише за ${n(answered)} із ${n(asked)} ${asked % 10 === 1 && asked % 100 !== 11 ? 'людини' : 'людей'} ${NTH.uk.of[wave]} хвилі, тож ця перевірка нічого не каже про текст. Спробуйте пізніше.`,
    blocked: (reasons) => `Сайт не опублікував би цей текст: ${reasons}. Місто його не читало.`,
    unlisted: (reasons) => `На сайті він не потрапив би до спільної стрічки: ${reasons}.`,
    failed: (count) => `Запитів не вдалося: ${count}; їхні люди рахуються як ті, кому текст не показали.`,
    cost: ({ requests, cached, usd, seconds }) => `Коштувало: запитів до Jev ${requests}${cached ? ` (з пам’яті цього сервера ${cached})` : ''}, ${money(usd, 4)}, ${Math.round(seconds)} с.`,
    budget: ({ spentUsd, limitUsd }) => (limitUsd ? `Цей сервер сьогодні витратив ${money(spentUsd, 2)} із ${money(limitUsd, 2)}.` : `Цей сервер сьогодні витратив ${money(spentUsd, 2)}; денного ліміту немає.`),
    first: (variant, mood, goesOn) => `Першим іде варіант ${variant}: настрій першої хвилі в середньому ${signed(mood)}, ${goesOn ? 'і текст іде далі' : 'але далі текст не йде'}.`,
    tooClose: (variants) => `Варіанти ${listOf(variants, 'і')} надто близькі, щоб обрати: їхній настрій першої хвилі різниться менше, ніж його може зсунути жереб.`,
    noneRanked: 'Жоден варіант не потрапив до рейтингу.',
    row: (variant, start, goesOn, mood, margin) => `${variant}. «${start}»: ${goesOn ? 'іде далі' : 'далі не йде'}, настрій ${signed(mood)} (±${margin.toFixed(2)})`,
    rowBlocked: (variant, start, reasons) => `${variant}. «${start}»: сайт не опублікував би його: ${reasons}`,
    rowError: (variant, start, error) => `${variant}. «${start}»: без місця в рейтингу: ${error}`,
  },
};

/** Moderation reason ids → the site's words for them. */
export const reasonsIn = (lang, ids) => ids.map((id) => DICTIONARIES[lang].blocked.reasons[id] ?? id).join(', ');

/** The headline of a check_text result, or null when the check says nothing about the text. */
export function verdictOf(lang, report, { maxSeconds }) {
  const t = DICTIONARIES[lang];
  const words = WORDS[lang];
  const last = report.waves.length - 1;
  return {
    blocked: () => words.blocked(reasonsIn(lang, report.blocked)),
    incomplete: () => null,
    stopped: () => t.verdict.stopped(report.stoppedAt),
    everyone: () => t.verdict.everyone,
    cut_by_waves: () => words.cutByWaves(last),
    cut_by_time: () => words.cutByTime(last, maxSeconds),
  }[report.status]();
}

/**
 * check_text's answer in words: one sentence per line, the numbers behind them are in the JSON.
 * incompleteAt: the index of the wave Jev answered too little of, when the status is incomplete.
 */
export function summary(lang, report, { incompleteAt } = {}) {
  const t = DICTIONARIES[lang];
  const words = WORDS[lang];
  const lines = [];
  if (report.status === 'incomplete') {
    const wave = report.waves[incompleteAt];
    lines.push(words.incomplete(wave.answered, wave.people, incompleteAt, t.n));
  } else if (report.status === 'blocked') lines.push(report.verdict);
  else lines.push(`${sentence(report.verdict)} ${t.verdict.reached(report.reach, report.town)} ${t.verdict.balance(report.counters.glad, report.counters.sorry)}`);
  if (report.unlisted.length && report.status !== 'blocked') lines.push(words.unlisted(reasonsIn(lang, report.unlisted)));
  const best = report.demand?.best;
  if (best) lines.push(t.blocks.bestPrice(`${report.demand.currency}${t.n(best.price)}`, best.buyers, `${report.demand.currency}${t.n(best.revenue)}`));
  return [...lines, ...spending(lang, report)].join('\n');
}

/** What a call cost, what failed on the way and what is left of the day's budget. */
function spending(lang, { cost, budget }) {
  const words = WORDS[lang];
  return [cost.failedBatches ? words.failed(cost.failedBatches) : null, words.cost(cost), words.budget(budget)].filter(Boolean);
}

/** compare_texts' answer in words: who ranks first, who is too close to call, then every variant on a line. */
export function compareSummary(lang, report, texts) {
  const words = WORDS[lang];
  const rows = report.rows;
  const lines = [];
  const [first] = report.ranking;
  if (first === undefined) lines.push(words.noneRanked);
  else {
    lines.push(words.first(first + 1, rows[first].expectedMood, rows[first].travels));
    const close = rows.filter((row) => row.closeToBest).map((row) => row.index + 1);
    if (close.length) lines.push(words.tooClose([first + 1, ...close]));
  }
  const unranked = rows.filter((row) => !report.ranking.includes(row.index));
  for (const row of [...report.ranking.map((index) => rows[index]), ...unranked]) {
    const start = startOf(texts[row.index]);
    if (report.ranking.includes(row.index)) lines.push(words.row(row.index + 1, start, row.travels, row.expectedMood, row.margin));
    else if (row.blocked.length) lines.push(words.rowBlocked(row.index + 1, start, reasonsIn(lang, row.blocked)));
    else lines.push(words.rowError(row.index + 1, start, row.error));
  }
  return [...lines, ...spending(lang, report)].join('\n');
}
