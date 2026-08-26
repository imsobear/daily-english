-- Track where a word's senses came from.
--
-- Entries written before the DeepSeek switch came from dictionaryapi.dev, whose
-- senses are ordered historically rather than by frequency. That put archaic
-- noun senses first ("despite" = disdain, "manage" = the act of managing) and
-- the article writer faithfully used them, producing ungrammatical prose.
-- Marking provenance lets lesson creation re-define legacy rows exactly once.
ALTER TABLE `words` ADD `sense_source` text DEFAULT 'legacy' NOT NULL;
