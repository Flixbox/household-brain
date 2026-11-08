import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite with coproc and xargs (#387)', () => {
  it('finds gh behind coproc', () => {
    expect(refused(['coproc gh issue close 1', 'coproc name { gh issue close 1; }', 'coproc { gh pr close 1; }'])).toEqual([])
    expect(allowed(['coproc gh pr view 1', 'coproc agent-gh issue close 1'])).toEqual([])
  })

  it('counts gh behind xargs as a write when its input may name the command', () => {
    expect(refused([
      'xargs gh <<< "issue close 1"',
      'cat list | xargs gh',
      'xargs gh < list',
      'xargs < list gh',
      'xargs -0 gh',
      'xargs -n 2 gh',
      'xargs -0rn 2 gh',
      'xargs -P4 -n1 gh',
      'xargs --max-args 2 gh',
      'xargs --max-args=2 gh',
      'xargs -- gh',
      '/usr/bin/xargs /usr/bin/gh',
      'timeout 5 xargs gh',
      'xargs gh -R o/r',
      'xargs gh issue',
      'xargs gh pr --repo o/r',
      'xargs gh api',
      'xargs -I{} gh {}',
      'xargs -I{} gh issue {} 1',
      'xargs -I % gh pr % 1',
      'xargs -I{} gh api {}',
    ])).toEqual([])
  })

  it('still finds writes written out behind xargs', () => {
    expect(refused(['xargs gh issue close', 'xargs -n1 gh pr merge --squash', 'xargs -I{} gh api repos/o/r/issues/{} -f state=closed'])).toEqual([])
  })

  it('lets reads written out behind xargs run', () => {
    expect(allowed([
      'cat list | xargs gh pr view',
      'xargs -n1 gh issue view --json title',
      'xargs -I{} gh pr view {}',
      'xargs -I{} gh api repos/o/r/issues/{}',
      'xargs -n1 gh api repos/o/r/issues',
      'xargs gh api "$ENDPOINT" --paginate',
      'xargs gh label list',
    ])).toEqual([])
  })

  it('lets xargs run anything that is no gh', () => {
    expect(allowed([
      'xargs agent-gh',
      'xargs agent-gh issue close',
      'xargs -n1 agent-gh api',
      'xargs grep gh',
      'xargs -n1 rg gh',
      'xargs -I gh echo gh',
      'xargs -a gh echo',
      'xargs --arg-file gh echo',
      'xargs',
    ])).toEqual([])
  })
})
