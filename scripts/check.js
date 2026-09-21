// A full check in the terminal:
//   node --env-file=.env.local scripts/check.js --preset listing "iPhone 13, 128 GB, ..."
//   options: --preset post|listing|product|headline   --pool uk|en   --prices 9,15,24,39   --currency $   --waves 2
import { crowd, GRID } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { pickProvider, ask } from '../public/shared/jev.js';
import { runCheck, NOT_SHOWN } from '../public/shared/check.js';
import { counters, segments, topSegments, rankedAnswers, demandCurve } from '../public/shared/summary.js';
import { hash32 } from '../public/shared/rng.js';
import { INTEREST, FIELDS, AGE_GROUP, TEMPER, BUDGET, SHOP } from '../public/shared/vocab.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args.splice(at, 2)[1];
};
const presetId = option('preset', 'post');
const pool = option('pool', 'uk');
const prices = option('prices', '5,9,19,49').split(',').map(Number);
const currency = option('currency', '$');
const maxWaves = Number(option('waves', 4));
const text = args.join(' ').trim();
const provider = pickProvider(process.env);
if (!text || !PRESETS[presetId] || !provider) {
  console.log('usage: node --env-file=.env.local scripts/check.js [--preset post|listing|product|headline] [--pool uk|en] [--prices 9,15,24] "text"');
  process.exit(1);
}

// The grid, two personas per character cell: the upper half block carries one row, its background the next.
const COLORS = { dark: 234, scrolled: 240, hollow: 60, stopped: 111, glad: 78, spreads: 220, sorry: 203 };
const colorOf = (preset, keys, byte) => {
  if (byte === NOT_SHOWN) return COLORS.dark;
  const reaction = preset.reactions[keys[byte - 1]];
  if (reaction.hollow) return COLORS.hollow;
  if (!reaction.stopped) return COLORS.scrolled;
  return reaction.tone === -1 ? COLORS.sorry : reaction.spreads ? COLORS.spreads : reaction.tone === 1 ? COLORS.glad : COLORS.stopped;
};
function drawGrid(preset, keys, reactions) {
  const lines = [];
  for (let y = 0; y < GRID; y += 2) {
    let line = '';
    for (let x = 0; x < GRID; x++) line += `\x1b[38;5;${colorOf(preset, keys, reactions[y * GRID + x])};48;5;${colorOf(preset, keys, reactions[(y + 1) * GRID + x])}m▀`;
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join('\n');
}
const swatch = (color, label) => `\x1b[38;5;${color}m■\x1b[0m ${label}`;

const preset = PRESETS[presetId];
console.log(`${preset.noun} → ${pool} crowd, Jev via ${provider.label}\n`);

const result = await runCheck({
  send: (request) => ask(provider, request),
  presetId, pool, text, prices, currency, maxWaves,
  versionId: hash32(text).toString(36),
  onWave: (wave) => console.log(`wave ${wave.index + 1}: ${wave.size} people in ${wave.seconds.toFixed(1)} s, mood ${wave.mood.toFixed(2)} → ${wave.travels ? 'travels further' : 'stops here'}`),
});

const { keys, reactions, scores } = result;
console.log(`\n${drawGrid(preset, keys, reactions)}`);
console.log([swatch(COLORS.dark, 'not shown'), swatch(COLORS.scrolled, 'scrolled past'), swatch(COLORS.stopped, 'stopped'), swatch(COLORS.glad, 'glad'), swatch(COLORS.spreads, 'spread it'), swatch(COLORS.sorry, 'sorry'), swatch(COLORS.hollow, "can't tell")].join('  '));

const totals = counters(presetId, keys, reactions);
console.log(`\nreach ${totals.reach} of 10,000 in ${result.waves.length} wave${result.waves.length > 1 ? 's' : ''}`);
console.log(Object.entries(totals.byReaction).map(([key, count]) => `${key.replace('_', ' ')} ${count}`).join(' · '));

const LABELS = { interest: (id) => `into ${INTEREST[id].en}`, field: (id) => FIELDS[id].group, age: (id) => `aged ${AGE_GROUP[id].en}`, temper: (id) => `${TEMPER[id].en}s`, budget: (id) => BUDGET[id].en, shopping: (id) => `looking for ${SHOP[id].en}`, city: (id) => `from ${id}` };
const name = (segment) => LABELS[segment.attribute](segment.value);
const percent = (share) => `${Math.round(share * 100)}%`;

console.log('\nshown to: ' + Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, score]) => `${LABELS[id.split(':')[0]](id.split(':')[1])} ${score.toFixed(2)}`).join(', '));
const all = segments(presetId, keys, reactions, crowd(pool));
const line = (what) => topSegments(all, what).map((s) => `${name(s)} ${percent(s[what] / s.size)}`).join(', ') + ` (everybody: ${percent(totals[what] / reactions.length)})`;
console.log(`who stopped: ${line('stopped')}`);
console.log(`who was glad: ${line('glad')}`);
if (totals.sorry >= 10) console.log(`who got annoyed: ${line('sorry')}`);

if (result.followUp?.asked) {
  if (presetId === 'product') {
    console.log(`\nwhat the ${result.followUp.asked} who stopped would pay:`);
    const curve = demandCurve(result.followUp, prices);
    const best = curve.reduce((a, b) => (b.revenue > a.revenue ? b : a));
    for (const step of curve) console.log(`  ${currency}${String(step.price).padEnd(5)} ${String(step.buyers).padStart(5)} buyers  ${currency}${step.revenue}${step === best ? '  ← earns the most' : ''}`);
  } else {
    console.log(`\nwhat the ${result.followUp.asked} who stopped would ask first:`);
    for (const answer of rankedAnswers(result.followUp).slice(0, 6)) console.log(`  ${percent(answer.share).padStart(4)}  ${answer.text}`);
  }
}
console.log(`\n${result.requests} requests, ${result.tokens.toLocaleString('en')} tokens, $${result.usd.toFixed(4)}, ${result.seconds.toFixed(1)} s${result.failed ? `, ${result.failed} batches failed` : ''}`);
