/**
 * Turns a CI recording of the end-to-end tests into a pull request's GIF, showing the screens it
 * changed. CI films every test against the emulators with demo data, and uploads the videos per
 * device as `e2e-videos-<device>`. Never record the live app: it shows the household's real entries,
 * and pull requests are public.
 *
 *   bun packages/tooling/src/pr-gif.ts fetch <run-id> <device> <dir>            download the run's videos for a device
 *   bun packages/tooling/src/pr-gif.ts sheet <video.webm> <sheet.png>           a contact sheet to find the moments:
 *                                                                               SHEET_FPS frames a second (default 4),
 *                                                                               six a row, left to right, top to bottom
 *   bun packages/tooling/src/pr-gif.ts gif <video.webm> <from> <to> <out.gif>   cut seconds <from>..<to> into a GIF;
 *                                                                               SPEED=0.5 plays it at half speed
 *
 * Then publish it on the `assets` branch and embed it in the pull request (.ai/AGENTS.md says how).
 */
import { $ } from 'bun'
import { sheetRows } from './sheet'

const GH = process.env.GH ?? 'gh'
const MAX_BYTES = 10 * 1024 * 1024

const usage = (): never => {
  process.stderr.write('Usage: see the comment at the top of packages/tooling/src/pr-gif.ts\n')
  process.exit(2)
}

const fetchVideos = async ([run, device, dir]: string[]) => {
  await $`${GH} run download ${run ?? usage()} --repo Flixbox/household-brain --name ${`e2e-videos-${device ?? usage()}`} --dir ${dir ?? usage()}`
  process.stdout.write(`${(await $`find ${dir ?? usage()} -name '*.webm'`.text()).split('\n').filter(Boolean).toSorted().join('\n')}\n`)
}

const sheet = async ([video, out]: string[]) => {
  const fps = Number(process.env.SHEET_FPS ?? 4)
  const duration = Number(await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${video ?? usage()}`.text())
  await $`ffmpeg -loglevel error -y -i ${video ?? usage()} -vf ${`fps=${fps},scale=240:-1,tile=6x${sheetRows(duration, fps)}`} -frames:v 1 ${out ?? usage()}`
  process.stdout.write(`${out}: tile n is second n/${fps}\n`)
}

const gif = async ([video, from, to, out]: string[]) => {
  const speed = process.env.SPEED ?? '1'
  // One palette made from the clip itself keeps the colours right at a small size.
  const filter = `setpts=PTS/${speed},fps=10,scale='min(800,iw)':-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`
  await $`ffmpeg -loglevel error -y -ss ${from ?? usage()} -to ${to ?? usage()} -i ${video ?? usage()} -vf ${filter} -loop 0 ${out ?? usage()}`
  const { size } = Bun.file(out ?? usage())
  if (size > MAX_BYTES) {
    process.stderr.write(`::error::${out} is ${size} bytes; GitHub takes 10 MB at most. Cut a shorter stretch.\n`)
    process.exit(1)
  }
  process.stdout.write(`${out} (${size} bytes)\n`)
}

const commands: Record<string, { arity: number, run: (args: string[]) => Promise<void> }> = {
  fetch: { arity: 3, run: fetchVideos },
  gif: { arity: 4, run: gif },
  sheet: { arity: 2, run: sheet },
}
const [command = '', ...args] = process.argv.slice(2)
const chosen = commands[command]
await (chosen?.arity === args.length ? chosen.run(args) : usage())
