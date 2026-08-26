ALTER TABLE `lessons` ADD `completed_local_date` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `failure_kind` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `failure_reason` text;--> statement-breakpoint
CREATE INDEX `lessons_user_local_date` ON `lessons` (`user_id`,`completed_local_date`);--> statement-breakpoint
ALTER TABLE `lesson_articles` ADD `sentences` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `lesson_articles` ADD `audio_chunks` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `lesson_articles` ADD `speak_score` integer;--> statement-breakpoint
ALTER TABLE `lesson_articles` ADD `speak_transcript` text;--> statement-breakpoint
ALTER TABLE `lesson_articles` ADD `speak_missed_words` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `lapses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `words` ADD `review_count` integer DEFAULT 0 NOT NULL;
