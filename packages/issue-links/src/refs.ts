/** Issue references as people write them (`#12`, `12`, `owner/repo#12`), read and written (pure, so it is tested). */

export interface IssueRef {
  /** `owner/name` */
  repo: string
  number: number
}

/** The issue a reference names; a bare number or `#12` is in `defaultRepo`. Null for anything else. */
export const parseRef = (text: string, defaultRepo: string): IssueRef | null => {
  const trimmed = text.trim()
  const hash = trimmed.lastIndexOf('#')
  const named = hash > 0 ? trimmed.slice(0, hash) : ''
  const digits = trimmed.slice(hash + 1)
  const repo = named === '' ? defaultRepo : named
  // A number GitHub could give out (not one that rounds), in a repository written `owner/name`.
  const valid = /^\d{1,9}$/u.test(digits) && /^[\w.-]+\/[\w.-]+$/u.test(repo)
  return valid && Number(digits) > 0 ? { number: Number(digits), repo } : null
}

export const refText = ({ number, repo }: IssueRef): string => `${repo}#${number}`

/** The same issue however its repository is written: GitHub's names ignore case. */
export const refKey = (ref: IssueRef): string => refText(ref).toLowerCase()

/** The issue an API answer describes (`repository_url` ends in `/repos/owner/name`). */
export const refOf = (issue: { number: unknown, repository_url: unknown }): IssueRef | null => {
  const repo = /\/repos\/(?<repo>[^/]+\/[^/]+)$/u.exec(typeof issue.repository_url === 'string' ? issue.repository_url : '')?.groups?.repo ?? ''
  return repo !== '' && typeof issue.number === 'number' ? { number: issue.number, repo } : null
}
