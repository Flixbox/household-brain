/* oxlint-disable import/no-nodejs-modules -- throwaway git repositories in a temporary folder; node:fs and node:os are built into Bun */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { verdict } from './owner-write-guard'

const key = 'credential.https://github.com.helper'
const bot = '!f() { echo "password=$(agent-gh-token)"; }; f'
const owner = '!gh auth git-credential'

const root = mkdtempSync(`${tmpdir()}/push-guard-`)
afterAll(() => rmSync(root, { force: true, recursive: true }))

let clones = 0

/** A throwaway clone whose local config lists these helpers, in this order. */
const clone = (helpers: readonly string[]) => {
  clones += 1
  const dir = `${root}/clone-${clones}`
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
    expect(denied(`env cd ${wrong} && timeout 60 git push`, right)).toBe(true)
    expect(denied(`git -C ${right} push`, wrong)).toBe(false)
    expect(denied(`cd ${right} && git push`, wrong)).toBe(false)
  })

  it('lets a push through when the bot\'s helper comes first', () => {
    expect(denied('git push origin HEAD', right)).toBe(false)
  })

  it('leaves clones without the bot\'s helper alone', () => {
    expect(denied('git push', clone(['', owner]))).toBe(false)
    expect(denied('git push', clone([]))).toBe(false)
    expect(denied('git push', `${root}/not-a-repository`)).toBe(false)
  })

  it('leaves other git commands alone', () => {
    expect(denied('git status', wrong)).toBe(false)
    expect(denied('git log --grep push', wrong)).toBe(false)
    expect(denied('git -C push status', wrong)).toBe(false)
  })
})

