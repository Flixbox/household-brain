import { persistentJSON } from '@nanostores/persistent'

/**
 * The categories this device shows collapsed, by slug. Everything else is expanded, so new
 * categories, a fresh device or cleared storage start fully expanded. Per device, never synced.
 */
export const $collapsed = persistentJSON<string[]>('hb:collapsed', [])

/** The stored list, ignoring anything that isn't a list of slugs (an older or hand-edited value). */
export const collapsedSlugs = (stored: unknown = $collapsed.get()): string[] =>
  Array.isArray(stored) ? stored.filter(slug => typeof slug === 'string') : []

export const toggleCollapsed = (slug: string) => {
  const current = collapsedSlugs()
  $collapsed.set(current.includes(slug) ? current.filter(other => other !== slug) : [...current, slug])
}

/** Drops slugs of categories that no longer exist. Call it only with the loaded categories. */
export const pruneCollapsed = (known: readonly string[]) => {
  const current = collapsedSlugs()
  const kept = current.filter(slug => known.includes(slug))
  if (kept.length !== current.length) {
    $collapsed.set(kept)
  }
}
