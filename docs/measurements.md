# Measurements

What Jev does with a crowd, measured before any interface was built. Run on 2026-09-19 with `scripts/probe.js` against TypeSafe's API, model `jev-1.13.0`. All of it cost $0.80. Raw numbers land in `data/probe/` and are not committed; to repeat a step:

```bash
node --env-file=.env.local scripts/probe.js attributes batch presets crowd waves calibrate throughput first-waves
```

The texts are in the script: three Ukrainian posts (tomato seedlings, coding with an AI assistant, the price of coffee), an iPhone listing, a product (running socks, English crowd), a headline, and six weak texts (spam, "good morning", a vague post, a rage post, a vague listing, a scam listing).

## What follows from them

1. Personas work. One changed attribute moves the answer several times over, in the direction a person would expect.
2. One request holds up to 255 personas, and a persona answers the same alone, among 50 and among 200. The engine sends 100 to 200 per request.
3. A persona costs 170 to 250 input tokens. The whole crowd is $0.07 to $0.10, the first wave of 600 is half a cent, the feed algorithm's scoring is $0.0003.
4. The key's ceiling is throughput, not the number of requests: 200 to 460 personas a second however the work is sliced. The first wave takes 2 to 4 seconds, the whole crowd 22 to 50.
5. The feed algorithm finds the right people: its first 500 people hold 83 to 97% of the reactions the best possible 500 would.
6. Jev tells a weak text from a strong one, and the difference is widest in the first wave. "Glad minus sorry" of a wave, with a threshold of 0.1, separates all six weak texts from all six strong ones.
7. With four waves (600, 1,500, 3,000, the rest) a niche post stops at 5,100 people, a broad one reaches everybody, a listing stops at 2,100, a weak text dies at 600.
8. Jev goes by a person's own earlier reactions: six near ones lift its guesses about that person from 0.49 to 0.72. This is what tunes a resident a visitor moved in.
9. Jev goes by whom a persona follows: `; follows this author` adds 0.12 to 0.17 of glad reactions and leaves spam where it was. The site does not use it: every post is on its own.

## 1. Do persona attributes move the answers?

The same 40 people spread over the grid, one attribute changed at a time, 10 per request. The numbers are mean probabilities; "stopped" is everything except "scrolled past" and "can't tell".

Post about tomato seedlings:

| The same 40 people | stopped | read | liked | disliked | reposted |
|---|---|---|---|---|---|
| as generated | 0.34 | 0.21 | 0.11 | 0.01 | 0.02 |
| into gardening | 0.93 | 0.47 | 0.36 | 0.01 | 0.07 |
| into programming | 0.15 | 0.11 | 0.03 | 0.01 | 0.00 |
| all trolls | 0.26 | 0.15 | 0.05 | 0.05 | 0.01 |
| all supporters | 0.37 | 0.18 | 0.18 | 0.00 | 0.01 |
| all lurkers | 0.29 | 0.28 | 0.01 | 0.00 | 0.00 |

Post about coding with an AI assistant: into gardening 0.18, into programming 0.72, developers aged 28 0.85, pensioners aged 68 0.20.

iPhone listing (14,000 UAH, Lviv):

| The same 40 people | stopped | opened | wrote to the seller | smelled a scam |
|---|---|---|---|---|
| looking for nothing | 0.19 | 0.17 | 0.02 | 0.01 |
| looking for a phone | 0.82 | 0.40 | 0.37 | 0.01 |
| … on a tight budget | 0.74 | 0.37 | 0.33 | 0.01 |
| … wealthy | 0.82 | 0.31 | 0.46 | 0.01 |
| … living in Lviv | 0.91 | 0.33 | 0.52 | 0.00 |
| … skeptics | 0.87 | 0.47 | 0.35 | 0.02 |

Running socks at $24, and the highest price the shopper would pay:

