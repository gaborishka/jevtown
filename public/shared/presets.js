// What can be posted and what the crowd can do with it. This is the file to read to understand
// what Jev is asked; everything else is picking people, counting and drawing.
//
// A reaction is the most a persona does. `stopped` marks the ones where the text got attention,
// `tone` marks the ones the author would be glad (+1) or sorry (-1) to see.

export const CANT_TELL = 'cant_tell';
/** In stored reactions a persona's byte is 0 while the text has not reached it, otherwise 1 + the index of its reaction. */
export const NOT_SHOWN = 0;
const cantTell = { criteria: 'Nothing about this person hints at what they would do', hollow: true };

export const PRESETS = {
  post: {
    noun: 'post',
    who: 'Reader',
    seenIn: 'a social feed (Telegram, X) between dozens of other posts; people scroll fast and skip most of what they see',
    ask: 'What is the most this reader does with the post?',
    reactions: {
      scrolled_past: { criteria: 'Keeps scrolling: the topic is not theirs or the opening does not hook them' },
      read: { criteria: 'Stops and reads it, does nothing else', stopped: true },
      liked: { criteria: 'Reads it and likes it', stopped: true, tone: 1 },
      disliked: { criteria: 'Reads it and is annoyed or disagrees', stopped: true, tone: -1 },
      reposted: { criteria: 'Shares it with friends or reposts it', stopped: true, tone: 1, spreads: true },
      followed: { criteria: 'Follows the author to see more', stopped: true, tone: 1 },
      blocked: { criteria: 'Blocks or mutes the author', stopped: true, tone: -1 },
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
      scrolled_past: { criteria: 'Keeps scrolling: does not need this thing, or the price or the title puts them off' },
      opened: { criteria: 'Opens the listing, looks and leaves', stopped: true },
      saved: { criteria: 'Saves it to come back later', stopped: true, tone: 1 },
      wrote: { criteria: 'Writes or calls the seller', stopped: true, tone: 1, spreads: true },
      scam: { criteria: 'Suspects a scam or a hidden defect and stays away', stopped: true, tone: -1 },
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
      scrolled_past: { criteria: 'Ignores it: does not need it or does not believe it' },
      looked: { criteria: 'Opens the page, looks and leaves', stopped: true },
      cart: { criteria: 'Adds it to the cart or a wishlist, does not pay yet', stopped: true, tone: 1 },
      bought: { criteria: 'Buys it', stopped: true, tone: 1, spreads: true },
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
      scrolled_past: { criteria: 'Skips it' },
      glanced: { criteria: 'Reads the headline with interest but does not click', stopped: true },
      clicked: { criteria: 'Clicks to read more', stopped: true, tone: 1, spreads: true },
      annoyed: { criteria: 'Feels baited or irritated by it', stopped: true, tone: -1 },
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
