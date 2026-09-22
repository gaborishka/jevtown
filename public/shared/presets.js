// What can be posted and what the crowd can do with it. This is the file to read to understand
// what Jev is asked; everything else is picking people, counting and drawing.
//
// A reaction is the most a persona does. `stopped` marks the ones where the text got attention,
// `tone` marks the ones the author would be glad (+1) or sorry (-1) to see. `did` is what the person
// did in plain words, for the questions the town is asked when a check closes: it says what they did,
// never why, since the reaction's own criteria would suggest the answer.
//
// Answer ids are stored with every finished check: add new ones, never rename or remove one.

export const CANT_TELL = 'cant_tell';
/** In stored reactions a persona's byte is 0 while the text has not reached it, otherwise 1 + the index of its reaction. */
export const NOT_SHOWN = 0;
const cantTell = { criteria: 'Nothing about this person hints at what they would do', hollow: true };
const PASSED = 'They saw it and went past without stopping.';

export const PRESETS = {
  post: {
    noun: 'post',
    who: 'Reader',
    seenIn: 'a social feed (Telegram, X) between dozens of other posts; people scroll fast and skip most of what they see',
    ask: 'What is the most this reader does with the post?',
    reactions: {
      scrolled_past: { criteria: 'Keeps scrolling: the topic is not theirs or the opening does not hook them', did: PASSED },
      read: { criteria: 'Stops and reads it, does nothing else', stopped: true, did: 'They stopped at it.' },
      liked: { criteria: 'Reads it and likes it', stopped: true, tone: 1, did: 'They liked it.' },
      disliked: { criteria: 'Reads it and is annoyed or disagrees', stopped: true, tone: -1, did: 'They disliked it.' },
      reposted: { criteria: 'Shares it with friends or reposts it', stopped: true, tone: 1, spreads: true, did: 'They shared it.' },
      followed: { criteria: 'Follows the author to see more', stopped: true, tone: 1, did: 'They followed the author.' },
      blocked: { criteria: 'Blocks or mutes the author', stopped: true, tone: -1, did: 'They blocked or muted the author.' },
      [CANT_TELL]: cantTell,
    },
  },
  listing: {
    noun: 'listing',
    who: 'Buyer',
    market: true,
    seenIn: 'a classifieds marketplace (OLX, Craigslist, Facebook Marketplace), in a long list of similar listings',
    ask: 'What is the most this buyer does with the listing?',
    reactions: {
      scrolled_past: { criteria: 'Keeps scrolling: does not need this thing, or the price or the title puts them off', did: PASSED },
      opened: { criteria: 'Opens the listing, looks and leaves', stopped: true, did: 'They opened it.' },
      saved: { criteria: 'Saves it to come back later', stopped: true, tone: 1, did: 'They saved it.' },
      wrote: { criteria: 'Writes or calls the seller', stopped: true, tone: 1, spreads: true, did: 'They wrote to or called the seller.' },
      scam: { criteria: 'Suspects a scam or a hidden defect and stays away', stopped: true, tone: -1, did: 'They stayed away from it.' },
      [CANT_TELL]: cantTell,
    },
    followUp: {
      ask: 'What would this buyer ask the seller first?',
      answers: {
        available: 'Is it still available?',
        negotiable: 'Is the price negotiable?',
        quick_discount: 'Will you give a discount if I take it today?',
        condition: 'What condition is it in, any scratches or wear?',
        defects: 'Does everything work, was it ever repaired?',
        how_old: 'How old is it and how much was it used?',
        why_selling: 'Why are you selling it?',
        original: 'Is it original, not a copy?',
        documents: 'Do you have the receipt, the box, the documents or a warranty?',
        included: 'What comes with it?',
        details: 'A technical detail the listing leaves out (battery, mileage, size, material)',
        photos: 'Can you send more photos or a video?',
        delivery: 'Do you ship it, and who pays for the delivery?',
        pickup: 'Where and when can I pick it up?',
        try_first: 'Can I check or try it before paying?',
        safe_deal: 'Can we use a safe deal or cash on delivery?',
        exchange: 'Would you trade it for something?',
        hold: 'Can you hold it for me for a few days?',
        bulk: 'Do you have more of these, is there a price for several?',
        nothing: 'Asks nothing: the listing answers everything, they just say they will take it',
      },
    },
  },
  product: {
    noun: 'product',
    who: 'Shopper',
    market: true,
    seenIn: 'an ad for the product that leads to its store page',
    ask: 'What is the most this shopper does?',
    reactions: {
      scrolled_past: { criteria: 'Ignores it: does not need it or does not believe it', did: PASSED },
      looked: { criteria: 'Opens the page, looks and leaves', stopped: true, did: 'They opened the page.' },
      cart: { criteria: 'Adds it to the cart or a wishlist, does not pay yet', stopped: true, tone: 1, did: 'They added it to the cart or a wishlist.' },
      bought: { criteria: 'Buys it', stopped: true, tone: 1, spreads: true, did: 'They bought it.' },
      [CANT_TELL]: cantTell,
    },
    // The answers are the steps of a price ladder, built by priceLadder().
    // Asked this strictly, the ladder agrees with the reactions: about as many people pay the listed
    // price as add to cart or buy. "What is the highest price they would pay" made nearly everybody a buyer.
    followUp: { ask: 'Does this shopper actually buy it, and at what price at most? Most people who look at a product do not buy it at any price.' },
  },
  headline: {
    noun: 'headline',
    who: 'Visitor',
    seenIn: 'a list of headlines: an inbox, a news page, search results',
    ask: 'What is the most this visitor does with the headline?',
    reactions: {
      scrolled_past: { criteria: 'Skips it', did: PASSED },
      glanced: { criteria: 'Reads the headline with interest but does not click', stopped: true, did: 'They read the headline and did not click.' },
      clicked: { criteria: 'Clicks to read more', stopped: true, tone: 1, spreads: true, did: 'They clicked it.' },
      annoyed: { criteria: 'Feels baited or irritated by it', stopped: true, tone: -1, did: 'It irritated them.' },
      [CANT_TELL]: cantTell,
    },
  },
};

