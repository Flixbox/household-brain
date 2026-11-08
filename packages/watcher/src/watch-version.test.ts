import { describe, expect, it } from 'bun:test'
import { codeVersion, outdatedLine } from './watch-version'

describe('codeVersion on the real watcher (#506)', () => {
  it('can tell which files the watcher runs: an import it can\'t follow would stop it on every change again', async () => {
    expect(await codeVersion()).toStartWith('files ')
  })

  it('counts the files watch-project.ts reaches only through its dynamic imports (#517)', async () => {
    const version = await codeVersion()
    expect(version).toContain('src/watch-version.ts:')
    expect(version).toContain('src/watch-main.ts:')
  })
})

describe('outdatedLine (#265)', () => {
  it('stops a watcher started on the code from before a pull that moved its checkout on', () => {
    // A restart that raced another one's pull of the same clone started on the old tree.
    expect(outdatedLine('a1bbd98', '21ac3d1')).toStartWith('WATCHER_OUTDATED:')
  })

  it('keeps a watcher whose code is unchanged, or whose checkout can\'t be read now', () => {
    expect(outdatedLine('21ac3d1', '21ac3d1')).toBeNull()
    expect(outdatedLine('21ac3d1', '')).toBeNull()
    // The plugin's copy is no git checkout: never read, never outdated.
    expect(outdatedLine('', '')).toBeNull()
  })

  it('stops one whose code couldn\'t be read at the start once it can: it may run any code', () => {
    expect(outdatedLine('', '21ac3d1')).toStartWith('WATCHER_OUTDATED:')
  })
})
