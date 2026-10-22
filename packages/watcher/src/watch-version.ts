/**
 * Which version of its own code the watcher runs (#265). Bun reads every file when the watcher starts,
 * so a watcher started while its checkout was being pulled (two restarts pulling one clone at once)
 * keeps the old code for as long as it runs. It compares the code at start with the checkout's now.
 */
import { $ } from 'bun'

/**
 * The git tree of the watcher's package in its checkout's current commit; '' where that can't be read
 * (the plugin's copy is no git checkout). Only the package's own files count: a commit elsewhere in
 * the repository leaves the watcher's code as it was.
 */
export const codeVersion = async (): Promise<string> =>
  $`git -C ${import.meta.dir}/.. rev-parse HEAD:./`.quiet().nothrow()
    .then(result => (result.exitCode === 0 ? result.stdout.toString().trim() : ''), () => '')

/** The code this watcher started on: read by watch-project.ts before it loads the rest (#265). */
const startState = { on: '' }
export const readStartedOn = async (): Promise<void> => {
  startState.on = await codeVersion()
}
export const startedOn = (): string => startState.on

/**
 * The line that stops a watcher whose code changed in its checkout after it started; null otherwise,
 * also while the checkout can't be read. One that couldn't be read at the start counts as changed
 * once it can: the watcher may have started on any code.
 */
export const outdatedLine = (started: string, now: string): string | null =>
  now === '' || started === now
    ? null
    : 'WATCHER_OUTDATED: its code changed in its checkout after it started, so it stops: start it again to run the new code'
