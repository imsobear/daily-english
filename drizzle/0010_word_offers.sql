-- Every word a learner has been shown on the add-words screen, so a shuffle
-- over the vocabulary pool stops repeating itself between visits. One row per
-- word rather than per showing: the date is only used to decide what is old
-- enough to offer again once the level runs dry.
CREATE TABLE `word_offers` (
	`user_id` text NOT NULL,
	`normalized` text NOT NULL,
	`offered_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `normalized`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `word_offers_user_offered` ON `word_offers` (`user_id`,`offered_at`);
