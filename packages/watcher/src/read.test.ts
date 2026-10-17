import { describe, expect, it } from 'bun:test'
import { allSettled } from './read'

describe('allSettled (#240)', () => {
  it('fails with the first failure only once everything has ended', async () => {
    const ended: string[] = []
    const slow = Bun.sleep(20).then(() => { ended.push('slow') })
    const failing = Promise.reject(new Error('first'))
    await expect(allSettled([failing, slow, Promise.reject(new Error('second'))])).rejects.toThrow('first')
    // Already ended when the failure came out.
    expect(ended).toEqual(['slow'])
  })

  it('succeeds when nothing fails', async () => {
    expect(await allSettled([Promise.resolve(1), Bun.sleep(1)])).toBeUndefined()
  })
})
