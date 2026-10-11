import { useEffect } from 'react'

/** Scrolls to the top when it appears; keyed by the address (Pages), it appears once per page. */
export const ToTop = () => {
  // A block, not an expression: Chrome's scrollTo returns a promise, which React would take for the
  // effect's cleanup and call when the page is left.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  return null
}
