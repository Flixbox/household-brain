import { describe, expect, it } from 'bun:test'
import { pinnedActions } from './pins'

const SHA = 'a'.repeat(40)

describe('pinnedActions', () => {
  it('reads action, repository, commit and version, once each', () => {
    const workflow = `
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: actions/checkout@${SHA} # v7.0.1
      - uses: github/codeql-action/init@${SHA}
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

  it('takes no version from another line that names the pin', () => {
    const workflow = `steps:\n  - uses: actions/checkout@${SHA}\n  - run: echo actions/checkout@${SHA} # v1.2.3\n`
    expect(pinnedActions(workflow)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: null }])
  })

  it('refuses a workflow that is not valid YAML', () => {
    expect(() => pinnedActions('uses: [')).toThrow()
  })

  it('takes no version from a comment on the next line', () => {
    expect(pinnedActions(`uses: actions/checkout@${SHA}\n# v7.0.1`)).toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: null }])
  })

  // A ref that isn't a full commit SHA can't be dated, so it fails instead of skipping the 48-hour check (#559).
  it.each([
    'uses: actions/setup-node@v4',
    'uses: actions/setup-node@main',
    'uses: actions/setup-node@3d3c42e',
    `uses: actions/setup-node@${SHA}0`,
    'uses: actions/setup-node',
    'uses: docker://alpine:3.20',
    `uses: docker://alpine@sha256:${'b'.repeat(64)}`,
  ])('refuses a ref that is not a full commit SHA: %s', workflow => {
    expect(() => pinnedActions(workflow)).toThrow('not pinned to a full commit SHA')
  })

  it('names every unpinned ref, beside the pinned ones', () => {
    expect(() => pinnedActions(`- uses: actions/checkout@${SHA}\n- uses: actions/setup-node@v4\n- uses: actions/cache@main\n`))
      .toThrow('actions/setup-node@v4, actions/cache@main')
  })

  it('takes a local action or workflow without a pin', () => {
    expect(pinnedActions(`- uses: ./.github/actions/setup\n- uses: ./.github/workflows/build.yml\n- uses: actions/checkout@${SHA}\n`))
      .toEqual([{ action: 'actions/checkout', repo: 'actions/checkout', sha: SHA, tag: null }])
  })
})
