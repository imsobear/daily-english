-- What the generator is doing right now, so the wait can say so. Nullable
-- throughout: rows written before this, and rows past generating, have no
-- stage to report.
ALTER TABLE `lessons` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `stage_part` integer;--> statement-breakpoint
ALTER TABLE `lessons` ADD `stage_parts` integer;
