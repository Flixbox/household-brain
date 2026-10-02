/** How far (px) an entry has to be swiped left to be marked done. */
export const SWIPE_DONE_PX = 96

/** Whether a swipe this far (negative: to the left) marks the entry done. */
export const swipedToDone = (dx: number) => dx <= -SWIPE_DONE_PX
