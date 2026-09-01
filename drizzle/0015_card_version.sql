ALTER TABLE `dictionary_entries` ADD `dictionary_senses` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dictionary_entries` ADD `card_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `dictionary_entries`
SET `dictionary_senses` = `senses`
WHERE `source` = 'dictionary'
  AND json_valid(`senses`)
  AND json_array_length(`senses`) > 0;
