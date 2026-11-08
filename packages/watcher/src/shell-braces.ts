/**
 * `${…}` whose text the owner-write guard can't follow (#380). Inside it bash pairs quotes up again,
 * and skips nested expansions whole, so a `"` there doesn't end the double-quoted string around it.
 * Modelling that exactly is what keeps failing, so the guard fails closed instead: it spots such a
 * `${…}`, also where bash would take it as data, and reads the line again with its quoting taken off.
 */
import { scanned } from './shell-commands'
import { type Work, unreadableLine } from './shell-work'

/** A `${` with, before the first `}`, a quote, an escape, or a nested expansion that may hold that `}`. */
const unfollowableBrace = /\$\{[^}]*(?:["'\\`]|\$[([{])/u

const withoutContinuations = (text: string) => text.replaceAll('\\\n', '')

/** Whether a command line has a `${…}` the guard can't tell the end of. */
const hasUnfollowableBrace = (text: string) => unfollowableBrace.test(withoutContinuations(text))

/** A text with everything taken off that could hide what follows: quotes, escapes, `#` (a comment) and `<<` (a here-document). */
const flattened = (text: string) => text.replaceAll(/["'\\#]/gu, '').replaceAll('<<', '  ')

/**
 * A command line without its quoting, so quoted text reads as commands too: too much rather than
 * too little. Read twice, as a backslash before a newline joins the lines (`g\` and `h`), except
 * in a comment or after another backslash, where the newline ends the command.
 */
const flatReadings = (text: string) => [flattened(withoutContinuations(text)), flattened(text)]

/**
 * Whether a flat reading names plain `gh` anywhere (`agent-gh` is no match), also split over lines:
 * after a line a backslash only seems to join, no reading has that line ended and a `g\` and `h`
 * joined. Flattening loses what was one argument, as the script of `bash -c "gh pr close 1"`, so a
 * mention has to be enough.
 */
const namesGh = (reading: string) => /(?<![\w.-])g\n*h(?![\w-])/u.test(reading)

/** A flat reading and its substitutions, which have nothing in them to flatten again. */
const scannedFlat = (text: string, work: Work): string[][] => scanned(text, inner => scannedFlat(inner, work), work)

/**
 * Every simple command of a command line, as its words. With a `${…}` the scan can't follow (#380),
 * also those of the line without its quoting, and a `gh` command the shell fills in if it names `gh`.
 */
export const commandsOf = (text: string, work: Work): string[][] => {
  const direct = scanned(text, inner => commandsOf(inner, work), work)
  if (!hasUnfollowableBrace(text)) {
    return direct
  }
  const readings = flatReadings(text)
  const named = readings.some(reading => namesGh(reading)) ? unreadableLine() : []
  return [...direct, ...readings.flatMap(reading => scannedFlat(reading, work)), ...named]
}
