import { describe, expect, it } from 'bun:test'
import { FOLLOW_NEWER, type OpenPr, type Run, answerFirst, cancelledDeployEvent, clockTime, decisionFrom, listsOpenPrs, mainRunEvent, newActivity, openPrLines, reminderLines, replacementCandidates, runEvent, stamped, usageFrom } from './watch-events'

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

describe('replacementCandidates', () => {
  it('tries the newer main runs that passed or still run first, newest first, then the other newer ones (#270)', () => {
    const cancelled = run({ conclusion: 'cancelled', id: 10 })
    const main = (id: number, changes: Partial<Run> = {}) => ({ run: run({ id, ...changes }), sha: `sha-${id}` })
    const candidates = replacementCandidates(cancelled, SHA, [
      main(14, { conclusion: 'cancelled' }),
      main(13, { conclusion: '', status: 'in_progress' }),
      main(12),
      main(11, { conclusion: 'failure' }),
      main(10, { conclusion: 'cancelled' }),
      main(9),
    ])
    expect(candidates.map(candidate => candidate.run.id)).toEqual([13, 12, 14, 11])
  })

  it('leaves out runs of the cancelled commit itself, and has none when no newer run exists', () => {
    expect(replacementCandidates(run({ conclusion: 'cancelled', id: 10 }), SHA, [{ run: run({ id: 11 }), sha: SHA }])).toEqual([])
    expect(replacementCandidates(run({ conclusion: 'cancelled', id: 10 }), SHA, [{ run: run({ id: 9 }), sha: 'older' }])).toEqual([])
  })
})

describe('decisionFrom', () => {
  it('takes each reviewer\'s latest approval, change request or dismissal; comments don\'t count', () => {
    expect(decisionFrom('', [{ login: 'owner', state: 'APPROVED' }, { login: 'owner', state: 'COMMENTED' }], 'owner')).toBe('APPROVED')
    expect(decisionFrom('', [{ login: 'owner', state: 'CHANGES_REQUESTED' }, { login: 'owner', state: 'APPROVED' }], 'owner')).toBe('APPROVED')
    expect(decisionFrom('', [{ login: 'owner', state: 'APPROVED' }, { login: 'owner', state: 'DISMISSED' }], 'owner')).toBe('')
  })

  it('lets one reviewer\'s change request outweigh another\'s approval, and is empty without reviews', () => {
    expect(decisionFrom('', [{ login: 'owner', state: 'APPROVED' }, { login: 'bot', state: 'CHANGES_REQUESTED' }], 'owner')).toBe('CHANGES_REQUESTED')
    expect(decisionFrom('', [{ login: 'owner', state: 'COMMENTED' }], 'owner')).toBe('')
    expect(decisionFrom('', [], 'owner')).toBe('')
  })

  it('counts an approval only from the owner, also when GitHub calls the PR approved (#277)', () => {
    const botApproved = [{ login: 'reviewer[bot]', state: 'APPROVED' }]
    expect(decisionFrom('', botApproved, 'owner')).toBe('')
    expect(decisionFrom('APPROVED', botApproved, 'owner')).toBe('')
    expect(decisionFrom('APPROVED', [...botApproved, { login: 'Owner', state: 'APPROVED' }], 'owner')).toBe('APPROVED')
  })

  it('keeps GitHub\'s decision when it isn\'t an approval', () => {
    expect(decisionFrom('CHANGES_REQUESTED', [{ login: 'owner', state: 'APPROVED' }], 'owner')).toBe('CHANGES_REQUESTED')
    expect(decisionFrom('REVIEW_REQUIRED', [], 'owner')).toBe('REVIEW_REQUIRED')
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
      { autoMerge: false, checks: ['SUCCESS', 'SKIPPED'], mergeState: 'CLEAN', number: 3, parked: true, queued: false, reviewDecision: '', title: 'Bump a tool' },
      { autoMerge: true, checks: ['SUCCESS', 'IN_PROGRESS'], mergeState: 'CLEAN', number: 4, parked: false, queued: false, reviewDecision: 'APPROVED', title: 'Add a page' },
      { autoMerge: false, checks: ['FAILURE'], mergeState: 'CLEAN', number: 5, parked: false, queued: false, reviewDecision: 'CHANGES_REQUESTED', title: 'Fix a bug' },
      { autoMerge: false, checks: ['SUCCESS'], mergeState: 'CLEAN', number: 6, parked: false, queued: true, reviewDecision: 'APPROVED', title: 'Ship it' },
    ])).toEqual([
      'Open PRs:',
      '  #3 Bump a tool: parked, awaiting approval, auto-merge off, CI green',
      '  #4 Add a page: approved, auto-merge on, CI running',
      '  #5 Fix a bug: changes requested, auto-merge off, CI failed',
      '  #6 Ship it: approved, in the merge queue, CI green',
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
    const items = [{ id: 'comment 1', lines: ['a'] }, { id: 'comment 2', lines: ['b'] }, { id: 'comment 2', lines: ['b'] }]
    expect(newActivity(new Set(['comment 1']), items)).toEqual([{ id: 'comment 2', lines: ['b'] }])
  })
})

describe('answerFirst (#222)', () => {
  it('puts what someone waits for an answer to before CI and deploys, each in the order found', () => {
    const deployed = ['PR #271: DEPLOYED: live', 'Open PRs:', '#272 …: approved']
    const approved = ['PR #272: APPROVED by the owner.']
    const activity = ['PR #272: ACTIVITY:', 'review-comment 1 owner …']
    const issue = ['NEW_ISSUE #9 Something']
    const main = ['MAIN_PASSED: CI run 1 on main passed']
    expect(answerFirst([deployed, main, activity, approved, issue])).toEqual([activity, approved, issue, deployed, main])
  })
})

