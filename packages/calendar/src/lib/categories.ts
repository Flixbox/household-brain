export interface Category {
  slug: string
  label: string
  /** Google Calendar event colour id ("1"–"11"). */
  colorId: string
  sortOrder: number
}

/** Seeded on first run; editable later in Settings. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 },
  { colorId: '3', label: 'Membership', slug: 'membership', sortOrder: 2 },
  { colorId: '7', label: 'Public transport', slug: 'transit', sortOrder: 3 },
  { colorId: '2', label: 'Warranty', slug: 'warranty', sortOrder: 4 },
  { colorId: '5', label: 'Contract', slug: 'contract', sortOrder: 5 },
  { colorId: '9', label: 'Insurance', slug: 'insurance', sortOrder: 6 },
  { colorId: '8', label: 'Document expiry', slug: 'document', sortOrder: 7 },
]
