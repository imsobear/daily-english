-- Fold the read-aloud step into reading.
--
-- The Speak step recorded the learner, transcribed it with Whisper and scored
-- the pronunciation. It is being removed in favour of the learner simply
-- reading at their own pace, so the step marker and the scoring columns it
-- populated no longer have a reader.
ALTER TABLE `lesson_articles` DROP COLUMN `step_speak_at`;--> statement-breakpoint
ALTER TABLE `lesson_articles` DROP COLUMN `speak_score`;--> statement-breakpoint
ALTER TABLE `lesson_articles` DROP COLUMN `speak_transcript`;--> statement-breakpoint
ALTER TABLE `lesson_articles` DROP COLUMN `speak_missed_words`;
