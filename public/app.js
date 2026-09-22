// The interface. On the left a person writes, on the right the crowd reacts: a feed of posts with
// the map of their audience, a post page where a check runs wave by wave, a page for every persona,
// a map of the whole crowd. No framework and no build step. The browser also drives a check: it
// asks the Worker for one batch of the running wave after another and paints what comes back.
import { DICTIONARIES } from './i18n.js';
import { createGrid, drawStill } from './grid.js';
import { createShowcase } from './showcase.js';
import { drawCard } from './card.js';
import { crowd, poolFor, interestHome, GRID, CROWD } from './shared/personas.js';
import { PRESETS, LOOKS, REASONS, LISTS, lookOf, questionOfList, priceLadder } from './shared/presets.js';
import { counters, segments, topSegments, biggestSegments, mostAnnoyed, rankedAnswers, demandCurve, voicesOf, listView, whySplit, readCheck, DRAIN_NOTE_FROM } from './shared/summary.js';
import { checksFor } from './shared/requests.js';
import { travels, WAVES } from './shared/feed.js';
import { unit } from './shared/rng.js';
import { CARDS, CARD } from './shared/quiz.js';
import { residentsOf, pickCards, scores, QUIZ_REACTIONS, TUNE_CARDS, TEST_CARDS, NAME_CHARS, PLACE_CHARS, ABOUT_CHARS, MAX_INTERESTS } from './shared/resident.js';
import { INTERESTS, INTEREST, INTEREST_COLUMNS, FIELDS, JOBS, JOB, AGE_GROUPS, AGE_GROUP, TEMPERS, TEMPER, BUDGETS, BUDGET, SPEND, SHOP, POOLS } from './shared/vocab.js';

const BATCHES_AT_ONCE = 6;
const BATCH_ATTEMPTS = 4;
const WATCH_EVERY_MS = 2500;
const VOICES_IN_CARD = 2;
const VOICES_AT_ONCE = 8;
const TICKER_EVERY_MS = 2800;
const TICKER_LINES = 4;
const MAX_CHARS = 2000;
const STALE_RUN_MS = 10 * 60 * 1000; // the Worker gives up on a check after this long, and so does a visitor watching it
const ASKING_EVERY_MS = 5000;
const ASKING_WAIT_MS = 3 * 60 * 1000; // another close holds the asking for two minutes at most (worker/town.js:ASKING_MS)

/** localStorage that never throws: with site data blocked the page must still open. */
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};

let lang = store.get('lang') ?? (/^(uk|ru)/.test(navigator.language) ? 'uk' : 'en');
let t = DICTIONARIES[lang];
let leave = () => {}; // what the current view must stop doing when the visitor goes elsewhere
let writeNext = false; // "Write" in the menu: the composer takes the cursor once the front page is there

// -- small things

/** h('div', { class: 'x', onclick }, child, 'text') → element. Text always goes in as text. */
function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (name.startsWith('aria-')) {
      element.setAttribute(name, String(value)); // aria-checked="false" is a state, not an absent attribute
      continue;
    }
    if (value === false) continue;
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name === 'class') element.className = value;
    else if (name in element && name !== 'list') element[name] = value;
    else element.setAttribute(name, value === true ? '' : value);
  }
  element.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

/** replaceChildren that skips what a condition left empty. */
const put = (element, ...children) => element.replaceChildren(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attributes = {}, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

const ICONS = {
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  crowd: ['M5 4.5v.01M12 4.5v.01M19 4.5v.01M5 12v.01M12 12v.01M19 12v.01M5 19.5v.01M12 19.5v.01M19 19.5v.01'],
  pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  eye: ['M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  focus: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  heart: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z'],
  repeat: ['M17 1l4 4-4 4', 'M3 11V9a4 4 0 0 1 4-4h14', 'M7 23l-4-4 4-4', 'M21 13v2a4 4 0 0 1-4 4H3'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  bag: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  cursor: ['M4 4l6.5 16 2.3-6.9L20 10.5z'],
  block: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M4.9 4.9l14.2 14.2'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  back: ['M19 12H5', 'M12 19l-7-7 7-7'],
  replay: ['M1 4v6h6', 'M3.5 15a9 9 0 1 0 2.1-9.4L1 10'],
  tag: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z', 'M7 7h.01'],
  type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
  globe: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  arrow: ['M7 17 17 7', 'M8 7h9v9'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  check: ['M20 6 9 17l-5-5'],
  picture: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8.5 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', 'M21 15l-5-5L5 21'],
};
const SPREADS_ICON = { post: 'repeat', listing: 'message', product: 'bag', headline: 'cursor' };

function icon(name, size = 18) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'icon', 'aria-hidden': 'true' }, ...ICONS[name].map((d) => svg('path', { d })));
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error?.message ?? response.statusText), { code: body.error?.code ?? 'error', status: response.status, reasons: body.error?.reasons ?? [] });
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percent = (share) => (share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`);
const clip = (text, length) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);
const ago = (iso) => t.ago(Math.max(0, Date.now() - new Date(iso).getTime()));

/**
 * A town is its 10,000 computed people and, after them, the people visitors moved in; the Worker
 * says who lives in those houses. The id of a person is their place in this list.
 */
const computed = {};
let towns = {};
let houses = Object.fromEntries(Object.keys(POOLS).map((pool) => [pool, []]));
const crowdOf = (pool) => (towns[pool] ??= (computed[pool] ??= crowd(pool)).concat(residentsOf(pool, houses[pool] ?? [])));
const whoIs = (pool, id) => crowdOf(pool)[id];
const townSize = (pool) => CROWD + (houses[pool]?.length ?? 0); // without building the town: the composer asks on every keystroke
const homePool = () => (lang === 'uk' ? 'uk' : 'en');
async function loadTown() {
  const fresh = await api('/api/residents').catch(() => null);
  if (!fresh) return;
  houses = fresh;
  towns = {};
}
const cityLabels = Object.fromEntries(Object.values(POOLS).flatMap((pool) => pool.cities.map(([english, ukrainian]) => [english, { en: english, uk: ukrainian }])));

/** What the Worker keeps of a check: the reaction of every persona, the wave that reached it, its follow-up answer. */
const crowdCache = new Map();
async function fetchCrowd(post, number, fresh = false) {
  const key = `${post.id}/${number}`;
  if (!fresh && crowdCache.has(key)) return crowdCache.get(key);
  const response = await fetch(`/api/reactions/${key}`, fresh ? { cache: 'no-store' } : {});
  if (!response.ok) throw new Error(`reactions ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const size = Math.floor(bytes.length / 3); // the town as it was when the text was posted
  if (size > crowdOf(post.pool).length) await loadTown(); // somebody has moved in since this page opened
  const part = (n) => bytes.slice(size * n, size * (n + 1));
  const data = { reactions: part(0), waves: part(1), answers: part(2) };
  if (!fresh) crowdCache.set(key, data);
  return data;
}

/** A number that counts up to its new value. */
function countTo(element, value, ms = 700) {
  const from = Number(element.dataset.value ?? 0);
  element.dataset.value = value;
  cancelAnimationFrame(element.frame);
  if (from === value || !(ms > 0) || matchMedia('(prefers-reduced-motion: reduce)').matches) return (element.textContent = t.n(value));
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / ms);
    element.textContent = t.n(from + (value - from) * (1 - (1 - progress) ** 3));
    if (progress < 1) element.frame = requestAnimationFrame(step);
  };
  element.frame = requestAnimationFrame(step);
}

/** 'interest:gardening' or a segment → words in the visitor's language. */
function groupLabel(attribute, value) {
  const label = {
    interest: () => INTEREST[value]?.[lang],
    field: () => t.fields[value],
    age: () => AGE_GROUP[value]?.[lang],
    temper: () => t.tempers[value],
    budget: () => BUDGET[value]?.[lang],
    shopping: () => SHOP[value]?.[lang],
    city: () => cityLabels[value]?.[lang] ?? value,
  }[attribute]?.();
  return label ? t.segments[attribute](label) : `${attribute}: ${value}`;
}

const IN_GROUP = {
  interest: (who, value) => who.interests.includes(value),
  field: (who, value) => who.field === value,
  age: (who, value) => who.ageGroup === value,
  temper: (who, value) => who.temper === value,
  budget: (who, value) => who.budget === value,
  shopping: (who, value) => who.shopping === value,
  city: (who, value) => who.city.en === value,
};
const groupMask = (pool, attribute, value) => Uint8Array.from(crowdOf(pool), (who) => (IN_GROUP[attribute]?.(who, value) ? 1 : 0));

const personaTitle = (who) => `${who.name[lang]}, ${who.age}`;
const personaLine = (who) => [who.job ? JOB[who.job][lang] : who.jobText, who.city[lang]].filter(Boolean).join(', '); // a resident may name a job of their own, or none
const reactionWord = (reaction, who) => t.reactions[reaction]?.[who ? (who.gender === 'female' ? 2 : 1) : 0] ?? reaction;
const dayOf = (date) => new Date(date).toLocaleDateString(lang, { day: 'numeric', month: 'long' });
const hueOf = (interest) => (INTERESTS.findIndex((item) => item.id === interest) * 47) % 360;

// -- faces

/** An author is a person: a square of nine dots, colored by the name. */
function authorAvatar(name, size = 40) {
  const lit = [LOOKS.stopped, LOOKS.glad, LOOKS.spreads, LOOKS.sorry];
  const dots = Array.from({ length: 9 }, (_, i) => {
    const color = unit('face', name, i) < 0.45 ? lit[Math.floor(unit('face-color', name, i) * lit.length)] : LOOKS.scrolled;
    return svg('circle', { cx: 8 + (i % 3) * 8, cy: 8 + Math.floor(i / 3) * 8, r: 2.7, fill: color });
  });
  return svg('svg', { viewBox: '0 0 32 32', width: size, height: size, class: 'face author', 'aria-hidden': 'true' }, svg('rect', { width: 32, height: 32, rx: 9, fill: '#161b24' }), ...dots);
}

/** A persona is a dot of the crowd: a disc in the colour of its district, with what it did as a smaller dot. */
function personaAvatar(who, look) {
  return h('span', { class: 'face persona', style: `--h:${hueOf(who.interests[0])}`, 'aria-hidden': 'true' }, who.name[lang][0], look && h('i', { class: look === 'hollow' ? 'dot hollow' : 'dot', style: `--c:${LOOKS[look]}` }));
}

// -- moving around

function go(path) {
  const depth = history.state?.depth ?? 0; // how many pages of this site are behind: a Back link leads there, not to a fixed page
  history.replaceState({ depth, y: window.scrollY }, ''); // where the visitor was, for the way back
  history.pushState({ depth: depth + 1 }, '', path);
  route();
}

// -- the tooltip over a map

