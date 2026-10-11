/**
 * The dev server, Bun's own with hot module reloading (`bun run dev`). Every page address gets the
 * app, as Firebase Hosting's rewrite does. It runs from the repository root (its `dev` script), as
 * Bun only watches files under its working directory: Tailwind and the `BUN_PUBLIC_*` variables
 * come in through the root bunfig.toml, their values from the env files the production build reads.
 */
import app from './index.html'

const server = Bun.serve({
  development: { console: true, hmr: true },
  port: 5173,
  routes: { '/*': app },
})
process.stdout.write(`Household Brain: ${server.url.href}\n`)
