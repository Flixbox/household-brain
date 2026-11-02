/** A thin Codex sink for the same events Claude receives from stdout (#340). */
import { hasText, ignoreFailure } from './read'
import { DeliveryOutbox } from './watch-outbox'
import { DIR } from './watch-state'
import { notifyCodex } from './codex-notify'
import { withCodexSocket } from './codex-socket'

const target = process.env.CODEX_WATCH_THREAD
const outbox = hasText(target) ? new DeliveryOutbox(`${DIR}/codex-delivery-${Bun.hash(target).toString(36)}.json`) : null
let draining = false

const drain = async (): Promise<void> => {
  if (!outbox || !hasText(target) || draining) { return }
  draining = true
  try {
    await outbox.drain(async event => withCodexSocket(async request => notifyCodex(request, { cwd: process.env.CODEX_WATCH_CWD ?? process.cwd(), threadId: target }, event)))
  } catch {
    process.stderr.write('project-watcher: Codex delivery failed; event retained for retry\n')
  } finally { draining = false }
}

/** Persist before stdout returns; successful host delivery alone acknowledges an event. */
export const deliver = (key: string, lines: readonly string[]): void => {
  outbox?.enqueue(key, lines.filter(line => line !== '---'))
  drain().catch(ignoreFailure)
}

if (outbox) {
  await drain()
  setInterval(() => { drain().catch(ignoreFailure) }, 15_000)
}
