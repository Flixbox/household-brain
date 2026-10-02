/**
 * Accepts what people type into the link field: "example.de", "www.shop.example/deal" or a full
 * "https://…" address. A bare domain gets `https://` in front; an empty field stays empty.
 */
export function normaliseLink(input: string): string {
  const link = input.trim()
  if (link === '') {
    return ''
  }
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(link) ? link : `https://${link}`
}

/**
 * For the field's `pattern`: something with a dot and no spaces, with or without a scheme. Browsers
 * compile a pattern with the `v` flag and silently ignore it when that fails, so `/` is escaped even
 * inside the character class.
 */
export const LINK_PATTERN = String.raw`\s*([a-zA-Z][a-zA-Z0-9+.\-]*:\/\/)?[^\s\/]+\.[^\s]+\s*`

/**
 * The address to open from the field, or null while it isn't a web address yet. Only `http(s)`:
 * any other scheme (a `javascript:` link someone stored) is never opened.
 */
export function openableLink(input: string): string | null {
  const link = normaliseLink(input)
  return /^https?:\/\/[^\s/]+\.\S+$/iu.test(link) ? link : null
}
