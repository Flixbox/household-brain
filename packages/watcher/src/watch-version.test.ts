import { describe, expect, it } from 'bun:test'
import { outdatedLine } from './watch-version'

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
