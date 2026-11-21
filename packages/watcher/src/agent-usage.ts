/** Select the current agent's allowance; Claude, Codex and Antigravity never share cached answers (#338, #594). */
import { askAntigravity } from './antigravity-usage'
import { type Usage, readUsage, usageLockPort, usageText, weekReset } from './claude-usage'
import { askCodex } from './codex-usage'
import { hasText } from './read'

export type Provider = 'antigravity' | 'claude' | 'codex'
type Environment = Record<string, string | undefined>

const PROVIDER_ERROR = 'AGENT_USAGE_PROVIDER must be claude, codex or antigravity'

/** Explicit selection wins; Codex takes precedence over Antigravity, which takes precedence over inherited Claude markers. */
export const usageProvider = (env: Environment = process.env): Provider => {
  const selected = env.AGENT_USAGE_PROVIDER
  if (typeof selected === 'string' && selected !== '') {
    if (selected === 'claude' || selected === 'codex' || selected === 'antigravity') {
      return selected
    }
    throw new Error(PROVIDER_ERROR)
  }
  if (hasText(env.CODEX_THREAD_ID)) {
    return 'codex'
  }
  if (hasText(env.ANTIGRAVITY_CONVERSATION_ID) || hasText(env.ANTIGRAVITY_AGENT)) {
    return 'antigravity'
  }
  return 'claude'
}

const stateDir = (env: Environment): { home: string, state: string } => {
  const home = env.HOME ?? env.USERPROFILE ?? '.'
  return { home, state: env.XDG_STATE_HOME ?? `${home}/.local/state` }
}

export const codexCache = (env: Environment = process.env): string => {
  const { home, state } = stateDir(env)
  const config = env.CODEX_HOME ?? `${home}/.codex`
  return env.CODEX_USAGE_CACHE ?? `${state}/codex-usage-${Bun.hash.crc32(config)}.json`
}

export const antigravityCache = (env: Environment = process.env): string => {
  const { home, state } = stateDir(env)
  const config = env.ANTIGRAVITY_APP_DATA_DIR ?? `${home}/.gemini/antigravity-cli`
  return env.ANTIGRAVITY_USAGE_CACHE ?? `${state}/antigravity-usage-${Bun.hash.crc32(config)}.json`
}

export interface AgentUsage extends Usage {
  provider: Provider
}

/** All providers use the same debounce, lock, stale marker and backoff, with separate cache files. */
export const readAgentUsage = async (provider = usageProvider()): Promise<AgentUsage> => {
  if (provider === 'codex') {
    const file = codexCache()
    return { ...await readUsage({ ask: askCodex, file, lockPort: usageLockPort('CODEX_USAGE_LOCK_PORT', file) }), provider }
  }
  if (provider === 'antigravity') {
    const file = antigravityCache()
    return { ...await readUsage({ ask: askAntigravity, file, lockPort: usageLockPort('ANTIGRAVITY_USAGE_LOCK_PORT', file) }), provider }
  }
  return { ...await readUsage(), provider }
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
    process.stderr.write(`${PROVIDER_ERROR}\n`)
    process.exitCode = 1
  }
}
