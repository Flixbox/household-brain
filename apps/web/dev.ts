/**
 * The dev server: `bun dev.ts` (through `bun run dev`). Every page address gets the app, as Firebase
 * Hosting's rewrite does; Tailwind and the `BUN_PUBLIC_*` variables come in through bunfig.toml.
 *
 * Bun's hot module reloading can't load import cycles yet (oven-sh/bun#40259; temporal-polyfill has
 * one), so it is off and the page reloads instead: a change under `src` sends `/__reload` listeners
 * (main.tsx) a message, and the reload gets a fresh bundle. Once Bun's fix ships, `hmr: true` and
 * the listener go.
 */
import { watch } from 'node:fs'
import app from './index.html'

const listeners = new Set<ReadableStreamDefaultController<string>>()
const RELOAD_DELAY_MS = 100
let pending: ReturnType<typeof setTimeout> | null = null

const reloadPages = () => {
  if (pending) {
    clearTimeout(pending)
  }
  // An editor saves in several writes: one reload for all of them.
  pending = setTimeout(() => {
    for (const listener of listeners) {
      listener.enqueue('data: reload\n\n')
    }
  }, RELOAD_DELAY_MS)
}
for (const folder of ['src', '../../packages']) {
  watch(folder, { recursive: true }, (_event, file) => {
    if (file && !file.includes('node_modules')) {
      reloadPages()
    }
  })
}

const reloads = () => {
  let own: ReadableStreamDefaultController<string> | null = null
  return new Response(new ReadableStream<string>({
    cancel: () => {
      if (own) {
        listeners.delete(own)
      }
    },
    start: controller => {
      own = controller
      listeners.add(controller)
    },
  }), { headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/event-stream' } })
}

const server = Bun.serve({
  development: { console: true, hmr: false },
  idleTimeout: 0,
  port: 5173,
  // Bun matches the most specific route first, so `/__reload` isn't swallowed by `/*`.
  routes: { '/*': app, '/__reload': reloads },
})
process.stdout.write(`Household Brain: ${server.url.href}\n`)
