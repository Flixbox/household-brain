/** Who `OWNER` is when the environment doesn't say (#295). */
import { ghText } from './watch-gh'

const adminCount = (humanAdmins: readonly string[]): string => (humanAdmins.length === 0 ? 'no' : String(humanAdmins.length))

const hasLogin = (login: string | undefined): login is string => typeof login === 'string' && login !== ''

/**
 * The repository's owner, unless that is an organisation, which never comments or approves: then
 * the repository's one human admin. When that can't be told (no human admin or several, or a read
 * failed: null), the repository's owner stays, and `note` says why, since no approval then counts.
 */
export const defaultOwner = (repoOwner: string, organisation: boolean | null, humanAdmins: readonly string[] | null): { note: string | null, owner: string } => {
  if (organisation === false) {
    return { note: null, owner: repoOwner }
  }
  const [only] = humanAdmins ?? []
  if (organisation === true && humanAdmins?.length === 1 && hasLogin(only)) {
    return { note: null, owner: only }
  }
  const why = organisation === null || humanAdmins === null
    ? "couldn't read whether an organisation owns it, or its admins"
    : `an organisation owns it, with ${adminCount(humanAdmins)} human admins`
  return { note: `OWNER is ${repoOwner}: ${why}. Set OWNER to the login whose comments and approval count.`, owner: repoOwner }
}

/** `defaultOwner` for `repo` (`owner/name`), asked of GitHub once at the start; its note goes to stderr. */
export const ownerOfRepo = async (repo: string): Promise<string> => {
  const [repoOwner = ''] = repo.split('/')
  const organisation = await ghText(['api', `repos/${repo}`, '-q', '.owner.type'])
    .then(text => text.trim() === 'Organization', () => null)
  // Users only: an app or bot with admin rights is no owner.
  const humanAdmins = organisation === true
    ? await ghText(['api', '--paginate', `repos/${repo}/collaborators?permission=admin`, '-q', '.[] | select(.type == "User") | .login'])
      .then(text => text.split('\n').filter(line => line !== ''), () => null)
    : []
  const { note, owner } = defaultOwner(repoOwner, organisation, humanAdmins)
  if (note !== null) {
    process.stderr.write(`${note}\n`)
  }
  return owner
}
