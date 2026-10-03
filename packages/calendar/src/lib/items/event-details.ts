import { PLAIN_NUMBER } from './amount'
import { CURRENCIES } from './currency'

/**
 * The details an event made outside the app carries in its description (#83), e.g. one the Gemini
 * app added from a shared coupon: "Code: SUMMER25", "Amount: 10 €" and a link, each on a line of its
 * own. Only labelled lines and web addresses count, so free text is never misread; whatever isn't
 * taken stays as the notes.
 */
export interface EventDetails {
  code: string
  amount: string
  /** ISO 4217 code, '' for euros (as entries store it). */
  currency: string
  url: string
  notes: string
}

const CODE = /^code\s*:\s*(?<value>\S+)(?<rest>.*)$/iu
const AMOUNT = /^amount\s*:\s*(?<value>\S.*)$/iu
const LINK = /^(?:link|url)\s*:\s*(?<value>\S+)$/iu
const WEB_ADDRESS = /https?:\/\/[^\s<>"]+/iu
// The tags Google Calendar's editor writes. Anything else in angle brackets (`<https://…>` pasted from
// an email) is text, not HTML.
const HTML_TAG = /<\/?(?:a|b|br|div|em|i|li|ol|p|span|strong|u|ul)\b[^>]*>/iu

// Longest first, so "R$" wins over "$".
const SYMBOLS: readonly [string, string][] = [['R$', 'BRL'], ['€', 'EUR'], ['£', 'GBP'], ['$', 'USD']]

/**
 * Google Calendar's own editor stores a description as HTML, so someone typing one by hand gives
 * `Code: X<br>Amount: …`: line breaks and links become plain text first.
 */
const plainText = (description: string): string => {
  const text = description.replaceAll(/\r\n?/gu, '\n')
  if (!HTML_TAG.test(text)) {
    return text
  }
  return text
    .replaceAll(/<br\s*\/?>|<\/(?:p|div|li)>/giu, '\n')
    .replaceAll(/<a\s[^>]*href=["'](?<href>[^"']*)["'][^>]*>[\s\S]*?<\/a>/giu, '$<href>')
    .replaceAll(new RegExp(HTML_TAG.source, 'giu'), '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&euro;', '€')
    .replaceAll('&amp;', '&')
}

/** A web address without the punctuation that ended its sentence. */
const addressIn = (text: string) => (WEB_ADDRESS.exec(text)?.[0] ?? '').replace(/[.,;:!?)\]]+$/u, '')

/**
 * "10 €", "€10,50", "R$ 199,99", "20 CHF", "10" (euros) → the number as typed and its currency. Null
 * for anything else ("10 € NEW", "100 kr", "1.500,00 €"): it stays in the notes rather than misread.
 */
const amountOf = (text: string): { amount: string, currency: string } | null => {
  const number = /\d[\d.,]*/u.exec(text)?.[0] ?? ''
  const unit = text.replace(number, '').trim()
  const currency = unit === '' ? 'EUR' : SYMBOLS.find(([symbol]) => symbol === unit)?.[1] ?? CURRENCIES.find(code => code === unit.toUpperCase())
  if (!PLAIN_NUMBER.test(number) || !currency) {
    return null
  }
  return { amount: number, currency: currency === 'EUR' ? '' : currency }
}

type Read =
  | { kind: 'code', code: string, rest: string }
  | { kind: 'amount', amount: string, currency: string }
  | { kind: 'url', url: string }
  | { kind: 'note' }

const readLine = (line: string): Read => {
  const text = line.trim()
  const code = CODE.exec(text)?.groups
  if (code?.value) {
    return { code: code.value, kind: 'code', rest: (code.rest ?? '').trim() }
  }
  const amount = amountOf(AMOUNT.exec(text)?.groups?.value ?? '')
  if (amount) {
    return { kind: 'amount', ...amount }
  }
  // A line that is only a web address, or labelled as the link; one inside a sentence stays there.
  const link = LINK.exec(text)?.groups?.value ?? text
  const address = addressIn(link)
  return address !== '' && address === link.replace(/[.,;:!?)\]]+$/u, '') ? { kind: 'url', url: address } : { kind: 'note' }
}

interface Line {
  line: string
  read: Read
}

export const detailsFrom = (description: string): EventDetails => {
  const lines: Line[] = plainText(description).split('\n').map(line => ({ line, read: readLine(line) }))
  // The first line of each kind is taken; a second one stays in the notes.
  const code = lines.find(entry => entry.read.kind === 'code')
  const amount = lines.find(entry => entry.read.kind === 'amount')
  const address = lines.find(entry => entry.read.kind === 'url')
  const taken = new Set([code, amount, address])
  // What followed the code on its line ("Code: X (in stores only)") stays as a note.
  const noteOf = (entry: Line): string => {
    if (entry.read.kind === 'code' && entry === code) {
      return entry.read.rest
    }
    return taken.has(entry) ? '' : entry.line
  }
  return {
    amount: amount?.read.kind === 'amount' ? amount.read.amount : '',
    code: code?.read.kind === 'code' ? code.read.code : '',
    currency: amount?.read.kind === 'amount' ? amount.read.currency : '',
    notes: lines.map(noteOf).filter(note => note !== '').join('\n').trim(),
    url: address?.read.kind === 'url' ? address.read.url : addressIn(plainText(description)),
  }
}
