/**
 * Fails when a web build contains emulator code (#534), or contains nothing that could be checked:
 * a missing or empty folder must never read as a clean build.
 *
 *   bun packages/tooling/src/check-no-emulator-wiring.ts apps/web/dist
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// `packages/firebase/src/firebase.ts` passes Auth one URL, but Firestore a host and a port as two
// arguments, which a bundle writes as `"127.0.0.1",8080`.
const wiring = [
  { pattern: /e2eSignIn/, what: 'the e2e sign-in hook' },
  { pattern: /127\.0\.0\.1:(?:9099|8080)/, what: 'an emulator address' },
  { pattern: /127\.0\.0\.1["'`]?,\s*(?:9099|8080)/, what: 'an emulator host and port' },
]

/** Every file below `dir`, relative to it, or null when `dir` can't be read as a folder. */
const filesIn = (dir: string) => {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(name => statSync(join(dir, name)).isFile())
  }
  catch {
    return null
  }
}

/** What is wrong with the build in `dir`; empty when it is a build without emulator code. */
export const checkBuild = (dir: string) => {
  const names = filesIn(dir)
  if (names === null) {
    return [`${dir} is missing, so there is no build to check`]
  }
  if (!names.some(name => name.endsWith('.js'))) {
    return [`${dir} holds no JavaScript, so there is no build to check`]
  }
  return names.flatMap((name) => {
    const path = join(dir, name)
    const text = readFileSync(path, 'utf8')
    return wiring.filter(({ pattern }) => pattern.test(text)).map(({ what }) => `${path} contains ${what}`)
  })
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (typeof dir === 'undefined') {
    console.error('Usage: check-no-emulator-wiring <build folder>')
    process.exit(1)
  }
  const problems = checkBuild(dir)
  for (const problem of problems) {
    console.error(`::error::${problem}`)
  }
  if (problems.length > 0) {
    process.exit(1)
  }
  console.log(`${dir} is a build without emulator code`)
}
