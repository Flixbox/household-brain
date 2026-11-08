import { describe, expect, it } from 'bun:test'
import { reportedPassed } from './watch-ci-state'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OTHER = '1234567890abcdef1234567890abcdef12345678'
const passed = (attempt: number, sha = HEAD) => (attempt > 1 ? `pr-12 ci-passed ${sha} ${attempt}` : `pr-12 ci-passed ${sha}`)
const failed = (attempt: number, sha = HEAD) => `pr-12 ci-failed ${sha} ${attempt}`
const passedIn = (run: number, attempt = 1) => `pr-12 ci-passed ${HEAD} ${run} ${attempt}`
const failedIn = (run: number, attempt = 1) => `pr-12 ci-failed ${HEAD} ${run} ${attempt}`
const green = (...reported: string[]) => reportedPassed(reported, 12, HEAD)

describe('reportedPassed', () => {
  it('is false until the head has a reported pass', () => {
    expect(green()).toBe(false)
    expect(green(failed(1))).toBe(false)
    expect(green(passed(1, OTHER))).toBe(false)
  })

  it('counts a pass without a suffix as attempt 1', () => {
    expect(green(passed(1))).toBe(true)
  })

  it('goes red when a later attempt on the head fails', () => {
    expect(green(passed(1), failed(2))).toBe(false)
    expect(green(failed(2), passed(1))).toBe(false)
  })

  it('goes green again when a later attempt passes', () => {
    expect(green(failed(1), passed(2))).toBe(true)
    expect(green(passed(1), failed(2), passed(3))).toBe(true)
  })

  it('compares attempts as numbers', () => {
    expect(green(failed(9), passed(10))).toBe(true)
    expect(green(passed(9), failed(10))).toBe(false)
  })

  it('lets the later line win a tie, as when a new run on the head starts again at attempt 1 (#430)', () => {
    expect(green(failed(1), passed(1))).toBe(true)
    expect(green(passed(1), failed(1))).toBe(false)
    expect(green(failed(2), passed(2))).toBe(true)
    expect(green(passed(2), failed(2))).toBe(false)
  })

  it('orders results by run before attempt, wherever their lines are (#486)', () => {
    expect(green(failedIn(101), passedIn(100, 2))).toBe(false)
    expect(green(passedIn(101), failedIn(100, 2))).toBe(true)
  })

  it('takes the latest of several runs on one head (#486)', () => {
    expect(green(passedIn(100), failedIn(101), passedIn(102))).toBe(true)
    expect(green(failedIn(100), passedIn(101), failedIn(102))).toBe(false)
  })

  it('orders attempts within one run (#486)', () => {
    expect(green(failedIn(100, 2), passedIn(100, 1))).toBe(false)
    expect(green(failedIn(100, 9), passedIn(100, 10))).toBe(true)
  })

  it('counts a line from before the run id as older than any run (#486)', () => {
    expect(green(failed(3), passedIn(100))).toBe(true)
    expect(green(passed(3), failedIn(100))).toBe(false)
  })

  it('ignores a failure on another head or PR', () => {
    expect(green(passed(1), failed(2, OTHER))).toBe(true)
    expect(green(passed(1), `pr-13 ci-failed ${HEAD} 2`)).toBe(true)
  })
})
