/** The project watcher's questions about single issues, for a scoped watcher's subscribed ones (#357). */
import { type Json, record } from './watch-text'
import { graphql } from './watch-github'
import { isRecord } from './read'

/**
 * `fields` of each issue asked about, all in one GraphQL query. One issue GitHub can't resolve (gone,
 * transferred, or a PR's number) fails the whole query, so then each is asked alone, like `perPr`
 * does, and one that still fails is missing. It mustn't hold back the others, or a PR's events
 * (#263): not even when it is the only one left, as a gone issue fails on every look. A lookup that
 * failed for another reason is asked again on the next look.
 */
export const perIssue = async (issues: readonly number[], fields: string, fresh = false): Promise<Map<number, Json>> => {
  const ask = async (batch: readonly number[]): Promise<[number, Json][]> => {
    const repository = await graphql(batch.map(issue => `issue${issue}: issue(number:${issue}){${fields}}`).join(' '), fresh)
    return batch.flatMap((issue): [number, Json][] => isRecord(repository[`issue${issue}`]) ? [[issue, record(repository[`issue${issue}`])]] : [])
  }
  const oneByOne = async (): Promise<[number, Json][]> =>
    (await Promise.all(issues.map(async issue => ask([issue]).catch((): [number, Json][] => [])))).flat()
  return issues.length === 0 ? new Map() : new Map(await ask(issues).catch(oneByOne))
}
