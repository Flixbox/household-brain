/*
 * The owner-write guard in Codex sessions (#370): Codex reads its plugin's hooks from
 * `.codex-plugin/plugin.json`, not from `hooks/hooks.json`, so the guard's PreToolUse entry has to be
 * there too, the same one. These tests run the manifest's command as Codex would, with the input
 * Codex sends for its shell tools (`exec_command`: `tool_name` "Bash", `tool_input.command` a string,
 * after `pre-tool-use.command.input` in Codex 0.166), and check its answer is one Codex accepts.
 * Whether Codex runs the hook for calls code mode makes (`tools.exec_command({cmd})`) is a live
 * check, #377.
 *
 * Only Claude Code has `onFailure` (#393): Codex 0.166's command handler has no such field, so there a
 * guard that times out or crashes still lets the call through.
 */
import { describe, expect, it } from 'bun:test'
import { isRecord, textOf } from './read'

const pluginRoot = `${import.meta.dir}/..`

const readJson = async (path: string): Promise<unknown> => JSON.parse(await Bun.file(`${pluginRoot}/${path}`).text())

/** A manifest's PreToolUse entries: `hooks.hooks.PreToolUse` in Codex's plugin.json, `hooks.PreToolUse` in hooks.json. */
const preToolUse = (hooks: unknown): unknown[] => {
  const entries = isRecord(hooks) ? hooks.PreToolUse : null
  return Array.isArray(entries) ? entries : []
}

const codexHooks = async () => {
  const manifest = await readJson('.codex-plugin/plugin.json')
  return preToolUse(isRecord(manifest) && isRecord(manifest.hooks) ? manifest.hooks.hooks : null)
}

const claudeHooks = async () => {
  const file = await readJson('hooks/hooks.json')
  return preToolUse(isRecord(file) ? file.hooks : null)
}

const handlersOf = (entry: unknown): unknown[] => (isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks : [])

/** A handler without `onFailure`, the one field only Claude Code reads. */
const withoutOnFailure = (handler: unknown) =>
  isRecord(handler) ? Object.fromEntries(Object.entries(handler).filter(([key]) => key !== 'onFailure')) : handler

/** Claude Code's entries with only what Codex reads too: the Codex manifest must match this exactly. */
const sharedEntries = (entries: readonly unknown[]) =>
  entries.map(entry => (isRecord(entry) ? { ...entry, hooks: handlersOf(entry).map(handler => withoutOnFailure(handler)) } : entry))

/** The commands Codex runs before a Bash call: those of every entry whose matcher matches "Bash". */
const bashCommands = (entries: readonly unknown[]) =>
  entries
    .filter(entry => isRecord(entry) && new RegExp(textOf(entry.matcher), 'u').test('Bash'))
    .flatMap(entry => handlersOf(entry))
    .map(hook => (isRecord(hook) && hook.type === 'command' ? textOf(hook.command) : ''))

/** What Codex sends a PreToolUse hook for a shell command. */
const codexInput = (command: string) => ({
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  model: 'gpt-test',
  permission_mode: 'default',
  session_id: 'session-370',
  tool_input: { command },
  tool_name: 'Bash',
  tool_use_id: 'call-370',
  transcript_path: null,
  turn_id: 'turn-370',
})

/** Runs a hook command as Codex does: through the shell, with the plugin's root in its environment. */
const runHook = (hookCommand: string, command: string) => {
  const run = Bun.spawnSync(['sh', '-c', hookCommand], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, PLUGIN_ROOT: pluginRoot },
    stdin: Buffer.from(JSON.stringify(codexInput(command))),
  })
  return { exitCode: run.exitCode, stdout: run.stdout.toString() }
}

describe('the owner-write guard as a Codex hook (#370)', () => {
  it('is registered in the Codex manifest as it is in hooks.json, matcher and command alike', async () => {
    const codex = await codexHooks()
    expect(codex).not.toEqual([])
    expect(codex).toEqual(sharedEntries(await claudeHooks()))
  })

  it('denies a write through plain gh with an answer Codex accepts', async () => {
    const commands = bashCommands(await codexHooks())
    expect(commands).not.toEqual([])
    for (const hookCommand of commands) {
      const { exitCode, stdout } = runHook(hookCommand, 'gh issue comment 999999 -b x')
      expect(exitCode).toBe(0)
      const answer: unknown = JSON.parse(stdout)
      // Codex's pre-tool-use.command.output allows no other keys, and refuses a deny without a reason.
      expect(isRecord(answer) ? Object.keys(answer) : null).toEqual(['hookSpecificOutput'])
      const output = isRecord(answer) && isRecord(answer.hookSpecificOutput) ? answer.hookSpecificOutput : {}
      expect(Object.keys(output).toSorted()).toEqual(['hookEventName', 'permissionDecision', 'permissionDecisionReason'])
      expect(output.hookEventName).toBe('PreToolUse')
      expect(output.permissionDecision).toBe('deny')
      expect(output.permissionDecisionReason).toContain('agent-gh')
    }
  })

  it('lets a read through plain gh run, answering nothing', async () => {
    const commands = bashCommands(await codexHooks())
    expect(commands).not.toEqual([])
    for (const hookCommand of commands) {
      expect(runHook(hookCommand, 'gh pr view 1')).toEqual({ exitCode: 0, stdout: '' })
    }
  })
})

describe('the owner-write guard failing in Claude Code (#393)', () => {
  it('blocks the call when the hook times out or crashes', async () => {
    const handlers = (await claudeHooks()).flatMap(entry => handlersOf(entry))
    const failureSettings = handlers.map(handler => (isRecord(handler) ? handler.onFailure : null))
    expect(failureSettings).toEqual(['block'])
  })
})
