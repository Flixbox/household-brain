/**
 * The command line (#256), the same commands as the MCP tools:
 *
 *   issue-links block <issue> <blocked-by>     mark <issue> as blocked by <blocked-by> (refused if it closes a cycle)
 *   issue-links unblock <issue> <blocked-by>   remove that link
 *   issue-links links <issue>                  what blocks <issue>, and what it blocks
 *
 * An issue is `12`, `#12` (in REPO, or the repository of the current folder) or `owner/repo#12`.
 * GH sets the `gh` to ask with. Exits 1 with the reason when GitHub or the deadlock check refuses,
 * 64 on a wrong command.
 */
import { commands } from './commands'

const USAGE = 'usage: issue-links block <issue> <blocked-by> | unblock <issue> <blocked-by> | links <issue>'

class UsageError extends Error {
  public override name = 'UsageError'
}

const run = async (args: string[]): Promise<string> => {
  const [command = '', first = '', second = ''] = args
  if ((command === 'block' || command === 'unblock') && args.length === 3) {
    return commands[command](first, second)
  }
  if (command === 'links' && args.length === 2) {
    return commands.links(first)
  }
  throw new UsageError(USAGE)
}

try {
  process.stdout.write(`${await run(process.argv.slice(2))}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'failed'}\n`)
  process.exitCode = error instanceof UsageError ? 64 : 1
}
