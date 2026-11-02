/* oxlint-disable import/no-nodejs-modules, eslint/no-await-in-loop -- synchronous durable writes precede output; ordered delivery acknowledges each event before the next */
/** Pending notifications survive failed delivery and watcher restarts; acknowledged ids suppress replay. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import type { Notification } from './codex-notify'
import { isRecord } from './read'

interface Entry extends Notification { delivered: boolean, key: string }

const entryFrom = (value: unknown): Entry => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.delivered !== 'boolean' || typeof value.key !== 'string'
    || !Array.isArray(value.lines) || !value.lines.every((line: unknown) => typeof line === 'string')) {
    throw new Error('Invalid watcher delivery outbox')
  }
  return { delivered: value.delivered, id: value.id, key: value.key, lines: value.lines }
}

const readText = (file: string): string => {
  try { return readFileSync(file, 'utf8') } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') { return '[]' }
    throw error
  }
}

const entriesFrom = (file: string): Entry[] => {
  const value: unknown = JSON.parse(readText(file))
  if (!Array.isArray(value)) { throw new TypeError('Invalid watcher delivery outbox') }
  return value.map(item => entryFrom(item))
}

/** Usage, reminders and quiet heartbeats stay on stdout without waking a model. */
export const actionable = (lines: readonly string[]): boolean => {
  const first = (lines[0] ?? '').replace(/^\[[^\]]+\]\s*/u, '')
  return first.length > 0 && !/^(?:IDLE:|Usage(?: \([^)]+\))?:|REMINDER:)/u.test(first)
}

export class DeliveryOutbox {
  public readonly file: string
  public constructor(file: string) { this.file = file }

  private save(entries: Entry[]): void {
    mkdirSync(nodePath.dirname(this.file), { recursive: true })
    const draft = `${this.file}.${process.pid}.writing`
    const retained = [...entries.filter(entry => !entry.delivered), ...entries.filter(entry => entry.delivered).slice(-512)]
    writeFileSync(draft, JSON.stringify(retained), { mode: 0o600 })
    renameSync(draft, this.file)
  }

  public enqueue(key: string, lines: readonly string[]): void {
    if (!actionable(lines)) { return }
    const entries = entriesFrom(this.file)
    if (entries.some(entry => entry.key === key)) { return }
    entries.push({ delivered: false, id: crypto.randomUUID(), key, lines })
    this.save(entries)
  }

  public async drain(send: (entry: Notification) => Promise<void>): Promise<void> {
    for (const entry of entriesFrom(this.file).filter(item => !item.delivered)) {
      await send(entry)
      // New output may have arrived while delivery awaited the host.
      this.save(entriesFrom(this.file).map(item => item.id === entry.id ? Object.assign(item, { delivered: true }) : item))
    }
  }
}
