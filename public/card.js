// The card of a post: a picture to send to a friend or to put into a feed elsewhere. 1080×1350, drawn
// on a canvas in the browser, so it speaks the language of the page and needs no server. The number
// it is about is the reach: how many of the town saw the text.
import { GRID } from './shared/personas.js';
import { PRESETS, LOOKS, IN_AUDIENCE, lookOf, NOT_SHOWN } from './shared/presets.js';

export const CARD_W = 1080;
export const CARD_H = 1350;
const PAD = 72;
const INK = '#0b0e13';
const PANEL = '#10141b';
const LINE = '#1d2430';
const TEXT = '#eef1f5';
const DIM = '#8d97a8';
const ACCENT = '#ed6ca2';
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const DISPLAY = `ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', ${SANS}`;
const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace";

const picture = (src) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null); // a card without the logo is still a card
  image.src = src;
});

/** Words → lines no wider than `width`, `most` of them; the last one ends with an ellipsis when the text goes on. */
function linesOf(context, text, width, most) {
  const lines = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const longer = line ? `${line} ${word}` : word;
      if (context.measureText(longer).width <= width || !line) line = longer;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length <= most) return lines;
  let last = lines[most - 1];
  while (last && context.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  return [...lines.slice(0, most - 1), `${last.trimEnd()}…`];
}

/** The crowd of the post: the square of the 10,000 and, under it, the rows of the people visitors moved in. Members of an audience the text did not reach are lighter. */
function drawCrowd(context, presetId, reactions, left, top, side, audience = null) {
  const cell = side / GRID;
  const keys = Object.keys(PRESETS[presetId].reactions);
  const paths = {};
  for (let id = 0; id < reactions.length; id++) {
    const byte = reactions[id] ?? NOT_SHOWN;
    const look = byte ? lookOf(presetId, keys[byte - 1]) : audience?.[id] === 1 ? 'member' : 'dark';
    const path = (paths[look] ??= new Path2D());
    const x = left + ((id % GRID) + 0.5) * cell;
    const y = top + (Math.floor(id / GRID) + 0.5 + (id >= GRID * GRID ? 0.8 : 0)) * cell;
    path.moveTo(x + cell * 0.36, y);
    path.arc(x, y, cell * 0.36, 0, Math.PI * 2);
  }
  for (const [look, path] of Object.entries(paths)) {
    context.fillStyle = look === 'hollow' ? LOOKS.scrolled : look === 'member' ? IN_AUDIENCE : LOOKS[look];
    context.fill(path);
  }
}

/**
 * post: { text, by, kind, presetId, reactions, audience?, reach, size, headline, reachWords, counters: [{ look, value, label }], address }
 * → a canvas with the card on it.
 */
export async function drawCard(post) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const context = canvas.getContext('2d');
  context.fillStyle = INK;
  context.fillRect(0, 0, CARD_W, CARD_H);
  context.textBaseline = 'alphabetic';

  const logo = await picture('/brand/logo-dark.svg');
  if (logo) context.drawImage(logo, PAD, 60, (48 * logo.width) / logo.height, 48);
  context.font = `24px ${MONO}`;
  context.fillStyle = DIM;
  context.textAlign = 'right';
  context.fillText(post.address, CARD_W - PAD, 94);
  context.textAlign = 'left';

  // Who wrote it and what it is, then the text itself.
  context.font = `600 28px ${SANS}`;
  context.fillStyle = TEXT;
  context.fillText(post.by, PAD, 188);
  context.fillStyle = DIM;
  context.font = `28px ${SANS}`;
  context.fillText(` · ${post.kind}`, PAD + context.measureText(post.by).width + 4, 188);
  context.font = `500 38px ${SANS}`;
  context.fillStyle = TEXT;
  linesOf(context, post.text, CARD_W - PAD * 2, 5).forEach((line, index) => context.fillText(line, PAD, 250 + index * 52));

  // The reach: the number the card is about.
  const top = 540;
  context.fillStyle = ACCENT;
  context.font = `800 132px ${DISPLAY}`;
  context.fillText(post.reach, PAD - 4, top + 100);
  const share = Math.round((post.reachCount / post.size) * 100);
  const afterNumber = PAD + context.measureText(post.reach).width + 22;
  context.font = `800 48px ${DISPLAY}`;
  context.fillStyle = TEXT;
  if (afterNumber + context.measureText(`${share}%`).width < CARD_W - PAD) context.fillText(`${share}%`, afterNumber, top + 100);
  context.font = `30px ${SANS}`;
  context.fillStyle = DIM;
  context.fillText(post.reachWords, PAD, top + 150);
  context.font = `800 40px ${DISPLAY}`;
  context.fillStyle = TEXT;
  linesOf(context, post.headline, CARD_W - PAD * 2, 1).forEach((line) => context.fillText(line, PAD, top + 222));

  // The map of who saw it, and beside it what they did.
  const mapTop = top + 270;
  const side = 440;
  const rows = Math.ceil(post.reactions.length / GRID);
  const box = side + 40;
  context.fillStyle = PANEL;
  context.strokeStyle = LINE;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(PAD, mapTop, box, box, 28);
  context.fill();
  context.stroke();
  const fit = Math.min(side, (side * GRID) / (rows + (rows > GRID ? 1.2 : 0))); // a town with residents is a little taller than wide
  drawCrowd(context, post.presetId, post.reactions, PAD + 20 + (side - fit) / 2, mapTop + 20, fit, post.audience);

  const column = PAD + box + 56;
  post.counters.forEach(({ look, value, label }, index) => {
    const y = mapTop + 64 + index * 112;
    context.fillStyle = LOOKS[look];
    context.beginPath();
    context.arc(column + 12, y - 20, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = TEXT;
    context.font = `800 56px ${DISPLAY}`;
    context.fillText(value, column + 42, y);
    context.fillStyle = DIM;
    context.font = `26px ${SANS}`;
    context.fillText(label, column + 42, y + 38);
  });
  return canvas;
}
