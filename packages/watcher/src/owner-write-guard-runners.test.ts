import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite, behind runners (#398)', () => {
  it('reads the command a runner starts', () => {
    expect(refused([
      'flock x gh issue close 1',
      'chroot / gh issue close 1',
      'unshare -r gh issue close 1',
      'setpriv --reuid 1 gh issue close 1',
      'chrt -o 0 gh issue close 1',
      'taskset 1 gh issue close 1',
      'script -q /dev/null gh issue close 1',
    ])).toEqual([])
  })

  it('reads the script a runner takes after -c', () => {
    expect(refused([
      "flock x -c 'gh issue close 1'",
      "script -c 'gh issue close 1' /dev/null",
      "script -qc 'gh issue close 1' /dev/null",
    ])).toEqual([])
  })

  it('counts a shell behind a runner as reading its here-document', () => {
    expect(refused([
      "flock x bash <<'EOF'\ngh issue close 1\nEOF",
      "taskset 1 sh <<< 'gh issue close 1'",
    ])).toEqual([])
  })

  it('leaves reads and agent-gh behind a runner alone', () => {
    expect(allowed([
      'flock x gh pr view 1',
      'flock x agent-gh issue close 1',
      "flock x -c 'gh pr list'",
      "flock x -c 'agent-gh issue close 1'",
      'taskset 1 gh api repos/o/r',
      "script -qc 'gh issue list' /dev/null",
    ])).toEqual([])
  })
})
