// Seeded randomness. Everything random in the crowd (who a persona is, what they do with a post)
// comes from here, so the same ids always give the same people and the same reactions.

/** FNV-1a over the parts joined with a separator → unsigned 32-bit integer. */
export function hash32(...parts) {
  const text = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // A final scramble: FNV alone leaves neighbouring ids with neighbouring hashes.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** A number in [0, 1) that depends only on the parts. */
export const unit = (...parts) => hash32(...parts) / 2 ** 32;

/** mulberry32: a small generator, () → [0, 1). */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Picks an item by weight; `u` is a number in [0, 1). */
export function pickWeighted(items, weightOf, u) {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let left = u * total;
  for (const item of items) {
    left -= weightOf(item);
    if (left < 0) return item;
  }
  return items.at(-1);
}