| The same 40 people | stopped | bought | up to $9 | up to $15 | up to $24 | $39 or more |
|---|---|---|---|---|---|---|
| into anime | 0.19 | 0.00 | 0.12 | 0.36 | 0.29 | 0.09 |
| into running | 0.49 | 0.04 | 0.06 | 0.36 | 0.39 | 0.12 |
| into running, tight budget | 0.36 | 0.01 | 0.13 | 0.47 | 0.23 | 0.06 |
| into running, wealthy | 0.58 | 0.08 | 0.03 | 0.14 | 0.44 | 0.32 |

That ladder was asked as "what is the highest price this shopper would pay", and it made nearly everybody a buyer: 90% of runners named a price, while 4% of them buy at $24 when shown the product at that price. Asked strictly ("does this shopper actually buy it, and at what price at most? Most people who look at a product do not buy it at any price"), 48% of runners and 22% of other people name a price, and about as many pay the listed price as add to cart or buy. The strict wording is the one in `public/shared/presets.js`.

Interests, the job, the age, the temper, the budget, the city and what the persona is shopping for all reach the answer. "Can't tell" stays under 1% for posts and listings and takes 4 to 7% for the product.

## 2. How many personas fit in one request?

50 people, the seedlings post. "Distance" is the mean total variation distance from the answer the same persona gave when asked alone; asking alone twice already gives 0.025, so that is the noise floor.

| Personas per request | distance from asked alone | same top answer | stopped | tokens per persona | ms per request |
|---|---|---|---|---|---|
| 1 | 0 | 100% | 0.403 | 755 | 294 |
| 1, asked again | 0.025 | 100% | 0.403 | 755 | 285 |
| 10 | 0.024 | 100% | 0.408 | 294 | 271 |
| 25 | 0.025 | 100% | 0.401 | 264 | 285 |
| 50 | 0.023 | 100% | 0.403 | 249 | 328 |
| 200 (150 strangers added) | 0.023 | 98% | 0.405 | 241 | 1,248 |
| 50, personas in reverse order | 0.023 | 98% | 0.403 | 249 | 304 |
| 50, reactions listed backwards | 0.062 | 96% | 0.364 | 249 | 299 |

Batching is free: questions in one request do not see each other, and their order does not matter. The order of the reactions inside a question does matter a little (Jev leans towards what is listed first), so it is fixed in `public/shared/presets.js` and never shuffled.

The ceiling: 255 personas in one request work (61,196 tokens, 1.4 s), 300 are refused with `max_tokens_exceeded`.

Shorter reaction descriptions bring a persona from 244 to 185 tokens and move the answers by 0.07, three times the noise. Most of the tokens are per-question overhead, so the full descriptions stay.

## 3. Throttling and speed

The whole crowd, 50 requests of 200 personas:

| Requests in flight | seconds | personas per second | throttled (429) | failed | ms per request, median |
|---|---|---|---|---|---|
| 4 | 42.0 | 238 | 0 | 0 | 2,602 |
| 8 | 21.7 | 461 | 0 | 0 | 3,277 |
| 16 | 26.4 | 379 | 0 | 0 | 7,391 |
| 25 | 23.9 | 418 | 0 | 0 | 10,816 |
| 50 (all at once) | 29.4 | 340 | 50 | 0 | 9,223 |

2,000 personas, a few minutes later: 200 per request and 8 in flight gave 192 personas a second, 100 × 8 gave 286, 50 × 8 gave 230, 50 × 16 gave 225, 25 × 16 gave 157.

More requests in flight do not help past 8: each one just takes longer. The ceiling is 200 to 460 personas a second, which is 50 to 110 thousand tokens a second, and it moves with the time of day. Every throttled request succeeded on a retry. The engine uses 100 personas per request with 6 to 8 in flight. OpenRouter was not measured: `.env.local` has a TypeSafe key only.

On the hosted copy this ceiling is shared by everybody: one to three whole crowds a minute, or twenty to forty-five first waves.

## 4. Tokens and dollars

