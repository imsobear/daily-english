/**
 * Rasterise public/icon.svg into every icon and launch screen the installed
 * app needs.
 *
 * Output is committed rather than generated at build time: the assets change
 * only when the artwork does, and keeping sharp out of the deploy path means a
 * missing native binary can never break a release.
 *
 *   pnpm icons
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import {
  LAUNCH_BACKGROUND,
  LAUNCH_SCREENS,
  launchScreenFile,
} from '../src/lib/launch-screens.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
const source = await readFile(join(root, 'public', 'icon.svg'))

/** The artwork is a 512 unit square, so density scales it to the target. */
function render(size) {
  return sharp(source, { density: Math.ceil((72 * size) / 512) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
}

/**
 * Apply the squircle iOS uses for home screen icons.
 *
 * Only the launch screens need this. The icon files themselves stay square,
 * because both iOS and Android mask them and a pre-rounded icon would end up
 * with its corners cut twice.
 */
async function rounded(size) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.2237)}" fill="#fff"/></svg>`,
  )
  return sharp(await render(size).toBuffer())
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function write(name, data) {
  await writeFile(join(outDir, name), data)
  return `${name} (${(data.length / 1024).toFixed(1)} KB)`
}

await mkdir(outDir, { recursive: true })

const written = []

for (const size of [180, 192, 512]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`
  written.push(await write(name, await render(size).toBuffer()))
}

for (const screen of LAUNCH_SCREENS) {
  const width = screen.width * screen.ratio
  const height = screen.height * screen.ratio
  // A quarter of the narrow edge reads as roughly the size of the home screen
  // icon it launched from, which makes the transition feel continuous.
  const iconSize = Math.round(Math.min(width, height) * 0.25)
  const icon = await rounded(iconSize)

  for (const scheme of ['light', 'dark']) {
    const png = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: LAUNCH_BACKGROUND[scheme],
      },
    })
      .composite([
        {
          input: icon,
          left: Math.round((width - iconSize) / 2),
          top: Math.round((height - iconSize) / 2),
        },
      ])
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()

    written.push(
      await write(launchScreenFile(screen, scheme).replace('/icons/', ''), png),
    )
  }
}

console.log(`Wrote ${written.length} files to public/icons:`)
for (const line of written) console.log(`  ${line}`)
