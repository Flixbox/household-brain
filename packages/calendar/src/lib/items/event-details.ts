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

const CODE = /^code\s*:\s*(?<value>\S.*)$/iu
const AMOUNT = /^amount\s*:\s*(?<value>\S.*)$/iu
const WEB_ADDRESS = /https?:\/\/[^\s<>"]+/iu
const PLAIN_NUMBER = /^\d+(?:[.,]\d{1,2})?$/u

// Longest first, so "R$" wins over "$".
const SYMBOLS: readonly [string, string][] = [['R$', 'BRL'], ['€', 'EUR'], ['£', 'GBP'], ['$', 'USD']]

const currencyIn = (text: string): string => {
  const code = /\b(?<code>[A-Z]{3})\b/u.exec(text)?.groups?.code ?? SYMBOLS.find(([symbol]) => text.includes(symbol))?.[1] ?? 'EUR'
  return code === 'EUR' ? '' : code
}

/** "10 €", "€10,50", "R$ 199,99", "20 CHF" → the number as typed and its currency; null when unclear. */
const amountOf = (text: string): { amount: string, currency: string } | null => {
  const number = /[\d.,]+/u.exec(text)?.[0] ?? ''
  return PLAIN_NUMBER.test(number) ? { amount: number, currency: currencyIn(text) } : null
}

type Read =
  | { kind: 'code', code: string }
  | { kind: 'amount', amount: string, currency: string }
  | { kind: 'url', url: string }
  | { kind: 'note' }

const readLine = (line: string): Read => {
  const text = line.trim()
  const code = CODE.exec(text)?.groups?.value ?? ''
  if (code !== '') {
    return { code, kind: 'code' }
  }
  const amount = amountOf(AMOUNT.exec(text)?.groups?.value ?? '')
  if (amount) {
    return { kind: 'amount', ...amount }
  }
  // A line that is only a web address; one inside a sentence stays there, but can still be the link.
  return text !== '' && WEB_ADDRESS.exec(text)?.[0] === text ? { kind: 'url', url: text } : { kind: 'note' }
}

export const detailsFrom = (description: string): EventDetails => {
  const lines = description.split('\n').map(line => ({ line, read: readLine(line) }))
  // The first line of each kind is taken; a second one stays in the notes.
  const code = lines.find(entry => entry.read.kind === 'code')
  const amount = lines.find(entry => entry.read.kind === 'amount')
  const address = lines.find(entry => entry.read.kind === 'url')
  const taken = new Set([code, amount, address])
  return {
    amount: amount?.read.kind === 'amount' ? amount.read.amount : '',
    code: code?.read.kind === 'code' ? code.read.code : '',
    currency: amount?.read.kind === 'amount' ? amount.read.currency : '',
    notes: lines.filter(entry => !taken.has(entry)).map(entry => entry.line).join('\n').trim(),
    url: address?.read.kind === 'url' ? address.read.url : WEB_ADDRESS.exec(description)?.[0] ?? '',
  }
}
