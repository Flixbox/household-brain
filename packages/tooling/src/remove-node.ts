/**
 * Removes every Node on the PATH, so nothing in CI can quietly fall back to it (#140). Runner images
 * and the Playwright image both ship one. `bun run` gives scripts that still call `node` a `node` that
 * is Bun itself (bunfig.toml: run.bun), so they keep working, on Bun.
 *
 *   bun packages/tooling/src/remove-node.ts
 */
import { $ } from 'bun'
import { hasText } from '@household-brain/core/lib/read'

// Root in the Playwright container, a sudoer on the runners.
const remove = async (path: string) => (process.getuid?.() === 0 ? $`rm -f ${path}` : $`sudo rm -f ${path}`)

const removeAll = async (): Promise<void> => {
  const node = Bun.which('node')
  if (!hasText(node)) {
    return
  }
  const real = (await $`readlink -f ${node}`.text()).trim()
  await remove(real)
  await remove(node)
  if (Bun.which('node') === node) {
    throw new Error(`Couldn't remove ${node}`)
  }
  await removeAll()
}

await removeAll()
process.stdout.write('Node removed\n')
