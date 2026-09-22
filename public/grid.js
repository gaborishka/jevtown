// The crowd as a picture: 100×100 dots, one per persona, and under them a row for every hundred
// residents visitors moved in. Dots that have just reacted pop in one
// after another, so a wave is seen arriving; a finished check is replayed wave by wave; lit dots
// glow (a second, blurred canvas under the first); a group of people can be singled out while the
// rest fades; a crowd that waits for a text twinkles. With an audience, its members the text has not
// reached are lighter than the rest of the town.
import { GRID } from './shared/personas.js';
import { PRESETS, LOOKS, IN_AUDIENCE, lookOf, NOT_SHOWN } from './shared/presets.js';

const LOOK_NAMES = Object.keys(LOOKS);
const LIT = ['stopped', 'glad', 'spreads', 'sorry'];
const REACTION_PALETTE = [...LOOK_NAMES.map((name) => ({ color: LOOKS[name], hollow: name === 'hollow', glow: LIT.includes(name) })), { color: IN_AUDIENCE }];
const DARK = LOOK_NAMES.indexOf('dark');
const MEMBER = LOOK_NAMES.length; // in the post's audience, and not reached by the text

const POP_MS = 420;
const SPREAD_MS = 1400; // a batch of 100 people arrives over this long
const FAINT = 0.13; // how much is left of the people outside the group in focus
const TWINKLE_MS = 1300;
const TWINKLE_COLOR = '#93a4c4';
const GLOW_SCALE = 0.5;
const GAP = 0.8; // cells between the square of the 10,000 and the rows of the people visitors moved in
const HAIL_MS = 3600;
const FOOT = 0.4; // and under the last of those rows, so a ring around a house there is whole

/** byte of a stored reaction → index into the reaction palette */
export function looksOf(presetId) {
  const keys = Object.keys(PRESETS[presetId].reactions);
  return [DARK, ...keys.map((key) => LOOK_NAMES.indexOf(lookOf(presetId, key)))];
}

