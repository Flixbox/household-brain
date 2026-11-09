/* oxlint-disable import/no-nodejs-modules -- a temporary project and Bun for the monitor to start; node:fs and node:os are built into Bun */
// Claude Code turns a plugin monitor's stdout into notifications, so a watcher that refuses a bad
// setting on stderr has to reach stdout too, as the manual Monitor command's 2>&1 does (#527).
import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) { rmSync(dir, { force: true, recursive: true }) } })

describe('monitor.sh (#527)', () => {
  it("passes the watcher's error on to stdout", () => {
    const dir = mkdtempSync(`${tmpdir()}/monitor-`)
    dirs.push(dir)
    mkdirSync(`${dir}/.claude`)
    mkdirSync(`${dir}/bin`)
    writeFileSync(`${dir}/.claude/watcher.env`, '')
    writeFileSync(`${dir}/bin/bun`, '#!/bin/sh\necho "GH_PARALLEL must be a whole number from 1" >&2\nexit 64\n')
    chmodSync(`${dir}/bin/bun`, 0o755)
    const result = Bun.spawnSync(['sh', `${import.meta.dir}/../monitor.sh`], { cwd: dir, env: { ...process.env, BUN_INSTALL: dir } })
    expect(result.exitCode).toBe(64)
    expect(result.stdout.toString()).toContain('GH_PARALLEL must be a whole number from 1')
  })
})
