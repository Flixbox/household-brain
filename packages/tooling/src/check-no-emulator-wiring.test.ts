/* oxlint-disable import/no-nodejs-modules -- builds in a temporary folder; Bun has no API for one */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkBuild } from './check-no-emulator-wiring'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

const build = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'emulator-wiring-'))
  dirs.push(dir)
  mkdirSync(path.join(dir, 'assets'))
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), text)
  }
  return dir
}

test('passes a build without emulator code', async () => {
  expect(await checkBuild(build({ 'assets/index.js': 'connect("firestore.googleapis.com",443)', 'index.html': '<html>' }))).toEqual([])
})

test('fails a missing folder', async () => {
  expect<unknown>(await checkBuild(path.join(build({}), 'nope'))).toEqual([expect.stringContaining('no build to check')])
})

test('fails a folder without JavaScript', async () => {
  expect<unknown>(await checkBuild(build({}))).toEqual([expect.stringContaining('no build to check')])
  expect<unknown>(await checkBuild(build({ 'index.html': '<html>' }))).toEqual([expect.stringContaining('no build to check')])
})

test.each([
  'Object.assign(globalThis,{e2eSignIn:async(a)=>a})',
  'c(a,"http://127.0.0.1:9099",{disableWarnings:!0})',
  'd(b,"127.0.0.1",8080)',
  'connectFirestoreEmulator(db, \'127.0.0.1\', 8080)',
])('finds the wiring in a nested file: %s', async text => {
  expect<unknown>(await checkBuild(build({ 'assets/index.js': text }))).toEqual([expect.stringContaining('index.js contains')])
})
