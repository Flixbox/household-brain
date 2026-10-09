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
  // Credit that never expires, e.g. on a gift card: its entries usually have no date at all (#33).
  { colorId: '10', label: 'Balance', slug: 'balance', sortOrder: 8 },
]

/**
 * Other words a `[Word]` title prefix may use for a default category (#92), besides its label: the
 * Gemini app tags the events it adds freely (`[Deal]`, `[Deadline]`). Lower case, English and German.
 * A category the household added itself is recognised by its label only.
 */
export const CATEGORY_WORDS: Readonly<Record<string, readonly string[]>> = {
  balance: ['credit', 'gift card', 'giftcard', 'guthaben', 'prepaid'],
  contract: ['vertrag', 'kündigung', 'cancellation', 'notice'],
  coupon: ['deal', 'discount', 'voucher', 'offer', 'promo', 'promotion', 'sale', 'cashback', 'bonus', 'freebie', 'rabatt', 'gutschein', 'angebot', 'aktion', 'gratis'],
  insurance: ['versicherung'],
  membership: ['subscription', 'abo', 'abonnement', 'mitgliedschaft'],
  paperwork: ['deadline', 'return', 'refund', 'document', 'documents', 'tax', 'bill', 'invoice', 'form', 'frist', 'rücksendung', 'retoure', 'erstattung', 'dokument', 'steuer', 'steuern', 'rechnung', 'antrag'],
  transit: ['transport', 'transit', 'ticket', 'deutschlandticket', 'öpnv'],
  warranty: ['guarantee', 'garantie', 'gewährleistung'],
}

/** The category a bracketed tag names, by its label or one of its words, ignoring case. */
export const categoryOfTag = <Entry extends Pick<Category, 'slug' | 'label'>>(tag: string, categories: readonly Entry[]): Entry | null => {
  const word = tag.trim().toLowerCase()
  if (word === '') {
    return null
  }
  return categories.find(category => category.label.toLowerCase() === word)
    ?? categories.find(category => CATEGORY_WORDS[category.slug]?.includes(word)) ?? null
}

const FALLBACK_CATEGORY = 'paperwork'

/**
 * The category the form shows and saves: the entry's own when it is offered; for one that isn't (an
 * uncategorised entry) Paperwork, else the first (#92). Without it the dropdown showed its first
 * option while Save kept the old category. '' (a new entry without one) stays, so the form asks.
 */
export const offeredCategory = (category: string, categories: readonly Pick<Category, 'slug'>[]): string => {
  if (category === '' || categories.some(entry => entry.slug === category)) {
    return category
  }
  return categories.find(entry => entry.slug === FALLBACK_CATEGORY)?.slug ?? categories[0]?.slug ?? category
}

/**
 * Former defaults, hidden while no entry uses them (`visibleCategories`). They are never deleted:
 * an entry still waiting to sync on some device may use one, and must keep its category.
 * "Document expiry" gave way to the broader "Paperwork".
 */
export const RETIRED_DEFAULTS: readonly string[] = ['document']

/** The categories to offer and list: all of them, minus retired defaults no entry uses. */
export const visibleCategories = <Entry extends Pick<Category, 'slug'>>(categories: readonly Entry[], items: readonly { category: string }[]): Entry[] => {
  const used = new Set(items.map(item => item.category))
  return categories.filter(category => !RETIRED_DEFAULTS.includes(category.slug) || used.has(category.slug))
}

/**
 * The defaults a set-up household doesn't have yet, so a category added to the defaults appears
 * without setting the household up again. Nothing for a household that has no categories at all:
 * seeding those is the setup's job.
 */
export const missingDefaults = (existing: readonly Pick<Category, 'slug'>[]): Category[] => {
  if (existing.length === 0) {
    return []
  }
  const slugs = new Set(existing.map(category => category.slug))
  return DEFAULT_CATEGORIES.filter(category => !slugs.has(category.slug))
}
