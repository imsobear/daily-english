-- A fourth lesson step: the whole article heard once more with no text, after
-- reading it. Nullable, so lessons already in progress simply have the new
-- step still to do, and finished ones keep their completed status.
ALTER TABLE `lesson_articles` ADD `step_full_listen_at` text;
