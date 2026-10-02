import { type MouseEvent, type PointerEvent, useRef, useState } from 'react'
import { swipedToDone } from '../../lib/items/swipe-threshold'

/** Movement (px) below which a press still counts as a tap. */
const TAP_SLOP_PX = 10

interface Gesture {
  pointerId: number
  startX: number
  /** How far it has moved so far (never to the right). */
  dx: number
}

/**
 * The gesture's distance after a move: null when the move isn't part of it (another pointer), NaN
 * when it has ended without a pointerup (a mouse moving with no button held, e.g. let go outside).
 */
function follow(gesture: Gesture | null, event: PointerEvent): number | null {
  if (!gesture || event.pointerId !== gesture.pointerId) {
    return null
  }
  if (event.pointerType === 'mouse' && event.buttons === 0) {
    return Number.NaN
  }
  gesture.dx = Math.min(0, event.clientX - gesture.startX)
  return gesture.dx
}

/**
 * A left swipe on a row: follows one pointer, and calls `onDone` when that pointer is let go far
 * enough. A cancelled gesture (e.g. the browser taking over to scroll) only resets. A swipe never
 * also counts as a tap on the row's link. Vertical scrolling stays with the browser (the row sets
 * `touch-action: pan-y`).
 */
export function useSwipeToDone(onDone: () => void, enabled: boolean) {
  const gesture = useRef<Gesture | null>(null)
  const moved = useRef(false)
  const [offset, setOffset] = useState(0)
  const reset = () => {
    gesture.current = null
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
    handlePointerCancel: reset,
    handlePointerDown: (event: PointerEvent) => {
      if (enabled && !gesture.current && event.isPrimary) {
        gesture.current = { dx: 0, pointerId: event.pointerId, startX: event.clientX }
        moved.current = false
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    },
    handlePointerMove: (event: PointerEvent) => {
      const dx = follow(gesture.current, event)
      if (dx !== null && Number.isNaN(dx)) {
        reset()
      } else if (dx !== null) {
        if (Math.abs(dx) > TAP_SLOP_PX) {
          moved.current = true
        }
        setOffset(dx)
      }
    },
    handlePointerUp: (event: PointerEvent) => {
      // The distance of the last move, not of this event: some browsers report odd coordinates here.
      if (gesture.current?.pointerId === event.pointerId && swipedToDone(gesture.current.dx)) {
        onDone()
      }
      if (gesture.current?.pointerId === event.pointerId) {
        reset()
      }
    },
  }
  return { handlers, offset }
}
