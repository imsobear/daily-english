import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    githubId: text('github_id'),
    googleId: text('google_id'),
    email: text('email'),
    onboardedAt: text('onboarded_at'),
  },
  (table) => [
    uniqueIndex('users_github_id').on(table.githubId),
    uniqueIndex('users_google_id').on(table.googleId),
  ],
)

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  cefrLevel: text('cefr_level').notNull().default('B1'),
  topics: text('topics').notNull().default('[]'),
  wordsPerLesson: integer('words_per_lesson').notNull().default(10),
  articlesPerLesson: integer('articles_per_lesson').notNull().default(3),
  /** Which words the browse feed draws from: 'mine', 'mix' or 'new'. */
  browseSource: text('browse_source').notNull().default('mix'),
  updatedAt: text('updated_at').notNull(),
})

/**
 * What a word means, shared by everyone who saves it.
 *
 * Pronunciation, senses and examples describe the language, not the learner,
 * so they live once rather than once per user. Defining a word costs a
 * dictionary fetch and a model call, and speaking it costs TTS, so the
 * hundredth learner to save "discover" should pay for none of it. Keying on
 * the normalized form also means a sense fixed for one learner is fixed for
 * all of them.
 */
export const dictionaryEntries = sqliteTable('dictionary_entries', {
  /** Lowercased, whitespace-collapsed headword. See `normalizeHeadword`. */
  normalized: text('normalized').primaryKey(),
  /** Canonical spelling to display, as returned by the dictionary. */
  headword: text('headword').notNull(),
  ipa: text('ipa'),
  /** `Sense[]` JSON: part of speech, definition, Chinese and examples. */
  senses: text('senses').notNull().default('[]'),
  /**
   * `Sense[]` JSON as the free dictionary gave them, written once and never
   * overwritten. Nobody is ever shown these. They are what the model is given
   * to work from, so a card is a rewrite of something true rather than a
   * recollection, and they are what a rewrite still has to work from years
   * later when the model's version is the only thing in `senses`.
   */
  dictionarySenses: text('dictionary_senses').notNull().default('[]'),
  /** `string[]` JSON — the phrases this word really appears in. */
  collocations: text('collocations').notNull().default('[]'),
  /** `WordRelative[]` JSON — same stem, different part of speech. */
  family: text('family').notNull().default('[]'),
  /** Where the senses came from: 'pending', then 'dictionary', then 'model'. */
  source: text('source').notNull().default('pending'),
  /**
   * Which recipe wrote the card — see `CARD_VERSION`.
   *
   * Provenance says where a card came from and cannot say whether it is still
   * the card we would write today. This can, so improving the prompt or the
   * checks re-warms the pool by itself over the following nights instead of
   * needing an UPDATE run against production by hand.
   */
  cardVersion: integer('card_version').notNull().default(0),
  /** R2 object holding the spoken word, written on first play. */
  audioKey: text('audio_key'),
  updatedAt: text('updated_at').notNull(),
})

export const words = sqliteTable(
  'words',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** As the learner typed it; the shared entry holds the canonical form. */
    headword: text('headword').notNull(),
    /** Joins to `dictionary_entries`, which owns everything lexical. */
    normalized: text('normalized').notNull(),
    source: text('source').notNull().default('manual'),
    sourceUrl: text('source_url'),
    familiarity: real('familiarity').notNull().default(0),
    dueAt: integer('due_at'),
    seenCount: integer('seen_count').notNull().default(0),
    lastReviewedAt: text('last_reviewed_at'),
    /** Times the learner got this word wrong in review; shortens the interval. */
    lapses: integer('lapses').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('words_user_normalized').on(table.userId, table.normalized),
    index('words_user_due').on(table.userId, table.dueAt),
  ],
)

/**
 * Every word this learner has been shown, on the add-words screen or in the
 * browse feed.
 *
 * Recommendations are a shuffle over a few thousand candidates, and a shuffle
 * with no memory repeats itself. Remembering the offer is what makes "New set"
 * new across visits and devices rather than only within one page view. Rows
 * outlive the words table on purpose: deleting a word you saved should not put
 * it back in the suggestions.
 */
export const wordOffers = sqliteTable(
  'word_offers',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    normalized: text('normalized').notNull(),
    offeredAt: text('offered_at').notNull(),
    /**
     * What became of the offer: 'shown' by default, or 'known' once the
     * learner says they have this one already. A shown word can come back when
     * the level runs dry; a known one is retired for good, which is also the
     * signal that the level is too easy.
     */
    verdict: text('verdict').notNull().default('shown'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.normalized] }),
    index('word_offers_user_offered').on(table.userId, table.offeredAt),
  ],
)

export const lessons = sqliteTable(
  'lessons',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull().default('generating'),
    cefrLevel: text('cefr_level').notNull(),
    topics: text('topics').notNull(),
    wordCount: integer('word_count').notNull(),
    articleCount: integer('article_count').notNull(),
    createdAt: text('created_at').notNull(),
    /** When writing began. A retry restarts the clock on the same row. */
    generatingSince: text('generating_since'),
    /**
     * What the generator is doing, for the screen the learner is watching:
     * 'writing', 'speaking' or 'saving'. The two counters are the audio part
     * being recorded and how many there are, since speech is the long half of
     * the wait and a bar that never moves reads as a hang.
     */
    stage: text('stage'),
    stagePart: integer('stage_part'),
    stageParts: integer('stage_parts'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    /**
     * Calendar date in the learner's own timezone, recorded by the client when
     * the lesson is finished. Streaks are counted over these rather than UTC
     * timestamps, which would roll over mid-evening for western timezones.
     */
    completedLocalDate: text('completed_local_date'),
    failureKind: text('failure_kind'),
    failureReason: text('failure_reason'),
  },
  (table) => [
    index('lessons_user_created').on(table.userId, table.createdAt),
    index('lessons_user_local_date').on(table.userId, table.completedLocalDate),
  ],
)

export const lessonWords = sqliteTable(
  'lesson_words',
  {
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id),
    position: integer('position').notNull(),
    wordId: text('word_id'),
    headword: text('headword').notNull(),
    definition: text('definition'),
  },
  (table) => [primaryKey({ columns: [table.lessonId, table.position] })],
)

export const lessonArticles = sqliteTable(
  'lesson_articles',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lessons.id),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audioKey: text('audio_key'),
    explanations: text('explanations').notNull().default('[]'),
    /** JSON string[]: the segmentation shared by the player and the audio. */
    sentences: text('sentences').notNull().default('[]'),
    /** JSON {key,from,to}[]: one R2 clip per run of sentences. */
    audioChunks: text('audio_chunks').notNull().default('[]'),
    stepBlindListenAt: text('step_blind_listen_at'),
    stepListenReadAt: text('step_listen_read_at'),
    /**
     * The whole article heard straight through after reading it, faster.
     *
     * Both listens are blind; what separates them is what the learner brings.
     * The first is cold, and getting only the shape of it is the exercise. By
     * this one the words are known, so keeping up is all that is left — which
     * is the part that turns reading vocabulary into listening vocabulary.
     */
    stepFullListenAt: text('step_full_listen_at'),
    stepExplainAt: text('step_explain_at'),
  },
  (table) => [
    index('lesson_articles_lesson_pos').on(table.lessonId, table.position),
  ],
)
