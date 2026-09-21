-- The people visitors move into the town. A resident lives in the crowd that speaks its language,
-- after the 10,000: its id there is 10000 + number. A house is never taken down: when a resident
-- moves out, the row stays with no author and no profile, and one of the 10,000 kinds of people
-- lives there instead, so the reactions stored for that id keep a face.
CREATE TABLE residents (
  pool TEXT NOT NULL,          -- uk | en
  number INTEGER NOT NULL,     -- 0, 1, 2… in the order of moving in
  author TEXT,                 -- hash of the secret cookie of whoever moved the resident in; the same one that owns their posts
  profile TEXT,                -- JSON: { name, gender, age, job, city, interests, temper, budget, about }
  seed TEXT NOT NULL,          -- decides the order of the quiz posts for this resident
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (pool, number)
);
CREATE UNIQUE INDEX residents_author ON residents (author) WHERE author IS NOT NULL;

-- What the visitor said the resident does with a quiz post. Every answer is kept and tunes the
-- resident. A test answer also keeps what Jev said before it saw the answer: `jev` with the earlier
-- answers at hand, `plain` with the description alone.
CREATE TABLE resident_answers (
  author TEXT NOT NULL,
  card TEXT NOT NULL,          -- id of the post in shared/quiz.js
  round INTEGER NOT NULL,      -- 1, 2, 3… within the resident
  kind TEXT NOT NULL,          -- tune | test
  human TEXT NOT NULL,
  jev TEXT,
  plain TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (author, card)
);
