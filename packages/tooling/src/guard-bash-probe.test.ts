import { describe, expect, test } from 'bun:test'
import { type ProbeOptions, parseProbeInputs, runProbes } from './guard-bash-probe'
import { spawnSync } from 'bun'

const options: ProbeOptions = { limitSeconds: 2, standIn: 'probe-stand-in', unshare: 'unshare' }

// GitHub's Ubuntu runners forbid unprivileged user namespaces, so what needs a real namespace is
// checked where one can be made; the refusal without one is checked everywhere.
const canIsolate = (() => {
  try {
    return spawnSync(['unshare', '-rnm', '--pid', '--fork', '--kill-child', '--mount-proc', 'true']).success
  } catch {
    return false
  }
})()

const probe = (input: string) => {
  const [result] = runProbes([input], options)
  if (!result) {
    throw new Error('no result')
  }
  return result
}

describe('parseProbeInputs', () => {
  test('takes a JSON array of strings', () => {
    expect(parseProbeInputs('["echo hello","true"]')).toEqual(['echo hello', 'true'])
  })

  test.each(['{}', '"echo hello"', '[1]', '["a","b",null]', String.raw`["a\u0000b"]`, 'not json'])('refuses %s', text => {
    expect(() => parseProbeInputs(text)).toThrow()
  })
})

describe('runProbes', () => {
  test('refuses to run anything when no namespace can be made', () => {
    expect(() => runProbes(['echo hello'], { ...options, unshare: 'no-such-unshare' })).toThrow()
  })

  test.skipIf(!canIsolate)('reports whether the stand-in ran', () => {
    expect(probe('echo hello')).toMatchObject({ ran: false, status: 0, timedOut: false })
    expect(probe('probe-stand-in >/dev/null')).toMatchObject({ ran: true, status: 0, timedOut: false })
    expect(probe('exit 7')).toMatchObject({ ran: false, status: 7 })
  })

  test.skipIf(!canIsolate)('has no network, environment or home', () => {
    expect(probe('[ -z "$(tail -n +2 /proc/net/route)" ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ "$(env | grep -cv -e ^PATH= -e ^PWD= -e ^SHLVL= -e ^_=)" = 0 ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ -z "$(ls -A /home)$(ls -A /mnt)" ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ -z "$(ls -A .)" ] && probe-stand-in').ran).toBe(true)
  })

  test.skipIf(!canIsolate)('stops an input at the time limit', () => {
    expect(probe('sleep 30')).toMatchObject({ ran: false, timedOut: true })
  })
})
