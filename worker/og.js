// The picture a messenger shows next to a link to a post: 1200×630, drawn here pixel by pixel
// into an 8-bit palette PNG. No font engine and no image library, so text is a 5×7 bitmap font of
// Latin capitals and digits; the crowd itself needs no words. The same code runs in a Worker and in Node.
import { GRID } from '../public/shared/personas.js';
import { PRESETS, LOOKS, lookOf, NOT_SHOWN } from '../public/shared/presets.js';
import { BRAND_WIDTH, BRAND_COLORS, BRAND_RUNS } from './brand-raster.js';

export const OG_W = 1200;
export const OG_H = 630;

const GLYPHS = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .###.',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# ##..# #.#.# #..## #...# #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# ##.## #...#',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '##### ...#. ..#.. ...#. ....# #...# .###.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '..##. .#... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ...#. .##..',
  '%': '##... ##..# ...#. ..#.. .#... #..## ...##',
  '@': '.###. #...# #.### #.#.# #.### #.... .###.',
  _: '..... ..... ..... ..... ..... ..... #####',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  '-': '..... ..... ..... ##### ..... ..... .....',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
};
const ROWS = Object.fromEntries(Object.entries(GLYPHS).map(([char, rows]) => [char, rows.split(' ')]));

const BASE = ['#0b0e13', '#151a22', '#eef1f5', '#8a93a3', '#2a3240'];
const [INK, PANEL, TEXT, DIM] = [0, 1, 2, 3];
const LOOK_INDEX = Object.fromEntries(Object.keys(LOOKS).map((look, i) => [look, BASE.length + i]));
const BRAND_START = BASE.length + Object.keys(LOOKS).length;
const PALETTE = [...BASE, ...Object.values(LOOKS), ...BRAND_COLORS];

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((char) => char.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** pixels: palette indices, row by row. */
async function encodePng(pixels, width, height) {
  const raw = new Uint8Array((width + 1) * height); // every row starts with filter type 0
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 3, 0, 0, 0], 8); // 8 bits, palette colour
  const palette = Uint8Array.from(PALETTE.flatMap((hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))));
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('PLTE', palette), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) png.set(part, at), (at += part.length);
  return png;
}

function canvas() {
  const pixels = new Uint8Array(OG_W * OG_H).fill(INK);
  const rect = (x, y, width, height, color) => {
    const [x0, x1] = [Math.max(0, Math.round(x)), Math.min(OG_W, Math.round(x + width))];
    const [y0, y1] = [Math.max(0, Math.round(y)), Math.min(OG_H, Math.round(y + height))];
    for (let row = y0; row < y1; row++) pixels.fill(color, row * OG_W + x0, row * OG_W + x1);
  };
  const textWidth = (string, scale) => string.length * 6 * scale - scale;
  /** align 'end' puts the right edge of the text at x. */
  const text = (string, x, y, scale, color, align = 'start') => {
    let left = align === 'end' ? x - textWidth(string, scale) : x;
    for (const char of string) {
      ROWS[char]?.forEach((row, r) => [...row].forEach((cell, c) => cell === '#' && rect(left + c * scale, y + r * scale, scale, scale, color)));
      left += 6 * scale;
    }
  };
  return { pixels, rect, text, textWidth };
}

const thousands = (count) => String(count).replace(/\B(?=(\d{3})+$)/g, ' ');

/** { presetId, reactions: Uint8Array, counters } as stored; site = the host printed in the corner. Returns PNG bytes. */
export async function renderOg({ presetId, reactions, counters }, site = '') {
  const { pixels, rect, text } = canvas();
  const keys = Object.keys(PRESETS[presetId].reactions);

  // The crowd: 100×100 people, 5 px each with a 1 px gap; the people visitors moved in fill a row or two under them.
  const CELL = 6;
  const [LEFT, TOP] = [48, 15];
  for (let id = 0; id < reactions.length; id++) {
    const look = reactions[id] === NOT_SHOWN ? 'dark' : lookOf(presetId, keys[reactions[id] - 1]);
    rect(LEFT + (id % GRID) * CELL, TOP + Math.floor(id / GRID) * CELL, CELL - 1, CELL - 1, LOOK_INDEX[look]);
  }

  // The mark, the reach, the counters.
  const X = 712;
  for (let i = 0; i < BRAND_RUNS.length; i += 3) {
    const [position, length, color] = BRAND_RUNS.subarray(i, i + 3);
    rect(X + position % BRAND_WIDTH, 42 + Math.floor(position / BRAND_WIDTH), length, 1, BRAND_START + color - 1);
  }
  text(site.toUpperCase().slice(0, 30), X, 120, 2, DIM);

  text('REACH', X, 150, 3, DIM);
  text(thousands(counters.reach), X, 186, 12, TEXT);
  text(`OF ${thousands(Math.max(GRID * GRID, reactions.length))}`, X, 290, 3, DIM); // the town as it was when the text was posted

  const rows = [['STOPPED', counters.stopped, 'stopped'], ['GLAD', counters.glad, 'glad'], ['SORRY', counters.sorry, 'sorry']];
  const most = Math.max(1, ...rows.map(([, count]) => count));
  rows.forEach(([label, count, look], i) => {
    const y = 370 + i * 76;
    rect(X, y, 16, 16, LOOK_INDEX[look]);
    text(label, X + 30, y + 1, 2, DIM);
    text(thousands(count), OG_W - 48, y - 6, 4, TEXT, 'end');
    rect(X, y + 32, OG_W - 48 - X, 6, PANEL);
    rect(X, y + 32, Math.max(count ? 3 : 0, ((OG_W - 48 - X) * count) / most), 6, LOOK_INDEX[look]);
  });
  return encodePng(pixels, OG_W, OG_H);
}
