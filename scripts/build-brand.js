// Rebuild the committed Jevtown artwork. Only this export step uses resvg;
// the browser and Worker consume ordinary SVG, PNG and generated palette runs.
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'output/branding/jevtown/production');
const live = join(root, 'public/brand');
const ink = '#151821';
const pink = '#ED6CA2';
const white = '#EEF1F5';
const bg = '#090B10';
await Promise.all([mkdir(output, { recursive: true }), mkdir(live, { recursive: true })]);

const inner = (source) => source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '').trim();
const mark = inner(await readFile(join(root, 'brand/mark.svg'), 'utf8'));
const word = inner(await readFile(join(root, 'brand/wordmark.svg'), 'utf8'));
const recolor = (source, foreground, accent) => source.replaceAll(ink, foreground).replaceAll(pink, accent);
const svg = (w, h, content, label = 'Jevtown') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${content}</svg>\n`;
const logoBody = (foreground, accent) => `<g transform="translate(10 10)">${recolor(mark, foreground, accent)}</g><g transform="translate(316 70)">${recolor(word, foreground, accent)}</g>`;
const raster = (source, width) => new Resvg(source, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
const png = async (path, source, width) => writeFile(path, raster(source, width).asPng());

const variants = {
  light: [ink, pink],
  dark: [white, pink],
  black: ['#000000', '#000000'],
  white: ['#FFFFFF', '#FFFFFF'],
};
const logos = {};
for (const [name, [fg, accent]] of Object.entries(variants)) {
  const forms = {
    logo: svg(1160, 304, logoBody(fg, accent)),
    stacked: svg(880, 590, `<g transform="translate(300 18)">${recolor(mark, fg, accent)}</g><g transform="translate(24 332)">${recolor(word, fg, accent)}</g>`),
    mark: svg(280, 280, recolor(mark, fg, accent)),
    wordmark: svg(832, 224, recolor(word, fg, accent)),
  };
  logos[name] = forms.logo;
  for (const [form, source] of Object.entries(forms)) {
    const stem = `jevtown-${form}-${name}`;
    await writeFile(join(output, `${stem}.svg`), source);
    for (const width of form === 'mark' ? [256, 512, 1024] : [640, 1280, 2560]) {
      await png(join(output, `${stem}-${width}.png`), source, width);
    }
  }
  await writeFile(join(live, `logo-${name}.svg`), forms.logo);
  await writeFile(join(live, `mark-${name}.svg`), forms.mark);
}

// A fixed dark tile stays legible in both light and dark browser chrome.
const tile = (scale, rounded = false) => svg(512, 512, `<rect width="512" height="512"${rounded ? ' rx="112"' : ''} fill="${bg}"/><g transform="translate(${(512 - 280 * scale) / 2} ${(512 - 280 * scale) / 2}) scale(${scale})">${recolor(mark, white, pink)}</g>`);
const favicon = tile(1.55, true);
await writeFile(join(root, 'public/favicon.svg'), favicon);
await writeFile(join(root, 'public/mark.svg'), favicon); // legacy bookmarks
await writeFile(join(root, 'public/safari-pinned-tab.svg'), svg(280, 280, recolor(mark, '#000000', '#000000')));
const iconSources = [
  ['favicon-16x16.png', 16, favicon],
  ['favicon-32x32.png', 32, favicon],
  ['favicon-48x48.png', 48, favicon],
  ['favicon-96x96.png', 96, favicon],
  ['apple-touch-icon.png', 180, tile(1.25)],
  ['web-app-manifest-192x192.png', 192, tile(1.25)],
  ['web-app-manifest-512x512.png', 512, tile(1.25)],
  // All artwork lies within the central 80% circle of a maskable icon.
  ['web-app-manifest-maskable-512x512.png', 512, tile(1)],
  ['jevtown-avatar-1024.png', 1024, tile(1.25)],
];
for (const [name, width, source] of iconSources) await png(join(root, 'public', name), source, width);

// PNG-backed ICO directory: 16, 32 and 48 px in a single favicon.ico.
const sizes = [16, 32, 48];
const frames = sizes.map((size) => raster(favicon, size).asPng());
const directory = Buffer.alloc(6 + 16 * frames.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(frames.length, 4);
let offset = directory.length;
frames.forEach((frame, i) => {
  const at = 6 + 16 * i;
  directory[at] = directory[at + 1] = sizes[i];
  directory.writeUInt16LE(1, at + 4);
  directory.writeUInt16LE(32, at + 6);
  directory.writeUInt32LE(frame.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += frame.length;
});
await writeFile(join(root, 'public/favicon.ico'), Buffer.concat([directory, ...frames]));

const manifest = {
  id: '/', name: 'Jevtown', short_name: 'Jevtown',
  description: 'A social network where people write and 10,000 AI personas read.',
  start_url: '/', scope: '/', display: 'standalone',
  background_color: bg, theme_color: bg,
  icons: [
    { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/web-app-manifest-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
await writeFile(join(root, 'public/site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

// The default social card uses the outlined logo, so exports need no font.
const dots = Array.from({ length: 15 }, (_, row) => Array.from({ length: 29 }, (_, col) => `<circle cx="${40 + col * 40}" cy="${35 + row * 40}" r="2" fill="${(row + col) % 19 === 0 ? pink : '#29303E'}" opacity="${(row + col) % 19 === 0 ? '.35' : '.5'}"/>`).join('')).join('');
const og = svg(1200, 630, `<rect width="1200" height="630" fill="${bg}"/>${dots}<rect x="100" y="128" width="1000" height="374" rx="40" fill="${bg}"/><g transform="translate(158 187) scale(.76)">${logoBody(white, pink)}</g>`, 'Jevtown — 10,000 AI personas');
await writeFile(join(output, 'jevtown-social.svg'), og);
await png(join(live, 'og-default.png'), og, 1200);
await copyFile(join(live, 'og-default.png'), join(output, 'jevtown-social-1200x630.png'));

// A small pre-rendered lockup for dynamic post previews. Runs use a 14-color
// antialias palette on the existing OG background; no font or SVG renderer ships.
const bitmap = raster(logos.dark, 280);
const rgba = bitmap.pixels;
const base = [11, 14, 19];
const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const tones = [white, pink].flatMap((color) => Array.from({ length: 7 }, (_, i) => '#' + rgb(color).map((v, c) => Math.round(base[c] + (v - base[c]) * ((i + 1) / 7)).toString(16).padStart(2, '0')).join('')));
const indices = new Uint8Array(bitmap.width * bitmap.height);
for (let i = 0; i < indices.length; i++) {
  const level = Math.round(rgba[i * 4 + 3] / 255 * 7);
  if (level) indices[i] = level + (rgba[i * 4] > rgba[i * 4 + 1] + 20 ? 7 : 0);
}
const runs = [];
for (let y = 0; y < bitmap.height; y++) {
  for (let x = 0; x < bitmap.width;) {
    const at = y * bitmap.width + x, color = indices[at];
    let end = x + 1;
    while (end < bitmap.width && indices[y * bitmap.width + end] === color) end++;
    if (color) runs.push([at, end - x, color]);
    x = end;
  }
}
await writeFile(join(root, 'worker/brand-raster.js'), `// Generated by npm run build-brand from brand/*.svg. Do not edit.\nexport const BRAND_WIDTH = ${bitmap.width};\nexport const BRAND_HEIGHT = ${bitmap.height};\nexport const BRAND_COLORS = ${JSON.stringify(tones)};\nexport const BRAND_RUNS = new Uint16Array([\n${runs.map((run) => '  ' + run.join(', ')).join(',\n')}\n]);\n`);

const icons = join(output, 'icons');
await mkdir(icons, { recursive: true });
for (const name of ['favicon.svg', 'favicon.ico', 'safari-pinned-tab.svg', 'site.webmanifest', ...iconSources.map(([name]) => name)]) {
  await copyFile(join(root, 'public', name), join(icons, name));
}
// The usage notes and the preview page are kept locally, not in the repository.
for (const [from, to] of [['brand/README.md', 'README.md'], ['brand/preview.html', 'index.html']]) {
  if (existsSync(join(root, from))) await copyFile(join(root, from), join(output, to));
}
console.log(`Jevtown: outlined SVG + transparent PNG, browser/mobile icons, manifest and social assets exported to ${output}`);
