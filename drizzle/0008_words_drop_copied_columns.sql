-- Anything saved between the backfill and the release that reads shared
-- entries still has its senses only on the user's own row.
INSERT OR IGNORE INTO `dictionary_entries` (`normalized`, `headword`, `ipa`, `definitions`, `examples`, `sense_source`, `updated_at`)
SELECT `normalized`, `headword`, `ipa`, `definitions`, `examples`, `sense_source`, `created_at`
FROM (
	SELECT
		`normalized`,
		`headword`,
		`ipa`,
		`definitions`,
		`examples`,
		`sense_source`,
		`created_at`,
		ROW_NUMBER() OVER (
			PARTITION BY `normalized`
			ORDER BY
				CASE `sense_source` WHEN 'model' THEN 0 ELSE 1 END,
				length(`definitions`) DESC,
				`created_at`
		) AS `rank`
	FROM `words`
)
WHERE `rank` = 1;
--> statement-breakpoint
-- Word audio was stored per user (`word-audio/<user>/<row>.mp3`), so none of it
-- can be shared. Those objects are left behind and the next play re-speaks the
-- word once, to a key everyone reads from.
ALTER TABLE `words` DROP COLUMN `ipa`;--> statement-breakpoint
ALTER TABLE `words` DROP COLUMN `audio_key`;--> statement-breakpoint
ALTER TABLE `words` DROP COLUMN `definitions`;--> statement-breakpoint
ALTER TABLE `words` DROP COLUMN `examples`;--> statement-breakpoint
ALTER TABLE `words` DROP COLUMN `sense_source`;
