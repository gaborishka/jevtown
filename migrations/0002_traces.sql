-- What the post page replays and quotes: in which wave the text reached each persona, and what the
-- personas who stopped answered to the follow-up question. A byte per persona, like `reactions`.
ALTER TABLE versions ADD COLUMN waves BLOB;    -- 0 = not shown, otherwise 1 + the index of the wave
ALTER TABLE versions ADD COLUMN answers BLOB;  -- 0 = not asked, otherwise 1 + the index of the answer
