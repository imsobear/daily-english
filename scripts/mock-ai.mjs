/**
 * Stand-ins for the paid AI calls — DeepSeek chat completions, OpenAI speech
 * and the Workers AI word cards — so a local end-to-end run costs nothing.
 *
 * The article mock deliberately returns a SHORT article the first time it is
 * asked for one, so the length-enforcement retry in generateArticle is
 * exercised rather than assumed.
 *
 *   node scripts/mock-ai.mjs
 *   DEEPSEEK_BASE_URL=http://127.0.0.1:8799/v1 TTS_MOCK_URL=http://127.0.0.1:8799/tts pnpm dev
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PORT = Number(process.env.PORT ?? 8799)
let articleCalls = 0

const SHORT = `Maya wanted to manage her time better. She read some advice online. It did not help.`

const LONG = `Maya had always believed that she could manage her own time, right up until the week her calendar collapsed. Despite three years of practice, she still ended each day with a list longer than the one she had started with. Her manager offered some advice that sounded almost too simple: write down where the hours actually go, then compare that record against what you assumed.

So she tried it. For five days she noted every task, every interruption, every quiet stretch that vanished without explanation. What she began to notice was a pattern she had never been aware of. The mornings she guarded carefully were productive, but each afternoon dissolved into small requests that felt urgent and turned out not to be.

The risk, she realised, was not that she worked too slowly. The risk was that she never stopped long enough to discover which work mattered. Once she could see the shape of her week on paper, she started to develop a different habit. She blocked the first two hours of every morning and refused to give them away.

It took a month before the change felt normal, and there were days when the old pattern crept back in. But she kept the record going, and slowly she began to realise something useful: managing time was never really about the clock. It was about noticing, honestly and often, where her attention had already gone.`

const EXPLANATIONS = [
  { phrase: 'manage', meaning: 'To control or organise something successfully.' },
  { phrase: 'despite', meaning: 'Even though something else is true.' },
  { phrase: 'advice', meaning: 'A suggestion about what someone should do.' },
  { phrase: 'compare', meaning: 'To look at two things and see how they differ.' },
  { phrase: 'notice', meaning: 'To become conscious of something.' },
  { phrase: 'pattern', meaning: 'A regular way that something happens.' },
  { phrase: 'aware', meaning: 'Knowing that something exists or is happening.' },
  { phrase: 'risk', meaning: 'The chance that something bad will happen.' },
  { phrase: 'discover', meaning: 'To find out something for the first time.' },
  { phrase: 'develop', meaning: 'To grow or build up gradually.' },
  { phrase: 'realise', meaning: 'To suddenly understand something.' },
]

function reply(prompt) {
  if (/learner dictionary/i.test(prompt.system)) {
    const word = /headword "([^"]+)"/.exec(prompt.user)?.[1] ?? 'word'
    return {
      ipa: null,
      definitions:
        word === 'despite'
          ? [
              {
                partOfSpeech: 'preposition',
                definition: 'Even though something else is true; in spite of.',
              },
            ]
          : [{ partOfSpeech: 'verb', definition: `To ${word}, in the usual modern sense.` }],
      examples: [`They carried on ${word === 'despite' ? 'despite the rain' : word}.`],
    }
  }

  articleCalls += 1
  const short = articleCalls === 1
  return {
    title: 'The Week Maya Counted Her Hours',
    body: short ? SHORT : LONG,
    usedWords: EXPLANATIONS.map((item) => item.phrase),
    explanations: EXPLANATIONS,
  }
}

/**
 * One frame of MPEG-1 Layer III silence.
 *
 * At 32 kbps / 44.1 kHz / mono a frame is 104 bytes and 26.12 ms, and a frame
 * whose payload is all zeroes decodes to silence. Repeating it produces a
 * valid constant-bitrate MP3, which matters because the player reads the clip
 * duration from the file to drive the progress bar and the listen gate.
 */
const SILENT_FRAME = Buffer.alloc(104)
SILENT_FRAME.set([0xff, 0xfb, 0x10, 0xc0])

function silentMp3(seconds) {
  const frames = Math.max(1, Math.round((seconds * 1000) / 26.12))
  return Buffer.concat(Array.from({ length: frames }, () => SILENT_FRAME))
}

/**
 * Speak text without spending neurons.
 *
 * macOS ships an offline American voice, so a local lesson still has real
 * audio to listen to and sentence chunking can be judged by ear. Anywhere else
 * — CI, Linux — it degrades to silence of roughly the right length, which is
 * enough to exercise the player, R2 storage and the service worker.
 */
async function speak(text) {
  if (process.platform === 'darwin') {
    const file = join(tmpdir(), `mock-tts-${randomUUID()}.wav`)
    try {
      // execFile, not exec: the article text reaches the command as one argv
      // entry instead of being parsed by a shell.
      await run('say', [
        '-v',
        'Samantha',
        '--data-format=LEI16@22050',
        '--file-format=WAVE',
        '-o',
        file,
        text,
      ])
      return { audio: await readFile(file), contentType: 'audio/wav' }
    } catch (error) {
      console.warn(`  say failed (${error.message}), using silence instead`)
    } finally {
      await rm(file, { force: true })
    }
  }

  // Learner-paced speech is roughly 12 characters a second.
  return { audio: silentMp3(text.length / 12), contentType: 'audio/mpeg' }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
  })
}

createServer(async (req, res) => {
  // Workers AI, which writes the word cards during the pre-warm pass. The
  // shape matters more than the prose: what is being exercised locally is the
  // parsing and the card, not the model.
  if (req.url?.endsWith('/word-card')) {
    const payload = JSON.parse((await readBody(req)) || '{}')
    const prompt = payload.messages?.[0]?.content ?? ''
    const word = /card for "([^"]+)"/.exec(prompt)?.[1] ?? 'word'
    console.log(`✎ card for ${word}`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        result: {
          response: JSON.stringify({
            senses: [
              {
                pos: 'noun',
                definition: `A mock definition of ${word}.`,
                zh: '模拟词',
                // Both have to contain the word, or the checks in
                // parseWordCard drop them and the mock card arrives thin.
                examples: [
                  `The ${word} was hard to miss.`,
                  `Everyone noticed the ${word} at once.`,
                ],
              },
            ],
            collocations: [`a real ${word}`, `${word} of something`],
            family: [{ word: `${word}ness`, pos: 'noun' }],
          }),
        },
      }),
    )
    return
  }

  if (req.url?.endsWith('/tts')) {
    const { text = '' } = JSON.parse((await readBody(req)) || '{}')
    const started = Date.now()
    const { audio, contentType } = await speak(text)
    console.log(
      `♪ ${text.length} chars → ${(audio.length / 1024).toFixed(0)} KB ${contentType} in ${Date.now() - started}ms`,
    )
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(audio)
    return
  }

  if (!req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }

  const payload = JSON.parse(await readBody(req))
  const system = payload.messages.find((m) => m.role === 'system')?.content ?? ''
  const user = payload.messages.find((m) => m.role === 'user')?.content ?? ''
  const content = JSON.stringify(reply({ system, user }))

  console.log(
    `→ ${payload.model} ${system.slice(0, 40)}… (article calls: ${articleCalls})`,
  )
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 100, completion_tokens: 400 },
    }),
  )
}).listen(PORT, () =>
  console.log(
    `mock ai on http://127.0.0.1:${PORT}\n  chat    /v1/chat/completions\n  speech  /tts  (${
      process.platform === 'darwin' ? 'macOS say' : 'silence'
    })\n  cards   /word-card`,
  ),
)
