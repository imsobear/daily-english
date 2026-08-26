/**
 * Rasterise scripts/og-card.html into public/og.png, the picture a chat app or
 * social network shows when someone shares a link to us.
 *
 * A browser does the drawing because the card is mostly type, and only a
 * browser will set Nunito and Lora the way the app does. Like the icons, the
 * output is committed: it changes when the artwork changes, and a deploy that
 * needed a headless Chrome to succeed would be a deploy waiting to break.
 *
 *   pnpm og
 *
 * Point CHROME_PATH at a binary if the usual places come up empty.
 */
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const WIDTH = 1200
const HEIGHT = 630

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const card = join(root, 'scripts', 'og-card.html')
const out = join(root, 'public', 'og.png')

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

async function findChrome() {
  for (const path of CANDIDATES) {
    try {
      await access(path)
      return path
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    `No Chrome found. Tried:\n  ${CANDIDATES.join('\n  ')}\nSet CHROME_PATH to one.`,
  )
}

const chrome = await findChrome()
const dir = await mkdtemp(join(tmpdir(), 'og-'))
const shot = join(dir, 'card.png')

await new Promise((resolve, reject) => {
  const child = spawn(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${shot}`,
      // Long enough for the webfonts to arrive; the card has nothing else to
      // wait for.
      '--virtual-time-budget=8000',
      card,
    ],
    { stdio: 'ignore' },
  )
  child.on('error', reject)
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Chrome exited with ${code}`)),
  )
})

const raw = await readFile(shot)
await rm(dir, { recursive: true, force: true })

const { width, height } = await sharp(raw).metadata()
if (width !== WIDTH || height !== HEIGHT) {
  throw new Error(`Expected ${WIDTH}x${HEIGHT}, got ${width}x${height}`)
}

// Recompressed rather than saved as Chrome wrote it: same pixels, roughly a
// third of the bytes, and some chat clients give up on a slow preview image.
const png = await sharp(raw).png({ compressionLevel: 9, effort: 10 }).toBuffer()
await writeFile(out, png)

console.log(`Wrote public/og.png (${(png.length / 1024).toFixed(1)} KB)`)
