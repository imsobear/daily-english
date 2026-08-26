-- What a word card says beyond its definition: the pattern the word lives in,
-- the phrases it keeps company with, its family, and a Chinese gloss.
--
-- One JSON column rather than five, because nothing queries these — they are
-- read whole, with the entry, and written whole by the pre-warm pass. Null
-- means the pass has not reached this word, and the card falls back to the
-- definition it already had.
ALTER TABLE `dictionary_entries` ADD `detail` text;
