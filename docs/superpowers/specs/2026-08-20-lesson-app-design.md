# English Lesson App — Design

Date: 2026-08-20

## Product

A mobile-first English learning web app. The unit of work is a **lesson** (课): N target words → **one** generated article (400–500 words) → four gated steps.

Lessons are not calendar-bound. The home screen nudges “today’s lesson” as habit guidance. Completing one lesson does not block starting another.

## Locked decisions

| Topic | Decision |
|---|---|
| Unit name | Lesson |
| N | User-configurable words per lesson, default 10 |
| Articles | Always one longer passage per lesson |
| Identity | Anonymous `user_id` cookie now; GitHub / Gmail OAuth later; no password signup |
| UI language | English |
| Gloss language | English (word cards + step-4 explanations) |
| Word placement | All N target words appear naturally at least once in the article |
| Steps | Gated in order; previous steps stay replayable |
| Word cards | Dictionary API first, LLM fallback on miss |
| Recommendations | CEFR + topic catalog, with regenerate and optional LLM extras |
| LLM | Workers AI Llama (cheap; `LLM_PROVIDER` can swap later) |
| TTS | Cloudflare Workers AI Aura; lesson stays ready if speech fails |
| Dictionary | Free Dictionary API first, LLM only on miss |
| Primary surface | Phone. Desktop is a narrow preview column, not a separate layout |

## Lesson flow

One article, in order:

1. Blind listen
2. Listen with transcript
3. Read aloud (mark complete; no pronunciation scoring in V1)
4. Key words / phrases explained (English), 8–12 glosses biased toward the target words

Restart this lesson = reset step timestamps, keep content. Start another lesson = new snapshot.

## Mobile UX

- Bottom tabs: Home / Words / Settings
- Lesson player is a full-screen flow; hide tabs while playing
- Tap targets ≥ 44px; no hover-only actions
- Sticky audio bar with replay and 0.75 / 1 / 1.25 speed
- `env(safe-area-inset-*)` for notches
- Phone-width column (`max-w-md`) when opened on desktop

## Data

Cloudflare D1 + R2 (audio keys). Tables: `users`, `user_settings`, `words`, `lessons`, `lesson_words`, `lesson_articles`. Lesson rows snapshot CEFR, topics, and N. `article_count` is always 1 for new lessons. SQLite may still have unused `articles_per_lesson` / extra `lesson_articles` rows from older builds; the app ignores them.

## V1 out of scope

Chrome extension (keep add-word API shaped for it), OAuth, FSRS, speech scoring, i18n.