/** createGrid(host, { onHover(id | null, { x, y }), onPick(id), label }); host is an empty element with a square box. */
export function createGrid(host, { onHover, onPick, label = '', hint = '' } = {}) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches; // no pops, no waves, no twinkle: the final picture at once
  const glowCanvas = document.createElement('canvas');
  const canvas = document.createElement('canvas');
  glowCanvas.className = 'grid-glow';
  canvas.className = 'grid-dots';
  glowCanvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'img'); // the picture carries the story, so it has a name; describe() keeps it current
  canvas.setAttribute('aria-label', onPick && hint ? `${label}. ${hint}` : label);
  host.classList.add('grid');
  host.replaceChildren(glowCanvas, canvas);
  const context = canvas.getContext('2d');
  const glow = glowCanvas.getContext('2d');

  let palette = REACTION_PALETTE;
  let look = new Uint8Array(GRID * GRID).fill(DARK);
  let bornAt = new Float64Array(GRID * GRID);
  let rows = GRID;
  let focus = null; // Uint8Array: 1 = in the group that is singled out
  let members = null; // Uint8Array: 1 = in the post's audience; null = the whole town
  let marked = -1;
  let hailedAt = 0; // when the marked house was last hailed: rings run out of it for a while
  let hovered = -1;
  let twinkles = [];
  let idle = false;
  let nextTwinkle = 0;
  let frame = 0;
  let timer = 0;
  let size = 0; // the width of the picture in device pixels; its height is `rows` cells
  let lastBirth = 0; // when the last dot on its way arrives; one number instead of a scan of 10,000 every frame

  function resize() {
    const side = Math.round(canvas.getBoundingClientRect().width); // the host has a padding, the dots do not
    if (!side) return (size = 0); // hidden: nothing to draw, and the waiting twinkle stops too
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    size = side * ratio;
    canvas.width = size;
    canvas.height = Math.round((size * height()) / GRID);
    glowCanvas.width = Math.round(size * GLOW_SCALE);
    glowCanvas.height = Math.round(canvas.height * GLOW_SCALE);
    schedule();
  }

  /** The height of the picture in cells. */
  const height = () => rows + (rows > GRID ? GAP + FOOT : 0);

  /** The town has grown (or another town is shown): as many dots as it has people. */
  function fit(people) {
    if (!(people > 0) || people === look.length) return;
    const [oldLook, oldBorn] = [look, bornAt];
    look = new Uint8Array(people).fill(DARK);
    bornAt = new Float64Array(people);
    look.set(oldLook.subarray(0, people));
    bornAt.set(oldBorn.subarray(0, people));
    if (focus && focus.length < people) focus = null;
    if (Math.ceil(people / GRID) !== rows) {
      rows = Math.ceil(people / GRID);
      (host.closest('.grid-wrap') ?? host).style.setProperty('--rows', height()); // the names of the districts over the map keep to the square
      resize();
    }
  }

  const center = (id, cell) => [((id % GRID) + 0.5) * cell, (Math.floor(id / GRID) + 0.5 + (id >= GRID * GRID ? GAP : 0)) * cell];

  function draw(now) {
    frame = 0;
    if (!size) return;
    const cell = size / GRID;
    const radius = cell * 0.36;
    context.clearRect(0, 0, canvas.width, canvas.height);
    glow.setTransform(1, 0, 0, 1, 0, 0);
    glow.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    glow.setTransform(GLOW_SCALE, 0, 0, GLOW_SCALE, 0, 0);

    const growing = [];
    const waiting = new Path2D();
    const waitingMember = new Path2D();
    const byAudience = members && palette === REACTION_PALETTE;
    const bright = palette.map(() => new Path2D());
    const faint = palette.map(() => new Path2D());
    for (let id = 0; id < look.length; id++) {
      const [x, y] = center(id, cell);
      if (bornAt[id]) {
        if (now < bornAt[id]) {
          const path = byAudience && members[id] === 1 ? waitingMember : waiting;
          path.moveTo(x + radius, y);
          path.arc(x, y, radius, 0, Math.PI * 2);
          continue;
        }
        if (now < bornAt[id] + POP_MS) {
          growing.push(id);
          continue;
        }
        bornAt[id] = 0;
      }
      const path = (focus && !focus[id] ? faint : bright)[byAudience && look[id] === DARK && members[id] === 1 ? MEMBER : look[id]];
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, Math.PI * 2);
    }

    context.fillStyle = palette[DARK]?.color ?? LOOKS.dark;
    context.fill(waiting);
    context.fillStyle = IN_AUDIENCE;
    context.fill(waitingMember);
    palette.forEach((entry, index) => {
      for (const [path, alpha] of [[bright[index], 1], [faint[index], FAINT]]) {
        context.globalAlpha = alpha;
        if (entry.hollow) {
          context.lineWidth = Math.max(1, cell * 0.12);
          context.strokeStyle = entry.color;
          context.stroke(path);
        } else {
          context.fillStyle = entry.color;
          context.fill(path);
        }
      }
      context.globalAlpha = 1;
      if (entry.glow) {
        glow.fillStyle = entry.color;
        glow.fill(bright[index]);
      }
    });

    for (const id of growing) {
      const age = (now - bornAt[id]) / POP_MS;
      const [x, y] = center(id, cell);
      const entry = palette[look[id]];
      // Overshoots and settles: the dot pops.
      const scale = age < 0.6 ? (age / 0.6) * 1.7 : 1.7 - ((age - 0.6) / 0.4) * 0.7;
      context.globalAlpha = focus && !focus[id] ? FAINT : 1;
      context.beginPath();
      context.fillStyle = entry.hollow ? LOOKS.scrolled : entry.color;
      context.arc(x, y, radius * Math.max(0.2, scale), 0, Math.PI * 2);
      context.fill();
      if (entry.glow) {
        glow.beginPath();
        glow.fillStyle = entry.color;
        glow.arc(x, y, radius * Math.max(0.2, scale) * 1.3, 0, Math.PI * 2);
        glow.fill();
      }
    }
    context.globalAlpha = 1;

    if (idle && now >= nextTwinkle) {
      for (let i = 0; i < 14; i++) twinkles.push({ id: Math.floor(Math.random() * look.length), from: now + Math.random() * 400 });
      nextTwinkle = now + 260;
    }
    twinkles = twinkles.filter((twinkle) => now < twinkle.from + TWINKLE_MS);
    for (const twinkle of twinkles) {
      const age = (now - twinkle.from) / TWINKLE_MS;
      if (age < 0) continue;
      const [x, y] = center(twinkle.id, cell);
      context.globalAlpha = Math.sin(age * Math.PI) * 0.85;
      context.beginPath();
      context.fillStyle = TWINKLE_COLOR;
      context.arc(x, y, radius * (0.9 + Math.sin(age * Math.PI) * 0.5), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;

    for (const [id, color, reach] of [[hovered, 'rgba(238,241,245,.75)', 0.75], [marked, '#eef1f5', 0.95]]) {
      if (id < 0) continue;
      context.lineWidth = Math.max(1.5, cell * 0.2);
      // A ring around a house on the edge of the map moves inside it, so it stays whole.
      const room = cell * reach + context.lineWidth / 2 + 1;
      const [x, y] = center(id, cell).map((at, axis) => Math.min(Math.max(at, room), (axis ? height() : GRID) * cell - room));
      context.beginPath();
      context.strokeStyle = color;
      context.arc(x, y, cell * reach, 0, Math.PI * 2);
      context.stroke();
      if (id !== marked || !hailedAt || now > hailedAt + HAIL_MS) continue;
      for (const delay of [0, 0.33, 0.66]) {
        const age = ((now - hailedAt) / HAIL_MS) * 1.66 - delay;
        if (age <= 0 || age >= 1) continue;
        context.globalAlpha = (1 - age) * 0.8;
        context.beginPath();
        context.arc(x, y, cell * (reach + age * 9), 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    const moving = growing.length || lastBirth > now || (hailedAt && now < hailedAt + HAIL_MS);
    if (moving) schedule();
    else if (idle || twinkles.length) schedule(70); // a waiting crowd needs no 60 frames a second
  }

  function schedule(after = 0) {
    if (frame || timer) return;
    if (after) {
      timer = setTimeout(() => {
        timer = 0;
        frame = requestAnimationFrame(draw);
      }, after);
    } else frame = requestAnimationFrame(draw);
  }

  function redraw() {
    clearTimeout(timer);
    timer = 0;
    schedule();
  }

  const idAt = (event) => {
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - box.left) / box.width) * GRID);
    const down = ((event.clientY - box.top) / box.width) * GRID;
    const y = Math.floor(down < GRID ? down : Math.max(GRID - 0.5, down - GAP)); // the gap under the square belongs to nobody
    return x >= 0 && x < GRID && y >= 0 && (down < GRID || y >= GRID) && y * GRID + x < look.length ? y * GRID + x : null;
  };
  if (onHover) {
    canvas.addEventListener('pointermove', (event) => {
      const id = idAt(event);
      if ((id ?? -1) !== hovered) {
        hovered = id ?? -1;
        redraw();
      }
      onHover(id, { x: event.clientX, y: event.clientY });
    });
    canvas.addEventListener('pointerleave', () => {
      hovered = -1;
      redraw();
      onHover(null);
    });
  }
  if (onPick) {
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', (event) => {
      const id = idAt(event);
      if (id !== null) onPick(id);
    });
    // The same walk without a mouse: arrows move from person to person, Enter opens the one the ring is on.
    const STEPS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -GRID, ArrowDown: GRID };
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.addEventListener('keydown', (event) => {
      if (event.key in STEPS) {
        event.preventDefault();
        const from = hovered < 0 ? (GRID * GRID) / 2 + GRID / 2 : hovered; // the first step starts in the middle of the crowd
        const to = from + STEPS[event.key];
        const sameRow = Math.abs(STEPS[event.key]) !== 1 || Math.floor(to / GRID) === Math.floor(from / GRID);
        hovered = to >= 0 && to < look.length && sameRow ? to : from;
        const box = canvas.getBoundingClientRect();
        onHover?.(hovered, { x: box.left + (((hovered % GRID) + 0.5) / GRID) * box.width, y: box.top + ((Math.floor(hovered / GRID) + 0.5 + (hovered >= GRID * GRID ? GAP : 0)) / GRID) * box.width });
        redraw();
      } else if ((event.key === 'Enter' || event.key === ' ') && hovered >= 0) {
        event.preventDefault();
        onPick(hovered);
      }
    });
    canvas.addEventListener('blur', () => {
      hovered = -1;
      onHover?.(null);
      redraw();
    });
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  /** Dots of one replay come in this order: by the wave that reached them, or outwards from where the text landed. */
  function delays(reactions, waves, { gap, spread }) {
    const result = new Float64Array(look.length);
    if (waves?.some((wave) => wave > 0)) {
      for (let id = 0; id < look.length; id++) if (reactions[id]) result[id] = 1 + (Math.max(1, waves[id]) - 1) * gap + Math.random() * spread;
      return result;
    }
    let [sumX, sumY, count] = [0, 0, 0];
    for (let id = 0; id < look.length; id++) {
      if (reactions[id] > 1) {
        sumX += id % GRID;
        sumY += Math.floor(id / GRID);
        count += 1;
      }
    }
    const [homeX, homeY] = count ? [sumX / count, sumY / count] : [GRID / 2, GRID / 2];
    for (let id = 0; id < look.length; id++) {
      if (reactions[id]) result[id] = 1 + (Math.hypot((id % GRID) - homeX, Math.floor(id / GRID) - homeY) / GRID) * gap * 3 + Math.random() * spread;
    }
    return result;
  }

  return {
    /** The whole crowd at once, no animation. reactions: a byte per persona. */
    setAll(presetId, reactions) {
      fit(Math.max(look.length, reactions.length));
      palette = REACTION_PALETTE;
      const looks = looksOf(presetId);
      for (let id = 0; id < look.length; id++) look[id] = looks[reactions[id] ?? NOT_SHOWN];
      bornAt.fill(0);
      lastBirth = 0;
      redraw();
    },
    /** A batch that has just arrived: its dots pop in one after another. */
    arrive(presetId, ids, bytes) {
      palette = REACTION_PALETTE;
      const looks = looksOf(presetId);
      const start = performance.now();
      ids.forEach((id, i) => {
        if (id >= look.length) return; // somebody who moved in after this page learned the town
        look[id] = looks[bytes[i]];
        bornAt[id] = still ? 0 : start + (i / ids.length) * SPREAD_MS;
      });
      if (!still) lastBirth = Math.max(lastBirth, start + SPREAD_MS);
      redraw();
    },
    /** A finished check again, from the dark: wave after wave. → how long the replay takes, ms. */
    replay(presetId, reactions, waves, pace = { gap: 800, spread: 650 }) {
      fit(Math.max(look.length, reactions.length));
      palette = REACTION_PALETTE;
      const looks = looksOf(presetId);
      const start = performance.now();
      const after = delays(reactions, waves, pace);
      let longest = 0;
      for (let id = 0; id < look.length; id++) {
        look[id] = looks[reactions[id] ?? NOT_SHOWN];
        bornAt[id] = after[id] && !still ? start + after[id] : 0;
        if (after[id] > longest) longest = after[id];
      }
      lastBirth = still ? 0 : start + longest;
      redraw();
      return still ? 0 : longest + POP_MS;
    },
    /** Any picture of the crowd: an index per persona into colours of the caller's choosing. */
    paint(indices, colors) {
      fit(indices.length);
      palette = colors.map((color) => (typeof color === 'string' ? { color } : color));
      look.set(indices);
      bornAt.fill(0);
      lastBirth = 0;
      redraw();
    },
    /** The post's audience: mask[id] = 1 for its members, drawn lighter than the town until the text reaches them; null for the whole town. */
    setAudience(mask) {
      members = mask;
      redraw();
    },
    /** Singles out a group: mask[id] = 1 for its people; null brings everybody back. */
    focusOn(mask) {
      focus = mask;
      redraw();
    },
    /** How many people the picture has: the 10,000 and whoever visitors moved in. */
    people: fit,
    /** A crowd that waits for a text: dark, with a twinkle here and there. */
    wait(on = true) {
      idle = on && !still;
      if (on) {
        palette = REACTION_PALETTE;
        look.fill(DARK);
        bornAt.fill(0);
        lastBirth = 0;
      }
      redraw();
    },
    /** What the picture shows, in words, for those who do not see it. */
    describe(text) {
      canvas.setAttribute('aria-label', onPick && hint ? `${text}. ${hint}` : text);
    },
    /** Rings a house; with `hail` rings run out of it for a few seconds: somebody has just moved in. */
    mark(id, hail = false) {
      marked = id ?? -1;
      hailedAt = hail && !still ? performance.now() : 0;
      redraw();
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    },
  };
}

