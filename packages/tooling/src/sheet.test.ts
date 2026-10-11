import { describe, expect, it } from 'bun:test'
import { sheetRows } from './sheet'

describe('sheetRows', () => {
  it('fits one tile per frame, six a row', () => {
    expect(sheetRows(1, 4)).toBe(1)
    expect(sheetRows(1.25, 4)).toBe(1)
    expect(sheetRows(1.5, 4)).toBe(2)
    expect(sheetRows(8.96, 1)).toBe(2)
  })
})
