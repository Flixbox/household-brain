/** Reading GitHub's JSON answers, and the text of comments, as the watcher prints them (pure, so it is tested). */
import { isRecord, textOf } from './read'

export type Json = Record<string, unknown>

export const records = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(item => isRecord(item)) : [])
export const count = (value: unknown) => (typeof value === 'number' ? value : 0)
export const record = (value: unknown): Json => (isRecord(value) ? value : {})
export const oneLine = (value: unknown, length: number) => textOf(value).replaceAll(/\s+/gu, ' ').slice(0, length)

/** Characters of someone else's comment that are printed; the rest is behind the comment's link. */
const LIMIT = 300

/**
 * A comment's text under its event line, indented so it stays part of the event (#255). The owner's
 * comments are instructions, so they come whole, line for line. Anyone else's is cut at a few hundred
 * characters, and then says so and where the rest is.
 */
export const bodyLines = (body: unknown, { indent = '    ', url, whole }: { indent?: string, url: unknown, whole: boolean }): string[] => {
  const text = textOf(body).trim()
  if (text === '') {
    return []
  }
  if (whole) {
    return text.split(/\r?\n/u).map(line => `${indent}${line}`.trimEnd())
  }
  const flat = oneLine(text, Infinity)
  return [flat.length <= LIMIT ? `${indent}${flat}` : `${indent}${flat.slice(0, LIMIT)} … [${flat.length - LIMIT} more characters: ${textOf(url)}]`]
}