| Preset | tokens per persona | first wave (600) | whole crowd | scoring request | follow-up, per 1,000 personas |
|---|---|---|---|---|---|
| Post | 249 | $0.0063 | $0.10 | 60 questions, 5,608 tokens, $0.00024, 263 ms | none |
| Listing | 218 | $0.0055 | $0.09 | 83 questions, 7,535 tokens, $0.00032, 535 ms | $0.022 (20 buyer questions) |
| Product | 187 | $0.0047 | $0.08 | 83 questions, 7,428 tokens, $0.00031, 552 ms | $0.007 (price ladder) |
| Headline | 169 | $0.0043 | $0.07 | 60 questions, 5,415 tokens, $0.00023, 267 ms | none |

The follow-up question is asked only of personas who stopped. For the iPhone listing that is about 540 people of the 2,100 it reaches: one more cent.

## 5. Does the feed algorithm find the right people?

Each text was shown to the whole crowd once. The share of all "stopped" reactions that the top N people by exposure would have caught, against the best possible N:

| Text | crowd that stops | top 500, algorithm | top 500, best possible | top 2,000, algorithm | top 2,000, best possible |
|---|---|---|---|---|---|
| Seedlings post | 30% | 0.158 | 0.162 | 0.500 | 0.524 |
| AI assistant post | 23% | 0.180 | 0.193 | 0.564 | 0.597 |
| Coffee post | 75% | 0.060 | 0.063 | 0.221 | 0.243 |
| iPhone listing | 12% | 0.295 | 0.309 | 0.443 | 0.658 |
| Socks | 30% | 0.119 | 0.144 | 0.350 | 0.458 |

What Jev said the texts were for: seedlings, `gardening 0.93, summer house 0.84, farmers 0.66, pensioners 0.63`; AI assistant, `IT 0.94, programming 0.92, AI tools 0.90, career 0.77`; iPhone, `looking for a phone 0.85, aged 25–34 0.61, 18–24 0.61`; socks, `running and cycling 0.91, gym 0.86, looking for sports gear 0.79`.

Exposure is the sum of cubes of the scores of a persona's own attributes. Four formulas were compared on these answers at no cost; the weighted average the plan started with caught only 0.213 of the listing's reactions with its top 500, because several lukewarm matches outweighed the one that matters, "is looking for a phone". Past the first 500 the listing and the product fall behind the best possible order: who opens a listing depends on the city and the budget in ways the group scores do not capture. The later waves correct part of it.

## 6. Does a weak text get a weak reaction?

The real first wave (600 people picked by the algorithm) for every text. "Glad" is liked, reposted, followed, saved, wrote, added to cart, bought, clicked; "sorry" is disliked, blocked, smelled a scam, annoyed.

| Text | stopped | glad | sorry | glad minus sorry |
|---|---|---|---|---|
| Spam ("earn $5,000 a month") | 0.25 | 0.02 | 0.07 | −0.04 |
| "Good morning everyone" | 0.26 | 0.11 | 0.00 | 0.11 |
| Vague post | 0.15 | 0.02 | 0.00 | 0.01 |
| Rage post | 0.50 | 0.10 | 0.19 | −0.09 |
| Vague listing ("selling a phone, price negotiable") | 0.09 | 0.02 | 0.01 | 0.01 |
| Scam listing (new iPhone 15 Pro Max, prepayment only) | 0.61 | 0.05 | 0.44 | −0.39 |
| Seedlings post | 0.82 | 0.34 | 0.00 | 0.33 |
| AI assistant post | 0.71 | 0.24 | 0.01 | 0.23 |
| Coffee post | 0.87 | 0.29 | 0.01 | 0.27 |
| iPhone listing | 0.44 | 0.19 | 0.00 | 0.18 |
| Socks | 0.53 | 0.12 | 0.00 | 0.12 |
| Headline | 0.86 | 0.23 | 0.06 | 0.18 |

"Stopped" alone does not separate them: the scam listing and the rage post stop plenty of people. Glad minus sorry does. The rule in `public/shared/feed.js`: a wave sends the text further when glad minus sorry is at least 0.1 of the wave. "Good morning" passes by a hair, which is how such posts do in real feeds.

## 7. The waves, played back on the whole-crowd answers

