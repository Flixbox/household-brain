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

  // Valid YAML the regular expression didn't read: each skipped the 48-hour check without an error (#554).
  it.each([
    `uses : actions/checkout@${SHA} # v7.0.1`,
    `"uses": actions/checkout@${SHA} # v7.0.1`,
    `uses:\n  actions/checkout@${SHA} # v7.0.1`,
    `uses: &pin actions/checkout@${SHA} # v7.0.1`,
    `uses: actions/checkout@${SHA.toUpperCase()} # v7.0.1`,
  ])('reads every spelling YAML allows: %s', workflow => {
    expect(pinnedActions(workflow)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: 'v7.0.1' }])
  })

  it('reads every step of every document, once each', () => {
    const workflow = `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA}\n---\njobs:\n  b:\n    steps:\n      - uses: actions/checkout@${SHA}\n      - uses: actions/cache@${SHA}\n`
    expect(pinnedActions(workflow).map(({ action }) => action)).toEqual(['actions/checkout', 'actions/cache'])
  })

  it('takes neither a comment nor a script for a pin', () => {
    expect(pinnedActions(`# uses: actions/checkout@${SHA}\nrun: |\n  uses: actions/cache@${SHA}\n`)).toEqual([])
  })

  it('refuses a workflow that is not valid YAML', () => {
    expect(() => pinnedActions('uses: [')).toThrow()
  })

  it('takes no version from a comment on the next line', () => {
    expect(pinnedActions(`uses: actions/checkout@${SHA}\n# v7.0.1`)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: null }])
  })
})
