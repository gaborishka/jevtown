-- An author may say in words whom a text is for: only the people in town who fit every part of the
-- description read it, and every version of the post goes to the same kind of people.
-- batches.stage gets one more letter: a = the request that read the description.
ALTER TABLE posts ADD COLUMN audience TEXT;     -- the description as written; NULL = the whole town
ALTER TABLE versions ADD COLUMN audience BLOB;  -- a byte per persona: 1 = in the audience; NULL = the whole town