const tip = document.getElementById('tip');
function showTip(lines, at) {
  if (!lines) return (tip.hidden = true);
  tip.replaceChildren(...lines.filter(Boolean).map((line, i) => h(i ? 'span' : 'b', {}, line)));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, at.x + 14))}px`;
  tip.style.top = `${Math.max(8, at.y - box.height - 10)}px`;
}

/** A name on a map, over the place where people of that interest live; near an edge it grows inwards. */
function mapLabel(interest) {
  const home = interestHome(interest);
  return h('span', { class: home.x > 76 ? 'to-left' : home.x < 24 ? 'to-right' : '', style: `left:${home.x}%;top:${home.y}%` }, INTEREST[interest][lang]);
}

function legend() {
  return h('ul', { class: 'legend' }, ...Object.entries(LOOKS).map(([look, color]) => h('li', {}, h('i', { class: look === 'hollow' ? 'dot hollow' : 'dot', style: `--c:${color}` }), t.looks[look])));
}

// -- what the crowd says

/** The follow-up answer of one persona in words: a buyer's question, or a step of the price ladder. */
function answerWords(presetId, options, byte, reaction = null) {
  if (!byte) return null;
  if (presetId === 'listing') {
    const key = Object.keys(PRESETS.listing.followUp.answers)[byte - 1];
    // Two of the prepared answers describe a buyer instead of quoting one.
    return key && { key, text: t.voices[key] ?? (t.answers ?? PRESETS.listing.followUp.answers)[key], quote: !t.voices[key] };
  }
  if (presetId === 'product' && options?.prices) {
    const { prices, currency } = options;
    const step = byte - 1;
    // The reaction and the price are two draws; somebody who bought is not quoted as refusing every price.
    if (step === 0 && PRESETS.product.reactions[reaction]?.tone === 1) return null;
    const cost = `${currency}${prices[step - 1]}`;
    return { key: `p${step}`, text: step === 0 ? t.ladder.none : step === 1 ? t.ladder.upTo(cost) : step === prices.length ? t.ladder.even(cost) : t.ladder.at(cost), quote: false };
  }
  return null;
}

/**
 * Who answered what when the town was asked at the end of a check: the first of these lists that
 * holds a person gives their answer. → Map(personId → { list, id })
 */
function answeredBy(said) {
  const by = new Map();
  for (const list of ['scrolled', 'sorry', 'hook', 'comment']) {
    for (const [answer, ids] of Object.entries(said?.picks?.[list] ?? {})) for (const id of ids) if (!by.has(id)) by.set(id, { list, id: answer });
  }
  return by;
}
const saidWords = (answer) => answer && t.said.labels[questionOfList(answer.list)]?.[answer.id];

/** A person quoted under a post. `reply` is their answer when the town was asked, in words: it follows what they did. */
function voice(pool, presetId, options, entry, answers, { tag = 'li', reply = null } = {}) {
  const who = whoIs(pool, entry.id);
  if (!who) return null;
  const answer = answerWords(presetId, options, answers?.[entry.id], entry.reaction);
  const said = answer && (answer.quote ? [entry.reaction === 'wrote' ? '' : `${t.voices.wouldAsk[who.gender === 'female' ? 2 : 1]}: `, h('q', {}, answer.text)] : [answer.text]);
  return h(tag, { class: 'voice' },
    h('a', { href: `/u/${pool}/${entry.id}`, 'data-link': true, class: 'voice-link' }, // the card around it lets clicks on links through
      personaAvatar(who, entry.look),
      h('span', { class: 'voice-body' },
        h('span', { class: 'voice-who' }, h('b', {}, personaTitle(who)), h('span', { class: 'dim' }, ` · ${personaLine(who)}`)),
        h('span', { class: 'voice-did' }, h('em', { style: `--c:${LOOKS[entry.look === 'hollow' ? 'scrolled' : entry.look]}` }, reactionWord(entry.reaction, who)), reply && ` · ${reply}`, said && h('span', { class: 'voice-said' }, ' · ', ...said)))));
}

// -- the composer

const KIND_ICON = { post: 'pen', listing: 'tag', product: 'bag', headline: 'type' };
const CURRENCIES = ['₴', '$', '€', '£'];
const FIRST_PRICES = { uk: [199, 299, 449, 649], en: [9, 15, 24, 39] };
const MAX_PRICES = 6;

/** '1 200', '1,000', '12,50' and '12.5' are all prices; anything else is not. */
function priceOf(raw) {
  const cleaned = raw.replace(/[\s\u00a0']/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const price = Number(cleaned);
  return cleaned && Number.isFinite(price) && price > 0 && price < 1e7 ? price : null;
}

/**
 * The composer is a post in the making: the same face and name as in the feed, the text, and a bar
 * of tools under it. What is being written (a post, a listing, a product, a headline) is a tool of
 * that bar, the way a poll is in other networks: picking Product opens the prices inside the draft.
 */
function composer({ post = null, presetId = 'post', pool = null, text = '', options = {}, unlisted = false, onCancel } = {}) {
  let preset = presetId;
  let currencyTouched = Boolean(options.currency);
  let pricesTouched = Boolean(options.prices);
  const fallbackPool = lang === 'uk' ? 'uk' : 'en';
  const readerPool = () => pool ?? poolFor(area.value, fallbackPool);
  let steps = (options.prices ?? FIRST_PRICES[pool ?? fallbackPool]).map(String);

  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const area = h('textarea', { name: 'text', rows: 3, maxLength: MAX_CHARS, required: true, value: text, 'aria-label': t.compose.text, oninput: typed });
  const currency = h('select', { name: 'currency', class: 'currency', 'aria-label': t.compose.currency, onchange: () => ((currencyTouched = true), paintLadder()) },
    ...[...new Set([...CURRENCIES, options.currency].filter(Boolean))].map((sign) => h('option', { value: sign }, sign)));
  currency.value = options.currency ?? (readerPool() === 'uk' ? '₴' : '$');
  const ladderSteps = h('div', { class: 'ladder-steps' });
  const ladder = h('fieldset', { class: 'ladder',
    // Leaving the ladder puts the prices in order, cheap to dear: the Worker sorts them anyway, and the page should show what runs.
    onfocusout: (event) => {
      if (ladder.contains(event.relatedTarget)) return;
      const prices = steps.map(priceOf);
      if (prices.includes(null) || prices.every((price, index) => !index || price > prices[index - 1])) return;
      steps = [...steps].sort((a, b) => priceOf(a) - priceOf(b));
      paintLadder();
    } },
    h('legend', {}, icon('tag', 15), t.compose.ladder.title[0], currency, t.compose.ladder.title[1]),
    ladderSteps,
    h('p', { class: 'ladder-note' }, t.compose.ladder.note));
  const nickname = h('input', { name: 'nickname', class: 'nickname', maxLength: 32, value: store.get('nickname') ?? '', placeholder: t.compose.nickname, autocomplete: 'nickname', 'aria-label': t.compose.nickname, oninput: () => face.replaceChildren(authorAvatar(nickname.value.trim() || 'anonymous', 40)) });
  const listed = h('input', { type: 'checkbox', name: 'listed', checked: !unlisted && store.get('listed') !== 'no', disabled: unlisted }); // a post that left the feed does not come back to it
  const submit = h('button', { type: 'submit', class: 'primary' }, post ? t.compose.again : t.compose.go);
  // A radio group the way a keyboard expects it: one tab stop, arrows move the choice.
  const modes = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': t.compose.kind, onkeydown: (event) => {
    const ids = Object.keys(PRESETS);
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (post || (!move && event.key !== 'Home' && event.key !== 'End')) return;
    event.preventDefault();
    preset = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : ids[(ids.indexOf(preset) + move + ids.length) % ids.length];
    paint();
    modes.querySelector('.on').focus();
  } });
  const readers = h('span', { class: 'readers' });
  const promise = h('span', { class: 'promise' });
  const left = h('span', { class: 'left', hidden: true });
  const face = h('div', { class: 'composer-face' }, authorAvatar(nickname.value.trim() || 'anonymous', 40));

  /** Swaps the words of a line with a flip; a class set twice in a row would not replay the animation. */
  function say(line, words) {
    if (line.textContent === words) return;
    line.textContent = words;
    line.classList.remove('flip');
    void line.offsetWidth;
    line.classList.add('flip');
  }

  function typed() {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
    area.style.overflowY = area.scrollHeight > area.clientHeight + 4 ? 'auto' : 'hidden'; // a long placeholder must not bring a scrollbar
    say(readers, t.compose.readers[readerPool()](townSize(readerPool())));
    // The currency follows the crowd only while the ladder is untouched: 249 typed as hryvnias must never turn into $249.
    if (!currencyTouched && !pricesTouched && currency.value !== (readerPool() === 'uk' ? '₴' : '$')) {
      currency.value = readerPool() === 'uk' ? '₴' : '$';
      steps = FIRST_PRICES[readerPool()].map(String); // hryvnia prices are not dollar prices
      paintLadder();
    }
    left.hidden = area.value.length < MAX_CHARS * 0.8;
    left.textContent = `${area.value.length} / ${MAX_CHARS}`;
  }

  function paintLadder() {
    ladderSteps.replaceChildren(
      ...steps.map((value, index) => {
        const input = h('input', { inputMode: 'decimal', value, maxLength: 9, 'aria-label': t.compose.ladder.price(index + 1), autocomplete: 'off', style: `width:${Math.max(2, value.length) + 0.4}ch`,
          oninput: () => {
            pricesTouched = true;
            steps[index] = input.value;
            input.style.width = `${Math.max(2, input.value.length) + 0.4}ch`;
            chip.classList.remove('bad');
            input.removeAttribute('aria-invalid');
          },
          // Enter in a price is "the next price", not "publish".
          onkeydown: (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const next = ladderSteps.querySelectorAll('input')[index + 1];
            if (next) next.select();
            else if (steps.length < MAX_PRICES) addStep();
          } });
        const chip = h('label', { class: 'price' }, h('span', { class: 'sign' }, currency.value), input,
          steps.length > 2 && h('button', { type: 'button', class: 'price-remove', 'aria-label': t.compose.ladder.remove, title: t.compose.ladder.remove, onclick: () => {
            pricesTouched = true;
            steps.splice(index, 1);
            paintLadder();
            ladderSteps.querySelectorAll('input')[Math.min(index, steps.length - 1)]?.focus(); // the button is gone; the cursor stays in the ladder
          } }, icon('x', 12)));
        return chip;
      }),
      steps.length < MAX_PRICES && h('button', { type: 'button', class: 'price-add', onclick: addStep }, icon('plus', 14), t.compose.ladder.add));
  }

  function addStep() {
    pricesTouched = true;
    steps.push(String(Number(((priceOf(steps.at(-1) ?? '') || 10) * 1.5).toPrecision(2))));
    paintLadder();
    ladderSteps.querySelectorAll('input')[steps.length - 1]?.select();
  }

  /** The prices as the crowd will get them, or null with the wrong chips marked. */
  function readPrices() {
    const inputs = [...ladderSteps.querySelectorAll('input')];
    const prices = steps.map(priceOf);
    prices.forEach((price, index) => {
      const wrong = price === null || prices.indexOf(price) !== index;
      inputs[index]?.closest('.price').classList.toggle('bad', wrong);
      if (wrong) inputs[index]?.setAttribute('aria-invalid', 'true');
    });
    const good = [...new Set(prices.filter((price) => price !== null))].sort((a, b) => a - b);
    return good.length >= 2 && good.length === steps.length ? good : null;
  }

  function paint() {
    form.className = ['composer', `kind-${preset}`, post && 'editing'].filter(Boolean).join(' ');
    modes.replaceChildren(...Object.keys(PRESETS).filter((id) => !post || id === preset).map((id) => h('button', {
      type: 'button', role: 'radio', class: id === preset ? `mode kind-${id} on` : `mode kind-${id}`, 'aria-checked': id === preset, 'aria-label': t.presets[id].name, 'data-tip': t.presets[id].hint, tabIndex: id === preset ? 0 : -1, disabled: Boolean(post),
      onclick: () => ((preset = id), paint(), area.focus()) }, icon(KIND_ICON[id], 17), h('span', {}, t.presets[id].name))));
    area.placeholder = t.presets[preset].placeholder;
    say(promise, t.presets[preset].promise);
    ladder.hidden = preset !== 'product';
  }

  const form = h('form', { novalidate: true, onsubmit: send,
    oninput: () => (problem.hidden = true), // what was wrong is being fixed
    onkeydown: (event) => event.key === 'Enter' && (event.metaKey || event.ctrlKey) && (event.preventDefault(), form.requestSubmit()) },
    h('div', { class: 'draft-head' }, face,
      h('div', { class: 'draft-by' }, nickname,
        h('label', { class: 'visibility' }, listed,
          h('span', { class: 'when-on' }, icon('globe', 13), t.compose.listed),
          h('span', { class: 'when-off' }, icon('link', 13), t.compose.unlisted)))),
    h('div', { class: 'draft-body' }, area), ladder, problem,
    h('div', { class: 'composer-bar' }, modes, h('span', { class: 'grow' }), left,
      onCancel && h('button', { type: 'button', class: 'quiet', onclick: onCancel }, t.compose.cancel), submit),
    h('p', { class: 'readers-line' }, h('i', { class: 'live' }), readers, h('span', { class: 'sep' }, '·'), promise));
  paint();
  paintLadder();
  queueMicrotask(typed);

  async function send(event) {
    event.preventDefault();
    if (submit.disabled) return;
    problem.hidden = true;
    if (!area.value.trim()) {
      problem.textContent = t.errors.empty;
      problem.hidden = false;
      return area.focus();
    }
    const prices = preset === 'product' ? readPrices() : null;
    if (preset === 'product' && !prices) {
      problem.textContent = t.errors.bad_prices;
      problem.hidden = false;
      ladderSteps.querySelector('.bad input')?.focus();
      return;
    }
    submit.disabled = true;
    submit.classList.add('busy');
    submit.style.minWidth = `${submit.offsetWidth}px`; // the bar does not jump when the words change
    submit.textContent = t.compose.busy;
    say(promise, t.run.scoring);
    store.set('nickname', nickname.value.trim());
    store.set('listed', listed.checked ? 'yes' : 'no');
    try {
      const body = { preset, pool: readerPool(), text: area.value, nickname: nickname.value, listed: listed.checked, post: post ?? undefined };
      if (prices) Object.assign(body, { prices, currency: currency.value });
      const started = await api('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (form.isConnected) go(`/p/${started.post}?v=${started.number}`); // a visitor who went elsewhere meanwhile stays there
    } catch (error) {
      problem.textContent = error.code === 'blocked' ? t.blocked.text(error.reasons.map((reason) => t.blocked.reasons[reason]).filter(Boolean)) : t.errors[error.code] ?? t.errors.error;
      problem.hidden = false;
      submit.disabled = false;
      submit.classList.remove('busy');
      submit.textContent = post ? t.compose.again : t.compose.go;
      say(promise, t.presets[preset].promise);
    }
  }
  return form;
}

// -- a post as the feed shows it

function statsRow(presetId, totals, { big = false } = {}) {
  const kinds = Object.entries(PRESETS[presetId].reactions);
  const spreadsKey = kinds.find(([, reaction]) => reaction.spreads)?.[0];
  const glad = kinds.filter(([, reaction]) => reaction.tone === 1).map(([key]) => key);
  const twin = glad.length === 1 && glad[0] === spreadsKey; // a headline: the only good thing is a click, and one number is not shown twice
  const items = [
    ['reach', 'eye', totals.reach, t.counters.reach],
    ['stopped', 'focus', totals.stopped, t.counters.stopped],
    ['glad', 'heart', totals.glad, t.counters.glad],
    ['spreads', SPREADS_ICON[presetId], totals.byReaction?.[spreadsKey], reactionWord(spreadsKey)],
    ['sorry', 'block', totals.sorry, t.counters.sorry],
  ].filter(([name]) => !(twin && name === 'glad'));
  const numbers = {};
  const row = h('div', { class: big ? 'stats big' : 'stats' }, ...items.map(([name, iconName, value, label]) => {
    numbers[name] = h('b', { class: value == null ? 'pending' : '', 'data-value': big ? 0 : value ?? 0 }, value == null ? '' : big ? '0' : t.n(value)); // the feed does not know this number: it comes with the crowd
    return h('span', { class: `stat ${name}`, title: label, role: 'group', 'aria-label': label }, icon(iconName, big ? 20 : 16), numbers[name], h('span', { class: 'stat-label' }, label));
  }));
  row.reset = () => Object.values(numbers).forEach((number) => (number.dataset.value = 0));
  row.update = (fresh, ms) => {
    const values = { reach: fresh.reach, stopped: fresh.stopped, glad: fresh.glad, spreads: fresh.byReaction?.[spreadsKey] ?? 0, sorry: fresh.sorry };
    for (const [name, value] of Object.entries(values)) {
      if (!numbers[name]) continue;
      numbers[name].classList.remove('pending');
      countTo(numbers[name], value, ms);
    }
  };
  return row;
}

function postHead(post, createdAt) {
  return h('div', { class: 'post-head' },
    authorAvatar(post.nickname),
    h('div', { class: 'post-by' },
      h('b', {}, post.nickname === 'anonymous' ? t.compose.anonymous : post.nickname),
      h('span', { class: 'dim' }, ` · ${ago(createdAt)}`)),
    h('span', { class: `badge kind-${post.preset}` }, t.presets[post.preset].name));
}

// -- the front page

function home(view, restoreY = 0) {
  let alive = true;
  let feedRun = 0;
  let sort = 'latest';
  let cards = [];
  let focused = null;
  let composing = false;
  let hoverTimer = 0;
  let scrollTimer = 0;
  let tickerTimer = 0;
  let touched = false;
  let passing = []; // who is in the ticker now, so nobody passes by twice in a row
  let voicesOn = null; // the card whose people the ticker shows

  const timeline = h('div', { class: 'timeline' });
  const totals = h('span', { class: 'totals dim' });
  const sortTabs = h('div', { class: 'feed-tabs', role: 'group', 'aria-label': t.feed.order });
  const gridHost = h('div', {});
  const caption = h('div', { class: 'rail-caption' });
  const ticker = h('ul', { class: 'ticker' });
  const tickerTitle = h('h3', { class: 'rail-sub', hidden: true }, t.rail.voices); // no voices until somebody has posted
  const rail = h('aside', { class: 'rail' },
    h('div', { class: 'rail-in' },
      h('div', { class: 'rail-head' }, h('h2', {}, t.rail.title), h('span', { class: 'rail-size' }, h('i', { class: 'live' }), t.rail.size(townSize(homePool())))),
      gridHost, caption, legend(),
      tickerTitle, ticker));
  const grid = createGrid(gridHost, {
    hint: t.mapKeys,
    label: `${t.rail.title}: ${t.rail.size(townSize(homePool()))}`,
    onHover(personaId, at) {
      if (personaId === null || !focused?.data) return showTip(null);
      const who = whoIs(focused.post.pool, personaId);
      if (!who) return showTip(null);
      const byte = focused.data.reactions[personaId];
      showTip([personaTitle(who), personaLine(who), byte ? reactionWord(Object.keys(PRESETS[focused.post.preset].reactions)[byte - 1], who) : t.looks.dark], at);
    },
    onPick: (personaId) => focused && go(`/u/${focused.post.pool}/${personaId}`),
  });
  // Beside the feed the map is always in sight; on a phone it lives under the composer and scrolls away. Nothing is painted into a map nobody sees.
  let railSeen = false;
  let painted; // the card the map shows now; undefined until the first picture
  const replayed = new Set(); // posts whose crowd has already gathered wave by wave: the second look is instant

  function paintRail() {
    if (!railSeen || painted === focused) return;
    painted = focused;
    grid.people(townSize(focused?.post.pool ?? homePool()));
    if (!focused) {
      hush();
      grid.wait(true);
      grid.describe(`${t.rail.title}: ${t.rail.size(townSize(homePool()))}`);
      return put(caption, h('div', { class: 'caption-wait' }, h('b', {}, t.rail.waiting), h('p', { class: 'dim' }, t.rail.waitingNote)));
    }
    const { post, data } = focused;
    grid.wait(false);
    if (replayed.has(post.id)) grid.setAll(post.preset, data.reactions);
    else grid.replay(post.preset, data.reactions, data.waves, { gap: 420, spread: 420 });
    replayed.add(post.id);
    grid.describe(t.post.picture(post));
    put(caption,
      h('a', { class: 'caption-post', href: `/p/${post.id}`, 'data-link': true },
        postHead(post, post.createdAt), h('p', { class: 'caption-text' }, clip(post.snippet, 120))));
    tick(); // the voices change together with the map
  }
  const railWatch = new IntersectionObserver((entries) => {
    railSeen = entries.at(-1).isIntersecting; // several changes can arrive at once: the last one is how things are now
    paintRail();
  });
  railWatch.observe(gridHost);

  /** The map shows the crowd of one post at a time: the one the visitor looks at. */
  function focus(card) {
    if (!alive || composing || !card?.data || card === focused) return;
    focused?.element.classList.remove('focused');
    focused = card;
    card.element.classList.add('focused');
    paintRail();
  }

  function waitForText() {
    focused?.element.classList.remove('focused');
    focused = null;
    paintRail();
  }

  function nearest() {
    const line = window.innerHeight * 0.4;
    let best = null;
    let bestDistance = Infinity;
    for (const card of cards) {
      if (!card.data) continue;
      const box = card.element.getBoundingClientRect();
      if (box.bottom < 60 || box.top > window.innerHeight) continue;
      const distance = Math.abs((box.top + box.bottom) / 2 - line);
      if (distance < bestDistance) [best, bestDistance] = [card, distance];
    }
    return best;
  }

  // The map follows the post the eye has settled on, not every post a fast scroll flies past.
  const onScroll = () => {
    touched = true;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => focus(nearest()), 200);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  /** A card asks for its crowd when it comes near the screen. */
  const near = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      near.unobserve(entry.target);
      cards.find((card) => card.element === entry.target)?.load();
    }
  }, { rootMargin: '700px 0px' });

  function postCard(post, index) {
    const canvas = h('canvas', { class: 'card-map', 'aria-hidden': 'true' });
    const stats = statsRow(post.preset, post);
    const voices = h('ul', { class: 'card-voices' });
    // The whole card is clickable for a mouse; a keyboard goes through the link on its text, so there is one tab stop, not two.
    const element = h('article', { class: 'card', style: `--i:${Math.min(index, 8)}`,
      onclick: (event) => !event.target.closest('a') && !getSelection()?.toString() && go(`/p/${post.id}`),
      onfocusin: () => ((touched = true), focus(card)),
      onpointerenter: () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => ((touched = true), focus(card)), 140);
      },
      onpointerleave: () => clearTimeout(hoverTimer) },
      postHead(post, post.createdAt),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-main' },
          h('a', { class: 'card-text', href: `/p/${post.id}`, 'data-link': true }, post.snippet.length >= 280 ? `${post.snippet}…` : post.snippet),
          post.versions > 1 && h('p', { class: 'card-note' }, t.feed.versions(post.versions))),
        canvas),
      stats, voices);
    const card = {
      post, element, data: null,
      async load() {
        const data = await fetchCrowd(post, post.version).catch(() => null);
        if (!alive || !data) return;
        card.data = data;
        drawStill(canvas, post.preset, data.reactions);
        canvas.classList.add('ready');
        stats.update(counters(post.preset, Object.keys(PRESETS[post.preset].reactions), data.reactions), 0);
        card.voices = voicesOf(post.id, post.preset, data.reactions).slice(0, 40);
        put(voices, card.voices.slice(0, VOICES_IN_CARD).map((entry) => voice(post.pool, post.preset, null, entry, data.answers)));
        if (!touched || !focused) focus(nearest() ?? card); // until the visitor moves, the map follows the post closest to the eye
      },
    };
    return card;
  }

  async function load() {
    sortTabs.replaceChildren(...['latest', 'top'].map((id) => h('button', { type: 'button', class: id === sort ? 'feed-tab on' : 'feed-tab', 'aria-pressed': id === sort, onclick: () => ((sort = id), load()) }, t.feed[id])));
    const mine = ++feedRun;
    const feed = await api(`/api/feed?sort=${sort}`).catch(() => ({ posts: [], totals: { posts: 0, reach: 0 } }));
    if (!alive || mine !== feedRun) return; // a newer choice of the tab is already on its way
    near.disconnect();
    focused = null;
    painted = undefined; // the cards are new: whatever the map shows belongs to none of them
    cards = feed.posts.map(postCard);
    put(timeline, cards.length ? cards.map((card) => card.element) : h('p', { class: 'empty' }, t.feed.empty));
    cards.forEach((card) => near.observe(card.element));
    totals.textContent = feed.totals.posts ? t.feed.totals(feed.totals.posts, feed.totals.reach) : '';
    if (!cards.length) waitForText();
    if (restoreY) window.scrollTo(0, restoreY); // back from a post: to the place in the feed the visitor left
    restoreY = 0;
  }

  /** Under the map pass the people of the same post the map shows, one after another, each with what they did with it. */
  function tick() {
    if (!alive || document.hidden || !railSeen || !focused?.voices?.length) return;
    if (voicesOn !== focused) {
      voicesOn = focused;
      passing = [];
      ticker.replaceChildren();
      for (let line = 1; line < TICKER_LINES; line++) pass(); // another post: its people are here at once, not one by one
    }
    pass();
  }

  function pass() {
    const { post, voices, data } = focused;
    const entry = voices[Math.floor(Math.random() * voices.length)];
    if (passing.includes(entry.id)) return;
    passing = [entry.id, ...passing].slice(0, TICKER_LINES);
    tickerTitle.hidden = false;
    ticker.prepend(voice(post.pool, post.preset, null, entry, data.answers));
    while (ticker.children.length > TICKER_LINES) ticker.lastChild.remove();
  }

  function hush() {
    voicesOn = null;
    tickerTitle.hidden = true;
    ticker.replaceChildren();
  }
  tickerTimer = setInterval(tick, TICKER_EVERY_MS);
  const firstTick = setTimeout(tick, 900);

  const form = composer();
  const startComposing = () => {
    if (composing) return;
    composing = true;
    waitForText();
  };
  form.addEventListener('focusin', startComposing);
  form.addEventListener('input', startComposing);
  form.addEventListener('focusout', (event) => {
    if (form.contains(event.relatedTarget)) return;
    composing = false;
    focus(nearest());
  });

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  const write = () => {
    form.scrollIntoView({ behavior: calm, block: 'center' });
    form.querySelector('textarea').focus({ preventScroll: true });
  };
  const showcase = createShowcase({ h, icon, t });
  const hero = h('section', { class: 'hero' },
    h('header', { class: 'hero-copy' },
      h('p', { class: 'eyebrow' }, t.hero.eyebrow),
      h('h1', {}, t.hero.title[0], ' ', h('span', {}, t.hero.title[1])),
      h('p', { class: 'lead' }, t.lead),
      h('div', { class: 'hero-actions' },
        h('button', { type: 'button', class: 'primary', onclick: write }, t.hero.write, icon('arrow', 16)),
        h('button', { type: 'button', class: 'hero-demo', onclick: () => {
          showcase.play();
          showcase.element.scrollIntoView({ behavior: calm, block: showcase.element.offsetHeight > window.innerHeight * 0.8 ? 'start' : 'center' }); // on a phone the example is taller than the screen
        } }, icon('replay', 16), t.hero.demo))),
    showcase.element);

  view.replaceChildren(h('div', { class: 'front' }, hero,
    h('div', { class: 'page home' },
      h('section', { class: 'column' }, form, h('div', { class: 'feed-head' }, sortTabs, totals), timeline),
      rail)));
  load();
  if (writeNext) {
    writeNext = false;
    setTimeout(write, 60);
  }

  return () => {
    alive = false;
    grid.destroy();
    showcase.destroy();
    near.disconnect();
    railWatch.disconnect();
    clearInterval(tickerTimer);
    clearTimeout(firstTick);
    clearTimeout(hoverTimer);
    clearTimeout(scrollTimer);
    window.removeEventListener('scroll', onScroll);
    showTip(null);
  };
}

// -- the post page

function bars(rows, onFocus) {
  const most = Math.max(...rows.map((row) => row.value), 1e-9);
  return h('ul', { class: 'bars' }, ...rows.map((row, index) => h('li', { class: [row.flag && 'flagged', row.lead && 'lead'].filter(Boolean).join(' '), style: `--i:${index}`, onpointerenter: row.group && (() => onFocus?.(row.group)), onpointerleave: row.group && (() => onFocus?.(null)) },
    h('span', { class: 'bar-label' }, row.label), h('span', { class: 'bar-value' }, row.text),
    h('span', { class: 'bar' }, h('i', { style: `--w:${Math.max(2, (row.value / most) * 100)}%;background:${row.color ?? LOOKS.stopped}` })),
    row.note && h('span', { class: 'bar-note' }, row.note))));
}

/** How many people a text has reached once wave `index` is over: the same numbers the stepper shows. */
const reachAfter = (index) => Math.min(CROWD, WAVES.slice(0, index + 1).reduce((sum, wave) => sum + (wave.size === Infinity ? CROWD : wave.size), 0));

function block(title, note, ...content) {
  return h('section', { class: 'block' }, h('h3', {}, title), note && h('p', { class: 'hint' }, note), ...content);
}

function postPage(view, post) {
  let alive = true;
  if (!post) {
    view.replaceChildren(h('div', { class: 'page single' }, h('p', { class: 'problem' }, t.errors.not_found)));
    return () => {};
  }
  const wanted = Number(new URLSearchParams(location.search).get('v'));
  let version = post.versions.find((candidate) => candidate.number === wanted) ?? post.versions.findLast((candidate) => candidate.state === 'done') ?? post.versions.at(-1);
  const preset = PRESETS[post.preset];
  const keys = Object.keys(preset.reactions);
  let reactions = new Uint8Array(crowdOf(post.pool).length);
  let waves = new Uint8Array(reactions.length);
  let answers = new Uint8Array(reactions.length);
  let only = null; // the reaction picked among the chips: the map and the voices show these people alone
  let singled = false; // whether the map is showing that group now
  let audience = 'stopped';
  let townTab = null; // the list of what the town said that is open; it stays open when the blocks are painted again
  let answered = answeredBy(version.summary?.said);
  let voicesShown = VOICES_AT_ONCE;

  const gridHost = h('div', {});
  const labels = h('div', { class: 'grid-labels', 'aria-hidden': 'true' });
  const status = h('p', { class: 'status', role: 'status' });
  const stepper = h('ol', { class: 'stepper' });
  const stats = statsRow(post.preset, { reach: 0, stopped: 0, glad: 0, sorry: 0, byReaction: {} }, { big: true });
  const chips = h('div', { class: 'chips' });
  const blocks = h('div', { class: 'blocks' });
  const article = h('article', { class: 'post-full' });

  const grid = createGrid(gridHost, {
    hint: t.mapKeys,
    onHover(personaId, at) {
      if (personaId === null) return showTip(null);
      const who = whoIs(post.pool, personaId);
      if (!who) return showTip(null);
      const byte = reactions[personaId];
      const reply = saidWords(answered.get(personaId));
      showTip([personaTitle(who), personaLine(who), byte ? `${reactionWord(keys[byte - 1], who)}${reply ? ` · ${reply}` : ''}` : t.looks.dark, answerWords(post.preset, version.options, answers[personaId])?.text], at);
    },
    onPick: (personaId) => go(`/u/${post.pool}/${personaId}`),
  });

  const onlyMask = () => only && Uint8Array.from(reactions, (byte) => (byte && keys[byte - 1] === only ? 1 : 0));
  const focusGroup = (group) => grid.focusOn(group ? groupMask(post.pool, ...group) : onlyMask());
  const focusPeople = (ids) => {
    if (!ids) return grid.focusOn(onlyMask());
    const mask = new Uint8Array(reactions.length);
    for (const id of ids) mask[id] = 1;
    grid.focusOn(mask);
  };

  /** One sentence of the result for a list of what the town said: its leading answer, the few about equal, or none. */
  function saidSentence(key, view) {
    const words = t.verdict.asked[key][view.lead.kind];
    if (view.lead.kind === 'none') return words;
    const labels = view.lead.ids.map((id) => t.said.labels[key === 'hook' ? 'hook' : 'why'][id]);
    return words(view.lead.kind === 'one' ? labels[0] : t.and(labels));
  }

  /** Jev's yes or no about the text itself, apart from the town. Whether the author wrote like an AI is for the author's eyes only. */
  function checksBlock() {
    const rows = checksFor(post.preset).filter(([id]) => version.checks?.[id] != null && (id !== 'ai' || post.mine)).map(([id]) => {
      const value = readCheck(version.checks[id]);
      const label = typeof t.checks.labels[id] === 'string' ? t.checks.labels[id] : t.checks.labels[id][post.preset];
      return { id, row: h('li', { class: value === 'unclear' ? 'unclear' : '' }, h('span', {}, label), h('b', {}, t.checks.values[value])) };
    });
    return rows.length > 0 && h('section', { class: 'text-checks', 'aria-label': t.checks.title },
      h('p', { class: 'eyebrow' }, t.checks.title),
      h('ul', { class: 'checks' }, rows.map((item) => item.row)),
      rows.at(-1).id === 'ai' && h('p', { class: 'dim' }, t.checks.onlyYou),
      h('p', { class: 'hint' }, t.checks.note));
  }

  function paintArticle() {
    const tabs = post.versions.length > 1 && h('div', { class: 'versions' }, ...post.versions.map((candidate) => h('button', { type: 'button', class: candidate.number === version.number ? 'version on' : 'version', onclick: () => go(`/p/${post.id}?v=${candidate.number}`) }, `${t.version} ${candidate.number}`)));
    const previous = post.versions.find((candidate) => candidate.number === version.number - 1 && candidate.summary);
    const delta = previous && version.summary && h('p', { class: 'delta' }, `${t.blocks.versionDelta}: `, ...['reach', 'stopped', 'glad', 'sorry'].map((name) => {
      const change = version.summary.counters[name] - previous.summary.counters[name];
      return h('span', { class: change > 0 === (name !== 'sorry') ? 'up' : change ? 'down' : '' }, `${t.counters[name]} ${change > 0 ? '+' : ''}${t.n(change)}`);
    }));
    const share = copyLink(`/p/${post.id}`);
    const editor = h('div', { class: 'editor' });
    const edit = post.mine && version.state === 'done' && h('button', { type: 'button', class: 'quiet', onclick: () => {
      edit.hidden = true;
      editor.replaceChildren(composer({ post: post.id, presetId: post.preset, pool: post.pool, text: version.text, options: version.options, unlisted: !post.listed, onCancel: () => (editor.replaceChildren(), (edit.hidden = false)) }));
      editor.querySelector('textarea').focus();
    } }, icon('pen', 16), h('span', {}, t.compose.edit));
    document.title = `${clip(version.text, 60)} · ${t.brand}`;
    // What the check showed, in words, before the numbers. The wave that did not let the text through decides the headline, not the balance of reactions.
    const totals = version.state === 'done' && version.summary?.counters;
    const stoppedAt = version.waves.findIndex((wave, index) => !wave.travels && index < WAVES.length - 1);
    const said = version.summary?.said;
    const asked = [['passed', 'scrolled'], ['annoyed', 'sorry'], ['hook', 'hook']].map(([key, list]) => [key, listView(said, list, post.preset)]).filter(([, view]) => view).map(([key, view]) => saidSentence(key, view));
    const verdict = totals && h('section', { class: stoppedAt >= 0 ? 'verdict stopped' : 'verdict', 'aria-label': t.verdict.label },
      h('p', { class: 'eyebrow' }, t.verdict.label),
      h('h2', {}, stoppedAt >= 0 ? t.verdict.stopped(stoppedAt) : t.verdict.everyone),
      h('p', {}, t.verdict.reached(totals.reach, reactions.length), ' ', t.verdict.balance(totals.glad, totals.sorry)),
      asked.length > 0 && h('p', {}, asked.join(' ')),
      stoppedAt >= 0 && h('p', { class: 'dim' }, t.verdict.why));
    const comparison = previous && h('details', { class: 'compare' }, h('summary', {}, t.compare.title),
      h('div', { class: 'compare-columns' },
        h('article', {}, h('b', {}, `${t.compare.previous} · ${t.version} ${previous.number}`), h('p', {}, previous.text)),
        h('article', {}, h('b', {}, `${t.compare.current} · ${t.version} ${version.number}`), h('p', {}, version.text))));
    put(article,
      postHead(post, version.createdAt), tabs,
      h('p', { class: 'post-text' }, version.text),
      version.options.prices && h('p', { class: 'asked-prices' }, h('span', { class: 'dim' }, t.compose.prices), ...version.options.prices.map((price) => h('span', { class: 'price-tag' }, h('i', {}, version.options.currency), t.n(price)))),
      !post.listed && h('p', { class: 'hint' }, version.unlisted.length ? t.blocks.unlisted : t.blocks.hiddenByAuthor),
      verdict, checksBlock(), delta, comparison, h('div', { class: 'post-actions' }, totals && h('button', { type: 'button', class: 'quiet', onclick: () => showCard(post, version, reactions) }, icon('picture', 16), h('span', {}, t.card.open)), share, edit), editor);
  }

  /** How far the text went: a step per wave, then the follow-up question. */
  function paintStepper() {
    let reach = 0;
    const stoppedAt = version.waves.findIndex((wave, index) => !wave.travels && index < WAVES.length - 1);
    const steps = WAVES.map((wave, index) => {
      reach = Math.min(CROWD, reach + (wave.size === Infinity ? CROWD : wave.size));
      const done = version.waves[index];
      const running = version.stage?.kind === 'wave' && version.stage.index === index;
      const state = done ? (done.travels || index === WAVES.length - 1 ? 'passed' : 'stopped') : running ? 'running' : stoppedAt >= 0 || (version.state === 'done' && !done) ? 'never' : 'pending';
      return h('li', { class: `step ${state}`, title: done ? t.run.moodNote(`${done.mood > 0 ? '+' : ''}${done.mood.toFixed(2)}`) : null, onpointerenter: done && (() => grid.focusOn(Uint8Array.from(waves, (wave) => (wave === index + 1 ? 1 : 0)))), onpointerleave: done && (() => focusGroup(null)) },
        h('i', { class: 'step-dot' }), h('b', {}, reach === CROWD ? t.post.everyone : t.n(reach)),
        // What the wave decided, in words; the number behind it is in the tooltip. After the last wave there is nothing to decide.
        h('span', { class: 'step-note' }, done && index < WAVES.length - 1 ? (done.travels ? t.run.went : t.run.stayed) : ' '));
    });
    if (preset.followUp) {
      const running = version.stage?.kind === 'followup';
      const asked = version.summary?.followUp?.asked;
      steps.push(h('li', { class: `step ask ${asked ? 'passed' : running ? 'running' : version.state === 'done' ? 'never' : 'pending'}` }, h('i', { class: 'step-dot' }), h('b', {}, t.post.asking[post.preset]), h('span', { class: 'step-note' }, asked ? t.n(asked) : ' ')));
    }
    put(stepper, steps);
  }

  // A chip per reaction is made once and then only recounted: during a run batches arrive several
  // times a second, and a button rebuilt under the pointer cannot be clicked.
  const chipOf = new Map(keys.map((key) => {
    const count = h('b', {}, '0');
    const chip = h('button', { type: 'button', class: 'chip', style: `--c:${LOOKS[lookOf(post.preset, key)]}`, hidden: true, title: t.post.filter, 'aria-pressed': false, onclick: () => {
      only = only === key ? null : key;
      voicesShown = VOICES_AT_ONCE;
      paintCounters(0);
      if (version.state === 'done') paintVoices();
    } }, h('i', { class: lookOf(post.preset, key) === 'hollow' ? 'dot hollow' : 'dot' }), reactionWord(key), count);
    return [key, { chip, count }];
  }));
  chips.append(...[...chipOf.values()].map((entry) => entry.chip));

  function paintCounters(ms) {
    const totals = counters(post.preset, keys, reactions);
    stats.update(totals, ms);
    for (const [key, { chip, count }] of chipOf) {
      chip.hidden = !totals.byReaction[key];
      chip.classList.toggle('on', key === only);
      chip.setAttribute('aria-pressed', String(key === only));
      count.textContent = t.n(totals.byReaction[key] ?? 0);
    }
    if (only || singled) grid.focusOn(onlyMask()); // people who arrive later join the group that is singled out
    singled = Boolean(only);
    grid.describe(t.post.picture(totals));
    return totals;
  }

  function paintLabels() {
    const homes = Object.entries(version.scores).filter(([group, score]) => group.startsWith('interest:') && score >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 4);
    // Districts that lie side by side would write their names over each other: the stronger one keeps its name.
    const placed = [];
    put(labels, homes.map(([group]) => group.slice('interest:'.length)).filter((interest) => {
      const home = interestHome(interest);
      const halfWidth = INTEREST[interest][lang].length * 0.85 + 2; // in percent of the map, near enough
      if (placed.some((other) => Math.abs(other.y - home.y) < 6 && Math.abs(other.x - home.x) < other.halfWidth + halfWidth)) return false;
      placed.push({ x: home.x, y: home.y, halfWidth });
      return true;
    }).map(mapLabel));
  }

  const voicesBlock = h('section', { class: 'block voices' });
  function paintVoices() {
    const found = voicesOf(post.id, post.preset, reactions, only, answered.size ? (id) => answered.has(id) : null);
    put(voicesBlock, h('h3', {}, t.voices.title, found.length > 0 && h('span', { class: 'count' }, t.voices.count(Math.min(voicesShown, found.length), found.total))), h('p', { class: 'hint' }, answered.size ? t.voices.noteSaid : t.voices.note),
      found.length ? h('ul', { class: 'voice-list' }, found.slice(0, voicesShown).map((entry) => voice(post.pool, post.preset, version.options, entry, answers, { reply: saidWords(answered.get(entry.id)) }))) : h('p', { class: 'dim' }, t.voices.nobody),
      found.length > voicesShown && h('button', { type: 'button', class: 'quiet wide', onclick: () => ((voicesShown += VOICES_AT_ONCE * 2), paintVoices()) }, t.voices.more));
  }

  function paintBlocks() {
    const totals = counters(post.preset, keys, reactions);
    const all = segments(post.preset, keys, reactions, crowdOf(post.pool));
    const views = { stopped: LOOKS.stopped, glad: LOOKS.glad, ...(totals.sorry >= 10 ? { sorry: LOOKS.sorry } : {}), shown: LOOKS.scrolled };
    if (!views[audience]) audience = 'stopped';
    const audienceBody = h('div', {});
    const audienceTabs = h('div', { class: 'seg' });
    const paintAudience = () => {
      put(audienceTabs, Object.keys(views).map((what) => h('button', { type: 'button', class: what === audience ? 'on' : '', 'aria-pressed': what === audience, onclick: () => ((audience = what), paintAudience()) }, t.blocks.tabs[what])));
      if (audience === 'shown') {
        const rows = Object.entries(version.scores).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([group, score]) => ({ label: groupLabel(...group.split(':')), value: score, text: score.toFixed(2), color: '#7c879b', group: group.split(':') }));
        return put(audienceBody, h('h3', {}, t.blocks.titles.shown), h('p', { class: 'hint' }, t.blocks.shownNote), bars(rows, focusGroup));
      }
      // A text that worked on everybody alike has no group above the crowd; the biggest groups are shown then, not an empty card.
      const standing = topSegments(all, audience, 7);
      const shownSegments = standing.length ? standing : biggestSegments(all, audience, 7);
      const rows = shownSegments.map((segment) => ({ label: groupLabel(segment.attribute, segment.value), value: segment[audience] / segment.size, text: percent(segment[audience] / segment.size), note: `${t.n(segment[audience])} / ${t.n(segment.size)}`, color: views[audience], group: [segment.attribute, segment.value] }));
      // Shares of whole groups favour the groups the feed showed the text to most; the most annoyed are counted over those who saw it.
      const annoyed = audience === 'sorry' && mostAnnoyed(all, totals, post.preset);
      put(audienceBody,
        h('h3', {}, t.blocks.titles[audience]),
        h('p', { class: 'hint' }, standing.length ? t.blocks.segmentNote(t.blocks.tabs[audience].toLowerCase(), percent(totals[audience] / reactions.length)) : t.blocks.alike),
        annoyed && h('p', { class: 'hint' }, t.blocks.annoyedGroup(groupLabel(annoyed.attribute, annoyed.value), annoyed.sorry, annoyed.reached)),
        rows.length ? bars(rows, focusGroup) : h('p', { class: 'dim' }, t.blocks.nobody));
    };
    paintAudience();
    const content = [h('section', { class: 'block' }, audienceTabs, audienceBody)];

    // What the town said when the check closed, a tab per list that has enough answers to show.
    const said = version.summary?.said;
    const lists = LISTS.map((list) => [list, listView(said, list, post.preset)]).filter(([, view]) => view);
    if (lists.length) {
      if (!lists.some(([list]) => list === townTab)) townTab = lists[0][0];
      const townTabs = h('div', { class: 'seg' });
      const townBody = h('div', {});
      const colorOf = (list, id) => (list === 'scrolled' ? (REASONS[id].audience ? '#7c879b' : LOOKS.stopped) : { sorry: LOOKS.sorry, hook: LOOKS.glad }[list] ?? LOOKS.stopped);
      const paintTown = () => {
        put(townTabs, lists.map(([list]) => h('button', { type: 'button', class: list === townTab ? 'on' : '', 'aria-pressed': list === townTab, onclick: () => ((townTab = list), paintTown()) }, t.said.tabs[list])));
        const view = lists.find(([list]) => list === townTab)[1];
        const words = t.said.labels[questionOfList(townTab)];
        const picks = said.picks?.[townTab] ?? {};
        const rows = view.rows.map((row) => ({ label: words[row.id], value: row.share, text: percent(row.share), color: colorOf(townTab, row.id), lead: view.lead.ids.includes(row.id), group: picks[row.id]?.length ? picks[row.id] : null }));
        const split = townTab === 'scrolled' && whySplit(view);
        put(townBody,
          h('h3', {}, t.said.titles[townTab]),
          h('p', { class: 'hint' }, [`${t.said.notes[townTab](view.asked)}${t.said.order}`, townTab === 'comment' && t.said.commentNote, t.said.point, view.lead.kind === 'none' ? t.said.flat : t.said.lead].filter(Boolean).join(' ')),
          bars(rows, focusPeople),
          view.drain >= DRAIN_NOTE_FROM && h('p', { class: 'dim' }, t.said.drain(percent(view.drain))),
          split && h('p', { class: 'dim' }, t.said.split(percent(split.text), percent(split.readers))));
      };
      paintTown();
      content.push(h('section', { class: 'block' }, townTabs, townBody));
    }

    const followUp = version.summary?.followUp;
    if (followUp?.asked && post.preset === 'listing') {
      const ranked = rankedAnswers({ ...followUp, answers: t.answers ?? preset.followUp.answers });
      content.push(block(t.blocks.questions, t.blocks.questionsNote(followUp.asked), bars(ranked.slice(0, 7).map((answer) => ({ label: answer.text, value: answer.share, text: percent(answer.share), color: LOOKS.spreads })))));
    }
    if (followUp?.asked && post.preset === 'product') {
      const { prices, currency } = version.options;
      const curve = demandCurve({ ...followUp, answers: priceLadder(prices, currency) }, prices);
      const best = curve.reduce((a, b) => (b.revenue > a.revenue ? b : a));
      content.push(block(t.blocks.demand, t.blocks.demandNote(followUp.asked), best.revenue > 0 && h('p', { class: 'best-price' }, t.blocks.bestPrice(`${currency}${t.n(best.price)}`, best.buyers, `${currency}${t.n(best.revenue)}`)), bars(curve.map((step) => ({ label: `${currency}${step.price}`, value: step.buyers, text: `${t.n(step.buyers)} ${t.blocks.buyers}`, note: `${t.blocks.revenue} ${currency}${t.n(step.revenue)}${step === best ? ` · ${t.blocks.best}` : ''}`, flag: step === best, color: LOOKS.glad })))));
    }
    paintVoices();
    put(blocks, content, voicesBlock);
  }

  async function askBatch(stage, n) {
    for (let attempt = 0; attempt < BATCH_ATTEMPTS && alive; attempt++) {
      try {
        return await api(`/api/batch?post=${post.id}&v=${version.number}&stage=${stage.stage}&n=${n}`);
      } catch (error) {
        if (error.status === 409) throw error;
        if (attempt < BATCH_ATTEMPTS - 1) await sleep(600 * 2 ** attempt * (0.75 + Math.random() / 2));
      }
    }
    return null;
  }

  /** Closes the running stage. While another close is asking the town, the Worker says so: wait and call again. */
  async function closeStage() {
    const until = Date.now() + ASKING_WAIT_MS;
    for (;;) {
      try {
        return await api(`/api/wave?post=${post.id}&v=${version.number}`);
      } catch (error) {
        if (error.code !== 'asking' || Date.now() > until) throw error;
        await sleep(ASKING_EVERY_MS);
        if (!alive) return null;
      }
    }
  }

  /** The author's browser runs the check: batches of the stage, then the Worker decides what is next. */
  async function drive() {
    let stage = version.stage;
    while (stage && alive) {
      version.stage = stage;
      paintStepper();
      status.textContent = stage.kind === 'wave' ? t.run.wave(stage.index, reachAfter(stage.index)) : t.run.followup(stage.people);
      const queue = [...Array(stage.batches).keys()];
      const drawn = [];
      const lane = async () => {
        while (queue.length && alive) {
          const batch = await askBatch(stage, queue.shift());
          if (batch?.ids && alive) {
            batch.ids.forEach((personaId, i) => {
              reactions[personaId] = batch.reactions[i];
              waves[personaId] = stage.index + 1;
              drawn.push(keys[batch.reactions[i] - 1]);
            });
            grid.arrive(post.preset, batch.ids, batch.reactions);
            paintCounters(900);
          }
        }
      };
      await Promise.all(Array.from({ length: BATCHES_AT_ONCE }, lane));
      if (!alive) return;
      // The close after the last stage asks the town a few more questions, and takes a few seconds.
      if (stage.kind === 'followup' || (!preset.followUp && (stage.index === WAVES.length - 1 || !travels(post.preset, drawn)))) status.textContent = t.run.asking;
      const closed = await closeStage();
      if (!closed) return;
      if (closed.wave && stage.kind === 'wave') {
        version.waves = [...version.waves.filter((wave) => wave.index !== closed.wave.index), closed.wave];
        status.textContent = `${t.run.wave(stage.index, reachAfter(stage.index))} · ${closed.done || closed.stage.kind !== 'wave' ? t.run.stops : t.run.travels}`;
      }
      if (closed.done) return finish(closed.version, true);
      stage = closed.stage;
      version.stage = stage;
      paintStepper();
      await sleep(900); // long enough to read what the wave decided
    }
  }

  /** Somebody else's running check: look again every few seconds. */
  async function watch() {
    status.textContent = t.run.watching;
    while (alive) {
      await sleep(WATCH_EVERY_MS);
      const fresh = await api(`/api/post/${post.id}`).catch(() => null);
      const now = fresh?.versions.find((candidate) => candidate.number === version.number);
      if (!now || !alive) continue;
      const stored = await fetchCrowd(post, version.number, true).catch(() => null); // one lost request is not the end of watching
      if (!stored || !alive) continue;
      const before = reactions;
      ({ reactions, waves, answers } = stored);
      const arrived = [];
      for (let personaId = 0; personaId < reactions.length; personaId++) if (reactions[personaId] && !before[personaId]) arrived.push(personaId);
      grid.arrive(post.preset, arrived, arrived.map((personaId) => reactions[personaId]));
      version = { ...now };
      paintStepper();
      paintCounters(900);
      if (now.state === 'done') return finish(now, true);
      if (Date.now() - new Date(now.createdAt) > STALE_RUN_MS) return (status.textContent = t.run.stale); // nobody drives it any more
    }
  }

  async function finish(done, live = false, countMs = 600) {
    post.versions = post.versions.map((candidate) => (candidate.number === done.number ? done : candidate));
    version = done;
    answered = answeredBy(done.summary?.said);
    if (live) {
      // The follow-up answers are written when the check closes; what is on the screen stays as it is.
      const stored = await fetchCrowd(post, done.number, true).catch(() => null);
      if (stored) ({ waves, answers } = stored);
      crowdCache.set(`${post.id}/${done.number}`, { reactions, waves, answers });
    }
    if (!alive) return;
    const replay = h('button', { type: 'button', class: 'link', onclick: () => {
      stats.reset(); // the counters run again together with the waves
      paintCounters(grid.replay(post.preset, reactions, waves));
    } }, icon('replay', 13), t.post.replay);
    put(status, `${t.run.done(done.waves.length, done.summary.seconds, done.summary.usd)} · `, replay);
    paintArticle();
    paintStepper();
    paintCounters(countMs);
    setTimeout(() => alive && paintBlocks(), 80); // building the crowd takes a moment; the map comes first
  }

  view.replaceChildren(h('div', { class: 'page post' },
    h('section', { class: 'post-top' },
      // From the feed the way back is the feed at the place the visitor left it; from a link there is nothing behind.
      (history.state?.depth ?? 0) > 0
        ? h('a', { class: 'back', href: '/', onclick: (event) => (event.preventDefault(), history.back()) }, icon('back', 18), t.nav.back)
        : h('a', { class: 'back', href: '/', 'data-link': true }, icon('back', 18), t.post.back),
      article),
    h('aside', { class: 'map-col' }, h('div', { class: 'map-in' }, stepper, h('div', { class: 'grid-wrap' }, gridHost, labels), status, stats, legend())),
    h('section', { class: 'post-rest' }, chips, blocks)));
  paintArticle();
  paintStepper();
  paintLabels();

  (async () => {
    try {
      if (version.state === 'done') {
        ({ reactions, waves, answers } = await fetchCrowd(post, version.number));
        await finish(version, false, grid.replay(post.preset, reactions, waves));
      } else {
        ({ reactions, waves, answers } = await fetchCrowd(post, version.number, true));
        grid.setAll(post.preset, reactions);
        paintCounters(0);
        await (post.mine ? drive() : watch());
      }
    } catch (error) {
      console.error(error);
      if (alive) status.textContent = t.run.failed;
    }
  })();

  return () => {
    alive = false;
    grid.destroy();
    showTip(null);
  };
}

// -- the persona page

function personaPage(view, pool, idText) {
  const id = Number(idText);
  if (!POOLS[pool] || !whoIs(pool, id)) {
    view.replaceChildren(h('div', { class: 'page single' }, h('p', { class: 'problem' }, t.errors.not_found)));
    return () => {};
  }
  const who = whoIs(pool, id);
  const cameFromHere = (history.state?.depth ?? 0) > 0;
  document.title = `${who.name[lang]} · ${t.brand}`;
  const gridHost = h('div', {});
  const grid = createGrid(gridHost, {
    hint: t.mapKeys,
    label: t.persona.lives,
    onHover(otherId, at) {
      if (otherId === null) return showTip(null);
      const other = whoIs(pool, otherId);
      showTip([personaTitle(other), personaLine(other), other.interests.map((interest) => INTEREST[interest][lang]).join(', ')], at);
    },
    onPick: (otherId) => go(`/u/${pool}/${otherId}`),
  });
  // People with the same main interest light up: the persona's district.
  grid.paint(Uint8Array.from(crowdOf(pool), (other) => (other.interests[0] === who.interests[0] ? 1 : 0)), [LOOKS.scrolled, { color: `hsl(${hueOf(who.interests[0])} 70% 64%)`, glow: true }]);
  grid.mark(id);

  const activity = activityList(pool, id, who);
  // Somebody a visitor moved in: the page says since when, can be sent to a friend, and whoever moved them in can change them.
  const actions = who.since && h('div', { class: 'me-actions' }, copyLink(`/u/${pool}/${id}`));
  if (actions) api('/api/me').then(({ resident }) => resident?.pool === pool && resident.id === id && actions.prepend(h('a', { class: 'quiet', href: '/me', 'data-link': true }, icon('pen', 15), t.me.edit))).catch(() => {});

  const money = [BUDGET[who.budget][lang], SPEND[who.spending][lang]].filter(Boolean).join(', ');
  const nextDoor = [-GRID, -1, 1, GRID, -GRID - 1, GRID + 1].map((step) => id + step).filter((other) => whoIs(pool, other) && Math.abs((other % GRID) - (id % GRID)) <= 1).slice(0, 4);
  view.replaceChildren(h('div', { class: 'page profile' },
    h('section', { class: 'column' },
      cameFromHere
        ? h('a', { class: 'back', href: '/crowd', onclick: (event) => (event.preventDefault(), history.back()) }, icon('back', 18), t.nav.back)
        : h('a', { class: 'back', href: '/crowd', 'data-link': true }, icon('back', 18), t.nav.crowd),
      h('header', { class: 'profile-head' },
        h('div', { class: 'profile-cover', style: `--h:${hueOf(who.interests[0])}` }),
        h('div', { class: 'profile-face' }, personaAvatar(who)),
        h('h1', {}, who.name[lang]),
        h('p', { class: 'lead' }, `${t.persona.years(who.age)} · ${personaLine(who)}`),
        h('p', { class: 'bio' }, `${TEMPER[who.temper][lang]} · ${money}`),
        h('p', { class: 'tags' }, ...who.interests.map((interest) => h('span', { class: 'tag', style: `--h:${hueOf(interest)}` }, INTEREST[interest][lang])), h('span', { class: 'tag plain' }, who.shopping === 'nothing' ? t.persona.nothing : `${t.persona.shopping}: ${SHOP[who.shopping][lang]}`)),
        who.since && h('p', { class: 'dim small' }, t.persona.since(dayOf(who.since))),
        actions),
      h('h2', { class: 'section-title' }, t.persona.history), activity),
    h('aside', { class: 'rail' }, h('div', { class: 'rail-in' },
      h('div', { class: 'rail-head' }, h('h2', {}, t.persona.lives)),
      h('div', { class: 'grid-wrap' }, gridHost, h('div', { class: 'grid-labels' }, mapLabel(who.interests[0]))), h('p', { class: 'hint' }, id < CROWD ? t.persona.neighbours : t.persona.newStreet),
      h('h3', { class: 'rail-sub' }, t.persona.next),
      h('ul', { class: 'people' }, ...nextDoor.map((other) => personCard(pool, other)))))));
  return () => {
    grid.destroy();
    showTip(null);
  };
}

/** What somebody in town did with the recent posts that reached them. */
function activityList(pool, id, who) {
  const list = h('ul', { class: 'activity' });
  const nothing = () => h('li', { class: 'dim' }, t.persona.noHistory, ' ', h('a', { class: 'link', href: '/', 'data-link': true }, t.persona.write));
  api(`/api/persona/${pool}/${id}`).then(({ history: items }) => {
    put(list, items.length ? items.map((item, index) => {
      const look = lookOf(item.preset, item.reaction);
      const answer = answerWords(item.preset, item.options, item.answer, item.reaction);
      return h('li', { style: `--i:${index}` },
        h('p', { class: 'activity-did' }, h('i', { class: look === 'hollow' ? 'dot hollow' : 'dot', style: `--c:${LOOKS[look]}` }), h('b', {}, reactionWord(item.reaction, who)), answer && h('span', { class: 'dim' }, ' · ', answer.quote ? h('q', {}, answer.text) : answer.text), item.finishedAt && h('span', { class: 'dim' }, ` · ${ago(item.finishedAt)}`)),
        h('a', { class: 'quoted', href: `/p/${item.post}`, 'data-link': true }, postHead(item, item.finishedAt), h('p', {}, clip(item.snippet, 200))));
    }) : nothing());
  }).catch(() => put(list, nothing()));
  return list;
}

/** The card of a finished post, in a dialog: the picture, and the ways to take it away. */
async function showCard(post, version, reactions) {
  const totals = version.summary.counters;
  const kinds = Object.entries(PRESETS[post.preset].reactions);
  const spreadsKey = kinds.find(([, reaction]) => reaction.spreads)?.[0];
  const stoppedAt = version.waves.findIndex((wave, index) => !wave.travels && index < WAVES.length - 1);
  const canvas = await drawCard({
    text: version.text, by: post.nickname === 'anonymous' ? t.compose.anonymous : post.nickname, kind: t.presets[post.preset].name,
    presetId: post.preset, reactions, reach: t.n(totals.reach), reachCount: totals.reach, size: reactions.length,
    reachWords: t.card.saw(reactions.length), headline: stoppedAt >= 0 ? t.verdict.stopped(stoppedAt) : t.verdict.everyone,
    counters: [['stopped', totals.stopped, t.counters.stopped], ['glad', totals.glad, t.counters.glad], ['spreads', totals.byReaction?.[spreadsKey] ?? 0, reactionWord(spreadsKey)], ['sorry', totals.sorry, t.counters.sorry]]
      .map(([look, value, label]) => ({ look, value: t.n(value), label })),
    address: `${location.host}/p/${post.id}`,
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const address = URL.createObjectURL(blob);
  const file = new File([blob], `jevtown-${post.id}.png`, { type: 'image/png' });
  const dialog = h('dialog', { class: 'card-dialog', 'aria-label': t.card.open, onclose: () => (URL.revokeObjectURL(address), dialog.remove()), onclick: (event) => event.target === dialog && dialog.close() },
    h('img', { src: address, alt: `${t.n(totals.reach)} ${t.card.saw(reactions.length)}. ${clip(version.text, 140)}`, width: 1080, height: 1350 }),
    h('div', { class: 'card-actions' },
      navigator.canShare?.({ files: [file] }) && h('button', { type: 'button', class: 'primary', onclick: () => navigator.share({ files: [file], url: `${location.origin}/p/${post.id}` }).catch(() => {}) }, t.card.share),
      h('a', { class: navigator.canShare?.({ files: [file] }) ? 'quiet' : 'primary', href: address, download: file.name }, t.card.download),
      h('button', { type: 'button', class: 'quiet', onclick: () => dialog.close() }, t.card.close)));
  document.body.append(dialog);
  dialog.showModal();
}

/** A button that copies a link of the site. */
function copyLink(path, words = t.share) {
  const button = h('button', { type: 'button', class: 'quiet', onclick: async () => {
    const copied = await navigator.clipboard.writeText(`${location.origin}${path}`).then(() => true, () => false);
    if (!copied) return;
    button.lastChild.textContent = t.copied;
    setTimeout(() => (button.lastChild.textContent = words), 2000); // the button is for the next time too
  } }, icon('link', 16), h('span', {}, words));
  return button;
}

function personCard(pool, id) {
  const who = whoIs(pool, id);
  return h('li', {}, h('a', { class: 'person', href: `/u/${pool}/${id}`, 'data-link': true }, personaAvatar(who),
    h('span', { class: 'person-body' }, h('b', {}, personaTitle(who)), h('span', { class: 'dim' }, personaLine(who)), h('span', { class: 'dim small' }, who.interests.map((interest) => INTEREST[interest][lang]).join(' · ')))));
}

// -- the whole crowd

const spread = (count, from, to) => Array.from({ length: count }, (_, i) => `hsl(${Math.round(from + ((to - from) * i) / Math.max(1, count - 1))} 68% 62%)`);
const LENSES = {
  interest: { values: INTERESTS.map((item) => item.id), of: (who) => who.interests[0], label: (value) => INTEREST[value][lang], colors: () => INTERESTS.map((item) => `hsl(${hueOf(item.id)} 62% 62%)`) },
  age: { values: AGE_GROUPS.map((item) => item.id), of: (who) => who.ageGroup, label: (value) => AGE_GROUP[value][lang], colors: () => spread(AGE_GROUPS.length, 200, 20) },
  field: { values: Object.keys(FIELDS), of: (who) => who.field, label: (value) => t.fields[value], colors: () => Object.keys(FIELDS).map((_, i) => `hsl(${(i * 67) % 360} 62% 62%)`) },
  temper: { values: TEMPERS.map((item) => item.id), of: (who) => who.temper, label: (value) => t.tempers[value], colors: () => TEMPERS.map((_, i) => `hsl(${(i * 47 + 140) % 360} 64% 62%)`) },
  budget: { values: BUDGETS.map((item) => item.id), of: (who) => who.budget, label: (value) => BUDGET[value][lang], colors: () => ['#4d5a70', '#6ea8fe', '#3ddc84', '#ffd84d'] },
};

function crowdPage(view) {
  const pool = lang === 'uk' ? 'uk' : 'en';
  const people = crowdOf(pool);
  let lens = 'interest';
  let picked = null;

  const gridHost = h('div', {});
  const labels = h('div', { class: 'grid-labels atlas', 'aria-hidden': 'true' });
  const lensTabs = h('div', { class: 'seg' });
  const values = h('div', { class: 'values' });
  const count = h('p', { class: 'crowd-count' });
  const sample = h('ul', { class: 'people two' });
  const grid = createGrid(gridHost, {
    hint: t.mapKeys,
    label: t.crowd.title,
    onHover(id, at) {
      if (id === null) return showTip(null);
      const who = people[id];
      showTip([personaTitle(who), personaLine(who), who.interests.map((interest) => INTEREST[interest][lang]).join(', '), `${TEMPER[who.temper][lang]} · ${BUDGET[who.budget][lang]}`], at);
    },
    onPick: (id) => go(`/u/${pool}/${id}`),
  });
  const belongs = (who, value) => (lens === 'interest' ? who.interests.includes(value) : LENSES[lens].of(who) === value);

  function paint() {
    const { values: all, of, label, colors } = LENSES[lens];
    const palette = colors();
    put(lensTabs, Object.keys(LENSES).map((id) => h('button', { type: 'button', class: id === lens ? 'on' : '', onclick: () => ((lens = id), (picked = null), paint()) }, t.crowd.lenses[id])));
    put(values, h('button', { type: 'button', class: picked === null ? 'value on' : 'value', onclick: () => ((picked = null), paint()) }, t.crowd.everyone),
      all.map((value, index) => h('button', { type: 'button', class: value === picked ? 'value on' : 'value', onclick: () => ((picked = picked === value ? null : value), paint()) }, h('i', { class: 'dot', style: `--c:${palette[index]}` }), label(value))));
    grid.paint(Uint8Array.from(people, (who) => all.indexOf(of(who))), palette.map((color) => ({ color, glow: picked !== null })));
    grid.focusOn(picked === null ? null : Uint8Array.from(people, (who) => (belongs(who, picked) ? 1 : 0)));
    const group = picked === null ? people : people.filter((who) => belongs(who, picked));
    count.textContent = t.crowd.count(group.length, picked === null);
    const from = Math.floor(unit('sample', lens, picked ?? 'all') * group.length);
    put(sample, Array.from({ length: Math.min(6, group.length) }, (_, i) => personCard(pool, group[(from + i * 37) % group.length].id)));
    // Forty names do not fit on the map at once: every other district is named, like squares of one colour on a chessboard.
    const named = (item, index) => (picked === null ? index % 2 === Math.floor(index / INTEREST_COLUMNS) % 2 : item.id === picked);
    labels.classList.toggle('picked', picked !== null);
    put(labels, lens === 'interest' && INTERESTS.filter(named).map((item) => mapLabel(item.id)));
  }

  view.replaceChildren(h('div', { class: 'page crowdpage' },
    h('section', { class: 'column' },
      h('header', { class: 'welcome' }, h('p', { class: 'eyebrow' }, t.rail.size(people.length)), h('h1', {}, t.crowd.title), h('p', { class: 'lead' }, t.crowd.lead)),
      h('div', { class: 'crowd-tools' }, lensTabs, values),
      h('h2', { class: 'section-title' }, t.crowd.people, count), sample),
    h('aside', { class: 'map-col' }, h('div', { class: 'map-in' }, h('div', { class: 'grid-wrap' }, gridHost, labels), h('p', { class: 'hint' }, t.crowd.hint)))));
  paint();
  return () => {
    grid.destroy();
    showTip(null);
  };
}

// -- the resident a visitor moves in

/** The one of the 10,000 most like the new resident: the same main interest, the nearest age, the same temper if there is a choice. */
function nearestResident(pool, profile) {
  let best = null;
  for (const who of crowdOf(pool)) {
    if (who.id === profile.id || who.interests[0] !== profile.interests[0]) continue;
    const distance = Math.abs(who.age - profile.age) * 4 + (who.temper === profile.temper ? 0 : 2) + (who.budget === profile.budget ? 0 : 1);
    if (!best || distance < best.distance) best = { who, distance };
  }
  return best?.who ?? null;
}

function mePage(view, me) {
  let alive = true;
  let state = me ?? { resident: null, answers: [] };
  let stopKeys = () => {};
  const pool = state.resident?.pool ?? homePool(); // a resident stays in the town it moved into, whatever language the page speaks now
  document.title = `${t.nav.me} · ${t.brand}`;

  const column = h('section', { class: 'column me' });
  const gridHost = h('div', {});
  const labels = h('div', { class: 'grid-labels' });
  const railNote = h('p', { class: 'hint' });
  const nearest = h('div', {});
  const mapBox = h('div', { class: 'me-map' }, h('div', { class: 'rail-head' }, h('h2', {}, t.me.lives)), h('div', { class: 'grid-wrap' }, gridHost, labels), railNote);
  const railIn = h('div', { class: 'rail-in' }, mapBox, nearest);
  // On a phone the rail comes after everything, so the map moves into the page: next to the interests it answers to, or under the resident's head.
  const phone = matchMedia('(max-width: 900px)');
  const placeMap = () => {
    const slot = phone.matches ? column.querySelector('.map-slot') : null;
    if (slot) slot.append(mapBox);
    else railIn.prepend(mapBox);
  };
  phone.addEventListener('change', placeMap);
  let justMoved = false; // the visit on which the resident moved in: the page greets them once
  const grid = createGrid(gridHost, {
    hint: t.mapKeys,
    label: t.me.lives,
    onHover(id, at) {
      if (id === null) return showTip(null);
      const who = whoIs(pool, id);
      showTip([personaTitle(who), personaLine(who), who.interests.map((interest) => INTEREST[interest][lang]).join(', ')], at);
    },
    onPick: (id) => go(`/u/${pool}/${id}`),
  });

  /** The map lights the district of the main interest and rings the resident's house, once it has one. */
  function paintRail(profile) {
    const main = profile?.interests?.[0];
    grid.paint(Uint8Array.from(crowdOf(pool), (who) => (who.interests[0] === main ? 1 : 0)), [LOOKS.scrolled, { color: `hsl(${hueOf(main ?? INTERESTS[0].id)} 70% 64%)`, glow: true }]);
    put(labels, main && mapLabel(main));
    railNote.textContent = main ? '' : t.me.pick;
    railNote.hidden = Boolean(main);
    grid.mark(profile?.id ?? null, justMoved);
    const who = main && profile.age ? nearestResident(pool, profile) : null;
    put(nearest, who && [h('h3', { class: 'rail-sub' }, t.me.nearest), h('ul', { class: 'people' }, personCard(pool, who.id))]);
  }

  const face = (profile) => personaAvatar({ interests: profile.interests, name: { uk: profile.name, en: profile.name } });
  const doWord = (reaction) => t.me.do[reaction] ?? reaction;
  const lookDot = (reaction) => h('i', { class: 'dot', style: `--c:${LOOKS[lookOf('post', reaction)]}` });

  async function send(path, body) {
    state = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  /** The town has changed: somebody moved in, moved out, or is somebody else now. */
  const sendAndReload = (path, body) => send(path, body).then(loadTown);

  // -- describing the resident

  function paintForm() {
    const old = state.resident;
    let gender = old?.gender ?? null;
    let interests = [...(old?.interests ?? [])];
    let temper = old?.temper ?? null; // no default: a lurker scrolls past everything, and most people keep a default
    let budget = old?.budget ?? 'average';
    const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
    const name = h('input', { name: 'name', maxLength: NAME_CHARS, required: true, autocomplete: 'off', value: old?.name ?? '' });
    const age = h('input', { name: 'age', type: 'number', min: 10, max: 110, required: true, inputMode: 'numeric', value: old?.age ?? '', oninput: () => paintRail({ id: old?.id, interests, age: Number(age.value) }) });
    const job = h('input', { name: 'job', maxLength: PLACE_CHARS, value: old?.job ?? '' });
    job.setAttribute('list', 'me-jobs');
    const city = h('input', { name: 'city', maxLength: PLACE_CHARS, autocomplete: 'off', value: old?.city ?? '' });
    city.setAttribute('list', 'me-cities');
    const about = h('textarea', { name: 'about', rows: 3, maxLength: ABOUT_CHARS, value: old?.about ?? '', placeholder: t.me.form.aboutHint });
    const genderChips = h('div', { class: 'values' });
    const interestChips = h('div', { class: 'values' });
    const chosen = h('p', { class: 'chosen' });
    const temperChips = h('div', { class: 'values' });
    const budgetChips = h('div', { class: 'values' });

    const setInterests = (next) => {
      interests = next;
      paintChips();
      paintRail({ id: old?.id, interests, age: Number(age.value) });
    };
    function paintChips() {
      put(chosen, interests.length
        ? [h('span', { class: 'dim' }, `${t.me.form.chosen}: `), ...interests.map((id, at) => h('button', { type: 'button', class: 'chosen-one', style: `--c:hsl(${hueOf(id)} 62% 62%)`, 'aria-label': `${t.me.form.drop}: ${INTEREST[id][lang]}`, onclick: () => setInterests(interests.filter((other) => other !== id)) },
          h('b', {}, INTEREST[id][lang]), at === 0 && h('small', {}, t.me.form.main), icon('x', 13)))]
        : h('span', { class: 'dim' }, t.me.form.interestsNote));
      put(genderChips, ['female', 'male'].map((id) => h('button', { type: 'button', class: id === gender ? 'value on' : 'value', 'aria-pressed': id === gender, onclick: () => ((gender = id), paintChips()) }, t.me.form.genders[id])));
      put(interestChips, INTERESTS.map((item) => {
        const at = interests.indexOf(item.id);
        return h('button', { type: 'button', class: at === -1 ? 'value' : 'value on', 'aria-pressed': at !== -1, disabled: at === -1 && interests.length >= MAX_INTERESTS, onclick: () => setInterests(at === -1 ? [...interests, item.id] : interests.filter((id) => id !== item.id)) },
          h('i', { class: 'dot', style: `--c:hsl(${hueOf(item.id)} 62% 62%)` }), item[lang], at !== -1 && h('small', {}, at + 1));
      }));
      put(temperChips, TEMPERS.map((item) => h('button', { type: 'button', class: item.id === temper ? 'value on' : 'value', 'aria-pressed': item.id === temper, onclick: () => ((temper = item.id), paintChips()) }, item[lang])));
      put(budgetChips, BUDGETS.map((item) => h('button', { type: 'button', class: item.id === budget ? 'value on' : 'value', 'aria-pressed': item.id === budget, onclick: () => ((budget = item.id), paintChips()) }, item[lang])));
    }
    paintChips();

    const submit = h('button', { type: 'submit', class: 'primary' }, old ? t.me.form.save : t.me.form.create);
    const field = (label, control, note) => h('label', { class: 'field' }, h('span', { class: 'field-name' }, label, note && h('small', {}, ` · ${note}`)), control);
    const group = (label, control, note) => h('div', { class: 'field', role: 'group', 'aria-label': label }, h('span', { class: 'field-name' }, label, note && h('small', {}, ` · ${note}`)), control);
    const form = h('form', { class: 'me-form', onsubmit: async (event) => {
      event.preventDefault();
      problem.hidden = true;
      if (!interests.length || !gender || !temper) {
        problem.textContent = t.me.errors.bad_profile;
        return (problem.hidden = false);
      }
      submit.disabled = true;
      try {
        await sendAndReload('/api/me', { pool, name: name.value, gender, age: Number(age.value), job: job.value, city: city.value, interests, temper, budget, about: about.value });
        if (!alive) return;
        justMoved = !old;
        paint();
        window.scrollTo(0, 0);
      } catch (error) {
        const words = t.me.errors[error.code] ?? t.errors[error.code] ?? t.errors.error;
        problem.textContent = typeof words === 'function' ? words(error.reasons.map((reason) => t.blocked.reasons[reason] ?? reason)) : words;
        problem.hidden = false;
        submit.disabled = false;
      }
    } },
      h('div', { class: 'field-row' }, field(t.me.form.name, name), field(t.me.form.age, age)),
      group(t.me.form.gender, genderChips),
      h('div', { class: 'field-row' }, field(t.me.form.job, job), field(t.me.form.city, city)),
      h('div', { class: 'field', role: 'group', 'aria-label': t.me.form.interests }, h('span', { class: 'field-name' }, t.me.form.interests), chosen, interestChips, h('div', { class: 'map-slot' })),
      group(t.me.form.temper, temperChips),
      group(t.me.form.budget, budgetChips),
      field(t.me.form.about, about, t.me.form.aboutNote),
      h('p', { class: 'hint me-note' }, t.me.form.shown),
      h('datalist', { id: 'me-jobs' }, ...JOBS.map((item) => h('option', { value: item[lang] }))),
      h('datalist', { id: 'me-cities' }, ...POOLS[pool].cities.map(([english, ukrainian]) => h('option', { value: lang === 'uk' ? ukrainian : english }))),
      problem,
      h('div', { class: 'me-actions' }, submit, old && h('button', { type: 'button', class: 'quiet', onclick: paint }, t.me.form.cancel)));

    put(column, h('header', { class: 'welcome' }, h('p', { class: 'eyebrow' }, old ? t.me.editEyebrow : t.me.eyebrow), h('h1', {}, old ? t.me.editTitle : t.me.title), !old && h('p', { class: 'lead' }, t.me.lead)), form);
    placeMap();
    paintRail({ id: old?.id, interests, age: Number(age.value) });
    window.scrollTo(0, 0);
  }

  // -- a round of posts

  /** Posts pass one by one, each with the seven things a person can do with it; keys 1 to 7 answer too. */
  function runQuiz(kind) {
    const answered = state.answers.map((answer) => answer.card);
    const cards = pickCards(kind, answered, state.resident.seed);
    if (!cards.length) return;
    const given = [];
    const panel = h('div', { class: 'quiz' });

    function leaveQuiz() {
      stopKeys();
      stopKeys = () => {};
      paint();
    }
    function answer(reaction) {
      given.push({ card: cards[given.length].id, reaction });
      given.length < cards.length ? paintCard() : finish();
    }
    function paintCard() {
      const card = cards[given.length];
      put(panel,
        h('div', { class: 'quiz-top' },
          h('span', { class: 'quiz-count' }, t.me.quiz.progress(given.length + 1, cards.length)),
          h('div', { class: 'quiz-bar', role: 'presentation' }, h('i', { style: `width:${(given.length / cards.length) * 100}%` })),
          h('button', { type: 'button', class: 'quiet', onclick: leaveQuiz }, t.me.quiz.leave)),
        h('article', { class: 'quiz-card', 'aria-live': 'polite' }, postHead({ nickname: card.by, preset: 'post' }, new Date(Date.now() - (5 + (hash(card.id) % 300)) * 60000).toISOString()), h('p', { class: 'quiz-text' }, card[lang])),
        h('p', { class: 'quiz-ask' }, t.me.quiz.ask),
        h('div', { class: 'quiz-do' }, ...QUIZ_REACTIONS.map((reaction, index) => h('button', { type: 'button', class: 'do', onclick: () => answer(reaction) }, lookDot(reaction), doWord(reaction), h('kbd', {}, index + 1)))),
        given.length > 0 && h('button', { type: 'button', class: 'quiet', onclick: () => (given.pop(), paintCard()) }, icon('back', 15), t.me.quiz.back));
    }
    async function finish() {
      stopKeys();
      stopKeys = () => {};
      put(panel, h('p', { class: 'quiz-busy' }, h('i', { class: 'live' }), kind === 'test' ? t.me.test.busy : ''));
      try {
        await send('/api/me/answers', { kind, lang, answers: given });
        if (!alive) return;
        paint();
        if (kind === 'test') document.querySelector('.me-result')?.scrollIntoView({ block: 'center' });
      } catch (error) {
        if (!alive) return;
        put(panel, h('p', { class: 'problem', role: 'alert' }, t.me.errors[error.code] ?? t.me.errors.jev),
          h('div', { class: 'me-actions' }, h('button', { type: 'button', class: 'primary', onclick: finish }, t.me.test.retry), h('button', { type: 'button', class: 'quiet', onclick: paint }, t.me.quiz.leave)));
      }
    }

    const onKey = (event) => {
      const index = Number(event.key) - 1;
      if (event.metaKey || event.ctrlKey || event.altKey || !(index >= 0 && index < QUIZ_REACTIONS.length) || given.length >= cards.length) return;
      event.preventDefault();
      answer(QUIZ_REACTIONS[index]);
    };
    document.addEventListener('keydown', onKey);
    stopKeys = () => document.removeEventListener('keydown', onKey);

    const step = t.me[kind];
    put(column, h('header', { class: 'welcome' }, h('p', { class: 'eyebrow' }, step.step), h('h1', {}, step.title)), panel);
    placeMap();
    paintCard();
    window.scrollTo(0, 0);
  }

  // -- the resident

  function paintResident() {
    const profile = state.resident;
    const answered = state.answers.map((answer) => answer.card);
    const left = CARDS.length - answered.length;
    const tuned = state.answers.filter((answer) => answer.kind === 'tune').length;
    const tries = scores(state.answers);
    const last = tries.at(-1);
    const lastAnswers = last ? state.answers.filter((answer) => answer.round === last.round) : [];

    const step = (kind, { on, button, locked }) => h('section', { class: on ? 'me-step' : 'me-step off' },
      h('p', { class: 'me-kicker' }, t.me[kind].step),
      h('h2', {}, t.me[kind].title),
      h('p', { class: 'dim' }, t.me[kind].note(Math.min(kind === 'tune' ? TUNE_CARDS : TEST_CARDS, left))),
      h('div', { class: 'me-actions' },
        h('button', { type: 'button', class: on ? 'primary' : 'primary off', disabled: !on, onclick: () => runQuiz(kind) }, button),
        locked && h('span', { class: 'hint' }, locked)));
    // Once there is a round behind, the page has one thing to press: the try. Step 1 folds into a line.
    const tunedLine = h('section', { class: 'me-step done' },
      h('p', { class: 'me-kicker' }, t.me.tune.step),
      h('div', { class: 'me-actions' }, h('span', {}, icon('check', 15), ' ', t.me.tune.kept(state.answers.length)), h('button', { type: 'button', class: 'quiet', onclick: () => runQuiz('tune') }, t.me.tune.more)));
    const result = last && h('section', { class: 'me-result' },
      h('p', { class: 'me-kicker' }, t.me.result.title),
      h('div', { class: 'me-scores' },
        h('p', {}, h('b', { class: 'score' }, t.me.result.of(last.tuned, last.asked)), h('span', { class: 'dim' }, t.me.result.withAnswers)),
        h('p', {}, h('b', { class: 'score dim' }, t.me.result.of(last.plain, last.asked)), h('span', { class: 'dim' }, t.me.result.byDescription))),
      h('ul', { class: 'guesses' }, ...lastAnswers.map(guessRow)),
      tries.length > 1 && [h('h3', { class: 'rail-sub' }, t.me.result.rounds),
        h('ol', { class: 'tries' }, ...tries.map((round, index) => h('li', {}, h('span', { class: 'dim' }, t.me.result.round(index + 1)), h('b', {}, t.me.result.of(round.tuned, round.asked)), h('span', { class: 'dim small' }, t.me.result.plainShort(round.plain)))))]);
    const greeting = justMoved && h('section', { class: 'me-hello', role: 'status' },
      h('h2', {}, t.me.hello.title(profile.name)),
      h('p', { class: 'dim' }, t.me.hello.note(t.n(profile.id + 1))));

    put(column,
      h('header', { class: 'profile-head' },
        h('div', { class: 'profile-cover', style: `--h:${hueOf(profile.interests[0])}` }),
        h('div', { class: 'profile-face' }, face(profile)),
        h('h1', {}, profile.name),
        h('p', { class: 'lead' }, [t.me.years(profile.age), profile.job, profile.city].filter(Boolean).join(' · ')),
        h('p', { class: 'bio' }, `${TEMPER[profile.temper][lang]} · ${BUDGET[profile.budget][lang]}`),
        profile.about && h('p', { class: 'bio' }, h('q', {}, profile.about)),
        h('p', { class: 'tags' }, ...profile.interests.map((interest) => h('span', { class: 'tag', style: `--h:${hueOf(interest)}` }, INTEREST[interest][lang]))),
        h('p', { class: 'dim small' }, t.me.moved(dayOf(profile.createdAt))),
        h('div', { class: 'me-actions' },
          h('button', { type: 'button', class: 'quiet', onclick: paintForm }, icon('pen', 15), t.me.edit),
          h('a', { class: 'quiet', href: `/u/${profile.pool}/${profile.id}`, 'data-link': true }, icon('arrow', 15), t.me.page),
          copyLink(`/u/${profile.pool}/${profile.id}`))),
      greeting,
      h('div', { class: 'map-slot' }),
      result,
      left > 0
        ? [tuned ? tunedLine : step('tune', { on: true, button: t.me.tune.start }),
          step('test', { on: tuned > 0, button: tries.length ? t.me.test.again : t.me.test.start, locked: tuned ? null : t.me.test.locked })]
        : h('p', { class: 'me-step dim' }, t.me.over(CARDS.length)),
      h('h2', { class: 'section-title' }, t.me.feed),
      activityList(profile.pool, profile.id, whoIs(profile.pool, profile.id)),
      h('details', { class: 'me-known' },
        h('summary', {}, t.me.answers.title, h('span', { class: 'crowd-count' }, String(state.answers.length))),
        state.answers.length
          ? [h('p', { class: 'hint me-note' }, t.me.answers.note), h('ul', { class: 'guesses all' }, ...[...state.answers].reverse().map(guessRow))]
          : h('p', { class: 'hint me-note' }, t.me.answers.empty)),
      h('div', { class: 'me-actions end' },
        state.answers.length > 0 && h('button', { type: 'button', class: 'quiet', onclick: () => confirm(t.me.resetSure) && send('/api/me/reset', {}).then(() => alive && paint()) }, t.me.reset),
        h('button', { type: 'button', class: 'quiet', onclick: () => confirm(t.me.removeSure) && sendAndReload('/api/me/reset', { resident: true }).then(() => alive && paint()) }, t.me.remove)));
    placeMap();
    paintRail(profile);
    justMoved = false; // the greeting and the rings are for the moment of moving in
  }

  /** One answer: the post, what the person said, and for a test post what Jev said before it saw that. */
  function guessRow(answer) {
    const card = CARD[answer.card];
    if (!card) return null;
    const hit = answer.kind === 'test' && answer.jev === answer.human;
    return h('li', { class: answer.kind === 'test' ? (hit ? 'guess hit' : 'guess miss') : 'guess' },
      h('p', { class: 'guess-text' }, clip(card[lang], 140)),
      h('p', { class: 'guess-said' },
        h('span', {}, h('span', { class: 'dim' }, `${t.me.answers.you}: `), lookDot(answer.human), doWord(answer.human).toLowerCase()),
        answer.kind === 'test' && h('span', { class: hit ? 'guess-verdict hit' : 'guess-verdict miss' }, hit ? [icon('check', 14), t.me.answers.guessed] : t.me.answers.missed(doWord(answer.jev).toLowerCase()))));
  }

  const hash = (text) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const paint = () => (state.resident ? paintResident() : paintForm());

  view.replaceChildren(h('div', { class: 'page profile' }, column, h('aside', { class: 'rail' }, railIn)));
  paint();
  return () => {
    alive = false;
    phone.removeEventListener('change', placeMap);
    stopKeys();
    grid.destroy();
    showTip(null);
  };
}

// -- routing

function paintShell(path) {
  document.documentElement.lang = lang;
  document.title = path === '/crowd' ? `${t.crowd.title} · ${t.brand}` : `${t.brand} · ${t.title}`; // a post and a persona put their own name here
  document.getElementById('brand').alt = t.brand;
  document.getElementById('about').textContent = t.nav.about;
  const at = path === '/me' ? 'me' : path === '/crowd' || path.startsWith('/u/') ? 'crowd' : 'feed';
  put(document.getElementById('nav'),
    h('a', { href: '/', 'data-link': true, class: at === 'feed' ? 'nav-link on' : 'nav-link', 'aria-label': t.nav.feed, 'aria-current': at === 'feed' ? 'page' : null }, icon('home', 22), h('span', {}, t.nav.feed)),
    h('a', { href: '/crowd', 'data-link': true, class: at === 'crowd' ? 'nav-link on' : 'nav-link', 'aria-label': t.nav.crowd, 'aria-current': at === 'crowd' ? 'page' : null }, icon('crowd', 22), h('span', {}, t.nav.crowd)),
    h('a', { href: '/me', 'data-link': true, class: at === 'me' ? 'nav-link on' : 'nav-link', 'aria-label': t.nav.me, 'aria-current': at === 'me' ? 'page' : null }, icon('user', 22), h('span', {}, t.nav.me)),
    h('button', { type: 'button', class: 'write', 'aria-label': t.nav.write, onclick: () => {
      writeNext = true;
      if (location.pathname === '/') {
        writeNext = false;
        document.querySelector('.composer')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
        document.querySelector('.composer textarea')?.focus({ preventScroll: true });
      } else go('/');
    } }, icon('pen', 18), h('span', {}, t.nav.write)));
  put(document.getElementById('lang'), ...[['uk', 'UA'], ['en', 'EN']].map(([id, label]) => h('button', { type: 'button', class: id === lang ? 'on' : '', 'aria-pressed': id === lang, 'aria-label': DICTIONARIES[id].langName, lang: id, onclick: () => {
    if (id === lang) return;
    lang = id;
    t = DICTIONARIES[lang];
    store.set('lang', lang);
    route({ keepY: window.scrollY }); // the same place, in other words
  } }, label)));
}

/**
 * What a page needs from the network is fetched first, while the old page still works; only the
 * swap itself runs inside a view transition. A newer navigation cancels an older one, so a page
 * never stays alive behind another with its timers and observers.
 */
let navigation = 0;
let townLoaded = null;
async function route({ back = false, keepY = 0 } = {}) {
  const mine = ++navigation;
  const path = location.pathname;
  const post = path.startsWith('/p/') ? await api(`/api/post/${encodeURIComponent(path.slice(3))}`).catch(() => null) : null;
  const me = path === '/me' ? await api('/api/me').catch(() => null) : null;
  await (townLoaded ??= loadTown());
  if (mine !== navigation) return;
  const y = back ? history.state?.y ?? 0 : keepY;
  const swap = () => {
    leave();
    leave = () => {};
    const view = document.getElementById('view');
    paintShell(path);
    let stop;
    if (path.startsWith('/p/')) stop = postPage(view, post);
    else if (path.startsWith('/u/')) stop = personaPage(view, ...path.slice(3).split('/'));
    else if (path === '/crowd') stop = crowdPage(view);
    else if (path === '/me') stop = mePage(view, me);
    else stop = home(view, y);
    leave = stop ?? (() => {});
    window.scrollTo(0, y);
  };
  if (!document.startViewTransition || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
  const transition = document.startViewTransition(swap);
  // A transition that is skipped (a hidden tab, a newer navigation) still swaps the page; its promises reject, and that is fine.
  for (const promise of [transition.ready, transition.finished, transition.updateCallbackDone]) promise.catch(() => {});
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  go(link.getAttribute('href'));
});
history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => route({ back: true }));
route();
