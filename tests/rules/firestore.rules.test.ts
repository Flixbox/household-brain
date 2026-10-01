import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { afterAll, beforeEach, describe, it } from 'vitest'

const env = await initializeTestEnvironment({
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  projectId: 'demo-household-brain',
})

afterAll(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'allowlist/alice'), { name: 'Alice' })
    await setDoc(doc(context.firestore(), 'items/coupon-1'), { title: 'Coupon' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

describe('data collections', () => {
  it('are closed to signed-out visitors', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'items/coupon-1')))
  })

  it('are closed to signed-in accounts that are not on the allowlist', async () => {
    await assertFails(getDoc(doc(as('mallory'), 'items/coupon-1')))
    await assertFails(setDoc(doc(as('mallory'), 'items/coupon-2'), { title: 'x' }))
  })

  it('are open to allowlisted accounts, including nested documents', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'items/coupon-1')))
    await assertSucceeds(setDoc(doc(as('alice'), 'items/coupon-2'), { title: 'x' }))
    await assertSucceeds(setDoc(doc(as('alice'), 'syncState/alice/history/1'), { at: 1 }))
  })
})

describe('allowlist', () => {
  it('lets a signed-in account read only its own entry', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'allowlist/alice')))
    await assertSucceeds(getDoc(doc(as('mallory'), 'allowlist/mallory')))
    await assertFails(getDoc(doc(as('alice'), 'allowlist/bob')))
  })

  it('cannot be changed from the app, even by an allowlisted account', async () => {
    await assertFails(setDoc(doc(as('alice'), 'allowlist/mallory'), { name: 'Mallory' }))
    await assertFails(setDoc(doc(as('alice'), 'allowlist/alice'), { name: 'Changed' }))
    await assertFails(deleteDoc(doc(as('alice'), 'allowlist/alice')))
    await assertFails(setDoc(doc(as('mallory'), 'allowlist/mallory'), { name: 'Mallory' }))
    await assertFails(setDoc(doc(as('alice'), 'allowlist/alice/notes/1'), { text: 'x' }))
  })

  it('is closed to signed-out visitors and cannot be listed', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'allowlist/alice')))
    await assertFails(getDocs(collection(as('alice'), 'allowlist')))
  })
})
