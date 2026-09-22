# Jevtown

Live at [jevtown.ivanhabor.com](https://jevtown.ivanhabor.com), no sign-in. [Watch the 30-second video](https://www.youtube.com/watch?v=Ktm2qwW7JAo).

<a href="https://www.producthunt.com/posts/jevtown?utm_source=badge-featured&utm_medium=badge"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1256567&theme=dark"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1256567&theme=light" alt="Jevtown on Product Hunt" width="250" height="54"></picture></a>

[![The Jevtown home page: one iPhone listing written two ways, and the town that read it](docs/images/home.png)](https://jevtown.ivanhabor.com)

A social network where people write and 10,000 AI personas read. Post a text, a listing, a product or a headline, and the crowd reacts within seconds: most scroll past, some like, repost, block, write to the seller or buy. Every reaction comes from [Jev](https://typesafe.ai), a model that answers typed questions with probabilities and writes no text.

What you get for a text:

- **The map of its audience.** 100×100 dots, one per persona, neighbours are similar people. A text starts with the 600 people Jev thinks it is for, and travels further only while the crowd is glad to see it. A good post visibly spreads across the map; spam, rage and scam listings die in the first wave. Every post in the feed carries its map, and the big map on the right always shows the crowd of the post you are looking at.
- **Your own audience, in words.** Say whom the text is for ("people who work in IT and are into startups"), and only the people in town who fit every part of it read it; the waves, the counts, the groups and the map are then about them. Nothing to connect: Jev reads the words, and the Audience tab shows how it read them. The town knows work, age, interests, money and shopping; words about anything else do not count, so check the tab: "tech founders of early-stage B2B SaaS" becomes everybody who works in business ([docs/measurements.md](docs/measurements.md)).
- **Who stopped, who liked it, who got annoyed**, by interest, job, age, temper, budget, city and what people are shopping for. Point at a group and its people light up on the map.
- **Asked in town.** When a check closes, the town gets up to three more questions, each asked of up to 100 people it reached, in the order the feed showed them the text: those who scrolled past or got annoyed say why (up to 40 annoyed first, more when few scrolled past), those who liked it say what made them stop, and for a post those who stopped say what they would write in the comments. One person can be asked more than one of these. The answers are fixed; a hidden "nothing hints at an answer" takes the people Jev cannot place, and the bars show only the real answers. Point at an answer and its people light up on the map.
- **How Jev reads the text.** Up to three yes or no questions about the text itself ride with the first request: for a listing, does the first sentence say what is for sale; is it clear what the reader should do; does it have a concrete number, name or example (a headline gets only the last). They are Jev's reading of the text, not the town's reactions, and never keep a text out of the feed.
- **Voices of the crowd.** The people who reacted, by name: "Svitlana, 62, civil servant, Kharkiv · wrote to the seller · «Can I check it before paying?»".
- **For a listing:** what buyers would ask the seller first, out of twenty prepared questions.
- **For a product:** how many would buy at each price of a ladder you set, and which price earns the most.
- **The result in one sentence**: how far the text went, which wave stopped it, how many were glad and how many annoyed, and, from what the town was asked, the reason given most often for scrolling past and for getting annoyed and what stopped the people who liked it, or the answers that are about equal.
- **Versions.** Edit the text, show it again, see what changed, with the two texts side by side, read by the same audience.
- **Your resident** (`/me`). Make up a person and move them into town: they live next to the 10,000, read every new post that reaches them and react like anybody else, with Jev answering for them. The town grows with every visitor. Tune the resident: say what they do with twelve posts. Then try it: eight new posts, you answer first, Jev answers without seeing that, and the page counts how often it guessed, next to how often it would have from the description alone. Every answer is kept and goes with the resident into the feed. The resident can be changed or moved out at any time.
- **A card of the post** to send to a friend: a PNG drawn in the browser with the text, the map and, largest of all, how many of the town saw it.
- A profile for every persona and every resident with what they did with recent texts, a map of the whole town to walk around (`/crowd`, with the mouse or with the arrow keys), and a link preview picture for every post.

The home page opens with a working example: one phone listing written two ways, replayed from two saved checks, so a visitor sees what the crowd does before writing anything.

A check costs from about a cent (a text that dies in the first wave) to ten cents (one that reaches all 10,000), and takes from 3 seconds to a minute. Asking the town adds up to three requests of up to 100 people, about $0.003 for a post ([docs/measurements.md](docs/measurements.md)). A post with an audience makes one more request. Its waves are the town's, cut at the audience, so it never costs more than a whole-town check plus that request. The interface comes in Ukrainian and English, and so do the personas: a text is read by the crowd that speaks its language, 10,000 Ukrainians or 10,000 English speakers, so there is nothing to choose.

## Run it

Node 22 or newer. You need a key for Jev: from [TypeSafe](https://typesafe.ai) or from [OpenRouter](https://openrouter.ai/settings/keys).

```bash
npm install
cp .env.example .env.local   # paste one of the two keys into it
npm run dev                  # http://localhost:5191
```

A check in the terminal, without the site:

```bash
npm run check -- --preset listing "iPhone 13, 128 GB, battery 86%, never repaired. 14,000 UAH, Lviv"
npm run check -- --preset product --pool en --prices 9,15,24,39 "Merino running socks that do not smell"
npm run check -- --pool en --audience "people who work in IT and are into startups" "I shipped our MVP in six weeks with two people"
```

Tests need no key: `npm test`.

The Jevtown logo is drawn from two outlined vector masters, [brand/mark.svg](brand/mark.svg) and [brand/wordmark.svg](brand/wordmark.svg). `npm run build-brand` regenerates the committed website assets in `public/` from them and writes the complete SVG/PNG package to `output/branding/jevtown/production/`, which is not committed; it adds no runtime dependency or required site build step.

## Use it from an agent (MCP)

Jev writes no text, and an agent can. [mcp/server.js](mcp/server.js) is an MCP server: an agent such as Claude writes variants of a text, and the town reads them, on your machine and your key.

Claude Code, for every project:

```bash
claude mcp add --scope user jevtown -- node /absolute/path/to/jevtown/mcp/server.js
```

Claude Desktop: open Settings from the Claude menu, then Developer, then Edit Config, and add the server to `claude_desktop_config.json`:

```json
{ "mcpServers": { "jevtown": { "command": "/output/of/which/node", "args": ["/absolute/path/to/jevtown/mcp/server.js"] } } }
```

Then quit the app completely and open it again, so that it reads the new config. The desktop app does not read your shell setup, so Node from nvm or Homebrew may be missing from its PATH; use the path `which node` prints (Node 22 or newer).

The key comes from the server's environment or from `.env.local` next to `package.json`, the file `npm run check` reads, so nothing goes into a client's settings. The two settings below can go into `.env.local` too, or into the environment the client gives the server: `env` in `claude_desktop_config.json`, `-e NAME=value` for `claude mcp add`. The client starts `node` and not `npm run`, because npm prints a line to stdout, where only MCP messages may go.

The agent gets two tools:

- **`check_text`** follows one text through the town the way a post page does: how far it travelled, who stopped, who was glad and who got annoyed, what the town said when asked (why people scrolled past or got annoyed, what made the glad ones stop, with the same rule for answers that are about equal), Jev's reading of the text itself, and for a listing or a product what buyers would ask or pay. A text that dies in the first wave costs about a cent, one that reaches 5,100 people (the default of three waves) about five cents, and a listing or a product that reaches everybody up to about thirty cents.
- **`compare_texts`** shows two to five variants to the first wave only and ranks them by the town's rule, marking the ones too close to call. Each variant comes with the main reason people scrolled past it. It costs about a cent per variant, up to two cents for a listing.

Both are paid from your key, so the server keeps to limits:

- `JEVTOWN_MCP_DAILY_BUDGET_USD` (default 1) is how many dollars one server may spend per UTC day, 0 for no limit. A call whose worst case would pass it is refused before anything is sent. The count lives in the server's memory: a restarted server starts the day from $0, and every client starts a server of its own (Claude Code one per session), so two open sessions may spend twice the limit on one key.
- `JEVTOWN_MCP_MAX_SECONDS` (default 45): a check starts the next wave only if it expects to finish within this many seconds with it, the follow-up question of a listing or a product and the closing questions included, so that a call fits in the minute clients usually wait. 0 means no limit.
- It runs one call at a time, with at most 8 requests to Jev in flight, and keeps Jev's answers in memory for repeats: `check_text` on the variant a comparison picked gets its first wave from memory.

Nothing is posted or stored, and only the requests to Jev leave your machine. The town is the 10,000, without the residents visitors moved in, and a post of the same text on the site uses its own seed, so its numbers will differ. The server speaks MCP 2026-07-28 and, through `initialize`, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05, over stdio only: an HTTP endpoint would spend your key for whoever reaches it.

A smoke test that costs nothing prints two JSON lines and exits:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"sh","version":"0"}}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp/server.js
```

## How it works

1. **Personas** are computed, not stored and not generated by an LLM: `persona(pool, id)` in [public/shared/personas.js](public/shared/personas.js) always returns the same person. The id is the place on the grid, and the place decides the age and the main interest, so neighbours are alike. Jev reads a persona as one English line: `Oksana, 34, accountant, Lviv; into gardening, movies and TV series, travel; skeptical, distrusts ads and big claims; average income, careful with money`.
2. **Whom is it for.** One request scores the text against about 60 kinds of people (83 for listings and products), plus seven questions about the text itself: hatred, explicit sex, threats, private data, illegal offers, insults, keyboard mashing. An answer of 0.5 or more keeps the text out of the public feed (it is still read, the page works by link); 0.85 or more and it is not posted at all. Up to three more are about how it is written: whether a listing's first sentence says what is for sale, whether the reader is told what to do, and whether there is a concrete number, name or example (a headline gets only the last). They are shown to every visitor as Jev's reading of the text and never keep a text out of the feed; a question that did not pass its measurement was left out ([docs/measurements.md](docs/measurements.md)). A persona's exposure is the sum of cubes of the scores of its own attributes. [public/shared/feed.js](public/shared/feed.js)
3. **Your own audience.** A description gets a request of its own, which never shows Jev the text: which parts of a person it names (work, age, interests, money, what they are looking to buy), how many of the people it describes are in each of the 83 groups, and the seven moderation questions, about the description. A part counts when Jev says it is named and one of its groups scores "Some of them" or more; in a counting part, every group within 0.7 of the best one counts. Whoever has a counting group in every counting part is in the audience, and a part the description does not name excludes nobody, so "people over 60" keeps the ones who still work. A description that names nothing the town knows, or that fewer than 50 people fit, is refused with the count. The waves are the town's, cut where they have reached the whole audience, and every version of the post goes to the same audience without asking again. [public/shared/feed.js](public/shared/feed.js)
4. **Waves.** 600 people, then 1,500, then 3,000, then everybody else. One request to Jev carries the text once and 100 personas, one choice question each; the reaction of each persona is drawn from the probabilities Jev returned, seeded by the persona and the version, so a reload shows the same crowd. A wave sends the text further when glad reactions outweigh sorry ones by at least 0.1 of the wave; after the first wave people are ranked by what their kind actually did, not by what was predicted.
5. **Follow-up.** For a listing and a product, the people who stopped get one more question.
6. **Asking.** At every wave the people who scrolled past, got annoyed, liked it or stopped are gathered in the order the feed algorithm picked them, up to 100 of each. When the check closes, each question goes to up to 100 of them in one request, with what the person did written into it: why (up to 40 annoyed first, then scrollers, then more annoyed if there is room), what made them stop, what they would comment. A question is not asked when fewer than 10 people fit. Only one close asks at a time, so a reload does not pay twice. An answer is Jev's answer about a persona, like the reaction itself. [worker/town.js](worker/town.js)
7. **Everything on a post page** is counted from the bytes stored for every persona: what it did, which wave reached it, what it answered to the follow-up question and, for a post with an audience, whether the persona is in it. The answers are kept with the version's summary. [public/shared/summary.js](public/shared/summary.js)

8. **Residents.** What a visitor types becomes the same kind of line a persona has, with the resident's own words added; Jev reads the name, the job, the city and those words before anybody else sees them, with the questions a post is asked. A resident's id continues the crowd's (10000, 10001, …), so everything that works by id works for them: the feed algorithm, the stored bytes, the map, where they fill rows under the square of the 10,000. When a resident moves out, the description is wiped and one of the 10,000 kinds of people takes the house, so the reactions stored for that id keep a face. The visitor's answers to the quiz posts in [public/shared/quiz.js](public/shared/quiz.js) are all kept; when Jev answers for the resident, in a test round or in the feed, the six answers nearest to the post go into the question. For a quiz post near means written the same way or on the same topic; for a post in the feed, on one of the interests Jev scored highest for it. A resident's question is about four personas long, so a request takes fewer people when residents are in it. A test round of eight posts costs about $0.0005. [public/shared/resident.js](public/shared/resident.js)
9. **Every post is on its own.** The town keeps no memory of an author: whoever followed or blocked after one post meets the next one like anybody else, so the same text gets the same crowd whatever was posted before it.

What Jev is asked, word for word, is in [public/shared/presets.js](public/shared/presets.js) and [public/shared/requests.js](public/shared/requests.js). The numbers behind the wave sizes, the rule and the request size are in [docs/measurements.md](docs/measurements.md): personas move the answers several times over, 200 personas in one request answer the same as one, the feed algorithm's first 500 people hold 83 to 97% of what the best possible 500 would, six near answers of a person lift Jev's guesses about them from 0.49 to 0.72.

## The layout

| Path | What is there |
|---|---|
| `public/shared/` | the engine, shared by the Worker, the browser and the terminal |
| `public/` | the interface: `app.js` (pages), `grid.js` (the map), `card.js` (the card of a post), `showcase.js` (the example on the home page), `i18n.js` (every word, twice); no framework, no build step |
| `public/examples/` | the two saved checks the home page replays |
| `worker/` | one Cloudflare Worker: the API, the link preview picture, the page head |
| `worker/crowd-*.bin` | the attributes of every persona, packed; rebuilt by `npm run build-crowd` after a change to the vocabularies |
| `migrations/` | the D1 schema |
| `scripts/` | `check.js` for the terminal, `probe.js` and `resident-probe.js` for the measurements |
| `mcp/` | the MCP server over stdio: `check_text` and `compare_texts`, run on your machine with your key |

One Worker on Cloudflare's free plan, D1, no runtime dependencies. A free invocation may make 50 outgoing requests and use 10 ms of CPU, so the browser drives a check: `POST /api/check` scores the text and plans the first wave, `GET /api/batch` asks Jev about 100 people, `GET /api/wave` closes the wave and decides whether the text travels further; the last close also asks up to four questions of up to 100 people each. Which people are asked is decided by the Worker alone. An author may narrow the town with a description but never name people, and an audience of at least 50 costs at most one request more than the whole town, so nobody can spend the key on a crowd of their choosing. An author is a secret cookie: it lets its holder add a version to their post, and it owns the resident its holder moved in. The name over a post is only a label, and there are no accounts.

## Deploy your own

```bash
npx wrangler d1 create jev-crowd          # put the printed database_id into wrangler.jsonc
npx wrangler secret put TYPESAFE_API_KEY  # or OPENROUTER_API_KEY
npm run deploy
```

The limits are plain variables in `wrangler.jsonc`: checks per address per day, dollars per day for everybody together, and how many waves a text may travel. One TypeSafe key gives 200 to 460 personas a second, which is one to three texts a minute reaching the whole crowd, or twenty to forty-five stopping after the first wave. Closing a wave takes about 5 ms of CPU; the last close, which also asks the town, about 2 to 3 ms (measured in Node). The first request of a fresh process also compiles the code and takes several times longer, for either close. If the free plan's 10 ms ever becomes a problem, the paid plan removes it.

## License

MIT