Reactions drawn from the saved probabilities, waves of 600, 1,500, 3,000 and the rest; after the first one the algorithm ranks people by what their kind actually did.

| Text | wave 1 mood | wave 2 mood | wave 3 mood | reach | caught of all who would stop | cost |
|---|---|---|---|---|---|---|
| Seedlings post | 0.34 | 0.20 | 0.05, stops | 5,100 | 74% | $0.05 |
| AI assistant post | 0.25 | 0.15 | 0.03, stops | 5,100 | 79% | $0.05 |
| Coffee post | 0.28 | 0.24 | 0.20 | 10,000 | 100% | $0.10 |
| iPhone listing | 0.27 | 0.01, stops | | 2,100 | 44% | $0.02 |
| Socks | 0.15 | 0.07, stops | | 2,100 | 34% | $0.02 |

A weak text stops after the first wave: 600 people, under a cent, about three seconds.

## Moderation: where to refuse a text

Seven yes/no questions about the text itself ride in the opening request. Twenty texts, Ukrainian and English, each asked once (2026-09-20, $0.0006 for all of them). The highest of the seven answers:

| Text | Highest answer | At 0.85 |
|---|---|---|
| Insult at the reader, Ukrainian / English | insult 0.98 / 0.98 | refused |
| "All … are thieves, drive them out" | hate 0.98 | refused |
| "I know where you live… break your legs" | violence 0.99 | refused |
| "Selling pure cocaine, DM for prices" | illegal 0.99 | refused |
| `asdfgh jkl;; qweqwe zxcv` / «ааааааааа лололо фівафіва» / `test test 123` | gibberish 0.97 / 0.89 / 0.92 | refused |
| «тест» | gibberish 0.30 | passes |
| "Politicians are all liars and thieves" | insult 0.24 | passes |
| «Я ідіот: три години шукав баг…» | insult 0.13 | passes |
| Harsh review of a bank, swearing at a blackout, a joke, one word («Кава»), "Hello world" | 0.06 or less | passes |
| The scam listing, the "BEST PAN EVER" spam, ordinary post and listing | 0.05 or less | passes |

Nothing landed between 0.30 and 0.89, so 0.85 refuses what is plainly abuse or noise and leaves the rest to the town. Twenty texts written by the person who wrote the questions is a smoke test, not a calibration.

## A resident: does Jev go by a person's earlier reactions

A resident a visitor moves in is a description plus the visitor's own answers to quiz posts ("what would you do with this one"). Before building it, three made-up readers answered all 48 quiz posts by hidden rules their description does not give away: one blocks anything in capitals whatever the topic, one reads the news though it is not among his interests, one likes every post about pets. Jev got the description and some of the answers, and was scored on twelve posts it had no answer to. 108 questions per row (three readers, three shuffles), share of posts where Jev's likeliest reaction was the reader's, out of seven reactions. `npm run probe-avatar`, 2026-09-20, $0.11 for everything below.

Answers sent as a list in the state, picked at random:

| Answers sent | 0 | 4 | 8 | 12 | 16 | 24 | 36 |
|---|---|---|---|---|---|---|---|
| Jev says what the reader said | 0.49 | 0.48 | 0.58 | 0.58 | 0.63 | 0.67 | 0.70 |
| Tokens per request | 570 | 860 | 1,100 | 1,350 | 1,600 | 2,100 | 2,850 |

The same answers inside the question's instructions: 0.69 with 16 and 0.72 with 36, and the probability Jev gives to the right reaction rises from 0.48 to 0.61, which it does not from the state (0.52). Reaction ids instead of their descriptions change nothing (0.67 and 0.70).

Then all 36 answers kept, but only the nearest sent: posts written the same way or on the same topic first.

| Nearest answers sent, of 36 kept | 4 | 8 | 12 | 16 |
|---|---|---|---|---|
| Jev says what the reader said | 0.75 | 0.72 | 0.71 | 0.69 |

Four near answers beat thirty-six sent at once, at a third of the tokens: more answers in one question dilute the ones that matter. With six sent, what counts is how many are kept to choose from:

