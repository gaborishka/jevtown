// Does Jev go by a reader's earlier reactions, and how many of them are worth keeping and sending?
// Three made-up readers answer the quiz posts by hidden rules their description does not give away.
// Jev gets the description plus k of their answers and is scored on twelve posts it has no answer to.
// The numbers this printed are in docs/measurements.md.
//   npm run probe-resident -- [--where state|instructions] [--format criteria|id] [--pick random|relevant]
//                           [--pool 36] [--ks 0,4,8] [--lang en|uk] [--seeds 3] [--test 12]
import { CARDS } from '../public/shared/quiz.js';
import { PRESETS } from '../public/shared/presets.js';
import { ask, pickProvider, eachLimit } from '../public/shared/jev.js';
import { rng, hash32 } from '../public/shared/rng.js';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const where = option('where', 'state');
const ks = option('ks', '0,4,8,12,16,24,36').split(',').map(Number);
const lang = option('lang', 'en');
const seeds = Number(option('seeds', 2));
const testSize = Number(option('test', 12));
const format = option('format', 'criteria');
const pick = option('pick', 'random');
const poolSize = Number(option('pool', 36));

const preset = PRESETS.post;
const criteria = Object.fromEntries(Object.entries(preset.reactions).map(([id, reaction]) => [id, reaction.criteria]));

const PEOPLE = {
  ira: {
    line: 'Ira, 34, marketer, Kyiv; into travel, psychology, cooking; supportive, encourages people; average income',
    rule({ topic, style }) {
      if (style === 'hype') return 'blocked';
      if (style === 'brag') return 'disliked';
      if (style === 'sincere') return ['travel', 'psychology'].includes(topic) ? 'reposted' : 'liked';
      if (style === 'humor') return 'liked';
      if (style === 'rant') return 'scrolled_past';
      if (style === 'news') return 'scrolled_past';
      if (style === 'question') return ['parenting', 'career'].includes(topic) ? 'read' : 'scrolled_past';
      if (topic === 'personal_finance') return 'followed';
      return ['travel', 'cooking', 'health', 'fitness'].includes(topic) ? 'read' : 'scrolled_past';
    },
  },
  taras: {
    line: 'Taras, 27, software developer, Lviv; into programming, AI tools, video games; skeptical, distrusts ads and big claims; comfortable income',
    rule({ topic, style, id }) {
      if (style === 'hype') return 'blocked';
      if (style === 'brag') return 'disliked';
      if (style === 'news') return 'read';
      if (id === 'genz') return 'disliked';
      if (topic === 'ai_tools' && style === 'rant') return 'reposted';
      if (style === 'plain') return ['programming', 'ai_tools'].includes(topic) ? 'liked' : topic === 'startups' ? 'followed' : topic === 'cars' ? 'read' : 'scrolled_past';
      if (style === 'humor') return ['programming', 'games', 'memes'].includes(topic) ? 'liked' : 'read';
      if (style === 'sincere') return ['career', 'crypto'].includes(topic) ? 'read' : 'scrolled_past';
      if (style === 'question') return topic === 'games' ? 'read' : 'scrolled_past';
      return 'scrolled_past';
    },
  },
  halyna: {
    line: 'Halyna, 58, school teacher, Poltava; into gardening, books, history; quiet lurker, rarely reacts; tight budget, careful with money',
    rule({ topic, style, id }) {
      if (topic === 'gardening' || topic === 'pets') return 'liked';
      if (topic === 'volunteering') return 'reposted';
      if (topic === 'books') return style === 'brag' ? 'disliked' : 'liked';
      if (id === 'genz') return 'liked';
      if (id === 'allsame') return 'disliked';
      if (topic === 'cooking') return style === 'plain' ? 'liked' : 'scrolled_past';
      if (topic === 'parenting') return style === 'humor' ? 'liked' : 'read';
      if (topic === 'health' && style === 'plain') return 'read';
      return 'scrolled_past';
    },
  },
};

const clip = (text, length) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);
const didWords = (reaction) => (format === 'id' ? reaction : criteria[reaction]);

function request(person, card, examples) {
  const earlier = examples.map((example) => ({ post: clip(example[lang], 200), did: didWords(person.rule(example)) }));
  const state = { seen_in: preset.seenIn, post: card[lang] };
  let instructions = `${preset.who}: ${person.line}. `;
  if (earlier.length && where === 'state') {
    state.reader_earlier_reactions = earlier;
    instructions += 'The state lists what this same reader really did with other posts (reader_earlier_reactions): go by that before anything else. ';
  }
  if (earlier.length && where === 'instructions') {
    instructions += `What this same reader really did with other posts: ${earlier.map((item) => `"${item.post}" → ${item.did}`).join('; ')}. Go by that before anything else. `;
  }
  return { state, questions: { q: { type: 'choice', instructions: instructions + preset.ask, criteria } } };
}

const provider = pickProvider(process.env);
let usd = 0;
let tokens = 0;
let requests = 0;
const LOOK = (reaction) => (preset.reactions[reaction].tone === 1 ? 'glad' : preset.reactions[reaction].tone === -1 ? 'sorry' : preset.reactions[reaction].stopped ? 'stopped' : 'scrolled');

const rows = [];
for (const k of ks) {
  const jobs = [];
  for (const [name, person] of Object.entries(PEOPLE)) {
    for (let seed = 0; seed < seeds; seed++) {
      const random = rng(hash32('probe', name, seed));
      const shuffled = [...CARDS].map((card) => [random(), card]).sort((a, b) => a[0] - b[0]).map(([, card]) => card);
      const test = shuffled.slice(0, testSize);
      const stored = shuffled.slice(testSize, testSize + poolSize);
      for (const card of test) {
        // Relevant first: answers about posts written the same way or on the same topic say the most about this one.
        const near = (other) => (other.style === card.style ? 2 : 0) + (other.topic === card.topic ? 2 : 0);
        const examples = pick === 'relevant' ? [...stored].sort((a, b) => near(b) - near(a)).slice(0, k) : stored.slice(0, k);
        jobs.push({ name, person, card, examples });
      }
    }
  }
  const stats = { n: 0, top: 0, look: 0, p: 0, byPerson: {} };
  const before = { tokens, requests };
  await eachLimit(jobs, 4, async ({ name, person, card, examples }) => {
    const answer = await ask(provider, request(person, card, examples));
    usd += answer.usd; tokens += answer.tokens; requests += 1;
    const probabilities = answer.answers.q?.probabilities ?? {};
    const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
    const truth = person.rule(card);
    const mine = (stats.byPerson[name] ??= { n: 0, top: 0 });
    stats.n += 1; mine.n += 1;
    if (top === truth) { stats.top += 1; mine.top += 1; }
    if (top && LOOK(top) === LOOK(truth)) stats.look += 1;
    stats.p += probabilities[truth] ?? 0;
  }, (job, error) => console.error('failed', job.name, job.card.id, error.message));
  const row = { k, n: stats.n, top1: (stats.top / stats.n).toFixed(2), look: (stats.look / stats.n).toFixed(2), pTruth: (stats.p / stats.n).toFixed(2), ...Object.fromEntries(Object.entries(stats.byPerson).map(([name, s]) => [name, (s.top / s.n).toFixed(2)])), tokensPerRequest: Math.round((tokens - before.tokens) / (requests - before.requests)) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(`where=${where} lang=${lang} format=${format} requests=${requests} tokens=${tokens} usd=${usd.toFixed(5)}`);
