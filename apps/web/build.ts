/* oxlint-disable import/no-nodejs-modules -- a build step: runs on Bun at build time, never in the browser */
/**
 * Builds the app with Bun's bundler, from index.html:
 *
 *   bun --env-file=.env.<mode> build.ts <production|e2e> <out dir>
 *
 * Tailwind comes in through its Bun plugin, and the React Compiler is built into Bun (it memoises at
 * build time, so no hand-written `useMemo`/`useCallback`, #69). Only `BUN_PUBLIC_*` variables reach
 * the app, inlined where the code reads `process.env.BUN_PUBLIC_*` literally.
 */
import { cp, rm } from 'node:fs/promises'
import tailwind from 'bun-plugin-tailwind'

const [mode, outdir] = process.argv.slice(2)
if ((mode !== 'production' && mode !== 'e2e') || !outdir) {
  process.stderr.write('Usage: bun --env-file=.env.<mode> build.ts <production|e2e> <out dir>\n')
  process.exit(64)
}
if (mode === 'production' && process.env.BUN_PUBLIC_USE_EMULATORS === 'true') {
  throw new Error('BUN_PUBLIC_USE_EMULATORS=true in a production build: check apps/web/.env.production.local')
}

await rm(outdir, { force: true, recursive: true })
const built = await Bun.build({
  // The e2e build is a production build too, only wired to the emulators.
  define: {
    // A variable the code reads but the environment lacks would stay `process.env.…` and throw in
    // the browser, so the one optional flag gets its default here.
    'process.env.BUN_PUBLIC_USE_EMULATORS': JSON.stringify(process.env.BUN_PUBLIC_USE_EMULATORS ?? 'false'),
    'process.env.NODE_ENV': '"production"',
  },
  entrypoints: ['index.html'],
  env: 'BUN_PUBLIC_*',
  minify: true,
  // Hashed names under assets/, which Firebase Hosting caches for a year (firebase.json).
  naming: { asset: 'assets/[name]-[hash].[ext]', chunk: 'assets/[name]-[hash].[ext]', entry: '[name].[ext]' },
  outdir,
  plugins: [tailwind],
  // Absolute asset addresses, so a page deeper than the root (/items/…) finds them too.
  publicPath: '/',
  reactCompiler: true,
  splitting: true,
  target: 'browser',
})
if (!built.success) {
  throw new AggregateError(built.logs, 'The build failed')
}
const leftovers = await Promise.all(built.outputs.map(async output => (await output.text()).includes('process.env.BUN_PUBLIC_') ? output.path : ''))
if (leftovers.some(Boolean)) {
  throw new Error(`An environment variable the app reads is not set: ${leftovers.filter(Boolean).join(', ')}`)
}
await cp('public', outdir, { recursive: true })
process.stdout.write(`${outdir}: ${built.outputs.length} files\n`)
