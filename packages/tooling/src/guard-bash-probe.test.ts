import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { type ProbeOptions, parseProbeInputs, readProbeFile, runProbes } from './guard-bash-probe'
import { join } from 'node:path'
import { spawnSync } from 'bun'
import { tmpdir } from 'node:os'

const options: ProbeOptions = { limitSeconds: 2, standIn: 'probe-stand-in', setpriv: 'setpriv', unshare: 'unshare' }

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

describe('parse errors', () => {
  test.each(['fake_value_abc123', '["a",fake_value_abc123]', '{"fake_value_abc123":1}', '[1,"fake_value_abc123"]'])(
    'show nothing of the file: %s',
    text => {
      expect(() => parseProbeInputs(text)).toThrow(/^the file is not a JSON array of strings$/u)
    },
  )
})

describe('readProbeFile', () => {
  const folder = mkdtempSync(join(tmpdir(), 'guard-bash-probe-'))
  const root = join(folder, 'root')
  mkdirSync(root)
  const inside = join(root, 'inputs.json')
  writeFileSync(inside, '["true"]')
  const outside = join(folder, 'outside.json')
  writeFileSync(outside, '["true"]')
  const link = join(root, 'link.json')
  symlinkSync(outside, link)
  const large = join(root, 'large.json')
  writeFileSync(large, ' '.repeat(2_000_000))

  test('reads a small file under the root', () => {
    expect(readProbeFile(inside, root)).toBe('["true"]')
  })

  test.each([
    ['outside the root', outside],
    ['through the parent folder', join(root, '..', 'outside.json')],
    ['a symlink', link],
    ['too large', large],
    ['a folder', root],
    ['missing', join(root, 'missing.json')],
  ])('refuses a file that is %s', (_name, path) => {
    expect(() => readProbeFile(path, root)).toThrow(/^the input file must be a small regular file under /u)
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

  test.skipIf(!canIsolate)('takes the record of the stand-in, not a file an input can touch', () => {
    expect(probe('touch /tmp/ran').ran).toBe(false)
    expect(probe('probe-stand-in; rm -rf /tmp/ran').ran).toBe(true)
  })

  test.skipIf(!canIsolate)('does not take an input killing itself for a timeout', () => {
    expect(probe('kill -9 $$')).toMatchObject({ status: 137, timedOut: false })
  })

  test.skipIf(!canIsolate)('has no network, environment or home', () => {
    expect(probe('[ -z "$(tail -n +2 /proc/net/route)" ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ "$(env | grep -cv -e ^PATH= -e ^PWD= -e ^SHLVL= -e ^_=)" = 0 ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ -z "$(ls -A /home)$(ls -A /mnt)" ] && probe-stand-in').ran).toBe(true)
    expect(probe('[ -z "$(ls -A .)" ] && probe-stand-in').ran).toBe(true)
  })

  const refusedAndMasked = (command: string) => `if ${command}; then exit 99; fi; [ -z "$(ls -A /home)" ]`

  test.skipIf(!canIsolate)('leaves an input no capabilities', () => {
    expect(probe(String.raw`grep -q '^CapEff:[[:space:]]*0*$' /proc/self/status`).status).toBe(0)
  })

  test.skipIf(!canIsolate).each([
    'umount /home',
    'umount /proc',
    'umount /tmp',
    'umount -l /mnt',
    'mount -t tmpfs tmpfs /mnt',
    'mount -o remount,rw /home',
    'pivot_root /tmp /tmp/work',
    'unshare -rm umount /home',
    'unshare -Um umount /home',
  ])('keeps the covers against: %s', command => {
    expect(probe(refusedAndMasked(`${command} 2>/dev/null`)).status).toBe(0)
  })

  test.skipIf(!canIsolate)('refuses to run anything when capabilities cannot be dropped', () => {
    expect(() => runProbes(['true'], { ...options, setpriv: 'no-such-setpriv' })).toThrow()
  })

  test.skipIf(!canIsolate)('does not echo the input', () => {
    expect(Object.keys(probe('true'))).not.toContain('input')
  })

  test.skipIf(!canIsolate)('stops an input that stops its own time limit, from outside', () => {
    expect(probe('kill -STOP $PPID; sleep 30')).toMatchObject({ ran: null, status: null, timedOut: true })
  })

  test.skipIf(!canIsolate)('stops an input at the time limit', () => {
    expect(probe('sleep 30')).toMatchObject({ ran: false, timedOut: true })
  })
})
