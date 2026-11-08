/** Subscription decisions use trusted subject identifiers, never rendered event text (#349). */
import { isRecord } from './read'

export interface Audience { issue?: number, pr?: number, quiet?: boolean, system?: boolean }
interface Saved { closedPrs: number[], ended: string[], links: [number, number[]][], selection: string }
export const SUBSCRIPTIONS_COMPLETE = 3

export const selectionKey = (raw: string): string => {
  if (raw.trim() === '') { return '' }
  const items = raw.split(',').map(item => item.trim())
  if (!items.every(item => /^(?:pr|issue):[1-9]\d*$/u.test(item) && Number.isSafeInteger(Number(item.split(':')[1])))) {
    throw new Error('WATCHER_SUBSCRIPTIONS must list pr:<number> or issue:<number>')
  }
  return [...new Set(items)].toSorted().join(',')
}

const numbers = (value: unknown): value is number[] => Array.isArray(value)
  && value.every((item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0)
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item: unknown) => typeof item === 'string')
const links = (value: unknown): value is [number, number[]][] => Array.isArray(value)
  && value.every((item: unknown) => Array.isArray(item) && numbers([item[0]]) && numbers(item[1]))

const savedFrom = (value: unknown, selection: string): Saved => {
  if (!isRecord(value) || value.selection !== selection || !numbers(value.closedPrs) || !strings(value.ended) || !links(value.links)) {
    throw new Error('Subscription state does not match this selection')
  }
  return { closedPrs: value.closedPrs, ended: value.ended, links: value.links, selection }
}

export class Subscription {
  public readonly selection: string
  private readonly wanted: Set<string>
  private ended = new Set<string>()
  private closedPrs = new Set<number>()
  private links = new Map<number, number[]>()

  public constructor(raw: string) {
    this.selection = selectionKey(raw)
    this.wanted = new Set(this.selection.split(',').filter(Boolean))
  }
  public get scoped(): boolean { return this.wanted.size > 0 }
  public get complete(): boolean { return this.scoped && [...this.wanted].every(item => this.ended.has(item)) }
  /** Whether ending these subjects leaves nothing wanted: only then is the subscription complete (#477). */
  public endedBy(subjects: readonly string[]): boolean {
    return this.scoped && [...this.wanted].every(item => this.ended.has(item) || subjects.includes(item))
  }
  public canStop(pending: boolean): boolean { return this.complete && !pending }
  public get prs(): number[] { return [...this.wanted].filter(item => item.startsWith('pr:') && this.active(item)).map(item => Number(item.slice(3))) }
  public get issues(): number[] { return [...this.wanted].filter(item => item.startsWith('issue:') && this.active(item)).map(item => Number(item.slice(6))) }
  private active(item: string): boolean { return this.wanted.has(item) && !this.ended.has(item) }

  public accepts(audience: Audience): boolean {
    if (!this.scoped) { return true }
    if (audience.system === true) { return true }
    if (audience.quiet === true || this.complete) { return false }
    if (this.active(`issue:${audience.issue ?? 0}`)) { return true }
    const pr = audience.pr ?? 0
    return !this.closedPrs.has(pr) && (this.active(`pr:${pr}`) || this.links.get(pr)?.some(issue => this.active(`issue:${issue}`)) === true)
  }
  public rememberPr(pr: number, issues: number[], open = false): void {
    if (open && issues.some(issue => this.active(`issue:${issue}`))) { this.closedPrs.delete(pr) }
    if (this.wanted.has(`pr:${pr}`) || this.links.has(pr) || issues.some(issue => this.wanted.has(`issue:${issue}`))) {
      this.links.set(pr, issues)
    }
  }
  public isClosedPr(pr: number): boolean { return this.closedPrs.has(pr) }
  public closePr(pr: number): void {
    if (this.accepts({ pr })) { this.closedPrs.add(pr); this.ended.add(`pr:${pr}`) }
  }
  public closeIssue(issue: number): void { if (this.wanted.has(`issue:${issue}`)) { this.ended.add(`issue:${issue}`) } }
  public snapshot(): Saved {
    return { closedPrs: [...this.closedPrs], ended: [...this.ended], links: [...this.links], selection: this.selection }
  }
  public restore(value: unknown): void {
    const saved = savedFrom(value, this.selection)
    this.closedPrs = new Set(saved.closedPrs)
    this.ended = new Set(saved.ended)
    this.links = new Map(saved.links)
  }
}
