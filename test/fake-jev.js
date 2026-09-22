// A stand-in for Jev that answers by the text it is shown, for tests that must not spend a key:
//   "tomatoes"        gardeners are glad, everybody else scrolls past
//   "meh"             everybody scrolls past
//   "coffee"          everybody is glad enough to send it on, to the last wave
//   "glad 0.30"       everybody is glad with that probability and scrolls past otherwise
//   "insult"          the moderation question about insults answers 0.95, so the site would refuse it
//   "rude"            the same question answers 0.6: the text would stay out of the public feed
// A listing's buyers ask about the price first; a product's shoppers pay up to the second price. Asked
// at the end, people give the first answer offered, then the second, and a tenth of it goes to the drain.
// It counts calls and requests in flight; delay, failures, dollars and tokens can be set.
import { PRESETS, ASKS, CANT_TELL } from '../public/shared/presets.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * createFakeJev({ delay, fail, usd, tokens, onSend }) → { send, calls, inFlight, mostInFlight, requests }.
 * delay is milliseconds, or delay(request, call) for a test that needs some calls slower than others.
 * fail(request, call) → true makes that call fail the way a busy Jev does; onSend(request, retries)
 * runs as a request is sent, for a test that moves a clock or looks at the retries allowance.
 */
export function createFakeJev({ delay = 0, fail = () => false, usd = 0.001, tokens = 100, onSend } = {}) {
  const fake = { calls: 0, inFlight: 0, mostInFlight: 0, requests: [] };
  fake.send = async (request, retries) => {
    fake.calls += 1;
    const call = fake.calls;
    fake.requests.push(request);
    fake.inFlight += 1;
    fake.mostInFlight = Math.max(fake.mostInFlight, fake.inFlight);
    try {
      onSend?.(request, retries);
      const wait = typeof delay === 'function' ? delay(request, call) : delay;
      if (wait) await sleep(wait);
      if (fail(request, call)) throw new Error('Jev 503: busy');
      return { answers: answer(request), tokens, usd };
    } finally {
      fake.inFlight -= 1;
    }
  };
  return fake;
}

/** What kind of request it is, by its questions. */
export const kindOf = ({ questions }) => {
  const first = Object.values(questions)[0];
  if (first.type === 'score') return 'opening';
  if ('negotiable' in first.criteria || 'p0' in first.criteria) return 'follow-up';
  if (closing(first)) return 'closing';
  return 'wave';
};

const closing = (question) => Object.values(ASKS).some(({ ask }) => question.instructions.endsWith(ask));

function answer({ state, questions }) {
  const presetId = Object.keys(PRESETS).find((id) => PRESETS[id].noun in state);
  const preset = PRESETS[presetId];
  const text = state[preset.noun];
  const reactions = Object.keys(preset.reactions);
  const glad = reactions.find((id) => preset.reactions[id].tone === 1);
  const looked = reactions.find((id) => preset.reactions[id].stopped && !preset.reactions[id].tone);
  const share = Number(/glad (\d\.\d+)/.exec(text)?.[1]);

  const answers = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'score') answers[id] = { score: text.includes('coffee') ? 3 : text.includes('meh') ? 1 : id === 'interest:gardening' && text.includes('tomatoes') ? 4 : 0 };
    else if (question.type === 'noul') answers[id] = { noul: id === 'unlisted:insult' ? (text.includes('insult') ? 0.95 : text.includes('rude') ? 0.6 : 0.02) : 0.02 };
    else if ('negotiable' in question.criteria) answers[id] = { probabilities: { negotiable: 0.6, photos: 0.4 } };
    else if ('p0' in question.criteria) answers[id] = { probabilities: { p0: 0.2, p1: 0.3, p2: 0.5 } };
    else if (closing(question)) {
      const [first, second] = Object.keys(question.criteria).filter((answer) => answer !== CANT_TELL);
      answers[id] = { probabilities: second ? { [first]: 0.6, [second]: 0.3, [CANT_TELL]: 0.1 } : { [first]: 0.9, [CANT_TELL]: 0.1 } };
    }
    else if (share >= 0) answers[id] = { probabilities: { [glad]: share, scrolled_past: 1 - share } };
    else if (text.includes('coffee')) answers[id] = { probabilities: { [glad]: 0.5, [looked]: 0.3, scrolled_past: 0.2 } };
    else if (text.includes('tomatoes') && /into [^;]*gardening/.test(question.instructions)) answers[id] = { probabilities: { [glad]: 0.8, [looked]: 0.2 } };
    else answers[id] = { probabilities: { scrolled_past: 1 } };
  }
  return answers;
}
