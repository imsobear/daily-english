import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const src = join(root, 'src')
const pub = join(root, 'public')

await mkdir(dist, { recursive: true })

const common = {
  absWorkingDir: root,
  bundle: true,
  target: 'chrome120',
  logLevel: 'info',
}

const entries = [
  { entryPoints: [join(src, 'background.ts')], format: 'esm', outfile: join(dist, 'background.js') },
  { entryPoints: [join(src, 'content.ts')], format: 'iife', outfile: join(dist, 'content.js') },
  { entryPoints: [join(src, 'popup.ts')], format: 'iife', outfile: join(dist, 'popup.js') },
]

async function copyPublic() {
  await cp(pub, dist, { recursive: true })
}

if (watch) {
  await copyPublic()
  await Promise.all(
    entries.map(async (entry) => {
      const ctx = await esbuild.context({ ...common, ...entry })
      await ctx.watch()
    }),
  )
  console.log('Watching extension sources…')
} else {
  await Promise.all(entries.map((entry) => esbuild.build({ ...common, ...entry })))
  await copyPublic()
}
