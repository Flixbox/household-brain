#!/usr/bin/env bun
// Runs shell inputs through real bash for reviews of the owner-write guard (#395), where nothing they
// do can reach GitHub, so a permission rule can name this command instead of allowing bash:
//
//   guard-bash-probe <file holding a JSON array of strings>
//
// It prints one JSON line per input, saying whether the stand-in `gh` ran. Each input gets its own
// namespaces (no network, its own processes and mounts), an empty environment but for a PATH led by
// the stand-in, a throwaway working directory and a time limit. Without the namespaces nothing runs.
//
// A network namespace alone wouldn't do: under WSL, a Windows gh.exe on /mnt/c or the interop socket
// in /run runs on the Windows side, which has the network. So those folders, the homes (the real gh,
// the tokens and keys) and the shared temporary folders are covered with empty ones.
import { spawnSync } from 'bun'

export interface ProbeResult {
  input: string
  ran: boolean
  status: number
  timedOut: boolean
}

export interface ProbeOptions {
  limitSeconds: number
  standIn: string
  unshare: string
}

// Run inside the namespaces, with the input, the stand-in's name and the limit as $1, $2 and $3. Only
// its last line of output is read, so the input's own output goes nowhere. Before the input runs,
// `set -e` ends it without that line if a folder can't be covered, which refuses the whole run.
// The stand-in records itself on an open descriptor of a file already deleted, so an input can't
// fake or erase that by file name. A status of 137 is a timeout only once the limit has passed: an
// input can kill itself too.
const insideNamespaces = String.raw`
set -eu
for folder in /home /root /mnt /media /run /tmp /var/tmp /dev/shm; do
  if [ -d "$folder" ]; then mount -t tmpfs tmpfs "$folder"; fi
done
mkdir /tmp/bin /tmp/work
exec 9>/tmp/ran 8</tmp/ran
rm /tmp/ran
printf '#!/bin/bash\necho ran >&9\necho RAN\n' >"/tmp/bin/$2"
chmod 755 "/tmp/bin/$2"
cd /tmp/work
status=0
timeout -s KILL "$3" env -i PATH=/tmp/bin:/usr/bin:/bin /bin/bash -c "$1" probe \
  </dev/null >/dev/null 2>&1 8<&- || status=$?
if [ -n "$(cat <&8)" ]; then ran=true; else ran=false; fi
if [ "$status" = 137 ] && [ "$SECONDS" -ge "$3" ]; then timedOut=true; else timedOut=false; fi
printf '%s %s %s\n' "$ran" "$status" "$timedOut"
`

const reportLine = /^(?<ran>true|false) (?<status>\d+) (?<timedOut>true|false)\n$/u

export const parseProbeInputs = (text: string): string[] => {
  const inputs: unknown = JSON.parse(text)
  if (!Array.isArray(inputs)) {
    throw new TypeError('expected a JSON array of strings')
  }
  return inputs.map((input: unknown) => {
    if (typeof input !== 'string' || input.includes('\0')) {
      throw new TypeError(`not a shell input: ${JSON.stringify(input)}`)
    }
    return input
  })
}

const runOne = (input: string, { limitSeconds, standIn, unshare }: ProbeOptions): ProbeResult => {
  const { stdout } = spawnSync({
    cmd: [
      unshare,
      '-rnm',
      '--pid',
      '--fork',
      '--kill-child',
      '--mount-proc',
      '/bin/bash',
      '-c',
      insideNamespaces,
      'guard-bash-probe',
      input,
      standIn,
      String(limitSeconds),
    ],
    cwd: '/',
    env: { PATH: '/usr/bin:/bin' },
    stderr: 'ignore',
    stdin: 'ignore',
    stdout: 'pipe',
  })
  const { ran = '', status = '', timedOut = '' } = reportLine.exec(stdout.toString())?.groups ?? {}
  if (ran === '') {
    throw new Error('could not set up the namespaces, so this input was not run')
  }
  return { input, ran: ran === 'true', status: Number(status), timedOut: timedOut === 'true' }
}

export const runProbes = (inputs: string[], options: ProbeOptions): ProbeResult[] =>
  inputs.map(input => runOne(input, options))

if (import.meta.main) {
  const [path] = process.argv.slice(2)
  if (typeof path === 'undefined') {
    throw new TypeError('usage: guard-bash-probe <file holding a JSON array of strings>')
  }
  const inputs = parseProbeInputs(await Bun.file(path).text())
  for (const result of runProbes(inputs, { limitSeconds: 5, standIn: 'gh', unshare: 'unshare' })) {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
}
