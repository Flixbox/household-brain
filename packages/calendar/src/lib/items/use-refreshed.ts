import { useEffect, useState } from 'react'
import { refreshNow } from './outbox'

/** How long a screen waits for Google before showing what it has. */
const WAIT_MS = 2500

/**
 * Whether the entries are fresh enough to show: false while a pull from Google runs on opening the
 * screen, true once it is done, or after a short wait (a slow network never blocks editing).
 */
export function useRefreshed(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let mounted = true
    const show = () => {
      if (mounted) {
        setReady(true)
      }
    }
    const timer = setTimeout(show, WAIT_MS)
    refreshNow().then(show, show)
    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [])
  return ready
}
