/* oxlint-disable no-template-curly-in-string -- the inputs are shell command lines, where ${…} is the shell's */
import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite and ${…} it cannot follow (#380)', () => {
  it('is not fooled by quotes inside a parameter expansion (#380)', () => {
    expect(refused([
      'echo "${x:-\'"\'}"; gh issue close 1 #"',
      'echo "${x:-$(echo })\'"\'}"; gh issue close 1 #"',
      'echo "${x:-${y}\'"\'}"; gh issue close 1 #"',
      'echo "${x:-$[ } ]\'"\'}"; gh issue close 1 #"',
      'echo "${x:-" # "}"; gh issue close 1',
      'echo "$\\\n{x:-\'"\'}"; gh issue close 1 #"',
      'echo "${x:-\'"\'}"; bash -c "gh issue close 1" #"',
      'echo "${x:-\'"\'}"; g\'\'h issue close 1 #"',
      'echo "${x:-\'"\'}"; $CMD #"',
      'echo $(echo "${x:-\'"\'}"; gh issue close 1 #")',
      'gh api "${path:-\'x\'}" -X POST',
      'echo "${x:-\'"\'}"; #x\\\ngh issue close 1',
      'echo "${x:-\'"\'}"; echo a\\\\\ngh issue close 1',
      'echo "${x:-\'"\'}"; #x\\\n$CMD',
      'echo "${x:-\'"\'}"; echo a\\\\\n$CMD',
      'echo "${x:-\'"\'}"; #x\\\ng\\\nh issue close 1',
      'echo "${x:-\'"\'}"; echo a\\\\\ng\\\nh issue close 1',
    ])).toEqual([])
  })

  it.each([
    ['eval', 7, (inner: string) => `eval \${x:-$(${inner})}`],
    ['bash -c', 7, (inner: string) => `bash -c \${x:-$(${inner})}'`],
    ['${…$(', 400, (inner: string) => `\${x:-$(${inner})}`],
  ] as const)('bounds the work of nesting through %s, as a hook that times out denies nothing (#380)', (_name, depth, around) => {
    const line = Array.from({ length: depth }).reduce<string>(inner => around(inner), "'")
    const start = performance.now()
    ownerWrite(line)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('reads deeply nested expansions in time, as a hook that times out denies nothing (#380)', () => {
    const nested = (depth: number): string => (depth === 0 ? "'" : `\${x:-$(${nested(depth - 1)})}`)
    const start = performance.now()
    expect(ownerWrite(`echo ${nested(20)}; gh pr list`)).not.toBeNull()
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('counts a line that spends the whole budget as a write (#380)', () => {
    const line = Array.from({ length: 40 }).reduce<string>(inner => `eval \${x:-$(${inner})}`, "'")
    expect(ownerWrite(line)).not.toBeNull()
  })

  it('leaves a parameter expansion that hides nothing alone (#380)', () => {
    expect(allowed([
      'echo "${x:-\'a\'}"',
      'agent-gh issue close "${n:-"1"}"',
      'echo "${x:-1}"; gh pr list',
      'gh pr view "${n}"',
    ])).toEqual([])
  })
})
