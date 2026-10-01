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
      method: 'POST',
      headers: { 'Authorization': 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'E2E' } } }),
    },
  )
  if (!response.ok) {
    throw new Error(`Allowlisting ${uid} failed: ${response.status} ${await response.text()}`)
  }
}