/**
 * How a reaction looks on the grid, the same in the browser, in the terminal and on the link preview:
 * dark = not shown, scrolled, stopped (looked and did nothing), glad, spreads (glad and carries it
 * further), sorry, hollow (can't tell).
 */
export const LOOKS = { dark: '#141922', scrolled: '#39414f', hollow: '#5d6880', stopped: '#6ea8fe', glad: '#3ddc84', spreads: '#ffd84d', sorry: '#ff5c5c' };

export function lookOf(presetId, reactionId) {
  const reaction = PRESETS[presetId].reactions[reactionId];
  if (!reaction) return 'dark';
  if (reaction.hollow) return 'hollow';
  if (!reaction.stopped) return 'scrolled';
  return reaction.tone === -1 ? 'sorry' : reaction.spreads ? 'spreads' : reaction.tone === 1 ? 'glad' : 'stopped';
}

/** Price steps → the answers of the Product follow-up question. prices = [5, 9, 19, 49], currency = '$'. */
export function priceLadder(prices, currency = '$') {
  const answers = { p0: 'Does not buy it at any of these prices: does not need it, or only looks' };
  prices.forEach((price, index) => {
    const cost = `${currency}${price}`;
    answers[`p${index + 1}`] = index === 0 ? `Buys it only at ${cost} or less` : index === prices.length - 1 ? `Buys it even at ${cost}` : `Buys it at ${cost}, not above`;
  });
  return answers;
}

/**
 * When a check closes, the town is asked a few more questions: each goes to up to 100 of the people
 * it reached (feed.js:whoIsAsked), in one request. The answers are fixed lists, never shuffled, since
 * Jev leans towards the answer listed first (docs/measurements.md §2). Every list ends with DRAIN for
 * the people Jev cannot place; it is never shown as an answer, and shares are counted without it.
 */
export const DRAIN = 'Nothing about this person hints at an answer';

/**
 * Why those who scrolled past or got annoyed did so. `looks` says whom a reason is offered to,
 * `presets` narrows it to some kinds of text, and `audience` marks the reason that is about who read
 * the text rather than about the text. Every reason names something the author can change or aim
 * elsewhere: disagreeing with a listing names nothing a seller can change, so it is offered for posts
 * and headlines only.
 */
export const REASONS = {
  not_for_them: { criteria: 'Not for them: the topic or the thing has nothing to do with their life, work or interests', looks: ['scrolled'], audience: true },
  weak_opening: { criteria: 'It could interest them, but the first words give them no reason to stop', looks: ['scrolled'] },
  unclear: { criteria: 'They cannot tell quickly what it is about or what is offered', looks: ['scrolled', 'sorry'] },
  too_long: { criteria: 'Too long or too hard to take in at a glance', looks: ['scrolled'] },
  nothing_new: { criteria: 'Nothing new: they have seen the same thing many times', looks: ['scrolled', 'sorry'] },
  distrust: { criteria: 'They do not believe it: it looks like an ad, spam, bait, an exaggeration or a scam', looks: ['scrolled', 'sorry'] },
  tone: { criteria: 'The tone puts them off: rude, preachy, pushy, smug or trying too hard', looks: ['scrolled', 'sorry'] },
  disagree: { criteria: 'They disagree with what it says', looks: ['scrolled', 'sorry'], presets: ['post', 'headline'] },
  price: { criteria: 'The price is too high for them, or it is not worth it', looks: ['scrolled', 'sorry'], presets: ['listing', 'product'] },
  missing: { criteria: 'It leaves out something they need to decide: the price, the condition, the details', looks: ['scrolled', 'sorry'], presets: ['listing', 'product'] },
};

