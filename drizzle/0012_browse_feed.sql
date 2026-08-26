-- The browse feed: an idle scroll through word cards, drawn from the learner's
-- own list, the CEFR pool, or both.
--
-- `browse_source` is which of those three the feed is showing. It lives with
-- the settings rather than in the browser so the choice follows the learner to
-- their other devices, like every other preference here.
ALTER TABLE `user_settings` ADD `browse_source` text DEFAULT 'mix' NOT NULL;--> statement-breakpoint
-- `verdict` separates a word that merely went past in the feed from one the
-- learner said they already know. Shown words are recyclable once the level
-- runs dry; known ones never come back, and counting them is what tells us the
-- level is too easy.
ALTER TABLE `word_offers` ADD `verdict` text DEFAULT 'shown' NOT NULL;
