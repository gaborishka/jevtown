-- A post is what an author put before the crowd; every edit is a new version of it.
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,        -- hash of the author's secret cookie
  nickname TEXT NOT NULL,
  preset TEXT NOT NULL,
  pool TEXT NOT NULL,          -- which crowd reads it: uk or en
  listed INTEGER NOT NULL,     -- 1 = shown in the public feed: the author asked for it and moderation passed
  created_at TEXT NOT NULL,
  -- A copy of the latest finished version, so the feed is one query over one table.
  version INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  reach INTEGER NOT NULL DEFAULT 0,
  stopped INTEGER NOT NULL DEFAULT 0,
  glad INTEGER NOT NULL DEFAULT 0,
  sorry INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT
);
CREATE INDEX posts_feed ON posts (listed, pool, finished_at);
CREATE INDEX posts_top ON posts (listed, pool, reach);

CREATE TABLE versions (
  post TEXT NOT NULL,
  number INTEGER NOT NULL,     -- 1, 2, 3… within the post
  text TEXT NOT NULL,
  options TEXT NOT NULL,       -- JSON: { prices, currency } for a product
  state TEXT NOT NULL,         -- running | done
  plan TEXT NOT NULL,          -- JSON: { scores, waves: [{ index, size, mood, travels }], current: { kind, index, ids } | null }
  reactions BLOB,              -- a byte per persona: 0 = not shown, otherwise 1 + the index of the reaction
  summary TEXT,                -- JSON, written when the version is done
  created_at TEXT NOT NULL,
  PRIMARY KEY (post, number)
);

-- One row per answered request to Jev. `result` is the drawn reactions of a wave batch, a byte per
-- persona in the order of the batch, or the JSON totals of a follow-up batch.
CREATE TABLE batches (
  post TEXT NOT NULL,
  number INTEGER NOT NULL,
  stage TEXT NOT NULL,         -- s = scoring, w0…w3 = waves, f = follow-up question
  n INTEGER NOT NULL,
  result BLOB,
  usd REAL NOT NULL,
  tokens INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (post, number, stage, n)
);
CREATE INDEX batches_day ON batches (day);

-- Who started checks today, for the per-address limit. The address is stored hashed.
CREATE TABLE checks (
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  post TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX checks_visitor ON checks (visitor, day);
