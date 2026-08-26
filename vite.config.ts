import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

function stubCloudflareWorkersOnClient(): Plugin {
  return {
    name: 'stub-cloudflare-workers-on-client',
    resolveId(id: string) {
      if (
        (id === 'cloudflare:workers' || id === 'cloudflare:workflows') &&
        this.environment?.name === 'client'
      ) {
        return '\0cf-workers-stub'
      }
    },
    load(id: string) {
      if (id === '\0cf-workers-stub') {
        return [
          'export const env = {}',
          'export function waitUntil() {}',
          'export class WorkflowEntrypoint {}',
          'export class NonRetryableError extends Error {}',
        ].join('\n')
      }
    },
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    stubCloudflareWorkersOnClient(),
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
