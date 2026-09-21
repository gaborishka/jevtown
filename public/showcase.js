// The first thing a visitor sees working: one listing about a phone, written two ways, and what
// the Ukrainian crowd did with each. Both are real finished checks saved to a file, so switching
// between them asks nobody anything and works on an empty database too.
import { createGrid } from './grid.js';
import { LOOKS } from './shared/presets.js';

const FILE = '/examples/iphone.json';
const PACE = { gap: 460, spread: 400 };

const bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/** → { element, play(), destroy() }. `h` and `icon` are the page's own builders, `t` its dictionary. */
export function createShowcase({ h, icon, t }) {
  const words = t.show;
  let alive = true;
  let versions = null;
  let shown = 0;

  const host = h('div', {});
  const grid = createGrid(host, { label: words.map });
  const index = h('span', { class: 'showcase-index' });
  const tabs = words.variants.map((label, number) => h('button', { type: 'button', disabled: true, 'aria-pressed': number === shown, onclick: () => show(number, true) },
    h('span', { class: 'showcase-number' }, `0${number + 1}`), label));
  const excerpt = h('p', { class: 'showcase-excerpt', lang: 'uk' }); // the listing is Ukrainian whatever the language of the interface
  const metrics = h('div', { class: 'showcase-metrics' });
  const finding = h('div', { class: 'showcase-finding', role: 'status' }, h('p', { class: 'dim' }, words.loading));
  const replay = h('button', { type: 'button', class: 'link', disabled: true, onclick: () => show(shown, true) }, icon('replay', 13), t.post.replay);

  const element = h('section', { class: 'showcase', 'aria-label': words.title },
    h('div', { class: 'showcase-top' }, h('span', { class: 'showcase-kicker' }, h('i', { class: 'live' }), words.kicker), index),
    h('h2', {}, words.title),
    h('div', { class: 'showcase-tabs', role: 'group', 'aria-label': words.title }, ...tabs),
    h('div', { class: 'showcase-body' },
      h('div', { class: 'showcase-map' }, host),
      h('div', { class: 'showcase-side' }, excerpt, metrics, finding)),
    h('div', { class: 'showcase-foot' },
      h('ul', { class: 'legend' }, ...[['scrolled', t.looks.scrolled], ['stopped', t.looks.stopped], ['spreads', t.reactions.wrote[0]], ['sorry', t.reactions.scam[0]]].map(([look, label]) =>
        h('li', {}, h('i', { class: 'dot', style: `--c:${LOOKS[look]}` }), label))),
      replay));

  function show(number, moving) {
    if (!versions || !alive) return;
    shown = number;
    const { text, counters, reactions } = versions[shown];
    element.dataset.variant = shown;
    index.textContent = `0${shown + 1} / 0${versions.length}`;
    tabs.forEach((tab, at) => {
      tab.disabled = false;
      tab.classList.toggle('on', at === shown);
      tab.setAttribute('aria-pressed', String(at === shown));
    });
    excerpt.replaceChildren(h('q', {}, text));
    // These two checks were made before waves were recorded per persona: the replay spreads from where the listing landed.
    if (moving) grid.replay('listing', reactions, null, PACE);
    else grid.setAll('listing', reactions);
    const numbers = [[counters.reach, t.counters.reach, null], [counters.byReaction.wrote, t.reactions.wrote[0], LOOKS.spreads], [counters.byReaction.scam, t.reactions.scam[0], LOOKS.sorry]];
    metrics.replaceChildren(...numbers.map(([value, label, color]) => h('div', { class: 'showcase-stat' }, h('b', { style: color ? `color:${color}` : null }, t.n(value)), h('span', {}, label))));
    const [headline, detail] = words.findings[shown](counters);
    finding.replaceChildren(h('strong', {}, headline), h('p', {}, detail));
    grid.describe(`${words.map}. ${headline} ${detail}`);
  }

  fetch(FILE).then((response) => (response.ok ? response.json() : Promise.reject(new Error(`example ${response.status}`)))).then((saved) => {
    if (!alive) return;
    versions = saved.versions.map((version) => ({ ...version, reactions: bytes(version.reactions) }));
    replay.disabled = false;
    show(0, false);
  }).catch(() => alive && finding.replaceChildren(h('p', { class: 'dim' }, words.unavailable)));

  return {
    element,
    /** "How it works": the other way of writing the same listing, played out on the map. */
    play: () => show(shown ? 0 : 1, true),
    destroy() {
      alive = false;
      grid.destroy();
    },
  };
}
