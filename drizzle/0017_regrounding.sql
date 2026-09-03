-- Grounding written before `sensesFrom` read the whole payload.
--
-- The old lookup took the first three senses of the first entry, so a word
-- with more than one etymology lost the rest of itself: "squash" was stored as
-- a sport, a drink and a cramped space, with the verb and the vegetable in
-- entries nobody read. Emptying the column is enough — `ensureDictionarySenses`
-- refills it from the dictionary the next time the nightly pass reaches the
-- word, which is the same night it rewrites the card for `CARD_VERSION` 2.
--
-- Rows already holding four or more senses can only have come from the new
-- reader, so they keep what they have. The rest are refetched, including the
-- short entries that were never truncated: one dictionary call each is cheaper
-- than a column to tell them apart.
UPDATE `dictionary_entries`
SET `dictionary_senses` = '[]'
WHERE `dictionary_senses` != '[]'
  AND (
    NOT json_valid(`dictionary_senses`)
    OR json_array_length(`dictionary_senses`) <= 3
  );
