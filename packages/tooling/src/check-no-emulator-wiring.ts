/**
 * Fails when a web build contains emulator code (#534), or contains nothing that could be checked:
 * a missing or empty folder must never read as a clean build.
 *
 *   bun packages/tooling/src/check-no-emulator-wiring.ts apps/web/dist
 */

import { Glob } from 'bun'

// `packages/firebase/src/firebase.ts` passes Auth one URL, but Firestore a host and a port as two
// arguments, which a bundle writes as `"127.0.0.1",8080`.
const wiring = [
  { pattern: /e2eSignIn/u, what: 'the e2e sign-in hook' },
  { pattern: /127\.0\.0\.1:(?:9099|8080)/u, what: 'an emulator address' },
  { pattern: /127\.0\.0\.1["'`]?,\s*(?:9099|8080)/u, what: 'an emulator host and port' },
]

/** Every file below `dir`, relative to it; none when `dir` can't be read as a folder. */
const filesIn = (dir: string) => {
  try {
    return [...new Glob('**').scanSync({ cwd: dir, dot: true })]
  } catch {
    return []
  }
}

/** What is wrong with the build in `dir`; empty when it is a build without emulator code. */
export const checkBuild = async (dir: string) => {
  const names = filesIn(dir)
  if (!names.some(name => name.endsWith('.js'))) {
    return [`${dir} is missing or holds no JavaScript, so there is no build to check`]
  }
  const problems = await Promise.all(names.map(async name => {
    const path = `${dir}/${name}`
    const text = await Bun.file(path).text()
    return wiring.filter(({ pattern }) => pattern.test(text)).map(({ what }) => `${path} contains ${what}`)
  }))
  return problems.flat()
}

if (import.meta.main) {
  const [dir] = process.argv.slice(2)
  if (typeof dir === 'undefined') {
    process.stderr.write('Usage: check-no-emulator-wiring <build folder>\n')
    process.exit(2)
  }
  const problems = await checkBuild(dir)
  for (const problem of problems) {
    process.stdout.write(`::error::${problem}\n`)
  }
  if (problems.length > 0) {
    process.exit(1)
  }
  process.stdout.write(`${dir} is a build without emulator code\n`)
}
