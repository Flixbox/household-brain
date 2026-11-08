/* oxlint-disable no-template-curly-in-string -- these strings are shell text, where `${…}` is what is tested */
import { describe, expect, it } from 'bun:test'
import { ownerWrite } from './owner-write-guard'

const refused = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) === null)
const allowed = (commands: readonly string[]) => commands.filter(command => ownerWrite(command) !== null)

describe('ownerWrite and a << that may be a shift (#385)', () => {
  it('refuses a << inside a subscript, $[…] or ${…}, where it may be a shift (#385)', () => {
    const shifts = [
      'a[1<<2]=3', 'a[1 << 2]=3', 'a[(1<<2)]=3', 'a[b[1]<<2]=3', 'a[\n1<<2]=3', 'a[1<<2]+=3', 'x=1 a[1<<2]=3',
      'echo $[1<<2]', 'echo $[1 << 2]', 'echo $[\n1<<2]', 'echo $[1;2<<3]',
      'a=([1<<2]=3)', 'a=([1 << 2]=3)',
      'echo ${a[1<<2]}', 'echo ${a[1 << 2]}', 'echo ${x:1<<2}', 'echo ${x:1 << 2}', 'echo ${x:]<<2}', 'echo ${x:{}<<2}',
      'a[${x:]}<<2]=3', 'echo $\\\n{x:1<<2}',
    ]
    expect(refused(shifts.map(shift => `${shift}\ngh issue close 1`))).toEqual([])
    expect(refused(["cat [<<EOF\n'\nEOF\ngh issue close 1\n'", "cat [<<EOF\n'\nEOF\ngh issue close 1''", 'echo a[ <<EOF\nonly data\nEOF'])).toEqual([])
  })

  it('refuses what a subscript, $[…] or ${…} takes as text and the reader would skip (clearing review of #391)', () => {
    const shifts = [
      'a[ #[\n]<<2]=3', 'echo $[ #[\n]<<2]',
      'a[ (([))]<<2]=3', 'echo $[ (([))]<<2]', 'echo ${x:- ((${y))}<<2}',
      'echo "$[1"<<"2]"', 'echo "${x:"1<<2"}"', 'echo "$\\\n[1"<<"2]"',
      'echo "${x:-${y}:"<<"}"', 'echo "$[${x]}"<<"]"', 'echo "${x:-$[}]"<<"}"', 'echo "${x:-$(echo })"<<"}"',
      'echo "${x:-\'}\' "<<EOF\n"foo"}"; EOF',
    ]
    expect(refused(shifts.map(shift => `${shift}\ngh issue close 1`))).toEqual([])
  })

  it('still reads closed expansions in double quotes, and comments and (( outside any enclosure (clearing review of #391)', () => {
    expect(allowed([
      'echo "${a[0]}" "$[1]" "${x}y"; cat <<EOF\ngh issue close 1\nEOF',
      '[ -f x ] # a note\ncat <<EOF\ngh issue close 1\nEOF',
      '[ -f x ] && ((1)); cat <<EOF\ngh issue close 1\nEOF',
    ])).toEqual([])
  })

  it('still reads a here-document after brackets and braces that have closed (#385)', () => {
    expect(allowed([
      'if [ -f x ]; then cat <<EOF\ngh issue close 1\nEOF\nfi',
      '[[ a == b ]] && cat <<EOF\ngh issue close 1\nEOF',
      'a[0]=1; cat <<EOF\ngh issue close 1\nEOF',
      'echo $[1+1]; cat <<EOF\ngh issue close 1\nEOF',
      'echo ${a[0]} ${b}; cat <<EOF\ngh issue close 1\nEOF',
      '{ cat <<EOF\ngh issue close 1\nEOF\n}',
      'echo "[" \'[\' \\[; cat <<EOF\ngh issue close 1\nEOF',
    ])).toEqual([])
  })
})
