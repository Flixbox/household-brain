import { type MouseEvent, type PointerEvent, useRef, useState } from 'react'
import { swipedToDone } from '../../lib/items/swipe-threshold'

/** Movement (px) below which a press still counts as a tap. */
const TAP_SLOP_PX = 10

/**
 * A left swipe on a row: follows the finger, and calls `onDone` when let go far enough. A swipe
 * never also counts as a tap on the row's link. Vertical scrolling stays with the browser (the row
 * sets `touch-action: pan-y`).
 */
export function useSwipeToDone(onDone: () => void, enabled: boolean) {
  const start = useRef<number | null>(null)
  const moved = useRef(false)
  const [offset, setOffset] = useState(0)
  const end = (event: PointerEvent) => {
    if (start.current !== null && swipedToDone(event.clientX - start.current)) {
      onDone()
    }
    start.current = null
    setOffset(0)
  }
  const handlers = {
    handleClickCapture: (event: MouseEvent) => {
      if (moved.current) {
        event.preventDefault()
        event.stopPropagation()
      }
      moved.current = false
    },
    handlePointerCancel: end,
    handlePointerDown: (event: PointerEvent) => {
      if (enabled) {
        start.current = event.clientX
        moved.current = false
      }
    },
    handlePointerMove: (event: PointerEvent) => {
      if (start.current === null) {
        return
      }
      const dx = Math.min(0, event.clientX - start.current)
      if (Math.abs(dx) > TAP_SLOP_PX) {
        moved.current = true
      }
      setOffset(dx)
    },
    handlePointerUp: end,
  }
  return { handlers, offset }
}
