-- Replaced by `senses`, `collocations`, `family` and `source` in
-- `0014_word_senses.sql`, which backfilled every row from them. The Worker
-- stopped reading them a deploy ago, which is what this migration was waiting
-- for.
ALTER TABLE `dictionary_entries` DROP COLUMN `definitions`;--> statement-breakpoint
ALTER TABLE `dictionary_entries` DROP COLUMN `examples`;--> statement-breakpoint
ALTER TABLE `dictionary_entries` DROP COLUMN `sense_source`;--> statement-breakpoint
ALTER TABLE `dictionary_entries` DROP COLUMN `detail`;
