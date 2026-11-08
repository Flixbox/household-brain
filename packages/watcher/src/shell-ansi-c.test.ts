import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

/** A character whose first UTF-8 byte (0xE0) is what bash's `\\c` takes, written so no transpiler rewrites it in a raw string. */
const wide = '\u0801'

/** The private-use character the reader marks an expansion with (#390), as a word can really hold it. */
const mark = '\u{E000}'

/** What the reader writes for that character: a here-document delimiter holding either must not end at the other (clearing review of #475). */
const standIn = '\uFFFD'

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
      "cat <<$'\\xC3\\xA9'\né\ngh issue close 1",
      "cat <<$'\\303\\251'\né\ngh issue close 1",
      "cat <<$'E\\xC3\\xA9'\nEé\ngh issue close 1",
      `cat <<$'\\xE0\\xA0\\x81'\n${wide}\ngh issue close 1`,
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

  it('takes the reader\'s own mark as plain text where a word really holds it (#390)', () => {
    expect(allowed([
      `gh pr ${mark} 1`,
      `gh pr $'${mark}' 1`,
      String.raw`gh pr $'\uE000' 1`,
      String.raw`gh pr $'\U0000E000' 1`,
      `gh issue close${mark} 1`,
      `${mark} pr close 1`,
    ])).toEqual([])
  })

  it('still counts what the shell fills in beside a literal mark, and marks read again from a script (#390)', () => {
    expect(refused([
      `gh pr ${mark}$x 1`,
      `gh issue close 1 ${mark}`,
      `bash -c $'gh\\c${wide} issue close 1'`,
      `eval $'gh\\c${wide}' issue close 1`,
      `cat <<${mark}\n${standIn}\nit's\n${mark}\ngh issue close 1\n'`,
      `cat <<'${mark}'\n${standIn}\nit's\n${mark}\ngh issue close 1\n'`,
      `cat <<${standIn}\n${mark}\nit's\n${standIn}\ngh issue close 1\n'`,
      String.raw`bash -c $'cat <<\uE000\n\uFFFD\nit\'s\n\uE000\ngh issue close 1\n\''`,
    ])).toEqual([])
  })
})
