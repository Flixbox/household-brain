import { useEffect } from 'react'

/** Scrolls to the top when it appears; keyed by the address (Pages), it appears once per page. */
export const ToTop = () => {
  useEffect(() => window.scrollTo(0, 0), [])
  return null
}
