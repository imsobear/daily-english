CREATE TABLE `lesson_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audio_key` text,
	`explanations` text DEFAULT '[]' NOT NULL,
	`step_blind_listen_at` text,
	`step_listen_read_at` text,
	`step_speak_at` text,
	`step_explain_at` text,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lesson_articles_lesson_pos` ON `lesson_articles` (`lesson_id`,`position`);--> statement-breakpoint
CREATE TABLE `lesson_words` (
	`lesson_id` text NOT NULL,
	`position` integer NOT NULL,
	`word_id` text,
	`headword` text NOT NULL,
	`definition` text,
	PRIMARY KEY(`lesson_id`, `position`),
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'generating' NOT NULL,
	`cefr_level` text NOT NULL,
	`topics` text NOT NULL,
	`word_count` integer NOT NULL,
	`article_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lessons_user_created` ON `lessons` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`cefr_level` text DEFAULT 'B1' NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`words_per_lesson` integer DEFAULT 10 NOT NULL,
	`articles_per_lesson` integer DEFAULT 3 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`github_id` text,
	`google_id` text,
	`email` text
);
--> statement-breakpoint
CREATE TABLE `words` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`headword` text NOT NULL,
	`normalized` text NOT NULL,
	`ipa` text,
	`audio_key` text,
	`definitions` text DEFAULT '[]' NOT NULL,
	`examples` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_url` text,
	`familiarity` real DEFAULT 0 NOT NULL,
	`due_at` integer,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `words_user_normalized` ON `words` (`user_id`,`normalized`);--> statement-breakpoint
CREATE INDEX `words_user_due` ON `words` (`user_id`,`due_at`);