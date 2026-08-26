CREATE TABLE `dictionary_entries` (
	`normalized` text PRIMARY KEY NOT NULL,
	`headword` text NOT NULL,
	`ipa` text,
	`definitions` text DEFAULT '[]' NOT NULL,
	`examples` text DEFAULT '[]' NOT NULL,
	`sense_source` text DEFAULT 'legacy' NOT NULL,
	`audio_key` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
-- Lift what every learner already has into the shared entry. Where several
-- people saved the same word, keep the best copy: a model-written entry first,
-- then the one with the most to say.
--
-- Additive on purpose. The running code still reads the per-user columns, so
-- they are dropped only once the release that stops doing so is live.
INSERT INTO `dictionary_entries` (`normalized`, `headword`, `ipa`, `definitions`, `examples`, `sense_source`, `updated_at`)
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
