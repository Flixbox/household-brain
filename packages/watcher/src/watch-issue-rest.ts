/** Issues and issue comments read through REST with `since=` (#412). Not written yet: the tests come first. */
import { type Json, records } from './watch-text'
import type { IssueEvent } from './watch-issue-events'
import type { OpenIssue } from './watch-link-cycles'

export type Rest = (path: string) => Promise<unknown>

export interface IssueSnapshot {
  cursor: string | null
  fullAt: number
  issues: OpenIssue[]
}

export const issuesBase = (repo: string): string => `repos/${repo}/issues?`
export const commentsBase = (repo: string): string => `repos/${repo}/issues/comments?`
export const askedSince = (cursor: string): string => cursor
export const readSince = async (rest: Rest, base: string, _cursor: string | null): Promise<Json[][]> => [records(await rest(base))]
export const nextCursor = (cursor: string | null, _pages: readonly Json[][]): string | null => cursor
export const newIssueEvents = (_items: readonly Json[], _self: string, _cursor: string | null): IssueEvent[] => []
export const ownerCommentEvents = (_items: readonly Json[], _owner: string, _cursor: string | null): IssueEvent[] => []
export const mergeOpen = (known: readonly OpenIssue[], _items: readonly Json[]): OpenIssue[] => [...known]
export const parseSnapshot = (_line: string | null): IssueSnapshot | null => null
export const reconcileDue = (_snapshot: IssueSnapshot, _now: number): boolean => false
