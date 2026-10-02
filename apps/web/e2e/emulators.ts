const PROJECT = 'demo-household-brain'
const FIRESTORE = 'http://127.0.0.1:8080'
const AUTH = 'http://127.0.0.1:9099'

/** Wipes every emulator user and document between tests. */
export async function resetEmulators() {
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  await fetch(`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

/** Adds a uid to the allowlist the way the owner does in the console: bypassing the rules. */
export async function allowlist(uid: string) {
  const response = await fetch(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/allowlist?documentId=${encodeURIComponent(uid)}`,
    {
      body: JSON.stringify({ fields: { name: { stringValue: 'E2E' } } }),
      headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )
  if (!response.ok) {
    throw new Error(`Allowlisting ${uid} failed: ${response.status} ${await response.text()}`)
  }
}

/**
 * Writes a document as the console would (bypassing the rules). Strings and integers are supported.
 * A PATCH, so it replaces a document that is still there (e.g. written late by a previous test's
 * page) instead of failing with "already exists".
 */
export async function seedDocument(path: string, fields: Record<string, string | number>) {
  const response = await fetch(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path.split('/').map(encodeURIComponent).join('/')}`,
    {
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }])) }),
      headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
      method: 'PATCH',
    },
  )
  if (!response.ok) {
    throw new Error(`Seeding ${path} failed: ${response.status} ${await response.text()}`)
  }
}

/** Reads a document as the console would (bypassing the rules); null when it doesn't exist. */
export async function readDocument(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path.split('/').map(encodeURIComponent).join('/')}`,
    { headers: { Authorization: 'Bearer owner' } },
  )
  if (response.status === 404) {
    return null
  }
  return ((await response.json()) as { fields: Record<string, unknown> }).fields
}