| Answers kept, six nearest sent | 0 | 6 | 12 | 24 | 36 |
|---|---|---|---|---|---|
| Jev says what the reader said | 0.49 | 0.62 | 0.67 | 0.72 | 0.73 |

In Ukrainian the same run gives 0.56 with nothing kept and 0.75 with 36.

So every answer is kept, six go into a question, and the instructions carry them. A tuning round is 12 posts spread over the ways of writing, and most of the gain is there by the second round (24 kept). The readers here follow rules written over the same topic and style tags that pick the near answers, which flatters the picking; real people are fuzzier. The site measures that itself: every test answer stores what Jev said with the kept answers and what it said from the description alone.

In the feed a post has no style tag, so the near answers are picked by topic alone: the quiz posts about the interests Jev scored highest for the post, then the latest. Six random answers out of 36 already give 0.65 to 0.70 in the tables above, so the floor is known; what topic alone adds on real posts has not been measured.

## The author's memory: does Jev go by whom a persona follows

Six posts, the first 150 people of each one's first wave, asked four ways: as they are, and with a clause about the author at the end of their line. 3,600 questions, 252 tokens a persona either way, $0.04.

| Glad minus sorry, as a share of the wave | as they are | follows this author | follows this author and liked their earlier posts | was annoyed by an earlier post of this author |
|---|---|---|---|---|
| Tomato seedlings | 0.40 | 0.52 | 0.76 | -0.07 |
| A month of coding with an assistant | 0.30 | 0.46 | 0.75 | -0.18 |
| The price of coffee | 0.31 | 0.47 | 0.72 | -0.24 |
| "Good morning everybody" | 0.19 | 0.35 | 0.61 | -0.08 |
| Earn $5,000 a month, write to me | -0.02 | -0.01 | 0.12 | -0.46 |
| Everybody in an office wasted their life | -0.03 | 0.13 | 0.52 | -0.62 |

Jev reads the clause. A follower scrolls past two to four times less often (0.04 to 0.01 on the seedlings, 0.58 to 0.26 on the greeting) and likes more, and "follows the author to see more" halves or vanishes for somebody who already does. The short clause shifts a reaction without deciding it: spam stays spam, and followers are as sorry about the rage post as anybody (0.16), only more of them like it too. "And liked their earlier posts" decides it: the spam passes the 0.1 rule and the rage post scores like the best text here. "Was annoyed by an earlier post" is as strong the other way and turns every good post sour.

A memory of an author could rest on that: a follow puts the persona at the head of the first wave of the next post with `; follows this author` in its line, a block keeps the post away from it for good. A follow is rare, 0 to 3% of a first wave, so the head start would be a few dozen people after a good post. It was built and taken out the same day: an author on the site is a cookie, not an account, and people post one text many times to try it, so follows and blocks left by earlier tries would bend every new one. Every post is on its own. Memory of a persona's own earlier reactions was weighed and dropped: they are Jev's own draws, so sending them back tells it nothing new, six of them make a persona two to four times longer (249 tokens to 560 in English, 930 in Ukrainian), and the same text would score differently depending on what the town read the day before.

## Asking the town and reading the text

`npm run probe -- town`, run on 2026-09-22: the twelve texts of the first sections and two plain ones, 249 requests, $0.20. Every closing question went out twice, with its answers in the listed order and reversed, since Jev leans towards the first answer it is offered. Each of the four questions and each of the text checks had a gate to pass before it ships; three did not, and were taken out before release.

Why they scrolled past or got annoyed passed every gate:

| Text | Top reason for scrolling past | Top reason for getting annoyed |
|---|---|---|
| Spam | distrust 0.98 | distrust 1.00 |
| "Good morning everybody" | nothing new 0.78 | too few annoyed to ask |
| Vague post | unclear 0.47, weak opening 0.34, about equal | nobody annoyed |
| Rage post | tone 0.55 | tone 0.72 |
| Scam listing | distrust 0.80 | distrust 0.96 |
| Tomato seedlings | not for them 0.69 | too few annoyed to ask |
| iPhone listing | price 0.55 | too few annoyed to ask |
| Running socks | price 0.50, distrust 0.34, about equal | nobody annoyed |