describe('a git push under the wrong credential helper, by where it goes (#467)', () => {
  const github = 'https://github.com/owner-test/repo.git'
  const ssh = 'git@host.test:owner-test/repo.git'

  const config = (dir: string, name: string, value: string) => Bun.spawnSync(['git', '-C', dir, 'config', '--add', name, value])

  /** A clone with its helpers in the wrong order and these settings. */
  const wrongWith = (...settings: readonly (readonly [string, string])[]) => {
    const dir = clone(['', owner, bot])
    for (const [name, value] of settings) {
      config(dir, name, value)
    }
    return dir
  }

  const origin = (url: string) => wrongWith(['remote.origin.url', url])

  it('lets through a push to a remote that never asks the HTTPS helpers', () => {
    const urls = [ssh, 'ssh://git@host.test/owner-test/repo.git', `${root}/bare.git`, '../bare.git', 'https://host.test/owner-test/repo.git']
    expect(urls.filter(url => denied('git push origin HEAD', origin(url)))).toEqual([])
  })

  it('still refuses a push to GitHub over HTTPS', () => {
    const urls = [github, 'https://GitHub.com/owner-test/repo', 'https://someone@github.com/owner-test/repo', 'https://github.com:443/owner-test/repo']
    expect(urls.filter(url => !denied('git push origin HEAD', origin(url)))).toEqual([])
  })

  it('goes by the push URL, and refuses when any of several reaches GitHub', () => {
    expect(denied('git push origin HEAD', wrongWith(['remote.origin.url', github], ['remote.origin.pushurl', ssh]))).toBe(false)
    expect(denied('git push origin HEAD', wrongWith(['remote.origin.url', ssh], ['remote.origin.pushurl', github]))).toBe(true)
    expect(denied('git push origin HEAD', wrongWith(['remote.origin.url', ssh], ['remote.origin.pushurl', ssh], ['remote.origin.pushurl', github]))).toBe(true)
  })

  it('reads a URL or path given on the command line', () => {
    const toGithub = origin(ssh)
    const toSsh = origin(github)
    expect(denied(`git push ${github} HEAD`, toGithub)).toBe(true)
    expect(denied(`git push --repo=${github}`, toGithub)).toBe(true)
    expect(denied(`git push --repo ${github}`, toGithub)).toBe(true)
    expect(denied(`git push ${ssh} HEAD`, toSsh)).toBe(false)
    expect(denied(`git push ${root}/bare.git HEAD`, toSsh)).toBe(false)
    expect(denied(`git push --repo=${ssh}`, toSsh)).toBe(false)
  })

  it('does not take an option\'s value for the destination', () => {
    expect(denied(`git push -o ${ssh} ${github} HEAD`, origin(ssh))).toBe(true)
    expect(denied(`git push --push-option ${ssh} ${github} HEAD`, origin(ssh))).toBe(true)
    expect(denied(`git push -u --force-with-lease -- ${ssh} HEAD`, origin(github))).toBe(false)
  })

  it('follows git\'s choice of remote for a plain push', () => {
    const bothRemotes = [['remote.origin.url', github], ['remote.away.url', ssh]] as const
    expect(denied('git push', wrongWith(...bothRemotes))).toBe(true)
    expect(denied('git push', wrongWith(...bothRemotes, ['remote.pushDefault', 'away']))).toBe(false)
    expect(denied('git push', wrongWith(['remote.origin.url', ssh]))).toBe(false)
    expect(denied('git push', wrongWith(['remote.origin.url', ssh], ['remote.away.url', github], ['remote.pushDefault', 'away']))).toBe(true)
  })

  it('applies URL rewrites', () => {
    const rewritten = ['url.https://github.com/.insteadOf', 'gh:'] as const
    expect(denied('git push gh:owner-test/repo HEAD', wrongWith(rewritten))).toBe(true)
    expect(denied('git push origin HEAD', wrongWith(rewritten, ['remote.origin.url', 'gh:owner-test/repo']))).toBe(true)
    expect(denied('git push origin HEAD', wrongWith(['url.https://github.com/.pushInsteadOf', 'git@host.test:'], ['remote.origin.url', ssh]))).toBe(true)
  })

  it('applies a push-only rewrite only to the URLs it matches', () => {
    const rewrite = ['url.https://github.com/.pushInsteadOf', 'ph:'] as const
    expect(denied('git push ph:owner-test/repo HEAD', wrongWith(rewrite))).toBe(true)
    expect(denied(`git push ${ssh} HEAD`, wrongWith(rewrite))).toBe(false)
  })

  it('reads the destination past a git option that cannot change it', () => {
    expect(denied('git --no-pager push origin HEAD', origin(ssh))).toBe(false)
    expect(denied('git --no-pager push origin HEAD', origin(github))).toBe(true)
  })

  it('keeps refusing when the destination is unclear', () => {
    const toSsh = origin(ssh)
    const commands = [
      'git push "$REMOTE" HEAD',
      'git push --repo "$REMOTE"',
      'git push nowhere HEAD',
      `git -c remote.origin.pushurl=${github} push origin HEAD`,
      'cd "$SOMEWHERE" && git push origin HEAD',
      'git -C "$SOMEWHERE" push origin HEAD',
      'git push ext::some-command HEAD',
    ]
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('never takes a redirection for the destination', () => {
    const commands = [
      'git push 2>/dev/null',
      'git push >/tmp/x 2>&1',
      'git push --quiet 2>/dev/null',
      'git push --force-with-lease 2>/dev/null',
      'git push </dev/null',
      'git push &>/tmp/log',
      'git push {out}>/tmp/x',
      'bash -c "git push 2>/dev/null"',
    ]
    const toGithub = origin(github)
    expect(commands.filter(command => !denied(command, toGithub))).toEqual([])
    expect(denied('git push 2>/dev/null origin HEAD', origin(ssh))).toBe(false)
  })

  it('counts a trailing dot on GitHub\'s host as GitHub', () => {
    expect(denied('git push origin HEAD', origin('https://github.com./owner-test/repo'))).toBe(true)
    expect(denied('git push https://github.com./owner-test/repo HEAD', origin(ssh))).toBe(true)
  })

  it('keeps refusing what git reads from the environment or xargs fills in', () => {
    const commands = [
      `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.pushurl GIT_CONFIG_VALUE_0=${github} git push origin HEAD`,
      'GIT_DIR=/x git push origin HEAD',
      'export GIT_DIR=/x; git push origin HEAD',
      'env GIT_DIR=/x git push origin HEAD',
      `echo ${github} | xargs git push`,
    ]
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('keeps refusing past quotes spliced into a variable or xargs', () => {
    const commands = [
      'env G"IT_DIR"=/x git push origin HEAD',
      String.raw`env GIT\_DIR=/x git push origin HEAD`,
      `echo ${github} | x"args" git push`,
      String.raw`echo ${github} | xa\rgs git push`,
    ]
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('keeps refusing when something on the line can change the shell\'s state unseen', () => {
    const commands = ['source e.sh; git push origin HEAD', '. e.sh; git push origin HEAD', 'pushd /other && git push origin HEAD', 'popd; git push origin HEAD']
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('keeps refusing when env moves to another directory (#492)', () => {
    const commands = [
      'env -C /other git push origin HEAD',
      'env -C/other git push origin HEAD',
      'env -iC /other git push origin HEAD',
      'env -u FOO -C /other git push origin HEAD',
      'env --chdir=/other git push origin HEAD',
      'env --chdir /other git push origin HEAD',
      'env --ch=/other git push origin HEAD',
      '/usr/bin/env -C /other git push origin HEAD',
      'env "-C" /other git push origin HEAD',
    ]
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('keeps refusing when a git variable is named without an assignment (#492)', () => {
    const commands = [
      'for GIT_DIR in /x; do export GIT_DIR; git push origin HEAD; done',
      'for G"IT_DIR" in /x; do export GIT_DIR; git push origin HEAD; done',
      'read GIT_DIR; export GIT_DIR; git push origin HEAD',
      'read -r GIT_DIR < f; export GIT_DIR; git push origin HEAD',
      'printf -v GIT_DIR /x; export GIT_DIR; git push origin HEAD',
    ]
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('keeps refusing a word in ANSI-C quotes (#492)', () => {
    const commands = [
      String.raw`env $'G\x49T_DIR=/x' git push origin HEAD`,
      String.raw`$'\x65nv' GIT_DIR=/x git push origin HEAD`,
    ]
    const toSsh = origin(ssh)
    expect(commands.filter(command => !denied(command, toSsh))).toEqual([])
  })

  it('still passes an ordinary push to another host past env or a git variable it only reads (#492)', () => {
    const commands = [
      'env FOO=1 git push origin HEAD',
      'env -i git push origin HEAD',
      'env -u FOO git push origin HEAD',
      'echo $GIT_DIR; git push origin HEAD',
    ]
    const toSsh = origin(ssh)
    commands.push(`env FOO=1 git -C ${toSsh} push origin HEAD`)
    expect(commands.filter(command => denied(command, toSsh))).toEqual([])
  })

  it('counts GitHub\'s subdomains as GitHub, but not a host that only looks like it', () => {
    expect(denied('git push origin HEAD', origin('https://www.github.com/owner-test/repo'))).toBe(true)
    expect(denied('git push origin HEAD', origin('https://www.github.com./owner-test/repo'))).toBe(true)
    expect(denied('git push origin HEAD', origin('https://notgithub.com/owner-test/repo'))).toBe(false)
  })

  it('does not take a lone option for the destination', () => {
    expect(denied('git push --quiet', origin(ssh))).toBe(false)
    expect(denied('git push -u', origin(ssh))).toBe(false)
  })

  it('does not count a branch the shell fills in as unclear', () => {
    expect(denied('git push origin "$BRANCH"', origin(ssh))).toBe(false)
  })

  it('never refuses a clone whose order is right, wherever the push goes', () => {
    expect(denied(`git push ${github} HEAD`, clone(['', bot]))).toBe(false)
  })
})
