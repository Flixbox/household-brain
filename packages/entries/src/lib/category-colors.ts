/**
 * Google Calendar's event colours, indexed by `colorId` ("1"–"11"), so a category looks the same in
 * the app as its events do in Google Calendar (Coupon tangerine, Membership grape, …). In order:
 * lavender, sage, grape, flamingo, banana, tangerine, peacock, graphite, blueberry, basil, tomato.
 */
const EVENT_COLORS = ['#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#039be5', '#616161', '#3f51b5', '#0b8043', '#d50000']

/** Graphite: entries without a category, and colour ids Google doesn't define. */
export const NO_CATEGORY_COLOR = '#616161'

export const categoryColor = (colorId: string): string => EVENT_COLORS[Number(colorId) - 1] ?? NO_CATEGORY_COLOR
