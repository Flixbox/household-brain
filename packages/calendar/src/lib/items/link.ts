/**
 * Accepts what people type into the link field: "example.de", "www.shop.example/deal" or a full
 * "https://…" address. A bare domain gets `https://` in front; an empty field stays empty.
 */
export const normaliseLink = (input: string): string => {
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
 * The address to open from the field, or null while it isn't a web address yet. Only `http(s)` with a
 * real host: another scheme (`javascript:`, `mailto:`) is never opened, also not when `https://` put
 * in front of it would turn it into the user part of an address (`https://mailto:a@shop.test`).
 */
export const openableLink = (input: string): string | null => {
  const link = normaliseLink(input)
  // Not `URL.canParse`: the build still targets iOS 16, which lacks it.
  const url = parsed(link)
  return url && (url.protocol === 'https:' || url.protocol === 'http:') && url.username === '' && url.hostname.includes('.') ? link : null
}

const parsed = (link: string): URL | null => {
  try {
    return new URL(link)
  } catch {
    return null
  }
}
