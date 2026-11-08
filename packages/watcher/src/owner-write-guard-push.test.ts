import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verdict } from './owner-write-guard'

const key = 'credential.https://github.com.helper'
const bot = '!f() { echo "password=$(agent-gh-token)"; }; f'
const owner = '!gh auth git-credential'

const root = mkdtempSync(join(tmpdir(), 'push-guard-'))
afterAll(() => rmSync(root, { force: true, recursive: true }))

let clones = 0

/** A throwaway clone whose local config lists these helpers, in this order. */
const clone = (helpers: readonly string[]) => {
  clones += 1
  const dir = join(root, `clone-${clones}`)
  Bun.spawnSync(['git', 'init', '-q', dir])
  for (const helper of helpers) {
    Bun.spawnSync(['git', '-C', dir, 'config', '--add', key, helper])
  }
  return dir
}

const call = (command: string, cwd: string) => ({ cwd, tool_input: { command }, tool_name: 'Bash' })
const denied = (command: string, cwd: string) => verdict(call(command, cwd))?.hookSpecificOutput.permissionDecision === 'deny'

describe('a git push under the wrong credential helper (#455)', () => {
  const right = clone(['', bot])
  const wrong = clone(['', owner, bot])

  it('refuses a push when the owner\'s helper comes before the bot\'s', () => {
    expect(denied('git push origin HEAD', wrong)).toBe(true)
    expect(denied('git push origin HEAD', clone([owner, bot]))).toBe(true)
  })

  it('refuses a push when a reset after the bot\'s helper leaves no helper', () => {
    expect(denied('git push origin HEAD', clone([bot, '']))).toBe(true)
  })

  it('names the issue and tells the agent not to fix the shared config itself', () => {
    const reason = verdict(call('git push', wrong))?.hookSpecificOutput.permissionDecisionReason ?? ''
    expect(reason).toContain('#455')
    expect(reason).toContain('--get-all')
  })

  it('finds the push however it is run', () => {
    const commands = [
      'git push',
      `git -C ${wrong} push`,
      `cd ${wrong} && git push --force-with-lease`,
      'timeout 60 git push',
      'bash -c "git push"',
      '/usr/bin/git push',
      'git -c core.quotepath=off push',
    ]
    expect(commands.filter(command => !denied(command, wrong))).toEqual([])
  })

  it('reads the clone the push runs in, not the hook\'s folder', () => {
    expect(denied(`git -C ${wrong} push`, right)).toBe(true)
    expect(denied(`cd ${wrong} && git push`, right)).toBe(true)
    expect(denied(`git -C ${right} push`, wrong)).toBe(false)
    expect(denied(`cd ${right} && git push`, wrong)).toBe(false)
  })

  it('lets a push through when the bot\'s helper comes first', () => {
    expect(denied('git push origin HEAD', right)).toBe(false)
  })

  it('leaves clones without the bot\'s helper alone', () => {
    expect(denied('git push', clone(['', owner]))).toBe(false)
    expect(denied('git push', clone([]))).toBe(false)
    expect(denied('git push', join(root, 'not-a-repository'))).toBe(false)
  })

  it('leaves other git commands alone', () => {
    expect(denied('git status', wrong)).toBe(false)
    expect(denied('git log --grep push', wrong)).toBe(false)
    expect(denied('git -C push status', wrong)).toBe(false)
  })
})
