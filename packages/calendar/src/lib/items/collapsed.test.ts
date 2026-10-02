import { cleanTestStorage, getTestStorage, useTestStorageEngine } from '@nanostores/persistent'
import { afterEach, describe, expect, it } from 'vitest'
import { $collapsed, collapsedSlugs, pruneCollapsed, toggleCollapsed } from './collapsed'

// oxlint-disable-next-line react-hooks/rules-of-hooks -- nanostores' switch to fake storage, not a React hook
useTestStorageEngine()

describe('collapsed categories', () => {
  afterEach(() => {
    $collapsed.set([])
    cleanTestStorage()
  })

  it('toggles a category and keeps the list in storage', () => {
    toggleCollapsed('coupon')
    expect(getTestStorage()['hb:collapsed']).toBe('["coupon"]')
    toggleCollapsed('coupon')
    expect(collapsedSlugs()).toEqual([])
  })

  it('drops categories that no longer exist', () => {
    $collapsed.set(['coupon', 'document'])
    pruneCollapsed(['coupon', 'membership'])
    expect(collapsedSlugs()).toEqual(['coupon'])
  })

  it('treats a stored value that is not a list of slugs as nothing collapsed', () => {
    expect(collapsedSlugs({ coupon: true })).toEqual([])
    expect(collapsedSlugs(['coupon', 3])).toEqual(['coupon'])
  })
})
