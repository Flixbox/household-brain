import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkBuild } from './check-no-emulator-wiring'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

const build = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'emulator-wiring-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'assets'))
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text)
  }
  return dir
}

test('passes a build without emulator code', () => {
  expect(checkBuild(build({ 'assets/index.js': 'connect("firestore.googleapis.com",443)', 'index.html': '<html>' }))).toEqual([])
})

test('fails a missing folder', () => {
  expect(checkBuild(join(build({}), 'nope'))).toEqual([expect.stringContaining('is missing')])
})

test('fails a folder without JavaScript', () => {
  expect(checkBuild(build({}))).toEqual([expect.stringContaining('holds no JavaScript')])
  expect(checkBuild(build({ 'index.html': '<html>' }))).toEqual([expect.stringContaining('holds no JavaScript')])
})

test.each([
  ['e2eSignIn', 'Object.assign(globalThis,{e2eSignIn:async(a)=>a})'],
  ['the Auth address', 'c(a,"http://127.0.0.1:9099",{disableWarnings:!0})'],
  ['the Firestore wiring, minified', 'd(b,"127.0.0.1",8080)'],
  ['the Firestore wiring, unminified', 'connectFirestoreEmulator(db, \'127.0.0.1\', 8080)'],
])('finds %s, in a nested file', (_, text) => {
  expect(checkBuild(build({ 'assets/index.js': text }))).toEqual([expect.stringContaining('index.js contains')])
})
