import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

/** A character whose first UTF-8 byte (0xE0) is what bash's `\\c` takes, written so no transpiler rewrites it in a raw string. */
const wide = '\u0801'

describe('ownerWrite on $\'…\' (#378)', () => {
  it('reads $\'…\' strings with their escapes, in substitutions and as here-document delimiters too (#378)', () => {
    expect(refused([
      String.raw`echo $'\''; gh issue close 1 #'`,
      "echo $'\\''\ngh issue close 1 #'",
      String.raw`echo $'\\'; gh issue close 1 #'`,
      String.raw`echo $'a\'b'; gh issue close 1 #'`,
      String.raw`x=$(echo $'\')'); gh issue close 1`,
      String.raw`echo "$(echo $'\')"')"; gh issue close 1 #"`,
      String.raw`echo $$'\'; gh issue close 1 #'`,
      String.raw`$'\x67h' issue close 1`,
      String.raw`$'\x{67}h' issue close 1`,
      String.raw`$'\x{0067}h' issue close 1`,
      String.raw`bash -c $'echo hi\ngh issue close 1'`,
      `$'gh\\c${wide}' issue close 1`,
      `gh issue $'close\\c${wide}' 1`,
      `cat <<$'EOF\\c${wide}'\nEOF\ngh issue close 1`,
      `cat <<$'E\\c${wide}'\n'\nE\ngh issue close 1\n'`,
      "cat <<$'EOF'\nEOF\ngh issue close 1",
      "cat <<$'E\\'F'\nE'F\ngh issue close 1",
      "cat <<$'\\x45OF'\nEOF\ngh issue close 1",
    ])).toEqual([])
    expect(allowed([
      String.raw`echo $'it\'s'; gh pr view 1`,
      `echo $'a\\c${wide}'; gh pr view 1`,
      String.raw`echo $'a\\'; gh pr view 1`,
      String.raw`git commit -m $'line\nline \'gh pr close 1\''`,
      "cat <<$'EOF'\ngh issue close 1\nEOF",
    ])).toEqual([])
  })
})
