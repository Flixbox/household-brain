import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite and here-document delimiters (#381)', () => {
  it('refuses a here-document delimiter it cannot read for certain, whatever follows it (#381)', () => {
    const delimiters = [
      "E'O'F", '"E"OF', String.raw`E\OF`, "E$'O'F", "'E'OF", String.raw`\E'O'F`, String.raw`"E\\"`, '$(x)', ['$', '{x y}'].join(''),
      String.raw`E\ F`, 'E\\\nOF', 'E<(x y)', 'E>(x y)', '--x', ' -x', 'E\rF', '#END',
      '"$(echo ")")"', '"a$b"', '"`echo "`"', '!!', 'E!F', '"!!"', "$'E'F", '$"E"',
    ]
    expect(refused(delimiters.map(delimiter => `cat <<${delimiter}\nEOF\ngh issue close 1`))).toEqual([])
    expect(refused(["cat <<E'O'F\n'\nEOF\ngh issue close 1\n'", "cat <<E'O'F\nonly data\nEOF"])).toEqual([])
  })

  it('still reads a here-document whose whole delimiter it has read as data (#381)', () => {
    expect(allowed([
      'cat <<EOF>out\ngh issue close 1\nEOF',
      'cat <<EOF;\ngh issue close 1\nEOF',
      '(cat <<EOF\ngh issue close 1\nEOF\n)',
      'cat <<END-OF\ngh issue close 1\nEND-OF',
      'cat <<\\EOF\ngh issue close 1\nEOF',
    ])).toEqual([])
  })
})
