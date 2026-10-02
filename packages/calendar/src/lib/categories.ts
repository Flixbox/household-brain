export interface Category {
  slug: string
  label: string
  /** Google Calendar event colour id ("1"–"11"). */
  colorId: string
  sortOrder: number
}

/** Seeded on first run; a default added later reaches existing households too (`missingDefaults`). */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { colorId: '6', label: 'Coupon', slug: 'coupon', sortOrder: 1 },
  { colorId: '3', label: 'Membership', slug: 'membership', sortOrder: 2 },
  { colorId: '7', label: 'Public transport', slug: 'transit', sortOrder: 3 },
  { colorId: '2', label: 'Warranty', slug: 'warranty', sortOrder: 4 },
  { colorId: '5', label: 'Contract', slug: 'contract', sortOrder: 5 },
  { colorId: '9', label: 'Insurance', slug: 'insurance', sortOrder: 6 },
  { colorId: '1', label: 'Paperwork', slug: 'paperwork', sortOrder: 7 },
]

/**
 * Former defaults, hidden while no entry uses them (`visibleCategories`). They are never deleted:
 * an entry still waiting to sync on some device may use one, and must keep its category.
 * "Document expiry" gave way to the broader "Paperwork".
 */
export const RETIRED_DEFAULTS: readonly string[] = ['document']

/** The categories to offer and list: all of them, minus retired defaults no entry uses. */
export function visibleCategories<Entry extends Pick<Category, 'slug'>>(categories: readonly Entry[], items: readonly { category: string }[]): Entry[] {
  const used = new Set(items.map(item => item.category))
  return categories.filter(category => !RETIRED_DEFAULTS.includes(category.slug) || used.has(category.slug))
}

/**
 * The defaults a set-up household doesn't have yet, so a category added to the defaults appears
 * without setting the household up again. Nothing for a household that has no categories at all:
 * seeding those is the setup's job.
 */
export function missingDefaults(existing: readonly Pick<Category, 'slug'>[]): Category[] {
  if (existing.length === 0) {
    return []
  }
  const slugs = new Set(existing.map(category => category.slug))
  return DEFAULT_CATEGORIES.filter(category => !slugs.has(category.slug))
}
