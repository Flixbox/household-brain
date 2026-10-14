import { describe, expect, it } from 'bun:test'
import { FOLLOW_NEWER, type Run, cancelledDeployEvent, decisionFrom, listsOpenPrs, mainRunEvent, newActivity, openPrLines, runEvent } from './watch-events'

const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const run = (changes: Partial<Run> = {}): Run => ({ ageSeconds: 60, attempt: 1, conclusion: 'success', id: 7, status: 'completed', ...changes })
const context = { jobs: ['  Lint: completed success'], limitSeconds: 1200, pr: 12, repo: 'owner/repo', sha: SHA }

describe('runEvent', () => {
  it('reports a PR run that passed or failed, keyed so a re-run that fails again is news', () => {
    expect(runEvent({ ...context, label: 'pr', run: run() })).toEqual({ key: `pr-12 ci-passed ${SHA}`, lines: ['CI_PASSED for abcdef1 (run 7)', '  Lint: completed success'] })
    expect(runEvent({ ...context, label: 'pr', run: run({ attempt: 2, conclusion: 'failure' }) })).toMatchObject({ key: `pr-12 ci-failed ${SHA} 2` })
  })

  it('ignores a PR run a newer push cancelled, and one still running within the limit', () => {
    expect(runEvent({ ...context, label: 'pr', run: run({ conclusion: 'cancelled' }) })).toBeNull()
    expect(runEvent({ ...context, label: 'pr', run: run({ conclusion: '', status: 'in_progress' }) })).toBeNull()
  })

  it('reports a run past the limit as slow', () => {
    expect(runEvent({ ...context, label: 'deploy', run: run({ ageSeconds: 1500, conclusion: '', status: 'in_progress' }) }))
      .toMatchObject({ key: 'pr-12 ci-slow 7 1', lines: [expect.stringContaining('still in_progress after 25 min'), '  Lint: completed success'] })
  })

  it('reports a deploy, and follows a newer run when it was cancelled', () => {
    expect(runEvent({ ...context, label: 'deploy', run: run() })).toMatchObject({ key: `pr-12 deployed ${SHA}` })
    expect(runEvent({ ...context, label: 'deploy', run: run({ conclusion: 'failure' }) })).toMatchObject({ key: `pr-12 deploy-failed ${SHA} 1` })
    expect(runEvent({ ...context, label: 'deploy', run: run({ conclusion: 'cancelled' }) })).toBe(FOLLOW_NEWER)
    expect(cancelledDeployEvent({ ...context, run: run({ conclusion: 'cancelled' }) }).lines[0]).toContain('no newer run replaces it')
  })
})

describe('decisionFrom', () => {
  it('takes each reviewer\'s latest approval, change request or dismissal; comments don\'t count', () => {
    expect(decisionFrom([{ login: 'owner', state: 'APPROVED' }, { login: 'owner', state: 'COMMENTED' }])).toBe('APPROVED')
    expect(decisionFrom([{ login: 'owner', state: 'CHANGES_REQUESTED' }, { login: 'owner', state: 'APPROVED' }])).toBe('APPROVED')
    expect(decisionFrom([{ login: 'owner', state: 'APPROVED' }, { login: 'owner', state: 'DISMISSED' }])).toBe('')
  })

  it('lets one reviewer\'s change request outweigh another\'s approval, and is empty without reviews', () => {
    expect(decisionFrom([{ login: 'owner', state: 'APPROVED' }, { login: 'bot', state: 'CHANGES_REQUESTED' }])).toBe('CHANGES_REQUESTED')
    expect(decisionFrom([{ login: 'owner', state: 'COMMENTED' }])).toBe('')
    expect(decisionFrom([])).toBe('')
  })
})

describe('mainRunEvent', () => {
  it('reports main passing, failing or hanging, and ignores a cancelled run', () => {
    expect(mainRunEvent({ limitSeconds: 1200, repo: 'owner/repo', run: run() })).toMatchObject({ key: 'main-passed 7 1' })
    expect(mainRunEvent({ limitSeconds: 1200, repo: 'owner/repo', run: run({ conclusion: 'failure' }) })).toMatchObject({ key: 'main-failed 7 1' })
    expect(mainRunEvent({ limitSeconds: 1200, repo: 'owner/repo', run: run({ ageSeconds: 1300, conclusion: '', status: 'queued' }) })).toMatchObject({ key: 'main-slow 7 1' })
    expect(mainRunEvent({ limitSeconds: 1200, repo: 'owner/repo', run: run({ conclusion: 'cancelled' }) })).toBeNull()
  })
})

describe('openPrLines', () => {
  it('says where each PR stands', () => {
    expect(openPrLines([
      { autoMerge: false, checks: ['SUCCESS', 'SKIPPED'], number: 3, parked: true, reviewDecision: '', title: 'Bump a tool' },
      { autoMerge: true, checks: ['SUCCESS', 'IN_PROGRESS'], number: 4, parked: false, reviewDecision: 'APPROVED', title: 'Add a page' },
      { autoMerge: false, checks: ['FAILURE'], number: 5, parked: false, reviewDecision: 'CHANGES_REQUESTED', title: 'Fix a bug' },
    ])).toEqual([
      'Open PRs:',
      '  #3 Bump a tool: parked, awaiting approval, auto-merge off, CI green',
      '  #4 Add a page: approved, auto-merge on, CI running',
      '  #5 Fix a bug: changes requested, auto-merge off, CI failed',
    ])
  })

  it('comes with every CI result, and only with those', () => {
    expect(listsOpenPrs(`pr-12 ci-passed ${SHA}`)).toBe(true)
    expect(listsOpenPrs('main-failed 7 1')).toBe(true)
    expect(listsOpenPrs('pr-12 approved')).toBe(false)
  })
})

describe('newActivity', () => {
  it('keeps what was not seen, once', () => {
    const items = [{ id: 'comment 1', line: 'a' }, { id: 'comment 2', line: 'b' }, { id: 'comment 2', line: 'b' }]
    expect(newActivity(new Set(['comment 1']), items)).toEqual([{ id: 'comment 2', line: 'b' }])
  })
})
