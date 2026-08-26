ALTER TABLE `dictionary_entries` ADD `senses` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dictionary_entries` ADD `collocations` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dictionary_entries` ADD `family` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `dictionary_entries` ADD `source` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE `dictionary_entries`
SET
  `senses` = (
    SELECT json_group_array(
      json_object(
        'pos', COALESCE(json_extract(value, '$.pos'), ''),
        'definition', json_extract(value, '$.definition'),
        'zh', json_extract(value, '$.zh'),
        'examples', CASE
          WHEN json_extract(value, '$.example') IS NULL THEN json_array()
          ELSE json_array(json_extract(value, '$.example'))
        END
      )
    )
    FROM json_each(json_extract(`detail`, '$.senses'))
  ),
  `collocations` = COALESCE(json_extract(`detail`, '$.collocations'), '[]'),
  `family` = COALESCE(json_extract(`detail`, '$.family'), '[]'),
  `source` = 'model'
WHERE `detail` IS NOT NULL
  AND json_valid(`detail`)
  AND json_array_length(COALESCE(json_extract(`detail`, '$.senses'), '[]')) > 0;--> statement-breakpoint
UPDATE `dictionary_entries`
SET
  `senses` = (
    SELECT json_group_array(
      json_object(
        'pos', COALESCE(json_extract(value, '$.partOfSpeech'), ''),
        'definition', json_extract(value, '$.definition'),
        'zh', NULL,
        'examples', CASE
          WHEN key = 0 AND json_array_length(COALESCE(`examples`, '[]')) > 0
            THEN json_array(json_extract(`examples`, '$[0]'))
          ELSE json_array()
        END
      )
    )
    FROM json_each(`definitions`)
  ),
  `source` = 'dictionary'
WHERE `source` = 'pending'
  AND json_valid(`definitions`)
  AND json_array_length(`definitions`) > 0;