/**
 * The questions. A person is told what they did (`did` of their reaction), then asked `ask`. Why
 * takes its answers from REASONS; what made them stop has answers of its own for every preset.
 * "Would not comment" is a real answer, listed last among the real ones, and the question says that
 * most readers never comment, the way the strict product follow-up did.
 */
export const ASKS = {
  why: { ask: 'What is the main reason?', presets: ['post', 'listing', 'product', 'headline'] },
  hook: {
    ask: 'What made them stop?',
    presets: ['post', 'listing', 'product', 'headline'],
    answers: {
      post: {
        example: 'A concrete number, fact or example',
        story: 'A personal story or experience',
        useful: 'A tip they can use themselves',
        humour: 'It is funny',
        opinion: 'An opinion they share',
        // Second to last, so the lean towards the first answers does not favour it.
        opening: 'The first sentence made them want to read on',
        topic: 'Only the topic: it is what they care about',
      },
      listing: {
        price: 'The price looks fair or good',
        details: 'The details answer their questions: the condition, the specs, what comes with it',
        trust: 'The seller seems honest: the listing is specific and open',
        terms: 'The terms: delivery, checking it before paying, where to pick it up',
        need: 'Only that they need this thing',
      },
      product: {
        price: 'The price looks fair or good',
        benefit: 'It solves a problem they have',
        claims: 'They believe the claims: they sound concrete and checkable',
        guarantee: 'A guarantee or an easy return',
        details: 'The details answer their questions',
        need: 'Only that they need this kind of thing',
      },
      headline: {
        curiosity: 'Curiosity: they want to know what it is about or how it ends',
        promise: 'The promise: what they would get from reading it',
        detail: 'A concrete number or detail in it',
        news: 'It sounds new or important right now',
        topic: 'Only the topic: it is what they care about',
      },
    },
  },
  comment: {
    ask: 'What would they write in the comments, if anything? Most readers never comment.',
    presets: ['post'],
    answers: {
      adds_own: 'Agrees and adds their own experience',
      question: 'Asks the author a question',
      argues: 'Argues or points out a mistake',
      thanks: 'Thanks the author or praises it in a few words',
      joke: 'Makes a joke',
      tags: 'Tags a friend who should see it',
      none: 'Would not comment',
    },
  },
  depth: {
    ask: 'How far into it do they read?',
    presets: ['post', 'listing'],
    answers: { first_sentence: 'Only the first sentence', half: 'About half', to_end: 'To the end' },
  },
};

/**
 * How far people read is asked only of a text with somewhere to stop: "the first sentence", "about
 * half" and "to the end" are three different places from three sentences on, and under 200 characters
 * (four or five lines on a phone at about 45 characters a line) three sentences are taken in at a glance.
 */
export const DEPTH_FROM = 200;
export const DEPTH_SENTENCES = 3;

/** How many sentences a text has. A sentence ends at a line break, or at . ! ? … before a space, so "2.5" and "shop.com" end none. */
export const sentences = (text) => text.split(/[.!?…]+(?=\s|$)|\n/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;

/**
 * Where the answers are kept: a list per question, and two for why, since those who scrolled past
 * and those who got annoyed are offered different reasons and shown apart.
 */
export const LISTS = ['scrolled', 'sorry', 'hook', 'comment', 'depth'];
/** The list an answer goes to: for why, the look of the person's reaction; for the rest, the question's own. */
export const listOf = (question, look) => (question === 'why' ? look : question);
export const questionOfList = (list) => (list === 'scrolled' || list === 'sorry' ? 'why' : list);

/** The answers a question offers, the drain last. look matters for why alone. → { id: criteria, …, cant_tell } */
export function answersFor(question, presetId, look) {
  const reasons = () => Object.entries(REASONS).filter(([, reason]) => reason.looks.includes(look) && (!reason.presets || reason.presets.includes(presetId)));
  const answers = question === 'why' ? Object.fromEntries(reasons().map(([id, reason]) => [id, reason.criteria])) : question === 'hook' ? ASKS.hook.answers[presetId] : ASKS[question].answers;
  return { ...answers, [CANT_TELL]: DRAIN };
}

/** The questions a text is asked when its check closes, in the order of ASKS. */
export function asksFor(presetId, text) {
  const long = text.length >= DEPTH_FROM && sentences(text) >= DEPTH_SENTENCES;
  return Object.keys(ASKS).filter((question) => ASKS[question].presets.includes(presetId) && (question !== 'depth' || long));
}
