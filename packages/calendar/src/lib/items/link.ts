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

/** For the field's `pattern`: something with a dot and no spaces, with or without a scheme. */
export const LINK_PATTERN = String.raw`\s*([a-zA-Z][a-zA-Z0-9+.\-]*://)?[^\s/]+\.[^\s]+\s*`
