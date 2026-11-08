/**
 * Who counts as the owner for `agent-queue` (#354). Its REST reads go through `restAnswer`, so a rate
 * limit is logged and waited out (#428). A read that stays refused, or says nothing usable, is null:
 * `defaultOwner` then keeps the repository's owner and says so, and no list is ever taken from part of its pages.
 */
import { at, records } from './watch-text'
import { hasText, textOf } from './read'
import { defaultOwner } from './watch-owner'
import { restAnswer } from './agent-queue-gh'

/** Whether an organisation owns `repo`; null when GitHub doesn't say. */
const ownedByOrganisation = async (repo: string): Promise<boolean | null> => {
  const answer = await restAnswer(repo, `repos/${repo}`)
  const type = answer.status === 200 ? textOf(at(answer.body, 'owner', 'type')) : ''
  if (type === 'Organization' || type === 'User') {
    return type === 'Organization'
  }
  return null
}

/** The logins of `repo`'s human admins, from `page` on (an app or bot with admin rights is no owner); null when any page can't be read. */
const humanAdminsOf = async (repo: string, page = 1): Promise<string[] | null> => {
  const answer = await restAnswer(repo, `repos/${repo}/collaborators?permission=admin&per_page=100&page=${page}`)
  if (answer.status !== 200 || !Array.isArray(answer.body)) {
    return null
  }
  const logins = records(answer.body).filter(admin => admin.type === 'User').map(admin => textOf(admin.login)).filter(login => login !== '')
  if (!(answer.headers.get('link') ?? '').includes('rel="next"')) {
    return logins
  }
  const rest = await humanAdminsOf(repo, page + 1)
  return rest === null ? null : [...logins, ...rest]
}

/** OWNER, else `defaultOwner` for the repository (its note goes to stderr). */
export const ownerOf = async (repo: string): Promise<string> => {
  if (hasText(process.env.OWNER)) {
    return process.env.OWNER
  }
  const [repoOwner = ''] = repo.split('/')
  const organisation = await ownedByOrganisation(repo)
  const humanAdmins = organisation === true ? await humanAdminsOf(repo) : []
  const { note, owner } = defaultOwner(repoOwner, organisation, humanAdmins)
  if (note !== null) {
    process.stderr.write(`${note}\n`)
  }
  return owner
}
