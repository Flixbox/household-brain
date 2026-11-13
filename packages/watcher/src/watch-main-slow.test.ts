import { describe, expect, it } from 'bun:test'
import { type Run, mainRunEvent } from './watch-events'

const slowRun: Run = { ageSeconds: 1300, attempt: 1, conclusion: '', id: 7, status: 'in_progress' }

describe('what a hanging main advises (#557)', () => {
  const slowMain = (jobs: string[]) => mainRunEvent({ jobs, limitSeconds: 1200, repo: 'owner/repo', run: slowRun })?.lines ?? []

  it('names the pending deploys, lists the jobs and does not say to cancel', () => {
    const jobs = ['  web-e2e: completed success', '  pages: in_progress ', '  dev-release: queued ']
    const [line, ...rest] = slowMain(jobs)
    expect(line).toContain('MAIN_SLOW: CI run 7 on main still in_progress after 21 min.')
    expect(line).toContain('Only deploy jobs are still pending (pages, dev-release)')
    expect(line).not.toContain('Cancel')
    expect(rest).toEqual(jobs)
  })

  it('says to cancel while anything else is pending', () => {
    expect(slowMain(['  web-e2e: in_progress ', '  pages: queued '])[0]).toContain('Cancel it and read the logs.')
  })
})
