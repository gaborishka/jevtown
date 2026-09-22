// From Jev's probabilities to what one persona does. The draw is seeded by the persona and the
// version of the text: a reload shows the same crowd, and two personas with the same odds can
// still act differently.
import { unit } from './rng.js';
import { CANT_TELL } from './presets.js';

/** Below this probability of the best answer Jev is guessing, and the persona gets a hollow dot. */
export const CONFIDENT_FROM = 0.35;

/** probabilities: { reaction: 0..1 } → reaction id. */
export function drawReaction(probabilities, pool, personaId, versionId) {
  const entries = Object.entries(probabilities);
  if (!entries.length) return CANT_TELL;
  if (Math.max(...entries.map(([, value]) => value)) < CONFIDENT_FROM) return CANT_TELL;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let left = unit('draw', pool, personaId, versionId) * total;
  for (const [reaction, value] of entries) {
    left -= value;
    if (left < 0) return reaction;
  }
  return entries.at(-1)[0];
}

/**
 * The answer of one persona to a follow-up or a closing question, drawn the same seeded way.
 * probabilities: { answer: 0..1 } → answer id, or null. Each question draws with its own salt, so two
 * questions asked of the same person do not draw alike; the follow-up keeps 'answer'.
 */
export function drawAnswer(probabilities, pool, personaId, versionId, salt = 'answer') {
  const entries = Object.entries(probabilities);
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let left = unit(salt, pool, personaId, versionId) * total;
  for (const [answer, value] of entries) {
    left -= value;
    if (left < 0) return answer;
  }
  return entries.at(-1)[0];
}