On all six weak texts, in both orders, a reason other than "not for them" led. The weak texts put 94% of the passing down to the text itself, the strong ones 65%; the order of the answers moved that share by 6 points.

What stopped the people who liked it, and what they would comment, tell texts apart. With the same 100 people glad about every text, two texts differed by 0.61 (hooks of posts), 0.65 (hooks of listings) and 0.34 (comments), against a noise of 0.12, 0.08 and 0.04 from the order and from halving the people. "The opening" led only one or three of seven posts, so it stays. Products and headlines had too few texts to run the gate, so their hooks ship unmeasured.

"Nothing hints at an answer", the hidden drain, took 3% of lurkers' answers and 7% of everybody else's. It took more than half of those asked only once: the 12 people glad about the vague post, asked what stopped them (0.52).

Taken out:

- **How far they read.** Four times the text did not make fewer read to the end: 79% and 86% for the seedlings, short and long, 82% and 77% for the coding post, 85% and 77% for the coffee post, 67% and 69% for the listing. None of the differences beat two standard errors in both orders.
- **Reads as written by AI.** Of twelve answers, eight were right and three clear of 0.3 to 0.7; a text rewritten in a chatbot's style scored 0.47 to 0.77 and the originals 0.15 to 0.56.
- **The main point in the first sentence, for a post and a product.** The seedlings post and the socks both got 0.47 to 0.51. For a listing all three answers were right and clear (0.96 for the iPhone listing, 0.11 when padded), so a listing keeps it.

Is it clear what to do next (right and clear 14 of 14) and does it have a concrete number, name or example (18 of 18) stay for every preset but the headline, which keeps only the second.

The closing questions cost 190 to 360 tokens a person, so a post whose three questions each go to 100 people adds about 76,000 tokens, $0.003.

## An audience described in words

`npm run probe -- audience`, run on 2026-09-22: eight descriptions, each rated twice, 23 requests, $0.009. For a description that fits, Jev was then asked person by person, with the description as the state, whether each of 100 members, 100 near misses (people who fit every counting part but one) and 200 others is one of the people it is about. The share of members it says yes to is the precision; recall is estimated from how many outside it says yes to.

| Description | Parts that count | Fit, first and second reading | Members Jev says fit | Near misses it says fit | Recall |
|---|---|---|---|---|---|
| people who work in IT and are into startups (en) | work: IT; interests: programming, startups, small business | 279, then 237 | 70% | 11% | about 41% |
| tech founders of early-stage B2B SaaS (en) | work: business | 1,024 both times | 0% | 0% | none |
| people over 60 (en) | age: over 60 | 1,398 both times | 100% | 0% | about 100% |
| parents of toddlers (en) | none: age named, no group scored | refused, `no_fit` | | | |
| пенсіонери, які мають город (uk) | work: retired; interests: gardening, summer house | 174 both times | 96% | 34% | about 21% |
| студенти-айтівці (uk) | work: student | 650 both times | 77% | 2% | about 73% |
| left-handed people (en) | none | refused, `no_fit`, as expected | | | |
| everybody (en) | none | refused, `no_fit`, as expected | | | |

Seven of the eight read the same parts the second time. The one that did not, IT and startups, kept work and changed the interests that count, so its audience moved from 279 to 237.

Where the town has the words, the audience holds: over 60, students, pensioners with a garden. It is narrower than the description where Jev leaves a part out ("студенти-айтівці" became students, not IT students) or where people just outside it fit too (Jev said yes to a third of the near misses for "pensioners with a garden").

Where the town lacks the words, the check runs on the wrong people. The town has no founders, no company stage and no B2B, so "tech founders" became the 1,024 people who work in business, and Jev itself said none of them is a tech founder. The Audience tab shows the part that counted; the site does not refuse such a description yet.
