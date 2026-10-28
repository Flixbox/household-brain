import { describe, expect, it } from 'bun:test'
import { defaultOwner } from './watch-owner'

describe('defaultOwner', () => {
  it("keeps a user's repository's owner", () => {
    expect(defaultOwner('someone', false, [])).toEqual({ note: null, owner: 'someone' })
  })

  it("takes an organisation's one human admin (#295)", () => {
    expect(defaultOwner('org', true, ['person'])).toEqual({ note: null, owner: 'person' })
  })

  it('keeps the organisation, and says why, with no human admin, several, or a failed read', () => {
    const cases: [boolean | null, string[] | null, string][] = [
      [true, [], 'with no human admins'],
      [true, ['one', 'two'], 'with 2 human admins'],
      [true, null, "couldn't read"],
      [null, [], "couldn't read"],
    ]
    for (const [organisation, admins, why] of cases) {
      const { note, owner } = defaultOwner('org', organisation, admins)
      expect(owner).toBe('org')
      expect(note ?? '').toContain(why)
    }
  })
})
