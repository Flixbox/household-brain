/** Select the current agent's allowance; Claude and Codex never share cached answers (#338). */
import { type Usage, readUsage, usageText, weekReset } from './claude-usage'
import { askCodex } from './codex-usage'
import { hasText } from './read'

export type Provider = 'claude' | 'codex'
type Environment = Record<string, string | undefined>

/** Explicit selection wins; Codex's thread marker takes precedence over inherited Claude markers. */
export const usageProvider = (env: Environment = process.env): Provider => {
  const selected = env.AGENT_USAGE_PROVIDER
  if (typeof selected === 'string' && selected !== '') {
    if (selected === 'claude' || selected === 'codex') {
      return selected
    }
    throw new Error('AGENT_USAGE_PROVIDER must be claude or codex')
  }
  return hasText(env.CODEX_THREAD_ID) ? 'codex' : 'claude'
}

export const codexCache = (env: Environment = process.env): string => {
  const home = env.HOME ?? env.USERPROFILE ?? '.'
  const state = env.XDG_STATE_HOME ?? `${home}/.local/state`
  const config = env.CODEX_HOME ?? `${home}/.codex`
  return env.CODEX_USAGE_CACHE ?? `${state}/codex-usage-${Bun.hash.crc32(config)}.json`
}

export interface AgentUsage extends Usage {
  provider: Provider
}

/** Both providers use the same debounce, lock, stale marker and backoff, with separate cache files. */
export const readAgentUsage = async (provider = usageProvider()): Promise<AgentUsage> => {
  const file = codexCache()
  const lockPort = Number(process.env.CODEX_USAGE_LOCK_PORT ?? 10_000 + (Bun.hash.crc32(file) % 10_000))
  const usage = provider === 'codex' ? await readUsage({ ask: askCodex, file, lockPort }) : await readUsage()
  return { ...usage, provider }
}

/** Name the provider on every line, including unknown or stale answers. */
export const agentUsageText = (usage: AgentUsage, at = Temporal.Now.instant().epochMilliseconds): string =>
  usageText(usage, at).replace('Usage:', `Usage (${usage.provider}):`)

if (import.meta.main) {
  try {
    const usage = await readAgentUsage()
    const lines = [agentUsageText(usage), ...(process.argv.includes('--reset') ? [weekReset(usage)] : [])]
    process.stdout.write(`${lines.join('\n')}\n`)
  } catch {
    process.stderr.write('AGENT_USAGE_PROVIDER must be claude or codex\n')
    process.exitCode = 1
  }
}
