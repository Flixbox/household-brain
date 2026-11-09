import { describe, expect, it } from 'bun:test'
import { pinnedActions } from './pins'

const SHA = 'a'.repeat(40)

describe('pinnedActions', () => {
  it('reads action, repository, commit and version, once each', () => {
    const workflow = `
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: github/codeql-action/init@${SHA}
      - uses: actions/setup-node@v4
    `
    expect(pinnedActions(workflow)).toEqual([
      { action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: 'v7.0.1' },
      { action: 'github/codeql-action/init', repo: 'github/codeql-action', sha: SHA, tag: null },
    ])
  })

  // A pin the regular expression misses skips the 48-hour check, and one that loses its tag is dated by its commit (#546).
  it.each([
    `uses:   actions/checkout@${SHA} # v7.0.1`,
    `uses:\tactions/checkout@${SHA} # v7.0.1`,
    `uses: actions/checkout@${SHA}   # v7.0.1`,
    `uses: actions/checkout@${SHA} #v7.0.1`,
    `uses: "actions/checkout@${SHA}" # v7.0.1`,
    `uses: 'actions/checkout@${SHA}' # v7.0.1`,
  ])('reads a pin however YAML spaces or quotes it: %s', line => {
    expect(pinnedActions(line)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: 'v7.0.1' }])
  })

  it('takes no version from a comment on the next line', () => {
    expect(pinnedActions(`uses: actions/checkout@${SHA}\n# v7.0.1`)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: null }])
  })
})
