import { describe, expect, it } from 'vitest'

import { getDb, getEnv } from '#/db'
import { dictionaryEntries } from '#/db/schema'
import { TTS_VOICE } from '#/lib/ai'
import type { LessonEnv } from '#/lib/generate-lesson'
import { prewarmBatch } from '#/lib/prewarm'

describe('prewarmBatch', () => {
  it('does nothing for a word already defined and spoken', async () => {
    const word = `warm${crypto.randomUUID().slice(0, 8)}`
    await getDb()
      .insert(dictionaryEntries)
      .values({
        normalized: word,
        headword: word,
        definitions: JSON.stringify([
          { partOfSpeech: 'noun', definition: 'a thing' },
        ]),
        examples: '[]',
        senseSource: 'model',
        audioKey: `word-audio/${TTS_VOICE}/${word}.mp3`,
        updatedAt: new Date().toISOString(),
      })

    // No network is reachable for this word's definition or audio, so a pass
    // that tried either would fail rather than report a clean skip. That is
    // what makes the whole run resumable.
    const tally = await prewarmBatch(getEnv() as LessonEnv, [word])

    expect(tally).toEqual({ seen: 1, defined: 0, spoken: 0, failed: 0 })
  })
})
