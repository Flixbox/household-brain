/* oxlint-disable import/no-nodejs-modules -- a temporary folder for the claims; node:fs/promises and node:os are built into Bun */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { claim, unclaim } from './watch-files'

const dir = await mkdtemp(`${tmpdir()}/watch-files-`)
afterAll(async () => rm(dir, { force: true, recursive: true }))

describe('claim', () => {
  it('lets exactly one of several claims of a path through, and again once it is given back', async () => {
    const path = `${dir}/claims/pr-7-abc-coderabbitai`
    const claims = await Promise.all([claim(path), claim(path), claim(path)])
    expect(claims.filter(Boolean)).toEqual([true])
    expect(await claim(path)).toBe(false)
    await unclaim(path)
    expect(await claim(path)).toBe(true)
  })
})