describe('reminderLines (#224)', () => {
  const pr = (changes: Partial<OpenPr>): OpenPr => ({ autoMerge: false, checks: ['SUCCESS'], mergeState: 'CLEAN', number: 1, parked: false, queued: false, reviewDecision: 'APPROVED', title: 'x', ...changes })

  it('reminds of an approved PR with green CI and auto-merge off, and of one whose CI failed', () => {
    expect(reminderLines([pr({ number: 284 }), pr({ checks: ['SUCCESS', 'FAILURE'], number: 290 })])).toEqual([
      'REMINDER: PR #284 is approved and CI is green, but auto-merge is off: enable it.',
      'REMINDER: PR #290 is approved and CI failed: fix it.',
    ])
  })

  it('stays quiet about running or unreported CI, auto-merge already on, parked or unapproved PRs', () => {
    expect(reminderLines([
      pr({ checks: ['SUCCESS', 'pending'] }),
      pr({ autoMerge: true }),
      pr({ parked: true }),
      pr({ reviewDecision: 'REVIEW_REQUIRED' }),
      pr({ checks: [] }),
      // In the merge queue: auto-merge shows as off there, and the queue does the merging (#251).
      pr({ queued: true }),
      pr({ checks: ['FAILURE'], queued: true }),
    ])).toEqual([])
  })
})

describe('reminders for branches that can\'t merge (#226)', () => {
  const pr = (changes: Partial<OpenPr>): OpenPr => ({ autoMerge: true, checks: ['SUCCESS'], mergeState: 'CLEAN', number: 314, parked: false, queued: false, reviewDecision: 'APPROVED', title: 'x', ...changes })

  it('reminds of a branch behind main or in conflict, approved or not', () => {
    expect(reminderLines([pr({ mergeState: 'BEHIND' }), pr({ mergeState: 'DIRTY', number: 9, reviewDecision: '' })])).toEqual([
      'REMINDER: PR #314 is behind main: rebase it and run the checks again.',
      'REMINDER: PR #9 has conflicts with main: rebase it.',
    ])
  })

  it('says so in the open-PR list, and leaves parked PRs and clean branches alone', () => {
    expect(openPrLines([pr({ mergeState: 'BEHIND', title: 'Triggers' })])).toEqual(['Open PRs:', '  #314 Triggers: approved, auto-merge on, CI green, behind main'])
    expect(reminderLines([pr({ mergeState: 'BEHIND', parked: true }), pr({})])).toEqual([])
  })
})

describe('usageFrom (#233, #238)', () => {
  it('reads the five-hour and seven-day windows as whole percentages used and left, with when each resets', () => {
    const answer = {
      five_hour: { resets_at: '2026-10-17T12:10:00.122917+00:00', utilization: 12.4 },
      seven_day: { resets_at: '2026-10-19T19:00:00.122936+00:00', utilization: 66 },
    }
    expect(usageFrom(answer, 'Europe/Berlin')).toBe('Usage: session 12% used (88% left, resets 2026-10-17 14:10), week 66% used (34% left, resets 2026-10-19 21:00)')
    expect(usageFrom({ five_hour: { resets_at: 'soon', utilization: 3 } }, 'UTC')).toBe('Usage: session 3% used (97% left), week ?')
  })

  it('rounds the use, keeps used and left adding up to 100, and keeps both within 0 to 100', () => {
    expect(usageFrom({ five_hour: { utilization: 12.5 }, seven_day: { utilization: 101.2 } }, 'UTC')).toBe('Usage: session 13% used (87% left), week 100% used (0% left)')
    expect(usageFrom({ five_hour: { utilization: -0.6 } }, 'UTC')).toBe('Usage: session 0% used (100% left), week ?')
  })

  it('says unknown for anything else', () => {
    expect(usageFrom(null)).toBe('Usage: unknown')
    expect(usageFrom({ error: 'unauthorized' })).toBe('Usage: unknown')
  })
})

describe('stamped (#240)', () => {
  it('puts when the event was found in front, and when it was written for a comment or issue', () => {
    expect(stamped(['ISSUE_COMMENT 9 #3: hi', '  more'], '12:27:03', '12:09:20')).toEqual(['[12:27:03, written 12:09:20] ISSUE_COMMENT 9 #3: hi', '  more'])
    expect(stamped(['MAIN_ADVANCED: main is at abc'], '12:27:03')).toEqual(['[12:27:03] MAIN_ADVANCED: main is at abc'])
  })

  it('still sorts stamped answers first', () => {
    const deployed = stamped(['PR #4: DEPLOYED: live'], '12:00:00')
    const comment = stamped(['ISSUE_COMMENT 9 #3: hi'], '12:00:01', '11:59:00')
    expect(answerFirst([deployed, comment])).toEqual([comment, deployed])
  })
})

describe('clockTime (#240)', () => {
  it("reads GitHub's timestamps and instants on the given clock, and nothing else", () => {
    expect(clockTime('2026-10-17T12:09:20Z', 'Europe/Berlin')).toBe('14:09:20')
    expect(clockTime(Temporal.Instant.from('2026-10-17T12:09:20.7Z'), 'UTC')).toBe('12:09:20')
    expect(clockTime('soon', 'UTC')).toBeNull()
    expect(clockTime(null, 'UTC')).toBeNull()
  })
})
