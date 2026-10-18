/** The commands both the MCP tools and the command line offer (#256): one implementation, two ways in. */
import { type IssueRef, parseRef } from './refs'
import { block, linksOf, unblock } from './links'
import { ghJson } from './gh'

/** REPO: `owner/name` for a bare issue number; by default the repository `gh` finds in the current folder. */
const defaultRepo = async (): Promise<string> => {
  const given = process.env.REPO ?? ''
  if (given !== '') {
    return given
  }
  // A failure comes with gh's own message (not logged in, not a repository folder).
  const answer = await ghJson(['repo', 'view', '--json', 'nameWithOwner'])
  return typeof answer === 'object' && answer !== null && 'nameWithOwner' in answer && typeof answer.nameWithOwner === 'string' ? answer.nameWithOwner : ''
}

const issue = async (text: string): Promise<IssueRef> => {
  const ref = parseRef(text, text.includes('/') ? '' : await defaultRepo())
  if (!ref) {
    throw new Error(`"${text}" isn't an issue: write 12, #12 or owner/repo#12 (a bare number needs REPO, or a repository folder)`)
  }
  return ref
}

export const commands = {
  block: async (blocked: string, blocker: string) => block(await issue(blocked), await issue(blocker)),
  links: async (of: string) => linksOf(await issue(of)),
  unblock: async (blocked: string, blocker: string) => unblock(await issue(blocked), await issue(blocker)),
}