/** A still picture of a finished check, for a card in the feed: squares when small, dots when there is room. */
export function drawStill(canvas, presetId, reactions, audience = null) {
  const side = Math.round(canvas.getBoundingClientRect().width) || GRID;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const size = Math.max(GRID, side * ratio);
  canvas.width = canvas.height = size; // a card keeps the square of the 10,000: the rows under it do not fit a thumbnail
  const context = canvas.getContext('2d');
  const cell = size / GRID;
  const looks = looksOf(presetId);
  REACTION_PALETTE.forEach((entry, index) => {
    context.beginPath();
    for (let id = 0; id < GRID * GRID; id++) {
      const at = looks[reactions[id] ?? NOT_SHOWN];
      if ((at === DARK && audience?.[id] === 1 ? MEMBER : at) !== index) continue;
      const x = (id % GRID) * cell;
      const y = Math.floor(id / GRID) * cell;
      if (cell < 3) context.rect(x, y, cell * 0.9, cell * 0.9);
      else {
        context.moveTo(x + cell * 0.86, y + cell / 2);
        context.arc(x + cell / 2, y + cell / 2, cell * 0.36, 0, Math.PI * 2);
      }
    }
    context.fillStyle = entry.hollow ? LOOKS.scrolled : entry.color;
    context.fill();
  });
}
